// The receiver's side of a note (design §3.2, §6.2 "Receive", "Redeem"): what the tracker says about the pair, what is
// redeemable now (only the committed total counts), and what a redemption pays out (the amount minus the miner fee,
// paid by the recipient for ERG reserves).
import { MIN_BOX_NANOERG, REDEEM_MAX_FEE_NANOERG, type StoredNote } from "../tx";
import type { Problem } from "../net";

export type NoteStage = "local" | "pending" | "committed";

export interface NoteView {
  /** The note's cumulative total at the tracker. */
  total: bigint;
  redeemed: bigint;
  /** total − redeemed: what the issuer still owes on this note. */
  outstanding: bigint;
  /** The total the chain has committed (null: none yet). */
  committed: bigint | null;
  /** What a redemption can take now (the tracker's `redeemable_amount`, which follows the committed total). */
  redeemableNow: bigint;
  stage: NoteStage;
  confirmedHeight: number | null;
  timestamp: bigint;
}

export function noteView(n: StoredNote): NoteView {
  const c = n.confirmation;
  const committed = c?.confirmedTotalDebt ?? null;
  const stage: NoteStage = committed !== null && committed === n.amountCollected ? "committed" : c?.status === "pending" ? "pending" : "local";
  const outstanding = n.amountCollected > n.amountRedeemed ? n.amountCollected - n.amountRedeemed : 0n;
  return {
    total: n.amountCollected,
    redeemed: n.amountRedeemed,
    outstanding,
    committed,
    redeemableNow: stage === "committed" ? c?.redeemableAmount ?? 0n : 0n,
    stage,
    confirmedHeight: c?.confirmedHeight ?? null,
    timestamp: n.timestamp,
  };
}

/** The miner fee a redemption pays out of the payout (the tracker builds with at most this, L1 `fee-limit`). */
export const REDEEM_FEE = REDEEM_MAX_FEE_NANOERG;
/** The smallest redemption: the payout must be at least one box (0.001 ERG) after the fee. */
export const REDEEM_MIN = MIN_BOX_NANOERG + REDEEM_FEE;

export const payoutOf = (amount: bigint, fee: bigint = REDEEM_FEE): bigint => (amount > fee ? amount - fee : 0n);

/** Can this amount be redeemed now? */
export function redeemableAmount(amount: bigint | null, v: NoteView): "ok" | "below-min" | "above" | "none" {
  if (v.redeemableNow < REDEEM_MIN) return "none";
  if (amount === null || amount < REDEEM_MIN) return "below-min";
  if (amount > v.redeemableNow) return "above";
  return "ok";
}

/** What a redemption's journal entry keeps to submit it again after a reload: the spliced `partial_tx` (signedRaw), the
 *  build's own `unsigned_tx` text (unsignedRaw), and the four plain fields. */
export interface RedeemRecord { signedRaw: string; unsignedRaw: string; issuer: string; recipient: string; amount: bigint; newRedeemed: bigint }

/** The `POST /redemption/submit` body rebuilt from the journal: byte for byte what `redemptionSubmitBody` wrote at
 *  signing time (the Redeem screen compares the two before it records anything). */
export const submitBodyOf = (r: RedeemRecord): string =>
  `{"signed_tx":${r.signedRaw},"unsigned_tx":${r.unsignedRaw},` +
  `"issuer_pubkey":${JSON.stringify(r.issuer)},"recipient_pubkey":${JSON.stringify(r.recipient)},` +
  `"redeemed_amount":${r.amount},"new_already_redeemed":${r.newRedeemed}}`;

/**
 * What a `POST /redemption/submit` answer means for a recorded redemption (money review P1-2). The tracker uses the
 * build up before anything else (validate_and_consume), so after an earlier attempt a 409 most likely means that attempt
 * went through; and only two of its 500s are definite (tracker round 5b, F7):
 * - "sent": the tracker broadcast it (2xx), or it said the node did not answer and it follows the transaction itself;
 * - "in-doubt": the build was already used and an earlier attempt was made: follow the transaction, do not submit again;
 * - "failed": nothing was broadcast (first-attempt 409, 400, 404, 413, "did not accept", "cannot record … did not
 *   submit"); the watcher still follows its id for a while, the chain has the last word;
 * - "unknown": no clear answer (timeout, network, 408, other 5xx, 429): it may be on its way; keep it, follow it, and
 *   offer the same bytes again.
 * `priorAttempts` = the entry's sendAttempts before this attempt's markSending.
 */
export type SubmitVerdict = "sent" | "in-doubt" | "failed" | "unknown";

export function submitVerdict(problem: Problem | null, priorAttempts: number): SubmitVerdict {
  if (problem === null || problem.kind === "submit-unknown") return "sent";
  if (problem.kind === "replaced") return priorAttempts > 0 ? "in-doubt" : "failed";
  if (problem.kind === "not-submitted" || problem.kind === "refused" || problem.kind === "not-found" || problem.kind === "too-large") return "failed";
  return "unknown";
}
