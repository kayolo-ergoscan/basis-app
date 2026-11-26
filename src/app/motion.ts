// Page switches without jumps (motion round, 26 Nov 2026). Every navigation (links, the menu, ⌘K, the keyboard, Back and
// Forward) goes through the one history below, whose listener is wrapped here:
//   1. the chunks and data the new path needs load first (routes.warmPath). Meanwhile the old view stays as it is and
//      the lit place of the top bar and the tab bar moves at once (usePendingPath), so a slow network never shows a
//      loader page or a half-built one; a pointer or focus on a link starts that loading early;
//   2. the router then applies the new location under a cross-fade (src/ui/motion.ts) that waits until the new view has
//      rendered and settled (the route frame reports its commit), so the view is shown at its final size from the first
//      frame. A change inside the same page (a #hash, a query) applies at once, without a fade.
// Reduced motion: the same order, the new view shown at once (still held until it has settled). No View Transitions
// API: the same order, the new view applied at once.
import { useSyncExternalStore } from "react";
import { createBrowserHistory, createMemoryHistory, type BrowserHistory, type History } from "@remix-run/router";
import { canHold, crossFade } from "@/ui/motion";
import { warmPath } from "./routes";

type Update = Parameters<Parameters<History["listen"]>[0]>[0];

/* ------------------------------------------------------------------ the path a switch is heading to */
let pending: string | null = null;
const subs = new Set<() => void>();
const setPending = (p: string | null) => {
  if (pending === p) return;
  pending = p;
  if (typeof document !== "undefined") document.documentElement.classList.toggle("switching", p != null);
  for (const f of [...subs]) f();
};
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** The path a switch is loading (the lit place shows it at once), or null. */
export function usePendingPath(): string | null {
  return useSyncExternalStore(subscribe, () => pending, () => null);
}

/* ------------------------------------------------------------------ commits of the route frame */
let committed: string | null = null;
const waiters = new Map<string, () => void>();
/** The route frame calls this from its layout effect once a location is on screen. */
export function routeCommitted(key: string) {
  committed = key;
  const w = waiters.get(key);
  if (w) { waiters.delete(key); w(); }
}
const SETTLE_CAP_MS = 400;
/** Resolves once the location `key` has rendered and two more task turns have passed (effects that render once more: the
 *  contents rail, a measured header), or after SETTLE_CAP_MS whatever happens. */
function settled(key: string): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const cap = setTimeout(() => finish(), SETTLE_CAP_MS);
    const finish = () => { if (done) return; done = true; clearTimeout(cap); waiters.delete(key); resolve(); };
    const after = () => setTimeout(() => setTimeout(finish, 0), 0);
    if (committed === key) after(); else waiters.set(key, after);
  });
}

/* ------------------------------------------------------------------ the history */
const WARM_CAP_MS = 2500;
/** The app's one browser history: BrowserRouter's own, with a listener that switches views as described above (a memory
 *  history where there is no browser: tests that import the shell). */
export const history: BrowserHistory | History = typeof document !== "undefined" ? createBrowserHistory({ v5Compat: true }) : createMemoryHistory({ v5Compat: true });
let shown = history.location.pathname;
let seq = 0;
const listen = history.listen.bind(history);
history.listen = (fn) => listen((u: Update) => {
  const my = ++seq;
  const path = u.location.pathname;
  const same = path === shown;
  const go = () => {
    if (my !== seq) return; // a newer switch took over
    shown = path;
    // the pending place hands over to the router's own in the same update (cleared before it, the old place lit up
    // again for the one frame the fade takes to capture the old view)
    const apply = () => { fn(u); setPending(null); };
    if (same || !canHold()) { apply(); return; }
    // held behind the API until the new view has settled: cross-faded, or at once with reduced motion
    crossFade(() => { apply(); return settled(u.location.key); }, [], true);
  };
  const w = same ? null : warmPath(path);
  if (!w) { go(); return; }
  setPending(path);
  Promise.race([w, new Promise((r) => setTimeout(r, WARM_CAP_MS))]).then(go, go);
});

/* ------------------------------------------------------------------ loading ahead */
let lastWarm = "";
function intent(e: Event) {
  const a = (e.target as Element | null)?.closest?.("a[href]");
  const href = a?.getAttribute("href");
  if (!href || href[0] !== "/" || href[1] === "/") return;
  const path = href.split(/[?#]/)[0];
  if (path === lastWarm) return;
  lastWarm = path;
  warmPath(path, true)?.catch(() => { lastWarm = ""; });
}
if (typeof window !== "undefined") {
  for (const ev of ["pointerover", "pointerdown", "focusin"] as const) addEventListener(ev, intent, { capture: true, passive: true });
}
