// StatusLadder: a note's way from "the tracker holds it" (local) through "the newest box carries it" (pending) to
// "a confirmed box carries it" (confirmed), with the block ETA (next commit ≤ interval, then depth 2 seen by the
// next updater cycle) and "can redeem now" = confirmed && something is redeemable.

import type { ReactNode } from "react";
import type { NoteStatus } from "@/protocol";
import { ERG_UNIT, fmtAmount, fmtBlocks, fmtBlocksTime, type UnitInfo } from "../core/format";
import { useVizLang, useVizT } from "../core/lang";
import { ProtoLamp, type ProtoLampState } from "../core/primitives";
import { ladderModel, type LadderInput } from "./model";
import "../core/core.css";
import "./clocks.css";

export interface StatusLadderProps extends LadderInput {
  unit?: UnitInfo;
  title?: ReactNode;
  /** One line per rung, no sub-sentences. */
  compact?: boolean;
  className?: string;
}

const RUNGS: ReadonlyArray<{ s: NoteStatus; lamp: ProtoLampState; key: string }> = [
  { s: "local", lamp: "tracked", key: "local" },
  { s: "pending", lamp: "committed", key: "pending" },
  { s: "confirmed", lamp: "live", key: "confirmed" },
];

export function StatusLadder(p: StatusLadderProps) {
  const t = useVizT();
  const lang = useVizLang();
  const m = ladderModel(p);
  const unit = p.unit ?? ERG_UNIT;
  const idx = RUNGS.findIndex((r) => r.s === m.status);
  const interval = Math.max(1, p.commitIntervalBlocks ?? 5);
  const depth = p.minDepth ?? 2;
  return (
    <section className={`vz vz-panel vz-ladder${p.compact ? " compact" : ""}${p.className ? " " + p.className : ""}`} aria-label={t("viz.ladder.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.ladder.eyebrow")}</div>
          <h3 className="vz-title">{p.title ?? t("viz.ladder.title")}</h3>
        </div>
      </header>
      <div className="vz-body">
        <ol className="vz-rungs">
          {RUNGS.map((r, i) => (
            <li key={r.s} className={`vz-rung${i < idx ? " done" : ""}${i === idx ? " now" : ""}${i > idx ? " next" : ""}`} aria-current={i === idx ? "step" : undefined}>
              <span className="lamp">
                <ProtoLamp state={i <= idx ? r.lamp : "off"} size={12} />
              </span>
              <span className="nm">
                {t(`viz.ladder.${r.key}`)}
                {i === idx ? <em className="here">{t("viz.ladder.here")}</em> : null}
              </span>
              {!p.compact ? <span className="sub">{t(`viz.ladder.${r.key}Sub`, { d: depth })}</span> : null}
              {i === 0 ? <span className="gap">{t("viz.ladder.toCommit", { n: fmtBlocks(interval, lang) })}</span> : null}
              {i === 1 ? <span className="gap">{t("viz.ladder.toDepth", { d: depth, c: fmtBlocks(interval, lang) })}</span> : null}
            </li>
          ))}
        </ol>
        <div className="vz-ladder-eta">
          <span className="eta">{m.etaBlocks === 0 ? t("viz.ladder.etaNow") : t("viz.ladder.eta", { eta: fmtBlocksTime(m.etaBlocks, lang) })}</span>
          <span className={`redeem${m.canRedeemNow ? " yes" : ""}`} role="status">
            {m.canRedeemNow ? t("viz.ladder.redeemNow", { amount: fmtAmount(m.redeemable, unit) }) : m.status === "confirmed" ? t("viz.ladder.redeemNothing") : t("viz.ladder.redeemNot")}
          </span>
        </div>
      </div>
    </section>
  );
}

export default StatusLadder;
