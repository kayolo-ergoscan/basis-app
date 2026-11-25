// Activity offers a note's receipt again only on the newest note per receiver and denomination (review L5): an older
// receipt promises a smaller total that the newer note already includes.
import { describe, expect, it } from "vitest";
import type { JournalEntry, JournalState } from "@/mainnet/vault";
import { newestNotes } from "./Activity";

const ME = `02${"4a".repeat(32)}`;
const A = `03${"5b".repeat(32)}`;
const B = `02${"6c".repeat(32)}`;
const SIG = "token:03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";

let n = 0;
const note = (to: string, ts: number, state: JournalState = "final", denom?: string, pub = ME): JournalEntry => ({
  v: 1, id: `n${++n}`, kind: "note", pub, state, txId: null, signedRaw: "{}", unsignedRaw: null, inputs: [],
  createdAt: ts, updatedAt: ts, sendAttempts: 1, firstSendAt: ts, lastSendAt: ts,
  meta: { to, total: String(ts * 10), ts: String(ts), sig: "11".repeat(65), ...(denom ? { denom } : {}) },
} as unknown as JournalEntry);

describe("newestNotes", () => {
  it("one per receiver and denomination, by the signed timestamp, whatever the journal order", () => {
    const a1 = note(A, 100), a2 = note(A, 300, "mempool"), a3 = note(A, 200);
    const s1 = note(A, 150, "sent", SIG), s2 = note(A, 120, "final", SIG);
    const b1 = note(B, 50);
    const other = note(A, 999, "final", undefined, B); // another key's note to A: its own pair
    const ids = newestNotes([a1, a2, a3, s1, s2, b1, other]);
    expect([...ids].sort()).toEqual([a2.id, s1.id, b1.id, other.id].sort());
  });
  it("a note the tracker did not take never replaces one it took", () => {
    const took = note(A, 100, "confirmed");
    const ids = newestNotes([took, note(A, 200, "signed"), note(A, 300, "failed"), note(A, 400, "abandoned")]);
    expect([...ids]).toEqual([took.id]);
  });
  it("skips entries without a receiver or timestamp, and denominations the wallet does not know", () => {
    const ok = note(A, 100);
    const bad = { ...note(A, 500), meta: { to: A, total: "5" } } as unknown as JournalEntry;
    const unknown = note(A, 600, "final", `token:${"ee".repeat(32)}`);
    expect([...newestNotes([ok, bad, unknown])]).toEqual([ok.id]);
  });
});
