// Ergo transaction and box bytes, exactly as the node (sigmastate, Scala 2.12) writes them, and the ids that hash them.
//
//   box candidate = VLQ(value) ‖ ergoTree bytes ‖ VLQ(creationHeight) ‖ u8(#tokens) ‖ tokens ‖ u8(#registers) ‖ R4…
//                   token = (32-byte id, or in a transaction VLQ(index into the token table)) ‖ VLQ(amount)
//   box           = candidate (full token ids) ‖ transactionId(32) ‖ VLQ(index)          boxId = blake2b256(box)
//   transaction   = VLQ(#inputs) ‖ inputs ‖ VLQ(#dataInputs) ‖ ids ‖ VLQ(#tokens) ‖ token table ‖ VLQ(#outputs) ‖ outputs
//                   input = boxId(32) ‖ VLQ(proof length) ‖ proof ‖ u8(#extension) ‖ (key ‖ constant)…
//   bytesToSign   = the transaction with every proof empty                               txId = blake2b256(bytesToSign)
//
// The token table holds each distinct token id of the OUTPUTS, in first-appearance order. Registers are dense from R4.
//
// The context extension is a Scala immutable Map[Byte, Constant], serialized in its iteration order:
//   • 1–4 entries: Map1…Map4, insertion order (the order of the bytes or of the JSON object);
//   • 5 or more:   HashMap (a hash trie), whose order depends only on the keys: scalaHashMapOrder below.
// The reserve redemption extension has 8 entries (first redemption) or 9, so its order is the trie order. The node
// computes the id in that order whatever order a JSON text gave, so we serialize in node order by default.
import { blake2b256, bytesToHex, hexToBytes } from "../../protocol/bytes";
import type { BoxCandidate, ErgoBox, ExtensionEntry, Hex, SignedTx, UnsignedTx } from "./model";
import { REGISTER_NAMES } from "./model";

const U64_MAX = (1n << 64n) - 1n;

class SigmaWriter {
  private buf = new Uint8Array(1024);
  private len = 0;

  private room(n: number) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }

  u8(b: number): this {
    if (!Number.isInteger(b) || b < 0 || b > 255) throw new RangeError(`byte out of range: ${b}`);
    this.room(1);
    this.buf[this.len++] = b;
    return this;
  }

  /** Unsigned VLQ (Scorex putULong / putUInt / putUShort). */
  vlq(v: number | bigint): this {
    let x = BigInt(v);
    if (x < 0n || x > U64_MAX) throw new RangeError(`VLQ value out of range: ${x}`);
    do {
      let b = Number(x & 0x7fn);
      x >>= 7n;
      if (x !== 0n) b |= 0x80;
      this.u8(b);
    } while (x !== 0n);
    return this;
  }

  bytes(b: Uint8Array): this {
    this.room(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }

  hex(h: Hex, expectBytes?: number): this {
    const b = hexToBytes(h);
    if (expectBytes !== undefined && b.length !== expectBytes) throw new RangeError(`expected ${expectBytes} bytes, got ${b.length}`);
    return this.bytes(b);
  }

  done(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}

// ─── Scala 2.12 immutable.HashMap iteration order ───────────────────────────────────────────────

/** Scala 2.12 `HashMap.improve`, on the key's `##` (a Byte widens to its signed Int value). */
function improve(hcode: number): number {
  let h = (hcode + ~(hcode << 9)) | 0;
  h ^= h >>> 14;
  h = (h + (h << 4)) | 0;
  h ^= h >>> 10;
  return h >>> 0;
}

function trieOrder(keys: number[], level: number, out: number[]): void {
  const groups = new Map<number, number[]>();
  for (const k of keys) {
    const signed = (k << 24) >> 24; // the key as a Scala Byte
    const idx = (improve(signed) >>> level) & 0x1f;
    const g = groups.get(idx);
    if (g) g.push(k);
    else groups.set(idx, [k]);
  }
  for (const idx of [...groups.keys()].sort((a, b) => a - b)) {
    const g = groups.get(idx)!;
    if (g.length === 1) out.push(g[0]);
    else if (level >= 30) out.push(...g); // HashMapCollision1: equal hashes, insertion order
    else trieOrder(g, level + 5, out);
  }
}

/**
 * The iteration order of a Scala 2.12 `immutable.HashMap` (HashTrieMap) holding these byte keys: a port of
 * basis_offchain `scala_context_extension_order`. It depends only on the set of keys.
 * {0,1,2,3,4,5,6,8} → 0,5,1,6,2,3,8,4 and {0,…,8} → 0,5,1,6,2,7,3,8,4 (both pinned by mainnet redemptions).
 */
export function scalaHashMapOrder(keys: readonly number[]): number[] {
  if (new Set(keys).size !== keys.length) throw new Error("duplicate context variable keys");
  const out: number[] = [];
  trieOrder([...keys], 0, out);
  return out;
}

/** The order the node serializes a context extension in (see the header): as given below 5 entries, else the trie. */
export function nodeExtensionOrder(entries: readonly ExtensionEntry[]): ExtensionEntry[] {
  const keys = entries.map((e) => e.key);
  if (new Set(keys).size !== keys.length) throw new Error("duplicate context variable keys");
  if (entries.length < 5) return [...entries];
  return scalaHashMapOrder(keys).map((k) => entries.find((e) => e.key === k)!);
}

/** True when `entries` is already in the order the node serializes it. */
export function isNodeExtensionOrder(entries: readonly ExtensionEntry[]): boolean {
  const want = nodeExtensionOrder(entries);
  return want.every((e, i) => e.key === entries[i].key);
}

// ─── boxes ──────────────────────────────────────────────────────────────────────────────────────

function writeCandidate(w: SigmaWriter, c: BoxCandidate, table: Map<Hex, number> | null): void {
  w.vlq(c.value);
  w.hex(c.ergoTree);
  w.vlq(c.creationHeight);
  if (c.tokens.length > 255) throw new RangeError("more than 255 tokens in one box");
  w.u8(c.tokens.length);
  for (const t of c.tokens) {
    if (table) {
      const i = table.get(t.tokenId);
      if (i === undefined) throw new Error(`token ${t.tokenId} is not in the transaction's token table`);
      w.vlq(i);
    } else {
      w.hex(t.tokenId, 32);
    }
    w.vlq(t.amount);
  }
  if (c.registers.length > REGISTER_NAMES.length) throw new RangeError("more than 6 registers (R4…R9)");
  w.u8(c.registers.length);
  for (const r of c.registers) w.hex(r);
}

/** The candidate's bytes with full token ids (the start of the box bytes). */
export function serializeCandidate(c: BoxCandidate): Uint8Array {
  const w = new SigmaWriter();
  writeCandidate(w, c, null);
  return w.done();
}

/** The box bytes the node hashes into the box id (and sends as `/utxo/byIdBinary`, as the tracker's binaries). */
export function serializeBox(b: Omit<ErgoBox, "boxId">): Uint8Array {
  const w = new SigmaWriter();
  writeCandidate(w, b, null);
  w.hex(b.transactionId, 32);
  w.vlq(b.index);
  return w.done();
}

/** The node's MaxBoxSize: a box's bytes (serializeBox) may not exceed it, or the transaction is invalid. */
export const MAX_BOX_BYTES = 4096;

/** The size of each output as a box (serializeBox): the id field is 32 bytes whatever the id, so a zero id gives the
 *  real size. */
export function outputSizes(outputs: readonly BoxCandidate[]): number[] {
  return outputs.map((o, index) => serializeBox({ ...o, transactionId: "00".repeat(32), index }).length);
}

/** The first output above MaxBoxSize, or null: every L1 refuses such a transaction before signing (wallet-t3: the
 *  node would reject it every time, and a refused box is never made). */
export function oversizedOutput(outputs: readonly BoxCandidate[]): { index: number; bytes: number } | null {
  const sizes = outputSizes(outputs);
  const index = sizes.findIndex((n) => n > MAX_BOX_BYTES);
  return index < 0 ? null : { index, bytes: sizes[index] };
}

/** The plain-text refusal for oversizedOutput. */
export function oversizedText(o: { index: number; bytes: number }): string {
  return `output ${o.index} would be ${o.bytes} bytes; the network takes boxes of at most ${MAX_BOX_BYTES} bytes`;
}

/** blake2b256 of the box bytes. */
export function computeBoxId(b: Omit<ErgoBox, "boxId">): Hex {
  return bytesToHex(blake2b256(serializeBox(b)));
}

/** True when the box hashes to its own `boxId`. This catches a hidden token or register in /v1 data. */
export function boxIdHolds(b: ErgoBox): boolean {
  return computeBoxId(b) === b.boxId;
}

// ─── transactions ───────────────────────────────────────────────────────────────────────────────

/** The distinct token ids of the outputs, in first-appearance order. */
export function tokenTable(outputs: readonly BoxCandidate[]): Hex[] {
  const seen = new Set<Hex>();
  const out: Hex[] = [];
  for (const o of outputs) for (const t of o.tokens) if (!seen.has(t.tokenId)) { seen.add(t.tokenId); out.push(t.tokenId); }
  return out;
}

export interface SerializeOptions {
  /** "node" (default): the extension in the node's order; "as-given": as listed (for tests and diagnostics). */
  extensionOrder?: "node" | "as-given";
}

function writeTx(
  w: SigmaWriter,
  inputs: readonly { boxId: Hex; proof: Uint8Array; extension: readonly ExtensionEntry[] }[],
  dataInputs: readonly Hex[],
  outputs: readonly BoxCandidate[],
  opts: SerializeOptions,
): void {
  w.vlq(inputs.length);
  for (const inp of inputs) {
    w.hex(inp.boxId, 32);
    w.vlq(inp.proof.length);
    w.bytes(inp.proof);
    const ext = opts.extensionOrder === "as-given" ? [...inp.extension] : nodeExtensionOrder(inp.extension);
    if (ext.length > 127) throw new RangeError("more than 127 context variables");
    w.u8(ext.length);
    for (const e of ext) {
      if (!Number.isInteger(e.key) || e.key < 0 || e.key > 127) throw new RangeError(`context variable key out of range: ${e.key}`);
      w.u8(e.key);
      const v = hexToBytes(e.value);
      if (v.length === 0) throw new Error(`context variable #${e.key} is empty`);
      w.bytes(v);
    }
  }
  w.vlq(dataInputs.length);
  for (const d of dataInputs) w.hex(d, 32);
  const table = tokenTable(outputs);
  w.vlq(table.length);
  for (const t of table) w.hex(t, 32);
  const index = new Map(table.map((t, i) => [t, i] as const));
  w.vlq(outputs.length);
  for (const o of outputs) writeCandidate(w, o, index);
}

/** The bytes every input's proof signs. */
export function bytesToSign(tx: UnsignedTx, opts: SerializeOptions = {}): Uint8Array {
  const w = new SigmaWriter();
  writeTx(w, tx.inputs.map((i) => ({ boxId: i.boxId, proof: new Uint8Array(0), extension: i.extension })), tx.dataInputs, tx.outputs, opts);
  return w.done();
}

/** The transaction id: blake2b256(bytesToSign). A signed transaction has the id of the unsigned one it signs. */
export function computeTxId(tx: UnsignedTx, opts: SerializeOptions = {}): Hex {
  return bytesToHex(blake2b256(bytesToSign(tx, opts)));
}

/** The signed transaction's bytes: what a block holds; its length is the transaction size. */
export function serializeSignedTx(tx: SignedTx, opts: SerializeOptions = {}): Uint8Array {
  const w = new SigmaWriter();
  writeTx(w, tx.inputs.map((i) => ({ boxId: i.boxId, proof: hexToBytes(i.proof), extension: i.extension })), tx.dataInputs, tx.outputs, opts);
  return w.done();
}

/** The boxes a transaction creates, with their ids. */
export function outputBoxes(tx: UnsignedTx, txId: Hex = computeTxId(tx)): ErgoBox[] {
  return tx.outputs.map((o, index) => {
    const b = { ...o, transactionId: txId, index };
    return { ...b, boxId: computeBoxId(b) };
  });
}

/** Drops the proofs: the unsigned transaction a signed one signs. */
export function unsignedOf(tx: SignedTx): UnsignedTx {
  return { inputs: tx.inputs.map((i) => ({ boxId: i.boxId, extension: i.extension })), dataInputs: tx.dataInputs, outputs: tx.outputs };
}

// ─── node JSON (POST /transactions) ─────────────────────────────────────────────────────────────

function candidateJson(o: BoxCandidate): string {
  const regs = o.registers.map((r, i) => `${JSON.stringify(REGISTER_NAMES[i])}:${JSON.stringify(r)}`).join(",");
  const assets = o.tokens.map((t) => `{"tokenId":${JSON.stringify(t.tokenId)},"amount":${t.amount}}`).join(",");
  return `{"value":${o.value},"ergoTree":${JSON.stringify(o.ergoTree)},"assets":[${assets}],"creationHeight":${o.creationHeight},"additionalRegisters":{${regs}}}`;
}

/**
 * A signed transaction as the node's `POST /transactions` takes it. Amounts are bare integers (never floats), the
 * extension is written in the node's order, and the id is included for people reading it (the node recomputes it).
 */
export function signedTxToNodeJson(tx: SignedTx): string {
  const id = computeTxId(unsignedOf(tx));
  const inputs = tx.inputs
    .map((i) => {
      const ext = nodeExtensionOrder(i.extension).map((e) => `${JSON.stringify(String(e.key))}:${JSON.stringify(e.value)}`).join(",");
      return `{"boxId":${JSON.stringify(i.boxId)},"spendingProof":{"proofBytes":${JSON.stringify(i.proof)},"extension":{${ext}}}}`;
    })
    .join(",");
  const dataInputs = tx.dataInputs.map((d) => `{"boxId":${JSON.stringify(d)}}`).join(",");
  return `{"id":${JSON.stringify(id)},"inputs":[${inputs}],"dataInputs":[${dataInputs}],"outputs":[${tx.outputs.map(candidateJson).join(",")}]}`;
}
