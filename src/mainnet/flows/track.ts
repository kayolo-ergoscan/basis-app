// Following a signed transaction to depth 2 (design §6.2, §6.4): what the chain shows → the journal state. The chain
// has the last word; nothing here is ever marked failed without proof that it can no longer confirm.
import type { JournalEntry, JournalState } from "../vault";
import type { TxStatus } from "../net";

/** The tracker reads redemptions and new reserves at 2 confirmations (its min_depth). */
export const FINAL_DEPTH = 2;
/** A failed entry that was sent is still looked for this many blocks after it failed: the chain has the last word. */
export const FAILED_FOLLOW_BLOCKS = 30;

export interface ChainSighting {
  /** /v1/transactions/{id}: null while it is in no block. */
  status: TxStatus | null;
  /** Seen in the mempool by the key's address. */
  inMempool: boolean;
  /** One of its inputs is spent by another transaction (a double spend, or the same key elsewhere): it can never confirm. */
  conflict?: boolean;
  /** Redemption only: the tracker box it reads was spent by a commit before it confirmed. */
  trackerBoxSpent?: boolean;
}

export type TrackStep =
  | { state: JournalState; inclusionHeight?: number | null; error?: string }
  | null;

/** The next journal state for an open entry (or a failed one still followed), or null when nothing changed. */
export function nextTrackState(e: Pick<JournalEntry, "state" | "inclusionHeight" | "sendAttempts">, s: ChainSighting): TrackStep {
  if (e.state === "failed") {
    // only the chain can reopen it: seen in a block or in the mempool after all
    if (s.status) return { state: s.status.confirmations >= FINAL_DEPTH ? "final" : "confirmed", inclusionHeight: s.status.inclusionHeight };
    if (s.inMempool) return { state: "mempool", inclusionHeight: null };
    return null;
  }
  if (s.status) {
    const state: JournalState = s.status.confirmations >= FINAL_DEPTH ? "final" : "confirmed";
    return state === e.state && e.inclusionHeight === s.status.inclusionHeight ? null : { state, inclusionHeight: s.status.inclusionHeight };
  }
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
