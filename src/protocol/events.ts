// The economy is event-sourced: every state change is one of these events, in `Economy.events`.
// Commands (Economy methods) validate and do the cryptography; reducers only apply event data, so
// replaying the log rebuilds the exact state (time machine, forks, sharing a run as JSON).

import type { Hex } from "./bytes";
import type { DenomId, DenominationInfo } from "./note";
import type { AcceptanceConfig } from "./policy";
import type { ReserveContract } from "./reserve";
import type { CensorshipMode, NoteVia, TrackerOptions } from "./tracker";

export type ParticipantKind = "human" | "agent" | "business" | "tracker-operator";

/** How a participant's key is (re)derived on replay. Demo keys are public by construction. */
export type KeySource = { source: "demo"; salt: string; label: string } | { source: "secret"; secretHex: Hex };

/**
 * Tracker publications named in specs/tracker_protocol.md (proposed as NOSTR events). The server has no NOSTR
 * code; its in-memory event store emits NoteUpdated (= our note.issued) and, from the chain scanner,
 * ReserveCreated / ReserveToppedUp / ReserveRedeemed / ReserveSpent (`inServer: true`). Commitment and
 * CollateralAlert exist only as hard-coded demo events seeded at start-up (`inServer: false`).
 */
export type NostrKind = "redemption" | "reserve-top-up" | "commitment" | "alert-80" | "alert-100";

export interface EventStamp {
  seq: number;
  height: number;
  /** Logical time (ms since epoch) when the event happened. */
  timeMs: bigint;
}

export type EventBody =
  | { type: "genesis"; seed: string; genesisHeight: number; genesisTimeMs: bigint; lazySignatures: boolean; avlBackend: string; demoSalt: string }
  | { type: "denomination.added"; denom: DenominationInfo }
  | { type: "participant.joined"; id: string; name: string; kind: ParticipantKind; avatarSeed: string; pub: Hex; key: KeySource; meta?: Record<string, string> }
  | { type: "participant.status"; participant: string; online: boolean }
  | { type: "wallet.funded"; participant: string; denom: DenomId; amount: bigint; memo?: string }
  | {
      type: "tracker.created";
      tracker: string;
      name: string;
      nftId: Hex;
      operator: string;
      pub: Hex;
      denoms: DenomId[];
      options: TrackerOptions;
      globalPolicy: AcceptanceConfig;
      boxId: Hex;
      txId: Hex;
      digest: Hex;
    }
  | { type: "tracker.committed"; tracker: string; boxId: Hex; txId: Hex; prevBoxId: Hex | null; creationHeight: number; digest: Hex; notes: number; heartbeat: boolean }
  | { type: "tracker.confirmed"; tracker: string; boxId: Hex; depth: number }
  | { type: "tracker.status"; tracker: string; online: boolean; reason?: string }
  | { type: "tracker.censorship"; tracker: string; mode: CensorshipMode; targets: Hex[] | "all" }
  | { type: "tracker.policy"; tracker: string; policy: AcceptanceConfig }
  | { type: "tracker.options"; tracker: string; options: Partial<TrackerOptions> }
  | { type: "policy.set"; participant: string; policy: AcceptanceConfig | null }
  | { type: "credit.set"; creditor: string; debtor: string; denom: DenomId; limit: bigint | null }
  | {
      type: "note.issued";
      tracker: string;
      issuer: string;
      receiver: string;
      denom: DenomId;
      amount: bigint;
      totalDebt: bigint;
      timestamp: bigint;
      key: Hex;
      /** null = lazy (materialise with Economy.signatures). */
      issuerSig: Hex | null;
      /** Co-signature handed out at submission (tracker coSign "on-submit"); null otherwise or lazy. */
      trackerSig: Hex | null;
      omitted: boolean;
      via: NoteVia;
      memo?: string;
      /** seq of the note.offline event this note syncs. */
      offlineRef?: number;
    }
  | {
      type: "note.rejected";
      tracker?: string;
      issuer: string;
      receiver: string;
      denom: DenomId;
      amount: bigint;
      totalDebt?: bigint;
      timestamp?: bigint;
      by: "receiver" | "credit-line" | "tracker" | "issuer";
      code: string;
      message: string;
      via: NoteVia;
      offlineRef?: number;
    }
  | { type: "note.offline"; tracker: string; issuer: string; receiver: string; denom: DenomId; amount: bigint; totalDebt: bigint; timestamp: bigint; issuerSig: Hex | null; memo?: string }
  | { type: "waiver"; creditor: string; issuer: string; denom: DenomId; amount: bigint; reason: "novation" | "clearing"; beneficiary?: string; ref?: number }
  | { type: "chain.mined"; from: number; to: number }
  | {
      type: "reserve.created";
      reserve: string;
      owner: string;
      tracker: string;
      denom: DenomId;
      contract: ReserveContract;
      value: bigint;
      tokenAmount: bigint;
      boxId: Hex;
      txId: Hex;
      reserveNftId: Hex | null;
      digest: Hex;
      fee: bigint;
    }
  | { type: "reserve.toppedUp"; reserve: string; by: string; amount: bigint; boxId: Hex; prevBoxId: Hex; txId: Hex; fee: bigint }
  | {
      type: "reserve.redeemed";
      reserve: string;
      tracker: string;
      issuer: string;
      receiver: string;
      denom: DenomId;
      amount: bigint;
      totalDebt: bigint;
      timestamp: bigint;
      redeemedTotal: bigint;
      emergency: boolean;
      issuerSig: Hex;
      trackerSig: Hex;
      boxId: Hex;
      prevBoxId: Hex;
      txId: Hex;
      digest: Hex;
      feePayer: string;
      fee: bigint;
      /** ERG the fee payer adds to a token redemption output (0.001 ERG), 0 for ERG reserves. */
      minBox: bigint;
      /** The tracker built/co-signed this redemption (counts towards its 60-per-pair-per-hour limit). */
      built: boolean;
      clearing?: string;
    }
  | { type: "reserve.refundInitiated"; reserve: string; r7: bigint; boxId: Hex; prevBoxId: Hex; txId: Hex; fee: bigint }
  | { type: "reserve.refundCompleted"; reserve: string; value: bigint; tokenAmount: bigint; txId: Hex; fee: bigint }
  | {
      type: "redemption.rejected";
      reserve?: string;
      tracker?: string;
      issuer: string;
      receiver: string;
      denom: DenomId;
      amount: bigint;
      stage: "wallet" | "tracker" | "contract";
      code: string;
      message: string;
      failed?: string[];
      /** The tracker had already built/co-signed it (the transaction then failed on-chain). */
      built?: boolean;
    }
  | { type: "action.rejected"; reserve: string; action: "create" | "top-up" | "initiate-refund" | "complete-refund"; by: string; code: string; message: string; failed?: string[] }
  | {
      type: "nostr";
      tracker: string;
      kind: NostrKind;
      issuer?: string;
      receiver?: string;
      reserve?: string;
      denom?: DenomId;
      amount?: bigint;
      /** Alerts: outstanding debt / collateral after the note. */
      ratio?: number;
      digest?: Hex;
      inServer: boolean;
    }
  | {
      type: "exchange.staged";
      tracker: string;
      id: string;
      issuer: string;
      receiver: string;
      fromDenom: DenomId;
      fromAmount: bigint;
      fromOld: bigint;
      fromNew: bigint;
      toDenom: DenomId;
      toAmount: bigint;
      toBase: bigint | null;
      toNew: bigint;
      timestamp: bigint;
      reserve: string;
      reserveBoxId: Hex;
      /** Issuer and receiver each sign msg_from(fromNew, ts) and msg_to(toNew, ts); null = lazy. */
      sigs: { issuerFrom: Hex | null; receiverFrom: Hex | null; issuerTo: Hex | null; receiverTo: Hex | null };
    }
  | { type: "exchange.applied"; tracker: string; id: string }
  | { type: "exchange.cancelled"; tracker: string; id: string; reason: string }
  | {
      type: "exchange.rejected";
      tracker: string;
      issuer: string;
      receiver: string;
      fromDenom: DenomId;
      fromAmount: bigint;
      toDenom: DenomId;
      toAmount: bigint;
      code: string;
      http: number;
      message: string;
    }
  | { type: "clearing.settled"; id: string; denom: DenomId; members: string[]; amount: bigint; mode: "onchain" | "waivers"; txId?: Hex; legs: number }
  | { type: "clearing.rejected"; denom: DenomId; members: string[]; amount: bigint; code: string; message: string }
  | { type: "scenario.step"; scenario: string; index: number; title: string; text: string }
  | { type: "annotation"; text: string; level: "info" | "warn" };

export type EconomyEvent = EventStamp & EventBody;
export type EventType = EventBody["type"];
export type EventOf<T extends EventType> = EventStamp & Extract<EventBody, { type: T }>;

/** Events that only inform (rejections, notices): replay skips nothing, but they change no state. */
export const INFORMATIONAL_EVENTS: ReadonlySet<EventType> = new Set<EventType>([
  "note.rejected",
  "redemption.rejected",
  "action.rejected",
  "clearing.rejected",
  "exchange.rejected",
  "scenario.step",
  "annotation",
]);

// ---------- JSON (bigint-safe) ----------

/** Serialises events (bigints as {"$n":"123"}) so a run can be saved, shared and replayed. */
export function eventsToJson(events: readonly EconomyEvent[], indent?: number): string {
  return JSON.stringify(events, (_k, v) => (typeof v === "bigint" ? { $n: v.toString() } : v), indent);
}

export function eventsFromJson(json: string): EconomyEvent[] {
  return JSON.parse(json, (_k, v) => (v && typeof v === "object" && typeof v.$n === "string" && Object.keys(v).length === 1 ? BigInt(v.$n) : v)) as EconomyEvent[];
}

/** One-line human summary of an event (for logs, tooltips and tests). */
export function describeEvent(e: EconomyEvent, name: (id: string) => string = (id) => id): string {
  switch (e.type) {
    case "genesis":
      return `genesis at height ${e.genesisHeight} (seed "${e.seed}")`;
    case "denomination.added":
      return `denomination ${e.denom.symbol} (${e.denom.id})`;
    case "participant.joined":
      return `${e.name} joined (${e.kind})`;
    case "participant.status":
      return `${name(e.participant)} is ${e.online ? "online" : "offline"}`;
    case "wallet.funded":
      return `${name(e.participant)} wallet +${e.amount} ${e.denom}`;
    case "tracker.created":
      return `tracker ${e.name} created (NFT ${e.nftId.slice(0, 8)}…)`;
    case "tracker.committed":
      return `${e.tracker} committed digest ${e.digest.slice(0, 10)}… at ${e.creationHeight} (${e.notes} notes)${e.heartbeat ? " [heartbeat]" : ""}`;
    case "tracker.confirmed":
      return `${e.tracker} box ${e.boxId.slice(0, 8)}… confirmed (depth ${e.depth})`;
    case "tracker.status":
      return `${e.tracker} ${e.online ? "back online" : "went offline"}${e.reason ? ` (${e.reason})` : ""}`;
    case "tracker.censorship":
      return `${e.tracker} censorship: ${e.mode}`;
    case "tracker.policy":
      return `${e.tracker} global acceptance policy set`;
    case "tracker.options":
      return `${e.tracker} options changed`;
    case "policy.set":
      return `${name(e.participant)} ${e.policy ? "set" : "cleared"} an acceptance policy`;
    case "credit.set":
      return `${name(e.creditor)} gives ${name(e.debtor)} a credit line of ${e.limit ?? "∞"} ${e.denom}`;
    case "note.issued":
      return `${name(e.issuer)} → ${name(e.receiver)}: +${e.amount} (total ${e.totalDebt}) ${e.denom}${e.omitted ? " [omitted by tracker]" : ""}`;
    case "note.rejected":
      return `rejected ${name(e.issuer)} → ${name(e.receiver)} +${e.amount}: ${e.code}`;
    case "note.offline":
      return `offline note ${name(e.issuer)} → ${name(e.receiver)} +${e.amount} (total ${e.totalDebt})`;
    case "waiver":
      return `${name(e.creditor)} waives ${e.amount} of ${name(e.issuer)}'s debt (${e.reason})`;
    case "chain.mined":
      return `blocks ${e.from + 1}…${e.to} mined`;
    case "reserve.created":
      return `${name(e.owner)} opened reserve ${e.reserve} (${e.contract === "basis-token" ? `${e.tokenAmount} units` : `${e.value} nanoERG`})`;
    case "reserve.toppedUp":
      return `${name(e.by)} topped up ${e.reserve} by ${e.amount}`;
    case "reserve.redeemed":
      return `${name(e.receiver)} redeemed ${e.amount} from ${e.reserve}${e.emergency ? " (emergency, no tracker signature)" : ""}`;
    case "reserve.refundInitiated":
      return `${e.reserve}: refund initiated, R7 = ${e.r7}`;
    case "reserve.refundCompleted":
      return `${e.reserve}: refund completed, owner took everything`;
    case "redemption.rejected":
      return `redemption ${name(e.receiver)} ← ${name(e.issuer)} refused at ${e.stage}: ${e.code}`;
    case "action.rejected":
      return `${e.action} on ${e.reserve} refused: ${e.code}`;
    case "nostr":
      return `tracker event "${e.kind}"${e.inServer ? "" : " (spec only)"}`;
    case "exchange.staged":
      return `${name(e.receiver)} swaps ${e.fromAmount} ${e.fromDenom} of ${name(e.issuer)}'s debt for ${e.toAmount} ${e.toDenom} (staged)`;
    case "exchange.applied":
      return `exchange ${e.id.slice(0, 8)}… applied: the to-edge increase is live`;
    case "exchange.cancelled":
      return `exchange ${e.id.slice(0, 8)}… cancelled: ${e.reason}`;
    case "exchange.rejected":
      return `exchange refused: ${e.code}`;
    case "clearing.settled":
      return `cleared ${e.amount} around ${e.members.map(name).join(" → ")} (${e.mode})`;
    case "clearing.rejected":
      return `clearing refused: ${e.code}`;
    case "scenario.step":
      return `▶ ${e.title}`;
    case "annotation":
      return e.text;
  }
}
