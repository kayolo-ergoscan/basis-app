// Pure read helpers over any Economy (the town or a scenario run): note summaries and history, redemption
// preview, tracker timeline, balance sheet with names, graph snapshot with stable positions. Indexes over the
// event log are built incrementally and cached per economy, so calling these on every frame is cheap.
import {
  blake2b256,
  bytesToHex,
  debtKey,
  hexToBytes,
  maxPayout,
  MIN_BOX_VALUE_NANOERG,
  MINER_FEE_NANOERG,
  noteMessage,
  utf8,
  type BalanceSheet,
  type ComplianceResult,
  type CoverageLevel,
  type DenomId,
  type Economy,
  type EconomyEvent,
  type GraphEdge,
  type GraphNode,
  type Hex,
  type NoteRecord,
  type NoteStatus,
  type NoteVia,
  type ParticipantKind,
} from "@/protocol";
import { denomInfo } from "./format";

// ---------------------------------------------------------------------------------------------
// notes
// ---------------------------------------------------------------------------------------------

export type NoteDirection = "owed-to-you" | "you-owe" | "self" | "other";

export interface NoteSummary {
  key: Hex;
  tracker: string;
  issuer: string;
  receiver: string;
  denom: DenomId;
  symbol: string;
  decimals: number;
  totalDebt: bigint;
  redeemed: bigint;
  waived: bigint;
  /** totalDebt − redeemed. */
  outstanding: bigint;
  /** outstanding − waived: what the holder's honest wallet still claims. */
  claim: bigint;
  status: NoteStatus;
  omitted: boolean;
  versions: number;
  timestamp: bigint;
  createdHeight: number;
  updatedHeight: number;
  memo?: string;
  via: NoteVia;
  /** Relative to the viewer passed to noteSummary (default "other"). */
  direction: NoteDirection;
  /** The issuer has an active reserve in this denomination bound to this tracker. */
  backed: boolean;
  /** Issuer agent or receiver agent (wallet tab "Agents"). */
  agent: boolean;
}

export function noteSummary(eco: Economy, rec: NoteRecord, viewer?: string): NoteSummary {
  const issuer = eco.idOf(rec.issuer) ?? rec.issuer;
  const receiver = eco.idOf(rec.receiver) ?? rec.receiver;
  const info = denomInfo(eco, rec.denom);
  const outstanding = rec.totalDebt > rec.amountRedeemed ? rec.totalDebt - rec.amountRedeemed : 0n;
  const claim = outstanding > rec.waived ? outstanding - rec.waived : 0n;
  const last = rec.history[rec.history.length - 1];
  const t = eco.t(rec.tracker);
  const direction: NoteDirection = !viewer ? "other" : issuer === viewer && receiver === viewer ? "self" : receiver === viewer ? "owed-to-you" : issuer === viewer ? "you-owe" : "other";
  const kindOf = (id: string) => eco.participants.get(id)?.kind;
  return {
    key: rec.key,
    tracker: rec.tracker,
    issuer,
    receiver,
    denom: rec.denom,
    symbol: info.symbol,
    decimals: info.decimals,
    totalDebt: rec.totalDebt,
    redeemed: rec.amountRedeemed,
    waived: rec.waived,
    outstanding,
    claim,
    status: t.status(rec, eco.clock.height),
    omitted: rec.omitted,
    versions: rec.history.length,
    timestamp: rec.timestamp,
    createdHeight: rec.createdHeight,
    updatedHeight: rec.updatedHeight,
    memo: last?.memo,
    via: last?.via ?? "pay",
    direction,
    backed: [...eco.reserves.values()].some((r) => r.active && r.owner === rec.issuer && r.denom === rec.denom && r.trackerNftId === t.nftId),
    agent: kindOf(issuer) === "agent" || kindOf(receiver) === "agent",
  };
}

export type NotesTab = "all" | "owed-to-you" | "you-owe" | "agents" | "self";

/** Notes of a participant (newest change first), summarised from its point of view. */
export function notesFor(eco: Economy, id: string, o: { tab?: NotesTab; denom?: DenomId } = {}): NoteSummary[] {
  if (!eco.participants.has(id)) return [];
  const pub = eco.p(id).pub;
  const out: NoteSummary[] = [];
  for (const t of eco.trackers.values()) {
    const seen = new Set<Hex>();
    for (const rec of [...t.notesOfIssuer(pub, o.denom), ...t.notesOfReceiver(pub, o.denom)]) {
      if (seen.has(rec.key)) continue;
      seen.add(rec.key);
      out.push(noteSummary(eco, rec, id));
    }
  }
  const tab = o.tab ?? "all";
  const filtered = out.filter((n) => (tab === "all" ? n.direction !== "self" : tab === "agents" ? n.agent : n.direction === tab));
  return filtered.sort((a, b) => (a.timestamp > b.timestamp ? -1 : a.timestamp < b.timestamp ? 1 : a.key < b.key ? -1 : 1));
}

// ---------------------------------------------------------------------------------------------
// event-log index (commits, changed keys, confirmations) — incremental, cached per economy
// ---------------------------------------------------------------------------------------------

export interface CommitRow {
  seq: number;
  tracker: string;
  boxId: Hex;
  txId: Hex;
  prevBoxId: Hex | null;
  height: number;
  digest: Hex;
  /** Entries in the committed tree. */
  notes: number;
  heartbeat: boolean;
  confirmedHeight: number | null;
  /** Debt keys whose totals entered or changed in this commitment. */
  changedKeys: Hex[];
}

interface LogIndex {
  len: number;
  commits: Map<string, CommitRow[]>;
  byBox: Map<Hex, CommitRow>;
  pending: Map<string, Set<Hex>>;
  /** note.issued seq → omitted flag (for version states). */
  omittedAt: Set<number>;
}

const indexes = new WeakMap<Economy, LogIndex>();

function keyOfExchange(eco: Economy, e: EconomyEvent): Hex | null {
  if (e.type === "exchange.staged") return bytesToHex(debtKey(eco.p(e.issuer).pub, eco.p(e.receiver).pub, e.fromDenom));
  if (e.type === "exchange.applied") {
    const x = eco.trackers.get(e.tracker)?.exchanges.get(e.id);
    return x ? bytesToHex(debtKey(x.issuer, x.receiver, x.toDenom)) : null;
  }
  return null;
}

function logIndex(eco: Economy): LogIndex {
  let ix = indexes.get(eco);
  if (!ix || ix.len > eco.events.length) {
    ix = { len: 0, commits: new Map(), byBox: new Map(), pending: new Map(), omittedAt: new Set() };
    indexes.set(eco, ix);
  }
  const ev = eco.events;
  for (let i = ix.len; i < ev.length; i++) {
    const e = ev[i];
    const pendingOf = (t: string) => {
      let s = ix!.pending.get(t);
      if (!s) ix!.pending.set(t, (s = new Set()));
      return s;
    };
    switch (e.type) {
      case "tracker.created": {
        const row: CommitRow = { seq: e.seq, tracker: e.tracker, boxId: e.boxId, txId: e.txId, prevBoxId: null, height: e.height, digest: e.digest, notes: 0, heartbeat: false, confirmedHeight: null, changedKeys: [] };
        ix.commits.set(e.tracker, [row]);
        ix.byBox.set(e.boxId, row);
        break;
      }
      case "note.issued":
        if (e.omitted) ix.omittedAt.add(e.seq);
        else pendingOf(e.tracker).add(e.key);
        break;
      case "exchange.staged":
      case "exchange.applied": {
        const k = keyOfExchange(eco, e);
        if (k) pendingOf(e.tracker).add(k);
        break;
      }
      case "tracker.committed": {
        const keys = [...pendingOf(e.tracker)];
        ix.pending.set(e.tracker, new Set());
        const row: CommitRow = { seq: e.seq, tracker: e.tracker, boxId: e.boxId, txId: e.txId, prevBoxId: e.prevBoxId, height: e.creationHeight, digest: e.digest, notes: e.notes, heartbeat: e.heartbeat, confirmedHeight: null, changedKeys: keys };
        const list = ix.commits.get(e.tracker) ?? [];
        list.push(row);
        ix.commits.set(e.tracker, list);
        ix.byBox.set(e.boxId, row);
        break;
      }
      case "tracker.confirmed": {
        const row = ix.byBox.get(e.boxId);
        if (row && row.confirmedHeight === null) row.confirmedHeight = e.height;
        break;
      }
    }
  }
  ix.len = ev.length;
  return ix;
}

/** Tracker digest timeline (newest first): commit rows with digest, height, changed keys, confirmation. */
export function trackerTimeline(eco: Economy, trackerId?: string, o: { limit?: number } = {}): Array<CommitRow & { current: boolean; depth: number }> {
  const t = eco.t(trackerId);
  const rows = logIndex(eco).commits.get(t.id) ?? [];
  const cur = t.currentBox()?.boxId;
  const h = eco.clock.height;
  const out: Array<CommitRow & { current: boolean; depth: number }> = [];
  for (let i = rows.length - 1; i >= 0 && out.length < (o.limit ?? Infinity); i--) {
    const r = rows[i];
    out.push({ ...r, changedKeys: r.changedKeys.slice(), current: r.boxId === cur, depth: h - r.height + 1 });
  }
  return out;
}

/** Keys changed since the tracker's last commitment (the "pending ladder"). */
export function uncommittedKeys(eco: Economy, trackerId?: string): Hex[] {
  const t = eco.t(trackerId);
  return [...(logIndex(eco).pending.get(t.id) ?? [])];
}

/** Keys changed in the commitment `tracker.committed` at seq (for pulses). */
export function commitChangedKeys(eco: Economy, seq: number): Hex[] {
  const e = eco.events[seq];
  if (!e || e.type !== "tracker.committed") return [];
  const row = logIndex(eco).byBox.get(e.boxId);
  return row ? row.changedKeys.slice() : [];
}

// ---------------------------------------------------------------------------------------------
// note history
// ---------------------------------------------------------------------------------------------

export type VersionState = "local" | "pending" | "confirmed" | "superseded" | "omitted";

export interface NoteVersionView {
  index: number;
  totalDebt: bigint;
  /** Increase over the previous version. */
  amount: bigint;
  timestamp: bigint;
  /** ISO time of the (simulated) timestamp. */
  timeIso: string;
  height: number;
  seq: number;
  via: NoteVia;
  memo?: string;
  /** The 80-byte message the issuer signs (hex). */
  messageHex: Hex;
  /** blake2b256 of the message (a short handle for the version). */
  messageDigest: Hex;
  /** The issuer signature is materialised (lazy signatures are produced on demand). */
  signed: boolean;
  committed: { boxId: Hex; txId: Hex; digest: Hex; height: number; seq: number; confirmedHeight: number | null } | null;
  state: VersionState;
  latest: boolean;
}

/** Every signed version of a note, oldest first, with the commitment that carried it (if any). */
export function noteHistory(eco: Economy, issuer: string, receiver: string, denom: DenomId = "erg", trackerId?: string): NoteVersionView[] {
  const t = eco.t(trackerId);
  if (!eco.participants.has(issuer) || !eco.participants.has(receiver)) return [];
  const rec = t.note(eco.p(issuer).pub, eco.p(receiver).pub, denom);
  if (!rec) return [];
  const ix = logIndex(eco);
  const commits = ix.commits.get(t.id) ?? [];
  const out: NoteVersionView[] = [];
  for (let i = 0; i < rec.history.length; i++) {
    const v = rec.history[i];
    const next = rec.history[i + 1];
    const c = commits.find((r) => r.seq > v.seq && r.changedKeys.includes(rec.key)) ?? null;
    const carried = c && (!next || c.seq < next.seq) ? c : null;
    const msg = noteMessage(hexToBytes(rec.key), v.totalDebt, v.timestamp, t.nftId);
    let state: VersionState;
    if (ix.omittedAt.has(v.seq)) state = "omitted";
    else if (carried) state = carried.confirmedHeight !== null ? "confirmed" : "pending";
    else state = next ? "superseded" : "local";
    out.push({
      index: i,
      totalDebt: v.totalDebt,
      amount: v.amount,
      timestamp: v.timestamp,
      timeIso: new Date(Number(v.timestamp)).toISOString(),
      height: v.height,
      seq: v.seq,
      via: v.via,
      memo: v.memo,
      messageHex: bytesToHex(msg),
      messageDigest: bytesToHex(blake2b256(msg)),
      signed: !!v.issuerSig,
      committed: carried ? { boxId: carried.boxId, txId: carried.txId, digest: carried.digest, height: carried.height, seq: carried.seq, confirmedHeight: carried.confirmedHeight } : null,
      state,
      latest: !next,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// redemption preview (X04, X05, X10, X15, S02, S03)
// ---------------------------------------------------------------------------------------------

export type RedeemBlocker =
  | "no-note"
  | "no-reserve"
  | "multiple-reserves"
  | "not-committed"
  | "not-confirmed"
  | "omitted"
  | "tracker-offline"
  | "emergency-not-open"
  | "nothing-left"
  | "reserve-empty"
  | "refund-pending"
  | "policy";

export interface RedemptionPreviewView {
  note: NoteSummary | null;
  status: NoteStatus | null;
  committed: bigint | null;
  reserves: Array<{ id: string; collateral: bigint; payable: bigint; alreadyRedeemed: bigint; refundPending: boolean; refundUnlockHeight: number | null }>;
  reserve: string | null;
  /** committed total − already paid by this reserve − waived. */
  claim: bigint;
  /** Largest amount redeemable now: min(claim, reserve − its remainder). */
  maxAmount: bigint;
  /** S03: confirmed && maxAmount > 0 (and the path is open). */
  canRedeemNow: boolean;
  path: "normal" | "emergency" | "none";
  trackerOnline: boolean;
  emergencyOpen: boolean;
  emergencyOpensAt: number | null;
  boxAge: number;
  /** S02: blocks until the latest version is confirmed (0 = confirmed; null = cannot tell, e.g. tracker offline). */
  etaBlocks: number | null;
  blockers: RedeemBlocker[];
  /** X05: the tracker's FIFO / policy gate for maxAmount, evaluated without signing. */
  preflight: { ok: boolean; code?: string; message?: string; compliance: ComplianceResult | null } | null;
  /** X15: miner fee and who pays it on this path; token reserves add a 0.001 ERG token box. */
  fee: { miner: bigint; tokenBox: bigint; payer: "tracker" | "holder" };
}

function nextCycle(eco: Economy, h: number, interval: number): number {
  const g = eco.clock.genesisHeight;
  return g + (Math.floor((h - g) / interval) + 1) * interval;
}

export function redemptionPreview(eco: Economy, receiver: string, issuer: string, denom: DenomId = "erg", trackerId?: string): RedemptionPreviewView {
  const t = eco.t(trackerId);
  const base = eco.redemptionPreview({ receiver, issuer, denom, tracker: t.id });
  const h = eco.clock.height;
  const rec = base.note;
  const reserves = base.reserves;
  const r0 = reserves[0] ?? null;
  const blockers: RedeemBlocker[] = [];
  const committed = base.committed;
  let claim = 0n;
  if (!rec) blockers.push("no-note");
  if (!r0) blockers.push("no-reserve");
  if (reserves.length > 1) blockers.push("multiple-reserves");
  if (rec?.omitted) blockers.push("omitted");
  if (rec && committed === null) blockers.push("not-committed");
  if (rec && r0) {
    const version = committed === null ? null : [...rec.history].reverse().find((v) => v.totalDebt === committed) ?? null;
    const total = version?.totalDebt ?? 0n;
    claim = total - r0.alreadyRedeemed - rec.waived;
    if (claim < 0n) claim = 0n;
  }
  const payable = r0?.payable ?? 0n;
  const maxAmount = claim < payable ? claim : payable;
  if (rec && committed !== null && claim === 0n) blockers.push("nothing-left");
  if (r0 && payable === 0n) blockers.push("reserve-empty");
  if (r0?.refundPending) blockers.push("refund-pending");
  const online = base.trackerOnline;
  const confirmed = base.status === "confirmed";
  if (rec && committed !== null && !confirmed && online) blockers.push("not-confirmed");
  let path: RedemptionPreviewView["path"] = "none";
  if (online) path = "normal";
  else if (base.emergencyOpen) path = "emergency";
  if (!online) blockers.push(base.emergencyOpen ? "tracker-offline" : "emergency-not-open");
  let preflight: RedemptionPreviewView["preflight"] = null;
  if (rec && r0 && online && confirmed && maxAmount > 0n) {
    const auth = t.authorizeRedemption({ issuer: eco.p(issuer).pub, receiver: eco.p(receiver).pub, denom, amount: maxAmount, emergency: false, height: h, nowMs: eco.clock.nowMs(), reserves: eco.reserveViews(t), sign: false });
    preflight = auth.ok ? { ok: true, compliance: auth.compliance } : { ok: false, code: auth.code, message: auth.message, compliance: (auth as { compliance?: ComplianceResult }).compliance ?? null };
    if (!auth.ok && (auth.code === "failed_policy_violation" || auth.code === "failed_not_oldest_note")) blockers.push("policy");
  }
  let etaBlocks: number | null = null;
  if (rec && online) {
    const interval = t.options.commitIntervalBlocks;
    const box = t.currentBox();
    if (base.status === "confirmed") etaBlocks = 0;
    else if (base.status === "pending" && box) etaBlocks = Math.max(0, nextCycle(eco, Math.max(h, box.creationHeight + t.options.minDepth - 2), interval) - h);
    else if (!rec.omitted) etaBlocks = nextCycle(eco, h, interval) + interval - h;
  }
  const emergencyPath = path === "emergency";
  const canRedeemNow = !!rec && !!r0 && maxAmount > 0n && reserves.length === 1 && (emergencyPath ? committed !== null : confirmed && online && preflight?.ok === true);
  const reserve = r0 ? eco.r(r0.id) : null;
  return {
    note: rec ? noteSummary(eco, rec, receiver) : null,
    status: base.status,
    committed,
    reserves,
    reserve: r0?.id ?? null,
    claim,
    maxAmount,
    canRedeemNow,
    path,
    trackerOnline: online,
    emergencyOpen: base.emergencyOpen,
    emergencyOpensAt: base.emergencyOpensAt,
    boxAge: base.boxAge,
    etaBlocks,
    blockers,
    preflight,
    fee: { miner: MINER_FEE_NANOERG, tokenBox: reserve?.contract === "basis-token" ? MIN_BOX_VALUE_NANOERG : 0n, payer: emergencyPath ? "holder" : "tracker" },
  };
}

// ---------------------------------------------------------------------------------------------
// balance sheet
// ---------------------------------------------------------------------------------------------

export interface BalanceSheetView extends BalanceSheet {
  symbol: string;
  decimals: number;
  /** Estimated part of `assets` covered by the issuers' reserves (issuer coverage, FIFO ignored). */
  assetsBacked: bigint;
  /** assets − assetsBacked. */
  assetsTrust: bigint;
  reserves: Array<{ id: string; collateral: bigint; payable: bigint; refundPending: boolean; refundUnlockHeight: number | null; contract: string; boxId: Hex | null }>;
}

export function balanceSheet(eco: Economy, id: string, denom: DenomId = "erg"): BalanceSheetView {
  const bs = eco.balanceSheet(id, denom);
  const info = denomInfo(eco, denom);
  let backed = 0n;
  for (const c of bs.counterparties) {
    if (c.owesMe <= 0n) continue;
    const cov = eco.coverage(c.id, denom);
    if (cov.ratio === null || cov.collateral === 0n) continue;
    const share = cov.ratio >= 1 ? c.owesMe : (c.owesMe * BigInt(Math.floor(cov.ratio * 10_000))) / 10_000n;
    backed += share;
  }
  if (backed > bs.assets) backed = bs.assets;
  const reserves = eco.reservesOf(id, denom).filter((r) => r.active).map((r) => ({ id: r.id, collateral: r.collateral(), payable: maxPayout(r), refundPending: r.refundPending(), refundUnlockHeight: r.refundUnlockHeight(), contract: r.contract, boxId: r.box?.boxId ?? null }));
  return { ...bs, symbol: info.symbol, decimals: info.decimals, assetsBacked: backed, assetsTrust: bs.assets - backed, reserves };
}

// ---------------------------------------------------------------------------------------------
// graph snapshot with stable positions
// ---------------------------------------------------------------------------------------------

export interface GraphNodeView extends GraphNode {
  x: number;
  y: number;
  ring: number;
  you: boolean;
  liabilities: bigint;
  ratio: number | null;
  level: CoverageLevel;
  reserves: number;
}

export interface GraphEdgeView extends GraphEdge {
  id: string;
  /** outstanding − waived. */
  claim: bigint;
  /** 0…1 stroke weight on a log scale of the claim within this snapshot. */
  weight: number;
}

export interface GraphSnapshot {
  denom: DenomId;
  symbol: string;
  decimals: number;
  height: number;
  /** events.length when taken (a cheap version stamp). */
  version: number;
  nodes: GraphNodeView[];
  edges: GraphEdgeView[];
}

const RING: Record<ParticipantKind, number> = { "tracker-operator": 0, business: 1, human: 2, agent: 3 };
const RADIUS = [0, 0.42, 0.78, 1];

/** Deterministic position for a node: ring by kind, angle from blake2b(seed, id). In [-1, 1]². */
export function stablePosition(seed: string, id: string, kind: ParticipantKind): { x: number; y: number; ring: number } {
  const h = blake2b256(utf8(`graph/${seed}/${id}`));
  const ring = RING[kind] ?? 2;
  const angle = ((h[0] << 8) | h[1]) / 65536 * Math.PI * 2;
  const jitter = (h[2] / 255 - 0.5) * 0.12;
  const r = ring === 0 ? 0 : RADIUS[ring] + jitter;
  return { x: Math.cos(angle) * r, y: Math.sin(angle) * r, ring };
}

const graphCache = new WeakMap<Economy, Map<string, GraphSnapshot>>();

/** Graph of one denomination (notes as edges, participants as nodes) with stable positions; cached per log length. */
export function graphSnapshot(eco: Economy, denom: DenomId = "erg", o: { seed?: string; you?: string; includeSelf?: boolean } = {}): GraphSnapshot {
  const seed = o.seed ?? eco.seed;
  const cacheKey = `${denom}|${seed}|${o.you ?? ""}|${o.includeSelf ? 1 : 0}`;
  let per = graphCache.get(eco);
  if (!per) graphCache.set(eco, (per = new Map()));
  const hit = per.get(cacheKey);
  if (hit && hit.version === eco.events.length && hit.height === eco.clock.height) return hit;
  const g = eco.graph(denom);
  const info = denomInfo(eco, denom);
  const nodes: GraphNodeView[] = g.nodes.map((n) => {
    const pos = stablePosition(seed, n.id, n.kind);
    return { ...n, ...pos, you: n.id === o.you, liabilities: n.coverage.liabilities, ratio: n.coverage.ratio, level: n.coverage.level, reserves: n.coverage.reserves };
  });
  const raw = g.edges.filter((e) => o.includeSelf || e.from !== e.to);
  const claims = raw.map((e) => (e.outstanding > e.waived ? e.outstanding - e.waived : 0n));
  const maxClaim = claims.reduce((m, c) => (c > m ? c : m), 0n);
  const lmax = maxClaim > 0n ? Math.log10(Number(maxClaim) + 1) : 1;
  const edges: GraphEdgeView[] = raw.map((e, i) => ({ ...e, id: `${e.tracker}:${e.key}`, claim: claims[i], weight: claims[i] > 0n ? Math.max(0.05, Math.log10(Number(claims[i]) + 1) / lmax) : 0 }));
  const snap: GraphSnapshot = { denom, symbol: info.symbol, decimals: info.decimals, height: eco.clock.height, version: eco.events.length, nodes, edges };
  per.set(cacheKey, snap);
  return snap;
}

/** Denominations present in an economy (ERG first). */
export function denominations(eco: Economy): Array<{ id: DenomId; symbol: string; decimals: number; label?: string }> {
  return [...eco.denominations.values()].map((d) => ({ id: d.id, symbol: d.symbol, decimals: d.decimals, label: d.label }));
}
