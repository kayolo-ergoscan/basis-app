// Key lifecycle: create, backup file, verify, restore, import, lock and unlock, the secret door, wipe.
// Every key here is a fresh random test key or a well-known test scalar (1, 2): no real secret anywhere.
import { secp256k1 } from "@noble/curves/secp256k1";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { p2pkAddress } from "../../../chain/decode";
import { DB_NAME, KDF_ITERATIONS, KEY_RECORD_ID, STORE_VAULT } from "../constants";
import { openVault } from "../vault";
import { FakeBrowser, OTHER_PASS, PASS, TEST_ITERATIONS } from "./fakes";
import { b64, backUp, code, flipB64, openTab, randomPub, revealHex, settle, SIGN_LOCK_NAME, storedRecord, unb64 } from "./helpers";

/** The AES key a backup file's passphrase derives (WebCrypto, independent of the vault's code). */
async function passKey(f: { kdf: { salt: string; iterations: number } }, pass: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: unb64(f.kdf.salt), iterations: f.kdf.iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"; // public key of the test scalar 1
const ONE = "00".repeat(31) + "01";

describe("mainnet vault: create, lock, unlock", () => {
  it("creates a key: a mainnet record in IndexedDB, unlocked, not backed up, persist() asked", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    expect(v.getState()).toMatchObject({ status: "none", key: null, backedUp: false, persisted: false, missing: [] });
    const r = await v.create(PASS);
    expect(r.persisted).toBe(true);
    expect(b.storage.asked).toBe(1);
    const s = v.getState();
    expect(s).toMatchObject({ status: "unlocked", backedUp: false, persisted: true, lockReason: null, key: { source: "created", backedUpAt: null } });
    const pub = s.key!.pub;
    expect(pub).toMatch(/^0[23][0-9a-f]{64}$/);
    expect(s.key!.address).toBe(p2pkAddress(pub));
    expect(s.key!.address.startsWith("9")).toBe(true);
    const rec = storedRecord(b)!;
    expect(Object.keys(rec).sort()).toEqual(["address", "backedUpAt", "cipher", "createdAt", "ct", "format", "kdf", "network", "pub", "source", "v"]);
    expect(rec).toMatchObject({
      format: "basis-mainnet-key",
      v: 1,
      network: "mainnet",
      pub,
      address: s.key!.address,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS },
      cipher: { name: "AES-GCM", tagLength: 128, aad: `basis-mainnet-key/v1|${pub}` },
      createdAt: b.clock.t,
      backedUpAt: null,
      source: "created",
    });
    expect([unb64(rec.kdf.salt).length, unb64(rec.cipher.iv).length, unb64(rec.ct).length]).toEqual([16, 12, 48]);
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBe("a");
    // the record holds the key encrypted only
    await backUp(v);
    const hex = await revealHex(v);
    expect(bytesToHex(secp256k1.getPublicKey(hex, true))).toBe(pub);
    expect(b.idb.dump()).not.toContain(hex);
    v.close();
  });

  it("refuses a short passphrase and a second key, also from another tab", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    expect(await code(v.create("eleven char"))).toBe("weak-passphrase");
    expect(await code(v.create("é".repeat(11)))).toBe("weak-passphrase");
    await v.create(PASS);
    expect(await code(v.create(OTHER_PASS))).toBe("exists");
    const w = await openTab(b, "b");
    expect(w.getState().status).toBe("locked");
    expect(await code(w.create(OTHER_PASS))).toBe("exists");
    v.close();
    w.close();
  });

  it("locks and unlocks; a wrong passphrase is refused and frees the lock; the key survives a reload", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const pub = (await v.create(PASS)).state.key!.pub;
    v.lock();
    await settle();
    expect(v.getState()).toMatchObject({ status: "locked", lockReason: "manual" });
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    expect(await code(v.unlock(OTHER_PASS))).toBe("wrong-passphrase");
    await settle();
    expect(v.getState().status).toBe("locked");
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    await v.unlock(PASS);
    expect(v.getState()).toMatchObject({ status: "unlocked", lockReason: null });
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBe("a");
    // already open: unlock() still checks the passphrase
    expect(await code(v.unlock(OTHER_PASS))).toBe("wrong-passphrase");
    expect(v.getState().status).toBe("unlocked");
    expect(await v.confirmPassphrase(PASS)).toBe(true);
    expect(await v.confirmPassphrase(OTHER_PASS)).toBe(false);
    v.close();
    await settle();
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    const again = await openTab(b);
    expect(again.getState()).toMatchObject({ status: "locked", key: { pub } });
    await again.unlock(PASS);
    expect(again.getState().status).toBe("unlocked");
    again.close();
  });

  it("normalises the passphrase with NFKC", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create("café au lait, s'il vous plaît");
    v.lock();
    await v.unlock("café au lait, s'il vous plaît");
    expect(v.getState().status).toBe("unlocked");
    v.close();
  });

  it("uses PBKDF2 with 600 000 iterations by default, and a stronger vault refuses weaker records", async () => {
    expect(KDF_ITERATIONS).toBe(600_000);
    const b = new FakeBrowser();
    const v = await openVault({ env: b.env("a") });
    await v.create(PASS);
    expect(storedRecord(b)!.kdf.iterations).toBe(600_000);
    v.lock();
    await v.unlock(PASS);
    expect(v.getState().status).toBe("unlocked");
    v.close();
    // a record made with the test work factor is "damaged" for a vault with the real floor
    const weakB = new FakeBrowser();
    const t = await openTab(weakB);
    await t.create(PASS);
    t.close();
    const strict = await openVault({ env: weakB.env("a") });
    expect(strict.getState().status).toBe("damaged");
    strict.close();
  }, 60_000);
});

describe("mainnet vault: backup file", () => {
  it("exports a self-describing file and verifies it; wrong passphrase, other key and changed bytes are refused", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const { state } = await v.create(PASS);
    const pub = state.key!.pub;
    const { filename, json } = await v.exportBackup();
    expect(filename).toMatch(new RegExp(`^basis-mainnet-key-${pub.slice(2, 10)}-\\d{4}-\\d{2}-\\d{2}\\.json$`));
    const f = JSON.parse(json);
    expect(Object.keys(f).sort()).toEqual(["address", "cipher", "createdAt", "ct", "format", "howToDecrypt", "kdf", "network", "pub", "v"]);
    expect(f).toMatchObject({
      format: "basis-mainnet-key-backup",
      v: 1,
      network: "mainnet",
      pub,
      address: state.key!.address,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS, salt: storedRecord(b)!.kdf.salt },
      cipher: { name: "AES-GCM", tagLength: 128, aad: `basis-mainnet-key-backup/v1|${pub}` },
      createdAt: new Date(b.clock.t).toISOString(),
    });
    expect(f.cipher.iv).not.toBe(storedRecord(b)!.cipher.iv);
    expect(f.howToDecrypt).toMatch(/NFKC.*PBKDF2-HMAC-SHA256.*AES-256-GCM/s);
    for (const w of ["safe", "guarantee", "trustless", "official", "launched"]) expect(f.howToDecrypt.toLowerCase()).not.toContain(w);
    expect(v.getState().backedUp).toBe(false);

    expect(await code(v.verifyBackup(json, OTHER_PASS))).toBe("wrong-passphrase");
    expect(await code(v.verifyBackup("{}", PASS))).toBe("bad-backup");
    expect(await code(v.verifyBackup("not json", PASS))).toBe("bad-backup");
    expect(await code(v.verifyBackup(JSON.stringify({ ...f, ct: flipB64(f.ct) }), PASS))).toBe("wrong-passphrase");
    expect(await code(v.verifyBackup(JSON.stringify({ ...f, cipher: { ...f.cipher, iv: flipB64(f.cipher.iv) } }), PASS))).toBe("wrong-passphrase");
    expect(await code(v.verifyBackup(JSON.stringify({ ...f, address: p2pkAddress(randomPub()) }), PASS))).toBe("bad-backup");
    // another key's file, and the same file relabelled with our key: the additional data binds the key
    const b2 = new FakeBrowser();
    const other = await openTab(b2);
    await other.create(PASS);
    const o = JSON.parse((await other.exportBackup()).json);
    expect(await code(v.verifyBackup(JSON.stringify(o), PASS))).toBe("backup-other-key");
    const relabelled = { ...o, pub, address: state.key!.address, cipher: { ...o.cipher, aad: `basis-mainnet-key-backup/v1|${pub}` } };
    expect(await code(v.verifyBackup(JSON.stringify(relabelled), PASS))).toBe("wrong-passphrase");
    expect(v.getState().backedUp).toBe(false);

    v.lock();
    b.clock.advance(5000);
    await v.verifyBackup(json, PASS); // works while locked
    expect(v.getState()).toMatchObject({ status: "locked", backedUp: true, key: { backedUpAt: b.clock.t } });
    expect(storedRecord(b)!.backedUpAt).toBe(b.clock.t);
    v.close();
    other.close();
    const again = await openTab(b);
    expect(again.getState().backedUp).toBe(true);
    again.close();
  });

  it("the file and the record decrypt with the file's own recipe alone (independent PBKDF2, raw AES-GCM key)", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    const f = JSON.parse((await v.exportBackup()).json);
    const keyBytes = pbkdf2(sha256, new TextEncoder().encode(PASS.normalize("NFKC")), unb64(f.kdf.salt), { c: f.kdf.iterations, dkLen: 32 });
    const k = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const open = async (iv: string, aad: string, ct: string) => new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv), additionalData: new TextEncoder().encode(aad) }, k, unb64(ct)));
    const fromFile = await open(f.cipher.iv, f.cipher.aad, f.ct);
    expect(fromFile.length).toBe(32);
    expect(bytesToHex(secp256k1.getPublicKey(fromFile, true))).toBe(f.pub);
    const rec = storedRecord(b)!;
    const fromRecord = await open(rec.cipher.iv, rec.cipher.aad, rec.ct);
    expect(bytesToHex(fromRecord)).toBe(bytesToHex(fromFile));
    // the two additional data strings keep the file and the record apart
    await expect(open(f.cipher.iv, rec.cipher.aad, f.ct)).rejects.toThrow();
    v.close();
  });

  it("restores into an empty browser; refuses over another key; the same key again only counts as a check", async () => {
    const home = new FakeBrowser();
    const v = await openTab(home);
    await v.create(PASS);
    const json = await backUp(v);
    const pub = v.getState().key!.pub;

    const fresh = new FakeBrowser();
    const w = await openTab(fresh, "x");
    expect(await code(w.restoreFromBackup(json, OTHER_PASS))).toBe("wrong-passphrase");
    await settle();
    expect(w.getState().status).toBe("none");
    expect(fresh.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    const r = await w.restoreFromBackup(json, PASS);
    expect(r).toMatchObject({ alreadyPresent: false, extras: null, persisted: true });
    expect(w.getState()).toMatchObject({ status: "unlocked", backedUp: true, key: { pub, source: "backup", createdAt: home.clock.t } });
    expect(storedRecord(fresh)!.kdf.salt).toBe(JSON.parse(json).kdf.salt);
    expect(await revealHex(w)).toBe(await revealHex(v)); // the same secret
    expect((await w.restoreFromBackup(json, PASS)).alreadyPresent).toBe(true);
    expect(await code(w.restoreFromBackup(json, OTHER_PASS))).toBe("wrong-passphrase");

    const third = new FakeBrowser();
    const t = await openTab(third);
    await t.create(OTHER_PASS);
    expect(await code(t.restoreFromBackup(json, PASS))).toBe("exists");
    for (const x of [v, w, t]) x.close();
  });

  it("seals watched issuers and contacts inside the file: none of their text is in the file's plaintext", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    const issuer = randomPub();
    const friend = randomPub();
    const name = "Zoë Quartermain";
    expect(await code(v.exportBackup({ extras: { watchedIssuers: ["nope"] } }))).toBe("bad-input");
    const { json } = await v.exportBackup({ extras: { watchedIssuers: [issuer, issuer], contacts: [{ pub: friend, name: `  ${name}\u0007  ` }] } });
    for (const text of [issuer, friend, issuer.slice(2), friend.slice(2, 40), issuer.toUpperCase(), name, "Quartermain", "watchedIssuers", "contacts"]) {
      expect(json.includes(text), text).toBe(false);
    }
    const f = JSON.parse(json);
    expect(Object.keys(f.extras).sort()).toEqual(["cipher", "ct"]);
    expect(f.extras.cipher).toMatchObject({ name: "AES-GCM", tagLength: 128, aad: `basis-mainnet-key-backup/v1|${f.pub}|extras` });
    expect(f.extras.cipher.iv).not.toBe(f.cipher.iv);
    // the file's own recipe opens them too: the same key, their own IV and additional data
    const key = await passKey(f, PASS);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(f.extras.cipher.iv), additionalData: new TextEncoder().encode(f.extras.cipher.aad) }, key, unb64(f.extras.ct));
    expect(JSON.parse(new TextDecoder().decode(plain))).toEqual({ watchedIssuers: [issuer], contacts: [{ pub: friend, name }] });
    // a restore decrypts them (cleaned on export: one issuer, the name trimmed); the same key again returns them too
    const w = await openTab(new FakeBrowser());
    const r = await w.restoreFromBackup(json, PASS);
    expect(r).toMatchObject({ alreadyPresent: false, extrasUnreadable: false, extras: { watchedIssuers: [issuer], contacts: [{ pub: friend, name }] } });
    expect(await w.restoreFromBackup(json, PASS)).toMatchObject({ alreadyPresent: true, extrasUnreadable: false, extras: r.extras });
    // no extras: no field; a file without extras restores with none
    const bare = (await v.exportBackup()).json;
    expect(JSON.parse(bare).extras).toBeUndefined();
    expect(await w.restoreFromBackup(bare, PASS)).toMatchObject({ extras: null, extrasUnreadable: false });
    v.close();
    w.close();
  });

  it("after decryption malformed entries are dropped; extras that do not open are reported, and the key still restores", async () => {
    const home = new FakeBrowser();
    const v = await openTab(home);
    await v.create(PASS);
    const issuer = randomPub();
    const f = JSON.parse((await v.exportBackup({ extras: { watchedIssuers: [issuer] } })).json);
    v.close();
    const key = await passKey(f, PASS);
    /** Seals our own text as another tool could; the envelope always names the extras' additional data. */
    const sealText = async (text: string, aad: string = f.extras.cipher.aad) => {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad) }, key, new TextEncoder().encode(text)));
      return { cipher: { name: "AES-GCM", iv: b64(iv), tagLength: 128, aad: f.extras.cipher.aad }, ct: b64(ct) };
    };
    const restore = async (extras: unknown) => {
      const w = await openTab(new FakeBrowser());
      const r = await w.restoreFromBackup(JSON.stringify({ ...f, extras }), PASS);
      w.close();
      return r;
    };
    const messy = JSON.stringify({
      watchedIssuers: [issuer, "zz", issuer],
      contacts: [{ pub: issuer, name: " Café\u0007" }, { pub: `02${"zz".repeat(32)}` }, { pub: randomPub(), name: 7 }],
    });
    expect(await restore(await sealText(messy))).toMatchObject({ extrasUnreadable: false, extras: { watchedIssuers: [issuer], contacts: [{ pub: issuer, name: "Café" }] } });
    const unreadable: unknown[] = [
      { ...f.extras, ct: flipB64(f.extras.ct) }, // a changed byte
      await sealText(messy, f.cipher.aad), // sealed under the key's additional data
      await sealText("not json"),
      await sealText(JSON.stringify(["a list"])),
      { watchedIssuers: [issuer] }, // lists in the clear: not a format this app reads
      { cipher: f.extras.cipher }, // no ciphertext
    ];
    for (const [i, x] of unreadable.entries()) {
      expect(await restore(x), `case ${i}`).toMatchObject({ extras: null, extrasUnreadable: true, alreadyPresent: false, state: { status: "unlocked", backedUp: true, key: { pub: f.pub } } });
    }
  });

  it("never reads a sandbox backup; the vault's code never touches localStorage, src/world or the console", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const sandbox = {
      format: "basis-sandbox-key-backup",
      version: 1,
      pub: randomPub(),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 210_000, salt: b64(new Uint8Array(16)) },
      cipher: { name: "AES-GCM", iv: b64(new Uint8Array(12)), tagLength: 128 },
      ciphertext: b64(new Uint8Array(48)),
    };
    expect(await code(v.restoreFromBackup(JSON.stringify(sandbox), PASS))).toBe("bad-backup");
    expect(v.getState().status).toBe("none");
    const files = import.meta.glob<string>("/src/mainnet/vault/*.ts", { query: "?raw", import: "default", eager: true });
    expect(Object.keys(files).length).toBeGreaterThanOrEqual(12);
    for (const [path, text] of Object.entries(files)) {
      expect(text, path).not.toMatch(/from\s+["'][^"']*\/world\//);
      expect(text, path).not.toMatch(/\b(localStorage|sessionStorage)\s*[.[]/);
      expect(text, path).not.toMatch(/\bconsole\s*\./);
    }
    v.close();
  });
});

describe("mainnet vault: import hex", () => {
  it("checks the format and the range, derives the public key, and is not backed up", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    expect(await code(v.importHex("12", PASS))).toBe("invalid-hex");
    expect(await code(v.importHex("00".repeat(32), PASS))).toBe("out-of-range");
    expect(await code(v.importHex("ff".repeat(32), PASS))).toBe("out-of-range");
    expect(await code(v.importHex(ONE, "too short"))).toBe("weak-passphrase");
    const r = await v.importHex(`0x${ONE.toUpperCase()}`, PASS);
    expect(r).toMatchObject({ alreadyPresent: false, persisted: true });
    expect(r.state.key).toMatchObject({ pub: G, address: p2pkAddress(G), source: "hex", backedUpAt: null });
    expect(await code(v.withSecret("t1", () => 1))).toBe("not-backed-up");
    expect((await v.importHex(` ${ONE.replace(/(..)/g, "$1 ")} `, PASS)).alreadyPresent).toBe(true);
    expect(await code(v.importHex("00".repeat(31) + "02", PASS))).toBe("exists");
    v.close();
  });
});

describe("mainnet vault: the secret door", () => {
  it("needs an unlocked, backed-up key; hands a 32-byte copy of this key's secret to a synchronous callback and wipes it", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    expect(await code(v.withSecret("t1", () => 1))).toBe("not-backed-up");
    await backUp(v);
    const pub = v.getState().key!.pub;
    const kept: Uint8Array[] = [];
    const seen = await v.withSecret("note", (sk, p) => {
      kept.push(sk);
      expect(sk.length).toBe(32);
      expect(bytesToHex(secp256k1.getPublicKey(sk, true))).toBe(pub);
      return bytesToHex(p);
    });
    expect(seen).toBe(pub);
    expect(kept).toHaveLength(1);
    expect(kept[0].every((x) => x === 0)).toBe(true); // wiped after the callback
    // a signature comes out; it verifies under the public key
    const msg = sha256(new TextEncoder().encode("test message"));
    const sig = await v.withSecret("build-request", (sk) => secp256k1.sign(msg, sk).toCompactRawBytes());
    expect(secp256k1.verify(sig, msg, pub)).toBe(true);
    v.close();
  });

  it("refuses callbacks that return or throw the secret, or return a promise; other errors pass through", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    await backUp(v);
    expect(await code(v.withSecret("t1", (sk) => sk))).toBe("secret-in-output");
    expect(await code(v.withSecret("t1", (sk) => sk.slice()))).toBe("secret-in-output");
    expect(await code(v.withSecret("t1", (sk) => new Uint8Array([9, ...sk, 9])))).toBe("secret-in-output");
    expect(await code(v.withSecret("t1", (sk) => ({ deep: [{ hex: `a${bytesToHex(sk).toUpperCase()}b` }] })))).toBe("secret-in-output");
    expect(await code(v.withSecret("t1", (sk) => BigInt(`0x${bytesToHex(sk)}`)))).toBe("secret-in-output");
    expect(
      await code(
        v.withSecret("t1", (sk) => {
          throw new Error(`bad key ${bytesToHex(sk)}`);
        }),
      ),
    ).toBe("secret-in-output");
    const plain = new Error("L1: the fee is too high");
    await expect(
      v.withSecret("t1", () => {
        throw plain;
      }),
    ).rejects.toBe(plain);
    expect(await code(v.withSecret("t1", async () => 1))).toBe("async-callback");
    expect(await code(v.withSecret("nope" as never, () => 1))).toBe("bad-input");
    expect(v.getState().status).toBe("unlocked");
    v.close();
  });

  it("re-asks the passphrase on demand; export-hex always needs it; a wrong one does not lock", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    await backUp(v);
    expect(await code(v.withSecret("export-hex", (sk) => bytesToHex(sk)))).toBe("passphrase-required");
    expect(await code(v.withSecret("export-hex", (sk) => bytesToHex(sk), { passphrase: OTHER_PASS }))).toBe("wrong-passphrase");
    const hex = await revealHex(v);
    expect(bytesToHex(secp256k1.getPublicKey(hex, true))).toBe(v.getState().key!.pub);
    expect(await code(v.withSecret("redeem", () => 1, { passphrase: OTHER_PASS }))).toBe("wrong-passphrase");
    expect(await v.withSecret("redeem", () => 7, { passphrase: PASS })).toBe(7);
    expect(v.getState().status).toBe("unlocked");
    v.lock();
    expect(await code(v.withSecret("t1", () => 1))).toBe("locked");
    expect(await code(v.exportBackup())).toBe("locked");
    v.close();
  });

  it("locks itself when the stored key vanishes under an open session (site data cleared)", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    await backUp(v);
    b.idb.store(DB_NAME, STORE_VAULT).delete(KEY_RECORD_ID);
    expect(await code(v.withSecret("t1", () => 1))).toBe("locked");
    expect(v.getState()).toMatchObject({ status: "none", key: null, lockReason: "storage-changed" });
    v.close();
  });
});

describe("mainnet vault: damaged records and wipe", () => {
  it("reports a damaged record, refuses to unlock it, and wipes it after a confirmation", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    v.close();
    const rec = storedRecord(b)!;
    b.idb.store(DB_NAME, STORE_VAULT).set(KEY_RECORD_ID, { ...rec, address: p2pkAddress(randomPub()) });
    const w = await openTab(b);
    expect(w.getState()).toMatchObject({ status: "damaged", key: null });
    expect(await code(w.unlock(PASS))).toBe("damaged");
    expect(await code(w.wipe())).toBe("not-backed-up");
    await w.wipe({ confirmUnbacked: true });
    expect(w.getState()).toMatchObject({ status: "none", lockReason: "wiped" });
    w.close();
  });

  it("an unbacked key needs a confirmation; the journal stays unless asked, and open entries keep it", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    expect(await code(v.wipe())).toBe("not-backed-up");
    const json = await backUp(v);
    const pub = v.getState().key!.pub;
    const txId = "aa".repeat(32);
    const e = await v.journal.record({ kind: "withdraw", pub, txId, signedRaw: JSON.stringify({ id: txId }), inputs: ["bb".repeat(32)] });
    await v.journal.claimTimestamp(`build|${pub}`, 5);
    expect(await code(v.wipe({ journal: true }))).toBe("journal-unresolved");
    expect(v.getState().status).toBe("unlocked"); // the failed wipe changed nothing
    expect(storedRecord(b)).toBeDefined();
    await v.wipe();
    expect(v.getState()).toMatchObject({ status: "none", key: null, backedUp: false, lockReason: "wiped" });
    expect(storedRecord(b)).toBeUndefined();
    expect(await v.journal.get(e.id)).not.toBeNull();
    // restored later, the key finds its journal; once every entry is closed a full wipe removes it
    await v.restoreFromBackup(json, PASS);
    await v.journal.update(e.id, { state: "final" });
    await v.wipe({ journal: true });
    expect(await v.journal.list({ pub })).toEqual([]);
    expect(await v.journal.lastTimestamp(`build|${pub}`)).toBeNull();
    v.close();
  });
});
