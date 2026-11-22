// Pure helpers for /play: the stage layout (VISUAL §9 encodings), timeline marks and segments, transaction and
// refusal rebuilds from the log, and the "try to cheat" attempts. Nothing here touches React or the live run's
// state: rebuilds and cheats work on copies (run.stateAt / eco.clone()).
import type { Lang } from "@/app/types";
import { getLang } from "@/app";
import {
  EMERGENCY_BLOCKS,
  findCycles,
  type CensorshipMode,
  type DebtEdge,
  type DenomId,
  type Economy,
  type EconomyEvent,
  type NoteStatus,
  type ParticipantKind,
  type ReserveEval,
  type ReserveSim,
  type SimTx,
  type StepResult,
} from "@/protocol";
import type { RunController } from "@/world";
import { blk, int, pct, plainNumber, units } from "@/ui";
import strings, { RU_NAMES } from "./strings";

// ------------------------------------------------------------------------------------------------
// names and amounts
// ------------------------------------------------------------------------------------------------

/** Display name of a participant id, a public key or a tracker id (RU names for the scenario casts). */
export function displayName(eco: Economy | null | undefined, x: string, lang: Lang): string {
  const p = eco?.participants.get(x) ?? eco?.byPub.get(x);
  const raw = p?.name ?? eco?.trackers.get(x)?.name ?? x;
  return lang === "ru" ? RU_NAMES[raw] ?? raw : raw;
}

export const namerFor = (eco: Economy | null | undefined, lang: Lang) => (x: string) => displayName(eco, x, lang);

/** Amount text: 2 dp, or up to 4 dp for sub-cent amounts (agent micro-payments). */
export function fmtAmt(v: bigint, decimals: number): string {
  const abs = v < 0n ? -v : v;
  const unit = 10n ** BigInt(decimals);
  let dp = Math.min(2, decimals);
  if (abs !== 0n && abs * 100n < unit && decimals > 2) dp = Math.min(4, decimals);
  return units(v, decimals, dp);
}

export interface DenomView {
  id: DenomId;
  symbol: string;
  decimals: number;
  notes: number;
}

/** Denominations of an economy with the number of notes in each (ERG first). */
export function denomViews(eco: Economy): DenomView[] {
  const count = new Map<DenomId, number>();
  for (const t of eco.trackers.values()) for (const rec of t.notes.values()) count.set(rec.denom, (count.get(rec.denom) ?? 0) + 1);
  return [...eco.denominations.values()].map((d) => ({ id: d.id, symbol: d.symbol, decimals: d.decimals, notes: count.get(d.id) ?? 0 }));
}

/** Units that are words rather than tickers: the village's hours read "32.50 h" / "32.50 ч", not "32.50 HOUR". */
const UNIT_WORDS: Record<string, [string, string]> = { HOUR: ["h", "ч"] };

export function denomInfoOf(eco: Economy, denom: DenomId): { symbol: string; decimals: number } {
  const d = eco.denominations.get(denom);
  const sym = d?.symbol ?? "ERG";
  const word = UNIT_WORDS[sym];
  return { symbol: word ? word[getLang() === "ru" ? 1 : 0] : sym, decimals: d?.decimals ?? 9 };
}

/** Parses "1.5" or "1,5" (spaces allowed) into base units; null when invalid or not positive. */
export function parseUnits(text: string, decimals: number): bigint | null {
  const s = plainNumber(text);
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  if (f.length > decimals) return null;
  const v = BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
  return v > 0n ? v : null;
}

// ------------------------------------------------------------------------------------------------
// stage model
// ------------------------------------------------------------------------------------------------

export type Side = "a" | "b" | "l" | "r";
export type TrackerBand = "none" | "ontime" | "late" | "silent" | "emergency";

export interface StageNode {
  id: string;
  name: string;
  kind: ParticipantKind;
  pub: string;
  agent: boolean;
  x: number;
  y: number;
  r: number;
  /** Angle on the ellipse (outward direction) and which half of the stage the node is on. */
  th: number;
  left: boolean;
  side: Side;
  /** Labels above or below the seal: centred, or aligned to the seal's outer edge near the stage's sides (phone). */
  align: "middle" | "start" | "end";
  reserve: bigint;
  reserveIds: string[];
  ratio: number | null;
  liabilities: bigint;
  net: bigint;
  online: boolean;
  /** Gold rim: coverage / 200 % (full when nothing is owed). */
  rim: number;
  refundPending: boolean;
  /** A dense swarm draws a name only where it has room; a bare seal shows its name on hover or selection. */
  bare: boolean;
  /** Widths (px) of the lines beside the seal, as drawn: name, net, reserve line (if any). */
  lw: number[];
}

export interface StageEdge {
  id: string;
  from: string;
  to: string;
  tracker: string;
  key: string;
  denom: DenomId;
  total: bigint;
  claim: bigint;
  redeemed: bigint;
  waived: bigint;
  limit: bigint | null;
  status: NoteStatus;
  omitted: boolean;
  /** Body = claim / cap of the tube. */
  frac: number;
  /** Part of the body backed by the debtor's reserve (metal), the rest is hatch. */
  backed: number;
  tw: number;
  bw: number;
  d: string;
  head: string;
  mx: number;
  my: number;
  near: boolean;
  /** The pill's words: what is owed, and "/ line" when there is a credit line (a small stage only when near). */
  pill: string;
  /** A small stage has no clean spot for this pill (or it would say 0.00): it shows only while its arrow is touched. */
  quiet: boolean;
  loop: boolean;
  /** Drawn as a tube (false: a hairline in a netted swarm). */
  major: boolean;
  count: number;
}

export interface StageTracker {
  id: string;
  name: string;
  x: number;
  y: number;
  online: boolean;
  censor: CensorshipMode;
  age: number | null;
  band: TrackerBand;
  notes: number;
  /** Drawing scale of the lighthouse (it takes the free band in the middle of the circle). */
  s: number;
  /** Lines under the name: "state · last commit" (one), state and last commit on two lines (two lighthouses side
   *  by side, or a laptop's narrow stage), or the state alone (phone). */
  lab: "one" | "two" | "state";
  /** Two lighthouses side by side on a phone: a long state goes on two short lines, clear of the seals beside it. */
  wrap: boolean;
  /** Width (px) of the widest line under the lighthouse, so pills and the loop mark keep off the words. */
  labW: number;
}

export interface StageLoop {
  members: string[];
  amount: bigint;
  x: number;
  y: number;
  /** Phone: the icon with the amount beside it (the sentence is the icon's title). */
  compact: boolean;
}

export interface StageModel {
  W: number;
  H: number;
  denom: DenomId;
  symbol: string;
  decimals: number;
  nodes: StageNode[];
  edges: StageEdge[];
  trackers: StageTracker[];
  loop: StageLoop | null;
  dense: boolean;
  netted: boolean;
  hidden: number;
  netSum: bigint;
  notes: number;
}

const DENSE_AT = 16;
const MAJOR_EDGES = 36;

export function trackerBandOf(age: number | null, emergencyOpen: boolean): TrackerBand {
  if (age === null) return "none";
  if (emergencyOpen) return "emergency";
  return age < 120 ? "ontime" : age < 720 ? "late" : "silent";
}

function sideOf(theta: number): Side {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  if (Math.abs(c) > 0.45) return c > 0 ? "r" : "l";
  return s < 0 ? "a" : "b";
}

/** The stage: nodes on an ellipse around the tracker lighthouse(s), edges as tubes bending away from the centre. */
/**
 * `keepOut`: boxes on the stage that hold the page's own words and keys (the cartouche at the top left, the zoom keys
 * at the top right), measured by the page; no seal or name goes under them. Default: their usual size.
 */
export function buildStage(eco: Economy, denom: DenomId, W: number, H: number, lang: Lang, keepOut?: Box4[]): StageModel {
  const height = eco.clock.height;
  const { symbol, decimals } = denomInfoOf(eco, denom);

  // raw notes of this denomination
  type Raw = { id: string; from: string; to: string; tracker: string; key: string; total: bigint; claim: bigint; redeemed: bigint; waived: bigint; status: NoteStatus; omitted: boolean; limit: bigint | null };
  const raw: Raw[] = [];
  let notes = 0;
  for (const t of eco.trackers.values()) {
    for (const rec of t.notes.values()) {
      if (rec.denom !== denom || rec.issuer === rec.receiver) continue;
      const from = eco.idOf(rec.issuer);
      const to = eco.idOf(rec.receiver);
      if (!from || !to) continue;
      notes++;
      const out = rec.totalDebt > rec.amountRedeemed ? rec.totalDebt - rec.amountRedeemed : 0n;
      const claim = out > rec.waived ? out - rec.waived : 0n;
      raw.push({ id: `${t.id}:${rec.key}`, from, to, tracker: t.id, key: rec.key, total: rec.totalDebt, claim, redeemed: rec.amountRedeemed, waived: rec.waived, status: t.status(rec, height), omitted: rec.omitted, limit: eco.creditLine(to, from, denom) });
    }
  }

  const inEdges = new Set<string>();
  for (const r of raw) {
    inEdges.add(r.from);
    inEdges.add(r.to);
  }
  const people = [...eco.participants.values()].filter((p) => p.kind !== "tracker-operator" || inEdges.has(p.id));
  const dense = people.length > DENSE_AT;
  const n = people.length;
  const narrow = W < 600;
  // a phone or a laptop: pills say less, and step aside for names and seals
  const small = W < 900;
  const keep = keepOut ?? stageKeepOut(W);

  // net positions
  const net = new Map<string, bigint>();
  for (const r of raw) {
    net.set(r.to, (net.get(r.to) ?? 0n) + r.claim);
    net.set(r.from, (net.get(r.from) ?? 0n) - r.claim);
  }
  // the lines beside each seal, measured as drawn (name 13.5 px bold: 7.8 a glyph; net 12 px mono: 7.2; reserve 11 px mono: 6.7)
  const words = strings[lang] ?? strings.en;
  const lws = people.map((p) => {
    const nv = net.get(p.id) ?? 0n;
    const out = [displayName(eco, p.id, lang).length * 7.8, (fmtAmt(nv < 0n ? -nv : nv, decimals).replace(/\u2060/g, "").length + (nv === 0n ? 0 : 1)) * 7.2];
    if (eco.reservesOf(p.id, denom).some((r) => r.active)) {
      const ratio = eco.coverage(p.id, denom).ratio;
      const txt = ratio === null ? (words["play.stage.noLiab"] ?? "") : (words["play.stage.reserve"] ?? "").replace("{pct}", coverPct(ratio));
      out.push(txt.replace(/\u2060/g, "").length * 6.7);
    }
    return out;
  });
  const theta0 = n === 2 ? Math.PI : n % 2 === 0 ? -Math.PI / 2 - Math.PI / n : -Math.PI / 2;
  let cx = W / 2;
  let cy = H / 2 + (dense ? 0 : 6);
  const padX = dense ? (narrow ? 34 : 70) : Math.min(200, Math.max(120, W * 0.15));
  const padY = dense ? (narrow ? 50 : 64) : Math.min(110, Math.max(84, H * 0.14));
  let rx = Math.max(80, W / 2 - padX);
  let ry = Math.max(70, H / 2 - padY);
  // where the lighthouse stands, relative to the centre of the ellipse
  let lhDy = 0;
  if (narrow && !dense && n >= 2) {
    // phone: fit the polygon's own extent between margins that leave room for the labels (three lines above the
    // top seals, two or three below the bottom ones) and stand the lighthouse in the middle of the polygon
    const ths = Array.from({ length: n }, (_, i) => theta0 + (2 * Math.PI * i) / n);
    const sins = ths.map(Math.sin);
    const coss = ths.map(Math.cos);
    const s0 = Math.min(...sins);
    const s1 = Math.max(...sins);
    const c0 = Math.min(...coss);
    const c1 = Math.max(...coss);
    const top = 80;
    const bottom = 80;
    const side = 52;
    rx = Math.max(60, (W - 2 * side) / Math.max(1, c1 - c0));
    cx = side - rx * c0;
    if (s1 - s0 > 0.5) {
      ry = Math.max(50, (H - top - bottom) / (s1 - s0));
      cy = top - ry * s0;
      lhDy = (ry * (s0 + s1)) / 2;
    } else {
      // two people side by side: the lighthouse stands above the line between them
      cy = H / 2 + 40;
      ry = 0;
      lhDy = -Math.min(110, H / 2 - 40);
    }
  }

  // a wide stage with a few people: the circle as wide as the names beside the seals allow (none runs off the stage),
  // then moved down into the free room under it and flattened (keeping its bottom) until no seal or name sits under
  // the cartouche or the zoom keys
  if (!narrow && !dense && n >= 2) {
    const ths = people.map((_, i) => theta0 + (2 * Math.PI * i) / n);
    const linked = new Set(raw.map((r) => `${r.from}>${r.to}`));
    const rOf = (i: number) => (people[i].kind === "agent" ? 24 : 30);
    people.forEach((_, i) => {
      const c = Math.abs(Math.cos(ths[i]));
      if (c < 0.05) return;
      const side = sideOf(ths[i]);
      const w = Math.max(...lws[i]);
      const need = side === "l" || side === "r" ? rOf(i) + 14 + w + 10 : Math.max(rOf(i) + 8, w / 2 + 8);
      rx = Math.min(rx, (W / 2 - need) / c);
    });
    rx = Math.max(80, rx);
    for (let k = 0; k < 40; k++) {
      const boxes = people.flatMap((_, i) => boxesOf({ x: cx + Math.cos(ths[i]) * rx, y: cy + Math.sin(ths[i]) * ry, r: rOf(i), th: ths[i], side: sideOf(ths[i]), align: "middle", lw: lws[i] }, false));
      if (!boxes.some((b) => overlapSum(b, keep) > 0)) break;
      // the lowest thing: a seal or its words, or a tube between two neighbours bending outwards below them (as the
      // tubes are drawn below: a quarter of the bend at the middle, more for a pair near the centre or both ways)
      let low = Math.max(...boxes.map((b) => b[3]));
      for (let i = 0; i < (n === 2 ? 1 : n); i++) {
        const j = (i + 1) % n;
        const ab = linked.has(`${people[i].id}>${people[j].id}`);
        const ba = linked.has(`${people[j].id}>${people[i].id}`);
        if (!ab && !ba) continue;
        const [xi, yi, xj, yj] = [cx + Math.cos(ths[i]) * rx, cy + Math.sin(ths[i]) * ry, cx + Math.cos(ths[j]) * rx, cy + Math.sin(ths[j]) * ry];
        const L = Math.hypot(xj - xi, yj - yi) || 1;
        const [mx, my] = [(xi + xj) / 2, (yi + yj) / 2];
        const bend = L * (Math.hypot(mx - cx, my - cy) < L * 0.22 ? 0.3 : 0.16) + (ab && ba ? L * 0.09 : 0);
        let ny = (xj - xi) / L;
        if (-(yj - yi) / L * (mx - cx) + ny * (my - cy) < 0) ny = -ny;
        if (ny > 0) low = Math.max(low, my + (ny * bend) / 2 + 24);
      }
      const room = H - 6 - low;
      if (room > 1) cy += Math.min(room, 10);
      else if (ry > 60) {
        const bottom = cy + ry;
        ry = Math.max(60, ry * 0.94);
        cy = bottom - ry;
      } else break;
    }
  }

  // a dense swarm sits on a ring of evenly spaced seals (equal arc length, so the ends of a flat ring do not bunch up).
  // A wide stage keeps room at the sides for the names that go outwards; the ring is lowered (keeping its bottom)
  // until no seal sits under the cartouche (top left) or the zoom keys (top right).
  let ring: Array<{ x: number; y: number; th: number }> | null = null;
  if (dense) {
    if (!narrow) {
      const longest = Math.min(150, Math.max(0, ...people.map((p) => displayName(eco, p.id, lang).length)) * 7.8);
      rx = Math.max(80, W / 2 - (W >= 1000 ? 15 + 6 + 14 + longest + 10 : 40));
      ry = Math.max(70, H / 2 - 52);
      for (let k = 0; k < 24; k++) {
        const pts = ringPoints(n, cx, cy, rx, ry, theta0);
        if (!pts.some((q) => overlapSum([q.x - 22, q.y - 22, q.x + 22, q.y + 22], keep) > 0)) break;
        const bottom = cy + ry;
        ry = Math.max(60, ry * 0.94);
        cy = bottom - ry;
      }
    }
    ring = ringPoints(n, cx, cy, rx, ry, theta0);
  }

  const nodes: StageNode[] = people.map((p, i) => {
    const th = ring ? ring[i].th : n === 1 ? Math.PI : theta0 + (2 * Math.PI * i) / n;
    const reserves = eco.reservesOf(p.id, denom).filter((r) => r.active);
    const reserve = reserves.reduce((s, r) => s + r.collateral(), 0n);
    const cov = eco.coverage(p.id, denom);
    const agent = p.kind === "agent";
    const r = dense ? (narrow ? 12 : 15) : narrow ? (agent ? 18 : 22) : agent ? 24 : 30;
    const rim = reserves.length === 0 ? 0 : cov.ratio === null ? 1 : Math.max(0.02, Math.min(1, cov.ratio / 2));
    return {
      id: p.id,
      name: displayName(eco, p.id, lang),
      kind: p.kind,
      pub: p.pub,
      agent,
      x: ring ? ring[i].x : cx + Math.cos(th) * rx * (n === 1 ? 0.6 : 1),
      y: ring ? ring[i].y : cy + Math.sin(th) * ry * (n === 1 ? 0 : 1),
      r,
      th,
      left: Math.cos(th) < -0.01,
      align: !narrow ? "middle" : cx + Math.cos(th) * rx < W * 0.3 ? "start" : cx + Math.cos(th) * rx > W * 0.7 ? "end" : "middle",
      side: narrow ? (Math.sin(th) < 0 ? "a" : "b") : sideOf(th),
      reserve,
      reserveIds: reserves.map((x) => x.id),
      ratio: cov.ratio,
      liabilities: cov.liabilities,
      net: net.get(p.id) ?? 0n,
      online: p.online,
      rim,
      refundPending: reserves.some((x) => x.refundPending()),
      bare: false,
      lw: lws[i],
    };
  });
  const at = new Map(nodes.map((nd) => [nd.id, nd]));
  if (dense) placeNames(nodes, narrow ? [] : keep, W, H);

  // trackers: one lighthouse in the centre, two side by side; the words under each, measured as the stage draws
  // them (name 7.8 px a glyph, mono lines 6.7). Where they stand comes next, once the lighthouse's size is known.
  const tl = [...eco.trackers.values()];
  let labLines = 1;
  const trackers: StageTracker[] = tl.map((t, i) => {
    const box = t.currentBox();
    const age = box ? height - box.creationHeight : null;
    const off = tl.length === 1 ? 0 : (i - (tl.length - 1) / 2) * (narrow ? Math.min(W * 0.3, 130) : Math.min(W * 0.2, 230));
    const tr: StageTracker = { id: t.id, name: displayName(eco, t.id, lang), x: cx + off, y: cy, online: t.online, censor: t.censorship.mode, age, band: trackerBandOf(age, t.emergencyOpen(height)), notes: t.notes.size, s: 1, lab: narrow ? "state" : tl.length > 1 || (small && !dense) ? "two" : "one", wrap: narrow && tl.length > 1, labW: 0 };
    const state = words[`play.tracker.${trackerStateOf(tr)}`] ?? "";
    const ago = age === null ? (words["play.tracker.never"] ?? "") : (words["play.tracker.ago"] ?? "").replace("{n}", blk(age, lang));
    const split = tr.wrap && state.length > 16 ? splitMid(state) : null;
    const lines = tr.lab === "one" ? [`${state} · ${ago}`] : tr.lab === "two" ? [state, ago] : split ?? [state];
    tr.labW = Math.max(tr.name.length * 7.8, ...lines.map((l) => l.replace(/\u2060/g, "").length * 6.7));
    labLines = Math.max(labLines, lines.length);
    return tr;
  });
  // two lighthouses side by side on a wide stage: never closer than their words need
  if (!narrow && trackers.length > 1) {
    const gap = Math.max(Math.min(W * 0.2, 230), ...trackers.slice(1).map((tr, i) => (trackers[i].labW + tr.labW) / 2 + 18));
    trackers.forEach((tr, i) => (tr.x = cx + (i - (trackers.length - 1) / 2) * gap));
  }

  // the lighthouse: as large as the free band in the middle of the polygon allows (between the top seal, or the top
  // chord, and the bottom chord), centred in it. The figure spans [-51 s, 46 s + 32] around its anchor.
  let lhScale = dense ? 1 : narrow ? 0.72 : 1.3;
  if (dense && !narrow) {
    // a flat ring (a short stage): the lighthouse and its two lines stand inside it, off the seals
    const topY = cy - ry + 28;
    const botY = cy + ry - 28;
    const plateH = labLines > 1 ? 52 : 38;
    lhScale = Math.max(0.5, Math.min(1, (botY - topY - plateH - 2) / 97));
    lhDy = (topY + botY) / 2 - (plateH - 5 * lhScale) / 2 - cy;
  }
  if (!dense && n >= 3) {
    const half = Math.cos(Math.PI / n);
    const topY = n % 2 === 1 ? cy - ry + (narrow ? 22 : 30) + 18 : cy - ry * half + 14;
    let botY = cy + ry * half - 14;
    const labH = labLines > 1 ? 47 : 32;
    // the lighthouse's words wider than the gap between the lower seals (or level with a name beside them, which
    // would read as one line with it): the lighthouse stands higher, its words above those seals and names
    const pad = narrow ? 14 : 4;
    people.forEach((p, i) => {
      const th = theta0 + (2 * Math.PI * i) / n;
      if (Math.sin(th) < -0.2) return;
      const x = cx + Math.cos(th) * rx;
      const y = cy + Math.sin(th) * ry;
      const agent = p.kind === "agent";
      const r = narrow ? (agent ? 18 : 22) : agent ? 24 : 30;
      const side: Side = narrow ? (Math.sin(th) < 0 ? "a" : "b") : sideOf(th);
      const align = !narrow ? "middle" : x < W * 0.3 ? "start" : x > W * 0.7 ? "end" : "middle";
      for (const b of boxesOf({ x, y, r, th, side, align, lw: lws[i] }, false)) {
        if (b[1] < (topY + botY) / 2) continue;
        for (const tr of trackers) {
          if (overlapSum([tr.x - tr.labW / 2 - pad, botY - labH + 2, tr.x + tr.labW / 2 + pad, botY], [b]) > 0) botY = Math.min(botY, b[1] - 4);
        }
      }
    });
    lhScale = Math.max(0.6, Math.min(narrow ? 0.8 : 1.3, (botY - topY - labH - 2) / 97));
    lhDy = (topY + botY) / 2 - (labH - 5 * lhScale) / 2 - cy;
  }
  for (const tr of trackers) {
    tr.y = cy + lhDy;
    tr.s = lhScale;
  }

  // a phone: a name level with the lighthouse's words reads as one line with them ("Village ledger Carpenter Ana"),
  // so a seal at the side puts its words on its other side when that side is free
  if (narrow && !dense) {
    const lab = trackerBoxes(trackers)
      .filter((_, k) => k % 2 === 1)
      .map(([a, b, c, d]): Box4 => [a - 14, b - 4, c + 14, d + 4]);
    for (const nd of nodes) {
      if (Math.abs(Math.sin(nd.th)) > 0.35) continue;
      const wordsAt = (side: Side) => boxesOf({ ...nd, side }, false).slice(1);
      const hits = (bs: Box4[], list: Box4[]) => bs.reduce((sum, b) => sum + overlapSum(b, list), 0);
      if (hits(wordsAt(nd.side), lab) === 0) continue;
      const other: Side = nd.side === "a" ? "b" : "a";
      const there = wordsAt(other);
      const rest = nodeBoxes(
        nodes.filter((o) => o !== nd),
        false,
      );
      if (there.every((b) => b[0] >= 4 && b[1] >= 4 && b[2] <= W - 4 && b[3] <= H - 4) && hits(there, lab) === 0 && hits(there, rest) === 0) nd.side = other;
    }
  }

  // per-tracker coverage of a debtor (for the metal share of a body)
  const covCache = new Map<string, number>();
  const backedOf = (from: string, tracker: string) => {
    const k = `${from}|${tracker}`;
    let v = covCache.get(k);
    if (v === undefined) {
      const c = eco.coverage(from, denom, tracker);
      v = c.reserves === 0 ? 0 : c.ratio === null ? 1 : Math.max(0, Math.min(1, c.ratio));
      covCache.set(k, v);
    }
    return v;
  };

  // edges: one per note, or netted per pair in a dense swarm
  type Item = Raw & { count: number };
  let items: Item[];
  let hidden = 0;
  if (dense) {
    const pair = new Map<string, { ab: bigint; ba: bigint; tAb: bigint; tBa: bigint; a: string; b: string; tracker: string; count: number; key: string; status: NoteStatus }>();
    for (const r of raw) {
      const [a, b] = r.from < r.to ? [r.from, r.to] : [r.to, r.from];
      const k = `${a}|${b}`;
      const e = pair.get(k) ?? { ab: 0n, ba: 0n, tAb: 0n, tBa: 0n, a, b, tracker: r.tracker, count: 0, key: r.key, status: r.status };
      if (r.from === a) {
        e.ab += r.claim;
        e.tAb += r.total;
      } else {
        e.ba += r.claim;
        e.tBa += r.total;
      }
      e.count++;
      pair.set(k, e);
    }
    items = [];
    for (const e of pair.values()) {
      const netAb = e.ab - e.ba;
      if (netAb === 0n) continue;
      const fwd = netAb > 0n;
      const claim = fwd ? netAb : -netAb;
      items.push({ id: `net:${e.a}|${e.b}`, from: fwd ? e.a : e.b, to: fwd ? e.b : e.a, tracker: e.tracker, key: e.key, total: claim, claim, redeemed: 0n, waived: 0n, status: e.status, omitted: false, limit: null, count: e.count });
    }
    items.sort((x, y) => (y.claim > x.claim ? 1 : y.claim < x.claim ? -1 : 0));
    hidden = Math.max(0, items.length - MAJOR_EDGES);
  } else {
    items = raw.map((r) => ({ ...r, count: 1 }));
  }

  const capOf = (it: Item) => (it.limit && it.limit > 0n ? it.limit : it.total > it.claim ? it.total : it.claim);
  const maxCap = items.reduce((m, it) => {
    const c = capOf(it);
    return c > m ? c : m;
  }, 0n);
  const pairs = new Set(items.map((it) => `${it.from}>${it.to}`));

  // the clearable loop with the most debt in it
  let loop: StageLoop | null = null;
  const loopEdges = new Set<string>();
  if (!dense && items.length > 2 && items.length <= 80) {
    const de: DebtEdge[] = items.filter((it) => it.claim > 0n).map((it) => ({ from: it.from, to: it.to, amount: it.claim }));
    try {
      const cycles = findCycles(de, 6, 24);
      let best = null as (typeof cycles)[number] | null;
      for (const c of cycles) if (c.amount > 0n && (!best || c.amount * BigInt(c.members.length) > best.amount * BigInt(best.members.length))) best = c;
      if (best) {
        let sx = 0;
        let sy = 0;
        for (const m of best.members) {
          const nd = at.get(m);
          if (nd) {
            sx += nd.x;
            sy += nd.y;
          }
        }
        const k = best.members.length;
        // placed after the edges are laid out (it must stay clear of seals, labels, pills and the lighthouse)
        loop = { members: best.members, amount: best.amount, x: cx + (sx / k - cx) * 0.55, y: cy + (sy / k - cy) * 0.55, compact: narrow };
        best.members.forEach((m, i) => loopEdges.add(`${m}>${best!.members[(i + 1) % k]}`));
      }
    } catch {
      loop = null;
    }
  }

  const edges: StageEdge[] = [];
  // every pill is shown on a small circle: slide each one along its arrow until it is off seals, names and other pills
  const pillAvoid: Box4[] | null = !dense && items.length <= 24 ? [...nodeBoxes(nodes, dense), ...trackerBoxes(trackers)] : null;
  items.forEach((it, idx) => {
    const P = at.get(it.from);
    const Q = at.get(it.to);
    if (!P || !Q) return;
    const major = !dense || idx < MAJOR_EDGES;
    const dx = Q.x - P.x;
    const dy = Q.y - P.y;
    const L = Math.hypot(dx, dy) || 1;
    const mx0 = (P.x + Q.x) / 2;
    const my0 = (P.y + Q.y) / 2;
    let nx = -dy / L;
    let ny = dx / L;
    const ox = mx0 - cx;
    const oy = my0 - cy;
    if (nx * ox + ny * oy < 0) {
      nx = -nx;
      ny = -ny;
    }
    const nearCentre = Math.hypot(ox, oy) < L * 0.22;
    const bidir = pairs.has(`${it.to}>${it.from}`);
    const base = dense ? 0.1 : nearCentre ? 0.3 : 0.16;
    const k = L * base + (bidir ? (it.from < it.to ? 1 : -1) * L * 0.09 : 0);
    const Cx = mx0 + nx * k;
    const Cy = my0 + ny * k;
    const u = (ax: number, ay: number) => {
      const l = Math.hypot(ax, ay) || 1;
      return [ax / l, ay / l] as const;
    };
    const [usx, usy] = u(Cx - P.x, Cy - P.y);
    const Sx = P.x + usx * (P.r + 5);
    const Sy = P.y + usy * (P.r + 5);
    const [uex, uey] = u(Cx - Q.x, Cy - Q.y);
    const Ex = Q.x + uex * (Q.r + 6);
    const Ey = Q.y + uey * (Q.r + 6);
    const [hx, hy] = u(Ex - Cx, Ey - Cy);
    const hl = dense ? 7 : 12;
    const hw = dense ? 4 : 6.5;
    const Bx = Ex - hx * hl;
    const By = Ey - hy * hl;
    const Lx = Ex - hx * (hl - 3);
    const Ly = Ey - hy * (hl - 3);
    const cap = capOf(it);
    const ratio = maxCap > 0n ? Number((cap * 10000n) / maxCap) / 10000 : 0;
    const tw = dense ? 2 + 8 * Math.sqrt(ratio) : 6 + 16 * Math.sqrt(ratio);
    const frac = cap > 0n ? Math.min(1, Number((it.claim * 10000n) / cap) / 10000) : 0;
    const f2 = (v: number) => v.toFixed(1);
    let mx = 0.25 * Sx + 0.5 * Cx + 0.25 * Lx;
    let my = 0.25 * Sy + 0.5 * Cy + 0.25 * Ly;
    // the pill: what is owed, and the credit line beside it (on a small stage only when the debt is near the line)
    const near = !!it.limit && it.limit > 0n && it.claim * 5n >= it.limit * 4n;
    const pill = it.limit && (!small || near) ? `${fmtAmt(it.claim, decimals)} / ${fmtAmt(it.limit, decimals)}` : fmtAmt(it.claim, decimals);
    // A small stage does not draw "0.00" pills, nor a pill that would sit on a name, a seal or another pill: those
    // wait for a touch (or a hover) on the arrow and take no room from the others. A pill may also move a little off
    // the tube's centre line.
    let quiet = small && it.claim === 0n;
    if (pillAvoid && !quiet) {
      const pw = pill.replace(/\u2060/g, "").length * 7.3 + 34;
      let bc = Infinity;
      let bo = 0;
      for (const off of PILL_OFFS) {
        for (const tt of PILL_TS) {
          const a = 1 - tt;
          const x = a * a * Sx + 2 * a * tt * Cx + tt * tt * Lx + nx * off;
          const y = a * a * Sy + 2 * a * tt * Cy + tt * tt * Ly + ny * off;
          const ov = overlapSum([x - pw / 2, y - 12, x + pw / 2, y + 12], pillAvoid) + outside(x, y, pw, W, H);
          const c = ov + Math.abs(tt - 0.5) * 60 + Math.abs(off) * 1.5;
          if (c < bc) {
            bc = c;
            bo = ov;
            mx = x;
            my = y;
          }
        }
        if (bo === 0 && bc < Infinity) break;
      }
      if (small && bo > PILL_SLACK) quiet = true;
      else pillAvoid.push([mx - pw / 2 - 4, my - 14, mx + pw / 2 + 4, my + 14]);
    }
    edges.push({
      id: it.id,
      from: it.from,
      to: it.to,
      tracker: it.tracker,
      key: it.key,
      denom,
      total: it.total,
      claim: it.claim,
      redeemed: it.redeemed,
      waived: it.waived,
      limit: it.limit,
      status: it.status,
      omitted: it.omitted,
      frac,
      backed: backedOf(it.from, it.tracker),
      tw,
      bw: Math.max(2, tw - (dense ? 1.5 : 4)),
      d: `M${f2(Sx)} ${f2(Sy)}Q${f2(Cx)} ${f2(Cy)} ${f2(Lx)} ${f2(Ly)}`,
      head: `M${f2(Ex)} ${f2(Ey)}L${f2(Bx + -hy * hw)} ${f2(By + hx * hw)}L${f2(Bx - -hy * hw)} ${f2(By - hx * hw)}Z`,
      mx,
      my,
      near,
      pill,
      quiet,
      loop: loopEdges.has(`${it.from}>${it.to}`),
      major,
      count: it.count,
    });
  });

  if (loop) {
    const at0 = placeLoopMark(loop, { W, H, narrow, lang, symbol, decimals, nodes, trackers, edges });
    loop = { ...loop, x: at0[0], y: at0[1] };
  }

  const netSum = nodes.reduce((s, nd) => s + nd.net, 0n);
  return { W, H, denom, symbol, decimals, nodes, edges, trackers, loop, dense, netted: dense, hidden, netSum, notes };
}

export type Box4 = [number, number, number, number];
const PILL_TS = [0.5, 0.42, 0.58, 0.34, 0.66, 0.27, 0.73];
/** A pill may also move this far off the tube's centre line (px, along the arrow's outer normal). */
const PILL_OFFS = [0, 13, -13];
/** Overlap (px²) a small stage forgives before it keeps a pill for a touch: every box has a few px of air around what it
 *  holds, so a pill edge inside that air (about 4 px of its height) touches nothing that can be seen. */
const PILL_SLACK = 100;
/** How much of a pill box (px²) falls outside the stage, as a cost. */
function outside(x: number, y: number, pw: number, W: number, H: number): number {
  const w = pw / 2;
  const cut = Math.max(0, 4 - (x - w)) + Math.max(0, x + w - (W - 4));
  const cutY = Math.max(0, 4 - (y - 12)) + Math.max(0, y + 12 - (H - 4));
  return cut * 24 + cutY * pw;
}

/** Total area of `a` covered by the boxes. */
function overlapSum(a: Box4, list: Box4[]): number {
  let c = 0;
  for (const b of list) {
    const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (w > 0 && h > 0) c += w * h;
  }
  return c;
}

/** n points on an ellipse at equal arc length, starting at the parameter angle th0; th is each point's parameter. */
function ringPoints(n: number, cx: number, cy: number, rx: number, ry: number, th0: number): Array<{ x: number; y: number; th: number }> {
  const K = 720;
  const cum = new Float64Array(K + 1);
  let px = cx + Math.cos(th0) * rx;
  let py = cy + Math.sin(th0) * ry;
  for (let k = 1; k <= K; k++) {
    const a = th0 + (2 * Math.PI * k) / K;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    cum[k] = cum[k - 1] + Math.hypot(x - px, y - py);
    px = x;
    py = y;
  }
  const total = cum[K] || 1;
  const out: Array<{ x: number; y: number; th: number }> = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const want = (total * i) / n;
    while (k < K && cum[k + 1] < want) k++;
    const span = cum[k + 1] - cum[k] || 1;
    const th = th0 + ((2 * Math.PI) / K) * (k + (want - cum[k]) / span);
    out.push({ x: cx + Math.cos(th) * rx, y: cy + Math.sin(th) * ry, th });
  }
  return out;
}

/** What sits over the wide stage: the cartouche (top left) and the zoom keys (top right). */
function stageKeepOut(W: number): Box4[] {
  return [
    [0, 0, 400, 128],
    [W - 66, 0, W, 196],
  ];
}

/** The box of a node's one-line name, as NodeShape draws it for its side (13.5 px semibold, about 7.8 px a glyph). */
function nameBox(n: StageNode): Box4 {
  const w = n.name.length * 7.8;
  const R = n.r;
  if (n.side === "l") return [n.x - R - 14 - w - 3, n.y - 11, n.x - R - 11, n.y + 8];
  if (n.side === "r") return [n.x + R + 11, n.y - 11, n.x + R + 14 + w + 3, n.y + 8];
  const x0 = n.align === "start" ? n.x - (R - 2) : n.align === "end" ? n.x + (R - 2) - w : n.x - w / 2;
  const base = n.side === "b" ? n.y + R + 22 : n.y - (R + 14);
  return [x0 - 3, base - 12, x0 + w + 3, base + 4];
}

/** Dense swarm: names in order of the biggest net positions, each only where it is off every seal, the stage's
 *  furniture and the names already placed. The rest stay bare until hovered or selected. */
function placeNames(nodes: StageNode[], keepOut: Box4[], W: number, H: number): void {
  const taken: Box4[] = [...keepOut];
  for (const nd of nodes) taken.push([nd.x - nd.r - 6, nd.y - nd.r - 6, nd.x + nd.r + 6, nd.y + nd.r + 6]);
  const size = (v: bigint) => (v < 0n ? -v : v);
  const order = [...nodes].sort((a, b) => (size(b.net) > size(a.net) ? 1 : size(b.net) < size(a.net) ? -1 : 0));
  for (const nd of order) {
    const box = nameBox(nd);
    const inside = box[0] >= 4 && box[1] >= 4 && box[2] <= W - 4 && box[3] <= H - 4;
    if (!inside || overlapSum(box, taken) > 0) nd.bare = true;
    else taken.push(box);
  }
}

/** Seals and their label lines, as StageGraph's NodeShape draws them (15 px a line, anchored by side and align). */
function nodeBoxes(nodes: StageNode[], dense: boolean): Box4[] {
  return nodes.flatMap((n) => boxesOf(n, dense));
}

/**
 * How far the words above (or below) a seal move away from its reserve coin, when the coin sits on that side of the
 * seal (it sits beside the seal, a quarter turn from the arrows: on a phone's upper seals that is above them).
 */
export function labelShift(r: number, th: number, side: Side, coin: boolean): number {
  if (!coin || (side !== "a" && side !== "b")) return 0;
  const a = th + (Math.cos(th) < -0.01 ? Math.PI / 2 : -Math.PI / 2);
  const y = Math.sin(a) * (r + 7);
  return side === "a" ? Math.min(0, y - 9.5 - 5 + (r + 14)) : Math.max(0, y + 9.5 + 4 - (r + 11));
}

/** A seal and the lines beside it (a dense swarm shows the name only), as boxes. */
function boxesOf(n: Pick<StageNode, "x" | "y" | "r" | "th" | "side" | "align" | "lw">, dense: boolean): Box4[] {
  const p = n.r + 6;
  const out: Box4[] = [[n.x - p, n.y - p, n.x + p, n.y + p]];
  const widths = dense ? n.lw.slice(0, 1) : n.lw;
  const k = widths.length;
  const shift = dense ? 0 : labelShift(n.r, n.th, n.side, n.lw.length > 2);
  widths.forEach((w, i) => {
    let base: number;
    let x0: number;
    if (n.side === "a" || n.side === "b") {
      base = (n.side === "b" ? n.y + n.r + 22 + 15 * i : n.y - (n.r + 14) - 15 * (k - 1) + 15 * i) + shift;
      x0 = n.align === "start" ? n.x - (n.r - 2) : n.align === "end" ? n.x + (n.r - 2) - w : n.x - w / 2;
    } else {
      base = n.y - ((k - 1) * 15) / 2 + 4 + 15 * i;
      x0 = n.side === "l" ? n.x - (n.r + 14) - w : n.x + n.r + 14;
    }
    out.push([x0 - 3, base - 12, x0 + w + 3, base + 4]);
  });
  return out;
}

/** The lighthouse figure and its two label lines. */
/** A seal's coverage as the stage prints it: "400 %", and "> 999 %" for a tiny debt against a big reserve. */
export function coverPct(ratio: number): string {
  const v = Math.round(ratio * 100);
  return v > 999 ? `> ${pct(999)}` : pct(v);
}

/** What the lighthouse says about its tracker: the key under play.tracker.* */
export function trackerStateOf(tr: Pick<StageTracker, "online" | "censor" | "band">): string {
  return !tr.online ? "offline" : tr.censor !== "off" ? tr.censor : tr.band === "none" ? "ontime" : tr.band;
}

/** A label cut in two at the space nearest its middle (the first of two equal ones, so "в" stays with its word). */
export function splitMid(s: string): [string, string] | null {
  const mid = s.length / 2;
  let at = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === " " && (at < 0 || Math.abs(i - mid) < Math.abs(at - mid))) at = i;
  return at < 0 ? null : [s.slice(0, at), s.slice(at + 1)];
}

function trackerBoxes(trackers: StageTracker[]): Box4[] {
  const out: Box4[] = [];
  for (const tr of trackers) {
    const half = tr.labW / 2 + 6;
    // the figure: roof at −51 s, base ellipse 34 s wide each way down to 44 s (a little air around it)
    out.push([tr.x - 38 * tr.s, tr.y - 56 * tr.s, tr.x + 38 * tr.s, tr.y + 46 * tr.s]);
    out.push([tr.x - half, tr.y + 46 * tr.s + 2, tr.x + half, tr.y + 46 * tr.s + (tr.lab === "two" || tr.wrap ? 54 : 38)]);
  }
  return out;
}

/** The "loop · could clear" mark: the free spot nearest the loop's centre, off every seal, name, pill and lighthouse. */
function placeLoopMark(
  loop: StageLoop,
  o: { W: number; H: number; narrow: boolean; lang: Lang; symbol: string; decimals: number; nodes: StageNode[]; trackers: StageTracker[]; edges: StageEdge[] },
): [number, number] {
  const { W, H } = o;
  const v = `${fmtAmt(loop.amount, o.decimals)} ${o.symbol}`;
  const obs: Box4[] = [...nodeBoxes(o.nodes, false), ...trackerBoxes(o.trackers)];
  for (const e of o.edges) if (e.major && !e.quiet) obs.push([e.mx - 36, e.my - 14, e.mx + 36, e.my + 14]);
  // the cartouche (top left) and the zoom keys (top right) sit over the desktop stage
  if (!o.narrow) obs.push([0, 0, 400, 128], [W - 66, 0, W, 196]);
  // desktop: icon with the sentence below it; phone: a small icon with the amount beside it
  const lw = ((o.lang === "ru" ? "кольцо · можно закрыть " : "loop · could clear ").length + v.length) * 6.6 + 10;
  const box = (x: number, y: number): Box4 => (loop.compact ? [x - 13, y - 13, x + 18 + v.length * 6.8, y + 13] : [x - lw / 2, y - 17, x + lw / 2, y + 41]);
  const cost = (x: number, y: number) => {
    const a = box(x, y);
    const out = a[0] < 6 || a[2] > W - 6 || a[1] < 6 || a[3] > H - 6 ? 1e7 : 0;
    return (out + overlapSum(a, obs)) * 4;
  };
  let best: [number, number] = [loop.x, loop.y];
  let bc = cost(loop.x, loop.y);
  for (let gy = 0; gy <= 14; gy++) {
    for (let gx = 0; gx <= 18; gx++) {
      const x = W * (0.08 + (0.84 * gx) / 18);
      const y = H * (0.06 + (0.88 * gy) / 14);
      const c = cost(x, y) + Math.hypot(x - loop.x, y - loop.y);
      if (c < bc) {
        bc = c;
        best = [x, y];
      }
    }
  }
  return best;
}

// ------------------------------------------------------------------------------------------------
// timeline: marks, block ticks, segments
// ------------------------------------------------------------------------------------------------

export type MarkKind = "step" | "money" | "chain" | "tracker" | "alert" | "reject";
export const MARK_KINDS: readonly MarkKind[] = ["step", "money", "chain", "tracker", "alert", "reject"];

const MARK: Partial<Record<EconomyEvent["type"], MarkKind>> = {
  "scenario.step": "step",
  "reserve.created": "money",
  "reserve.redeemed": "money",
  "reserve.toppedUp": "money",
  "reserve.refundInitiated": "money",
  "reserve.refundCompleted": "money",
  "clearing.settled": "money",
  "tracker.committed": "chain",
  "tracker.status": "tracker",
  "tracker.censorship": "tracker",
  nostr: "alert",
  "redemption.rejected": "reject",
  "action.rejected": "reject",
  "clearing.rejected": "reject",
  "note.rejected": "reject",
  "exchange.rejected": "reject",
};

export interface Mark {
  seq: number;
  kind: MarkKind;
  height: number;
}

export interface Tick {
  seq: number;
  to: number;
  blocks: number;
}

const markCache = new WeakMap<Economy, { n: number; marks: Mark[]; ticks: Tick[] }>();

/** Marks and block ticks of a log, extended incrementally as the log grows. */
export function marksOf(eco: Economy): { marks: Mark[]; ticks: Tick[] } {
  let c = markCache.get(eco);
  if (!c || c.n > eco.events.length) {
    c = { n: 0, marks: [], ticks: [] };
    markCache.set(eco, c);
  }
  const ev = eco.events;
  for (let i = c.n; i < ev.length; i++) {
    const e = ev[i];
    if (e.type === "chain.mined") c.ticks.push({ seq: e.seq, to: e.to, blocks: e.to - e.from + 1 });
    const k = MARK[e.type];
    if (k) c.marks.push({ seq: e.seq, kind: k, height: e.height });
  }
  c.n = ev.length;
  return c;
}

export interface Seg {
  from: number;
  to: number;
  w: number;
  kind: "setup" | "step" | "free" | "ahead";
  index: number;
}

/** Story time: the setup, one equal segment per played step, ghost segments for the steps ahead. */
export function segmentsOf(results: readonly StepResult[], lastSeq: number, totalSteps: number, story: boolean): Seg[] {
  if (!story) return [{ from: 0, to: Math.max(0, lastSeq), w: 1, kind: "free", index: -1 }];
  const segs: Seg[] = [];
  const first = results[0]?.fromSeq ?? lastSeq + 1;
  segs.push({ from: 0, to: Math.max(0, first - 1), w: 0.55, kind: "setup", index: -1 });
  results.forEach((r, i) => {
    const end = (results[i + 1]?.fromSeq ?? lastSeq + 1) - 1;
    segs.push({ from: r.fromSeq, to: Math.max(r.fromSeq, end), w: 1, kind: "step", index: r.index });
  });
  for (let i = results.length; i < totalSteps; i++) segs.push({ from: lastSeq, to: lastSeq, w: 1, kind: "ahead", index: i });
  return segs;
}

export function segTotal(segs: readonly Seg[]): number {
  return segs.reduce((s, g) => s + g.w, 0) || 1;
}

/** 0…1 position of a seq on the story timeline. */
export function xOfSeq(segs: readonly Seg[], seq: number): number {
  const total = segTotal(segs);
  let acc = 0;
  for (const g of segs) {
    if (g.kind === "ahead") break;
    if (seq <= g.to || g === segs[segs.length - 1]) {
      const span = g.to - g.from + 1;
      const f = Math.max(0, Math.min(1, (seq - g.from + 1) / span));
      return (acc + g.w * f) / total;
    }
    acc += g.w;
  }
  return acc / total;
}

/** The seq under a 0…1 position (clamped to the played part). */
export function seqOfX(segs: readonly Seg[], x: number, lastSeq: number): number {
  const total = segTotal(segs);
  const target = Math.max(0, x) * total;
  let acc = 0;
  for (const g of segs) {
    if (g.kind === "ahead") break;
    if (target <= acc + g.w) {
      const f = (target - acc) / g.w;
      const span = g.to - g.from + 1;
      return Math.max(0, Math.min(lastSeq, g.from + Math.round(f * span) - 1));
    }
    acc += g.w;
  }
  return lastSeq;
}

/** End (0…1) of the played part. */
export function playedEnd(segs: readonly Seg[]): number {
  const total = segTotal(segs);
  let acc = 0;
  for (const g of segs) {
    if (g.kind === "ahead") break;
    acc += g.w;
  }
  return acc / total;
}

// ------------------------------------------------------------------------------------------------
// transactions and refusals rebuilt from the log
// ------------------------------------------------------------------------------------------------

export interface TxView {
  tx: SimTx;
  evaluation: ReserveEval | null;
  event: EconomyEvent;
  synthesized: boolean;
  matches: boolean;
}

export const ONCHAIN_TYPES: ReadonlySet<string> = new Set(["reserve.created", "reserve.redeemed", "reserve.toppedUp", "reserve.refundInitiated", "reserve.refundCompleted", "clearing.settled"]);

type Synth = (r: ReserveSim) => SimTx;

/** The transaction behind an on-chain event, rebuilt on a copy of the state right before it. */
export function rebuildTx(run: RunController, live: Economy, e: EconomyEvent, synth: Synth): TxView | null {
  try {
    if (e.type === "reserve.created") {
      const r = live.reserves.get(e.reserve);
      if (!r) return null;
      return { tx: synth(r), evaluation: null, event: e, synthesized: true, matches: false };
    }
    let settled: Extract<EconomyEvent, { type: "clearing.settled" }> | null = null;
    if (e.type === "clearing.settled") settled = e;
    else if (e.type === "reserve.redeemed" && e.clearing) {
      for (let i = e.seq + 1; i < live.events.length && i < e.seq + 24; i++) {
        const x = live.events[i];
        if (x.type === "clearing.settled" && x.id === e.clearing) {
          settled = x;
          break;
        }
      }
    }
    if (settled) {
      if (settled.mode !== "onchain") return null;
      const first = settled.seq - settled.legs;
      if (first < 1) return null;
      const c = run.stateAt(first - 1);
      const out = c.clearCycle(settled.members, { mode: "onchain", amount: settled.amount, denom: settled.denom });
      if (!out.tx) return null;
      const leg = e.type === "reserve.redeemed" ? Math.max(0, settled.members.indexOf(e.issuer)) : 0;
      return { tx: out.tx, evaluation: out.evals?.[leg] ?? null, event: e, synthesized: false, matches: out.tx.id === settled.txId };
    }
    if (e.seq < 1) return null;
    const c = run.stateAt(e.seq - 1);
    if (e.type === "reserve.redeemed") {
      const out = c.redeem({ receiver: e.receiver, issuer: e.issuer, denom: e.denom, tracker: e.tracker, reserve: e.reserve, amount: e.amount, emergency: e.emergency });
      const alt = out.tx ? out : c.redeem({ receiver: e.receiver, issuer: e.issuer, denom: e.denom, tracker: e.tracker, reserve: e.reserve, amount: e.amount, emergency: e.emergency, force: true });
      if (!alt.tx) return null;
      return { tx: alt.tx, evaluation: alt.eval ?? null, event: e, synthesized: false, matches: alt.tx.id === e.txId };
    }
    if (e.type === "reserve.toppedUp") {
      const out = c.topUp({ reserve: e.reserve, amount: e.amount, by: e.by });
      if (!out.tx) return null;
      return { tx: out.tx, evaluation: out.eval ?? null, event: e, synthesized: false, matches: out.tx.id === e.txId };
    }
    if (e.type === "reserve.refundInitiated") {
      const out = c.initiateRefund({ reserve: e.reserve, r7: e.r7 });
      if (!out.tx) return null;
      return { tx: out.tx, evaluation: out.eval ?? null, event: e, synthesized: false, matches: out.tx.id === e.txId };
    }
    if (e.type === "reserve.refundCompleted") {
      const out = c.completeRefund({ reserve: e.reserve });
      if (!out.tx) return null;
      return { tx: out.tx, evaluation: out.eval ?? null, event: e, synthesized: false, matches: out.tx.id === e.txId };
    }
  } catch {
    return null;
  }
  return null;
}

export interface RefusalView {
  /** An Economy outcome (ContractXray evaluation input) or null when only a focus code is known. */
  outcome: { ok: boolean; stage?: "wallet" | "tracker" | "contract"; code?: string; message?: string; eval?: ReserveEval; tx?: SimTx } | null;
  focus: string[];
  code: string;
  stage: string;
  message: string;
}

export const REFUSAL_TYPES: ReadonlySet<string> = new Set(["redemption.rejected", "action.rejected"]);

/** A refusal in the log, re-run on the state just before it so the X-ray can show the evaluation. */
export function rebuildRefusal(run: RunController, e: EconomyEvent): RefusalView | null {
  if (e.type === "redemption.rejected") {
    const base: RefusalView = { outcome: null, focus: [e.code], code: e.code, stage: e.stage, message: e.message };
    if (e.seq < 1) return base;
    try {
      const variants = [
        { emergency: "auto" as const },
        { emergency: true },
        { force: true },
        { emergency: true, force: true },
      ];
      for (const v of variants) {
        const c = run.stateAt(e.seq - 1);
        const out = c.redeem({ receiver: e.receiver, issuer: e.issuer, denom: e.denom, tracker: e.tracker, reserve: e.reserve, amount: e.amount || undefined, ...v });
        if (!out.ok && out.code === e.code && out.stage === e.stage) return { ...base, outcome: { ok: false, stage: out.stage, code: out.code, message: out.message, eval: out.eval, tx: out.tx } };
      }
    } catch {
      /* fall back to the focus code */
    }
    return base;
  }
  if (e.type === "action.rejected") {
    const base: RefusalView = { outcome: null, focus: [e.code], code: e.code, stage: "contract", message: e.message };
    if (e.seq < 1) return base;
    try {
      const c = run.stateAt(e.seq - 1);
      const out =
        e.action === "complete-refund" ? c.completeRefund({ reserve: e.reserve, signer: e.by }) : e.action === "initiate-refund" ? c.initiateRefund({ reserve: e.reserve, signer: e.by }) : null;
      if (out && !out.ok && out.eval) return { ...base, outcome: { ok: false, stage: "contract", code: out.code, message: out.message, eval: out.eval, tx: out.tx } };
    } catch {
      /* fall back */
    }
    return base;
  }
  return null;
}

/** Refusals inside a step's events (contract-level ones first). */
export function refusalsIn(events: readonly EconomyEvent[]): EconomyEvent[] {
  const out = events.filter((e) => REFUSAL_TYPES.has(e.type));
  return out.sort((a, b) => (stageRank(b) - stageRank(a)));
}
const stageRank = (e: EconomyEvent) => (e.type === "redemption.rejected" ? (e.stage === "contract" ? 2 : 1) : e.type === "action.rejected" ? 2 : 0);

// ------------------------------------------------------------------------------------------------
// try to cheat
// ------------------------------------------------------------------------------------------------

export type CheatId = "double" | "replay" | "over" | "forged" | "early" | "refund";
export const CHEATS: readonly CheatId[] = ["double", "replay", "over", "forged", "early", "refund"];

export interface CheatCtx {
  issuer: string;
  receiver: string;
  tracker: string;
  denom: DenomId;
  reserve: string;
  decimals: number;
  symbol: string;
  committed: bigint;
  already: bigint;
  /** Box age of the tracker (null: no box). */
  age: number | null;
  emergencyOpen: boolean;
}

/** The best pair to try cheats on: a committed note whose issuer has a live reserve on that tracker. */
export function cheatContext(eco: Economy): CheatCtx | null {
  let best: CheatCtx | null = null;
  let bestScore = -1;
  const h = eco.clock.height;
  for (const t of eco.trackers.values()) {
    const box = t.currentBox();
    if (!box) continue;
    for (const rec of t.notes.values()) {
      if (rec.issuer === rec.receiver) continue;
      const committed = t.committedTotal(rec.key);
      if (committed === null || committed <= 0n) continue;
      const I = eco.byPub.get(rec.issuer);
      const R = eco.byPub.get(rec.receiver);
      if (!I || !R) continue;
      const r = eco.reservesOf(I.id, rec.denom).find((x) => x.active && x.trackerNftId === t.nftId && x.collateral() > 2_000_000n);
      if (!r) continue;
      const done = r.redeemedFor(R.pub)?.redeemed ?? 0n;
      const { symbol, decimals } = denomInfoOf(eco, rec.denom);
      const score = (t.status(rec, h) === "confirmed" ? 4 : 0) + (done > 0n ? 2 : 0) + (rec.denom === "erg" ? 1 : 0) + (committed > done ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = { issuer: I.id, receiver: R.id, tracker: t.id, denom: rec.denom, reserve: r.id, decimals, symbol, committed, already: done, age: h - box.creationHeight, emergencyOpen: t.emergencyOpen(h) };
      }
    }
  }
  return best;
}

/** Any live reserve (for the exit cheat when no note qualifies). */
export function anyReserve(eco: Economy): ReserveSim | null {
  for (const r of eco.reserves.values()) if (r.active) return r;
  return null;
}

export interface CheatResult {
  id: CheatId;
  /** The engine accepted it (should never happen). */
  passed: boolean;
  stage: "wallet" | "tracker" | "contract";
  code: string;
  message: string;
  eval: ReserveEval | null;
  tx: SimTx | null;
  failed: string[];
  /** i18n keys + vars of what the copy did first. */
  setup: Array<{ key: string; vars: Record<string, string> }>;
  vars: Record<string, string>;
  trackerCode?: string;
}

function minUnit(decimals: number): bigint {
  return decimals >= 2 ? 10n ** BigInt(decimals - 2) : 1n;
}

/** Runs one cheat on a copy of `eco`. Returns null when there is nothing to try it on. */
export function runCheat(id: CheatId, eco: Economy, lang: Lang): CheatResult | null {
  const c = eco.clone();
  const nm = (x: string) => displayName(eco, x, lang);
  if (id === "refund") {
    const ctx = cheatContext(c);
    const r = ctx ? c.r(ctx.reserve) : anyReserve(c);
    if (!r) return null;
    const owner = c.idOf(r.owner) ?? "";
    const vars = { i: nm(owner) };
    const setup: CheatResult["setup"] = [];
    if (!r.refundPending()) {
      const init = c.initiateRefund({ reserve: r.id });
      if (!init.ok) return { id, passed: false, stage: "contract", code: init.code ?? "contract", message: init.message ?? "", eval: init.eval ?? null, tx: init.tx ?? null, failed: init.eval?.failed ?? [], setup, vars };
      setup.push({ key: "play.cheat.refund.setup", vars });
    }
    const out = c.completeRefund({ reserve: r.id });
    return { id, passed: out.ok, stage: "contract", code: out.code ?? "", message: out.message ?? "", eval: out.eval ?? null, tx: out.tx ?? null, failed: out.eval?.failed ?? [], setup, vars };
  }
  const ctx = cheatContext(c);
  if (!ctx) return null;
  const I = c.p(ctx.issuer);
  const R = c.p(ctx.receiver);
  const t = c.t(ctx.tracker);
  const res = c.r(ctx.reserve);
  const setup: CheatResult["setup"] = [];
  // the cheats are about the contract: on the copy the tracker answers as usual (online, nothing censored), except
  // for "too early", whose whole point is a tracker that went quiet
  if (id !== "early" && (!t.online || t.censorship.mode !== "off")) {
    if (!t.online) c.reappear(t.id);
    if (t.censorship.mode !== "off") c.setCensorship(t.id, "off");
    setup.push({ key: "play.cheat.setupTracker", vars: { t: nm(t.id) } });
  }
  const fmt = (v: bigint) => `${fmtAmt(v, ctx.decimals)}${" "}${ctx.symbol}`;
  const vars: Record<string, string> = { i: nm(ctx.issuer), r: nm(ctx.receiver) };
  const payable = () => {
    const col = res.collateral();
    const floor = res.contract === "basis-token" ? 1n : 1_000_000n;
    return col > floor ? col - floor : 0n;
  };
  const room = () => {
    const committed = t.committedTotal(t.note(I.pub, R.pub, ctx.denom)!.key) ?? 0n;
    const done = res.redeemedFor(R.pub)?.redeemed ?? 0n;
    return committed > done ? committed - done : 0n;
  };
  const small = () => {
    const r = room();
    const p = payable();
    const m = r < p ? r : p;
    const q = m / 4n;
    return q > 0n ? q : m;
  };
  const base = { receiver: R.id, issuer: I.id, denom: ctx.denom, tracker: t.id, reserve: res.id };
  const fromOutcome = (out: { ok: boolean; stage?: "wallet" | "tracker" | "contract"; code?: string; message?: string; eval?: ReserveEval; tx?: SimTx }, extra: Partial<CheatResult> = {}): CheatResult => ({
    id,
    passed: out.ok,
    stage: out.stage ?? "contract",
    code: out.code ?? (out.eval?.failed[0] ?? ""),
    message: out.message ?? "",
    eval: out.eval ?? null,
    tx: out.tx ?? null,
    failed: out.eval?.failed ?? [],
    setup,
    vars,
    ...extra,
  });

  if (id === "double") {
    let paid = res.redeemedFor(R.pub)?.redeemed ?? 0n;
    if (paid === 0n) {
      const amt = small();
      if (amt <= 0n) return null;
      const h = c.redeem({ ...base, amount: amt, force: true, emergency: false });
      if (!h.ok) return fromOutcome(h);
      paid = amt;
      setup.push({ key: "play.cheat.double.setup", vars: { ...vars, v: fmt(amt) } });
    }
    const p = payable();
    const amount = paid < p ? paid : p;
    const out = c.redeem({ ...base, amount: amount > 0n ? amount : 1n, force: true, emergency: false, tamper: { omitReserveLookup: true } });
    return fromOutcome(out);
  }

  if (id === "over") {
    const r = room();
    const extra = r / 2n > minUnit(ctx.decimals) * 10n ? r / 2n : minUnit(ctx.decimals) * 10n;
    let amount = r + extra;
    if (amount > payable()) {
      if (res.contract === "basis") {
        const need = amount - payable() + 200_000_000n;
        const rich = [...c.participants.values()].sort((a, b) => (c.balance(b.id) > c.balance(a.id) ? 1 : -1))[0];
        if (rich && c.balance(rich.id) > need + 2_000_000n) {
          const tu = c.topUp({ reserve: res.id, amount: need, by: rich.id });
          if (tu.ok) setup.push({ key: "play.cheat.over.setup", vars: { who: nm(rich.id), v: fmt(need) } });
        }
      }
      if (amount > payable()) amount = payable();
    }
    vars.v = fmt(amount);
    const out = c.redeem({ ...base, amount, force: true, emergency: false });
    return fromOutcome(out);
  }

  if (id === "forged" || id === "replay") {
    if (!t.note(I.pub, R.pub, ctx.denom)) return null;
    if (id === "forged") {
      // a fully redeemed note is raised a little first, so the signature is the only thing wrong with the claim
      if (room() <= 0n) {
        const up = c.pay({ from: I.id, to: R.id, amount: minUnit(ctx.decimals) * 100n, denom: ctx.denom, tracker: t.id, skipAcceptance: true });
        if (!up.ok) return fromOutcome({ ok: false, stage: "tracker", code: up.code, message: up.message });
        c.mine(10);
        setup.push({ key: "play.cheat.forged.setupRaise", vars });
      }
      const rec = t.note(I.pub, R.pub, ctx.denom)!;
      const committed = t.committedTotal(rec.key);
      const version = [...rec.history].reverse().find((v) => v.totalDebt === committed) ?? rec.history[rec.history.length - 1];
      const sig = c.issuerSignature(rec, version);
      const bad = sig.slice();
      bad[40] ^= 0x01;
      const trackerSig = t.coSign(rec, version.totalDebt, version.timestamp);
      const amt = small() > 0n ? small() : 1n;
      const built = res.buildRedeem({ receiver: R.pub, totalDebt: version.totalDebt, timestamp: version.timestamp, amount: amt, issuerSig: bad, trackerSig, trackerBox: t.dataInput(), height: c.clock.height, salt: "forged" });
      const ev = res.evaluate(built.tx);
      // the tracker refuses the same kind of signature at POST /notes
      const p = c.pay({ from: I.id, to: R.id, amount: minUnit(ctx.decimals), denom: ctx.denom, tracker: t.id, signature: bad, skipAcceptance: true });
      return fromOutcome({ ok: ev.ok, stage: "contract", code: ev.error?.check ?? "contract", message: ev.error?.message ?? "", eval: ev, tx: built.tx }, { trackerCode: p.ok ? undefined : p.code });
    }
    // replay: a newer version with the same total is committed and partly redeemed; then the older one comes back
    // (a fully redeemed note is raised a little first, so there is something left to redeem honestly)
    const raise = room() <= 0n;
    if (raise) {
      const up = c.pay({ from: I.id, to: R.id, amount: minUnit(ctx.decimals) * 100n, denom: ctx.denom, tracker: t.id, skipAcceptance: true });
      if (!up.ok) return fromOutcome({ ok: false, stage: "tracker", code: up.code, message: up.message });
    }
    // the version that will be replayed, and a newer one with the same total (so only the timestamp tells them apart)
    const rec1 = t.note(I.pub, R.pub, ctx.denom)!;
    const latest = rec1.history[rec1.history.length - 1];
    const fresh = c.pay({ from: I.id, to: R.id, amount: 0n, totalDebt: latest.totalDebt, denom: ctx.denom, tracker: t.id, skipAcceptance: true });
    if (!fresh.ok) return fromOutcome({ ok: false, stage: "tracker", code: fresh.code, message: fresh.message });
    c.mine(10);
    const amt = small();
    if (amt <= 0n) return null;
    const h = c.redeem({ ...base, amount: amt, force: true, emergency: false });
    if (!h.ok) return fromOutcome(h);
    setup.push({ key: raise ? "play.cheat.replay.setupRaise" : "play.cheat.replay.setup", vars: { ...vars, v: fmt(amt) } });
    const rec2 = t.note(I.pub, R.pub, ctx.denom)!;
    const old = rec2.history.find((v) => v.totalDebt === latest.totalDebt && v.timestamp === latest.timestamp) ?? latest;
    const issuerSig = c.issuerSignature(rec2, old);
    const trackerSig = t.coSign(rec2, old.totalDebt, old.timestamp);
    const p = payable();
    const amount = amt < p ? amt : p;
    const built = res.buildRedeem({ receiver: R.pub, totalDebt: old.totalDebt, timestamp: old.timestamp, amount: amount > 0n ? amount : 1n, issuerSig, trackerSig, trackerBox: t.dataInput(), height: c.clock.height, salt: "replay" });
    const ev = res.evaluate(built.tx);
    return fromOutcome({ ok: ev.ok, stage: "contract", code: ev.error?.check ?? "contract", message: ev.error?.message ?? "", eval: ev, tx: built.tx });
  }

  if (id === "early") {
    vars.age = String(ctx.age ?? 0);
    if (ctx.emergencyOpen) return null;
    const amt = small() > 0n ? small() : 1n;
    const out = c.redeem({ ...base, amount: amt, emergency: true, force: true });
    return fromOutcome(out);
  }
  return null;
}

/** Is the emergency path already open for the cheat pair (then "too early" is not a cheat). */
export function emergencyOpenFor(eco: Economy): boolean {
  const ctx = cheatContext(eco);
  return !!ctx?.emergencyOpen;
}

export const EMERGENCY = EMERGENCY_BLOCKS;
