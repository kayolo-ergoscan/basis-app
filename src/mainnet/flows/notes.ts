// Issuing or raising a note (design §6.2 "Note (pay)", §6.6): the cumulative total for the pair, the timestamp the
// tracker accepts (after the pair's last note, not after its own clock), the signature over the 80-byte message and the
// `POST /notes` body as a string. Coverage and the passphrase rule are wallet policy, not contract rules.
import { bytesToHex } from "../../protocol/bytes";
import { TRACKER_NFT, jsonString, noteMessage, signBasis, type StoredNote } from "../tx";
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

/** Design §4.2: ask for the passphrase again when one signature promises more than 25 % of the reserve. */
export const needsPassphrase = (added: bigint, reserve: bigint): boolean => reserve <= 0n || added * 4n > reserve;
