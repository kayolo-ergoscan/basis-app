// src/chain/ours/queue.ts — the one start queue of a visitor's requests to our tracker's front (and, for the mainnet
// wallet, its /v1 reads): every start waits for its turn, starts are ≥ minGapMs apart, FIFO within a priority, and a
// user action ("user") goes ahead of the polls that wait ("poll"). Nothing is dropped: an aborted wait leaves the
// queue, and the gap between two real starts never shrinks.
import { OURS_POLL } from "./types";

export type Priority = "user" | "poll";

export interface StartQueue {
  readonly minGapMs: number;
  /** Resolves when this request may start; rejects with Error("aborted") when the signal aborts first. */
  wait(o?: { priority?: Priority; signal?: AbortSignal }): Promise<void>;
  /** Requests waiting for their start now. */
  waiting(): number;
  /** Starts so far. */
  started(): number;
}

interface Waiter { pri: number; resolve: () => void; signal?: AbortSignal; onAbort?: () => void }

const RANK: Record<Priority, number> = { user: 1, poll: 0 };

export function createStartQueue(minGapMs: number, now: () => number = () => Date.now()): StartQueue {
  let lastStart = -Infinity;
  let starts = 0;
  const queue: Waiter[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const begin = () => { lastStart = now(); starts++; };

  function pump() {
    timer = null;
    if (!queue.length) return;
    const due = lastStart + minGapMs - now();
    if (due > 0) { timer = setTimeout(pump, due); return; }
    let best = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].pri > queue[best].pri) best = i;
    const w = queue.splice(best, 1)[0];
    if (w.onAbort) w.signal?.removeEventListener("abort", w.onAbort);
    begin();
    w.resolve();
    if (queue.length) timer = setTimeout(pump, minGapMs);
  }

  return {
    minGapMs,
    wait(o = {}) {
      const { signal } = o;
      if (signal?.aborted) return Promise.reject(new Error("aborted"));
      if (!queue.length && now() >= lastStart + minGapMs) { begin(); return Promise.resolve(); }
      return new Promise<void>((resolve, reject) => {
        const w: Waiter = { pri: RANK[o.priority ?? "poll"], resolve, signal };
        if (signal) {
          w.onAbort = () => {
            const i = queue.indexOf(w);
            if (i >= 0) queue.splice(i, 1);
            reject(new Error("aborted"));
          };
          signal.addEventListener("abort", w.onAbort, { once: true });
        }
        queue.push(w);
        if (!timer) pump();
      });
    },
    waiting: () => queue.length,
    started: () => starts,
  };
}

/** The app-wide queue: the tracker client's polls and lookups, and every request of the mainnet wallet. */
export const requestQueue: StartQueue = createStartQueue(OURS_POLL.minGapMs);
