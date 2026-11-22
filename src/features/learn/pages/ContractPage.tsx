// /learn/contract — basis.es in full: the X-ray with the four spending paths, a live sandbox run per path (honest or
// not) that lights the conditions in contract order, the reason legend, what differs in basis-token.es, the context
// variables of a redemption, what the contract leaves out, and the pinned source.
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { rich, useT } from "@/app";
import { Icon, Key, Seg, Tabs, money, useIsPhone, withUnit, prefersReducedMotion } from "@/ui";
import { ContractXray, expectedChecks } from "@/viz";
import type { ReserveCheckId } from "@/protocol";
import {
  CONTRACT_ONLY, GIT_REF, GIT_REF_DATE, GIT_REF_SHORT, actionLines, actionTabs, contextVarOrder, contextVars, contracts, notChecked,
  pick, reasonFor, reasonLines, reserveCheckReasons,
} from "@/content";
import { BookHead, Pager, SandboxTag, Sec, Side, SourceLinks, inline, plainTitle, useBookSections } from "../layout";
import { later, useAvl } from "../lab";
import { LAB_TOKEN, amountOf, runPath, type LabContract, type LabRun, type PathId, type RunKind } from "../contractLab";

type Cid = "basis" | "token";
const toViz = (c: Cid): LabContract => (c === "token" ? "basis-token" : "basis");

/** ?lines=381-385&c=token → the contract, the path those lines belong to and the checks they decide. */
function fromQuery(q: URLSearchParams): { c: Cid; action: PathId; focus: ReserveCheckId[]; range: [number, number] } | null {
  const m = /^(\d+)(?:-(\d+))?$/.exec(q.get("lines") ?? "");
  if (!m) return null;
  const c: Cid = q.get("c") === "token" ? "token" : "basis";
  const a = Number(m[1]), b = Number(m[2] ?? m[1]);
  const overlaps = (r: { from: number; to: number }) => r.from <= b && r.to >= a;
  let action: PathId = 0;
  for (const k of [0, 1, 2, 3] as PathId[]) if (actionLines[c][k].some(overlaps)) { action = k; break; }
  const focus = (Object.keys(reasonLines) as ReserveCheckId[]).filter((id) => reasonLines[id][c].some(overlaps));
  return { c, action, focus, range: [a, b] };
}

export default function ContractPage() {
  const t = useT();
  const L = t.lang;
  const phone = useIsPhone();
  const [params] = useSearchParams();
  const q = useMemo(() => fromQuery(params), [params]);
  const [cid, setCid] = useState<Cid>(q?.c ?? "basis");
  const [action, setAction] = useState<PathId>(q?.action ?? 0);
  const [focus, setFocus] = useState<ReserveCheckId[]>(q?.focus ?? []);
  const [range, setRange] = useState<[number, number] | null>(q?.range ?? null);
  const [run, setRun] = useState<LabRun | null>(null);
  const [busy, setBusy] = useState<RunKind | null>(null);
  const [runNo, setRunNo] = useState(0);
  const avl = useAvl(true);
  const xrayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!q) return;
    setCid(q.c); setAction(q.action); setFocus(q.focus); setRange(q.range); setRun(null);
  }, [q]);

  useBookSections([
    { id: "xray", label: pick({ en: "The X-ray", ru: "Рентген" }, L) },
    { id: "legend", label: pick({ en: "Every condition", ru: "Все условия" }, L) },
    { id: "diff", label: pick({ en: "basis-token.es", ru: "basis-token.es" }, L) },
    { id: "vars", label: pick({ en: "Context variables", ru: "Контекстные переменные" }, L) },
    { id: "not", label: pick({ en: "Not checked", ru: "Что не проверяется" }, L) },
    { id: "source", label: pick({ en: "The source", ru: "Исходный код" }, L) },
  ]);

  const token = cid === "token";
  const vizC = toViz(cid);
  const unit = token ? { symbol: LAB_TOKEN.symbol, decimals: 0 } : undefined;
  const dec = token ? 3 : 2;
  const amt = (a: PathId, k: RunKind) => {
    const v = amountOf(a, k, token);
    return v === null ? "" : withUnit(money(Number(v), dec), token ? "LAB" : "ERG");
  };
  const desc = token && action === 1 ? t("learn.cx.diff.tok.3") : token ? t(`learn.cx.run.${action}.d`).replace(/ERG/g, "LAB") : t(`learn.cx.run.${action}.d`);

  const pickContract = (c: Cid) => { setCid(c); setRun(null); setFocus([]); setRange(null); };
  const pickAction = (a: PathId) => { setAction(a); setRun(null); setFocus([]); setRange(null); };
  const go = (kind: RunKind) => {
    if (!avl || busy) return;
    setBusy(kind);
    void later(() => runPath(avl.backend, vizC, action, kind)).then(
      (r) => { setRun(r); setFocus([]); setRange(null); setRunNo((n) => n + 1); },
      () => setRun(null),
    ).finally(() => setBusy(null));
  };
  const pointAt = (id: ReserveCheckId) => {
    setFocus([id]);
    setRange(null);
    xrayRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  const verdict = run ? verdictLine(run, t) : null;
  const checks = expectedChecks(vizC, action);
  const prelude = useMemo(() => {
    const all = ([0, 1, 2, 3] as PathId[]).map((a) => new Set(expectedChecks(vizC, a)));
    return new Set([...all[0]].filter((id) => all.every((s) => s.has(id))));
  }, [vizC]);
  const src = contracts[cid];
  // after a run, each legend row shows what that check did in it (only when the contract itself ran)
  const states = useMemo(() => {
    const ev = run?.outcome.eval;
    if (!ev) return null;
    const m = new Map<ReserveCheckId, CheckState>();
    for (const c of ev.checks) m.set(c.id, c.ok === true ? "pass" : c.ok === false ? "fail" : "skip");
    return m;
  }, [run]);

  return (
    <article>
      <BookHead
        id="contract"
        lede={t("learn.cx.lede")}
        // the label face is upper case; a git hash must keep its case
        meta={<span className="label lrn-nocase">{t("learn.pinned", { ref: GIT_REF_SHORT, date: GIT_REF_DATE })}</span>}
      />

      <Sec id="xray" first title={rich(t("learn.cx.s.xray"))} lede={t("learn.cx.s.xray.lede")}>
        <div className="lab-bar">
          <div className="grp">
            <span className="label">{t("learn.cx.contract")}</span>
            <Seg<Cid> ariaLabel={t("learn.cx.contract")} mono value={cid} onChange={pickContract} options={[{ value: "basis", label: "basis.es" }, { value: "token", label: "basis-token.es" }]} />
          </div>
          <SandboxTag />
        </div>
        <div className="lab-tabs" style={{ marginBottom: 14 }}>
          <Tabs<string>
            ariaLabel={t("learn.cx.action")}
            value={String(action)}
            onChange={(v) => pickAction(Number(v) as PathId)}
            tabs={actionTabs.map((x) => ({
              id: String(x.action),
              label: <span className="lab-tab-l"><span>{x.action} · {pick(x.label, L)}</span><span className="b">{x.byte}</span></span>,
            }))}
          />
        </div>
        <div className="lab-run">
          <div className="txt">
            <b>{token && action !== 1 ? `${t(`learn.cx.run.${action}.t`)} · LAB` : t(`learn.cx.run.${action}.t`)}</b>
            <span>{desc}{token ? ` ${t("learn.cx.token.d")}` : ""}</span>
          </div>
          <div className="keys">
            {action === 3 ? (
              <>
                <Key size="sm" icon="warn" onClick={() => go("bad")} disabled={!avl || !!busy}>{t("learn.cx.run.3.bad")}</Key>
                <Key size="sm" variant="primary" icon="clock" onClick={() => go("ok")} disabled={!avl || !!busy}>{t("learn.cx.run.3.ok")}</Key>
              </>
            ) : (
              <>
                <Key size="sm" variant="primary" icon={action === 0 ? "redeem" : action === 1 ? "plus" : "exit"} onClick={() => go("ok")} disabled={!avl || !!busy}>{t(`learn.cx.run.${action}.ok`, { v: amt(action, "ok") })}</Key>
                <Key size="sm" icon="warn" onClick={() => go("bad")} disabled={!avl || !!busy}>{t(`learn.cx.run.${action}.bad`, { v: amt(action, "bad") })}</Key>
              </>
            )}
          </div>
        </div>
        <div className="lab-result" aria-live="polite">
          {busy ? <span>{t("learn.cx.running")}</span>
            : run && verdict ? (
              <>
                <span className={verdict.ok ? "v-ok" : "v-no"}>{verdict.text}</span>
                <span className="mono" style={{ fontSize: 12 }}>{t("learn.cx.ran", { h: run.height.toLocaleString("en-US").replace(/,/g, " ⁠"), b: t(avl?.real ? "viz.backend.wasm" : "viz.backend.simulated") })}</span>
              </>
            ) : range ? <span>{t("learn.cx.lines", { a: range[0], b: range[1] })}</span>
              : <span>{avl ? t("learn.cx.noRun") : t("learn.engine")}</span>}
        </div>
        <div ref={xrayRef} style={{ scrollMarginTop: 96 }}>
          <ContractXray
            key={`${vizC}-${action}-${runNo}`}
            contract={vizC}
            action={run ? undefined : action}
            evaluation={run?.outcome}
            focus={focus.length ? focus : undefined}
            mode="full"
            unit={unit}
            maxCodeHeight={phone ? 520 : 920}
          />
        </div>
      </Sec>

      <Sec id="legend" title={rich(t("learn.cx.s.legend"))} lede={t("learn.cx.s.legend.lede")}>
        {states && <p className="cx-leg-after" aria-live="polite">{t("learn.cx.legend.after")}</p>}
        <div className="label" style={{ marginBottom: 6 }}>{t("learn.cx.prelude")}</div>
        <div className="cx-legend" style={{ marginBottom: 28 }}>
          {checks.filter((id) => prelude.has(id)).map((id) => <LegendRow key={id} id={id} cid={cid} on={focus.includes(id)} onPick={pointAt} state={states ? states.get(id) ?? "skip" : undefined} />)}
        </div>
        <div className="label" style={{ marginBottom: 6 }}>{action} · {pick(actionTabs[action].label, L)} · <span className="lrn-nocase">{actionTabs[action].byte}</span></div>
        <div className="cx-legend">
          {checks.filter((id) => !prelude.has(id)).map((id) => <LegendRow key={id} id={id} cid={cid} on={focus.includes(id)} onPick={pointAt} state={states ? states.get(id) ?? "skip" : undefined} />)}
        </div>
      </Sec>

      <Sec id="diff" title={rich(t("learn.cx.s.diff"))} lede={t("learn.cx.s.diff.lede")}>
        <div className="cx-diff">
          <div>
            <div className="fh"><b>basis.es</b><span className="label">{t("learn.cx.diff.lines", { n: contracts.basis.lines.length })}</span></div>
            <ul>{[1, 2, 3].map((i) => <li key={i}>{inline(t(`learn.cx.diff.erg.${i}`))}</li>)}</ul>
            <div><Key size="sm" variant="quiet" icon="right" onClick={() => { pickContract("basis"); xrayRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }); }}>{plainTitle(t("learn.cx.s.xray"))}</Key></div>
          </div>
          <div>
            <div className="fh"><b>basis-token.es</b><span className="label">{t("learn.cx.diff.lines", { n: contracts.token.lines.length })}</span></div>
            <ul>{[1, 2, 3, 4].map((i) => <li key={i}>{inline(t(`learn.cx.diff.tok.${i}`))}</li>)}</ul>
            <div><Key size="sm" variant="quiet" icon="right" onClick={() => { pickContract("token"); xrayRef.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }); }}>{plainTitle(t("learn.cx.s.xray"))}</Key></div>
          </div>
        </div>
        <p className="lrn-p" style={{ marginTop: 20 }}>{t("learn.cx.diff.same")}</p>
      </Sec>

      <Sec id="vars" title={rich(t("learn.cx.s.vars"))} lede={t("learn.cx.s.vars.lede")}>
        <div className="cx-vars">
          {contextVars.map((v) => (
            <div className="cx-var" key={v.id}>
              <span className="i">#{v.id}</span>
              <span className="ty">{v.type}</span>
              <span className="tx">{inline(pick(v.text, L))}</span>
            </div>
          ))}
        </div>
        <div className="cx-order"><span className="k">{t("learn.cx.vars.first")}</span>{contextVarOrder.firstRedemption.map((i) => <span key={i}>#{i}</span>)}</div>
        <div className="cx-order"><span className="k">{t("learn.cx.vars.later")}</span>{contextVarOrder.laterRedemption.map((i) => <span key={i} className={i === 7 ? "opt" : undefined}>#{i}</span>)}</div>
      </Sec>

      <Sec id="not" title={rich(t("learn.cx.s.not"))} lede={t("learn.cx.s.not.lede")}>
        <ul className="lrn-ul">
          {notChecked.map((x, i) => <li key={i}>{inline(pick(x, L))}</li>)}
        </ul>
      </Sec>

      <Sec id="source" title={rich(t("learn.cx.s.source"))} lede={t("learn.cx.s.source.lede")}>
        <Side label={t("learn.sources")}>
          <SourceLinks ids={["bt-basis-es", "bt-basis-token-es", "bt-spec-compiled"]} />
        </Side>
        <div className="cx-pin">
          <span>{t("learn.cx.pin.file")} <b>{src.path}</b></span>
          <span>{t("learn.cx.pin.ref")} <b>{GIT_REF_SHORT}</b> · {GIT_REF_DATE}</span>
          <span>{t("learn.cx.pin.lines")} <b>{src.lines.length}</b></span>
          <span>{t("learn.cx.pin.license")} <b>{src.license}</b></span>
          <span style={{ overflowWrap: "anywhere" }}>{t("learn.cx.pin.sha")} <b>{src.sha256}</b></span>
        </div>
        <div className="lrn-try">
          <Key size="sm" icon="github" href={src.url}>{t("learn.cx.github")}<Icon name="ext" size={14} /></Key>
          <span className="t-small mono">{GIT_REF}</span>
        </div>
      </Sec>

      <Pager id="contract" />
    </article>
  );
}

function verdictLine(run: LabRun, t: ReturnType<typeof useT>): { ok: boolean; text: string } {
  const o = run.outcome;
  if (o.ok) return { ok: true, text: t("learn.cx.pass") };
  if (run.before) {
    const r = reasonFor(run.before);
    return { ok: false, text: t("learn.cx.before", { why: r ? pick(r.title, t.lang) : run.before }) };
  }
  const id = o.eval?.error?.check ?? o.eval?.failed[0];
  const r = id ? reserveCheckReasons[id] : undefined;
  return { ok: false, text: t("learn.cx.fail", { check: r ? pick(r.title, t.lang) : id ?? "?" }) };
}

type CheckState = "pass" | "fail" | "skip";
const STATE_MARK: Record<CheckState, string> = { pass: "✓", fail: "✕", skip: "–" };

function LegendRow({ id, cid, on, onPick, state }: { id: ReserveCheckId; cid: Cid; on: boolean; onPick: (id: ReserveCheckId) => void; state?: CheckState }) {
  const t = useT();
  const r = reserveCheckReasons[id];
  const only = CONTRACT_ONLY[id];
  const lines = reasonLines[id][cid][0];
  return (
    <button type="button" className={`cx-leg${on ? " on" : ""}${state ? ` is-${state}` : ""}`} aria-pressed={on} onClick={() => onPick(id)}>
      {state ? <span className="st" aria-hidden="true">{STATE_MARK[state]}</span> : <span className="lp" aria-hidden="true" />}
      <b>{state && <span className="sr-only">{t(`learn.cx.st.${state}`)}: </span>}{pick(r.title, t.lang)}{only && <span className="only">{t("learn.cx.onlyIn", { file: only === "token" ? "basis-token.es" : "basis.es" })}</span>}</b>
      <span className="id">{id}{lines ? ` · ${lines.from === lines.to ? t("learn.tr.lineShort", { a: lines.from }) : t("learn.tr.linesShort", { a: lines.from, b: lines.to })}` : ""}</span>
      <span className="tx">{inline(pick(r.text, t.lang))}</span>
    </button>
  );
}

