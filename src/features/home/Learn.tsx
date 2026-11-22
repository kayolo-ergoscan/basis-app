// 04 Learn teaser: the ten chapters of "How Basis works" (content `chapters`) as small cards into /learn.
import { Link } from "react-router-dom";
import { rich, useLang, useT } from "@/app/lang";
import { chapters, howItWorksLede, pick } from "@/content";
import { Key, Section } from "@/ui";

export function Learn() {
  const t = useT();
  const { lang } = useLang();
  return (
    <Section id="learn" className="home-learn" no={<>04 · {t("nav.learn")}</>} title={rich(t("home.l.title"))} lede={pick(howItWorksLede, lang)}
      aside={<div className="ln-aside"><Key to="/learn" kbd="L" icon="learn">{t("home.l.all")}</Key></div>}>
      <ol className="ln-grid">
        {chapters.map((c) => (
          <li key={c.id}>
            <Link className="ln-card" to={`/learn/how#${c.id}`}>
              <span className="n mono" aria-hidden="true">{String(c.n).padStart(2, "0")}</span>
              <span className="sr-only">{t("home.l.ch", { n: c.n })}: </span>
              <b>{pick(c.title, lang)}</b>
              <span className="d">{pick(c.lede, lang)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Section>
  );
}
