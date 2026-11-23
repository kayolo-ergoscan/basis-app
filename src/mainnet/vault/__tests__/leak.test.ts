// The secret stays inside: after a full session (import, backup, verify, signing, every refusal, two tabs), nothing the
// vault lets out holds it: state, errors (message, stack, JSON), the vault as JSON, string or inspect, stored records,
// the backup file, channel messages, the journal. Nothing is written to the console. Random TEST secret only.
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { holdsSecret, toB64 } from "../bytes";
import { isVaultError } from "../errors";
import { FakeBrowser, OTHER_PASS, PASS } from "./fakes";
import { openTab, randomPub, settle } from "./helpers";
import { p2pkBox } from "../../tx/testkit";

type Inspect = (v: unknown, o?: Record<string, unknown>) => string;
const nodeUtil = (globalThis as { process?: { getBuiltinModule?: (id: string) => { inspect?: Inspect } | undefined } }).process?.getBuiltinModule?.("node:util");
const inspect: Inspect = nodeUtil?.inspect ?? ((v) => String(v));

const CONSOLE = ["log", "info", "warn", "error", "debug", "trace", "dir", "table"] as const;

describe("mainnet vault: the secret never leaves", () => {
  let spies: Array<{ mockRestore: () => void }> = [];
  beforeEach(() => {
    spies = CONSOLE.map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
  });
  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  it("holds through a whole session, refusals included", async () => {
    const sk = secp256k1.utils.randomPrivateKey();
    const skHex = bytesToHex(sk);
    const b = new FakeBrowser();
    const v = await openTab(b);
    const errors: unknown[] = [];
    const attempt = async (p: Promise<unknown>): Promise<void> => {
      try {
        await p;
      } catch (e) {
        errors.push(e);
      }
    };
    const results: unknown[] = [];

    results.push(await v.importHex(`0x${skHex.toUpperCase()}`, PASS));
    const backup = await v.exportBackup({ extras: { watchedIssuers: [randomPub()] } });
    await attempt(v.verifyBackup(backup.json, OTHER_PASS));
    results.push(await v.verifyBackup(backup.json, PASS));
    // callbacks that try to hand the secret out, in every shape the guard knows
    await attempt(v.withSecret("redeem", (s) => s));
    await attempt(v.withSecret("redeem", (s) => ({ raw: Array.from(s) })));
    await attempt(v.withSecret("redeem", (s) => JSON.stringify({ k: Array.from(s) })));
    await attempt(v.withSecret("redeem", (s) => toB64(s)));
    await attempt(v.withSecret("redeem", (s) => `key=${bytesToHex(s).toUpperCase()};`));
    await attempt(v.withSecret("redeem", (s) => new Map([["k", s.slice().buffer]])));
    await attempt(v.withSecret("redeem", (s) => BigInt(`0x${bytesToHex(s)}`).toString()));
    await attempt(
      v.withSecret("redeem", (s) => {
        throw new Error("wrapped", { cause: { key: bytesToHex(s) } });
      }),
    );
    await attempt(
      v.withSecret("redeem", (s) => {
        throw { inner: [s.slice()] };
      }),
    );
    await attempt(v.withSecret("redeem", (s) => () => s));
    await attempt(v.withSecret("redeem", async () => 1));
    await attempt(v.withSecret("export-hex", (s) => bytesToHex(s), { passphrase: OTHER_PASS }));
    await attempt(v.unlock(OTHER_PASS));
    // honest use
    const msg = sha256(new TextEncoder().encode("leak test"));
    results.push(await v.withSecret("build-request", (s) => bytesToHex(secp256k1.sign(msg, s).toCompactRawBytes())));
    const txId = "ab".repeat(32);
    const own = `0008cd${bytesToHex(secp256k1.getPublicKey(sk, true))}`;
    const coin = p2pkBox(bytesToHex(secp256k1.getPublicKey(sk, true)), 2_000_000n);
    results.push(await v.signToJournal("withdraw", (s) => ({ txId, signedRaw: JSON.stringify({ id: txId, inputs: [{ boxId: coin.boxId, spendingProof: { proofBytes: bytesToHex(secp256k1.sign(msg, s).toCompactRawBytes()), extension: {} } }], outputs: [{ value: 1000, ergoTree: own }] }), inputs: [coin.boxId] }), { inputBoxes: [coin] }));
    // more refusals: locked, weak, malformed, a second key, another tab
    v.lock();
    await attempt(v.withSecret("t1", () => 1));
    await attempt(v.exportBackup());
    await v.unlock(PASS);
    await attempt(v.importHex(skHex, "short"));
    await attempt(v.importHex(skHex.slice(2), PASS));
    await attempt(v.importHex(`${skHex}00`, PASS));
    await attempt(v.create(PASS));
    const t = await openTab(b, "b");
    await attempt(t.unlock(PASS));
    await attempt(t.withSecret("t1", () => 1));
    await settle();

    expect(errors.length).toBe(22);
    expect(errors.every((e) => isVaultError(e))).toBe(true);
    const codes = errors.map((e) => (isVaultError(e) ? e.code : "?"));
    expect(codes.filter((c) => c === "secret-in-output")).toHaveLength(10);

    const out: unknown[] = [
      ...errors.flatMap((e) => [e, String(e), JSON.stringify(e), (e as Error).stack, (e as Error).message, inspect(e, { depth: 8, showHidden: true })]),
      ...results,
      v.getState(),
      t.getState(),
      JSON.stringify(v),
      String(v),
      inspect(v, { depth: 8, showHidden: true }),
      inspect(v.journal, { depth: 8, showHidden: true }),
      v.journal.getSnapshot(),
      backup,
      b.idb.dump(),
      b.hub.sent,
    ];
    for (const [i, o] of out.entries()) expect(holdsSecret(o, sk), `output #${i}`).toBe(false);
    const text = out.map((o) => (typeof o === "string" ? o : JSON.stringify(o) ?? "")).join("\n");
    for (const form of [skHex, skHex.toUpperCase(), toB64(sk), BigInt(`0x${skHex}`).toString()]) expect(text.includes(form)).toBe(false);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    v.close();
    t.close();
  });

  it("the vault and its errors print safely", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    const pub = v.getState().key!.pub;
    expect(JSON.parse(JSON.stringify(v))).toEqual({ type: "MainnetVault", status: "unlocked", pub });
    expect(String(v)).toBe(`MainnetVault <unlocked ${pub.slice(0, 10)}…>`);
    expect(inspect(v)).toContain("MainnetVault <unlocked");
    let caught: unknown;
    try {
      await v.unlock(OTHER_PASS);
    } catch (e) {
      caught = e;
    }
    expect(JSON.parse(JSON.stringify(caught))).toEqual({ name: "VaultError", code: "wrong-passphrase", message: "wrong passphrase, or the encrypted data was changed", detail: null });
    expect(String(caught)).not.toContain(OTHER_PASS);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    v.close();
  });
});
