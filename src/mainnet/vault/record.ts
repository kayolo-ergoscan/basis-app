// The stored key record (IndexedDB "basis-mainnet" / "vault" / "key-v1", design §4.2) and the checks shared with the
// backup file. The parameters travel with the ciphertext, so the work factor can be raised later.
import { p2pkAddress } from "../../chain/decode";
import { fromB64 } from "./bytes";
import { BACKUP_AAD_PREFIX, BACKUP_EXTRAS_AAD_SUFFIX, CT_BYTES, IV_BYTES, KDF_MAX_ITERATIONS, KEY_AAD_PREFIX, KEY_FORMAT, NETWORK } from "./constants";
import { isPublicKeyHex, type Hex } from "./keys";

export interface KdfParams {
  name: "PBKDF2";
  hash: "SHA-256";
  iterations: number;
  /** base64, 16–64 bytes. */
  salt: string;
}

export interface CipherParams {
  name: "AES-GCM";
  /** base64, 12 bytes. */
  iv: string;
  tagLength: 128;
  /** UTF-8 additional data: "<format>/v1|<pub>". */
  aad: string;
}

/** How the key came into this browser. */
export type KeySource = "created" | "backup" | "hex";

export interface KeyRecord {
  format: typeof KEY_FORMAT;
  v: 1;
  network: typeof NETWORK;
  pub: Hex;
  address: string;
  kdf: KdfParams;
  cipher: CipherParams;
  /** base64 of AES-256-GCM(secret) ‖ tag: 48 bytes. */
  ct: string;
  /** ms since 1970. */
  createdAt: number;
  /** When a backup file was last proven to decrypt to this key (ms), or null. Funding waits for it. */
  backedUpAt: number | null;
  source: KeySource;
}

export const keyAad = (pub: Hex): string => KEY_AAD_PREFIX + pub;
export const backupAad = (pub: Hex): string => BACKUP_AAD_PREFIX + pub;
export const extrasAad = (pub: Hex): string => BACKUP_AAD_PREFIX + pub + BACKUP_EXTRAS_AAD_SUFFIX;

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isTime = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export function checkKdf(v: unknown, minIterations: number): KdfParams | null {
  if (!isObject(v) || v.name !== "PBKDF2" || v.hash !== "SHA-256") return null;
  const it = v.iterations;
  if (typeof it !== "number" || !Number.isSafeInteger(it) || it < minIterations || it > KDF_MAX_ITERATIONS) return null;
  if (!fromB64(v.salt, [16, 64])) return null;
  return { name: "PBKDF2", hash: "SHA-256", iterations: it, salt: v.salt as string };
}

export function checkCipher(v: unknown, aad: string): CipherParams | null {
  if (!isObject(v) || v.name !== "AES-GCM" || v.tagLength !== 128 || v.aad !== aad) return null;
  if (!fromB64(v.iv, IV_BYTES)) return null;
  return { name: "AES-GCM", iv: v.iv as string, tagLength: 128, aad };
}

/** The mainnet P2PK address of a public key (base58, prefix 0x01, blake2b256 checksum). */
export const addressOf = (pub: Hex): string => p2pkAddress(pub, "mainnet");

/** A stored record, checked field by field (and against itself: the address and the additional data name its key). */
export function parseKeyRecord(raw: unknown, minIterations: number): KeyRecord | null {
  if (!isObject(raw) || raw.format !== KEY_FORMAT || raw.v !== 1 || raw.network !== NETWORK) return null;
  const pub = raw.pub;
  if (!isPublicKeyHex(pub) || raw.address !== addressOf(pub)) return null;
  const kdf = checkKdf(raw.kdf, minIterations);
  const cipher = checkCipher(raw.cipher, keyAad(pub));
  if (!kdf || !cipher || !fromB64(raw.ct, CT_BYTES)) return null;
  if (!isTime(raw.createdAt) || (raw.backedUpAt !== null && !isTime(raw.backedUpAt))) return null;
  if (raw.source !== "created" && raw.source !== "backup" && raw.source !== "hex") return null;
  return { format: KEY_FORMAT, v: 1, network: NETWORK, pub, address: raw.address as string, kdf, cipher, ct: raw.ct as string, createdAt: raw.createdAt, backedUpAt: raw.backedUpAt, source: raw.source };
}
