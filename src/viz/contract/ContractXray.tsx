// ContractXray: "watch the contract think". The ErgoScript source of basis.es / basis-token.es with line numbers
// and a gutter of lamps; the engine's checks light up in contract order (verdigris = holds, alarm = false or
// throws) with the actual value against the required one; a verdict line ends the run. Hover or tap a line to
// read what it does. Source, annotations and reason → line ranges are data, so content can supply its own.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ReserveCheckId } from "@/protocol";
import { ERG_UNIT, fmtAmount, type UnitInfo } from "../core/format";
import { pick, reasonTitle, useVizLang, useVizT } from "../core/lang";
import { useReducedMotion, useSeen } from "../core/motion";
import { Btn, CheckLamp, Seg, Tag, type CheckLampState } from "../core/primitives";
import { compactRanges, inRanges, mergeRanges, type ActionId, type ContractId, type LineRange } from "./lines";
import { actionOf, buildRows, contractIdOf, focusChecks, mapOf, resolveEvaluation, sourceOf, verdictOf, type EvaluationInput, type XrayRow } from "./model";
import { annotations as contentAnn, reasonLines as contentRL } from "@/content/contracts";
import "../core/core.css";
import "./contract.css";

type Bi = string | { en: string; ru?: string };

/** A note on a line range (content's annotations use the same shape). */
export interface XrayAnnotation {
  from: number;
  to: number;
  title?: Bi;
  text: Bi;
  kind?: string;
  /** A source comment in this block is stale or misleading: said next to the block. */
  warning?: Bi;
}

/** content's annotations (src/content/contracts.ts) for one contract, in the X-ray's shape. */
export function contentAnnotations(contract: ContractId): XrayAnnotation[] {
  return contentAnn[contract === "basis-token" ? "token" : "basis"].map((a) => ({
    from: a.from,
    to: a.to,
    title: { en: a.titleEN, ru: a.titleRU },
    text: { en: a.textEN, ru: a.textRU },
    kind: a.kind,
    ...(a.warningEN ? { warning: { en: a.warningEN, ru: a.warningRU ?? a.warningEN } } : {}),
  }));
}

/** content's reasonLines for one contract: check id → line ranges (with the spending path when it is one branch). */
export function contentReasonLines(contract: ContractId): Record<string, ReadonlyArray<{ from: number; to: number; action?: number }>> {
  const k = contract === "basis-token" ? "token" : "basis";
  const out: Record<string, ReadonlyArray<{ from: number; to: number; action?: number }>> = {};
  for (const [id, v] of Object.entries(contentRL)) out[id] = v[k];
  return out;
}

/** Text with `inline code` in backticks (content's convention) → nodes. */
export function codeSpans(s: string): ReactNode {
  if (!s.includes("`")) return s;
  return s.split("`").map((part, i) => (i % 2 ? <code key={i}>{part}</code> : part));
}

export interface ContractXrayProps {
  /** Which contract; default: from the evaluation, else "basis". */
  contract?: ContractId;
  /** Spending path 0–3 (null = invalid action); default: from the evaluation, else 0. */
  action?: ActionId | null;
  /** ReserveEval, or an Economy outcome (redeem / topUp / initiateRefund / completeRefund) that carries one. */
  evaluation?: EvaluationInput;
  /** Reason codes to point at: engine check ids, or wallet/tracker codes (note-not-committed, …). */
  focus?: readonly string[];
  mode?: "compact" | "full";
  /** How amounts in findings are written (default ERG; token contract: raw units). */
  unit?: UnitInfo;
  /** Source lines (default: @/content/contractSource). */
  lines?: readonly string[];
  annotations?: readonly XrayAnnotation[];
  /** Extra reason code → line ranges (content's reasonLines). */
  reasonLines?: Record<string, ReadonlyArray<{ from: number; to: number; action?: number }>>;
  /** Show the 0–3 path switch (only meaningful without an evaluation). */
  actionPicker?: boolean;
  title?: ReactNode;
  sub?: ReactNode;
  /** false = no stepping animation (also off under reduced motion). */
  animate?: boolean;
  maxCodeHeight?: number;
  className?: string;
}

type Item = { kind: "line"; n: number } | { kind: "fold"; from: number; to: number; comments: boolean };

const INFORMATIVE_PASS = new Set<ReserveCheckId>(["actionVar", "properlyRedeemed", "trackerDebtCorrect", "timestampCorrect", "trackerSigValid", "topUpAmount", "refundPeriodOver", "refundHeightValid", "refundStarted", "refundHeightRead"]);
const KEYWORDS = /\b(val|if|else|def|true|false|sigmaProp|proveDlog|getVar|OUTPUTS|INPUTS|SELF|HEIGHT|CONTEXT|blake2b256|byteArrayToLong|longToByteArray|byteArrayToBigInt|decodePoint)\b/g;

function isComment(s: string): boolean {
  const t = s.trim();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/** The contract's own comment block at or just above line n (up to 3 code lines above), as one sentence. */
export function commentNear(lines: readonly string[], n: number): string | null {
  let k = n;
  if (!isComment(lines[k - 1] ?? "")) {
    let j = n - 1;
    let steps = 0;
    while (j >= 1 && !isComment(lines[j - 1]) && steps < 3) {
      j--;
      steps++;
    }
    if (j < 1 || !isComment(lines[j - 1])) return null;
    k = j;
  }
  let a = k;
  let b = k;
  while (a - 1 >= 1 && isComment(lines[a - 2]) && k - a < 8) a--;
  while (b + 1 <= lines.length && isComment(lines[b]) && b - a < 10) b++;
  const text = lines
    .slice(a - 1, b)
    .map((l) => l.trim().replace(/^\/\/+\s?|^\/\*+\s?|^\*+\/?\s?|\*\/$/g, "").trim())
    .filter(Boolean)
    .join(" ");
  return text || null;
}

function Code({ text }: { text: string }) {
  const ci = text.indexOf("//");
  const code = ci >= 0 ? text.slice(0, ci) : text;
  const comment = ci >= 0 ? text.slice(ci) : "";
  const parts: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  KEYWORDS.lastIndex = 0;
  let k = 0;
  while ((m = KEYWORDS.exec(code))) {
    if (m.index > last) parts.push(code.slice(last, m.index));
    parts.push(
      <b key={k++} className={/^[A-Z]/.test(m[1]) || /^(getVar|sigmaProp|proveDlog|blake2b256|byteArrayToLong|longToByteArray|byteArrayToBigInt|decodePoint)$/.test(m[1]) ? "bi" : "kw"}>
        {m[1]}
      </b>,
    );
    last = m.index + m[1].length;
  }
  if (last < code.length) parts.push(code.slice(last));
  return (
    <code>
      {parts}
      {comment ? <span className="cm">{comment}</span> : null}
      {text.length === 0 ? "​" : null}
    </code>
  );
}

export function ContractXray(props: ContractXrayProps) {
  const t = useVizT();
  const lang = useVizLang();
  const reduced = useReducedMotion();
  const resolved = useMemo(() => resolveEvaluation(props.evaluation), [props.evaluation]);
  const contract: ContractId = props.contract ?? contractIdOf(resolved.eval);
  const derivedAction = props.action !== undefined ? props.action : actionOf(resolved.eval, 0);
  const [action, setAction] = useState<ActionId | null>(derivedAction);
  useEffect(() => setAction(derivedAction), [derivedAction]);

  const src = useMemo(() => (props.lines ? { file: contract === "basis-token" ? ("basis-token.es" as const) : ("basis.es" as const), lines: props.lines, gitRef: undefined } : sourceOf(contract)), [contract, props.lines]);
  const map = useMemo(() => mapOf(contract, src.lines), [contract, src.lines]);
  // content's annotations and reason lines belong to its own copy of the source; a custom source brings its own
  const annotations = useMemo(() => props.annotations ?? (props.lines ? [] : contentAnnotations(contract)), [props.annotations, props.lines, contract]);
  const reasonLinesMap = useMemo(() => props.reasonLines ?? (props.lines ? {} : contentReasonLines(contract)), [props.reasonLines, props.lines, contract]);
  const unit = props.unit ?? (contract === "basis-token" ? { symbol: t("viz.cx.units"), decimals: 0 } : ERG_UNIT);
  const rows = useMemo(() => buildRows({ contract, action, map, resolved, lang, unit }), [contract, action, map, resolved, lang, unit.symbol, unit.decimals]); // eslint-disable-line react-hooks/exhaustive-deps
  const verdict = useMemo(() => verdictOf(resolved), [resolved]);
  const focus = useMemo(() => focusChecks(props.focus, verdict), [props.focus, verdict]);

  const [mode, setMode] = useState<"compact" | "full">(props.mode ?? "compact");
  useEffect(() => {
    if (props.mode) setMode(props.mode);
  }, [props.mode]);

  // ---- stepping animation ----
  const [rootRef, seen] = useSeen<HTMLElement>();
  const animated = props.animate !== false && !reduced && !!resolved.eval;
  const [nonce, setNonce] = useState(0);
  const [step, setStep] = useState<number>(animated ? -1 : rows.length);
  const runKey = `${contract}|${action}|${rows.map((r) => r.id + r.state).join(",")}|${nonce}`;
  useEffect(() => {
    if (!animated) {
      setStep(rows.length);
      return;
    }
    if (!seen) {
      setStep(-1);
      return;
    }
    let i = 0;
    setStep(0);
    const dt = Math.max(70, Math.min(170, 2600 / Math.max(1, rows.length)));
    const id = window.setInterval(() => {
      i++;
      setStep(i);
      if (i >= rows.length) window.clearInterval(id);
    }, dt);
    return () => window.clearInterval(id);
  }, [runKey, seen, animated]); // eslint-disable-line react-hooks/exhaustive-deps
  const done = step >= rows.length;
  const lampOf = (i: number): CheckLampState => (i < step ? rows[i].state : i === step ? "current" : "idle");

  // ---- selection ----
  const [selected, setSelected] = useState<ReserveCheckId | null>(null);
  const [line, setLine] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    setSelected(null);
    setLine(null);
  }, [runKey]);
  const firstFocus = rows.find((r) => focus.has(r.id))?.id ?? null;
  const firstBad = rows.find((r) => r.state === "fail" || r.state === "throws")?.id ?? null;
  const activeId: ReserveCheckId | null = selected ?? (!done ? rows[step]?.id ?? null : firstFocus ?? firstBad);
  const active = rows.find((r) => r.id === activeId) ?? null;

  const extraFocusRanges = useMemo(() => {
    const out: LineRange[] = [];
    for (const code of props.focus ?? []) for (const r of reasonLinesMap[code] ?? []) if (r.action === undefined || r.action === action) out.push([r.from, r.to]);
    return out;
  }, [props.focus, reasonLinesMap, action]);

  const anchorRow = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => {
      if (!m.has(r.anchor)) m.set(r.anchor, i);
    });
    return m;
  }, [rows]);
  const badRanges = useMemo(() => mergeRanges(rows.filter((r) => r.state === "fail" || r.state === "throws").flatMap((r) => r.ranges)), [rows]);
  const pathRanges = useMemo(() => compactRanges(map, action), [map, action]);
  const annotationsAt = (n: number) => annotations.filter((a) => n >= a.from && n <= a.to);

  // ---- visible items (compact folds) ----
  const [open, setOpen] = useState<Set<number>>(new Set());
  useEffect(() => setOpen(new Set()), [mode, action, contract]);
  const items = useMemo<Item[]>(() => {
    const N = src.lines.length;
    const out: Item[] = [];
    if (mode === "full") {
      for (let n = 1; n <= N; n++) out.push({ kind: "line", n });
      return out;
    }
    let n = 1;
    while (n <= N) {
      if (!inRanges(n, pathRanges)) {
        let e = n;
        while (e + 1 <= N && !inRanges(e + 1, pathRanges)) e++;
        if (open.has(n)) for (let k = n; k <= e; k++) out.push({ kind: "line", n: k });
        else out.push({ kind: "fold", from: n, to: e, comments: false });
        n = e + 1;
        continue;
      }
      if (isComment(src.lines[n - 1])) {
        let e = n;
        while (e + 1 <= N && inRanges(e + 1, pathRanges) && isComment(src.lines[e]) && !anchorRow.has(e + 1)) e++;
        if (e - n + 1 >= 4 && !open.has(n)) {
          out.push({ kind: "fold", from: n, to: e, comments: true });
          n = e + 1;
          continue;
        }
        for (let k = n; k <= e; k++) out.push({ kind: "line", n: k });
        n = e + 1;
        continue;
      }
      out.push({ kind: "line", n });
      n++;
    }
    return out;
  }, [src.lines, mode, pathRanges, open, anchorRow]);

  // ---- keep the active line in view (inside the code panel only, never the page) ----
  const codeRef = useRef<HTMLDivElement>(null);
  const focusLine = line ?? active?.anchor ?? null;
  useEffect(() => {
    const box = codeRef.current;
    if (!box || focusLine === null) return;
    const el = box.querySelector<HTMLElement>(`[data-ln="${focusLine}"]`);
    if (!el) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop - box.clientHeight * 0.3;
    if (Math.abs(box.scrollTop - top) < 8) return;
    box.scrollTo({ top: Math.max(0, top), behavior: reduced || !done ? "auto" : "smooth" });
  }, [focusLine, items, reduced, done]);

  // ---- annotation card ----
  const noteLine = hover ?? line;
  const note = useMemo(() => {
    if (noteLine !== null) {
      const covering = rows.filter((r) => inRanges(noteLine, r.ranges));
      const ann = annotationsAt(noteLine);
      if (covering.length || ann.length) return { line: noteLine, rows: covering, ann, comment: null as string | null };
      return { line: noteLine, rows: [], ann: [], comment: commentNear(src.lines, noteLine) };
    }
    if (active) return { line: null as number | null, rows: [active], ann: annotationsAt(active.anchor), comment: null };
    return null;
  }, [noteLine, rows, active, src.lines, annotations]); // eslint-disable-line react-hooks/exhaustive-deps

  const title = (id: ReserveCheckId) => t(`viz.check.${id}`);
  const actionLabel = (a: ActionId | null) => (a === null ? t("viz.cx.actionInvalid") : t(`viz.cx.action${a}`));
  const ev = resolved.eval;

  const verdictNode = (() => {
    if (!done && step < 0) return <div className="vz-verdict neutral" role="status"><CheckLamp state="idle" size={14} /><div><div className="vz-verdict-t">{t("viz.cx.ready", { total: rows.length })}</div></div></div>;
    if (!done) return <div className="vz-verdict neutral" role="status"><CheckLamp state="current" size={14} /><div><div className="vz-verdict-t">{t("viz.cx.thinking", { n: step + 1, total: rows.length })}</div></div></div>;
    switch (verdict.kind) {
      case "ok": {
        const amount = action === 0 && verdict.redeemed !== undefined ? fmtAmount(verdict.redeemed, unit) : null;
        return (
          <div className="vz-verdict ok" role="status">
            <CheckLamp state="pass" size={14} />
            <div>
              <div className="vz-verdict-t">{amount ? t("viz.cx.verdictOkRedeem", { amount }) : t("viz.cx.verdictOk")}</div>
            </div>
          </div>
        );
      }
      case "fail":
      case "throws": {
        const row = rows.find((r) => r.id === verdict.check);
        return (
          <div className="vz-verdict bad" role="status">
            <CheckLamp state={verdict.kind === "throws" ? "throws" : "fail"} size={14} />
            <div>
              <div className="vz-verdict-t">{verdict.kind === "throws" ? t("viz.cx.verdictThrows", { check: verdict.check ? title(verdict.check) : "?" }) : t("viz.cx.verdictBad", { check: verdict.check ? title(verdict.check) : "?" })}</div>
              {row?.finding ? <div className="vz-verdict-d mono">{row.finding}</div> : null}
              <div className="vz-verdict-d">{t("viz.cx.verdictBadSub")}</div>
            </div>
          </div>
        );
      }
      case "not-reached":
        return (
          <div className="vz-verdict neutral" role="status">
            <CheckLamp state="skip" size={14} />
            <div>
              <div className="vz-verdict-t">{t("viz.cx.verdictNotReached", { stage: t(`viz.cx.stage.${verdict.stage}`) })}</div>
              <div className="vz-verdict-d">
                {verdict.code ? <code>{verdict.code}</code> : null} {verdict.code ? reasonTitle(lang, verdict.code, verdict.message) : verdict.message}
              </div>
            </div>
          </div>
        );
      default:
        return (
          <div className="vz-verdict neutral" role="status">
            <CheckLamp state="idle" size={14} />
            <div>
              <div className="vz-verdict-t">{t("viz.cx.idle")}</div>
            </div>
          </div>
        );
    }
  })();

  return (
    <section ref={rootRef} className={`vz vz-panel vz-cx${props.className ? " " + props.className : ""}`} aria-label={t("viz.cx.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">
            {t("viz.cx.eyebrow")} · <b>{src.file}</b> · {actionLabel(action)}
          </div>
          <h3 className="vz-title">{props.title ?? t("viz.cx.title")}</h3>
          <p className="vz-sub">{props.sub ?? (ev ? t("viz.cx.sub", { file: src.file }) : t("viz.cx.subIdle", { file: src.file, action: actionLabel(action) }))}</p>
        </div>
        <div className="vz-head-a">
          {ev?.emergency ? <Tag tone="watch" glyph="◇">{t("viz.cx.emergency")}</Tag> : null}
          {ev?.proofMode ? <Tag tone="plain">{t(`viz.cx.proofMode.${ev.proofMode}`)}</Tag> : null}
          {props.actionPicker && !ev ? (
            <Seg<string> size="s" mono label={t("viz.cx.actions")} value={String(action)} onChange={(v) => setAction(Number(v) as ActionId)} options={[0, 1, 2, 3].map((a) => ({ value: String(a), label: t(`viz.cx.action${a}`) }))} />
          ) : null}
          <Seg<"compact" | "full"> size="s" mono label={t("viz.cx.mode")} value={mode} onChange={setMode} options={[{ value: "compact", label: t("viz.cx.compact") }, { value: "full", label: t("viz.cx.full") }]} />
          {animated ? done ? <Btn kind="quiet" onClick={() => setNonce((x) => x + 1)}>{t("viz.cx.replay")}</Btn> : <Btn kind="quiet" onClick={() => setStep(rows.length)}>{t("viz.cx.skip")}</Btn> : null}
        </div>
      </header>

      <div className="vz-cx-grid">
        <div className="vz-cx-codewrap">
          <div
            ref={codeRef}
            className="vz-cx-code"
            style={props.maxCodeHeight ? { maxHeight: props.maxCodeHeight } : undefined}
            tabIndex={0}
            role="region"
            aria-label={`${t("viz.cx.code")} ${src.file}`}
            onMouseLeave={() => setHover(null)}
          >
            {items.map((it) =>
              it.kind === "fold" ? (
                <button
                  key={`f${it.from}`}
                  type="button"
                  className="vz-fold"
                  onClick={() => setOpen((s) => new Set(s).add(it.from))}
                  title={t("viz.cx.lines", { a: it.from, b: it.to })}
                >
                  <span className="no">{it.from}</span>
                  <span className="mk" aria-hidden="true">⋯</span>
                  <span className="txt">{it.comments ? t("viz.cx.foldComments", { n: it.to - it.from + 1 }) : t("viz.cx.fold", { n: it.to - it.from + 1 })}</span>
                </button>
              ) : (
                (() => {
                  const n = it.n;
                  const text = src.lines[n - 1];
                  const ri = anchorRow.get(n);
                  const inActive = !!active && inRanges(n, active.ranges);
                  const activeBad = !!active && (active.state === "fail" || active.state === "throws") && (selected !== null || done);
                  const bad = done && inRanges(n, badRanges);
                  const off = mode === "full" && !inRanges(n, pathRanges);
                  const extra = inRanges(n, extraFocusRanges);
                  const cls = ["vz-ln", isComment(text) ? "c" : "", off ? "off" : "", inActive ? (activeBad ? "act bad" : "act") : "", bad && !inActive ? "badrule" : "", extra ? "extra" : "", line === n ? "sel" : "", annotationsAt(n).length ? "ann" : ""].filter(Boolean).join(" ");
                  return (
                    <div key={n} data-ln={n} className={cls} onMouseEnter={() => setHover(n)} onClick={() => setLine((x) => (x === n ? null : n))}>
                      <span className="no">{n}</span>
                      <span className="mk">{ri !== undefined ? <CheckLamp state={lampOf(ri)} size={10} title={`${title(rows[ri].id)}: ${t(`viz.cx.outcome.${lampOf(ri) === "current" ? "idle" : lampOf(ri)}`)}`} /> : annotationsAt(n).length ? <i className="tick" aria-hidden="true" /> : null}</span>
                      <Code text={text} />
                    </div>
                  );
                })()
              ),
            )}
          </div>
          <div className="vz-cx-src">{t("viz.cx.source", { file: src.file, ref: src.gitRef ? src.gitRef.slice(0, 7) : "" })}</div>
        </div>

        <div className="vz-cx-side">
          {verdictNode}
          <div className="vz-cx-checkshead vz-eyebrow">{ev ? t("viz.cx.checks") : t("viz.cx.checksIdle")}</div>
          <ol className="vz-cx-checks">
            {rows.map((r, i) => {
              const lamp = lampOf(i);
              const shown = lamp !== "idle" && lamp !== "current";
              const showFinding = shown && r.finding && (r.state === "fail" || r.state === "throws" || (r.state === "pass" && INFORMATIVE_PASS.has(r.id)));
              return (
                <li key={`${r.id}-${i}`}>
                  <button
                    type="button"
                    className={`vz-cx-check s-${shown ? r.state : lamp}${activeId === r.id ? " on" : ""}${focus.has(r.id) ? " focus" : ""}`}
                    onClick={() => {
                      setSelected((s) => (s === r.id ? null : r.id));
                      setLine(null);
                    }}
                    aria-pressed={activeId === r.id}
                    title={r.expr || undefined}
                  >
                    <CheckLamp state={lamp} size={12} />
                    <span className="nm">{title(r.id)}</span>
                    <span className="oc">{shown ? t(`viz.cx.outcome.${r.state}`) : ""}</span>
                    <span className="ln">{r.anchor}</span>
                    {showFinding ? <span className="fd">{r.finding}</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="vz-cx-note" aria-live="polite">
            <div className="vz-eyebrow">
              {t("viz.cx.annotation")}
              {note?.line ? ` · ${t("viz.cx.line", { n: note.line })}` : note?.rows[0] ? ` · ${t("viz.cx.line", { n: note.rows[0].anchor })}` : ""}
            </div>
            {!note ? <p className="vz-small">{t("viz.cx.noAnnotation")}</p> : null}
            {note?.rows.map((r) => (
              <div key={r.id} className="vz-cx-ann">
                <div className="vz-cx-ann-t">
                  <CheckLamp state={done ? r.state : "idle"} size={10} /> {title(r.id)}
                </div>
                <p className="vz-p">{t(`viz.check.${r.id}.why`)}</p>
                {done && r.finding ? <p className={`vz-cx-ann-f${r.state === "fail" || r.state === "throws" ? " bad" : ""}`}>{r.finding}</p> : null}
              </div>
            ))}
            {note?.ann.map((a, i) => (
              <div key={`a${i}`} className="vz-cx-ann ctx">
                {a.title ? (
                  <div className="vz-cx-ann-t">
                    {pick(lang, a.title)} <span className="lns">{t("viz.cx.lines", { a: a.from, b: a.to })}</span>
                  </div>
                ) : null}
                <p className="vz-p">{codeSpans(pick(lang, a.text))}</p>
                {a.warning ? <p className="vz-cx-ann-w">{codeSpans(pick(lang, a.warning))}</p> : null}
              </div>
            ))}
            {note && !note.rows.length && !note.ann.length ? <p className="vz-p">{note.comment ? `“${note.comment}”` : t("viz.cx.noAnnotation")}</p> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export default ContractXray;
