// Following a signed transaction to depth 2 (design §6.2, §6.4): what the chain shows → the journal state. The chain
// has the last word; nothing here is ever marked failed without proof that it can no longer confirm.
import type { JournalEntry, JournalState } from "../vault";
import type { TxStatus } from "../net";

/** The tracker reads redemptions and new reserves at 2 confirmations (its min_depth). */
export const FINAL_DEPTH = 2;
/** A failed entry that was sent is still looked for this many blocks after it failed: the chain has the last word. */
export const FAILED_FOLLOW_BLOCKS = 30;
/** A final entry is checked again until this depth (money review P2-3): a reorg deeper than 2 blocks sends it back. */
export const FINAL_RECHECK_DEPTH = 10;

export interface ChainSighting {
  /** /v1/transactions/{id}: null while it is in no block. */
  status: TxStatus | null;
  /** Seen in the mempool by the key's address. */
  inMempool: boolean;
  /** One of its inputs is spent by another transaction (a double spend, or the same key elsewhere): it can never confirm. */
  conflict?: boolean;
  /** Redemption only: the tracker box it reads was spent by a commit before it confirmed. */
  trackerBoxSpent?: boolean;
  /** Refund start only: the tip reached its R7, so no next block may hold it (refundStartExpired). */
  expired?: boolean;
}

/**
 * A refund start is valid only in a block at a height ≤ its R7 (basis.es: `selfOut.R7 >= HEIGHT`): once the tip has
 * reached R7, the next block is past it and the transaction can never confirm (re-review P2).
 */
export function refundStartExpired(e: Pick<JournalEntry, "kind" | "meta">, tip: number | null): boolean {
  if (e.kind !== "refund-start" || tip === null) return false;
  const r7 = typeof e.meta.r7 === "string" && /^\d{1,15}$/.test(e.meta.r7) ? Number(e.meta.r7) : 0;
  return r7 > 0 && tip >= r7;
}

export type TrackStep =
  | { state: JournalState; inclusionHeight?: number | null; error?: string }
  | null;

/** The next journal state for an open entry (or a failed one still followed), or null when nothing changed. */
export function nextTrackState(e: Pick<JournalEntry, "state" | "inclusionHeight" | "sendAttempts">, s: ChainSighting): TrackStep {
  if (e.state === "failed") {
    // only the chain can reopen it: seen in a block or in the mempool after all
    if (s.status) return { state: s.status.confirmations >= FINAL_DEPTH ? "final" : "confirmed", inclusionHeight: s.status.inclusionHeight };
    // an expired refund start still listed by a mempool is not alive: no block can hold it
    if (s.inMempool && !s.expired) return { state: "mempool", inclusionHeight: null };
    return null;
  }
  if (e.state === "final" && !s.status) {
    // gone from its block (a reorg): back to the mempool or to "sent"; a conflict shows on the next look, from "sent"
    return { state: s.inMempool ? "mempool" : "sent", inclusionHeight: null };
  }
  if (s.status) {
    const state: JournalState = s.status.confirmations >= FINAL_DEPTH ? "final" : "confirmed";
    return state === e.state && e.inclusionHeight === s.status.inclusionHeight ? null : { state, inclusionHeight: s.status.inclusionHeight };
  }
  if (s.expired) return { state: "failed", error: "The refund height R7 passed before the refund start reached a block: it can never confirm. No funds moved; start again." };
  if (s.inMempool) return e.state === "mempool" ? null : { state: "mempool", inclusionHeight: null };
  if (s.conflict) return { state: "failed", error: "Another transaction spent the same boxes; this one can never confirm. No funds moved." };
  if (s.trackerBoxSpent) return { state: "failed", error: "The tracker committed meanwhile; no funds moved. Build again." };
  // seen before and gone now (a reorg or a drop): back to "sent", so the same bytes are offered again
  if (e.state === "mempool" || e.state === "confirmed") return { state: "sent", inclusionHeight: null };
  return null;
}

/** Depth of a transaction at the tip (1 = in the newest block). */
export const depthAt = (inclusionHeight: number | null, tip: number | null): number =>
  inclusionHeight === null || tip === null ? 0 : Math.max(0, tip - inclusionHeight + 1);

/** The height a failed entry failed at (meta.failedAt, set by the watcher the first time it sees it), or null. */
export const failedAtOf = (e: Pick<JournalEntry, "meta">): number | null =>
  typeof e.meta.failedAt === "number" && Number.isSafeInteger(e.meta.failedAt) && e.meta.failedAt >= 0 ? e.meta.failedAt : null;

/** True while the watcher still looks for a failed entry on chain: it was sent, and failed less than 30 blocks ago. */
export function followsFailed(e: Pick<JournalEntry, "state" | "txId" | "sendAttempts" | "meta">, tip: number): boolean {
  if (e.state !== "failed" || !e.txId || e.sendAttempts === 0) return false;
  const at = failedAtOf(e);
  return at === null || tip - at <= FAILED_FOLLOW_BLOCKS;
}

/** True while a final entry is still checked again (depth up to 10). */
export const followsFinal = (e: Pick<JournalEntry, "state" | "txId" | "inclusionHeight">, tip: number): boolean =>
  e.state === "final" && !!e.txId && e.inclusionHeight !== null && depthAt(e.inclusionHeight, tip) <= FINAL_RECHECK_DEPTH;
