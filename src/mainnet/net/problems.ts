// What went wrong with one request, in the words the wallet needs (design §6.3). Every answer of the front is read
// here: the status, the tracker's own reason (cut to 300 characters, always shown as plain text), and for a 429 when
// to try again. Nothing here retries: polls back off (`backoffMs`), user actions show the wait and a "Try again".
import type { RawAnswer } from "../../chain/ours";
import { OURS_POLL } from "../../chain/ours";

export type ProblemKind =
  | "busy"          // 429 from the front's rate limits: retry later (per-IP buckets are shared by a household)
  | "cap"           // 429 naming a note cap of the tracker (server.notes_max_*): the reason says which
  | "restarting"    // 503 on /reserves/create: the tracker is starting (about 10 minutes)
  | "low-funds"     // 503 on /redemption/build: the tracker keeps its commit funds
  | "unavailable"   // 502 / 503 / 504 otherwise
  | "waiting-chain" // 409 on /redemption/build (round 5, C8): an earlier redemption waits for 2 confirmations
  | "replaced"      // 409 on /redemption/submit: the build is unknown, expired, used or replaced; nothing was sent
  | "conflict"      // 409 otherwise (no active reserve, reserve in refund, two reserves …): the reason says which
  | "future-ts"     // 400 "Future timestamp": the note is later than the tracker's clock
  | "past-ts"       // 400 "Past timestamp": not after the pair's last note
  | "refused"       // 400 or 2xx success:false: the reason says why
  | "not-found"     // 404
  | "too-large"     // 413, or a body the wallet refused to send because the front would refuse it
  | "timeout" | "network" | "aborted"
  | "shape"         // an answer the wallet cannot read
  | "http";         // any other status

export interface Problem {
  kind: ProblemKind;
  status: number | null;
  /** The server's words (tracker or node), ≤ 300 characters; "" when it gave none. Render as text, never as HTML. */
  reason: string;
  /** For busy: wait this long before asking again (Retry-After, else the poll backoff). */
  retryInMs: number | null;
  /** For waiting-chain: the redemption the tracker waits for. */
  txId: string | null;
}

export type WalletRoute =
  | "state" | "pending-tx" | "reserves-of" | "key-status" | "pair-note"
  | "notes" | "reserves-create" | "build" | "submit" | "broadcast" | "v1";

const cut = (s: string) => (s.length > 300 ? s.slice(0, 299) + "…" : s);

/** The server's own words in an error body: the tracker's `{success:false, error}` or the node's `{error, reason, detail}`. */
export function reasonOf(text: string): string {
  let j: unknown;
  try { j = JSON.parse(text); } catch { return ""; }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return typeof j === "string" ? cut(j) : "";
  const o = j as Record<string, unknown>;
  if (typeof o.error === "string" && o.error && o.success === false) return cut(o.error);
  const parts = [o.reason, o.detail].filter((x): x is string => typeof x === "string" && x.trim() !== "");
  if (parts.length) return cut(parts.join(": "));
  if (typeof o.error === "string") return cut(o.error);
  return "";
}

const TX_ID = /\b([0-9a-f]{64})\b/i;

/** The poll backoff after `failures` failed answers in a row: 30 s, 60 s, … 10 min (OURS_POLL). */
export function backoffMs(failures: number): number {
  if (failures <= 0) return 0;
  return Math.min(OURS_POLL.backoffMaxMs, OURS_POLL.backoffBaseMs * 2 ** (failures - 1));
}

/** Null for a 2xx answer; otherwise what went wrong. `failures` counts the failed answers before this one (backoff). */
export function problemOf(route: WalletRoute, a: RawAnswer, failures = 0): Problem | null {
  if (!a.ok) return { kind: a.kind, status: null, reason: "", retryInMs: a.kind === "aborted" ? null : backoffMs(failures + 1), txId: null };
  const s = a.status;
  if (s >= 200 && s < 300) return null;
  const reason = reasonOf(a.text);
  const p = (kind: ProblemKind, extra: Partial<Problem> = {}): Problem => ({ kind, status: s, reason, retryInMs: null, txId: null, ...extra });
  if (s === 429) {
    if (/server\.notes_max_/i.test(reason)) return p("cap");
    return p("busy", { retryInMs: a.retryAfterMs ?? backoffMs(failures + 1) });
  }
  if (s === 503 || s === 502 || s === 504) {
    if (route === "reserves-create") return p("restarting");
    if (route === "build" && /commit|fee fund|fee box|floor/i.test(reason)) return p("low-funds");
    return p("unavailable", { retryInMs: a.retryAfterMs ?? backoffMs(failures + 1) });
  }
  if (s === 409) {
    if (route === "build" && /waiting for the\s+chain/i.test(reason)) return p("waiting-chain", { txId: (reason.match(TX_ID)?.[1] ?? "").toLowerCase() || null });
    if (route === "submit") return p("replaced");
    return p("conflict");
  }
  if (s === 400) {
    if (/^future timestamp/i.test(reason)) return p("future-ts");
    if (/^past timestamp/i.test(reason)) return p("past-ts");
    return p("refused");
  }
  if (s === 404) return p("not-found");
  if (s === 413) return p("too-large");
  return p("http");
}

/** A problem the wallet found itself, before or after a request (a body too large, an answer it cannot read). */
export const localProblem = (kind: ProblemKind, reason = ""): Problem => ({ kind, status: null, reason: cut(reason), retryInMs: null, txId: null });
