// The encrypted backup file (design §4.3). Self-describing: with the passphrase and the recipe in `howToDecrypt`, the key
// can be recovered with any PBKDF2 + AES-GCM tool, without this site. The parser checks every field before any work.
import { fromB64 } from "./bytes";
import { BACKUP_FORMAT, CT_BYTES, MAX_BACKUP_TEXT, NETWORK } from "./constants";
import { VaultError } from "./errors";
import { isPublicKeyHex, type Hex } from "./keys";
import { addressOf, backupAad, checkCipher, checkKdf, isObject, type CipherParams, type KdfParams } from "./record";

/** Non-secret lists that help after a restore (watched issuers and contacts, design §4.3 and §6). Not authenticated by
 *  the encryption: treat them as user input. */
export interface BackupExtras {
  watchedIssuers?: Hex[];
  contacts?: BackupContact[];
}

export interface BackupContact {
  pub: Hex;
  name?: string;
}

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  v: 1;
  network: typeof NETWORK;
  pub: Hex;
  address: string;
  kdf: KdfParams;
  cipher: CipherParams;
  ct: string;
  /** When the key was made (ISO 8601, UTC). */
  createdAt: string;
  howToDecrypt: string;
  extras?: BackupExtras;
}

export const HOW_TO_DECRYPT =
  "This file holds one Basis mainnet key (a secp256k1 secret key), encrypted with your passphrase. To decrypt it without " +
  "the Basis app: 1) normalize the passphrase with Unicode NFKC and encode it as UTF-8; 2) derive 32 bytes with " +
  "PBKDF2-HMAC-SHA256, salt = base64-decoded kdf.salt, iterations = kdf.iterations; 3) decrypt with AES-256-GCM: key = " +
  "those 32 bytes, nonce = base64-decoded cipher.iv, additional authenticated data = the UTF-8 bytes of cipher.aad, " +
  "input = base64-decoded ct (the ciphertext followed by its 16-byte tag); 4) the 32 bytes you get are the secret key, " +
  "and its compressed public key must equal pub. Anyone who has this file and the passphrase controls the key.";

export const MAX_WATCHED = 100;
export const MAX_CONTACTS = 200;
export const MAX_CONTACT_NAME = 64;

const bad = (message: string): VaultError => new VaultError("bad-backup", message);

/** `basis-mainnet-key-<8 hex of the key>-<YYYY-MM-DD>.json` */
export function backupFilename(pub: Hex, nowMs: number): string {
  return `basis-mainnet-key-${pub.slice(2, 10)}-${new Date(nowMs).toISOString().slice(0, 10)}.json`;
}

function cleanName(v: unknown): string | undefined | null {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return null;
  const name = v.normalize("NFC").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return [...name].length <= MAX_CONTACT_NAME ? name || undefined : null;
}

/**
 * Extras for a new file: strict (a bad entry is a bug in the caller). For a file being read: lenient (bad entries are
 * dropped; the result is still untrusted input).
 */
export function checkExtras(v: unknown, mode: "strict" | "lenient"): BackupExtras | undefined {
  if (v === undefined || v === null) return undefined;
  const fail = (what: string): undefined => {
    if (mode === "strict") throw new VaultError("bad-input", `backup extras: ${what}`);
    return undefined;
  };
  if (!isObject(v)) return fail("not an object");
  const out: BackupExtras = {};
  if (v.watchedIssuers !== undefined) {
    if (!Array.isArray(v.watchedIssuers)) return fail("watchedIssuers is not a list");
    const keys: Hex[] = [];
    for (const k of v.watchedIssuers) {
      if (!isPublicKeyHex(k)) {
        fail("a watched issuer is not a public key");
        continue;
      }
      if (!keys.includes(k)) keys.push(k);
    }
    if (keys.length > MAX_WATCHED) {
      fail(`more than ${MAX_WATCHED} watched issuers`);
      keys.length = MAX_WATCHED;
    }
    out.watchedIssuers = keys;
  }
  if (v.contacts !== undefined) {
    if (!Array.isArray(v.contacts)) return fail("contacts is not a list");
    const list: BackupContact[] = [];
    for (const c of v.contacts) {
      const name = isObject(c) ? cleanName(c.name) : null;
      if (!isObject(c) || !isPublicKeyHex(c.pub) || name === null) {
        fail("a contact is malformed");
        continue;
      }
      if (list.some((x) => x.pub === c.pub)) continue;
      list.push(name === undefined ? { pub: c.pub } : { pub: c.pub, name });
    }
    if (list.length > MAX_CONTACTS) {
      fail(`more than ${MAX_CONTACTS} contacts`);
      list.length = MAX_CONTACTS;
    }
    out.contacts = list;
  }
  return out;
}

/** Reads a backup file's text. Throws "bad-backup" for anything that is not a well-formed mainnet key backup (a sandbox
 *  backup included). Nothing is decrypted here. */
export function parseBackup(text: unknown, minIterations: number): BackupFile {
  if (typeof text !== "string" || text.length === 0 || text.length > MAX_BACKUP_TEXT) throw bad("this is not a Basis mainnet key backup file");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw bad("this file is not JSON");
  }
  if (!isObject(raw) || raw.format !== BACKUP_FORMAT) throw bad("this file is not a Basis mainnet key backup");
  if (raw.v !== 1) throw bad("this backup file has a version this app does not read");
  if (raw.network !== NETWORK) throw bad("this backup file is not for mainnet");
  const pub = raw.pub;
  if (!isPublicKeyHex(pub)) throw bad("the backup file's public key is malformed");
  if (raw.address !== addressOf(pub)) throw bad("the backup file's address does not match its public key");
  const kdf = checkKdf(raw.kdf, minIterations);
  if (!kdf) throw bad("the backup file's key-derivation settings are not supported");
  const cipher = checkCipher(raw.cipher, backupAad(pub));
  if (!cipher) throw bad("the backup file's cipher settings are not supported");
  if (!fromB64(raw.ct, CT_BYTES)) throw bad("the backup file's ciphertext is malformed");
  const createdAt = raw.createdAt;
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt))) throw bad("the backup file's date is malformed");
  const extras = checkExtras(raw.extras, "lenient");
  const file: BackupFile = { format: BACKUP_FORMAT, v: 1, network: NETWORK, pub, address: raw.address as string, kdf, cipher, ct: raw.ct as string, createdAt, howToDecrypt: typeof raw.howToDecrypt === "string" ? raw.howToDecrypt : HOW_TO_DECRYPT };
  if (extras) file.extras = extras;
  return file;
}
