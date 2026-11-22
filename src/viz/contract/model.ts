// ContractXray model: turns an engine evaluation (ReserveEval, or the outcome of Economy.redeem / an action)
// into rows the X-ray draws: one per condition, in the order the engine evaluated them, each with its lines
// and a finding that states the actual value against the required one. Pure; no React.

import type { ReserveCheck, ReserveCheckId, ReserveEval, SimTx } from "@/protocol";
import { EMERGENCY_BLOCKS, MIN_TOP_UP_NANOERG } from "@/protocol";
import { basisEs, basisTokenEs } from "@/content/contractSource";
import { fmtAmount, fmtBlocks, fmtInt, fmtTimestamp, shortHex, type UnitInfo, type VizLang, ERG_UNIT } from "../core/format";
import { translate } from "../core/lang";
import { checkLinesFor, deriveContractMap, expectedChecks, type ActionId, type ContractId, type ContractMap, type LineRange } from "./lines";

export type RowState = "pass" | "fail" | "throws" | "skip" | "idle";

export interface XrayRow {
  id: ReserveCheckId;
  state: RowState;
  anchor: number;
  ranges: LineRange[];
  /** Engine detail, verbatim (machine face). */
  detail: string;
  expr: string;
  /** Translated finding: actual vs required. Empty when there is nothing to add. */
  finding: string;
}

export interface XrayVerdict {
  kind: "idle" | "ok" | "fail" | "throws" | "not-reached";
  check?: ReserveCheckId;
  stage?: "wallet" | "tracker" | "contract";
  code?: string;
  message?: string;
  redeemed?: bigint;
}

/** What ContractXray accepts as `evaluation`: the engine's report, or an Economy outcome that carries one. */
export type EvaluationInput =
  | ReserveEval
  | { ok: boolean; stage?: "wallet" | "tracker" | "contract"; code?: string; message?: string; eval?: ReserveEval; tx?: SimTx; amount?: bigint }
  | null
  | undefined;

export interface ResolvedEval {
  eval: ReserveEval | null;
  tx: SimTx | null;
  stage?: "wallet" | "tracker" | "contract";
  code?: string;
  message?: string;
  ok?: boolean;
}

function isReserveEval(x: unknown): x is ReserveEval {
  return !!x && typeof x === "object" && Array.isArray((x as ReserveEval).checks) && "actionName" in (x as object);
}

export function resolveEvaluation(input: EvaluationInput): ResolvedEval {
  if (!input) return { eval: null, tx: null };
  if (isReserveEval(input)) return { eval: input, tx: null, ok: input.ok, stage: "contract" };
  return { eval: input.eval ?? null, tx: input.tx ?? null, stage: input.stage, code: input.code, message: input.message, ok: input.ok };
}

// ---------- source ----------

export interface ContractSourceData {
  file: "basis.es" | "basis-token.es";
  lines: readonly string[];
  gitRef?: string;
}

export function sourceOf(contract: ContractId): ContractSourceData {
  const s = contract === "basis-token" ? basisTokenEs : basisEs;
  return { file: s.file, lines: s.lines, gitRef: s.gitRef };
}

const maps = new Map<string, ContractMap>();
export function mapOf(contract: ContractId, lines: readonly string[]): ContractMap {
  const k = `${contract}:${lines.length}:${lines[0]}:${lines[lines.length - 1]}`;
  let m = maps.get(k);
  if (!m) {
    m = deriveContractMap(lines, contract);
    maps.set(k, m);
  }
  return m;
}

export function contractIdOf(e: ReserveEval | null | undefined, fallback: ContractId = "basis"): ContractId {
  if (!e) return fallback;
  return e.contract === "basis-token.es" ? "basis-token" : "basis";
}

export function actionOf(e: ReserveEval | null | undefined, fallback: ActionId | null = 0): ActionId | null {
  if (!e) return fallback;
  if (e.action === null) return fallback;
  return e.action >= 0 && e.action <= 3 ? (e.action as ActionId) : null;
}

// ---------- findings ----------

const num = (s: string | undefined) => (s === undefined ? null : BigInt(s));

export interface FindingCtx {
  lang: VizLang;
  unit: UnitInfo;
  tx: SimTx | null;
}

function amt(v: bigint | null, ctx: FindingCtx): string {
  return v === null ? "?" : fmtAmount(v, ctx.unit);
}

/** The finding line for one check: parses the engine's detail (stable, read-only engine) into translated copy. */
export function findingFor(c: ReserveCheck, ctx: FindingCtx): string {
  const T = (k: string, v?: Record<string, string | number>) => translate(ctx.lang, k, v);
  if (c.outcome === "skipped") return T("viz.find.skipped");
  if (c.outcome === "throws") return T("viz.find.throws", { detail: c.detail });
  const ok = c.outcome === "true";
  const d = c.detail;
  let m: RegExpMatchArray | null;
  switch (c.id) {
    case "properlyRedeemed":
      if ((m = d.match(/redeemed (-?\d+), room (-?\d+) \(= (-?\d+) − (-?\d+)\)/))) {
        const [r, room, total, done] = [num(m[1]), num(m[2]), num(m[3]), num(m[4])];
        const vars = { r: amt(r, ctx), room: amt(room, ctx), total: amt(total, ctx), done: amt(done, ctx) };
        if (ok) return T("viz.find.properlyRedeemed.ok", vars);
        return r !== null && r <= 0n ? T("viz.find.properlyRedeemed.zero", vars) : T("viz.find.properlyRedeemed.over", vars);
      }
      break;
    case "trackerDebtCorrect":
      if ((m = d.match(/committed (-?\d+), note says (-?\d+)/))) return T(ok ? "viz.find.trackerDebtCorrect.ok" : "viz.find.trackerDebtCorrect.bad", { committed: amt(num(m[1]), ctx), claimed: amt(num(m[2]), ctx) });
      break;
    case "timestampCorrect":
      if (/first redemption/.test(d)) return T("viz.find.timestampCorrect.first");
      if ((m = d.match(/note ts (-?\d+) vs stored (-?\d+)/))) {
        const vars = { ts: fmtTimestamp(BigInt(m[1])), stored: fmtTimestamp(BigInt(m[2])) };
        return T(ok ? "viz.find.timestampCorrect.ok" : "viz.find.timestampCorrect.bad", vars);
      }
      break;
    case "trackerSigValid":
      if (/co-signed/.test(d)) return T("viz.find.trackerSigValid.sigOk");
      if (/does not verify/.test(d)) return T("viz.find.trackerSigValid.sigBad");
      if ((m = d.match(/box age (-?\d+) blocks/))) {
        const age = Number(m[1]);
        return ok
          ? T("viz.find.trackerSigValid.emOk", { age: fmtBlocks(age, ctx.lang) })
          : T("viz.find.trackerSigValid.emBad", { age: fmtBlocks(age, ctx.lang), left: fmtBlocks(EMERGENCY_BLOCKS + 1 - age, ctx.lang) });
      }
      break;
    case "topUpAmount":
      if ((m = d.match(/\+(-?\d+)/))) {
        const delta = BigInt(m[1]);
        const isUnits = /unit/.test(d);
        const min = isUnits ? fmtAmount(1n, ctx.unit) : fmtAmount(MIN_TOP_UP_NANOERG, ERG_UNIT);
        const dd = isUnits ? fmtAmount(delta, ctx.unit) : fmtAmount(delta, ERG_UNIT);
        return T(ok ? "viz.find.topUpAmount.ok" : "viz.find.topUpAmount.bad", { d: dd, min });
      }
      break;
    case "refundPeriodOver":
      if ((m = d.match(/HEIGHT (-?\d+) vs (-?\d+)/))) {
        const h = Number(m[1]);
        const unlock = Number(m[2]);
        return T(ok ? "viz.find.refundPeriodOver.ok" : "viz.find.refundPeriodOver.bad", { h: fmtInt(h), unlock: fmtInt(unlock), left: fmtBlocks(unlock - h, ctx.lang) });
      }
      break;
    case "refundHeightValid":
      if ((m = d.match(/R7 = (-?\d+), HEIGHT = (-?\d+)/))) return T(ok ? "viz.find.refundHeightValid.ok" : "viz.find.refundHeightValid.bad", { r7: fmtInt(BigInt(m[1])), h: fmtInt(Number(m[2])) });
      break;
    case "refundNotStarted":
      if (!ok && (m = d.match(/R7 = (-?\d+)/))) return T("viz.find.refundNotStarted.bad", { r7: fmtInt(BigInt(m[1])) });
      return "";
    case "refundStarted":
      if ((m = d.match(/R7 = (-?\d+)/))) return ok ? T("viz.find.refundStarted.ok", { r7: fmtInt(BigInt(m[1])) }) : T("viz.find.refundStarted.bad");
      break;
    case "uniqueReserveInput":
      if ((m = d.match(/(\d+) matching/))) return ok ? T("viz.find.uniqueReserveInput.ok") : T("viz.find.uniqueReserveInput.bad", { n: m[1] });
      break;
    case "valueNotDecreased":
    case "ergPreserved":
      if ((m = d.match(/^(-?\d+) ≥ (-?\d+)$/))) return T(ok ? "viz.find.notLess.ok" : "viz.find.notLess.bad", { out: fmtAmount(BigInt(m[1]), ERG_UNIT), in: fmtAmount(BigInt(m[2]), ERG_UNIT) });
      if ((m = d.match(/tokens (-?\d+) ≥ (-?\d+), ERG (-?\d+) ≥ (-?\d+)/))) {
        const tokOk = BigInt(m[1]) >= BigInt(m[2]);
        const pair = tokOk ? { out: fmtAmount(BigInt(m[3]), ERG_UNIT), in: fmtAmount(BigInt(m[4]), ERG_UNIT) } : { out: fmtAmount(BigInt(m[1]), ctx.unit), in: fmtAmount(BigInt(m[2]), ctx.unit) };
        return T(ok ? "viz.find.notLess.ok" : "viz.find.notLess.bad", pair);
      }
      break;
    case "refundPreserved":
      if ((m = d.match(/(-?\d+) vs (-?\d+)/))) return ok ? T("viz.find.refundPreserved.ok", { in: fmtInt(BigInt(m[2])) }) : T("viz.find.refundPreserved.bad", { out: fmtInt(BigInt(m[1])), in: fmtInt(BigInt(m[2])) });
      break;
    case "receiverSignature":
      return T(ok ? "viz.find.receiverSignature.ok" : "viz.find.receiverSignature.bad");
    case "ownerSignature":
      return T(ok ? "viz.find.ownerSignature.ok" : "viz.find.ownerSignature.bad");
    case "properReserveSignature":
      return T(ok ? "viz.find.properReserveSignature.ok" : "viz.find.properReserveSignature.bad");
    case "properRedemptionTree":
      if ((m = d.match(/(insertOrUpdate|insert) → ([0-9a-f]+)… vs output ([0-9a-f]+)…/))) return ok ? T("viz.find.properRedemptionTree.ok", { op: m[1], a: m[2].slice(0, 8) }) : T("viz.find.properRedemptionTree.bad", { a: m[2].slice(0, 8), b: m[3].slice(0, 8) });
      break;
    case "trackerIdCorrect":
      if ((m = d.match(/tracker NFT ([0-9a-f]+)… vs R6 ([0-9a-f]+)…/))) return ok ? T("viz.find.trackerIdCorrect.ok", { a: m[1].slice(0, 8) }) : T("viz.find.trackerIdCorrect.bad", { a: m[1].slice(0, 8), b: m[2].slice(0, 8) });
      break;
    case "scriptPreserved":
      return ok ? "" : T("viz.find.scriptPreserved.bad", { s: d });
    case "actionVar":
      if ((m = d.match(/#0 = (-?\d+) → action (-?\d+), output (-?\d+)/))) return T("viz.find.actionVar.ok", { v: m[1], a: m[2], i: m[3] });
      break;
    case "refundHeightRead":
      if ((m = d.match(/R7 = (-?\d+)/)) && BigInt(m[1]) > 0n) return T("viz.find.refundHeightRead.set", { r7: fmtInt(BigInt(m[1])) });
      return T("viz.find.refundHeightRead.none");
    default:
      break;
  }
  return ok ? "" : T("viz.find.false", { detail: d });
}

// ---------- rows ----------

export interface BuildRowsInput {
  contract: ContractId;
  action: ActionId | null;
  map: ContractMap;
  resolved: ResolvedEval;
  lang: VizLang;
  unit: UnitInfo;
}

const STATE: Record<ReserveCheck["outcome"], RowState> = { true: "pass", false: "fail", throws: "throws", skipped: "skip" };

export function buildRows({ contract, action, map, resolved, lang, unit }: BuildRowsInput): XrayRow[] {
  const ev = resolved.eval;
  const ctx: FindingCtx = { lang, unit, tx: resolved.tx };
  if (ev && ev.checks.length) {
    return ev.checks.map((c) => {
      const l = checkLinesFor(map, c.id, action) ?? { anchor: map.prologue[0], ranges: [] };
      return { id: c.id, state: STATE[c.outcome], anchor: l.anchor, ranges: l.ranges, detail: c.detail, expr: c.expr, finding: findingFor(c, ctx) };
    });
  }
  return expectedChecks(contract, action).map((id) => {
    const l = checkLinesFor(map, id, action) ?? { anchor: map.prologue[0], ranges: [] };
    return { id, state: "idle" as const, anchor: l.anchor, ranges: l.ranges, detail: "", expr: "", finding: "" };
  });
}

export function verdictOf(resolved: ResolvedEval): XrayVerdict {
  const ev = resolved.eval;
  if (!ev) {
    if (resolved.stage && resolved.stage !== "contract" && resolved.ok === false) return { kind: "not-reached", stage: resolved.stage, code: resolved.code, message: resolved.message };
    return { kind: "idle" };
  }
  if (ev.ok) return { kind: "ok", redeemed: ev.redeemed };
  const e = ev.error;
  return { kind: e?.outcome === "throws" ? "throws" : "fail", check: e?.check ?? ev.failed[0], message: e?.message };
}

/** Reason codes outside the contract (wallet, tracker) → the contract condition they protect on chain. */
export const OFFCHAIN_REASON_CHECK: Record<string, ReserveCheckId> = {
  "note-not-committed": "trackerDebtCorrect",
  "stale-committed-debt": "trackerDebtCorrect",
  "not-found": "trackerDebtCorrect",
  "nothing-to-redeem": "properlyRedeemed",
  "insufficient-collateral": "properlyRedeemed",
  "tracker-offline": "trackerSigValid",
  "invalid-signature": "properReserveSignature",
  "tracker-nft-mismatch": "trackerIdCorrect",
  "past-timestamp": "timestampCorrect",
  "multiple-reserves": "uniqueReserveInput",
  "amount-exceeds-contract-range": "trackerDebtCorrect",
};

/** Resolves focus codes (engine check ids, or wallet/tracker codes) to check ids. */
export function focusChecks(focus: readonly string[] | undefined, verdict: XrayVerdict): Set<ReserveCheckId> {
  const out = new Set<ReserveCheckId>();
  for (const f of focus ?? []) {
    if (OFFCHAIN_REASON_CHECK[f]) out.add(OFFCHAIN_REASON_CHECK[f]);
    else out.add(f as ReserveCheckId);
  }
  if (verdict.kind === "not-reached" && verdict.code && OFFCHAIN_REASON_CHECK[verdict.code]) out.add(OFFCHAIN_REASON_CHECK[verdict.code]);
  return out;
}

export function shortKey(hex: string | undefined): string {
  return hex ? shortHex(hex) : "";
}
