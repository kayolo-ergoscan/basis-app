// Issuing or raising a note (design §6.2 "Note (pay)", §6.6): the cumulative total for the pair, the timestamp the
// tracker accepts (after the pair's last note, not after its own clock), the signature over the 80-byte message and the
// `POST /notes` body as a string, and the checks of the pair's previous note. Coverage is wallet policy, not a contract
// rule; when the passphrase is asked again is the vault's (vault/policy.ts).
import { bytesToHex } from "../../protocol/bytes";
import { TRACKER_NFT, jsonString, noteMessage, signBasis, verifyBasis, type StoredNote } from "../tx";
import type { JournalEntry } from "../vault";
import type { NoteReceipt } from "./receipt";

/** The note's state at the tracker before this one: what the pair already owes, and the last timestamp. */
export interface PairState { total: bigint; redeemed: bigint; timestamp: bigint }

export const pairStateOf = (n: StoredNote | null): PairState | null =>
  n ? { total: n.amountCollected, redeemed: n.amountRedeemed, timestamp: n.timestamp } : null;

/** Clock margin for notes: the tracker refuses a timestamp later than its own clock, with no tolerance (§6.6). */
export const NOTE_CLOCK_MARGIN_MS = 2000;

/** The timestamp to claim for the next note of a pair: max(previous + 1, server now − 2 s). */
export function noteTimestamp(previous: bigint | null, serverNowMs: number): bigint {
  const now = BigInt(Math.max(0, Math.floor(serverNowMs - NOTE_CLOCK_MARGIN_MS)));
  return previous !== null && previous + 1n > now ? previous + 1n : now;
}

export interface NoteFieldsIn {
  issuer: string;
  recipient: string;
  /** The new cumulative total, nanoERG. */
  total: bigint;
  timestamp: bigint;
  trackerNft?: string;
}

export interface SignedNote { body: string; signature: string; receipt: NoteReceipt }

/** `POST /notes` exactly as the tracker reads it (CreateNoteRequest). */
export function noteBody(f: NoteFieldsIn & { signature: string }): string {
  return `{"recipient_pubkey":${jsonString(f.recipient)},"amount":${f.total},"timestamp":${f.timestamp},"signature":${jsonString(f.signature)},` +
    `"issuer_pubkey":${jsonString(f.issuer)},"tracker_nft_id":${jsonString(f.trackerNft ?? TRACKER_NFT)},"denomination":"erg"}`;
}

/** Signs the note (inside the vault's secret callback): the body to POST and the receipt to hand over. */
export function signNote(secret: Uint8Array, f: NoteFieldsIn): SignedNote {
  if (f.issuer === f.recipient) throw new Error("a note to yourself is not a note");
  if (f.total <= 0n) throw new Error("the total must be above 0");
  const nft = f.trackerNft ?? TRACKER_NFT;
  const message = noteMessage({ issuer: f.issuer, recipient: f.recipient, totalDebt: f.total, timestamp: f.timestamp, trackerNft: nft });
  const signature = bytesToHex(signBasis(message, secret, f.issuer));
  return { body: noteBody({ ...f, signature }), signature, receipt: { nft, issuer: f.issuer, recipient: f.recipient, total: f.total, timestamp: f.timestamp, signature } };
}

/** Coverage of a reserve by what its notes promise: collateral / outstanding (null when nothing is outstanding). */
export function coverage(collateral: bigint, outstanding: bigint): number | null {
  if (outstanding <= 0n) return null;
  return Number((collateral * 10000n) / outstanding) / 100;
}

/**
 * A reserve's coverage as the tracker reports it, and once its redemptions waiting for the chain are applied (money
 * review P2-8). For a few minutes after a redemption is mined, the reserve already holds less while the tracker still
 * counts the redeemed notes in its debt: then a low figure is that delay, not a shortfall.
 */
export function reserveCoverage(r: { collateral: bigint; debt: bigint; pendingRedemption: bigint }): { pct: number | null; settled: number | null; settling: boolean } {
  const pct = coverage(r.collateral, r.debt);
  if (r.pendingRedemption <= 0n) return { pct, settled: pct, settling: false };
  return { pct, settled: coverage(r.collateral, r.debt - r.pendingRedemption), settling: true };
}

/**
 * What a reserve's tag shows. While a redemption waits for the chain and the reserve is covered once it is counted,
 * the tag says "settling" instead of a band. A band of a figure that changes within minutes would warn about nothing:
 * at exactly 100 % it said «Тревога» (operator, 23 Nov 2026). A real shortfall still shows its band.
 */
export function reserveTag(r: { collateral: bigint; debt: bigint; pendingRedemption: bigint }): { kind: "none" } | { kind: "settling" } | { kind: "band"; pct: number } {
  const { pct, settled, settling } = reserveCoverage(r);
  if (settling && (settled === null || settled >= 100)) return { kind: "settling" };
  return pct === null ? { kind: "none" } : { kind: "band", pct };
}

// ─── the pair's previous note (keys review P0-1, money review P1-1) ──────────────────────────────

/** A previous note may be dated at most this much after our reading of the tracker's clock: the tracker refuses any
 *  note later than its own clock, and our reading runs up to 1 s behind it, plus the answer's travel time. */
export const PREV_NOTE_AHEAD_MS = 5_000;

/** A note entry's fields as Pay records them (meta.to, total, ts, sig), or null for an entry without them. */
export function noteEntryFields(e: JournalEntry): { to: string; total: bigint; timestamp: bigint; signature: string } | null {
  const m = e.meta;
  if (e.kind !== "note" || typeof m.to !== "string" || typeof m.total !== "string" || typeof m.ts !== "string" || typeof m.sig !== "string") return null;
  if (!/^\d{1,19}$/.test(m.total) || !/^\d{1,19}$/.test(m.ts)) return null;
  return { to: m.to, total: BigInt(m.total), timestamp: BigInt(m.ts), signature: m.sig };
}

/** What this browser's journal knows of one pair (issuer → recipient). */
export interface PairJournal {
  /** The highest total of a note the tracker took (sent, in a commit, committed): it must show at least this. */
  accepted: bigint;
  /** Notes sent at least once without an answer (still "signed"): they may be at the tracker. Newest first. */
  uncertain: JournalEntry[];
}

export function pairJournalOf(entries: readonly JournalEntry[], issuer: string, recipient: string): PairJournal {
  let accepted = 0n;
  const uncertain: JournalEntry[] = [];
  for (const e of entries) {
    if (e.pub !== issuer) continue;
    const f = noteEntryFields(e);
    if (!f || f.to !== recipient) continue;
    if (e.state === "sent" || e.state === "mempool" || e.state === "confirmed" || e.state === "final") {
      if (f.total > accepted) accepted = f.total;
    } else if (e.state === "signed" && e.sendAttempts > 0) uncertain.push(e);
  }
  uncertain.sort((a, b) => b.createdAt - a.createdAt);
  return { accepted, uncertain };
}

/**
 * An unanswered note the pair has moved past (the tracker holds a later timestamp; this key, maybe on another device):
 * true when that later note promises at least this note's total, so this payment is included in it and must not be
 * paid again; false when it promises less (this one was replaced and can no longer be recorded).
 */
export const laterNoteCovers = (stored: { total: bigint }, ours: { total: bigint }): boolean => stored.total >= ours.total;

/** True when the tracker's stored note is exactly this recorded note: same pair, total, timestamp and signature. */
export function storedIsEntry(n: StoredNote, e: JournalEntry): boolean {
  const f = noteEntryFields(e);
  return !!f && n.issuer === e.pub && n.recipient === f.to && n.amountCollected === f.total && n.timestamp === f.timestamp && n.signature === f.signature;
}

export type PrevNoteRule = "prev-pair" | "prev-denomination" | "prev-tracker" | "prev-signature" | "prev-ahead" | "prev-older" | "prev-missing";

/** The previous note, checked: its total, what was redeemed of it, its timestamp and its signature. */
export interface CheckedPrev extends PairState { signature: string }

export type PrevNoteCheck = { ok: true; prev: CheckedPrev | null } | { ok: false; rule: PrevNoteRule; message: string };

/**
 * Before a new note is signed on top of the pair's previous one: the tracker's answer must be a note of this key (its
 * signature over the 80-byte message verifies), ERG, bound to our tracker's NFT, dated no later than the tracker's
 * clock, and not older than the newest note the tracker took from this browser (`accepted`, from the journal). A pair
 * without a note is fine only when the journal knows of no accepted one. Then "note so far" is a fact, not a claim:
 * the tracker cannot make this key sign a total it never promised.
 */
export function checkPreviousNote(note: StoredNote | null, want: { issuer: string; recipient: string; accepted: bigint; serverNowMs: number }): PrevNoteCheck {
  if (note === null) {
    return want.accepted > 0n
      ? { ok: false, rule: "prev-missing", message: `the tracker shows no note for this pair, but it took one of ${want.accepted} nanoERG from this browser` }
      : { ok: true, prev: null };
  }
  if (note.issuer !== want.issuer || note.recipient !== want.recipient) return { ok: false, rule: "prev-pair", message: "the tracker answered for another pair of keys" };
  if (note.denomination !== "erg") return { ok: false, rule: "prev-denomination", message: `the note is in ${note.denomination}, not ERG` };
  if (note.trackerNft !== TRACKER_NFT) return { ok: false, rule: "prev-tracker", message: `the note is bound to tracker NFT ${note.trackerNft}` };
  let signed = false;
  try {
    const message = noteMessage({ issuer: note.issuer, recipient: note.recipient, totalDebt: note.amountCollected, timestamp: note.timestamp, trackerNft: TRACKER_NFT });
    signed = verifyBasis(note.issuer, message, note.signature);
  } catch {
    signed = false;
  }
  if (!signed) return { ok: false, rule: "prev-signature", message: `the stored signature does not cover total ${note.amountCollected} at timestamp ${note.timestamp} under this key` };
  const latest = BigInt(Math.max(0, Math.floor(want.serverNowMs))) + BigInt(PREV_NOTE_AHEAD_MS);
  if (note.timestamp > latest) return { ok: false, rule: "prev-ahead", message: `the note is dated ${note.timestamp}, after the tracker's clock (about ${Math.floor(want.serverNowMs)})` };
  if (note.amountCollected < want.accepted) {
    return { ok: false, rule: "prev-older", message: `the tracker shows total ${note.amountCollected}, below ${want.accepted} it took from this browser` };
  }
  return { ok: true, prev: { total: note.amountCollected, redeemed: note.amountRedeemed, timestamp: note.timestamp, signature: note.signature } };
}
