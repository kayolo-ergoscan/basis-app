// /tracker/api: the API mirror (FEATURES T09). The main read endpoints of the reference tracker server, answered
// from the sandbox town's current state with the server's own field names, status codes and quirks. Nothing is
// sent anywhere: every answer is computed in the browser from the town.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { apiEndpoints, apiGroups, pick, trackerApi, type ApiEndpoint } from "@/content";
import type { DenomId } from "@/protocol";
import { Card, Col, CopyButton, Grid, int, Key, PageHead, Section, Switch, Tag, useIsPhone } from "@/ui";
import { AGENTS, BUSINESSES, HUMANS, SUSE_ID, TOWN_TRACKER, useTown, useTownView, YOU } from "@/world";
import { EVENTS_PAGE, jsonLines, MIRROR, mirrorAnswer, tokenizeJson, type MirrorAnswer, type MirrorId, type MirrorSpec } from "./mirror";
import { HeadActions, md, useText } from "./parts";
import { TownGate, useNameOf } from "./townParts";

const PAGE = 30;
const byId = new Map(apiEndpoints.map((e) => [e.id, e]));
/** This is the tracker's page: its own state, proofs and events lead the list; the rest keep the catalogue order. */
const LEAD = ["tracker", "proofs", "events"];
const navGroups = [...apiGroups].sort((a, b) => (LEAD.includes(a.id) ? LEAD.indexOf(a.id) : LEAD.length) - (LEAD.includes(b.id) ? LEAD.indexOf(b.id) : LEAD.length));
const isMirror = (s: string | null): s is MirrorId => !!s && MIRROR.some((m) => m.id === s);

export default function ApiMirror() {
  const t = useT();
  return (
    <>
      <div className="container">
        <PageHead eyebrow={t("tracker.api.eyebrow")} title={md(t("tracker.api.h1"))} lede={t("tracker.api.lede")} actions={<HeadActions />} />
      </div>
      <TownGate>
        <MirrorBody />
      </TownGate>
      <Rules />
    </>
  );
}

function MirrorBody() {
  const t = useT();
  const phone = useIsPhone();
  const [q, setQ] = useSearchParams();
  const id: MirrorId = isMirror(q.get("e")) ? (q.get("e") as MirrorId) : "tracker-state";
  const spec = MIRROR.find((m) => m.id === id)!;
  const pick1 = (e: MirrorId) => {
    const n = new URLSearchParams(q);
    n.set("e", e);
    setQ(n, { replace: true });
  };

  const groups = useMemo(() => {
    const out: { id: string; title: string; items: MirrorSpec[] }[] = [];
    for (const g of navGroups) {
      const items = MIRROR.filter((m) => byId.get(m.id)?.group === g.id);
      if (items.length) out.push({ id: g.id, title: pick(g.title, t.lang), items });
    }
    return out;
  }, [t.lang]);

  // On a short screen the endpoint list scrolls inside its sticky column: keep the chosen endpoint in view (one
  // opened from a link may sit far down the list) and fade the edge while more endpoints wait below.
  const navRef = useRef<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const box = navRef.current?.parentElement;
    if (!box) return;
    const measure = () => setMore(box.scrollHeight - box.scrollTop - box.clientHeight > 4);
    measure();
    box.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      box.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [phone]);
  useEffect(() => {
    const box = navRef.current?.parentElement;
    const on = navRef.current?.querySelector<HTMLElement>("button.on");
    if (!box || !on || box.scrollHeight <= box.clientHeight) return;
    const b = box.getBoundingClientRect();
    const r = on.getBoundingClientRect();
    if (r.top < b.top) box.scrollTop += r.top - b.top - 8;
    else if (r.bottom > b.bottom - 48) box.scrollTop += r.bottom - b.bottom + 56;
  }, [id, phone]);

  return (
    <div className="container">
      <Grid className="trk-api">
        <Col span={4} spanL={4} className="trk-api-nav">
          {phone ? (
            <label className="trk-field">
              <span className="label">{t("tracker.api.pick")}</span>
              <select className="trk-select" value={id} onChange={(e) => pick1(e.target.value as MirrorId)}>
                {groups.map((g) => (
                  <optgroup key={g.id} label={g.title}>
                    {g.items.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.method} {m.path}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          ) : (
            <nav className="trk-eps" aria-label={t("tracker.api.list")} ref={navRef}>
              {groups.map((g) => (
                <div className="trk-eps-g" key={g.id}>
                  <div className="label">{g.title}</div>
                  <ul>
                    {g.items.map((m) => (
                      <li key={m.id}>
                        <button type="button" className={m.id === id ? "on" : undefined} aria-current={m.id === id ? "true" : undefined} onClick={() => pick1(m.id)}>
                          <span className={`trk-method m-${m.method.toLowerCase()}`}>{m.method}</span>
                          <span className="trk-eps-path"><PathText path={m.path} /></span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </nav>
          )}
          {!phone && more && <div className="trk-eps-more" aria-hidden="true" />}
        </Col>
        <Col span={8} spanL={8}>
          <Answer spec={spec} />
        </Col>
      </Grid>
    </div>
  );
}

function Answer({ spec }: { spec: MirrorSpec }) {
  const t = useT();
  const txt = useText();
  const nameOf = useNameOf();
  const joined = useTown((s) => s.joined);
  const ep = byId.get(spec.id) as ApiEndpoint;
  const people = useMemo(() => [...(joined ? [YOU] : []), ...HUMANS, ...BUSINESSES, ...AGENTS], [joined]);
  const [issuer, setIssuer] = useState<string>(joined ? YOU : "alice");
  const [recipient, setRecipient] = useState<string>("bob");
  const [denom, setDenom] = useState<DenomId>("erg");
  const [limit, setLimit] = useState(PAGE);
  const [live, setLive] = useState(true);
  useEffect(() => setLimit(PAGE), [spec.id]);

  const args = { issuer, recipient, denom, limit: spec.id === "events" ? Math.min(limit, EVENTS_PAGE) : limit };
  const fresh = useTownView((eco) => ({ a: mirrorAnswer(eco, TOWN_TRACKER, spec, args), h: eco.clock.height }), [spec.id, issuer, recipient, denom, limit]);
  const frozen = useRef<{ a: MirrorAnswer; h: number } | null>(null);
  if (live || !frozen.current) frozen.current = fresh;
  const shownAnswer = live ? fresh : frozen.current;
  if (!shownAnswer) return null;
  const { a, h } = shownAnswer;
  const lines = a.json ? jsonLines(tokenizeJson(a.body)) : null;
  const more = a.total !== undefined && a.shown !== undefined && a.total > a.shown && spec.id !== "events" ? Math.min(PAGE, a.total - a.shown) : 0;
  const role = ep.role;

  return (
    <Card
      className="trk-ans"
      title={
        <div className="trk-ans-h">
          <span className={`trk-method m-${spec.method.toLowerCase()}`}>{spec.method}</span>
          <code className="trk-ans-path"><PathText path={spec.path} /></code>
        </div>
      }
      aside={
        <span className="trk-role">
          <span className="label">{t("tracker.api.role")}</span>
          <Tag tone={role === "public" ? "ok" : role === "admin" ? "watch" : "plain"}>{pick(trackerApi.roles[role], t.lang)}</Tag>
        </span>
      }
    >
      <p className="trk-ans-purpose">{txt(ep.purpose)}</p>
      <p className="t-small dim">{t("tracker.api.needs", { what: t(`tracker.api.role.${role}`) })}</p>

      {spec.params.length > 0 && (
        <div className="trk-ans-params">
          {spec.params.includes("issuer") && (
            <label className="trk-field">
              <span className="label">{t("tracker.api.issuer")}</span>
              <select className="trk-select" value={issuer} onChange={(e) => setIssuer(e.target.value)}>
                {people.map((p) => <option key={p} value={p}>{nameOf(p)}</option>)}
              </select>
            </label>
          )}
          {spec.params.includes("recipient") && (
            <label className="trk-field">
              <span className="label">{t("tracker.api.recipient")}</span>
              <select className="trk-select" value={recipient} onChange={(e) => setRecipient(e.target.value)}>
                {people.map((p) => <option key={p} value={p}>{nameOf(p)}</option>)}
              </select>
            </label>
          )}
          {spec.params.includes("denom") && (
            <label className="trk-field">
              <span className="label">{t("tracker.api.denom")}</span>
              <select className="trk-select" value={denom} onChange={(e) => setDenom(e.target.value as DenomId)}>
                <option value="erg">ERG</option>
                <option value={SUSE_ID}>sUSE</option>
              </select>
            </label>
          )}
        </div>
      )}

      <div className="trk-ans-block">
        <div className="trk-ans-bh">
          <span className="label"><b>{t("tracker.api.request")}</b></span>
        </div>
        <pre className="trk-pre trk-req" tabIndex={0}>{a.request}</pre>
        {a.requestBody && (
          <>
            <div className="trk-ans-bh"><span className="label">{t("tracker.api.body")}</span></div>
            <pre className="trk-pre trk-req" tabIndex={0}>{a.requestBody}</pre>
          </>
        )}
      </div>

      <div className="trk-ans-block">
        <div className="trk-ans-bh">
          <span className="label"><b>{t("tracker.api.response")}</b> · <span className={`trk-status s${String(a.status)[0]}`}>{t("tracker.api.status", { s: String(a.status) })}</span></span>
          <span className="trk-ans-tools">
            <Switch checked={live} onChange={setLive} ariaLabel={t("tracker.api.follow")} />
            <span className="t-small dim">{live ? t("tracker.api.live") : t("tracker.api.liveFrozen", { h: int(h) })}</span>
            <CopyButton value={a.body} small label={t("tracker.api.copyText")} />
          </span>
        </div>
        <pre className="trk-pre trk-json" tabIndex={0} aria-label={t("tracker.api.response")}>
          {lines
            ? lines.map((ln, i) => (
                <span key={i} className="j-ln" style={{ "--ind": ln.ind } as CSSProperties}>
                  {ln.toks.map((x, j) => (x.k === "p" ? x.t : <span key={j} className={`j-${x.k}`}>{x.t}</span>))}
                </span>
              ))
            : a.body}
        </pre>
        {a.total !== undefined && a.shown !== undefined && a.total > 0 && (
          <div className="trk-ans-more">
            <span className="t-small dim">
              {spec.id === "events"
                ? t("tracker.api.shownEvents", { s: int(a.shown), n: int(a.total), m: int(a.stored ?? a.total) })
                : t("tracker.api.shown", { s: int(a.shown), n: int(a.total) })}
            </span>
            {more > 0 && (
              <Key size="sm" variant="quiet" onClick={() => setLimit((x) => x + PAGE)}>
                {t("tracker.api.showMore", { n: int(more) })}
              </Key>
            )}
          </div>
        )}
        {a.total === 0 && <p className="t-small dim">{t("tracker.api.empty")}</p>}
      </div>

      <div className="trk-ans-notes">
        <div className="trk-ans-note sandbox">
          <span className="label">{t("tracker.api.sandboxNote")}</span>
          <p className="t-small">{md(t(`tracker.api.s.${spec.id}`))}</p>
        </div>
        {(ep.gotchas?.length ?? 0) > 0 && (
          <div className="trk-ans-note">
            <span className="label">{t("tracker.api.gotchas")}</span>
            <ul>{ep.gotchas!.map((g, i) => <li key={i} className="t-small">{txt(g)}</li>)}</ul>
          </div>
        )}
        {(ep.errors?.length ?? 0) > 0 && (
          <div className="trk-ans-note">
            <span className="label">{t("tracker.api.errors")}</span>
            <ul className="trk-errs">
              {ep.errors!.map((e, i) => (
                <li key={i} className="t-small">
                  <span className={`trk-status s${String(e.status)[0]}`}>{e.status}</span> <code className="trk-code">{e.message}</code>
                  {e.when && <span className="dim"> · {txt(e.when)}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <p className="t-small dim trk-ans-values">{t("tracker.api.values")}</p>
    </Card>
  );
}

/** A route path that may break only before a slash. */
function PathText({ path }: { path: string }) {
  const segs = path.split("/");
  return (
    <>
      {segs.map((s, i) => (
        <Fragment key={i}>
          {i > 1 && <wbr />}
          {i > 0 && "/"}
          {s}
        </Fragment>
      ))}
    </>
  );
}

/** The server's limit values ("256 KiB", "30 s", "60 / h / pair", "1024") in the reader's language, numbers grouped. */
function useLimitValue() {
  const t = useT();
  return (value: string): string => {
    const m = /^(\d+)(?: (KiB|s|min|\/ h \/ pair))?$/.exec(value);
    if (!m) return value;
    const n = int(Number(m[1]));
    switch (m[2]) {
      case undefined:
        return n;
      case "KiB":
        return t("tracker.api.unit.kib", { n });
      case "s":
        return t("tracker.api.unit.s", { n });
      case "min":
        return t("tracker.api.unit.min", { n });
      default:
        return t("tracker.api.unit.perHourPair", { n });
    }
  };
}

function Rules() {
  const t = useT();
  const limitValue = useLimitValue();
  const txt = useText();
  const modes = trackerApi.auth.modes;
  return (
    <Section id="rules" no={t("tracker.api.rules.no")} title={md(t("tracker.api.rules.title"))} lede={t("tracker.api.rules.lede")}>
      <div className="trk-rules">
        <Card title={pick(trackerApi.envelope.title, t.lang)}>
          <pre className="trk-pre trk-req" tabIndex={0}>{trackerApi.envelope.shape}</pre>
          <p className="t-small">{txt(trackerApi.envelope.text)}</p>
          <ul className="trk-codes">
            {trackerApi.statusCodes.map((c) => (
              <li key={c.status} className="t-small">
                <span className={`trk-status s${String(c.status)[0]}`}>{c.status}</span> {txt(c.text)}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={pick(trackerApi.auth.title, t.lang)}>
          <p className="t-small">{txt(trackerApi.auth.text)}</p>
          <ul className="trk-modes">
            {modes.map((m) => (
              <li key={m.id}>
                <code className="trk-code">{m.id}</code>
                <span className="t-small">{txt(m.text)}</span>
                {m.headers.filter((hd) => !/^Authorization:/i.test(hd)).map((hd) => (
                  <code key={hd} className="trk-code trk-hdr">{hd}</code>
                ))}
                {m.id === "api_key" && <span className="t-small dim">{t("tracker.api.authAlt")}</span>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t("tracker.api.limits")}>
          <ul className="trk-limits">
            {trackerApi.limits.map((l) => (
              <li key={l.id}>
                <span className="trk-limit-v">{limitValue(l.value)}</span>
                <span className="t-small">{txt(l.text)}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="trk-rules-end">
        <p className="t-small dim">{txt(trackerApi.noPublicTracker)}</p>
        <p className="t-small">
          {t("tracker.api.full")}{" "}
          <Link className="textlink" to="/learn/api">{t("tracker.api.fullLink")}</Link>
        </p>
      </div>
    </Section>
  );
}
