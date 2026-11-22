// Transactions the app builds itself from boxes at P2PK(app key): T1 (the reserve creation, design §2) and Withdraw.
// Both are signed with ProveDlog on every input and broadcast as node JSON (D1: POST /api/tracker/node/transactions).
//
//   T1:       [reserve(amount, NFT = inputs[0].boxId), change to P2PK(owner) if any, miner fee]
//   Withdraw: [destination(amount), change to P2PK(owner) if any, miner fee]
//
// Change is 0 or at least 0.001 ERG. Dust below that goes to the reserve (T1) or the destination (Withdraw), never to
// the miner. Tokens in spent boxes always go to the change output: nothing is ever burned.
import { bytesToHex, hexToBytes } from "../../protocol/bytes";
import { isValidPublicKey } from "../../protocol/keys";
import { parseAddress, treeOfAddress } from "./address";
import {
  BROADCAST_BODY_MAX_BYTES, EMPTY_RESERVE_R5, FEE_TREE_HEX, MIN_BOX_NANOERG, R7_NO_REFUND, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, RESERVE_MIN_NANOERG, RESERVE_TREE_HEX,
  T1_FEE_MAX_NANOERG, T1_FEE_MIN_NANOERG, TRACKER_NFT, p2pkKeyOfTree, p2pkTree, reserveAddress,
} from "./constants";
import { asArray, asHex, asObject, asString, asU64, member, required, ShapeError, utf8Length } from "./json";
import type { BoxCandidate, ErgoBox, Hex, SignedTx, Token, UnsignedTx } from "./model";
import { proveDlog, publicKeyOf, verifyDlog, type ProveOptions } from "./provedlog";
import { envelopeData } from "./redemption";
import { boxIdHolds, bytesToSign, computeTxId, signedTxToNodeJson } from "./serialize";

export type CheckResult<R extends string> = { ok: true } | { ok: false; rule: R; message: string };

class Refused<R extends string> extends Error {
  constructor(readonly rule: R, message: string) {
    super(message);
  }
}

function run<R extends string>(fn: (refuse: (rule: R, message: string) => never) => void): CheckResult<R> {
  try {
    fn((rule, message) => {
      throw new Refused(rule, message);
    });
    return { ok: true };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, rule: e.rule as R, message: e.message };
    throw e;
  }
}

function sum(values: bigint[]): bigint {
  return values.reduce((a, b) => a + b, 0n);
}

/** Every token of `boxes`, merged by id, in first-appearance order. */
export function mergedTokens(boxes: readonly { tokens: Token[] }[]): Token[] {
  const order: Hex[] = [];
  const total = new Map<Hex, bigint>();
  for (const b of boxes)
    for (const t of b.tokens) {
      if (!total.has(t.tokenId)) order.push(t.tokenId);
      total.set(t.tokenId, (total.get(t.tokenId) ?? 0n) + t.amount);
    }
  return order.map((tokenId) => ({ tokenId, amount: total.get(tokenId)! }));
}

// ─── coin selection ─────────────────────────────────────────────────────────────────────────────

export interface Selection {
  inputs: ErgoBox[];
  /** ERG left after `need`: 0, or at least MIN_BOX_NANOERG unless `dust` says otherwise. */
  leftover: bigint;
  /** Tokens the spent boxes carry: they must go to a change output. */
  tokens: Token[];
}

/**
 * Picks boxes at P2PK(owner) that cover `need` nanoERG: token-free boxes first (largest first), token boxes only when
 * needed. With tokens, a change box of at least MIN_BOX_NANOERG must remain. Every box must hash to its id.
 * Returns null when the boxes do not cover it.
 */
export function selectCoins(boxes: readonly ErgoBox[], owner: Hex, need: bigint): Selection | null {
  const tree = p2pkTree(owner);
  for (const b of boxes) {
    if (b.ergoTree !== tree) throw new Error(`box ${b.boxId} is not at P2PK(owner)`);
    if (!boxIdHolds(b)) throw new Error(`box ${b.boxId} does not hash to its id`);
  }
  const free = boxes.filter((b) => b.tokens.length === 0).sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1));
  const withTokens = boxes.filter((b) => b.tokens.length > 0).sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1));
  const picked: ErgoBox[] = [];
  let total = 0n;
  const enough = () => {
    const tokens = mergedTokens(picked);
    const left = total - need;
    if (left < 0n) return false;
    return tokens.length === 0 || left >= MIN_BOX_NANOERG;
  };
  for (const b of [...free, ...withTokens]) {
    if (enough()) break;
    picked.push(b);
    total += b.value;
  }
  if (!enough()) return null;
  return { inputs: picked, leftover: total - need, tokens: mergedTokens(picked) };
}

// ─── T1: the tracker's payload (POST /reserves/create) ──────────────────────────────────────────

export interface ReservePayload {
  text: string;
  requestCount: number;
  address: string;
  value: bigint;
  assets: Token[];
  /** Register name → hex, exactly as sent. */
  registers: Record<string, Hex>;
  fee: bigint;
  changeAddress: string;
}

/** Reads a `POST /reserves/create` answer (`{requests:[{address, value, assets:[{token_id, amount}], registers}], fee, change_address}`). */
export function parseReservePayload(text: string): ReservePayload {
  const { data } = envelopeData(text);
  const d = asObject(data, "data");
  const reqs = asArray(required(d, "requests", "data"), "data.requests");
  const r = asObject(reqs.items[0], "data.requests[0]");
  const regsNode = asObject(required(r, "registers", "data.requests[0]"), "data.requests[0].registers");
  const registers: Record<string, Hex> = {};
  for (const e of regsNode.entries) registers[e.key] = asHex(e.value, `data.requests[0].registers.${e.key}`);
  return {
    text,
    requestCount: reqs.items.length,
    address: asString(required(r, "address", "data.requests[0]"), "data.requests[0].address"),
    value: asU64(required(r, "value", "data.requests[0]"), "data.requests[0].value"),
    assets: asArray(required(r, "assets", "data.requests[0]"), "data.requests[0].assets").items.map((a, i) => {
      const o = asObject(a, `data.requests[0].assets[${i}]`);
      const id = member(o, "token_id") ?? member(o, "tokenId");
      if (!id) throw new ShapeError(`data.requests[0].assets[${i}]`, "no token id");
      return { tokenId: asHex(id, `data.requests[0].assets[${i}].token_id`, 32), amount: asU64(required(o, "amount", `data.requests[0].assets[${i}]`), `data.requests[0].assets[${i}].amount`) };
    }),
    registers,
    fee: asU64(required(d, "fee", "data"), "data.fee"),
    changeAddress: asString(required(d, "change_address", "data"), "data.change_address"),
  };
}

export type ReservePayloadRule = "requests" | "address" | "value" | "assets" | "registers" | "fee" | "change-address";

/** The registers a new reserve of `owner` must have: R4 owner, R5 empty tree, R6 our tracker NFT, R7 Long 0. */
export function reserveRegisters(owner: Hex): Hex[] {
  return [`07${owner}`, EMPTY_RESERVE_R5, `0e20${TRACKER_NFT}`, R7_NO_REFUND];
}

/**
 * Design §2.3, the tracker's answer: byte for byte against the pinned constants. On any mismatch: "The tracker's
 * reserve template differs from the one this app knows. Nothing was signed."
 */
export function checkReservePayload(p: ReservePayload, want: { owner: Hex; amount: bigint; nftId: Hex }): CheckResult<ReservePayloadRule> {
  return run<ReservePayloadRule>((refuse) => {
    if (p.requestCount !== 1) refuse("requests", `${p.requestCount} payment requests; expected exactly one`);
    let tree: Hex | null = null;
    try {
      const a = parseAddress(p.address);
      tree = a.network === "mainnet" && a.type === "P2S" ? a.ergoTree : null;
    } catch {
      tree = null;
    }
    if (tree !== RESERVE_TREE_HEX || p.address !== reserveAddress()) refuse("address", "the reserve address is not the mainnet P2S of the pinned reserve contract");
    if (p.value !== want.amount) refuse("value", `the payload asks for ${p.value} nanoERG; we chose ${want.amount}`);
    if (p.assets.length !== 1 || p.assets[0].tokenId !== want.nftId || p.assets[0].amount !== 1n) refuse("assets", "the payload's assets are not [{inputs[0].boxId, 1}]");
    const want4 = reserveRegisters(want.owner);
    const names = Object.keys(p.registers).sort();
    if (names.join() !== "R4,R5,R6,R7" || want4.some((v, i) => p.registers[`R${4 + i}`] !== v)) refuse("registers", "the payload's registers are not exactly R4 owner, R5 empty tree, R6 our tracker NFT, R7 0");
    if (p.fee < T1_FEE_MIN_NANOERG || p.fee > T1_FEE_MAX_NANOERG) refuse("fee", `the fee ${p.fee} nanoERG is outside ${T1_FEE_MIN_NANOERG} … ${T1_FEE_MAX_NANOERG}`);
    let change: Hex | null = null;
    try {
      change = treeOfAddress(p.changeAddress);
    } catch {
      change = null;
    }
    if (change !== p2pkTree(want.owner)) refuse("change-address", "the change address is not P2PK(owner)");
  });
}

// ─── T1: build and check ────────────────────────────────────────────────────────────────────────

export interface ReserveCreationInput {
  owner: Hex;
  /** Confirmed, unspent boxes at P2PK(owner), as chosen: inputs[0].boxId becomes the reserve NFT id. */
  inputs: ErgoBox[];
  /** The reserve value (already raised by any dust, see `planReserveCreation`). */
  amount: bigint;
  fee: bigint;
  /** creationHeight of every output: the tip from /v1/info. */
  height: number;
}

export interface ReservePlan {
  inputs: ErgoBox[];
  /** The final reserve value: ask POST /reserves/create for exactly this. */
  amount: bigint;
  /** inputs[0].boxId: the id the reserve NFT gets. */
  nftId: Hex;
  /** The change T1 will return to P2PK(owner): 0 or at least MIN_BOX_NANOERG. */
  change: bigint;
}

/**
 * Chooses the boxes and the final amount for a reserve of about `amount` (design §2.2): change is 0 or ≥ 0.001 ERG.
 * Dust below that is added to the reserve; when that would pass `cap`, the amount is lowered instead so that the
 * change is exactly 0.001 ERG. Null when the boxes do not cover it (or the lowered amount would fall below 0.1 ERG).
 */
export function planReserveCreation(boxes: readonly ErgoBox[], owner: Hex, amount: bigint, fee: bigint, cap: bigint = RESERVE_DEFAULT_CAP_NANOERG): ReservePlan | null {
  const sel = selectCoins(boxes, owner, amount + fee);
  if (!sel) return null;
  const base = { inputs: sel.inputs, nftId: sel.inputs[0].boxId };
  const dust = sel.tokens.length === 0 && sel.leftover > 0n && sel.leftover < MIN_BOX_NANOERG ? sel.leftover : 0n;
  if (dust === 0n) return { ...base, amount, change: sel.leftover };
  if (amount + dust <= cap) return { ...base, amount: amount + dust, change: 0n };
  const lowered = amount - (MIN_BOX_NANOERG - dust);
  if (lowered < RESERVE_MIN_NANOERG) return null;
  return { ...base, amount: lowered, change: MIN_BOX_NANOERG };
}

/** The unsigned T1: [reserve, change?, fee], no data inputs, no extensions. */
export function buildReserveCreation(t: ReserveCreationInput): UnsignedTx {
  if (t.inputs.length === 0) throw new Error("T1 needs at least one input");
  const total = sum(t.inputs.map((b) => b.value));
  const change = total - t.amount - t.fee;
  const tokens = mergedTokens(t.inputs);
  if (change < 0n) throw new Error("the inputs do not cover the amount and the fee");
  if ((change > 0n || tokens.length > 0) && change < MIN_BOX_NANOERG) throw new Error(`change ${change} nanoERG is below ${MIN_BOX_NANOERG}: add it to the amount or pick more boxes`);
  const outputs: BoxCandidate[] = [
    { value: t.amount, ergoTree: RESERVE_TREE_HEX, creationHeight: t.height, tokens: [{ tokenId: t.inputs[0].boxId, amount: 1n }], registers: reserveRegisters(t.owner) },
  ];
  if (change > 0n) outputs.push({ value: change, ergoTree: p2pkTree(t.owner), creationHeight: t.height, tokens, registers: [] });
  outputs.push({ value: t.fee, ergoTree: FEE_TREE_HEX, creationHeight: t.height, tokens: [], registers: [] });
  return { inputs: t.inputs.map((b) => ({ boxId: b.boxId, extension: [] })), dataInputs: [], outputs };
}

export type ReserveCreationRule = "amount" | "fee" | "inputs" | "outputs" | "reserve-output" | "change-output" | "fee-output" | "creation-height" | "totals";

/**
 * Design §2.3, the transaction: owner-only inputs (ids verified by hash), exactly [reserve, change?, fee], ERG in =
 * ERG out, the only new token is the NFT (inputs[0].boxId, amount 1) in output 0, every input token in the change.
 * `cap` is the UI cap (D5): 1 ERG by default, never above 10 ERG.
 */
export function checkReserveCreation(tx: UnsignedTx, inputs: readonly ErgoBox[], want: { owner: Hex; amount: bigint; fee: bigint; height: number; cap?: bigint }): CheckResult<ReserveCreationRule> {
  return run<ReserveCreationRule>((refuse) => {
    const cap = want.cap ?? RESERVE_DEFAULT_CAP_NANOERG;
    if (cap > RESERVE_HARD_CAP_NANOERG) refuse("amount", "the cap is above the 10 ERG maximum");
    if (want.amount < RESERVE_MIN_NANOERG || want.amount > cap) refuse("amount", `the reserve amount ${want.amount} nanoERG is outside ${RESERVE_MIN_NANOERG} … ${cap}`);
    if (want.fee < T1_FEE_MIN_NANOERG || want.fee > T1_FEE_MAX_NANOERG) refuse("fee", `the fee ${want.fee} is outside ${T1_FEE_MIN_NANOERG} … ${T1_FEE_MAX_NANOERG}`);
    const owner = p2pkTree(want.owner);
    if (tx.inputs.length === 0 || tx.inputs.length !== inputs.length) refuse("inputs", "the inputs do not match the boxes");
    tx.inputs.forEach((inp, i) => {
      const b = inputs[i];
      if (inp.boxId !== b.boxId) refuse("inputs", `input ${i} is not box ${b.boxId}`);
      if (inp.extension.length !== 0) refuse("inputs", `input ${i} carries a context extension`);
      if (b.ergoTree !== owner) refuse("inputs", `input ${i} is not at P2PK(owner)`);
      if (!boxIdHolds(b)) refuse("inputs", `box ${b.boxId} does not hash to its id`);
    });
    if (new Set(tx.inputs.map((i) => i.boxId)).size !== tx.inputs.length) refuse("inputs", "a box is spent twice");
    if (tx.dataInputs.length !== 0) refuse("inputs", "T1 has no data inputs");
    const nft = inputs[0].boxId;
    const inTokens = mergedTokens(inputs as ErgoBox[]);
    if (inTokens.some((t) => t.tokenId === nft)) refuse("totals", "the NFT id is already a token of an input");
    const outs = tx.outputs;
    const hasChange = outs.length === 3;
    if (outs.length !== 2 && outs.length !== 3) refuse("outputs", `${outs.length} outputs; T1 has [reserve, change?, fee]`);
    const [reserve, change, fee] = hasChange ? [outs[0], outs[1], outs[2]] : [outs[0], null, outs[1]];
    const regs = reserveRegisters(want.owner);
    if (
      reserve.ergoTree !== RESERVE_TREE_HEX ||
      reserve.value !== want.amount ||
      reserve.tokens.length !== 1 ||
      reserve.tokens[0].tokenId !== nft ||
      reserve.tokens[0].amount !== 1n ||
      reserve.registers.length !== 4 ||
      regs.some((v, i) => reserve.registers[i] !== v)
    ) {
      refuse("reserve-output", "output 0 is not the reserve: pinned contract, the amount, [NFT 1], R4 owner, R5 empty tree, R6 our NFT, R7 0");
    }
    if (change) {
      const tokensOk = change.tokens.length === inTokens.length && inTokens.every((t, i) => change.tokens[i].tokenId === t.tokenId && change.tokens[i].amount === t.amount);
      if (change.ergoTree !== owner || change.value < MIN_BOX_NANOERG || !tokensOk || change.registers.length !== 0) refuse("change-output", "output 1 is not the change to P2PK(owner) with every input token and at least 0.001 ERG");
    } else if (inTokens.length > 0) {
      refuse("change-output", "the inputs carry tokens and there is no change output: they would be burned");
    }
    if (fee.ergoTree !== FEE_TREE_HEX || fee.value !== want.fee || fee.tokens.length !== 0 || fee.registers.length !== 0) refuse("fee-output", "the last output is not the token-free miner fee");
    const floor = Math.max(...inputs.map((b) => b.creationHeight));
    for (const [i, o] of outs.entries()) if (o.creationHeight !== want.height || o.creationHeight < floor) refuse("creation-height", `output ${i} is created at ${o.creationHeight}, not at the tip ${want.height} (inputs up to ${floor})`);
    if (sum(inputs.map((b) => b.value)) !== sum(outs.map((o) => o.value))) refuse("totals", "ERG in differs from ERG out");
  });
}

// ─── Withdraw ───────────────────────────────────────────────────────────────────────────────────

export interface WithdrawInput {
  owner: Hex;
  inputs: ErgoBox[];
  /** A mainnet P2PK or P2S address (never the reserve contract or the fee contract). */
  to: string;
  /** The destination's value. */
  amount: bigint;
  fee: bigint;
  height: number;
}

function destinationTree(to: string): Hex {
  const tree = treeOfAddress(to);
  if (tree === RESERVE_TREE_HEX) throw new Error("this is the reserve contract's address: a box sent there is not a reserve");
  if (tree === FEE_TREE_HEX) throw new Error("this is the miner-fee contract");
  const pk = p2pkKeyOfTree(tree);
  if (pk !== null && !isValidPublicKey(pk)) throw new Error("not a valid P2PK address");
  return tree;
}

/** The unsigned Withdraw: [destination, change?, fee]; tokens stay with the owner (change). */
export function buildWithdraw(w: WithdrawInput): UnsignedTx {
  const tree = destinationTree(w.to);
  const total = sum(w.inputs.map((b) => b.value));
  const change = total - w.amount - w.fee;
  const tokens = mergedTokens(w.inputs);
  if (w.amount < MIN_BOX_NANOERG) throw new Error(`a withdrawal sends at least ${MIN_BOX_NANOERG} nanoERG`);
  if (change < 0n) throw new Error("the inputs do not cover the amount and the fee");
  if ((change > 0n || tokens.length > 0) && change < MIN_BOX_NANOERG) throw new Error(`change ${change} nanoERG is below ${MIN_BOX_NANOERG}: add it to the amount or pick more boxes`);
  const outputs: BoxCandidate[] = [{ value: w.amount, ergoTree: tree, creationHeight: w.height, tokens: [], registers: [] }];
  if (change > 0n) outputs.push({ value: change, ergoTree: p2pkTree(w.owner), creationHeight: w.height, tokens, registers: [] });
  outputs.push({ value: w.fee, ergoTree: FEE_TREE_HEX, creationHeight: w.height, tokens: [], registers: [] });
  return { inputs: w.inputs.map((b) => ({ boxId: b.boxId, extension: [] })), dataInputs: [], outputs };
}

export type WithdrawRule = "inputs" | "outputs" | "destination" | "change-output" | "fee-output" | "totals";

export function checkWithdraw(tx: UnsignedTx, inputs: readonly ErgoBox[], want: { owner: Hex; to: string; amount: bigint; fee: bigint }): CheckResult<WithdrawRule> {
  return run<WithdrawRule>((refuse) => {
    const owner = p2pkTree(want.owner);
    let dest: Hex = "";
    try {
      dest = destinationTree(want.to);
    } catch (e) {
      refuse("destination", (e as Error).message);
    }
    if (tx.inputs.length === 0 || tx.inputs.length !== inputs.length || tx.dataInputs.length !== 0) refuse("inputs", "the inputs do not match the boxes");
    tx.inputs.forEach((inp, i) => {
      if (inp.boxId !== inputs[i].boxId || inp.extension.length !== 0 || inputs[i].ergoTree !== owner || !boxIdHolds(inputs[i])) refuse("inputs", `input ${i} is not an owner box with a verified id`);
    });
    const outs = tx.outputs;
    if (outs.length !== 2 && outs.length !== 3) refuse("outputs", `${outs.length} outputs; a withdrawal has [destination, change?, fee]`);
    const [d, change, fee] = outs.length === 3 ? [outs[0], outs[1], outs[2]] : [outs[0], null, outs[1]];
    if (d.ergoTree !== dest || d.value !== want.amount || d.tokens.length !== 0 || d.registers.length !== 0) refuse("destination", "output 0 is not the amount to the destination");
    const inTokens = mergedTokens(inputs as ErgoBox[]);
    if (change) {
      const tokensOk = change.tokens.length === inTokens.length && inTokens.every((t, i) => change.tokens[i].tokenId === t.tokenId && change.tokens[i].amount === t.amount);
      if (change.ergoTree !== owner || change.value < MIN_BOX_NANOERG || !tokensOk || change.registers.length !== 0) refuse("change-output", "output 1 is not the change to P2PK(owner) with every input token");
    } else if (inTokens.length > 0) {
      refuse("change-output", "the inputs carry tokens and there is no change output: they would be burned");
    }
    if (fee.ergoTree !== FEE_TREE_HEX || fee.value !== want.fee || fee.tokens.length !== 0 || fee.registers.length !== 0) refuse("fee-output", "the last output is not the token-free miner fee");
    if (want.fee < T1_FEE_MIN_NANOERG || want.fee > T1_FEE_MAX_NANOERG) refuse("fee-output", `the fee ${want.fee} is outside ${T1_FEE_MIN_NANOERG} … ${T1_FEE_MAX_NANOERG}`);
    if (sum(inputs.map((b) => b.value)) !== sum(outs.map((o) => o.value))) refuse("totals", "ERG in differs from ERG out");
  });
}

// ─── signing P2PK transactions ──────────────────────────────────────────────────────────────────

/**
 * Proves every input with the owner's secret. Every input box must be at P2PK(pk of the secret) and hash to its id.
 * Each proof is verified; the result's id is the unsigned transaction's.
 */
export function signP2pkTransaction(tx: UnsignedTx, inputs: readonly ErgoBox[], secret: Uint8Array, opts: ProveOptions = {}): { signed: SignedTx; txId: Hex; nodeJson: string } {
  const pk = publicKeyOf(secret);
  const tree = p2pkTree(bytesToHex(pk));
  if (inputs.length !== tx.inputs.length) throw new Error("one box per input");
  tx.inputs.forEach((inp, i) => {
    if (inputs[i].boxId !== inp.boxId || inputs[i].ergoTree !== tree || !boxIdHolds(inputs[i])) throw new Error(`input ${i} is not a verified box at P2PK(this key)`);
    if (inp.extension.length !== 0) throw new Error(`input ${i} carries a context extension`);
  });
  const message = bytesToSign(tx);
  const signed: SignedTx = {
    inputs: tx.inputs.map((inp) => {
      const proof = proveDlog(message, secret, opts);
      if (!verifyDlog(pk, message, proof)) throw new Error("a proof does not verify");
      return { ...inp, proof: bytesToHex(proof) };
    }),
    dataInputs: tx.dataInputs,
    outputs: tx.outputs,
  };
  const nodeJson = signedTxToNodeJson(signed);
  if (utf8Length(nodeJson) > BROADCAST_BODY_MAX_BYTES) throw new Error(`the signed transaction is ${utf8Length(nodeJson)} bytes of JSON, above the ${BROADCAST_BODY_MAX_BYTES}-byte broadcast limit: spend fewer boxes`);
  return { signed, txId: computeTxId(tx), nodeJson };
}

/** Verifies every input proof of a P2PK transaction against the owner keys of its boxes. */
export function verifyP2pkTransaction(tx: SignedTx, inputs: readonly ErgoBox[]): boolean {
  const message = bytesToSign({ inputs: tx.inputs.map((i) => ({ boxId: i.boxId, extension: i.extension })), dataInputs: tx.dataInputs, outputs: tx.outputs });
  return tx.inputs.every((inp, i) => {
    const pk = p2pkKeyOfTree(inputs[i]?.ergoTree ?? "");
    return pk !== null && inputs[i].boxId === inp.boxId && verifyDlog(hexToBytes(pk), message, hexToBytes(inp.proof));
  });
}
