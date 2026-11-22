// Byte helpers for the generative engine. Hashing is @noble/hashes BLAKE2b (VISUAL §8.1);
// the tile ships its own compact port of the same function, so outputs are identical.
import { blake2b } from "@noble/hashes/blake2b";

export type Bytes = Uint8Array;

export const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const fromHex = (s: string): Uint8Array => new Uint8Array((s.match(/../g) || []).map((h) => parseInt(h, 16)));
export const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

export function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** blake2b with an arbitrary digest length (the tile's `blake2b(input, outlen)`). */
export const blake2bN = (msg: Uint8Array, outlen = 32): Uint8Array => blake2b(msg, { dkLen: outlen });
/** blake2b256: the hash every seed in VISUAL §8.2 is made of. */
export const blake2b256 = (msg: Uint8Array): Uint8Array => blake2b(msg, { dkLen: 32 });

/** Accepts hex or bytes; returns bytes (hex is parsed). */
export const asBytes = (v: string | Uint8Array): Uint8Array => (typeof v === "string" ? fromHex(v) : v);
export const isHex = (s: string, bytes?: number): boolean =>
  /^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0 && (bytes == null || s.length === bytes * 2);
