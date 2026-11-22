// An acceptance policy (the tracker's AcceptanceConfig) as one sentence with pills (VISUAL §12.8), its mono
// predicate tags, and an evaluation trace in words. Grammar is template-based so EN and RU read naturally
// (RU lists names after a colon, so they stay in the nominative).
import type { ReactNode } from "react";
import type { TFn } from "@/app/lang";
import { policyRootName, type AcceptanceConfig, type PredicateConfig, type PredicateTrace } from "@/protocol";
import type { PolicyPill } from "@/ui";

export type Part = string | PolicyPill;

export interface PolicyTextCtx {
  t: TFn;
  /** Public key → display data (null when the key is not in the town). */
  who: (pub: string) => { name: string; agent: boolean } | null;
  /** A max_debt in base units → "5.00 ERG". */
  cap: (v: bigint) => string;
  uid: string;
  /** Optional pill editors (the policy page). */
  edit?: { cap?: (pred: string) => ReactNode; ratio?: (pred: string) => ReactNode; names?: (pred: string) => ReactNode };
}

function fill(tpl: string, vars: Record<string, Part[]>): Part[] {
  const out: Part[] = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tpl))) {
    if (m.index > last) out.push(tpl.slice(last, m.index));
    out.push(...(vars[m[1]] ?? [m[0]]));
    last = re.lastIndex;
  }
  if (last < tpl.length) out.push(tpl.slice(last));
  return out;
}

function join(items: Part[][], comma: string, last: string): Part[] {
  const out: Part[] = [];
  items.forEach((x, i) => {
    if (i > 0) out.push(i === items.length - 1 ? last : comma);
    out.push(...x);
  });
  return out;
}

export function ratioLabel(r: number): string {
  return `≥ ${Math.round(r * 100)} ⁠%`;
}

/** The sentence parts and the predicate tags of a policy. */
export function policyText(cfg: AcceptanceConfig | null, c: PolicyTextCtx): { parts: Part[]; tags: { label: ReactNode; metal?: boolean }[] } {
  const { t } = c;
  if (!cfg) return { parts: [t("wallet.pol.noPolicy")], tags: [{ label: "policy · none" }] };
  if (cfg.predicates.length === 0) return { parts: [t("wallet.pol.acceptNone")], tags: [{ label: `default · ${cfg.default}` }, { label: "predicates · []" }] };
  const map = new Map(cfg.predicates.map((p) => [p.name, p]));
  const root = cfg.root ?? policyRootName(cfg, "builder");
  let n = 0;
  const pill = (label: string, o: Partial<PolicyPill> = {}): PolicyPill => ({ id: `${c.uid}-${n++}`, label, ...o });
  const names = (holders: string[], pred: string, neg = false): Part[] => {
    if (holders.length === 0) return [t("wallet.pol.emptyList")];
    return join(
      holders.map((h) => {
        const w = c.who(h);
        return [pill(w?.name ?? `${h.slice(0, 4)}…${h.slice(-4)}`, { pk: h, agent: w?.agent, edit: c.edit?.names?.(pred) })];
      }),
      t("wallet.pol.comma"),
      t(neg ? "wallet.pol.orWord" : "wallet.pol.and"),
    );
  };
  const seen = new Set<string>();
  /** "whose reserve covers ≥ 100 % of their debt" (after "anyone") */
  const whoOf = (p: PredicateConfig): Part[] | null => {
    if (p.type === "collateralization") return fill(t("wallet.pol.who.coll"), { pct: [pill(ratioLabel(p.min_ratio), { metal: true, edit: c.edit?.ratio?.(p.name) })] });
    if (p.type === "no_pending_refund") return fill(t("wallet.pol.who.noRefund"), { x: [pill(t("wallet.pol.noExit"))] });
    if (p.type === "blacklist" && p.holders.length) return fill(t("wallet.pol.who.notIn"), { names: names(p.holders, p.name) });
    if (p.type === "all_of") {
      const kids = p.predicates.map((k) => map.get(k)).filter((k): k is PredicateConfig => !!k);
      if (kids.length && kids.every((k) => k.type === "collateralization" || k.type === "no_pending_refund" || (k.type === "blacklist" && k.holders.length > 0))) {
        return join(kids.map((k) => whoOf(k)!), t("wallet.pol.comma"), t("wallet.pol.and"));
      }
    }
    return null;
  };
  /** "their reserve covers ≥ 100 %" (after "if also") */
  const condOf = (p: PredicateConfig): Part[] | null => {
    if (p.type === "collateralization") return fill(t("wallet.pol.cond.coll"), { pct: [pill(ratioLabel(p.min_ratio), { metal: true, edit: c.edit?.ratio?.(p.name) })] });
    if (p.type === "no_pending_refund") return fill(t("wallet.pol.cond.noRefund"), { x: [pill(t("wallet.pol.noExit"))] });
    if (p.type === "blacklist" && p.holders.length) return fill(t("wallet.pol.cond.notIn"), { names: names(p.holders, p.name, true) });
    return null;
  };
  const phrase = (name: string, depth = 0): Part[] => {
    const p = map.get(name);
    if (!p) return [t("wallet.pol.missing", { name })];
    if (seen.has(name) || depth > 8) return [t("wallet.pol.loop", { name })];
    seen.add(name);
    try {
      switch (p.type) {
        case "whitelist": {
          const out = fill(t("wallet.pol.from.list"), { names: names(p.holders, p.name) });
          if (p.max_debt != null) out.push(...fill(t("wallet.pol.capEach"), { cap: [pill(c.cap(p.max_debt), { edit: c.edit?.cap?.(p.name) })] }));
          return out;
        }
        case "blacklist":
          return p.holders.length ? fill(t("wallet.pol.from.except"), { names: names(p.holders, p.name) }) : [t("wallet.pol.from.anyone")];
        case "collateralization":
        case "no_pending_refund":
          return fill(t("wallet.pol.from.anyoneWho"), { who: whoOf(p)! });
        case "any_of": {
          if (p.predicates.length === 0) return [t("wallet.pol.from.nobody")];
          return join(p.predicates.map((k) => phrase(k, depth + 1)), t("wallet.pol.or"), t("wallet.pol.or"));
        }
        case "all_of": {
          if (p.predicates.length === 0) return [t("wallet.pol.from.anyone")];
          const w = whoOf(p);
          if (w) return fill(t("wallet.pol.from.anyoneWho"), { who: w });
          const [first, ...rest] = p.predicates;
          const out = phrase(first, depth + 1);
          for (const k of rest) {
            const kp = map.get(k);
            const cond = kp ? condOf(kp) : null;
            if (cond) out.push(...fill(t("wallet.pol.ifAlso"), { cond }));
            else out.push(...fill(t("wallet.pol.andAlso"), { x: phrase(k, depth + 1) }));
          }
          return out;
        }
        case "not": {
          const k = map.get(p.predicate);
          if (k?.type === "whitelist") return fill(t("wallet.pol.from.except"), { names: names(k.holders, k.name) });
          const cond = k ? condOf(k) : null;
          if (cond) return fill(t("wallet.pol.from.unless"), { cond });
          return fill(t("wallet.pol.from.unlessX"), { x: phrase(p.predicate, depth + 1) });
        }
      }
    } finally {
      seen.delete(name);
    }
    return [];
  };
  const body = root ? phrase(root) : [t("wallet.pol.from.nobody")];
  const parts = fill(t("wallet.pol.accept"), { x: body });
  const tags: { label: ReactNode; metal?: boolean }[] = [];
  for (const p of cfg.predicates) {
    if (p.type === "whitelist") tags.push({ label: `whitelist · ${p.name}${p.max_debt != null ? ` · max_debt ${c.cap(p.max_debt)}` : ""}` });
    else if (p.type === "blacklist") tags.push({ label: `blacklist · ${p.name}` });
    else if (p.type === "collateralization") tags.push({ label: `collateralization ≥ ${p.min_ratio.toFixed(2)}`, metal: true });
    else if (p.type === "no_pending_refund") tags.push({ label: "no_pending_refund" });
    else if (p.type === "not") tags.push({ label: `not · ${p.predicate}` });
    else tags.push({ label: `${p.type} · ${p.name}` });
  }
  tags.push({ label: `root · ${root ?? "—"}` }, { label: `default · ${cfg.default}` });
  return { parts, tags };
}

// ---------------------------------------------------------------------------------------------
// evaluation trace in words
// ---------------------------------------------------------------------------------------------

export interface TraceLine {
  depth: number;
  ok: boolean;
  text: string;
  tag: string;
}

export interface TraceFacts {
  /** The candidate cumulative total of the edge. */
  total: string;
  /** whitelist max_debt formatted, by predicate name. */
  capOf: (name: string) => string | null;
  /** The issuer's coverage for the acceptance formula (collateral / gross debt), as text. */
  coverage: string | null;
  /** min_ratio formatted, by predicate name. */
  ratioOf: (name: string) => string | null;
  issuer: string;
}

export function traceLines(trace: PredicateTrace | null, f: TraceFacts, t: TFn, depth = 0, out: TraceLine[] = []): TraceLine[] {
  if (!trace) return out;
  let text: string;
  switch (trace.type) {
    case "whitelist": {
      const cap = f.capOf(trace.name);
      const member = !trace.detail.startsWith("issuer is not");
      text = !member ? t("wallet.tr.notListed", { who: f.issuer }) : cap ? t(trace.result ? "wallet.tr.capOk" : "wallet.tr.capOver", { total: f.total, cap }) : t("wallet.tr.listed", { who: f.issuer });
      break;
    }
    case "blacklist":
      text = t(trace.result ? "wallet.tr.notBlocked" : "wallet.tr.blocked", { who: f.issuer });
      break;
    case "collateralization":
      text = trace.detail.includes("no tracked reserve")
        ? t("wallet.tr.noReserve", { who: f.issuer })
        : trace.detail === "no debt"
          ? t("wallet.tr.noDebt")
          : t(trace.result ? "wallet.tr.covOk" : "wallet.tr.covLow", { cov: f.coverage ?? "—", need: f.ratioOf(trace.name) ?? "—" });
      break;
    case "no_pending_refund":
      text = trace.detail.includes("no tracked reserve") ? t("wallet.tr.noReserve", { who: f.issuer }) : t(trace.result ? "wallet.tr.noExit" : "wallet.tr.exit");
      break;
    case "any_of":
      text = t(trace.result ? "wallet.tr.anyOk" : "wallet.tr.anyNo");
      break;
    case "all_of":
      text = t(trace.result ? "wallet.tr.allOk" : "wallet.tr.allNo");
      break;
    case "not":
      text = t("wallet.tr.not");
      break;
    default:
      text = t("wallet.tr.missing", { name: trace.name });
  }
  out.push({ depth, ok: trace.result, text, tag: `${trace.type} · ${trace.name}` });
  for (const k of trace.children ?? []) traceLines(k, f, t, depth + 1, out);
  return out;
}
