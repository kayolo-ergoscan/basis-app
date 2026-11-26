// The inbox: every note paid to this key in one list, without a receipt link. GET /notes/recipient/{key} gives that
// list in one call only to the key's holder: the request carries this key's signature over "basis-inbox-v1" ‖ tracker
// NFT ‖ key ‖ valid_until (headers X-Basis-Inbox-Until, X-Basis-Inbox-Sig; src/mainnet/tx signInbox, tracker fork
// branch `inbox`), 401 otherwise. That stops bulk listing; it hides nothing (a pair's note stays readable by whoever
// knows both keys, as receipts need). The signed token (until + signature, never the key) is valid at the tracker
// until it expires, from anywhere; the wallet keeps its copy in this tab's sessionStorage only, drops it on «Forget»,
// and every copy when the key leaves this browser. A front without the route answers 404: the screen then falls back
// to receipt links, quietly, as before.
// Every record is checked like a watched pair's note: this key as the recipient, our tracker, a wallet denomination
// and the issuer's signature over the 80-byte message. A record that fails is counted, never shown.
import { requestQueue } from "@/chain/ours";
import { INBOX_MAX_AHEAD_S, envelopeData, isWalletDenom, parseStoredNote, type Denomination, type InboxToken } from "@/mainnet/tx";
import { checkPreviousNote, noteView, type NoteView } from "@/mainnet/flows";

export const INBOX_TOKEN_KEY = "basis.mainnet.inbox.v1";
/** How long a new token is valid (the tracker takes at most 24 h). */
export const INBOX_VALID_S = 12 * 3600;
/** A token is never dated from a server clock more than this ahead of the local one. */
export const INBOX_CLOCK_AHEAD_MS = 5 * 60_000;
/** Clocks further apart than this: no token is signed at all. */
export const INBOX_MAX_SKEW_MS = 3600_000;
/** A stored token is used while at least this much of it is left. */
const MARGIN_S = 120;
const PATH = "/api/tracker/notes/recipient/";
const PK = /^0[23][0-9a-f]{64}$/;
const TIMEOUT_MS = 20_000;

export interface InboxItem {
  issuer: string;
  denom: Denomination;
  view: NoteView;
}

export type InboxAnswer =
  | { kind: "list"; items: InboxItem[]; refused: number }
  /** 404: no such route here (a tracker or front from before the inbox); 401: the signature was not taken. */
  | { kind: "closed"; status: 401 | 404; reason: string | null }
  | { kind: "busy" }
  | { kind: "failed"; reason: string };

// ─── the token ──────────────────────────────────────────────────────────────────────────────────

const storeKey = (pub: string) => `${INBOX_TOKEN_KEY}.${pub}`;

function session(): Storage | null {
  try { return typeof sessionStorage === "undefined" ? null : sessionStorage; } catch { return null; }
}

/** The token of `pub` kept in this tab, when it is well-formed and still valid for a while at `nowS`. */
export function readToken(pub: string, nowS: number, store: Storage | null = session()): InboxToken | null {
  if (!store || !PK.test(pub)) return null;
  let raw: string | null = null;
  try { raw = store.getItem(storeKey(pub)); } catch { return null; }
  if (!raw) return null;
  let t: unknown;
  try { t = JSON.parse(raw); } catch { t = null; }
  const o = t as Record<string, unknown> | null;
  const ok = !!o && typeof o === "object" && Object.keys(o).length === 2 && typeof o.until === "string" && /^[1-9]\d{0,19}$/.test(o.until) && typeof o.sig === "string" && /^[0-9a-f]{130}$/.test(o.sig);
  const until = ok ? Number(o!.until) : 0;
  if (!ok || until - nowS < MARGIN_S || until - nowS > INBOX_MAX_AHEAD_S + 3600) {
    dropToken(pub, store);
    return null;
  }
  return { until: o!.until as string, sig: o!.sig as string };
}

/** Keeps only the token (until + signature) for this tab. */
export function saveToken(pub: string, token: InboxToken, store: Storage | null = session()): void {
  try { store?.setItem(storeKey(pub), JSON.stringify({ until: token.until, sig: token.sig })); } catch { /* private mode: this page only */ }
}

export function dropToken(pub: string, store: Storage | null = session()): void {
  try { store?.removeItem(storeKey(pub)); } catch { /* nothing kept */ }
}

/** Drops every inbox token kept in this tab but `keep`'s (all of them for null: the key was wiped or removed). */
export function dropTokensExcept(keep: string | null, store: Storage | null = session()): void {
  if (!store) return;
  try {
    const mine = keep ? storeKey(keep) : null;
    const all: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const k = store.key(i);
      if (k && k.startsWith(`${INBOX_TOKEN_KEY}.`) && k !== mine) all.push(k);
    }
    for (const k of all) store.removeItem(k);
  } catch { /* nothing kept */ }
}

/**
 * valid_until for a token signed now, or null when the tracker's clock (as the wallet reads it) and this device's
 * differ by more than INBOX_MAX_SKEW_MS. The base is the earlier of the server clock and the local one plus
 * INBOX_CLOCK_AHEAD_MS, so a bad clock sample cannot push a token far into the future; then INBOX_VALID_S on top.
 */
export function inboxUntil(serverNowMs: number, localNowMs: number): bigint | null {
  if (!Number.isFinite(serverNowMs) || !Number.isFinite(localNowMs) || Math.abs(serverNowMs - localNowMs) > INBOX_MAX_SKEW_MS) return null;
  const base = Math.min(serverNowMs, localNowMs + INBOX_CLOCK_AHEAD_MS);
  return BigInt(Math.floor(base / 1000) + INBOX_VALID_S);
}

// ─── the answer ─────────────────────────────────────────────────────────────────────────────────

/** The tracker's list for `me`: the notes that check out, newest first, and how many records did not. */
export function parseInbox(text: string, me: string, serverNowMs: number): { items: InboxItem[]; refused: number } | null {
  let data;
  try { data = envelopeData(text).data; } catch { return null; }
  if (data.kind !== "array") return null;
  const items: (InboxItem & { ts: bigint })[] = [];
  let refused = 0;
  const seen = new Set<string>();
  for (const it of data.items) {
    try {
      const n = parseStoredNote(`{"success":true,"data":${text.slice(it.start, it.end)}}`);
      const denom = n.denomination;
      if (!isWalletDenom(denom) || seen.has(`${n.issuer}/${denom}`)) { refused++; continue; }
      const c = checkPreviousNote(n, { issuer: n.issuer, recipient: me, accepted: 0n, serverNowMs, ...(denom === "erg" ? {} : { denomination: denom }) });
      if (!c.ok) { refused++; continue; }
      seen.add(`${n.issuer}/${denom}`);
      items.push({ issuer: n.issuer, denom, view: noteView(n), ts: n.timestamp });
    } catch { refused++; }
  }
  items.sort((a, b) => (a.ts === b.ts ? 0 : a.ts > b.ts ? -1 : 1));
  return { items: items.map(({ ts: _ts, ...x }) => x), refused };
}

/** The payers of a list, each with its denominations, in the list's order. */
export function payersOf(items: readonly InboxItem[]): { pk: string; denoms: Denomination[] }[] {
  const out = new Map<string, Denomination[]>();
  for (const x of items) {
    const d = out.get(x.issuer) ?? [];
    if (!d.includes(x.denom)) d.push(x.denom);
    out.set(x.issuer, d);
  }
  return [...out].map(([pk, denoms]) => ({ pk, denoms }));
}

// ─── the request ────────────────────────────────────────────────────────────────────────────────

export interface InboxDeps {
  fetchImpl?: typeof fetch;
  /** The app's one start queue (≥ 1 s between requests); a user action goes first. */
  queue?: { wait(o?: { priority?: "user" | "poll"; signal?: AbortSignal }): Promise<void> };
  signal?: AbortSignal;
}

async function ask(pub: string, until: string, sig: string, deps: InboxDeps): Promise<{ status: number; text: string } | { failed: string }> {
  if (!PK.test(pub)) return { failed: "not a public key" };
  try { await (deps.queue ?? requestQueue).wait({ priority: "user", signal: deps.signal }); } catch { return { failed: "aborted" }; }
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  deps.signal?.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, TIMEOUT_MS);
  try {
    const res = await (deps.fetchImpl ?? fetch)(PATH + pub, {
      method: "GET",
      headers: { Accept: "application/json", "X-Basis-Inbox-Until": until, "X-Basis-Inbox-Sig": sig },
      credentials: "omit",
      cache: "no-store",
      signal: ctrl.signal,
    });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { failed: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
    deps.signal?.removeEventListener("abort", stop);
  }
}

/** The tracker's `error` text of a refusal, short and plain, or null. */
function refusalText(text: string): string | null {
  try {
    const e = (JSON.parse(text) as { error?: unknown } | null)?.error;
    return typeof e === "string" && e.trim() ? e.trim().replace(/\s+/g, " ").slice(0, 200) : null;
  } catch { return null; }
}

/**
 * Reads the list with a token. 401 (the signature was not taken; `reason` is the tracker's text) and 404 (no such
 * route here) are "closed": the caller drops the token, then retries or falls back to receipt links.
 */
export async function readInbox(pub: string, token: InboxToken, serverNowMs: number, deps: InboxDeps = {}): Promise<InboxAnswer> {
  const a = await ask(pub, token.until, token.sig, deps);
  if ("failed" in a) return { kind: "failed", reason: a.failed };
  if (a.status === 401 || a.status === 404) return { kind: "closed", status: a.status, reason: a.status === 401 ? refusalText(a.text) : null };
  if (a.status === 429) return { kind: "busy" };
  if (a.status !== 200) return { kind: "failed", reason: `HTTP ${a.status}` };
  const list = parseInbox(a.text, pub, serverNowMs);
  return list ? { kind: "list", ...list } : { kind: "failed", reason: "unreadable answer" };
}

/**
 * Whether this tracker has the inbox at all, before the key is unlocked for it: the same request with a signature of
 * zeros, which no key makes. Only a 401 means the inbox is there (worth the passphrase); 404 means no such route
 * (quiet fallback); 429 is busy; anything else (403, 5xx, no answer) failed. Nothing about the key is sent but its
 * public part, which the path names anyway.
 */
export async function probeInbox(pub: string, serverNowMs: number, deps: InboxDeps = {}): Promise<"open" | "closed" | "busy" | "failed"> {
  const a = await ask(pub, String(Math.floor(serverNowMs / 1000) + 60), "00".repeat(65), deps);
  if ("failed" in a) return "failed";
  return a.status === 401 ? "open" : a.status === 404 ? "closed" : a.status === 429 ? "busy" : "failed";
}
