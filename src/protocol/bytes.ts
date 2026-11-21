// Byte helpers shared by the protocol engine. Pure, no DOM, no network.
//
// Every multi-byte integer the Basis contract reads or writes is big-endian:
// `longToByteArray` / `byteArrayToLong` in ErgoScript are 8-byte two's complement BE.

import { blake2b } from "@noble/hashes/blake2b";
import { bytesToHex as nobleBytesToHex, hexToBytes as nobleHexToBytes, concatBytes as nobleConcat } from "@noble/hashes/utils";

export type Hex = string;

/** 2^63 - 1: the largest value ErgoScript's signed `byteArrayToLong` can read back as positive. */
export const I64_MAX = (1n << 63n) - 1n;
/** 2^64 - 1: largest u64 (the Rust tracker types are u64; the contract reads them as signed Long). */
export const U64_MAX = (1n << 64n) - 1n;

export function bytesToHex(bytes: Uint8Array): Hex {
  return nobleBytesToHex(bytes);
}

export function hexToBytes(hex: Hex): Uint8Array {
  const h = hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0) throw new Error(`hex string has odd length (${h.length})`);
  return nobleHexToBytes(h.toLowerCase());
}

export function toBytes(v: Uint8Array | Hex): Uint8Array {
  return typeof v === "string" ? hexToBytes(v) : v;
}

export function toHex(v: Uint8Array | Hex): Hex {
  return typeof v === "string" ? v.toLowerCase() : bytesToHex(v);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  return nobleConcat(...parts);
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Lexicographic (unsigned) comparison, like sorting keys in an AVL+ tree. */
export function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return a.length === b.length ? 0 : a.length < b.length ? -1 : 1;
}

export function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/** BLAKE2b with a 32-byte digest (Ergo's `blake2b256`). */
export function blake2b256(...parts: Uint8Array[]): Uint8Array {
  const h = blake2b.create({ dkLen: 32 });
  for (const p of parts) h.update(p);
  return h.digest();
}

/**
 * 8-byte big-endian encoding, as ErgoScript's `longToByteArray`.
 * Accepts 0..2^64-1 (u64, as the Rust tracker stores it) and negative values down to -2^63
 * (two's complement, as a signed Long would serialise).
 */
export function u64be(v: bigint): Uint8Array {
  if (v < -(1n << 63n) || v > U64_MAX) throw new RangeError(`value out of 64-bit range: ${v}`);
  let x = v < 0n ? (1n << 64n) + v : v;
  const out = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/** Unsigned big-endian read of `len` bytes (default 8). */
export function readUnsignedBE(b: Uint8Array, offset = 0, len = 8): bigint {
  let x = 0n;
  for (let i = 0; i < len; i++) x = (x << 8n) | BigInt(b[offset + i]);
  return x;
}

/** Signed read, exactly like ErgoScript's `byteArrayToLong` (first 8 bytes, two's complement). */
export function readI64BE(b: Uint8Array, offset = 0): bigint {
  const u = readUnsignedBE(b, offset, 8);
  return u >= 1n << 63n ? u - (1n << 64n) : u;
}

/** Big-endian bytes of a non-negative bigint, left-padded to `len`. */
export function bigToBytes(v: bigint, len = 32): Uint8Array {
  if (v < 0n) throw new RangeError("negative value");
  const out = new Uint8Array(len);
  let x = v;
  for (let i = len - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  if (x !== 0n) throw new RangeError(`value does not fit in ${len} bytes`);
  return out;
}

export function bytesToBig(b: Uint8Array): bigint {
  return readUnsignedBE(b, 0, b.length);
}

/**
 * ErgoScript `byteArrayToBigInt`: SIGNED two's-complement big-endian.
 * A 32-byte value with the top bit set comes out negative — the reason Basis signers retry nonces.
 */
export function bytesToSignedBig(b: Uint8Array): bigint {
  const u = bytesToBig(b);
  if (b.length > 0 && (b[0] & 0x80) !== 0) return u - (1n << BigInt(8 * b.length));
  return u;
}

/** Short hex for display: first `head` and last `tail` hex chars. */
export function shortHex(hex: Hex, head = 6, tail = 4): string {
  const h = toHex(hex);
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** Hex dump grouped by `group` bytes, for X-ray views. */
export function hexGroups(bytes: Uint8Array, group = 8): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += group) out.push(bytesToHex(bytes.subarray(i, i + group)));
  return out;
}
