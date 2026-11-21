// IOU notes: debt keys and the 80-byte signed message, bit-exact with contract/basis.es and basis-token.es.
//
//   debtKey  = blake2b256(ownerKey(33) ‖ receiverKey(33))              — ERG (basis.es)
//   debtKey  = blake2b256(ownerKey(33) ‖ receiverKey(33) ‖ tokenId(32)) — token denomination (basis-token.es)
//   message  = debtKey(32) ‖ longToByteArray(totalDebt)(8) ‖ longToByteArray(timestamp)(8) ‖ trackerNftId(32) = 80 bytes
//
// The reserve's own redemption tree (R5) always uses the UNSUFFIXED key blake2b256(owner ‖ receiver), in both contracts:
//   reserve tree: reserveKey → timestamp(8) ‖ cumulativeRedeemed(8)
//   tracker tree: debtKey    → totalDebt(8)

import {
  I64_MAX,
  blake2b256,
  bytesToHex,
  concatBytes,
  hexToBytes,
  readI64BE,
  readUnsignedBE,
  toBytes,
  u64be,
  type Hex,
} from "./bytes";

/** Denomination id, same strings as the Rust `DenomKey`: "erg" or "token:<64 hex>". */
export type DenomId = "erg" | `token:${string}`;

export interface DenominationInfo {
  id: DenomId;
  symbol: string;
  /** Display decimals only; on-chain amounts are raw integer units (nanoERG for ERG). */
  decimals: number;
  /** 32-byte token id (hex) for token denominations. */
  tokenId?: Hex;
  /** Free-form label for the UI, e.g. "gold, 1 unit = 1 mg". */
  label?: string;
}

export const ERG: DenominationInfo = { id: "erg", symbol: "ERG", decimals: 9 };
export const NANOERG_PER_ERG = 1_000_000_000n;

export function tokenDenomination(tokenId: Hex | Uint8Array, symbol: string, decimals: number, label?: string): DenominationInfo {
  const hex = typeof tokenId === "string" ? tokenId.toLowerCase() : bytesToHex(tokenId);
  if (!/^[0-9a-f]{64}$/.test(hex)) throw new Error("token id must be 32 bytes (64 hex chars)");
  return { id: `token:${hex}`, symbol, decimals, tokenId: hex, label };
}

export function isDenomId(s: string): s is DenomId {
  return s === "erg" || /^token:[0-9a-f]{64}$/.test(s);
}

/** Token id bytes of a denomination, or null for ERG. Accepts "ERG" in any case like `DenomKey::parse`. */
export function denomTokenId(denom: DenomId | string | undefined | null): Uint8Array | null {
  if (denom === undefined || denom === null || denom.toLowerCase() === "erg") return null;
  if (!denom.startsWith("token:")) throw new Error(`invalid denomination ${JSON.stringify(denom)}: expected "erg" or "token:<64 hex chars>"`);
  const id = hexToBytes(denom.slice(6));
  if (id.length !== 32) throw new Error(`invalid denomination token id: expected 32 bytes, got ${id.length}`);
  return id;
}

function key33(k: Uint8Array | Hex, what: string): Uint8Array {
  const b = toBytes(k);
  if (b.length !== 33) throw new Error(`${what} must be a 33-byte compressed public key (got ${b.length})`);
  return b;
}

/**
 * Tracker debt-tree key and signed-message key: blake2b256(owner ‖ receiver [‖ tokenId]).
 * `denom` may be a DenomId, a raw 32-byte token id, or omitted (ERG).
 */
export function debtKey(owner: Uint8Array | Hex, receiver: Uint8Array | Hex, denom?: DenomId | Uint8Array | null): Uint8Array {
  const o = key33(owner, "owner key");
  const r = key33(receiver, "receiver key");
  const suffix = denom instanceof Uint8Array ? denom : denomTokenId(denom ?? null);
  if (suffix && suffix.length !== 32) throw new Error("token id must be 32 bytes");
  return suffix ? blake2b256(o, r, suffix) : blake2b256(o, r);
}

/** Reserve redemption-tree key, denomination-free in both contracts: blake2b256(owner ‖ receiver). */
export function reserveKey(owner: Uint8Array | Hex, receiver: Uint8Array | Hex): Uint8Array {
  return blake2b256(key33(owner, "owner key"), key33(receiver, "receiver key"));
}

/** The 80-byte message both the issuer and the tracker sign. */
export function noteMessage(key: Uint8Array | Hex, totalDebt: bigint, timestampMs: bigint, trackerNftId: Uint8Array | Hex): Uint8Array {
  const k = toBytes(key);
  const nft = toBytes(trackerNftId);
  if (k.length !== 32) throw new Error(`debt key must be 32 bytes (got ${k.length})`);
  if (nft.length !== 32) throw new Error(`tracker NFT id must be 32 bytes (got ${nft.length})`);
  return concatBytes(k, u64be(totalDebt), u64be(timestampMs), nft);
}

export interface NoteFields {
  issuer: Hex;
  receiver: Hex;
  denom: DenomId;
  totalDebt: bigint;
  timestamp: bigint;
  trackerNftId: Hex;
}

export function noteMessageFor(n: NoteFields): Uint8Array {
  return noteMessage(debtKey(n.issuer, n.receiver, n.denom), n.totalDebt, n.timestamp, n.trackerNftId);
}

export function parseNoteMessage(msg: Uint8Array | Hex): { key: Hex; totalDebt: bigint; totalDebtSigned: bigint; timestamp: bigint; timestampSigned: bigint; trackerNftId: Hex } {
  const m = toBytes(msg);
  if (m.length !== 80) throw new Error(`note message must be 80 bytes (got ${m.length})`);
  return {
    key: bytesToHex(m.subarray(0, 32)),
    totalDebt: readUnsignedBE(m, 32, 8),
    totalDebtSigned: readI64BE(m, 32),
    timestamp: readUnsignedBE(m, 40, 8),
    timestampSigned: readI64BE(m, 40),
    trackerNftId: bytesToHex(m.subarray(48, 80)),
  };
}

/** One labelled slice of a byte string, for the protocol X-ray. */
export interface ByteSegment {
  id: string;
  label: string;
  offset: number;
  length: number;
  hex: Hex;
  /** Human value (decimal number, date, …) when meaningful. */
  value?: string;
  note: string;
}

/** Layout of the 80-byte note message: exactly what `longToByteArray`/`++` builds in the contract. */
export function messageLayout(msg: Uint8Array | Hex): ByteSegment[] {
  const m = toBytes(msg);
  const p = parseNoteMessage(m);
  const ts = p.timestamp <= 8_640_000_000_000_000n ? new Date(Number(p.timestamp)).toISOString() : "out of Date range";
  return [
    {
      id: "key",
      label: "debt key",
      offset: 0,
      length: 32,
      hex: p.key,
      note: "blake2b256(owner ‖ receiver) for ERG; blake2b256(owner ‖ receiver ‖ tokenId) for a token denomination",
    },
    {
      id: "totalDebt",
      label: "total debt",
      offset: 32,
      length: 8,
      hex: bytesToHex(m.subarray(32, 40)),
      value: p.totalDebt.toString(),
      note: "cumulative debt owner → receiver, 8 bytes big-endian (longToByteArray); raw units (nanoERG / token units)",
    },
    {
      id: "timestamp",
      label: "timestamp",
      offset: 40,
      length: 8,
      hex: bytesToHex(m.subarray(40, 48)),
      value: `${p.timestamp} ms (${ts})`,
      note: "time of the latest payment, milliseconds since Unix epoch, 8 bytes big-endian",
    },
    {
      id: "trackerNftId",
      label: "tracker NFT id",
      offset: 48,
      length: 32,
      hex: p.trackerNftId,
      note: "binds the signature to one tracker (SELF.R6 of the reserve, tokens(0) of the tracker box)",
    },
  ];
}

/** Layout of the debt-key preimage (66 or 98 bytes before hashing). */
export function debtKeyPreimageLayout(owner: Uint8Array | Hex, receiver: Uint8Array | Hex, denom?: DenomId | null): ByteSegment[] {
  const o = key33(owner, "owner key");
  const r = key33(receiver, "receiver key");
  const t = denomTokenId(denom ?? null);
  const segs: ByteSegment[] = [
    { id: "owner", label: "owner (issuer) key", offset: 0, length: 33, hex: bytesToHex(o), note: "ownerKey.getEncoded — compressed secp256k1 point" },
    { id: "receiver", label: "receiver key", offset: 33, length: 33, hex: bytesToHex(r), note: "receiver.getEncoded — the creditor" },
  ];
  if (t) segs.push({ id: "tokenId", label: "token id", offset: 66, length: 32, hex: bytesToHex(t), note: "basis-token.es: SELF.tokens(1)._1 — namespaces the debt per token" });
  return segs;
}

/** Tracker tree value: totalDebt as 8 bytes BE. */
export function trackerTreeValue(totalDebt: bigint): Uint8Array {
  return u64be(totalDebt);
}

/** Reserve tree value: timestamp(8) ‖ cumulativeRedeemed(8). */
export function reserveTreeValue(timestamp: bigint, redeemed: bigint): Uint8Array {
  return concatBytes(u64be(timestamp), u64be(redeemed));
}

/** Reads a reserve tree value the way the contract does (signed byteArrayToLong on each half). */
export function parseReserveTreeValue(v: Uint8Array): { timestamp: bigint; redeemed: bigint } {
  if (v.length < 16) throw new Error("reserve tree value must be 16 bytes");
  return { timestamp: readI64BE(v, 0), redeemed: readI64BE(v, 8) };
}

/**
 * The Rust tracker rejects totals/timestamps above i64::MAX: the contract reads both with the signed
 * `byteArrayToLong`, so a larger value would come out negative on-chain (`AmountExceedsContractRange`).
 */
export function contractRangeError(totalDebt: bigint, timestamp: bigint): { field: "amount_collected" | "timestamp"; value: bigint } | null {
  if (totalDebt < 0n || totalDebt > I64_MAX) return { field: "amount_collected", value: totalDebt };
  if (timestamp < 0n || timestamp > I64_MAX) return { field: "timestamp", value: timestamp };
  return null;
}

// ---------- amounts ----------

/** "1.5" ERG → 1500000000n. Throws on more fractional digits than `decimals`. */
export function parseUnits(amount: string | number, decimals: number): bigint {
  const s = typeof amount === "number" ? amount.toString() : amount.trim();
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error(`not a decimal amount: ${s}`);
  const neg = s.startsWith("-");
  const [int, frac = ""] = (neg ? s.slice(1) : s).split(".");
  if (frac.length > decimals) throw new Error(`too many decimals (${frac.length} > ${decimals})`);
  const v = BigInt(int) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0");
  return neg ? -v : v;
}

/** 1500000000n, 9 → "1.5". */
export function formatUnits(v: bigint, decimals: number, maxFraction = decimals): string {
  const neg = v < 0n;
  const x = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const int = x / base;
  let frac = (x % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${neg ? "-" : ""}${int}${frac ? "." + frac : ""}`;
}

/** Shorthand used by scenarios and tests: erg(1.5) = 1500000000n. */
export function erg(amount: string | number): bigint {
  return parseUnits(amount, 9);
}
