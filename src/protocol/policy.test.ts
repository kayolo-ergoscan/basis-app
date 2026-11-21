import { describe, expect, it } from "vitest";
import {
  acceptAllPolicy,
  checkRedemptionCompliance,
  collateralPolicy,
  cowPolicy,
  defaultCollateralPolicy,
  EMPTY_POLICY,
  evaluateAcceptance,
  hasRootAmbiguity,
  policyFromJson,
  policyRootName,
  policyToJson,
  policyToToml,
  validatePolicy,
  type AcceptanceConfig,
  type AcceptanceContext,
  type ComplianceInput,
} from "./policy";

const A = "02" + "aa".repeat(32);
const B = "02" + "bb".repeat(32);
const C = "02" + "cc".repeat(32);

const ctx = (o: Partial<AcceptanceContext> = {}): AcceptanceContext => ({
  issuer: A,
  recipient: B,
  totalDebt: 100n,
  denom: "erg",
  reserve: { collateral: 200n, refundPending: false, count: 1 },
  issuerGrossDebt: 100n,
  ...o,
});

describe("acceptance (check_acceptance semantics)", () => {
  it("root: builder takes the alphabetically last name, the redemption check the last in the list", () => {
    const cfg: AcceptanceConfig = {
      default: "reject",
      predicates: [
        { type: "collateralization", name: "zeta", min_ratio: 1 },
        { type: "whitelist", name: "alpha", holders: [A] },
      ],
    };
    expect(policyRootName(cfg, "builder")).toBe("zeta");
    expect(policyRootName(cfg, "redemption-check")).toBe("alpha");
    expect(hasRootAmbiguity(cfg)).toBe(true);
    expect(hasRootAmbiguity(cowPolicy([A]))).toBe(false);
  });

  it("empty per-recipient policy rejects; an empty global one uses its default", () => {
    expect(evaluateAcceptance(EMPTY_POLICY, ctx()).acceptable).toBe(false);
    expect(evaluateAcceptance({ default: "accept", predicates: [] }, ctx(), "global").acceptable).toBe(true);
    expect(evaluateAcceptance(acceptAllPolicy(), ctx()).acceptable).toBe(true);
  });

  it("whitelist max_debt caps the CUMULATIVE total; collateral uses gross debt and fails closed", () => {
    const cow = cowPolicy([A], 1.0, 150n);
    expect(evaluateAcceptance(cow, ctx({ reserve: null, issuerGrossDebt: null })).acceptable).toBe(true);
    expect(evaluateAcceptance(cow, ctx({ totalDebt: 151n, reserve: null })).acceptable).toBe(false);
    const col = defaultCollateralPolicy();
    expect(evaluateAcceptance(col, ctx({ issuerGrossDebt: 200n })).acceptable).toBe(true);
    expect(evaluateAcceptance(col, ctx({ issuerGrossDebt: 201n })).acceptable).toBe(false);
    expect(evaluateAcceptance(col, ctx({ reserve: null })).acceptable).toBe(false);
    expect(evaluateAcceptance(col, ctx({ reserve: { collateral: 999n, refundPending: false, count: 2 } })).acceptable).toBe(false);
    const safe = collateralPolicy(1.0, true);
    expect(evaluateAcceptance(safe, ctx({ reserve: { collateral: 999n, refundPending: true, count: 1 } })).acceptable).toBe(false);
  });

  it("not over collateralization without a snapshot fails closed; traces short-circuit", () => {
    const cfg: AcceptanceConfig = {
      default: "reject",
      root: "neg",
      predicates: [
        { type: "collateralization", name: "c", min_ratio: 5 },
        { type: "not", name: "neg", predicate: "c" },
      ],
    };
    expect(evaluateAcceptance(cfg, ctx({ reserve: null })).acceptable).toBe(false);
    expect(evaluateAcceptance(cfg, ctx()).acceptable).toBe(true);
    const r = evaluateAcceptance(cowPolicy([A]), ctx());
    expect(r.trace!.children!.length).toBe(1); // any_of stopped at the first true child
  });

  it("builder errors: unknown reference, cycle", () => {
    expect(validatePolicy({ default: "reject", root: "x", predicates: [{ type: "not", name: "x", predicate: "y" }] })).toMatch(/unknown/);
    expect(
      validatePolicy({
        default: "reject",
        root: "a",
        predicates: [
          { type: "not", name: "a", predicate: "b" },
          { type: "not", name: "b", predicate: "a" },
        ],
      }),
    ).toMatch(/circular/);
  });

  it("serialises like the server (u64 as JSON numbers, TOML for config)", () => {
    const cfg = cowPolicy([A], 1.5, 18446744073709551615n);
    const json = policyToJson(cfg);
    expect(json).toContain('"max_debt": 18446744073709551615');
    expect(policyFromJson(json)).toEqual({ ...cfg, root: "cow" });
    expect(policyToToml(cfg)).toContain("max_debt = 18446744073709551615");
    expect(policyToToml(defaultCollateralPolicy())).toContain("min_ratio = 1.0");
  });
});

describe("redemption compliance (tracker co-signing gate)", () => {
  const base = (o: Partial<ComplianceInput> = {}): ComplianceInput => ({
    issuer: A,
    redeemer: B,
    redeemAmount: 50n,
    reserveValue: 300n,
    refundPending: false,
    notes: [
      { recipient: B, amountCollected: 100n, amountRedeemed: 0n, timestamp: 1n, denom: "erg" },
      { recipient: C, amountCollected: 100n, amountRedeemed: 0n, timestamp: 2n, denom: "erg" },
    ],
    denom: "erg",
    storedPolicy: () => defaultCollateralPolicy(),
    globalPolicy: EMPTY_POLICY,
    ...o,
  });

  it("no other holders", () => {
    const r = checkRedemptionCompliance(base({ notes: [{ recipient: B, amountCollected: 100n, amountRedeemed: 0n, timestamp: 1n, denom: "erg" }] }));
    expect(r.ok && r.mode).toBe("no-other-holders");
  });

  it("compliant when no other holder's policy is newly violated", () => {
    const r = checkRedemptionCompliance(base());
    expect(r.ok && r.mode).toBe("compliant");
  });

  it("distressed reserve → FIFO: only the oldest outstanding note may redeem", () => {
    const younger = checkRedemptionCompliance(base({ redeemer: C, reserveValue: 150n }));
    expect(younger.ok).toBe(false);
    expect(!younger.ok && younger.failureId).toBe("failed_not_oldest_note");
    const oldest = checkRedemptionCompliance(base({ reserveValue: 150n }));
    expect(oldest.ok && oldest.mode).toBe("fifo-oldest");
  });

  it("shipped default (reject, no predicates) makes every multi-holder redemption FIFO", () => {
    const r = checkRedemptionCompliance(base({ redeemer: C, storedPolicy: () => undefined, globalPolicy: EMPTY_POLICY }));
    expect(!r.ok && r.failureId).toBe("failed_not_oldest_note");
  });

  it("a fractional policy (min_ratio < 1) can be NEWLY violated", () => {
    const half = collateralPolicy(0.5, false);
    const r = checkRedemptionCompliance(base({ reserveValue: 110n, redeemAmount: 90n, storedPolicy: () => half }));
    expect(!r.ok && r.failureId).toBe("failed_policy_violation");
  });

  it("with min_ratio ≥ 1 a redemption never newly violates (ratio moves away from 1)", () => {
    for (const C0 of [200n, 250n, 1000n])
      for (const x of [1n, 50n, 99n]) {
        const r = checkRedemptionCompliance(base({ reserveValue: C0, redeemAmount: x }));
        expect(r.ok).toBe(true);
      }
  });
});
