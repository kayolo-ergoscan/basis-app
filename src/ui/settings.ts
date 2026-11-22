// Viewer settings that change how the kit behaves (stored per browser under "basis.ui"):
//   motion        "system" follows prefers-reduced-motion; "reduce" forces it (VISUAL §10 in-app switch)
//   confirmPress  replaces every hold-to-act with "press, then press again to confirm" (VISUAL §15)
//   privacy       hides amounts on screen (FEATURES U05); <Num> shows •••
//   sounds        off by default (VISUAL §11); reserved for a later WebAudio module
import { useEffect, useState, useSyncExternalStore } from "react";

export interface UiSettings {
  motion: "system" | "reduce";
  confirmPress: boolean;
  privacy: boolean;
  sounds: boolean;
}
const KEY = "basis.ui";
const DEFAULTS: UiSettings = { motion: "system", confirmPress: false, privacy: false, sounds: false };

function read(): UiSettings {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UiSettings>) };
  } catch { /* storage blocked: defaults */ }
  return { ...DEFAULTS };
}

let state: UiSettings = read();
const subs = new Set<() => void>();
const emit = () => { for (const f of [...subs]) f(); };

function applyRoot() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("rm", state.motion === "reduce");
}
applyRoot();

export function getUiSettings(): UiSettings { return state; }
export function setUiSettings(patch: Partial<UiSettings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  applyRoot();
  emit();
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** React: the current settings (re-renders on change). */
export function useUiSettings(): UiSettings {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** True while screenshots/tests freeze motion (?still) — read once at boot. */
export const STILL = typeof location !== "undefined" && new URLSearchParams(location.search).has("still");

const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
/** Reduced motion: the OS setting, the in-app switch, or ?still. */
export function prefersReducedMotion(): boolean {
  return STILL || state.motion === "reduce" || !!mq?.matches;
}
/** React: reduced motion, live. */
export function useReducedMotion(): boolean {
  const s = useUiSettings();
  const [sys, setSys] = useState(() => !!mq?.matches);
  useEffect(() => {
    if (!mq) return;
    const on = () => setSys(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return STILL || s.motion === "reduce" || sys;
}
