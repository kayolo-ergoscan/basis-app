// Geometry of the engraving (ported verbatim from design/final/intaglio.js; any change to the output must bump
// the algorithm versions in seal.ts / noteArt.ts). All paths are compact: absolute M, then relative l-deltas
// of points rounded to 0.1 unit.

export type Pt = [number, number];
export const TAU = Math.PI * 2;

export const r1 = (n: number): number => Math.round(n * 10) / 10;
const cn = (q: number): string => { const s = (q / 10).toString(); return s.replace(/^(-?)0\./, "$1."); };

/** Compact path: absolute M, then relative l-deltas rounded to 0.1. */
export function poly(pts: Pt[], close?: boolean): string {
  let px = Math.round(pts[0][0] * 10), py = Math.round(pts[0][1] * 10);
  let d = "M" + cn(px) + " " + cn(py) + "l";
  let first = true;
  for (let i = 1; i < pts.length; i++) {
    const x = Math.round(pts[i][0] * 10), y = Math.round(pts[i][1] * 10);
    const dx = x - px, dy = y - py;
    if (!dx && !dy) continue;
    const a = cn(dx), b = cn(dy);
    d += (!first && a[0] !== "-" ? " " : "") + a + (b[0] === "-" ? "" : " ") + b;
    first = false; px = x; py = y;
  }
  return close ? d + "Z" : d;
}

/** Radius modulation for regular polygons (agents = octagon). */
export const polyR = (t: number, sides: number): number => {
  const seg = TAU / sides; const a = ((t % seg) + seg) % seg - seg / 2;
  return Math.cos(Math.PI / sides) / Math.cos(a);
};

export interface LatheOpts { R: number; A: number; n: number; copies: number; steps: number; phase?: number; sides?: number; wob?: number; wobN?: number }
export function lathe(cx: number, cy: number, { R, A, n, copies, steps, phase = 0, sides = 0, wob = 0, wobN = 3 }: LatheOpts): string[] {
  const out: string[] = [];
  for (let i = 0; i < copies; i++) {
    const ph = phase + i * TAU / copies, pts: Pt[] = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps * TAU;
      const base = sides ? R * polyR(t + Math.PI / sides, sides) : R;
      const r = base + A * Math.sin(n * t + ph) + wob * Math.sin(wobN * t);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    out.push(poly(pts, true));
  }
  return out;
}

export interface LaceOpts { R: number; A: number; n: number; B: number; mm: number; copies: number; steps: number; sides?: number }
export function lace(cx: number, cy: number, { R, A, n, B, mm, copies, steps, sides = 0 }: LaceOpts): string[] {
  const out: string[] = [];
  for (let i = 0; i < copies; i++) {
    const ph = i * TAU / copies, pts: Pt[] = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps * TAU;
      const base = sides ? R * polyR(t + Math.PI / sides, sides) : R;
      const r = base + A * Math.sin(n * t + ph * 0.5) + B * Math.sin(mm * t + ph);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    out.push(poly(pts, true));
  }
  return out;
}

export interface CrownOpts { r0: number; r1: number; k: number; copies: number; steps: number; p?: number; rot?: number; inv?: boolean }
export function crown(cx: number, cy: number, { r0, r1: rr1, k, copies, steps, p = 1.2, rot = 0, inv = false }: CrownOpts): string[] {
  const out: string[] = [];
  for (let i = 0; i < copies; i++) {
    const s = 1 - i / copies, pts: Pt[] = [];
    for (let j = 0; j <= steps; j++) {
      const t = j / steps * TAU;
      const w = Math.abs(Math.sin(k * t / 2 + rot));
      const r = r0 + (rr1 - r0) * s * Math.pow(inv ? 1 - w : w, p);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    out.push(poly(pts, true));
  }
  return out;
}

export const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/** Ring of n circles whose centres sit on radius R (classic lathe rosette). */
export function rosette(cx: number, cy: number, { n, R, r, steps = 72 }: { n: number; R: number; r: number; steps?: number }): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU, ox = cx + R * Math.cos(a), oy = cy + R * Math.sin(a), pts: Pt[] = [];
    for (let j = 0; j <= steps; j++) { const t = j / steps * TAU; pts.push([ox + r * Math.cos(t), oy + r * Math.sin(t)]); }
    out.push(poly(pts, true));
  }
  return out;
}

export interface TrochoidOpts { Rr: number; rr: number; d: number; rad: number; rot?: number; density?: number }
export function trochoid(cx: number, cy: number, { Rr, rr, d, rad, rot = 0, density = 1 }: TrochoidOpts): string {
  const turns = rr / gcd(Rr, rr), T = TAU * turns, pts: Pt[] = [];
  const k = (Rr - rr) / rr, maxR = Math.abs(Rr - rr) + d, s = rad / maxR;
  const n = Math.round(turns * (110 + 70 * Math.abs(k)) * density);
  const c = Math.cos(rot), sn = Math.sin(rot);
  for (let j = 0; j <= n; j++) {
    const t = j / n * T;
    const x = (Rr - rr) * Math.cos(t) + d * Math.cos(k * t), y = (Rr - rr) * Math.sin(t) - d * Math.sin(k * t);
    pts.push([cx + s * (x * c - y * sn), cy + s * (x * sn + y * c)]);
  }
  return poly(pts, true);
}

interface Seg { k: "l" | "a"; x0?: number; y0?: number; x1?: number; y1?: number; nx?: number; ny?: number; cx?: number; cy?: number; a0?: number; len: number }
export interface RRect { L: number; at(s: number): [number, number, number, number] }

/** Rounded-rect perimeter sampler: point + outward normal at arc length s. */
export function rrect(x: number, y: number, w: number, h: number, r: number): RRect {
  const segs: Seg[] = [];
  const line = (x0: number, y0: number, x1: number, y1: number, nx: number, ny: number) => segs.push({ k: "l", x0, y0, x1, y1, nx, ny, len: Math.hypot(x1 - x0, y1 - y0) });
  const arc = (cx: number, cy: number, a0: number) => segs.push({ k: "a", cx, cy, a0, len: Math.PI / 2 * r });
  line(x + r, y, x + w - r, y, 0, -1); arc(x + w - r, y + r, -Math.PI / 2);
  line(x + w, y + r, x + w, y + h - r, 1, 0); arc(x + w - r, y + h - r, 0);
  line(x + w - r, y + h, x + r, y + h, 0, 1); arc(x + r, y + h - r, Math.PI / 2);
  line(x, y + h - r, x, y + r, -1, 0); arc(x + r, y + r, Math.PI);
  const L = segs.reduce((a, s) => a + s.len, 0);
  return {
    L,
    at(s: number) {
      s = ((s % L) + L) % L;
      for (const g of segs) {
        if (s <= g.len) {
          if (g.k === "l") { const t = s / g.len; return [g.x0! + (g.x1! - g.x0!) * t, g.y0! + (g.y1! - g.y0!) * t, g.nx!, g.ny!]; }
          const a = g.a0! + s / r; return [g.cx! + r * Math.cos(a), g.cy! + r * Math.sin(a), Math.cos(a), Math.sin(a)];
        }
        s -= g.len;
      }
      return [x, y, 0, -1];
    },
  };
}

export function rope(R: RRect, { strands = 3, cycles = 140, amp = 5, steps = 1200 }: { strands?: number; cycles?: number; amp?: number; steps?: number }): string[] {
  const out: string[] = [];
  for (let k = 0; k < strands; k++) {
    const ph = k * TAU / strands, pts: Pt[] = [];
    for (let j = 0; j <= steps; j++) {
      const [px, py, nx, ny] = R.at(j / steps * R.L);
      const o = amp * Math.sin(TAU * cycles * j / steps + ph);
      pts.push([px + nx * o, py + ny * o]);
    }
    out.push(poly(pts, true));
  }
  return out;
}
