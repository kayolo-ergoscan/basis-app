// Token reserves in the flows: the T1 body, the token top-up plan, and "which reserve is this key's own" per
// denomination (an ERG answer never names a token reserve, nor the other way round).
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX, SIGUSD_TOKEN_ID, reserveTokenById, MINER_FEE_NANOERG, checkReserveAction } from "../tx";
import { p2pkBox, reserveBox } from "../tx/testkit";
import { planTokenT1, tokenBalanceOf, tokenT1CreateBody, mempoolCreatesReserve } from "./coins";
import { linkTarget, ownReserve, planTokenTopUp, topUpMax, trackedAs, trackedGate, trustedNft, type TrackedRef } from "./reserveops";
import { parseRequest, requestLink } from "./receipt";
import { redeemPrefill, tokenRedeemMax } from "./redeem";
import { parseWatchStore, watchIssuer, watchedDenoms } from "./watch";
import { TRACKER_NFT } from "../tx";

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
  it("a link to another key's SigUSD reserve opens only when the tracker tracks it in SigUSD (shots 25 Nov: the token was not passed)", () => {
    const them = keyPairFromSecret(5n).pubHex;
    const theirSig: TrackedRef = { ...sigRef, owner: them };
    const own = { ok: false as const, why: "untrusted" as const };
    expect(linkTarget({ me, nft: NFT, owner: them, own, trackedOfOwner: [theirSig], token: SIGUSD_TOKEN_ID })).toBe("other");
    expect(linkTarget({ me, nft: NFT, owner: them, own, trackedOfOwner: [theirSig] })).toBe("untrusted");
    expect(linkTarget({ me, nft: NFT, owner: them, own, trackedOfOwner: [{ ...theirSig, token: null }], token: SIGUSD_TOKEN_ID })).toBe("untrusted");
  });
  it("the box that holds the trusted NFT must be a token reserve of this token", () => {
    const held = { box: reserveBox(me, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }] }), height: 1 };
    expect(ownReserve({ owner: me, trusted: { ok: true, nft: NFT }, held, listing: null, token: SIGUSD_TOKEN_ID })).toMatchObject({ ok: true, nft: NFT });
    expect(ownReserve({ owner: me, trusted: { ok: true, nft: NFT }, held, listing: null })).toEqual({ ok: false, why: "none" });
  });
});

describe("request links and watched issuers per denomination", () => {
  const other = keyPairFromSecret(5n).pubHex;
  it("a token request names its denomination; an ERG one is what it was; an unknown one is refused", () => {
    const erg = requestLink("https://x", { to: other, amount: 5n, nft: TRACKER_NFT });
    expect(erg).not.toContain("d=");
    expect(parseRequest(new URL(erg).hash)).toEqual({ to: other, amount: 5n, nft: TRACKER_NFT });
    const sig = requestLink("https://x", { to: other, amount: 250n, nft: TRACKER_NFT, denom: `token:${SIGUSD_TOKEN_ID}` });
    expect(sig).toContain("&d=sigusd");
    expect(parseRequest(new URL(sig).hash)).toEqual({ to: other, amount: 250n, nft: TRACKER_NFT, denom: `token:${SIGUSD_TOKEN_ID}` });
    expect(parseRequest(`#to=${other}&d=dogecoin`)).toBeNull();
  });
  it("a token receipt adds that token to the watched issuer, apart from its ERG receipt", () => {
    const base = { nft: TRACKER_NFT, issuer: other, recipient: me, signature: "ab".repeat(65) };
    let l = watchIssuer([], me, other, { receipt: { ...base, total: 7n, timestamp: 10n }, now: 1 });
    expect(l[0].tokens).toBeUndefined();
    expect(JSON.stringify(l[0])).not.toContain("tokens");
    l = watchIssuer(l, me, other, { receipt: { ...base, total: 300n, timestamp: 20n, denom: `token:${SIGUSD_TOKEN_ID}` } });
    expect(l[0].receipt).toMatchObject({ total: "7" });
    expect(l[0].tokens).toEqual([{ denom: `token:${SIGUSD_TOKEN_ID}`, receipt: { total: "300", timestamp: "20", signature: base.signature } }]);
    // an older token receipt does not replace a newer one
    l = watchIssuer(l, me, other, { receipt: { ...base, total: 100n, timestamp: 15n, denom: `token:${SIGUSD_TOKEN_ID}` } });
    expect(l[0].tokens![0].receipt!.total).toBe("300");
    expect(watchedDenoms(l[0])).toEqual(["erg", `token:${SIGUSD_TOKEN_ID}`]);
    const back = parseWatchStore(JSON.stringify({ [me]: [{ ...l[0], tokens: [...l[0].tokens!, { denom: "token:" + "ee".repeat(32), receipt: null }, { denom: "erg", receipt: null }] }] }));
    expect(back[me][0].tokens).toEqual(l[0].tokens);
  });
});

describe("the most a token redemption takes now (review LOW-3)", () => {
  it("the note's redeemable amount, but never the reserve's last raw unit", () => {
    expect(tokenRedeemMax(300n, 1_000n)).toEqual({ max: 300n, keptOne: false });
    expect(tokenRedeemMax(1_000n, 1_000n)).toEqual({ max: 999n, keptOne: true });
    expect(tokenRedeemMax(999n, 1_000n)).toEqual({ max: 999n, keptOne: false });
    expect(tokenRedeemMax(5n, 1n)).toEqual({ max: 0n, keptOne: true });
    expect(tokenRedeemMax(5n, 0n)).toEqual({ max: 0n, keptOne: true });
    // redemptions waiting for the chain come off first (second review LOW-3)
    expect(tokenRedeemMax(1_000n, 1_000n, 400n)).toEqual({ max: 599n, keptOne: true });
    expect(tokenRedeemMax(300n, 1_000n, 400n)).toEqual({ max: 300n, keptOne: false });
    expect(tokenRedeemMax(300n, 1_000n, 1_000n)).toEqual({ max: 0n, keptOne: true });
    expect(tokenRedeemMax(300n, 1_000n, -5n)).toEqual({ max: 300n, keptOne: false });
  });
});

describe("the Redeem prefill (second review LOW-3)", () => {
  const tok = { token: true, decimals: 2, min: 1n };
  it("fills nothing while a token's cap is unknown", () => {
    expect(redeemPrefill({ ...tok, capMax: null, amountText: "", prefilled: "" })).toBeNull();
  });
  it("fills the cap once known, and follows it while the amount is still the screen's own", () => {
    const first = redeemPrefill({ ...tok, capMax: 999n, amountText: "", prefilled: "" });
    expect(first).toEqual({ amountText: "9.99", prefilled: "9.99" });
    expect(redeemPrefill({ ...tok, capMax: 599n, amountText: "9.99", prefilled: "9.99" })).toEqual({ amountText: "5.99", prefilled: "5.99" });
    expect(redeemPrefill({ ...tok, capMax: 0n, amountText: "5.99", prefilled: "5.99" })).toEqual({ amountText: "", prefilled: "" });
  });
  it("never overwrites a typed amount; ERG keeps its old rule (only an empty field is filled)", () => {
    expect(redeemPrefill({ ...tok, capMax: 599n, amountText: "3", prefilled: "9.99" })).toBeNull();
    const erg = { token: false, decimals: 9, min: 2_000_000n };
    expect(redeemPrefill({ ...erg, capMax: 300_000_000n, amountText: "", prefilled: "" })).toEqual({ amountText: "0.3", prefilled: "0.3" });
    expect(redeemPrefill({ ...erg, capMax: 200_000_000n, amountText: "0.3", prefilled: "0.3" })).toBeNull();
  });
});
