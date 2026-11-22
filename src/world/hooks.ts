// React hooks over the town and the scenario runs. Every hook reads a zustand store that is updated at most
// once per animation frame; selectors are compared shallowly, so a component re-renders only when what it
// selected changed.
import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { createStore } from "zustand/vanilla";
import { useLang } from "@/app/lang";
import type { Economy, ScenarioId } from "@/protocol";
import { feed, type FeedItem, type FeedQuery } from "./feed";
import type { WalletState } from "./identity";
import { createFreeRun, createRun, importRun, type FreeWorld, type RunController, type RunState } from "./runs";
import { town as defaultTown, type Town, type TownNotice, type TownState } from "./town";

function useBoot(t: Town): void {
  useEffect(() => {
    void t.ready().catch(() => {
      /* status "error" is in the store */
    });
  }, [t]);
}

/** Selects from the town state (boots the town on first use). Shallow-equal results do not re-render. */
export function useTown<T>(selector: (s: TownState) => T, t: Town = defaultTown): T {
  useBoot(t);
  return useStore(t.store, useShallow(selector));
}

/** Status for gates and banners: ready, status, role ("follower" = the town runs in another tab), AVL info. */
export function useTownReady(t: Town = defaultTown) {
  return useTown((s) => ({ ready: s.status === "ready", status: s.status, role: s.role, error: s.error, avl: s.avl, load: s.load, persistence: s.persistence }), t);
}

/**
 * A value derived from the live town economy, recomputed once per frame in which the town changed
 * (null until the town is ready). `deps` are extra inputs of `fn`.
 */
export function useTownView<T>(fn: (eco: Economy, s: TownState) => T, deps: readonly unknown[] = [], t: Town = defaultTown): T | null {
  const { v, eco } = useTown((s) => ({ v: s.v, eco: s.eco }), t);
  const ref = useRef(fn);
  ref.current = fn;
  return useMemo(() => (eco ? ref.current(eco, t.store.getState()) : null), [v, eco, t, ...deps]);
}

/** The sandbox wallet identity (no secret): status "none" | "ready", identity with words and fingerprint. */
export function useWallet(t: Town = defaultTown): WalletState {
  useBoot(t);
  return useStore(t.wallet.store);
}

/** Clock state and height. */
export function useClock(t: Town = defaultTown) {
  return useTown((s) => ({ ...s.clock, height: s.height }), t);
}

/** The town's event feed, newest first, in the current language (cast names translated). */
export function useFeed(q: FeedQuery = {}, t: Town = defaultTown): FeedItem[] {
  const { lang } = useLang();
  const key = JSON.stringify(q);
  return useTownView((eco) => feed(eco, q, lang, { cast: true }), [key, lang], t) ?? [];
}

/** Calls `fn` for every notice about You (toasts). The latest `fn` is used; no resubscribe on re-render. */
export function useNotices(fn: (n: TownNotice) => void, t: Town = defaultTown): void {
  const ref = useRef(fn);
  ref.current = fn;
  useBoot(t);
  useEffect(() => t.onNotice((n) => ref.current(n)), [t]);
}

// ---------------------------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------------------------

export type RunSpec =
  | { scenario: ScenarioId; seed?: string; params?: Record<string, number> }
  | { free: FreeWorld; seed?: string }
  | { json: string };

/**
 * Creates a run for `spec` (and disposes it when the spec changes or the component unmounts). The spec is
 * compared by value, so an inline object is fine.
 */
export function useRun(spec: RunSpec | null): { run: RunController | null; error: string | null } {
  const key = spec ? JSON.stringify(spec) : "";
  const [state, setState] = useState<{ key: string; run: RunController | null; error: string | null }>({ key: "", run: null, error: null });
  useEffect(() => {
    if (!spec) return;
    let alive = true;
    let made: RunController | null = null;
    const p = "scenario" in spec ? createRun(spec.scenario, { seed: spec.seed, params: spec.params }) : "free" in spec ? createFreeRun({ seed: spec.seed, world: spec.free }) : importRun(spec.json);
    p.then(
      (r) => {
        if (!alive) return r.dispose();
        made = r;
        setState({ key, run: r, error: null });
      },
      (e: Error) => {
        if (alive) setState({ key, run: null, error: e.message });
      },
    );
    return () => {
      alive = false;
      made?.dispose();
    };
  }, [key]);
  return state.key === key ? { run: state.run, error: state.error } : { run: null, error: null };
}

const EMPTY_RUN_STORE = createStore<RunState | null>(() => null);

/** Selects from a run's state (null while the run is being created). */
export function useRunState<T>(run: RunController | null, selector: (s: RunState) => T): T | null {
  return useStore((run?.store ?? EMPTY_RUN_STORE) as typeof EMPTY_RUN_STORE, useShallow((s: RunState | null) => (s ? selector(s) : null)));
}

/** A value derived from the economy the page shows: the time-travel view when one is set, else the live one. */
export function useRunView<T>(run: RunController | null, fn: (eco: Economy, s: RunState) => T, deps: readonly unknown[] = []): T | null {
  const sel = useRunState(run, (s) => ({ v: s.v, eco: s.view ?? s.eco }));
  const ref = useRef(fn);
  ref.current = fn;
  return useMemo(() => (run && sel?.eco ? ref.current(sel.eco, run.store.getState()) : null), [sel?.v, sel?.eco, run, ...deps]);
}
