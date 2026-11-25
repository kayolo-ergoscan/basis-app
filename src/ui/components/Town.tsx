// The town at night: the picture language of the site. Flat SVG drawn from tokens (walls, roofs, unlit windows, the
// street), with light carrying the meaning: lamplight (amber) = value on Ergo, moonlight = recorded by a tracker.
//   <BrandMark>    the mark: one window, lit; it catches moonlight once per commitment (the pulse)
//   <Skyline>      a quiet row of houses (footer, page heads, 404, empty states): deterministic, no data
//   <HouseLights>  your house: one window per step you finished (the wallet checklists)
//   <WindowLoader> loading: three windows light up in turn (static under reduced motion)
// Everything here is decoration with aria-hidden, except HouseLights, which carries a label.
import { memo, useMemo, useRef, type CSSProperties } from "react";
import type { Pulse } from "@/app/pulse";
import { usePulseClass } from "../hooks";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** The Basis mark: a window with its lower pane lit. Pulses (moonlight) once per commitment. */
export function BrandMark({ size = 30, pulse = true, className }: { size?: number; pulse?: boolean; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  usePulseClass(ref, () => pulse);
  return (
    <span ref={ref} className={cx("brand-mark", className)} style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 32 32" width="100%" height="100%">
        <rect className="bm-frame" x="2" y="2" width="28" height="28" rx="9" />
        <rect className="bm-top" x="8.5" y="7.5" width="15" height="6" rx="2.5" />
        <rect className="bm-lit" x="8.5" y="16" width="15" height="9" rx="2.5" />
      </svg>
    </span>
  );
}

/** A small deterministic generator (the skyline must look the same on every render and every server). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 10000) / 10000; };
}

interface Bld { x: number; w: number; h: number; roof: "flat" | "gable" | "arch"; wins: { x: number; y: number; w: number; h: number; lit: 0 | 1 | 2 }[] }

/** Builds a row of houses across `width` units, ground at `ground`. lit: 1 = lamplight, 2 = moonlight. */
function buildRow(seed: number, width: number, ground: number, maxH: number, litShare: number): Bld[] {
  const r = rng(seed);
  const out: Bld[] = [];
  let x = 0;
  while (x < width) {
    const w = 46 + Math.round(r() * 64);
    const h = Math.round(maxH * (0.38 + r() * 0.62));
    const roofPick = r();
    const roof: Bld["roof"] = roofPick < 0.22 ? "gable" : roofPick < 0.3 ? "arch" : "flat";
    const wins: Bld["wins"] = [];
    const cols = Math.max(1, Math.floor((w - 16) / 18));
    const rows = Math.max(1, Math.floor((h - 22) / 24));
    const ox = x + (w - cols * 18 + 6) / 2;
    for (let c = 0; c < cols; c++)
      for (let rr = 0; rr < rows; rr++) {
        if (r() < 0.25) continue;
        const v = r();
        wins.push({ x: ox + c * 18, y: ground - h + 14 + rr * 24, w: 10, h: 13, lit: v < litShare * 0.12 ? 2 : v < litShare ? 1 : 0 });
      }
    out.push({ x, w, h, roof, wins });
    x += w + 4 + Math.round(r() * 10);
  }
  return out;
}

export interface SkylineProps {
  /** Changes the houses (stable per seed). */
  seed?: number;
  /** Share of windows that are lit, 0–1 (default .22). */
  lit?: number;
  /** Units tall. */
  height?: number;
  /** Units wide (default 1200): a wider row is lower on the same screen. */
  span?: number;
  /** A tracker's clock tower at this x (0–1200): its face catches moonlight once per matching commitment. */
  tower?: number;
  /** Which commitments light the tower (default: every one). */
  towerFilter?: (p: Pulse) => boolean;
  className?: string;
}
/** A row of houses across the page, windows lit here and there. Pure decoration (aria-hidden). Memoised: a page that
 *  re-renders on live data does not redraw the town (pass a stable `towerFilter`). */
export const Skyline = memo(function Skyline({ seed = 7, lit = 0.22, height = 120, span = 1200, tower, towerFilter, className }: SkylineProps) {
  const ground = height - 4;
  const row = useMemo(() => {
    const all = buildRow(seed, span, ground, height - 18, lit);
    return tower == null ? all : all.filter((b) => b.x + b.w < tower - 8 || b.x > tower + 64);
  }, [seed, span, ground, height, lit, tower]);
  const towerRef = useRef<SVGGElement>(null);
  usePulseClass(towerRef, towerFilter);
  const th = Math.round(height * 0.96);
  return (
    <svg className={cx("skyline", className)} viewBox={`0 0 ${span} ${height}`} preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">
      {row.map((b, i) => (
        <g key={i}>
          {b.roof === "gable" ? (
            <path className="sk-wall" d={`M${b.x} ${ground} V${ground - b.h + 14} L${b.x + b.w / 2} ${ground - b.h - 8} L${b.x + b.w} ${ground - b.h + 14} V${ground} Z`} />
          ) : b.roof === "arch" ? (
            <path className="sk-wall" d={`M${b.x} ${ground} V${ground - b.h + 10} Q${b.x + b.w / 2} ${ground - b.h - 14} ${b.x + b.w} ${ground - b.h + 10} V${ground} Z`} />
          ) : (
            <rect className="sk-wall" x={b.x} y={ground - b.h} width={b.w} height={b.h} rx="5" />
          )}
          {b.wins.map((w, j) => <rect key={j} className={w.lit === 2 ? "sk-moon" : w.lit === 1 ? "sk-lit" : "sk-win"} x={w.x} y={w.y} width={w.w} height={w.h} rx="2.5" />)}
        </g>
      ))}
      {tower != null && (
        <g className="sk-tower" ref={towerRef}>
          <path className="sk-wall" d={`M${tower} ${ground} V${ground - th + 34} L${tower + 28} ${ground - th + 4} L${tower + 56} ${ground - th + 34} V${ground} Z`} />
          <circle className="sk-face-glow" cx={tower + 28} cy={ground - th + 56} r="30" />
          <circle className="sk-face" cx={tower + 28} cy={ground - th + 56} r="15" />
          <path className="sk-hands" d={`M${tower + 28} ${ground - th + 56} V${ground - th + 46} M${tower + 28} ${ground - th + 56} L${tower + 35} ${ground - th + 60}`} />
          <rect className="sk-moon" x={tower + 23} y={ground - th + 86} width="10" height="13" rx="2.5" />
        </g>
      )}
      <rect className="sk-street" x="0" y={ground} width={span} height="4" />
    </svg>
  );
});

export interface HouseLightsProps {
  /** One entry per step: true when done. */
  steps: boolean[];
  /** Index of the step to do now (its window is outlined in lamplight). */
  now?: number;
  size?: number;
  /** Words for screen readers ("3 of 5 done"); leave out when a list next to it already says it (then aria-hidden). */
  label?: string;
  className?: string;
}
/** Your house: a window per step, lit when the step is done. */
export function HouseLights({ steps, now, size = 88, label, className }: HouseLightsProps) {
  const n = steps.length;
  const cols = n <= 4 ? 2 : 3;
  const rows = Math.ceil(n / cols);
  const W = 96, top = 40, cell = 22, gapX = (W - 16 - cols * 14) / Math.max(1, cols - 1);
  const H = top + rows * cell + 12;
  return (
    <svg className={cx("house-lights", className)} viewBox={`0 0 ${W} ${H}`} width={size} height={(size * H) / W} {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}>
      <path className="hl-wall" d={`M6 ${H - 2} V${top - 6} L${W / 2} 6 L${W - 6} ${top - 6} V${H - 2} Z`} />
      {steps.map((done, i) => {
        const c = i % cols, r = Math.floor(i / cols);
        const x = 8 + c * (14 + gapX), y = top + r * cell;
        return <rect key={i} className={cx("hl-win", done && "on", now === i && "now")} x={x} y={y} width="14" height="17" rx="3.5" style={{ "--i": i } as CSSProperties} />;
      })}
    </svg>
  );
}

/** Loading: three windows light up in turn. Under reduced motion they stay half lit. */
export function WindowLoader({ size = 64 }: { size?: number }) {
  return (
    <div className="window-load" style={{ width: size, height: size }} aria-hidden="true">
      <svg viewBox="0 0 64 64" width="100%" height="100%">
        <path className="wl-wall" d="M6 60 V24 L32 6 L58 24 V60 Z" />
        <rect className="wl-w w1" x="14" y="30" width="10" height="13" rx="2.5" />
        <rect className="wl-w w2" x="27" y="30" width="10" height="13" rx="2.5" />
        <rect className="wl-w w3" x="40" y="30" width="10" height="13" rx="2.5" />
        <rect className="wl-door" x="27" y="47" width="10" height="13" rx="2.5" />
      </svg>
    </div>
  );
}
