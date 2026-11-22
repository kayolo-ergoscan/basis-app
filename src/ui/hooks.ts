// Small shared hooks for the kit: media queries, the pulse reaction and stable ids.
import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type RefObject } from "react";
import { pulse, type Pulse } from "@/app/pulse";
import { prefersReducedMotion } from "./settings";

/** React: a CSS media query, live. */
export function useMedia(query: string): boolean {
  const sub = useCallback((f: () => void) => {
    if (typeof matchMedia === "undefined") return () => {};
    const m = matchMedia(query);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, [query]);
  return useSyncExternalStore(sub, () => (typeof matchMedia === "undefined" ? false : matchMedia(query).matches), () => false);
}
/** Phone layout (≤ 640 px, VISUAL §5). */
export const useIsPhone = () => useMedia("(max-width: 640px)");
/** Fine pointer (mouse / trackpad): small keys, hover loupe, parallax. */
export const useFinePointer = () => useMedia("(pointer: fine)");

/** Restart a one-shot CSS animation class on an element (tile: remove → reflow → add). */
export function flash(el: Element | null | undefined, cls = "pulse-on", ms = 1400) {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).offsetWidth;
  el.classList.add(cls);
  const prev = (el as HTMLElement & { __flashT?: number }).__flashT;
  if (prev) clearTimeout(prev);
  (el as HTMLElement & { __flashT?: number }).__flashT = window.setTimeout(() => el.classList.remove(cls), ms + 60);
}

/** The one pulse (VISUAL §10.2): every matching commitment adds `.pulse-on` for 1400 ms (400 ms under reduced motion). */
export function usePulseClass(ref: RefObject<Element | null>, filter?: (p: Pulse) => boolean, cls = "pulse-on") {
  const fRef = useRef(filter);
  fRef.current = filter;
  useEffect(() => pulse.subscribe((p) => {
    if (fRef.current && !fRef.current(p)) return;
    flash(ref.current, cls, prefersReducedMotion() ? 400 : 1400);
  }), [ref, cls]);
}

/** A DOM-safe unique id ("r1a" style ids from useId contain colons). */
export function useUid(prefix = "u"): string {
  return prefix + useId().replace(/[^a-zA-Z0-9_-]/g, "");
}

/** Close on Escape while `active`. */
export function useEscape(active: boolean, fn: () => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!active) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); ref.current(); } };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [active]);
}

/** True when a keyboard event comes from a text field (shortcuts must ignore it). */
export function isTyping(e: KeyboardEvent | { target: EventTarget | null }): boolean {
  const t = e.target as HTMLElement | null;
  if (!t || !(t instanceof HTMLElement)) return false;
  return !!t.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [role='textbox']");
}
