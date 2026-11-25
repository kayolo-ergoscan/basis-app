// When the vault asks for the passphrase again (design §4.2; keys review P1-2; operator decision 2, 22 Nov 2026). The
// vault enforces it itself, so no screen can sign around it:
//   • t1 (a reserve creation moves the whole reserve) and export-hex: always;
//   • withdraw: whenever the transaction pays anything but this key's own address and at most the wallet's miner fee
//     (combining small boxes, or cancelling a stuck transaction, back to the key itself needs none);
//   • note: when the notes signed since the last passphrase entry, this one included, promise more than 25 % of the
//     reserve's value read on chain (/v1, never the tracker's figure). A note promises its increment: the new total
//     minus the pair's previous total, which must be a note of this key (its signature is checked here);
//   • redeem and build-request: never (a redemption pays only this key: its signed outputs are checked, below, and it
//     must be a redemption: one input, action 0, another key's reserve);
//   • topup, refund-start, refund-end (the reserve's own actions): always, and the signed outputs must be exactly the
//     action's layout (reserveActionPaysRight, below): a top-up can send money to another key's reserve for good.
// Token reserves: a note's budget is counted per denomination, in its own raw units, against the key's own reserve
// of that denomination (amounts in different units are never added up); the guards below accept the token layouts
// (basis-token.es) with the same rules.
// "Since the last passphrase entry" = since the session opened (an unlock is a passphrase entry) or since the last use
// of the key with the passphrase typed again. The count lives in the session only.
import { FEE_TREE_HEX, MINER_FEE_NANOERG, REDEEM_MAX_FEE_NANOERG, RESERVE_TREE_HEX, TRACKER_NFT, TRACKER_PK } from "../tx/constants";
import { TOKEN_REDEEM_MAX_FEE_NANOERG, TOKEN_RESERVE_TREE_HEX, reserveTokenOf } from "../tx/tokens";
import { asArray, asObject, asString, asU64, member, parseJson, type JsonObject } from "../tx/json";
import { boxIdHolds } from "../tx/serialize";
import type { ErgoBox } from "../tx/model";
import { noteMessage, verifyBasis, type Denomination } from "../tx/messages";
import { VaultError } from "./errors";
import { isObject } from "./record";
import type { Hex } from "./keys";

/** More than 1/4 of the reserve needs the passphrase. */
export const NOTE_PASSPHRASE_DIVISOR = 4n;

/** What a note to sign promises, declared before the key is touched (checked against the signed body afterwards). */
export interface NoteIntent {
  recipient: Hex;
  /** The new cumulative total, nanoERG. */
  total: bigint;
  /** The issuer's reserve value read on chain (/v1), nanoERG; 0 when none is known (then the passphrase is asked). */
  reserveValue: bigint;
  /** The pair's previous note as the tracker stores it, signed by this key; null for the pair's first note. */
  prev: { total: bigint; timestamp: bigint; signature: Hex } | null;
  /** "erg" (default) or "token:<id>": `total` and `reserveValue` are then raw units of that token (the key's own
   *  reserve of that token on chain). */
  denomination?: Denomination;
}

/** The session's promise key of a pair: the recipient for ERG (as before), "token:<id>|recipient" for a token. */
export const promiseKey = (recipient: Hex, denomination: Denomination = "erg"): string => (denomination === "erg" ? recipient : `${denomination}|${recipient}`);
const denomOfKey = (k: string): string => (k.includes("|") ? k.slice(0, k.indexOf("|")) : "erg");

/** One pair's notes since the last passphrase entry: its total before the first of them, and the highest signed. */
export interface PairPromise { base: bigint; top: bigint }

export interface NotePolicy {
  /** What this note adds: total − previous total. */
  added: bigint;
  /** Promised since the last passphrase entry, before this note. */
  since: bigint;
  /** … and with this note (a note signed again at the same total adds nothing). */
  after: bigint;
  reserveValue: bigint;
  /** The passphrase must be typed again for this note. */
  passphrase: boolean;
}

const PK = /^0[23][0-9a-f]{64}$/;
const SIG = /^[0-9a-f]{130}$/;
const I64_MAX = (1n << 63n) - 1n;

const bad = (message: string) => new VaultError("bad-input", message);

/** What the session promised in one denomination (never summed across denominations), less the pair `skip`. */
function sumPromised(m: ReadonlyMap<string, PairPromise>, skip?: string, denomination: string = "erg"): bigint {
  let s = 0n;
  for (const [k, p] of m) if (k !== skip && denomOfKey(k) === denomination) s += p.top - p.base;
  return s;
}

/** The pair's promise once this note is signed. */
export function nextPromise(m: ReadonlyMap<string, PairPromise>, recipient: string, prevTotal: bigint, total: bigint): PairPromise {
  const old = m.get(recipient);
  return { base: old ? (prevTotal < old.base ? prevTotal : old.base) : prevTotal, top: old && old.top > total ? old.top : total };
}

/** True when promising `after` since the last passphrase entry needs it again (> 25 % of the reserve, or no reserve). */
export const notePassphraseNeeded = (after: bigint, reserveValue: bigint): boolean => reserveValue <= 0n || after * NOTE_PASSPHRASE_DIVISOR > reserveValue;

/**
 * The rule for one note of `issuer`, given what the session promised so far. Throws "bad-input" for an intent that is not
 * a note this key can sign: a malformed key or amount, a previous note that is not this key's own, a total not above it.
 */
export function notePolicy(issuer: Hex, intent: NoteIntent, promised: ReadonlyMap<string, PairPromise>): NotePolicy {
  if (!isObject(intent)) throw bad("a note needs its intent (recipient, total, reserve value, previous note)");
  const { recipient, total, reserveValue, prev } = intent;
  const denomination = intent.denomination ?? "erg";
  if (typeof denomination !== "string" || reserveTokenOf(denomination) === undefined) throw bad("the note's denomination is not one this wallet makes");
  if (typeof recipient !== "string" || !PK.test(recipient) || recipient === issuer) throw bad("the note's recipient is not another public key");
  if (typeof total !== "bigint" || total <= 0n || total > I64_MAX) throw bad("the note's total is out of range");
  if (typeof reserveValue !== "bigint" || reserveValue < 0n) throw bad("the reserve value is out of range");
  let prevTotal = 0n;
  if (prev !== null) {
    if (!isObject(prev) || typeof prev.total !== "bigint" || typeof prev.timestamp !== "bigint" || typeof prev.signature !== "string" || !SIG.test(prev.signature)) {
      throw bad("the previous note is malformed");
    }
    let ok = false;
    try {
      ok = verifyBasis(issuer, noteMessage({ issuer, recipient, totalDebt: prev.total, timestamp: prev.timestamp, trackerNft: TRACKER_NFT, denomination }), prev.signature);
    } catch {
      ok = false;
    }
    if (!ok) throw bad("the previous note is not signed by this key");
    prevTotal = prev.total;
  }
  if (total <= prevTotal) throw bad("the new total is not above the previous note's");
  const key = promiseKey(recipient, denomination);
  const since = sumPromised(promised, undefined, denomination);
  const p = nextPromise(promised, key, prevTotal, total);
  const after = sumPromised(promised, key, denomination) + (p.top - p.base);
  return { added: total - prevTotal, since, after, reserveValue, passphrase: notePassphraseNeeded(after, reserveValue) };
}

/** The top-level object of a signed text, read with the strict parser (exact u64s, duplicate keys refused), or null. */
function strictObject(text: string): JsonObject | null {
  try {
    return asObject(parseJson(text), "signed");
  } catch {
    return null;
  }
}

/** The signed `POST /notes` body must be the declared note of this key: its top-level fields, the amount exact. */
export function checkNoteBody(signedRaw: string, issuer: Hex, intent: NoteIntent): void {
  const o = strictObject(signedRaw);
  if (!o) throw bad("the signed note is not JSON");
  let ok = false;
  try {
    ok =
      asString(member(o, "issuer_pubkey"), "issuer_pubkey") === issuer &&
      asString(member(o, "recipient_pubkey"), "recipient_pubkey") === intent.recipient &&
      asString(member(o, "denomination"), "denomination") === (intent.denomination ?? "erg") &&
      asString(member(o, "tracker_nft_id"), "tracker_nft_id") === TRACKER_NFT &&
      asU64(member(o, "amount"), "amount") === intent.total;
  } catch {
    ok = false;
  }
  if (!ok) throw bad("the signed note is not the declared one");
}

/** The outputs of a signed transaction (node JSON): tree and exact value, or null when it cannot be read. */
function outputsOf(signedRaw: string): { tree: string; value: bigint; regs: Record<string, string> }[] | null {
  const o = strictObject(signedRaw);
  if (!o) return null;
  try {
    return asArray(member(o, "outputs"), "outputs").items.map((x, i) => {
      const b = asObject(x, `outputs[${i}]`);
      const regs: Record<string, string> = {};
      const r = member(b, "additionalRegisters");
      if (r) for (const e of asObject(r, `outputs[${i}].additionalRegisters`).entries) regs[e.key] = asString(e.value, `outputs[${i}].${e.key}`).toLowerCase();
      return { tree: asString(member(b, "ergoTree"), `outputs[${i}].ergoTree`), value: asU64(member(b, "value"), `outputs[${i}].value`), regs };
    });
  } catch {
    return null;
  }
}

/**
 * True when a signed P2PK transaction (node JSON) pays only this key's own address, plus at most the wallet's miner
 * fee (MINER_FEE_NANOERG, what Withdraw, Combine and Cancel pay): a "withdraw" that does not needs the passphrase.
 */
export function paysOnlyOwnKey(signedRaw: string, pub: Hex): boolean {
  const outs = outputsOf(signedRaw);
  if (!outs || outs.length === 0) return false;
  const own = `0008cd${pub}`;
  let fee = 0n;
  for (const o of outs) {
    if (o.tree === FEE_TREE_HEX) fee += o.value;
    else if (o.tree !== own) return false;
  }
  return fee <= MINER_FEE_NANOERG;
}

/** The ids of a signed transaction's inputs and whether each carries a context extension, or null when unreadable. */
function inputsOf(signedRaw: string): { boxId: string; extension: boolean }[] | null {
  const o = strictObject(signedRaw);
  if (!o) return null;
  try {
    return asArray(member(o, "inputs"), "inputs").items.map((x, i) => {
      const b = asObject(x, `inputs[${i}]`);
      const proof = member(b, "spendingProof");
      const ext = proof ? member(asObject(proof, `inputs[${i}].spendingProof`), "extension") : undefined;
      return { boxId: asString(member(b, "boxId"), `inputs[${i}].boxId`).toLowerCase(), extension: !!ext && asObject(ext, `inputs[${i}].extension`).entries.length > 0 };
    });
  } catch {
    return null;
  }
}

/** The boxes a caller says the inputs are, each bound to its id (its bytes hash to it), in the inputs' order. */
function boundInputs(signedRaw: string, boxes: readonly ErgoBox[] | undefined): ErgoBox[] | null {
  const ins = inputsOf(signedRaw);
  if (!ins || !boxes || boxes.length !== ins.length) return null;
  try {
    return ins.every((x, i) => boxes[i].boxId === x.boxId && boxIdHolds(boxes[i])) ? [...boxes] : null;
  } catch {
    return null; // a box that cannot even be serialized is no box
  }
}

/**
 * A withdrawal (Withdraw, Combine, Cancel) spends only this key's own boxes, with no context variables (re-review,
 * LOW): its inputs, bound to their ids, are P2PK(this key). So "withdraw" can never sign a reserve's refund
 * completion (which needs #0 and spends the reserve contract) without the passphrase, or at all.
 */
export function spendsOnlyOwnBoxes(signedRaw: string, pub: Hex, boxes: readonly ErgoBox[] | undefined): boolean {
  const ins = inputsOf(signedRaw);
  const bound = boundInputs(signedRaw, boxes);
  return !!ins && ins.length > 0 && !ins.some((x) => x.extension) && !!bound && bound.every((b) => b.ergoTree === `0008cd${pub}` && b.ergoTree !== RESERVE_TREE_HEX && b.ergoTree !== TOKEN_RESERVE_TREE_HEX);
}

/** A redemption's one input is a reserve-contract box (re-review, LOW): the box the screen reviewed, bound to its id.
 *  A token redemption: input 0 the token reserve, every other input a token-free box at the tracker's own key (never
 *  this key's: its proof would spend them too), at least one. `trackerPk` is for tests. */
export function redeemsReserveBox(signedRaw: string, boxes: readonly ErgoBox[] | undefined, trackerPk: Hex = TRACKER_PK): boolean {
  const bound = boundInputs(signedRaw, boxes);
  if (!bound || bound.length === 0) return false;
  if (bound[0].ergoTree === RESERVE_TREE_HEX) return bound.length === 1;
  return bound[0].ergoTree === TOKEN_RESERVE_TREE_HEX && bound.length >= 2 && bound.slice(1).every((b) => b.ergoTree === `0008cd${trackerPk}` && b.tokens.length === 0);
}

/** Each output's tree and tokens (node JSON `assets`; none listed = none), or null when unreadable. */
function outputTokensOf(signedRaw: string): { tree: string; tokens: { tokenId: string; amount: bigint }[] }[] | null {
  const o = strictObject(signedRaw);
  if (!o) return null;
  try {
    return asArray(member(o, "outputs"), "outputs").items.map((x, i) => {
      const b = asObject(x, `outputs[${i}]`);
      const a = member(b, "assets");
      const tokens = a === undefined ? [] : asArray(a, `outputs[${i}].assets`).items.map((t, j) => {
        const tk = asObject(t, `outputs[${i}].assets[${j}]`);
        return { tokenId: asString(member(tk, "tokenId"), `outputs[${i}].assets[${j}].tokenId`).toLowerCase(), amount: asU64(member(tk, "amount"), `outputs[${i}].assets[${j}].amount`) };
      });
      return { tree: asString(member(b, "ergoTree"), `outputs[${i}].ergoTree`), tokens };
    });
  } catch {
    return null;
  }
}

/**
 * A withdrawal (Withdraw, Combine, Cancel, token Withdraw) moves tokens and never makes or burns one (second review
 * LOW-1): per token id, the input boxes (bound to the signed inputs' ids) hold exactly what the signed outputs hold,
 * and the miner-fee output holds none. A token sent to the fee contract would be anyone's to take.
 */
export function withdrawKeepsTokens(signedRaw: string, boxes: readonly ErgoBox[] | undefined): boolean {
  const bound = boundInputs(signedRaw, boxes);
  const outs = outputTokensOf(signedRaw);
  if (!bound || !outs) return false;
  if (outs.some((o) => o.tree === FEE_TREE_HEX && o.tokens.length > 0)) return false;
  const total = (lists: readonly (readonly { tokenId: string; amount: bigint }[])[]) => {
    const m = new Map<string, bigint>();
    for (const l of lists) for (const t of l) m.set(t.tokenId.toLowerCase(), (m.get(t.tokenId.toLowerCase()) ?? 0n) + t.amount);
    return m;
  };
  const tin = total(bound.map((b) => b.tokens));
  const tout = total(outs.map((o) => o.tokens));
  return tin.size === tout.size && [...tin].every(([id, n]) => tout.get(id) === n);
}

/** The redemption's context variable #0: action 0 (redeem), output 0 (basis.es: a Byte, action × 10 + index). */
const REDEEM_ACTION_VAR = "0200";

/**
 * True when a signed redemption pays this key: exactly [the reserve's continuation, P2PK(this key), the miner fee of at
 * most REDEEM_MAX_FEE_NANOERG], as the wallet's own checks require before it signs (tx/redemption.ts L1); and it is
 * a redemption, not another reserve action of the same layout (a refund start with change is [reserve, own, fee] too):
 * one input, the reserve, whose #0 is action 0, and a reserve that is not this key's own (R4 of output 0).
 */
export function redemptionPaysOwnKey(signedRaw: string, pub: Hex): boolean {
  const outs = outputsOf(signedRaw);
  if (!outs) return false;
  // ERG: [reserve, own, fee ≤ 0.001 ERG], one input. Token (the tracker pays): [token reserve, own, fee ≤ 0.002 ERG,
  // the tracker's change?], the reserve and the tracker's fee boxes; no output but the payout at this key.
  const token = outs[0]?.tree === TOKEN_RESERVE_TREE_HEX;
  if (token) {
    if ((outs.length !== 3 && outs.length !== 4) || outs[1].tree !== `0008cd${pub}` || outs[2].tree !== FEE_TREE_HEX || outs[2].value > TOKEN_REDEEM_MAX_FEE_NANOERG) return false;
    if (outs.length === 4 && (outs[3].tree === `0008cd${pub}` || outs[3].tree === RESERVE_TREE_HEX || outs[3].tree === TOKEN_RESERVE_TREE_HEX)) return false;
  } else if (outs.length !== 3 || outs[0].tree !== RESERVE_TREE_HEX || outs[1].tree !== `0008cd${pub}` ||
    outs[2].tree !== FEE_TREE_HEX || outs[2].value > REDEEM_MAX_FEE_NANOERG) return false;
  const o = strictObject(signedRaw);
  if (!o) return false;
  try {
    const ins = asArray(member(o, "inputs"), "inputs").items;
    if (token ? ins.length < 2 : ins.length !== 1) return false;
    const proof = asObject(member(asObject(ins[0], "inputs[0]"), "spendingProof"), "inputs[0].spendingProof");
    if (asString(member(asObject(member(proof, "extension"), "extension"), "0"), "extension.0").toLowerCase() !== REDEEM_ACTION_VAR) return false;
    const out0 = asObject(asArray(member(o, "outputs"), "outputs").items[0], "outputs[0]");
    const r4 = asString(member(asObject(member(out0, "additionalRegisters"), "outputs[0].additionalRegisters"), "R4"), "outputs[0].R4");
    return r4.toLowerCase() !== `07${pub}`;
  } catch {
    return false;
  }
}

/** The reserve's own actions (journal kinds topup, refund-start, refund-end). */
export type ReserveActionKind = "topup" | "refund-start" | "refund-end";

/**
 * True when a signed reserve action pays only where the wallet's own checks allow (tx/reserveaction.ts L1): a top-up
 * or a refund start is [the reserve contract, change to this key?, the miner fee]; a completion is [this key, the
 * miner fee]; the fee is at most MINER_FEE_NANOERG. The reserve output is our tracker's (R6) and of the right owner
 * (R4): this key for a refund start, `owner` (the reserve the screen reviewed) for a top-up. The amounts and the other
 * registers are L1's; this keeps a screen from signing money to anywhere else under these kinds.
 */
export function reserveActionPaysRight(signedRaw: string, pub: Hex, kind: ReserveActionKind, owner: Hex | null = null): boolean {
  const outs = outputsOf(signedRaw);
  if (!outs) return false;
  const own = `0008cd${pub}`;
  const fee = outs[outs.length - 1];
  if (!fee || fee.tree !== FEE_TREE_HEX || fee.value > MINER_FEE_NANOERG) return false;
  if (kind === "refund-end") return outs.length === 2 && outs[0].tree === own;
  if (outs.length !== 2 && outs.length !== 3) return false;
  const r4 = kind === "refund-start" ? pub : owner;
  if (!r4 || outs[0].regs.R4 !== `07${r4}` || outs[0].regs.R6 !== `0e20${TRACKER_NFT}`) return false;
  return (outs[0].tree === RESERVE_TREE_HEX || outs[0].tree === TOKEN_RESERVE_TREE_HEX) && (outs.length === 2 || outs[1].tree === own);
}
