// Live Ergo height for the nav pill: GET /v1/info (same origin) every 30 s, paused while the tab is hidden, one shared
// poller for the whole app (≤ 1 request per 30 s). A failed request keeps the last height and marks it stale.
import { useEffect, useSyncExternalStore } from "react";

export interface HeightState {
  /** Ergo mainnet height, null until the first answer. */
  height: number | null;
  lastBlockId: string | null;
  /** ms timestamp of the last successful answer. */
  updatedAt: number | null;
  /** The last request failed (height may be stale). */
  error: boolean;
}

const PERIOD = 30_000;
let state: HeightState = { height: null, lastBlockId: null, updatedAt: null, error: false };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let inflight = false;
let users = 0;

function set(p: Partial<HeightState>) {
  state = { ...state, ...p };
  for (const f of [...subs]) f();
}

async function poll() {
  if (inflight || typeof fetch === "undefined") return;
  if (typeof document !== "undefined" && document.hidden) return;
  inflight = true;
  const ac = typeof AbortController !== "undefined" ? new AbortController() : null;
  const to = setTimeout(() => ac?.abort(), 10_000);
  try {
    const r = await fetch("/v1/info", { signal: ac?.signal, headers: { accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { height?: number; fullHeight?: number; lastBlockId?: string };
    const h = Number(j.height ?? j.fullHeight);
    if (!Number.isFinite(h) || h <= 0) throw new Error("no height");
    set({ height: h, lastBlockId: j.lastBlockId ?? null, updatedAt: Date.now(), error: false });
  } catch {
    set({ error: true });
  } finally {
    clearTimeout(to);
    inflight = false;
  }
}

function schedule() {
  if (timer) clearTimeout(timer);
  timer = setTimeout(async () => { await poll(); schedule(); }, PERIOD);
}

function onVisible() {
  if (document.hidden) return;
  if (!state.updatedAt || Date.now() - state.updatedAt >= PERIOD) { void poll(); schedule(); }
}

function start() {
  if (users++ > 0 || typeof window === "undefined") return;
  void poll();
  schedule();
  document.addEventListener("visibilitychange", onVisible);
}
function stop() {
  if (--users > 0) return;
  if (timer) clearTimeout(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisible);
}

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const getHeight = (): HeightState => state;

/** The oldest tip a reserve action is planned or signed on (review 2): a minute, two polls. */
export const FRESH_HEIGHT_MS = 60_000;

/** Reads /v1/info now through the shared poller (no second request while one is in flight); the state after it. */
export async function refreshHeight(): Promise<HeightState> {
  await poll();
  return state;
}

/** The height when it is fresh: the last request answered, at most `maxAgeMs` ago; null otherwise (stale, failed). */
export function freshHeight(s: HeightState, now = Date.now(), maxAgeMs = FRESH_HEIGHT_MS): number | null {
  return !s.error && s.height !== null && s.updatedAt !== null && now - s.updatedAt <= maxAgeMs && now >= s.updatedAt - 5_000 ? s.height : null;
}

/** React: the live Ergo height ({ height, lastBlockId, updatedAt, error }). Starts the shared poller while mounted. */
export function useHeight(): HeightState {
  useEffect(() => { start(); return stop; }, []);
  return useSyncExternalStore(subscribe, () => state, () => state);
}
