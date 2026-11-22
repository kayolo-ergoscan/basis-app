// The encrypted backup file (design §4.3). Self-describing: with the passphrase and the recipe in `howToDecrypt`, the key
// can be recovered with any PBKDF2 + AES-GCM tool, without this site. The parser checks every field before any work.
// The optional extras (watched issuers, contacts) are sealed too, so a found file shows nobody's counterparties.
import { fromB64, toB64 } from "./bytes";
import { BACKUP_FORMAT, CT_BYTES, IV_BYTES, MAX_BACKUP_TEXT, MAX_EXTRAS_BYTES, NETWORK } from "./constants";
import { VaultError } from "./errors";
import { seal, unseal } from "./kdf";
import { isPublicKeyHex, type Hex } from "./keys";
import { addressOf, backupAad, checkCipher, checkKdf, extrasAad, isObject, type CipherParams, type KdfParams } from "./record";

/** Lists that help after a restore (watched issuers and contacts, design §4.3 and §6). In the file they are sealed with
 *  the passphrase's key (their own IV and additional data); after decryption they are still treated as user input. */
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
  /** The extras, sealed. null (parser only): the file has extras this app cannot read; the key restores without them. */
  extras?: SealedExtras | null;
}

/** AES-256-GCM of the extras' JSON (UTF-8) under the key derived from the passphrase, with additional data
 *  `basis-mainnet-key-backup/v1|<pub>|extras`. */
export interface SealedExtras {
  cipher: CipherParams;
  /** base64 of the ciphertext followed by its 16-byte tag. */
  ct: string;
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
  const file: BackupFile = { format: BACKUP_FORMAT, v: 1, network: NETWORK, pub, address: raw.address as string, kdf, cipher, ct: raw.ct as string, createdAt, howToDecrypt: typeof raw.howToDecrypt === "string" ? raw.howToDecrypt : HOW_TO_DECRYPT };
  if (raw.extras !== undefined) file.extras = parseSealedExtras(raw.extras, pub);
  return file;
}

/** The sealed extras' envelope, or null when it is malformed (the key still restores; the extras are dropped). */
function parseSealedExtras(v: unknown, pub: Hex): SealedExtras | null {
  if (!isObject(v)) return null;
  const cipher = checkCipher(v.cipher, extrasAad(pub));
  if (!cipher || !fromB64(v.ct, [16, MAX_EXTRAS_BYTES + 16])) return null;
  return { cipher, ct: v.ct as string };
}

/** Seals checked extras for a new file (the caller's key, a fresh IV). The plaintext is wiped. */
export async function sealExtras(subtle: SubtleCrypto, key: CryptoKey, iv: Uint8Array, pub: Hex, extras: BackupExtras): Promise<SealedExtras> {
  const plain = new TextEncoder().encode(JSON.stringify(extras));
  try {
    if (plain.length > MAX_EXTRAS_BYTES) throw new VaultError("bad-input", "backup extras are too large");
    const ct = await seal(subtle, key, iv, extrasAad(pub), plain);
    return { cipher: { name: "AES-GCM", iv: toB64(iv), tagLength: 128, aad: extrasAad(pub) }, ct: toB64(ct) };
  } finally {
    plain.fill(0);
  }
}

export interface OpenedExtras {
  /** The decrypted lists, malformed entries dropped: still untrusted input. Null when the file has none or they are
   *  unreadable. */
  extras: BackupExtras | null;
  /** The file has extras, but they do not decrypt or parse (changed, damaged or from another format). */
  unreadable: boolean;
}

/** Opens a file's sealed extras with the key derived from its passphrase. Never throws. */
export async function openExtras(subtle: SubtleCrypto, key: CryptoKey, sealed: SealedExtras | null | undefined): Promise<OpenedExtras> {
  if (sealed === undefined) return { extras: null, unreadable: false };
  if (sealed === null) return { extras: null, unreadable: true };
  let plain: Uint8Array | null = null;
  try {
    plain = await unseal(subtle, key, fromB64(sealed.cipher.iv, IV_BYTES) as Uint8Array, sealed.cipher.aad, fromB64(sealed.ct) as Uint8Array);
    const extras = checkExtras(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plain)), "lenient");
    return extras ? { extras, unreadable: false } : { extras: null, unreadable: true };
  } catch {
    return { extras: null, unreadable: true };
  } finally {
    plain?.fill(0);
  }
}
