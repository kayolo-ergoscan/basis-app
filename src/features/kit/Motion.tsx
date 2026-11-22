// Kit section 11: the motion choreography of the style tile (VISUAL §10), five tracks on a time axis.
// Durations are the --t-* tokens; with reduced motion every one of them collapses to 1 ms (?still: none at all).
import { rich, useT } from "@/app/lang";
import { Section } from "@/ui";
import { Spec } from "./Spec";

type Tone = "" | "u" | "m" | "h";
/** [from ms, to ms, label key, tone, second row] */
type Seg = [number, number, string, Tone?, boolean?];
interface Track { id: string; total: number; segs: Seg[]; ticks: number[] }

const TRACKS: Track[] = [
  { id: "pay", total: 2600, segs: [[0, 700, "pay.1"], [700, 1600, "pay.2", "u"], [1600, 1840, "pay.3", "", true], [1600, 2600, "pay.4"]], ticks: [0, 700, 1600, 2600] },
  { id: "commit", total: 2600, segs: [[0, 1400, "commit.1", "h"], [0, 240, "commit.2", "", true], [240, 2600, "commit.3", "", true]], ticks: [0, 240, 1400, 2600] },
  { id: "redeem", total: 3500, segs: [[0, 1200, "redeem.1", "m"], [1200, 1900, "redeem.2"], [1900, 2500, "redeem.3", "m"], [2500, 3400, "redeem.4", "u", true]], ticks: [0, 1200, 1900, 2500, 3400] },
  { id: "eclipse", total: 3000, segs: [[0, 2400, "eclipse.1"], [2400, 2820, "eclipse.2", "", true]], ticks: [0, 2400, 2820] },
  { id: "time", total: 1200, segs: [[0, 180, "time.1"], [180, 1080, "time.2", "u"]], ticks: [0, 180, 1080] },
];

export function MotionSection() {
  const t = useT();
  const tick = (ms: number) => (ms >= 1000 ? `${ms / 1000} ${t("kit.mo.s")}` : `${ms} ${t("kit.mo.ms")}`);
  return (
    <Section id="motion" no={`11 · ${t("kit.s.motion")}`} title={rich(t("kit.s.motion.t"))} lede={t("kit.s.motion.l")}>
      <Spec tag="<Odometer> <Key hold> <Note> · VISUAL §10" name={t("kit.mo.name")} note={t("kit.mo.note")}>
        <div className="mo-tracks">
          {TRACKS.map((tr) => (
            <div className="mo-track" key={tr.id}>
              <div className="mo-nm"><b>{t(`kit.mo.${tr.id}`)}</b><span>{t(`kit.mo.${tr.id}.d`)}</span></div>
              <div className="mo-tl">
                <div className="mo-in">
                  {tr.segs.map(([a, b, k, tone, row2]) => (
                    <span key={k} className={["mo-seg", tone, row2 && "row2"].filter(Boolean).join(" ")}
                      style={{ left: `${(a / tr.total) * 100}%`, width: `${((b - a) / tr.total) * 100}%` }}>
                      {t(`kit.mo.${k}`)}
                    </span>
                  ))}
                  <div className="mo-axis" aria-hidden="true">
                    {tr.ticks.map((x) => <span key={x} style={{ left: `${(x / tr.total) * 100}%` }}>{tick(x)}</span>)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Spec>
    </Section>
  );
}
