// /learn/developers — a small page for people who build on Basis: the tracker's public address, accepting a payment in
// three steps (a request link, a receipt link, one tracker call), working examples with live answers, the open read
// routes, what to know before the first call, and our code. It sits beside the book (no chapter number) and links the
// API chapter for everything else instead of repeating it.
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { Icon, Page } from "@/ui";
import { CLIENTS_HREF, REPOS, apiEndpoints, clients, trackerExamples } from "@/content";
import { OUR_TRACKER } from "@/chain/ours/types";
import { inline, useLearnTitle } from "../layout";
import { TrackerAddress, TrackerExamples } from "./Examples";

const SITE = "https://basis.ergoscan.me";
/** The read routes this page names (catalogue ids); the API page's ready-made programs block lists every one. */
const READS = ["tracker-state", "reserves", "key-status", "note-pair", "note-state"];
/** The closed one people ask for first: all notes of a key. */
const CLOSED = "notes-by-recipient";
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-4)}`;

export default function DevPage() {
  const t = useT();
  useLearnTitle(t("learn.dev.title"));
  const ep = (id: string) => apiEndpoints.find((e) => e.id === id);
  const toEntry = (id: string) => `/learn/api#ep-${id}`;
  const nOpen = clients.accepted.find((g) => g.id === "reads")?.endpoints.length ?? 0;
  const step3 = trackerExamples.find((x) => x.endpoint === "note-state");
  const request = [
    `${SITE}/wallet/mainnet/pay`,
    `  #to=${t("learn.dev.s1.key")}`,
    `  &amount=500000000      # ${t("learn.dev.s1.amount")}`,
    `  &nft=${short(OUR_TRACKER.nft)}   # ${t("learn.dev.s1.nft")}`,
  ].join("\n");
  const receipt = [
    `${SITE}/wallet/mainnet/receive`,
    "  #note=eyJ2IjoxLCJuZnQi…",
    `# ${t("learn.dev.s2.c1")}`,
    `# ${t("learn.dev.s2.c2")}`,
    `# ${t("learn.dev.s2.c3")}`,
  ].join("\n");
  const facts = [
    { n: "0", k: "f0" },
    { n: "2", k: "f1" },
    { n: "CC0", k: "f2" },
  ];
  const code = [
    { k: "app", repo: REPOS.app },
    { k: "tracker", repo: REPOS.tracker },
    { k: "ref", repo: REPOS.reference },
  ] as const;

  return (
    <Page className="dv">
      <section className="dv-hero">
        <div>
          <div className="eyebrow label">{t("learn.dev.kicker")}</div>
          <h1>{rich(t("learn.dev.h1"))}</h1>
          <p className="t-lede">{t("learn.dev.lede")}</p>
          <TrackerAddress label={t("learn.dev.addr")} copy={t("learn.dev.copy")} />
        </div>
        <ul className="dv-facts">
          {facts.map((f) => (
            <li key={f.k}>
              <b className="n">{f.n}</b>
              <span><b>{t(`learn.dev.${f.k}.t`)}</b><span>{t(`learn.dev.${f.k}.b`)}</span></span>
            </li>
          ))}
        </ul>
      </section>

      <section className="dv-sec" aria-labelledby="dv-pay">
        <div className="dv-sec-h">
          <h2 id="dv-pay">{rich(t("learn.dev.pay.h"))}</h2>
          <span className="t-small">{t("learn.dev.pay.aside")}</span>
        </div>
        <ol className="dv-steps">
          <li>
            <span className="dv-no" aria-hidden="true">1</span>
            <h3>{t("learn.dev.s1.t")}</h3>
            <p>{t("learn.dev.s1.b")}</p>
            <pre className="dv-pre">{request}</pre>
            <p className="t-small">{t("learn.dev.s1.tok")}</p>
          </li>
          <li>
            <span className="dv-no" aria-hidden="true">2</span>
            <h3>{t("learn.dev.s2.t")}</h3>
            <p>{t("learn.dev.s2.b")}</p>
            <pre className="dv-pre">{receipt}</pre>
            <p className="t-small">{inline(t("learn.dev.s2.total"))}</p>
          </li>
          <li>
            <span className="dv-no" aria-hidden="true">3</span>
            <h3>{t("learn.dev.s3.t")}</h3>
            <p>{inline(t("learn.dev.s3.b"))}</p>
            {step3 && <pre className="dv-pre">{step3.curl}</pre>}
          </li>
        </ol>
        <Link className="lx-dev dv-circle" to="/learn/circle">
          <Icon name="you" size={18} />
          <span>{t("learn.cc.fromDev")}</span>
          <Icon name="right" size={16} />
        </Link>
      </section>

      <section className="dv-sec" aria-labelledby="dv-ex">
        <div className="dv-sec-h">
          <h2 id="dv-ex">{rich(t("learn.dev.ex.h"))}</h2>
          <span className="t-small">{t("learn.dev.ex.lede")}</span>
        </div>
        <TrackerExamples entry={(id) => <Link className="textlink" to={toEntry(id)}>{t("learn.dx.entry")} →</Link>} />
      </section>

      <div className="dv-cards">
        <section className="dv-card" aria-labelledby="dv-read">
          <h2 id="dv-read">{t("learn.dev.read.h")}</h2>
          <ul>
            {READS.map((id) => {
              const e = ep(id);
              return e ? (
                <li key={id}>
                  <Link to={toEntry(id)}><code>{e.method} {e.path}</code></Link>
                  <span className="dv-tag ok">{t("learn.dev.read.open")}</span>
                </li>
              ) : null;
            })}
            {ep(CLOSED) && (
              <li className="closed">
                <code>{ep(CLOSED)!.method} {ep(CLOSED)!.path}</code>
                <span className="dv-tag no">{t("learn.dev.read.closed")}</span>
              </li>
            )}
          </ul>
          <Link className="textlink dv-more" to={CLIENTS_HREF}>{t("learn.dev.read.all", { n: nOpen })} →</Link>
        </section>

        <section className="dv-card" aria-labelledby="dv-know">
          <h2 id="dv-know">{t("learn.dev.know.h")}</h2>
          <ul>
            {[1, 2, 3, 4].map((i) => (
              <li key={i}>
                <span>{t(`learn.dev.know.${i}`)}{i === 2 && <> <Link className="textlink" to="/learn/signature">{t("learn.dev.know.2go")} →</Link></>}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="dv-card" aria-labelledby="dv-code">
          <h2 id="dv-code">{t("learn.dev.code.h")}</h2>
          <ul className="dv-code">
            {code.map((c) => (
              <li key={c.k}>
                <span>{t(`learn.dev.code.${c.k}`)}</span>
                <a href={c.repo.url} target="_blank" rel="noreferrer"><Icon name="github" size={14} />{c.repo.name}</a>
              </li>
            ))}
            <li>
              <span>{t("learn.dev.code.api")}</span>
              <Link to="/learn/api">{t("learn.dev.code.apiGo")} →</Link>
            </li>
          </ul>
        </section>
      </div>
    </Page>
  );
}
