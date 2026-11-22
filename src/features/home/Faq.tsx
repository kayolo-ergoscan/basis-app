// Before you start: the three questions newcomers ask first (content `faq`), each with its one-line answer from the FAQ
// and a link to the full answer on /learn/faq; the whole FAQ is one click away.
import { Link } from "react-router-dom";
import { rich, useLang, useT } from "@/app/lang";
import { faq, pick } from "@/content";
import { Key, Section } from "@/ui";

/** The FAQ page; `#q-<id>` opens one answer. */
export const FAQ_HREF = "/learn/faq";
export const faqHref = (id: string) => `${FAQ_HREF}#q-${id}`;
/** The questions Home shows, in order: can I lose money, what if the tracker vanishes, can I use real ERG yet. */
export const HOME_FAQ = ["lose-money", "tracker-disappears", "launched"] as const;

export function HomeFaq() {
  const t = useT();
  const { lang } = useLang();
  const items = HOME_FAQ.flatMap((id) => faq.filter((f) => f.id === id));
  return (
    <Section id="faq" className="home-faq" no={t("home.f.no")} title={rich(t("home.f.title"))} lede={t("home.f.lede")}
      aside={<div className="hf-aside"><Key to={FAQ_HREF} icon="learn">{t("home.f.all")}</Key></div>}>
      <ul className="hf-list">
        {items.map((f) => (
          <li key={f.id} className="hf-item">
            <h3 className="hf-q">{pick(f.q, lang)}</h3>
            <p className="hf-a">{pick(f.short, lang)}</p>
            <Link className="textlink hf-go" to={faqHref(f.id)}>{t("home.f.more")} <span aria-hidden="true">→</span></Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}
