// Pure reads over the town economy for the wallet (no React, no writes). Everything here is derived from
// `@/world` views and read-only engine getters; commands live in the pages.
import { maxPayout, type AcceptanceConfig, type DenomId, type Economy, type Hex, type NoteRecord } from "@/protocol";
import { balanceSheet, denomInfo, notesFor, TOWN_TRACKER, YOU, type BalanceSheetView, type NoteSummary } from "@/world";

/** One sandbox day (1 block ≈ 2 min). */
export const DAY_BLOCKS = 720;
/** VISUAL §10.4: the tracker is "silent" (eclipse, stale foil) after 720 blocks without a commitment. */
export const SILENT_BLOCKS = 720;
/** Emergency redemption opens when the tracker box is older than this (basis.es). */
export const EMERGENCY_AGE = 2160;
/** Owner refund wait after R7 (basis.es). */
export const REFUND_BLOCKS = 43200;

export type Dir = "in" | "out" | "self";
export type FoilState = "signed" | "tracked" | "committed" | "stale";
export type RowLamp = "tracked" | "committed" | "stale" | "alarm";
export type Gender = "f" | "m" | "n";

/** Grammatical gender of the residents (RU verbs and possessives) and the EN possessive. */
export const GENDER: Record<string, Gender> = { op: "f", alice: "f", bob: "m", carol: "f", dan: "m", eve: "f", cafe: "n", bakery: "f", scout: "m", quill: "m" };
export const POSSESSIVE_EN: Record<string, string> = { op: "her", alice: "her", bob: "his", carol: "her", dan: "his", eve: "her", cafe: "its", bakery: "its", scout: "its", quill: "its" };

export interface Unit {
  id: DenomId;
  symbol: string;
  decimals: number;
}

export function unitOf(eco: Economy, denom: DenomId): Unit {
  const i = denomInfo(eco, denom);
  return { id: denom, symbol: i.symbol, decimals: i.decimals };
}

/** bigint base units → JS number in whole units (for drawing only: bars, notes, meters). */
export function toNum(v: bigint, decimals: number): number {
  return Number(v) / 10 ** decimals;
}

export function ratio(a: bigint, b: bigint): number | null {
  if (b <= 0n) return null;
  return Number(a) / Number(b);
}

// ---------------------------------------------------------------------------------------------
// tracker
// ---------------------------------------------------------------------------------------------

export interface TrackerInfo {
  id: string;
  online: boolean;
  censorMode: "off" | "refuse" | "omit";
  /** The tracker's censorship targets include You (or everyone). */
  censorsYou: boolean;
  boxHeight: number | null;
  boxAge: number;
  digest: Hex | null;
  interval: number;
  minDepth: number;
  silent: boolean;
  emergencyOpen: boolean;
  emergencyOpensAt: number | null;
  notesInBox: number;
}

export function trackerInfo(eco: Economy): TrackerInfo {
  const t = eco.t(TOWN_TRACKER);
  const h = eco.clock.height;
  const box = t.currentBox();
  const age = box ? Math.max(0, h - box.creationHeight) : 0;
  const you = eco.participants.get(YOU)?.pub ?? null;
  const targets = t.censorship.targets;
  const censorsYou = t.censorship.mode !== "off" && (targets === "all" || (!!you && targets.has(you)));
  return {
    id: t.id,
    online: t.online,
    censorMode: t.censorship.mode as TrackerInfo["censorMode"],
    censorsYou,
    boxHeight: box?.creationHeight ?? null,
    boxAge: age,
    digest: box?.digest ?? null,
    interval: t.options.commitIntervalBlocks,
    minDepth: t.options.minDepth,
    silent: !!box && age >= SILENT_BLOCKS,
    emergencyOpen: !!box && age > EMERGENCY_AGE,
    emergencyOpensAt: box ? box.creationHeight + EMERGENCY_AGE + 1 : null,
    notesInBox: box?.notes ?? 0,
  };
}

// ---------------------------------------------------------------------------------------------
// lines (credit lines and policy caps)
// ---------------------------------------------------------------------------------------------

export interface LineInfo {
  /** credit: a wallet credit line on OUTSTANDING (redemptions free room); cap: a policy whitelist max_debt on the
   *  CUMULATIVE total (a lifetime cap: totals never go down). */
  kind: "credit" | "cap";
  limit: bigint;
  /** What the line measures now (outstanding for credit, cumulative total for cap). */
  usedV: bigint;
  used: number;
}

/** The largest whitelist max_debt of `policy` that lists `pub` (any_of presets use the most permissive one). */
export function policyCapFor(policy: AcceptanceConfig | null | undefined, pub: Hex): bigint | null {
  if (!policy) return null;
  let cap: bigint | null = null;
  for (const p of policy.predicates) {
    if (p.type !== "whitelist" || p.max_debt == null) continue;
    if (!p.holders.some((h) => h.toLowerCase() === pub.toLowerCase())) continue;
    if (cap === null || p.max_debt > cap) cap = p.max_debt;
  }
  return cap;
}

/** The line that limits `debtor`'s notes to `creditor` (credit line first, then the creditor's policy cap). */
export function lineFor(eco: Economy, creditor: string, debtor: string, denom: DenomId, total: bigint, outstanding: bigint): LineInfo | null {
  const credit = eco.creditLine(creditor, debtor, denom);
  if (credit !== null) return { kind: "credit", limit: credit, usedV: outstanding, used: credit > 0n ? Number(outstanding) / Number(credit) : 1 };
  const c = eco.participants.get(creditor);
  const d = eco.participants.get(debtor);
  if (!c || !d) return null;
  const cap = policyCapFor(c.policy, d.pub);
  if (cap === null) return null;
  return { kind: "cap", limit: cap, usedV: total, used: cap > 0n ? Number(total) / Number(cap) : 1 };
}

// ---------------------------------------------------------------------------------------------
// note rows
// ---------------------------------------------------------------------------------------------

export interface Row {
  key: Hex;
  issuer: string;
  receiver: string;
  /** The counterparty (the other side of the note). */
  other: string;
  dir: Dir;
  denom: DenomId;
  unit: Unit;
  total: bigint;
  redeemed: bigint;
  waived: bigint;
  outstanding: bigint;
  claim: bigint;
  status: NoteSummary["status"];
  omitted: boolean;
  foil: FoilState;
  lamp: RowLamp;
  /** The issuer has a reserve in this denomination bound to T-01. */
  backed: boolean;
  /** Issuer coverage (collateral / outstanding liabilities), null without debt or reserve. */
  coverage: number | null;
  line: LineInfo | null;
  /** Increments signed within the last sandbox day (DAY_BLOCKS). */
  today: bigint;
  lastTs: bigint;
  lastHeight: number;
  agent: boolean;
  memo?: string;
  versions: number;
  /** Your own coverage (for notes you owe), null without a reserve or debt. */
  yourCoverage: number | null;
}

function todayDelta(rec: NoteRecord, height: number): bigint {
  let s = 0n;
  for (let i = rec.history.length - 1; i >= 0; i--) {
    const v = rec.history[i];
    if (v.height < height - DAY_BLOCKS) break;
    s += v.amount;
  }
  return s;
}

export function foilOf(status: NoteSummary["status"], omitted: boolean, tracker: TrackerInfo): FoilState {
  if (omitted) return "tracked";
  if (status === "pending" || status === "confirmed") return tracker.silent ? "stale" : "committed";
  return "tracked";
}

export function lampOf(foil: FoilState, omitted: boolean): RowLamp {
  if (omitted) return "alarm";
  return foil === "signed" ? "tracked" : foil;
}

export function buildRow(eco: Economy, s: NoteSummary, tracker: TrackerInfo, covCache: Map<string, number | null>): Row {
  const dir: Dir = s.direction === "owed-to-you" ? "in" : s.direction === "you-owe" ? "out" : "self";
  const other = dir === "in" ? s.issuer : s.receiver;
  const rec = eco.note(s.issuer, s.receiver, s.denom, s.tracker);
  const cov = (id: string): number | null => {
    const k = `${id}|${s.denom}`;
    if (!covCache.has(k)) {
      const c = eco.coverage(id, s.denom);
      covCache.set(k, c.collateral > 0n ? c.ratio : null);
    }
    return covCache.get(k) ?? null;
  };
  const line = dir === "in" ? lineFor(eco, YOU, s.issuer, s.denom, s.totalDebt, s.claim) : dir === "out" ? lineFor(eco, s.receiver, YOU, s.denom, s.totalDebt, s.outstanding) : null;
  const foil = foilOf(s.status, s.omitted, tracker);
  return {
    key: s.key,
    issuer: s.issuer,
    receiver: s.receiver,
    other,
    dir,
    denom: s.denom,
    unit: { id: s.denom, symbol: s.symbol, decimals: s.decimals },
    total: s.totalDebt,
    redeemed: s.redeemed,
    waived: s.waived,
    outstanding: s.outstanding,
    claim: s.claim,
    status: s.status,
    omitted: s.omitted,
    foil,
    lamp: lampOf(foil, s.omitted),
    backed: s.backed,
    coverage: s.backed ? cov(s.issuer) : null,
    line,
    today: rec ? todayDelta(rec, eco.clock.height) : 0n,
    lastTs: s.timestamp,
    lastHeight: s.updatedHeight,
    agent: s.agent,
    memo: s.memo,
    versions: s.versions,
    yourCoverage: dir === "out" ? cov(YOU) : null,
  };
}

/** Amount shown in a row: what the holder can still claim (in) or what you still owe (out). */
export const rowAmount = (r: Row): bigint => (r.dir === "in" ? r.claim : r.outstanding);

// ---------------------------------------------------------------------------------------------
// the whole wallet at once (one pass per frame)
// ---------------------------------------------------------------------------------------------

export interface ReserveInfo {
  id: string;
  denom: DenomId;
  unit: Unit;
  contract: string;
  collateral: bigint;
  payable: bigint;
  refundPending: boolean;
  r7: number | null;
  unlock: number | null;
  boxId: Hex | null;
  boxes: number;
  /** Your outstanding notes in this denomination (what the reserve backs). */
  liabilities: bigint;
  coverage: number | null;
  /** Holders of your notes, largest first. */
  backs: Array<{ id: string; amount: bigint }>;
  createdHeight: number;
}

export interface WalletModel {
  height: number;
  joined: boolean;
  youPub: Hex | null;
  tracker: TrackerInfo;
  rows: Row[];
  sheet: BalanceSheetView | null;
  /** Wallet (P2PK) balances of play money. */
  wallet: Record<string, bigint>;
  reserves: ReserveInfo[];
  policy: AcceptanceConfig | null;
  denoms: Unit[];
}

export function reservesOfYou(eco: Economy): ReserveInfo[] {
  if (!eco.participants.has(YOU)) return [];
  const out: ReserveInfo[] = [];
  const youPub = eco.p(YOU).pub;
  const t = eco.t(TOWN_TRACKER);
  for (const r of eco.reservesOf(YOU)) {
    if (!r.active) continue;
    const notes = t.notesOfIssuer(youPub, r.denom).filter((n) => n.receiver !== youPub);
    const backs: ReserveInfo["backs"] = [];
    let liabilities = 0n;
    for (const n of notes) {
      const o = n.totalDebt - n.amountRedeemed;
      if (o <= 0n) continue;
      liabilities += o;
      backs.push({ id: eco.idOf(n.receiver) ?? n.receiver, amount: o });
    }
    backs.sort((a, b) => (a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : 0));
    const r7n = r.refundHeight();
    const collateral = r.collateral();
    out.push({
      id: r.id,
      denom: r.denom,
      unit: unitOf(eco, r.denom),
      contract: r.contract,
      collateral,
      payable: maxPayout(r),
      refundPending: r.refundPending(),
      r7: r7n > 0n ? Number(r7n) : null,
      unlock: r.refundUnlockHeight(),
      boxId: r.box?.boxId ?? null,
      boxes: r.history.length,
      liabilities,
      coverage: liabilities > 0n ? Number(collateral) / Number(liabilities) : null,
      backs,
      createdHeight: r.history[0]?.height ?? 0,
    });
  }
  return out;
}

export function walletModel(eco: Economy, denom: DenomId): WalletModel {
  const tracker = trackerInfo(eco);
  const joined = eco.participants.has(YOU);
  const denoms = [...eco.denominations.keys()].sort((a, b) => (a === "erg" ? -1 : b === "erg" ? 1 : a < b ? -1 : 1)).map((d) => unitOf(eco, d));
  if (!joined) return { height: eco.clock.height, joined, youPub: null, tracker, rows: [], sheet: null, wallet: {}, reserves: [], policy: null, denoms };
  const cache = new Map<string, number | null>();
  const rows = notesFor(eco, YOU, { tab: "all" }).map((s) => buildRow(eco, s, tracker, cache));
  const wallet: Record<string, bigint> = {};
  for (const u of denoms) wallet[u.id] = eco.balance(YOU, u.id);
  return {
    height: eco.clock.height,
    joined,
    youPub: eco.p(YOU).pub,
    tracker,
    rows,
    sheet: balanceSheet(eco, YOU, denom),
    wallet,
    reserves: reservesOfYou(eco),
    policy: eco.p(YOU).policy,
    denoms,
  };
}

export type SortMode = "amount" | "recent";
export type TabId = "all" | "in" | "out" | "agents";

export function filterRows(rows: Row[], tab: TabId): Row[] {
  return rows.filter((r) => r.dir !== "self" && (tab === "all" ? rowAmount(r) > 0n || r.total > 0n : tab === "in" ? r.dir === "in" : tab === "out" ? r.dir === "out" : r.agent));
}

export function sortRows(rows: Row[], mode: SortMode): Row[] {
  const out = rows.slice();
  if (mode === "recent") return out.sort((a, b) => (a.lastTs > b.lastTs ? -1 : a.lastTs < b.lastTs ? 1 : 0));
  // by amount: ERG first, then other denominations; within one, the larger amount first
  return out.sort((a, b) => {
    if (a.denom !== b.denom) return a.denom === "erg" ? -1 : b.denom === "erg" ? 1 : a.denom < b.denom ? -1 : 1;
    const x = rowAmount(a), y = rowAmount(b);
    return x > y ? -1 : x < y ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------------------------
// redemption pre-flight (X05, X06, H03)
// ---------------------------------------------------------------------------------------------

export interface Queue {
  /** 1-based position of your note among the issuer's outstanding notes, oldest first (0 = not in it). */
  pos: number;
  of: number;
}

export function fifoQueue(eco: Economy, issuer: string, denom: DenomId): Queue {
  if (!eco.participants.has(issuer) || !eco.participants.has(YOU)) return { pos: 0, of: 0 };
  const t = eco.t(TOWN_TRACKER);
  const youPub = eco.p(YOU).pub;
  const live = t.notesOfIssuer(eco.p(issuer).pub, denom).filter((n) => n.totalDebt > n.amountRedeemed).sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
  return { pos: live.findIndex((n) => n.receiver === youPub) + 1, of: live.length };
}

/** The issuer's coverage before and after paying `amount` out of its reserve (the redemption-check formula). */
export function coverageAfter(eco: Economy, issuer: string, denom: DenomId, amount: bigint): { before: number | null; after: number | null; collateral: bigint; collateralAfter: bigint; debt: bigint } {
  const t = eco.t(TOWN_TRACKER);
  if (!eco.participants.has(issuer)) return { before: null, after: null, collateral: 0n, collateralAfter: 0n, debt: 0n };
  let debt = 0n;
  for (const n of t.notesOfIssuer(eco.p(issuer).pub, denom)) if (n.totalDebt > n.amountRedeemed) debt += n.totalDebt - n.amountRedeemed;
  const res = eco.reservesOf(issuer, denom).find((r) => r.active);
  const collateral = res ? res.collateral() : 0n;
  const ca = collateral > amount ? collateral - amount : 0n;
  const da = debt > amount ? debt - amount : 0n;
  return { before: ratio(collateral, debt), after: da > 0n ? Number(ca) / Number(da) : null, collateral, collateralAfter: ca, debt };
}

// ---------------------------------------------------------------------------------------------
// request links (P09, K10, M02)
// ---------------------------------------------------------------------------------------------

export interface PayLink {
  to: Hex;
  amount?: string;
  denom?: string;
  memo?: string;
  tracker?: string;
}

export function makePayLink(origin: string, l: PayLink): string {
  const q = new URLSearchParams();
  q.set("to", l.to);
  if (l.amount) q.set("amount", l.amount);
  if (l.denom && l.denom !== "erg") q.set("denom", l.denom);
  if (l.memo) q.set("memo", l.memo);
  q.set("tracker", l.tracker ?? TOWN_TRACKER);
  return `${origin}/wallet/pay?${q.toString()}`;
}

export type ParseError = "empty" | "format";

/** Accepts a pay link (any origin), a `basis:` URI, or a bare 33-byte public key. */
export function parsePayLink(input: string): PayLink | { error: ParseError } {
  const s = input.trim();
  if (!s) return { error: "empty" };
  if (/^0[23][0-9a-fA-F]{64}$/.test(s)) return { to: s.toLowerCase() };
  let query = "";
  const m = /^basis:(0[23][0-9a-fA-F]{64})(\?.*)?$/.exec(s);
  if (m) query = `to=${m[1]}&${(m[2] ?? "").slice(1)}`;
  else {
    const i = s.indexOf("?");
    query = i >= 0 ? s.slice(i + 1) : s;
  }
  let q: URLSearchParams;
  try {
    q = new URLSearchParams(query);
  } catch {
    return { error: "format" };
  }
  const to = (q.get("to") ?? "").toLowerCase();
  if (!/^0[23][0-9a-f]{64}$/.test(to)) return { error: "format" };
  const amount = q.get("amount") ?? undefined;
  if (amount !== undefined && !/^\d+([.,]\d+)?$/.test(amount)) return { error: "format" };
  return { to, amount, denom: q.get("denom") ?? undefined, memo: q.get("memo")?.slice(0, 80) ?? undefined, tracker: q.get("tracker") ?? undefined };
}

// ---------------------------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------------------------

export function plainAmount(v: bigint, decimals: number): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const s = a.toString().padStart(decimals + 1, "0");
  const i = s.slice(0, s.length - decimals);
  const f = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return `${neg ? "-" : ""}${i}${f ? `.${f}` : ""}`;
}

/** Percent share of `part` in `whole` (0…1), safe for zero. */
export function share(part: bigint, whole: bigint): number {
  if (whole <= 0n) return 0;
  return Math.max(0, Math.min(1, Number(part) / Number(whole)));
}

export function isAgentId(eco: Economy, id: string): boolean {
  return eco.participants.get(id)?.kind === "agent";
}

// ---------------------------------------------------------------------------------------------
// acceptance context (local copy of the engine's private acceptanceContext: the policy page tests a policy against
// a resident and the pay pre-check explains the coverage number; listed as a gap for @/protocol)
// ---------------------------------------------------------------------------------------------

export function acceptanceCtx(eco: Economy, issuerId: string, receiverId: string, denom: DenomId, candidateTotal: bigint) {
  const issuer = eco.p(issuerId);
  const receiver = eco.p(receiverId);
  const t = eco.t(TOWN_TRACKER);
  const views = eco.reserveViews(t).filter((v) => v.active && v.owner === issuer.pub && v.denom === denom);
  let gross = 0n;
  let replaced = false;
  for (const n of t.notesOfIssuer(issuer.pub, denom)) {
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

/** A participant id from a URL value: an id in the town or a 33-byte public key of one. */
export function resolveParty(eco: Economy, v: string | null | undefined): string | null {
  if (!v) return null;
  if (eco.participants.has(v)) return v;
  const s = v.trim().toLowerCase();
  if (/^0[23][0-9a-f]{64}$/.test(s)) return eco.idOf(s) ?? null;
  return null;
}
