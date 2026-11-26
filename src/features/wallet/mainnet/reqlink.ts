// A payment request link's two optional words, and the request that waits while the payer sets up a key.
//
// Labels: the receiver may add how to sign them («name») and what the payment is for («memo»). They ride in the link's
// fragment after the request's own fields (#to=…&amount=…&nft=…[&d=…]&name=…&memo=…), so no server ever sees them.
// They are not part of the note, are never sent to the tracker, and nobody checked them: the screens show them as
// plain text, capped, next to a line that says so. A link without them is read exactly as before (parseRequest in
// src/mainnet/flows reads only its own fields).
//
// The pending request: a payer without a key opens the link, starts key setup, and comes back to the same request.
// It is kept in this tab's sessionStorage (the canonical fragment only) and cleared once it is paid or dropped.
import { useSyncExternalStore } from "react";
import { fragmentOf, parseRequest, requestLink, type PayRequest } from "@/mainnet/flows";

/** At most this many characters (code points): a name, and what the payment is for. Short enough for a QR code
 *  (a Cyrillic letter takes 6 characters in the link). */
export const NAME_MAX = 24;
export const MEMO_MAX = 48;

/** A link this long gets a bigger QR code, so its finer modules still scan from a screen. */
export const LONG_LINK = 400;

export interface RequestLabels { name: string | null; memo: string | null }

/** One line of plain text: no control, format or bidi characters, single spaces, at most `max` characters. */
export function cleanLabel(s: string, max: number): string {
  const one = s.normalize("NFC").replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, " ").replace(/\s+/gu, " ").trim();
  return Array.from(one).slice(0, max).join("").trim();
}

/** The labels of a request link's fragment (none: both null). */
export function labelsOf(hash: string): RequestLabels {
  const f = fragmentOf(hash);
  const name = cleanLabel(f.name ?? "", NAME_MAX);
  const memo = cleanLabel(f.memo ?? "", MEMO_MAX);
  return { name: name || null, memo: memo || null };
}

/** The request link with the labels after requestLink's own fields; without labels it is exactly requestLink's link. */
export function labelledRequestLink(origin: string, req: PayRequest, labels: Partial<RequestLabels>): string {
  const base = requestLink(origin, req);
  const p = new URLSearchParams();
  const name = cleanLabel(labels.name ?? "", NAME_MAX);
  const memo = cleanLabel(labels.memo ?? "", MEMO_MAX);
  if (name) p.set("name", name);
  if (memo) p.set("memo", memo);
  const extra = p.toString();
  return extra ? `${base}&${extra}` : base;
}

/** The request and its labels from a fragment, or null when it holds no request for our tracker. `hash` is the
 *  canonical fragment (what the pending store keeps and the Pay screen is opened with). */
export interface OpenRequest { hash: string; req: PayRequest; labels: RequestLabels }
export function openRequest(hash: string): OpenRequest | null {
  const req = parseRequest(hash);
  if (!req) return null;
  const labels = labelsOf(hash);
  const link = labelledRequestLink("", req, labels);
  return { hash: link.slice(link.indexOf("#")), req, labels };
}

// ─── the pending request (this tab only) ────────────────────────────────────────────────────────

export const PENDING_KEY = "basis.mw.request";
const EVENT = "basis:mw-request";

function read(): string | null {
  try { return sessionStorage.getItem(PENDING_KEY); } catch { return null; }
}
function changed() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Keeps the request of this fragment for the tab (nothing when the fragment holds none). */
export function keepPending(hash: string) {
  const o = openRequest(hash);
  if (!o || read() === o.hash) return;
  try { sessionStorage.setItem(PENDING_KEY, o.hash); } catch { /* storage off: the request is simply not kept */ }
  changed();
}

export function clearPending() {
  if (read() === null) return;
  try { sessionStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
  changed();
}

export function pendingNow(): OpenRequest | null {
  const h = read();
  return h ? openRequest(h) : null;
}

const subscribe = (f: () => void) => {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, f);
  return () => window.removeEventListener(EVENT, f);
};

/** The tab's pending request (its canonical fragment), re-read when it is kept or cleared. */
export function usePendingHash(): string | null {
  return useSyncExternalStore(subscribe, read, () => null);
}
