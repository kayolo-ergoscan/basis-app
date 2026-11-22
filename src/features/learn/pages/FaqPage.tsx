// /learn/faq — questions people ask in public (content faq.ts) as an accordion: filter by tag, open all, and a
// deep link per answer (#q-<id> opens that answer).
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app";
import { Icon, Key, toast } from "@/ui";
import { faq, pick, sources, type Faq, type FaqTag } from "@/content";
import { BookHead, Pager, inline, useBookSections } from "../layout";

const TAGS: FaqTag[] = ["status", "trust", "money", "wallet", "tracker", "community", "site"];

export default function FaqPage() {
  const t = useT();
  const L = t.lang;
  const [tag, setTag] = useState<FaqTag | "all">("all");
  const [open, setOpen] = useState<Set<string>>(() => {
    const h = typeof window !== "undefined" ? decodeURIComponent(window.location.hash.slice(1)) : "";
    return new Set(h.startsWith("q-") ? [h.slice(2)] : []);
  });
  useEffect(() => {
    const on = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (h.startsWith("q-")) setOpen((s) => new Set(s).add(h.slice(2)));
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useBookSections([]);
  const used = useMemo(() => TAGS.filter((x) => faq.some((f) => f.tags.includes(x))), []);
  const list = tag === "all" ? faq : faq.filter((f) => f.tags.includes(tag));
  const allOpen = list.every((f) => open.has(f.id));
  const toggle = (id: string, v: boolean) => setOpen((s) => { const n = new Set(s); if (v) n.add(id); else n.delete(id); return n; });

  return (
    <article>
      <BookHead id="faq" lede={t("learn.fq.lede")} meta={<span className="label">{t.p("learn.ix.count.faq", faq.length)}</span>} />
      <div className="lrn-sec first" style={{ paddingTop: 40 }}>
        <div className="spread fq-bar" style={{ flexWrap: "wrap", gap: 12, marginBottom: 6 }}>
          <div className="fq-tags" role="group" aria-label={t("learn.fq.all")}>
            <button type="button" className="fq-chip" aria-pressed={tag === "all"} onClick={() => setTag("all")}>{t("learn.fq.all")} · {faq.length}</button>
            {used.map((x) => (
              <button type="button" key={x} className="fq-chip" aria-pressed={tag === x} onClick={() => setTag(x)}>
                {t(`learn.fq.tag.${x}`)} · {faq.filter((f) => f.tags.includes(x)).length}
              </button>
            ))}
          </div>
          <Key size="sm" variant="quiet" onClick={() => setOpen(allOpen ? new Set() : new Set(list.map((f) => f.id)))}>{allOpen ? t("learn.fq.closeAll") : t("learn.fq.openAll")}</Key>
        </div>
        {list.map((f, i) => <Item key={f.id} f={f} n={i + 1} open={open.has(f.id)} onToggle={(v) => toggle(f.id, v)} />)}
      </div>
      <Pager id="faq" />
    </article>
  );
}

function Item({ f, n, open: isOpen, onToggle }: { f: Faq; n: number; open: boolean; onToggle: (v: boolean) => void }) {
  const t = useT();
  const P = (x: Parameters<typeof pick>[0]) => pick(x, t.lang);
  const copyLink = async () => {
    const url = `${window.location.origin}/learn/faq#q-${f.id}`;
    try {
      await navigator.clipboard.writeText(url);
      toast({ kind: "info", title: t("learn.fq.copied"), detail: `#q-${f.id}`, mono: true, icon: "copy", ttl: 2000 });
    } catch { /* clipboard refused: the link is still in the address bar below */ }
    window.history.replaceState(null, "", `#q-${f.id}`);
  };
  return (
    <details className="lrn-fq" id={`q-${f.id}`} open={isOpen} onToggle={(e) => { const v = (e.currentTarget as HTMLDetailsElement).open; if (v !== isOpen) onToggle(v); }}>
      <summary>
        <span className="n">{String(n).padStart(2, "0")}</span>
        <span><span className="q">{inline(P(f.q))}</span><span className="s">{inline(P(f.short))}</span></span>
        <Icon name="down" size={18} className="chev" />
      </summary>
      {isOpen && (
        <div className="fq-a">
          {f.a.map((p, k) => <p className="lrn-p" key={k}>{inline(P(p))}</p>)}
          {f.asked && (
            <div className="fq-asked">
              <q lang="en">{f.asked.quote}</q>
              <span className="who">{t("learn.fq.asked", { who: f.asked.who })} · {sources[f.asked.source] ? <a className="lrn-link" href={sources[f.asked.source].url} target="_blank" rel="noreferrer">{f.asked.source}</a> : f.asked.source}</span>
            </div>
          )}
          <div className="fq-foot">
            {f.links?.map((l) => <Link key={l.to} className="lrn-link" to={l.to}>{P(l.label)}</Link>)}
            {f.sources.map((id) => sources[id] ? <a key={id} className="lrn-link t-small" href={sources[id].url} target="_blank" rel="noreferrer">{t(`learn.so.kind.${sources[id].kind}`)} · {id}</a> : null)}
            <button type="button" className="copy" onClick={copyLink}><Icon name="copy" size={13} />{t("learn.fq.link")}</button>
          </div>
        </div>
      )}
    </details>
  );
}
