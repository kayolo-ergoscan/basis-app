// /learn/trust — who can do what: the tracker, the issuer and you; contract rules versus policy; the known open
// issues with dates; the reviews; and the money spectrum. Content only (trust.ts, spectrum.ts): no engine here.
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { Callout, Honest } from "@/ui";
import { pick, sources, spectrum, trust, type Enforcer, type LineRef, type SourceId, type TrustItem } from "@/content";
import { BookHead, Pager, Pull, Sec, inline, linesHref, plainTitle, useBookSections } from "../layout";
import { pageMinutes } from "../minutes";
import { SpectrumFig } from "../figures/spectrum";

const ENF: Enforcer[] = ["contract", "tracker", "wallet", "nobody"];

function SrcLinks({ ids }: { ids: readonly SourceId[] }) {
  const t = useT();
  return (
    <>
      {ids.map((id) => {
        const s = sources[id];
        return s ? <a key={id} href={s.url} target="_blank" rel="noreferrer" title={pick(s.title, t.lang)}>{id}</a> : null;
      })}
    </>
  );
}

function LinesLinks({ lines }: { lines?: LineRef[] }) {
  const t = useT();
  if (!lines?.length) return null;
  return (
    <>
      {lines.map((r, i) => (
        <Link key={i} to={linesHref(r)}>{r.from === r.to ? t("learn.tr.lineShort", { a: r.from }) : t("learn.tr.linesShort", { a: r.from, b: r.to })}</Link>
      ))}
    </>
  );
}

function Enf({ by }: { by: Enforcer }) {
  const t = useT();
  return <span className={`lrn-enf ${by}`}><i aria-hidden="true" />{pick(trust.enforcerLabels[by], t.lang)}</span>;
}

function Item({ x }: { x: TrustItem }) {
  const t = useT();
  return (
    <div className="tr-item">
      <span className="t">{inline(pick(x.text, t.lang))}</span>
      {x.detail && <span className="d">{inline(pick(x.detail, t.lang))}</span>}
      <span className="m"><Enf by={x.by} /><LinesLinks lines={x.lines} /><SrcLinks ids={x.sources} /></span>
    </div>
  );
}

function Pair({ cannot, can, who }: { cannot: TrustItem[]; can: TrustItem[]; who: string }) {
  const t = useT();
  return (
    <div className="tr-pair">
      <div className="tr-col" aria-label={`${who}: ${t("learn.tr.cannot")}`}>
        <div className="tr-col-h"><span className="g no" aria-hidden="true">✕</span><b>{t("learn.tr.cannot")}</b></div>
        {cannot.map((x) => <Item key={x.id} x={x} />)}
      </div>
      <div className="tr-col" aria-label={`${who}: ${t("learn.tr.can")}`}>
        <div className="tr-col-h"><span className="g yes" aria-hidden="true">!</span><b>{t("learn.tr.can")}</b></div>
        {can.map((x) => <Item key={x.id} x={x} />)}
      </div>
    </div>
  );
}

export default function TrustPage() {
  const t = useT();
  const L = t.lang;
  const P = (x: Parameters<typeof pick>[0]) => pick(x, L);
  useBookSections([
    { id: "status", label: P(trust.status.title) },
    { id: "tracker", label: P(trust.tracker.title) },
    { id: "issuer", label: P(trust.issuer.title) },
    { id: "holder", label: P(trust.holder.title) },
    { id: "rules", label: P(trust.enforcement.title) },
    { id: "issues", label: plainTitle(t("learn.tr.s.issues")) },
    { id: "reviews", label: plainTitle(t("learn.tr.s.reviews")) },
    { id: "spectrum", label: P(spectrum.title) },
  ]);
  const verdict = trust.reviews.find((r) => r.quote && r.date === "2026-10-29");
  return (
    <article>
      <BookHead id="trust" lede={inline(P(trust.lede))} minutes={pageMinutes("trust", L) ?? undefined} meta={<span className="label">{t("learn.tr.status.asOf", { date: trust.asOf })}</span>} />

      <Sec id="status" first title={P(trust.status.title)}>
        <Callout tone="calm" className="lrn-callout" title={t("learn.tr.status.asOf", { date: trust.asOf })}>
          <p style={{ margin: 0 }}>{inline(P(trust.status.text))}</p>
          <p style={{ margin: "8px 0 0" }}>{inline(P(trust.status.contractsVerdict))}</p>
        </Callout>
        {verdict && (L === "ru"
          ? <Pull cite={`${verdict.who} · ${verdict.date} · ${t("learn.tr.translated")}`}>{t("learn.tr.verdict")}</Pull>
          : <Pull cite={`${verdict.who} · ${verdict.date}`}>{verdict.quote}</Pull>)}
      </Sec>

      <Sec id="tracker" title={P(trust.tracker.title)} lede={P(trust.tracker.line)}>
        <div style={{ maxWidth: 720, marginBottom: 28 }}><Honest /></div>
        <Pair who={P(trust.tracker.title)} cannot={trust.tracker.cannot} can={trust.tracker.can} />
      </Sec>

      <Sec id="issuer" title={P(trust.issuer.title)}>
        <Pair who={P(trust.issuer.title)} cannot={trust.issuer.cannot} can={trust.issuer.can} />
      </Sec>

      <Sec id="holder" title={P(trust.holder.title)} lede={t("learn.tr.s.holder.lede")}>
        <div className="tr-holder">
          {trust.holder.can.map((x, i) => (
            <div key={i}><span className="n">{String(i + 1).padStart(2, "0")}</span><span>{inline(P(x))}</span></div>
          ))}
        </div>
      </Sec>

      <Sec id="rules" title={P(trust.enforcement.title)} lede={P(trust.enforcement.lede)}>
        <div className="tr-enf">
          {ENF.map((by) => (
            <div key={by}>
              <Enf by={by} />
              <ul>{(trust.enforcement[by as "contract" | "tracker" | "wallet" | "nobody"] as readonly Parameters<typeof pick>[0][]).map((x, i) => <li key={i}>{inline(P(x))}</li>)}</ul>
            </div>
          ))}
        </div>
      </Sec>

      <Sec id="issues" title={rich(t("learn.tr.s.issues"))} lede={t("learn.tr.s.issues.lede", { date: trust.asOf })}>
        <div className="tr-issues">
          {trust.openIssues.map((x) => (
            <div className="tr-issue" id={`issue-${x.id}`} key={x.id}>
              <div className="when"><span className="label">{t("learn.tr.since")}</span><span className="mono">{x.since}</span></div>
              <div>
                <div className="h"><b>{inline(P(x.title))}</b><span className={`lrn-st ${x.status}`}>{P(trust.statusLabels[x.status])}</span></div>
                <p>{inline(P(x.text))}</p>
                {x.items && (
                  <ul>{x.items.map((it) => <li key={it.id}><b>{it.id}</b> {inline(P(it.text))}</li>)}</ul>
                )}
                <p className="impact"><span className="label">{t("learn.tr.impact")}</span> {inline(P(x.impact))}</p>
                <div className="srcs"><SrcLinks ids={x.sources} /></div>
              </div>
            </div>
          ))}
        </div>
      </Sec>

      <Sec id="reviews" title={rich(t("learn.tr.s.reviews"))} lede={t("learn.tr.s.reviews.lede")}>
        <div className="tr-reviews">
          {trust.reviews.map((r, i) => (
            <div className="tr-review" key={i}>
              <span className="when mono">{r.date}</span>
              <div>
                <b>{inline(P(r.title))}</b> <span className="by">· {r.who}</span>
                <p>{inline(P(r.text))}</p>
                {r.quote && <p><q lang="en">{r.quote}</q></p>}
                <div className="srcs" style={{ display: "flex", gap: 10, flexWrap: "wrap", font: "400 12px/1.4 var(--f-mono)" }}><SrcLinks ids={r.sources} /></div>
              </div>
            </div>
          ))}
        </div>
      </Sec>

      <Sec id="spectrum" title={P(spectrum.title)} lede={P(spectrum.lede)}>
        <SpectrumFig n="1" />
      </Sec>

      <Pager id="trust" />
    </article>
  );
}
