// /learn/history — a vertical timeline from 2022 to November 2026 (content history.ts), grouped by era, with a
// source for every event and links to the chain on ergoscan.me; then the people.
import { useState } from "react";
import { rich, useT } from "@/app";
import { Icon, Seg, int } from "@/ui";
import { chainUrl, eras, eventKinds, historyAsOf, historyEvents, historyLede, people, peopleTitle, pick, sources, type Era } from "@/content";
import { BookHead, Pager, Sec, inline, useBookSections } from "../layout";
import { pageMinutes } from "../minutes";

const ERA_ORDER = Object.keys(eras) as Era[];

export default function HistoryPage() {
  const t = useT();
  const L = t.lang;
  const P = (x: Parameters<typeof pick>[0]) => pick(x, L);
  const [mode, setMode] = useState<"all" | "ms">("all");
  useBookSections([
    ...ERA_ORDER.filter((e) => historyEvents.some((x) => x.era === e)).map((e) => ({ id: `era-${e}`, label: P(eras[e].title) })),
    { id: "people", label: P(peopleTitle) },
  ]);
  const list = mode === "ms" ? historyEvents.filter((e) => e.milestone) : historyEvents;
  return (
    <article>
      <BookHead
        id="history"
        lede={inline(P(historyLede))}
        minutes={pageMinutes("history", L) ?? undefined}
        meta={<span className="label">{t("learn.hi.asOf", { date: historyAsOf })} · {t.p("learn.ix.count.history", historyEvents.length)}</span>}
      />
      <div className="hi-filter" style={{ marginTop: 8 }}>
        <span className="label">{t("learn.hi.show")}</span>
        <Seg<"all" | "ms"> ariaLabel={t("learn.hi.show")} value={mode} onChange={setMode} options={[{ value: "all", label: t("learn.hi.all") }, { value: "ms", label: t("learn.hi.milestones") }]} />
      </div>

      {ERA_ORDER.map((era, i) => {
        const evs = list.filter((e) => e.era === era);
        if (!evs.length) return null;
        return (
          <section className="hi-era lrn-sec" id={`era-${era}`} key={era} aria-labelledby={`era-${era}-h`} style={i === 0 ? { paddingTop: 40 } : { paddingTop: 48 }}>
            <div className="hi-era-h">
              <h2 id={`era-${era}-h`}>{P(eras[era].title)}</h2>
              <span className="label">{eras[era].range}</span>
            </div>
            <ol className="hi-list">
              {evs.map((e) => (
                <li className={e.milestone ? "hi-ev ms" : "hi-ev"} key={e.id} id={`ev-${e.id}`}>
                  <span className="date">{e.precision === "month" ? e.date.slice(0, 7) : e.date}</span>
                  <span className="mk" aria-hidden="true"><i /></span>
                  <div className="body">
                    <div className="h"><b>{inline(P(e.title))}</b><span className="kind">{P(eventKinds[e.kind])}</span></div>
                    <p>{inline(P(e.text))}</p>
                    <div className="links">
                      {e.sources.map((id) => {
                        const s = sources[id];
                        return s ? <a key={id} href={s.url} target="_blank" rel="noreferrer" title={P(s.title)}>{t(`learn.so.kind.${s.kind}`)} · {id}<Icon name="ext" size={11} /></a> : null;
                      })}
                      {e.chain?.map((c) => (
                        <a key={c.id} href={chainUrl(c)} target="_blank" rel="noreferrer">{c.kind} {c.id.slice(0, 8)}…{c.height ? ` · ${int(c.height)}` : ""}<Icon name="ext" size={11} /></a>
                      ))}
                      {e.people && e.people.length > 0 && <span className="ppl">{e.people.join(" · ")}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      <Sec id="people" title={rich(`${P(peopleTitle)}.`)}>
        <div className="hi-people">
          {people.map((p) => (
            <div className="hi-person" key={p.handle}>
              <b>{p.handle}</b>
              {p.aka && p.aka.length > 0 && <span className="aka">{t("learn.hi.aka", { names: p.aka.join(", ") })}</span>}
              <p>{inline(P(p.role))}</p>
              <span className="where">{p.where.map((w) => t(`learn.hi.where.${w}`)).join(" · ")}</span>
            </div>
          ))}
        </div>
      </Sec>

      <Pager id="history" />
    </article>
  );
}
