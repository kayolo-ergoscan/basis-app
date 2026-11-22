// src/chain/ours/raw.ts — the mainnet wallet's way to the tracker front and to /v1: any route, GET or POST, through the
// app's one start queue (queue.ts: ≥ 1 s between starts, a user action ahead of waiting polls), the answer as text with
// its status, never re-stringified (src/mainnet/net reads the status and the body itself).
//
// Rules:
//   • every answer's `Date` header feeds this client's clock (clock.ts, wallet design §6.6); the wallet keeps one raw
//     client per origin, so the ErgoScan API's `Date` never moves the tracker's clock;
//   • any HTTP status is an answer; only a request that got none (timeout, network, aborted) is a failure;
//   • a timeout per request (AbortController); no retries here.
// Only the lazy wallet imports this module (by its path, not through index.ts): none of it is in the first load.
import { createServerClock, type ServerClock } from "./clock";
import { retryAfter, type TrackerRequestLog } from "./client";
import { createStartQueue, type Priority, type StartQueue } from "./queue";
import { OURS_POLL } from "./types";

export interface RawOptions {
  method?: "GET" | "POST";
  /** POST body, sent byte for byte as `application/json`. */
  body?: string;
  priority?: Priority;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** A raw answer: any HTTP status counts as an answer; only a request that got none is a failure. */
export type RawAnswer =
  | { ok: true; status: number; text: string; retryAfterMs: number | null; sentAt: number; receivedAt: number }
  | { ok: false; kind: "timeout" | "network" | "aborted"; message: string; sentAt: number | null };

export interface RawClientConfig {
  /** Same-origin prefix: `/api/tracker` or `/v1`. */
  base: string;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  now: () => number;
  /** The start queue (default: one of its own; the wallet passes the app-wide `requestQueue`). */
  queue: StartQueue;
  /** The clock this origin's `Date` headers feed (default: one of its own). */
  clock: ServerClock;
}

export interface RawClient {
  readonly config: Readonly<RawClientConfig>;
  readonly clock: ServerClock;
  raw(route: string, o?: RawOptions): Promise<RawAnswer>;
  /** Requests sent so far (every one counts, failed or not). */
  requests(): number;
  /** The last 30 requests. */
  log(): TrackerRequestLog[];
}

const defaultFetch: typeof fetch = (...a) => fetch(...a);

export function createRawClient(partial: Partial<RawClientConfig> & { base: string }): RawClient {
  const base = { fetchImpl: defaultFetch, timeoutMs: OURS_POLL.timeoutMs, now: () => Date.now(), ...partial };
  const cfg: RawClientConfig = {
    ...base,
    queue: partial.queue ?? createStartQueue(OURS_POLL.minGapMs, base.now),
    clock: partial.clock ?? createServerClock(base.now),
  };
  let count = 0;
  const ring: TrackerRequestLog[] = [];

  async function raw(route: string, o: RawOptions = {}): Promise<RawAnswer> {
    const method = o.method ?? "GET";
    try { await cfg.queue.wait({ signal: o.signal, priority: o.priority ?? "poll" }); } catch { return { ok: false, kind: "aborted", message: "aborted", sentAt: null }; }
    count++;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    o.signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const limit = o.timeoutMs ?? cfg.timeoutMs;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, limit);
    const t0 = cfg.now();
    const note = (status: number | string) => {
      ring.push({ route: method === "GET" ? route : `${method} ${route}`, status, ms: cfg.now() - t0, at: t0 });
      if (ring.length > 30) ring.shift();
    };
    const failed = (e: unknown): RawAnswer => {
      note(timedOut ? "timeout" : o.signal?.aborted ? "aborted" : "network");
      if (timedOut) return { ok: false, kind: "timeout", message: `no answer in ${Math.round(limit / 1000)} s`, sentAt: t0 };
      if (o.signal?.aborted) return { ok: false, kind: "aborted", message: "aborted", sentAt: t0 };
      return { ok: false, kind: "network", message: e instanceof Error ? e.message : String(e), sentAt: t0 };
    };
    try {
      let res: Response;
      try {
        const headers: Record<string, string> = { Accept: "application/json" };
        if (method === "POST") headers["Content-Type"] = "application/json";
        res = await cfg.fetchImpl(cfg.base + route, { method, signal: ctrl.signal, headers, body: method === "POST" ? o.body ?? "" : undefined, credentials: "omit", cache: "no-store" });
      } catch (e) { return failed(e); }
      let text: string;
      try { text = await res.text(); } catch (e) { return failed(e); }
      const t1 = cfg.now();
      note(res.status);
      cfg.clock.sample(res.headers?.get?.("date"), t0, t1);
      return { ok: true, status: res.status, text, retryAfterMs: retryAfter(res), sentAt: t0, receivedAt: t1 };
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", onAbort);
    }
  }

  return { config: cfg, clock: cfg.clock, raw, requests: () => count, log: () => ring.slice() };
}
