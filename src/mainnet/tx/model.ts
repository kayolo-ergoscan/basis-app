// Transactions and boxes as plain data, and the parsers that read them from the three JSON shapes we meet:
//   • /v1 (ErgoScan API, explorer shape): amounts as strings, registers as {serializedValue,…} or hex, NO context
//     extension (an input's `spendingProof` is only the proof hex);
//   • the tracker's `unsigned_tx` (node shape without proofs): {inputs:[{boxId, extension}], dataInputs, outputs};
//   • a signed or partial transaction (node shape): {id, inputs:[{boxId, spendingProof:{proofBytes, extension}}], …}.
//
// Everything is hex in lowercase and bigint for amounts. Registers are a dense list from R4; the extension keeps the
// order the text had (that order is part of the id for the node, see serialize.ts).
import {
  asArray, asHex, asObject, asSafeInt, asString, asU64, member, required, ShapeError, type JsonNode, type JsonObject,
} from "./json";

export type Hex = string;

export interface Token {
  tokenId: Hex;
  amount: bigint;
}

/** An output before it has an id: what a transaction creates. */
export interface BoxCandidate {
  value: bigint;
  ergoTree: Hex;
  creationHeight: number;
  tokens: Token[];
  /** R4, R5, … in order, each one serialized constant (hex). Registers are dense: no gaps. */
  registers: Hex[];
}

/** A box on chain: a candidate plus where it was created. */
export interface ErgoBox extends BoxCandidate {
  boxId: Hex;
  transactionId: Hex;
  index: number;
}

/** One context variable: key 0..127 and its serialized constant (hex). */
export interface ExtensionEntry {
  key: number;
  value: Hex;
}

export interface UnsignedInput {
  boxId: Hex;
  /** In the order of the source text (or as built). */
  extension: ExtensionEntry[];
}

export interface UnsignedTx {
  inputs: UnsignedInput[];
  dataInputs: Hex[];
  outputs: BoxCandidate[];
}

export interface SignedInput extends UnsignedInput {
  /** ProveDlog proof bytes, hex ("" for an input that needs none). */
  proof: Hex;
}

export interface SignedTx {
  inputs: SignedInput[];
  dataInputs: Hex[];
  outputs: BoxCandidate[];
}

export const REGISTER_NAMES = ["R4", "R5", "R6", "R7", "R8", "R9"] as const;
export type RegisterName = (typeof REGISTER_NAMES)[number];

/** Register `name` of a box or candidate, or null when absent. */
export function register(box: BoxCandidate, name: RegisterName): Hex | null {
  return box.registers[REGISTER_NAMES.indexOf(name)] ?? null;
}

/** The extension value of `key`, or null. */
export function extensionValue(input: UnsignedInput, key: number): Hex | null {
  return input.extension.find((e) => e.key === key)?.value ?? null;
}

// ─── field readers ──────────────────────────────────────────────────────────────────────────────

const I64_MAX = (1n << 63n) - 1n;

/** Box value and token amounts are Longs on chain: 1 ≤ v ≤ 2^63 − 1. */
function positiveLong(node: JsonNode | undefined, path: string): bigint {
  const v = asU64(node, path);
  if (v < 1n || v > I64_MAX) throw new ShapeError(path, "must be within 1 … 2^63 − 1");
  return v;
}

function treeHex(node: JsonNode | undefined, path: string): Hex {
  const h = asHex(node, path);
  if (h.length === 0) throw new ShapeError(path, "empty ErgoTree");
  return h;
}

function tokensOf(node: JsonNode | undefined, path: string): Token[] {
  if (node === undefined) return [];
  const arr = asArray(node, path);
  return arr.items.map((t, i) => {
    const o = asObject(t, `${path}[${i}]`);
    return { tokenId: asHex(required(o, "tokenId", `${path}[${i}]`), `${path}[${i}].tokenId`, 32), amount: positiveLong(required(o, "amount", `${path}[${i}]`), `${path}[${i}].amount`) };
  });
}

/** Registers: keys R4…R9, dense from R4. A value is hex, or the /v1 object {serializedValue, …}. */
function registersOf(node: JsonNode | undefined, path: string): Hex[] {
  if (node === undefined) return [];
  const o = asObject(node, path);
  const byIndex = new Map<number, Hex>();
  for (const e of o.entries) {
    const idx = REGISTER_NAMES.indexOf(e.key as RegisterName);
    if (idx < 0) throw new ShapeError(`${path}.${e.key}`, "not a register name R4…R9");
    const p = `${path}.${e.key}`;
    const v = e.value.kind === "object" ? required(e.value, "serializedValue", p) : e.value;
    const h = asHex(v, p);
    if (h.length === 0) throw new ShapeError(p, "empty register");
    byIndex.set(idx, h);
  }
  const out: Hex[] = [];
  for (let i = 0; i < byIndex.size; i++) {
    const v = byIndex.get(i);
    if (v === undefined) throw new ShapeError(path, `registers are not dense: ${REGISTER_NAMES[i]} is missing`);
    out.push(v);
  }
  return out;
}

/** A context extension object {"0": "0200", …}, in text order. Keys are canonical decimals 0…127. */
export function extensionOf(node: JsonNode | undefined, path: string): ExtensionEntry[] {
  if (node === undefined) return [];
  const o = asObject(node, path);
  return o.entries.map((e) => {
    if (!/^(?:0|[1-9][0-9]{0,2})$/.test(e.key) || Number(e.key) > 127) throw new ShapeError(`${path}.${e.key}`, "context variable keys are 0…127");
    const value = asHex(e.value, `${path}.${e.key}`);
    if (value.length === 0) throw new ShapeError(`${path}.${e.key}`, "empty constant");
    return { key: Number(e.key), value };
  });
}

function candidateOf(o: JsonObject, path: string): BoxCandidate {
  return {
    value: positiveLong(required(o, "value", path), `${path}.value`),
    ergoTree: treeHex(required(o, "ergoTree", path), `${path}.ergoTree`),
    creationHeight: asSafeInt(required(o, "creationHeight", path), `${path}.creationHeight`, 0x7fffffff),
    tokens: tokensOf(member(o, "assets"), `${path}.assets`),
    registers: registersOf(member(o, "additionalRegisters"), `${path}.additionalRegisters`),
  };
}

// ─── /v1 (explorer shape) ───────────────────────────────────────────────────────────────────────

/** A box from `/v1/boxes/{id}`, or an output of `/v1/transactions/{id}`: `index` is the box's own index. */
export function boxFromV1(node: JsonNode | undefined, path = "box"): ErgoBox {
  const o = asObject(node, path);
  return {
    ...candidateOf(o, path),
    boxId: asHex(required(o, "boxId", path), `${path}.boxId`, 32),
    transactionId: asHex(required(o, "transactionId", path), `${path}.transactionId`, 32),
    index: asSafeInt(required(o, "index", path), `${path}.index`, 0xffff),
  };
}

/**
 * An input or data input of `/v1/transactions/{id}`. Careful: there `index` is the position in the SPENDING
 * transaction; the box's own index is `outputIndex` and its creating transaction is `outputTransactionId`.
 */
export function inputBoxFromV1(node: JsonNode | undefined, path = "input"): ErgoBox {
  const o = asObject(node, path);
  const createdBy = asHex(required(o, "outputTransactionId", path), `${path}.outputTransactionId`, 32);
  const tx = member(o, "transactionId");
  if (tx !== undefined && asHex(tx, `${path}.transactionId`, 32) !== createdBy) throw new ShapeError(path, "transactionId and outputTransactionId differ");
  return {
    ...candidateOf(o, path),
    boxId: asHex(required(o, "boxId", path), `${path}.boxId`, 32),
    transactionId: createdBy,
    index: asSafeInt(required(o, "outputIndex", path), `${path}.outputIndex`, 0xffff),
  };
}

export interface V1Transaction {
  id: Hex;
  inclusionHeight: number | null;
  /** Serialized size of the signed transaction, as the chain counts it. */
  size: number | null;
  /** The boxes spent, with their proofs. /v1 carries no context extension. */
  inputs: (ErgoBox & { proof: Hex })[];
  dataInputs: ErgoBox[];
  outputs: ErgoBox[];
}

/** `/v1/transactions/{id}`. */
export function txFromV1(node: JsonNode | undefined, path = "tx"): V1Transaction {
  const o = asObject(node, path);
  const ins = asArray(required(o, "inputs", path), `${path}.inputs`);
  const dis = asArray(member(o, "dataInputs") ?? { kind: "array", items: [], start: 0, end: 0 }, `${path}.dataInputs`);
  const outs = asArray(required(o, "outputs", path), `${path}.outputs`);
  const height = member(o, "inclusionHeight");
  const size = member(o, "size");
  return {
    id: asHex(required(o, "id", path), `${path}.id`, 32),
    inclusionHeight: height === undefined || height.kind === "null" ? null : asSafeInt(height, `${path}.inclusionHeight`),
    size: size === undefined || size.kind === "null" ? null : asSafeInt(size, `${path}.size`),
    inputs: ins.items.map((n, i) => {
      const p = `${path}.inputs[${i}]`;
      const proofNode = required(asObject(n, p), "spendingProof", p);
      const proof = proofNode.kind === "object" ? asHex(required(proofNode, "proofBytes", `${p}.spendingProof`), `${p}.spendingProof.proofBytes`) : proofNode.kind === "null" ? "" : asHex(proofNode, `${p}.spendingProof`);
      return { ...inputBoxFromV1(n, p), proof };
    }),
    dataInputs: dis.items.map((n, i) => inputBoxFromV1(n, `${path}.dataInputs[${i}]`)),
    outputs: outs.items.map((n, i) => boxFromV1(n, `${path}.outputs[${i}]`)),
  };
}

// ─── node shapes (the tracker's unsigned_tx, partial and signed transactions) ───────────────────

function dataInputsOf(node: JsonNode | undefined, path: string): Hex[] {
  if (node === undefined) return [];
  return asArray(node, path).items.map((d, i) => asHex(required(asObject(d, `${path}[${i}]`), "boxId", `${path}[${i}]`), `${path}[${i}].boxId`, 32));
}

/** The tracker's `unsigned_tx`: inputs carry `extension` directly, outputs are candidates. */
export function unsignedTxFromJson(node: JsonNode | undefined, path = "unsigned_tx"): UnsignedTx {
  const o = asObject(node, path);
  return {
    inputs: asArray(required(o, "inputs", path), `${path}.inputs`).items.map((n, i) => {
      const p = `${path}.inputs[${i}]`;
      const io = asObject(n, p);
      return { boxId: asHex(required(io, "boxId", p), `${p}.boxId`, 32), extension: extensionOf(member(io, "extension"), `${p}.extension`) };
    }),
    dataInputs: dataInputsOf(member(o, "dataInputs"), `${path}.dataInputs`),
    outputs: asArray(required(o, "outputs", path), `${path}.outputs`).items.map((n, i) => candidateOf(asObject(n, `${path}.outputs[${i}]`), `${path}.outputs[${i}]`)),
  };
}

export interface NodeTx extends SignedTx {
  /** The `id` field of the text (not recomputed). */
  id: Hex | null;
  /** Each output's `boxId` field when present (not recomputed). */
  outputBoxIds: (Hex | null)[];
}

/** A partial or signed transaction in node shape: inputs carry `spendingProof {proofBytes, extension}`. */
export function nodeTxFromJson(node: JsonNode | undefined, path = "tx"): NodeTx {
  const o = asObject(node, path);
  const id = member(o, "id");
  const outs = asArray(required(o, "outputs", path), `${path}.outputs`).items;
  return {
    id: id === undefined ? null : asHex(id, `${path}.id`, 32),
    inputs: asArray(required(o, "inputs", path), `${path}.inputs`).items.map((n, i) => {
      const p = `${path}.inputs[${i}]`;
      const io = asObject(n, p);
      const sp = asObject(required(io, "spendingProof", p), `${p}.spendingProof`);
      return {
        boxId: asHex(required(io, "boxId", p), `${p}.boxId`, 32),
        proof: asHex(required(sp, "proofBytes", `${p}.spendingProof`), `${p}.spendingProof.proofBytes`),
        extension: extensionOf(member(sp, "extension"), `${p}.spendingProof.extension`),
      };
    }),
    dataInputs: dataInputsOf(member(o, "dataInputs"), `${path}.dataInputs`),
    outputs: outs.map((n, i) => candidateOf(asObject(n, `${path}.outputs[${i}]`), `${path}.outputs[${i}]`)),
    outputBoxIds: outs.map((n, i) => {
      const b = member(asObject(n, `${path}.outputs[${i}]`), "boxId");
      return b === undefined ? null : asHex(b, `${path}.outputs[${i}].boxId`, 32);
    }),
  };
}

/** Reads a string field and checks it is exactly one of `allowed`. */
export function oneOf<T extends string>(node: JsonNode | undefined, path: string, allowed: readonly T[]): T {
  const s = asString(node, path);
  if (!(allowed as readonly string[]).includes(s)) throw new ShapeError(path, `unexpected value ${JSON.stringify(s.slice(0, 40))}`);
  return s as T;
}
