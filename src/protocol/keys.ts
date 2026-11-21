// secp256k1 key pairs for Basis participants.
//
// A Basis identity is a secp256k1 key: secret scalar x, public key X = x·G, serialised compressed
// (33 bytes, 0x02/0x03 prefix + x coordinate) exactly like Ergo's GroupElement.getEncoded.

import { secp256k1 } from "@noble/curves/secp256k1";
import { blake2b256, bigToBytes, bytesToBig, bytesToHex, hexToBytes, utf8, type Hex } from "./bytes";

export const CURVE_N = secp256k1.CURVE.n;
export const Point = secp256k1.ProjectivePoint;
export type CurvePoint = InstanceType<typeof secp256k1.ProjectivePoint>;

export interface KeyPair {
  /** Secret scalar 1..n-1. Sandbox/demo keys only travel inside the browser. */
  readonly secret: bigint;
  /** Compressed public key, 33 bytes. */
  readonly pub: Uint8Array;
  readonly pubHex: Hex;
}

export function keyPairFromSecret(secret: bigint | Uint8Array | Hex): KeyPair {
  const s = typeof secret === "bigint" ? secret : bytesToBig(typeof secret === "string" ? hexToBytes(secret) : secret);
  if (s <= 0n || s >= CURVE_N) throw new RangeError("secret key must be in [1, n-1]");
  const pub = Point.BASE.multiply(s).toRawBytes(true);
  return { secret: s, pub, pubHex: bytesToHex(pub) };
}

/** Fresh random key (crypto.getRandomValues through noble). */
export function randomKeyPair(): KeyPair {
  return keyPairFromSecret(secp256k1.utils.randomPrivateKey());
}

export const DEMO_SALT = "basis-sandbox-v1";

/**
 * DEMO ONLY. Deterministic key for a sandbox persona: blake2b256("basis/demo-key/v1" ‖ salt ‖ 0x00 ‖ name),
 * reduced into [1, n-1]. Anyone who knows the name can recompute the secret — never use for real funds.
 */
export function demoKeyPair(name: string, salt: string = DEMO_SALT): KeyPair {
  const h = blake2b256(utf8("basis/demo-key/v1"), utf8(salt), new Uint8Array([0]), utf8(name));
  const s = (bytesToBig(h) % (CURVE_N - 1n)) + 1n;
  return keyPairFromSecret(s);
}

export function secretToHex(secret: bigint): Hex {
  return bytesToHex(bigToBytes(secret, 32));
}

/** Decodes a compressed public key; returns null when it is not a valid curve point (or not compressed). */
export function decodePublicKey(pub: Uint8Array | Hex): CurvePoint | null {
  const b = typeof pub === "string" ? safeHex(pub) : pub;
  if (!b || b.length !== 33 || (b[0] !== 0x02 && b[0] !== 0x03)) return null;
  try {
    return Point.fromHex(b);
  } catch {
    return null;
  }
}

export function isValidPublicKey(pub: Uint8Array | Hex): boolean {
  return decodePublicKey(pub) !== null;
}

function safeHex(h: string): Uint8Array | null {
  try {
    return hexToBytes(h);
  } catch {
    return null;
  }
}

/** "02fc84…c063" — compact display form of a public key. */
export function shortId(pub: Uint8Array | Hex): string {
  const h = typeof pub === "string" ? pub.toLowerCase() : bytesToHex(pub);
  return h.length > 12 ? `${h.slice(0, 6)}…${h.slice(-4)}` : h;
}

const ADJ = [
  "amber", "brisk", "calm", "dusky", "eager", "fern", "gilded", "hazel", "ivory", "jade", "keen", "lunar", "mossy", "noble",
  "ochre", "pale", "quiet", "rusty", "silver", "tidal", "umber", "vivid", "woven", "young", "zesty", "azure", "bold", "coral",
  "dawn", "ember", "frost", "glade",
];
const NOUN = [
  "heron", "otter", "lynx", "finch", "badger", "marten", "wren", "ibex", "koi", "lark", "moth", "newt", "orca", "puma", "quail",
  "raven", "stoat", "tern", "urchin", "vole", "whale", "yak", "zebu", "adder", "bison", "crane", "dingo", "egret", "fox", "gecko",
  "hare", "ibis",
];

/** Deterministic two-word nickname for a key ("amber-heron"), handy for avatars and logs. */
export function nickname(pub: Uint8Array | Hex): string {
  const b = typeof pub === "string" ? hexToBytes(pub) : pub;
  const h = blake2b256(utf8("basis/nick"), b);
  return `${ADJ[h[0] % ADJ.length]}-${NOUN[h[1] % NOUN.length]}`;
}
