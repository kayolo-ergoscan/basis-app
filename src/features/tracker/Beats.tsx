// The heartbeat strip (VISUAL §9, §12.7) over the last 720 blocks or, while the town is younger, over every block
// since it began. One bar is one updater cycle, aligned to the town's cycles, so the strip moves left one bar per
// cycle; while the town is younger than 144 blocks one bar is one block. A commitment is light (holo); a heartbeat
// box (same digest, posted only to stay alive) is a shorter light bar; the current bar is verdigris. When the
// tracker is dark or silent the light goes grey. On phone a long strip folds into two rows so each bar stays readable.
import { useMemo } from "react";
import { useT } from "@/app/lang";
import { int } from "@/ui";
import { BEATS, beatsWindow, type Beat } from "./model";

export interface BeatsProps {
  beats: Beat[];
  height: number;
  genesis: number;
  interval: number;
  /** Grey light: the tracker is dark, or silent for ≥ 720 blocks. */
  stale: boolean;
  /** The current bar shows the live (verdigris) mark. */
  live: boolean;
  /** 2: fold a long strip into two rows (phone). */
  rows?: 1 | 2;
  /** Blocks since the latest commitment (for the screen-reader summary). */
  lastAgo: number | null;
}

interface Slot {
  cycle: number;
  start: number;
  commits: number;
  heartbeats: number;
}

/** A strip of more bars than this folds into two rows when asked to. */
const FOLD = 72;

export function Beats({ beats, height, genesis, interval, stale, live, rows = 1, lastAgo }: BeatsProps) {
  const t = useT();
  const win = beatsWindow(height, genesis, interval);
  const { bucket, from } = win;
  const slots = useMemo(() => {
    const c0 = Math.floor((from - genesis) / bucket);
    const c1 = Math.floor((height - genesis) / bucket);
    const out: Slot[] = [];
    for (let c = c0; c <= c1; c++) out.push({ cycle: c, start: genesis + c * bucket, commits: 0, heartbeats: 0 });
    for (const b of beats) {
      if (b.height < from || b.height > height) continue;
      const s = out[Math.floor((b.height - genesis) / bucket) - c0];
      if (!s) continue;
      s.commits++;
      if (b.heartbeat) s.heartbeats++;
    }
    return out;
  }, [beats, height, genesis, bucket, from]);

  const commits = beats.filter((b) => b.height >= from && b.height <= height).length;
  const fold = rows === 2 && slots.length > FOLD;
  const half = Math.ceil(slots.length / 2);
  const chunks: Slot[][] = fold ? [slots.slice(0, half), slots.slice(half)] : [slots];
  const ageAt = (s: Slot) => Math.max(0, height - Math.max(s.start, from));
  const head = win.young
    ? t.p("tracker.beats.ariaYoung", win.back, { n: int(win.back), c: int(commits) })
    : t("tracker.beats.aria", { n: int(BEATS), c: int(commits) });
  const aria = commits === 0 ? t("tracker.beats.none") : lastAgo === null ? head : `${head} ${t.p("tracker.beats.ariaLast", lastAgo, { n: int(lastAgo) })}`;

  return (
    <div className={["trk-beats", stale && "stale", fold && "folded"].filter(Boolean).join(" ")} role="img" aria-label={aria}>
      {chunks.map((chunk, ri) => {
        const lastRow = ri === chunks.length - 1;
        return (
          <div className="trk-beats-row" key={ri} aria-hidden="true">
            <div className="trk-beats-bars" style={{ gridTemplateColumns: `repeat(${chunk.length}, minmax(0, 1fr))` }}>
              {chunk.map((s, i) => {
                const now = lastRow && i === chunk.length - 1;
                const cls = [s.commits > 0 && (s.heartbeats === s.commits ? "hb" : "c"), now && live && "now"].filter(Boolean).join(" ");
                const rest = 18 + ((((s.cycle * 37) % 11) + 11) % 11) * 2;
                return <i key={s.cycle} className={cls || undefined} style={cls ? undefined : { height: `${rest}%` }} />;
              })}
            </div>
            <div className="trk-beats-scale">
              <span>{t("tracker.beats.ago", { n: int(ri === 0 ? win.back : ageAt(chunk[0])) })}</span>
              {!fold && win.back >= 8 && <span>{t("tracker.beats.ago", { n: int(Math.round(win.back / 2)) })}</span>}
              <span>{lastRow ? `${t("ui.tracker.now")} ▸` : t("tracker.beats.ago", { n: int(ageAt(chunk[chunk.length - 1])) })}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
