// The start screen's seed-phrase import without React (seedflow.ts): list, find the expected address among 0–49, import
// through vault.importHex, and keep nothing secret. The phrases are the throwaway test vectors of the vault's seed tests.
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { p2pkAddress } from "@/chain/decode";
import { openVault, type MainnetVault } from "@/mainnet/vault";
import { FakeBrowser, PASS, TEST_ITERATIONS } from "@/mainnet/vault/__tests__/fakes";
import V from "@/mainnet/vault/__tests__/seed-vectors.json";
import { findExpected, importSeedKey, listSeedKeys, type SeedFields } from "./seedflow";

type Vec = (typeof V.vectors)[number];
const byNote = (s: string): Vec => V.vectors.find((v) => v.note.startsWith(s))!;

/** Two "fields" as the screen has them; `cleared` counts the clear() calls. */
function fields(words: string, password = "") {
  const f = { w: words, p: password, cleared: 0 };
  const api: SeedFields = { words: () => f.w, password: () => f.p, clear: () => { f.w = ""; f.p = ""; f.cleared++; } };
  return { f, api };
}

/** Every secret of a vector, as text: the words, the password, the seed and each listed key's secret. */
const secretsOf = (v: Vec): string[] => [v.mnemonic, ...v.mnemonic.split(" ").filter((w) => w.length > 4), ...(v.password ? [v.password] : []), v.seed, ...v.keys.map((k) => k.secret)];
const holdsNone = (value: unknown, v: Vec) => {
  const s = JSON.stringify(value);
  return secretsOf(v).filter((x) => s.includes(x));
};

const openTab = (b: FakeBrowser): Promise<MainnetVault> => openVault({ env: b.env("a"), unsafeTestKdfIterations: TEST_ITERATIONS });

describe("seed import flow: the list", () => {
  it("lists addresses 0–49 of the words and password in the fields; public data only", async () => {
    const v = byNote("same 12 words, ASCII password");
    const { api } = fields(`  ${v.mnemonic.toUpperCase().replace(/ /g, "\n")}  `, v.password);
    const r = await listSeedKeys(api);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.keys.map((k) => k.index)).toEqual([...Array(50).keys()]);
    for (const k of v.keys) expect(r.keys[k.index]).toEqual({ index: k.index, pub: k.pub, address: k.address });
    expect(holdsNone(r, v)).toEqual([]);
  });

  it("says what is wrong with the words, by word number, and derives nothing", async () => {
    const w = byNote("12 words, no password").mnemonic.split(" ");
    expect(await listSeedKeys(fields("").api)).toEqual({ ok: false, problem: { reason: "empty" } });
    expect(await listSeedKeys(fields([...w.slice(0, 2), "basis", ...w.slice(3)].join(" ")).api)).toEqual({ ok: false, problem: { reason: "word", at: 3 } });
    expect(await listSeedKeys(fields(w.slice(0, 11).join(" ")).api)).toEqual({ ok: false, problem: { reason: "count", count: 11 } });
    expect(await listSeedKeys(fields([w[1], w[0], ...w.slice(2)].join(" ")).api)).toEqual({ ok: false, problem: { reason: "checksum" } });
  });
});

describe("seed import flow: the address the user expects", () => {
  it("is found among 0–49 by address or public key, also at the far end; marks nothing when it is not there", async () => {
    const v = byNote("24 words");
    const r = await listSeedKeys(fields(v.mnemonic).api);
    if (!r.ok) throw new Error("vector refused");
    for (const k of v.keys) {
      expect(findExpected(r.keys, ` ${k.address} `)).toEqual({ k: "found", key: { index: k.index, pub: k.pub, address: k.address } });
      expect(findExpected(r.keys, k.pub.toUpperCase())).toMatchObject({ k: "found", key: { index: k.index } });
    }
    expect(findExpected(r.keys, v.keys.find((k) => k.index === 49)!.address)).toMatchObject({ k: "found", key: { index: 49 } });
    // another phrase's address, and the same words under a password: not these keys
    const other = byNote("same 12 words, ASCII password").keys[0];
    expect(findExpected(r.keys, other.address)).toEqual({ k: "none" });
    expect(findExpected(r.keys, "")).toEqual({ k: "empty" });
    expect(findExpected(r.keys, "not an address")).toEqual({ k: "bad", reason: "format" });
    expect(findExpected(r.keys, other.address.slice(0, -1) + (other.address.endsWith("a") ? "b" : "a"))).toEqual({ k: "bad", reason: "checksum" });
  });

  it("a mnemonic password moves every address: the address of the words without it is not found with it", async () => {
    const none = byNote("12 words, no password (pair");
    const withPass = byNote("same 12 words, ASCII password");
    const r = await listSeedKeys(fields(withPass.mnemonic, withPass.password).api);
    if (!r.ok) throw new Error("vector refused");
    for (const k of none.keys) expect(findExpected(r.keys, k.address)).toEqual({ k: "none" });
  });
});

describe("seed import flow: into the vault", () => {
  it("imports the chosen key through importHex, empties the fields and keeps no secret anywhere", async () => {
    const v = byNote("same 12 words, non-ASCII password");
    const pick = v.keys.find((k) => k.index === 17)!;
    const b = new FakeBrowser();
    const vault = await openTab(b);
    const handed: Uint8Array[] = [];
    const spy: Pick<MainnetVault, "importHex"> = {
      importHex: async (key, pass, opts) => {
        if (!(key instanceof Uint8Array)) throw new Error("expected bytes");
        handed.push(key);
        expect(bytesToHex(key)).toBe(pick.secret); // the right key, as bytes (never a hex string)
        return vault.importHex(key, pass, opts);
      },
    };
    const { f, api } = fields(v.mnemonic, v.password.normalize("NFD"));
    const r = await importSeedKey(spy, api, pick, PASS);
    expect(r).toEqual({ ok: true, alreadyPresent: false });
    expect(vault.getState().key).toMatchObject({ pub: pick.pub, address: p2pkAddress(pick.pub), source: "hex", backedUpAt: null });
    // the fields are empty, the bytes handed over are wiped, and nothing returned or stored holds a secret
    expect([f.w, f.p, f.cleared]).toEqual(["", "", 1]);
    expect(handed).toHaveLength(1);
    expect(handed[0].every((x) => x === 0)).toBe(true);
    expect(holdsNone(r, v)).toEqual([]);
    expect(holdsNone(vault.getState(), v)).toEqual([]);
    const db = [...b.idb.store("basis-mainnet", "vault").values()];
    expect(holdsNone(db, v)).toEqual([]);
    // one record, the same fields as any imported key: no words, no path, no index
    expect(db).toHaveLength(1);
    expect(Object.keys(db[0] as object).sort()).toEqual(["address", "backedUpAt", "cipher", "createdAt", "ct", "format", "kdf", "network", "pub", "source", "v"]);
    vault.close();
  });

  it("refuses when the fields no longer give the key that was shown, and keeps the fields for a retry", async () => {
    const v = byNote("same 12 words, ASCII password");
    const b = new FakeBrowser();
    const vault = await openTab(b);
    const pick = v.keys[1];
    // the password changed after the list was made
    const a = fields(v.mnemonic, "");
    expect(await importSeedKey(vault, a.api, pick, PASS)).toEqual({ ok: false, reason: "changed" });
    expect(a.f.cleared).toBe(0);
    // the words no longer pass
    const c = fields(v.mnemonic.split(" ").slice(0, 11).join(" "), v.password);
    expect(await importSeedKey(vault, c.api, pick, PASS)).toEqual({ ok: false, reason: "changed" });
    expect(vault.getState().status).toBe("none");
    vault.close();
  });

  it("never replaces a key already in the browser: «exists», the key and the fields stay as they were", async () => {
    const v = byNote("15 words");
    const b = new FakeBrowser();
    const vault = await openTab(b);
    await vault.create(PASS);
    const before = vault.getState().key!.pub;
    const { f, api } = fields(v.mnemonic);
    await expect(importSeedKey(vault, api, v.keys[0], PASS)).rejects.toMatchObject({ code: "exists" });
    expect(vault.getState().key!.pub).toBe(before);
    expect(f.cleared).toBe(0);
    vault.close();
  });

  it("wipes the derived bytes even when the vault refuses them (a weak passphrase)", async () => {
    const v = byNote("18 words");
    const handed: Uint8Array[] = [];
    const vault = await openTab(new FakeBrowser());
    const spy: Pick<MainnetVault, "importHex"> = { importHex: (key, pass) => { handed.push(key as Uint8Array); return vault.importHex(key, pass); } };
    await expect(importSeedKey(spy, fields(v.mnemonic).api, v.keys[0], "short")).rejects.toMatchObject({ code: "weak-passphrase" });
    expect(handed[0].every((x) => x === 0)).toBe(true);
    vault.close();
  });
});
