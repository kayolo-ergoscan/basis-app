// The tracker-key rule: ErgoScan's tracker key is the server's signing key (it pays the commit fees) and never lives in
// a browser. Create, restore, import and unlock refuse a key whose public key is the tracker's ("tracker-key-refused").
// Only public keys are compared. No secret of the tracker exists in these tests or anywhere in this repo: the "equal"
// case is a mocked derivation (a random TEST secret whose public key the mock reports as the tracker's).
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { p2pkAddress } from "../../../chain/decode";
import { OUR_TRACKER } from "../../../chain/ours/types";
import { BACKUP_FORMAT, DB_NAME, KEY_FORMAT, KEY_RECORD_ID, STORE_VAULT } from "../constants";
import { isVaultError } from "../errors";
import { isPublicKeyHex, publicKeyOf, refuseTrackerKey, TRACKER_PUBLIC_KEY } from "../keys";
import { backupAad, keyAad } from "../record";
import { openVault } from "../vault";
import { FakeBrowser, PASS, TEST_ITERATIONS } from "./fakes";
import { b64, backUp, code, openTab, randomPub, settle, SIGN_LOCK_NAME, storedRecord } from "./helpers";

vi.mock("../keys", async (importOriginal) => {
  const real = await importOriginal<typeof import("../keys")>();
  return { ...real, publicKeyOf: vi.fn(real.publicKeyOf) };
});

const actual = await vi.importActual<typeof import("../keys")>("../keys");
const derive = vi.mocked(publicKeyOf);
afterEach(() => {
  derive.mockImplementation(actual.publicKeyOf);
});

/** From now on every secret "derives" to the tracker's public key. */
const deriveAsTracker = () => derive.mockImplementation(() => hexToBytes(TRACKER_PUBLIC_KEY));

const TRACKER = "02f17d2d625b7f40f2b1a0ffb5d45fa35be371984ac3a6590945c28c28b99b5fc8";
const ONE = "00".repeat(31) + "01";
const G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

const syncCode = (fn: () => unknown): string => {
  try {
    fn();
    return "ok";
  } catch (e) {
    return isVaultError(e) ? e.code : "other";
  }
};

const rand = (n: number) => crypto.getRandomValues(new Uint8Array(n));

/** A browser whose WebCrypto counts PBKDF2 derivations (to show a refusal comes before any work). */
function countingBrowser(): { b: FakeBrowser; derivations: () => number; open: (tab?: string) => ReturnType<typeof openVault> } {
  const b = new FakeBrowser();
  let n = 0;
  const s = globalThis.crypto.subtle;
  const subtle = {
    importKey: (...a: unknown[]) => (s.importKey as (...x: unknown[]) => Promise<CryptoKey>).apply(s, a),
    deriveKey: (...a: unknown[]) => {
      n++;
      return (s.deriveKey as (...x: unknown[]) => Promise<CryptoKey>).apply(s, a);
    },
    encrypt: (...a: unknown[]) => (s.encrypt as (...x: unknown[]) => Promise<ArrayBuffer>).apply(s, a),
    decrypt: (...a: unknown[]) => (s.decrypt as (...x: unknown[]) => Promise<ArrayBuffer>).apply(s, a),
  } as unknown as SubtleCrypto;
  const c = { getRandomValues: <T extends ArrayBufferView | null>(a: T): T => globalThis.crypto.getRandomValues(a), subtle };
  return { b, derivations: () => n, open: (tab = "a") => openVault({ env: b.env(tab, { crypto: c }), unsafeTestKdfIterations: TEST_ITERATIONS }) };
}

describe("ErgoScan's tracker key is never a wallet key", () => {
  it("is the tracker's key: kept next to OUR_TRACKER, a valid point, and it is the tracker's address", () => {
    expect(TRACKER_PUBLIC_KEY).toBe(TRACKER);
    expect(OUR_TRACKER.key).toBe(TRACKER);
    expect(isPublicKeyHex(TRACKER)).toBe(true);
    expect(p2pkAddress(OUR_TRACKER.key)).toBe(OUR_TRACKER.address);
  });

  it("refuseTrackerKey compares public keys: hex in any case, bytes, the negated point; other keys pass", () => {
    expect(syncCode(() => refuseTrackerKey(TRACKER))).toBe("tracker-key-refused");
    expect(syncCode(() => refuseTrackerKey(TRACKER.toUpperCase()))).toBe("tracker-key-refused");
    expect(syncCode(() => refuseTrackerKey(hexToBytes(TRACKER)))).toBe("tracker-key-refused");
    // the same x with the other parity: its secret is n minus the tracker's, so it is refused too
    const negated = `03${TRACKER.slice(2)}`;
    expect(isPublicKeyHex(negated)).toBe(true);
    expect(syncCode(() => refuseTrackerKey(negated))).toBe("tracker-key-refused");
    const full = secp256k1.ProjectivePoint.fromHex(TRACKER).toRawBytes(false);
    expect(syncCode(() => refuseTrackerKey(full))).toBe("tracker-key-refused");
    for (let i = 0; i < 5; i++) expect(syncCode(() => refuseTrackerKey(randomPub()))).toBe("ok");
    expect(syncCode(() => refuseTrackerKey(G))).toBe("ok");
  });

  it("derives the public key from a test secret (the real derivation) and accepts it", async () => {
    const sk = secp256k1.utils.randomPrivateKey();
    expect(bytesToHex(publicKeyOf(sk))).toBe(bytesToHex(secp256k1.getPublicKey(sk, true)));
    expect(bytesToHex(publicKeyOf(hexToBytes(ONE)))).toBe(G);
    expect(syncCode(() => refuseTrackerKey(publicKeyOf(sk)))).toBe("ok");
    const v = await openTab(new FakeBrowser());
    derive.mockClear();
    const r = await v.importHex(bytesToHex(sk), PASS);
    expect(derive).toHaveBeenCalled();
    expect(r.state).toMatchObject({ status: "unlocked", key: { pub: bytesToHex(secp256k1.getPublicKey(sk, true)) } });
    v.close();
  });

  it("create refuses when the new key derives to the tracker's key (mocked): nothing stored, no KDF, lock free", async () => {
    const { b, derivations, open } = countingBrowser();
    const v = await open();
    deriveAsTracker();
    expect(await code(v.create(PASS))).toBe("tracker-key-refused");
    await settle();
    expect(derivations()).toBe(0);
    expect(storedRecord(b)).toBeUndefined();
    expect(v.getState()).toMatchObject({ status: "none", key: null });
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    v.close();
  });

  it("import refuses a secret that derives to the tracker's key (mocked): nothing stored, no KDF", async () => {
    const { b, derivations, open } = countingBrowser();
    const v = await open();
    deriveAsTracker();
    expect(await code(v.importHex(bytesToHex(secp256k1.utils.randomPrivateKey()), PASS))).toBe("tracker-key-refused");
    expect(derivations()).toBe(0);
    expect(storedRecord(b)).toBeUndefined();
    expect(b.storage.asked).toBe(0);
    expect(v.getState().status).toBe("none");
    v.close();
  });

  it("restore refuses a file whose secret derives to the tracker's key (mocked), before anything is stored", async () => {
    const home = new FakeBrowser();
    const v = await openTab(home);
    await v.create(PASS);
    const json = await backUp(v);
    v.close();
    const { b, open } = countingBrowser();
    const w = await open();
    deriveAsTracker();
    expect(await code(w.restoreFromBackup(json, PASS))).toBe("tracker-key-refused");
    await settle();
    expect(storedRecord(b)).toBeUndefined();
    expect(w.getState()).toMatchObject({ status: "none", key: null });
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    w.close();
  });

  it("restore refuses a file that names the tracker's key before deriving anything", async () => {
    const { b, derivations, open } = countingBrowser();
    const w = await open();
    const file = {
      format: BACKUP_FORMAT,
      v: 1,
      network: "mainnet",
      pub: TRACKER,
      address: OUR_TRACKER.address,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS, salt: b64(rand(16)) },
      cipher: { name: "AES-GCM", iv: b64(rand(12)), tagLength: 128, aad: backupAad(TRACKER) },
      ct: b64(rand(48)), // random bytes: nothing is encrypted in this file
      createdAt: new Date(b.clock.t).toISOString(),
      howToDecrypt: "-",
    };
    expect(await code(w.restoreFromBackup(JSON.stringify(file), PASS))).toBe("tracker-key-refused");
    expect(derivations()).toBe(0);
    expect(b.storage.asked).toBe(0);
    expect(storedRecord(b)).toBeUndefined();
    w.close();
  });

  it("unlock refuses a stored record of the tracker's key before deriving anything", async () => {
    const { b, derivations, open } = countingBrowser();
    const v = await open();
    b.idb.store(DB_NAME, STORE_VAULT).set(KEY_RECORD_ID, {
      format: KEY_FORMAT,
      v: 1,
      network: "mainnet",
      pub: TRACKER,
      address: OUR_TRACKER.address,
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations: TEST_ITERATIONS, salt: b64(rand(16)) },
      cipher: { name: "AES-GCM", iv: b64(rand(12)), tagLength: 128, aad: keyAad(TRACKER) },
      ct: b64(rand(48)),
      createdAt: b.clock.t,
      backedUpAt: null,
      source: "hex",
    });
    await v.refresh();
    expect(v.getState()).toMatchObject({ status: "locked", key: { pub: TRACKER } });
    expect(await code(v.unlock(PASS))).toBe("tracker-key-refused");
    await settle();
    expect(derivations()).toBe(0);
    expect(v.getState().status).toBe("locked");
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    // it can be removed (no backup: the confirmation is needed)
    await v.wipe({ confirmUnbacked: true });
    expect(v.getState().status).toBe("none");
    v.close();
  });
});
