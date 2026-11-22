// Resident bots: what the town does by itself on every block while the clock runs.
//
// Every block's decisions come from Rng(`<seed>/bots/<height>`), so the town's life is a pure function of
// (state, height): replaying the same ticks gives the same events, whichever tab runs the clock and however
// often the page was reloaded. Bots pre-check with pure reads (checkAcceptance, authorizeRedemption with
// sign: false) so they do not spam the log with refusals; a refusal still happens when it is the story
// (e.g. your own policy declining a resident's payment to you).
import { erg, maxPayout, MIN_TOP_UP_NANOERG, Rng, type DenomId, type Economy, type EconomyEvent } from "@/protocol";
import { AGENTS, BUSINESSES, HUMANS, SUSE_ID, TOWN_TRACKER, YOU } from "./genesis";

const E = (x: number | string) => erg(x);
const S = (x: number) => BigInt(Math.round(x * 1000));

export interface PaymentRequest {
  id: string;
  /** Who is asked to pay (a resident id). */
  from: string;
  to: string;
  amount: bigint;
  denom: DenomId;
  memo: string;
  createdHeight: number;
  dueHeight: number;
  status: "pending" | "paid" | "declined" | "refused" | "cancelled";
  resolvedHeight?: number;
  /** Why it was declined/refused: an engine code ("policy-rejected") or a bot reason ("over-limit"). */
  code?: string;
  message?: string;
  /** seq of the note.issued event that paid it. */
  noteSeq?: number;
}

/** The most each resident pays on request (base units per denomination). */
export const REQUEST_LIMITS: Record<string, Partial<Record<DenomId, bigint>>> = {
  alice: { erg: E(3) },
  bob: { erg: E(1) },
  carol: { erg: E(2) },
  dan: { erg: E(1) },
  eve: { erg: E("1.5"), [SUSE_ID]: S(50) },
  cafe: { erg: E(1), [SUSE_ID]: S(100) },
  bakery: { erg: E(1) },
  scout: { erg: E("0.05") },
  quill: { erg: E("0.05") },
};

/** Blocks a resident takes to answer a request (2…5, from the request id). */
export function requestDelay(id: string): number {
  return 2 + new Rng(`request-delay/${id}`).int(0, 3);
}

export interface BotReport {
  height: number;
  payments: number;
  redemptions: number;
  topUps: number;
  clearings: number;
  requests: PaymentRequest[];
}

const AGENT_MEMOS = ["search call", "summary call", "vision call", "map tile", "translation call", "code review call"];
const HUMAN_MEMOS = ["lunch", "books", "bike repair", "groceries", "concert tickets", "rent share", "garden tools", "taxi", "birthday gift", "plumbing"];
const TO_YOU_MEMOS = ["thanks for the help", "your share of dinner", "refund for lunch", "tip", "for the ride"];

function round(v: bigint, step: bigint): bigint {
  const r = (v / step) * step;
  return r > 0n ? r : step;
}

function trackerUp(eco: Economy): boolean {
  const t = eco.trackers.get(TOWN_TRACKER);
  return !!t && t.online;
}

/** Pays when the receiver would accept (no refusal event otherwise). */
function tryPay(eco: Economy, from: string, to: string, amount: bigint, memo: string, denom: DenomId = "erg"): boolean {
  if (!eco.participants.has(from) || !eco.participants.has(to) || from === to) return false;
  if (!eco.p(from).online) return false;
  const acc = eco.checkAcceptance({ from, to, amount, denom, tracker: TOWN_TRACKER });
  if (!acc.ok) return false;
  return eco.pay({ from, to, amount, denom, memo, tracker: TOWN_TRACKER }).ok;
}

/** Redeems part of a confirmed note when the tracker would co-sign (pre-flight without signing). */
function tryRedeem(eco: Economy, rng: Rng, receivers: string[]): boolean {
  const t = eco.t(TOWN_TRACKER);
  const h = eco.clock.height;
  const candidates: Array<{ issuer: string; receiver: string; denom: DenomId; claim: bigint; reserve: string }> = [];
  for (const rec of t.notes.values()) {
    if (rec.issuer === rec.receiver) continue;
    const receiver = eco.idOf(rec.receiver);
    const issuer = eco.idOf(rec.issuer);
    if (!receiver || !issuer || !receivers.includes(receiver)) continue;
    if (t.status(rec, h) !== "confirmed") continue;
    const reserve = eco.reservesOf(issuer, rec.denom).find((r) => r.active && r.trackerNftId === t.nftId);
    if (!reserve) continue;
    const already = reserve.redeemedFor(rec.receiver)?.redeemed ?? 0n;
    const claim = rec.totalDebt - already - rec.waived;
    if (claim <= 0n) continue;
    candidates.push({ issuer, receiver, denom: rec.denom, claim, reserve: reserve.id });
  }
  if (!candidates.length) return false;
  const c = rng.pick(candidates);
  const reserve = eco.r(c.reserve);
  const payable = maxPayout(reserve);
  const cap = c.claim < payable ? c.claim : payable;
  if (cap <= 0n) return false;
  const share = BigInt(rng.int(30, 100));
  const step = c.denom === "erg" ? 10_000_000n : 1_000n;
  const amount = round((cap * share) / 100n, step) > cap ? cap : round((cap * share) / 100n, step);
  const auth = t.authorizeRedemption({ issuer: eco.p(c.issuer).pub, receiver: eco.p(c.receiver).pub, denom: c.denom, amount, emergency: false, height: h, nowMs: eco.clock.nowMs(), reserves: eco.reserveViews(t), sign: false });
  if (!auth.ok) return false;
  return eco.redeem({ receiver: c.receiver, issuer: c.issuer, denom: c.denom, amount, tracker: TOWN_TRACKER }).ok;
}

/** Issuers keep their reserves near their target coverage (the Bakery stays thin on purpose). */
const COVERAGE_TARGETS: Array<{ owner: string; denom: DenomId; below: number; to: number }> = [
  { owner: "alice", denom: "erg", below: 1.5, to: 1.75 },
  { owner: "bakery", denom: "erg", below: 1.04, to: 1.12 },
  { owner: "cafe", denom: SUSE_ID, below: 1.3, to: 1.6 },
  { owner: "scout", denom: "erg", below: 1.15, to: 1.6 },
  { owner: "quill", denom: "erg", below: 1.15, to: 1.6 },
];

function tryTopUp(eco: Economy): boolean {
  for (const g of COVERAGE_TARGETS) {
    const cov = eco.coverage(g.owner, g.denom, TOWN_TRACKER);
    if (cov.ratio === null || cov.ratio >= g.below || cov.refundPending) continue;
    const reserve = eco.reservesOf(g.owner, g.denom).find((r) => r.active);
    if (!reserve) continue;
    const want = BigInt(Math.ceil(Number(cov.liabilities) * g.to)) - cov.collateral;
    const min = g.denom === "erg" ? MIN_TOP_UP_NANOERG : 1n;
    const step = g.denom === "erg" ? 10_000_000n : 1_000n;
    const amount = round(want > min ? want : min, step);
    const unit = g.denom === "erg" ? "erg" : g.denom;
    if (eco.balance(g.owner, unit) < amount + (unit === "erg" ? 2_000_000n : 0n) || eco.balance(g.owner, "erg") < 2_000_000n) continue;
    if (eco.topUp({ reserve: reserve.id, amount, by: g.owner }).ok) return true;
  }
  return false;
}

/** Scout and Quill clear their mutual debt on-chain now and then (one atomic transaction, two reserves). */
function tryClearAgents(eco: Economy): boolean {
  const cycles = eco.findCycles("erg", 2).filter((c) => c.members.every((m) => (AGENTS as readonly string[]).includes(m)) && c.amount >= E("0.02"));
  if (!cycles.length) return false;
  return eco.clearCycle(cycles[0], { mode: "auto", tracker: TOWN_TRACKER }).ok;
}

/** Answers due requests (resident → You), each per its limit and then through your own policy. */
export function answerRequests(eco: Economy, requests: PaymentRequest[], height: number): PaymentRequest[] {
  const changed: PaymentRequest[] = [];
  for (const r of requests) {
    if (r.status !== "pending" || r.dueHeight > height) continue;
    const done = (status: PaymentRequest["status"], code?: string, message?: string, noteSeq?: number) => {
      r.status = status;
      r.resolvedHeight = height;
      r.code = code;
      r.message = message;
      r.noteSeq = noteSeq;
      changed.push(r);
    };
    if (!eco.participants.has(r.from) || !eco.participants.has(r.to)) {
      done("cancelled", "unknown-participant", "this resident is not in the town any more");
      continue;
    }
    if (!trackerUp(eco)) continue; // wait for the tracker to come back
    const limit = REQUEST_LIMITS[r.from]?.[r.denom];
    if (limit === undefined) {
      done("declined", "denomination", `${eco.nameOf(r.from)} does not pay in this denomination`);
      continue;
    }
    if (r.amount > limit) {
      done("declined", "over-limit", `${eco.nameOf(r.from)} pays requests up to ${limit} base units`);
      continue;
    }
    const res = eco.pay({ from: r.from, to: r.to, amount: r.amount, denom: r.denom, memo: r.memo || "payment request", tracker: TOWN_TRACKER });
    if (res.ok) done("paid", undefined, undefined, res.event.seq);
    else done("refused", res.code, res.message);
  }
  return changed;
}

/**
 * One block of town life (called right after the block is mined, so `eco.clock.height` is the new height).
 * Returns what happened (for tests and the HUD).
 */
export function runBots(eco: Economy, seed: string, requests: PaymentRequest[]): BotReport {
  const height = eco.clock.height;
  const rng = new Rng(`${seed}/bots/${height}`);
  const report: BotReport = { height, payments: 0, redemptions: 0, topUps: 0, clearings: 0, requests: [] };
  const up = trackerUp(eco);
  if (up) {
    // agents pay per call
    if (rng.bool(0.45)) {
      const a = rng.pick(AGENTS);
      const b = a === "scout" ? "quill" : "scout";
      if (tryPay(eco, a, b, round(rng.bigint(E("0.001"), E("0.015")), 100_000n), rng.pick(AGENT_MEMOS))) report.payments++;
    }
    // residents pay each other
    if (rng.bool(0.18)) {
      const payers = [...HUMANS, "bakery"];
      const from = rng.pick(payers);
      const to = rng.pick([...HUMANS, ...BUSINESSES].filter((x) => x !== from));
      if (tryPay(eco, from, to, round(rng.bigint(E("0.05"), E("0.6")), 10_000_000n), rng.pick(HUMAN_MEMOS))) report.payments++;
    }
    // the café pays its suppliers in sUSE, the bakery pays for flour
    if (height % 23 === 0 && tryPay(eco, "cafe", "bakery", S(rng.int(40, 120)), "bread delivery", SUSE_ID)) report.payments++;
    if (height % 37 === 0 && tryPay(eco, "cafe", "carol", S(rng.int(20, 60)), "coffee beans", SUSE_ID)) report.payments++;
    if (height % 41 === 0 && tryPay(eco, "bakery", "carol", round(rng.bigint(E("0.4"), E("1.2")), 10_000_000n), "flour")) report.payments++;
    // now and then a resident pays You (your policy decides; a refusal is part of the story)
    if (eco.participants.has(YOU) && rng.bool(0.03)) {
      const from = rng.pick(["alice", "bob", "carol", "eve", "cafe"]);
      const suse = from === "cafe" && rng.bool(0.5);
      const amount = suse ? S(rng.int(5, 40)) : round(rng.bigint(E("0.05"), E("0.4")), 10_000_000n);
      const r = eco.pay({ from, to: YOU, amount, denom: suse ? SUSE_ID : "erg", memo: rng.pick(TO_YOU_MEMOS), tracker: TOWN_TRACKER });
      if (r.ok) report.payments++;
    }
    // occasional redemptions by residents
    if (rng.bool(0.02) && tryRedeem(eco, rng, [...HUMANS, ...BUSINESSES, ...AGENTS])) report.redemptions++;
    // issuers top up when coverage sags
    if (rng.bool(0.05) && tryTopUp(eco)) report.topUps++;
    // agents clear their loop
    if (rng.bool(0.01) && tryClearAgents(eco)) report.clearings++;
  }
  report.requests = answerRequests(eco, requests, height);
  return report;
}

/** Events of a bot report's block range (helper for tests). */
export function eventsSince(eco: Economy, seq: number): EconomyEvent[] {
  return eco.events.slice(seq);
}
