// Left rail (VISUAL §13 /play): the scenario (title, tagline, features, the other ten one click away) and its
// steps, each with a ✓ or ✗ once it ran: "the protocol behaved as the story says". On phone the steps become a
// swipeable row of cards.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { TFn } from "@/app";
import type { EconomyEvent, StepResult } from "@/protocol";
import { blk, Icon, Tag, int } from "@/ui";
import { scenarioList, type RunController, type RunStepInfo } from "@/world";
import { refusalsIn } from "./model";

export interface StepsState {
  steps: RunStepInfo[];
  results: StepResult[];
  index: number;
  animating: { step: number; mined: number; total: number } | null;
  busy: boolean;
  ok: boolean | null;
  tampered: boolean;
  continuable: boolean;
  mode: string;
}

export const SCENARIOS = scenarioList();

export function stepTitle(t: TFn, scenario: string, s: { id: string; title: string }): string {
  const k = `play.sc.${scenario}.${s.id}.t`;
  return t.has(k) ? t(k) : s.title;
}
export function stepText(t: TFn, scenario: string, s: { id: string; text: string }): string {
  const k = `play.sc.${scenario}.${s.id}.x`;
  return t.has(k) ? t(k) : s.text;
}
export function scTitle(t: TFn, id: string, fallback?: string): string {
  const k = `play.sc.${id}.title`;
  return t.has(k) ? t(k) : fallback ?? id;
}
export function scTag(t: TFn, id: string, fallback?: string): string {
  const k = `play.sc.${id}.tag`;
  return t.has(k) ? t(k) : fallback ?? "";
}
export function featLabel(t: TFn, f: string): string {
  const k = `play.feat.${f}`;
  return t.has(k) ? t(k) : f;
}

/** Scenario list: title, tagline and features of each, the current one marked. */
export function ScenarioList({ current, t, seedQuery, onPick }: { current: string | null; t: TFn; seedQuery?: string; onPick?: () => void }) {
  return (
    <ul className="pl-sclist" role="list">
      {SCENARIOS.map((s) => (
        <li key={s.id}>
          <Link to={`/play/${s.id}${seedQuery ?? ""}`} className={`pl-sc${s.id === current ? " on" : ""}`} aria-current={s.id === current ? "page" : undefined} onClick={onPick}>
            <span className="pl-sc-t">{scTitle(t, s.id, s.title)}</span>
            <span className="pl-sc-tag">{scTag(t, s.id, s.tagline)}</span>
            <span className="pl-sc-feats">
              {s.features.slice(0, 4).map((f) => (
                <span key={f} className="pl-feat">
                  {featLabel(t, f)}
                </span>
              ))}
              <span className="pl-sc-n mono">{t.p("play.rail.stepsN", s.steps)}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

interface RailProps {
  run: RunController;
  scenario: { id: string; title: string; tagline: string; features: string[] } | null;
  /** An alternate history: the title of the story or world it branched off. */
  forkOf?: string;
  st: StepsState;
  t: TFn;
  /** Live event count (refusal detection per step). */
  version: number;
  viewSeq: number | null;
  onViewStep: (r: StepResult) => void;
  onXray: (e: EconomyEvent) => void;
  children?: React.ReactNode;
}

/** Scenario header + steps (desktop rail). In free mode the children (the tools) replace the steps. */
export const Rail = memo(function Rail({ run, scenario, forkOf, st, t, version, viewSeq, onViewStep, onXray, children }: RailProps) {
  const [listOpen, setListOpen] = useState(false);
  const id = scenario?.id ?? "free";
  const listRef = useRef<HTMLOListElement>(null);
  const refusals = useRefusals(run, st.results, version);
  // keep the next step in view as the story advances
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(".pl-step.next, .pl-step.running");
    if (!el || !listRef.current) return;
    const box = listRef.current.closest(".pl-rail-scroll") as HTMLElement | null;
    if (!box) return;
    const top = el.offsetTop - box.offsetTop;
    if (top < box.scrollTop + 40 || top + el.offsetHeight > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: Math.max(0, top - 120), behavior: "smooth" });
  }, [st.index, st.animating?.step]);
  const failed = st.results.filter((r) => !r.outcome.ok).length;
  const viewing = viewSeq !== null ? st.results.findIndex((r, i) => viewSeq >= r.fromSeq && (i === st.results.length - 1 || viewSeq < st.results[i + 1].fromSeq)) : -1;
  return (
    <div className="pl-rail-scroll">
      <header className="pl-rail-h">
        <span className="label">{scenario ? t("play.rail.scenarios") : st.mode === "fork" ? t("play.top.fork") : st.mode === "replay" ? t("play.top.replay") : t("play.top.free")}</span>
        <h2 className="pl-rail-t">{scenario ? scTitle(t, id, scenario.title) : st.mode === "fork" ? (forkOf ?? t("play.top.fork")) : t("play.sc.free.title")}</h2>
        <p className="pl-rail-tag">{scenario ? scTag(t, id, scenario.tagline) : st.mode === "fork" ? t("play.free.fork") : t("play.free.lede")}</p>
        {scenario && (
          <div className="pl-feats">
            {scenario.features.map((f) => (
              <span key={f} className="pl-feat">
                {featLabel(t, f)}
              </span>
            ))}
          </div>
        )}
        <button type="button" className="pl-disclose" aria-expanded={listOpen} onClick={() => setListOpen((x) => !x)}>
          <Icon name={listOpen ? "down" : "right"} />
          {listOpen ? t("play.rail.hide") : t("play.rail.all")}
        </button>
        {listOpen && <ScenarioList current={scenario?.id ?? null} t={t} onPick={() => setListOpen(false)} />}
      </header>
      {children}
      {scenario && st.steps.length > 0 && (
        <section className="pl-steps" aria-label={t("play.rail.steps")}>
          <div className="pl-steps-h">
            <span className="label">{t("play.rail.steps")}</span>
            <span className="mono pl-mini">{t("play.rail.stepOf", { n: String(Math.min(st.index + (st.index < st.steps.length ? 1 : 0), st.steps.length)), total: String(st.steps.length) })}</span>
          </div>
          <ol className="pl-steplist" ref={listRef}>
            {st.steps.map((s) => {
              const r = st.results[s.index];
              const running = st.animating?.step === s.index;
              const next = !r && s.index === st.index && !st.busy;
              const cls = ["pl-step", r ? (r.outcome.ok ? "ok" : "fail") : "", running ? "running" : "", next ? "next" : "", !r && !running && !next ? "ahead" : "", viewing === s.index ? "viewing" : ""].filter(Boolean).join(" ");
              const ref = refusals.get(s.index);
              return (
                <li key={s.id} className={cls}>
                  <div className="pl-step-n mono" aria-hidden="true">
                    {r ? r.outcome.ok ? <Icon name="check" /> : <span className="pl-x">✗</span> : s.index + 1}
                  </div>
                  <div className="pl-step-b">
                    {r ? (
                      <button type="button" className="pl-step-t as-link" onClick={() => onViewStep(r)} title={t("play.rail.viewStep")}>
                        {stepTitle(t, id, s)}
                      </button>
                    ) : (
                      <span className="pl-step-t">{stepTitle(t, id, s)}</span>
                    )}
                    <p className="pl-step-x">{stepText(t, id, s)}</p>
                    {running && st.animating && st.animating.total > 0 && (
                      <p className="pl-step-mine mono" aria-live="polite">
                        {t("play.player.mining", { n: int(st.animating.mined), total: int(st.animating.total) })}
                      </p>
                    )}
                    {r && (
                      <p className={`pl-verdict ${r.outcome.ok ? "ok" : "fail"}`} title={r.outcome.ok ? t("play.rail.ok") : t("play.rail.fail")}>
                        <span className="sr-only">{r.outcome.ok ? t("play.rail.ok") : t("play.rail.fail")}</span>
                        <span aria-hidden="true">{r.outcome.ok ? "✓ " : "✗ "}{r.outcome.ok ? t("play.rail.okShort") : t("play.rail.failShort")}</span>
                        {r.minedBlocks > 0 && <span className="mono dim"> · {blk(r.minedBlocks, t.lang)}</span>}
                      </p>
                    )}
                    {r && !r.outcome.ok && r.outcome.detail && <p className="pl-step-detail mono">{t("play.rail.engine")}: {r.outcome.detail}</p>}
                    {ref && (
                      <button type="button" className="pl-xray-k" onClick={() => onXray(ref)}>
                        <Icon name="scan" />
                        {t("play.rail.xray")}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
          {st.ok !== null && (
            <div className={`pl-done ${st.ok ? "ok" : "fail"}`} role="status">
              <b>{t("play.rail.done")}</b>
              <span>{st.ok ? t("play.rail.allOk") : t("play.rail.someFail", { n: String(failed), total: String(st.steps.length) })}</span>
            </div>
          )}
          {st.tampered && (
            <p className="t-small pl-note-line">
              <Tag tone="watch">{t("play.rail.tamperedTag")}</Tag> {t("play.rail.tampered")}
            </p>
          )}
          {!st.continuable && st.mode === "replay" && <p className="t-small pl-note-line">{t("play.rail.replay")}</p>}
        </section>
      )}
    </div>
  );
});

/** First refusal (contract-level first) in each played step. */
export function useRefusals(run: RunController, results: readonly StepResult[], version: number): Map<number, EconomyEvent> {
  const cache = useRef(new Map<number, { to: number; ev: EconomyEvent | null }>());
  return useMemo(() => {
    const out = new Map<number, EconomyEvent>();
    for (const r of results) {
      const c = cache.current.get(r.index);
      let ev: EconomyEvent | null;
      if (c && c.to === r.toSeq) ev = c.ev;
      else {
        ev = refusalsIn(run.eventsOf(r))[0] ?? null;
        cache.current.set(r.index, { to: r.toSeq, ev });
      }
      if (ev) out.set(r.index, ev);
    }
    return out;
  }, [run, results, results.length, version]);
}

/** Phone: the steps as a row of swipeable cards (the next one scrolled into view). */
export function StepCards({ run, scenario, st, t, version, onViewStep, onXray }: Omit<RailProps, "children" | "viewSeq">) {
  const row = useRef<HTMLOListElement>(null);
  const refusals = useRefusals(run, st.results, version);
  const id = scenario?.id ?? "free";
  const focus = st.animating?.step ?? Math.min(st.index, st.steps.length - 1);
  useEffect(() => {
    const el = row.current?.children[focus] as HTMLElement | undefined;
    if (el && row.current) row.current.scrollTo({ left: el.offsetLeft - 16, behavior: "smooth" });
  }, [focus]);
  if (!scenario) return null;
  return (
    <ol className="pl-cards" ref={row} aria-label={t("play.rail.steps")}>
      {st.steps.map((s) => {
        const r = st.results[s.index];
        const running = st.animating?.step === s.index;
        const ref = refusals.get(s.index);
        return (
          <li key={s.id} className={`pl-card${r ? (r.outcome.ok ? " ok" : " fail") : ""}${running ? " running" : ""}${s.index === st.index && !r ? " next" : ""}`}>
            <div className="pl-card-h">
              <span className="mono pl-mini">{t("play.rail.stepOf", { n: String(s.index + 1), total: String(st.steps.length) })}</span>
              {r && <span className={`pl-verdict-dot ${r.outcome.ok ? "ok" : "fail"}`} aria-label={r.outcome.ok ? t("play.rail.ok") : t("play.rail.fail")}>{r.outcome.ok ? "✓" : "✗"}</span>}
            </div>
            {r ? (
              <button type="button" className="pl-step-t as-link" onClick={() => onViewStep(r)}>
                {stepTitle(t, id, s)}
              </button>
            ) : (
              <span className="pl-step-t">{stepTitle(t, id, s)}</span>
            )}
            <p className="pl-step-x">{stepText(t, id, s)}</p>
            {running && st.animating && st.animating.total > 0 && <p className="pl-step-mine mono">{t("play.player.mining", { n: int(st.animating.mined), total: int(st.animating.total) })}</p>}
            {r && <p className={`pl-verdict ${r.outcome.ok ? "ok" : "fail"}`}>{r.outcome.ok ? t("play.rail.ok") : t("play.rail.fail")}</p>}
            {ref && (
              <button type="button" className="pl-xray-k" onClick={() => onXray(ref)}>
                <Icon name="scan" />
                {t("play.rail.xray")}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
