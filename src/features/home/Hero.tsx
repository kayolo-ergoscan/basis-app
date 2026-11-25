// The hero: copy on the left; on the right the note stack signed live in this page by the story economy, with the
// numbered callouts and their dashed leaders and the checks row; the sandbox town along the bottom (its tracker's
// tower catches moonlight on each commitment) and the live strip.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useLang, useT, rich } from "@/app/lang";
import { copy, pick } from "@/content";
import { Checks, Key, Lamp, NoteStack, Skyline, prefersReducedMotion, short, money, int, type NoteProps } from "@/ui";
import { FAQ_HREF } from "./Faq";
import { LiveStrip } from "./LiveStrip";
import { STORY, storyKeys, TRACKER_ID, TRACKER_NAME } from "./story";
import type { Pulse } from "@/app/pulse";
import { phaseAtLeast, useStory, type Phase } from "./useStory";

const ZERO_SIG = "00".repeat(65);

/** Splits "Pay with your word." into "Pay with" / "your word." (the approved three-line headline); RU likewise
 *  ("Платите" / "словом."). */
function headlineLines(line1: string): string[] {
  const sp = [...line1.matchAll(/ /g)].map((m) => m.index ?? 0);
  if (!sp.length) return [line1];
  const mid = line1.length / 2;
  const at = sp.reduce((b, i) => (Math.abs(i - mid) < Math.abs(b - mid) ? i : b), sp[0]);
  return [line1.slice(0, at), line1.slice(at + 1)];
}

const CHECK_STAGE: Record<Phase, 0 | 1 | 2 | 3> = { boot: 0, open: 0, signed: 1, witnessed: 2, committed: 3 };

/** Keeps the hero exactly one screen tall under the nav and the banner, and fits the headline to its column. */
function useHeroFit(hero: RefObject<HTMLElement>, head: RefObject<HTMLElement>, lang: string) {
  useLayoutEffect(() => {
    const el = hero.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
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
      });
    };
    measure();
    void document.fonts?.ready.then(measure);
    addEventListener("resize", measure);
    const host = el.closest(".shell-body")?.parentElement;
    const mo = host ? new MutationObserver(measure) : null;
    if (host && mo) mo.observe(host, { childList: true });
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", measure); mo?.disconnect(); };
  }, [hero, head, lang]);
}

/** Dashed leaders from the callouts to their spots on the front note (port of the tile's drawLeaders). */
function useLeaders(stage: RefObject<HTMLElement>, svg: RefObject<SVGSVGElement>, deps: unknown[]) {
  useEffect(() => {
    const st = stage.current, sv = svg.current;
    if (!st || !sv) return;
    let raf = 0;
    const draw = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const c1 = st.querySelector<HTMLElement>(".home-c1"), c2 = st.querySelector<HTMLElement>(".home-c2"), c3 = st.querySelector<HTMLElement>(".home-c3");
        const note = st.querySelector<HTMLElement>(".hero-note-wrap .note");
        if (!c1 || !note || getComputedStyle(c1).display === "none") { sv.innerHTML = ""; return; }
        const sr = st.getBoundingClientRect();
        const pt = (e: Element, ax: number, ay: number): [number, number] => { const r = e.getBoundingClientRect(); return [r.left - sr.left + r.width * ax, r.top - sr.top + r.height * ay]; };
        const parties = note.querySelector(".note-parties") ?? note;
        const foil = note.querySelector(".note-foil") ?? note;
        const seal = note.querySelector(".note-art g[transform^='translate(']");
        const links: [HTMLElement | null, number, number, [number, number]][] = [
          [c1, 0.04, 1, pt(parties, 0.08, 0.12)],
          [c3, 0.97, 1, pt(foil, 0.5, 0.16)],
          [c2, 0.03, 0, seal ? pt(seal, 0.5, 0.5) : pt(note, 0.73, 0.486)],
        ];
        let d = "";
        for (const [c, ax, ay, [x2, y2]] of links) {
          if (!c) continue;
          const [x1, y1] = pt(c, ax, ay);
          const y0 = ay === 1 ? y1 + 6 : y1 - 6;
          d += `<path d="M${x1.toFixed(1)} ${y0.toFixed(1)} L${x1.toFixed(1)} ${y2.toFixed(1)} L${x2.toFixed(1)} ${y2.toFixed(1)}"/><circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3.5"/>`;
        }
        sv.setAttribute("width", String(sr.width));
        sv.setAttribute("height", String(sr.height));
        sv.innerHTML = d;
      });
    };
    draw();
    const t1 = setTimeout(draw, 320), t2 = setTimeout(draw, 900);
    void document.fonts?.ready.then(draw);
    addEventListener("resize", draw);
    const host = st.closest(".hero");
    const fine = matchMedia("(pointer: fine)").matches && !prefersReducedMotion();
    if (fine) host?.addEventListener("pointermove", draw);
    return () => { cancelAnimationFrame(raf); clearTimeout(t1); clearTimeout(t2); removeEventListener("resize", draw); host?.removeEventListener("pointermove", draw); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}

/** The hero town's tower lights for the story tracker's commitments only. */
const storyTracker = (p: Pulse) => p.trackerId === TRACKER_ID;

export function Hero() {
  const t = useT();
  const { lang } = useLang();
  const { phase, snap, store } = useStory();
  const keys = useMemo(() => storyKeys(), []);
  const heroRef = useRef<HTMLElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  useHeroFit(heroRef, headRef, lang);
  useLeaders(stageRef, svgRef, [phase, !!snap, lang]);

  const issuer = t("home.name.alice");
  const receiver = t("home.name.bobOnNote");
  const lines = headlineLines(pick(copy.heroHeadline.line1, lang));

  const notes = useMemo(() => {
    if (!snap?.v0 || !snap.v1 || !snap.genesis) return null;
    const base = {
      issuer, receiver, issuerPk: snap.alicePub, receiverPk: snap.bobPub, noteKey: snap.noteKey, limit: STORY.limit,
      tracker: TRACKER_NAME, trackerId: TRACKER_ID,
    } satisfies Partial<NoteProps>;
    const g = snap.genesis;
    const raised = phaseAtLeast(phase, "signed") && snap.v2;
    const v = raised ? snap.v2! : snap.v1;
    const front: NoteProps = {
      ...base,
      amount: v.total,
      prev: raised ? snap.v1.total : snap.v0.total,
      settled: snap.redeemed,
      state: phase === "committed" && snap.commit ? "committed" : phase === "signed" ? "signed" : "tracked",
      digest: phase === "committed" && snap.commit ? snap.commit.digest : g.digest,
      block: phase === "committed" && snap.commit ? snap.commit.height : g.height,
      sigA: v.sigA,
      sigT: phase === "signed" ? ZERO_SIG : v.sigT ?? ZERO_SIG,
      live: true, odometer: true, loupe: true,
    };
    const back: NoteProps[] = [
      ...(raised ? [{ ...base, amount: snap.v1.total, prev: snap.v0.total, state: "tracked" as const, digest: g.digest, block: g.height, sigA: snap.v1.sigA, sigT: snap.v1.sigT ?? ZERO_SIG }] : []),
      { ...base, amount: snap.v0.total, state: "tracked" as const, digest: g.digest, block: g.height, sigA: snap.v0.sigA, sigT: snap.v0.sigT ?? ZERO_SIG },
    ];
    return { front, back };
  }, [snap, phase, issuer, receiver]);

  // the older versions join the stack one task after the front note (each note's art is its own main-thread task)
  const backSig = notes ? notes.back.map((b) => b.amount).join("|") + issuer + receiver : "";
  const latest = useRef(notes);
  latest.current = notes;
  const [back, setBack] = useState<NoteProps[]>([]);
  useEffect(() => {
    if (!backSig) { setBack((b) => (b.length ? [] : b)); return; }
    const id = setTimeout(() => setBack(latest.current?.back ?? []), 0);
    return () => clearTimeout(id);
  }, [backSig]);

  const status = !snap
    ? t("home.stage.boot")
    : phase === "committed" && snap.commit
      ? t("home.stage.committed", { n: int(snap.commit.height) })
      : phase === "witnessed"
        ? t("home.stage.witnessed")
        : phase === "signed"
          ? t("home.stage.signed", { v: money(STORY.first + STORY.raise) })
          : t("home.stage.open", { v: money(STORY.first) });

  const scrollToMoments = () => {
    const el = document.getElementById("moments");
    el?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  const callouts = [
    { n: 1, k: t("home.c1.k"), a: t("home.c1.a"), b: t("home.c1.b") },
    { n: 2, k: t("home.c2.k"), a: t("home.c2.a"), b: rich(t("home.c2.b"), { key: <span className="home-key mono">{short(snap?.noteKey ?? keys.noteKey, 4, 4)}</span> }) },
    { n: 3, k: t("home.c3.k"), a: t("home.c3.a"), b: t("home.c3.b") },
  ];
  const callout = (i: number, cls: string) => (
    <div className={`callout-n ${cls}`}>
      <span className="k"><i>{callouts[i].n}</i>{callouts[i].k}</span>
      <p>{callouts[i].a} <span>{callouts[i].b}</span></p>
    </div>
  );

  return (
    <section className="hero home-hero" ref={heroRef} aria-label={t("home.hero.aria")}>
      <Skyline className="home-town" seed={23} height={170} lit={0.2} tower={760} towerFilter={storyTracker} />
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
            <button type="button" className="textlink home-how" onClick={scrollToMoments}>{t("home.cta.how")} <span aria-hidden="true">↓</span></button>
            <Link className="textlink home-how" to={FAQ_HREF}>{t("home.cta.faq")} <span aria-hidden="true">→</span></Link>
          </div>
          <ul className="home-materials" aria-label={t("home.mat.aria")}>
            <li><i className="msw line" aria-hidden="true" /><b>{t("home.mat.line")}</b><span>{t("home.mat.line.sub")}</span></li>
            <li><i className="msw metal" aria-hidden="true" /><b>{t("home.mat.metal")}</b><span>{t("home.mat.metal.sub")}</span></li>
            <li><i className="msw light" aria-hidden="true" /><b>{t("home.mat.light")}</b><span>{t("home.mat.light.sub")}</span></li>
          </ul>
        </div>

        <div className="home-stage" ref={stageRef}>
          <svg className="leaders" ref={svgRef} aria-hidden="true" />
          <div className="home-stage-col">
            <div className="home-callrow">
              {callout(0, "home-c1")}
              {callout(2, "home-c3")}
            </div>
            <div className="home-notewrap" style={{ "--n": notes ? 1 : 0 } as CSSProperties}>
              {notes ? <NoteStack className="home-notes" front={notes.front} back={back} /> : <div className="home-note-ph" aria-hidden="true" />}
            </div>
            <div className="stage-foot home-foot">
              <div className="home-foot-l">
                <Checks stage={CHECK_STAGE[phase]} issuer={issuer} tracker={TRACKER_NAME} block={phase === "committed" ? snap?.commit?.height : undefined} />
                <span className="sr-only" role="status">{phase === "committed" && snap?.commit ? t("home.stage.sr", { v: money(snap.v2?.total ?? STORY.first + STORY.raise), n: int(snap.commit.height) }) : ""}</span>
                <p className="home-sbx">
                  <Lamp state="live" size={8} />
                  <b>{t("home.stage.sandbox")}</b>
                  <span className="sep" aria-hidden="true">·</span>
                  <span>{status}</span>
                  {snap && (
                    <span className="home-sbx-tail">
                      <span className="avl">{snap.avl.simulated ? t("home.stage.avlSim") : t("home.stage.avlReal")}</span>
                      {phase === "committed" && !prefersReducedMotion() && (
                        <button type="button" className="home-replay" onClick={() => store?.replay()}>{t("home.stage.replay")}</button>
                      )}
                    </span>
                  )}
                </p>
              </div>
              {callout(1, "home-c2")}
            </div>
            <ol className="home-callist" aria-label={t("home.list.aria")}>
              {callouts.map((c) => (
                <li key={c.n}><span className="k"><i>{c.n}</i>{c.k}</span><p>{c.a} <span>{c.b}</span></p></li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      <LiveStrip />
    </section>
  );
}
