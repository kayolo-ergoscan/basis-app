// Ergo register constants used by Basis boxes, serialised exactly as the node shows them in `additionalRegisters`.
//
//   R4 GroupElement : 07 ‖ point(33)
//   R5 AvlTree      : 64 ‖ digest(33) ‖ flags(1) ‖ VLQ(keyLength) ‖ Option[valueLength] (00 = None)
//   R6 Coll[Byte]   : 0e ‖ VLQ(len) ‖ bytes
//   R7 Long         : 05 ‖ ZigZag-VLQ(value)
//
// The tracker box updater writes R5 = 64 ‖ digest ‖ 03 ‖ 20 ‖ 00 (insert+update allowed, 32-byte keys, variable values)
// and R6 = 0e20 ‖ trackerNftId; a fresh reserve must hold the empty AVL+ digest in R5.

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

export function unzigzag64(u: bigint): bigint {
  return BigInt.asIntN(64, (u >> 1n) ^ -(u & 1n));
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

export function encodeAvlTree(t: AvlTreeRegister): Hex {
  const d = toBytes(t.digest);
  if (d.length !== 33) throw new Error("AVL digest must be 33 bytes");
  const vl = t.valueLength === null ? Uint8Array.of(0) : concatBytes(Uint8Array.of(1), vlqEncode(t.valueLength));
  return bytesToHex(concatBytes(Uint8Array.of(0x64), d, Uint8Array.of(t.flags & 0xff), vlqEncode(t.keyLength), vl));
}

export type DecodedRegister =
  | { type: "GroupElement"; value: Hex }
  | { type: "Coll[Byte]"; value: Hex }
  | { type: "Long"; value: bigint }
  | { type: "Int"; value: number }
  | ({ type: "AvlTree" } & AvlTreeRegister)
  | { type: "unknown"; typeByte: number; raw: Hex };

/** Decodes the register constants Basis uses; anything else comes back as `unknown`. */
export function decodeRegister(hex: Hex): DecodedRegister {
  const b = toBytes(hex);
  if (b.length === 0) throw new Error("empty register");
  const t = b[0];
  switch (t) {
    case 0x07:
      if (b.length !== 34) throw new Error("GroupElement register must be 34 bytes");
      return { type: "GroupElement", value: bytesToHex(b.subarray(1)) };
    case 0x0e: {
      const { value: len, next } = vlqDecode(b, 1);
      const end = next + Number(len);
      if (end > b.length) throw new Error("truncated Coll[Byte]");
      return { type: "Coll[Byte]", value: bytesToHex(b.subarray(next, end)) };
    }
    case 0x05:
      return { type: "Long", value: unzigzag64(vlqDecode(b, 1).value) };
    case 0x04:
      return { type: "Int", value: Number(unzigzag64(vlqDecode(b, 1).value)) };
    case 0x64: {
      if (b.length < 36) throw new Error("truncated AvlTree");
      const digest = bytesToHex(b.subarray(1, 34));
      const flags = b[34];
      const kl = vlqDecode(b, 35);
      let valueLength: number | null = null;
      if (b[kl.next] === 1) valueLength = Number(vlqDecode(b, kl.next + 1).value);
      return { type: "AvlTree", digest, flags, keyLength: Number(kl.value), valueLength };
    }
    default:
      return { type: "unknown", typeByte: t, raw: bytesToHex(b) };
  }
}

/** R5 exactly as the tracker box updater and a fresh reserve write it (insert+update, 32-byte keys, variable values). */
export function basisAvlRegister(digest: Uint8Array | Hex): Hex {
  return encodeAvlTree({ digest: typeof digest === "string" ? digest : bytesToHex(digest), flags: AVL_FLAGS_INSERT | AVL_FLAGS_UPDATE, keyLength: 32, valueLength: null });
}
