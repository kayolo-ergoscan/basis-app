// src/chain/ours/client.ts — the only code that talks to our tracker's API: GET `/api/tracker/<route>` on the same
// origin. Never the tracker itself (:3048), never a key: the front in between adds it.
//
// Rules:
//   • at most one request per second: every request start waits for its slot, FIFO, ≥ minGapMs after the previous one
//     (polls, key lookups and the mainnet wallet share one queue, queue.ts; a user action goes ahead of waiting polls);
//   • the mainnet wallet does not use this client: its raw GET/POST and the tracker clock (raw.ts, clock.ts) share the
//     queue and stay out of the first load;
//   • a timeout per request (AbortController);
//   • no retries here: the store decides when to ask again and backs off on 429, 503 and every other failure;
//   • the answer is parsed into a typed model or refused as "shape": a field the app cannot read is never guessed;
//   • u64 amounts arrive as JSON numbers; they are quoted before JSON.parse, so a bigint never passes through a float.
import { parseAddress } from "../decode";
import type { Hex } from "../types";
import { createStartQueue, requestQueue, type Priority, type StartQueue } from "./queue";
import {
  NO_DEBT_RATIO, OURS_POLL,
  type ApiEnvelope, type CollateralConfig, type KeyDenomination, type KeyStatus, type ReservesAnswer, type TrackedReserve, type TrackerState,
} from "./types";

export type TrackerErrorKind =
  | "timeout"      // no answer in time
  | "network"      // the request did not reach a server
  | "rate"         // 429: the front's per-IP limit
  | "unavailable"  // 502 / 503 / 504: the front or the tracker is down or starting
  | "notFound"     // 404: route refused by the front, or no such object
  | "http"         // any other status, or success: false
  | "shape"        // an answer the app cannot read
  | "invalid"      // refused before sending (bad key)
  | "aborted";

export interface TrackerSuccess<T> { ok: true; data: T; status: number; at: number; ms: number; raw: string }
export interface TrackerFailure { ok: false; kind: TrackerErrorKind; status: number | null; message: string; retryAfterMs: number | null; at: number }
export type TrackerAnswer<T> = TrackerSuccess<T> | TrackerFailure;

export interface TrackerClientConfig {
  base: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  minGapMs: number;
  now: () => number;
  /** The start queue (default: one of its own; the app-wide client shares `requestQueue`). */
  queue: StartQueue;
}

export interface TrackerRequestLog { route: string; status: number | string; ms: number; at: number }

export interface RequestOptions { signal?: AbortSignal; priority?: Priority }

export interface TrackerClient {
  readonly config: Readonly<TrackerClientConfig>;
  state(o?: RequestOptions): Promise<TrackerAnswer<TrackerState>>;
  reserves(o?: RequestOptions): Promise<TrackerAnswer<ReservesAnswer>>;
  keyStatus(pk: string, o?: RequestOptions): Promise<TrackerAnswer<KeyStatus>>;
  collateralConfig(o?: RequestOptions): Promise<TrackerAnswer<CollateralConfig>>;
  /** Requests sent so far (every one counts, failed or not). */
  requests(): number;
  /** The last 30 requests. */
  log(): TrackerRequestLog[];
}

// ─── parsing helpers (pure, exported for tests) ──────────────────────────────────────────────────

const HEX = /^[0-9a-f]+$/i;
const isHexOf = (v: unknown, len?: number): v is string => typeof v === "string" && v.length > 0 && HEX.test(v) && (len == null || v.length === len);
const hexOrNull = (v: unknown, len?: number): Hex | null => (isHexOf(v, len) ? v.toLowerCase() : null);
const intOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bigOf = (v: unknown): bigint | null => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);

/** `"key": 123` → `"key": "123"` for the listed keys, so JSON.parse keeps u64 amounts exact. */
export function quoteBigInts(text: string, keys: readonly string[]): string {
  if (!keys.length) return text;
  const re = new RegExp(`"(${keys.join("|")})"(\\s*):(\\s*)(-?\\d+)(?=\\s*[,}\\]])`, "g");
  return text.replace(re, '"$1"$2:$3"$4"');
}

/** A tracker key as the API may send it: 33 bytes, or the GroupElement register form `07‖key`. */
export function normalizeKey(v: unknown): Hex | null {
  if (!isHexOf(v)) return null;
  const h = v.toLowerCase();
  if (h.length === 68 && h.startsWith("07")) return h.slice(2);
  return h.length === 66 ? h : null;
}

/** A tracker NFT id as the API may send it: 32 bytes, or the register form `0e20‖id`. */
export function normalizeNft(v: unknown): Hex | null {
  if (!isHexOf(v)) return null;
  const h = v.toLowerCase();
  if (h.length === 68 && h.startsWith("0e20")) return h.slice(4);
  return h.length === 64 ? h : null;
}

/** A compressed secp256k1 public key (33 bytes, 02/03 prefix). */
export const isPubKey = (s: string): boolean => /^0[23][0-9a-f]{64}$/i.test(s);

/** What a person may type to name a key: the 66-hex public key, or a P2PK address on mainnet. */
export function parseKeyInput(input: string): { ok: true; key: Hex; from: "hex" | "address" } | { ok: false; reason: "empty" | "format" | "notP2pk" | "checksum" | "testnet" } {
  const s = input.trim();
  if (!s) return { ok: false, reason: "empty" };
  if (/^[0-9a-f]+$/i.test(s)) return isPubKey(s) ? { ok: true, key: s.toLowerCase(), from: "hex" } : { ok: false, reason: "format" };
  if (!/^[1-9A-HJ-NP-Za-km-z]{30,}$/.test(s)) return { ok: false, reason: "format" };
  try {
    const a = parseAddress(s);
    if (!a.checksumOk) return { ok: false, reason: "checksum" };
    if (a.network !== "mainnet") return { ok: false, reason: "testnet" };
    if (a.type !== "P2PK" || !isPubKey(a.content)) return { ok: false, reason: "notP2pk" };
    return { ok: true, key: a.content.toLowerCase(), from: "address" };
  } catch {
    return { ok: false, reason: "format" };
  }
}

export function parseState(d: unknown): TrackerState | null {
  if (!isObj(d)) return null;
  const local = hexOrNull(d.local_digest);
  if (!local) return null;
  const tx = hexOrNull(d.pending_tx_id, 64);
  return {
    localDigest: local,
    confirmedDigest: hexOrNull(d.confirmed_digest),
    confirmedBox: hexOrNull(d.confirmed_box_id, 64),
    confirmedHeight: intOrNull(d.confirmed_height),
    pending: tx ? { tx, digest: hexOrNull(d.pending_digest), height: intOrNull(d.pending_submitted_height) } : null,
    trackerBox: hexOrNull(d.tracker_box_id, 64),
  };
}

export function parseReserve(d: unknown): TrackedReserve | null {
  if (!isObj(d)) return null;
  const box = hexOrNull(d.box_id, 64);
  const owner = normalizeKey(d.owner_pubkey);
  const nft = normalizeNft(d.tracker_nft_id);
  const collateral = bigOf(d.collateral_amount);
  const debt = bigOf(d.total_debt);
  const updatedHeight = intOrNull(d.last_updated_height);
  if (!box || !owner || !nft || collateral === null || debt === null || updatedHeight === null) return null;
  const token = d.reserve_token_id === undefined || d.reserve_token_id === "" || d.reserve_token_id === null ? null : hexOrNull(d.reserve_token_id, 64);
  if (d.reserve_token_id && !token) return null;
  const ratio = typeof d.collateralization_ratio === "number" && Number.isFinite(d.collateralization_ratio) && d.collateralization_ratio < NO_DEBT_RATIO && debt > 0n
    ? d.collateralization_ratio : null;
  const pending = bigOf(d.pending_redemption_amount);
  const pendingRedemption = pending !== null && pending <= debt ? pending : 0n;
  return { box, owner, collateral, debt, nft, token, updatedHeight, updatedAt: intOrNull(d.last_updated_timestamp) ?? 0, ratio, refundHeight: intOrNull(d.refund_initiation_height) ?? 0, pendingRedemption };
}

export function parseReserves(d: unknown): ReservesAnswer | null {
  if (!Array.isArray(d)) return null;
  const list: TrackedReserve[] = [];
  let invalid = 0;
  for (const x of d) {
    const r = parseReserve(x);
    if (r) list.push(r); else invalid++;
  }
  return { list, invalid };
}

function parseDenomination(d: unknown): KeyDenomination | null {
  if (!isObj(d) || typeof d.denomination !== "string") return null;
  const debt = bigOf(d.total_debt), collateral = bigOf(d.collateral);
  const decimals = intOrNull(d.decimals), notes = intOrNull(d.note_count);
  if (debt === null || collateral === null || decimals === null || decimals > 18 || notes === null) return null;
  const r = d.collateralization_ratio;
  return {
    id: d.denomination,
    symbol: typeof d.symbol === "string" && d.symbol.length <= 16 ? d.symbol : "",
    decimals,
    debt,
    collateral,
    ratio: typeof r === "number" && Number.isFinite(r) && r < NO_DEBT_RATIO && debt > 0n ? r : null,
    notes,
    reserve: hexOrNull(d.reserve_box_id, 64),
    pendingRefund: d.has_pending_refund === true,
  };
}

export function parseKeyStatus(d: unknown): KeyStatus | null {
  if (!isObj(d) || !Array.isArray(d.denominations)) return null;
  const key = normalizeKey(d.issuer_pubkey);
  const notes = intOrNull(d.note_count);
  if (!key || notes === null) return null;
  const denominations: KeyDenomination[] = [];
  for (const x of d.denominations) {
    const p = parseDenomination(x);
    if (!p) return null;
    denominations.push(p);
  }
  return { key, notes, lastUpdated: intOrNull(d.last_updated) ?? 0, pendingRefund: d.has_pending_refund === true, denominations };
}

export function parseCollateralConfig(d: unknown): CollateralConfig | null {
  if (!isObj(d) || typeof d.erg_contract_p2s !== "string" || typeof d.token_contract_p2s !== "string") return null;
  const denominations = Array.isArray(d.denominations)
    ? d.denominations.filter(isObj).filter((x) => typeof x.id === "string" && typeof x.symbol === "string" && intOrNull(x.decimals) !== null)
      .map((x) => ({ id: x.id as string, symbol: x.symbol as string, decimals: x.decimals as number }))
    : [];
  return { ergP2s: d.erg_contract_p2s, tokenP2s: d.token_contract_p2s, denominations };
}

/** Reads `{ success, data, error }`. Returns the data, or a reason. */
export function readEnvelope(text: string, bigKeys: readonly string[]): { ok: true; data: unknown } | { ok: false; message: string; shape: boolean } {
  let j: unknown;
  try { j = JSON.parse(quoteBigInts(text, bigKeys)); } catch { return { ok: false, message: "answer is not JSON", shape: true }; }
  if (!isObj(j) || typeof j.success !== "boolean") return { ok: false, message: "answer has no success flag", shape: true };
  const env = j as unknown as ApiEnvelope<unknown>;
  if (!env.success) return { ok: false, message: typeof env.error === "string" && env.error ? env.error.slice(0, 300) : "the tracker answered success: false", shape: false };
  return { ok: true, data: env.data };
}

export const retryAfter = (res: Response): number | null => {
  const v = res.headers?.get?.("retry-after");
  if (!v) return null;
  const s = Number(v);
  if (Number.isFinite(s) && s >= 0) return Math.min(s * 1000, 3_600_000);
  const d = Date.parse(v);
  return Number.isFinite(d) ? Math.max(0, Math.min(d - Date.now(), 3_600_000)) : null;
};

const kindOfStatus = (s: number): TrackerErrorKind => (s === 429 ? "rate" : s === 404 ? "notFound" : s === 502 || s === 503 || s === 504 ? "unavailable" : "http");

// ─── the client ──────────────────────────────────────────────────────────────────────────────────

const defaultFetch: typeof fetch = (...a) => fetch(...a);

export function createTrackerClient(partial: Partial<TrackerClientConfig> = {}): TrackerClient {
  const base = { base: "/api/tracker", fetchImpl: defaultFetch, timeoutMs: OURS_POLL.timeoutMs, minGapMs: OURS_POLL.minGapMs, now: () => Date.now(), ...partial };
  const cfg: TrackerClientConfig = {
    ...base,
    queue: partial.queue ?? createStartQueue(base.minGapMs, base.now),
  };
  let count = 0;
  const ring: TrackerRequestLog[] = [];

  /** Waits for this request's start slot in the shared queue (FIFO within a priority, starts ≥ minGapMs apart). */
  const slot = (signal?: AbortSignal, priority: Priority = "poll") => cfg.queue.wait({ signal, priority });

  async function request<T>(route: string, parse: (d: unknown) => T | null, o: RequestOptions & { bigKeys?: readonly string[] } = {}): Promise<TrackerAnswer<T>> {
    const fail = (kind: TrackerErrorKind, message: string, status: number | null = null, ra: number | null = null): TrackerFailure =>
      ({ ok: false, kind, status, message, retryAfterMs: ra, at: cfg.now() });
    try { await slot(o.signal, o.priority); } catch { return fail("aborted", "aborted"); }
    count++;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    o.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, cfg.timeoutMs);
    const t0 = cfg.now();
    const note = (status: number | string) => {
      ring.push({ route, status, ms: cfg.now() - t0, at: t0 });
      if (ring.length > 30) ring.shift();
    };
    try {
      let res: Response;
      try {
        res = await cfg.fetchImpl(cfg.base + route, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" }, credentials: "omit", cache: "no-store" });
      } catch (e) {
        note(timedOut ? "timeout" : o.signal?.aborted ? "aborted" : "network");
        if (timedOut) return fail("timeout", `no answer in ${Math.round(cfg.timeoutMs / 1000)} s`);
        if (o.signal?.aborted) return fail("aborted", "aborted");
        return fail("network", e instanceof Error ? e.message : String(e));
      }
      let text: string;
      try { text = await res.text(); } catch (e) {
        note(timedOut ? "timeout" : "network");
        return fail(timedOut ? "timeout" : "network", e instanceof Error ? e.message : String(e), res.status);
      }
      note(res.status);
      if (!res.ok) {
        // the front and the tracker answer errors as JSON {success: false, error}; keep its words for the detail line
        const env = readEnvelope(text, []);
        return fail(kindOfStatus(res.status), env.ok ? `HTTP ${res.status}` : env.shape ? `HTTP ${res.status}` : env.message, res.status, retryAfter(res));
      }
      const env = readEnvelope(text, o.bigKeys ?? []);
      if (!env.ok) return fail(env.shape ? "shape" : "http", env.message, res.status);
      const data = parse(env.data);
      if (data === null) return fail("shape", "unexpected answer shape", res.status);
      return { ok: true, data, status: res.status, at: cfg.now(), ms: cfg.now() - t0, raw: text };
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    }
  }

  return {
    config: cfg,
    state: (o) => request("/tracker/state", parseState, o),
    reserves: (o) => request("/reserves", parseReserves, { ...o, bigKeys: ["collateral_amount", "total_debt"] }),
    keyStatus: async (pk, o) => {
      const key = pk.trim().toLowerCase();
      if (!isPubKey(key)) return { ok: false, kind: "invalid", status: null, message: "not a 33-byte public key", retryAfterMs: null, at: cfg.now() };
      return request(`/key-status/${key}`, parseKeyStatus, { ...o, bigKeys: ["total_debt", "collateral"] });
    },
    collateralConfig: (o) => request("/config/reserve-collateral", parseCollateralConfig, o),
    requests: () => count,
    log: () => ring.slice(),
  };
}

/** The app-wide client (same origin `/api/tracker`, the shared queue). Tests make their own with createTrackerClient({ fetchImpl, … }). */
export const trackerClient: TrackerClient = createTrackerClient({ queue: requestQueue });
