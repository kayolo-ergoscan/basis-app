// /learn/glossary — every term (content glossary.ts) A–Z in the reader's language, the other language beside it,
// searchable in both; each term has an anchor (#t-<id>) that the rest of the book links to.
import { useMemo, useState } from "react";
import { useT } from "@/app";
import { TextInput } from "@/ui";
import { glossary, glossaryGroups, pick, type Term } from "@/content";
import { BookHead, Pager, inline, useBookSections } from "../layout";

const AZ = { en: "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split(""), ru: "АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ".split("") };
const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е");

function letterOf(s: string): string {
  const c = s.trim().charAt(0).toUpperCase().replace("Ё", "Е");
  return /[0-9]/.test(c) ? "#" : c;
}

export default function GlossaryPage() {
  const t = useT();
  const L = t.lang;
  const [q, setQ] = useState("");
  useBookSections([]);
  const name = (x: Term) => (L === "ru" ? x.ru : x.en);
  const sorted = useMemo(() => [...glossary].sort((a, b) => name(a).localeCompare(name(b), L)), [L]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return sorted;
    return sorted.filter((x) => norm([x.en, x.ru, ...(x.alsoEN ?? []), ...(x.alsoRU ?? []), x.def.en, x.def.ru, x.code ?? ""].join(" ")).includes(n));
  }, [q, sorted]);
  const groups = useMemo(() => {
    const m = new Map<string, Term[]>();
    for (const x of list) {
      const k = letterOf(name(x));
      m.set(k, [...(m.get(k) ?? []), x]);
    }
    return m;
  }, [list]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(glossary.map((x) => [x.id, x])), []);

  return (
    <article>
      <BookHead id="glossary" lede={t("learn.gl.lede")} meta={<span className="label">{t.p("learn.gl.count", glossary.length)}</span>} />
      <div className="lrn-sec first" style={{ paddingTop: 32 }}>
        <div className="gl-tools">
          <div className="gl-search">
            <TextInput value={q} onChange={setQ} icon="search" type="search" placeholder={t("learn.gl.search")} aria-label={t("learn.gl.search")} />
            <span className="api-count" aria-live="polite">{t.p("learn.gl.count", list.length)}</span>
          </div>
          <nav className="gl-az" aria-label="A–Z">
            {AZ[L].map((c) => (groups.has(c) ? <a key={c} href={`#l-${c}`}>{c}</a> : <span key={c} aria-hidden="true">{c}</span>))}
          </nav>
        </div>
        {list.length === 0 && <p className="api-empty">{t("learn.gl.none", { q })}</p>}
        {[...groups.entries()].map(([c, terms]) => (
          <section className="gl-letter" key={c} aria-label={c}>
            <div className="lt" id={`l-${c}`}>{c}</div>
            {terms.map((x) => (
              <div className="gl-term" id={`t-${x.id}`} key={x.id}>
                <div className="gl-names">
                  <span className={L === "en" ? "en" : "ru"}><span className="lg">{L.toUpperCase()}</span>{name(x)}</span>
                  <span className={L === "en" ? "ru other" : "en other"} lang={L === "en" ? "ru" : "en"}><span className="lg">{L === "en" ? "RU" : "EN"}</span>{L === "en" ? x.ru : x.en}</span>
                  {((L === "en" ? x.alsoEN : x.alsoRU) ?? []).length > 0 && <span className="also">{t("learn.hi.aka", { names: ((L === "en" ? x.alsoEN : x.alsoRU) ?? []).join(", ") })}</span>}
                  <span className="gl-group">{pick(glossaryGroups[x.group], L)}</span>
                </div>
                <div className="gl-def">
                  <p>{inline(pick(x.def, L))}</p>
                  {x.code && <div className="code">{x.code}</div>}
                  {x.see && x.see.length > 0 && (
                    <div className="see">
                      <span>{t("learn.gl.see")}</span>
                      {x.see.map((id) => byId.get(id)).filter((y): y is Term => !!y).map((y) => <a key={y.id} className="lrn-term" href={`#t-${y.id}`}>{name(y)}</a>)}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </section>
        ))}
      </div>
      <Pager id="glossary" />
    </article>
  );
}
