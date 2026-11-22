// One line per economy event, EN/RU, for the EventFeed: group (filter chip), mark (lamp/tag shape), text and
// actors. Pure; the tests check that every event type and every refusal stage has copy.

import type { DenomId, EconomyEvent, EventType } from "@/protocol";
import { ERG_UNIT, fmtAmount, fmtInt, shortHex, type UnitInfo, type VizLang } from "../core/format";
import { reasonTitle, translate } from "../core/lang";

export type FeedGroup = "notes" | "chain" | "reserves" | "tracker" | "alerts" | "rejections";
export const FEED_GROUPS: readonly FeedGroup[] = ["notes", "chain", "reserves", "tracker", "alerts", "rejections"];

/** Shape first (VISUAL §7, §12.2): ○ signed · ● committed (holo) · ● live · ◆ metal · ✕ refused · ▲ alert · ▪ block · · world. */
export type FeedMark = "signed" | "committed" | "live" | "metal" | "refused" | "alert" | "block" | "world" | "story" | "nostr";

export const EVENT_TYPES: readonly EventType[] = [
  "genesis", "denomination.added", "participant.joined", "participant.status", "wallet.funded",
  "tracker.created", "tracker.committed", "tracker.confirmed", "tracker.status", "tracker.censorship", "tracker.policy", "tracker.options",
  "policy.set", "credit.set",
  "note.issued", "note.rejected", "note.offline", "waiver",
  "chain.mined",
  "reserve.created", "reserve.toppedUp", "reserve.redeemed", "reserve.refundInitiated", "reserve.refundCompleted", "redemption.rejected", "action.rejected",
  "nostr",
  "exchange.staged", "exchange.applied", "exchange.cancelled", "exchange.rejected",
  "clearing.settled", "clearing.rejected",
  "scenario.step", "annotation",
];

export function groupOf(e: EconomyEvent): FeedGroup {
  switch (e.type) {
    case "note.issued":
    case "note.offline":
    case "waiver":
    case "policy.set":
    case "credit.set":
    case "exchange.staged":
    case "exchange.applied":
    case "exchange.cancelled":
    case "clearing.settled":
    case "scenario.step":
      return "notes";
    case "genesis":
    case "chain.mined":
    case "denomination.added":
    case "participant.joined":
    case "participant.status":
    case "wallet.funded":
      return "chain";
    case "reserve.created":
    case "reserve.toppedUp":
    case "reserve.redeemed":
    case "reserve.refundInitiated":
    case "reserve.refundCompleted":
      return "reserves";
    case "tracker.created":
    case "tracker.committed":
    case "tracker.confirmed":
    case "tracker.status":
    case "tracker.censorship":
    case "tracker.policy":
    case "tracker.options":
      return "tracker";
    case "nostr":
      // Every NOSTR kind is spec only: the reference server has no NOSTR code, its reserve-event handler
      // (basis_server main.rs process_reserve_event) has no caller, and commitments/alerts are seeded demo events.
      return e.kind === "alert-80" || e.kind === "alert-100" ? "alerts" : e.kind === "commitment" ? "tracker" : "reserves";
    case "annotation":
      return e.level === "warn" ? "alerts" : "notes";
    case "note.rejected":
    case "redemption.rejected":
    case "action.rejected":
    case "exchange.rejected":
    case "clearing.rejected":
      return "rejections";
  }
}

export function markOf(e: EconomyEvent): FeedMark {
  switch (e.type) {
    case "note.issued":
    case "note.offline":
    case "waiver":
    case "exchange.staged":
      return "signed";
    case "tracker.committed":
      return "committed";
    case "tracker.confirmed":
    case "exchange.applied":
    case "clearing.settled":
      return "live";
    case "reserve.created":
    case "reserve.toppedUp":
    case "reserve.redeemed":
    case "reserve.refundInitiated":
    case "reserve.refundCompleted":
      return "metal";
    case "note.rejected":
    case "redemption.rejected":
    case "action.rejected":
    case "exchange.rejected":
    case "clearing.rejected":
    case "exchange.cancelled":
      return "refused";
    case "nostr":
      // Every NOSTR kind is spec only: the reference server has no NOSTR code, its reserve-event handler
      // (basis_server main.rs process_reserve_event) has no caller, and commitments/alerts are seeded demo events.
      return e.kind === "alert-80" || e.kind === "alert-100" ? "alert" : "nostr";
    case "tracker.status":
      return e.online ? "live" : "alert";
    case "tracker.censorship":
      return e.mode === "off" ? "world" : "alert";
    case "annotation":
      return e.level === "warn" ? "alert" : "story";
    case "scenario.step":
      return "story";
    case "chain.mined":
    case "genesis":
      return "block";
    default:
      return "world";
  }
}

export interface FeedLine {
  group: FeedGroup;
  mark: FeedMark;
  text: string;
  actors: string[];
  /** nostr: does the real server emit this today? */
  inServer?: boolean;
}

export interface DescribeCtx {
  lang: VizLang;
  nameOf: (id: string) => string;
  unitOf: (denom: DenomId) => UnitInfo;
}

export function defaultUnitOf(denom: DenomId): UnitInfo {
  return denom === "erg" ? ERG_UNIT : { symbol: shortHex(denom.slice(6), 4, 0).replace("…", ""), decimals: 0 };
}

export function describeLine(e: EconomyEvent, ctx: DescribeCtx): FeedLine {
  const T = (k: string, v?: Record<string, string | number>) => translate(ctx.lang, k, v);
  const n = ctx.nameOf;
  const amt = (v: bigint, d: DenomId = "erg") => fmtAmount(v, ctx.unitOf(d));
  const reason = (code: string, message?: string) => reasonTitle(ctx.lang, code, message);
  const group = groupOf(e);
  const mark = markOf(e);
  const L = (key: string, vars: Record<string, string | number>, actors: string[], inServer?: boolean): FeedLine => ({ group, mark, text: T(`viz.ev.${key}`, vars), actors, inServer });
  switch (e.type) {
    case "genesis":
      return L("genesis", { h: fmtInt(e.genesisHeight) }, []);
    case "denomination.added":
      return L("denomination.added", { s: e.denom.symbol }, []);
    case "participant.joined":
    {
      // the page's nameOf knows display names (localised demo names); fall back to the event's own name
      const known = n(e.id);
      const who = known && known !== e.id ? known : e.name;
      return L("participant.joined", { who, kind: T(`viz.ev.kind.${e.kind}`) }, [who]);
    }
    case "participant.status":
      return L(e.online ? "participant.online" : "participant.offline", { who: n(e.participant) }, [n(e.participant)]);
    case "wallet.funded":
      return L("wallet.funded", { who: n(e.participant), amount: amt(e.amount, e.denom) }, [n(e.participant)]);
    case "tracker.created":
      return L("tracker.created", { t: e.name, nft: shortHex(e.nftId) }, [e.name]);
    case "tracker.committed":
      return L(e.heartbeat ? "tracker.heartbeat" : "tracker.committed", { t: n(e.tracker), d: shortHex(e.digest), notes: fmtInt(e.notes), h: fmtInt(e.creationHeight) }, [n(e.tracker)]);
    case "tracker.confirmed":
      return L("tracker.confirmed", { t: n(e.tracker), box: shortHex(e.boxId), depth: e.depth }, [n(e.tracker)]);
    case "tracker.status":
      return L(e.online ? "tracker.online" : "tracker.offline", { t: n(e.tracker) }, [n(e.tracker)]);
    case "tracker.censorship":
      return L(`tracker.censorship.${e.mode}`, { t: n(e.tracker) }, [n(e.tracker)]);
    case "tracker.policy":
      return L("tracker.policy", { t: n(e.tracker) }, [n(e.tracker)]);
    case "tracker.options":
      return L("tracker.options", { t: n(e.tracker) }, [n(e.tracker)]);
    case "policy.set":
      return L(e.policy ? "policy.set" : "policy.cleared", { who: n(e.participant) }, [n(e.participant)]);
    case "credit.set":
      return L(e.limit === null ? "credit.cleared" : "credit.set", { a: n(e.creditor), b: n(e.debtor), limit: e.limit === null ? "" : amt(e.limit, e.denom) }, [n(e.creditor), n(e.debtor)]);
    case "note.issued":
      return L(e.omitted ? "note.issuedOmitted" : "note.issued", { a: n(e.issuer), b: n(e.receiver), amount: amt(e.amount, e.denom), total: amt(e.totalDebt, e.denom) }, [n(e.issuer), n(e.receiver)]);
    case "note.rejected":
      return L("note.rejected", { a: n(e.issuer), b: n(e.receiver), amount: amt(e.amount, e.denom), by: T(`viz.ev.by.${e.by}`), why: reason(e.code, e.message) }, [n(e.issuer), n(e.receiver)]);
    case "note.offline":
      return L("note.offline", { a: n(e.issuer), b: n(e.receiver), amount: amt(e.amount, e.denom) }, [n(e.issuer), n(e.receiver)]);
    case "waiver":
      return L("waiver", { a: n(e.creditor), b: n(e.issuer), amount: amt(e.amount, e.denom), why: T(`viz.ev.waiver.${e.reason}`) }, [n(e.creditor), n(e.issuer)]);
    case "chain.mined":
      return e.to - e.from <= 1 ? L("chain.mined1", { h: fmtInt(e.to) }, []) : L("chain.mined", { a: fmtInt(e.from + 1), b: fmtInt(e.to), n: fmtInt(e.to - e.from) }, []);
    case "reserve.created":
      return L("reserve.created", { who: n(e.owner), amount: e.contract === "basis-token" ? amt(e.tokenAmount, e.denom) : amt(e.value), t: n(e.tracker) }, [n(e.owner)]);
    case "reserve.toppedUp":
      return L("reserve.toppedUp", { who: n(e.by), r: e.reserve, amount: amt(e.amount) }, [n(e.by)]);
    case "reserve.redeemed":
      return L(e.emergency ? "reserve.redeemedEmergency" : "reserve.redeemed", { who: n(e.receiver), from: n(e.issuer), amount: amt(e.amount, e.denom) }, [n(e.receiver), n(e.issuer)]);
    case "reserve.refundInitiated":
      return L("reserve.refundInitiated", { r: e.reserve, r7: fmtInt(e.r7) }, []);
    case "reserve.refundCompleted":
      return L("reserve.refundCompleted", { r: e.reserve, amount: amt(e.value) }, []);
    case "redemption.rejected":
      return L("redemption.rejected", { who: n(e.receiver), from: n(e.issuer), stage: T(`viz.cx.stage.${e.stage}`), why: reason(e.code, e.message) }, [n(e.receiver), n(e.issuer)]);
    case "action.rejected":
      return L("action.rejected", { action: T(`viz.ev.action.${e.action}`), r: e.reserve, why: reason(e.code, e.message) }, [n(e.by)]);
    case "nostr":
      // Every NOSTR kind is spec only: the reference server has no NOSTR code, its reserve-event handler
      // (basis_server main.rs process_reserve_event) has no caller, and commitments/alerts are seeded demo events.
      return L(`nostr.${e.kind}`, { t: n(e.tracker), who: e.issuer ? n(e.issuer) : "", to: e.receiver ? n(e.receiver) : "", amount: e.amount !== undefined ? amt(e.amount, e.denom ?? "erg") : "", ratio: e.ratio !== undefined ? `${Math.round(e.ratio * 100)} ⁠%` : "" }, [n(e.tracker)], false);
    case "exchange.staged":
      return L("exchange.staged", { a: n(e.receiver), b: n(e.issuer), x: amt(e.fromAmount, e.fromDenom), y: amt(e.toAmount, e.toDenom) }, [n(e.receiver), n(e.issuer)]);
    case "exchange.applied":
      return L("exchange.applied", { id: e.id.slice(0, 8) }, []);
    case "exchange.cancelled":
      return L("exchange.cancelled", { id: e.id.slice(0, 8), why: e.reason }, []);
    case "exchange.rejected":
      return L("exchange.rejected", { why: reason(e.code, e.message) }, [n(e.issuer), n(e.receiver)]);
    case "clearing.settled":
      return L(e.mode === "onchain" ? "clearing.onchain" : "clearing.waivers", { amount: amt(e.amount, e.denom), loop: e.members.map(n).join(" → "), legs: e.legs }, e.members.map(n));
    case "clearing.rejected":
      return L("clearing.rejected", { why: reason(e.code, e.message) }, e.members.map(n));
    case "scenario.step":
      return { group, mark, text: `▸ ${e.title}`, actors: [] };
    case "annotation":
      return { group, mark, text: e.text, actors: [] };
  }
}
