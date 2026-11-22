// Acceptance-policy presets for the wallet's policy builder (FEATURES A01–A04). The output is the tracker's
// own AcceptanceConfig format; the engine evaluates it exactly like the server. Thresholds such as 150 / 120
// / 100 % are wallet policy, not contract rules (say so in the UI where they are introduced).
import { acceptAllPolicy, collateralPolicy, defaultCollateralPolicy, hasRootAmbiguity, policyRootName, validatePolicy, type AcceptanceConfig, type Economy, type Hex } from "@/protocol";

export type PolicyPresetId = "friends-only" | "friends-or-backed" | "backed-100" | "backed-150" | "half-backed" | "backed-no-refund" | "server-default" | "accept-all" | "reject-all";

export interface PolicyPresetParams {
  /** Participant ids (or 33-byte pubkeys in hex) for whitelist presets. */
  friends?: string[];
  /** Cap on each friend's cumulative total (base units; null = no cap). */
  maxDebt?: bigint | null;
  /** Ratio for collateral presets (1.0 = 100 %). */
  minRatio?: number;
}

export interface PolicyPreset {
  id: PolicyPresetId;
  /** i18n keys: `world.policy.<id>.name` / `.about`. */
  nameKey: string;
  aboutKey: string;
  needsFriends: boolean;
}

export const POLICY_PRESETS: readonly PolicyPreset[] = (
  [
    ["friends-only", true],
    ["friends-or-backed", true],
    ["backed-100", false],
    ["backed-150", false],
    ["half-backed", false],
    ["backed-no-refund", false],
    ["server-default", false],
    ["accept-all", false],
    ["reject-all", false],
  ] as const
).map(([id, needsFriends]) => ({ id, nameKey: `world.policy.${id}.name`, aboutKey: `world.policy.${id}.about`, needsFriends }));

function pubsOf(eco: Economy | null, ids: string[] = []): Hex[] {
  return ids.map((x) => (/^0[23][0-9a-f]{64}$/i.test(x) ? x.toLowerCase() : eco ? eco.p(x).pub : x));
}

/** Builds the AcceptanceConfig of a preset. Friends may be given as participant ids (needs `eco`) or pubkeys. */
export function policyFromPreset(id: PolicyPresetId, p: PolicyPresetParams = {}, eco: Economy | null = null): AcceptanceConfig {
  const friends = pubsOf(eco, p.friends);
  switch (id) {
    case "friends-only":
      return { default: "reject", root: "friends", predicates: [{ type: "whitelist", name: "friends", holders: friends, max_debt: p.maxDebt ?? null }] };
    case "friends-or-backed":
      return {
        default: "reject",
        root: "friends_or_backed",
        predicates: [
          { type: "whitelist", name: "friends", holders: friends, max_debt: p.maxDebt ?? null },
          { type: "collateralization", name: "backed", min_ratio: p.minRatio ?? 1.0 },
          { type: "any_of", name: "friends_or_backed", predicates: ["friends", "backed"] },
        ],
      };
    case "backed-100":
      return collateralPolicy(p.minRatio ?? 1.0, false);
    case "backed-150":
      return collateralPolicy(p.minRatio ?? 1.5, false);
    case "half-backed":
      return collateralPolicy(p.minRatio ?? 0.5, false);
    case "backed-no-refund":
      return collateralPolicy(p.minRatio ?? 1.0, true);
    case "server-default":
      return defaultCollateralPolicy();
    case "accept-all":
      return acceptAllPolicy();
    case "reject-all":
      return { default: "reject", root: null, predicates: [] };
    default:
      // an unknown id must never fall through to "no policy" (that would accept by the server default)
      throw new Error(`unknown policy preset: ${String(id)}`);
  }
}

export interface PolicyCheck {
  ok: boolean;
  /** validatePolicy's message (the builder's error text). */
  error: string | null;
  /** A04: no explicit root and the two server evaluators would pick different roots. */
  rootAmbiguity: boolean;
  rootBuilder: string | null;
  rootRedemption: string | null;
  /** Predicates not reachable from the root (inert). */
  inert: string[];
}

/** Validates a policy and reports the root-consistency issues (A03, A04). */
export function checkPolicy(cfg: AcceptanceConfig): PolicyCheck {
  const error = validatePolicy(cfg);
  const rootBuilder = policyRootName(cfg, "builder");
  const rootRedemption = policyRootName(cfg, "redemption-check");
  const byName = new Map(cfg.predicates.map((p) => [p.name, p]));
  const seen = new Set<string>();
  const walk = (n: string | null) => {
    if (!n || seen.has(n)) return;
    seen.add(n);
    const p = byName.get(n);
    if (!p) return;
    if (p.type === "all_of" || p.type === "any_of") p.predicates.forEach(walk);
    if (p.type === "not") walk(p.predicate);
  };
  walk(rootBuilder);
  const inert = cfg.predicates.map((p) => p.name).filter((n) => !seen.has(n));
  return { ok: error === null, error, rootAmbiguity: hasRootAmbiguity(cfg), rootBuilder, rootRedemption, inert };
}

/** Best-effort preset recognition (for showing "your policy: Friends or backed"). */
export function presetOf(cfg: AcceptanceConfig | null): PolicyPresetId | "custom" | "none" {
  if (!cfg) return "none";
  const json = JSON.stringify(cfg, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  for (const pr of POLICY_PRESETS) {
    if (pr.needsFriends) {
      if (cfg.root === (pr.id === "friends-only" ? "friends" : "friends_or_backed")) return pr.id;
      continue;
    }
    if (JSON.stringify(policyFromPreset(pr.id), (_k, v) => (typeof v === "bigint" ? v.toString() : v)) === json) return pr.id;
  }
  return "custom";
}
