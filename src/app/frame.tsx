// Route frame: an error boundary per route, Suspense with loading-by-engraving, document.title from titleKey,
// scroll restoration, the 404 with a torn note.
import { Component, Suspense, useEffect, useLayoutEffect, useRef, type ErrorInfo, type ReactNode } from "react";
import { Link, useLocation, useNavigationType } from "react-router-dom";
import { Key } from "@/ui/components/Key";
import { TornNote } from "@/ui/components/Note";
import { ErrorState, PageLoading } from "@/ui/components/states";
import { MOD } from "./chrome";
import { openCommandBar } from "./commands";
import { translate, useT } from "./lang";
import { routeCommitted } from "./motion";
import { pageOf } from "./routes";
import type { FeatureRoute } from "./types";

const SUFFIX = " · Basis";
export function useTitle(text: string | null | undefined) {
  useEffect(() => { document.title = text ? text + SUFFIX : translate("app.title"); }, [text]);
}

interface EBState { error: Error | null }
/** Catches a render error inside one route; the rest of the shell keeps working. */
export class RouteErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(error: Error): EBState { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error("[route error]", error, info.componentStack); }
  componentDidUpdate(prev: { resetKey?: string }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }); }
  render() {
    if (!this.state.error) return this.props.children;
    // a chunk that failed to load stays failed inside React.lazy: only a page reload fetches it again
    const chunk = /dynamically imported module|Importing a module script failed|error loading dynamically|Failed to fetch/i.test(String(this.state.error?.message));
    return <RouteError error={this.state.error} onRetry={() => (chunk ? location.reload() : this.setState({ error: null }))} />;
  }
}
function RouteError({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const t = useT();
  return (
    <div className="container page">
      <ErrorState title={t("app.err.title")} text={t("app.err.text")} onRetry={onRetry} retryLabel={t("app.err.retry")} detail={import.meta.env.DEV ? String(error?.stack || error) : String(error?.message || error)}>
        <Key size="sm" variant="quiet" to="/">{t("app.err.home")}</Key>
      </ErrorState>
    </div>
  );
}

/** One feature page: boundary → Suspense → page, plus its document title. */
export function RouteFrame({ route }: { route: FeatureRoute }) {
  const t = useT();
  const { pathname } = useLocation();
  const Page = pageOf(route);
  const key = route.titleKey ?? route.nav?.labelKey;
  useTitle(key ? t(key) : null);
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense fallback={<PageLoading label={t("app.loading")} />}>
        <div className="route-in"><Page /></div>
      </Suspense>
    </RouteErrorBoundary>
  );
}

/** 404: a torn note, the path, and two ways out. */
export function NotFound() {
  const t = useT();
  const { pathname } = useLocation();
  useTitle(t("app.404.doc"));
  return (
    <div className="container nf route-in">
      <TornNote seed={pathname}>
        <span className="nf-txt">404</span>
      </TornNote>
      <div>
        <div className="label">404</div>
        <h1 className="t-h1" style={{ marginTop: 14 }}>{t("app.404.title")}</h1>
        <p className="t-lede" style={{ marginTop: 18 }}>{t("app.404.text", { path: pathname })}</p>
        <div className="acts">
          <Key variant="primary" to="/">{t("app.404.home")}</Key>
          <Key onClick={() => openCommandBar()} icon="search">{t("app.404.cmdk", { mod: MOD })}</Key>
        </div>
        <p className="t-small" style={{ marginTop: 18 }}><Link className="link" to="/learn">{t("nav.learn")}</Link> · <Link className="link" to="/play">{t("nav.play")}</Link></p>
      </div>
    </div>
  );
}

const POS_KEY = "basis.scroll";
const readPos = (): Record<string, number> => { try { return JSON.parse(sessionStorage.getItem(POS_KEY) || "{}"); } catch { return {}; } };
/** Every fresh page load has the router key "default": add the path, so a load restores only its own page's place. */
const posKey = (loc: { key: string; pathname: string }): string => (loc.key === "default" ? `default:${loc.pathname}` : loc.key);
/** New pages start at the top (or at #hash); Back/Forward restores where you were. */
export function ScrollManager() {
  const loc = useLocation();
  const type = useNavigationType();
  const keyRef = useRef(posKey(loc));
  useEffect(() => { if ("scrollRestoration" in history) history.scrollRestoration = "manual"; }, []);
  useEffect(() => {
    let raf = 0;
    const save = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const all = readPos();
        all[keyRef.current] = window.scrollY;
        const keys = Object.keys(all);
        if (keys.length > 60) delete all[keys[0]];
        try { sessionStorage.setItem(POS_KEY, JSON.stringify(all)); } catch { /* ignore */ }
      });
    };
    addEventListener("scroll", save, { passive: true });
    return () => { removeEventListener("scroll", save); cancelAnimationFrame(raf); };
  }, []);
  const lastPath = useRef<string | null>(null);
  useLayoutEffect(() => {
    // the switch that brought this location waits for it (src/app/motion.ts): the new view is on the page now
    routeCommitted(loc.key);
    keyRef.current = posKey(loc);
    const first = lastPath.current == null;
    const moved = lastPath.current !== loc.pathname;
    lastPath.current = loc.pathname;
    // A #hash wins (links, first load, native anchors); then Back/Forward restores; new pages start at the top.
    if (loc.hash) {
      const id = decodeURIComponent(loc.hash.slice(1));
      const go = () => document.getElementById(id)?.scrollIntoView();
      // late layout (lazy chunks, fonts) can push the target down: re-aim twice, unless the reader already moved
      const raf = requestAnimationFrame(go); const t1 = setTimeout(go, 350), t2 = setTimeout(go, 900);
      const stop = () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); off(); };
      const evs = ["wheel", "touchstart", "keydown", "mousedown"] as const;
      const off = () => evs.forEach((e) => removeEventListener(e, stop, true));
      evs.forEach((e) => addEventListener(e, stop, { capture: true, passive: true }));
      return stop;
    }
    const timers: number[] = [];
    let raf = 0;
    if (type === "POP") {
      const y = readPos()[posKey(loc)];
      if (y != null) {
        const go = () => window.scrollTo(0, y);
        go(); raf = requestAnimationFrame(go); timers.push(window.setTimeout(go, 350));
      }
    } else window.scrollTo(0, 0);
    const stop = () => { cancelAnimationFrame(raf); timers.forEach(clearTimeout); };
    // A new page, Back and Forward too: move focus to its heading (screen readers announce it; Tab continues from the
    // page, not the nav). Not on first load, not when only the query changed, and never out of an open dialog or sheet.
    if (first || !moved) return stop;
    let n = 0;
    const heading = () => (document.querySelector("[aria-modal='true']") ? null : document.querySelector<HTMLElement>("#main h1"));
    const focusOn = (h: HTMLElement) => {
      if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1");
      h.focus({ preventScroll: true });
    };
    const aim = () => {
      if (document.querySelector("[aria-modal='true']")) return;
      const h = heading();
      if (!h) { if (++n < 90) raf = requestAnimationFrame(aim); return; }
      // a live control inside the page keeps focus (a closed sheet gave it back to its opener; a side nav that stays)
      const a = document.activeElement as HTMLElement | null;
      if (a && a !== document.body && a !== h && a.id !== "main" && a.isConnected && a.closest("#main")) return;
      focusOn(h);
    };
    raf = requestAnimationFrame(aim);
    // the control that kept focus can leave with the switch (the wallet's mode switch, a bar item drawn anew): focus
    // then fell to the page body; it goes to the heading instead (motion round)
    timers.push(window.setTimeout(() => {
      const h = document.activeElement === document.body ? heading() : null;
      if (h) focusOn(h);
    }, 700));
    return stop;
  }, [loc.key]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
