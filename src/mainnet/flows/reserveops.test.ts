// Planning the reserve's own actions: top-up coins and caps (D5), dust into the reserve, the refund start's fee box and
// R7 = tip + 10, the completion's clock, and the mempool conflict on the reserve box.
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { MINER_FEE_NANOERG, MIN_BOX_NANOERG, REFUND_PERIOD_BLOCKS, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, checkReserveAction, p2pkTree } from "../tx";
import { p2pkBox, reserveBox } from "../tx/testkit";
import { blocksToDays, linkTarget, mempoolSpending, ownReserve, planRefundComplete, planRefundStart, planTopUp, reserveLife, topUpMax, trackedAs, trackedGate, trustedNft } from "./reserveops";

const FEE = MINER_FEE_NANOERG;
const ERG = 1_000_000_000n;
const TIP = 1_925_000;
const me = keyPairFromSecret(7n).pubHex;
const other = keyPairFromSecret(11n).pubHex;

describe("top-up planning", () => {
  it("caps: the own reserve up to the cap in total; another key's reserve per top-up; never above 10 ERG", () => {
    expect(topUpMax(true, 400_000_000n, RESERVE_DEFAULT_CAP_NANOERG)).toBe(600_000_000n);
    expect(topUpMax(true, 2n * ERG, RESERVE_DEFAULT_CAP_NANOERG)).toBe(0n);
    expect(topUpMax(false, 5n * ERG, RESERVE_DEFAULT_CAP_NANOERG)).toBe(ERG);
    expect(topUpMax(false, 0n, 50n * ERG)).toBe(RESERVE_HARD_CAP_NANOERG);
  });

  const reserve = reserveBox(other, 3n * ERG);
  it("plans coins, change and a transaction that passes L1", () => {
    const boxes = [p2pkBox(me, 150_000_000n, { index: 1 }), p2pkBox(me, 900_000_000n, { index: 2 })];
    const p = planTopUp(boxes, me, reserve, 200_000_000n, FEE, TIP, ERG);
    if (!p.ok) throw new Error(p.why);
    expect(p.inputs.map((b) => b.value)).toEqual([900_000_000n]);
    expect([p.amount, p.change]).toEqual([200_000_000n, 900_000_000n - 200_000_000n - FEE]);
    expect(checkReserveAction(p.tx, [reserve, ...p.inputs], { kind: "topup", signer: me, height: TIP, fee: FEE, amount: p.amount })).toEqual({ ok: true });
  });

  it("puts dust into the reserve, or lowers the amount at the cap so the change is 0.001 ERG", () => {
    const boxes = [p2pkBox(me, 100_000_000n + FEE + 300_000n)];
    const p = planTopUp(boxes, me, reserve, 100_000_000n, FEE, TIP, ERG);
    expect(p.ok && [p.amount, p.change, p.tx.outputs.length]).toEqual([100_300_000n, 0n, 2]);
    const atCap = planTopUp([p2pkBox(me, 150_000_000n + FEE + 300_000n)], me, reserve, 150_000_000n, FEE, TIP, 150_000_000n);
    expect(atCap.ok && [atCap.amount, atCap.change]).toEqual([150_000_000n - (MIN_BOX_NANOERG - 300_000n), MIN_BOX_NANOERG]);
  });

  it("at the cap with dust: one more coin keeps the amount; else 0.001 ERG more is short, never \"between 0.1 and 0.1\"", () => {
    const one = p2pkBox(me, 100_000_000n + FEE + 300_000n, { index: 1 });
    expect(planTopUp([one], me, reserve, 100_000_000n, FEE, TIP, 100_000_000n)).toMatchObject({ ok: false, why: "short", need: 100_000_000n + FEE + MIN_BOX_NANOERG });
    const p = planTopUp([one, p2pkBox(me, 5_000_000n, { index: 2 })], me, reserve, 100_000_000n, FEE, TIP, 100_000_000n);
    if (!p.ok) throw new Error(p.why);
    expect([p.amount, p.change, p.inputs.length]).toEqual([100_000_000n, 5_300_000n, 2]);
    expect(checkReserveAction(p.tx, [reserve, ...p.inputs], { kind: "topup", signer: me, height: TIP, fee: FEE, amount: p.amount })).toEqual({ ok: true });
  });

  it("refuses below 0.1 ERG, above the cap, and more than it has", () => {
    const boxes = [p2pkBox(me, 300_000_000n)];
    expect(planTopUp(boxes, me, reserve, 99_999_999n, FEE, TIP, ERG)).toMatchObject({ ok: false, why: "amount" });
    expect(planTopUp(boxes, me, reserve, 2n * ERG, FEE, TIP, ERG)).toMatchObject({ ok: false, why: "amount", max: ERG });
    expect(planTopUp(boxes, me, reserve, 300_000_000n, FEE, TIP, ERG)).toMatchObject({ ok: false, why: "short", need: 301_000_000n, have: 300_000_000n });
  });

  it("refuses more than 49 boxes (the reserve is the 50th input)", () => {
    const many = Array.from({ length: 60 }, (_, i) => p2pkBox(me, 5_000_000n, { index: i }));
    expect(planTopUp(many, me, reserve, 250_000_000n, FEE, TIP, ERG)).toMatchObject({ ok: false, why: "too-many-boxes" });
  });
});

describe("refund start planning", () => {
  const reserve = reserveBox(me, 600_000_000n);
  it("pays the fee from the owner's largest box and sets R7 = tip + 10", () => {
    const p = planRefundStart([p2pkBox(me, 5_000_000n, { index: 1 }), p2pkBox(me, 40_000_000n, { index: 2 })], me, reserve, FEE, TIP);
    if (!p.ok) throw new Error(p.why);
    expect(p.refundHeight).toBe(BigInt(TIP + 10));
    expect(p.inputs.map((b) => b.value)).toEqual([40_000_000n]);
    expect(p.tx.outputs.map((o) => o.value)).toEqual([600_000_000n, 39_000_000n, FEE]);
    expect(p.tx.outputs[1].ergoTree).toBe(p2pkTree(me));
    expect(checkReserveAction(p.tx, [reserve, ...p.inputs], { kind: "refund-start", signer: me, height: TIP, fee: FEE, refundHeight: p.refundHeight })).toEqual({ ok: true });
  });

  it("dust goes into the reserve; no free ERG at the key is a plain refusal", () => {
    const p = planRefundStart([p2pkBox(me, FEE + 200_000n)], me, reserve, FEE, TIP);
    expect(p.ok && [p.add, p.change, p.tx.outputs[0].value]).toEqual([200_000n, 0n, 600_200_000n]);
    expect(planRefundStart([], me, reserve, FEE, TIP)).toMatchObject({ ok: false, why: "short", need: FEE });
  });
});

describe("refund completion planning", () => {
  const r7 = 1_900_000n;
  const reserve = reserveBox(me, 600_000_000n, { r7 });
  it("waits until the next block may hold it, then pays everything less the fee to the owner", () => {
    const early = planRefundComplete(me, reserve, r7, FEE, Number(r7) + 1000);
    expect(early).toMatchObject({ ok: false, why: "waiting", clock: { blocksLeft: REFUND_PERIOD_BLOCKS - 1001 } });
    const p = planRefundComplete(me, reserve, r7, FEE, Number(r7) + REFUND_PERIOD_BLOCKS - 1);
    expect(p.ok && p.payout).toBe(600_000_000n - FEE);
    expect(planRefundComplete(me, reserveBox(me, 600_000_000n), 0n, FEE, TIP)).toEqual({ ok: false, why: "no-refund" });
    expect(planRefundComplete(me, reserveBox(me, FEE + 1n, { r7 }), r7, FEE, Number(r7) + REFUND_PERIOD_BLOCKS)).toEqual({ ok: false, why: "small" });
  });

  it("states and days: active, refund waiting, refund open; 43 200 blocks are 60 days", () => {
    expect(reserveLife(0, TIP)).toEqual({ kind: "active" });
    expect(reserveLife(Number(r7), Number(r7))).toMatchObject({ kind: "refund", clock: { open: false, unlockAt: r7 + 43_200n } });
    expect(reserveLife(r7, Number(r7) + 43_199)).toMatchObject({ kind: "refund", clock: { open: true, blocksLeft: 0 } });
    expect([blocksToDays(43_200), blocksToDays(721), blocksToDays(1), blocksToDays(0)]).toEqual([60, 2, 1, 0]);
  });

  it("finds a pending transaction that spends the reserve box", () => {
    const tx = { id: "ab".repeat(32), spends: [reserve.boxId], outputs: [] };
    expect(mempoolSpending([tx], reserve.boxId)).toBe(tx);
    expect(mempoolSpending([tx], "cd".repeat(32))).toBeNull();
  });
});

describe("which reserve is the key's own (review 2: planted boxes; re-review P1-1/2: minted by the owner, exact lookup)", () => {
  const NFT = "9f".repeat(32);
  const PLANT = "8a".repeat(32);
  const ub = (nft: string, owner = me, height = 1_924_000) => ({ box: reserveBox(owner, 2n * ERG, { nft }), height });
  const real = ub(NFT, me, 1_923_000);
  const planted = ub(PLANT, me, 1_924_900); // newer: /v1 lists it first
  // genuine: the owner minted it (the box with id = NFT sat at the owner's P2PK); the tracker can name a planted one
  const tr = (nft: string, owner = me, genuine = true) => ({ box: `b${nft.slice(1)}`, owner, nft, token: null, genuine });
  const own = (t1Nft: string | null, tracked: ReturnType<typeof tr>[] | null, held: typeof real | null, boxes: (typeof real)[] | null = null) =>
    ownReserve({ owner: me, trusted: trustedNft({ owner: me, t1Nft, tracked }), held, listing: boxes && { boxes } });

  it("trusts this wallet's T1 always, else the one tracked reserve this key minted", () => {
    expect(trustedNft({ owner: me, t1Nft: NFT, tracked: null })).toEqual({ ok: true, nft: NFT });
    expect(trustedNft({ owner: me, t1Nft: NFT, tracked: [] })).toEqual({ ok: true, nft: NFT });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [tr(NFT)] })).toEqual({ ok: true, nft: NFT });
    // with a T1: it must be among the genuine NFTs the tracker names, not "exactly" it
    expect(trustedNft({ owner: me, t1Nft: NFT, tracked: [tr(NFT), tr(PLANT)] })).toEqual({ ok: true, nft: NFT });
    expect(trustedNft({ owner: me, t1Nft: NFT, tracked: [tr(PLANT)] })).toMatchObject({ ok: false, why: "disagree", tracker: [PLANT] });
    // a planted box the tracker was made to name: dropped, so it neither replaces nor contradicts the T1
    expect(trustedNft({ owner: me, t1Nft: NFT, tracked: [tr(PLANT, me, false)] })).toEqual({ ok: true, nft: NFT });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [tr(PLANT, me, false), tr(NFT)] })).toEqual({ ok: true, nft: NFT });
  });

  it("refuses what it cannot prove: nothing named, several genuine, only unproven names, the tracker unread", () => {
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [] })).toEqual({ ok: false, why: "none" });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [tr(NFT, other)] })).toEqual({ ok: false, why: "none" });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: null })).toEqual({ ok: false, why: "untrusted" });
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [tr(NFT), tr(PLANT)] })).toEqual({ ok: false, why: "untrusted" });
    // P minted from the attacker's box with R4 = victim, named by the tracker: refused in words
    expect(trustedNft({ owner: me, t1Nft: null, tracked: [tr(PLANT, me, false)] })).toEqual({ ok: false, why: "unproven" });
    expect(own(null, [tr(PLANT, me, false)], planted, [planted])).toEqual({ ok: false, why: "unproven" });
  });

  it("takes the box the exact lookup finds, checked; the listing only for the warning", () => {
    expect(own(NFT, null, real)).toMatchObject({ ok: true, nft: NFT, others: [] });
    expect(own(null, [tr(NFT)], real, [real])).toMatchObject({ ok: true, nft: NFT, others: [] });
    // a flooded listing (incomplete, or not read at all) does not matter: never a block
    expect(own(NFT, null, real, null)).toMatchObject({ ok: true });
    expect(own(NFT, [tr(NFT)], real, [planted, planted])).toMatchObject({ ok: true, others: [planted] });
    // the NFT in no unspent box (the T1 not in a block yet), or out of the reserve contract (a completed refund)
    expect(own(NFT, null, null, [planted])).toEqual({ ok: false, why: "none" });
    const paidOut = { box: { ...real.box, ergoTree: p2pkTree(me) }, height: 1_925_000 };
    expect(own(NFT, null, paidOut)).toEqual({ ok: false, why: "none" });
    // under the contract but another owner's (or another tracker's): never "yours"
    const theirs = ub(NFT, other);
    expect(own(NFT, null, theirs)).toMatchObject({ ok: false, why: "mismatch", nft: NFT });
    const otherTracker = { box: reserveBox(me, 2n * ERG, { nft: NFT, r6: `0e20${"77".repeat(32)}` }), height: 1 };
    expect(own(NFT, null, otherTracker)).toMatchObject({ ok: false, why: "mismatch" });
  });

  it("a planted box next to the real one: the real one, and the planted one listed as a warning; never boxes[0]", () => {
    const r = own(NFT, [tr(NFT)], real, [planted, real]);
    if (!r.ok) throw new Error(r.why);
    expect(r.box).toBe(real);
    expect(r.others).toEqual([planted]);
    const byTracker = own(null, [tr(NFT), tr(PLANT, me, false)], real, [planted, real, planted]);
    expect(byTracker.ok && [byTracker.box, byTracker.others]).toEqual([real, [planted]]);
  });

  it("a ?nft= link: this key's own only when trusted; another key's only when our tracker tracks it and the owner minted it", () => {
    const mine = own(NFT, null, real);
    expect(linkTarget({ me, nft: NFT, owner: me, own: mine, trackedOfOwner: null })).toBe("own");
    // a planted box with R4 = this key, linked directly
    expect(linkTarget({ me, nft: PLANT, owner: me, own: mine, trackedOfOwner: null })).toBe("untrusted");
    // the real one stays linkable next to a planted one; the planted one is not
    const both = own(NFT, null, real, [planted, real]);
    expect(linkTarget({ me, nft: NFT, owner: me, own: both, trackedOfOwner: null })).toBe("own");
    expect(linkTarget({ me, nft: PLANT, owner: me, own: both, trackedOfOwner: null })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: me, own: own(null, [tr(PLANT, me, false)], planted), trackedOfOwner: null })).toBe("unproven");
    // another key: a box planted with R4 = Alice is not her reserve until the tracker says so and she minted it
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: [tr(NFT, other)] })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: null })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: [tr(PLANT, me)] })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: [{ box: "b1".repeat(32), owner: other, nft: PLANT, token: "11".repeat(32), genuine: true }] })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: [tr(PLANT, other)] })).toBe("other");
    expect(trackedAs(other, PLANT, [tr(PLANT, other)])).toBe(true);
    // the tracker names it, but Alice did not mint it (an attacker's box with R4 = Alice): refused, in words
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: [tr(PLANT, other, false)] })).toBe("unproven");
    expect(trackedAs(other, PLANT, [tr(PLANT, other, false)])).toBe(false);
    // ... and it does not count as her second reserve either
    expect(linkTarget({ me, nft: NFT, owner: other, own: mine, trackedOfOwner: [tr(NFT, other), tr(PLANT, other, false)] })).toBe("other");
    // the tracker follows two genuine ERG reserves of that owner: not picked
    expect(linkTarget({ me, nft: PLANT, owner: other, own: mine, trackedOfOwner: [tr(PLANT, other), tr(NFT, other)] })).toBe("untrusted");
    expect(trackedAs(other, PLANT, [tr(PLANT, other), tr(PLANT, other), tr(NFT, me)])).toBe(true);
  });
});

describe("whether a T1 may be made, as far as the tracker goes (wallet-t3 P2: one rule for the screen and prepare)", () => {
  const BOX = "b9".repeat(32), PBOX = "ba".repeat(32), TBOX = "bb".repeat(32);
  const entry = (box: string, owner = me, token: string | null = null) => ({ box, owner, token, collateral: 2n * ERG });
  const ref = (box: string, genuine: boolean, owner = me, token: string | null = null) => ({ box, owner, nft: `9${box.slice(1)}`, token, genuine });

  it("no ERG reserve of this key listed: nothing stops it (another key's, a token reserve)", () => {
    expect(trackedGate(me, [], [])).toEqual({ k: "none" });
    expect(trackedGate(me, [entry(BOX, other)], [ref(BOX, true, other)])).toEqual({ k: "none" });
    expect(trackedGate(me, [entry(TBOX, me, "11".repeat(32))], [ref(TBOX, true, me, "11".repeat(32))])).toEqual({ k: "none" });
  });

  it("this key's own (it minted the NFT): shown as its reserve, and a T1 stops", () => {
    expect(trackedGate(me, [entry(BOX)], [ref(BOX, true)])).toEqual({ k: "own", r: entry(BOX) });
    // next to a planted one, listed first: still the own one
    expect(trackedGate(me, [entry(PBOX), entry(BOX)], [ref(PBOX, false), ref(BOX, true)])).toEqual({ k: "own", r: entry(BOX) });
  });

  it("a listed ERG reserve this key did not mint, or one the wallet cannot read: unproven, and a T1 stops all the same", () => {
    // the planted look-alike the tracker was made to name, or a reserve a sponsor funded for this key
    expect(trackedGate(me, [entry(PBOX)], [ref(PBOX, false)])).toEqual({ k: "unproven", rs: [entry(PBOX)] });
    // a box trackedRefs could not read as this key's reserve (no ref at all): never let through
    expect(trackedGate(me, [entry(PBOX)], [])).toEqual({ k: "unproven", rs: [entry(PBOX)] });
    // a genuine ref of another box, another owner or a token reserve does not prove this entry
    expect(trackedGate(me, [entry(PBOX)], [ref(BOX, true)])).toMatchObject({ k: "unproven" });
    expect(trackedGate(me, [entry(PBOX)], [ref(PBOX, true, other)])).toMatchObject({ k: "unproven" });
    expect(trackedGate(me, [entry(PBOX), entry(TBOX, me, "11".repeat(32))], [ref(PBOX, true, me, "11".repeat(32))])).toEqual({ k: "unproven", rs: [entry(PBOX)] });
  });
});
