// Bottom time machine (VISUAL §13 /play, 72 px): the step player on the left; the track with block ticks, event
// marks and the scrubber in the middle (dragging rewinds the whole stage through run.view); the readout, "Fork
// from here" and "Back to live" on the right.
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import type { TFn } from "@/app";
import { Icon, int } from "@/ui";
import { MARK_KINDS, playedEnd, seqOfX, xOfSeq, type Mark, type MarkKind, type Seg, type Tick } from "./model";

export type Speed = "calm" | "brisk" | "fast";
export const SPEEDS: Record<Speed, { blockMs: number; pause: number }> = {
  calm: { blockMs: 260, pause: 1600 },
  brisk: { blockMs: 90, pause: 700 },
  fast: { blockMs: 16, pause: 150 },
};
const ORDER: Speed[] = ["calm", "brisk", "fast"];
/** Shortest gap between two moments asked for while dragging the scrubber. */
const SCRUB_MS = 90;

export interface PlayerProps {
  story: boolean;
  canNext: boolean;
  animating: boolean;
  busy: boolean;
  done: boolean;
  auto: boolean;
  canBack: boolean;
  speed: Speed;
  onNext: () => void;
  onSkip: () => void;
  onAuto: () => void;
  onBack: () => void;
  onReset: () => void;
  onSpeed: (s: Speed) => void;
}

interface Props {
  t: TFn;
  segs: Seg[];
  marks: readonly Mark[];
  ticks: readonly Tick[];
  lastSeq: number;
  viewSeq: number | null;
  viewHeight: number;
  liveHeight: number;
  forked: boolean;
  onScrub: (seq: number | null) => void;
  onFork: () => void;
  onLive: () => void;
  onLeaveFork: () => void;
  player: PlayerProps;
  compact: boolean;
}

const PRIORITY: Record<MarkKind, number> = { step: 1, chain: 2, tracker: 3, money: 4, alert: 5, reject: 6 };

export const TimeBar = memo(function TimeBar(p: Props) {
  const { t, segs, marks, ticks, lastSeq, viewSeq, onScrub, compact } = p;
  const track = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [hover, setHover] = useState<{ x: number; seq: number } | null>(null);
  const drag = useRef(false);
  const raf = useRef(0);
  const want = useRef<number | null>(null);
  // a drag asks for a new moment at most every SCRUB_MS: each one rebuilds a past state, and the gaps between them
  // keep the pointer and the head smooth on a big run
  const lastScrub = useRef(0);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(80, el.clientWidth)));
    ro.observe(el);
    setW(Math.max(80, el.clientWidth));
    return () => ro.disconnect();
  }, []);
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      if (later.current) clearTimeout(later.current);
    },
    [],
  );

  const end = playedEnd(segs);
  const head = viewSeq === null ? end : xOfSeq(segs, viewSeq);

  // marks bucketed per pixel and kind: one path per kind, the highest-priority kind wins a pixel
  const paths = useMemo(() => {
    const best = new Map<number, Mark>();
    for (const m of marks) {
      const px = Math.round(xOfSeq(segs, m.seq) * w);
      const cur = best.get(px);
      if (!cur || PRIORITY[m.kind] > PRIORITY[cur.kind]) best.set(px, m);
    }
    const d: Record<MarkKind, string> = { step: "", money: "", chain: "", tracker: "", alert: "", reject: "" };
    for (const [px, m] of best) {
      const x = px + 0.5;
      if (m.kind === "step") d.step += `M${x} 2V30`;
      else if (m.kind === "money") d.money += `M${x - 3} 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0`;
      else if (m.kind === "chain") d.chain += `M${x} 6L${x + 3} 10L${x} 14L${x - 3} 10Z`;
      else if (m.kind === "tracker") d.tracker += `M${x - 3.2} 22a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0`;
      else if (m.kind === "alert") d.alert += `M${x} 17L${x + 3.6} 24H${x - 3.6}Z`;
      else d.reject += `M${x - 3} 19L${x + 3} 25M${x + 3} 19L${x - 3} 25`;
    }
    let tk = "";
    let last = -9;
    for (const k of ticks) {
      const px = Math.round(xOfSeq(segs, k.seq) * w);
      if (px - last < 2) continue;
      last = px;
      tk += `M${px + 0.5} 27V32`;
    }
    return { d, tk };
  }, [marks, ticks, segs, w]);

  const segRects = useMemo(() => {
    const total = segs.reduce((s, g) => s + g.w, 0) || 1;
    let acc = 0;
    return segs.map((g, i) => {
      const r = { left: (acc / total) * 100, width: (g.w / total) * 100, kind: g.kind, i, index: g.index };
      acc += g.w;
      return r;
    });
  }, [segs]);

  const seqAt = (clientX: number) => {
    const el = track.current;
    if (!el) return lastSeq;
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left) / r.width;
    if (x >= end - 0.002) return lastSeq;
    return seqOfX(segs, x, lastSeq);
  };
  const push = (seq: number) => {
    want.current = seq;
    if (raf.current || later.current) return;
    const go = () => {
      raf.current = requestAnimationFrame(() => {
        raf.current = 0;
        const s = want.current;
        if (s === null) return;
        lastScrub.current = performance.now();
        onScrub(s >= lastSeq ? null : s);
      });
    };
    const wait = SCRUB_MS - (performance.now() - lastScrub.current);
    if (wait <= 0) go();
    else
      later.current = setTimeout(() => {
        later.current = null;
        go();
      }, wait);
  };
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    push(seqAt(e.clientX));
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    const seq = seqAt(e.clientX);
    const r = track.current?.getBoundingClientRect();
    if (r && e.pointerType === "mouse") setHover({ x: Math.max(0, Math.min(r.width, e.clientX - r.left)), seq });
    if (drag.current) push(seq);
  };
  const onUp = () => {
    drag.current = false;
  };

  const cur = viewSeq ?? lastSeq;
  const onKey = (e: RKeyboardEvent) => {
    const stepMarks = marks.filter((m) => m.kind === "step");
    const pool = e.shiftKey ? stepMarks : marks;
    let target: number | null | undefined;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") target = [...pool].reverse().find((m) => m.seq < cur)?.seq ?? 0;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") target = pool.find((m) => m.seq > cur)?.seq ?? null;
    else if (e.key === "Home") target = 0;
    else if (e.key === "End") target = null;
    else if (e.key === "PageUp") target = Math.max(0, cur - Math.ceil(lastSeq / 10));
    else if (e.key === "PageDown") target = Math.min(lastSeq, cur + Math.ceil(lastSeq / 10));
    else return;
    e.preventDefault();
    onScrub(target === null || target >= lastSeq ? null : target);
  };

  const live = viewSeq === null;
  return (
    <div className={`pl-time${compact ? " compact" : ""}`} role="group" aria-label={t("play.tm.label")}>
      <Player {...p.player} t={t} compact={compact} />
      <div className="pl-track-wrap">
        <div
          ref={track}
          className="pl-track"
          role="slider"
          tabIndex={0}
          aria-label={t("play.tm.slider")}
          aria-valuemin={0}
          aria-valuemax={Math.max(0, lastSeq)}
          aria-valuenow={cur}
          aria-valuetext={t("play.tm.valueText", { seq: int(cur), last: int(lastSeq), h: int(p.viewHeight) })}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
          onKeyDown={onKey}
        >
          {segRects.map((r) => (
            <span key={r.i} className={`pl-seg ${r.kind}`} style={{ left: `${r.left}%`, width: `${r.width}%` }} aria-hidden="true">
              {r.kind === "step" && r.width > 3 && <i>{r.index + 1}</i>}
            </span>
          ))}
          <span className="pl-played" style={{ width: `${head * 100}%` }} aria-hidden="true" />
          <svg className="pl-marks" width={w} height={32} viewBox={`0 0 ${w} 32`} aria-hidden="true">
            <path d={paths.tk} className="mk-tick" />
            <path d={paths.d.step} className="mk-step" />
            <path d={paths.d.chain} className="mk-chain" />
            <path d={paths.d.tracker} className="mk-tracker" />
            <path d={paths.d.money} className="mk-money" />
            <path d={paths.d.alert} className="mk-alert" />
            <path d={paths.d.reject} className="mk-reject" />
          </svg>
          <span className={`pl-tm-head${live ? " live" : ""}`} style={{ left: `${head * 100}%` }} aria-hidden="true" />
          {hover && !drag.current && (
            <span className="pl-hover mono" style={{ left: hover.x }} aria-hidden="true">
              {hover.seq >= lastSeq ? t("play.tm.live") : `#${int(hover.seq)}`}
            </span>
          )}
        </div>
        {!compact && (
          <div className="pl-legend-tm" aria-hidden="true">
            {MARK_KINDS.map((k) => (
              <span key={k} className={`lg-${k}`}>
                <i />
                {t(`play.tm.mark.${k}`)}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="pl-readout">
        {live ? (
          <span className="pl-live mono">
            <span className="pl-live-dot" aria-hidden="true" />
            {t("play.tm.live")} · {int(p.liveHeight)}
          </span>
        ) : (
          <span className="pl-when mono">{t("play.tm.viewing", { seq: int(viewSeq!), h: int(p.viewHeight) })}</span>
        )}
        <div className="pl-readout-k">
          {!live && (
            <button type="button" className="key sm primary" onClick={p.onLive}>
              {t("play.tm.back")}
            </button>
          )}
          {!live && !p.forked && (
            <button type="button" className="key sm" onClick={p.onFork} title={t("play.tm.forkHelp")}>
              {t("play.tm.fork")}
            </button>
          )}
          {live && !p.forked && !compact && (
            <button type="button" className="key sm quiet" onClick={p.onFork} title={t("play.tm.forkHelp")}>
              {t("play.tm.fork")}
            </button>
          )}
          {p.forked && (
            <button type="button" className="key sm" onClick={p.onLeaveFork}>
              {t("play.tm.leave")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

function Player({ story, canNext, animating, busy, done, auto, canBack, speed, onNext, onSkip, onAuto, onBack, onReset, onSpeed, t, compact }: PlayerProps & { t: TFn; compact: boolean }) {
  if (!story) return <div className="pl-player empty" />;
  const nextSpeed = ORDER[(ORDER.indexOf(speed) + 1) % ORDER.length];
  return (
    <div className="pl-player pl-pad">
      <button type="button" className="key sm icon-only quiet" onClick={onBack} disabled={!canBack || busy} aria-label={t("play.player.back")} title={t("play.player.back")}>
        <Icon name="left" />
      </button>
      {animating ? (
        <button type="button" className="key sm primary pl-next" onClick={onSkip}>
          {t("play.player.skip")}
        </button>
      ) : done ? (
        <button type="button" className="key sm pl-next" onClick={onReset}>
          {t("play.player.again")}
        </button>
      ) : (
        <button type="button" className="key sm primary pl-next" onClick={onNext} disabled={!canNext || busy} aria-keyshortcuts="N">
          <Icon name="right" />
          {t("play.player.next")}
          {!compact && <span className="kbd" aria-hidden="true">N</span>}
        </button>
      )}
      <button type="button" className={`key sm icon-only${auto ? "" : " quiet"}`} onClick={onAuto} disabled={done} aria-pressed={auto} aria-label={auto ? t("play.player.pause") : t("play.player.auto")} title={auto ? t("play.player.pause") : t("play.player.auto")}>
        {auto ? <PauseGlyph /> : <Icon name="play" />}
      </button>
      {!compact && (
        <button type="button" className="key sm icon-only quiet" onClick={onReset} aria-label={t("play.player.reset")} title={t("play.player.reset")}>
          <Icon name="loop" />
        </button>
      )}
      <button type="button" className="key sm quiet pl-speed mono" onClick={() => onSpeed(nextSpeed)} aria-label={`${t("play.player.speed")}: ${t(`play.speed.${speed}`)}`} title={t("play.player.speed")}>
        {t(`play.speed.${speed}`)}
      </button>
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.5" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9.5" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}
