// src/chain/ours/hooks.ts — React over the store. useOurTracker() mounts the poller (ref-counted: the first watcher starts
// it, the last one stops it) and joins its answers with the shell's chain height. useKeyLookup() runs one lookup at a
// time through the same one-per-second queue.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useHeight } from "@/app/height";
import { useT } from "@/app/lang";
import type { Hex } from "../types";
import type { TrackerAnswer } from "./client";
import { agoParts, ourView, type OurView } from "./model";
import { ours, type OursState } from "./store";
import type { KeyStatus } from "./types";

const getState = (): OursState => ours.store.getState();

/** Everything the pages show about our tracker; re-renders on each answer and each new block. */
export function useOurTracker(): OurView {
  useEffect(() => ours.acquire(), []);
  const s = useSyncExternalStore(ours.store.subscribe, getState, getState);
  const { height } = useHeight();
  return useMemo(() => ourView(s, height), [s, height]);
}

export type KeyLookup =
  | { phase: "idle" }
  | { phase: "loading"; key: Hex }
  | { phase: "done"; key: Hex; answer: TrackerAnswer<KeyStatus> };

/** One key lookup at a time; a new one cancels the previous. The result stays until the next lookup or reset(). */
export function useKeyLookup(): { lookup: KeyLookup; run: (key: Hex) => void; reset: () => void } {
  const [lookup, setLookup] = useState<KeyLookup>({ phase: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);
  const run = useCallback((key: Hex) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setLookup({ phase: "loading", key });
    void ours.lookupKey(key, c.signal).then((answer) => {
      if (!c.signal.aborted) setLookup({ phase: "done", key, answer });
    });
  }, []);
  const reset = useCallback(() => { ctrl.current?.abort(); ctrl.current = null; setLookup({ phase: "idle" }); }, []);
  return { lookup, run, reset };
}

/** The wall clock, refreshed every `periodMs` (ages of answers). */
export function useNow(periodMs = 5_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), periodMs);
    return () => clearInterval(id);
  }, [periodMs]);
  return now;
}

/** "12 s ago" in the current language (chain.ours.ago.*), refreshed every 5 s. */
export function useAgo(): (at: number) => string {
  const t = useT();
  const now = useNow(5_000);
  return useCallback((at: number) => {
    const a = agoParts(now - at);
    return t(`chain.ours.ago.${a.unit}`, { n: a.n });
  }, [now, t]);
}
