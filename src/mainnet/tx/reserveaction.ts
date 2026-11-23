// The reserve's own actions, built by the wallet from a reserve box (read on /v1) and boxes at P2PK(app key)
// (design §9; tracker contract/basis.es, read at its current text):
//
//   top-up          #0 = 10   [reserve + amount, change?, fee]   inputs [reserve, payer boxes…]  reserve: no signature
//   refund start    #0 = 20   [reserve with R7 = tip + 10, change?, fee]   inputs [reserve, owner boxes…]  owner signs
//   refund complete #0 = 30   [everything − fee to P2PK(owner), fee]        inputs [reserve]              owner signs
//
// What the contract asks (basis.es line numbers):
//   • every action: #0 is a Byte (l. 223); OUTPUTS(#0 % 10) must exist, even for a completion (l. 228, read before the
//     branch); only one reserve input of this owner (l. 242); the reserve output keeps the script, the tokens, R4 and R6
//     (selfPreserved, l. 248);
//   • top-up (l. 438–445): R5 equal, R7 equal (a pending refund stays), at least 0.1 ERG added; no signature at all, so
//     anyone may top up anyone's reserve;
//   • refund start (l. 446–456): value not lower, R5 equal, the new R7 ≥ HEIGHT, the current R7 = 0 (one-shot: a
//     started refund can never be started again, and no action sets R7 back to 0), proveDlog(owner);
//   • refund completion (l. 457–465): R7 > 0, HEIGHT ≥ R7 + 43 200, proveDlog(owner); the outputs are free.
//
// The wallet's own rules on top (stricter than the contract): only an ERG reserve under the pinned tree and bound to
// our tracker; no top-up of a reserve in refund (the contract allows it, the money would only wait for the owner's
// completion); exactly the outputs above, R4–R7 byte for byte, the miner fee exactly 0.001 ERG, every token of the
// wallet's boxes to its change, the reserve NFT kept (a completion puts it into the owner's output: nothing is burned).
import { bytesToHex, hexToBytes } from "../../protocol/bytes";
import { isValidPublicKey } from "../../protocol/keys";
import { decodeRegister, encodeAvlTree } from "../../protocol/registerCodec";
import { encodeLong } from "../../protocol/registers";
import {
  ACTION_REFUND_COMPLETE, ACTION_REFUND_START, ACTION_TOP_UP, BROADCAST_BODY_MAX_BYTES, FEE_TREE_HEX, MINER_FEE_NANOERG, MIN_BOX_NANOERG, RESERVE_TREE_HEX,
  TRACKER_NFT, p2pkKeyOfTree, p2pkTree,
} from "./constants";
import { utf8Length } from "./json";
import type { BoxCandidate, ErgoBox, Hex, SignedTx, UnsignedTx } from "./model";
import { mergedTokens, outputHeight, type CheckResult } from "./p2pk";
import { proveDlog, publicKeyOf, verifyDlog, type ProveOptions } from "./provedlog";
import { boxIdHolds, bytesToSign, computeTxId, signedTxToNodeJson } from "./serialize";

/** basis.es `refundPeriod` (l. 231): blocks between the refund start (R7) and its completion, about 60 days. */
export const REFUND_PERIOD_BLOCKS = 43_200;
/** R7 of a refund start: the tip + 10 (the contract needs R7 ≥ HEIGHT of the block that includes it, l. 454). */
export const REFUND_START_AHEAD = 10;
/** The highest R7 the wallet signs for a start built at `tip`: a later R7 only delays the completion. */
export const REFUND_START_MAX_AHEAD = 20;
/** basis.es l. 444: a top-up adds at least 0.1 ERG. */
export const TOP_UP_MIN_NANOERG = 100_000_000n;

export type ReserveActionKind = "topup" | "refund-start" | "refund-end";

const ACTION_OF: Record<ReserveActionKind, number> = { topup: ACTION_TOP_UP, "refund-start": ACTION_REFUND_START, "refund-end": ACTION_REFUND_COMPLETE };

/** Context variable #0 of the reserve input: a Byte constant (02‖b), action × 10 + the reserve output's index (0). */
export const actionVar = (kind: ReserveActionKind): Hex => `02${ACTION_OF[kind].toString(16).padStart(2, "0")}`;

// ─── the reserve box ────────────────────────────────────────────────────────────────────────────

export type ReserveReadRule = "box-id" | "contract" | "tokens" | "registers" | "tracker";

export interface ReserveInfo {
  box: ErgoBox;
  /** R4: the owner's key. */
  owner: Hex;
  /** Token 0: the reserve NFT. */
  nft: Hex;
  /** R7: 0 = no refund started; otherwise the height the refund counts from. */
  refundHeight: bigint;
}

/**
 * Reads a reserve box the wallet may act on: it hashes to its id, sits under the pinned ERG contract (a legacy template
 * or a token reserve is refused), holds exactly its NFT, R4 a valid key, R5 an AvlTree, R6 our tracker's NFT and R7 a
 * Long ≥ 0, each one canonical constant and nothing after R7.
 */
export function readReserve(box: ErgoBox): { ok: true; info: ReserveInfo } | { ok: false; rule: ReserveReadRule; message: string } {
  const no = (rule: ReserveReadRule, message: string) => ({ ok: false as const, rule, message });
  if (!boxIdHolds(box)) return no("box-id", "the reserve box does not hash to its id");
  if (box.ergoTree !== RESERVE_TREE_HEX) return no("contract", "the box is not under the current Basis ERG reserve contract (a legacy test version, a token reserve or another contract)");
  if (box.tokens.length !== 1 || box.tokens[0].amount !== 1n) return no("tokens", "the reserve does not hold exactly one NFT");
  const [r4, r5, r6, r7] = box.registers;
  if (box.registers.length !== 4) return no("registers", "the reserve does not have exactly R4–R7");
  let owner = "", refundHeight = -1n;
  try {
    const d4 = decodeRegister(r4);
    if (d4.type !== "GroupElement" || `07${d4.value}` !== r4 || !isValidPublicKey(d4.value)) return no("registers", "R4 is not the owner's key");
    owner = d4.value;
    const d5 = decodeRegister(r5);
    if (d5.type !== "AvlTree" || encodeAvlTree(d5) !== r5) return no("registers", "R5 is not one AvlTree");
    const d7 = decodeRegister(r7);
    if (d7.type !== "Long" || encodeLong(d7.value) !== r7 || d7.value < 0n) return no("registers", "R7 is not a Long refund height");
    refundHeight = d7.value;
  } catch {
    return no("registers", "a register could not be read");
  }
  if (r6 !== `0e20${TRACKER_NFT}`) return no("tracker", "the reserve is bound to another tracker (R6), not ErgoScan's");
  return { ok: true, info: { box, owner, nft: box.tokens[0].tokenId, refundHeight } };
}

/** The refund's clock at `tip`: the completion is valid in a block at HEIGHT ≥ R7 + 43 200, the next one is tip + 1. */
export interface RefundClock {
  /** R7. */
  startedAt: bigint;
  /** R7 + 43 200: the first block that may hold the completion. */
  unlockAt: bigint;
  /** Blocks until a completion can be broadcast (0 = now). */
  blocksLeft: number;
  open: boolean;
}

export function refundClock(refundHeight: bigint, tip: number): RefundClock | null {
  if (refundHeight <= 0n) return null;
  const unlockAt = refundHeight + BigInt(REFUND_PERIOD_BLOCKS);
  const left = unlockAt - BigInt(tip + 1);
  return { startedAt: refundHeight, unlockAt, blocksLeft: left > 0n ? Number(left) : 0, open: left <= 0n };
}

// ─── building ───────────────────────────────────────────────────────────────────────────────────

const sum = (v: readonly bigint[]): bigint => v.reduce((a, b) => a + b, 0n);
const reserveInput = (box: ErgoBox, kind: ReserveActionKind) => ({ boxId: box.boxId, extension: [{ key: 0, value: actionVar(kind) }] });

function changeOutputs(owner: Hex, boxes: readonly ErgoBox[], change: bigint, h: number): BoxCandidate[] {
  const tokens = mergedTokens(boxes);
  if ((change > 0n || tokens.length > 0) && change < MIN_BOX_NANOERG) throw new Error(`change ${change} nanoERG is below ${MIN_BOX_NANOERG}: add it to the reserve or pick more boxes`);
  return change > 0n ? [{ value: change, ergoTree: p2pkTree(owner), creationHeight: h, tokens, registers: [] }] : [];
}

export interface TopUpInput {
  /** The reserve box as /v1 has it now (readReserve passed). */
  reserve: ErgoBox;
  /** The wallet's key: it pays and signs its own boxes; it need not own the reserve. */
  payer: Hex;
  /** Confirmed, unspent boxes at P2PK(payer). */
  inputs: ErgoBox[];
  /** What the reserve gains: at least 0.1 ERG. */
  amount: bigint;
  fee: bigint;
  height: number;
}

/** The unsigned top-up: inputs [reserve (#0 = 10, no proof), payer boxes…], outputs [reserve + amount, change?, fee]. */
export function buildTopUp(t: TopUpInput): UnsignedTx {
  if (t.inputs.length === 0) throw new Error("a top-up needs at least one box of the payer");
  if (t.amount < TOP_UP_MIN_NANOERG) throw new Error(`a top-up adds at least ${TOP_UP_MIN_NANOERG} nanoERG`);
  const h = outputHeight(t.height, [t.reserve, ...t.inputs]);
  const change = sum(t.inputs.map((b) => b.value)) - t.amount - t.fee;
  if (change < 0n) throw new Error("the boxes do not cover the amount and the fee");
  const r = t.reserve;
  return {
    inputs: [reserveInput(r, "topup"), ...t.inputs.map((b) => ({ boxId: b.boxId, extension: [] }))],
    dataInputs: [],
    outputs: [
      { value: r.value + t.amount, ergoTree: r.ergoTree, creationHeight: h, tokens: r.tokens.map((x) => ({ ...x })), registers: [...r.registers] },
      ...changeOutputs(t.payer, t.inputs, change, h),
      { value: t.fee, ergoTree: FEE_TREE_HEX, creationHeight: h, tokens: [], registers: [] },
    ],
  };
}

export interface RefundStartInput {
  reserve: ErgoBox;
  owner: Hex;
  /** Boxes at P2PK(owner) that pay the fee: the reserve's value may not go down (l. 452). */
  inputs: ErgoBox[];
  fee: bigint;
  height: number;
  /** The new R7: the tip + REFUND_START_AHEAD. */
  refundHeight: bigint;
  /** Change below 0.001 ERG goes into the reserve (never to the miner): 0 ≤ add < 0.001 ERG. */
  add?: bigint;
}

/** The unsigned refund start: inputs [reserve (#0 = 20), owner boxes…], outputs [reserve with R7 set, change?, fee]. */
export function buildRefundStart(t: RefundStartInput): UnsignedTx {
  if (t.inputs.length === 0) throw new Error("a refund start needs a box of the owner for the miner fee");
  const add = t.add ?? 0n;
  if (add < 0n || add >= MIN_BOX_NANOERG) throw new Error("only change below 0.001 ERG goes into the reserve");
  const h = outputHeight(t.height, [t.reserve, ...t.inputs]);
  const change = sum(t.inputs.map((b) => b.value)) - t.fee - add;
  if (change < 0n) throw new Error("the boxes do not cover the fee");
  const r = t.reserve;
  return {
    inputs: [reserveInput(r, "refund-start"), ...t.inputs.map((b) => ({ boxId: b.boxId, extension: [] }))],
    dataInputs: [],
    outputs: [
      { value: r.value + add, ergoTree: r.ergoTree, creationHeight: h, tokens: r.tokens.map((x) => ({ ...x })), registers: [r.registers[0], r.registers[1], r.registers[2], encodeLong(t.refundHeight)] },
      ...changeOutputs(t.owner, t.inputs, change, h),
      { value: t.fee, ergoTree: FEE_TREE_HEX, creationHeight: h, tokens: [], registers: [] },
    ],
  };
}

export interface RefundCompleteInput {
  reserve: ErgoBox;
  owner: Hex;
  fee: bigint;
  height: number;
}

/** The unsigned completion: inputs [reserve (#0 = 30)], outputs [the reserve − fee with its NFT to P2PK(owner), fee]. */
export function buildRefundComplete(t: RefundCompleteInput): UnsignedTx {
  const r = t.reserve;
  const out = r.value - t.fee;
  if (out < MIN_BOX_NANOERG) throw new Error("the reserve holds too little to pay the miner fee and leave 0.001 ERG");
  const h = outputHeight(t.height, [r]);
  return {
    inputs: [reserveInput(r, "refund-end")],
    dataInputs: [],
    outputs: [
      { value: out, ergoTree: p2pkTree(t.owner), creationHeight: h, tokens: r.tokens.map((x) => ({ ...x })), registers: [] },
      { value: t.fee, ergoTree: FEE_TREE_HEX, creationHeight: h, tokens: [], registers: [] },
    ],
  };
}

// ─── L1: the structural checks before signing ──────────────────────────────────────────────────

export type ReserveActionRule =
  | "reserve" | "owner" | "refund-state" | "amount" | "fee" | "inputs" | "action-var" | "outputs"
  | "reserve-output" | "payout-output" | "change-output" | "fee-output" | "creation-height" | "totals";

class Refused extends Error {
  constructor(readonly rule: ReserveActionRule, message: string) {
    super(message);
  }
}

function run(fn: (refuse: (rule: ReserveActionRule, message: string) => never) => void): CheckResult<ReserveActionRule> {
  try {
    fn((rule, message) => { throw new Refused(rule, message); });
    return { ok: true };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, rule: e.rule, message: e.message };
    throw e;
  }
}

export interface ReserveActionWant {
  kind: ReserveActionKind;
  /** The wallet's key: the payer of a top-up, the owner of a refund. */
  signer: Hex;
  /** The tip the transaction was built at (HEIGHT of the next block is tip + 1). */
  height: number;
  fee: bigint;
  /** Top-up: what the reserve gains. */
  amount?: bigint;
  /** Refund start: the R7 it sets. */
  refundHeight?: bigint;
}

/**
 * L1 for a top-up, a refund start or a completion: the reserve box is one the wallet acts on and in the right refund
 * state; the transaction spends exactly it (input 0, #0 the action, nothing else in its extension) and the signer's
 * own verified boxes; the outputs are exactly the layout above with R4–R7 byte for byte, the fee exactly 0.001 ERG
 * (MINER_FEE_NANOERG), every token of the signer's boxes in its change, ERG in = ERG out, no data inputs.
 */
export function checkReserveAction(tx: UnsignedTx, inputs: readonly ErgoBox[], want: ReserveActionWant): CheckResult<ReserveActionRule> {
  return run((refuse) => {
    const reserve = inputs[0];
    if (!reserve) refuse("inputs", "no reserve input");
    const read = readReserve(reserve);
    if (!read.ok) refuse("reserve", read.message);
    const info = (read as { info: ReserveInfo }).info;
    const own = p2pkTree(want.signer);
    if (want.fee !== MINER_FEE_NANOERG) refuse("fee", `the miner fee ${want.fee} is not ${MINER_FEE_NANOERG} nanoERG`);
    if (want.kind === "topup") {
      if (info.refundHeight !== 0n) refuse("refund-state", "a refund of this reserve has started: the wallet does not top it up");
      if (want.amount === undefined || want.amount < TOP_UP_MIN_NANOERG) refuse("amount", `a top-up adds at least ${TOP_UP_MIN_NANOERG} nanoERG`);
    } else {
      if (info.owner !== want.signer) refuse("owner", "only the reserve's owner starts or completes its refund");
      if (want.kind === "refund-start") {
        if (info.refundHeight !== 0n) refuse("refund-state", "a refund of this reserve has already started (it can start only once)");
        const r7 = want.refundHeight;
        if (r7 === undefined || r7 < BigInt(want.height + 1) || r7 > BigInt(want.height + REFUND_START_MAX_AHEAD)) refuse("refund-state", `R7 must be from ${want.height + 1} to ${want.height + REFUND_START_MAX_AHEAD}`);
      } else {
        const clock = refundClock(info.refundHeight, want.height);
        if (!clock) refuse("refund-state", "no refund of this reserve has started");
        if (!clock!.open) refuse("refund-state", `the refund completes from block ${clock!.unlockAt}; ${clock!.blocksLeft} blocks to go`);
      }
    }

    // inputs: the reserve first, with #0 only; then the signer's own boxes, ids verified, no extension
    if (tx.dataInputs.length !== 0) refuse("inputs", "no data inputs");
    if (tx.inputs.length !== inputs.length || tx.inputs.length === 0) refuse("inputs", "the inputs do not match the boxes");
    if (want.kind === "refund-end" && tx.inputs.length !== 1) refuse("inputs", "a completion spends only the reserve");
    if (want.kind !== "refund-end" && tx.inputs.length < 2) refuse("inputs", "the miner fee comes from the wallet's own boxes");
    tx.inputs.forEach((inp, i) => {
      if (inp.boxId !== inputs[i].boxId) refuse("inputs", `input ${i} is not box ${inputs[i].boxId}`);
      if (i === 0) {
        if (inp.extension.length !== 1 || inp.extension[0].key !== 0 || inp.extension[0].value !== actionVar(want.kind)) refuse("action-var", `the reserve input's extension is not exactly #0 = ${actionVar(want.kind)}`);
        return;
      }
      if (inp.extension.length !== 0) refuse("inputs", `input ${i} carries a context extension`);
      if (inputs[i].ergoTree !== own || !boxIdHolds(inputs[i])) refuse("inputs", `input ${i} is not a verified box at the wallet's own address`);
    });
    if (new Set(tx.inputs.map((i) => i.boxId)).size !== tx.inputs.length) refuse("inputs", "a box is spent twice");
    const ownBoxes = inputs.slice(1);
    const inTokens = mergedTokens(ownBoxes);

    const outs = tx.outputs;
    const fee = outs[outs.length - 1];
    if (want.kind === "refund-end") {
      if (outs.length !== 2) refuse("outputs", `${outs.length} outputs; a completion has [everything to the owner, fee]`);
      const p = outs[0];
      const tokensOk = p.tokens.length === reserve.tokens.length && reserve.tokens.every((t, i) => p.tokens[i].tokenId === t.tokenId && p.tokens[i].amount === t.amount);
      if (p.ergoTree !== own || p.value !== reserve.value - want.fee || !tokensOk || p.registers.length !== 0) refuse("payout-output", "output 0 is not the whole reserve less the fee, with its NFT, to the owner's own address");
    } else {
      if (outs.length !== 2 && outs.length !== 3) refuse("outputs", `${outs.length} outputs; this action has [reserve, change?, fee]`);
      const r = outs[0];
      const tokensOk = r.tokens.length === reserve.tokens.length && reserve.tokens.every((t, i) => r.tokens[i].tokenId === t.tokenId && r.tokens[i].amount === t.amount);
      if (r.ergoTree !== RESERVE_TREE_HEX || !tokensOk || r.registers.length !== 4) refuse("reserve-output", "output 0 does not keep the reserve contract, its NFT and four registers");
      const keep = want.kind === "topup" ? 4 : 3;
      for (let i = 0; i < keep; i++) if (r.registers[i] !== reserve.registers[i]) refuse("reserve-output", `output 0 changes R${4 + i}`);
      if (want.kind === "topup") {
        if (r.value !== reserve.value + want.amount!) refuse("reserve-output", `output 0 holds ${r.value}; the reserve ${reserve.value} plus ${want.amount} is ${reserve.value + want.amount!}`);
      } else {
        if (r.registers[3] !== encodeLong(want.refundHeight!)) refuse("reserve-output", `output 0's R7 is not Long ${want.refundHeight}`);
        if (r.value < reserve.value || r.value - reserve.value >= MIN_BOX_NANOERG) refuse("reserve-output", "a refund start keeps the reserve's value (plus at most the change dust)");
      }
      const change = outs.length === 3 ? outs[1] : null;
      if (change) {
        const ok = change.tokens.length === inTokens.length && inTokens.every((t, i) => change.tokens[i].tokenId === t.tokenId && change.tokens[i].amount === t.amount);
        if (change.ergoTree !== own || change.value < MIN_BOX_NANOERG || !ok || change.registers.length !== 0) refuse("change-output", "output 1 is not the change to the wallet's own address with every token of its boxes");
      } else if (inTokens.length > 0) {
        refuse("change-output", "the wallet's boxes carry tokens and there is no change output: they would be burned");
      }
    }
    if (fee.ergoTree !== FEE_TREE_HEX || fee.value !== want.fee || fee.tokens.length !== 0 || fee.registers.length !== 0) refuse("fee-output", "the last output is not the token-free miner fee of 0.001 ERG");
    const at = outputHeight(want.height, inputs);
    for (const [i, o] of outs.entries()) if (o.creationHeight !== at) refuse("creation-height", `output ${i} is created at ${o.creationHeight}, not at ${at}`);
    if (sum(inputs.map((b) => b.value)) !== sum(outs.map((o) => o.value))) refuse("totals", "ERG in differs from ERG out");
  });
}

// ─── signing ────────────────────────────────────────────────────────────────────────────────────

/**
 * Signs a reserve action with the wallet's key. Input 0 is the reserve: a top-up leaves its proof empty (the contract
 * asks no signature), a refund start or completion proves the owner's key (the contract reduces to proveDlog(owner),
 * the same proof a P2PK box takes). Every other input must be a verified box at P2PK(this key). Each proof is verified;
 * throws above the 16 KB broadcast limit, like signP2pkTransaction.
 */
export function signReserveAction(tx: UnsignedTx, inputs: readonly ErgoBox[], secret: Uint8Array, kind: ReserveActionKind, opts: ProveOptions = {}): { signed: SignedTx; txId: Hex; nodeJson: string } {
  const pk = publicKeyOf(secret);
  const pkHex = bytesToHex(pk);
  const own = p2pkTree(pkHex);
  if (inputs.length !== tx.inputs.length || inputs.length === 0) throw new Error("one box per input");
  const read = readReserve(inputs[0]);
  if (!read.ok) throw new Error(`input 0 is not a reserve the wallet acts on: ${read.message}`);
  if (kind !== "topup" && read.info.owner !== pkHex) throw new Error("only the reserve's owner signs its refund");
  tx.inputs.forEach((inp, i) => {
    if (inputs[i].boxId !== inp.boxId) throw new Error(`input ${i} is not box ${inp.boxId}`);
    if (i === 0) {
      if (inp.extension.length !== 1 || inp.extension[0].key !== 0 || inp.extension[0].value !== actionVar(kind)) throw new Error("the reserve input's #0 is not this action");
      return;
    }
    if (inputs[i].ergoTree !== own || !boxIdHolds(inputs[i]) || inp.extension.length !== 0) throw new Error(`input ${i} is not a verified box at P2PK(this key)`);
  });
  const message = bytesToSign(tx);
  const prove = () => {
    const proof = proveDlog(message, secret, opts);
    if (!verifyDlog(pk, message, proof)) throw new Error("a proof does not verify");
    return bytesToHex(proof);
  };
  const signed: SignedTx = {
    inputs: tx.inputs.map((inp, i) => ({ ...inp, proof: i === 0 && kind === "topup" ? "" : prove() })),
    dataInputs: tx.dataInputs,
    outputs: tx.outputs,
  };
  const nodeJson = signedTxToNodeJson(signed);
  if (utf8Length(nodeJson) > BROADCAST_BODY_MAX_BYTES) throw new Error(`the signed transaction is ${utf8Length(nodeJson)} bytes of JSON, above the ${BROADCAST_BODY_MAX_BYTES}-byte broadcast limit: spend fewer boxes`);
  return { signed, txId: computeTxId(tx), nodeJson };
}

/** Verifies the proofs of a signed reserve action: an empty reserve proof for a top-up, the owner's otherwise. */
export function verifyReserveAction(tx: SignedTx, inputs: readonly ErgoBox[], kind: ReserveActionKind): boolean {
  const message = bytesToSign({ inputs: tx.inputs.map((i) => ({ boxId: i.boxId, extension: i.extension })), dataInputs: tx.dataInputs, outputs: tx.outputs });
  return tx.inputs.every((inp, i) => {
    const box = inputs[i];
    if (!box || box.boxId !== inp.boxId) return false;
    if (i === 0) {
      if (kind === "topup") return inp.proof === "";
      const read = readReserve(box);
      return read.ok && verifyDlog(hexToBytes(read.info.owner), message, hexToBytes(inp.proof));
    }
    const pk = p2pkKeyOfTree(box.ergoTree);
    return pk !== null && verifyDlog(hexToBytes(pk), message, hexToBytes(inp.proof));
  });
}
