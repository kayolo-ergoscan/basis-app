// Redemption in the browser (design §3): the tracker builds, we check (L1, a port of the round-4 canary's
// `check_redemption`, basis_canary 6113b8d), the receiver key proves the reserve input, we splice the proof into the
// tracker's own text and echo its `unsigned_tx` byte for byte.
//
//   const build = parseBuildResponse(text);                      // raw spans + parsed copies
//   const l1 = checkRedemption(build, chain, expect);             // chain = the /v1 copies of the boxes
//   if (!l1.ok) → show l1.rule / l1.message; nothing is signed
//   const signed = signRedemption(l1, secret);                    // ProveDlog, self-verified, spliced, re-checked
//   const body = redemptionSubmitBody(l1, signed);                // POST /redemption/submit
import { bytesToHex, equalBytes, hexToBytes } from "../../protocol/bytes";
import { decodeRegister, encodeCollByte, encodeLong, vlqDecode } from "../../protocol/registers";
import { p2pkAddress } from "./address";
import {
  FEE_PAID_BY_RECIPIENT, FEE_TREE_HEX, MIN_BOX_NANOERG, REDEEM_MAX_FEE_NANOERG, RESERVE_TREE_HEX, SUBMIT_BODY_MAX_BYTES, TRACKER_NFT, TRACKER_PK,
  p2pkTree,
} from "./constants";
import {
  asArray, asBool, asHex, asObject, asSafeInt, asString, asU64, at, jsonString, member, parseJson, rawText, replaceSpan, required, utf8Length,
  type JsonNode, type JsonObject, type Span,
} from "./json";
import { buildRequestMessage, noteMessage, signBasis, verifyBasis } from "./messages";
import { extensionValue, nodeTxFromJson, register, unsignedTxFromJson, type BoxCandidate, type ErgoBox, type Hex, type NodeTx, type Token, type UnsignedTx } from "./model";
import { proveDlog, publicKeyOf, verifyDlog, type ProveOptions } from "./provedlog";
import { boxIdHolds, bytesToSign, computeTxId, isNodeExtensionOrder, outputBoxes, scalaHashMapOrder, serializeBox, unsignedOf } from "./serialize";

// ─── tracker envelopes ──────────────────────────────────────────────────────────────────────────

/** The tracker said no (`success: false`), with its reason cut to 300 characters (show it as plain text). */
export class TrackerRefusal extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "TrackerRefusal";
  }
}

/** `{success, data, error}` → the `data` node. */
export function envelopeData(text: string): { root: JsonNode; data: JsonNode } {
  const root = asObject(parseJson(text), "answer");
  const success = asBool(required(root, "success", "answer"), "answer.success");
  const data = member(root, "data");
  if (!success || !data || data.kind === "null") {
    const err = member(root, "error");
    const reason = err && err.kind === "string" ? err.value : "the tracker refused without a reason";
    throw new TrackerRefusal(reason.slice(0, 300));
  }
  return { root, data };
}

// ─── the build ──────────────────────────────────────────────────────────────────────────────────

export interface RedemptionBuild {
  /** The answer text exactly as received. */
  text: string;
  /** `data.unsigned_tx` and `data.partial_tx` exactly as they stand in `text`: echo these, never re-stringify. */
  unsignedRaw: string;
  partialRaw: string;
  unsignedSpan: Span;
  partialSpan: Span;
  unsigned: UnsignedTx;
  partial: NodeTx;
  inputBoxBinaries: Hex[];
  dataBoxBinaries: Hex[];
  /** Only the count: the headers matter for full validation (D2-iii), not for L1. */
  headerCount: number;
  reserveBoxId: Hex;
  trackerBoxId: Hex;
  reserveOutputValue: bigint;
  recipientOutputValue: bigint;
  totalDebt: bigint;
  changeAmount: bigint;
  changeAddress: string;
  recipientAddress: string;
  isFirstRedemption: boolean;
  fee: bigint;
  newAlreadyRedeemed: bigint;
  feePaidBy: string;
}

/** Reads a `POST /redemption/build` answer. Throws TrackerRefusal, JsonSyntaxError or ShapeError. */
export function parseBuildResponse(text: string): RedemptionBuild {
  const { data } = envelopeData(text);
  const d = asObject(data, "data");
  const p = "data";
  const unsignedNode = required(d, "unsigned_tx", p);
  const partialNode = required(d, "partial_tx", p);
  const hexList = (key: string) => asArray(required(d, key, p), `${p}.${key}`).items.map((n, i) => asHex(n, `${p}.${key}[${i}]`));
  return {
    text,
    unsignedRaw: rawText(text, unsignedNode),
    partialRaw: rawText(text, partialNode),
    unsignedSpan: { start: unsignedNode.start, end: unsignedNode.end },
    partialSpan: { start: partialNode.start, end: partialNode.end },
    unsigned: unsignedTxFromJson(unsignedNode, `${p}.unsigned_tx`),
    partial: nodeTxFromJson(partialNode, `${p}.partial_tx`),
    inputBoxBinaries: hexList("input_box_binaries"),
    dataBoxBinaries: hexList("data_box_binaries"),
    headerCount: asArray(member(d, "headers") ?? { kind: "array", items: [], start: 0, end: 0 }, `${p}.headers`).items.length,
    reserveBoxId: asHex(required(d, "reserve_box_id", p), `${p}.reserve_box_id`, 32),
    trackerBoxId: asHex(required(d, "tracker_box_id", p), `${p}.tracker_box_id`, 32),
    reserveOutputValue: asU64(required(d, "reserve_output_value", p), `${p}.reserve_output_value`),
    recipientOutputValue: asU64(required(d, "recipient_output_value", p), `${p}.recipient_output_value`),
    totalDebt: asU64(required(d, "total_debt", p), `${p}.total_debt`),
    changeAmount: asU64(required(d, "change_amount", p), `${p}.change_amount`),
    changeAddress: asString(required(d, "change_address", p), `${p}.change_address`),
    recipientAddress: asString(required(d, "recipient_address", p), `${p}.recipient_address`),
    isFirstRedemption: asBool(required(d, "is_first_redemption", p), `${p}.is_first_redemption`),
    fee: asU64(required(d, "fee", p), `${p}.fee`),
    newAlreadyRedeemed: member(d, "new_already_redeemed") === undefined ? 0n : asU64(member(d, "new_already_redeemed"), `${p}.new_already_redeemed`),
    feePaidBy: member(d, "fee_paid_by") === undefined ? "" : asString(member(d, "fee_paid_by"), `${p}.fee_paid_by`),
  };
}

// ─── L1 ─────────────────────────────────────────────────────────────────────────────────────────

/** What the redemption must be. */
export interface RedemptionExpectation {
  issuer: Hex;
  recipient: Hex;
  /** What the reserve gives; the payout is amount − fee. */
  amount: bigint;
  /** The note's committed total (confirmation.confirmed_total_debt == amount_collected). */
  totalDebt: bigint;
  /** The note's timestamp, ms. */
  timestamp: bigint;
  /** The stored note's issuer signature (65 bytes hex): context var #2. */
  issuerSignature: Hex;
  /** Defaults: our tracker (TRACKER_NFT, TRACKER_PK) and REDEEM_MAX_FEE_NANOERG. */
  trackerNft?: Hex;
  trackerPk?: Hex;
  maxFee?: bigint;
  /** When given (from /tracker/state): the build must read exactly this tracker box. */
  currentTrackerBoxId?: Hex;
  /** When given (/v1/info height): every output is created within tipHeight − 15 … tipHeight + 2. */
  tipHeight?: number;
}

/** The /v1 copies of the boxes the transaction names, in its order. */
export interface ChainBoxes {
  inputs: ErgoBox[];
  dataInputs: ErgoBox[];
}

export type L1Rule =
  | "fee-paid-by"
  | "fee-limit"
  | "payout"
  | "box-ids"
  | "box-binaries"
  | "tracker-key"
  | "tracker-box"
  | "reserve-input"
  | "extension-order"
  | "extension-keys"
  | "extension-values"
  | "tracker-signature"
  | "outputs"
  | "reserve-output"
  | "payout-output"
  | "fee-output"
  | "creation-height"
  | "totals"
  | "ids"
  /** Something in the build or the expectation could not be read at all (a value out of range, bad hex, …). */
  | "malformed";

declare const checkedBrand: unique symbol;

/** A build that passed L1. Only `checkRedemption` makes one; only this can be signed. */
export interface CheckedRedemption {
  readonly ok: true;
  readonly [checkedBrand]: true;
  readonly build: RedemptionBuild;
  readonly expect: Readonly<Required<Pick<RedemptionExpectation, "issuer" | "recipient" | "amount" | "totalDebt" | "timestamp" | "issuerSignature" | "trackerNft" | "trackerPk" | "maxFee">>>;
  readonly txId: Hex;
  readonly bytesToSign: Uint8Array;
  /** Index of the payout output (always 1). */
  readonly payoutIndex: 1;
  readonly payout: bigint;
  readonly fee: bigint;
  /** The reserve's own NFT (token 0 of input 0 and output 0). */
  readonly reserveNft: Hex;
  /** The reserve box after the redemption, with its id (once the transaction is in a block). */
  readonly reserveAfter: ErgoBox;
  readonly payoutBox: ErgoBox;
}

export interface L1Failure {
  readonly ok: false;
  readonly rule: L1Rule;
  readonly message: string;
}

export type L1Result = CheckedRedemption | L1Failure;

class Refused extends Error {
  constructor(readonly rule: L1Rule, message: string) {
    super(message);
  }
}

function refuse(rule: L1Rule, message: string): never {
  throw new Refused(rule, message);
}

const KEY_RE = /^0[23][0-9a-f]{64}$/;

function longOrZero(hex: Hex | null, what: string): bigint {
  if (hex === null) return 0n;
  const d = decodeRegister(hex);
  if (d.type !== "Long" || encodeLong(d.value) !== hex) refuse("reserve-output", `${what} is not a canonical Long`);
  return (d as { value: bigint }).value;
}

/** A Coll[Byte] constant exactly: 0e ‖ VLQ(len) ‖ len bytes, nothing after. Returns the bytes. */
function collBytes(hex: Hex | null, what: string): Uint8Array {
  if (hex === null) return refuse("extension-keys", `${what} is missing`);
  const b = hexToBytes(hex);
  if (b[0] !== 0x0e) refuse("extension-values", `${what} is not a Coll[Byte]`);
  let len: bigint, next: number;
  try {
    ({ value: len, next } = vlqDecode(b, 1));
  } catch {
    return refuse("extension-values", `${what} is not a Coll[Byte]`);
  }
  if (BigInt(b.length - next) !== len || encodeCollByte(b.subarray(next)) !== hex) refuse("extension-values", `${what} is not exactly one Coll[Byte]`);
  return b.subarray(next);
}

function tokenTotals(lists: Token[][]): Map<Hex, bigint> {
  const m = new Map<Hex, bigint>();
  for (const l of lists) for (const t of l) m.set(t.tokenId, (m.get(t.tokenId) ?? 0n) + t.amount);
  return m;
}

function sameTokens(a: Token[], b: Token[]): boolean {
  return a.length === b.length && a.every((t, i) => t.tokenId === b[i].tokenId && t.amount === b[i].amount);
}

/** Is R5 an AvlTree with flags 03 (insert + update), 32-byte keys and no fixed value length? */
function isReserveTree(r5: Hex | null): boolean {
  if (r5 === null) return false;
  try {
    const d = decodeRegister(r5);
    return d.type === "AvlTree" && d.flags === 0x03 && d.keyLength === 32 && d.valueLength === null && r5.length === 2 * 37;
  } catch {
    return false;
  }
}

/**
 * L1: everything that must hold before the receiver key proves the reserve input (design §3.3), in the canary's
 * order. A failure names its rule; nothing may be signed then.
 */
export function checkRedemption(build: RedemptionBuild, chain: ChainBoxes, expectation: RedemptionExpectation): L1Result {
  try {
    return check(build, chain, expectation);
  } catch (e) {
    if (e instanceof Refused) return { ok: false, rule: e.rule, message: e.message };
    return { ok: false, rule: "malformed", message: `the build or the expectation could not be read: ${(e as Error).message}` };
  }
}

function check(build: RedemptionBuild, chain: ChainBoxes, x: RedemptionExpectation): CheckedRedemption {
  const expect = {
    issuer: x.issuer,
    recipient: x.recipient,
    amount: x.amount,
    totalDebt: x.totalDebt,
    timestamp: x.timestamp,
    issuerSignature: x.issuerSignature.toLowerCase(),
    trackerNft: x.trackerNft ?? TRACKER_NFT,
    trackerPk: x.trackerPk ?? TRACKER_PK,
    maxFee: x.maxFee ?? REDEEM_MAX_FEE_NANOERG,
  };
  if (!KEY_RE.test(expect.issuer) || !KEY_RE.test(expect.recipient) || !KEY_RE.test(expect.trackerPk)) refuse("tracker-key", "a key of the expectation is not a compressed key in lowercase hex");
  if (expect.issuer === expect.recipient) refuse("tracker-key", "the issuer is the recipient");
  if (!/^[0-9a-f]{130}$/.test(expect.issuerSignature)) refuse("extension-values", "the note's issuer signature is not 65 bytes");
  const unsigned = build.unsigned;

  // 1. Who pays the fee, and how much.
  if (build.feePaidBy !== FEE_PAID_BY_RECIPIENT) refuse("fee-paid-by", `the build says the miner fee is paid by ${JSON.stringify(build.feePaidBy)}; an ERG redemption takes it from the payout ("recipient"), the only layout we sign`);
  if (build.fee > expect.maxFee) refuse("fee-limit", `the miner fee ${build.fee} nanoERG is above the limit ${expect.maxFee} nanoERG; it comes out of the payout`);
  if (expect.amount <= 0n) refuse("payout", "the amount must be above 0");
  const payout = expect.amount - build.fee;
  if (payout <= 0n) refuse("payout", "the miner fee is not below the amount");
  if (payout < MIN_BOX_NANOERG) refuse("payout", `the payout ${payout} nanoERG is below ${MIN_BOX_NANOERG} nanoERG`);
  if (build.recipientAddress !== p2pkAddress(expect.recipient)) refuse("payout", `the build reports the payout to ${build.recipientAddress.slice(0, 12)}…, not to the recipient's P2PK address`);
  if (build.recipientOutputValue !== payout || build.changeAmount !== 0n || build.changeAddress !== "") {
    refuse("payout", `the build reports a payout of ${build.recipientOutputValue} nanoERG and change ${build.changeAmount} to ${JSON.stringify(build.changeAddress)}; expected ${payout} (the amount ${expect.amount} minus the fee ${build.fee}) and no change`);
  }

  // 2. The boxes: the /v1 copies are the ones the transaction names, each hashes to its id, and the tracker's binaries
  //    are byte for byte the same boxes.
  const inputIds = unsigned.inputs.map((i) => i.boxId);
  const haveIn = chain.inputs.map((b) => b.boxId);
  const haveData = chain.dataInputs.map((b) => b.boxId);
  if (inputIds.join() !== haveIn.join()) refuse("box-ids", `the transaction spends ${inputIds.join(", ")}, the boxes read from the chain are ${haveIn.join(", ")}`);
  if (unsigned.dataInputs.join() !== haveData.join()) refuse("box-ids", `the transaction reads ${unsigned.dataInputs.join(", ")}, the data boxes read from the chain are ${haveData.join(", ")}`);
  for (const b of [...chain.inputs, ...chain.dataInputs]) if (!boxIdHolds(b)) refuse("box-ids", `the chain copy of box ${b.boxId} does not hash to its id`);
  const binaries = (sent: Hex[], boxes: ErgoBox[], what: string) => {
    if (sent.length !== boxes.length) refuse("box-binaries", `the build sent ${sent.length} ${what} boxes for ${boxes.length} ${what}s`);
    boxes.forEach((b, i) => {
      if (sent[i] !== bytesToHex(serializeBox(b))) refuse("box-binaries", `the build's ${what} box ${i} is not the chain's box ${b.boxId}`);
    });
  };
  binaries(build.inputBoxBinaries, chain.inputs, "input");
  binaries(build.dataBoxBinaries, chain.dataInputs, "data input");
  if (expect.trackerPk === expect.recipient) refuse("tracker-key", "the tracker key is the recipient key");

  // 3. The tracker box: the only data input.
  if (chain.dataInputs.length !== 1) refuse("tracker-box", `${chain.dataInputs.length} data inputs; a redemption reads only the tracker box`);
  const trackerBox = chain.dataInputs[0];
  if (trackerBox.boxId !== build.trackerBoxId) refuse("tracker-box", "data input 0 is not the build's tracker box");
  if (x.currentTrackerBoxId !== undefined && trackerBox.boxId !== x.currentTrackerBoxId.toLowerCase()) refuse("tracker-box", `the build reads tracker box ${trackerBox.boxId}, the current one is ${x.currentTrackerBoxId}`);
  const t0 = trackerBox.tokens[0];
  if (!t0 || t0.tokenId !== expect.trackerNft || t0.amount !== 1n) refuse("tracker-box", "data input 0 does not hold the tracker NFT as token 0");
  if (register(trackerBox, "R4") !== `07${expect.trackerPk}`) refuse("tracker-box", `the tracker box R4 is not the key ${expect.trackerPk} that signed the redemption`);

  // 4. The only input: the issuer's reserve under the pinned contract, bound to our tracker.
  if (chain.inputs.length !== 1) refuse("reserve-input", `the transaction spends ${chain.inputs.length} inputs; an ERG redemption spends only the reserve`);
  const reserve = chain.inputs[0];
  if (reserve.boxId !== build.reserveBoxId) refuse("reserve-input", "input 0 is not the build's reserve box");
  if (reserve.ergoTree !== RESERVE_TREE_HEX) refuse("reserve-input", "input 0 is not under the pinned ERG reserve contract");
  if (register(reserve, "R4") !== `07${expect.issuer}`) refuse("reserve-input", "the reserve is not owned by the issuer (R4)");
  const nftReg = `0e20${expect.trackerNft}`;
  if (register(reserve, "R6") !== nftReg) refuse("reserve-input", "the reserve is not bound to our tracker NFT (R6)");
  if (reserve.tokens.length !== 1 || reserve.tokens[0].amount !== 1n) refuse("reserve-input", "the reserve does not hold exactly its NFT");
  const reserveNft = reserve.tokens[0].tokenId;

  // 5. The reserve input's context extension: Scala's order, the expected keys, the note's values.
  const ext = unsigned.inputs[0].extension;
  const keys = ext.map((e) => e.key);
  const sorted = [...keys].sort((a, b) => a - b);
  const scala = scalaHashMapOrder(sorted);
  if (keys.join() !== scala.join()) refuse("extension-order", `the reserve input's context extension is in order ${keys.join(",")}, not Scala's ${scala.join(",")}; the node would compute another transaction id`);
  const partialKeys = build.partial.inputs[0]?.extension.map((e) => e.key) ?? [];
  if (partialKeys.join() !== keys.join()) refuse("extension-order", `partial_tx lists the reserve extension as ${partialKeys.join(",")}, unsigned_tx as ${keys.join(",")}`);
  const expectedKeys = build.isFirstRedemption ? [0, 1, 2, 3, 4, 5, 6, 8] : [0, 1, 2, 3, 4, 5, 6, 7, 8];
  if (sorted.join() !== expectedKeys.join()) refuse("extension-keys", `the reserve input's context variables are ${sorted.join(",")}, expected ${expectedKeys.join(",")} (#7 only once the reserve tree holds this note)`);
  const v = (k: number) => extensionValue(unsigned.inputs[0], k);
  if (v(0) !== "0200") refuse("extension-values", "context var #0 is not 0 (redeem into output 0)");
  if (v(1) !== `07${expect.recipient}`) refuse("extension-values", "context var #1 is not the recipient key");
  if (v(2) !== encodeCollByte(expect.issuerSignature)) refuse("extension-values", "context var #2 is not the note's issuer signature");
  if (build.totalDebt !== expect.totalDebt || v(3) !== encodeLong(expect.totalDebt)) refuse("extension-values", `the build redeems against total debt ${build.totalDebt}, the note's committed total is ${expect.totalDebt}`);
  if (v(4) !== encodeLong(expect.timestamp)) refuse("extension-values", "context var #4 is not the note timestamp");
  collBytes(v(5), "context var #5");
  collBytes(v(8), "context var #8");
  if (!build.isFirstRedemption) collBytes(v(7), "context var #7");
  const trackerSig = collBytes(v(6), "context var #6");
  if (trackerSig.length !== 65) refuse("tracker-signature", "context var #6 is not a 65-byte signature");
  const message = noteMessage({ issuer: expect.issuer, recipient: expect.recipient, totalDebt: expect.totalDebt, timestamp: expect.timestamp, trackerNft: expect.trackerNft });
  if (!verifyBasis(expect.trackerPk, message, trackerSig)) refuse("tracker-signature", "context var #6 is not the tracker's signature over the note message");

  // 6. Outputs: the reserve, the payout, the miner fee.
  const outs = unsigned.outputs;
  if (outs.length !== 3) refuse("outputs", `${outs.length} outputs; an ERG redemption has exactly three: the reserve, the payout and the miner fee`);
  const [reserveOut, payoutOut, feeOut] = outs as [BoxCandidate, BoxCandidate, BoxCandidate];
  const reserveLeft = reserve.value - expect.amount;
  if (reserveLeft < MIN_BOX_NANOERG) refuse("reserve-output", `the reserve holds ${reserve.value} nanoERG; after ${expect.amount} it would keep less than ${MIN_BOX_NANOERG}`);
  if (
    reserveOut.ergoTree !== RESERVE_TREE_HEX ||
    reserveOut.value !== reserveLeft ||
    !sameTokens(reserveOut.tokens, reserve.tokens) ||
    register(reserveOut, "R4") !== register(reserve, "R4") ||
    register(reserveOut, "R6") !== nftReg ||
    !isReserveTree(register(reserveOut, "R5")) ||
    reserveOut.registers.length !== 4
  ) {
    refuse("reserve-output", `output 0 does not keep the reserve minus ${expect.amount} nanoERG (script, tokens, R4, R5, R6, R7 and nothing else)`);
  }
  if (longOrZero(register(reserveOut, "R7"), "output 0 R7") !== longOrZero(register(reserve, "R7"), "the reserve's R7")) refuse("reserve-output", "output 0 changes the reserve's refund height (R7)");
  if (payoutOut.ergoTree !== p2pkTree(expect.recipient)) refuse("payout-output", "output 1 goes to an unexpected script, not P2PK(recipient)");
  if (payoutOut.value !== payout || payoutOut.tokens.length !== 0 || payoutOut.registers.length !== 0) {
    refuse("payout-output", `output 1 pays ${payoutOut.value} nanoERG to the recipient; expected ${payout} (the amount ${expect.amount} minus the miner fee ${build.fee}), no token and no register`);
  }
  if (feeOut.ergoTree !== FEE_TREE_HEX || feeOut.value !== build.fee || feeOut.tokens.length !== 0 || feeOut.registers.length !== 0) refuse("fee-output", `output 2 is not the token-free miner fee of ${build.fee} nanoERG`);

  // Creation heights: never below an input (the node's rule) and, when the tip is known, near it.
  const floor = Math.max(...chain.inputs.map((b) => b.creationHeight));
  for (const [i, o] of outs.entries()) {
    if (o.creationHeight < floor) refuse("creation-height", `output ${i} is created at ${o.creationHeight}, below its input (${floor})`);
    if (x.tipHeight !== undefined && (o.creationHeight < x.tipHeight - 15 || o.creationHeight > x.tipHeight + 2)) refuse("creation-height", `output ${i} is created at ${o.creationHeight}, far from the tip ${x.tipHeight}`);
  }

  // 7. Totals: ERG in = ERG out, no token minted or burned, the reserve NFT only first in output 0.
  const ergIn = chain.inputs.reduce((s, b) => s + b.value, 0n);
  const ergOut = outs.reduce((s, o) => s + o.value, 0n);
  if (ergIn !== ergOut) refuse("totals", `ERG not preserved: inputs ${ergIn} nanoERG, outputs ${ergOut} nanoERG`);
  const tin = tokenTotals(chain.inputs.map((b) => b.tokens));
  const tout = tokenTotals(outs.map((o) => o.tokens));
  if (tin.size !== tout.size || [...tin].some(([id, amt]) => tout.get(id) !== amt)) refuse("totals", "a token would be minted, burned or changed");
  const places = outs.flatMap((o, i) => o.tokens.map((t, j) => ({ i, j, t }))).filter((p) => p.t.tokenId === reserveNft);
  if (places.length !== 1 || places[0].i !== 0 || places[0].j !== 0 || places[0].t.amount !== 1n) refuse("totals", "the reserve NFT must appear once, first in output 0, with amount 1");

  // 8. Ids: partial_tx is this transaction with one empty proof; we sign blake2b256 of exactly these bytes.
  if (!isNodeExtensionOrder(ext)) refuse("extension-order", "the extension is not in the node's order");
  const toSign = bytesToSign(unsigned);
  const txId = computeTxId(unsigned);
  const partial = build.partial;
  if (partial.inputs.length !== 1) refuse("ids", `the build's partial transaction has ${partial.inputs.length} inputs`);
  if (partial.inputs[0].proof !== "") refuse("ids", "the build already holds a proof for the reserve input");
  if (!equalBytes(bytesToSign(unsignedOf(partial)), toSign)) refuse("ids", "the build's partial transaction is not its unsigned transaction");
  if (partial.id !== txId) refuse("ids", `partial_tx names id ${partial.id}, the transaction's id is ${txId}`);
  const boxes = outputBoxes(unsigned, txId);
  partial.outputBoxIds.forEach((id, i) => {
    if (id !== null && id !== boxes[i].boxId) refuse("ids", `partial_tx output ${i} names box ${id}, it is ${boxes[i].boxId}`);
  });

  return {
    ok: true,
    build,
    expect,
    txId,
    bytesToSign: toSign,
    payoutIndex: 1,
    payout,
    fee: build.fee,
    reserveNft,
    reserveAfter: boxes[0],
    payoutBox: boxes[1],
  } as unknown as CheckedRedemption;
}

// ─── signing and submit ─────────────────────────────────────────────────────────────────────────

export interface SignedRedemption {
  txId: Hex;
  /** The 56-byte proof, hex. */
  proof: Hex;
  /** `partial_tx` exactly as received, with only `inputs[0].spendingProof.proofBytes` filled. */
  signedRaw: string;
}

/**
 * Splices a 56-byte proof of the reserve input into the tracker's partial_tx text and re-reads the result: the proof
 * verifies under the recipient over the bytes L1 checked, the slot was `""`, only that slot changed, the id is the same.
 * `signRedemption` uses it; the tests feed it the on-chain proof of R3 to rebuild the chain's exact transaction.
 */
export function spliceRedemptionProof(checked: CheckedRedemption, proof: Uint8Array): SignedRedemption {
  if (!(checked as { ok?: unknown }).ok || !checked.bytesToSign) throw new Error("only a build that passed L1 can be signed");
  const pk = hexToBytes(checked.expect.recipient);
  if (!verifyDlog(pk, checked.bytesToSign, proof)) throw new Error("the proof does not verify under the recipient key over this transaction");
  const proofHex = bytesToHex(proof);

  const raw = checked.build.partialRaw;
  const slot = at(parseJson(raw), "inputs", 0, "spendingProof", "proofBytes");
  if (!slot || slot.kind !== "string" || slot.value !== "" || rawText(raw, slot) !== '""') throw new Error("partial_tx has no empty proof slot at inputs[0].spendingProof.proofBytes");
  const signedRaw = replaceSpan(raw, slot, jsonString(proofHex));

  const back = nodeTxFromJson(parseJson(signedRaw), "signed_tx");
  if (!equalBytes(bytesToSign(unsignedOf(back)), checked.bytesToSign)) throw new Error("the spliced transaction signs other bytes");
  if (back.id !== checked.txId || computeTxId(unsignedOf(back)) !== checked.txId) throw new Error("the spliced transaction has another id");
  if (back.inputs.length !== 1 || back.inputs[0].proof !== proofHex || !verifyDlog(pk, checked.bytesToSign, hexToBytes(back.inputs[0].proof))) throw new Error("the spliced proof does not verify");
  if (signedRaw.length !== raw.length + proofHex.length || signedRaw.slice(0, slot.start) !== raw.slice(0, slot.start) || signedRaw.slice(slot.start + proofHex.length + 2) !== raw.slice(slot.end)) throw new Error("the splice changed more than the proof");
  return { txId: checked.txId, proof: proofHex, signedRaw };
}

/**
 * Proves the reserve input with the receiver's secret (ProveDlog over bytesToSign, hedged nonce, self-verified) and
 * splices the proof into the tracker's partial_tx text (`spliceRedemptionProof`).
 */
export function signRedemption(checked: CheckedRedemption, secret: Uint8Array, opts: ProveOptions = {}): SignedRedemption {
  if (!(checked as { ok?: unknown }).ok || !checked.bytesToSign) throw new Error("only a build that passed L1 can be signed");
  if (bytesToHex(publicKeyOf(secret)) !== checked.expect.recipient) throw new Error("this key is not the note's recipient");
  return spliceRedemptionProof(checked, proveDlog(checked.bytesToSign, secret, opts));
}

/**
 * The `POST /redemption/submit` body. `unsigned_tx` is the build's own text (its SHA-256 names the pending build);
 * the four deprecated fields carry the build's values. Throws above the front's 64 KB cap.
 */
export function redemptionSubmitBody(checked: CheckedRedemption, signed: SignedRedemption): string {
  if (signed.txId !== checked.txId) throw new Error("the signed transaction is not this build");
  const e = checked.expect;
  const body =
    `{"signed_tx":${signed.signedRaw},"unsigned_tx":${checked.build.unsignedRaw},` +
    `"issuer_pubkey":${jsonString(e.issuer)},"recipient_pubkey":${jsonString(e.recipient)},` +
    `"redeemed_amount":${e.amount},"new_already_redeemed":${checked.build.newAlreadyRedeemed}}`;
  if (utf8Length(body) > SUBMIT_BODY_MAX_BYTES) throw new Error(`the submit body is ${utf8Length(body)} bytes, above the front's ${SUBMIT_BODY_MAX_BYTES}`);
  return body;
}

/** `POST /redemption/submit` answer → the tracker's tx id (compare it with ours; the canary warns on a mismatch). */
export function parseSubmitResponse(text: string): { txId: Hex } {
  const { data } = envelopeData(text);
  return { txId: asHex(required(asObject(data, "data"), "tx_id", "data"), "data.tx_id", 32) };
}

// ─── the build request (the receiver asks) ──────────────────────────────────────────────────────

export interface BuildRequestInput {
  issuer: Hex;
  recipient: Hex;
  amount: bigint;
  /** The stored note's signature: the tracker builds with it as #2. */
  issuerSignature: Hex;
  /** ms; within ±120 s of the tracker's clock and above this receiver's previous request. */
  requestTimestamp: bigint;
  trackerNft?: Hex;
}

export interface SignedBuildRequest {
  body: string;
  message: Uint8Array;
  signature: Hex;
}

/** The receiver's signed `POST /redemption/build` body (the canary's `signed_build_request`). */
export function signedBuildRequest(secret: Uint8Array, r: BuildRequestInput): SignedBuildRequest {
  if (!/^[0-9a-f]{130}$/.test(r.issuerSignature)) throw new Error("the issuer signature must be 65 bytes of lowercase hex");
  if (r.amount <= 0n) throw new Error("the amount must be above 0");
  const message = buildRequestMessage({ trackerNft: r.trackerNft ?? TRACKER_NFT, issuer: r.issuer, recipient: r.recipient, amount: r.amount, requestTimestamp: r.requestTimestamp });
  const signature = bytesToHex(signBasis(message, secret, r.recipient));
  const body =
    `{"issuer_pubkey":${jsonString(r.issuer)},"recipient_pubkey":${jsonString(r.recipient)},"amount":${r.amount},` +
    `"issuer_signature":${jsonString(r.issuerSignature)},"emergency":false,"denomination":"erg",` +
    `"request_timestamp":${r.requestTimestamp},"receiver_signature":${jsonString(signature)}}`;
  return { body, message, signature };
}

// ─── the note (step 1: before any build) ────────────────────────────────────────────────────────

export interface StoredNote {
  issuer: Hex;
  recipient: Hex;
  amountCollected: bigint;
  amountRedeemed: bigint;
  timestamp: bigint;
  signature: Hex;
  trackerNft: Hex;
  denomination: string;
  confirmation: {
    status: string;
    confirmedTotalDebt: bigint | null;
    redeemable: boolean;
    redeemableAmount: bigint;
    confirmedBoxId: Hex | null;
    confirmedHeight: number | null;
  } | null;
}

function optU64(o: JsonObject, key: string, path: string): bigint | null {
  const n = member(o, key);
  return n === undefined || n.kind === "null" ? null : asU64(n, `${path}.${key}`);
}

/** `GET /notes/issuer/{i}/recipient/{r}` answer. */
export function parseStoredNote(text: string): StoredNote {
  const { data } = envelopeData(text);
  const d = asObject(data, "data");
  const p = "data";
  const c = member(d, "confirmation");
  let confirmation: StoredNote["confirmation"] = null;
  if (c && c.kind === "object") {
    const box = member(c, "confirmed_box_id");
    const h = member(c, "confirmed_height");
    const redeemable = member(c, "redeemable");
    confirmation = {
      status: asString(required(c, "status", `${p}.confirmation`), `${p}.confirmation.status`),
      confirmedTotalDebt: optU64(c, "confirmed_total_debt", `${p}.confirmation`),
      redeemable: redeemable !== undefined && redeemable.kind === "bool" ? redeemable.value : false,
      redeemableAmount: optU64(c, "redeemable_amount", `${p}.confirmation`) ?? 0n,
      confirmedBoxId: box === undefined || box.kind === "null" ? null : asHex(box, `${p}.confirmation.confirmed_box_id`, 32),
      confirmedHeight: h === undefined || h.kind === "null" ? null : asSafeInt(h, `${p}.confirmation.confirmed_height`),
    };
  }
  return {
    issuer: asHex(required(d, "issuer_pubkey", p), `${p}.issuer_pubkey`, 33),
    recipient: asHex(required(d, "recipient_pubkey", p), `${p}.recipient_pubkey`, 33),
    amountCollected: asU64(required(d, "amount_collected", p), `${p}.amount_collected`),
    amountRedeemed: asU64(required(d, "amount_redeemed", p), `${p}.amount_redeemed`),
    timestamp: asU64(required(d, "timestamp", p), `${p}.timestamp`),
    signature: asHex(required(d, "signature", p), `${p}.signature`, 65),
    trackerNft: asHex(required(d, "tracker_nft_id", p), `${p}.tracker_nft_id`, 32),
    denomination: asString(required(d, "denomination", p), `${p}.denomination`),
    confirmation,
  };
}

export type NoteRule = "note-pair" | "note-denomination" | "note-tracker" | "note-committed" | "note-redeemable" | "note-signature";

/**
 * Design §3.2 step 1: the note is ERG, bound to our tracker, committed at its current total, covers `amount`, and its
 * stored signature is the issuer's over the 80-byte message. Gives the expectation L1 needs.
 */
export function checkNoteForRedemption(
  note: StoredNote,
  want: { issuer: Hex; recipient: Hex; amount: bigint; trackerNft?: Hex },
): { ok: true; expect: RedemptionExpectation } | { ok: false; rule: NoteRule; message: string } {
  const nft = want.trackerNft ?? TRACKER_NFT;
  if (note.issuer !== want.issuer || note.recipient !== want.recipient) return { ok: false, rule: "note-pair", message: "the tracker answered for another pair of keys" };
  if (note.denomination !== "erg") return { ok: false, rule: "note-denomination", message: `the note is in ${note.denomination}, not ERG` };
  if (note.trackerNft !== nft) return { ok: false, rule: "note-tracker", message: `the note is bound to tracker NFT ${note.trackerNft}` };
  const committed = note.confirmation?.confirmedTotalDebt ?? null;
  if (committed !== note.amountCollected) return { ok: false, rule: "note-committed", message: `the note's total ${note.amountCollected} is not committed on chain yet (committed: ${committed ?? "none"})` };
  const redeemable = note.confirmation?.redeemableAmount ?? 0n;
  if (want.amount <= 0n || want.amount > redeemable) return { ok: false, rule: "note-redeemable", message: `the amount ${want.amount} is above what is redeemable now: ${redeemable} nanoERG` };
  const message = noteMessage({ issuer: note.issuer, recipient: note.recipient, totalDebt: note.amountCollected, timestamp: note.timestamp, trackerNft: nft });
  if (!verifyBasis(note.issuer, message, note.signature)) return { ok: false, rule: "note-signature", message: `the stored note signature does not cover total ${note.amountCollected} at timestamp ${note.timestamp}` };
  return {
    ok: true,
    expect: { issuer: note.issuer, recipient: note.recipient, amount: want.amount, totalDebt: note.amountCollected, timestamp: note.timestamp, issuerSignature: note.signature, trackerNft: nft },
  };
}


