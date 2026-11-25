// Token reserves in the flows: the T1 body, the token top-up plan, and "which reserve is this key's own" per
// denomination (an ERG answer never names a token reserve, nor the other way round).
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX, SIGUSD_TOKEN_ID, reserveTokenById, MINER_FEE_NANOERG, checkReserveAction } from "../tx";
import { p2pkBox, reserveBox } from "../tx/testkit";
import { planTokenT1, tokenBalanceOf, tokenT1CreateBody, mempoolCreatesReserve } from "./coins";
import { ownReserve, planTokenTopUp, topUpMax, trackedAs, trackedGate, trustedNft, type TrackedRef } from "./reserveops";

const me = keyPairFromSecret(3n).pubHex;
const SIG = reserveTokenById(SIGUSD_TOKEN_ID)!;
const FEE = MINER_FEE_NANOERG;
const NFT = "a7".repeat(32);
const box = p2pkBox(me, 10_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 900n }] });

describe("token T1 in the flows", () => {
  it("the create body names the token, its raw amount and the box's ERG", () => {
    const p = planTokenT1([box], me, SIG, 500n, FEE, SIG.defaultCap);
    if (!p.ok) throw new Error(p.why);
    expect(tokenT1CreateBody(p.plan, me)).toBe(`{"nft_id":"${box.boxId}","owner_pubkey":"${me}","erg_amount":${TOKEN_RESERVE_BOX_NANOERG},"token_amount":500,"token_id":"${SIGUSD_TOKEN_ID}"}`);
    expect(tokenBalanceOf([box], SIGUSD_TOKEN_ID)).toBe(900n);
  });

  it("a mempool T1 under the token contract counts for the token, not for ERG", () => {
    const tx = { id: "aa".repeat(32), spends: [box.boxId], inputs: [{ boxId: box.boxId, ergoTree: `0008cd${me}` }], outputs: [{ ergoTree: TOKEN_RESERVE_TREE_HEX, r4: `07${me}` }] } as never;
    expect(mempoolCreatesReserve([tx], { pub: me, address: "9x" }, `token:${SIGUSD_TOKEN_ID}`)).not.toBeNull();
    expect(mempoolCreatesReserve([tx], { pub: me, address: "9x" })).toBeNull();
  });
});

describe("token top-up plan", () => {
  const reserve = reserveBox(me, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 500n }] });
  it("caps in raw units of the token, own reserve in total", () => {
    expect(topUpMax(true, 500n, SIG.defaultCap, SIG.hardCap)).toBe(0n);
    expect(topUpMax(true, 500n, SIG.hardCap, SIG.hardCap)).toBe(2_000n);
    expect(topUpMax(false, 500n, 10_000n, SIG.hardCap)).toBe(2_500n);
  });
  it("plans, and the plan passes L1", () => {
    const p = planTokenTopUp([box], me, reserve, SIG, 300n, FEE, 1_925_000, 2_000n);
    if (!p.ok) throw new Error(p.why);
    expect(p.tx.outputs[0].tokens[1]).toEqual({ tokenId: SIGUSD_TOKEN_ID, amount: 800n });
    expect(checkReserveAction(p.tx, [reserve, ...p.inputs], { kind: "topup", signer: me, height: 1_925_000, fee: FEE, amount: 300n, denom: `token:${SIGUSD_TOKEN_ID}`, add: p.add })).toEqual({ ok: true });
    expect(planTokenTopUp([box], me, reserve, SIG, 901n, FEE, 1_925_000, 2_000n)).toMatchObject({ ok: false, why: "short", tokens: true });
    expect(planTokenTopUp([box], me, reserve, SIG, 50n, FEE, 1_925_000, 2_000n)).toMatchObject({ ok: false, why: "amount" });
  });
});

describe("which reserve is the key's own, per denomination", () => {
  const ergRef: TrackedRef = { box: "11".repeat(32), owner: me, nft: "e1".repeat(32), token: null, genuine: true };
  const sigRef: TrackedRef = { box: "22".repeat(32), owner: me, nft: NFT, token: SIGUSD_TOKEN_ID, genuine: true };
  it("the tracker's ERG and SigUSD entries never stand in for each other", () => {
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [ergRef, sigRef] })).toEqual({ ok: true, nft: ergRef.nft });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [ergRef, sigRef], token: SIGUSD_TOKEN_ID })).toEqual({ ok: true, nft: NFT });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [ergRef], token: SIGUSD_TOKEN_ID })).toEqual({ ok: false, why: "none" });
    const list = [{ box: ergRef.box, owner: me, token: null }, { box: sigRef.box, owner: me, token: SIGUSD_TOKEN_ID }];
    expect(trackedGate(me, list, [ergRef, sigRef])).toMatchObject({ k: "own", r: { box: ergRef.box } });
    expect(trackedGate(me, list, [ergRef, sigRef], SIGUSD_TOKEN_ID)).toMatchObject({ k: "own", r: { box: sigRef.box } });
    expect(trackedAs(me, NFT, [sigRef])).toBe(false);
    expect(trackedAs(me, NFT, [sigRef], SIGUSD_TOKEN_ID)).toBe(true);
  });
  it("the box that holds the trusted NFT must be a token reserve of this token", () => {
    const held = { box: reserveBox(me, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }] }), height: 1 };
    expect(ownReserve({ owner: me, trusted: { ok: true, nft: NFT }, held, listing: null, token: SIGUSD_TOKEN_ID })).toMatchObject({ ok: true, nft: NFT });
    expect(ownReserve({ owner: me, trusted: { ok: true, nft: NFT }, held, listing: null })).toEqual({ ok: false, why: "none" });
  });
});
