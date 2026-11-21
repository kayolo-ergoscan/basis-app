// Time machine over an economy's event log: the state after any event, the state at any block height,
// alternate histories (forks) and deterministic replays.
//
// Replays are exact because every state change is an event and reducers only apply event data (economy.ts).
// Checkpoints (deep copies every `checkpointEvery` events) make backward jumps cheap; every state handed
// out is a fresh, independent Economy, so it is safe to continue it with commands (that is a fork).

import type { AvlBackend } from "./avl";
import type { Hex } from "./bytes";
import { Economy } from "./economy";
import { describeEvent, type EconomyEvent, type EventType } from "./events";
import type { DenomId } from "./note";

export interface TimeMachineOptions {
  /** Deep-copy the state every N events while replaying (default 256). */
  checkpointEvery?: number;
  avl?: AvlBackend;
}

export interface TimelineMark {
  seq: number;
  height: number;
  timeMs: bigint;
  type: EventType;
  label: string;
  kind: "step" | "money" | "chain" | "tracker" | "alert" | "reject";
}

export interface StateDiff {
  height: { a: number; b: number };
  wallets: Array<{ participant: string; denom: DenomId; a: bigint; b: bigint }>;
  notes: Array<{ key: Hex; issuer: string; receiver: string; denom: DenomId; a: bigint | null; b: bigint | null; redeemedA: bigint; redeemedB: bigint }>;
  reserves: Array<{ reserve: string; a: bigint | null; b: bigint | null }>;
  trackers: Array<{ tracker: string; digestA: Hex | null; digestB: Hex | null; onlineA: boolean | null; onlineB: boolean | null }>;
  /** First seq where the two logs differ (null if one is a prefix of the other). */
  divergedAt: number | null;
}

const MARK_KIND: Partial<Record<EventType, TimelineMark["kind"]>> = {
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
};

export class TimeMachine {
  readonly events: EconomyEvent[];
  readonly checkpointEvery: number;
  private readonly avl?: AvlBackend;
  /** seq → frozen state after that event (never handed out, only cloned). */
  private readonly checkpoints = new Map<number, Economy>();
  /** Live replay head: state after event `frontierSeq`. */
  private frontier: Economy | null = null;
  private frontierSeq = -1;

  constructor(source: Economy | readonly EconomyEvent[], opts: TimeMachineOptions = {}) {
    this.events = (source instanceof Economy ? source.events : source).slice();
    if (this.events.length === 0 || this.events[0].type !== "genesis") throw new Error("the log must start with genesis");
    this.checkpointEvery = Math.max(16, opts.checkpointEvery ?? 256);
    // replay with the backend that produced the digests in the log, not whichever one is active later
    this.avl = opts.avl ?? (source instanceof Economy ? source.avl : undefined);
  }

  get length(): number {
    return this.events.length;
  }

  get lastSeq(): number {
    return this.events.length - 1;
  }

  /** Appends events the source economy produced since (it must have the same prefix). */
  sync(source: Economy): number {
    const n = this.events.length;
    const mine = this.events[n - 1];
    const theirs = source.events[n - 1];
    if (!theirs || theirs.type !== mine.type || theirs.timeMs !== mine.timeMs || theirs.height !== mine.height) {
      throw new Error("sync: the source is not a continuation of this log");
    }
    for (let i = n; i < source.events.length; i++) this.events.push(source.events[i]);
    return source.events.length - n;
  }

  private advanceFrontier(seq: number): void {
    if (!this.frontier) {
      this.frontier = Economy.replay([this.events[0]], { avl: this.avl });
      this.frontierSeq = 0;
      this.checkpoints.set(0, this.frontier.clone());
    }
    while (this.frontierSeq < seq) {
      const next = this.events[this.frontierSeq + 1];
      this.frontier.ingest(next);
      this.frontierSeq++;
      if (this.frontierSeq % this.checkpointEvery === 0) this.checkpoints.set(this.frontierSeq, this.frontier.clone());
    }
  }

  /** A fresh economy in the state right after event `seq` (inclusive). */
  stateAt(seq: number): Economy {
    if (!Number.isInteger(seq) || seq < 0 || seq > this.lastSeq) throw new RangeError(`seq ${seq} outside 0…${this.lastSeq}`);
    if (seq >= this.frontierSeq) {
      this.advanceFrontier(seq);
      return this.frontier!.clone();
    }
    let base = -1;
    for (const k of this.checkpoints.keys()) if (k <= seq && k > base) base = k;
    const eco = this.checkpoints.get(base)!.clone();
    for (let i = base + 1; i <= seq; i++) eco.ingest(this.events[i]);
    return eco;
  }

  /** The last event whose effect lies at or before block `height` (−1 if the log starts later). */
  seqAtHeight(height: number): number {
    let lo = 0;
    let hi = this.events.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (heightAfter(this.events[mid]) <= height) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /** State at the end of block `height` (events are ordered by height). */
  stateAtHeight(height: number): Economy {
    const seq = this.seqAtHeight(height);
    if (seq < 0) throw new RangeError(`no state before height ${this.events[0].height}`);
    const eco = this.stateAt(seq);
    if (eco.clock.height < height && height <= heightAfter(this.events[this.lastSeq])) eco.clock.setHeight(height);
    return eco;
  }

  /** Alternate history: a live economy continuing from event `seq`. Same as stateAt (every state is fresh). */
  fork(seq: number): Economy {
    return this.stateAt(seq);
  }

  /** Points of interest for a timeline scrubber. */
  marks(filter?: (m: TimelineMark) => boolean, name?: (id: string) => string): TimelineMark[] {
    const out: TimelineMark[] = [];
    for (const e of this.events) {
      const kind = MARK_KIND[e.type];
      if (!kind) continue;
      const m: TimelineMark = { seq: e.seq, height: e.height, timeMs: e.timeMs, type: e.type, label: e.type === "scenario.step" ? e.title : describeEvent(e, name), kind };
      if (!filter || filter(m)) out.push(m);
    }
    return out;
  }

  /** Replays the whole log from scratch and checks it lands on `expected` (default: the replay of this log). */
  verify(expected?: Economy): { ok: boolean; hash: Hex; expected: Hex } {
    const replayed = Economy.replay(this.events, { avl: this.avl });
    const hash = replayed.stateHash();
    const want = expected ? expected.stateHash() : hash;
    return { ok: hash === want, hash, expected: want };
  }

  /** What differs between two states (e.g. the original and a fork). */
  static diff(a: Economy, b: Economy): StateDiff {
    const wallets: StateDiff["wallets"] = [];
    const ids = new Set([...a.participants.keys(), ...b.participants.keys()]);
    for (const id of [...ids].sort()) {
      const wa = a.participants.get(id)?.wallet ?? new Map<DenomId, bigint>();
      const wb = b.participants.get(id)?.wallet ?? new Map<DenomId, bigint>();
      for (const d of new Set([...wa.keys(), ...wb.keys()])) {
        const va = wa.get(d) ?? 0n;
        const vb = wb.get(d) ?? 0n;
        if (va !== vb) wallets.push({ participant: id, denom: d, a: va, b: vb });
      }
    }
    const notes: StateDiff["notes"] = [];
    const index = (eco: Economy) => {
      const m = new Map<Hex, { issuer: string; receiver: string; denom: DenomId; total: bigint; redeemed: bigint }>();
      for (const t of eco.trackers.values())
        for (const r of t.notes.values()) m.set(`${t.id}:${r.key}`, { issuer: eco.idOf(r.issuer) ?? r.issuer, receiver: eco.idOf(r.receiver) ?? r.receiver, denom: r.denom, total: r.totalDebt, redeemed: r.amountRedeemed });
      return m;
    };
    const na = index(a);
    const nb = index(b);
    for (const k of new Set([...na.keys(), ...nb.keys()])) {
      const x = na.get(k);
      const y = nb.get(k);
      if (x && y && x.total === y.total && x.redeemed === y.redeemed) continue;
      const any = (x ?? y)!;
      notes.push({ key: k.split(":")[1], issuer: any.issuer, receiver: any.receiver, denom: any.denom, a: x?.total ?? null, b: y?.total ?? null, redeemedA: x?.redeemed ?? 0n, redeemedB: y?.redeemed ?? 0n });
    }
    const reserves: StateDiff["reserves"] = [];
    for (const id of new Set([...a.reserves.keys(), ...b.reserves.keys()])) {
      const x = a.reserves.get(id);
      const y = b.reserves.get(id);
      const ca = x && x.active ? x.collateral() : null;
      const cb = y && y.active ? y.collateral() : null;
      if (ca !== cb) reserves.push({ reserve: id, a: ca, b: cb });
    }
    const trackers: StateDiff["trackers"] = [];
    for (const id of new Set([...a.trackers.keys(), ...b.trackers.keys()])) {
      const x = a.trackers.get(id);
      const y = b.trackers.get(id);
      const da = x?.currentBox()?.digest ?? null;
      const db = y?.currentBox()?.digest ?? null;
      if (da !== db || x?.online !== y?.online) trackers.push({ tracker: id, digestA: da, digestB: db, onlineA: x?.online ?? null, onlineB: y?.online ?? null });
    }
    let divergedAt: number | null = null;
    const n = Math.min(a.events.length, b.events.length);
    for (let i = 0; i < n; i++) {
      if (a.events[i] !== b.events[i] && a.events[i].type !== b.events[i].type) {
        divergedAt = i;
        break;
      }
      if (a.events[i] !== b.events[i] && JSON.stringify(a.events[i], big) !== JSON.stringify(b.events[i], big)) {
        divergedAt = i;
        break;
      }
    }
    return { height: { a: a.clock.height, b: b.clock.height }, wallets, notes, reserves, trackers, divergedAt };
  }
}

/** Chain height once the event has been applied (chain.mined is stamped with its start height). */
export function heightAfter(e: EconomyEvent): number {
  return e.type === "chain.mined" ? e.to : e.height;
}

function big(_k: string, v: unknown): unknown {
  return typeof v === "bigint" ? v.toString() : v;
}

/** Runs `build` twice from scratch and checks both runs and a replay agree (determinism self-test). */
export function checkDeterminism(build: () => Economy): { ok: boolean; hashes: Hex[] } {
  const a = build();
  const b = build();
  const c = Economy.replay(a.events);
  const hashes = [a.stateHash(), b.stateHash(), c.stateHash()];
  return { ok: hashes[0] === hashes[1] && hashes[1] === hashes[2] && a.events.length === b.events.length, hashes };
}
