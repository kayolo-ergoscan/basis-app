// The general register codec: decoding the constants Basis boxes carry and encoding any AvlTree register (the layouts
// are in ./registers.ts). A module of its own, imported by its path and not re-exported from protocol/index.ts: only the
// mainnet wallet's lazy code reads registers, and registers.ts sits in the first load.
import { bytesToHex, concatBytes, toBytes, type Hex } from "./bytes";
import { vlqDecode, vlqEncode, type AvlTreeRegister } from "./registers";

export function unzigzag64(u: bigint): bigint {
  return BigInt.asIntN(64, (u >> 1n) ^ -(u & 1n));
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
