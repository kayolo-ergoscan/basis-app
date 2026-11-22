// ExitClocks: the two clocks the reserve contract keeps.
//  1. Emergency redeem (the tracker's dead-man switch): the dial of VISUAL §9, 0–2 160 blocks of the newest
//     tracker box's age; the path opens when the age is more than 2 160, i.e. at creationHeight + 2 161.
//  2. The owner's exit: R7 (the height written when the exit is announced) + 43 200 blocks.
// Blocks first, then ≈ time (120 s per block).

import type { ReactNode } from "react";
import { EMERGENCY_BLOCKS, REFUND_PERIOD_BLOCKS } from "@/protocol";
import { fmtBlocks, fmtBlocksTime, fmtInt } from "../core/format";
import { useVizLang, useVizT } from "../core/lang";
import { emergencyModel, exitModel } from "./model";
import "../core/core.css";
import "./clocks.css";

export interface ExitClocksProps {
  height: number;
  /** Creation height of the tracker's newest box (null: no box yet, or not looked up yet: see boxPending). */
  boxCreationHeight: number | null;
  /** The tracker box is still being looked up: say "checking", never "no box". */
  boxPending?: boolean;
  /** The reserve's R7 (0 / null / undefined: no exit announced). */
  r7?: number | null;
  /** Which clocks to show (default both). */
  show?: "both" | "emergency" | "exit";
  trackerName?: string;
  title?: ReactNode;
  className?: string;
}

const C = 60;
const R = 50;
function pt(blocks: number, r: number): [number, number] {
  const a = (Math.min(blocks, EMERGENCY_BLOCKS) / EMERGENCY_BLOCKS) * 2 * Math.PI;
  return [C + r * Math.sin(a), C - r * Math.cos(a)];
}
function arc(b0: number, b1: number, r: number): string {
  const [x0, y0] = pt(b0, r);
  const [x1, y1] = pt(b1, r);
  const large = (b1 - b0) / EMERGENCY_BLOCKS > 0.5 ? 1 : 0;
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function DeadManDial({ age, open, label, sub }: { age: number; open: boolean; label: string; sub: string }) {
  const ticks: ReactNode[] = [];
  for (let b = 0; b < EMERGENCY_BLOCKS; b += 30) {
    const major = b % 180 === 0;
    const [x0, y0] = pt(b, R - (major ? 7 : 3.5));
    const [x1, y1] = pt(b, R);
    ticks.push(<line key={b} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? "tk major" : "tk"} />);
  }
  const [hx, hy] = pt(Math.min(age, EMERGENCY_BLOCKS), R - 12);
  return (
    <svg className={`vz-dial${open ? " open" : ""}`} viewBox="0 0 120 120" role="img" aria-label={`${label} · ${sub}`}>
      <circle cx={C} cy={C} r={R} className="face" />
      <path d={arc(120, 720, R - 2)} className="z-late" />
      <path d={arc(720, EMERGENCY_BLOCKS - 0.01, R - 2)} className="z-silent" />
      {ticks}
      <line x1={C} y1={C} x2={hx} y2={hy} className="hand" />
      <circle cx={C} cy={C} r={3} className="hub" />
      <text x={C} y={C + 20} textAnchor="middle" className="rd">
        {label}
      </text>
      <text x={C} y={C + 30} textAnchor="middle" className="rd2">
        {sub}
      </text>
    </svg>
  );
}

export function ExitClocks(p: ExitClocksProps) {
  const t = useVizT();
  const lang = useVizLang();
  const show = p.show ?? "both";
  const em = p.boxCreationHeight === null ? null : emergencyModel(p.height, p.boxCreationHeight);
  const r7 = p.r7 && p.r7 > 0 ? p.r7 : null;
  const ex = r7 === null ? null : exitModel(p.height, r7);
  return (
    <section className={`vz vz-panel vz-clocks${p.className ? " " + p.className : ""}`} aria-label={t("viz.clock.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.clock.eyebrow")}</div>
          <h3 className="vz-title">{p.title ?? t(show === "exit" ? "viz.clock.titleExit" : show === "emergency" ? "viz.clock.titleEm" : "viz.clock.title")}</h3>
        </div>
        <div className="vz-head-a">
          <span className="vz-small">{t("viz.clock.blockNow", { h: fmtInt(p.height) })}</span>
        </div>
      </header>
      <div className={`vz-body vz-clocks-grid${show !== "both" ? " one" : ""}`}>
        {show !== "exit" ? (
          <div className={`vz-clock em${em?.open ? " open" : ""}`}>
            <div className="vz-clock-h">{t("viz.clock.emTitle")}</div>
            {em ? (
              <>
                <div className="vz-clock-dial">
                  <DeadManDial age={em.age} open={em.open} label={fmtBlocks(em.age, lang)} sub={t(`viz.clock.zone.${em.zone}`)} />
                </div>
                <p className="vz-clock-line">{t("viz.clock.age", { age: fmtBlocksTime(em.age, lang) })}</p>
                <p className={`vz-clock-line strong${em.open ? " open" : ""}`}>
                  {em.open ? t("viz.clock.emOpen", { h: fmtInt(em.opensAt) }) : t("viz.clock.emOpensIn", { h: fmtInt(em.opensAt), left: fmtBlocksTime(em.left, lang) })}
                </p>
                {em.zone === "silent" ? <p className="vz-clock-line calm">{t("viz.clock.calm")}</p> : null}
              </>
            ) : (
              <p className="vz-clock-line">{t(p.boxPending ? "viz.clock.checking" : "viz.clock.noBox")}</p>
            )}
            <p className="vz-small">{t("viz.clock.emSub")}</p>
          </div>
        ) : null}
        {show !== "emergency" ? (
          <div className={`vz-clock ex${ex?.open ? " open" : ""}`}>
            <div className="vz-clock-h">{t("viz.clock.exitTitle")}</div>
            {ex ? (
              <>
                <div className="vz-exitbar" role="meter" aria-valuemin={0} aria-valuemax={REFUND_PERIOD_BLOCKS} aria-valuenow={Math.min(ex.elapsed, REFUND_PERIOD_BLOCKS)} aria-label={t("viz.clock.exitTitle")}>
                  <span className="fill" style={{ width: `${(ex.progress * 100).toFixed(2)}%` }} />
                  <span className="needle" style={{ left: `${(ex.progress * 100).toFixed(2)}%` }} />
                </div>
                <div className="vz-exitbar-l">
                  <span>R7 {fmtInt(ex.r7)}</span>
                  <span>{t("viz.clock.elapsed", { a: fmtInt(Math.min(ex.elapsed, REFUND_PERIOD_BLOCKS)) })}</span>
                  <span>{fmtInt(ex.unlockAt)}</span>
                </div>
                <p className="vz-clock-line">{t("viz.clock.exitR7", { r7: fmtInt(ex.r7) })}</p>
                <p className={`vz-clock-line strong${ex.open ? " open" : ""}`}>{ex.open ? t("viz.clock.exitOpen", { h: fmtInt(ex.unlockAt) }) : t("viz.clock.exitLeft", { h: fmtInt(ex.unlockAt), left: fmtBlocksTime(ex.left, lang) })}</p>
              </>
            ) : (
              <p className="vz-clock-line">{t("viz.clock.exitNone")}</p>
            )}
            <p className="vz-small">{t("viz.clock.exitSub")}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default ExitClocks;
