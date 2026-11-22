// Ergo addresses, strict: base58( prefix ‖ content ‖ blake2b256(prefix ‖ content)[0..4] ).
//   prefix = network (0x00 mainnet, 0x10 testnet) + type (1 P2PK, 2 P2SH, 3 P2S)
//   P2PK content = the 33-byte compressed key  → ErgoTree 0008cd ‖ key
//   P2S  content = the ErgoTree itself
// Decoding refuses a bad character, a bad checksum, an unknown prefix and a P2PK key that is not on the curve, so a
// mistyped address never turns into a script.
import { blake2b256, bytesToHex, concatBytes, equalBytes, hexToBytes } from "../../protocol/bytes";
import { isValidPublicKey } from "../../protocol/keys";
import type { Hex } from "./model";

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((c, i) => [c, i] as const));

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = []; // little-endian base-58 digits
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] * 256;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = "1".repeat(zeros);
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  const bytes: number[] = []; // little-endian base-256
  for (let i = zeros; i < s.length; i++) {
    const d = INDEX.get(s[i]);
    if (d === undefined) throw new AddressError("format", `invalid base58 character ${JSON.stringify(s[i])}`);
    let carry = d;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const out = new Uint8Array(zeros + bytes.length);
  for (let i = 0; i < bytes.length; i++) out[zeros + i] = bytes[bytes.length - 1 - i];
  return out;
}

export type Network = "mainnet" | "testnet";
export type AddressType = "P2PK" | "P2SH" | "P2S";
export type AddressFailure = "format" | "checksum" | "prefix" | "network" | "key" | "type";

export class AddressError extends Error {
  constructor(readonly reason: AddressFailure, message: string) {
    super(message);
    this.name = "AddressError";
  }
}

export interface ParsedAddress {
  network: Network;
  type: AddressType;
  /** The key (P2PK), the 24-byte script hash (P2SH) or the ErgoTree (P2S). */
  content: Hex;
  /** The script it pays to; null for P2SH (only its hash is known). */
  ergoTree: Hex | null;
}

const NET: Record<Network, number> = { mainnet: 0x00, testnet: 0x10 };
const TYPE: Record<AddressType, number> = { P2PK: 1, P2SH: 2, P2S: 3 };

function encode(type: AddressType, content: Uint8Array, network: Network): string {
  const body = concatBytes(Uint8Array.of(NET[network] + TYPE[type]), content);
  return base58Encode(concatBytes(body, blake2b256(body).subarray(0, 4)));
}

/** P2PK address of a 33-byte compressed key. */
export function p2pkAddress(pk: Hex, network: Network = "mainnet"): string {
  if (!isValidPublicKey(pk)) throw new AddressError("key", "not a compressed secp256k1 public key");
  return encode("P2PK", hexToBytes(pk), network);
}

/** P2S address of an ErgoTree. */
export function p2sAddress(ergoTree: Hex, network: Network = "mainnet"): string {
  const t = hexToBytes(ergoTree);
  if (t.length === 0) throw new AddressError("format", "empty ErgoTree");
  return encode("P2S", t, network);
}

/** The address a tree pays to: P2PK for 0008cd ‖ key, P2S otherwise (the node's choice). */
export function addressOfTree(ergoTree: Hex, network: Network = "mainnet"): string {
  const t = ergoTree.toLowerCase();
  if (/^0008cd0[23][0-9a-f]{64}$/.test(t) && isValidPublicKey(t.slice(6))) return p2pkAddress(t.slice(6), network);
  return p2sAddress(t, network);
}

/** Decodes and checks an address. Throws AddressError. */
export function parseAddress(addr: string): ParsedAddress {
  const s = addr.trim();
  if (s !== addr || s.length < 10) throw new AddressError("format", "not an address");
  const b = base58Decode(s);
  if (b.length < 6) throw new AddressError("format", "address too short");
  const body = b.subarray(0, b.length - 4);
  if (!equalBytes(b.subarray(b.length - 4), blake2b256(body).subarray(0, 4))) throw new AddressError("checksum", "bad checksum");
  const prefix = body[0];
  const network: Network | null = prefix >> 4 === 0 ? "mainnet" : prefix >> 4 === 1 ? "testnet" : null;
  const type = (["P2PK", "P2SH", "P2S"] as const)[(prefix & 0x0f) - 1];
  if (!network || !type) throw new AddressError("prefix", `unknown address prefix 0x${prefix.toString(16).padStart(2, "0")}`);
  const content = body.subarray(1);
  const hex = bytesToHex(content);
  if (type === "P2PK") {
    if (!isValidPublicKey(content)) throw new AddressError("key", "the P2PK content is not a public key");
    return { network, type, content: hex, ergoTree: `0008cd${hex}` };
  }
  if (type === "P2SH") {
    if (content.length !== 24) throw new AddressError("format", "a P2SH address holds a 24-byte hash");
    return { network, type, content: hex, ergoTree: null };
  }
  if (content.length === 0) throw new AddressError("format", "empty P2S script");
  return { network, type, content: hex, ergoTree: hex };
}

/** The key of a mainnet P2PK address. */
export function p2pkKeyOf(addr: string): Hex {
  const a = parseAddress(addr);
  if (a.network !== "mainnet") throw new AddressError("network", "not a mainnet address");
  if (a.type !== "P2PK") throw new AddressError("type", "not a P2PK address");
  return a.content;
}

/** The ErgoTree of a mainnet P2PK or P2S address (P2SH and testnet are refused: we never pay to them). */
export function treeOfAddress(addr: string): Hex {
  const a = parseAddress(addr);
  if (a.network !== "mainnet") throw new AddressError("network", "not a mainnet address");
  if (!a.ergoTree) throw new AddressError("type", "a P2SH address names only a script hash");
  return a.ergoTree;
}
