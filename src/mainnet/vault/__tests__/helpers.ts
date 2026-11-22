import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { DB_NAME, KEY_RECORD_ID, SIGN_LOCK_NAME, STORE_VAULT } from "../constants";
import { isVaultError } from "../errors";
import { openVault, type MainnetVault, type VaultOptions } from "../vault";
import { FakeBrowser, PASS, settle, task, TEST_ITERATIONS } from "./fakes";

export { SIGN_LOCK_NAME };

/** The error code a promise rejects with ("ok" when it resolves). */
export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "ok";
  } catch (e) {
    return isVaultError(e) ? e.code : `other: ${e instanceof Error ? e.name : typeof e}`;
  }
}

export function openTab(b: FakeBrowser, tab = "a", o: Partial<VaultOptions> = {}): Promise<MainnetVault> {
  return openVault({ env: b.env(tab), unsafeTestKdfIterations: TEST_ITERATIONS, ...o });
}

/** The stored key record, read directly from the fake IndexedDB. */
export function storedRecord(b: FakeBrowser): Record<string, any> | undefined {
  return b.idb.store(DB_NAME, STORE_VAULT).get(KEY_RECORD_ID) as Record<string, any> | undefined;
}

/** Downloads the backup and loads it back with the passphrase (the mandatory step before funding). */
export async function backUp(v: MainnetVault, pass = PASS): Promise<string> {
  const { json } = await v.exportBackup();
  await v.verifyBackup(json, pass);
  return json;
}

/** The secret of a TEST key, through the one door that returns it. */
export function revealHex(v: MainnetVault, pass = PASS): Promise<string> {
  return v.withSecret("export-hex", (sk) => bytesToHex(sk), { passphrase: pass });
}

/** A fresh valid public key (random test key, never stored anywhere). */
export function randomPub(): string {
  return bytesToHex(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true));
}

export async function until(cond: () => boolean, what = "condition", rounds = 2000): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    if (cond()) return;
    await new Promise<void>((r) => task(r));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** Flips one bit of a base64 field. */
export function flipB64(s: string, at = 3): string {
  const bin = atob(s);
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  b[at] ^= 0x01;
  return btoa(String.fromCharCode(...b));
}

export function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

export function unb64(s: string): Uint8Array {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

export { settle };
