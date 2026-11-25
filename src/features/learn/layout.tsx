// The book frame: sticky contents with scroll-spy, the article head, sections, prose helpers, figures, side
// notes, fact lines, try-it keys, terms, sources and the prev/next pager. Every Learn page except the index
// renders inside <BookLayout> and registers its sections with useBookSections().
import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { rich, useT } from "@/app";
import { Icon, Key, Page, PageLoading, Tag } from "@/ui";
import { glossary, pick, sources, type LineRef, type SourceId, type Text } from "@/content";
import { LEARN_PAGES, PARTS, neighbours, pageOf, type LearnPage, type LearnPageId, type ScenarioRef } from "./pages";
import { markRead, useReadChapters } from "./progress";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ---------------------------------------------------------------- text helpers */

/** Content strings mark inline code with backticks: render the odd parts as <code>. */
export function inline(s: string): ReactNode {
  if (!s.includes("`")) return s;
  const parts = s.split("`");
  return parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p));
}

/** A content Text in the current language, with inline code. */
export function Tx({ t: text }: { t: Text }) {
  const t = useT();
  return <>{inline(pick(text, t.lang))}</>;
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx("lrn-p", className)}>{children}</p>;
}

/** Paragraphs from content. */
export function Paras({ items }: { items: readonly Text[] }) {
  const t = useT();
  return <>{items.map((x, i) => <p className="lrn-p" key={i}>{inline(pick(x, t.lang))}</p>)}</>;
}

/* ---------------------------------------------------------------- title */

/** Sets document.title after the route frame's own title effect (which uses the feature's titleKey). */
export function useLearnTitle(title: string) {
  useEffect(() => {
    const id = window.setTimeout(() => { document.title = `${title} · Basis`; }, 0);
    return () => window.clearTimeout(id);
  }, [title]);
}

/* ---------------------------------------------------------------- sections registry */

export interface TocSection { id: string; label: string }
const BookCtx = createContext<{ setSecs: (s: TocSection[]) => void; ready: () => void } | null>(null);

/** Registers this page's sections with the contents rail. */
export function useBookSections(secs: TocSection[]) {
  const ctx = useContext(BookCtx);
  const key = secs.map((s) => s.id + "\u0001" + s.label).join("\u0002");
  useEffect(() => {
    ctx?.setSecs(secs);
    ctx?.ready();
    return () => ctx?.setSecs([]);
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function pageIdOf(pathname: string): LearnPageId | null {
  const seg = pathname.replace(/^\/learn\/?/, "").split("/")[0];
  return (LEARN_PAGES.find((p) => p.path === `/learn/${seg}`)?.id ?? null) as LearnPageId | null;
}

/* ---------------------------------------------------------------- the frame */

export function BookLayout() {
  const t = useT();
  const loc = useLocation();
  const current = pageIdOf(loc.pathname);
  const [secs, setSecs] = useState<TocSection[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const mRef = useRef<HTMLDetailsElement>(null);

  // a #hash that points into a lazily loaded page: scroll once it has rendered
  const hashDone = useRef<string | null>(null);
  const ready = useCallback(() => {
    const h = window.location.hash;
    if (!h || hashDone.current === window.location.pathname + h) return;
    hashDone.current = window.location.pathname + h;
    const id = decodeURIComponent(h.slice(1));
    const go = () => document.getElementById(id)?.scrollIntoView();
    requestAnimationFrame(go);
    window.setTimeout(go, 120);
  }, []);
  const ctx = useMemo(() => ({ setSecs, ready }), [ready]);

  useEffect(() => {
    if (!secs.length) { setActive(null); return; }
    let raf = 0;
    const run = () => {
      raf = 0;
      let cur = secs[0].id;
      for (const s of secs) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - 150 <= 0) cur = s.id;
        else break;
      }
      setActive(cur);
      const f = flowRef.current;
      if (f) {
        const r = f.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 1;
        railRef.current?.style.setProperty("--p", p.toFixed(3));
        // read to (nearly) the end: the chapter counts as read in your progress
        if (p >= 0.85 && current) markRead(current);
      }
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(run); };
    run();
    window.addEventListener("scroll", on, { passive: true });
    window.addEventListener("resize", on);
    // lazy figures change the page height without a scroll event: follow the layout too
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(on) : null;
    if (ro && flowRef.current) ro.observe(flowRef.current);
    return () => { window.removeEventListener("scroll", on); window.removeEventListener("resize", on); ro?.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [secs, current]);

  const closeMobile = () => { if (mRef.current) mRef.current.open = false; };
  const curPage = current ? pageOf(current) : null;
  const curSec = secs.find((s) => s.id === active);

  return (
    <BookCtx.Provider value={ctx}>
      <Page className="lrn-page">
        <div className="lrn">
          <aside className="lrn-toc" ref={railRef} aria-label={t("learn.toc.label")}>
            <Toc current={current} secs={secs} active={active} />
          </aside>
          <div className="lrn-flow" ref={flowRef}>
            <details className="lrn-toc-m" ref={mRef}>
              <summary>
                <span>{t("learn.toc.open")}</span>
                <span className="cur">{curPage ? `${curPage.numeral} · ${t(`learn.page.${curPage.id}.toc`)}${curSec ? ` · ${curSec.label}` : ""}` : ""}</span>
                <Icon name="down" size={18} />
              </summary>
              {/* same wrapper as the rail, so the drawer gets the rail's list styles (no list numbers, no stray progress line) */}
              <div className="lrn-toc">
                <Toc current={current} secs={secs} active={active} onNav={closeMobile} />
              </div>
            </details>
            <Suspense fallback={<PageLoading label={t("learn.loading")} />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </Page>
    </BookCtx.Provider>
  );
}

/** Your progress: one window per chapter, lit once you read it to the end. */
export function ReadWindows({ read, className }: { read: Set<string>; className?: string }) {
  const t = useT();
  const n = LEARN_PAGES.filter((p) => read.has(p.id)).length;
  return (
    <span className={cx("lrn-prog", className)} role="img" aria-label={t("learn.progress.n", { n, total: LEARN_PAGES.length })}>
      {LEARN_PAGES.map((p) => <i key={p.id} className={read.has(p.id) ? "on" : undefined} />)}
    </span>
  );
}

function Toc({ current, secs, active, onNav }: { current: LearnPageId | null; secs: TocSection[]; active: string | null; onNav?: () => void }) {
  const t = useT();
  const read = useReadChapters();
  const nRead = LEARN_PAGES.filter((p) => read.has(p.id)).length;
  const navigate = useNavigate();
  const go = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    onNav?.();
    navigate({ hash: "#" + id }, { replace: true });
  };
  return (
    <nav>
      <div className="lrn-toc-top">
        <span className="label">{t("learn.toc.label")}</span>
        <Link to="/learn" onClick={onNav}>{t("learn.toc.all")}<Icon name="right" size={14} /></Link>
      </div>
      <div className="lrn-toc-prog">
        <ReadWindows read={read} />
        <span className="t-small">{t("learn.progress.n", { n: nRead, total: LEARN_PAGES.length })}</span>
      </div>
      {PARTS.map((part) => (
        <div className="lrn-toc-part" key={part.n}>
          <span className="label">{part.numeral} · {t(`learn.part.${part.n}`)}</span>
          <ol>
            {LEARN_PAGES.filter((p) => p.part === part.n).map((p) => {
              const on = p.id === current;
              return (
                <li key={p.id} className={cx("lrn-toc-page", on && "on", read.has(p.id) && "read")}>
                  <Link to={p.path} aria-current={on ? "page" : undefined} onClick={onNav}>
                    <span className="n">{p.numeral}</span>
                    <span>{t(`learn.page.${p.id}.toc`)}{read.has(p.id) && <span className="sr-only"> · {t("learn.progress.read")}</span>}</span>
                  </Link>
                  {on && secs.length > 0 && (
                    <ol className="lrn-toc-secs" aria-label={t("learn.toc.here")}>
                      {secs.map((s) => (
                        <li key={s.id}>
                          <a href={`#${s.id}`} className={s.id === active ? "on" : undefined} aria-current={s.id === active ? "location" : undefined} onClick={go(s.id)}>
                            {s.label}
                          </a>
                        </li>
                      ))}
                    </ol>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </nav>
  );
}

/* ---------------------------------------------------------------- article head */

export function timeLabel(page: LearnPage, minutes: number, t: ReturnType<typeof useT>): string {
  return page.kind === "lab" ? t("learn.time.lab", { n: minutes }) : page.kind === "read" ? t("learn.time.read", { n: minutes }) : t(`learn.kind.${page.kind}`);
}

export function BookHead({ id, lede, minutes, meta }: { id: LearnPageId; lede?: ReactNode; minutes?: number; meta?: ReactNode }) {
  const t = useT();
  const page = pageOf(id);
  useLearnTitle(t(`learn.page.${id}.title`));
  const mins = minutes ?? page.labMinutes;
  return (
    <header className="lrn-head">
      {/* each item draws its own leading rule; the one that starts a line is clipped, so a wrap never leaves a dangling rule */}
      <div className="lrn-kicker label">
        <span className="lrn-kicker-in">
          <span>{t("learn.part", { n: PARTS[page.part - 1].numeral })}</span>
          <span>{t("learn.chapter", { n: page.numeral })}</span>
          <span>{t(`learn.kind.${page.kind}`)}</span>
          {mins ? <span>{t("learn.min", { n: mins })}</span> : null}
        </span>
      </div>
      <h1 className="lrn-title">{rich(t(`learn.page.${id}.head`))}</h1>
      {lede && <p className="t-lede">{lede}</p>}
      {meta && <div className="lrn-meta">{meta}</div>}
    </header>
  );
}

/* ---------------------------------------------------------------- section */

/** Section title as plain text (contents rail, key labels): no *italics* markers, no closing full stop. */
export function plainTitle(s: string): string {
  return s.replace(/\*/g, "").replace(/[.。]\s*$/, "").trim();
}

export function Sec({ id, no, title, lede, first, children, className, side, sideLabel }: { id: string; no?: ReactNode; title: ReactNode; lede?: ReactNode; first?: boolean; children?: ReactNode; className?: string; side?: ReactNode; sideLabel?: ReactNode }) {
  return (
    <section id={id} className={cx("lrn-sec", first && "first", className)} aria-labelledby={`${id}-h`} style={{ display: "flow-root" }}>
      {side && <aside className="lrn-side w">{sideLabel && <span className="label">{sideLabel}</span>}{side}</aside>}
      <header className="lrn-sec-head">
        {no != null && <div className="lrn-no">{no}</div>}
        <h2 className="lrn-h2" id={`${id}-h`}>{title}</h2>
        {lede && <p className="t-lede">{lede}</p>}
      </header>
      {side && <aside className="lrn-side n">{sideLabel && <span className="label">{sideLabel}</span>}{side}</aside>}
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- blocks */

export function Pull({ children, cite }: { children: ReactNode; cite?: ReactNode }) {
  return (
    <blockquote className="lrn-pull">
      <p>{children}</p>
      {cite && <cite>{cite}</cite>}
    </blockquote>
  );
}

/** Lines of a contract → a link into the contract X-ray. */
export function linesHref(r: { from: number; to: number; contract?: "basis" | "token" }): string {
  const c = r.contract === "token" ? "&c=token" : "";
  return `/learn/contract?lines=${r.from}-${r.to}${c}#xray`;
}

export function LinesLink({ r, className }: { r: LineRef; className?: string }) {
  const t = useT();
  const file = r.contract === "token" ? "basis-token.es" : "basis.es";
  return (
    <Link className={className} to={linesHref(r)}>
      {r.from === r.to ? t("learn.line", { file, a: r.from }) : t("learn.lines", { file, a: r.from, b: r.to })}
      <Icon name="right" size={12} />
    </Link>
  );
}

export function Fact({ text, lines, label }: { text: Text | string; lines?: LineRef; label?: ReactNode }) {
  const t = useT();
  return (
    <div className="lrn-fact">
      <span className="label">{label ?? t("learn.fact")}</span>
      <span className="v">{typeof text === "string" ? inline(text) : inline(pick(text, t.lang))}</span>
      {lines ? <LinesLink r={lines} className="src" /> : <span />}
    </div>
  );
}

export function Side({ children, label, low }: { children: ReactNode; label?: ReactNode; low?: boolean }) {
  return (
    <aside className={cx("lrn-side", low && "low")}>
      {label && <span className="label">{label}</span>}
      {children}
    </aside>
  );
}

export function SandboxTag() {
  const t = useT();
  return <Tag tone="agent" glyph="◇">{t("viz.sandbox")}</Tag>;
}

export interface FigProps {
  n?: string;
  caption?: ReactNode;
  tag?: ReactNode;
  /** Use the full width of the flow (wider than the 720 px reading column). */
  wide?: boolean;
  /** No frame: the child brings its own card. */
  bare?: boolean;
  flush?: boolean;
  /** Phone: scroll horizontally inside the frame, keeping this minimum width. */
  minWidth?: number;
  label?: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function Fig({ n, caption, tag, wide, bare, flush, minWidth, label, children, className, style }: FigProps) {
  const t = useT();
  const inner = minWidth ? <div className="lrn-wide-inner" style={{ "--minw": `${minWidth}px` } as CSSProperties}>{children}</div> : children;
  return (
    <figure className={cx("lrn-fig", !wide && "narrow", bare && "bare", className)} style={style} aria-label={label}>
      <div className={cx("lrn-frame", flush && "flush", !!minWidth && "lrn-scroll")}>
        {tag && <div className="lrn-fig-tag">{tag}</div>}
        {inner}
      </div>
      {(caption || n) && (
        <figcaption>
          {n && <span className="no">{t("learn.fig", { n })}</span>}
          {caption && <span>{caption}</span>}
        </figcaption>
      )}
    </figure>
  );
}

/** "Try it" keys to /play scenarios (and optional extra links). */
export function TryIt({ scenarios, extra }: { scenarios: ScenarioRef[]; extra?: ReactNode }) {
  const t = useT();
  if (!scenarios.length && !extra) return null;
  return (
    <div className="lrn-try">
      <span className="label">{t("learn.tryIt")}</span>
      {scenarios.map((s) => (
        <Key key={s} size="sm" icon="play" to={`/play/${s}`}>{t("learn.play", { name: t(`learn.sc.${s}`) })}</Key>
      ))}
      {extra}
    </div>
  );
}

/** Glossary chips. */
export function Terms({ ids }: { ids: readonly string[] }) {
  const t = useT();
  const items = ids.map((id) => glossary.find((g) => g.id === id)).filter((x): x is NonNullable<typeof x> => !!x);
  if (!items.length) return null;
  return (
    <div className="lrn-terms">
      {items.map((g) => (
        <Link key={g.id} className="lrn-term" to={`/learn/glossary#t-${g.id}`}>{t.lang === "ru" ? g.ru : g.en}</Link>
      ))}
    </div>
  );
}

/** First-party sources, as small external links. */
export function SourceLinks({ ids }: { ids: readonly SourceId[] }) {
  const t = useT();
  if (!ids.length) return null;
  return (
    <div className="lrn-sources">
      {ids.map((id) => {
        const s = sources[id];
        if (!s) return null;
        return (
          <a key={id} className="lrn-src" href={s.url} target="_blank" rel="noreferrer">
            <span className="k">{t(`learn.so.kind.${s.kind}`)}</span>
            <span>{pick(s.title, t.lang)}</span>
          </a>
        );
      })}
    </div>
  );
}

/* ---------------------------------------------------------------- pager */

export function Pager({ id }: { id: LearnPageId }) {
  const t = useT();
  const { prev, next } = neighbours(id);
  return (
    <nav className="lrn-pager" aria-label={t("learn.toc.label")}>
      {prev ? (
        <Link to={prev.path} className="prev">
          <span className="label">← {t("learn.prev")} · {prev.numeral}</span>
          <span className="t">{t(`learn.page.${prev.id}.title`)}</span>
          <span className="d">{t(`learn.page.${prev.id}.desc`)}</span>
        </Link>
      ) : (
        <Link to="/learn" className="prev">
          <span className="label">← {t("learn.toc.all")}</span>
          <span className="t">{t("learn.book")}</span>
          <span className="d">{t("learn.lede")}</span>
        </Link>
      )}
      {next && (
        <Link to={next.path} className="next">
          <span className="label">{next.numeral} · {t("learn.next")} →</span>
          <span className="t">{t(`learn.page.${next.id}.title`)}</span>
          <span className="d">{t(`learn.page.${next.id}.desc`)}</span>
        </Link>
      )}
    </nav>
  );
}

/* ---------------------------------------------------------------- misc */

export function useLangPick() {
  const t = useT();
  return useCallback((x: Text) => pick(x, t.lang), [t.lang]);
}

export function NotInBook() {
  const t = useT();
  const { pathname } = useLocation();
  useLearnTitle(t("learn.nf.title"));
  return (
    <Page>
      <div className="reading" style={{ paddingTop: 24 }}>
        <div className="label">404</div>
        <h1 className="lrn-title" style={{ marginTop: 16 }}>{t("learn.nf.title")}</h1>
        <p className="t-lede" style={{ marginTop: 18 }}>{t("learn.nf.text", { path: pathname })}</p>
        <div style={{ marginTop: 28 }}><Key variant="primary" icon="learn" to="/learn">{t("learn.nf.back")}</Key></div>
      </div>
    </Page>
  );
}
