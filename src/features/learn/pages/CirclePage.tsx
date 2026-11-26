// /learn/circle — the developer circle: people and projects that accept Basis notes for their work (tips, bounties,
// help). A list this site keeps in src/content/circle.json; each entry gets a «Support with a note» key that opens its
// payment request link. People join in three steps (make the button in the wallet, put it in the README, open a pull
// request). Empty, the page says so and invites: a dashed "your entry here" card and the three steps. It sits beside
// the book (no chapter number), like /learn/developers. Nothing here fetches anything: "the key matches the button" is
// the reviewer's word on the entry's `checked` day.
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { CopyButton, Icon, Key, KeySeal, Page, short } from "@/ui";
import { CIRCLE, CIRCLE_DENOM_LABEL, CIRCLE_GITHUB, circleLink, type CircleEntry } from "@/content/circle";
import { inline, useLearnTitle } from "../layout";

/** The README button, in the page's language (public/badge.svg, public/badge-ru.svg). */
const BADGE = { en: { src: "/badge.svg", w: 185 }, ru: { src: "/badge-ru.svg", w: 214 } } as const;

export default function CirclePage() {
  const t = useT();
  useLearnTitle(t("learn.cc.title"));
  const empty = CIRCLE.length === 0;
  return (
    <Page className="dv cc">
      <section className={empty ? "dv-hero cc-hero" : "dv-hero cc-hero solo"}>
        <div>
          <div className="eyebrow label">{t("learn.cc.kicker")}</div>
          <h1>{rich(t("learn.cc.h1"))}</h1>
          <p className="t-lede">{t("learn.cc.lede")}</p>
          {empty && <p className="cc-empty">{t("learn.cc.empty")}</p>}
        </div>
        {empty && <GhostCard />}
      </section>

      {!empty && (
        <section className="dv-sec" id="list" aria-labelledby="cc-list-h">
          <div className="dv-sec-h">
            <h2 id="cc-list-h">{t("learn.cc.listH")}</h2>
            <span className="t-small">{t.p("learn.cc.count", CIRCLE.length)} · {t("learn.cc.aside")}</span>
          </div>
          <ul className="cc-list">
            {CIRCLE.map((e) => <li key={e.key}><EntryCard e={e} /></li>)}
          </ul>
        </section>
      )}

      <JoinSteps empty={empty} />

      <div className="dv-cards cc-cards">
        <section className="dv-card" aria-labelledby="cc-check-h">
          <h2 id="cc-check-h">{t("learn.cc.check.h")}</h2>
          <ul>{[1, 2, 3, 4].map((i) => <li key={i}><span>{t(`learn.cc.check.${i}`)}</span></li>)}</ul>
        </section>
        <section className="dv-card" aria-labelledby="cc-know-h">
          <h2 id="cc-know-h">{t("learn.cc.know.h")}</h2>
          <ul>{[1, 2, 3].map((i) => <li key={i}><span>{t(`learn.cc.know.${i}`)}</span></li>)}</ul>
        </section>
      </div>
    </Page>
  );
}

/** One entry: who, the project, what they do, the key, the reviewer's check and the support key (the first currency;
 *  the others as small links beside it). */
function EntryCard({ e }: { e: CircleEntry }) {
  const t = useT();
  const fmt = new Intl.DateTimeFormat(t.lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const date = fmt.format(new Date(`${e.checked}T12:00:00Z`));
  const [first, ...more] = e.denoms;
  return (
    <article className="cc-card" aria-labelledby={`cc-${e.key}`}>
      <header className="cc-who">
        <KeySeal pk={e.key} size="md" />
        <div>
          <h3 id={`cc-${e.key}`}>{e.name}</h3>
          <a className="cc-proj" href={e.url} target="_blank" rel="noreferrer nofollow">{e.project}<Icon name="ext" size={13} /></a>
        </div>
      </header>
      <p className="cc-about">{e.about}</p>
      <div className="cc-key">
        <span className="label">{t("learn.cc.key")}</span>
        <code title={e.key}>{short(e.key, 8, 8)}</code>
        <CopyButton value={e.key} label={t("learn.cc.copyKey")} small />
      </div>
      <p className="cc-check">
        <Icon name="check" size={15} />
        <span><a href={e.readme} target="_blank" rel="noreferrer nofollow">{t("learn.cc.match")}</a> · {t("learn.cc.checked", { date })}</span>
      </p>
      <div className="cc-act">
        <Key size="sm" to={circleLink("", e, first)}>{t("learn.cc.support")}</Key>
        <span className="cc-units">
          {CIRCLE_DENOM_LABEL[first]}
          {more.length > 0 && <> · {t("learn.cc.or")} {more.map((d, i) => <span key={d}>{i > 0 && ", "}<Link className="textlink" to={circleLink("", e, d)}>{CIRCLE_DENOM_LABEL[d]}</Link></span>)}</>}
        </span>
      </div>
    </article>
  );
}

/** The empty list's "your entry here": the shape of an entry with placeholders, dashed, its key disabled. */
function GhostCard() {
  const t = useT();
  return (
    <div className="cc-card ghost" aria-label={t("learn.cc.ghost")}>
      <span className="label cc-ghost-l">{t("learn.cc.ghost")}</span>
      <div className="cc-who">
        <span className="cc-ghost-seal" aria-hidden="true" />
        <div>
          <h3 className="cc-ph">{t("learn.cc.ghost.name")}</h3>
          <span className="cc-proj cc-ph">{t("learn.cc.ghost.project")}</span>
        </div>
      </div>
      <p className="cc-about cc-ph">{t("learn.cc.ghost.about")}</p>
      <div className="cc-key">
        <span className="label">{t("learn.cc.key")}</span>
        <code className="cc-ph">{t("learn.cc.ghost.key")}</code>
      </div>
      <p className="cc-check"><Icon name="check" size={15} /><span>{t("learn.cc.ghost.check")}</span></p>
      <div className="cc-act">
        <Key size="sm" disabled>{t("learn.cc.support")}</Key>
        <span className="cc-units">ERG</span>
      </div>
    </div>
  );
}

/** How to join, in three steps; the empty list's invitation, or the section after the list. */
function JoinSteps({ empty }: { empty: boolean }) {
  const t = useT();
  const badge = BADGE[t.lang === "ru" ? "ru" : "en"];
  const tpl = [
    "{",
    `  "name": ${JSON.stringify(t("learn.cc.ghost.name"))},`,
    `  "project": ${JSON.stringify(t("learn.cc.ghost.project"))},`,
    `  "url": "https://github.com/…",`,
    `  "about": ${JSON.stringify(t("learn.cc.ghost.about"))},`,
    `  "key": ${JSON.stringify(t("learn.cc.tpl.key"))},`,
    `  "denoms": ["erg"]`,
    "}",
  ].join("\n");
  return (
    <section className="dv-sec" id="join" aria-labelledby="cc-join-h">
      <div className="dv-sec-h">
        <h2 id="cc-join-h">{rich(t(empty ? "learn.cc.joinH.empty" : "learn.cc.joinH"))}</h2>
        {empty && <span className="t-small">{t("learn.cc.aside")}</span>}
      </div>
      <ol className="dv-steps">
        <li>
          <span className="dv-no" aria-hidden="true">1</span>
          <h3>{t("learn.cc.s1.t")}</h3>
          <p>{t("learn.cc.s1.b")}</p>
          <div className="cc-step-go"><Key size="sm" variant={empty ? "primary" : "default"} to="/wallet/mainnet/receive">{t("learn.cc.s1.go")} <span aria-hidden="true">→</span></Key></div>
        </li>
        <li>
          <span className="dv-no" aria-hidden="true">2</span>
          <h3>{t("learn.cc.s2.t")}</h3>
          <p>{t("learn.cc.s2.b")}</p>
          <div className="cc-badge"><img src={badge.src} alt={t("learn.cc.s2.alt")} width={badge.w} height={20} /></div>
        </li>
        <li>
          <span className="dv-no" aria-hidden="true">3</span>
          <h3>{t("learn.cc.s3.t")}</h3>
          <p>{inline(t("learn.cc.s3.b"))}</p>
          <details className="cc-tpl">
            <summary><span>{t("learn.cc.tpl.h")}</span><Icon name="down" size={16} className="chev" /></summary>
            <div className="cc-tpl-b">
              <pre className="dv-pre">{tpl}</pre>
              <CopyButton value={tpl} label={t("learn.cc.tpl.copy")} small />
            </div>
            <p className="t-small">{inline(t("learn.cc.tpl.note"))}</p>
          </details>
          <div className="cc-step-go">
            <Key size="sm" icon="github" href={CIRCLE_GITHUB.edit}>{t("learn.cc.s3.go")}</Key>
            <a className="textlink t-small" href={CIRCLE_GITHUB.file} target="_blank" rel="noreferrer">{t("learn.cc.s3.file")}</a>
          </div>
        </li>
      </ol>
    </section>
  );
}
