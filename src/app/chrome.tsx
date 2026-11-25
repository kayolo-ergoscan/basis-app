// Shell chrome: top nav (VISUAL §12.12), menu sheet (≤ 1280), phone tab bar, pre-launch banner, live tape, footer.
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { BrandMark, Skyline } from "@/ui/components/Town";
import { Icon, type IconName } from "@/ui/components/Icon";
import { Chip, Lamp, Seg } from "@/ui/components/primitives";
import { Sheet } from "@/ui/components/Sheet";
import { flash, usePulseClass } from "@/ui/hooks";
import { int, short } from "@/ui/engine/money";
import { openCommandBar, openHelp } from "./commands";
import { useHeight } from "./height";
import { useLang, useT } from "./lang";
import { pulse, usePulse, type Pulse } from "./pulse";
import { hrefOf, linkOf, NAV, preload } from "./routes";
import type { FeatureRoute } from "./types";
import { useTheme } from "./theme";

const NAV_ICON: Record<string, IconName> = { home: "story", play: "play", wallet: "wallet", network: "network", tracker: "tracker", learn: "learn" };
export const iconOf = (id: string, icon?: string): IconName => (icon as IconName) || NAV_ICON[id] || "note";
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? "⌘" : "Ctrl";

/** The wordmark "Basis" (the mark beside it carries the pulse). */
function Wordmark() {
  return <span className="wordmark" aria-hidden="true">Basis</span>;
}

/** Live Ergo height: lamp pings once per new block; the chip is part of the pulse. */
export function HeightChip() {
  const t = useT();
  const h = useHeight();
  const lamp = useRef<HTMLSpanElement>(null);
  const chip = useRef<HTMLElement>(null);
  const last = useRef<number | null>(null);
  usePulseClass(chip);
  useEffect(() => {
    if (h.height == null) return;
    if (last.current != null && h.height > last.current) flash(lamp.current?.querySelector(".lamp"), "ping", 1200);
    last.current = h.height;
  }, [h.height]);
  // offline before the first answer: say so calmly (a grey lamp and a word), never an error colour
  const offline = h.height == null && h.error;
  const title = offline ? t("app.height.offline.title") : h.height == null ? t("app.height.wait") : h.error ? t("app.height.stale") : t("app.height.title");
  // «Блок 1 922 434» / "Block 1,922,434"; offline it is the network that is gone: «Ergo нет связи»
  const word = offline ? "Ergo" : t("app.height.label");
  return (
    <Link to="/network" className="chip height" title={title} ref={chip as React.Ref<HTMLAnchorElement>} aria-label={`${word} ${h.height != null ? int(h.height) : offline ? t("app.height.offline") : "…"}. ${title}`}>
      <span ref={lamp} style={{ display: "inline-flex" }}><Lamp state={offline ? "stale" : h.height == null ? "signed" : h.error ? "stale" : "live"} /></span>
      <span className="lbl-l">{word}</span> {offline ? <span className="off">{t("app.height.offline")}</span> : <b className="num">{h.height != null ? int(h.height) : "· · ·"}</b>}
    </Link>
  );
}

export function ThemeSeg() {
  const t = useT();
  const { theme, setTheme } = useTheme();
  return <Seg ariaLabel={t("app.theme.aria")} value={theme} onChange={setTheme} options={[{ value: "night", label: t("app.theme.night") }, { value: "cotton", label: t("app.theme.cotton") }]} />;
}
export function LangSeg({ className }: { className?: string }) {
  const t = useT();
  const { lang, setLang } = useLang();
  return <Seg ariaLabel={t("app.lang.aria")} className={className} value={lang} onChange={setLang} options={[{ value: "en", label: "EN", title: "English" }, { value: "ru", label: "RU", title: "Русский" }]} />;
}

/** A menu entry whose link is not its base (the wallet) stays lit on every page under the base. */
const inRoute = (r: FeatureRoute, pathname: string): boolean => {
  if (!r.href || r.path === "/") return false;
  const base = hrefOf(r);
  return pathname === base || pathname.startsWith(base + "/");
};

export function Nav() {
  const t = useT();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => setMenu(false), [loc.pathname]);
  return (
    <header className="nav">
      <div className="container">
        <Link className="brand" to="/" aria-label={t("app.brand.home")}>
          <BrandMark />
          <Wordmark />
          <span className="brand-sub">{t("app.brand.sub")}</span>
        </Link>
        <nav className="nav-links" aria-label={t("nav.primary")}>
          {NAV.map((r) => (
            <NavLink key={r.id} to={linkOf(r)} end={r.path === "/"} className={({ isActive }) => (isActive || inRoute(r, loc.pathname) ? "on" : undefined)}
              onMouseEnter={() => preload(r)} onFocus={() => preload(r)}>
              {t(r.nav!.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="nav-right">
          <button type="button" className="key sm quiet search-k" onClick={() => openCommandBar()} aria-label={t("app.cmd.aria")}>
            <Icon name="search" size={16} /><span className="kbd">{MOD} K</span>
          </button>
          <HeightChip />
          <ThemeSeg />
          <LangSeg className="hide-s" />
          <Link className="key sm" to="/wallet/mainnet">{t("app.openWallet")}</Link>
          <button type="button" className="key sm quiet icon-only menu-k" onClick={() => setMenu(true)} aria-label={t("app.menu")} aria-expanded={menu}><Icon name="menu" /></button>
        </div>
      </div>
      <Sheet open={menu} onClose={() => setMenu(false)} title={<span className="cluster menu-brand" style={{ "--gap": "10px" } as CSSProperties}><BrandMark pulse={false} size={26} />Basis</span>} ariaLabel={t("app.menu")} width={380}>
        <nav className="menu-links" aria-label={t("nav.primary")}>
          {NAV.map((r) => (
            <NavLink key={r.id} to={linkOf(r)} end={r.path === "/"} className={({ isActive }) => (isActive || inRoute(r, loc.pathname) ? "on" : undefined)}>
              <Icon name={iconOf(r.id, r.nav?.icon)} />{t(r.nav!.labelKey)}
            </NavLink>
          ))}
        </nav>
        <div className="menu-row">
          <HeightChip />
          <ThemeSeg />
          <LangSeg />
        </div>
        <div className="menu-row">
          <button type="button" className="key sm" onClick={() => { setMenu(false); openCommandBar(); }}><Icon name="search" size={16} />{t("app.cmd.aria")}</button>
          <button type="button" className="key sm quiet" onClick={() => { setMenu(false); openHelp(); }}><Icon name="keyboard" size={16} />{t("app.footer.keys")}</button>
        </div>
      </Sheet>
    </header>
  );
}

const TABS: { to: string; key: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: "/wallet", key: "nav.wallet", icon: "wallet", match: (p) => p === "/wallet" || (p.startsWith("/wallet/") && !p.startsWith("/wallet/notes") && !p.startsWith("/wallet/settings")) },
  { to: "/wallet/notes", key: "nav.notes", icon: "notes", match: (p) => p.startsWith("/wallet/notes") },
  { to: "/play", key: "nav.play", icon: "play", match: (p) => p === "/play" || p.startsWith("/play/") },
  { to: "/network", key: "nav.network", icon: "network", match: (p) => p === "/network" || p.startsWith("/network/") },
  { to: "/wallet/settings", key: "nav.you", icon: "you", match: (p) => p.startsWith("/wallet/settings") },
];
/** Phone tab bar: Wallet · Notes · Play · Network · You (84 px glass). */
export function TabBar() {
  const t = useT();
  const { pathname } = useLocation();
  return (
    <nav className="tabbar" aria-label={t("nav.primary")}>
      {TABS.map((x) => {
        const on = x.match(pathname);
        return <Link key={x.to} to={x.to} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}><Icon name={x.icon} size={24} />{t(x.key)}</Link>;
      })}
    </nav>
  );
}

const BANNER_KEY = "basis.banner.mainnet"; // a new text: a notice hidden before is shown once more
/** Thin notice: our tracker on mainnet (beta), unofficial, small amounts only. Once per session, dismissible (PRODUCT §1). */
export function Banner() {
  const t = useT();
  const [hidden, setHidden] = useState(() => { try { return sessionStorage.getItem(BANNER_KEY) === "1"; } catch { return false; } });
  if (hidden) return null;
  return (
    <div className="banner" role="note">
      <div className="container">
        <Icon name="info" className="ic" />
        <p>{t("app.banner")}</p>
        <button type="button" className="key sm quiet icon-only x" aria-label={t("app.banner.close")} onClick={() => { setHidden(true); try { sessionStorage.setItem(BANNER_KEY, "1"); } catch { /* ignore */ } }}>
          <Icon name="close" size={16} />
        </button>
      </div>
    </div>
  );
}

/** Routes without the tape: on the mainnet wallet (real ERG) a «ПЕСОЧНИЦА · ЛЕНТА — Ждём следующую фиксацию» bar under
 *  the key reads as if that key were a play key, and nothing on the tape is about that page. */
export const tapeHidden = (pathname: string): boolean => /^\/wallet\/mainnet(\/|$)/.test(pathname);

/** Desktop live tape above the footer: the last commitments on the pulse bus and the Ergo height. */
export function LiveTape() {
  const t = useT();
  const { pathname } = useLocation();
  const [list, setList] = useState<Pulse[]>(() => { const l = pulse.last(); return l ? [l] : []; });
  usePulse((p) => setList((x) => [p, ...x].slice(0, 6)));
  if (tapeHidden(pathname)) return null;
  const src = list[0]?.source ?? "sandbox";
  return (
    <div className="shell-tape" aria-label={t(src === "sandbox" ? "ui.tape.sandbox" : "ui.tape.mainnet")}>
      <div className="container">
        <span className="label"><b>{t(src === "sandbox" ? "ui.tape.sandbox" : "ui.tape.mainnet")}</b></span>
        <div className="board-rows">
          {list.length === 0 && <span className="board-row">{t("app.tape.waiting")}</span>}
          {list.map((p, i) => (
            <span key={`${p.digest}-${i}`} className="board-row">
              <span className="ev">COMMIT</span><Lamp state="committed" size={8} />
              {p.trackerId.length > 16 ? short(p.trackerId, 4, 4) : p.trackerId.toUpperCase()} · <span className="mono">{short(p.digest, 4, 2)}</span>
              <b>{t("ui.tracker.block", { n: int(p.height) })}</b>
              {p.noteKeys?.length ? <span>· {t.p("ui.tape.notes", p.noteKeys.length)}</span> : null}
            </span>
          ))}
        </div>
        <HeightChip />
      </div>
    </div>
  );
}

export function Footer() {
  const t = useT();
  return (
    <footer className="foot">
      <Skyline className="foot-town" seed={11} height={110} />
      <div className="container">
        <div className="f-brand">
          <span className="cluster" style={{ "--gap": "10px" } as CSSProperties}><BrandMark pulse={false} size={24} /><b className="f-word">Basis</b><span className="f-unoff">{t("app.footer.unofficial")}</span></span>
          <span>{t("app.footer.line")}</span>
          <span>{t("app.footer.prelaunch")}</span>
        </div>
        <nav aria-label={t("app.footer.sources")}>
          <div className="f-col">
            <span className="label">{t("app.footer.sources")}</span>
            <a href="https://github.com/BetterMoneyLabs/basis-tracker" target="_blank" rel="noreferrer"><Icon name="github" size={15} />{t("app.footer.code")} <span className="mono">github.com/BetterMoneyLabs/basis-tracker</span></a>
            <a href="https://t.me/chaincashtalks" target="_blank" rel="noreferrer"><Icon name="chat" size={15} />{t("app.footer.chat")} <span className="mono">t.me/chaincashtalks</span></a>
            <a href="https://ergoscan.me" target="_blank" rel="noreferrer"><Icon name="ext" size={15} />{t("app.footer.explorer")} <span className="mono">ergoscan.me</span></a>
          </div>
          <div className="f-col">
            <span className="label">Basis</span>
            <Link to="/kit">{t("app.footer.kit")}</Link>
            <button type="button" className="textlink" style={{ background: "none", border: 0, padding: 0, cursor: "pointer", font: "inherit", color: "var(--ink-2)" }} onClick={() => openHelp()}>{t("app.footer.keys")}</button>
          </div>
        </nav>
      </div>
    </footer>
  );
}
