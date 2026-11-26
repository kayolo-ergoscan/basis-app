// Switching without jumps (motion round, 26 Nov 2026). Two quiet moves, each ≤ 200 ms, both off under reduced motion:
//   1. crossFade(): the view cross-fades in place (document.startViewTransition, the root only: a fade, never a
//      slide). The fixed chrome (top bar, phone tab bar) and the bars that stay between views (sub-navs, the wallet mode
//      switch, the tab row that was pressed) are named in motion.css and stay live above the fade, so they never fade,
//      flicker or move. Without the View Transitions API, or with reduced motion, the switch is instant.
//   2. useGlide(): the lit plate of a bar glides from the old item to the new one (the «фишка»): the header places, the
//      lamp of the phone tab bar, sub-navs, tabs and segmented controls. One plate per bar, moved with the Web Animations
//      API from where it was to where the lit item is now.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./settings";

/** The glide and the fade (VISUAL §10: motion is a hint; every duration ≤ 250 ms). */
export const GLIDE_MS = 200;
export const FADE_MS = 180;
const EASE = "cubic-bezier(.2,.7,.2,1)";

interface ViewTransitionLike { finished: Promise<void>; ready: Promise<void>; updateCallbackDone: Promise<void>; skipTransition(): void }
type StartVT = (update: () => Promise<void> | void) => ViewTransitionLike;
const startVT = (): StartVT | null => {
  if (typeof document === "undefined") return null;
  const f = (document as unknown as { startViewTransition?: StartVT }).startViewTransition;
  return typeof f === "function" ? f.bind(document) : null;
};

/** A cross-fade can run: the API is there, motion is allowed and the tab is visible. */
export function canFade(): boolean {
  return !!startVT() && !prefersReducedMotion() && document.visibilityState === "visible";
}

let running: ViewTransitionLike | null = null;
/** Two slots for bars that are live only during their own switch (a tab row, a segmented control); motion.css names
 *  their pseudo-elements. The always-live bars are named in motion.css itself. */
const SLOTS = ["vt-live-a", "vt-live-b"];

/** Run `update` (it changes the DOM; a promise is awaited) under a cross-fade of the view; `live` elements stay out of
 *  the fade (they show as themselves, so a plate gliding inside them is seen once, not twice). Instant without the API,
 *  under reduced motion or in a hidden tab. A switch that starts while another runs finishes the older one at once. */
export function crossFade(update: () => void | Promise<void>, live: (Element | null | undefined)[] = []): void {
  const start = canFade() ? startVT() : null;
  if (!start) { void update(); return; }
  running?.skipTransition();
  const named: HTMLElement[] = [];
  for (const el of live) {
    if (!(el instanceof HTMLElement) || named.length >= SLOTS.length || getComputedStyle(el).viewTransitionName !== "none") continue;
    el.style.setProperty("view-transition-name", SLOTS[named.length]);
    named.push(el);
  }
  const done = () => { for (const el of named) el.style.removeProperty("view-transition-name"); };
  let vt: ViewTransitionLike;
  try {
    vt = start(async () => { await update(); });
  } catch {
    done();
    void update();
    return;
  }
  running = vt;
  vt.ready.catch(() => { /* skipped: the DOM is already updated */ });
  vt.updateCallbackDone.catch(() => { /* the update threw: it is reported where it ran */ });
  vt.finished.finally(() => { done(); if (running === vt) running = null; });
}

/* ------------------------------------------------------------------ the gliding plate */

interface Box { x: number; y: number; w: number; h: number }
const boxOf = (bar: HTMLElement, el: HTMLElement): Box => {
  const b = bar.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - b.left - bar.clientLeft + bar.scrollLeft, y: r.top - b.top - bar.clientTop + bar.scrollTop, w: r.width, h: r.height };
};
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const frame = (b: Box) => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` });

/** The bar's lit plate glides to the new lit item. The bar renders one `<span className="glide" aria-hidden="true" />`
 *  child and marks its lit item with `.on` (or `lit`, a selector relative to the bar). The bar gets the class `glides`
 *  once the plate stands under the lit item (motion.css then moves the lit look from the item to the plate); before
 *  that, and without JS, the item keeps its own lit look, so nothing flashes. Size changes (fonts, the window, a count
 *  that arrives) move the plate at once; only a change of the lit item glides.
 *  `memo` names the bar across pages: a page that draws the same bar again (the next section with the same sub-nav)
 *  takes over the old bar's plate, so the plate glides on, and its sideways scroll, so a row that scrolls (phone)
 *  stays where it was. A row that scrolls keeps its lit item in view, moving only as far as needed. */
interface Memo { box: Box; scroll: number; t: number }
const memos = new Map<string, Memo>();
const MEMO_MS = 1500;
const EDGE = 16;
/** The least sideways scroll that shows `el` whole inside the row (16 px clear of either edge), or null if it is. */
function scrollToShow(bar: HTMLElement, el: HTMLElement): number | null {
  if (bar.scrollWidth <= bar.clientWidth + 1) return null;
  const b = bar.getBoundingClientRect(), r = el.getBoundingClientRect();
  const l = r.left - b.left - bar.clientLeft, rt = r.right - b.left - bar.clientLeft;
  if (l < EDGE) return Math.max(0, bar.scrollLeft + l - EDGE);
  if (rt > bar.clientWidth - EDGE) return Math.min(bar.scrollWidth - bar.clientWidth, bar.scrollLeft + rt - bar.clientWidth + EDGE);
  return null;
}
export function useGlide(ref: RefObject<HTMLElement | null>, lit = ":scope > .on", memo?: string): void {
  useLayoutEffect(() => {
    const bar = ref.current;
    const plate = bar?.querySelector<HTMLElement>(":scope > .glide");
    if (!bar || !plate) return;
    const m = memo ? memos.get(memo) : undefined;
    const fresh = m && performance.now() - m.t < MEMO_MS ? m : null;
    if (fresh && fresh.scroll) bar.scrollLeft = fresh.scroll;
    let at: Box | null = fresh ? fresh.box : null;
    let litEl: HTMLElement | null = null;
    let anim: Animation | null = null;
    // only a real change touches the class (the observer below watches the bar's class too: React may reset it)
    const lit_ = (on: boolean) => { if (bar.classList.contains("glides") !== on) bar.classList.toggle("glides", on); };
    const place = (glide: boolean) => {
      const el = bar.querySelector<HTMLElement>(lit);
      if (!el || !el.getClientRects().length) {
        // nothing lit (or the bar is hidden): no plate; the next lit item appears in place
        lit_(false);
        at = null; litEl = null;
        return;
      }
      const moved = litEl !== el;
      if (moved) {
        const x = scrollToShow(bar, el);
        if (x != null) {
          // a row that scrolls: the lit item comes into view (gently when it was pressed, at once when the row is new)
          if (glide && litEl && !prefersReducedMotion() && typeof bar.scrollTo === "function") bar.scrollTo({ left: x, behavior: "smooth" });
          else bar.scrollLeft = x;
        }
      }
      const to = boxOf(bar, el);
      if (at && same(at, to) && !moved) { litEl = el; lit_(true); return; }
      const from = at;
      Object.assign(plate.style, frame(to));
      lit_(true);
      anim?.cancel();
      anim = null;
      if (glide && moved && from && !same(from, to) && !prefersReducedMotion() && typeof plate.animate === "function") {
        // TRIAL (motion round): «фишка» candidates side by side; html[data-fishka] picks B or C, A is the default
        if (document.documentElement.dataset.fishka === "b") anim = plate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "cubic-bezier(.2,0,.2,1)" });
        else anim = plate.animate([frame(from), frame(to)], { duration: GLIDE_MS, easing: EASE });
      }
      at = to; litEl = el;
    };
    place(!!at);
    // the lit item changed (a class or aria attribute on a child, a child added or removed): glide
    const mo = new MutationObserver(() => place(true));
    mo.observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "aria-current", "aria-selected", "aria-pressed"] });
    // a size changed (fonts, the window, a count that arrived): follow at once
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => place(false)) : null;
    if (ro) { ro.observe(bar); for (const c of bar.children) if (c !== plate) ro.observe(c); }
    const onFonts = () => place(false);
    document.fonts?.addEventListener?.("loadingdone", onFonts);
    return () => {
      mo.disconnect(); ro?.disconnect(); document.fonts?.removeEventListener?.("loadingdone", onFonts); anim?.cancel();
      if (memo && at) memos.set(memo, { box: at, scroll: bar.scrollLeft, t: performance.now() });
    };
  }, [ref, lit, memo]);
}

/* ------------------------------------------------------------------ panels that hold their height */

/** A panel whose content switches in place (a tab's list, a filter) keeps the tallest height it has had, so whatever
 *  sits below it never moves when a shorter view replaces a taller one. `estimate` (optional) names a height the
 *  panel will need for its tallest view, so even the first switch to it moves nothing. The hold starts over when
 *  `reset` changes (other data) or the panel's width changes. `deps`: what switches the view. */
export function useHoldHeight(ref: RefObject<HTMLElement | null>, reset: unknown, deps: readonly unknown[], estimate?: () => number): void {
  const m = useRef<{ w: number; h: number; reset: unknown }>({ w: -1, h: 0, reset });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.clientWidth;
    if (m.current.w !== w || m.current.reset !== reset) m.current = { w, h: 0, reset };
    el.style.minHeight = "";
    const h = Math.max(el.getBoundingClientRect().height, estimate?.() ?? 0);
    if (h > m.current.h) m.current.h = h;
    el.style.minHeight = `${Math.ceil(m.current.h)}px`;
  }, [reset, ...deps]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    // a new window width: the hold no longer fits; the next switch measures again
    const off = () => { const el = ref.current; if (el) el.style.minHeight = ""; m.current.w = -1; };
    addEventListener("resize", off);
    return () => removeEventListener("resize", off);
  }, [ref]);
}
