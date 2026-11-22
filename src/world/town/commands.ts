// "You" commands on the town: the wallet's actions, each a thin, typed layer over one engine command.
// They run in the leader tab only (town.ts routes follower calls here over the tab channel) and return plain
// outcomes with a toast descriptor. Business rules a real wallet adds on top of the engine live here:
// one reserve per denomination (R05), no payment to yourself (use a self-note), the faucet cooldown.
import {
  erg,
  MINER_FEE_NANOERG,
  type AcceptanceConfig,
  type CensorshipMode,
  type DenomId,
  type Economy,
  type EventOf,
  type Hex,
} from "@/protocol";
import { fmtDenom } from "../format";
import { checkPolicy, policyFromPreset, type PolicyPresetId, type PolicyPresetParams } from "../policies";
import { noteSummary, redemptionPreview } from "../views";
import type { ExchangeOutcomeView, PayOutcome, RedeemOutcome, RequestOutcome, ReserveOutcome, SimpleOutcome, Toast } from "../outcome";
import { requestDelay, type PaymentRequest } from "./bots";
import { cafePolicy, RESIDENTS, SUSE_ID, TOWN_TRACKER, YOU } from "./genesis";
import { FAUCET_COOLDOWN_BLOCKS, FAUCET_ERG, FAUCET_SUSE, MAX_REQUESTS, type Contact, type Speed, type WorldData } from "./worlddata";

export interface CommandContext {
  eco: Economy;
  world: WorldData;
  /** The wallet's secret (join only) and display name. */
  wallet: { secretHex: Hex | null; pubHex: Hex | null; name: string | null };
}

export interface CommandArgs {
  join: { name?: string };
  faucet: Record<string, never>;
  pay: { to: string; amount: bigint; denom?: DenomId; memo?: string };
  selfNote: { amount: bigint; denom?: DenomId; memo?: string };
  request: { from: string; amount: bigint; denom?: DenomId; memo?: string };
  cancelRequest: { id: string };
  redeem: { issuer: string; amount?: bigint; denom?: DenomId; emergency?: boolean | "auto" };
  createReserve: { amount: bigint; denom?: DenomId };
  topUp: { reserve: string; amount: bigint };
  initiateRefund: { reserve: string; r7?: bigint };
  completeRefund: { reserve: string };
  novate: { issuer: string; to: string; amount: bigint; denom?: DenomId; memo?: string };
  exchange: { issuer: string; from: DenomId; fromAmount: bigint; to: DenomId; toAmount: bigint };
  setPolicy: { policy?: AcceptanceConfig | null; preset?: PolicyPresetId; params?: PolicyPresetParams };
  setCreditLine: { debtor: string; limit: bigint | null; denom?: DenomId };
  contact: { op: "add" | "update" | "remove"; id: string; label?: string; note?: string; favorite?: boolean };
  tracker: { op: "commit" | "offline" | "online" | "heartbeat" | "censor"; on?: boolean; mode?: CensorshipMode; targets?: string[] | "all" };
  setSpeed: { speed: Speed };
  mine: { blocks: number };
  tick: { blocks: number };
  reset: Record<string, never>;
}

export interface CommandResults {
  join: SimpleOutcome;
  faucet: SimpleOutcome;
  pay: PayOutcome;
  selfNote: PayOutcome;
  request: RequestOutcome;
  cancelRequest: RequestOutcome;
  redeem: RedeemOutcome;
  createReserve: ReserveOutcome;
  topUp: ReserveOutcome;
  initiateRefund: ReserveOutcome;
  completeRefund: ReserveOutcome;
  novate: PayOutcome;
  exchange: ExchangeOutcomeView;
  setPolicy: SimpleOutcome;
  setCreditLine: SimpleOutcome;
  contact: SimpleOutcome;
  tracker: SimpleOutcome;
  setSpeed: SimpleOutcome;
  mine: SimpleOutcome;
  tick: SimpleOutcome;
  reset: SimpleOutcome;
}

export type CommandName = keyof CommandArgs;

/** Outcome without the `events` range (the router fills it in). */
type Draft<T> = Omit<T, "events">;

const ref = (id: string) => `@${id}`;
const toast = (kind: Toast["kind"], titleKey: string, params: Record<string, string> = {}, detailKey?: string, extra: Partial<Toast> = {}): Toast => ({ kind, titleKey, detailKey, params, sticky: kind === "alarm" ? true : undefined, ...extra });
const refused = (code: string | undefined, params: Record<string, string> = {}): Toast => toast("alarm", "world.toast.refused", { ...params, code: code ?? "error" }, `world.code.${code ?? "error"}`);

function joined(ctx: CommandContext): boolean {
  return ctx.eco.participants.has(YOU);
}

function needJoin(ctx: CommandContext): { ok: false; code: string; message: string; toast: Toast } | null {
  if (joined(ctx)) return null;
  return { ok: false, code: "not-joined", message: "join the town first", toast: refused("not-joined") };
}

function amountText(eco: Economy, v: bigint, denom: DenomId, sign?: "always"): string {
  return fmtDenom(eco, v, denom, { sign });
}

// ---------------------------------------------------------------------------------------------

export function cmdJoin(ctx: CommandContext, a: CommandArgs["join"]): Draft<SimpleOutcome> {
  const { eco, wallet } = ctx;
  if (joined(ctx)) return { ok: true, kind: "join", toast: toast("info", "world.toast.join.already") };
  if (!wallet.secretHex) return { ok: false, kind: "join", code: "no-identity", message: "create or import a sandbox key first", toast: refused("no-identity") };
  eco.addParticipant({ id: YOU, name: (a.name ?? wallet.name ?? "").trim() || "You", kind: "human", avatarSeed: wallet.pubHex ?? YOU, secretHex: wallet.secretHex, meta: { about: "The wallet in this browser (sandbox key)." } });
  eco.fund(YOU, "erg", FAUCET_ERG, "faucet: play ERG");
  eco.fund(YOU, SUSE_ID, FAUCET_SUSE, "faucet: play sUSE");
  // the café opens a small tab for newcomers; Alice sends a welcome note
  eco.setPolicy("cafe", cafePolicy({ regulars: [eco.p("dan").pub], newcomers: [eco.p(YOU).pub] }));
  const welcome = erg("0.5");
  if (eco.checkAcceptance({ from: "alice", to: YOU, amount: welcome, tracker: TOWN_TRACKER }).ok) eco.pay({ from: "alice", to: YOU, amount: welcome, memo: "welcome to town", tracker: TOWN_TRACKER });
  for (const id of ["alice", "cafe", "dan"]) if (!ctx.world.contacts.some((c) => c.id === id)) ctx.world.contacts.push({ id, favorite: false, addedHeight: eco.clock.height });
  return { ok: true, kind: "join", toast: toast("metal", "world.toast.join.ok", { erg: amountText(eco, FAUCET_ERG, "erg"), suse: amountText(eco, FAUCET_SUSE, SUSE_ID) }, "world.toast.join.okDetail") };
}

/** Height of the last faucet payment to You (null = never). */
export function lastFaucetHeight(eco: Economy): number | null {
  for (let i = eco.events.length - 1; i >= 0; i--) {
    const e = eco.events[i];
    if (e.type === "wallet.funded" && e.participant === YOU && e.denom === "erg" && e.memo?.startsWith("faucet")) return e.height;
  }
  return null;
}

export function faucetReadyIn(eco: Economy): number {
  if (!eco.participants.has(YOU)) return 0;
  if (eco.balance(YOU, "erg") < erg(1)) return 0;
  const last = lastFaucetHeight(eco);
  return last === null ? 0 : Math.max(0, last + FAUCET_COOLDOWN_BLOCKS - eco.clock.height);
}

export function cmdFaucet(ctx: CommandContext): Draft<SimpleOutcome> {
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "faucet" };
  const wait = faucetReadyIn(ctx.eco);
  if (wait > 0) return { ok: false, kind: "faucet", code: "faucet-cooldown", message: `the faucet refills in ${wait} blocks`, detail: { blocks: wait }, toast: refused("faucet-cooldown", { blocks: String(wait), height: String(ctx.eco.clock.height + wait) }) };
  ctx.eco.fund(YOU, "erg", FAUCET_ERG, "faucet: play ERG");
  return { ok: true, kind: "faucet", toast: toast("metal", "world.toast.faucet.ok", { erg: amountText(ctx.eco, FAUCET_ERG, "erg") }) };
}

export function cmdPay(ctx: CommandContext, a: CommandArgs["pay"], kind: "pay" | "self-note" = "pay"): Draft<PayOutcome> {
  const { eco } = ctx;
  const denom = a.denom ?? "erg";
  const to = kind === "self-note" ? YOU : a.to;
  const base = { kind, to, denom, delta: a.amount, totalBefore: 0n, totalAfter: 0n } as const;
  const n = needJoin(ctx);
  if (n) return { ...base, ...n, kind };
  if (!eco.participants.has(to)) return { ...base, ok: false, code: "unknown-participant", message: `nobody called ${to} lives in the town`, toast: refused("unknown-participant") };
  if (kind === "pay" && to === YOU) return { ...base, ok: false, code: "self-payment", message: "a note to yourself is a self-note", toast: refused("self-payment") };
  const before = eco.note(YOU, to, denom, TOWN_TRACKER)?.totalDebt ?? 0n;
  const r = kind === "self-note" ? eco.selfNote({ who: YOU, amount: a.amount, denom, tracker: TOWN_TRACKER, memo: a.memo }) : eco.pay({ from: YOU, to, amount: a.amount, denom, memo: a.memo, tracker: TOWN_TRACKER });
  if (!r.ok) {
    const ev = r.event as EventOf<"note.rejected">;
    return { ...base, ok: false, code: r.code, message: r.message, by: ev.by, acceptance: r.acceptance, totalBefore: before, totalAfter: before, toast: refused(r.code, { to: ref(to) }) };
  }
  const rec = r.record!;
  return {
    ...base,
    ok: true,
    totalBefore: before,
    totalAfter: rec.totalDebt,
    note: noteSummary(eco, rec, YOU),
    acceptance: r.acceptance,
    toast: toast("info", kind === "self-note" ? "world.toast.selfNote.ok" : "world.toast.pay.ok", { to: ref(to), total: amountText(eco, rec.totalDebt, denom), delta: amountText(eco, a.amount, denom, "always") }, "world.toast.pay.okDetail", { refs: { participant: to, noteKey: rec.key } }),
  };
}

export function cmdRequest(ctx: CommandContext, a: CommandArgs["request"]): Draft<RequestOutcome> {
  const { eco, world } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "request" };
  if (!eco.participants.has(a.from) || a.from === YOU) return { ok: false, kind: "request", code: "unknown-participant", message: "ask a resident of the town", toast: refused("unknown-participant") };
  if (a.amount <= 0n) return { ok: false, kind: "request", code: "invalid-amount", message: "amount must be positive", toast: refused("invalid-amount") };
  const id = `req-${world.nextRequest++}`;
  const h = eco.clock.height;
  const req: PaymentRequest = { id, from: a.from, to: YOU, amount: a.amount, denom: a.denom ?? "erg", memo: a.memo ?? "", createdHeight: h, dueHeight: h + requestDelay(id), status: "pending" };
  world.requests.unshift(req);
  if (world.requests.length > MAX_REQUESTS) world.requests.length = MAX_REQUESTS;
  return { ok: true, kind: "request", requestId: id, dueHeight: req.dueHeight, toast: toast("info", "world.toast.request.sent", { from: ref(a.from), amount: amountText(eco, a.amount, req.denom), blocks: String(req.dueHeight - h) }, "world.toast.request.sentDetail", { refs: { participant: a.from, requestId: id } }) };
}

export function cmdCancelRequest(ctx: CommandContext, a: CommandArgs["cancelRequest"]): Draft<RequestOutcome> {
  const r = ctx.world.requests.find((x) => x.id === a.id);
  if (!r || r.status !== "pending") return { ok: false, kind: "request.cancel", code: "not-found", message: "no pending request with this id", toast: refused("not-found") };
  r.status = "cancelled";
  r.resolvedHeight = ctx.eco.clock.height;
  return { ok: true, kind: "request.cancel", requestId: r.id, toast: toast("info", "world.toast.request.cancelled", { from: ref(r.from) }) };
}

export function cmdRedeem(ctx: CommandContext, a: CommandArgs["redeem"]): Draft<RedeemOutcome> {
  const { eco } = ctx;
  const denom = a.denom ?? "erg";
  const base = { kind: "redeem" as const, issuer: a.issuer, denom };
  const n = needJoin(ctx);
  if (n) return { ...base, ...n, kind: "redeem" };
  if (!eco.participants.has(a.issuer)) return { ...base, ok: false, code: "unknown-participant", message: `nobody called ${a.issuer} lives in the town`, toast: refused("unknown-participant") };
  const r = eco.redeem({ receiver: YOU, issuer: a.issuer, denom, amount: a.amount, emergency: a.emergency ?? "auto", tracker: TOWN_TRACKER });
  const reserve = (r.event as { reserve?: string } | undefined)?.reserve;
  if (!r.ok) return { ...base, ok: false, code: r.code, message: r.message, stage: r.stage, eval: r.eval, tx: r.tx, compliance: r.compliance ?? null, emergency: r.emergency, reserve, toast: refused(r.code, { issuer: ref(a.issuer), stage: r.stage ?? "wallet" }) };
  const passed = r.eval?.checks.filter((c) => c.outcome === "true").length ?? 0;
  return {
    ...base,
    ok: true,
    amount: r.amount,
    stage: "contract",
    emergency: r.emergency,
    eval: r.eval,
    tx: r.tx,
    txId: r.tx?.id,
    compliance: r.compliance ?? null,
    reserve,
    toast: toast("metal", r.emergency ? "world.toast.redeem.emergency" : "world.toast.redeem.ok", { issuer: ref(a.issuer), amount: amountText(eco, r.amount ?? 0n, denom), checks: String(passed) }, r.emergency ? "world.toast.redeem.emergencyDetail" : "world.toast.redeem.okDetail", { refs: { participant: a.issuer, reserve, txId: r.tx?.id } }),
  };
}

export function cmdCreateReserve(ctx: CommandContext, a: CommandArgs["createReserve"]): Draft<ReserveOutcome> {
  const { eco } = ctx;
  const denom = a.denom ?? "erg";
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "reserve.create" };
  if (eco.reservesOf(YOU, denom).some((r) => r.active)) return { ok: false, kind: "reserve.create", code: "reserve-exists", message: "one reserve per denomination: top up the one you have", toast: refused("reserve-exists") };
  const r = eco.createReserve({ owner: YOU, amount: a.amount, denom, tracker: TOWN_TRACKER });
  if (!r.ok) return { ok: false, kind: "reserve.create", code: r.code, message: r.message, toast: refused(r.code) };
  const ev = r.event as EventOf<"reserve.created">;
  return { ok: true, kind: "reserve.create", reserve: ev.reserve, amount: a.amount, txId: ev.txId, toast: toast("metal", "world.toast.reserve.created", { amount: amountText(eco, a.amount, denom), tracker: TOWN_TRACKER }, "world.toast.reserve.createdDetail", { refs: { reserve: ev.reserve, txId: ev.txId } }) };
}

export function cmdTopUp(ctx: CommandContext, a: CommandArgs["topUp"]): Draft<ReserveOutcome> {
  const { eco } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "reserve.top-up" };
  if (!eco.reserves.has(a.reserve)) return { ok: false, kind: "reserve.top-up", code: "not-found", message: "no such reserve", toast: refused("not-found") };
  const res = eco.r(a.reserve);
  const r = eco.topUp({ reserve: a.reserve, amount: a.amount, by: YOU });
  if (!r.ok) return { ok: false, kind: "reserve.top-up", reserve: a.reserve, code: r.code, message: r.message, eval: r.eval, tx: r.tx, toast: refused(r.code) };
  const owner = eco.idOf(res.owner) ?? YOU;
  return { ok: true, kind: "reserve.top-up", reserve: a.reserve, amount: a.amount, eval: r.eval, tx: r.tx, txId: r.tx?.id, toast: toast("metal", owner === YOU ? "world.toast.reserve.toppedUp" : "world.toast.reserve.backed", { amount: amountText(eco, a.amount, res.denom), owner: ref(owner) }, undefined, { refs: { reserve: a.reserve, txId: r.tx?.id } }) };
}

export function cmdInitiateRefund(ctx: CommandContext, a: CommandArgs["initiateRefund"]): Draft<ReserveOutcome> {
  const { eco } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "reserve.initiate-refund" };
  if (!eco.reserves.has(a.reserve)) return { ok: false, kind: "reserve.initiate-refund", code: "not-found", message: "no such reserve", toast: refused("not-found") };
  const r = eco.initiateRefund({ reserve: a.reserve, r7: a.r7, signer: YOU });
  if (!r.ok) return { ok: false, kind: "reserve.initiate-refund", reserve: a.reserve, code: r.code, message: r.message, eval: r.eval, tx: r.tx, toast: refused(r.code) };
  const unlock = eco.r(a.reserve).refundUnlockHeight();
  return { ok: true, kind: "reserve.initiate-refund", reserve: a.reserve, eval: r.eval, tx: r.tx, txId: r.tx?.id, unlockHeight: unlock, toast: toast("alarm", "world.toast.reserve.refundStarted", { unlock: String(unlock ?? "") }, "world.toast.reserve.refundStartedDetail", { refs: { reserve: a.reserve } }) };
}

export function cmdCompleteRefund(ctx: CommandContext, a: CommandArgs["completeRefund"]): Draft<ReserveOutcome> {
  const { eco } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "reserve.complete-refund" };
  if (!eco.reserves.has(a.reserve)) return { ok: false, kind: "reserve.complete-refund", code: "not-found", message: "no such reserve", toast: refused("not-found") };
  const res = eco.r(a.reserve);
  const value = res.box?.value ?? 0n;
  const r = eco.completeRefund({ reserve: a.reserve, signer: YOU });
  if (!r.ok) return { ok: false, kind: "reserve.complete-refund", reserve: a.reserve, code: r.code, message: r.message, eval: r.eval, tx: r.tx, unlockHeight: res.refundUnlockHeight(), toast: refused(r.code, { unlock: String(res.refundUnlockHeight() ?? "") }) };
  return { ok: true, kind: "reserve.complete-refund", reserve: a.reserve, amount: value, eval: r.eval, tx: r.tx, txId: r.tx?.id, toast: toast("metal", "world.toast.reserve.refundCompleted", { amount: fmtDenom(eco, value, "erg", { dp: 3 }), net: fmtDenom(eco, value > MINER_FEE_NANOERG ? value - MINER_FEE_NANOERG : 0n, "erg", { dp: 3 }), fee: fmtDenom(eco, MINER_FEE_NANOERG, "erg", { dp: 3 }) }, undefined, { refs: { reserve: a.reserve } }) };
}

export function cmdNovate(ctx: CommandContext, a: CommandArgs["novate"]): Draft<PayOutcome> {
  const { eco } = ctx;
  const denom = a.denom ?? "erg";
  const base = { kind: "novate" as const, to: a.to, denom, delta: a.amount, totalBefore: 0n, totalAfter: 0n };
  const n = needJoin(ctx);
  if (n) return { ...base, ...n, kind: "novate" };
  if (!eco.participants.has(a.issuer) || !eco.participants.has(a.to)) return { ...base, ok: false, code: "unknown-participant", message: "unknown participant", toast: refused("unknown-participant") };
  const before = eco.note(a.issuer, a.to, denom, TOWN_TRACKER)?.totalDebt ?? 0n;
  const r = eco.novate({ issuer: a.issuer, from: YOU, to: a.to, amount: a.amount, denom, tracker: TOWN_TRACKER, memo: a.memo });
  if (!r.ok) return { ...base, ok: false, code: r.code, message: r.message, totalBefore: before, totalAfter: before, toast: refused(r.code, { issuer: ref(a.issuer), to: ref(a.to) }) };
  return { ...base, ok: true, totalBefore: before, totalAfter: r.record!.totalDebt, note: noteSummary(eco, r.record!, YOU), toast: toast("up", "world.toast.novate.ok", { issuer: ref(a.issuer), to: ref(a.to), amount: amountText(eco, a.amount, denom) }, "world.toast.novate.okDetail") };
}

export function cmdExchange(ctx: CommandContext, a: CommandArgs["exchange"]): Draft<ExchangeOutcomeView> {
  const { eco } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "exchange" };
  if (!eco.participants.has(a.issuer)) return { ok: false, kind: "exchange", code: "unknown-participant", message: "unknown participant", toast: refused("unknown-participant") };
  const r = eco.exchange({ issuer: a.issuer, receiver: YOU, from: a.from, fromAmount: a.fromAmount, to: a.to, toAmount: a.toAmount, tracker: TOWN_TRACKER });
  if (!r.ok) return { ok: false, kind: "exchange", code: r.code, message: r.message, http: (r.event as EventOf<"exchange.rejected">).http, toast: refused(r.code) };
  return { ok: true, kind: "exchange", exchangeId: r.exchange?.id, toast: toast("info", "world.toast.exchange.staged", { issuer: ref(a.issuer), from: amountText(eco, a.fromAmount, a.from), to: amountText(eco, a.toAmount, a.to) }, "world.toast.exchange.stagedDetail") };
}

export function cmdSetPolicy(ctx: CommandContext, a: CommandArgs["setPolicy"]): Draft<SimpleOutcome> {
  const { eco } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "policy" };
  let cfg: AcceptanceConfig | null;
  try {
    cfg = a.preset ? policyFromPreset(a.preset, a.params ?? {}, eco) : a.policy ?? null;
  } catch (e) {
    return { ok: false, kind: "policy", code: "invalid-policy", message: (e as Error).message, toast: refused("invalid-policy") };
  }
  if (cfg) {
    const chk = checkPolicy(cfg);
    if (!chk.ok) return { ok: false, kind: "policy", code: "invalid-policy", message: chk.error ?? "invalid policy", detail: { check: chk }, toast: refused("invalid-policy") };
  }
  eco.setPolicy(YOU, cfg);
  return { ok: true, kind: "policy", detail: { preset: a.preset ?? (cfg ? "custom" : "none") }, toast: toast("info", cfg ? "world.toast.policy.set" : "world.toast.policy.cleared") };
}

export function cmdSetCreditLine(ctx: CommandContext, a: CommandArgs["setCreditLine"]): Draft<SimpleOutcome> {
  const { eco } = ctx;
  const n = needJoin(ctx);
  if (n) return { ...n, kind: "credit-line" };
  if (!eco.participants.has(a.debtor) || a.debtor === YOU) return { ok: false, kind: "credit-line", code: "unknown-participant", message: "a credit line is for a resident of the town", toast: refused("unknown-participant") };
  if (a.limit !== null && a.limit < 0n) return { ok: false, kind: "credit-line", code: "invalid-amount", message: "the limit cannot be negative", toast: refused("invalid-amount") };
  const denom = a.denom ?? "erg";
  eco.setCreditLine(YOU, a.debtor, a.limit, denom);
  return { ok: true, kind: "credit-line", toast: toast("info", a.limit === null ? "world.toast.credit.cleared" : "world.toast.credit.set", { debtor: ref(a.debtor), limit: a.limit === null ? "" : amountText(eco, a.limit, denom) }) };
}

export function cmdContact(ctx: CommandContext, a: CommandArgs["contact"]): Draft<SimpleOutcome> {
  const { eco, world } = ctx;
  const i = world.contacts.findIndex((c) => c.id === a.id);
  if (a.op === "remove") {
    if (i >= 0) world.contacts.splice(i, 1);
    return { ok: true, kind: "contact", toast: toast("info", "world.toast.contact.removed", { id: ref(a.id) }) };
  }
  if (!eco.participants.has(a.id) || a.id === YOU) return { ok: false, kind: "contact", code: "unknown-participant", message: "contacts are residents of the town", toast: refused("unknown-participant") };
  const patch: Partial<Contact> = {};
  if (a.label !== undefined) patch.label = a.label.trim() || undefined;
  if (a.note !== undefined) patch.note = a.note.trim() || undefined;
  if (a.favorite !== undefined) patch.favorite = a.favorite;
  if (i >= 0) world.contacts[i] = { ...world.contacts[i], ...patch };
  else world.contacts.push({ id: a.id, favorite: false, addedHeight: eco.clock.height, ...patch });
  return { ok: true, kind: "contact", toast: toast("info", i >= 0 ? "world.toast.contact.updated" : "world.toast.contact.added", { id: ref(a.id) }) };
}

export function cmdTracker(ctx: CommandContext, a: CommandArgs["tracker"]): Draft<SimpleOutcome> {
  const { eco } = ctx;
  const t = eco.t(TOWN_TRACKER);
  switch (a.op) {
    case "commit": {
      const box = eco.commit(TOWN_TRACKER, { force: true });
      return box
        ? { ok: true, kind: "tracker", detail: { boxId: box.boxId, digest: box.digest }, toast: toast("proof", "world.toast.tracker.committed", { tracker: TOWN_TRACKER, digest: box.digest.slice(0, 8) }) }
        : { ok: false, kind: "tracker", code: t.online ? "nothing-to-commit" : "tracker-offline", message: t.online ? "this digest was already committed at this height" : "the tracker is offline", toast: refused(t.online ? "nothing-to-commit" : "tracker-offline") };
    }
    case "offline":
      eco.disappear(TOWN_TRACKER, "switched off from the tracker console");
      return { ok: true, kind: "tracker", toast: toast("info", "world.toast.tracker.offline", { tracker: TOWN_TRACKER }, "world.toast.tracker.offlineDetail") };
    case "online":
      eco.reappear(TOWN_TRACKER);
      return { ok: true, kind: "tracker", toast: toast("info", "world.toast.tracker.online", { tracker: TOWN_TRACKER }) };
    case "heartbeat":
      eco.setTrackerOptions(TOWN_TRACKER, { skipIfUnchanged: !(a.on ?? true) });
      return { ok: true, kind: "tracker", toast: toast("info", a.on ?? true ? "world.toast.tracker.heartbeatOn" : "world.toast.tracker.heartbeatOff", { tracker: TOWN_TRACKER }) };
    case "censor": {
      const mode = a.mode ?? "off";
      const targets = a.targets ?? "all";
      if (targets !== "all" && targets.some((id) => !eco.participants.has(id))) return { ok: false, kind: "tracker", code: "unknown-participant", message: "unknown participant", toast: refused("unknown-participant") };
      eco.setCensorship(TOWN_TRACKER, mode, targets);
      return { ok: true, kind: "tracker", toast: toast(mode === "off" ? "info" : "alarm", `world.toast.tracker.censor.${mode}`, { tracker: TOWN_TRACKER }) };
    }
  }
}

/** Residents with a short persona (for the contacts / directory views). */
export const CAST = RESIDENTS;

/** Preview of a payment from You (P01, P06, P07): new total, the recipient's decision with its trace. */
export function previewPay(eco: Economy, a: { to: string; amount: bigint; denom?: DenomId }) {
  const denom = a.denom ?? "erg";
  if (!eco.participants.has(YOU) || !eco.participants.has(a.to)) return null;
  const t = eco.t(TOWN_TRACKER);
  const rec = eco.note(YOU, a.to, denom, TOWN_TRACKER);
  const totalBefore = rec?.totalDebt ?? 0n;
  const acc = a.to === YOU ? { ok: true as const } : eco.checkAcceptance({ from: YOU, to: a.to, amount: a.amount, denom, tracker: TOWN_TRACKER });
  const limit = eco.creditLine(a.to, YOU, denom);
  const outstanding = rec ? rec.totalDebt - rec.amountRedeemed - rec.waived : 0n;
  const censored = t.isCensored(eco.p(YOU).pub, eco.p(a.to).pub) && t.censorship.mode === "refuse";
  return {
    to: a.to,
    denom,
    delta: a.amount,
    totalBefore,
    totalAfter: totalBefore + a.amount,
    acceptance: acc,
    recipientPolicy: eco.p(a.to).policy,
    creditLine: limit,
    outstanding,
    trackerOnline: t.online,
    censored,
    /** Everything checks out: the receiver accepts and the tracker will witness it. */
    ok: acc.ok && t.online && !censored && a.amount > 0n,
    /** Blocks until the new total would be confirmed (next commit + one cycle for depth 2). */
    etaBlocks: t.online ? t.options.commitIntervalBlocks - ((eco.clock.height - eco.clock.genesisHeight) % t.options.commitIntervalBlocks) + t.options.commitIntervalBlocks : null,
  };
}

export type PayPreview = NonNullable<ReturnType<typeof previewPay>>;

/** Redemption preview for a note You hold. */
export function previewRedeem(eco: Economy, a: { issuer: string; denom?: DenomId }) {
  if (!eco.participants.has(YOU) || !eco.participants.has(a.issuer)) return null;
  return redemptionPreview(eco, YOU, a.issuer, a.denom ?? "erg", TOWN_TRACKER);
}
