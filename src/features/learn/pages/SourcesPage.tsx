// /learn/sources — every first-party source the site cites (content sources.ts), grouped, each with an anchor
// (#s-<id>), its kind, date, author and a note.
import { rich, useT } from "@/app";
import { Icon } from "@/ui";
import { pick, sourceGroups, sources, sourcesIntro } from "@/content";
import { BookHead, Pager, Sec, inline, useBookSections } from "../layout";

export default function SourcesPage() {
  const t = useT();
  const L = t.lang;
  useBookSections(sourceGroups.map((g) => ({ id: `sg-${g.id}`, label: pick(g.title, L) })));
  return (
    <article>
      <BookHead
        id="sources"
        lede={inline(pick(sourcesIntro, L))}
        meta={<span className="label">{t.p("learn.ix.count.sources", Object.keys(sources).length)}</span>}
      />
      <p className="lrn-p" style={{ marginTop: 28 }}>{t("learn.so.only")}</p>
      {sourceGroups.map((g, i) => (
        <Sec key={g.id} id={`sg-${g.id}`} first={i === 0} title={rich(`${pick(g.title, L)}.`)} className="so-group">
          <ol className="so-list">
            {g.ids.map((id) => {
              const s = sources[id];
              if (!s) return null;
              const meta = [s.date, s.by ? t("learn.so.by", { who: s.by }) : null].filter(Boolean).join(" · ");
              return (
                <li className="so-item" id={`s-${id}`} key={id}>
                  <span className="k">{t(`learn.so.kind.${s.kind}`)}</span>
                  <a className="t" href={s.url} target="_blank" rel="noreferrer">{inline(pick(s.title, L))}<Icon name="ext" size={12} style={{ marginLeft: 6, verticalAlign: -1, color: "var(--ink-3)" }} /></a>
                  <span className="meta">{meta}</span>
                  {s.note && <span className="nt">{inline(pick(s.note, L))}</span>}
                  <span className="url">{s.url.replace(/^https:\/\//, "").replace(/\b([0-9a-f]{7})[0-9a-f]{33}\b/g, "$1…")}</span>
                </li>
              );
            })}
          </ol>
        </Sec>
      ))}
      <Pager id="sources" />
    </article>
  );
}
