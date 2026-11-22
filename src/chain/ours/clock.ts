// src/chain/ours/clock.ts — the tracker's clock as seen from here (wallet design §6.6). The front sends `Date` with every
// answer, from the same host as the tracker. One sample = that header minus the local midpoint of the request (RTT/2
// correction); the offset is the median of the last 5 samples. `Date` has a resolution of one second and is truncated,
// so the estimate runs up to 1 s behind the server: the side the tracker accepts for note timestamps (it refuses a
// note timestamp later than its own clock, with no tolerance).

export interface ServerClock {
  /** Adds the `Date` header of one answer, with the local times the request was sent and answered. */
  sample(dateHeader: string | null | undefined, sentAt: number, receivedAt: number): void;
  /** Server minus local, ms; null before the first sample. */
  offset(): number | null;
  /** The server's clock now: local time + offset (local time alone before any sample). */
  now(): number;
  /** Samples kept (at most 5). */
  samples(): number;
  /** Forgets every sample (a resync starts again from fresh answers). */
  reset(): void;
}

const KEEP = 5;
/** Answers slower than this say too little about the clock. */
const MAX_RTT_MS = 10_000;

export function createServerClock(localNow: () => number = () => Date.now()): ServerClock {
  let ring: number[] = [];
  const offsetOf = (): number | null => {
    if (!ring.length) return null;
    const s = [...ring].sort((a, b) => a - b);
    const m = s.length >> 1;
    return Math.round(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2);
  };
  return {
    sample(dateHeader, sentAt, receivedAt) {
      if (!dateHeader) return;
      const server = Date.parse(dateHeader);
      const rtt = receivedAt - sentAt;
      if (!Number.isFinite(server) || !Number.isFinite(rtt) || rtt < 0 || rtt > MAX_RTT_MS) return;
      ring.push(server - (sentAt + rtt / 2));
      if (ring.length > KEEP) ring = ring.slice(-KEEP);
    },
    offset: offsetOf,
    now: () => localNow() + (offsetOf() ?? 0),
    samples: () => ring.length,
    reset() { ring = []; },
  };
}
