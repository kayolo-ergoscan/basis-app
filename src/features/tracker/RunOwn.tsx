// /tracker/run: running your own tracker (FEATURES T10). The checklist we would follow, with the reference
// server's real configuration keys, the current contracts as the chain knows them, a fee-runway calculator and
// the open problems as they stand today. Nothing here starts or talks to a server.
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { explorerLink, useObservatory } from "@/chain";
import { CLIENTS_HREF, GIT_REF_SHORT, pick, sources, trust, type OpenIssue } from "@/content";
import { AmountInput, Card, Col, CopyButton, Grid, Icon, int, Key, money, PageHead, parseMoney, Section, Seg, short, Tag } from "@/ui";
import { commitsPerDay, runwayDays } from "./runway";
import { HeadActions, md, TRACKER_PRACTICE, useText } from "./parts";

const STEPS = ["node", "nft", "fee", "contracts", "config", "alive"] as const;
type StepId = (typeof STEPS)[number];
const STORE = "basis.tracker.run";

function loadTicks(): StepId[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is StepId => (STEPS as readonly string[]).includes(x)) : [];
  } catch {
    return [];
  }
}
function saveTicks(v: StepId[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* private window: ticks stay for this visit only */
  }
}

export default function RunOwn() {
  const t = useT();
  const [ticks, setTicks] = useState<StepId[]>(loadTicks);
  const toggle = (id: StepId) =>
    setTicks((x) => {
      const n = x.includes(id) ? x.filter((y) => y !== id) : [...x, id];
      saveTicks(n);
      return n;
    });
  const reset = () => {
    saveTicks([]);
    setTicks([]);
  };

  return (
    <>
      <div className="container">
        <PageHead eyebrow={t("tracker.run.eyebrow")} title={md(t("tracker.run.h1"))} lede={t("tracker.run.lede")} actions={<HeadActions sandbox={false} />} />
      </div>
      <Section id="checklist" no={t("tracker.run.no")} title={md(t("tracker.run.list.title"))} lede={t("tracker.run.list.lede")}>
        <Grid className="trk-run">
          <Col span={8} spanL={8} className="trk-run-main">
            <ol className="trk-steps">
              {STEPS.map((id, i) => (
                <Step key={id} id={id} n={i + 1} done={ticks.includes(id)} onToggle={() => toggle(id)} />
              ))}
            </ol>
          </Col>
          <Col span={4} spanL={4} className="trk-run-aside">
            <Aside done={ticks.length} onReset={reset} />
          </Col>
        </Grid>
      </Section>
      <Caveats />
    </>
  );
}

function Step({ id, n, done, onToggle }: { id: StepId; n: number; done: boolean; onToggle: () => void }) {
  const t = useT();
  const extra: Record<StepId, ReactNode> = {
    node: <p className="t-small dim">{t("tracker.run.node.c")}</p>,
    nft: (
      <ul className="trk-cautions">
        <li><span className="g" aria-hidden="true">!</span>{t("tracker.run.nft.c1")}</li>
        <li><span className="g" aria-hidden="true">!</span>{t("tracker.run.nft.c2")}</li>
      </ul>
    ),
    fee: <Runway />,
    contracts: <Contracts />,
    config: <ConfigStep />,
    alive: (
      <p>
        <Key size="sm" variant="quiet" icon="tracker" to={TRACKER_PRACTICE}>{t("tracker.run.alive.try")}</Key>
      </p>
    ),
  };
  return (
    <li className={`trk-step${done ? " done" : ""}`} id={`step-${id}`}>
      <span className="trk-step-no" aria-hidden="true">{String(n).padStart(2, "0")}</span>
      <div className="trk-step-b">
        <div className="trk-step-h">
          <h3 className="trk-step-t">{md(t(`tracker.run.${id}.t`))}</h3>
          <label className="trk-done">
            <input type="checkbox" checked={done} onChange={onToggle} />
            <span>{t("tracker.run.done")}</span>
          </label>
        </div>
        {id === "config" ? null : <p className="trk-step-text">{md(t(`tracker.run.${id}.b`))}</p>}
        {extra[id]}
      </div>
    </li>
  );
}

function Runway() {
  const t = useT();
  const [bal, setBal] = useState("5");
  const [cadence, setCadence] = useState<"busy" | "quiet" | "daily">("busy");
  const [red, setRed] = useState("10");
  const perDayCommits = cadence === "busy" ? commitsPerDay(600) : cadence === "quiet" ? 24 : 1;
  const b = parseMoney(bal);
  const r = Math.max(0, Math.floor(parseMoney(red) ?? 0));
  const days = b === null ? null : runwayDays(b, perDayCommits, r);
  const perDay = (perDayCommits + r) * 0.001;
  const fmt = (x: number) => (t.lang === "ru" ? money(x, 3).replace(".", ",") : money(x, 3));
  return (
    <div className="trk-runway" aria-label={t("tracker.run.fee.calc")} role="group">
      <div className="trk-runway-in">
        <label className="trk-field">
          <span className="label">{t("tracker.run.fee.balance")}</span>
          <AmountInput value={bal} onChange={setBal} unit="ERG" invalid={b === null} aria-label={t("tracker.run.fee.balance")} />
        </label>
        <div className="trk-field">
          <span className="label">{t("tracker.run.fee.cadence")}</span>
          <Seg
            ariaLabel={t("tracker.run.fee.cadence")}
            value={cadence}
            onChange={setCadence}
            options={[
              { value: "busy", label: <SegLabel name={t("tracker.run.fee.busy")} n={t("tracker.run.fee.busyN")} /> },
              { value: "quiet", label: <SegLabel name={t("tracker.run.fee.quiet")} n={t("tracker.run.fee.quietN")} /> },
              { value: "daily", label: <SegLabel name={t("tracker.run.fee.daily")} n={t("tracker.run.fee.dailyN")} /> },
            ]}
          />
        </div>
        <label className="trk-field">
          <span className="label">{t("tracker.run.fee.redemptions")}</span>
          <AmountInput value={red} onChange={setRed} unit="" aria-label={t("tracker.run.fee.redemptions")} />
        </label>
      </div>
      <div className="trk-runway-out" aria-live="polite">
        <span className="label">{t("tracker.run.fee.calc")}</span>
        {days === null ? (
          <span className="t-small">{t("tracker.run.fee.invalid")}</span>
        ) : (
          <>
            <span className="trk-runway-v">
              {days < 1
                ? t("tracker.run.fee.lessDay")
                : days > 100 * 365
                  ? t("tracker.run.fee.century")
                  : days >= 730
                  ? t.p("tracker.run.fee.years", Math.floor(days / 365), { d: int(Math.floor(days / 365)) })
                  : t.p("tracker.run.fee.result", Math.floor(days), { d: int(Math.floor(days)) })}
            </span>
            <span className="t-small">{t("tracker.run.fee.perDay", { v: fmt(perDay) })}</span>
          </>
        )}
      </div>
    </div>
  );
}

function Contracts() {
  const t = useT();
  const obs = useObservatory();
  const list = useMemo(() => (obs ? obs.contracts.filter((c) => c.current) : []), [obs]);
  if (!obs) return <p className="t-small dim" aria-busy="true">…</p>;
  return (
    <div className="trk-contracts">
      {list.map((c) => {
        const href = explorerLink("address", c.p2sFull);
        return (
          <div className="trk-contract" key={c.id}>
            <div className="trk-contract-h">
              <b>{t(c.kind === "erg" ? "tracker.run.contracts.erg" : "tracker.run.contracts.token")}</b>
              <Tag className="trk-b58" title={c.p2sFull}>{c.short}</Tag>
              <span className="t-small dim">{t("tracker.run.contracts.template", { h: short(c.templateHash, 8, 6) })} · {t("tracker.run.contracts.len", { n: int(c.p2sFull.length) })}</span>
            </div>
            <div className="trk-contract-a">
              <code className="trk-code hex" title={c.p2sFull}>{short(c.p2sFull, 18, 14)}</code>
              <span className="trk-contract-k">
                <CopyButton value={c.p2sFull} small />
                {href && (
                  <a className="textlink t-small" href={href} target="_blank" rel="noreferrer">
                    ergoscan.me <Icon name="ext" size={12} />
                  </a>
                )}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ConfigStep() {
  const t = useT();
  const sketch: [string, string | null][] = [
    ["[server]", null],
    ['host = "127.0.0.1"', "tracker.run.toml.host"],
    ["port = 3048", null],
    ["", null],
    ["[server.auth]", null],
    ['mode = "signature"', "tracker.run.toml.mode"],
    ["allowed_origins = []", "tracker.run.toml.origins"],
    ["", null],
    ["[ergo]", null],
    ['basis_reserve_contract_p2s = "2XoR96…"', null],
    ['basis_token_reserve_contract_p2s = "8LeDK9…"', null],
    ['tracker_nft_id = "…"', "tracker.run.toml.nft"],
    ['tracker_public_key = "…"', null],
    ["", null],
    ["[ergo.scanner]", null],
    ['node_url = "http://127.0.0.1:9053"', "tracker.run.toml.node"],
    ["", null],
    ["[transaction]", null],
    ["fee = 1000000", "tracker.run.toml.fee"],
    ["", null],
    ["[acceptance]", null],
    ['default = "reject"', "tracker.run.toml.accept"],
    ["predicates = []", null],
    ["", null],
    ["[redemption]", null],
    ["enforce_acceptance_policy = true", "tracker.run.toml.fifo"],
    ["", null],
    ["[confirmation]", null],
    ["min_depth = 2", null],
  ];
  const text = sketch.map(([l, c]) => (c ? `${l.padEnd(46)}# ${t(c)}` : l)).join("\n");
  return (
    <div className="trk-config">
      <ul className="trk-config-list">
        <li>{md(t("tracker.run.config.accept"))}</li>
        <li>{md(t("tracker.run.config.auth"))}</li>
        <li>{md(t("tracker.run.config.cors"))}</li>
      </ul>
      <div className="trk-sketch">
        <div className="trk-sketch-h">
          <span className="label">
            <b>config/basis.toml</b> · {t("tracker.run.sketch")}
          </span>
          <CopyButton value={text} small />
        </div>
        <pre className="trk-pre" tabIndex={0} aria-label={t("tracker.run.sketch")}>
          {sketch.map(([l, c], i) => (
            <span key={i} className={l ? "trk-pre-l" : "trk-pre-l blank"}>
              {l.startsWith("[") ? <span className="j-sec">{l}</span> : <span className="j-set">{l}</span>}
              {c && <span className="j-pad">{" ".repeat(Math.max(1, 46 - l.length))}</span>}
              {c && <span className="j-com">{`# ${t(c)}`}</span>}
              {"\n"}
            </span>
          ))}
        </pre>
        <p className="t-small dim">{t("tracker.run.sketch.note")}</p>
      </div>
    </div>
  );
}

/** A cadence option: its name, then how many commitments a day. */
function SegLabel({ name, n }: { name: string; n: string }) {
  return (
    <span className="trk-seg2">
      <span>{name}</span>
      <span className="trk-seg2-n">{n}</span>
    </span>
  );
}

function Aside({ done, onReset }: { done: number; onReset: () => void }) {
  const t = useT();
  const txt = useText();
  const repo = sources["bt-repo"];
  const links: [string, string][] = [
    ["tracker.run.repo.readme", sources["bt-readme"].url],
    ["tracker.run.repo.spec", sources["bt-spec-tracker"].url],
    ["tracker.run.repo.api", sources["bt-openapi"].url],
  ];
  const latest = trust.reviews.reduce<(typeof trust.reviews)[number] | null>((a, r) => (!a || r.date > a.date ? r : a), null);
  return (
    <div className="trk-aside">
      <Card className="trk-progress" title={t("tracker.run.progressTitle")}>
        <div className="trk-progress-v" role="status">
          <span className="num">{int(done)}</span>
          <span className="t-small">{t("tracker.run.progress", { d: int(done), n: int(STEPS.length) })}</span>
        </div>
        <div className="trk-progress-bar" aria-hidden="true">
          {STEPS.map((s, i) => (
            <i key={s} className={i < done ? "on" : undefined} />
          ))}
        </div>
        <p className="t-small dim">{t("tracker.run.saved")}</p>
        {done > 0 && (
          <Key size="sm" variant="quiet" onClick={onReset}>
            {t("tracker.run.reset")}
          </Key>
        )}
      </Card>
      <Card className="trk-standing" title={t("tracker.run.status.title")}>
        <p className="t-small">{txt(trust.status.text)}</p>
        <p className="t-small dim">{txt(trust.status.contractsVerdict)}</p>
        {latest && (
          <p className="t-small trk-latest">
            <span className="label">{t("tracker.run.status.latest", { d: latest.date })}</span>
            <span>
              <b>{pick(latest.title, t.lang)}.</b> {txt(latest.text)}
            </span>
          </p>
        )}
        <a className="textlink t-small" href="#caveats">{t("tracker.run.status.open")}</a>
      </Card>
      <Card
        className="trk-repo"
        title={t("tracker.run.repo.title")}
        footer={<Key href={repo.url} icon="github">{t("tracker.run.repo.open")}</Key>}
      >
        <p className="t-small">{t("tracker.run.repo.text")}</p>
        <p className="t-small">
          <Link className="textlink" to={CLIENTS_HREF}>{t("tracker.run.repo.clients")}</Link>
        </p>
        <p className="t-small dim">{t("tracker.run.repo.ref", { ref: GIT_REF_SHORT })}</p>
        <ul className="trk-repo-links">
          {links.map(([k, url]) => (
            <li key={k}>
              <a className="textlink t-small" href={url} target="_blank" rel="noreferrer">
                {t(k)} <Icon name="ext" size={12} />
              </a>
            </li>
          ))}
        </ul>
        <p className="t-small dim">{t("tracker.run.repo.note")}</p>
      </Card>
    </div>
  );
}

function Caveats() {
  const t = useT();
  const txt = useText();
  return (
    <Section id="caveats" no={t("tracker.run.caveats.no")} title={md(t("tracker.run.caveats.title"))} lede={t("tracker.run.caveats.lede")}>
      <div className="trk-issues">
        {trust.openIssues.map((x: OpenIssue) => (
          <article className="card trk-issue" key={x.id}>
            <div className="card-h">
              <span className="label"><b>{t("tracker.run.since", { d: x.since })}</b></span>
              <Tag tone={x.status === "open" || x.status === "not-implemented" ? "watch" : "plain"}>{pick(trust.statusLabels[x.status], t.lang)}</Tag>
            </div>
            <div className="card-b">
              <h3 className="trk-issue-t">{txt(x.title)}</h3>
              <p className="t-small">{txt(x.text)}</p>
              {x.items && (
                <ul className="trk-issue-items">
                  {x.items.map((it) => (
                    <li key={it.id}>
                      <code className="trk-code">{it.id}</code> {txt(it.text)}
                    </li>
                  ))}
                </ul>
              )}
              <p className="t-small trk-issue-impact">
                <span className="label">{t("tracker.run.impact")}</span> {txt(x.impact)}
              </p>
            </div>
          </article>
        ))}
      </div>
      <p className="t-small dim trk-issues-asof">{t("tracker.run.asOf", { d: trust.asOf })}</p>
      <p className="t-small"><Link className="textlink" to="/learn/trust">{t("tracker.run.trustLink")}</Link></p>
    </Section>
  );
}
