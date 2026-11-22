// Block height ↔ time for axes. Ergo averages about two minutes per block, but over months the drift is days, so the
// axes interpolate between real (height, time) pairs from the observatory (reserve boxes, redemptions, NFT mints and
// the snapshot itself) and extrapolate at 120 s per block only past the last known pair.
import type { Observatory } from "@/chain";

export interface ChainClock {
  toTime(height: number): number;
  toHeight(ms: number): number;
}

const BLOCK_MS = 120_000;

export function makeClock(obs: Observatory): ChainClock {
  const pairs = new Map<number, number>();
  const add = (h: number | null | undefined, at: string | null | undefined) => {
    if (h == null || !at) return;
    const ms = Date.parse(at);
    if (Number.isFinite(ms) && !pairs.has(h)) pairs.set(h, ms);
  };
  add(obs.asOf.height, obs.asOf.at);
  for (const r of obs.reserves) add(r.height, r.at);
  for (const r of obs.redemptions) add(r.height, r.at);
  for (const t of obs.trackers) add(t.mint.height, t.mint.at);
  const pts = [...pairs.entries()].sort((a, b) => a[0] - b[0]);
  // keep the series monotonic in time (a box's creationHeight can be older than its block)
  const mono: [number, number][] = [];
  for (const p of pts) if (!mono.length || p[1] > mono[mono.length - 1][1]) mono.push(p);
  const hs = mono.map((p) => p[0]), ts = mono.map((p) => p[1]);

  const toTime = (h: number) => {
    if (!hs.length) return Date.now();
    if (h <= hs[0]) return ts[0] + (h - hs[0]) * BLOCK_MS;
    if (h >= hs[hs.length - 1]) return ts[ts.length - 1] + (h - hs[hs.length - 1]) * BLOCK_MS;
    let lo = 0, hi = hs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (hs[m] <= h) lo = m; else hi = m; }
    return ts[lo] + ((ts[hi] - ts[lo]) * (h - hs[lo])) / (hs[hi] - hs[lo]);
  };
  const toHeight = (ms: number) => {
    if (!ts.length) return 0;
    if (ms <= ts[0]) return hs[0] + (ms - ts[0]) / BLOCK_MS;
    if (ms >= ts[ts.length - 1]) return hs[hs.length - 1] + (ms - ts[ts.length - 1]) / BLOCK_MS;
    let lo = 0, hi = ts.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ts[m] <= ms) lo = m; else hi = m; }
    return hs[lo] + ((hs[hi] - hs[lo]) * (ms - ts[lo])) / (ts[hi] - ts[lo]);
  };
  return { toTime, toHeight };
}

/** First instants of each UTC month in [from, to] (ms). */
export function monthStarts(from: number, to: number): number[] {
  const out: number[] = [];
  const d = new Date(from);
  let y = d.getUTCFullYear(), m = d.getUTCMonth() + 1;
  for (;;) {
    if (m > 11) { m = 0; y++; }
    const t = Date.UTC(y, m, 1);
    if (t > to) break;
    out.push(t);
    m++;
  }
  return out;
}
