// src/chain/api.ts — the only place src/chain talks to the network: GET '/v1/...' on the same origin (the ErgoScan API;
// Vite proxies it to 127.0.0.1:4401 in dev, Caddy on basis.ergoscan.me). Amounts come back as strings.
//
// Rules (PRODUCT §4.2 and §6; CHAIN_API.md "Request budget"):
//   • ≤ 2 requests per second, ever, for the whole app: src/chain has one global token bucket (capacity 1, refill 1/s,
//     so its starts are ≥ 1 s apart) and the shell's /v1/info poll (once per 30 s) is the only other /v1 traffic, so any
//     one-second window holds at most one src/chain request plus at most one height poll;
//   • ≤ 6 requests per block per visitor. The shell's height pill (src/app/height.ts) polls /v1/info every 30 s, about
//     4 polls in a 2-minute block, so `heightReserve` keeps 4 of the 6 for it and src/chain spends the other 2.
//     Background work gets a slot only while no user-initiated request waits; an interactive request (useBox, a tx
//     opened by the user) that finds the block spent waits for the next block instead of failing;
//     A block that takes longer than 4 minutes (or a height poll that is down) opens a new budget epoch by time;
//   • while the tab is hidden, background requests are refused ("hidden") and nothing is scheduled;
//   • timeouts (AbortController), retries with exponential backoff + jitter on network errors, timeouts, 429 and 5xx.
//     Every attempt is a request and counts against the budget.
import type { BudgetStats } from "./types";

export type Lane = "background" | "interactive";

export type ChainApiErrorKind = "timeout" | "http" | "network" | "parse" | "aborted" | "budget" | "hidden";

export class ChainApiError extends Error {
  retryAfterMs?: number;
  constructor(public kind: ChainApiErrorKind, public path: string, message: string, public status?: number) {
    super(message);
    this.name = "ChainApiError";
  }
}

export interface ChainApiConfig {
  base: string;                  // "/v1" in the app
  fetchImpl: typeof fetch;
  timeoutMs: number;
  retries: number;               // extra attempts after the first
  backoffMs: number;             // first retry delay; doubles each time (+ up to 30 % jitter)
  ratePerSec: number;            // token refill rate
  burst: number;                 // bucket capacity
  perBlock: number;              // every request of this visitor in one block, height polls included
  heightReserve: number;         // of those, kept for the shell's height poller
  epochMaxMs: number;            // no new block for this long (height poll down, slow chain) → a new budget epoch anyway
  now: () => number;
  isHidden: () => boolean;
  random: () => number;
}

/** Budget defaults. If the shell's height poll moves to 60 s, set heightReserve to 2 and src/chain gets 4 per block. */
export const CHAIN_BUDGET = { perBlock: 6, heightReserve: 4, ratePerSec: 1, burst: 1 } as const;

export interface GetOptions { lane?: Lane; signal?: AbortSignal; timeoutMs?: number; retries?: number }

export interface RequestLogEntry { path: string; lane: Lane; status: number | string; ms: number; at: number; bytes: number | null }

export interface ChainApi {
  readonly config: Readonly<ChainApiConfig>;
  /** GET base + path, parsed as JSON. Throws ChainApiError. */
  get<T>(path: string, opts?: GetOptions): Promise<T>;
  /** A new block was seen (the shell's height poll): a higher height opens a new block budget. */
  newBlock(height: number): void;
  /** The shell made a /v1/info request (counted in the stats; its slots are `heightReserve`). */
  noteHeightPoll(): void;
  /** Would a request in this lane be sent right now (budget, visibility, no interactive request waiting)? */
  canSpend(lane: Lane): boolean;
  /** Data slots left in this block. */
  budgetLeft(): number;
  stats(): BudgetStats;
  log(): RequestLogEntry[];
  subscribe(fn: () => void): () => void;
}

const defaultHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const defaultFetch: typeof fetch = (...a) => fetch(...a);

export function createChainApi(partial: Partial<ChainApiConfig> = {}): ChainApi {
  const cfg: ChainApiConfig = {
    base: "/v1",
    fetchImpl: defaultFetch,
    timeoutMs: 10_000,
    retries: 2,
    backoffMs: 800,
    ratePerSec: CHAIN_BUDGET.ratePerSec,
    burst: CHAIN_BUDGET.burst,
    perBlock: CHAIN_BUDGET.perBlock,
    heightReserve: CHAIN_BUDGET.heightReserve,
    epochMaxMs: 240_000,
    now: () => Date.now(),
    isHidden: defaultHidden,
    random: Math.random,
    ...partial,
  };
  const dataBudget = Math.max(0, cfg.perBlock - cfg.heightReserve);

  // ── token bucket (FIFO) ──
  let tokens = cfg.burst;
  let refilledAt = cfg.now();
  const waiting: { resolve: () => void; signal?: AbortSignal }[] = [];
  let pumpTimer: ReturnType<typeof setTimeout> | null = null;
  const refill = () => {
    const t = cfg.now();
    tokens = Math.min(cfg.burst, tokens + ((t - refilledAt) / 1000) * cfg.ratePerSec);
    refilledAt = t;
  };
  const pump = () => {
    pumpTimer = null;
    refill();
    while (waiting.length && tokens >= 1) {
      const w = waiting.shift()!;
      if (w.signal?.aborted) continue;
      tokens -= 1;
      w.resolve();
    }
    if (waiting.length && !pumpTimer) {
      const ms = Math.max(1, Math.ceil(((1 - tokens) / cfg.ratePerSec) * 1000));
      pumpTimer = setTimeout(pump, ms);
    }
  };
  const acquireToken = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new ChainApiError("aborted", "", "aborted")); return; }
      const w = { resolve, signal };
      waiting.push(w);
      signal?.addEventListener("abort", () => {
        const i = waiting.indexOf(w);
        if (i >= 0) { waiting.splice(i, 1); reject(new ChainApiError("aborted", "", "aborted")); }
      }, { once: true });
      pump();
    });

  // ── per-block budget ──
  let epochHeight = -1;
  let epochStartedAt = cfg.now();
  let used = 0;
  let heightThisBlock = 0;
  let interactiveWaiting = 0;
  let blockWaiters: (() => void)[] = [];
  const byLane: BudgetStats["byLane"] = { height: 0, background: 0, interactive: 0 };
  let requests = 0;
  let lastLatency: number | null = null;
  let latencySum = 0;
  let latencyN = 0;
  const ring: RequestLogEntry[] = [];
  const subs = new Set<() => void>();
  const emit = () => { for (const f of [...subs]) { try { f(); } catch { /* a subscriber's error is not ours */ } } };

  const rollEpoch = () => {
    if (cfg.now() - epochStartedAt < cfg.epochMaxMs) return;
    epochStartedAt = cfg.now();
    used = 0;
    heightThisBlock = 0;
  };
  const admit = (lane: Lane): "budget" | "hidden" | null => {
    rollEpoch();
    if (lane === "background") {
      if (cfg.isHidden()) return "hidden";
      if (interactiveWaiting > 0) return "budget";
    }
    return used < dataBudget ? null : "budget";
  };
  /** Resolves on the next block, or when the epoch times out (then admit() opens a new one). */
  const nextBlock = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => done(), Math.max(1, epochStartedAt + cfg.epochMaxMs - cfg.now()));
      const done = () => { clearTimeout(timer); blockWaiters = blockWaiters.filter((f) => f !== done); signal?.removeEventListener("abort", onAbort); resolve(); };
      const onAbort = () => { clearTimeout(timer); blockWaiters = blockWaiters.filter((f) => f !== done); reject(new ChainApiError("aborted", "", "aborted")); };
      blockWaiters.push(done);
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  /** Waits for a slot (interactive) or refuses (background), then for a token. Returns when the request may start. */
  async function slot(path: string, lane: Lane, signal?: AbortSignal) {
    for (;;) {
      const why = admit(lane);
      if (!why) break;
      if (lane === "background") throw new ChainApiError(why, path, why === "hidden" ? "tab is hidden" : "block budget spent");
      interactiveWaiting++;
      emit();
      try { await nextBlock(signal); } finally { interactiveWaiting--; }
    }
    used++;              // reserve the slot before waiting for the token, so parallel callers cannot overspend
    try { await acquireToken(signal); } catch (e) { used--; throw e; }
  }

  const sleep = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, ms);
      const onAbort = () => { clearTimeout(t); reject(new ChainApiError("aborted", "", "aborted")); };
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  async function once<T>(path: string, lane: Lane, timeoutMs: number, signal?: AbortSignal): Promise<T> {
    await slot(path, lane, signal);
    requests++;
    byLane[lane]++;
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, timeoutMs);
    const t0 = cfg.now();
    const log = (status: number | string, bytes: number | null) => {
      const ms = cfg.now() - t0;
      lastLatency = ms; latencySum += ms; latencyN++;
      ring.push({ path, lane, status, ms, at: t0, bytes });
      if (ring.length > 40) ring.shift();
      emit();
    };
    try {
      let res: Response;
      try {
        res = await cfg.fetchImpl(cfg.base + path, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" }, credentials: "omit" });
      } catch (e) {
        log(timedOut ? "timeout" : signal?.aborted ? "aborted" : "network", null);
        if (timedOut) throw new ChainApiError("timeout", path, `timed out after ${timeoutMs} ms`);
        if (signal?.aborted) throw new ChainApiError("aborted", path, "aborted");
        throw new ChainApiError("network", path, e instanceof Error ? e.message : String(e));
      }
      let text: string;
      try { text = await res.text(); } catch (e) {
        log(timedOut ? "timeout" : "network", null);
        throw new ChainApiError(timedOut ? "timeout" : "network", path, e instanceof Error ? e.message : String(e));
      }
      log(res.status, text.length);
      if (!res.ok) {
        const err = new ChainApiError("http", path, `HTTP ${res.status}`, res.status);
        const ra = Number(res.headers?.get?.("retry-after"));
        if (ra > 0) err.retryAfterMs = Math.min(ra * 1000, 60_000);
        throw err;
      }
      try { return JSON.parse(text) as T; } catch { throw new ChainApiError("parse", path, "response is not JSON"); }
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  const retryable = (e: unknown) =>
    e instanceof ChainApiError && (e.kind === "network" || e.kind === "timeout" || (e.kind === "http" && (e.status === 429 || (e.status ?? 0) >= 500)));

  async function get<T>(path: string, opts: GetOptions = {}): Promise<T> {
    const lane = opts.lane ?? "interactive";
    const retries = opts.retries ?? cfg.retries;
    const timeoutMs = opts.timeoutMs ?? cfg.timeoutMs;
    for (let attempt = 0; ; attempt++) {
      try {
        return await once<T>(path, lane, timeoutMs, opts.signal);
      } catch (e) {
        if (!retryable(e) || attempt >= retries || opts.signal?.aborted) throw e;
        const delay = (e as ChainApiError).retryAfterMs ?? cfg.backoffMs * 2 ** attempt * (1 + 0.3 * cfg.random());
        await sleep(delay, opts.signal);
        if (lane === "background" && admit(lane)) throw e;   // budget spent or tab hidden meanwhile: give up
      }
    }
  }

  return {
    config: cfg,
    get,
    newBlock(height: number) {
      if (!(height > epochHeight)) return;
      const first = epochHeight < 0;
      epochHeight = height;
      if (!first) { used = 0; heightThisBlock = 0; epochStartedAt = cfg.now(); }
      const w = blockWaiters;
      blockWaiters = [];
      for (const f of w) f();
      emit();
    },
    noteHeightPoll() { heightThisBlock++; byLane.height++; emit(); },
    canSpend: (lane) => admit(lane) === null,
    budgetLeft: () => { rollEpoch(); return Math.max(0, dataBudget - used); },
    stats: () => ({
      perBlock: cfg.perBlock,
      usedThisBlock: used + heightThisBlock,
      requests,
      byLane: { ...byLane },
      lastLatencyMs: lastLatency,
      avgLatencyMs: latencyN ? Math.round(latencySum / latencyN) : null,
    }),
    log: () => ring.slice(),
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
  };
}

/** The app-wide client (same origin '/v1'). Tests make their own with createChainApi({ fetchImpl, … }). */
export const chainApi: ChainApi = createChainApi();

// ── endpoint paths (measured on :4401; shapes and timings in CHAIN_API.md) ──
const enc = encodeURIComponent;
export const paths = {
  info: () => `/info`,
  box: (boxId: string) => `/boxes/${enc(boxId)}`,
  tx: (txId: string) => `/transactions/${enc(txId)}`,
  unspentByToken: (tokenId: string) => `/boxes/unspent/byTokenId/${enc(tokenId)}`,
  boxesByToken: (tokenId: string, limit = 50, offset = 0) => `/boxes/byTokenId/${enc(tokenId)}?limit=${limit}&offset=${offset}`,
  unspentByTemplate: (hash: string, limit = 50) => `/boxes/unspent/byErgoTreeTemplateHash/${enc(hash)}?limit=${limit}`,
  boxesByTemplate: (hash: string, limit = 50) => `/boxes/byErgoTreeTemplateHash/${enc(hash)}?limit=${limit}`,
  mempoolByAddress: (address: string) => `/mempool/transactions/byAddress/${enc(address)}`,
  token: (tokenId: string) => `/tokens/${enc(tokenId)}`,
  hostIndex: () => `/defi/basis`,
  /** Unspent boxes at an address, explorer shape with `hasMore` (our tracker's fee funds: its token-free boxes). */
  unspentByAddress: (address: string, limit: number) => `/boxes/unspent/byAddress/${enc(address)}?limit=${limit}`,
};
