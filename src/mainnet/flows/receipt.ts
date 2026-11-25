// Note receipts and payment requests (design §6.2): links to our own site with the data in the URL fragment, so it
// never reaches a server log.
//   request: /wallet/mainnet/pay#to=<pk>&amount=<nano>&nft=<tracker>[&d=sigusd|rsada]  (d: a token request, the amount
//            in that token's raw units; absent for ERG)
//   receipt: /wallet/mainnet/receive#note=<base64url of {v,nft,i,r,a,ts,s[,d]}>  (d: "token:<id>" of a token note;
//            absent for ERG, so ERG links are what they were)
// A receipt is verified (the issuer's signature over the 80-byte note message) before the wallet watches anything.
import { TRACKER_NFT, denomOfSlug, denomSlug, isWalletDenom, noteMessage, verifyBasis, type Denomination } from "../tx";

export interface NoteReceipt {
  nft: string;
  issuer: string;
  recipient: string;
  /** The note's cumulative total, nanoERG. */
  total: bigint;
  /** ms since the epoch, as signed. */
  timestamp: bigint;
  /** 65-byte Basis signature, hex. */
  signature: string;
  /** A token note's denomination; absent = ERG. */
  denom?: Denomination;
}

export interface PayRequest { to: string; amount: bigint | null; nft: string; /** a token request; absent = ERG */ denom?: Denomination }

export type ReceiptRefusal = "format" | "version" | "tracker" | "keys" | "same-key" | "signature";

const PK = /^0[23][0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SIG = /^[0-9a-f]{130}$/;
const U63 = /^(0|[1-9]\d{0,18})$/;
const I64_MAX = (1n << 63n) - 1n;

function b64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string | null {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(s)) return null;
  try {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch { return null; }
}

/** The fragment's fields: "#a=1&b=2" → {a: "1", b: "2"}. */
export function fragmentOf(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!h) return out;
  for (const [k, v] of new URLSearchParams(h)) out[k] = v;
  return out;
}

export function encodeReceipt(r: NoteReceipt): string {
  return b64urlEncode(JSON.stringify({ v: 1, nft: r.nft, i: r.issuer, r: r.recipient, a: r.total.toString(), ts: r.timestamp.toString(), s: r.signature, ...(r.denom && r.denom !== "erg" ? { d: r.denom } : {}) }));
}

/** Reads and verifies a receipt (the `note` field of the fragment, or the bare base64url text). */
/** The latest time a JavaScript Date can show (year 275 760), in ms. */
export const RECEIPT_MAX_TS = 8_640_000_000_000_000n;

export function decodeReceipt(text: string, opts: { trackerNft?: string } = {}): { ok: true; receipt: NoteReceipt } | { ok: false; reason: ReceiptRefusal } {
  const raw = b64urlDecode(text.trim());
  if (raw === null) return { ok: false, reason: "format" };
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return { ok: false, reason: "format" }; }
  if (typeof j !== "object" || j === null || Array.isArray(j)) return { ok: false, reason: "format" };
  const o = j as Record<string, unknown>;
  if (o.v !== 1) return { ok: false, reason: "version" };
  const nft = typeof o.nft === "string" ? o.nft.toLowerCase() : "";
  const issuer = typeof o.i === "string" ? o.i.toLowerCase() : "";
  const recipient = typeof o.r === "string" ? o.r.toLowerCase() : "";
  const sig = typeof o.s === "string" ? o.s.toLowerCase() : "";
  if (!HEX64.test(nft) || typeof o.a !== "string" || typeof o.ts !== "string" || !U63.test(o.a) || !U63.test(o.ts) || !SIG.test(sig)) return { ok: false, reason: "format" };
  if (nft !== (opts.trackerNft ?? TRACKER_NFT)) return { ok: false, reason: "tracker" };
  if (!PK.test(issuer) || !PK.test(recipient)) return { ok: false, reason: "keys" };
  if (issuer === recipient) return { ok: false, reason: "same-key" };
  const total = BigInt(o.a), timestamp = BigInt(o.ts);
  // a note's time is a date: past the last one a Date can hold (8.64e15 ms), the link is malformed (keys review P2-4)
  if (total > I64_MAX || timestamp > RECEIPT_MAX_TS) return { ok: false, reason: "format" };
  const d = o.d === undefined ? "erg" : typeof o.d === "string" ? o.d.toLowerCase() : "";
  if (!isWalletDenom(d)) return { ok: false, reason: "format" };
  const receipt: NoteReceipt = { nft, issuer, recipient, total, timestamp, signature: sig, ...(d === "erg" ? {} : { denom: d }) };
  return verifyReceipt(receipt) ? { ok: true, receipt } : { ok: false, reason: "signature" };
}

/** The issuer's signature over the 80-byte note message. */
export function verifyReceipt(r: NoteReceipt): boolean {
  try {
    return verifyBasis(r.issuer, noteMessage({ issuer: r.issuer, recipient: r.recipient, totalDebt: r.total, timestamp: r.timestamp, trackerNft: r.nft, denomination: r.denom ?? "erg" }), r.signature);
  } catch { return false; }
}

export const receiptLink = (origin: string, r: NoteReceipt): string => `${origin}/wallet/mainnet/receive#note=${encodeReceipt(r)}`;

export function requestLink(origin: string, req: PayRequest): string {
  const p = new URLSearchParams({ to: req.to });
  if (req.amount !== null) p.set("amount", req.amount.toString());
  p.set("nft", req.nft);
  if (req.denom && req.denom !== "erg") p.set("d", denomSlug(req.denom));
  return `${origin}/wallet/mainnet/pay#${p.toString()}`;
}

/** A payment request from the fragment; null when there is none or it is not for our tracker. */
export function parseRequest(hash: string, opts: { trackerNft?: string } = {}): PayRequest | null {
  const f = fragmentOf(hash);
  const to = (f.to ?? "").toLowerCase();
  if (!PK.test(to)) return null;
  const nft = (f.nft ?? "").toLowerCase();
  if (nft && nft !== (opts.trackerNft ?? TRACKER_NFT)) return null;
  const amount = f.amount && U63.test(f.amount) && BigInt(f.amount) > 0n && BigInt(f.amount) <= I64_MAX ? BigInt(f.amount) : null;
  // a denomination this wallet does not know is not read as ERG: the request is refused
  const denom = f.d === undefined ? "erg" : denomOfSlug(f.d);
  if (denom === null) return null;
  return denom === "erg" ? { to, amount, nft: opts.trackerNft ?? TRACKER_NFT } : { to, amount, nft: opts.trackerNft ?? TRACKER_NFT, denom };
}
