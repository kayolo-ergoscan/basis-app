// The mainnet key itself: a random secp256k1 scalar (K1, design §4.6). No seed words. The secret only ever exists as a
// Uint8Array that its owner wipes; its public key is the 33-byte compressed point, as Ergo encodes a GroupElement.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { OUR_TRACKER } from "../../chain/ours/types";
import { SECRET_BYTES } from "./constants";
import { VaultError } from "./errors";

export type Hex = string;

/** ErgoScan's tracker key (the server's signing key, it pays the commit fees). Never accepted as a wallet key here. */
export const TRACKER_PUBLIC_KEY: Hex = OUR_TRACKER.key;

export interface RandomSource {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
}

/** A uniformly random secret in [1, n − 1] (rejection sampling, no modulo bias). Rejected draws are wiped. */
export function randomSecret(rng: RandomSource): Uint8Array {
  for (let i = 0; i < 64; i++) {
    const b = rng.getRandomValues(new Uint8Array(SECRET_BYTES));
    if (secp256k1.utils.isValidPrivateKey(b)) return b;
    b.fill(0);
  }
  throw new VaultError("unsupported", "the random generator gave no valid key");
}

/** Compressed public key (33 bytes) of a secret. */
export function publicKeyOf(secret: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(secret, true);
}

/** A 33-byte compressed public key in lowercase hex that is a point on the curve. */
export function isPublicKeyHex(v: unknown): v is Hex {
  if (typeof v !== "string" || !/^0[23][0-9a-f]{64}$/.test(v)) return false;
  try {
    secp256k1.ProjectivePoint.fromHex(v);
    return true;
  } catch {
    return false;
  }
}

/** The x coordinate of a public key in hex (compressed 02/03 or uncompressed 04), or null. */
function xOf(hex: string): string | null {
  if (hex.length === 66 && (hex.startsWith("02") || hex.startsWith("03"))) return hex.slice(2);
  if (hex.length === 130 && hex.startsWith("04")) return hex.slice(2, 66);
  return null;
}

const TRACKER_X = TRACKER_PUBLIC_KEY.slice(2);

/**
 * Throws "tracker-key-refused" when a public key is ErgoScan's tracker key, or its negation (the same x coordinate:
 * its secret is n minus the tracker's, the same secret in disguise). Compares public keys only, never a secret.
 */
export function refuseTrackerKey(pub: Hex | Uint8Array): void {
  const hex = typeof pub === "string" ? pub.toLowerCase() : bytesToHex(pub);
  if (xOf(hex) === TRACKER_X) throw new VaultError("tracker-key-refused", "this is ErgoScan's tracker key: it lives only on the server");
}

/**
 * The 32 bytes of a hex secret typed by an expert ("0x", spaces and capitals allowed). The input string cannot be wiped;
 * the returned bytes must be.
 */
export function secretFromHex(input: string): Uint8Array {
  const h = typeof input === "string" ? input.trim().replace(/^0x/i, "").replace(/\s+/g, "").toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(h)) throw new VaultError("invalid-hex", "a key is 64 hex characters (32 bytes)");
  const b = hexToBytes(h);
  if (!secp256k1.utils.isValidPrivateKey(b)) {
    b.fill(0);
    throw new VaultError("out-of-range", "this number is not a secp256k1 secret key (it must be between 1 and n − 1)");
  }
  return b;
}

/** A copy of a 32-byte secret handed over as bytes (a key derived from a seed phrase, seed.ts). The caller still wipes
 *  its own array; the returned copy must be wiped too. */
export function secretFromBytes(input: Uint8Array): Uint8Array {
  if (!(input instanceof Uint8Array) || input.length !== SECRET_BYTES) throw new VaultError("invalid-hex", "a key is 32 bytes");
  const b = input.slice();
  if (!secp256k1.utils.isValidPrivateKey(b)) {
    b.fill(0);
    throw new VaultError("out-of-range", "this number is not a secp256k1 secret key (it must be between 1 and n − 1)");
  }
  return b;
}
