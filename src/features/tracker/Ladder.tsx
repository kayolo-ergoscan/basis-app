// The pending ladder (FEATURES T05): every note of the town tracker by how far its latest total has travelled,
// with the server's own status names and the wait for the next step.
import { useT } from "@/app/lang";
import { blk, Card, int, Lamp, type LampState } from "@/ui";
import type { Ladder, TrackerView } from "./model";
import { htime, md } from "./parts";

export function LadderCard({ ladder, v }: { ladder: Ladder; v: TrackerView }) {
  const t = useT();
  const lang = t.lang;
  const eta = (n: number | null, count: number) =>
    count === 0 ? null : !v.online ? t("tracker.ladder.etaDark") : n === null || n <= 0 ? t("tracker.ladder.etaNow") : t("tracker.ladder.eta", { blk: blk(n, lang) });
  const rungs: { id: "local" | "pending" | "confirmed"; code: string; lamp: LampState; n: number; eta: string | null }[] = [
    { id: "local", code: "local_only", lamp: "signed", n: ladder.local, eta: eta(ladder.etaPending, ladder.local) },
    { id: "pending", code: "pending", lamp: "tracked", n: ladder.pending, eta: eta(ladder.etaConfirmed, ladder.pending) },
    { id: "confirmed", code: "confirmed", lamp: "committed", n: ladder.confirmed, eta: null },
  ];
  return (
    <Card className="trk-ladder-card" title={t("tracker.ladder.title")} aside={<span className="label">{int(ladder.total)}</span>}>
      <p className="t-small trk-ladder-sub">{t("tracker.ladder.sub", { id: v.id })}</p>
      <ol
        className="trk-ladder"
        aria-label={t("tracker.ladder.aria", { local: int(ladder.local), pending: int(ladder.pending), confirmed: int(ladder.confirmed), omitted: int(ladder.omitted) })}
      >
        {rungs.map((r) => (
          <li key={r.id} className={`trk-rung r-${r.id}${r.n === 0 ? " zero" : ""}`}>
            <span className="trk-rung-lamp"><Lamp state={r.lamp} size={12} /></span>
            <span className="trk-rung-n">{int(r.n)}</span>
            <span className="trk-rung-t">
              <b>{t(`tracker.ladder.${r.id}`)}</b> <code className="trk-code">{r.code}</code>
              <span className="t-small">{t(`tracker.ladder.${r.id}.d`)}</span>
            </span>
            {r.eta && <span className="trk-rung-eta t-small">{r.eta}</span>}
          </li>
        ))}
      </ol>
      {ladder.omitted > 0 && (
        <div className="trk-rung-omit">
          <span className="trk-rung-n">{int(ladder.omitted)}</span>
          <span className="trk-rung-t">
            <b>{t("tracker.ladder.omitted")}</b>
            <span className="t-small">{t("tracker.ladder.omitted.d")}</span>
          </span>
        </div>
      )}
      <div className="trk-ladder-f">
        {ladder.etaLocalToConfirmed !== null && (
          <p className="t-small">{t("tracker.ladder.full", { blk: blk(ladder.etaLocalToConfirmed, lang), time: htime(ladder.etaLocalToConfirmed, lang) })}</p>
        )}
        <p className="t-small dim">{t("tracker.ladder.reference")}</p>
        <p className="t-small dim">{md(t("tracker.ladder.canRedeem"))}</p>
      </div>
    </Card>
  );
}
