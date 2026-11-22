// The money spectrum (content `spectrum`) as a three-stop band from line (on trust) to metal (backed on Ergo),
// and the six personas (content `personas`) as a compact row of cards.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLang, useT } from "@/app/lang";
import { personas, personasLede, personasTitle, pick, spectrum } from "@/content";
import { useUid } from "@/ui";
import { FAQ_HREF } from "./Faq";
import { CodeText } from "./Moments";

/** The serif second beat every section title has ("The money *spectrum.*"): the last word in italic ink-2. */
function beat(title: string): ReactNode {
  const i = title.trimEnd().lastIndexOf(" ");
  const tail = title.slice(i + 1).replace(/[.]?$/, ".");
  return i < 0 ? title : <>{title.slice(0, i + 1)}<em>{tail}</em></>;
}

export function Spectrum() {
  const t = useT();
  const { lang } = useLang();
  const [sel, setSel] = useState(0);
  const uid = useUid("spec");
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const tier = spectrum.tiers[sel];
  const onKey = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (sel + d + spectrum.tiers.length) % spectrum.tiers.length;
    setSel(n);
    tabs.current[n]?.focus();
  };
  return (
    <section className="sec rule-top home-spectrum" id="spectrum">
      <div className="container">
        <div className="sec-head">
          <div><div className="no">{t("home.s.no")}</div><h2 className="t-h2">{beat(pick(spectrum.title, lang))}</h2></div>
          <div><p className="t-lede">{pick(spectrum.lede, lang)}</p></div>
        </div>

        <div className="sp-band" style={{ "--sel": sel } as CSSProperties}>
          <div className="sp-track" aria-hidden="true">
            {/* the backed-vs-trust encoding (VISUAL §9 bt): hatch = on trust, metal = backed on Ergo, 2 px apart */}
            <i className="hatch-part" /><i className="mix-part"><b className="h" /><b className="m" /></i><i className="metal-part" />
            <span className="sp-needle" />
            <span className="sp-end l">{t("home.s.trust")}</span>
            <span className="sp-end r">{t("home.s.backed")}</span>
          </div>
          <div className="sp-stops" role="tablist" aria-label={t("home.s.pick")} onKeyDown={onKey}>
            {spectrum.tiers.map((x, i) => (
              <button key={x.id} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`${uid}-t${i}`} aria-controls={`${uid}-p`} aria-selected={sel === i} tabIndex={sel === i ? 0 : -1}
                className={`sp-stop${sel === i ? " on" : ""}`} onClick={() => setSel(i)}>
                <span className="n mono">{String(x.n).padStart(2, "0")}</span>
                <b>{pick(x.title, lang)}</b>
                <span className="s">{pick(x.short, lang)}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="sp-detail" role="tabpanel" id={`${uid}-p`} aria-labelledby={`${uid}-t${sel}`}>
          <p className="sp-expl"><CodeText text={pick(tier.explanation, lang)} /></p>
          <dl className="sp-dl">
            <div><dt className="label">{t("home.s.policy")}</dt><dd className="mono">{pick(tier.policy, lang)}</dd></div>
            <div><dt className="label">{t("home.s.chain")}</dt><dd>{pick(tier.chain, lang)}</dd></div>
            <div><dt className="label">{t("home.s.protection")}</dt><dd>{pick(tier.protection, lang)}</dd></div>
            <div><dt className="label">{t("home.s.risk")}</dt><dd>{pick(tier.risk, lang)}</dd></div>
            <div><dt className="label">{t("home.s.example")}</dt><dd>{pick(tier.example, lang)}</dd></div>
          </dl>
        </div>

        <div className="pe-head">
          <h3 className="t-h3">{pick(personasTitle, lang)}</h3>
          <p className="t-small">{pick(personasLede, lang)} <Link className="textlink pe-faq" to={FAQ_HREF}>{t("home.cta.faq")} <span aria-hidden="true">→</span></Link></p>
        </div>
        <ul className="pe-row">
          {personas.map((p) => (
            <li key={p.id} className="pe-card">
              <span className="label">{pick(p.title, lang)}</span>
              <p className="pe-one">{pick(p.oneLiner, lang)}</p>
              <p className="pe-who">{pick(p.who, lang)}</p>
              <Link className="textlink pe-go" to={p.start.to}>{pick(p.start.label, lang)} <span aria-hidden="true">→</span></Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
