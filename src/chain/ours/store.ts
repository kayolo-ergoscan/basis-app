// src/chain/ours/store.ts — polls our tracker while someone watches (ref-counted acquire, like the chain store):
//   /tracker/state every 30 s and /reserves every 120 s (both from the tracker's front),
//   the fee funds at the tracker address from /v1 (its token-free unspent boxes, through the chain module's budget):
//   once as soon as a page that shows them opens, then every 30 min and after each new commit.
// Nothing is requested while the tab is hidden or nobody watches. A failed poll backs off: 30 s, 60 s, 120 s … 10 min
// (or the server's Retry-After when it is longer); one success resets it.
// The last good answers are kept in memory and saved in this browser (as the raw answer, parsed again on load), so an
// unreachable tracker still shows its last known state with the age of that answer. Events (a new commit, a new
// reserve) come only from two fresh answers of this session that differ; a new commit is also the app's one mainnet
// pulse for our tracker.
import { createStore, type StoreApi } from "zustand/vanilla";
import { pulse as appPulse, type Pulse } from "@/app/pulse";
import { chainApi, paths } from "../api";
import type { Hex } from "../types";
import { parseReserves, parseState, readEnvelope, trackerClient, type TrackerAnswer, type TrackerClient, type TrackerErrorKind } from "./client";
import { commitEvent, reserveEvents } from "./model";
import { OUR_TRACKER, OURS_POLL, type FeeFunds, type KeyStatus, type OurEvent, type ReservesAnswer, type TrackerState } from "./types";

export interface Snap<T> {
  data: T;
  /** When it was answered (ms since epoch). */
  at: number;
  /** Loaded from this browser's storage (an earlier visit), not answered in this session. */
  cached: boolean;
  /** The raw answer, for the machine face. */
  raw?: string;
}

export interface OursError { kind: TrackerErrorKind; status: number | null; message: string; at: number }

export interface OursState {
  /** Someone watches (a mounted hook). */
  active: boolean;
  hidden: boolean;
  state: Snap<TrackerState> | null;
  reserves: Snap<ReservesAnswer> | null;
  fees: Snap<FeeFunds> | null;
  /** When /tracker/state last answered in this session (null: not yet). */
  fresh: number | null;
  /** The latest failure of each poll; cleared by that poll's next answer. */
  stateError: OursError | null;
  reservesError: OursError | null;
  /** Failures in a row (any request); one answer resets them. */
  failures: number;
  /** No poll before `until`; `kind` is the failure that caused it (a 429 is "rate"). */
  backoff: { until: number; kind: TrackerErrorKind } | null;
  /** Newest first, at most 20, derived from polling only. */
  events: OurEvent[];
  requests: number;
}

export interface OursStoreOptions {
  client?: TrackerClient;
  /** Fee funds at an address; throws when they cannot be read now (budget, hidden tab, network). null: never read them.
   *  `first`: not read in this session yet (the page shows "—", or the saved value, until it comes). */
  feesOf?: ((address: string, first: boolean) => Promise<FeeFunds>) | null;
  pulse?: { commit(p: Pulse): void; last?(): Pulse | null };
  now?: () => number;
  isHidden?: () => boolean;
  random?: () => number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

export const OURS_STORAGE_KEY = "basis.ours.v1";
const MAX_EVENTS = 20;
const MAX_SAVED_CHARS = 256 * 1024;
const STATE_BIG: readonly string[] = [];
const RESERVES_BIG = ["collateral_amount", "total_debt"] as const;

/** One page of unspent boxes is enough for a tracker address (its NFT box and one change box); more → a lower bound. */
export const FEES_PAGE = 100;

/** Fee funds from a /v1 unspent-box list: the sum of the boxes that hold no token (the box with the tracker NFT, or any
 *  box with a token, is not fee money). Throws on an unexpected shape. */
export function feeFundsOf(list: unknown): FeeFunds {
  const j = list as { items?: unknown; hasMore?: unknown; total?: unknown } | null;
  if (!j || !Array.isArray(j.items)) throw new Error("unexpected box list");
  let nano = 0n;
  let boxes = 0;
  for (const it of j.items as { value?: unknown; assets?: unknown }[]) {
    const v = typeof it?.value === "string" ? it.value : typeof it?.value === "number" && Number.isSafeInteger(it.value) ? String(it.value) : null;
    if (v === null || !/^\d{1,20}$/.test(v) || !Array.isArray(it.assets)) throw new Error("unexpected box in the list");
    if (it.assets.length > 0) continue;
    nano += BigInt(v);
    boxes++;
  }
  const partial = j.hasMore === true || (typeof j.total === "number" && j.total > j.items.length);
  return { nano, boxes, partial };
}

/** Fee funds at an address through the chain module's request budget, no retries. The first read of a visit takes the
 *  interactive lane and is asked as soon as a page that shows it opens, so it gets one of the block's /v1 slots before
 *  the chain module's background checks (and waits for the next block only when the budget is already spent);
 *  refreshes take the background lane and simply try again later. */
export async function feesFromChain(address: string, first: boolean): Promise<FeeFunds> {
  const j = await chainApi.get<unknown>(paths.unspentByAddress(address, FEES_PAGE), { lane: first ? "interactive" : "background", retries: 0 });
  return feeFundsOf(j);
}

const defaultStorage = (): OursStoreOptions["storage"] => {
  try { return typeof localStorage !== "undefined" ? localStorage : null; } catch { return null; }
};

export type OursStore = ReturnType<typeof createOursStore>;

export function createOursStore(opts: OursStoreOptions = {}) {
  const client = opts.client ?? trackerClient;
  const feesOf = opts.feesOf === undefined ? feesFromChain : opts.feesOf;
  const bus = opts.pulse ?? appPulse;
  const now = opts.now ?? (() => Date.now());
  const random = opts.random ?? Math.random;
  const hidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const storage = opts.storage === undefined ? defaultStorage() : opts.storage;

  const store: StoreApi<OursState> = createStore<OursState>(() => ({
    active: false, hidden: false, state: null, reserves: null, fees: null, fresh: null,
    stateError: null, reservesError: null, failures: 0, backoff: null, events: [], requests: 0,
  }));
  const get = store.getState;
  const set = (p: Partial<OursState>) => store.setState({ ...p, requests: client.requests() });

  let users = 0;
  let feeUsers = 0;   // mounted hooks that show the fee funds (only they make the /v1 read)
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let lastStateTry: number | null = null;
  let lastReservesTry: number | null = null;
  let loaded = false;
  // the session's own baselines for events (never the saved answers of an earlier visit)
  let prevState: TrackerState | null = null;
  let prevReserves: ReservesAnswer | null = null;
  // fee funds bookkeeping
  let feesBusy = false;
  let feesRetryAt = 0;
  let feesForBox: Hex | null = null;

  // ── saved answers: the raw text, parsed again with the same parser on load ──
  function load() {
    if (loaded) return;
    loaded = true;
    if (!storage) return;
    try {
      const s = storage.getItem(OURS_STORAGE_KEY);
      if (!s) return;
      const j = JSON.parse(s) as { v?: number; state?: { raw?: unknown; at?: unknown }; reserves?: { raw?: unknown; at?: unknown }; fees?: { nano?: unknown; boxes?: unknown; partial?: unknown; at?: unknown } };
      if (j?.v !== 1) return;
      const cur = get();
      const p: Partial<OursState> = {};
      const old = (x: { raw?: unknown; at?: unknown } | undefined) => (x && typeof x.raw === "string" && typeof x.at === "number" && x.at <= now() ? { raw: x.raw, at: x.at } : null);
      const st = old(j.state);
      if (st && !cur.state) {
        const e = readEnvelope(st.raw, STATE_BIG);
        const d = e.ok ? parseState(e.data) : null;
        if (d) p.state = { data: d, at: st.at, cached: true, raw: st.raw };
      }
      const rs = old(j.reserves);
      if (rs && !cur.reserves) {
        const e = readEnvelope(rs.raw, RESERVES_BIG);
        const d = e.ok ? parseReserves(e.data) : null;
        if (d) p.reserves = { data: d, at: rs.at, cached: true, raw: rs.raw };
      }
      // (an older entry's "balance" counted the NFT box too: it is ignored)
      const f = j.fees;
      if (f && !cur.fees && typeof f.nano === "string" && /^\d{1,30}$/.test(f.nano) && typeof f.boxes === "number" && typeof f.partial === "boolean" && typeof f.at === "number" && f.at <= now()) {
        p.fees = { data: { nano: BigInt(f.nano), boxes: f.boxes, partial: f.partial }, at: f.at, cached: true };
      }
      if (Object.keys(p).length) set(p);
    } catch { /* a broken entry is ignored; the next answer replaces it */ }
  }
  function save() {
    if (!storage) return;
    const s = get();
    const keep = (x: Snap<unknown> | null) => (x?.raw && x.raw.length <= MAX_SAVED_CHARS ? { raw: x.raw, at: x.at } : null);
    try {
      storage.setItem(OURS_STORAGE_KEY, JSON.stringify({
        v: 1,
        state: keep(s.state),
        reserves: keep(s.reserves),
        fees: s.fees ? { nano: s.fees.data.nano.toString(), boxes: s.fees.data.boxes, partial: s.fees.data.partial, at: s.fees.at } : null,
      }));
    } catch { /* storage full or blocked: the in-memory answers still work */ }
  }

  // ── failures and backoff (shared: a 429 or a 503 is about the front, whichever route met it) ──
  type Poll = "state" | "reserves" | null;
  function failed(which: Poll, a: Extract<TrackerAnswer<unknown>, { ok: false }>) {
    if (a.kind === "aborted" || a.kind === "invalid") return;
    const failures = get().failures + 1;
    const base = Math.min(OURS_POLL.backoffBaseMs * 2 ** (failures - 1), OURS_POLL.backoffMaxMs);
    const wait = Math.max(a.retryAfterMs ?? 0, base * (1 + 0.2 * random()));
    const err: OursError = { kind: a.kind, status: a.status, message: a.message, at: a.at };
    set({
      ...(which === "state" ? { stateError: err } : which === "reserves" ? { reservesError: err } : {}),
      failures,
      backoff: { until: now() + wait, kind: a.kind },
    });
  }
  function succeeded(which: Exclude<Poll, null>, at: number) {
    set({ ...(which === "state" ? { stateError: null, fresh: at } : { reservesError: null }), failures: 0, backoff: null });
  }
  const blockedUntil = () => { const b = get().backoff; return b !== null && b.until > now() ? b.until : null; };

  function addEvents(list: OurEvent[]) {
    if (!list.length) return;
    const seen = new Set(get().events.map((e) => e.id));
    const fresh = list.filter((e) => !seen.has(e.id));
    if (fresh.length) set({ events: [...fresh.reverse(), ...get().events].slice(0, MAX_EVENTS) });
  }

  function emitPulse(digest: Hex, height: number) {
    try {
      const l = bus.last?.();
      // the chain module may have seen the same box first (a focused tracker): one commitment = one pulse
      if (l && l.source === "mainnet" && l.trackerId === OUR_TRACKER.nft && l.digest === digest && l.height === height) return;
      bus.commit({ source: "mainnet", trackerId: OUR_TRACKER.nft, digest, height });
    } catch { /* bus errors are the shell's */ }
  }

  // ── polls ──
  async function pollState(): Promise<boolean> {
    lastStateTry = now();
    const a = await client.state();
    if (!a.ok) { failed("state", a); return false; }
    const ev = commitEvent(prevState, a.data, a.at);
    prevState = a.data;
    set({ state: { data: a.data, at: a.at, cached: false, raw: a.raw } });
    succeeded("state", a.at);
    if (ev) {
      addEvents([ev]);
      if (ev.kind === "commit" && ev.digest && ev.height !== null) emitPulse(ev.digest, ev.height);
    }
    save();
    return true;
  }

  async function pollReserves(): Promise<boolean> {
    lastReservesTry = now();
    const a = await client.reserves();
    if (!a.ok) { failed("reserves", a); return false; }
    const ev = reserveEvents(prevReserves?.list ?? null, a.data.list, a.at);
    prevReserves = a.data;
    set({ reserves: { data: a.data, at: a.at, cached: false, raw: a.raw } });
    succeeded("reserves", a.at);
    addEvents(ev);
    save();
    return true;
  }

  function maybeFees() {
    if (!feesOf || feesBusy || feeUsers === 0 || hidden()) return;
    const t = now();
    if (t < feesRetryAt) return;
    const f = get().fees;
    const s = get().state;
    const box = s && !s.cached ? s.data.confirmedBox : null;
    // read before the first state answer (at page load): the box of that answer is the baseline for "moved"
    if (feesForBox === null && box !== null && f && !f.cached) feesForBox = box;
    const moved = box !== null && feesForBox !== null && box !== feesForBox;
    if (f && !f.cached && t - f.at < OURS_POLL.feesMs && !moved) return;
    feesBusy = true;
    feesOf(OUR_TRACKER.address, !f || f.cached)
      .then((data) => { feesForBox = box ?? feesForBox; set({ fees: { data, at: now(), cached: false } }); save(); })
      .catch(() => { feesRetryAt = now() + 60_000; })
      .finally(() => { feesBusy = false; });
  }

  // ── the loop ──
  const due = (last: number | null, every: number) => last === null || now() - last >= every;
  function schedule() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (users === 0 || hidden()) return;
    const t = now();
    const nextPoll = Math.min(lastStateTry === null ? t : lastStateTry + OURS_POLL.stateMs, lastReservesTry === null ? t : lastReservesTry + OURS_POLL.reservesMs);
    const at = Math.max(nextPoll, blockedUntil() ?? 0);
    timer = setTimeout(() => { timer = null; void tick(); }, Math.max(250, at - t));
  }

  async function tick() {
    if (running) return;
    if (timer) { clearTimeout(timer); timer = null; }
    if (users === 0) return;
    if (hidden()) { if (!get().hidden) set({ hidden: true }); return; }
    if (get().hidden) set({ hidden: false });
    running = true;
    try {
      const go = () => users > 0 && !hidden() && blockedUntil() === null;
      if (go() && due(lastStateTry, OURS_POLL.stateMs)) await pollState();
      if (go() && due(lastReservesTry, OURS_POLL.reservesMs)) await pollReserves();
      if (users > 0) maybeFees();
    } finally {
      running = false;
      schedule();
    }
  }

  const onVisibility = () => {
    if (!hidden()) { void tick(); return; }
    if (timer) { clearTimeout(timer); timer = null; }
    set({ hidden: true });
  };

  /** A hook mounted: load the saved answers, start polling. `fees`: it shows the fee funds, which are then read at once
   *  (before the polls) unless this session has them. Returns release(). */
  function acquire(o: { fees?: boolean } = {}): () => void {
    users++;
    if (o.fees) feeUsers++;
    if (users === 1) {
      load();
      set({ active: true, hidden: hidden() });
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
    }
    if (o.fees) maybeFees();
    if (users === 1) void tick();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (o.fees) feeUsers = Math.max(0, feeUsers - 1);
      users = Math.max(0, users - 1);
      if (users === 0) {
        if (timer) { clearTimeout(timer); timer = null; }
        if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
        set({ active: false });
      }
    };
  }

  /** One user-initiated key lookup (shares the one-per-second queue). Refused while the front asks us to slow down. */
  async function lookupKey(pk: Hex, signal?: AbortSignal): Promise<TrackerAnswer<KeyStatus>> {
    const b = blockedUntil();
    if (b !== null && get().backoff?.kind === "rate") {
      return { ok: false, kind: "rate", status: 429, message: "the tracker front asked this page to slow down", retryAfterMs: b - now(), at: now() };
    }
    const a = await client.keyStatus(pk, { signal });
    if (!a.ok && (a.kind === "rate" || a.kind === "unavailable")) failed(null, a);
    else set({});
    return a;
  }

  return {
    store,
    acquire,
    tick,
    lookupKey,
    /** Test/dev: drop timers and listeners. */
    dispose: () => {
      users = 0;
      if (timer) { clearTimeout(timer); timer = null; }
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}

/** The app-wide store. */
export const ours = createOursStore();
