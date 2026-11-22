// Wires the page to the vault's auto-lock (design §4.2 "Locking"): activity pushes the 10-minute idle deadline, a hidden
// tab locks after 2 minutes, and leaving the page (pagehide, freeze) locks at once. The vault keeps the clock; this file
// only forwards DOM events, so the vault itself stays free of the DOM.
import type { LockReason } from "./vault";

export interface AutoLockTarget {
  touch(): void;
  setHidden(hidden: boolean): void;
  lock(reason?: LockReason): void;
}

type Listen = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export interface AutoLockDom {
  document: Listen & { readonly visibilityState: DocumentVisibilityState };
  window: Listen;
  now?: () => number;
}

const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** Starts forwarding; returns the function that stops it. `throttleMs`: at most one touch() per interval. */
export function attachAutoLock(vault: AutoLockTarget, dom?: AutoLockDom, throttleMs = 1000): () => void {
  const doc = dom?.document ?? document;
  const win = dom?.window ?? window;
  const now = dom?.now ?? (() => Date.now());
  let last = -Infinity;
  const onVisibility = () => vault.setHidden(doc.visibilityState === "hidden");
  const onActivity = () => {
    const n = now();
    if (n - last < throttleMs) return;
    last = n;
    vault.touch();
  };
  const onLeave = () => vault.lock("hidden");
  const opts: AddEventListenerOptions = { capture: true, passive: true };
  doc.addEventListener("visibilitychange", onVisibility);
  doc.addEventListener("freeze", onLeave);
  win.addEventListener("pagehide", onLeave);
  for (const t of ACTIVITY) win.addEventListener(t, onActivity, opts);
  onVisibility();
  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    doc.removeEventListener("freeze", onLeave);
    win.removeEventListener("pagehide", onLeave);
    for (const t of ACTIVITY) win.removeEventListener(t, onActivity, opts);
  };
}
