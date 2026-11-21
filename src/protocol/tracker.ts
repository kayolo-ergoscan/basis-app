// Tracker emulator, mirroring BetterMoneyLabs/basis-tracker @ 43e2173 (crates/basis_store + basis_server):
//
//  • POST /notes (create_note → add_note): NFT binding, served denomination, contract range (≤ i64::MAX),
//    no future timestamp, strictly increasing timestamp, cumulative debt never decreases, issuer signature.
//    The tracker does NOT evaluate acceptance policies or collateral when a note is created.
//  • One AVL+ tree for all denominations: debtKey → totalDebt (8 bytes BE).
//  • tracker_box_updater: every 600 s (5 blocks) it recreates the tracker box with the new digest, and SKIPS
//    the update when the digest has not changed. Notes are LocalOnly → Pending (in a submitted box) →
//    Confirmed (box depth ≥ 2).
//  • Redemption gate (/redemption/build, /tracker/signature): the tracker co-signs only its STORED, committed
//    and confirmed state, refuses when the issuer has more than one reserve in the denomination, and (unless
//    emergency) refuses redemptions that would newly violate another holder's acceptance policy; a distressed
//    reserve redeems FIFO. With the shipped defaults (acceptance.default = "reject", no predicates) every
//    other holder counts as already violated, so redemptions are FIFO whenever more than one holder exists.
//  • Emergency: when the latest tracker box is older than 2160 blocks, the contract accepts an empty
//    tracker signature.
//
// The event names in tracker_protocol.md (note, redemption, reserve top-up, commitment, 80 % / 100 % alerts)
// are emitted by the economy as "nostr" events; only NoteUpdated is emitted by the real server code.

import { bytesToHex, hexToBytes, readI64BE, type Hex } from "./bytes";
import { type AuthenticatedMap, type AvlBackend, getAvlBackend } from "./avl";
import { EMERGENCY_BLOCKS, MIN_CONFIRMATION_DEPTH, REDEMPTION_BUILDS_PER_PAIR_PER_HOUR } from "./clock";
import type { KeyPair } from "./keys";
import { contractRangeError, debtKey, noteMessage, reserveKey, trackerTreeValue, type DenomId } from "./note";
import {
  checkRedemptionCompliance,
  type AcceptanceConfig,
  type ComplianceNote,
  type ComplianceResult,
} from "./policy";
import { basisAvlRegister, encodeCollByte, encodeGroupElement } from "./registers";
import { trackerBoxFor, type SimBox } from "./reserve";
import { sign, verify } from "./schnorr";

export type NoteStatus = "local" | "pending" | "confirmed";
export type NoteVia = "pay" | "novation" | "self-note" | "sync" | "clearing" | "exchange" | "import";

export interface NoteVersion {
  totalDebt: bigint;
  timestamp: bigint;
  /** Increase over the previous version. */
  amount: bigint;
  /** Issuer signature; null = not materialised yet (deterministic, see Economy.signatures). */
  issuerSig: Hex | null;
  seq: number;
  height: number;
  via: NoteVia;
  memo?: string;
}

export interface NoteRecord {
  /** Tracker id that witnesses this note. */
  tracker: string;
  /** Tracker tree key = blake2b256(issuer ‖ receiver [‖ tokenId]). */
  key: Hex;
  /** Reserve tree key = blake2b256(issuer ‖ receiver) (denomination-free, both contracts). */
  reserveKey: Hex;
  issuer: Hex;
  receiver: Hex;
  denom: DenomId;
  /** amount_collected: latest cumulative total. */
  totalDebt: bigint;
  timestamp: bigint;
  /** amount_redeemed as the tracker records it (sum over reserves). */
  amountRedeemed: bigint;
  issuerSig: Hex | null;
  /** Last co-signature the tracker handed out, and for which state. */
  trackerSig: Hex | null;
  trackerSigFor: { totalDebt: bigint; timestamp: bigint } | null;
  /** Censorship "omit": the tracker answered OK but keeps this note out of its tree. */
  omitted: boolean;
  /** App-level waivers by the receiver (novation / off-chain clearing). Not enforceable on-chain. */
  waived: bigint;
  history: NoteVersion[];
  createdHeight: number;
  updatedHeight: number;
}

export interface TrackerBoxRecord {
  boxId: Hex;
  txId: Hex;
  creationHeight: number;
  digest: Hex;
  /** Entries in the committed tree. */
  notes: number;
  registers: { R4: Hex; R5: Hex; R6: Hex };
  /** Snapshot for lookup proofs; dropped for boxes older than the previous one. */
  tree: AuthenticatedMap | null;
  /**
   * Height of the updater cycle that saw this box at depth ≥ minDepth (notes Pending → Confirmed), null before.
   * The real updater checks once per 600 s cycle, so this is the first cycle after the box, not depth 2 itself.
   */
  confirmedHeight: number | null;
}

/** POST /notes/exchange (issues #17/#20): a staged two-phase cross-denomination exchange. */
export interface PendingExchange {
  id: string;
  issuer: Hex;
  receiver: Hex;
  fromDenom: DenomId;
  fromOld: bigint;
  fromNew: bigint;
  toDenom: DenomId;
  /** to-edge total when staged (null = the edge did not exist). */
  toBase: bigint | null;
  toNew: bigint;
  timestamp: bigint;
  /** The issuer's from-denomination reserve box observed at staging (phase 2 requires it unspent). */
  reserveBoxId: Hex;
  reserveId: string;
  /** Four signatures over msg_from(fromNew, ts) and msg_to(toNew, ts); null = lazy (deterministic). */
  sigs: { issuerFrom: Hex | null; receiverFrom: Hex | null; issuerTo: Hex | null; receiverTo: Hex | null };
  status: "staged" | "applied" | "cancelled";
  reason?: string;
  stagedHeight: number;
  resolvedHeight?: number;
}

export interface TrackerOptions {
  /** "on-redemption" = the real server (co-signs stored, confirmed state at redemption time, after policy checks).
   *  "on-submit" = the contract's documented normal workflow (co-signs each note when it is witnessed). */
  coSign: "on-redemption" | "on-submit";
  /** Run the box updater on block ticks. */
  autoCommit: boolean;
  /** Updater interval in blocks (600 s = 5 blocks). */
  commitIntervalBlocks: number;
  /** Real updater: no new box when the digest is unchanged (an idle tracker then opens the emergency path). */
  skipIfUnchanged: boolean;
  /** Server default true: redemption-time acceptance-policy compliance + FIFO. */
  enforceAcceptancePolicy: boolean;
  minDepth: number;
  rateLimitPerHour: number;
}

export const DEFAULT_TRACKER_OPTIONS: TrackerOptions = {
  coSign: "on-redemption",
  autoCommit: true,
  commitIntervalBlocks: 5,
  skipIfUnchanged: true,
  enforceAcceptancePolicy: true,
  minDepth: MIN_CONFIRMATION_DEPTH,
  rateLimitPerHour: REDEMPTION_BUILDS_PER_PAIR_PER_HOUR,
};

export type CensorshipMode = "off" | "refuse" | "omit";

export type TrackerErrorCode =
  | "tracker-offline"
  | "censored"
  | "tracker-nft-mismatch"
  | "invalid-denomination"
  | "amount-exceeds-contract-range"
  | "future-timestamp"
  | "past-timestamp"
  | "debt-decrease-not-permitted"
  | "invalid-signature"
  | "not-found"
  | "note-not-committed"
  | "note-not-confirmed"
  | "stale-committed-debt"
  | "request-mismatch"
  | "multiple-reserves"
  | "no-reserve"
  | "failed_policy_violation"
  | "failed_not_oldest_note"
  | "rate-limited"
  | "invalid-exchange"
  | "exchange-policy-rejected";

export interface TrackerReject {
  ok: false;
  code: TrackerErrorCode;
  /** HTTP status the real server answers with. */
  http: number;
  message: string;
  compliance?: ComplianceResult;
}

export interface NoteSubmission {
  issuer: Hex;
  receiver: Hex;
  denom: DenomId;
  totalDebt: bigint;
  timestamp: bigint;
  trackerNftId: Hex;
  /** null = lazy mode: the sandbox signs deterministically later (the signature is real once materialised). */
  issuerSig: Uint8Array | null;
}

export interface NoteAccept {
  ok: true;
  key: Hex;
  previous: NoteRecord | null;
  /** True when censorship mode "omit" hides this note from the committed tree. */
  omitted: boolean;
}

export interface ReserveView {
  id: string;
  owner: Hex;
  denom: DenomId;
  collateral: bigint;
  refundPending: boolean;
  active: boolean;
}

function reject(code: TrackerErrorCode, http: number, message: string, extra: Partial<TrackerReject> = {}): TrackerReject {
  return { ok: false, code, http, message, ...extra };
}

export interface TrackerInit {
  id: string;
  name: string;
  nftId: Hex;
  operatorId: string;
  key: KeyPair;
  denoms: DenomId[];
  options?: Partial<TrackerOptions>;
  avl?: AvlBackend;
  globalPolicy?: AcceptanceConfig;
}

export class TrackerSim {
  readonly id: string;
  readonly name: string;
  readonly nftId: Hex;
  readonly operatorId: string;
  readonly key: KeyPair;
  readonly pub: Hex;
  readonly denoms: Set<DenomId>;
  options: TrackerOptions;
  online = true;
  censorship: { mode: CensorshipMode; targets: Set<Hex> | "all" } = { mode: "off", targets: new Set() };
  readonly map: AuthenticatedMap;
  readonly notes = new Map<Hex, NoteRecord>();
  private readonly byIssuer = new Map<Hex, Set<Hex>>();
  private readonly byReceiver = new Map<Hex, Set<Hex>>();
  readonly boxes: TrackerBoxRecord[] = [];
  /** Staged / resolved two-phase exchanges, by id. */
  readonly exchanges = new Map<string, PendingExchange>();
  /** Per-recipient stored acceptance policies (POST /acceptance/policy). */
  readonly policies = new Map<Hex, AcceptanceConfig>();
  /** Server config [acceptance]; shipped default: reject with no predicates. */
  globalPolicy: AcceptanceConfig;
  lastCommitAttemptHeight: number;
  private readonly builds = new Map<string, bigint[]>();
  readonly avl: AvlBackend;

  constructor(init: TrackerInit) {
    this.id = init.id;
    this.name = init.name;
    this.nftId = init.nftId.toLowerCase();
    this.operatorId = init.operatorId;
    this.key = init.key;
    this.pub = init.key.pubHex;
    this.denoms = new Set<DenomId>(["erg", ...init.denoms]);
    this.options = { ...DEFAULT_TRACKER_OPTIONS, ...init.options };
    this.avl = init.avl ?? getAvlBackend();
    this.map = this.avl.createMap(32);
    this.globalPolicy = init.globalPolicy ?? { default: "reject", root: null, predicates: [] };
    this.lastCommitAttemptHeight = -Infinity;
  }

  /**
   * Independent copy (time machine checkpoints). Committed tree snapshots and note versions are shared:
   * they are never mutated after creation (a version only gains its deterministic signature).
   */
  clone(): TrackerSim {
    const c = Object.create(TrackerSim.prototype) as TrackerSim;
    const w = c as unknown as Record<string, unknown>;
    w.id = this.id;
    w.name = this.name;
    w.nftId = this.nftId;
    w.operatorId = this.operatorId;
    w.key = this.key;
    w.pub = this.pub;
    w.denoms = new Set(this.denoms);
    w.options = { ...this.options };
    w.online = this.online;
    w.censorship = { mode: this.censorship.mode, targets: this.censorship.targets === "all" ? "all" : new Set(this.censorship.targets) };
    w.map = this.map.clone();
    const notes = new Map<Hex, NoteRecord>();
    for (const [k, r] of this.notes) notes.set(k, { ...r, history: r.history.slice(), trackerSigFor: r.trackerSigFor ? { ...r.trackerSigFor } : null });
    w.notes = notes;
    w.byIssuer = new Map([...this.byIssuer].map(([k, v]) => [k, new Set(v)]));
    w.byReceiver = new Map([...this.byReceiver].map(([k, v]) => [k, new Set(v)]));
    w.boxes = this.boxes.map((b) => ({ ...b }));
    w.exchanges = new Map([...this.exchanges].map(([k, x]) => [k, { ...x, sigs: { ...x.sigs } }]));
    w.policies = new Map(this.policies);
    w.globalPolicy = this.globalPolicy;
    w.lastCommitAttemptHeight = this.lastCommitAttemptHeight;
    w.builds = new Map([...this.builds].map(([k, v]) => [k, v.slice()]));
    w.avl = this.avl;
    return c;
  }

  // ---------- queries ----------

  note(issuer: Hex, receiver: Hex, denom: DenomId = "erg"): NoteRecord | undefined {
    return this.notes.get(bytesToHex(debtKey(issuer, receiver, denom)));
  }

  noteByKey(key: Hex): NoteRecord | undefined {
    return this.notes.get(key);
  }

  notesOfIssuer(issuer: Hex, denom?: DenomId): NoteRecord[] {
    const keys = this.byIssuer.get(issuer);
    if (!keys) return [];
    const out: NoteRecord[] = [];
    for (const k of keys) {
      const r = this.notes.get(k)!;
      if (!denom || r.denom === denom) out.push(r);
    }
    return out;
  }

  notesOfReceiver(receiver: Hex, denom?: DenomId): NoteRecord[] {
    const keys = this.byReceiver.get(receiver);
    if (!keys) return [];
    const out: NoteRecord[] = [];
    for (const k of keys) {
      const r = this.notes.get(k)!;
      if (!denom || r.denom === denom) out.push(r);
    }
    return out;
  }

  allNotes(): NoteRecord[] {
    return [...this.notes.values()];
  }

  currentBox(): TrackerBoxRecord | undefined {
    return this.boxes[this.boxes.length - 1];
  }

  /** The box is deep enough for the updater to promote its notes (depth = height − inclusion + 1 ≥ minDepth). */
  depthReached(box: TrackerBoxRecord, height: number): boolean {
    return height - box.creationHeight + 1 >= this.options.minDepth;
  }

  /** The updater has observed the box at sufficient depth (its notes are Confirmed). */
  isConfirmed(box: TrackerBoxRecord | undefined = this.currentBox()): boolean {
    return !!box && box.confirmedHeight !== null;
  }

  /** Reducer: the updater saw `boxId` deep enough at `height`. */
  markConfirmed(boxId: Hex, height: number): void {
    const box = this.boxes.find((b) => b.boxId === boxId);
    if (!box || box.confirmedHeight !== null) return;
    const before = this.confirmedIndex();
    box.confirmedHeight = height;
    // lookup trees are kept for the current box, the previous one and the newest confirmed one
    const after = this.confirmedIndex();
    if (before >= 0 && before !== after && before < this.boxes.length - 2) this.boxes[before].tree = null;
  }

  /** Index in `boxes` of the newest box the updater has confirmed (−1 if none). */
  private confirmedIndex(): number {
    for (let i = this.boxes.length - 1; i >= 0; i--) if (this.boxes[i].confirmedHeight !== null) return i;
    return -1;
  }

  /** The newest box the updater has confirmed: the state the server builds committed proofs against. */
  confirmedBox(): TrackerBoxRecord | undefined {
    const i = this.confirmedIndex();
    return i >= 0 ? this.boxes[i] : undefined;
  }

  /** Total committed in the latest on-chain box for `key` (null = not in the tree). */
  committedTotal(key: Hex): bigint | null {
    const box = this.currentBox();
    if (!box?.tree) return null;
    const v = box.tree.get(hexToBytes(key));
    return v ? readI64BE(v, 0) : null;
  }

  /** Total for `key` in the newest confirmed box: the server's per-note `confirmed_total_debt` (null = none). */
  confirmedTotal(key: Hex): bigint | null {
    const box = this.confirmedBox();
    if (!box?.tree) return null;
    const v = box.tree.get(hexToBytes(key));
    return v ? readI64BE(v, 0) : null;
  }

  /**
   * Per-note confirmation, like the server (NoteConfirmationStatus): `confirmed` when the note's total is in a
   * box the updater has confirmed, `pending` when only the newest (still unconfirmed) box holds it, `local`
   * otherwise. While a new box waits for depth, mark_notes_pending only touches notes whose total changed, so an
   * unchanged note stays Confirmed (and redeemable). The current box must hold the total too: it is the data
   * input every redemption uses.
   */
  status(rec: NoteRecord, height: number): NoteStatus {
    const box = this.currentBox();
    if (!box) return "local";
    const c = this.committedTotal(rec.key);
    if (c === null || c !== rec.totalDebt) return "local";
    void height;
    if (this.isConfirmed(box)) return "confirmed";
    return this.confirmedTotal(rec.key) === rec.totalDebt ? "confirmed" : "pending";
  }

  /** Blocks since the latest tracker box was created. */
  boxAge(height: number): number {
    const box = this.currentBox();
    return box ? height - box.creationHeight : 0;
  }

  /** First height at which the emergency path (no tracker signature) opens for the current box. */
  emergencyOpensAt(): number | null {
    const box = this.currentBox();
    return box ? box.creationHeight + EMERGENCY_BLOCKS + 1 : null;
  }

  emergencyOpen(height: number): boolean {
    const box = this.currentBox();
    return !!box && height - box.creationHeight > EMERGENCY_BLOCKS;
  }

  digest(): Uint8Array {
    return this.map.digest();
  }

  /** The tracker box as a data input (for the reserve contract). */
  dataInput(): SimBox {
    const box = this.currentBox();
    if (!box || !box.tree) throw new Error(`tracker ${this.id} has no box on chain`);
    return trackerBoxFor({ boxId: box.boxId, nftId: this.nftId, trackerPub: this.pub, tree: box.tree, creationHeight: box.creationHeight, digest: box.digest });
  }

  isCensored(issuer: Hex, receiver: Hex): boolean {
    if (this.censorship.mode === "off") return false;
    if (this.censorship.targets === "all") return true;
    return this.censorship.targets.has(issuer) || this.censorship.targets.has(receiver);
  }

  // ---------- POST /notes ----------

  /** All create_note + add_note checks, in the server's order. Pure: does not change state. */
  checkNote(sub: NoteSubmission, nowMs: bigint): NoteAccept | TrackerReject {
    if (!this.online) return reject("tracker-offline", 503, "tracker unreachable");
    if (this.isCensored(sub.issuer, sub.receiver) && this.censorship.mode === "refuse") {
      return reject("censored", 503, "the tracker did not accept the note (censorship: the protocol cannot force a tracker to witness a note)");
    }
    if (sub.trackerNftId.toLowerCase() !== this.nftId) {
      return reject("tracker-nft-mismatch", 409, `Note is bound to tracker NFT ${sub.trackerNftId}, this tracker is ${this.nftId}`);
    }
    if (!this.denoms.has(sub.denom)) return reject("invalid-denomination", 400, `invalid denomination: ${sub.denom} is not served by this tracker`);
    const range = contractRangeError(sub.totalDebt, sub.timestamp);
    if (range) return reject("amount-exceeds-contract-range", 400, `${range.field} exceeds the range the on-chain contract can represent: ${range.value}`);
    if (sub.timestamp > nowMs) return reject("future-timestamp", 400, "Future timestamp");
    const key = bytesToHex(debtKey(sub.issuer, sub.receiver, sub.denom));
    const prev = this.notes.get(key) ?? null;
    if (prev) {
      if (sub.timestamp <= prev.timestamp) return reject("past-timestamp", 400, "Past timestamp");
      if (sub.totalDebt < prev.totalDebt) {
        return reject("debt-decrease-not-permitted", 400, `Cumulative debt cannot decrease without the creditor's consent (existing ${prev.totalDebt}, requested ${sub.totalDebt})`);
      }
    }
    if (sub.issuerSig) {
      const msg = noteMessage(hexToBytes(key), sub.totalDebt, sub.timestamp, this.nftId);
      if (!verify(sub.issuer, msg, sub.issuerSig).ok) return reject("invalid-signature", 400, "Invalid signature");
    }
    const omitted = this.censorship.mode === "omit" && this.isCensored(sub.issuer, sub.receiver);
    return { ok: true, key, previous: prev, omitted };
  }

  /** Reducer for an accepted note. */
  applyNote(p: {
    issuer: Hex;
    receiver: Hex;
    denom: DenomId;
    totalDebt: bigint;
    timestamp: bigint;
    amount: bigint;
    issuerSig: Hex | null;
    trackerSig?: Hex | null;
    omitted: boolean;
    seq: number;
    height: number;
    via: NoteVia;
    memo?: string;
  }): NoteRecord {
    const kb = debtKey(p.issuer, p.receiver, p.denom);
    const key = bytesToHex(kb);
    let rec = this.notes.get(key);
    const version: NoteVersion = { totalDebt: p.totalDebt, timestamp: p.timestamp, amount: p.amount, issuerSig: p.issuerSig, seq: p.seq, height: p.height, via: p.via, memo: p.memo };
    if (!rec) {
      rec = {
        tracker: this.id,
        key,
        reserveKey: bytesToHex(reserveKey(p.issuer, p.receiver)),
        issuer: p.issuer,
        receiver: p.receiver,
        denom: p.denom,
        totalDebt: p.totalDebt,
        timestamp: p.timestamp,
        amountRedeemed: 0n,
        issuerSig: p.issuerSig,
        trackerSig: p.trackerSig ?? null,
        trackerSigFor: p.trackerSig ? { totalDebt: p.totalDebt, timestamp: p.timestamp } : null,
        omitted: p.omitted,
        waived: 0n,
        history: [version],
        createdHeight: p.height,
        updatedHeight: p.height,
      };
      this.notes.set(key, rec);
      if (!this.byIssuer.has(p.issuer)) this.byIssuer.set(p.issuer, new Set());
      this.byIssuer.get(p.issuer)!.add(key);
      if (!this.byReceiver.has(p.receiver)) this.byReceiver.set(p.receiver, new Set());
      this.byReceiver.get(p.receiver)!.add(key);
    } else {
      rec.totalDebt = p.totalDebt;
      rec.timestamp = p.timestamp;
      rec.issuerSig = p.issuerSig;
      rec.omitted = p.omitted;
      rec.history.push(version);
      rec.updatedHeight = p.height;
      if (p.trackerSig) {
        rec.trackerSig = p.trackerSig;
        rec.trackerSigFor = { totalDebt: p.totalDebt, timestamp: p.timestamp };
      }
    }
    if (!p.omitted) this.map.insertOrUpdate(kb, trackerTreeValue(p.totalDebt));
    return rec;
  }

  // ---------- box updater ----------

  /** What the updater would do at `height` (pure). */
  planCommit(height: number, force = false): { digest: Hex; notes: number } | null {
    if (!this.online) return null;
    const digest = bytesToHex(this.map.digest());
    const box = this.currentBox();
    if (!force && box && this.options.skipIfUnchanged && box.digest === digest) return null;
    void height;
    return { digest, notes: this.map.size };
  }

  /** Whether the periodic updater runs at `height` (every commitIntervalBlocks). */
  updaterDue(height: number): boolean {
    return this.online && this.options.autoCommit && height - this.lastCommitAttemptHeight >= this.options.commitIntervalBlocks;
  }

  applyCommit(p: { boxId: Hex; txId: Hex; creationHeight: number; digest: Hex }): TrackerBoxRecord {
    const tree = this.map.clone();
    const digest = bytesToHex(tree.digest());
    if (digest !== p.digest) throw new Error(`replay diverged: tracker ${this.id} digest ${digest} ≠ ${p.digest}`);
    const box: TrackerBoxRecord = {
      boxId: p.boxId,
      txId: p.txId,
      creationHeight: p.creationHeight,
      digest,
      notes: tree.size,
      registers: { R4: encodeGroupElement(this.pub), R5: basisAvlRegister(digest), R6: encodeCollByte(this.nftId) },
      tree,
      confirmedHeight: null,
    };
    this.boxes.push(box);
    // drop the lookup tree of the box before the previous one, unless it is still the newest confirmed box
    // (status() and confirmedTotal() read it while a newer box waits for depth)
    const old = this.boxes.length - 3;
    if (old >= 0 && old !== this.confirmedIndex()) this.boxes[old].tree = null;
    this.lastCommitAttemptHeight = p.creationHeight;
    return box;
  }

  markUpdaterRun(height: number): void {
    this.lastCommitAttemptHeight = height;
  }

  // ---------- signatures ----------

  /** Co-signs the 80-byte message (deterministic nonce → same bytes on every replay). */
  coSign(rec: Pick<NoteRecord, "key">, totalDebt: bigint, timestamp: bigint): Uint8Array {
    return sign(noteMessage(hexToBytes(rec.key), totalDebt, timestamp, this.nftId), this.key);
  }

  // ---------- redemption gate ----------

  /**
   * /redemption/build + /tracker/signature: returns the tracker signature (empty in emergency) or the
   * server's refusal. `worstCase` = check policy compliance for redeeming the full outstanding amount
   * (what /tracker/signature does) instead of `amount` (what /redemption/build does).
   *
   * Order of /redemption/build: the per-pair rate limit comes first (the server records every attempt it
   * lets through, refused later or not), then the note lookup, the single-reserve rule, the acceptance
   * policy, and last the committed proof (stale committed debt, then not committed / not confirmed).
   * Attempts a wallet refuses before it reaches the tracker (Economy.redeem's own checks) are not counted.
   * The real /tracker/signature has none of the rate-limit, stale or confirmation gates.
   * `emergency` only reports what the tracker data allows a holder's own build; it skips the server gates.
   */
  authorizeRedemption(p: {
    issuer: Hex;
    receiver: Hex;
    denom: DenomId;
    amount: bigint;
    emergency: boolean;
    height: number;
    nowMs: bigint;
    reserves: ReserveView[];
    worstCase?: boolean;
    sign?: boolean;
  }): { ok: true; record: NoteRecord; trackerSig: Uint8Array; compliance: ComplianceResult | null } | TrackerReject {
    const rec = this.note(p.issuer, p.receiver, p.denom);
    if (!p.emergency && !this.online) return reject("tracker-offline", 503, "tracker unreachable");
    if (!p.emergency && this.recentBuilds(p.issuer, p.receiver, p.nowMs) >= this.options.rateLimitPerHour) {
      return reject("rate-limited", 429, `rate limit: at most ${this.options.rateLimitPerHour} redemption builds per pair per hour`);
    }
    if (!rec) return reject("not-found", 404, "Note not found");
    const committed = this.committedTotal(rec.key);
    // a consented decrease (exchange) that is not committed yet: the server compares the note's confirmed value
    // (generate_committed_tracker_lookup_proof); a holder's own emergency build reads the current box, its data input
    const reference = p.emergency ? committed : this.confirmedTotal(rec.key);
    const ahead = reference !== null && reference > rec.totalDebt ? reference : null;
    const stale = (): TrackerReject =>
      reject(
        "stale-committed-debt",
        409,
        `Committed tracker state (${ahead}) is ahead of the note's current total (${rec.totalDebt}); a consented debt decrease has not been committed yet. Retry after the next tracker box update`,
      );
    if (p.emergency) return ahead !== null ? stale() : { ok: true, record: rec, trackerSig: new Uint8Array(), compliance: null };
    const live = p.reserves.filter((r) => r.active && r.owner === p.issuer && r.denom === p.denom);
    if (live.length > 1) {
      return reject("multiple-reserves", 409, `issuer has ${live.length} tracked reserves in ${p.denom}; refusing to sign: the same note would redeem in full against each`);
    }
    let compliance: ComplianceResult | null = null;
    if (this.options.enforceAcceptancePolicy) {
      const reserve = live[0];
      if (!reserve) return reject("no-reserve", 409, `No tracked reserve found for issuer ${p.issuer} in denomination ${p.denom}; refusing to sign a redemption the acceptance policy cannot evaluate`);
      const notes: ComplianceNote[] = this.notesOfIssuer(p.issuer).map((n) => ({ recipient: n.receiver, amountCollected: n.totalDebt, amountRedeemed: n.amountRedeemed, timestamp: n.timestamp, denom: n.denom }));
      const outstanding = rec.totalDebt > rec.amountRedeemed ? rec.totalDebt - rec.amountRedeemed : 0n;
      compliance = checkRedemptionCompliance({
        issuer: p.issuer,
        redeemer: p.receiver,
        redeemAmount: p.worstCase ? outstanding : p.amount,
        reserveValue: reserve.collateral,
        fee: 0n,
        refundPending: reserve.refundPending,
        notes,
        denom: p.denom,
        storedPolicy: (h) => this.policies.get(h),
        globalPolicy: this.globalPolicy,
      });
      if (!compliance.ok) return reject(compliance.failureId, 400, compliance.message, { compliance });
    }
    if (ahead !== null) return stale();
    if (committed === null) return reject("note-not-committed", 409, "Note is not committed on-chain yet");
    if (this.status(rec, p.height) !== "confirmed") return reject("note-not-confirmed", 409, "Note is not committed on-chain yet");
    const trackerSig = p.sign === false ? new Uint8Array() : this.coSign(rec, rec.totalDebt, rec.timestamp);
    return { ok: true, record: rec, trackerSig, compliance };
  }

  /** A staged exchange of this (issuer, receiver) pair, if any (only one may be in flight). */
  stagedExchange(issuer: Hex, receiver: Hex): PendingExchange | undefined {
    for (const x of this.exchanges.values()) if (x.status === "staged" && x.issuer === issuer && x.receiver === receiver) return x;
    return undefined;
  }

  /**
   * Phase 2 decision (decide_staged_exchange) for one staged exchange. `reserveBoxId` = the issuer's
   * from-denomination reserve box currently unspent on chain (null = spent / gone).
   */
  decideExchange(x: PendingExchange, reserveBoxId: Hex | null): { decision: "wait" } | { decision: "apply" } | { decision: "cancel"; reason: string } {
    // 1. the from-edge must be Confirmed, and confirmed exactly at the decreased total
    const from = this.note(x.issuer, x.receiver, x.fromDenom);
    if (!from || this.status(from, 0) !== "confirmed") return { decision: "wait" };
    if (from.totalDebt !== x.fromNew) {
      return { decision: "cancel", reason: `from-edge committed total is ${from.totalDebt} but the exchange decreased it to ${x.fromNew}; the tracker state moved past the exchange` };
    }
    // 2./3. the observed reserve box must be the one recorded at staging (unspent)
    if (reserveBoxId !== x.reserveBoxId) {
      return {
        decision: "cancel",
        reason: `from-denomination reserve box ${x.reserveBoxId.slice(0, 16)}… is no longer unspent; an on-chain reserve action (redemption, top-up, or refund) occurred while the exchange was staged`,
      };
    }
    const to = this.note(x.issuer, x.receiver, x.toDenom);
    const unchanged = x.toBase === null ? !to : !!to && to.totalDebt === x.toBase;
    if (!unchanged) {
      return { decision: "cancel", reason: "the to-edge changed while the exchange was staged (a new note was issued on it); the staged increase no longer matches the agreed state" };
    }
    return { decision: "apply" };
  }

  /** Redemption builds of this pair in the hour before `nowMs` (the server's per-pair rate limiter). */
  recentBuilds(issuer: Hex, receiver: Hex, nowMs: bigint): number {
    const list = this.builds.get(`${issuer}|${receiver}`);
    if (!list) return 0;
    const hourAgo = nowMs - 3_600_000n;
    let n = 0;
    for (const t of list) if (t > hourAgo) n++;
    return n;
  }

  /** Reducer: one redemption build was handed out (counts towards the rate limit). */
  recordBuild(issuer: Hex, receiver: Hex, nowMs: bigint): void {
    const pair = `${issuer}|${receiver}`;
    const hourAgo = nowMs - 3_600_000n;
    const list = (this.builds.get(pair) ?? []).filter((t) => t > hourAgo);
    list.push(nowMs);
    this.builds.set(pair, list);
  }

  /** Reducer: record_redemption (amount_redeemed += amount on the stored note). */
  applyRedemption(issuer: Hex, receiver: Hex, denom: DenomId, amount: bigint, trackerSig?: Hex): void {
    const rec = this.note(issuer, receiver, denom);
    if (!rec) return;
    rec.amountRedeemed += amount;
    if (trackerSig) {
      rec.trackerSig = trackerSig;
      rec.trackerSigFor = { totalDebt: rec.totalDebt, timestamp: rec.timestamp };
    }
  }
}
