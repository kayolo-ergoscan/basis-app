// Event feed: one plain FeedItem per engine event, with EN/RU text from src/world/i18n.ts. Pages render
// `item.text`, or re-render `key` + `params` with worldText (participant params are "@id").
import type { Lang } from "@/app/types";
import type { DenomId, Economy, EconomyEvent, Hex } from "@/protocol";
import { INFORMATIONAL_EVENTS, REFUND_PERIOD_BLOCKS } from "@/protocol";
import { fmtDenom } from "./format";
import { castName, worldLookup, worldText } from "./i18n";
import { YOU } from "./town/genesis";

export type FeedTone = "up" | "metal" | "proof" | "alarm" | "refused" | "chain" | "step" | "info";

export interface FeedItem {
  seq: number;
  height: number;
  timeMs: bigint;
  type: EconomyEvent["type"];
  tone: FeedTone;
  /** i18n key and its params; participant params are "@id". */
  key: string;
  params: Record<string, string>;
  /** `key` rendered in the requested language. */
  text: string;
  /** Participant ids involved, the acting one first. */
  who: string[];
  /** The event involves You. */
  mine: boolean;
  refs: { tracker?: string; reserve?: string; noteKey?: Hex; txId?: Hex; boxId?: Hex };
  /** The event's main amount (for a money column). */
  amount?: { value: bigint; denom: DenomId; text: string };
  /** Refusals and markers change no state. */
  informational: boolean;
}

export interface FeedOptions {
  /** Use the town's cast names (`world.cast.<id>.name`); default false: the names in the log. */
  cast?: boolean;
  /** Participant id of the viewer (default "you"). */
  you?: string;
  /** Custom display names. */
  name?: (id: string) => string | undefined;
}

const reasonOf = (code: string, message: string): string => (worldLookup(`world.code.${code}`) !== undefined ? `world.code.${code}` : message);

/** Describes one event for the feed (pure; cheap enough to call for every visible row). */
export function describeEvent(eco: Economy, e: EconomyEvent, lang: Lang = "en", o: FeedOptions = {}): FeedItem {
  const you = o.you ?? YOU;
  const nameOf = (id: string): string => o.name?.(id) ?? (o.cast ? castName(id, lang) : undefined) ?? eco.participants.get(id)?.name ?? id;
  const money = (v: bigint, d: DenomId, sign?: "always") => fmtDenom(eco, v, d, { sign });
  const ownerOf = (reserve: string): string | undefined => {
    const r = eco.reserves.get(reserve);
    return r ? eco.idOf(r.owner) : undefined;
  };
  let key = "world.feed.annotation";
  const params: Record<string, string> = {};
  let who: string[] = [];
  let tone: FeedTone = "info";
  const refs: FeedItem["refs"] = {};
  let amount: FeedItem["amount"];
  const setAmount = (value: bigint, denom: DenomId, sign?: "always") => {
    amount = { value, denom, text: money(value, denom, sign) };
  };
  const at = (k: string, id: string) => {
    params[k] = `@${id}`;
  };

  switch (e.type) {
    case "genesis":
      key = "world.feed.genesis";
      params.height = String(e.genesisHeight);
      tone = "chain";
      break;
    case "denomination.added":
      key = "world.feed.denomination";
      params.symbol = e.denom.symbol;
      break;
    case "participant.joined":
      key = "world.feed.joined";
      at("who", e.id);
      who = [e.id];
      break;
    case "participant.status":
      key = e.online ? "world.feed.online" : "world.feed.offline";
      at("who", e.participant);
      who = [e.participant];
      break;
    case "wallet.funded":
      key = e.memo?.startsWith("faucet") ? "world.feed.faucet" : "world.feed.funded";
      at("who", e.participant);
      params.amount = money(e.amount, e.denom);
      setAmount(e.amount, e.denom, "always");
      who = [e.participant];
      tone = "up";
      break;
    case "tracker.created":
      key = "world.feed.trackerCreated";
      params.tracker = e.tracker;
      refs.tracker = e.tracker;
      refs.boxId = e.boxId;
      tone = "proof";
      break;
    case "tracker.committed":
      key = e.heartbeat ? "world.feed.heartbeat" : "world.feed.committed";
      params.tracker = e.tracker;
      params.digest = e.digest.slice(0, 8);
      params.notes = String(e.notes);
      refs.tracker = e.tracker;
      refs.boxId = e.boxId;
      refs.txId = e.txId;
      tone = "proof";
      break;
    case "tracker.confirmed":
      key = "world.feed.confirmed";
      params.tracker = e.tracker;
      params.depth = String(e.depth);
      refs.tracker = e.tracker;
      refs.boxId = e.boxId;
      tone = "proof";
      break;
    case "tracker.status":
      key = e.online ? "world.feed.trackerOnline" : "world.feed.trackerOffline";
      params.tracker = e.tracker;
      refs.tracker = e.tracker;
      tone = e.online ? "info" : "alarm";
      break;
    case "tracker.censorship":
      key = `world.feed.censorship.${e.mode}`;
      params.tracker = e.tracker;
      refs.tracker = e.tracker;
      tone = e.mode === "off" ? "info" : "alarm";
      break;
    case "tracker.policy":
      key = "world.feed.trackerPolicy";
      params.tracker = e.tracker;
      refs.tracker = e.tracker;
      break;
    case "tracker.options":
      key = "world.feed.trackerOptions";
      params.tracker = e.tracker;
      refs.tracker = e.tracker;
      break;
    case "policy.set":
      key = e.policy ? "world.feed.policySet" : "world.feed.policyCleared";
      at("who", e.participant);
      who = [e.participant];
      break;
    case "credit.set":
      key = e.limit === null ? "world.feed.creditCleared" : "world.feed.creditSet";
      at("creditor", e.creditor);
      at("debtor", e.debtor);
      if (e.limit !== null) params.limit = money(e.limit, e.denom);
      who = [e.creditor, e.debtor];
      break;
    case "note.issued":
      key = e.omitted ? "world.feed.noteOmitted" : e.issuer === e.receiver ? "world.feed.noteSelf" : "world.feed.note";
      at("issuer", e.issuer);
      at("receiver", e.receiver);
      params.delta = money(e.amount, e.denom);
      params.total = money(e.totalDebt, e.denom);
      setAmount(e.amount, e.denom);
      who = [e.issuer, e.receiver];
      refs.tracker = e.tracker;
      refs.noteKey = e.key;
      tone = e.omitted ? "alarm" : "up";
      break;
    case "note.rejected":
      key = `world.feed.rejected.${e.by}`;
      at("issuer", e.issuer);
      at("receiver", e.receiver);
      params.amount = money(e.amount, e.denom);
      params.reason = reasonOf(e.code, e.message);
      params.code = e.code;
      who = [e.issuer, e.receiver];
      refs.tracker = e.tracker;
      tone = "refused";
      break;
    case "note.offline":
      key = "world.feed.offlineNote";
      at("issuer", e.issuer);
      at("receiver", e.receiver);
      params.delta = money(e.amount, e.denom);
      params.total = money(e.totalDebt, e.denom);
      setAmount(e.amount, e.denom);
      who = [e.issuer, e.receiver];
      refs.tracker = e.tracker;
      tone = "up";
      break;
    case "waiver":
      key = `world.feed.waiver.${e.reason}`;
      at("creditor", e.creditor);
      at("issuer", e.issuer);
      params.amount = money(e.amount, e.denom);
      setAmount(e.amount, e.denom);
      who = [e.creditor, e.issuer, ...(e.beneficiary ? [e.beneficiary] : [])];
      break;
    case "chain.mined":
      key = e.to - e.from === 1 ? "world.feed.mined.one" : "world.feed.mined.range";
      params.from = String(e.from + 1);
      params.to = String(e.to);
      tone = "chain";
      break;
    case "reserve.created":
      key = "world.feed.reserveCreated";
      at("owner", e.owner);
      params.amount = e.contract === "basis-token" ? money(e.tokenAmount, e.denom) : money(e.value, "erg");
      setAmount(e.contract === "basis-token" ? e.tokenAmount : e.value, e.contract === "basis-token" ? e.denom : "erg");
      who = [e.owner];
      refs.tracker = e.tracker;
      refs.reserve = e.reserve;
      refs.boxId = e.boxId;
      refs.txId = e.txId;
      tone = "metal";
      break;
    case "reserve.toppedUp": {
      const owner = ownerOf(e.reserve) ?? e.by;
      const denom = eco.reserves.get(e.reserve)?.denom ?? "erg";
      key = "world.feed.toppedUp";
      at("by", e.by);
      at("owner", owner);
      params.amount = money(e.amount, denom);
      setAmount(e.amount, denom);
      who = owner === e.by ? [e.by] : [e.by, owner];
      refs.reserve = e.reserve;
      refs.boxId = e.boxId;
      refs.txId = e.txId;
      tone = "metal";
      break;
    }
    case "reserve.redeemed":
      key = e.emergency ? "world.feed.redeemedEmergency" : "world.feed.redeemed";
      at("receiver", e.receiver);
      at("issuer", e.issuer);
      params.amount = money(e.amount, e.denom);
      setAmount(e.amount, e.denom);
      who = [e.receiver, e.issuer];
      refs.tracker = e.tracker;
      refs.reserve = e.reserve;
      refs.boxId = e.boxId;
      refs.txId = e.txId;
      tone = "metal";
      break;
    case "reserve.refundInitiated": {
      const owner = ownerOf(e.reserve) ?? "";
      key = "world.feed.refundInitiated";
      at("owner", owner);
      params.unlock = String(e.r7 + BigInt(REFUND_PERIOD_BLOCKS));
      who = owner ? [owner] : [];
      refs.reserve = e.reserve;
      refs.boxId = e.boxId;
      refs.txId = e.txId;
      tone = "alarm";
      break;
    }
    case "reserve.refundCompleted": {
      const owner = ownerOf(e.reserve) ?? "";
      const denom = eco.reserves.get(e.reserve)?.denom ?? "erg";
      key = "world.feed.refundCompleted";
      at("owner", owner);
      params.amount = denom === "erg" ? money(e.value, "erg") : `${money(e.tokenAmount, denom)} + ${money(e.value, "erg")}`;
      setAmount(denom === "erg" ? e.value : e.tokenAmount, denom);
      who = owner ? [owner] : [];
      refs.reserve = e.reserve;
      refs.txId = e.txId;
      tone = "metal";
      break;
    }
    case "redemption.rejected":
      key = "world.feed.redemptionRejected";
      at("receiver", e.receiver);
      at("issuer", e.issuer);
      params.amount = money(e.amount, e.denom);
      params.reason = reasonOf(e.code, e.message);
      params.code = e.code;
      params.stage = e.stage;
      who = [e.receiver, e.issuer];
      refs.tracker = e.tracker;
      refs.reserve = e.reserve;
      tone = "refused";
      break;
    case "action.rejected":
      key = `world.feed.actionRejected.${e.action}`;
      at("who", e.by);
      params.reason = reasonOf(e.code, e.message);
      params.code = e.code;
      who = [e.by];
      refs.reserve = e.reserve;
      tone = "refused";
      break;
    case "nostr":
      key = `world.feed.nostr.${e.kind}`;
      if (e.issuer) at("who", e.issuer);
      if (e.ratio !== undefined) params.ratio = String(Math.round(e.ratio * 100));
      who = [e.issuer, e.receiver].filter((x): x is string => !!x);
      refs.tracker = e.tracker;
      refs.reserve = e.reserve;
      tone = e.kind.startsWith("alert") ? "alarm" : "proof";
      break;
    case "exchange.staged":
      key = "world.feed.exchangeStaged";
      at("receiver", e.receiver);
      at("issuer", e.issuer);
      params.from = money(e.fromAmount, e.fromDenom);
      params.to = money(e.toAmount, e.toDenom);
      who = [e.receiver, e.issuer];
      refs.tracker = e.tracker;
      refs.reserve = e.reserve;
      break;
    case "exchange.applied":
      key = "world.feed.exchangeApplied";
      refs.tracker = e.tracker;
      tone = "up";
      break;
    case "exchange.cancelled":
      key = "world.feed.exchangeCancelled";
      params.reason = e.reason;
      refs.tracker = e.tracker;
      tone = "refused";
      break;
    case "exchange.rejected":
      key = "world.feed.exchangeRejected";
      at("receiver", e.receiver);
      at("issuer", e.issuer);
      params.reason = reasonOf(e.code, e.message);
      params.code = e.code;
      who = [e.receiver, e.issuer];
      refs.tracker = e.tracker;
      tone = "refused";
      break;
    case "clearing.settled":
      key = `world.feed.clearing.${e.mode}`;
      params.n = String(e.members.length);
      params.amount = money(e.amount, e.denom);
      setAmount(e.amount, e.denom);
      who = [...e.members];
      refs.txId = e.txId;
      tone = "metal";
      break;
    case "clearing.rejected":
      key = "world.feed.clearingRejected";
      params.reason = reasonOf(e.code, e.message);
      params.code = e.code;
      who = [...e.members];
      tone = "refused";
      break;
    case "scenario.step":
      key = "world.feed.step";
      params.title = e.title;
      tone = "step";
      break;
    case "annotation":
      key = "world.feed.annotation";
      params.text = e.text;
      tone = e.level === "warn" ? "alarm" : "info";
      break;
  }
  const text = worldText(key, params, lang, { name: nameOf });
  return { seq: e.seq, height: e.height, timeMs: e.timeMs, type: e.type, tone, key, params, text, who, mine: who.includes(you), refs, amount, informational: INFORMATIONAL_EVENTS.has(e.type) };
}

export interface FeedQuery {
  /** Only events that involve this participant. */
  participant?: string;
  /** Skip chain.mined and tracker.confirmed rows (default true). */
  hideChain?: boolean;
  /** Skip refusals (default false). */
  hideRefused?: boolean;
  /** Newest first, at most this many (default 50). */
  limit?: number;
  /** Only events with seq < before (paging). */
  before?: number;
}

const CHAIN_TYPES = new Set<EconomyEvent["type"]>(["chain.mined", "tracker.confirmed", "nostr"]);

/** The latest events as feed items, newest first. Scans backwards and stops at `limit`. */
export function feed(eco: Economy, q: FeedQuery = {}, lang: Lang = "en", o: FeedOptions = {}): FeedItem[] {
  const out: FeedItem[] = [];
  const limit = q.limit ?? 50;
  const hideChain = q.hideChain ?? true;
  const start = Math.min(eco.events.length, q.before ?? eco.events.length) - 1;
  for (let i = start; i >= 0 && out.length < limit; i--) {
    const e = eco.events[i];
    if (hideChain && CHAIN_TYPES.has(e.type)) continue;
    if (q.hideRefused && INFORMATIONAL_EVENTS.has(e.type) && e.type !== "scenario.step" && e.type !== "annotation") continue;
    const item = describeEvent(eco, e, lang, o);
    if (q.participant && !item.who.includes(q.participant)) continue;
    out.push(item);
  }
  return out;
}
