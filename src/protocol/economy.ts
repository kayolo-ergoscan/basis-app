// A whole Basis economy in the browser: participants, trackers, reserves, notes, the chain clock — event-sourced.
//
// Commands (pay, novate, redeem, createReserve, mine, …) validate exactly like the tracker server and the
// reserve contract, do the real cryptography, and emit events. Reducers apply event data only, so
// `Economy.replay(events)` rebuilds the identical state (see timemachine.ts).
//
// Signatures: with `lazySignatures` (default) notes are signed when first needed (UI view, redemption,
// materialize*()). Nonces are deterministic, so a lazily produced signature is byte-identical to the one an
// eager run would have produced, and it verifies under the contract's rules.

import { blake2b256, bytesToHex, hexToBytes, utf8, type Hex } from "./bytes";
import { type AvlBackend, getAvlBackend, loadedAvlBackend } from "./avl";
import { applyCycle, clearingStats, findCycles as findDebtCycles, netPositions as debtNetPositions, settlementPlan, type ClearingStats, type DebtCycle, type DebtEdge } from "./clearing";
import { BlockClock, MIN_BOX_VALUE_NANOERG, MINER_FEE_NANOERG, REFUND_PERIOD_BLOCKS } from "./clock";
import { INFORMATIONAL_EVENTS, type EconomyEvent, type EventBody, type EventOf, type KeySource, type NostrKind, type ParticipantKind } from "./events";
import { demoKeyPair, keyPairFromSecret, nickname, secretToHex, type KeyPair } from "./keys";
import { debtKey, ERG, noteMessage, type DenomId, type DenominationInfo } from "./note";
import { evaluateAcceptance, type AcceptanceConfig, type AcceptanceResult, type ComplianceResult } from "./policy";
import { combineRedemptions, deriveId, evaluateReserveSpend, ReserveSim, type RedeemTamper, type ReserveContract, type ReserveEval, type SimTx } from "./reserve";
import { explain, sign, verify, type SignatureXray } from "./schnorr";
import {
  DEFAULT_TRACKER_OPTIONS,
  TrackerSim,
  type CensorshipMode,
  type NoteRecord,
  type NoteStatus,
  type NoteVersion,
  type NoteVia,
  type PendingExchange,
  type ReserveView,
  type TrackerBoxRecord,
  type TrackerOptions,
} from "./tracker";

// ---------- types ----------

export interface Participant {
  id: string;
  name: string;
  kind: ParticipantKind;
  avatarSeed: string;
  key: KeyPair;
  pub: Hex;
  /** Deterministic two-word nickname of the key. */
  nick: string;
  /** On-chain wallet (nanoERG under "erg", token units under "token:<id>"). */
  wallet: Map<DenomId, bigint>;
  /** Receiver-side acceptance policy in the tracker's format (null = accept anything). */
  policy: AcceptanceConfig | null;
  /** Mesh mode: an offline participant can only sign notes, not reach the tracker. */
  online: boolean;
  meta: Record<string, string>;
  keySource: KeySource;
}

export interface EconomyOptions {
  seed?: string;
  /** Default true: sign notes on demand (5,000 payments in well under a second). */
  lazySignatures?: boolean;
  genesisHeight?: number;
  genesisTimeMs?: bigint;
  avl?: AvlBackend;
  demoSalt?: string;
}

export interface OfflineNote {
  seq: number;
  tracker: string;
  issuer: string;
  receiver: string;
  denom: DenomId;
  amount: bigint;
  totalDebt: bigint;
  timestamp: bigint;
  issuerSig: Hex | null;
  memo?: string;
}

export interface PayOptions {
  from: string;
  to: string;
  amount: bigint;
  denom?: DenomId;
  tracker?: string;
  memo?: string;
  via?: NoteVia;
  /** Skip the receiver's policy and credit line (e.g. scripted gifts). */
  skipAcceptance?: boolean;
  /** Supply a ready signature (e.g. a forged one in tests). Forces eager verification. */
  signature?: Uint8Array;
  /** Override the timestamp (tests: replay / future timestamps). */
  timestamp?: bigint;
  /** Override the cumulative total (tests: attempt to decrease). */
  totalDebt?: bigint;
  /** Override the tracker NFT the note is bound to (tests). */
  trackerNftId?: Hex;
}

export interface PayResult {
  ok: boolean;
  event: EconomyEvent;
  record?: NoteRecord;
  code?: string;
  message?: string;
  acceptance?: AcceptanceResult;
}

export type RedemptionStage = "wallet" | "tracker" | "contract";

export interface RedeemOptions {
  receiver: string;
  issuer: string;
  denom?: DenomId;
  /** Default: everything this reserve still owes on the note (capped by its collateral). */
  amount?: bigint;
  reserve?: string;
  tracker?: string;
  /** true = no tracker signature (contract emergency path); "auto" (default) = only if the tracker is offline. */
  emergency?: boolean | "auto";
  /** Skip the tracker's off-chain gates and go straight to the contract (shows contract-level failures). */
  force?: boolean;
  /** /tracker/signature semantics: check policy for redeeming the full outstanding amount. */
  worstCase?: boolean;
  tamper?: RedeemTamper;
}

export interface RedemptionOutcome {
  ok: boolean;
  stage?: RedemptionStage;
  code?: string;
  message?: string;
  event?: EconomyEvent;
  eval?: ReserveEval;
  tx?: SimTx;
  emergency?: boolean;
  amount?: bigint;
  compliance?: ComplianceResult | null;
}

export interface ActionOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  event?: EconomyEvent;
  eval?: ReserveEval;
  tx?: SimTx;
  reserve?: ReserveSim;
}

export interface ExchangeOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  event: EconomyEvent;
  exchange?: PendingExchange;
}

export interface ClearingOutcome {
  ok: boolean;
  code?: string;
  message?: string;
  mode?: "onchain" | "waivers";
  amount?: bigint;
  events: EconomyEvent[];
  tx?: SimTx;
  evals?: ReserveEval[];
  before?: DebtEdge[];
  after?: DebtEdge[];
  stats?: ClearingStats;
}

export type CoverageLevel = "none" | "ok" | "caution" | "warning" | "critical";

export interface Coverage {
  collateral: bigint;
  /** Outstanding liabilities the reserve backs (incl. the owner's own self-notes). */
  liabilities: bigint;
  ratio: number | null;
  /** TUI wallet levels: < 1.0 critical, < 1.2 warning, < 1.5 caution, else ok; "none" without liabilities. */
  level: CoverageLevel;
  /** TUI reserve-screen label: UNDER-COLLATERALIZED < 1.0 ≤ LOW < 1.5 ≤ ADEQUATE < 2.0 ≤ GOOD < 3.0 ≤ EXCELLENT. */
  label: string;
  reserves: number;
  refundPending: boolean;
}

export interface CounterpartyLine {
  id: string;
  /** What they owe me (outstanding of their notes to me, after my waivers). */
  owesMe: bigint;
  /** What I owe them. */
  iOwe: bigint;
  net: bigint;
}

export interface BalanceSheet {
  participant: string;
  denom: DenomId;
  /** Σ outstanding of notes held (others' debt to me), after my waivers. */
  assets: bigint;
  /** Same, ignoring waivers: what the contract would still let me redeem. */
  assetsOnChain: bigint;
  /** Σ outstanding of notes I issued to others, after the holders' waivers. */
  liabilities: bigint;
  /** Same, ignoring waivers: what could be redeemed against me. */
  liabilitiesOnChain: bigint;
  /** Outstanding of my own A→A self-note (what I may withdraw from my reserve). */
  selfNote: bigint;
  reserve: bigint;
  wallet: bigint;
  /** assets − liabilities. */
  net: bigint;
  coverage: Coverage;
  counterparties: CounterpartyLine[];
  notesHeld: number;
  notesIssued: number;
}

export interface GraphNode {
  id: string;
  name: string;
  kind: ParticipantKind;
  pub: Hex;
  reserve: bigint;
  coverage: Coverage;
  online: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  denom: DenomId;
  totalDebt: bigint;
  redeemed: bigint;
  waived: bigint;
  outstanding: bigint;
  status: NoteStatus;
  omitted: boolean;
  key: Hex;
  tracker: string;
}

export interface NoteSignatures {
  message: Uint8Array;
  issuerSig: Uint8Array;
  issuerSigOk: boolean;
  /** Tracker co-signature for this version, when one exists or `includeTracker` asked for a preview. */
  trackerSig: Uint8Array | null;
  trackerSigSource: "handed-out" | "preview" | null;
  version: NoteVersion;
}

// ---------- helpers ----------

const keyCache = new Map<string, KeyPair>();
function cachedDemoKey(label: string, salt: string): KeyPair {
  const k = `${salt}\u0000${label}`;
  let kp = keyCache.get(k);
  if (!kp) {
    kp = demoKeyPair(label, salt);
    if (keyCache.size > 4096) keyCache.clear();
    keyCache.set(k, kp);
  }
  return kp;
}

const min = (a: bigint, b: bigint) => (a < b ? a : b);

/**
 * Most a reserve can pay out in one redemption: the server's /redemption/build keeps MIN_RESERVE_REMAINDER
 * (0.001 ERG) in an ERG reserve box and refuses to leave a token reserve with zero tokens (Ergo boxes need a
 * minimum value, and a token entry cannot be 0). The contract itself does not check either.
 */
export function maxPayout(reserve: ReserveSim): bigint {
  const c = reserve.collateral();
  const floor = reserve.contract === "basis-token" ? 1n : MIN_BOX_VALUE_NANOERG;
  return c > floor ? c - floor : 0n;
}
const outstandingOf = (r: NoteRecord) => (r.totalDebt > r.amountRedeemed ? r.totalDebt - r.amountRedeemed : 0n);
/**
 * What an honest holder still claims: outstanding minus its own waivers, never below 0. A holder who redeems
 * past a waiver (the contract cannot see waivers) has a claim of 0, not a negative one.
 */
const honestClaimOf = (r: NoteRecord) => {
  const c = outstandingOf(r) - r.waived;
  return c > 0n ? c : 0n;
};

export function coverageLevel(ratio: number | null): CoverageLevel {
  if (ratio === null) return "none";
  if (ratio < 1.0) return "critical";
  if (ratio < 1.2) return "warning";
  if (ratio < 1.5) return "caution";
  return "ok";
}

export function coverageLabel(ratio: number | null): string {
  if (ratio === null) return "NO LIABILITIES";
  if (ratio < 1.0) return "UNDER-COLLATERALIZED";
  if (ratio < 1.5) return "LOW";
  if (ratio < 2.0) return "ADEQUATE";
  if (ratio < 3.0) return "GOOD";
  return "EXCELLENT";
}

type Body<T extends EconomyEvent["type"]> = Extract<EventBody, { type: T }>;

// ---------- the economy ----------

export class Economy {
  readonly seed: string;
  readonly lazy: boolean;
  readonly avl: AvlBackend;
  readonly demoSalt: string;
  readonly clock: BlockClock;
  readonly participants = new Map<string, Participant>();
  readonly byPub = new Map<Hex, Participant>();
  readonly trackers = new Map<string, TrackerSim>();
  readonly reserves = new Map<string, ReserveSim>();
  readonly denominations = new Map<DenomId, DenominationInfo>([["erg", ERG]]);
  /** creditor|debtor|denom → limit on OUTSTANDING debt (app-level; the policy format has no denomination). */
  readonly creditLines = new Map<string, bigint>();
  readonly offline: OfflineNote[] = [];
  readonly events: EconomyEvent[] = [];
  readonly waivers: Array<EventOf<"waiver">> = [];
  defaultTracker: string | null = null;
  private listeners = new Set<(e: EconomyEvent) => void>();
  private replaying = false;

  constructor(opts: EconomyOptions = {}) {
    this.seed = opts.seed ?? "basis";
    this.lazy = opts.lazySignatures ?? true;
    this.avl = opts.avl ?? getAvlBackend();
    this.demoSalt = opts.demoSalt ?? `basis-sandbox-v1/${this.seed}`;
    this.clock = new BlockClock({ genesisHeight: opts.genesisHeight, genesisTimeMs: opts.genesisTimeMs });
    this.emit({
      type: "genesis",
      seed: this.seed,
      genesisHeight: this.clock.genesisHeight,
      genesisTimeMs: this.clock.genesisTimeMs,
      lazySignatures: this.lazy,
      avlBackend: this.avl.id,
      demoSalt: this.demoSalt,
    });
  }

  // ======================================================================================
  // events
  // ======================================================================================

  subscribe(listener: (e: EconomyEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit<B extends EventBody>(body: B, timeMs?: bigint): EconomyEvent {
    if (timeMs !== undefined) this.clock.observe(timeMs);
    const e = { seq: this.events.length, height: this.clock.height, timeMs: timeMs ?? this.clock.nowMs(), ...body } as EconomyEvent;
    this.reduce(e);
    this.events.push(e);
    if (!this.replaying) for (const l of this.listeners) l(e);
    return e;
  }

  /** Rebuilds an economy from a log (time machine, forks, shared runs). */
  static replay(events: readonly EconomyEvent[], opts: { avl?: AvlBackend } = {}): Economy {
    const g = events[0];
    if (!g || g.type !== "genesis") throw new Error("event log must start with genesis");
    const eco = Object.create(Economy.prototype) as Economy;
    Economy.initEmpty(eco, g, opts.avl);
    eco.replaying = true;
    for (const e of events) eco.applyEvent(e);
    eco.replaying = false;
    return eco;
  }

  private static initEmpty(eco: Economy, g: EventOf<"genesis">, avl?: AvlBackend): void {
    const self = eco as unknown as Record<string, unknown>;
    self.seed = g.seed;
    self.lazy = g.lazySignatures;
    // digests in the log belong to the backend that recorded it: prefer that one when it is loaded, so a
    // replay does not depend on which backend happens to be active now
    self.avl = avl ?? loadedAvlBackend(g.avlBackend) ?? getAvlBackend();
    self.demoSalt = g.demoSalt;
    self.clock = new BlockClock({ genesisHeight: g.genesisHeight, genesisTimeMs: g.genesisTimeMs });
    self.participants = new Map();
    self.byPub = new Map();
    self.trackers = new Map();
    self.reserves = new Map();
    self.denominations = new Map([["erg", ERG]]);
    self.creditLines = new Map();
    self.offline = [];
    self.events = [];
    self.waivers = [];
    self.defaultTracker = null;
    self.listeners = new Set();
    self.replaying = false;
  }

  /**
   * Independent deep copy (time machine checkpoints, "what if" branches). The copy has no listeners;
   * commands on it append to its own log only.
   */
  clone(): Economy {
    const eco = Object.create(Economy.prototype) as Economy;
    const w = eco as unknown as Record<string, unknown>;
    w.seed = this.seed;
    w.lazy = this.lazy;
    w.avl = this.avl;
    w.demoSalt = this.demoSalt;
    w.clock = BlockClock.restore(this.clock.snapshot());
    const participants = new Map<string, Participant>();
    for (const [k, p] of this.participants) participants.set(k, { ...p, wallet: new Map(p.wallet), meta: { ...p.meta } });
    w.participants = participants;
    w.byPub = new Map([...participants.values()].map((p) => [p.pub, p]));
    w.trackers = new Map([...this.trackers].map(([k, t]) => [k, t.clone()]));
    w.reserves = new Map([...this.reserves].map(([k, r]) => [k, r.clone()]));
    w.denominations = new Map(this.denominations);
    w.creditLines = new Map(this.creditLines);
    w.offline = this.offline.map((o) => ({ ...o }));
    w.events = this.events.slice();
    w.waivers = this.waivers.slice();
    w.defaultTracker = this.defaultTracker;
    w.listeners = new Set();
    w.replaying = false;
    return eco;
  }

  /** Applies one recorded event (replays, time machine). The event's seq must be the next one. */
  ingest(e: EconomyEvent): void {
    const wasReplaying = this.replaying;
    this.replaying = true;
    try {
      this.applyEvent(e);
    } finally {
      this.replaying = wasReplaying;
    }
  }

  /** Applies a recorded event (used by replay). */
  private applyEvent(e: EconomyEvent): void {
    if (e.seq !== this.events.length) throw new Error(`event seq ${e.seq} out of order (expected ${this.events.length})`);
    if (e.height > this.clock.height) this.clock.setHeight(e.height);
    this.clock.observe(e.timeMs);
    this.reduce(e);
    this.events.push(e);
  }

  private reduce(e: EconomyEvent): void {
    if (INFORMATIONAL_EVENTS.has(e.type)) {
      if (e.type === "redemption.rejected" && e.built && e.tracker) this.t(e.tracker).recordBuild(this.p(e.issuer).pub, this.p(e.receiver).pub, e.timeMs);
      return;
    }
    switch (e.type) {
      case "genesis":
        return;
      case "denomination.added":
        this.denominations.set(e.denom.id, e.denom);
        return;
      case "participant.joined": {
        const key = e.key.source === "demo" ? cachedDemoKey(e.key.label, e.key.salt) : keyPairFromSecret(e.key.secretHex);
        if (key.pubHex !== e.pub) throw new Error(`replay diverged: key of ${e.id}`);
        const p: Participant = {
          id: e.id,
          name: e.name,
          kind: e.kind,
          avatarSeed: e.avatarSeed,
          key,
          pub: key.pubHex,
          nick: nickname(key.pub),
          wallet: new Map(),
          policy: null,
          online: true,
          meta: e.meta ?? {},
          keySource: e.key,
        };
        this.participants.set(p.id, p);
        this.byPub.set(p.pub, p);
        return;
      }
      case "participant.status":
        this.p(e.participant).online = e.online;
        return;
      case "wallet.funded":
        this.credit(e.participant, e.denom, e.amount);
        return;
      case "tracker.created": {
        const op = this.p(e.operator);
        const t = new TrackerSim({ id: e.tracker, name: e.name, nftId: e.nftId, operatorId: e.operator, key: op.key, denoms: e.denoms, options: e.options, avl: this.avl, globalPolicy: e.globalPolicy });
        t.applyCommit({ boxId: e.boxId, txId: e.txId, creationHeight: e.height, digest: e.digest });
        this.trackers.set(t.id, t);
        if (!this.defaultTracker) this.defaultTracker = t.id;
        return;
      }
      case "tracker.committed":
        this.t(e.tracker).applyCommit({ boxId: e.boxId, txId: e.txId, creationHeight: e.creationHeight, digest: e.digest });
        return;
      case "tracker.confirmed":
        this.t(e.tracker).markConfirmed(e.boxId, e.height);
        return;
      case "exchange.staged": {
        const t = this.t(e.tracker);
        const issuer = this.p(e.issuer).pub;
        const receiver = this.p(e.receiver).pub;
        t.applyNote({ issuer, receiver, denom: e.fromDenom, totalDebt: e.fromNew, timestamp: e.timestamp, amount: e.fromNew - e.fromOld, issuerSig: e.sigs.issuerFrom, omitted: false, seq: e.seq, height: e.height, via: "exchange", memo: `exchange → ${e.toAmount} ${e.toDenom}` });
        t.exchanges.set(e.id, {
          id: e.id,
          issuer,
          receiver,
          fromDenom: e.fromDenom,
          fromOld: e.fromOld,
          fromNew: e.fromNew,
          toDenom: e.toDenom,
          toBase: e.toBase,
          toNew: e.toNew,
          timestamp: e.timestamp,
          reserveBoxId: e.reserveBoxId,
          reserveId: e.reserve,
          sigs: { ...e.sigs },
          status: "staged",
          stagedHeight: e.height,
        });
        return;
      }
      case "exchange.applied": {
        const t = this.t(e.tracker);
        const x = t.exchanges.get(e.id)!;
        t.applyNote({ issuer: x.issuer, receiver: x.receiver, denom: x.toDenom, totalDebt: x.toNew, timestamp: x.timestamp, amount: x.toNew - (x.toBase ?? 0n), issuerSig: x.sigs.issuerTo, omitted: false, seq: e.seq, height: e.height, via: "exchange", memo: `exchange ← ${x.fromOld - x.fromNew} ${x.fromDenom}` });
        x.status = "applied";
        x.resolvedHeight = e.height;
        return;
      }
      case "exchange.cancelled": {
        const x = this.t(e.tracker).exchanges.get(e.id)!;
        x.status = "cancelled";
        x.reason = e.reason;
        x.resolvedHeight = e.height;
        return;
      }
      case "tracker.status":
        this.t(e.tracker).online = e.online;
        return;
      case "tracker.censorship":
        this.t(e.tracker).censorship = { mode: e.mode, targets: e.targets === "all" ? "all" : new Set(e.targets) };
        return;
      case "tracker.policy":
        this.t(e.tracker).globalPolicy = e.policy;
        return;
      case "tracker.options":
        this.t(e.tracker).options = { ...this.t(e.tracker).options, ...e.options };
        return;
      case "policy.set": {
        const p = this.p(e.participant);
        p.policy = e.policy;
        for (const t of this.trackers.values()) {
          if (e.policy) t.policies.set(p.pub, e.policy);
          else t.policies.delete(p.pub);
        }
        return;
      }
      case "credit.set": {
        const k = `${e.creditor}|${e.debtor}|${e.denom}`;
        if (e.limit === null) this.creditLines.delete(k);
        else this.creditLines.set(k, e.limit);
        return;
      }
      case "note.issued": {
        const t = this.t(e.tracker);
        t.applyNote({
          issuer: this.p(e.issuer).pub,
          receiver: this.p(e.receiver).pub,
          denom: e.denom,
          totalDebt: e.totalDebt,
          timestamp: e.timestamp,
          amount: e.amount,
          issuerSig: e.issuerSig,
          trackerSig: e.trackerSig,
          omitted: e.omitted,
          seq: e.seq,
          height: e.height,
          via: e.via,
          memo: e.memo,
        });
        if (e.offlineRef !== undefined) this.dropOffline(e.offlineRef);
        return;
      }
      case "note.offline":
        this.offline.push({ seq: e.seq, tracker: e.tracker, issuer: e.issuer, receiver: e.receiver, denom: e.denom, amount: e.amount, totalDebt: e.totalDebt, timestamp: e.timestamp, issuerSig: e.issuerSig, memo: e.memo });
        return;
      case "waiver": {
        const t = this.trackerForPair(e.issuer, e.creditor, e.denom);
        const rec = t?.note(this.p(e.issuer).pub, this.p(e.creditor).pub, e.denom);
        if (rec) rec.waived += e.amount;
        this.waivers.push(e as EventOf<"waiver">);
        return;
      }
      case "chain.mined":
        this.clock.setHeight(e.to);
        return;
      case "reserve.created": {
        const r = new ReserveSim({
          id: e.reserve,
          contract: e.contract,
          owner: this.p(e.owner).pub,
          trackerNftId: this.t(e.tracker).nftId,
          denom: e.denom,
          value: e.value,
          tokenAmount: e.tokenAmount,
          reserveNftId: e.reserveNftId ?? undefined,
          height: e.height,
          boxId: e.boxId,
          txId: e.txId,
          avl: this.avl,
        });
        this.reserves.set(r.id, r);
        this.debit(e.owner, "erg", e.value + e.fee);
        if (e.contract === "basis-token") this.debit(e.owner, e.denom, e.tokenAmount);
        return;
      }
      case "reserve.toppedUp": {
        const r = this.r(e.reserve);
        r.applyTopUp({ amount: e.amount, boxId: e.boxId, txId: e.txId, height: e.height });
        this.debit(e.by, r.contract === "basis-token" ? r.denom : "erg", e.amount);
        this.debit(e.by, "erg", e.fee);
        return;
      }
      case "reserve.redeemed": {
        const r = this.r(e.reserve);
        const receiver = this.p(e.receiver);
        r.applyRedeem({ receiver: receiver.pub, amount: e.amount, timestamp: e.timestamp, newRedeemedTotal: e.redeemedTotal, boxId: e.boxId, txId: e.txId, height: e.height, expectDigest: e.digest });
        this.credit(e.receiver, e.denom, e.amount);
        if (e.minBox > 0n) this.credit(e.receiver, "erg", e.minBox);
        this.debit(e.feePayer, "erg", e.fee + e.minBox);
        this.t(e.tracker).applyRedemption(this.p(e.issuer).pub, receiver.pub, e.denom, e.amount, e.trackerSig || undefined);
        if (e.built) this.t(e.tracker).recordBuild(this.p(e.issuer).pub, receiver.pub, e.timeMs);
        return;
      }
      case "reserve.refundInitiated": {
        this.r(e.reserve).applyInitiateRefund({ r7: e.r7, boxId: e.boxId, txId: e.txId, height: e.height });
        const owner = this.byPub.get(this.r(e.reserve).owner)!;
        this.debit(owner.id, "erg", e.fee);
        return;
      }
      case "reserve.refundCompleted": {
        const r = this.r(e.reserve);
        const owner = this.byPub.get(r.owner)!;
        r.applyCompleteRefund({ txId: e.txId, height: e.height });
        this.credit(owner.id, "erg", e.value - e.fee);
        if (r.contract === "basis-token") this.credit(owner.id, r.denom, e.tokenAmount);
        return;
      }
      case "nostr":
        return;
      case "clearing.settled":
        return;
      default:
        return;
    }
  }

  // ======================================================================================
  // lookups
  // ======================================================================================

  /** Participant by id (throws when unknown). */
  p(id: string): Participant {
    const p = this.participants.get(id);
    if (!p) throw new Error(`unknown participant "${id}"`);
    return p;
  }

  t(id?: string | null): TrackerSim {
    const key = id ?? this.defaultTracker;
    const t = key ? this.trackers.get(key) : undefined;
    if (!t) throw new Error(id ? `unknown tracker "${id}"` : "no tracker yet: call createTracker first");
    return t;
  }

  r(id: string): ReserveSim {
    const r = this.reserves.get(id);
    if (!r) throw new Error(`unknown reserve "${id}"`);
    return r;
  }

  /** Public keys (hex) of participants: acceptance policies list issuers by key. */
  pubsOf(...ids: string[]): Hex[] {
    return ids.map((id) => this.p(id).pub);
  }

  idOf(pub: Hex): string | undefined {
    return this.byPub.get(pub)?.id;
  }

  nameOf(id: string): string {
    return this.participants.get(id)?.name ?? id;
  }

  balance(id: string, denom: DenomId = "erg"): bigint {
    return this.p(id).wallet.get(denom) ?? 0n;
  }

  private credit(id: string, denom: DenomId, amount: bigint): void {
    const w = this.p(id).wallet;
    w.set(denom, (w.get(denom) ?? 0n) + amount);
  }

  private debit(id: string, denom: DenomId, amount: bigint): void {
    this.credit(id, denom, -amount);
  }

  private trackerForPair(issuerId: string, receiverId: string, denom: DenomId): TrackerSim | undefined {
    const i = this.p(issuerId).pub;
    const r = this.p(receiverId).pub;
    for (const t of this.trackers.values()) if (t.note(i, r, denom)) return t;
    return undefined;
  }

  private dropOffline(seq: number): void {
    const i = this.offline.findIndex((o) => o.seq === seq);
    if (i >= 0) this.offline.splice(i, 1);
  }

  // ======================================================================================
  // setup
  // ======================================================================================

  addDenomination(info: DenominationInfo): DenominationInfo {
    if (!this.denominations.has(info.id)) this.emit({ type: "denomination.added", denom: info });
    return info;
  }

  addParticipant(o: { id: string; name?: string; kind?: ParticipantKind; avatarSeed?: string; secretHex?: Hex; erg?: bigint; tokens?: Array<[DenomId, bigint]>; meta?: Record<string, string> }): Participant {
    if (this.participants.has(o.id)) throw new Error(`participant "${o.id}" exists`);
    const keySource: KeySource = o.secretHex ? { source: "secret", secretHex: o.secretHex } : { source: "demo", salt: this.demoSalt, label: o.id };
    const key = keySource.source === "demo" ? cachedDemoKey(keySource.label, keySource.salt) : keyPairFromSecret(keySource.secretHex);
    if (this.byPub.has(key.pubHex)) throw new Error("key already used by another participant");
    this.emit({ type: "participant.joined", id: o.id, name: o.name ?? o.id, kind: o.kind ?? "human", avatarSeed: o.avatarSeed ?? o.id, pub: key.pubHex, key: keySource, meta: o.meta });
    if (o.erg && o.erg > 0n) this.fund(o.id, "erg", o.erg, "genesis");
    for (const [d, a] of o.tokens ?? []) this.fund(o.id, d, a, "genesis");
    return this.p(o.id);
  }

  /** Imports a real secret (sandbox only; it is stored in the event log so the run can be replayed). */
  addParticipantWithKey(o: { id: string; name?: string; kind?: ParticipantKind; key: KeyPair; erg?: bigint }): Participant {
    return this.addParticipant({ ...o, secretHex: secretToHex(o.key.secret) });
  }

  fund(id: string, denom: DenomId, amount: bigint, memo?: string): void {
    this.p(id);
    this.emit({ type: "wallet.funded", participant: id, denom, amount, memo });
  }

  setOnline(id: string, online: boolean): void {
    if (this.p(id).online !== online) this.emit({ type: "participant.status", participant: id, online });
  }

  createTracker(o: { id: string; name?: string; operator: string; nftId?: Hex; denoms?: DenomId[]; options?: Partial<TrackerOptions>; globalPolicy?: AcceptanceConfig }): TrackerSim {
    if (this.trackers.has(o.id)) throw new Error(`tracker "${o.id}" exists`);
    const op = this.p(o.operator);
    const nftId = (o.nftId ?? deriveId("tracker-nft", this.seed, o.id)).toLowerCase();
    const empty = this.avl.createMap(32).digest();
    const txId = deriveId("tx", "tracker-genesis", nftId, this.clock.height);
    this.emit({
      type: "tracker.created",
      tracker: o.id,
      name: o.name ?? o.id,
      nftId,
      operator: op.id,
      pub: op.pub,
      denoms: o.denoms ?? [],
      options: { ...DEFAULT_TRACKER_OPTIONS, ...o.options },
      globalPolicy: o.globalPolicy ?? { default: "reject", root: null, predicates: [] },
      boxId: deriveId("box", txId, 0),
      txId,
      digest: bytesToHex(empty),
    });
    return this.t(o.id);
  }

  setTrackerOptions(trackerId: string, options: Partial<TrackerOptions>): void {
    this.t(trackerId);
    this.emit({ type: "tracker.options", tracker: trackerId, options });
  }

  /** The tracker operator's [acceptance] config (used for holders without a stored policy). */
  setGlobalPolicy(trackerId: string, policy: AcceptanceConfig): void {
    this.t(trackerId);
    this.emit({ type: "tracker.policy", tracker: trackerId, policy });
  }

  /** A participant's acceptance policy: checked before accepting a note, and stored at the tracker. */
  setPolicy(id: string, policy: AcceptanceConfig | null): void {
    this.p(id);
    this.emit({ type: "policy.set", participant: id, policy });
  }

  /** creditor accepts debtor's notes while debtor's OUTSTANDING debt to creditor stays ≤ limit (per denomination). */
  setCreditLine(creditor: string, debtor: string, limit: bigint | null, denom: DenomId = "erg"): void {
    this.p(creditor);
    this.p(debtor);
    this.emit({ type: "credit.set", creditor, debtor, denom, limit });
  }

  creditLine(creditor: string, debtor: string, denom: DenomId = "erg"): bigint | null {
    return this.creditLines.get(`${creditor}|${debtor}|${denom}`) ?? null;
  }

  annotate(text: string, level: "info" | "warn" = "info"): void {
    this.emit({ type: "annotation", text, level });
  }

  markStep(scenario: string, index: number, title: string, text: string): EconomyEvent {
    return this.emit({ type: "scenario.step", scenario, index, title, text });
  }

  // ======================================================================================
  // payments
  // ======================================================================================

  /** Gross debt and reserve snapshot that the tracker's acceptance check would use. */
  private acceptanceContext(issuer: Participant, receiver: Participant, denom: DenomId, candidateTotal: bigint, tracker: TrackerSim) {
    const views = this.reserveViews(tracker).filter((v) => v.active && v.owner === issuer.pub && v.denom === denom);
    const notes = tracker.notesOfIssuer(issuer.pub, denom);
    let gross = 0n;
    let replaced = false;
    for (const n of notes) {
      let edge = n.totalDebt;
      if (n.receiver === receiver.pub) {
        edge = edge > candidateTotal ? edge : candidateTotal;
        replaced = true;
      }
      gross += edge;
    }
    if (!replaced) gross += candidateTotal;
    return {
      issuer: issuer.pub,
      recipient: receiver.pub,
      totalDebt: candidateTotal,
      denom,
      reserve: views.length ? { collateral: views.length === 1 ? views[0].collateral : 0n, refundPending: views.some((v) => v.refundPending), count: views.length } : null,
      issuerGrossDebt: gross,
    };
  }

  /** Checks a would-be note against the receiver's policy and credit line (no state change). */
  checkAcceptance(o: { from: string; to: string; amount: bigint; denom?: DenomId; tracker?: string }): { ok: boolean; by?: "receiver" | "credit-line"; code?: string; message?: string; acceptance?: AcceptanceResult } {
    const from = this.p(o.from);
    const to = this.p(o.to);
    const denom = o.denom ?? "erg";
    const tracker = this.t(o.tracker);
    const prev = this.issuerLocalTotal(tracker, from, to, denom);
    const total = prev + o.amount;
    let acceptance: AcceptanceResult | undefined;
    if (to.policy) {
      acceptance = evaluateAcceptance(to.policy, this.acceptanceContext(from, to, denom, total, tracker), "per-recipient");
      if (!acceptance.acceptable) return { ok: false, by: "receiver", code: "policy-rejected", message: acceptance.reason ?? "rejected by the receiver's policy", acceptance };
    }
    const limit = this.creditLine(to.id, from.id, denom);
    if (limit !== null) {
      const rec = tracker.note(from.pub, to.pub, denom);
      const redeemed = rec?.amountRedeemed ?? 0n;
      const waived = rec?.waived ?? 0n;
      const after = total - redeemed - waived;
      if (after > limit) return { ok: false, by: "credit-line", code: "credit-limit", message: `credit line ${limit} exceeded: outstanding would be ${after}`, acceptance };
    }
    return { ok: true, acceptance };
  }

  /** The issuer's own view of the cumulative total (includes notes signed offline, not yet synced). */
  private issuerLocalTotal(tracker: TrackerSim, from: Participant, to: Participant, denom: DenomId): bigint {
    let total = tracker.note(from.pub, to.pub, denom)?.totalDebt ?? 0n;
    for (const o of this.offline) if (o.tracker === tracker.id && o.issuer === from.id && o.receiver === to.id && o.denom === denom && o.totalDebt > total) total = o.totalDebt;
    return total;
  }

  /**
   * A payment: the issuer signs the new cumulative note, the receiver's policy/credit line accepts it, the
   * tracker runs every add_note check and witnesses it.
   */
  pay(o: PayOptions): PayResult {
    const from = this.p(o.from);
    const to = this.p(o.to);
    const denom = o.denom ?? "erg";
    const tracker = this.t(o.tracker);
    const via: NoteVia = o.via ?? (from.id === to.id ? "self-note" : "pay");
    const rejected = (by: Body<"note.rejected">["by"], code: string, message: string, extra: Partial<Body<"note.rejected">> = {}, acceptance?: AcceptanceResult): PayResult => {
      const event = this.emit({ type: "note.rejected", tracker: tracker.id, issuer: from.id, receiver: to.id, denom, amount: o.amount, by, code, message, via, ...extra });
      return { ok: false, event, code, message, acceptance };
    };
    if (o.amount <= 0n && o.totalDebt === undefined) return rejected("issuer", "invalid-amount", "amount must be positive");
    if (!this.denominations.has(denom)) return rejected("issuer", "unknown-denomination", `unknown denomination ${denom}`);
    if (!from.online) return rejected("issuer", "issuer-offline", `${from.name} is offline (mesh mode): use payOffline and sync later`);
    if (from.id !== to.id && !o.skipAcceptance) {
      const acc = this.checkAcceptance({ from: from.id, to: to.id, amount: o.amount, denom, tracker: tracker.id });
      if (!acc.ok) return rejected(acc.by!, acc.code!, acc.message!, {}, acc.acceptance);
    }
    const prev = this.issuerLocalTotal(tracker, from, to, denom);
    const totalDebt = o.totalDebt ?? prev + o.amount;
    const timestamp = o.timestamp ?? this.clock.tick();
    const nft = o.trackerNftId ?? tracker.nftId;
    const eager = !this.lazy || !!o.signature || !!o.trackerNftId;
    const sig = o.signature ?? (eager ? sign(noteMessage(debtKey(from.pub, to.pub, denom), totalDebt, timestamp, nft), from.key) : null);
    const check = tracker.checkNote({ issuer: from.pub, receiver: to.pub, denom, totalDebt, timestamp, trackerNftId: nft, issuerSig: sig }, this.clock.nowMs());
    if (!check.ok) return rejected("tracker", check.code, check.message, { totalDebt, timestamp });
    const trackerSig = tracker.options.coSign === "on-submit" && !this.lazy ? bytesToHex(tracker.coSign({ key: check.key }, totalDebt, timestamp)) : null;
    const event = this.emit(
      {
        type: "note.issued",
        tracker: tracker.id,
        issuer: from.id,
        receiver: to.id,
        denom,
        amount: totalDebt - (tracker.note(from.pub, to.pub, denom)?.totalDebt ?? 0n),
        totalDebt,
        timestamp,
        key: check.key,
        issuerSig: sig ? bytesToHex(sig) : null,
        trackerSig,
        omitted: check.omitted,
        via,
        memo: o.memo,
      },
      timestamp,
    );
    this.publishNote(tracker, from, denom, (event as EventOf<"note.issued">).amount);
    return { ok: true, event, record: tracker.noteByKey(check.key) };
  }

  /** A→A note: the owner's claim on its own reserve (partial withdrawal, gated by the tracker at redemption). */
  selfNote(o: { who: string; amount: bigint; denom?: DenomId; tracker?: string; memo?: string }): PayResult {
    return this.pay({ from: o.who, to: o.who, amount: o.amount, denom: o.denom, tracker: o.tracker, memo: o.memo ?? "self-note (partial withdrawal)", via: "self-note" });
  }

  /**
   * tracker_protocol.md alerts: published when a note makes the issuer's outstanding debt cross 80 % or 100 %
   * of its collateral (edge-triggered, so the alert state needs no storage and replays exactly).
   */
  private publishNote(tracker: TrackerSim, from: Participant, denom: DenomId, increase: bigint): void {
    if (increase <= 0n) return;
    const cov = this.coverage(from.id, denom, tracker.id);
    if (cov.collateral <= 0n) return;
    const after = Number(cov.liabilities) / Number(cov.collateral);
    const before = Number(cov.liabilities - increase) / Number(cov.collateral);
    if (before < 1.0 && after >= 1.0) this.emit({ type: "nostr", tracker: tracker.id, kind: "alert-100", issuer: from.id, denom, ratio: after, inServer: false });
    else if (before < 0.8 && after >= 0.8) this.emit({ type: "nostr", tracker: tracker.id, kind: "alert-80", issuer: from.id, denom, ratio: after, inServer: false });
  }

  /**
   * Novation (contract comments, "Debt Transfer"): B pays C with part of A's debt. A signs a new A→C note
   * (+amount); the A→B total stays (totals never decrease) and B records a waiver — a promise the contract
   * cannot enforce.
   */
  novate(o: { issuer: string; from: string; to: string; amount: bigint; denom?: DenomId; tracker?: string; memo?: string }): PayResult {
    const denom = o.denom ?? "erg";
    const tracker = this.t(o.tracker);
    const A = this.p(o.issuer);
    const B = this.p(o.from);
    const C = this.p(o.to);
    const ab = tracker.note(A.pub, B.pub, denom);
    const available = ab ? outstandingOf(ab) - ab.waived : 0n;
    if (o.amount <= 0n || o.amount > available) {
      const event = this.emit({ type: "note.rejected", tracker: tracker.id, issuer: A.id, receiver: C.id, denom, amount: o.amount, by: "issuer", code: "novation-exceeds", message: `${B.name} holds only ${available} of ${A.name}'s debt to transfer`, via: "novation" });
      return { ok: false, event, code: "novation-exceeds", message: `${B.name} holds only ${available}` };
    }
    const r = this.pay({ from: A.id, to: C.id, amount: o.amount, denom, tracker: tracker.id, via: "novation", memo: o.memo ?? `novation: ${B.name}'s claim → ${C.name}` });
    if (!r.ok) return r;
    this.emit({ type: "waiver", creditor: B.id, issuer: A.id, denom, amount: o.amount, reason: "novation", beneficiary: C.id, ref: r.event.seq });
    return r;
  }

  /**
   * POST /notes/exchange (two-phase, issues #17/#20): issuer and receiver agree to lower the receiver's claim
   * in `from` and raise it in `to` (e.g. 40 ERG of claim → 100 USE of claim). Phase 1 (now): the from-edge
   * decrease is applied — the only decrease the tracker ever accepts, because the creditor co-signs it. Phase 2
   * (a later updater cycle, once the decrease is committed AND confirmed): the to-edge increase is applied,
   * or the exchange is cancelled if the from-reserve box was spent meanwhile (any redemption, top-up — anyone
   * may top up — or refund) or the to-edge moved. A cancel restores nothing: the creditor keeps the lowered
   * from-edge and loses the increase.
   */
  exchange(o: { issuer: string; receiver: string; from: DenomId; fromAmount: bigint; to: DenomId; toAmount: bigint; tracker?: string }): ExchangeOutcome {
    const tracker = this.t(o.tracker);
    const A = this.p(o.issuer);
    const B = this.p(o.receiver);
    const refuse = (code: string, http: number, message: string): ExchangeOutcome => {
      const event = this.emit({ type: "exchange.rejected", tracker: tracker.id, issuer: A.id, receiver: B.id, fromDenom: o.from, fromAmount: o.fromAmount, toDenom: o.to, toAmount: o.toAmount, code, http, message });
      return { ok: false, code, message, event };
    };
    if (!tracker.online) return refuse("tracker-offline", 503, "tracker unreachable");
    if (o.from === o.to) return refuse("invalid-exchange", 400, "from_denomination and to_denomination must differ");
    for (const d of [o.from, o.to]) if (!tracker.denoms.has(d)) return refuse("invalid-denomination", 400, `invalid denomination: ${d} is not served by this tracker`);
    const reserves = this.reservesOf(A.id, o.from).filter((r) => r.active && r.trackerNftId === tracker.nftId);
    if (reserves.length === 0) return refuse("no-reserve", 409, `issuer ${A.pub} has no tracked reserve in denomination ${o.from}; exchanges require a tracked from-denomination reserve`);
    if (reserves.length > 1) return refuse("multiple-reserves", 409, `issuer has ${reserves.length} tracked reserves in ${o.from}; the exchange needs exactly one to observe`);
    const reserve = reserves[0];
    const fromNote = tracker.note(A.pub, B.pub, o.from);
    const toNote = tracker.note(A.pub, B.pub, o.to);
    if (tracker.globalPolicy.predicates.length > 0) {
      const ctx = this.acceptanceContext(A, B, o.to, (toNote?.totalDebt ?? 0n) + o.toAmount, tracker);
      const acc = evaluateAcceptance(tracker.globalPolicy, ctx, "global");
      if (!acc.acceptable) return refuse("exchange-policy-rejected", 400, `rejected by acceptance policy '${acc.root ?? "default"}' in the target denomination`);
    }
    if (o.fromAmount <= 0n || o.toAmount <= 0n) return refuse("invalid-exchange", 400, "exchange amounts must be positive");
    const staged = tracker.stagedExchange(A.pub, B.pub);
    if (staged) return refuse("invalid-exchange", 400, `another exchange for this issuer/recipient pair is already staged (from ${staged.fromDenom} to ${staged.toDenom}); it resolves after the next tracker box commit`);
    if (!fromNote) return refuse("not-found", 404, "Note not found");
    const fromNew = fromNote.totalDebt - o.fromAmount;
    if (fromNew < 0n) return refuse("invalid-exchange", 400, "from_amount is larger than the from-edge total (AmountOverflow)");
    if (fromNew < fromNote.amountRedeemed) return refuse("invalid-exchange", 400, `exchange would lower the from-edge total (${fromNew}) below its already-redeemed amount (${fromNote.amountRedeemed})`);
    const toNew = (toNote?.totalDebt ?? 0n) + o.toAmount;
    const timestamp = this.clock.tick();
    if (timestamp <= fromNote.timestamp || (toNote && timestamp <= toNote.timestamp)) return refuse("past-timestamp", 400, "Past timestamp");
    for (const [field, v] of [["from_new_total", fromNew], ["to_new_total", toNew]] as const) {
      if (v > (1n << 63n) - 1n) return refuse("amount-exceeds-contract-range", 400, `${field} exceeds the range the on-chain contract can represent: ${v}`);
    }
    let sigs: EventOf<"exchange.staged">["sigs"] = { issuerFrom: null, receiverFrom: null, issuerTo: null, receiverTo: null };
    if (!this.lazy) {
      const s4 = this.exchangeSignatureSet(tracker, A, B, o.from, fromNew, o.to, toNew, timestamp);
      sigs = { issuerFrom: bytesToHex(s4.issuerFrom), receiverFrom: bytesToHex(s4.receiverFrom), issuerTo: bytesToHex(s4.issuerTo), receiverTo: bytesToHex(s4.receiverTo) };
    }
    const id = deriveId("exchange", tracker.nftId, A.pub, B.pub, o.from, o.to, timestamp).slice(0, 32);
    const event = this.emit(
      {
        type: "exchange.staged",
        tracker: tracker.id,
        id,
        issuer: A.id,
        receiver: B.id,
        fromDenom: o.from,
        fromAmount: o.fromAmount,
        fromOld: fromNote.totalDebt,
        fromNew,
        toDenom: o.to,
        toAmount: o.toAmount,
        toBase: toNote ? toNote.totalDebt : null,
        toNew,
        timestamp,
        reserve: reserve.id,
        reserveBoxId: reserve.box!.boxId,
        sigs,
      },
      timestamp,
    );
    return { ok: true, event, exchange: tracker.exchanges.get(id) };
  }

  /** The four exchange signatures (both parties sign both new edge states), materialised on demand. */
  exchangeSignatures(trackerId: string | undefined, id: string): { msgFrom: Uint8Array; msgTo: Uint8Array; issuerFrom: Uint8Array; receiverFrom: Uint8Array; issuerTo: Uint8Array; receiverTo: Uint8Array; allValid: boolean } {
    const t = this.t(trackerId);
    const x = t.exchanges.get(id);
    if (!x) throw new Error(`unknown exchange ${id}`);
    const A = this.byPub.get(x.issuer)!;
    const B = this.byPub.get(x.receiver)!;
    const s4 = this.exchangeSignatureSet(t, A, B, x.fromDenom, x.fromNew, x.toDenom, x.toNew, x.timestamp);
    x.sigs = { issuerFrom: bytesToHex(s4.issuerFrom), receiverFrom: bytesToHex(s4.receiverFrom), issuerTo: bytesToHex(s4.issuerTo), receiverTo: bytesToHex(s4.receiverTo) };
    const allValid =
      verify(A.pub, s4.msgFrom, s4.issuerFrom).ok && verify(B.pub, s4.msgFrom, s4.receiverFrom).ok && verify(A.pub, s4.msgTo, s4.issuerTo).ok && verify(B.pub, s4.msgTo, s4.receiverTo).ok;
    return { ...s4, allValid };
  }

  private exchangeSignatureSet(t: TrackerSim, A: Participant, B: Participant, from: DenomId, fromNew: bigint, to: DenomId, toNew: bigint, ts: bigint) {
    const msgFrom = noteMessage(debtKey(A.pub, B.pub, from), fromNew, ts, t.nftId);
    const msgTo = noteMessage(debtKey(A.pub, B.pub, to), toNew, ts, t.nftId);
    return { msgFrom, msgTo, issuerFrom: sign(msgFrom, A.key), receiverFrom: sign(msgFrom, B.key), issuerTo: sign(msgTo, A.key), receiverTo: sign(msgTo, B.key) };
  }

  /** App-level waiver signature (NOT a Basis message; nothing on-chain verifies it). */
  waiverSignature(w: EventOf<"waiver">): Uint8Array {
    const creditor = this.p(w.creditor);
    const issuer = this.p(w.issuer);
    const msg = blake2b256(utf8("basis-sandbox/waiver/v1"), debtKey(issuer.pub, creditor.pub, w.denom), utf8(`${w.amount}|${w.seq}`));
    return sign(msg, creditor.key);
  }

  // ---------- mesh / offline ----------

  /** The issuer signs a cumulative note without reaching the tracker (mesh, no internet). */
  payOffline(o: { from: string; to: string; amount: bigint; denom?: DenomId; tracker?: string; memo?: string }): { ok: boolean; event: EconomyEvent; code?: string; message?: string } {
    const from = this.p(o.from);
    const to = this.p(o.to);
    const denom = o.denom ?? "erg";
    const tracker = this.t(o.tracker);
    if (from.id !== to.id) {
      const acc = this.checkAcceptance({ from: from.id, to: to.id, amount: o.amount, denom, tracker: tracker.id });
      if (!acc.ok) {
        const event = this.emit({ type: "note.rejected", tracker: tracker.id, issuer: from.id, receiver: to.id, denom, amount: o.amount, by: acc.by!, code: acc.code!, message: acc.message!, via: "sync" });
        return { ok: false, event, code: acc.code, message: acc.message };
      }
    }
    const totalDebt = this.issuerLocalTotal(tracker, from, to, denom) + o.amount;
    const timestamp = this.clock.tick();
    const sig = this.lazy ? null : bytesToHex(sign(noteMessage(debtKey(from.pub, to.pub, denom), totalDebt, timestamp, tracker.nftId), from.key));
    const event = this.emit({ type: "note.offline", tracker: tracker.id, issuer: from.id, receiver: to.id, denom, amount: o.amount, totalDebt, timestamp, issuerSig: sig, memo: o.memo }, timestamp);
    return { ok: true, event };
  }

  /** Submits queued offline notes to the tracker in signing order. */
  syncOffline(filter?: (n: OfflineNote) => boolean): PayResult[] {
    const queue = this.offline.filter((n) => !filter || filter(n)).sort((a, b) => a.seq - b.seq);
    const out: PayResult[] = [];
    for (const n of queue) {
      const tracker = this.t(n.tracker);
      const from = this.p(n.issuer);
      const to = this.p(n.receiver);
      const key = debtKey(from.pub, to.pub, n.denom);
      const sig = n.issuerSig ? hexToBytes(n.issuerSig) : this.lazy ? null : sign(noteMessage(key, n.totalDebt, n.timestamp, tracker.nftId), from.key);
      const check = tracker.checkNote({ issuer: from.pub, receiver: to.pub, denom: n.denom, totalDebt: n.totalDebt, timestamp: n.timestamp, trackerNftId: tracker.nftId, issuerSig: sig }, this.clock.nowMs());
      if (!check.ok) {
        const event = this.emit({ type: "note.rejected", tracker: tracker.id, issuer: from.id, receiver: to.id, denom: n.denom, amount: n.amount, totalDebt: n.totalDebt, timestamp: n.timestamp, by: "tracker", code: check.code, message: check.message, via: "sync", offlineRef: n.seq });
        out.push({ ok: false, event, code: check.code, message: check.message });
        continue;
      }
      const event = this.emit({
        type: "note.issued",
        tracker: tracker.id,
        issuer: from.id,
        receiver: to.id,
        denom: n.denom,
        amount: n.totalDebt - (tracker.note(from.pub, to.pub, n.denom)?.totalDebt ?? 0n),
        totalDebt: n.totalDebt,
        timestamp: n.timestamp,
        key: check.key,
        issuerSig: sig ? bytesToHex(sig) : null,
        trackerSig: null,
        omitted: check.omitted,
        via: "sync",
        memo: n.memo,
        offlineRef: n.seq,
      });
      this.publishNote(tracker, from, n.denom, (event as EventOf<"note.issued">).amount);
      out.push({ ok: true, event, record: tracker.noteByKey(check.key) });
    }
    return out;
  }

  // ======================================================================================
  // chain: blocks, tracker updater
  // ======================================================================================

  private alignedNext(h: number, interval: number): number {
    const g = this.clock.genesisHeight;
    return g + (Math.floor((h - g) / interval) + 1) * interval;
  }

  private alignedLastAtOrBefore(h: number, interval: number): number {
    const g = this.clock.genesisHeight;
    return g + Math.floor((h - g) / interval) * interval;
  }

  /** Something will happen at this tracker's next updater cycles (otherwise mining can jump). */
  private updaterBusy(t: TrackerSim): boolean {
    if (!t.online) return false;
    const box = t.currentBox();
    if (box && box.confirmedHeight === null) return true;
    for (const x of t.exchanges.values()) if (x.status === "staged") return true;
    return t.options.autoCommit && box?.digest !== bytesToHex(t.digest());
  }

  /**
   * One run of tracker_box_updater at block `h`, in the server's order: (1) a submitted box that is deep
   * enough is confirmed (its notes become Confirmed); a box not yet deep enough ends the cycle; (2) staged
   * exchanges are applied or cancelled (phase 2); (3) a new box is submitted when the digest changed.
   */
  private updaterCycle(t: TrackerSim, h: number, advance: (to: number) => void): void {
    const box = t.currentBox();
    if (box && box.confirmedHeight === null) {
      if (!t.depthReached(box, h)) return;
      advance(h);
      this.emit({ type: "tracker.confirmed", tracker: t.id, boxId: box.boxId, depth: h - box.creationHeight + 1 });
    }
    this.processExchanges(t, advance, h);
    if (t.options.autoCommit && t.currentBox()?.digest !== bytesToHex(t.digest())) {
      advance(h);
      this.commit(t.id);
    }
  }

  private processExchanges(t: TrackerSim, advance: (to: number) => void, h: number): void {
    for (const x of [...t.exchanges.values()]) {
      if (x.status !== "staged") continue;
      const r = this.reserves.get(x.reserveId);
      const d = t.decideExchange(x, r && r.active ? r.box!.boxId : null);
      if (d.decision === "wait") continue;
      advance(h);
      if (d.decision === "apply") this.emit({ type: "exchange.applied", tracker: t.id, id: x.id });
      else this.emit({ type: "exchange.cancelled", tracker: t.id, id: x.id, reason: d.reason });
    }
  }

  /**
   * Mines `blocks` blocks. Every tracker's updater runs once per `commitIntervalBlocks` (600 s = 5 blocks,
   * aligned to genesis) and does what the real one does (updaterCycle). The real updater never recreates
   * a box for an unchanged digest; with skipIfUnchanged = false a heartbeat box is recorded at the last
   * cycle of the jump (the emergency clock only depends on the latest box).
   */
  mine(blocks = 1): void {
    if (blocks <= 0) return;
    const start = this.clock.height;
    const target = start + blocks;
    let emittedTo = start;
    const advance = (to: number) => {
      if (to > emittedTo) {
        this.emit({ type: "chain.mined", from: emittedTo, to });
        emittedTo = to;
      }
    };
    let h = start;
    for (;;) {
      let next = Infinity;
      for (const t of this.trackers.values()) {
        if (!this.updaterBusy(t)) continue;
        const b = this.alignedNext(h, t.options.commitIntervalBlocks);
        if (b < next) next = b;
      }
      if (next > target) break;
      h = next;
      for (const t of this.trackers.values()) {
        if ((h - this.clock.genesisHeight) % t.options.commitIntervalBlocks !== 0 || !this.updaterBusy(t)) continue;
        this.updaterCycle(t, h, advance);
      }
    }
    // heartbeat trackers (hypothetical: the real updater skips unchanged digests)
    for (const t of this.trackers.values()) {
      if (!t.online || !t.options.autoCommit || t.options.skipIfUnchanged) continue;
      const last = this.alignedLastAtOrBefore(target, t.options.commitIntervalBlocks);
      const box = t.currentBox();
      if (last <= start || !box || box.creationHeight >= last) continue;
      advance(last);
      if (box.confirmedHeight === null && t.depthReached(box, last)) this.emit({ type: "tracker.confirmed", tracker: t.id, boxId: box.boxId, depth: last - box.creationHeight + 1 });
      this.commit(t.id, { force: true });
    }
    advance(target);
  }

  /** Mines until the given height. */
  mineTo(height: number): void {
    if (height > this.clock.height) this.mine(height - this.clock.height);
  }

  /** Recreates the tracker box now (the operator can always force it). Returns null when there is nothing to do. */
  commit(trackerId?: string, o: { force?: boolean } = {}): TrackerBoxRecord | null {
    const t = this.t(trackerId);
    if (!t.online) return null;
    const plan = t.planCommit(this.clock.height, o.force);
    if (!plan) return null;
    const prev = t.currentBox();
    if (prev && prev.creationHeight === this.clock.height && prev.digest === plan.digest) return null;
    const txId = deriveId("tx", "tracker-update", t.nftId, this.clock.height, this.events.length);
    this.emit({ type: "tracker.committed", tracker: t.id, boxId: deriveId("box", txId, 0), txId, prevBoxId: prev?.boxId ?? null, creationHeight: this.clock.height, digest: plan.digest, notes: plan.notes, heartbeat: prev?.digest === plan.digest });
    this.emit({ type: "nostr", tracker: t.id, kind: "commitment", digest: plan.digest, inServer: false });
    return t.currentBox()!;
  }

  /** The tracker goes dark: no more commitments, no signatures, no new notes. */
  disappear(trackerId?: string, reason = "operator vanished"): void {
    const t = this.t(trackerId);
    if (t.online) this.emit({ type: "tracker.status", tracker: t.id, online: false, reason });
  }

  reappear(trackerId?: string): void {
    const t = this.t(trackerId);
    if (!t.online) this.emit({ type: "tracker.status", tracker: t.id, online: true });
  }

  /** "refuse": the tracker rejects notes of the targets. "omit": it answers OK but keeps them out of its tree. */
  setCensorship(trackerId: string | undefined, mode: CensorshipMode, targets: string[] | "all" = "all"): void {
    const t = this.t(trackerId);
    this.emit({ type: "tracker.censorship", tracker: t.id, mode, targets: targets === "all" ? "all" : targets.map((id) => this.p(id).pub) });
  }

  // ======================================================================================
  // reserves
  // ======================================================================================

  reserveViews(tracker?: TrackerSim): ReserveView[] {
    const out: ReserveView[] = [];
    for (const r of this.reserves.values()) {
      if (tracker && r.trackerNftId !== tracker.nftId) continue;
      out.push({ id: r.id, owner: r.owner, denom: r.denom, collateral: r.collateral(), refundPending: r.refundPending(), active: r.active });
    }
    return out;
  }

  reservesOf(id: string, denom?: DenomId): ReserveSim[] {
    const pub = this.p(id).pub;
    return [...this.reserves.values()].filter((r) => r.owner === pub && (!denom || r.denom === denom));
  }

  /** Opens a reserve box (basis.es for ERG, basis-token.es for a token denomination). */
  createReserve(o: { owner: string; amount: bigint; denom?: DenomId; tracker?: string; id?: string; ergValue?: bigint }): ActionOutcome {
    const owner = this.p(o.owner);
    const tracker = this.t(o.tracker);
    const denom = o.denom ?? "erg";
    const contract: ReserveContract = denom === "erg" ? "basis" : "basis-token";
    const id = o.id ?? `${owner.id}-${this.denominations.get(denom)?.symbol.toLowerCase() ?? "res"}-${this.reservesOf(owner.id).length + 1}`;
    if (this.reserves.has(id)) throw new Error(`reserve "${id}" exists`);
    const value = contract === "basis" ? o.amount : o.ergValue ?? MIN_BOX_VALUE_NANOERG;
    const fail = (code: string, message: string): ActionOutcome => {
      const event = this.emit({ type: "action.rejected", reserve: id, action: "create", by: owner.id, code, message });
      return { ok: false, code, message, event };
    };
    if (o.amount <= 0n) return fail("invalid-amount", "amount must be positive");
    if (this.balance(owner.id, "erg") < value + MINER_FEE_NANOERG) return fail("insufficient-funds", `${owner.name} needs ${value + MINER_FEE_NANOERG} nanoERG`);
    if (contract === "basis-token" && this.balance(owner.id, denom) < o.amount) return fail("insufficient-funds", `${owner.name} needs ${o.amount} token units`);
    const txId = deriveId("tx", "reserve-create", owner.pub, id, this.events.length);
    const boxId = deriveId("box", txId, 0);
    const event = this.emit({
      type: "reserve.created",
      reserve: id,
      owner: owner.id,
      tracker: tracker.id,
      denom,
      contract,
      value,
      tokenAmount: contract === "basis-token" ? o.amount : 0n,
      boxId,
      txId,
      reserveNftId: contract === "basis-token" ? deriveId("reserve-nft", txId) : null,
      digest: bytesToHex(this.avl.createMap(32).digest()),
      fee: MINER_FEE_NANOERG,
    });
    return { ok: true, event, reserve: this.r(id) };
  }

  /** Anyone can top up (≥ 0.1 ERG, or ≥ 1 token unit). */
  topUp(o: { reserve: string; amount: bigint; by?: string }): ActionOutcome {
    const r = this.r(o.reserve);
    const by = this.p(o.by ?? this.idOf(r.owner)!);
    const fail = (code: string, message: string, ev?: ReserveEval): ActionOutcome => {
      const event = this.emit({ type: "action.rejected", reserve: r.id, action: "top-up", by: by.id, code, message, failed: ev?.failed });
      return { ok: false, code, message, event, eval: ev };
    };
    if (!r.active) return fail("reserve-closed", "the reserve was refunded and no longer exists");
    const unit: DenomId = r.contract === "basis-token" ? r.denom : "erg";
    if (this.balance(by.id, unit) < o.amount || this.balance(by.id, "erg") < MINER_FEE_NANOERG + (unit === "erg" ? o.amount : 0n)) return fail("insufficient-funds", `${by.name} cannot pay ${o.amount} + fee`);
    const tx = r.buildTopUp(o.amount, by.pub, this.clock.height, String(this.events.length));
    const ev = r.evaluate(tx);
    if (!ev.ok) return fail(ev.error?.check ?? "contract", ev.error?.message ?? "contract rejected the top-up", ev);
    const prevBoxId = r.box!.boxId;
    const event = this.emit({ type: "reserve.toppedUp", reserve: r.id, by: by.id, amount: o.amount, boxId: tx.outputs[0].boxId, prevBoxId, txId: tx.id, fee: MINER_FEE_NANOERG });
    this.emit({ type: "nostr", tracker: this.trackerOfReserve(r).id, kind: "reserve-top-up", reserve: r.id, amount: o.amount, inServer: true });
    return { ok: true, event, eval: ev, tx, reserve: r };
  }

  private trackerOfReserve(r: ReserveSim): TrackerSim {
    for (const t of this.trackers.values()) if (t.nftId === r.trackerNftId) return t;
    throw new Error(`no tracker for reserve ${r.id}`);
  }

  /** Owner announces exit: R7 := r7 (≥ HEIGHT). Holders have 43 200 blocks (~60 days) to redeem. */
  initiateRefund(o: { reserve: string; r7?: bigint; signer?: string }): ActionOutcome {
    const r = this.r(o.reserve);
    const signer = o.signer ? this.p(o.signer) : this.byPub.get(r.owner)!;
    const fail = (code: string, message: string, ev?: ReserveEval): ActionOutcome => {
      const event = this.emit({ type: "action.rejected", reserve: r.id, action: "initiate-refund", by: signer.id, code, message, failed: ev?.failed });
      return { ok: false, code, message, event, eval: ev };
    };
    if (!r.active) return fail("reserve-closed", "the reserve no longer exists");
    const r7 = o.r7 ?? BigInt(this.clock.height);
    const tx = r.buildInitiateRefund(r7, this.clock.height, [signer.pub]);
    const ev = r.evaluate(tx);
    if (!ev.ok) return fail(ev.error?.check ?? "contract", ev.error?.message ?? "contract rejected", ev);
    const event = this.emit({ type: "reserve.refundInitiated", reserve: r.id, r7, boxId: tx.outputs[0].boxId, prevBoxId: r.box!.boxId, txId: tx.id, fee: MINER_FEE_NANOERG });
    return { ok: true, event, eval: ev, tx, reserve: r };
  }

  /** After R7 + 43 200 blocks the owner takes everything. */
  completeRefund(o: { reserve: string; signer?: string }): ActionOutcome {
    const r = this.r(o.reserve);
    const signer = o.signer ? this.p(o.signer) : this.byPub.get(r.owner)!;
    const fail = (code: string, message: string, ev?: ReserveEval): ActionOutcome => {
      const event = this.emit({ type: "action.rejected", reserve: r.id, action: "complete-refund", by: signer.id, code, message, failed: ev?.failed });
      return { ok: false, code, message, event, eval: ev };
    };
    if (!r.active) return fail("reserve-closed", "the reserve no longer exists");
    const tx = r.buildCompleteRefund(this.clock.height, [signer.pub]);
    const ev = r.evaluate(tx);
    if (!ev.ok) {
      const unlock = r.refundUnlockHeight();
      return fail(ev.error?.check ?? "contract", unlock && this.clock.height < unlock ? `refund unlocks at height ${unlock} (${unlock - this.clock.height} blocks to go)` : ev.error?.message ?? "contract rejected", ev);
    }
    const event = this.emit({ type: "reserve.refundCompleted", reserve: r.id, value: r.box!.value, tokenAmount: r.contract === "basis-token" ? r.box!.tokens[1].amount : 0n, txId: tx.id, fee: MINER_FEE_NANOERG });
    return { ok: true, event, eval: ev, tx, reserve: r };
  }

  // ======================================================================================
  // redemption
  // ======================================================================================

  /** Issuer signature for one version (materialised on demand; cached in the record). */
  issuerSignature(rec: NoteRecord, v: NoteVersion = rec.history[rec.history.length - 1]): Uint8Array {
    if (v.issuerSig) return hexToBytes(v.issuerSig);
    const t = this.t(rec.tracker);
    const issuer = this.byPub.get(rec.issuer)!;
    const sig = sign(noteMessage(hexToBytes(rec.key), v.totalDebt, v.timestamp, t.nftId), issuer.key);
    v.issuerSig = bytesToHex(sig);
    if (v === rec.history[rec.history.length - 1]) rec.issuerSig = v.issuerSig;
    return sig;
  }

  /** Both signatures of a note version, verified; the tracker signature is a preview unless it was handed out. */
  signatures(rec: NoteRecord, o: { version?: number; includeTracker?: boolean } = {}): NoteSignatures {
    const v = rec.history[o.version ?? rec.history.length - 1];
    const t = this.t(rec.tracker);
    const message = noteMessage(hexToBytes(rec.key), v.totalDebt, v.timestamp, t.nftId);
    const issuerSig = this.issuerSignature(rec, v);
    let trackerSig: Uint8Array | null = null;
    let src: NoteSignatures["trackerSigSource"] = null;
    if (rec.trackerSig && rec.trackerSigFor && rec.trackerSigFor.totalDebt === v.totalDebt && rec.trackerSigFor.timestamp === v.timestamp) {
      trackerSig = hexToBytes(rec.trackerSig);
      src = "handed-out";
    } else if (o.includeTracker) {
      trackerSig = t.coSign(rec, v.totalDebt, v.timestamp);
      src = "preview";
    }
    return { message, issuerSig, issuerSigOk: verify(rec.issuer, message, issuerSig).ok, trackerSig, trackerSigSource: src, version: v };
  }

  /** Signature X-ray of a note version (issuer signature, or the tracker's). */
  xray(rec: NoteRecord, o: { version?: number; who?: "issuer" | "tracker" } = {}): SignatureXray {
    const s = this.signatures(rec, { version: o.version, includeTracker: o.who === "tracker" });
    if (o.who === "tracker") return explain(this.t(rec.tracker).pub, s.message, s.trackerSig!);
    return explain(rec.issuer, s.message, s.issuerSig);
  }

  /** Signs pending versions until `budgetMs` is spent (call from requestIdleCallback). Returns how many. */
  materialize(budgetMs = 8, latestOnly = true): number {
    const t0 = Date.now();
    let n = 0;
    for (const t of this.trackers.values()) {
      for (const rec of t.notes.values()) {
        const versions = latestOnly ? [rec.history[rec.history.length - 1]] : rec.history;
        for (const v of versions) {
          if (v.issuerSig) continue;
          this.issuerSignature(rec, v);
          n++;
          if (Date.now() - t0 >= budgetMs) return n;
        }
      }
    }
    return n;
  }

  /** How many note versions still wait for their (deterministic) signature. */
  pendingSignatures(latestOnly = true): number {
    let n = 0;
    for (const t of this.trackers.values())
      for (const rec of t.notes.values()) {
        if (latestOnly) {
          if (!rec.history[rec.history.length - 1].issuerSig) n++;
        } else for (const v of rec.history) if (!v.issuerSig) n++;
      }
    return n;
  }

  /** Redeems a note against the issuer's reserve: tracker gate → transaction → contract evaluation. */
  redeem(o: RedeemOptions): RedemptionOutcome {
    const denom = o.denom ?? "erg";
    const R = this.p(o.receiver);
    const I = this.p(o.issuer);
    const tracker = this.t(o.tracker);
    const height = this.clock.height;
    let built = false;
    const fail = (stage: RedemptionStage, code: string, message: string, extra: Partial<RedemptionOutcome> = {}, reserveId?: string, amount = o.amount ?? 0n): RedemptionOutcome => {
      const event = this.emit({ type: "redemption.rejected", reserve: reserveId, tracker: tracker.id, issuer: I.id, receiver: R.id, denom, amount, stage, code, message, failed: extra.eval?.failed, built: built || undefined });
      return { ok: false, stage, code, message, event, ...extra };
    };
    const candidates = [...this.reserves.values()].filter((r) => r.active && r.owner === I.pub && r.denom === denom && r.trackerNftId === tracker.nftId);
    const reserve = o.reserve ? this.reserves.get(o.reserve) : candidates[0];
    if (!reserve) return fail("wallet", "no-reserve", `${I.name} has no reserve in ${denom} bound to ${tracker.name}`);
    if (!reserve.active) return fail("wallet", "reserve-closed", `reserve ${reserve.id} no longer exists (refund completed)`, {}, reserve.id);
    const emergency = o.emergency === true ? true : o.emergency === false ? false : !tracker.online;
    if (emergency && o.emergency !== true && !tracker.emergencyOpen(height) && !o.force) {
      return fail("tracker", "tracker-offline", `tracker unreachable; the emergency path opens at height ${tracker.emergencyOpensAt()} (${(tracker.emergencyOpensAt() ?? height) - height} blocks)`, {}, reserve.id);
    }
    const rec = tracker.note(I.pub, R.pub, denom);
    if (!rec) return fail("tracker", "not-found", "Note not found", {}, reserve.id);
    const committed = tracker.committedTotal(rec.key);
    // which signed version goes on-chain: the one the tracker tree commits to
    const version =
      committed === null ? rec.history[rec.history.length - 1] : [...rec.history].reverse().find((v) => v.totalDebt === committed) ?? rec.history[rec.history.length - 1];
    if (committed === null && !o.force) return fail("tracker", "note-not-committed", rec.omitted ? "Note is not committed on-chain (the tracker left it out of its tree)" : "Note is not committed on-chain yet", {}, reserve.id);
    const already = reserve.redeemedFor(R.pub)?.redeemed ?? 0n;
    const room = version.totalDebt - already;
    // an honest wallet also respects its own waivers (novation / off-chain clearing); the contract does not
    const claim = version.totalDebt - rec.amountRedeemed - rec.waived;
    const payable = maxPayout(reserve);
    const amount = o.amount ?? min(min(room, claim > 0n ? claim : 0n), payable);
    if (amount <= 0n && !o.force) {
      const why = room <= 0n ? "this reserve already paid out the whole note" : claim <= 0n ? "the rest of this note was waived (novation / clearing)" : "the reserve is empty (it must keep its minimum remainder)";
      return fail("wallet", "nothing-to-redeem", why, {}, reserve.id, amount);
    }
    if (amount > payable && !o.force) {
      const unit = reserve.contract === "basis-token" ? "token units" : "nanoERG";
      const keep = reserve.contract === "basis-token" ? "at least one token unit" : "0.001 ERG";
      return fail(
        emergency || tracker.options.coSign === "on-submit" ? "wallet" : "tracker",
        "insufficient-collateral",
        `no unspent reserve with >= ${amount + (reserve.contract === "basis-token" ? 1n : MIN_BOX_VALUE_NANOERG)} ${unit} collateral: the reserve box must keep ${keep}; at most ${payable} can be redeemed now`,
        {},
        reserve.id,
        amount,
      );
    }

    let trackerSig = new Uint8Array();
    let compliance: ComplianceResult | null = null;
    let feePayer: Participant = R;
    const operator = this.p(tracker.operatorId);
    if (!emergency) {
      if (tracker.options.coSign === "on-submit") {
        // the holder already received a co-signature for every version at payment time
        trackerSig = this.signatures(rec, { version: rec.history.indexOf(version), includeTracker: true }).trackerSig!;
        if (!tracker.online && !o.force) return fail("tracker", "tracker-offline", "tracker unreachable (it must still build and fund the transaction)", {}, reserve.id, amount);
        feePayer = operator;
      } else if (o.force) {
        trackerSig = tracker.coSign(rec, version.totalDebt, version.timestamp);
        feePayer = operator;
      } else {
        const auth = tracker.authorizeRedemption({ issuer: I.pub, receiver: R.pub, denom, amount, emergency: false, height, nowMs: this.clock.nowMs(), reserves: this.reserveViews(tracker), worstCase: o.worstCase });
        // the server's rate limiter records every /redemption/build attempt it lets through, even one it refuses later
        built = auth.ok || (auth.code !== "rate-limited" && auth.code !== "tracker-offline");
        if (!auth.ok) return fail("tracker", auth.code, auth.message, { compliance: auth.compliance ?? null }, reserve.id, amount);
        trackerSig = auth.trackerSig;
        compliance = auth.compliance;
        feePayer = operator;
      }
    }
    const minBox = reserve.contract === "basis-token" ? MIN_BOX_VALUE_NANOERG : 0n;
    if (this.balance(feePayer.id, "erg") < MINER_FEE_NANOERG + minBox && !o.force) {
      return fail("wallet", "fee-funds", `${feePayer.name} cannot pay the 0.001 ERG miner fee${minBox ? " + 0.001 ERG token box" : ""}`, {}, reserve.id, amount);
    }
    const issuerSig = this.issuerSignature(rec, version);
    const { tx, newRedeemedTotal } = reserve.buildRedeem({
      receiver: R.pub,
      totalDebt: version.totalDebt,
      timestamp: version.timestamp,
      amount,
      issuerSig,
      trackerSig,
      trackerBox: tracker.dataInput(),
      height,
      extraSigners: feePayer.id !== R.id ? [feePayer.pub] : [],
      tamper: o.tamper,
      salt: String(this.events.length),
    });
    const ev = reserve.evaluate(tx);
    if (!ev.ok) return fail("contract", ev.error?.check ?? "contract", ev.error?.message ?? "the reserve contract rejected the transaction", { eval: ev, tx, emergency, compliance }, reserve.id, amount);
    const event = this.emit({
      type: "reserve.redeemed",
      reserve: reserve.id,
      tracker: tracker.id,
      issuer: I.id,
      receiver: R.id,
      denom,
      amount: ev.redeemed ?? amount,
      totalDebt: version.totalDebt,
      timestamp: version.timestamp,
      redeemedTotal: ev.newRedeemedTotal ?? newRedeemedTotal,
      emergency,
      issuerSig: bytesToHex(issuerSig),
      trackerSig: bytesToHex(trackerSig),
      boxId: tx.outputs[0].boxId,
      prevBoxId: reserve.box!.boxId,
      txId: tx.id,
      digest: (tx.outputs[0].registers.R5 as { digest: Hex }).digest,
      feePayer: feePayer.id,
      fee: MINER_FEE_NANOERG,
      minBox,
      built,
    });
    this.emit({ type: "nostr", tracker: tracker.id, kind: "redemption", issuer: I.id, receiver: R.id, reserve: reserve.id, denom, amount, inServer: true });
    return { ok: true, event, eval: ev, tx, emergency, amount, compliance };
  }

  /** What a holder could redeem right now, and what stands in the way. */
  redemptionPreview(o: { receiver: string; issuer: string; denom?: DenomId; tracker?: string }) {
    const denom = o.denom ?? "erg";
    const tracker = this.t(o.tracker);
    const R = this.p(o.receiver);
    const I = this.p(o.issuer);
    const rec = tracker.note(I.pub, R.pub, denom);
    const reserves = this.reservesOf(I.id, denom).filter((r) => r.active && r.trackerNftId === tracker.nftId);
    const height = this.clock.height;
    const committed = rec ? tracker.committedTotal(rec.key) : null;
    return {
      note: rec ?? null,
      status: rec ? tracker.status(rec, height) : null,
      committed,
      reserves: reserves.map((r) => ({ id: r.id, collateral: r.collateral(), payable: maxPayout(r), alreadyRedeemed: r.redeemedFor(R.pub)?.redeemed ?? 0n, refundPending: r.refundPending(), refundUnlockHeight: r.refundUnlockHeight() })),
      trackerOnline: tracker.online,
      emergencyOpen: tracker.emergencyOpen(height),
      emergencyOpensAt: tracker.emergencyOpensAt(),
      boxAge: tracker.boxAge(height),
    };
  }

  // ======================================================================================
  // clearing
  // ======================================================================================

  /** Debt edges (outstanding minus waivers) in one denomination, by participant id. */
  debtEdges(denom: DenomId = "erg", o: { ignoreWaivers?: boolean } = {}): DebtEdge[] {
    const out: DebtEdge[] = [];
    for (const t of this.trackers.values())
      for (const rec of t.notes.values()) {
        if (rec.denom !== denom || rec.issuer === rec.receiver) continue;
        const amount = outstandingOf(rec) - (o.ignoreWaivers ? 0n : rec.waived);
        if (amount > 0n) out.push({ from: this.idOf(rec.issuer)!, to: this.idOf(rec.receiver)!, amount });
      }
    return out;
  }

  findCycles(denom: DenomId = "erg", maxLen = 8): DebtCycle[] {
    return findDebtCycles(this.debtEdges(denom), maxLen);
  }

  netPositions(denom: DenomId = "erg"): Map<string, bigint> {
    return debtNetPositions(this.debtEdges(denom));
  }

  settlementPlan(denom: DenomId = "erg"): DebtEdge[] {
    return settlementPlan(this.debtEdges(denom));
  }

  /**
   * Clears `amount` around a cycle. "onchain": one atomic transaction, each debtor's reserve redeems to its
   * creditor (needs a reserve per debtor, the tracker's co-signature per leg, ≤ 10 legs). "waivers": every
   * creditor waives `amount` off-chain (no reserves needed, unenforceable). "auto": on-chain when possible.
   */
  clearCycle(cycle: DebtCycle | string[], o: { amount?: bigint; mode?: "onchain" | "waivers" | "auto"; denom?: DenomId; tracker?: string } = {}): ClearingOutcome {
    const denom = o.denom ?? "erg";
    const tracker = this.t(o.tracker);
    const before = this.debtEdges(denom);
    const members = Array.isArray(cycle) ? cycle : cycle.members;
    const edges: DebtEdge[] = members.map((m, i) => {
      const to = members[(i + 1) % members.length];
      const rec = tracker.note(this.p(m).pub, this.p(to).pub, denom);
      return { from: m, to, amount: rec ? honestClaimOf(rec) : 0n };
    });
    const maxAmount = edges.reduce((m, e) => (e.amount < m ? e.amount : m), edges[0]?.amount ?? 0n);
    const amount = o.amount ?? maxAmount;
    const refuse = (code: string, message: string): ClearingOutcome => {
      const event = this.emit({ type: "clearing.rejected", denom, members, amount, code, message });
      return { ok: false, code, message, events: [event], before };
    };
    if (members.length < 2) return refuse("not-a-cycle", "a cycle needs at least two members");
    if (amount <= 0n || amount > maxAmount) return refuse("amount", `clearable amount is ${maxAmount}`);
    const id = deriveId("clearing", members.join(">"), amount, this.events.length).slice(0, 16);
    const reservesOk = members.every((m) => this.reservesOf(m, denom).some((r) => r.active && r.trackerNftId === tracker.nftId && maxPayout(r) >= amount));
    const mode = o.mode === "auto" || !o.mode ? (reservesOk && members.length <= 10 ? "onchain" : "waivers") : o.mode;
    if (mode === "waivers") {
      const events: EconomyEvent[] = [];
      for (const e of edges) events.push(this.emit({ type: "waiver", creditor: e.to, issuer: e.from, denom, amount, reason: "clearing" }));
      events.push(this.emit({ type: "clearing.settled", id, denom, members, amount, mode, legs: edges.length }));
      const after = this.debtEdges(denom);
      return { ok: true, mode, amount, events, before, after, stats: clearingStats(before, after) };
    }
    if (!reservesOk) return refuse("no-reserve", "on-chain clearing needs a reserve with enough collateral for every debtor");
    if (members.length > 10) return refuse("too-many-legs", "at most 10 reserves per transaction (#0 % 10 is the output index)");
    // build every leg, get the tracker's co-signatures, combine into one transaction
    const operator = this.p(tracker.operatorId);
    const legs: Array<{ tx: SimTx; reserve: ReserveSim; rec: NoteRecord; version: NoteVersion; issuerSig: Uint8Array; trackerSig: Uint8Array; newRedeemedTotal: bigint; from: string; to: string }> = [];
    const dataInput = tracker.dataInput();
    for (const e of edges) {
      const I = this.p(e.from);
      const R = this.p(e.to);
      const reserve = this.reservesOf(I.id, denom).find((r) => r.active && r.trackerNftId === tracker.nftId && maxPayout(r) >= amount)!;
      const rec = tracker.note(I.pub, R.pub, denom)!;
      const auth = tracker.authorizeRedemption({ issuer: I.pub, receiver: R.pub, denom, amount, emergency: false, height: this.clock.height, nowMs: this.clock.nowMs(), reserves: this.reserveViews(tracker) });
      if (!auth.ok) return refuse(auth.code, `${I.name} → ${R.name}: ${auth.message}`);
      const version = rec.history[rec.history.length - 1];
      const issuerSig = this.issuerSignature(rec, version);
      const built = reserve.buildRedeem({ receiver: R.pub, totalDebt: version.totalDebt, timestamp: version.timestamp, amount, issuerSig, trackerSig: auth.trackerSig, trackerBox: dataInput, height: this.clock.height, salt: id });
      legs.push({ tx: built.tx, reserve, rec, version, issuerSig, trackerSig: auth.trackerSig, newRedeemedTotal: built.newRedeemedTotal, from: e.from, to: e.to });
    }
    if (this.balance(operator.id, "erg") < MINER_FEE_NANOERG) return refuse("fee-funds", `${operator.name} cannot pay the miner fee`);
    const tx = combineRedemptions(legs, this.clock.height, [operator.pub]);
    const evals = legs.map((_, i) => evaluateReserveSpend(tx, i, { avl: this.avl }));
    const bad = evals.findIndex((e) => !e.ok);
    if (bad >= 0) {
      const event = this.emit({ type: "clearing.rejected", denom, members, amount, code: evals[bad].error?.check ?? "contract", message: `leg ${bad + 1}: ${evals[bad].error?.message}` });
      return { ok: false, code: "contract", message: evals[bad].error?.message, events: [event], tx, evals, before };
    }
    const events: EconomyEvent[] = [];
    legs.forEach((l, i) => {
      events.push(
        this.emit({
          type: "reserve.redeemed",
          reserve: l.reserve.id,
          tracker: tracker.id,
          issuer: l.from,
          receiver: l.to,
          denom,
          amount,
          totalDebt: l.version.totalDebt,
          timestamp: l.version.timestamp,
          redeemedTotal: evals[i].newRedeemedTotal ?? l.newRedeemedTotal,
          emergency: false,
          issuerSig: bytesToHex(l.issuerSig),
          trackerSig: bytesToHex(l.trackerSig),
          boxId: tx.outputs[i].boxId,
          prevBoxId: l.reserve.box!.boxId,
          txId: tx.id,
          digest: (tx.outputs[i].registers.R5 as { digest: Hex }).digest,
          feePayer: operator.id,
          fee: i === 0 ? MINER_FEE_NANOERG : 0n,
          minBox: l.reserve.contract === "basis-token" ? MIN_BOX_VALUE_NANOERG : 0n,
          built: true,
          clearing: id,
        }),
      );
    });
    events.push(this.emit({ type: "clearing.settled", id, denom, members, amount, mode: "onchain", txId: tx.id, legs: legs.length }));
    const after = this.debtEdges(denom);
    return { ok: true, mode: "onchain", amount, events, tx, evals, before, after, stats: clearingStats(before, after) };
  }

  /** Preview of clearing a cycle (no state change). */
  previewClearing(cycle: DebtCycle, amount: bigint = cycle.amount, denom: DenomId = "erg"): { before: DebtEdge[]; after: DebtEdge[]; stats: ClearingStats } {
    const before = this.debtEdges(denom);
    const after = applyCycle(before, cycle, amount);
    return { before, after, stats: clearingStats(before, after) };
  }

  // ======================================================================================
  // views
  // ======================================================================================

  coverage(id: string, denom: DenomId = "erg", trackerId?: string): Coverage {
    const pub = this.p(id).pub;
    const trackers = trackerId ? [this.t(trackerId)] : [...this.trackers.values()];
    const reserves = [...this.reserves.values()].filter((r) => r.active && r.owner === pub && r.denom === denom && trackers.some((t) => t.nftId === r.trackerNftId));
    const collateral = reserves.reduce((s, r) => s + r.collateral(), 0n);
    let liabilities = 0n;
    for (const t of trackers) for (const rec of t.notesOfIssuer(pub, denom)) liabilities += outstandingOf(rec);
    const ratio = liabilities === 0n ? null : Number(collateral) / Number(liabilities);
    return { collateral, liabilities, ratio, level: coverageLevel(ratio), label: coverageLabel(ratio), reserves: reserves.length, refundPending: reserves.some((r) => r.refundPending()) };
  }

  balanceSheet(id: string, denom: DenomId = "erg"): BalanceSheet {
    const me = this.p(id);
    let assets = 0n;
    let assetsOnChain = 0n;
    let liabilities = 0n;
    let liabilitiesOnChain = 0n;
    let selfNote = 0n;
    let held = 0;
    let issued = 0;
    const cp = new Map<string, CounterpartyLine>();
    const line = (other: string) => {
      let l = cp.get(other);
      if (!l) cp.set(other, (l = { id: other, owesMe: 0n, iOwe: 0n, net: 0n }));
      return l;
    };
    for (const t of this.trackers.values()) {
      for (const rec of t.notesOfReceiver(me.pub, denom)) {
        const out = outstandingOf(rec);
        if (rec.issuer === me.pub) {
          selfNote += out;
          continue;
        }
        held++;
        assetsOnChain += out;
        assets += honestClaimOf(rec);
        line(this.idOf(rec.issuer)!).owesMe += honestClaimOf(rec);
      }
      for (const rec of t.notesOfIssuer(me.pub, denom)) {
        if (rec.receiver === me.pub) continue;
        const out = outstandingOf(rec);
        issued++;
        liabilitiesOnChain += out;
        liabilities += honestClaimOf(rec);
        line(this.idOf(rec.receiver)!).iOwe += honestClaimOf(rec);
      }
    }
    for (const l of cp.values()) l.net = l.owesMe - l.iOwe;
    const reserve = this.reservesOf(id, denom).reduce((s, r) => s + (r.active ? r.collateral() : 0n), 0n);
    return {
      participant: id,
      denom,
      assets,
      assetsOnChain,
      liabilities,
      liabilitiesOnChain,
      selfNote,
      reserve,
      wallet: this.balance(id, denom),
      net: assets - liabilities,
      coverage: this.coverage(id, denom),
      counterparties: [...cp.values()].sort((a, b) => (a.net < b.net ? -1 : a.net > b.net ? 1 : a.id < b.id ? -1 : 1)),
      notesHeld: held,
      notesIssued: issued,
    };
  }

  graph(denom?: DenomId): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const h = this.clock.height;
    const nodes: GraphNode[] = [...this.participants.values()].map((p) => ({
      id: p.id,
      name: p.name,
      kind: p.kind,
      pub: p.pub,
      reserve: this.reservesOf(p.id, denom ?? "erg").reduce((s, r) => s + (r.active ? r.collateral() : 0n), 0n),
      coverage: this.coverage(p.id, denom ?? "erg"),
      online: p.online,
    }));
    const edges: GraphEdge[] = [];
    for (const t of this.trackers.values())
      for (const rec of t.notes.values()) {
        if (denom && rec.denom !== denom) continue;
        edges.push({
          from: this.idOf(rec.issuer)!,
          to: this.idOf(rec.receiver)!,
          denom: rec.denom,
          totalDebt: rec.totalDebt,
          redeemed: rec.amountRedeemed,
          waived: rec.waived,
          outstanding: outstandingOf(rec),
          status: t.status(rec, h),
          omitted: rec.omitted,
          key: rec.key,
          tracker: t.id,
        });
      }
    return { nodes, edges };
  }

  /** Notes where `id` is issuer or receiver, newest first. */
  notesOf(id: string): NoteRecord[] {
    const pub = this.p(id).pub;
    const out: NoteRecord[] = [];
    for (const t of this.trackers.values()) {
      out.push(...t.notesOfIssuer(pub));
      for (const r of t.notesOfReceiver(pub)) if (r.issuer !== pub) out.push(r);
    }
    return out.sort((a, b) => (a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : 0));
  }

  note(issuer: string, receiver: string, denom: DenomId = "erg", trackerId?: string): NoteRecord | undefined {
    return this.t(trackerId).note(this.p(issuer).pub, this.p(receiver).pub, denom);
  }

  noteStatus(rec: NoteRecord): NoteStatus {
    return this.t(rec.tracker).status(rec, this.clock.height);
  }

  stats(): { participants: number; notes: number; payments: number; reserves: number; events: number; height: number; outstanding: Record<string, bigint>; collateral: Record<string, bigint> } {
    let notes = 0;
    let payments = 0;
    const outstanding: Record<string, bigint> = {};
    for (const t of this.trackers.values())
      for (const rec of t.notes.values()) {
        notes++;
        payments += rec.history.length;
        outstanding[rec.denom] = (outstanding[rec.denom] ?? 0n) + outstandingOf(rec);
      }
    const collateral: Record<string, bigint> = {};
    for (const r of this.reserves.values()) if (r.active) collateral[r.denom] = (collateral[r.denom] ?? 0n) + r.collateral();
    return { participants: this.participants.size, notes, payments, reserves: [...this.reserves.values()].filter((r) => r.active).length, events: this.events.length, height: this.clock.height, outstanding, collateral };
  }

  /** Deterministic digest of the whole state (signatures excluded: they are caches of deterministic values). */
  stateHash(): Hex {
    const parts: string[] = [`h=${this.clock.height}`];
    for (const p of [...this.participants.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const w = [...p.wallet.entries()].sort().map(([d, v]) => `${d}:${v}`).join(",");
      parts.push(`p:${p.id}:${p.pub}:${p.online}:${w}:${p.policy ? JSON.stringify(p.policy, (_k, v) => (typeof v === "bigint" ? v.toString() : v)) : "-"}`);
    }
    for (const t of [...this.trackers.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      parts.push(`t:${t.id}:${t.online}:${t.censorship.mode}:${bytesToHex(t.digest())}:${t.boxes.map((b) => `${b.boxId}@${b.creationHeight}`).join(",")}`);
      for (const rec of [...t.notes.values()].sort((a, b) => (a.key < b.key ? -1 : 1))) parts.push(`n:${rec.key}:${rec.totalDebt}:${rec.timestamp}:${rec.amountRedeemed}:${rec.waived}:${rec.omitted}:${rec.history.length}`);
    }
    for (const r of [...this.reserves.values()].sort((a, b) => (a.id < b.id ? -1 : 1))) parts.push(`r:${r.id}:${r.box?.boxId ?? "closed"}:${r.box?.value ?? 0n}:${r.collateral()}:${r.digestHex()}:${r.refundHeight()}`);
    for (const [k, v] of [...this.creditLines.entries()].sort()) parts.push(`c:${k}:${v}`);
    parts.push(`off:${this.offline.map((o) => o.seq).join(",")}`);
    return bytesToHex(blake2b256(utf8(parts.join("\n"))));
  }
}

