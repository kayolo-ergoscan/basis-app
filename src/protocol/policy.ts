// Acceptance policies in the tracker's real format (crates/basis_core/src/acceptance.rs) and both of the
// server's evaluation semantics:
//
//   1. evaluateAcceptance  — `POST /acceptance/check` (crates/basis_server/src/acceptance/{builder,mod}.rs):
//      "would this recipient accept a note from this issuer with this cumulative total?"
//      Root = explicit `root`, else the ALPHABETICALLY LAST predicate name (builder uses a BTreeMap).
//      Whitelist `max_debt` is compared with the candidate CUMULATIVE total of the edge (gross, not net of
//      redemptions). Collateralization compares reserve collateral with the issuer's GROSS debt
//      (Σ per-recipient cumulative totals incl. the candidate).
//
//   2. checkRedemptionCompliance — tracker co-signing gate (acceptance/redemption_check.rs):
//      "would redeeming X newly violate some OTHER holder's policy?" Root = explicit `root`, else the LAST
//      predicate IN THE LIST. Collateralization uses OUTSTANDING debt (collected − redeemed); whitelist
//      `max_debt` uses that holder's max cumulative total. If every other holder is already violated, the
//      reserve is "distressed" and only the oldest outstanding note may redeem (FIFO).
//
// Note: the format has no denomination field — a whitelist `max_debt` applies to whatever denomination the
// note is in. Per-denomination credit lines therefore live in the economy layer (economy.ts), not here.

import type { DenomId } from "./note";

export type DefaultPolicy = "accept" | "reject";

export type PredicateConfig =
  | { type: "whitelist"; name: string; holders: string[]; max_debt?: bigint | null }
  | { type: "blacklist"; name: string; holders: string[] }
  | { type: "collateralization"; name: string; min_ratio: number }
  | { type: "all_of"; name: string; predicates: string[] }
  | { type: "any_of"; name: string; predicates: string[] }
  | { type: "not"; name: string; predicate: string }
  | { type: "no_pending_refund"; name: string };

export interface AcceptanceConfig {
  default: DefaultPolicy;
  root?: string | null;
  predicates: PredicateConfig[];
}

export const EMPTY_POLICY: AcceptanceConfig = { default: "reject", root: null, predicates: [] };

/** `AcceptanceConfig::default_collateral()` — require 100 % collateral. */
export function defaultCollateralPolicy(): AcceptanceConfig {
  return { default: "reject", root: "require_full_collateral", predicates: [{ type: "collateralization", name: "require_full_collateral", min_ratio: 1.0 }] };
}

export type RootRule = "builder" | "redemption-check";

/** Root predicate name the given evaluator would use (null when there are no predicates). */
export function policyRootName(config: AcceptanceConfig, rule: RootRule): string | null {
  if (config.root) return config.root;
  if (config.predicates.length === 0) return null;
  if (rule === "redemption-check") return config.predicates[config.predicates.length - 1].name;
  // builder: BTreeMap<String, _>::keys().last() — byte-wise lexicographic maximum
  let max = config.predicates[0].name;
  for (const p of config.predicates) if (p.name > max) max = p.name;
  return max;
}

/** True when the two evaluators would pick different roots — a real inconsistency in the server. */
export function hasRootAmbiguity(config: AcceptanceConfig): boolean {
  return !config.root && config.predicates.length > 1 && policyRootName(config, "builder") !== policyRootName(config, "redemption-check");
}

// ---------- check_acceptance semantics ----------

export interface ReserveSnapshot {
  /** Collateral in the note's denomination (nanoERG or token units). */
  collateral: bigint;
  refundPending: boolean;
  /** How many tracked reserves this issuer has in this denomination; >1 fails closed. */
  count: number;
}

export interface AcceptanceContext {
  issuer: string;
  recipient: string;
  /** Candidate cumulative total of the issuer→recipient edge after the payment. */
  totalDebt: bigint;
  denom: DenomId;
  /** Issuer's reserve in this denomination, null when none is tracked. */
  reserve: ReserveSnapshot | null;
  /** Σ per-recipient cumulative totals of the issuer in this denomination incl. the candidate; null = unavailable. */
  issuerGrossDebt: bigint | null;
}

export interface PredicateTrace {
  name: string;
  type: PredicateConfig["type"] | "missing";
  result: boolean;
  detail: string;
  children?: PredicateTrace[];
}

export interface AcceptanceResult {
  acceptable: boolean;
  /** Server-style reason, e.g. "Note rejected by per-recipient policy 'strict'". */
  reason: string | null;
  root: string | null;
  trace: PredicateTrace | null;
  /** Set when the builder would refuse the config (missing reference, cycle). */
  buildError?: string;
}

function lc(xs: string[]): Set<string> {
  return new Set(xs.map((x) => x.toLowerCase()));
}

function requiresSnapshot(map: Map<string, PredicateConfig>, name: string, seen = new Set<string>()): boolean {
  const p = map.get(name);
  if (!p || seen.has(name)) return false;
  seen.add(name);
  switch (p.type) {
    case "collateralization":
      return true;
    case "all_of":
    case "any_of":
      return p.predicates.some((c) => requiresSnapshot(map, c, seen));
    case "not":
      return requiresSnapshot(map, p.predicate, seen);
    default:
      return false;
  }
}

function fmtRatio(c: bigint, d: bigint): string {
  if (d === 0n) return "∞";
  return (Number(c) / Number(d)).toFixed(4);
}

/** Validates references the way PredicateBuilder does (unknown name or cycle → BuilderError). */
export function validatePolicy(config: AcceptanceConfig): string | null {
  const map = new Map(config.predicates.map((p) => [p.name, p]));
  const root = policyRootName(config, "builder");
  if (!root) return null;
  const visiting = new Set<string>();
  const visit = (name: string): string | null => {
    const p = map.get(name);
    if (!p) return `unknown predicate reference '${name}'`;
    if (visiting.has(name)) return `circular predicate reference at '${name}'`;
    visiting.add(name);
    const kids = p.type === "all_of" || p.type === "any_of" ? p.predicates : p.type === "not" ? [p.predicate] : [];
    for (const k of kids) {
      const e = visit(k);
      if (e) return e;
    }
    visiting.delete(name);
    return null;
  };
  return visit(root);
}

/**
 * Evaluates a policy like `check_acceptance` does. `scope` only changes the reason text
 * ("per-recipient" or "global"); an empty per-recipient policy rejects, an empty global one uses `default`.
 */
export function evaluateAcceptance(config: AcceptanceConfig, ctx: AcceptanceContext, scope: "per-recipient" | "global" = "per-recipient"): AcceptanceResult {
  if (config.predicates.length === 0) {
    if (scope === "per-recipient") return { acceptable: false, reason: "Empty per-recipient policy - rejecting by default", root: null, trace: null };
    const ok = config.default === "accept";
    return { acceptable: ok, reason: ok ? null : "Note rejected by default policy", root: null, trace: null };
  }
  const buildError = validatePolicy(config);
  if (buildError) return { acceptable: false, reason: "Invalid stored policy - rejecting by default", root: null, trace: null, buildError };
  const map = new Map(config.predicates.map((p) => [p.name, p]));
  const root = policyRootName(config, "builder")!;
  const issuer = ctx.issuer.toLowerCase();

  const evalNode = (name: string): PredicateTrace => {
    const p = map.get(name)!;
    switch (p.type) {
      case "whitelist": {
        const member = lc(p.holders).has(issuer);
        const cap = p.max_debt ?? null;
        const within = cap === null || ctx.totalDebt <= cap;
        return {
          name,
          type: p.type,
          result: member && within,
          detail: !member ? "issuer is not on the list" : cap === null ? "issuer is on the list (no cap)" : within ? `cumulative ${ctx.totalDebt} ≤ cap ${cap}` : `cumulative ${ctx.totalDebt} > cap ${cap}`,
        };
      }
      case "blacklist": {
        const listed = lc(p.holders).has(issuer);
        return { name, type: p.type, result: !listed, detail: listed ? "issuer is blacklisted" : "issuer not blacklisted" };
      }
      case "collateralization": {
        if (!ctx.reserve) return { name, type: p.type, result: false, detail: "no tracked reserve in this denomination (fails closed)" };
        if (ctx.reserve.count > 1) return { name, type: p.type, result: false, detail: `issuer has ${ctx.reserve.count} reserves in this denomination (ambiguous, fails closed)` };
        if (ctx.issuerGrossDebt === null) return { name, type: p.type, result: false, detail: "liability snapshot unavailable (fails closed)" };
        if (ctx.issuerGrossDebt === 0n) return { name, type: p.type, result: true, detail: "no debt" };
        const ratio = Number(ctx.reserve.collateral) / Number(ctx.issuerGrossDebt);
        return {
          name,
          type: p.type,
          result: ratio >= p.min_ratio,
          detail: `collateral ${ctx.reserve.collateral} / gross debt ${ctx.issuerGrossDebt} = ${fmtRatio(ctx.reserve.collateral, ctx.issuerGrossDebt)} ${ratio >= p.min_ratio ? "≥" : "<"} ${p.min_ratio}`,
        };
      }
      case "no_pending_refund": {
        if (!ctx.reserve) return { name, type: p.type, result: false, detail: "no tracked reserve (fails closed)" };
        if (ctx.reserve.count > 1) return { name, type: p.type, result: false, detail: "ambiguous reserves (fails closed)" };
        return { name, type: p.type, result: !ctx.reserve.refundPending, detail: ctx.reserve.refundPending ? "refund pending on the reserve" : "no refund pending" };
      }
      case "all_of": {
        const children: PredicateTrace[] = [];
        let ok = true;
        for (const c of p.predicates) {
          const t = evalNode(c);
          children.push(t);
          if (!t.result) {
            ok = false;
            break; // Iterator::all short-circuits
          }
        }
        return { name, type: p.type, result: ok, detail: p.predicates.length === 0 ? "empty all_of = true" : ok ? "all hold" : "one fails", children };
      }
      case "any_of": {
        const children: PredicateTrace[] = [];
        let ok = false;
        for (const c of p.predicates) {
          const t = evalNode(c);
          children.push(t);
          if (t.result) {
            ok = true;
            break; // Iterator::any short-circuits
          }
        }
        return { name, type: p.type, result: ok, detail: p.predicates.length === 0 ? "empty any_of = false" : ok ? "one holds" : "none holds", children };
      }
      case "not": {
        if (requiresSnapshot(map, p.predicate) && (ctx.issuerGrossDebt === null || ctx.reserve === null)) {
          return { name, type: p.type, result: false, detail: "not over collateralization without a snapshot (fails closed)" };
        }
        const t = evalNode(p.predicate);
        return { name, type: p.type, result: !t.result, detail: `not(${t.result})`, children: [t] };
      }
    }
  };

  const trace = evalNode(root);
  return {
    acceptable: trace.result,
    reason: trace.result ? null : `Note rejected by ${scope} policy '${root}'`,
    root,
    trace,
  };
}

// ---------- redemption-time compliance (tracker co-signing gate) ----------

export interface ComplianceNote {
  recipient: string;
  amountCollected: bigint;
  amountRedeemed: bigint;
  timestamp: bigint;
  denom: DenomId;
}

export type EffectivePolicy = { kind: "config"; config: AcceptanceConfig } | { kind: "default"; policy: DefaultPolicy };

/** resolve_effective_policy: stored per-recipient policy → global config → global default. */
export function resolveEffectivePolicy(stored: AcceptanceConfig | null | undefined, global: AcceptanceConfig): EffectivePolicy {
  if (stored) return stored.predicates.length === 0 ? { kind: "default", policy: "reject" } : { kind: "config", config: stored };
  return global.predicates.length === 0 ? { kind: "default", policy: global.default } : { kind: "config", config: global };
}

interface EvalEnv {
  issuer: string;
  refundPending: boolean;
  collateral: bigint;
  debt: bigint;
  holderTotalDebt: bigint;
}

function evalEnvPredicate(configs: Map<string, PredicateConfig>, name: string, env: EvalEnv, depth = 0): boolean {
  const p = configs.get(name);
  if (!p || depth > 64) return false; // missing reference → false (warn), recursion guard
  switch (p.type) {
    case "whitelist": {
      if (!lc(p.holders).has(env.issuer.toLowerCase())) return false;
      if (p.max_debt != null && env.holderTotalDebt > p.max_debt) return false;
      return true;
    }
    case "blacklist":
      return !lc(p.holders).has(env.issuer.toLowerCase());
    case "collateralization":
      if (env.debt === 0n) return true;
      return Number(env.collateral) / Number(env.debt) >= p.min_ratio;
    case "all_of":
      return p.predicates.every((c) => evalEnvPredicate(configs, c, env, depth + 1));
    case "any_of":
      return p.predicates.length > 0 && p.predicates.some((c) => evalEnvPredicate(configs, c, env, depth + 1));
    case "not":
      return !evalEnvPredicate(configs, p.predicate, env, depth + 1);
    case "no_pending_refund":
      return !env.refundPending;
  }
}

function evalEffective(policy: EffectivePolicy, env: EvalEnv): boolean {
  if (policy.kind === "default") return policy.policy === "accept";
  const configs = new Map(policy.config.predicates.map((p) => [p.name, p]));
  if (configs.size === 0) return policy.config.default === "accept";
  const root = policyRootName(policy.config, "redemption-check") ?? "";
  return evalEnvPredicate(configs, root, env);
}

export type ComplianceResult =
  | { ok: true; mode: "no-other-holders" | "compliant" | "fifo-oldest" | "mixed"; detail: string; collateral: { before: bigint; after: bigint }; debt: { before: bigint; after: bigint } }
  | {
      ok: false;
      failureId: "failed_policy_violation" | "failed_not_oldest_note";
      holder?: string;
      oldestTimestamp?: bigint;
      requestedTimestamp?: bigint;
      message: string;
      collateral: { before: bigint; after: bigint };
      debt: { before: bigint; after: bigint };
    };

export interface ComplianceInput {
  issuer: string;
  redeemer: string;
  redeemAmount: bigint;
  /** Current reserve collateral C in the denomination. */
  reserveValue: bigint;
  /** Miner fee taken from the reserve output; the real server passes 0 (fee comes from tracker inputs). */
  fee?: bigint;
  refundPending: boolean;
  /** All of the issuer's notes (other denominations are ignored). */
  notes: ComplianceNote[];
  denom: DenomId;
  /** Per-recipient stored policy lookup. */
  storedPolicy: (holder: string) => AcceptanceConfig | null | undefined;
  globalPolicy: AcceptanceConfig;
}

const sat = (a: bigint, b: bigint) => (a > b ? a - b : 0n);

/** Exact port of `check_redemption_policy_compliance`. */
export function checkRedemptionCompliance(input: ComplianceInput): ComplianceResult {
  const notes = input.notes.filter((n) => n.denom === input.denom);
  const outstanding = (n: ComplianceNote) => sat(n.amountCollected, n.amountRedeemed);
  const totalDebt = notes.reduce((s, n) => s + outstanding(n), 0n);
  const fee = input.fee ?? 0n;
  const collateralPost = sat(sat(input.reserveValue, input.redeemAmount), fee);
  const debtPost = sat(totalDebt, input.redeemAmount);
  const collateral = { before: input.reserveValue, after: collateralPost };
  const debt = { before: totalDebt, after: debtPost };
  const redeemer = input.redeemer.toLowerCase();

  const others = new Map<string, bigint>();
  for (const n of notes) {
    const r = n.recipient.toLowerCase();
    if (r === redeemer || outstanding(n) === 0n) continue;
    const prev = others.get(r) ?? 0n;
    others.set(r, prev > n.amountCollected ? prev : n.amountCollected);
  }
  if (others.size === 0) return { ok: true, mode: "no-other-holders", detail: "no other holders: nobody else's policy can be affected", collateral, debt };

  let firstViolated: { holder: string; detail: string } | null = null;
  let allPreViolated = true;
  let anyPreViolated = false;
  for (const [holder, holderTotal] of others) {
    const policy = resolveEffectivePolicy(input.storedPolicy(holder), input.globalPolicy);
    const pre = evalEffective(policy, { issuer: input.issuer, refundPending: input.refundPending, collateral: input.reserveValue, debt: totalDebt, holderTotalDebt: holderTotal });
    const post = evalEffective(policy, { issuer: input.issuer, refundPending: input.refundPending, collateral: collateralPost, debt: debtPost, holderTotalDebt: holderTotal });
    if (pre) allPreViolated = false;
    else anyPreViolated = true;
    if (pre && !post && !firstViolated) {
      firstViolated = {
        holder,
        detail: `collateralization ratio would drop from ${fmtRatio(input.reserveValue, totalDebt)} (${input.reserveValue}/${totalDebt}) to ${fmtRatio(collateralPost, debtPost)} (${collateralPost}/${debtPost})`,
      };
    }
  }
  if (firstViolated) {
    return {
      ok: false,
      failureId: "failed_policy_violation",
      holder: firstViolated.holder,
      message: `failed_policy_violation: redemption would newly violate acceptance policy of holder ${firstViolated.holder}: ${firstViolated.detail}`,
      collateral,
      debt,
    };
  }
  if (allPreViolated) {
    const live = notes.filter((n) => outstanding(n) > 0n);
    if (live.length === 0) return { ok: true, mode: "fifo-oldest", detail: "no outstanding notes", collateral, debt };
    let oldest = live[0];
    for (const n of live) if (n.timestamp < oldest.timestamp) oldest = n;
    if (oldest.recipient.toLowerCase() === redeemer) return { ok: true, mode: "fifo-oldest", detail: "reserve is distressed; the redeemer holds the oldest outstanding note (FIFO)", collateral, debt };
    const mine = live.filter((n) => n.recipient.toLowerCase() === redeemer).map((n) => n.timestamp);
    const requested = mine.length ? mine.reduce((a, b) => (a < b ? a : b)) : 0n;
    return {
      ok: false,
      failureId: "failed_not_oldest_note",
      oldestTimestamp: oldest.timestamp,
      requestedTimestamp: requested,
      message: `failed_not_oldest_note: reserve is distressed; only the oldest outstanding note (timestamp ${oldest.timestamp}) may redeem, requested note has timestamp ${requested}`,
      collateral,
      debt,
    };
  }
  // The server returns plain Ok here; "compliant" vs "mixed" is only a label for the UI.
  if (!anyPreViolated) return { ok: true, mode: "compliant", detail: "no other holder's policy is newly violated", collateral, debt };
  return { ok: true, mode: "mixed", detail: "some holders already violated, none newly violated", collateral, debt };
}

// ---------- presets ----------

/** ChainCash's "Collateral or Whitelist" idea: accept if ≥ minRatio collateralised OR the issuer is trusted. */
export function cowPolicy(trusted: string[], minRatio = 1.0, maxDebt: bigint | null = null): AcceptanceConfig {
  return {
    default: "reject",
    root: "cow",
    predicates: [
      { type: "whitelist", name: "trusted", holders: trusted, max_debt: maxDebt },
      { type: "collateralization", name: "collateral", min_ratio: minRatio },
      { type: "any_of", name: "cow", predicates: ["trusted", "collateral"] },
    ],
  };
}

/** Per-issuer cumulative caps (LETS-style credit lines): one whitelist per issuer, joined by any_of. */
export function creditCapsPolicy(caps: Array<{ issuer: string; cap: bigint; label?: string }>, extra: PredicateConfig[] = []): AcceptanceConfig {
  const preds: PredicateConfig[] = caps.map((c, i) => ({ type: "whitelist", name: c.label ?? `cap_${i}`, holders: [c.issuer], max_debt: c.cap }));
  preds.push(...extra);
  preds.push({ type: "any_of", name: "credit", predicates: preds.map((p) => p.name) });
  return { default: "reject", root: "credit", predicates: preds };
}

export function collateralPolicy(minRatio: number, requireNoRefund = true): AcceptanceConfig {
  const preds: PredicateConfig[] = [{ type: "collateralization", name: "collateral", min_ratio: minRatio }];
  if (requireNoRefund) {
    preds.push({ type: "no_pending_refund", name: "no_refund" });
    preds.push({ type: "all_of", name: "safe", predicates: ["collateral", "no_refund"] });
  }
  return { default: "reject", root: requireNoRefund ? "safe" : "collateral", predicates: preds };
}

export function acceptAllPolicy(): AcceptanceConfig {
  return { default: "accept", root: null, predicates: [{ type: "blacklist", name: "nobody_blocked", holders: [] }] };
}

// ---------- serialisation (same field names as the Rust serde format) ----------

/** JSON exactly as the tracker stores `policy_json` (u64 written as plain integers). */
export function policyToJson(config: AcceptanceConfig, indent = 2): string {
  const replacer = (_k: string, v: unknown) => (typeof v === "bigint" ? `__u64__${v.toString()}` : v);
  return JSON.stringify(config, replacer, indent).replace(/"__u64__(\d+)"/g, "$1");
}

export function policyFromJson(json: string): AcceptanceConfig {
  const quoted = json.replace(/("max_debt"\s*:\s*)(\d+)/g, '$1"$2"');
  const raw = JSON.parse(quoted) as { default?: DefaultPolicy; root?: string | null; predicates?: Array<Record<string, unknown>> };
  const predicates = (raw.predicates ?? []).map((p) => {
    if (p.type === "whitelist") return { ...p, max_debt: p.max_debt == null ? null : BigInt(p.max_debt as string) } as PredicateConfig;
    return p as unknown as PredicateConfig;
  });
  return { default: raw.default ?? "reject", root: raw.root ?? null, predicates };
}

/** TOML as in the tracker's config files (for display). */
export function policyToToml(config: AcceptanceConfig): string {
  const q = (s: string) => JSON.stringify(s);
  const lines = [`default = ${q(config.default)}`];
  if (config.root) lines.push(`root = ${q(config.root)}`);
  for (const p of config.predicates) {
    lines.push("", "[[predicates]]", `name = ${q(p.name)}`, `type = ${q(p.type)}`);
    if (p.type === "whitelist" || p.type === "blacklist") lines.push(`holders = [${p.holders.map(q).join(", ")}]`);
    if (p.type === "whitelist" && p.max_debt != null) lines.push(`max_debt = ${p.max_debt}`);
    if (p.type === "collateralization") lines.push(`min_ratio = ${Number.isInteger(p.min_ratio) ? p.min_ratio.toFixed(1) : p.min_ratio}`);
    if (p.type === "all_of" || p.type === "any_of") lines.push(`predicates = [${p.predicates.map(q).join(", ")}]`);
    if (p.type === "not") lines.push(`predicate = ${q(p.predicate)}`);
  }
  return lines.join("\n") + "\n";
}
