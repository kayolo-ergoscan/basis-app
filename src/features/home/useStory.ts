// The story's React side: builds the Story economy off the first paint (idle callback, real Ergo AVL+ when the
// wasm loads in time), plays the hero sequence once — Alice raises her note, T-01 witnesses, a block commits the
// digest — and runs the moments' commands. One commitment fires exactly one pulse.
import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import { pulse } from "@/app/pulse";
import { SIMULATED_AVL, type AvlBackend } from "@/protocol";
import { prefersReducedMotion } from "@/ui";
import { ensureAvl } from "@/world";
import { Story, TRACKER_ID, type StorySnap } from "./story";

/** boot → open (1 000.00 witnessed) → signed (Alice signs 1 240.00) → witnessed (T-01) → committed (digest on chain). */
export type Phase = "boot" | "open" | "signed" | "witnessed" | "committed";
const ORDER: Phase[] = ["boot", "open", "signed", "witnessed", "committed"];
export const phaseAtLeast = (p: Phase, q: Phase): boolean => ORDER.indexOf(p) >= ORDER.indexOf(q);

export interface StoryState {
  phase: Phase;
  snap: StorySnap | null;
  error: string | null;
  /** Bumps on every engine command (moments re-read the snapshot). */
  v: number;
}

export interface StoryStore {
  get(): StoryState;
  subscribe(fn: () => void): () => void;
  /** Mount: builds the story once (idle callback), or resumes it after a stop (StrictMode remounts). */
  start(): void;
  /** Unmount: stops the hero timers; nothing runs until start() again. */
  stop(): void;
  replay(): void;
  check(): void;
  topUp(): void;
  redeem(): void;
}

/** Timings of the hero sequence (ms after the note appears). */
const STEP_MS = { signed: 1100, witnessed: 1250, committed: 1300 };
/** How long the hero waits for the wasm AVL before it signs with the simulated tree. */
const AVL_WAIT_MS = 1200;

type Idle = (cb: () => void, o?: { timeout: number }) => number;

function pickBackend(): Promise<AvlBackend> {
  return Promise.race([
    ensureAvl().then((r) => r.backend),
    new Promise<AvlBackend>((res) => setTimeout(() => res(SIMULATED_AVL), AVL_WAIT_MS)),
  ]).catch(() => SIMULATED_AVL);
}

export function createStoryStore(): StoryStore {
  let state: StoryState = { phase: "boot", snap: null, error: null, v: 0 };
  const subs = new Set<() => void>();
  let story: Story | null = null;
  let backend: AvlBackend | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let pulsed = false;
  let active = false;
  let started = false;

  const set = (patch: Partial<StoryState>) => {
    state = { ...state, ...patch, v: state.v + 1 };
    for (const f of [...subs]) f();
  };
  const clear = () => { timers.forEach(clearTimeout); timers = []; };

  /** One commitment = one pulse: fired the first time the snapshot shows the committed digest. */
  const maybePulse = (snap: StorySnap) => {
    if (pulsed || !snap.commit) return;
    pulsed = true;
    pulse.commit({ source: "sandbox", trackerId: TRACKER_ID, digest: snap.commit.digest, height: snap.commit.height, noteKeys: [snap.noteKey] });
  };

  const run = (fn: (s: Story) => StorySnap): StorySnap | null => {
    if (!story || !active) return null;
    try {
      return fn(story);
    } catch (e) {
      set({ error: (e as Error)?.message ?? String(e) });
      return null;
    }
  };

  /** Engine work and the render it causes run as separate tasks (VISUAL §8.4: no long main-thread stalls). */
  const later = (fn: () => void, ms = 0) => { timers.push(setTimeout(fn, ms)); };

  /** Jump the hero to its final state (reduced motion, or a moment needed the commit). */
  const finish = () => {
    clear();
    const snap = run((s) => s.commit());
    if (!snap) return;
    later(() => { set({ phase: "committed", snap }); maybePulse(snap); });
  };

  const sequence = () => {
    clear();
    const open = run((s) => s.open());
    if (!open) return;
    later(() => {
      set({ phase: "open", snap: open, error: null });
      if (prefersReducedMotion()) { later(finish); return; }
      let at = 0;
      at += STEP_MS.signed;
      later(() => { const snap = run((s) => s.raise()); if (snap) later(() => set({ phase: "signed", snap })); }, at);
      at += STEP_MS.witnessed;
      later(() => { if (state.phase === "signed") set({ phase: "witnessed" }); }, at);
      at += STEP_MS.committed;
      later(finish, at);
    });
  };

  const build = async () => {
    backend ??= await pickBackend();
    if (!active || story) return;
    try {
      story = new Story(backend);
    } catch (e) {
      try {
        backend = SIMULATED_AVL;
        story = new Story(backend);
      } catch (e2) {
        set({ error: (e2 as Error)?.message ?? String(e) });
        return;
      }
    }
    later(sequence);
  };

  const afterCommand = (snap: StorySnap | null) => {
    if (!snap) return;
    if (snap.commit && state.phase !== "committed") clear();
    set({ snap, phase: snap.commit ? "committed" : state.phase });
    maybePulse(snap);
  };

  return {
    get: () => state,
    subscribe(fn) { subs.add(fn); return () => { subs.delete(fn); }; },
    start() {
      active = true;
      if (!started) {
        started = true;
        const ric = (window as Window & { requestIdleCallback?: Idle }).requestIdleCallback;
        const go = () => { void build(); };
        if (ric) ric(go, { timeout: 300 });
        else setTimeout(go, 1);
      } else if (story && state.phase !== "committed" && timers.length === 0) {
        // stopped mid-sequence (StrictMode remount, fast navigation): jump to the end, or start over cleanly
        if (state.snap) finish();
        else { story = null; later(() => { void build(); }); }
      }
    },
    stop() { active = false; clear(); },
    replay() {
      if (!backend || !active) return;
      clear();
      pulsed = false;
      story = new Story(backend);
      set({ phase: "boot", snap: null });
      later(sequence, 60);
    },
    check() { afterCommand(run((s) => s.check())); },
    topUp() { afterCommand(run((s) => s.topUp())); },
    redeem() { afterCommand(run((s) => s.redeem())); },
  };
}

export const StoryContext = createContext<StoryStore | null>(null);

const EMPTY: StoryState = { phase: "boot", snap: null, error: null, v: 0 };
const getEmpty = () => EMPTY;
const noop = () => () => {};

export type StoryView = StoryState & { store: StoryStore | null };

/** The story state (re-renders on every engine command and phase change). */
export function useStory(): StoryView {
  const store = useContext(StoryContext);
  const s = useSyncExternalStore(store ? store.subscribe : noop, store ? store.get : getEmpty, store ? store.get : getEmpty);
  return useMemo(() => ({ ...s, store }), [s, store]);
}
