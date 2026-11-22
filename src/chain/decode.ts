// src/chain/decode.ts — pure decoders for mainnet Basis boxes. No network, no React, no DOM except the optional
// WebCrypto path of templateHash(). Rules and constants: research/KNOWLEDGE.md §d.1, §d.5, §i, Appendix B (with the
// verifier's fixes: ownNft from assets[0], trackerValid without R6; template hash = SHA-256, not blake2b256).
import { blake2b } from "@noble/hashes/blake2b";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes as nobleHexToBytes } from "@noble/hashes/utils";
import type {
  ApiAsset, ApiRegister, AvlTreeInfo, BasisRegisters, DecodedConstant, EmergencyClock, ExitAssessment, ExitClass,
  ExitReason, Hex, RefundClock, SeedAvl, TokenKind, TrackerStatus,
} from "./types";

// ─── constants ──────────────────────────────────────────────────────────────────────────────────

export const EMERGENCY_BLOCKS = 2160;            // basis.es:337-338: (HEIGHT − tracker.creationInfo._1) > 3 * 720
export const REFUND_BLOCKS = 43200;              // basis.es:231: 60 days × 720 blocks
export const BLOCK_SECONDS = 120;
export const EMPTY_DIGEST = "4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900";
export const USE_TOKEN_ID = "a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669";      // DexyUSD, 3 dp
export const USE_LOOKALIKE_ID = "548a6819b987023f413beb3320deafe16f8d81ca4836aebed94bae9098a69201";  // test token named "USE", 6 dp
/** The two current templates the detector watches (KNOWLEDGE §d.5): ERG post-C3 `2XoR96…`, multi-token `8LeDK9…`. */
export const CURRENT_TEMPLATES = {
  erg: "6e7d9a0e012e556d78a84cb373eca1b279695e7b48731b9158fd0ddd3faeff01",
  multiToken: "8699a5572dd93d3fc1d6b33157d26bb1451c4cdd4e969e6e08e50b18e32f4feb",
} as const;
export const FEE_TREE_PREFIX = "1005040004000e36100204a00b08cd0279be";   // miner-fee contract 2iHkR7CW…

// ─── bytes ──────────────────────────────────────────────────────────────────────────────────────

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new Error("not a hex string");
  return nobleHexToBytes(h.toLowerCase());
}
export { bytesToHex };

export const isHex = (s: unknown, bytes?: number): s is string =>
  typeof s === "string" && /^[0-9a-fA-F]*$/.test(s) && s.length % 2 === 0 && (bytes === undefined || s.length === bytes * 2);

/** VISUAL §4.3 hex: first 4 + "…" + last 4 ("02d9…60b6"); `n` changes both halves. */
export const shortHex = (h: string | null | undefined, n = 4): string => (!h ? "—" : h.length <= 2 * n + 1 ? h : `${h.slice(0, n)}…${h.slice(-n)}`);

/** VISUAL §4.3 integer: thousands separated by a thin space + word joiner (U+2009 U+2060): 43 200. */
export const fmtInt = (n: number | bigint): string => n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "\u2009\u2060");

export function blake2b256(...parts: Uint8Array[]): Uint8Array {
  const h = blake2b.create({ dkLen: 32 });
  for (const p of parts) h.update(p);
  return h.digest();
}

/** Unsigned LEB128 VLQ (Ergo `putULong`). Returns [value, nextOffset]. */
export function readVlq(b: Uint8Array, i: number): [bigint, number] {
  let n = 0n;
  let shift = 0n;
  for (;;) {
    if (i >= b.length) throw new Error("truncated VLQ");
    const x = b[i++];
    n |= BigInt(x & 0x7f) << shift;
    if ((x & 0x80) === 0) return [n, i];
    shift += 7n;
    if (shift > 70n) throw new Error("VLQ too long");
  }
}
export const unzigzag = (n: bigint): bigint => (n >> 1n) ^ -(n & 1n);

/** Exact decimal string of raw units: formatUnits(50000000n, 9) → "0.05", formatUnits(3400n, 3) → "3.4". */
export function formatUnits(raw: bigint | string | number, decimals: number): string {
  let v = BigInt(raw);
  const neg = v < 0n;
  if (neg) v = -v;
  const base = 10n ** BigInt(decimals);
  const int = v / base;
  let frac = decimals ? (v % base).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${int.toString()}${frac ? "." + frac : ""}`;
}

// ─── Sigma constants (register values and ErgoTree constants) ──────────────────────────────────

type SType =
  | { k: "prim"; id: number }
  | { k: "coll"; e: SType }
  | { k: "option"; e: SType }
  | { k: "tuple"; items: SType[] }
  | { k: "avl" }
  | { k: "unit" }
  | { k: "string" }
  | { k: "box" }
  | { k: "any" };

const PRIM_NAMES: Record<number, string> = { 1: "Boolean", 2: "Byte", 3: "Short", 4: "Int", 5: "Long", 6: "BigInt", 7: "GroupElement", 8: "SigmaProp", 9: "UnsignedBigInt" };

export function typeName(t: SType): string {
  switch (t.k) {
    case "prim": return PRIM_NAMES[t.id] ?? `Prim${t.id}`;
    case "coll": return `Coll[${typeName(t.e)}]`;
    case "option": return `Option[${typeName(t.e)}]`;
    case "tuple": return `(${t.items.map(typeName).join(", ")})`;
    case "avl": return "AvlTree";
    case "unit": return "Unit";
    case "string": return "String";
    case "box": return "Box";
    case "any": return "Any";
  }
}

/** Type codes of sigma TypeSerializer: prims 1–11, Coll 12, nested Coll 24, Option 36, Option[Coll] 48, pairs 60/72/84, tuple 96. */
function readType(b: Uint8Array, i: number): [SType, number] {
  if (i >= b.length) throw new Error("truncated type");
  const c = b[i++];
  const prim = (id: number): SType => ({ k: "prim", id });
  const isPrim = (id: number) => id >= 1 && id <= 11;
  if (isPrim(c)) return [prim(c), i];
  if (c >= 12 && c < 24) { if (c === 12) { const [e, j] = readType(b, i); return [{ k: "coll", e }, j]; } return [{ k: "coll", e: prim(c - 12) }, i]; }
  if (c >= 24 && c < 36) { if (c === 24) { const [e, j] = readType(b, i); return [{ k: "coll", e: { k: "coll", e } }, j]; } return [{ k: "coll", e: { k: "coll", e: prim(c - 24) } }, i]; }
  if (c >= 36 && c < 48) { if (c === 36) { const [e, j] = readType(b, i); return [{ k: "option", e }, j]; } return [{ k: "option", e: prim(c - 36) }, i]; }
  if (c >= 48 && c < 60) { if (c === 48) { const [e, j] = readType(b, i); return [{ k: "option", e: { k: "coll", e } }, j]; } return [{ k: "option", e: { k: "coll", e: prim(c - 48) } }, i]; }
  if (c >= 60 && c < 72) {
    if (c === 60) { const [a, j] = readType(b, i); const [d, k] = readType(b, j); return [{ k: "tuple", items: [a, d] }, k]; }
    const [d, j] = readType(b, i); return [{ k: "tuple", items: [prim(c - 60), d] }, j];
  }
  if (c >= 72 && c < 84) {
    if (c === 72) { const [a, j] = readType(b, i); const [d, k] = readType(b, j); return [{ k: "tuple", items: [a, d] }, k]; }
    const [a, j] = readType(b, i); return [{ k: "tuple", items: [a, prim(c - 72)] }, j];
  }
  if (c >= 84 && c < 96) { if (c === 84) { const [a, j] = readType(b, i); return [{ k: "tuple", items: [a, a] }, j]; } return [{ k: "tuple", items: [prim(c - 84), prim(c - 84)] }, i]; }
  if (c === 96) {
    const n = b[i++]; const items: SType[] = []; let j = i;
    for (let x = 0; x < n; x++) { const [t, jj] = readType(b, j); items.push(t); j = jj; }
    return [{ k: "tuple", items }, j];
  }
  if (c === 97) return [{ k: "any" }, i];
  if (c === 98) return [{ k: "unit" }, i];
  if (c === 99) return [{ k: "box" }, i];
  if (c === 100) return [{ k: "avl" }, i];
  if (c === 102) return [{ k: "string" }, i];
  throw new Error(`unsupported type code ${c} (0x${c.toString(16)})`);
}

export interface SigmaPropValue { kind: "proveDlog" | "proveDHTuple" | "and" | "or" | "threshold" | "trivial"; keys?: Hex[]; k?: number; children?: SigmaPropValue[]; value?: boolean }

function readSigmaBoolean(b: Uint8Array, i: number): [SigmaPropValue, number] {
  const op = b[i++];
  if (op === 0xcd) return [{ kind: "proveDlog", keys: [bytesToHex(b.subarray(i, i + 33))] }, i + 33];
  if (op === 0xce) {
    const keys: Hex[] = [];
    for (let x = 0; x < 4; x++) keys.push(bytesToHex(b.subarray(i + 33 * x, i + 33 * (x + 1))));
    return [{ kind: "proveDHTuple", keys }, i + 132];
  }
  if (op === 0x96 || op === 0x97 || op === 0x98) {
    let j = i; let k: number | undefined;
    if (op === 0x98) { const [kk, j1] = readVlq(b, j); k = Number(kk); j = j1; }
    const [n, j2] = readVlq(b, j); j = j2;
    const children: SigmaPropValue[] = [];
    for (let x = 0; x < Number(n); x++) { const [c, jj] = readSigmaBoolean(b, j); children.push(c); j = jj; }
    return [{ kind: op === 0x96 ? "and" : op === 0x97 ? "or" : "threshold", k, children }, j];
  }
  throw new Error(`unsupported SigmaProp opcode 0x${op.toString(16)}`);
}

function readAvl(b: Uint8Array, i: number): [AvlTreeInfo, number] {
  if (i + 34 > b.length) throw new Error("truncated AvlTree");
  const digest = bytesToHex(b.subarray(i, i + 33));
  const flags = b[i + 33];
  const [kl, j] = readVlq(b, i + 34);
  let valueLength: number | null = null;
  let k = j;
  if (k >= b.length) throw new Error("truncated AvlTree (valueLengthOpt)");
  const tag = b[k++];
  if (tag === 1) { const [vl, kk] = readVlq(b, k); valueLength = Number(vl); k = kk; }
  else if (tag !== 0) throw new Error("bad AvlTree valueLengthOpt tag");
  return [avlInfo(digest, flags, Number(kl), valueLength), k];
}

export function avlInfo(digest: Hex, flags: number, keyLength: number, valueLength: number | null): AvlTreeInfo {
  return {
    digest,
    rootHash: digest.slice(0, 64),
    height: parseInt(digest.slice(64, 66), 16),
    flags,
    insert: (flags & 1) !== 0,
    update: (flags & 2) !== 0,
    remove: (flags & 4) !== 0,
    keyLength,
    valueLength,
    empty: digest === EMPTY_DIGEST,
    zero: /^0+$/.test(digest),
  };
}

function readValue(b: Uint8Array, i: number, t: SType): [unknown, number] {
  switch (t.k) {
    case "prim":
      switch (t.id) {
        case 1: return [b[i] !== 0, i + 1];
        case 2: return [b[i] > 127 ? b[i] - 256 : b[i], i + 1];
        case 3: case 4: { const [n, j] = readVlq(b, i); return [Number(unzigzag(n)), j]; }
        case 5: { const [n, j] = readVlq(b, i); return [BigInt.asIntN(64, unzigzag(n)), j]; }
        case 6: case 9: {
          const [len, j] = readVlq(b, i); const bytes = b.subarray(j, j + Number(len));
          let v = 0n; for (const x of bytes) v = (v << 8n) | BigInt(x);
          if (t.id === 6 && bytes.length && bytes[0] & 0x80) v -= 1n << BigInt(8 * bytes.length);
          return [v, j + Number(len)];
        }
        case 7: if (i + 33 > b.length) throw new Error("truncated GroupElement"); return [bytesToHex(b.subarray(i, i + 33)), i + 33];
        case 8: return readSigmaBoolean(b, i);
        default: throw new Error(`unsupported primitive ${t.id}`);
      }
    case "coll": {
      const [nBig, j0] = readVlq(b, i); const n = Number(nBig); let j = j0;
      if (t.e.k === "prim" && t.e.id === 2) { if (j + n > b.length) throw new Error("truncated Coll[Byte]"); return [bytesToHex(b.subarray(j, j + n)), j + n]; }
      if (t.e.k === "prim" && t.e.id === 1) {
        const nb = (n + 7) >> 3; const out: boolean[] = [];
        for (let x = 0; x < n; x++) out.push(((b[j + (x >> 3)] >> (x & 7)) & 1) === 1);
        return [out, j + nb];
      }
      const out: unknown[] = [];
      for (let x = 0; x < n; x++) { const [v, jj] = readValue(b, j, t.e); out.push(v); j = jj; }
      return [out, j];
    }
    case "option": { const tag = b[i]; if (tag === 0) return [null, i + 1]; return readValue(b, i + 1, t.e); }
    case "tuple": { const out: unknown[] = []; let j = i; for (const it of t.items) { const [v, jj] = readValue(b, j, it); out.push(v); j = jj; } return [out, j]; }
    case "avl": return readAvl(b, i);
    case "unit": return [null, i];
    case "string": { const [len, j] = readVlq(b, i); return [new TextDecoder().decode(b.subarray(j, j + Number(len))), j + Number(len)]; }
    default: throw new Error(`cannot decode values of type ${typeName(t)}`);
  }
}

function display(t: SType, v: unknown): string {
  if (v === null || v === undefined) return t.k === "unit" ? "()" : "None";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return t.k === "string" ? JSON.stringify(v) : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (t.k === "avl") { const a = v as AvlTreeInfo; return `AvlTree(digest ${shortHex(a.digest, 16)}, flags ${a.flags}, key ${a.keyLength}${a.valueLength === null ? "" : `, value ${a.valueLength}`})`; }
  if (t.k === "prim" && t.id === 8) { const s = v as SigmaPropValue; return s.kind === "proveDlog" ? `proveDlog(${shortHex(s.keys![0], 16)})` : s.kind; }
  if (Array.isArray(v) && t.k === "tuple") return `(${v.map((x, i) => display(t.items[i], x)).join(", ")})`;
  if (Array.isArray(v)) return `[${v.slice(0, 8).map((x) => display(t.k === "coll" ? t.e : t, x)).join(", ")}${v.length > 8 ? ", …" : ""}]`;
  return JSON.stringify(v);
}

/** Decodes any serialized constant (a register value). Never throws: errors come back in `.error`. */
export function decodeConstant(hex: Hex): DecodedConstant & { bytes: number; trailing: number } {
  try {
    const b = hexToBytes(hex);
    if (!b.length) return { type: "?", value: null, display: "", error: "empty", bytes: 0, trailing: 0 };
    const [t, j] = readType(b, 0);
    const [v, k] = readValue(b, j, t);
    return { type: typeName(t), value: v, display: display(t, v), bytes: b.length, trailing: b.length - k };
  } catch (e) {
    return { type: "?", value: null, display: hex, error: e instanceof Error ? e.message : String(e), bytes: hex.length / 2, trailing: 0 };
  }
}

// ─── Basis registers (KNOWLEDGE Appendix B + verifier fixes) ───────────────────────────────────

/** Works with both /v1 box shapes: raw hex strings (site shape) and {serializedValue,…} objects (explorer shape). */
export const regHex = (v: ApiRegister | undefined): Hex | null => (typeof v === "string" ? v : v?.serializedValue) || null;

export function decodeGroupElementRegister(hex: Hex | null): Hex | null {
  return hex && hex.startsWith("07") && hex.length === 68 ? hex.slice(2).toLowerCase() : null;
}
export function decodeAvlTreeRegister(hex: Hex | null): AvlTreeInfo | null {
  if (!hex || !hex.startsWith("64") || hex.length < 74) return null;
  try { return readAvl(hexToBytes(hex), 1)[0]; } catch { return null; }
}
/** R6 of a reserve: `0e20` + 32-byte tracker NFT id. */
export function decodeNftRegister(hex: Hex | null): Hex | null {
  return hex && hex.startsWith("0e20") && hex.length === 68 ? hex.slice(4).toLowerCase() : null;
}
/** R7 Long (refund start height). `0500` = 0 = none. Also accepts the long form `05000000000000000000`. */
export function decodeLongRegister(hex: Hex | null): bigint | null {
  if (!hex || !hex.startsWith("05")) return null;
  try { return BigInt.asIntN(64, unzigzag(readVlq(hexToBytes(hex), 1)[0])); } catch { return null; }
}

export function decodeBasisRegisters(
  regs: Partial<Record<string, ApiRegister>> | undefined,
  assets?: Pick<ApiAsset, "tokenId">[] | null,
): BasisRegisters {
  const R = regs || {};
  const r4 = regHex(R.R4), r5 = regHex(R.R5), r6 = regHex(R.R6), r7 = regHex(R.R7);
  const key = decodeGroupElementRegister(r4);
  const tree = decodeAvlTreeRegister(r5);
  const nft = decodeNftRegister(r6);
  const refund = decodeLongRegister(r7);
  const ownNft = assets?.[0]?.tokenId?.toLowerCase() || null;
  const issues: string[] = [];
  if (!r4) issues.push("R4-missing"); else if (!key) issues.push("R4-not-GroupElement");
  if (!r5) issues.push("R5-missing"); else if (!tree) issues.push("R5-not-AvlTree"); else if (tree.zero) issues.push("R5-zero-digest");
  if (!r6) issues.push("R6-missing"); else if (!nft) issues.push("R6-not-32-bytes");
  if (r7 && refund === null) issues.push("R7-not-Long");
  return {
    key,
    tree,
    nft,
    ownNft,
    refundHeight: refund ?? 0n,
    hasR7: !!r7,
    valid: !!(key && tree && !tree.zero && nft),
    trackerValid: !!(key && tree && !tree.zero && ownNft),
    issues,
  };
}

/** SeedAvl ← AvlTreeInfo (drops the derived booleans). */
export const toSeedAvl = (a: AvlTreeInfo): SeedAvl => ({ digest: a.digest, height: a.height, flags: a.flags, keyLength: a.keyLength, valueLength: a.valueLength, empty: a.empty, zero: a.zero });

// ─── addresses (Ergo base58, blake2b256 checksum) ──────────────────────────────────────────────

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

// Chunked BigInt base58: 10 digits per division, so a 3 KB P2S tree encodes in about a millisecond.
const B58_CHUNK = 58n ** 10n;
const B58_IN = 58 ** 9;        // 9 digits per Number accumulation (58^9 < 2^53)

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  if (zeros === bytes.length) return "1".repeat(zeros);
  let n = BigInt("0x" + bytesToHex(bytes.subarray(zeros)));
  const parts: string[] = [];
  while (n > 0n) {
    let r = n % B58_CHUNK;
    n /= B58_CHUNK;
    let chunk = "";
    for (let i = 0; i < 10; i++) { chunk = B58[Number(r % 58n)] + chunk; r /= 58n; }
    parts.push(chunk);
  }
  return "1".repeat(zeros) + parts.reverse().join("").replace(/^1+/, "");
}

export function base58Decode(s: string): Uint8Array {
  let zeros = 0;
  while (zeros < s.length && s[zeros] === "1") zeros++;
  let n = 0n;
  let acc = 0;
  let mul = 1;
  for (let i = zeros; i < s.length; i++) {
    const d = B58.indexOf(s[i]);
    if (d < 0) throw new Error(`invalid base58 character ${JSON.stringify(s[i])}`);
    acc = acc * 58 + d;
    mul *= 58;
    if (mul === B58_IN) { n = n * BigInt(mul) + BigInt(acc); acc = 0; mul = 1; }
  }
  if (mul > 1) n = n * BigInt(mul) + BigInt(acc);
  let hex = n > 0n ? n.toString(16) : "";
  if (hex.length % 2) hex = "0" + hex;
  const body = hex ? hexToBytes(hex) : new Uint8Array(0);
  const out = new Uint8Array(zeros + body.length);
  out.set(body, zeros);
  return out;
}

export type Network = "mainnet" | "testnet";
const NET = { mainnet: 0x00, testnet: 0x10 } as const;

function encodeAddress(type: 1 | 2 | 3, content: Uint8Array, network: Network): string {
  const body = new Uint8Array(1 + content.length);
  body[0] = NET[network] + type;
  body.set(content, 1);
  const out = new Uint8Array(body.length + 4);
  out.set(body);
  out.set(blake2b256(body).subarray(0, 4), body.length);
  return base58Encode(out);
}

/** P2PK address of a 33-byte compressed public key: base58(0x01 ‖ pk ‖ blake2b256(0x01 ‖ pk)[0..4]) on mainnet. */
export function p2pkAddress(pubKey: Hex | Uint8Array, network: Network = "mainnet"): string {
  const pk = typeof pubKey === "string" ? hexToBytes(pubKey) : pubKey;
  if (pk.length !== 33 || (pk[0] !== 2 && pk[0] !== 3)) throw new Error("P2PK needs a 33-byte compressed public key");
  return encodeAddress(1, pk, network);
}

/** P2S address of an ErgoTree: base58(0x03 ‖ tree ‖ checksum) on mainnet. */
export function p2sAddress(ergoTree: Hex | Uint8Array, network: Network = "mainnet"): string {
  return encodeAddress(3, typeof ergoTree === "string" ? hexToBytes(ergoTree) : ergoTree, network);
}

/** The address an ErgoTree pays to: P2PK when the tree is `0008cd‖pk`, else P2S. */
export function addressOfErgoTree(ergoTree: Hex, network: Network = "mainnet"): string {
  const t = ergoTree.toLowerCase();
  if (t.length === 72 && t.startsWith("0008cd")) return p2pkAddress(t.slice(6), network);
  return p2sAddress(t, network);
}

/** The public key of a P2PK ErgoTree (`0008cd‖pk33`), else null. */
export const p2pkKeyOfTree = (ergoTree: Hex): Hex | null => {
  const t = ergoTree.toLowerCase();
  return t.length === 72 && t.startsWith("0008cd") ? t.slice(6) : null;
};

export interface ParsedAddress { network: Network; type: "P2PK" | "P2SH" | "P2S"; content: Hex; checksumOk: boolean }

export function parseAddress(addr: string): ParsedAddress {
  const b = base58Decode(addr);
  if (b.length < 5) throw new Error("address too short");
  const body = b.subarray(0, b.length - 4);
  const sum = b.subarray(b.length - 4);
  const want = blake2b256(body).subarray(0, 4);
  const checksumOk = sum.every((x, i) => x === want[i]);
  const prefix = body[0];
  const network: Network = prefix >= 0x10 ? "testnet" : "mainnet";
  const t = prefix & 0x0f;
  const type = t === 1 ? "P2PK" : t === 2 ? "P2SH" : "P2S";
  return { network, type, content: bytesToHex(body.subarray(1)), checksumOk };
}

// ─── ErgoTree: header, constants, template, template hash ──────────────────────────────────────

export interface ParsedErgoTree {
  header: number;
  headerHex: string;
  version: number;               // header & 0x07
  hasSize: boolean;              // bit 3
  segregated: boolean;           // bit 4: constants are in a table before the template
  size: number | null;
  constants: (DecodedConstant & { offset: number })[];
  templateOffset: number;
  template: Uint8Array;          // the bytes hashed by the template hash
  bytes: number;
}

export function parseErgoTree(ergoTree: Hex | Uint8Array): ParsedErgoTree {
  const b = typeof ergoTree === "string" ? hexToBytes(ergoTree) : ergoTree;
  if (!b.length) throw new Error("empty ErgoTree");
  const header = b[0];
  let i = 1;
  const hasSize = (header & 0x08) !== 0;
  const segregated = (header & 0x10) !== 0;
  let size: number | null = null;
  if (hasSize) { const [s, j] = readVlq(b, i); size = Number(s); i = j; }
  const constants: ParsedErgoTree["constants"] = [];
  if (segregated) {
    const [n, j0] = readVlq(b, i); i = j0;
    for (let x = 0; x < Number(n); x++) {
      const offset = i;
      const [t, j1] = readType(b, i);
      const [v, j2] = readValue(b, j1, t);
      constants.push({ type: typeName(t), value: v, display: display(t, v), offset });
      i = j2;
    }
  }
  return { header, headerHex: header.toString(16).padStart(2, "0"), version: header & 0x07, hasSize, segregated, size, constants, templateOffset: i, template: b.subarray(i), bytes: b.length };
}

/** Template hash, synchronously (noble SHA-256; works in Node and in the browser). */
export function templateHashSync(ergoTree: Hex | Uint8Array): Hex {
  return bytesToHex(sha256(parseErgoTree(ergoTree).template));
}

/** Template hash via WebCrypto (`crypto.subtle.digest("SHA-256")`), falling back to noble when unavailable. */
export async function templateHash(ergoTree: Hex | Uint8Array): Promise<Hex> {
  const tpl = parseErgoTree(ergoTree).template;
  const subtle = (globalThis as { crypto?: Crypto }).crypto?.subtle;
  if (subtle) {
    const copy = new Uint8Array(tpl.length);
    copy.set(tpl);
    const d = await subtle.digest("SHA-256", copy);
    return bytesToHex(new Uint8Array(d));
  }
  return bytesToHex(sha256(tpl));
}

/** AVL+ method calls in a template: MethodCall 0xdc on type AvlTree 0x64 with method 0x0c insert / 0x10 insertOrUpdate. */
export function avlOpsOfTemplate(template: Uint8Array): ("insert" | "insertOrUpdate")[] {
  let ins = false, iou = false;
  for (let i = 0; i + 2 < template.length; i++) {
    if (template[i] !== 0xdc || template[i + 1] !== 0x64) continue;
    if (template[i + 2] === 0x0c) ins = true;
    if (template[i + 2] === 0x10) iou = true;
  }
  return [...(ins ? ["insert" as const] : []), ...(iou ? ["insertOrUpdate" as const] : [])];
}

/** Named Basis parameters found among the constants: 2160 blocks (or the stale 604 800 000 ms), 43 200, top-up minimum. */
export function basisParams(constants: { type: string; value: unknown }[], kind: "erg" | "token" | "multitoken") {
  const has = (type: string, v: number) => constants.some((c) => c.type === type && (typeof c.value === "bigint" ? c.value === BigInt(v) : c.value === v));
  return {
    emergency: has("Int", 2160) ? { unit: "blocks" as const, value: 2160 } : has("Int", 604800000) ? { unit: "ms" as const, value: 604800000 } : null,
    refundBlocks: has("Int", 43200) ? 43200 : null,
    topUpMinNano: kind === "erg" ? (has("Long", 1000000000) ? "1000000000" : has("Long", 100000000) ? "100000000" : null) : null,
    topUpMinTokenUnits: kind === "erg" ? null : 1,
  };
}

// ─── tokens ─────────────────────────────────────────────────────────────────────────────────────

/** Tell USE from the look-alike by token id — never by name (both are named "USE"). */
export function tokenKind(tokenId: Hex | null | undefined): TokenKind {
  const t = (tokenId || "").toLowerCase();
  return t === USE_TOKEN_ID ? "use" : t === USE_LOOKALIKE_ID ? "use-lookalike" : "other";
}

// ─── clocks ─────────────────────────────────────────────────────────────────────────────────────

/** Emergency clock of a tracker box: open when tip − creationHeight > 2160, i.e. from creationHeight + 2161. */
export function emergencyClock(trackerBoxHeight: number, tip: number): EmergencyClock {
  const age = Math.max(0, tip - trackerBoxHeight);
  const opensAt = trackerBoxHeight + EMERGENCY_BLOCKS + 1;
  return { boxHeight: trackerBoxHeight, age, open: age > EMERGENCY_BLOCKS, opensAt, blocksLeft: Math.max(0, opensAt - tip) };
}

/** Refund countdown from R7: the owner may complete at R7 + 43 200 (≈ 60 days). R7 = 0 means no refund started. */
export function refundClock(r7: number | bigint | null | undefined, tip: number): RefundClock {
  const start = Number(r7 ?? 0);
  const completesAt = start + REFUND_BLOCKS;
  if (start <= 0) return { started: false, startedAt: 0, completesAt: 0, blocksLeft: 0, ready: false };
  return { started: true, startedAt: start, completesAt, blocksLeft: Math.max(0, completesAt - tip), ready: tip >= completesAt };
}

/** Blocks → rough duration at 120 s per block: "≈ 3 d", "≈ 2 h". */
export function blocksToApprox(blocks: number, lang: "en" | "ru" = "en"): string {
  const s = Math.max(0, blocks) * BLOCK_SECONDS;
  const u = lang === "ru" ? { d: "дн", h: "ч", m: "мин" } : { d: "d", h: "h", m: "min" };
  if (s >= 86400) return `≈ ${Math.round(s / 86400)} ${u.d}`;
  if (s >= 3600) return `≈ ${Math.round(s / 3600)} ${u.h}`;
  return `≈ ${Math.max(1, Math.round(s / 60))} ${u.m}`;
}

// ─── exit assessment (KNOWLEDGE §i.1 table; N07 §10.4 recipe 5) ────────────────────────────────

export interface TrackerLookup {
  status: TrackerStatus;
  /** Unspent box that holds the NFT now (tracker box for live/stale, reserve box for locked, wallet box for unused). */
  currentBox: Hex | null;
  /** Creation height of the box the contract would read as dataInputs(0) (live/stale only). */
  trackerBoxHeight: number | null;
  holder: string | null;
  burnTx: Hex | null;
  /** Locked inside a reserve whose owner could refund (and so free the NFT). */
  releasable: boolean;
  /** The tracker box commits the empty tree: no note can be proven against it until a new commitment. */
  emptyTree?: boolean;
}

export interface ExitInput {
  ownerExit: boolean;            // the contract has refundInit + refundComplete
  ownerKey: Hex | null;          // R4 decoded (null = malformed)
  tree: Pick<SeedAvl, "zero"> | null;   // R5 decoded (null = not an AvlTree)
  r6: Hex | null;                // tracker NFT
  ownNft: Hex | null;            // the reserve's own NFT
  r7: number | bigint | null;    // refund start height (null = absent)
  tracker: TrackerLookup | null; // where the R6 NFT is now (null = unknown)
  tip: number;
}

/**
 * Who can still move this reserve? Two exits exist: holders redeem (needs a tracker box with the R6 NFT and a
 * provable tree) and the owner refunds (only in templates with refundInit/refundComplete: 3PQn, pB9o, 96Hr, current).
 */
export function assessExit(x: ExitInput): ExitAssessment {
  const refundCapable = x.ownerExit && !!x.ownerKey;
  const rc = refundClock(x.r7, x.tip);
  const refund: ExitAssessment["refund"] = !refundCapable ? "no" : rc.started ? (rc.ready ? "ready" : "pending") : "yes";
  let redeem: ExitAssessment["redeem"] = "no";
  let reason: ExitReason;
  let emergency: EmergencyClock | null = null;
  const t = x.tracker;
  if (!x.ownerKey) reason = { code: "r4-invalid" };
  else if (!x.r6) reason = { code: "r6-missing" };
  else if (!x.tree || x.tree.zero) reason = { code: "r5-invalid" };
  else if (x.ownNft && x.r6 === x.ownNft) reason = { code: "tracker-own-nft", nft: x.r6 };
  else if (!t) { redeem = "if-tracker-posts"; reason = { code: "tracker-unknown", nft: x.r6 }; }
  else if (t.status === "live") {
    redeem = "now";
    reason = { code: "tracker-live", nft: x.r6, trackerBox: t.currentBox, emptyTree: !!t.emptyTree };
    if (t.trackerBoxHeight !== null) emergency = emergencyClock(t.trackerBoxHeight, x.tip);
  } else if (t.status === "unused") { redeem = "if-tracker-posts"; reason = { code: "tracker-unused", nft: x.r6, holder: t.holder }; }
  else if (t.status === "stale") {
    reason = { code: "tracker-stale", nft: x.r6 };
    if (t.trackerBoxHeight !== null) emergency = emergencyClock(t.trackerBoxHeight, x.tip);
  } else if (t.status === "locked") reason = { code: "tracker-locked", nft: x.r6, reserve: t.currentBox, releasable: t.releasable };
  else reason = { code: "tracker-burned", nft: x.r6, tx: t.burnTx };

  const cls: ExitClass = refundCapable
    ? redeem === "now" ? "refund+redeem" : redeem === "if-tracker-posts" ? "refund+redeem-if-tracker" : "refund"
    : redeem === "now" ? "redeem" : redeem === "if-tracker-posts" ? "redeem-if-tracker" : "locked";
  const a: Omit<ExitAssessment, "line"> = { class: cls, redeem, refund, reason, emergency, refundClock: rc.started ? rc : null };
  return { ...a, line: { en: describeExit(a, "en"), ru: describeExit(a, "ru") } };
}

/** Short labels of the exit classes (EN / RU). */
export const EXIT_LABEL: Record<ExitClass, { en: string; ru: string }> = {
  locked: { en: "Locked, no exit", ru: "Заперт, выхода нет" },
  refund: { en: "Owner can refund", ru: "Владелец может вернуть" },
  "refund+redeem": { en: "Owner can refund · holders can redeem", ru: "Владелец может вернуть · держатели могут погасить" },
  "redeem-if-tracker": { en: "Redeemable only if a tracker box appears", ru: "Погашение — только если появится бокс трекера" },
  redeem: { en: "Holders can redeem · no owner exit", ru: "Держатели могут погасить · у владельца выхода нет" },
  "refund+redeem-if-tracker": { en: "Owner can refund · redeemable if a tracker box appears", ru: "Владелец может вернуть · погашение, если появится бокс трекера" },
};

/** One plain sentence for an assessment (VISUAL §14: no "safe", "guaranteed", "trustless"; blocks first, then time). */
export function describeExit(a: Pick<ExitAssessment, "class" | "reason" | "refund" | "emergency" | "refundClock">, lang: "en" | "ru"): string {
  const ru = lang === "ru";
  const id = (h: string | null | undefined) => shortHex(h);
  const n = fmtInt;
  const r = a.reason;
  const why = (() => {
    switch (r.code) {
      case "r4-invalid": return ru ? "R4 не ключ, поэтому ни одну расписку нельзя проверить" : "R4 is not a key, so no note can ever be checked";
      case "r6-missing": return ru ? "в R6 нет NFT трекера" : "R6 names no tracker NFT";
      case "r5-invalid": return ru ? "дерево резерва (R5) не дерево или из одних нулей, доказать ничего нельзя" : "the reserve tree (R5) is missing or all zeros, so nothing can be proven";
      case "tracker-own-nft": return ru ? `R6 указывает на собственный NFT резерва ${id(r.nft)}` : `R6 points at the reserve's own NFT ${id(r.nft)}`;
      case "tracker-burned": return ru ? `NFT трекера ${id(r.nft)} сожжён${r.tx ? ` (tx ${id(r.tx)})` : ""}, бокса трекера больше не будет` : `its tracker NFT ${id(r.nft)} was burned${r.tx ? ` (tx ${id(r.tx)})` : ""}, so no tracker box can exist again`;
      case "tracker-locked":
        return ru
          ? `NFT трекера ${id(r.nft)} заперт в резерве ${id(r.reserve)}${r.releasable ? " и освободится, только если владелец того резерва завершит возврат" : ""}`
          : `its tracker NFT ${id(r.nft)} is locked inside reserve ${id(r.reserve)}${r.releasable ? " and comes free only if that reserve's owner completes a refund" : ""}`;
      case "tracker-stale": return ru ? `у бокса трекера ${id(r.nft)} дайджест из нулей, против него ничего не доказать` : `the tracker box of ${id(r.nft)} has an all-zero digest, so nothing can be proven against it`;
      case "tracker-unused": return ru ? `NFT ${id(r.nft)} лежит в обычном кошельке, погасить можно, только если его держатель опубликует бокс трекера` : `NFT ${id(r.nft)} sits in a plain wallet, so redeeming works only if its holder posts a tracker box`;
      case "tracker-unknown": return ru ? `где сейчас NFT трекера ${id(r.nft)}, ещё не проверено` : `where tracker NFT ${id(r.nft)} is now has not been checked yet`;
      case "tracker-live": {
        const e = a.emergency;
        const em = !e ? "" : e.open
          ? (ru ? `; трекер молчит ${n(e.age)} блоков, больше ${n(EMERGENCY_BLOCKS)} блоков ≈ 3 дня, поэтому погашению уже не нужна его подпись` : `; the tracker has been silent ${n(e.age)} blk, more than ${n(EMERGENCY_BLOCKS)} blk ≈ 3 days, so a redemption no longer needs its signature`)
          : (ru ? `; без подписи трекера — с блока ${n(e.opensAt)}` : `; without the tracker's signature from block ${n(e.opensAt)}`);
        if (r.emptyTree) {
          return ru
            ? `бокс трекера ${id(r.trackerBox)} не потрачен, но его дерево пустое: сначала трекер должен зафиксировать расписку${em}`
            : `tracker box ${id(r.trackerBox)} is unspent, but its committed tree is empty, so a note must be committed before anyone can redeem${em}`;
        }
        return ru ? `бокс трекера ${id(r.trackerBox)} не потрачен, держатель расписки с доказательствами по дереву может погасить${em}` : `tracker box ${id(r.trackerBox)} is unspent, so a note holder with tree proofs can redeem${em}`;
      }
    }
  })();
  const rc = a.refundClock;
  const refundPart = a.refund === "pending" && rc
    ? (ru ? `возврат начат: R7 = ${n(rc.startedAt)}, остаток можно забрать с блока ${n(rc.completesAt)}` : `a refund is running: R7 = ${n(rc.startedAt)}, what is left can be taken from block ${n(rc.completesAt)}`)
    : a.refund === "ready"
      ? (ru ? `возврат дождался: с блока ${n(rc?.completesAt ?? 0)} владелец может забрать остаток` : `the refund has waited long enough: since block ${n(rc?.completesAt ?? 0)} the owner can take what is left`)
      : (ru ? `владелец может выйти: записать R7, ждать ${n(REFUND_BLOCKS)} блоков ≈ 60 дней и забрать остаток` : `the owner can exit: write R7, wait ${n(REFUND_BLOCKS)} blk ≈ 60 days, then take what is left`);
  switch (a.class) {
    case "locked": return ru ? `Заперт: в контракте нет выхода для владельца, а ${why}.` : `Locked: the contract has no owner exit, and ${why}.`;
    case "refund": return ru ? `${cap(refundPart)}. Держатели погасить не могут: ${why}.` : `${cap(refundPart)}. Holders cannot redeem: ${why}.`;
    case "refund+redeem": return `${cap(refundPart)}. ${cap(why)}.`;
    case "redeem": return ru ? `У владельца выхода нет; ${why}.` : `No owner exit; ${why}.`;
    case "redeem-if-tracker": return ru ? `У владельца выхода нет; ${why}.` : `No owner exit; ${why}.`;
    case "refund+redeem-if-tracker": return `${cap(refundPart)}. ${cap(why)}.`;
  }
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
