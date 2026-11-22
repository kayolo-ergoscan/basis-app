// Seals (VISUAL §8.3), ported verbatim from design/final/intaglio.js. Parameters are read from the key in a fixed
// order, so the same key always yields the same seal. Bump SEAL_ALGO when any output byte changes.
import { asBytes, blake2b256, concat } from "./bytes";
import { crown, lace, lathe, rosette, TAU, trochoid } from "./geometry";
import { inksFor, SEAL_PAPER, type InkLike } from "./inks";
import { rng } from "./rng";

export const SEAL_ALGO = "seal@1";

export interface SealParams {
  rope: { strands: number; cycles: number };
  lathe: { n: number; A: number; copies: number };
  lace: { n: number; A: number; mm: number; B: number; copies: number };
  crown: { k: number; copies: number; p: number };
  crown2: { k: number; copies: number; p: number };
  tro: readonly [number, number];
  rot: number;
  motif: "crown" | "star" | "rosette";
  star: { k: number; q: number; copies: number };
  ros: { n: number; spread: number };
}

export function sealParams(key: Uint8Array): SealParams {
  const R = rng(key);
  return {
    rope: { strands: R.pick([2, 3, 3, 4]), cycles: R.int(64, 96) },
    lathe: { n: R.int(16, 30), A: R.range(4.2, 6.4), copies: R.int(7, 11) },
    lace: { n: R.int(30, 56), A: R.range(1.6, 2.6), mm: R.int(5, 12), B: R.range(3.5, 6), copies: R.int(6, 10) },
    crown: { k: R.pick([10, 12, 14, 16, 18, 20, 24]), copies: R.int(8, 12), p: R.range(0.8, 1.8) },
    crown2: { k: R.pick([6, 8, 10, 12]), copies: R.int(5, 8), p: R.range(1.2, 2.4) },
    tro: R.pick([[7, 3], [8, 3], [9, 4], [10, 3], [11, 4], [12, 5], [13, 5], [11, 3], [9, 2], [13, 4]] as const),
    rot: R.range(0, TAU),
    // drawn last so older parameters keep their values
    motif: R.pick(["crown", "star", "rosette"] as const),
    star: { k: R.pick([7, 8, 9, 10, 11, 12]), q: R.range(1.5, 2.4), copies: R.int(8, 12) },
    ros: { n: R.int(15, 24), spread: R.range(0.52, 0.64) },
  };
}

export type SealKind = "pair" | "person" | "agent";
export interface SealOptions {
  inks?: { a: InkLike; b: InkLike };
  fg?: string;
  fg2?: string;
  /** 1 full, .6 mid, .35 mini (VISUAL §8.3: ≥160 px → 1, 60–160 → .6, ≤60 → .35). */
  detail?: number;
  kind?: SealKind;
  /** Rendered size in CSS px: strokes are tuned so a line is about half a device pixel. */
  px?: number;
  sw?: number;
  paperFill?: string;
  /** false = no paper disc (a seal printed on a note). */
  paper?: boolean;
  cls?: string;
}

/** Detail level for a rendered size (VISUAL §8.3). */
export const detailFor = (px: number): number => (px >= 160 ? 1 : px > 60 ? 0.6 : 0.35);

/** The seal SVG string. viewBox −100…100. kind 'pair' braids the rope; 'person' = circle; 'agent' = octagon. */
export function sealSVG(key: Uint8Array, o: SealOptions = {}): string {
  const P = sealParams(key), ink = o.inks || inksFor(key);
  const A = o.fg || ink.a.c, B = o.fg2 || ink.b.c;
  const d = o.detail || 1, kind = o.kind || "pair";
  const sides = kind === "agent" ? 8 : 0;
  // px = rendered size: strokes are tuned so a line is ~0.4–0.7 device px at any size
  const px = o.px || (d >= 1 ? 220 : d >= 0.6 ? 120 : 48);
  const sw = o.sw || Math.max(0.42, Math.min(2.6, 0.52 * 200 / px));
  const steps = d >= 1 ? 340 : d >= 0.6 ? 220 : 130;
  const k = d >= 1 ? 1 : d >= 0.6 ? 0.7 : 0.45; // share of engraved copies kept
  const cp = (n: number) => Math.max(2, Math.round(n * k));
  const paperFill = o.paperFill || SEAL_PAPER;
  const paper = o.paper === false ? "" : (sides
    ? `<path d="${lathe(0, 0, { R: 99, A: 0, n: 1, copies: 1, steps: 64, sides }).join("")}" fill="${paperFill}"/>`
    : `<circle r="99" fill="${paperFill}"/>`);
  const parts: string[] = [];
  const ropeCycles = d >= 1 ? P.rope.cycles : Math.round(P.rope.cycles * 0.55);
  const ropeSteps = ropeCycles * 7;
  if (sides) {
    parts.push(`<path d="${lathe(0, 0, { R: 93, A: 0, n: 1, copies: 1, steps: 64, sides }).join("")}" stroke="${A}" stroke-width="${sw * 1.5}" opacity=".9"/>`);
    parts.push(`<path d="${lathe(0, 0, { R: 86, A: 2.4, n: ropeCycles, copies: d >= 1 ? P.rope.strands : 2, steps: ropeSteps, sides }).join("")}" stroke="${A}" stroke-width="${sw}" opacity=".85"/>`);
  } else {
    parts.push(`<circle r="94" stroke="${A}" stroke-width="${sw * 1.5}" opacity=".9"/>`);
    if (kind === "pair") parts.push(`<circle r="97.5" stroke="${A}" stroke-width="${sw * .8}" opacity=".7"/>`);
    parts.push(`<path d="${lathe(0, 0, { R: 88, A: 2.4, n: ropeCycles, copies: kind === "pair" ? P.rope.strands : 2, steps: ropeSteps }).join("")}" stroke="${A}" stroke-width="${sw}" opacity=".85"/>`);
  }
  parts.push(`<path d="${lathe(0, 0, { R: 72, A: P.lathe.A, n: P.lathe.n, copies: cp(P.lathe.copies), steps, sides }).join("")}" stroke="${B}" stroke-width="${sw * 0.9}" opacity=".78"/>`);
  if (d >= 0.6) parts.push(`<path d="${lace(0, 0, { R: 58, A: P.lace.A, n: P.lace.n, B: P.lace.B, mm: P.lace.mm, copies: cp(P.lace.copies), steps: Math.round(steps * 1.2), sides }).join("")}" stroke="${A}" stroke-width="${sw}" opacity=".85"/>`);
  const mr = d >= 0.6 ? 50 : 60;
  let motif: string[];
  if (P.motif === "rosette") {
    const n = d >= 1 ? P.ros.n : d >= 0.6 ? Math.round(P.ros.n * 0.8) : Math.max(9, Math.round(P.ros.n * 0.6));
    const R0 = mr * P.ros.spread * 0.62;
    motif = rosette(0, 0, { n, R: R0, r: mr - R0, steps: d >= 0.6 ? 72 : 48 });
  } else if (P.motif === "star") {
    motif = crown(0, 0, { r0: 14, r1: mr, k: P.star.k, copies: cp(P.star.copies), steps, p: P.star.q, rot: P.rot, inv: true });
  } else {
    motif = crown(0, 0, { r0: 16, r1: mr, k: P.crown.k, copies: cp(P.crown.copies), steps, p: P.crown.p, rot: P.rot });
  }
  parts.push(`<path d="${motif.join("")}" stroke="${A}" stroke-width="${sw * 0.9}" opacity=".88"/>`);
  if (d >= 0.6) parts.push(`<path d="${crown(0, 0, { r0: 8, r1: 30, k: P.crown2.k, copies: cp(P.crown2.copies), steps: Math.round(steps * 0.8), p: P.crown2.p, rot: P.rot + Math.PI / P.crown2.k }).join("")}" stroke="${B}" stroke-width="${sw * 0.9}" opacity=".8"/>`);
  let heart = "";
  const hn = d >= 1 ? 5 : d >= 0.6 ? 3 : 2;
  for (let i = 0; i < hn; i++) heart += trochoid(0, 0, { Rr: P.tro[0], rr: P.tro[1], d: P.tro[1] * (0.55 + i * 0.1), rad: 19 - i * 1.6, rot: P.rot + i * 0.05, density: d >= 1 ? 0.8 : 0.5 });
  parts.push(`<path d="${heart}" stroke="${A}" stroke-width="${sw}" opacity=".95"/>`);
  parts.push(`<circle r="${d >= 0.6 ? 2.6 : 5}" fill="${A}"/>`);
  const cls = o.cls ? ` class="${o.cls}"` : "";
  return `<svg${cls} viewBox="-100 -100 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${paper}<g fill="none" stroke-linejoin="round" stroke-linecap="round">${parts.join("")}</g></svg>`;
}

/** blake2b256(pk): the seed of a key seal (VISUAL §8.2). pk is hex or bytes. */
export const keyHash = (pk: string | Uint8Array): Uint8Array => blake2b256(asBytes(pk));
/** blake2b256(issuer ‖ receiver [‖ tokenId]): the tracker's AVL key for a note, and the seed of its pair seal. */
export const pairKey = (pkA: string | Uint8Array, pkB: string | Uint8Array, tokenId?: string | Uint8Array): Uint8Array =>
  blake2b256(tokenId ? concat(asBytes(pkA), asBytes(pkB), asBytes(tokenId)) : concat(asBytes(pkA), asBytes(pkB)));

export interface KeySealOptions extends SealOptions { agent?: boolean }
/** A person (circle) or agent (octagon) seal from blake2b256(pk), at detail .35 by default. */
export const keySeal = (pk: string | Uint8Array, o: KeySealOptions = {}): string =>
  sealSVG(keyHash(pk), { kind: o.agent ? "agent" : "person", detail: o.detail || 0.35, ...o });
/** The face of a note: the pair seal of a debt key. */
export const pairSeal = (key: Uint8Array, o: SealOptions = {}): string => sealSVG(key, { kind: "pair", ...o });
