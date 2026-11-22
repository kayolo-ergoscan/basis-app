// Pure derivations for the tracker console. Inputs are the live sandbox economy (read only: nothing here changes
// it); outputs are plain data the components render. Kept free of React so the tests can drive it directly.

import {
  bytesToHex,
  EMERGENCY_BLOCKS,
  type CensorshipMode,
  type Economy,
  type Hex,
  type NoteRecord,
  type NoteStatus,
  type TrackerBoxRecord,
  type TrackerSim,
} from "@/protocol";
import { commitChangedKeys, trackerTimeline, uncommittedKeys } from "@/world";

/** Blocks the console's heartbeat strip covers (VISUAL §9: 720 on /tracker ≈ 1 day). */
export const BEATS = 720;
/** Product thresholds for the state tag (only 2 160 is the contract rule). */
export const LATE_BLOCKS = 120;
export const SILENT_BLOCKS = 720;

export type Band = "ontime" | "late" | "silent" | "emergency";
export const bandOf = (age: number): Band => (age < LATE_BLOCKS ? "ontime" : age < SILENT_BLOCKS ? "late" : age < EMERGENCY_BLOCKS ? "silent" : "emergency");

export interface BoxView {
  boxId: Hex;
  txId: Hex;
  creationHeight: number;
  digest: Hex;
  notes: number;
  registers: { R4: Hex; R5: Hex; R6: Hex };
  confirmedHeight: number | null;
}

/** What the updater will do next. */
export type NextKind = "change" | "heartbeat" | "confirm" | "idle" | "dark";

export interface TrackerView {
  id: string;
  name: string;
  nftId: Hex;
  pub: Hex;
  operator: string;
  height: number;
  online: boolean;
  /** skipIfUnchanged = false: a box every cycle even when nothing changed. */
  heartbeat: boolean;
  censor: { mode: CensorshipMode; targets: string[] | "all" };
  interval: number;
  minDepth: number;
  box: BoxView | null;
  confirmed: BoxView | null;
  /** Blocks since the current box was created (the dead-man dial). */
  age: number;
  band: Band;
  /** First height at which the emergency path opens (creation + 2 161). */
  emergencyAt: number | null;
  /** Blocks until it opens; 0 when open. */
  emergencyIn: number;
  emergencyOpen: boolean;
  /** The live tree's digest (the server's local_digest). */
  localDigest: Hex;
  /** The live digest differs from the latest box: something waits for the next commit. */
  dirty: boolean;
  /** Debt keys changed since the latest commitment. */
  uncommitted: number;
  /** Blocks until the next updater cycle (cycles are aligned to the town's genesis). */
  nextRunIn: number;
  next: { kind: NextKind; inBlocks: number | null };
  /** Entries in the live tree. */
  treeSize: number;
}

const boxView = (b: TrackerBoxRecord | undefined): BoxView | null =>
  b ? { boxId: b.boxId, txId: b.txId, creationHeight: b.creationHeight, digest: b.digest, notes: b.notes, registers: { ...b.registers }, confirmedHeight: b.confirmedHeight } : null;

/** The first aligned updater cycle after `h` (Economy.alignedNext). */
export function nextCycleAfter(h: number, genesis: number, interval: number): number {
  return genesis + (Math.floor((h - genesis) / interval) + 1) * interval;
}

/** First cycle at or after `from` at which the box is deep enough to be confirmed by the updater. */
export function cycleWithDepth(from: number, interval: number, box: { creationHeight: number; confirmedHeight: number | null } | null, minDepth: number): number {
  let at = from;
  if (box && box.confirmedHeight === null) while (at - box.creationHeight + 1 < minDepth) at += interval;
  return at;
}

export function participantIdOf(eco: Economy, pub: Hex): string | null {
  return eco.byPub.get(pub)?.id ?? null;
}

export function trackerView(eco: Economy, trackerId: string): TrackerView {
  const t = eco.t(trackerId);
  const h = eco.clock.height;
  const box = t.currentBox();
  const localDigest = bytesToHex(t.digest());
  const dirty = !!box && box.digest !== localDigest;
  const interval = Math.max(1, t.options.commitIntervalBlocks);
  const nextRun = nextCycleAfter(h, eco.clock.genesisHeight, interval);
  const age = t.boxAge(h);
  const emergencyAt = t.emergencyOpensAt();
  let next: TrackerView["next"];
  if (!t.online) next = { kind: "dark", inBlocks: null };
  else if (dirty && t.options.autoCommit) next = { kind: "change", inBlocks: cycleWithDepth(nextRun, interval, box ?? null, t.options.minDepth) - h };
  else if (box && box.confirmedHeight === null) next = { kind: "confirm", inBlocks: cycleWithDepth(nextRun, interval, box, t.options.minDepth) - h };
  else if (!t.options.skipIfUnchanged && t.options.autoCommit) next = { kind: "heartbeat", inBlocks: nextRun - h };
  else next = { kind: "idle", inBlocks: null };
  const targets = t.censorship.targets === "all" ? "all" : [...t.censorship.targets].map((p) => participantIdOf(eco, p) ?? p);
  return {
    id: t.id,
    name: t.name,
    nftId: t.nftId,
    pub: t.pub,
    operator: t.operatorId,
    height: h,
    online: t.online,
    heartbeat: !t.options.skipIfUnchanged,
    censor: { mode: t.censorship.mode, targets },
    interval,
    minDepth: t.options.minDepth,
    box: boxView(box),
    confirmed: boxView(t.confirmedBox()),
    age,
    band: bandOf(age),
    emergencyAt,
    emergencyIn: emergencyAt === null ? EMERGENCY_BLOCKS + 1 : Math.max(0, emergencyAt - h),
    emergencyOpen: t.emergencyOpen(h),
    localDigest,
    dirty,
    uncommitted: uncommittedKeys(eco, t.id).length,
    nextRunIn: nextRun - h,
    next,
    treeSize: t.map.size,
  };
}

// ---------------------------------------------------------------------------------------------
// heartbeat: commitments inside the last BEATS blocks
// ---------------------------------------------------------------------------------------------

export interface Beat {
  /** 0 = oldest block of the window, BEATS − 1 = now. */
  index: number;
  height: number;
  heartbeat: boolean;
}

/** While the town is younger than this, one bar of the strip is one block. */
export const BEATS_FINE = 144;

export interface BeatsWindow {
  /** Oldest height the strip covers. */
  from: number;
  /** How far back the strip reaches: 720 blocks, or the town's age while it is younger. */
  back: number;
  /** The town is younger than the 720-block window, so the strip starts at genesis. */
  young: boolean;
  /** Blocks per bar. */
  bucket: number;
}

/**
 * The heartbeat strip's window: the last 720 blocks, or every block since genesis while the town is younger (a
 * young town never shows a strip of empty pre-history). One bar is one updater cycle (at least 4 blocks), aligned to
 * the town's cycles; while the town is younger than 144 blocks one bar is one block.
 */
export function beatsWindow(height: number, genesis: number, interval: number): BeatsWindow {
  const age = Math.max(0, height - genesis);
  const cycle = Math.max(4, Math.floor(interval) || 1);
  if (age >= BEATS - 1) return { from: height - BEATS + 1, back: BEATS, young: false, bucket: cycle };
  return { from: genesis, back: age, young: true, bucket: age < BEATS_FINE ? 1 : cycle };
}

/** Commit positions in the window that ends at `height` (rows newest first, as trackerTimeline gives them). */
export function beatsOf(rows: ReadonlyArray<{ height: number; heartbeat: boolean; seq: number }>, height: number, n = BEATS): Beat[] {
  const from = height - n + 1;
  const out: Beat[] = [];
  for (const r of rows) {
    if (r.height < from) break;
    if (r.height > height) continue;
    out.push({ index: r.height - from, height: r.height, heartbeat: r.heartbeat });
  }
  return out.reverse();
}

// ---------------------------------------------------------------------------------------------
// digest timeline: rows with "+ new / ~ raised" counts
// ---------------------------------------------------------------------------------------------

export interface TimelineRow {
  seq: number;
  boxId: Hex;
  txId: Hex;
  prevBoxId: Hex | null;
  height: number;
  digest: Hex;
  /** Entries in the committed tree. */
  notes: number;
  heartbeat: boolean;
  confirmedHeight: number | null;
  current: boolean;
  /** Confirmations: height − inclusion + 1. */
  depth: number;
  /** Debt keys that entered the tree in this commitment. */
  added: Hex[];
  /** Debt keys whose total was raised in this commitment. */
  raised: Hex[];
  /** The genesis box (tracker created with an empty tree). */
  genesis: boolean;
}

interface ClassCache {
  scanned: number;
  seen: Set<Hex>;
  byBox: Map<Hex, { added: Hex[]; raised: Hex[] }>;
}
const classCaches = new WeakMap<Economy, Map<string, ClassCache>>();

/** Splits each commitment's changed keys into new pairs and raised totals (incremental over the log). */
function classify(eco: Economy, trackerId: string): ClassCache {
  let per = classCaches.get(eco);
  if (!per) classCaches.set(eco, (per = new Map()));
  let c = per.get(trackerId);
  if (!c || c.scanned > eco.events.length) per.set(trackerId, (c = { scanned: 0, seen: new Set(), byBox: new Map() }));
  const ev = eco.events;
  for (let i = c.scanned; i < ev.length; i++) {
    const e = ev[i];
    if (e.type !== "tracker.committed" || e.tracker !== trackerId) continue;
    const added: Hex[] = [];
    const raised: Hex[] = [];
    for (const k of commitChangedKeys(eco, e.seq)) {
      if (c.seen.has(k)) raised.push(k);
      else {
        added.push(k);
        c.seen.add(k);
      }
    }
    c.byBox.set(e.boxId, { added, raised });
  }
  c.scanned = ev.length;
  return c;
}

export function timelineRows(eco: Economy, trackerId: string, limit: number): TimelineRow[] {
  const cls = classify(eco, trackerId);
  return trackerTimeline(eco, trackerId, { limit }).map((r) => {
    const k = cls.byBox.get(r.boxId);
    return {
      seq: r.seq,
      boxId: r.boxId,
      txId: r.txId,
      prevBoxId: r.prevBoxId,
      height: r.height,
      digest: r.digest,
      notes: r.notes,
      heartbeat: r.heartbeat,
      confirmedHeight: r.confirmedHeight,
      current: r.current,
      depth: r.depth,
      added: k?.added ?? [],
      raised: k?.raised ?? [],
      genesis: r.prevBoxId === null,
    };
  });
}

/** Number of commitments the tracker has made (genesis box included). */
export function commitCount(eco: Economy, trackerId: string): number {
  return eco.t(trackerId).boxes.length;
}

// ---------------------------------------------------------------------------------------------
// pending ladder: local_only → pending → confirmed
// ---------------------------------------------------------------------------------------------

export interface Ladder {
  local: number;
  pending: number;
  confirmed: number;
  /** Accepted, but left out of the tree (omit censorship). */
  omitted: number;
  total: number;
  /** Blocks until local notes become pending (null: not while the tracker is dark). */
  etaPending: number | null;
  /** Blocks until pending notes become confirmed. */
  etaConfirmed: number | null;
  /** Blocks from a note raised now to confirmed. */
  etaLocalToConfirmed: number | null;
}

/** Server status names (NoteConfirmationStatus). */
export const SERVER_STATUS: Record<NoteStatus, string> = { local: "local_only", pending: "pending", confirmed: "confirmed" };

export function noteStatusOf(t: TrackerSim, rec: NoteRecord, height: number): NoteStatus | "omitted" {
  if (rec.omitted) return "omitted";
  return t.status(rec, height);
}

export function ladderOf(eco: Economy, trackerId: string, v: Pick<TrackerView, "online" | "interval" | "minDepth" | "box" | "height">): Ladder {
  const t = eco.t(trackerId);
  const h = eco.clock.height;
  const out: Ladder = { local: 0, pending: 0, confirmed: 0, omitted: 0, total: 0, etaPending: null, etaConfirmed: null, etaLocalToConfirmed: null };
  for (const rec of t.notes.values()) {
    const s = noteStatusOf(t, rec, h);
    out[s]++;
    out.total++;
  }
  if (v.online) {
    const nextRun = nextCycleAfter(h, eco.clock.genesisHeight, v.interval);
    const commitAt = cycleWithDepth(nextRun, v.interval, v.box, v.minDepth);
    out.etaPending = commitAt - h;
    // a box committed at `commitAt` is deep enough at the following cycle (interval + 1 ≥ minDepth)
    out.etaLocalToConfirmed = cycleWithDepth(commitAt + v.interval, v.interval, { creationHeight: commitAt, confirmedHeight: null }, v.minDepth) - h;
    out.etaConfirmed = v.box && v.box.confirmedHeight === null ? cycleWithDepth(nextRun, v.interval, v.box, v.minDepth) - h : 0;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// notes in the town, for pickers
// ---------------------------------------------------------------------------------------------

export interface NoteOption {
  key: Hex;
  issuer: string;
  receiver: string;
  denom: NoteRecord["denom"];
  totalDebt: bigint;
  amountRedeemed: bigint;
  omitted: boolean;
  createdHeight: number;
  updatedHeight: number;
}

export function noteOptions(eco: Economy, trackerId: string): NoteOption[] {
  const t = eco.t(trackerId);
  const out: NoteOption[] = [];
  for (const rec of t.notes.values()) {
    const issuer = participantIdOf(eco, rec.issuer);
    const receiver = participantIdOf(eco, rec.receiver);
    if (!issuer || !receiver) continue;
    out.push({ key: rec.key, issuer, receiver, denom: rec.denom, totalDebt: rec.totalDebt, amountRedeemed: rec.amountRedeemed, omitted: rec.omitted, createdHeight: rec.createdHeight, updatedHeight: rec.updatedHeight });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// register anatomy (the machine face)
// ---------------------------------------------------------------------------------------------

export interface RegisterPart {
  id: string;
  hex: Hex;
}

/** R4 = 07 ‖ key · R5 = 64 ‖ digest(33) ‖ flags ‖ keyLength ‖ valueLength? · R6 = 0e ‖ len ‖ NFT. */
export function registerParts(r: { R4: Hex; R5: Hex; R6: Hex }): { R4: RegisterPart[]; R5: RegisterPart[]; R6: RegisterPart[] } {
  const R4 = [
    { id: "type", hex: r.R4.slice(0, 2) },
    { id: "key", hex: r.R4.slice(2) },
  ];
  const R5 = [
    { id: "type", hex: r.R5.slice(0, 2) },
    { id: "root", hex: r.R5.slice(2, 66) },
    { id: "height", hex: r.R5.slice(66, 68) },
    { id: "flags", hex: r.R5.slice(68, 70) },
    { id: "keyLength", hex: r.R5.slice(70, 72) },
    { id: "valueLength", hex: r.R5.slice(72) },
  ];
  const R6 = [
    { id: "type", hex: r.R6.slice(0, 2) },
    { id: "length", hex: r.R6.slice(2, 4) },
    { id: "nft", hex: r.R6.slice(4) },
  ];
  return { R4, R5, R6 };
}

/** AvlTree flags byte: bit 0 insert, bit 1 update, bit 2 remove. */
export function avlFlags(byteHex: Hex): { insert: boolean; update: boolean; remove: boolean } {
  const b = parseInt(byteHex || "0", 16) || 0;
  return { insert: (b & 1) !== 0, update: (b & 2) !== 0, remove: (b & 4) !== 0 };
}

export { commitsPerDay, runwayDays } from "./runway";
