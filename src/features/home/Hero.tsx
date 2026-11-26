// The hero: the place you enter. One sentence and two actions over the town at night (sky, moon, three rows of houses
// with depth, the clock tower that catches the story tracker's commitments), and the live strip as its street. The
// note signed live in this page moved into «How it works» (Street.tsx).
import { useLayoutEffect, useRef, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useLang, useT, rich } from "@/app/lang";
import type { Pulse } from "@/app/pulse";
import { copy, pick } from "@/content";
import { Key, Lamp, NightScene, prefersReducedMotion } from "@/ui";
import { FAQ_HREF } from "./Faq";
import { LiveStrip } from "./LiveStrip";
import { TRACKER_ID } from "./story";

/** Splits "Pay with your word." into "Pay with" / "your word." (the approved three-line headline); RU likewise
 *  ("Платите" / "словом."). */
function headlineLines(line1: string): string[] {
  const sp = [...line1.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (!sp.length) return [line1];
  const mid = line1.length / 2;
  const at = sp.reduce((b, i) => (Math.abs(i - mid) < Math.abs(b - mid) ? i : b), sp[0]);
  return [line1.slice(0, at), line1.slice(at + 1)];
}

/** Keeps the hero exactly one screen tall under the nav and the banner, and fits the headline to its column. */
function useHeroFit(hero: RefObject<HTMLElement>, head: RefObject<HTMLElement>, lang: string) {
  useLayoutEffect(() => {
    const el = hero.current;
    if (!el) return;
    let raf = 0;
    const fit = () => {
      let y = 0;
      for (let n: HTMLElement | null = el; n; n = n.offsetParent as HTMLElement | null) y += n.offsetTop;
      el.style.setProperty("--hero-top", `${Math.max(0, Math.round(y))}px`);
      const h = head.current;
      if (!h) return;
      h.style.setProperty("--hero-fit", "1");
      const col = h.clientWidth;
      let widest = 0;
      h.querySelectorAll<HTMLElement>(".ln").forEach((l) => { widest = Math.max(widest, l.scrollWidth); });
      if (col > 0 && widest > col) h.style.setProperty("--hero-fit", (Math.floor((col / widest) * 1000) / 1000).toString());
    };
    const measure = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(fit); };
    // the first fit before the first paint (motion round: it ran a frame later, so the hero's height and the headline's
    // size changed under the reader on every visit, moving everything below by 3 px, or 32 px on a phone)
    fit();
    void document.fonts?.ready.then(measure);
    addEventListener("resize", measure);
    const host = el.closest(".shell-body")?.parentElement;
    const mo = host ? new MutationObserver(measure) : null;
    if (host && mo) mo.observe(host, { childList: true });
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", measure); mo?.disconnect(); };
  }, [hero, head, lang]);
}

/** The tower lights for the story tracker's commitments only (a stable filter: the scene is memoised). */
const storyTracker = (p: Pulse) => p.trackerId === TRACKER_ID;

export function Hero() {
  const t = useT();
  const { lang } = useLang();
  const heroRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  useHeroFit(heroRef, headRef, lang);
  const lines = headlineLines(pick(copy.heroHeadline.line1, lang));
  const toHow = () => document.getElementById("how")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });

  return (
    <section className="hero home-hero" ref={heroRef} aria-label={t("home.hero.aria")}>
      <div className="home-scene"><NightScene towerFilter={storyTracker} /></div>
      <div className="container home-hero-grid">
        <div className="home-hero-copy">
          <p className="eyebrow label home-eyebrow"><Lamp state="committed" />{pick(copy.eyebrow, lang)}</p>
          <h1 className="t-hero home-h1" ref={headRef}>
            {lines.map((l, i) => <span key={i} className="ln">{l}</span>)}
            <span className="ln"><em>{pick(copy.heroHeadline.line2, lang)}</em></span>
          </h1>
          <p className="t-lede home-lede">{rich(t("home.lede"))}</p>
          <div className="home-cta">
            <Key variant="primary" size="lg" kbd="P" to="/play">{t("home.cta.play")}</Key>
            <Key size="lg" to="/wallet/mainnet">{t("home.cta.wallet")}</Key>
          </div>
          <p className="home-more">
            <Link className="textlink home-how" to={FAQ_HREF}>{t("home.cta.faq")} <span aria-hidden="true">→</span></Link>
          </p>
        </div>
      </div>
      <button type="button" className="home-down" onClick={toHow}>{t("home.cta.how")} <span aria-hidden="true">↓</span></button>
      <LiveStrip />
    </section>
  );
}
