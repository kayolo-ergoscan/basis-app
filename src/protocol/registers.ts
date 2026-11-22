// Ergo register constants used by Basis boxes, serialised exactly as the node shows them in `additionalRegisters`.
//
//   R4 GroupElement : 07 ‖ point(33)
//   R5 AvlTree      : 64 ‖ digest(33) ‖ flags(1) ‖ VLQ(keyLength) ‖ Option[valueLength] (00 = None)
//   R6 Coll[Byte]   : 0e ‖ VLQ(len) ‖ bytes
//   R7 Long         : 05 ‖ ZigZag-VLQ(value)
//
// The tracker box updater writes R5 = 64 ‖ digest ‖ 03 ‖ 20 ‖ 00 (insert+update allowed, 32-byte keys, variable values)
// and R6 = 0e20 ‖ trackerNftId; a fresh reserve must hold the empty AVL+ digest in R5.
//
// This module is in the first load (protocol/index.ts) and keeps only what the shell and the engine use. Decoding any
// register and encoding any AvlTree live in ./registerCodec.ts, which only the mainnet wallet's lazy code imports.

import { bytesToHex, concatBytes, toBytes, type Hex } from "./bytes";

/** Root digest of an empty Ergo AVL+ tree with 32-byte keys (label ‖ height 0). Real value, not simulated. */
export const EMPTY_AVL_DIGEST_HEX = "4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900";

export const AVL_FLAGS_INSERT = 0x01;
export const AVL_FLAGS_UPDATE = 0x02;
export const AVL_FLAGS_REMOVE = 0x04;

export function vlqEncode(value: bigint | number): Uint8Array {
  let v = BigInt(value);
  if (v < 0n) throw new RangeError("VLQ of a negative number");
  const out: number[] = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    out.push(byte);
  } while (v !== 0n);
  return Uint8Array.from(out);
}

export function vlqDecode(b: Uint8Array, offset = 0): { value: bigint; next: number } {
  let shift = 0n;
  let v = 0n;
  let i = offset;
  for (;;) {
    if (i >= b.length) throw new Error("truncated VLQ");
    const byte = b[i++];
    v |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
    if (shift > 70n) throw new Error("VLQ too long");
  }
  return { value: v, next: i };
}

export function zigzag64(v: bigint): bigint {
  const x = BigInt.asIntN(64, v);
  return BigInt.asUintN(64, (x << 1n) ^ (x >> 63n));
}

export function encodeGroupElement(pub: Uint8Array | Hex): Hex {
  const p = toBytes(pub);
  if (p.length !== 33) throw new Error("GroupElement must be 33 bytes");
  return bytesToHex(concatBytes(Uint8Array.of(0x07), p));
}

export function encodeCollByte(bytes: Uint8Array | Hex): Hex {
  const b = toBytes(bytes);
  return bytesToHex(concatBytes(Uint8Array.of(0x0e), vlqEncode(b.length), b));
}

export function encodeLong(v: bigint): Hex {
  return bytesToHex(concatBytes(Uint8Array.of(0x05), vlqEncode(zigzag64(v))));
}

export function encodeInt(v: number): Hex {
  return bytesToHex(concatBytes(Uint8Array.of(0x04), vlqEncode(zigzag64(BigInt(v)))));
}

export interface AvlTreeRegister {
  digest: Hex;
  flags: number;
  keyLength: number;
  valueLength: number | null;
}

/** R5 exactly as the tracker box updater and a fresh reserve write it (insert+update, 32-byte keys, variable values). */
export function basisAvlRegister(digest: Uint8Array | Hex): Hex {
  const d = toBytes(digest);
  if (d.length !== 33) throw new Error("AVL digest must be 33 bytes");
  // 64 ‖ digest ‖ flags 03 ‖ keyLength VLQ(32) = 20 ‖ valueLength None = 00 (registerCodec.test.ts: = encodeAvlTree)
  return bytesToHex(concatBytes(Uint8Array.of(0x64), d, Uint8Array.of(AVL_FLAGS_INSERT | AVL_FLAGS_UPDATE, 32, 0)));
}
