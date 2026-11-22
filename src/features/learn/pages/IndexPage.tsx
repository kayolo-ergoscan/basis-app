// /learn — the book's landing page: what it is, where to start, the five moments, and every chapter as a card
// with a small plate. No engine here: the plates are drawn with CSS, so this chunk stays light.
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { Icon, Note, Page } from "@/ui";
import { GIT_REF_SHORT, apiEndpoints, chapters, copy, faq, glossary, historyEvents, moments, pick, sources, sourcesIntro } from "@/content";
import { LEARN_PAGES, PARTS, type LearnPage, type LearnPageId } from "../pages";
import { useLearnTitle } from "../layout";
import { bookMinutes, pageMinutes } from "../minutes";

const START: LearnPageId[] = ["how", "signature", "contract", "trust"];

export default function IndexPage() {
  const t = useT();
  useLearnTitle(t("learn.book"));
  const total = bookMinutes(t.lang);
  const startMin = START.reduce((n, id) => n + (pageMinutes(id, t.lang) ?? 0), 0);
  const sourceCount = Object.keys(sources).length;

  return (
    <Page className="lx">
      <section className="lx-hero">
        <div>
          <div className="eyebrow label" style={{ marginBottom: 18 }}>{t("learn.ix.kicker", { n: LEARN_PAGES.length })}</div>
          <h1>{rich(t("learn.ix.title"))}</h1>
          <p className="t-lede">{t("learn.ix.lede")}</p>
          <div className="lx-stats">
            <div className="lx-stat"><b>{LEARN_PAGES.length}</b><span className="label">{t("learn.ix.stat.chapters")}</span></div>
            <div className="lx-stat"><b>{t("learn.min", { n: total })}</b><span className="label">{t("learn.ix.stat.time")}</span></div>
            <div className="lx-stat"><b>{sourceCount}</b><span className="label">{t("learn.ix.stat.sources")}</span></div>
            <div className="lx-stat"><b className="mono" style={{ fontWeight: 500 }}>{GIT_REF_SHORT}</b><span className="label">{t("learn.ix.stat.commit")}</span></div>
          </div>
        </div>
        <nav className="lx-path" aria-labelledby="lx-start">
          <div className="lx-path-h">
            <span className="label" id="lx-start"><b>{t("learn.ix.start")}</b></span>
            <span className="label">{t("learn.ix.start.sub", { n: startMin })}</span>
          </div>
          <ol>
            {START.map((id, i) => {
              const p = LEARN_PAGES.find((x) => x.id === id)!;
              const m = pageMinutes(id, t.lang);
              return (
                <li className="lx-step" key={id}>
                  <Link to={p.path}>
                    <span className="lx-dot" aria-hidden="true">{i + 1}</span>
                    <span>
                      <span className="t" style={{ display: "block" }}>{t(`learn.page.${id}.title`)}</span>
                      <span className="d" style={{ display: "block" }}>{t(`learn.ix.start.${id}`)}</span>
                    </span>
                    <span className="m">{t(`learn.kind.${p.kind}`)}{m ? ` · ${t("learn.min", { n: m })}` : ""}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>
      </section>

      <section className="lx-moments" aria-label={t("learn.ix.moments")}>
        {moments.map((m) => {
          const ch = LEARN_PAGES[0];
          return (
            <Link key={m.id} className="lx-moment" to={`${ch.path}#ch-${m.chapter}`}>
              <span className="nm" aria-hidden="true">{m.numeral}</span>
              <span className="t">{pick(m.title, t.lang)}</span>
              <span className="d">{pick(m.text, t.lang)}</span>
              <span className="go">{t("learn.ix.toChapter", { n: String(chapterNo(m.chapter)).padStart(2, "0") })}<Icon name="right" size={14} /></span>
            </Link>
          );
        })}
      </section>

      {PARTS.map((part) => {
        const pages = LEARN_PAGES.filter((p) => p.part === part.n);
        return (
          <section className="lx-part" key={part.n} aria-labelledby={`lx-part-${part.n}`}>
            <div className="lx-part-h">
              <div>
                <div className="no">{t("learn.part", { n: part.numeral })} · {t(`learn.part.${part.n}`)}</div>
                <h2 id={`lx-part-${part.n}`}>{rich(t(`learn.part.${part.n}.title`))}</h2>
              </div>
              <p className="t-lede">{t(`learn.part.${part.n}.lede`)}</p>
            </div>
            <div className="lx-cards" style={{ ["--cols" as string]: pages.length }}>
              {pages.map((p) => (part.n === 3 ? <RefCard key={p.id} page={p} /> : <ChapterCard key={p.id} page={p} />))}
            </div>
          </section>
        );
      })}

      <footer className="lx-foot">
        <span style={{ maxWidth: 760 }}>{pick(sourcesIntro, t.lang)}</span>
        <span>{pick(copy.independence, t.lang)}</span>
      </footer>
    </Page>
  );
}

function chapterNo(id: string): number {
  return chapters.find((c) => c.id === id)?.n ?? 1;
}

function KindLine({ page }: { page: LearnPage }) {
  const t = useT();
  const m = pageMinutes(page.id, t.lang);
  return (
    <span className="meta">
      <span className={`lx-kind ${page.kind}`}><i aria-hidden="true" />{t(`learn.kind.${page.kind}`)}</span>
      {m ? <span>{t("learn.min", { n: m })}</span> : null}
    </span>
  );
}

function ChapterCard({ page }: { page: LearnPage }) {
  const t = useT();
  return (
    <Link to={page.path} className="lx-card">
      <div className="lx-plate" aria-hidden="true"><Plate id={page.id} /></div>
      <div className="lx-card-b">
        <div className="top"><span className="nm">{page.numeral}</span><KindLine page={page} /></div>
        <h3>{t(`learn.page.${page.id}.title`)}</h3>
        <p>{t(`learn.page.${page.id}.desc`)}</p>
      </div>
    </Link>
  );
}

function RefCard({ page }: { page: LearnPage }) {
  const t = useT();
  const n = page.id === "faq" ? faq.length : page.id === "glossary" ? glossary.length : page.id === "sources" ? Object.keys(sources).length : page.id === "history" ? historyEvents.length : apiEndpoints.length;
  return (
    <Link to={page.path} className="lx-card lx-ref">
      <div className="lx-card-b">
        <div className="top"><span className="nm">{page.numeral}</span><KindLine page={page} /></div>
        <h3>{t(`learn.page.${page.id}.title`)}</h3>
        <p>{t(`learn.page.${page.id}.desc`)}</p>
        <span className="label" style={{ marginTop: 8 }}><b>{t.p(`learn.ix.count.${page.id}`, n)}</b></span>
      </div>
    </Link>
  );
}

/* ---------------------------------------------------------------- plates (decorative) */

const MSG_TONES: string[] = [...Array(32).fill("k"), ...Array(8).fill("t"), ...Array(8).fill("ts"), ...Array(32).fill("n")];
const API_SAMPLE = apiEndpoints.filter((e) => !e.legacy && e.path.length < 30).slice(1, 6);
const CODE = [
  [1, 0.5], [1, 0.72], [1, 0.4], [0, 0.86], [1, 0.62], [1, 0.78], [0, 0.34], [1, 0.7], [1, 0.52], [2, 0.66], [0, 0.44],
] as const;

function Plate({ id }: { id: LearnPageId }) {
  switch (id) {
    case "how":
      return (
        <div className="pl-note">
          <Note issuer="Alice" receiver="Bob" amount={1240} prev={1000} state="signed" lite bare decorative />
        </div>
      );
    case "signature":
      return <div className="pl-bytes">{MSG_TONES.map((c, i) => <i key={i} className={c} />)}</div>;
    case "contract":
      return (
        <div className="pl-code">
          {CODE.map(([s, w], i) => (
            <div key={i}>
              <span className="ln">{381 + i}</span>
              <span className={s === 1 ? "lp ok" : "lp"} />
              <span className={i % 3 === 0 ? "bar kw" : "bar"} style={{ width: `${Math.round(w * 100)}%`, marginLeft: `${(i % 4) * 8}px` }} />
            </div>
          ))}
        </div>
      );
    case "avl":
      return (
        <div className="pl-tree">
          <svg viewBox="0 0 236 128" aria-hidden="true">
            <g stroke="var(--ink-4)" strokeWidth="1" fill="none">
              <path d="M118 22 L62 64 M118 22 L174 64 M62 64 L34 106 M62 64 L90 106 M174 64 L146 106 M174 64 L202 106" />
            </g>
            <g fill="var(--bg-2)" stroke="var(--ink-2)" strokeWidth="1.2">
              <circle cx="62" cy="64" r="7" /><circle cx="174" cy="64" r="7" />
              <circle cx="34" cy="106" r="6" /><circle cx="90" cy="106" r="6" /><circle cx="146" cy="106" r="6" /><circle cx="202" cy="106" r="6" />
            </g>
            <circle cx="118" cy="22" r="13" fill="none" stroke="var(--ink-2)" strokeWidth="2" />
            <circle cx="118" cy="22" r="5" fill="var(--ink)" />
          </svg>
        </div>
      );
    case "trust":
      return <TrustPlate />;
    case "tools":
      return (
        <div className="pl-mono">
          <div><b>debtKey</b> = blake2b256(</div>
          <div>&nbsp;&nbsp;A<span className="m">(33)</span> ‖ B<span className="m">(33)</span>)</div>
          <div><b>msg</b> = key ‖ total ‖ ts ‖ nft <span className="m">(80)</span></div>
          <div><b>ErgoTree</b> → template → sha-256</div>
        </div>
      );
    case "api":
      return (
        <div className="pl-api">
          {API_SAMPLE.map((e) => (
            <div key={e.id}><span className={e.method === "POST" ? "m post" : "m"}>{e.method}</span><span>{e.path}</span></div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function TrustPlate() {
  const t = useT();
  const [steal, censor] = pick(copy.trackerLine, t.lang).split(" · ");
  return (
    <div className="pl-trust">
      <div><span className="g no">✕</span><b>{steal}</b></div>
      <div><span className="g yes">!</span><b>{censor}</b></div>
    </div>
  );
}
