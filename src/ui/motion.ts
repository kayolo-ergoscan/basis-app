// Switching without jumps (motion round, 26 Nov 2026). Two quiet moves, each ≤ 200 ms, both off under reduced motion:
//   1. crossFade(): the view cross-fades in place (document.startViewTransition, the root only: a fade, never a
//      slide). The fixed chrome (top bar, phone tab bar) and the bars that stay between views (sub-navs, the wallet mode
//      switch, the tab row that was pressed) are named in motion.css and stay live above the fade, so they never fade,
//      flicker or move. With reduced motion a page switch still waits behind the API for its new view, then shows it at
//      once (no fade: the late layout of a view is never seen); without the API the switch is instant.
//   2. useLight(): the «фишка» — the light moves the way lights move in the night town: the soft lit tag goes out where
//      it was and lights up at the new item at the same time, in place (a cross-fade of two lights, nothing slides). The
//      header places, the lamp over the phone tab bar, sub-navs, tabs and segmented controls: one light per bar.
import { useLayoutEffect, useRef, type RefObject } from "react";
import { prefersReducedMotion } from "./settings";

/** The fade of a view and of a light (VISUAL §10: motion is a hint; every duration ≤ 250 ms). */
export const FADE_MS = 180;
const EASE = "cubic-bezier(.2,0,.2,1)";

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

/** A page switch can wait behind the API until its new view is ready: the API is there and the tab is visible. With
 *  reduced motion it is shown at once, without a fade (motion.css: html.vt-still). */
export function canHold(): boolean {
  return !!startVT() && document.visibilityState === "visible";
}

let running: ViewTransitionLike | null = null;
/** Two slots for bars that are live only during their own switch (a tab row, a segmented control); motion.css names
 *  their pseudo-elements. The always-live bars are named in motion.css itself. */
const SLOTS = ["vt-live-a", "vt-live-b"];

/** Run `update` (it changes the DOM; a promise is awaited) under a cross-fade of the view; `live` elements stay out of
 *  the fade (they show as themselves, so a plate gliding inside them is seen once, not twice). Instant without the API,
 *  under reduced motion or in a hidden tab; `hold` (a page switch): with reduced motion the old view still stays until
 *  the update is done, then the new one shows at once. A switch that starts while another runs finishes the older one. */
export function crossFade(update: () => void | Promise<void>, live: (Element | null | undefined)[] = [], hold = false): void {
  const start = (hold ? canHold() : canFade()) ? startVT() : null;
  if (!start) { void update(); return; }
  running?.skipTransition();
  const root = document.documentElement;
  root.classList.toggle("vt-still", prefersReducedMotion());
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
  vt.finished.finally(() => { done(); if (running === vt) { running = null; root.classList.toggle("vt-still", false); } });
}

/* ------------------------------------------------------------------ the light of a bar */

interface Box { x: number; y: number; w: number; h: number }
const boxOf = (bar: HTMLElement, el: HTMLElement): Box => {
  const b = bar.getBoundingClientRect(), r = el.getBoundingClientRect();
  return { x: r.left - b.left - bar.clientLeft + bar.scrollLeft, y: r.top - b.top - bar.clientTop + bar.scrollTop, w: r.width, h: r.height };
};
const same = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const frame = (b: Box) => ({ transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` });

/** The bar's light (its soft lit tag) moves to the new lit item: it goes out where it was while it lights up there, in
 *  place. The bar renders one `<span className="light" aria-hidden="true" />` child and marks its lit item with `.on` (or
 *  `lit`, a selector relative to the bar). The bar gets the class `lights` once the light stands under the lit item
 *  (motion.css then moves the lit look from the item to the light); before that, and without JS, the item keeps its own
 *  lit look, so nothing flashes. Size changes (fonts, the window, a count that arrives) move the light at once; only a
 *  change of the lit item cross-fades. The light going out is a copy of it, removed when it is dark.
 *  `memo` names the bar across pages: a page that draws the same bar again (the next section with the same sub-nav)
 *  takes over the old bar's light, so it goes out where it stood on the last page, and its sideways scroll, so a row
 *  that scrolls (phone) stays where it was. A row that scrolls keeps its lit item in view, moving only as far as needed. */
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
export function useLight(ref: RefObject<HTMLElement | null>, lit = ":scope > .on", memo?: string): void {
  useLayoutEffect(() => {
    const bar = ref.current;
    const plate = bar?.querySelector<HTMLElement>(":scope > .light");
    if (!bar || !plate) return;
    const m = memo ? memos.get(memo) : undefined;
    const fresh = m && performance.now() - m.t < MEMO_MS ? m : null;
    if (fresh && fresh.scroll) bar.scrollLeft = fresh.scroll;
    let at: Box | null = fresh ? fresh.box : null;
    let litEl: HTMLElement | null = null;
    let anim: Animation | null = null;
    // only a real change touches the class (the observer below watches the bar's class too: React may reset it)
    const lit_ = (on: boolean) => { if (bar.classList.contains("lights") !== on) bar.classList.toggle("lights", on); };
    const place = (fade: boolean) => {
      const el = bar.querySelector<HTMLElement>(lit);
      if (!el || !el.getClientRects().length) {
        // nothing lit (or the bar is hidden): no light; the next lit item lights in place
        lit_(false);
        at = null; litEl = null;
        return;
      }
      const moved = litEl !== el;
      if (moved) {
        const x = scrollToShow(bar, el);
        if (x != null) {
          // a row that scrolls: the lit item comes into view (gently when it was pressed, at once when the row is new)
          if (fade && litEl && !prefersReducedMotion() && typeof bar.scrollTo === "function") bar.scrollTo({ left: x, behavior: "smooth" });
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
      if (fade && moved && from && !same(from, to) && !prefersReducedMotion() && typeof plate.animate === "function") {
        // the light that goes out: a copy where the light stood (after it, so the bar's own query finds the light first)
        const out = plate.cloneNode(false) as HTMLElement;
        Object.assign(out.style, frame(from));
        plate.after(out);
        const drop = () => out.remove();
        out.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, easing: EASE, fill: "forwards" }).finished.then(drop, drop);
        anim = plate.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: EASE });
      }
      at = to; litEl = el;
    };
    place(!!at);
    // the lit item changed (a class or aria attribute on a child, a child added or removed): the light moves
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
