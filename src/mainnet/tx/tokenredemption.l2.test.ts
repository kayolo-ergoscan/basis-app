// Token redemption L2 (review MEDIUM-1): a build in the tracker's layout with REAL AVL+ trees and proofs, made the way
// the tracker makes them (basis_store: tracker-tree lookup #8, reserve-tree lookup #7, InsertOrUpdate #5), goes
// through L1 and then the contract engine on the basis-token branch with the stock verifier (avl.wasm).
import { beforeAll, describe, expect, it } from "vitest";
import type { AvlBackend } from "../../protocol/avl";
import { checkRedemptionContract, loadContractAvl } from "./contract";
import { checkRedemption, parseBuildResponse } from "./redemption";
import { syntheticTokenRedemption, trackerBuildResponse } from "./testkit";
import { RSADA_TOKEN_ID, SIGUSD_TOKEN_ID } from "./tokens";

let avl: AvlBackend;
beforeAll(async () => {
  avl = await loadContractAvl();
});

const TS = 1_795_357_991_710n;
// the block that includes it: the synthetic tip (1 922 400) + 1, as the Redeem screen passes tip + 1
const AT = 1_922_401;

function l1Of(s: ReturnType<typeof syntheticTokenRedemption>) {
  const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, s.expect);
  if (!l1.ok) throw new Error(`L1 ${l1.rule}: ${l1.message}`);
  return l1;
}

describe("token redemption L2 with real proofs", () => {
  it("first redemption (no #7): the contract redeems exactly the amount and records it", () => {
    const s = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, avl, reserveTokens: 2_000n, totalDebt: 1_000n, amount: 300n, timestamp: TS });
    expect(s.parts.summary.isFirstRedemption).toBe(true);
    expect(s.parts.unsigned.inputs[0].extension.some((e) => e.key === 7)).toBe(false);
    const r = checkRedemptionContract(l1Of(s), s.chain, AT, avl);
    if (!r.ok) throw new Error(`L2 ${r.rule}: ${r.message}`);
    expect(r.eval?.contract).toBe("basis-token.es");
    expect(r.eval?.proofMode).toBe("verified");
    expect(r.eval?.action).toBe(0);
    expect(r.eval?.emergency).toBe(false);
    expect(r.eval?.redeemed).toBe(300n);
    expect(r.eval?.newRedeemedTotal).toBe(300n);
    expect(r.eval?.checks.filter((c) => c.outcome !== "true").map((c) => c.id)).toEqual([]);
    expect(r.eval?.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["trackerDebtCorrect", "timestampCorrect", "properRedemptionTree", "properlyRedeemed", "receiverSignature", "tokenIdsPreserved", "ergPreserved"]));
  });

  it("a later redemption (#7 lookup, insertOrUpdate): the new total is the prior one plus the amount", () => {
    const s = syntheticTokenRedemption({ tokenId: RSADA_TOKEN_ID, avl, reserveTokens: 9_000_000n, totalDebt: 5_000_000n, amount: 1_250_000n, timestamp: TS, prior: { timestamp: TS - 60_000n, redeemed: 2_000_000n } });
    expect(s.parts.summary.isFirstRedemption).toBe(false);
    expect(s.parts.summary.newAlreadyRedeemed).toBe(3_250_000n);
    const r = checkRedemptionContract(l1Of(s), s.chain, AT, avl);
    if (!r.ok) throw new Error(`L2 ${r.rule}: ${r.message}`);
    expect(r.eval?.redeemed).toBe(1_250_000n);
    expect(r.eval?.newRedeemedTotal).toBe(3_250_000n);
  });

  it("refuses the same build when it claims another new total, or takes more than the room left", () => {
    const s = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, avl, totalDebt: 1_000n, amount: 300n, timestamp: TS, prior: { timestamp: TS - 1n, redeemed: 200n } });
    const wrong = { ...s.parts, summary: { ...s.parts.summary, newAlreadyRedeemed: 300n } };
    const l1 = checkRedemption(parseBuildResponse(trackerBuildResponse(wrong)), s.chain, s.expect);
    if (!l1.ok) throw new Error(`L1 ${l1.rule}: ${l1.message}`);
    expect(checkRedemptionContract(l1, s.chain, AT, avl)).toMatchObject({ ok: false, rule: "redeemed-total" });
    // 900 already redeemed of 1 000: 300 more is above the room (the contract's properlyRedeemed)
    const over = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, avl, totalDebt: 1_000n, amount: 300n, timestamp: TS, prior: { timestamp: TS - 1n, redeemed: 900n } });
    expect(checkRedemptionContract(l1Of(over), over.chain, AT, avl)).toMatchObject({ ok: false, rule: "properlyRedeemed" });
  });

  it("refuses a note older than the last redemption of the pair (timestampCorrect)", () => {
    const s = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, avl, totalDebt: 1_000n, amount: 100n, timestamp: TS, prior: { timestamp: TS + 1n, redeemed: 100n } });
    expect(checkRedemptionContract(l1Of(s), s.chain, AT, avl)).toMatchObject({ ok: false, rule: "timestampCorrect" });
  });
});
