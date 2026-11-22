// "Try to cheat" (VISUAL §13 /play, both modes): six attempts, each run on a copy of the moment on screen. The
// contract (or the tracker) refuses; the card names the failing check in words and opens the X-ray with the
// evaluation. The run itself never changes.
import { useEffect, useRef, useState } from "react";
import type { Lang } from "@/app/types";
import type { TFn } from "@/app";
import { pick, reasonFor } from "@/content";
import type { Economy } from "@/protocol";
import { Icon, int, toast } from "@/ui";
import { worldLookup } from "@/world";
import { CHEATS, cheatContext, displayName, runCheat, type CheatId, type CheatResult } from "./model";

interface Props {
  eco: Economy;
  t: TFn;
  lang: Lang;
  free: boolean;
  /** Bumps when the shown state changes (results go stale). */
  version: string;
  onOpen: (r: CheatResult) => void;
}

export function checkTitle(code: string, lang: Lang): string {
  const r = reasonFor(code);
  return r ? pick(r.title, lang) : code;
}
export function checkText(code: string, lang: Lang): string {
  const r = reasonFor(code);
  if (r) return pick(r.text, lang);
  return worldLookup(`world.code.${code}`, lang) ?? "";
}

export function Cheats({ eco, t, lang, free, version, onOpen }: Props) {
  const [res, setRes] = useState<Partial<Record<CheatId, CheatResult | "none">>>({});
  const [busy, setBusy] = useState<CheatId | null>(null);
  // one cheat toast at a time: the next attempt replaces the last one instead of stacking up beside the cards
  const lastToast = useRef<number | null>(null);
  useEffect(() => setRes({}), [version]);
  const ctx = cheatContext(eco);
  const vars = ctx ? { r: displayName(eco, ctx.receiver, lang), i: displayName(eco, ctx.issuer, lang), age: int(ctx.age ?? 0), v: "" } : { r: "—", i: "—", age: "0", v: "" };

  const tryIt = (id: CheatId) => {
    setBusy(id);
    // let the button paint its pressed state before the copy is built
    requestAnimationFrame(() => {
      let out: CheatResult | null = null;
      try {
        out = runCheat(id, eco, lang);
      } catch {
        out = null;
      }
      setBusy(null);
      setRes((m) => ({ ...m, [id]: out ?? "none" }));
      if (!out) return;
      if (out.passed) {
        toast({ kind: "alarm", title: t("play.cheat.passed"), ttl: 6000 });
        return;
      }
      const where = t(`play.cheat.where.${out.stage}`);
      // the X-ray opens by itself; the toast only says, calmly, what happened
      if (lastToast.current !== null) toast.dismiss(lastToast.current);
      lastToast.current = toast({ kind: "info", title: t("play.cheat.toast"), detail: `${t(`play.cheat.${id}.t`)} · ${t("play.cheat.refused", { where })}` });
      onOpen(out);
    });
  };

  return (
    <div className="pl-cheats">
      <p className="t-small">{t("play.cheat.lede")}</p>
      {ctx ? (
        <p className="pl-cheat-ctx mono">{t("play.cheat.who", { r: vars.r, i: vars.i })}</p>
      ) : (
        <p className="pl-cheat-ctx">{free ? t("play.cheat.noneFree") : t("play.cheat.none")}</p>
      )}
      <ol className="pl-cheat-list">
        {CHEATS.map((id) => {
          const r = res[id];
          const disabled = id === "refund" ? false : !ctx || (id === "early" && ctx.emergencyOpen);
          const x = t(`play.cheat.${id}.x`, vars);
          return (
            <li key={id} className={`pl-cheat${r && r !== "none" ? (r.passed ? " passed" : " refused") : ""}`}>
              <div className="pl-cheat-h">
                <b>{t(`play.cheat.${id}.t`)}</b>
                <button type="button" className="key sm" onClick={() => tryIt(id)} disabled={disabled || busy !== null} aria-busy={busy === id}>
                  {r && r !== "none" ? t("play.cheat.again") : t("play.cheat.try")}
                </button>
              </div>
              <p className="t-small">{x}</p>
              {r === "none" && <p className="t-small pl-cheat-none">{id === "refund" ? t("play.cheat.noneRefund") : free ? t("play.cheat.noneFree") : t("play.cheat.none")}</p>}
              {r && r !== "none" && (
                <div className="pl-cheat-out" role="status">
                  {r.setup.length > 0 && <p className="t-small dim">{t("play.cheat.setup", { what: r.setup.map((x) => t(x.key, x.vars)).join("; ") })}</p>}
                  {r.passed ? (
                    <p className="pl-cheat-v alarm-t">{t("play.cheat.passed")}</p>
                  ) : (
                    <>
                      <p className="pl-cheat-v">
                        <Icon name="lock" />
                        {t("play.cheat.refused", { where: t(`play.cheat.where.${r.stage}`) })}
                      </p>
                      {r.stage === "contract" && r.failed.length > 0 && <p className="t-small">{t("play.cheat.failedCheck", { check: checkTitle(r.failed[0], lang) })}</p>}
                      <p className="t-small dim">{checkText(r.stage === "contract" && r.failed[0] ? r.failed[0] : r.code, lang)}</p>
                      {r.trackerCode && <p className="t-small dim">{t("play.cheat.forged.tracker", { why: worldLookup(`world.code.${r.trackerCode}`, lang) ?? r.trackerCode })}</p>}
                      <button type="button" className="key sm quiet pl-cheat-open" onClick={() => onOpen(r)}>
                        <Icon name="scan" />
                        {t("play.cheat.open")}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
