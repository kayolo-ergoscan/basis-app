// Planning the reserve's own actions: top-up coins and caps (D5), dust into the reserve, the refund start's fee box and
// R7 = tip + 10, the completion's clock, and the mempool conflict on the reserve box.
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { MINER_FEE_NANOERG, MIN_BOX_NANOERG, REFUND_PERIOD_BLOCKS, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, checkReserveAction, p2pkTree } from "../tx";
import { p2pkBox, reserveBox } from "../tx/testkit";
import { blocksToDays, linkTarget, mempoolSpending, ownReserve, planRefundComplete, planRefundStart, planTopUp, reserveLife, topUpMax, trackedAs } from "./reserveops";

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

describe("which reserve is the key's own (review 2: planted boxes)", () => {
  const NFT = "9f".repeat(32);
  const PLANT = "8a".repeat(32);
  const ub = (nft: string, owner = me, height = 1_924_000) => ({ box: reserveBox(owner, 2n * ERG, { nft }), height });
  const real = ub(NFT, me, 1_923_000);
  const planted = ub(PLANT, me, 1_924_900); // newer: /v1 lists it first
  const tr = (nft: string, owner = me) => ({ owner, nft, token: null });

  it("takes the one box that holds the NFT of this wallet's T1 or of the tracker's reserve", () => {
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: NFT, tracked: null })).toMatchObject({ ok: true, nft: NFT });
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: null, tracked: [tr(NFT)] })).toMatchObject({ ok: true, nft: NFT });
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: NFT, tracked: [tr(NFT)] })).toMatchObject({ ok: true });
    // the tracker may not list a fresh reserve yet: the T1 alone is enough
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: NFT, tracked: [] })).toMatchObject({ ok: true });
  });

  it("refuses a planted box: newest first, alone, or next to the real one; never boxes[0]", () => {
    expect(ownReserve({ owner: me, chain: { boxes: [planted, real], complete: true }, t1Nft: NFT, tracked: [tr(NFT)] })).toMatchObject({ ok: false, why: "several" });
    expect(ownReserve({ owner: me, chain: { boxes: [planted], complete: true }, t1Nft: NFT, tracked: null })).toMatchObject({ ok: false, why: "mismatch", nft: NFT });
    // no trusted NFT at all (a wallet restored elsewhere, the tracker silent): refused, not guessed
    expect(ownReserve({ owner: me, chain: { boxes: [planted], complete: true }, t1Nft: null, tracked: null })).toMatchObject({ ok: false, why: "untrusted" });
    expect(ownReserve({ owner: me, chain: { boxes: [planted], complete: true }, t1Nft: null, tracked: [] })).toMatchObject({ ok: false, why: "untrusted" });
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: null, tracked: [tr(NFT), tr(PLANT)] })).toMatchObject({ ok: false, why: "untrusted" });
    // the T1 and the tracker disagree
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: NFT, tracked: [tr(PLANT)] })).toMatchObject({ ok: false, why: "disagree" });
    // another owner's entries in the tracker's answer do not count
    expect(ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: null, tracked: [tr(NFT, other)] })).toMatchObject({ ok: false, why: "untrusted" });
    expect(ownReserve({ owner: me, chain: { boxes: [], complete: false }, t1Nft: NFT, tracked: null })).toMatchObject({ ok: false, why: "incomplete" });
    expect(ownReserve({ owner: me, chain: { boxes: [], complete: true }, t1Nft: NFT, tracked: null })).toMatchObject({ ok: false, why: "none" });
  });

  it("a ?nft= link: this key's own only when trusted; another key's only when our tracker tracks it as that owner's", () => {
    const own = ownReserve({ owner: me, chain: { boxes: [real], complete: true }, t1Nft: NFT, tracked: null });
    expect(linkTarget({ me, nft: NFT, owner: me, own, trackedOfOwner: null })).toBe("own");
    // a planted box with R4 = this key, linked directly
    expect(linkTarget({ me, nft: PLANT, owner: me, own, trackedOfOwner: null })).toBe("untrusted");
    const several = ownReserve({ owner: me, chain: { boxes: [planted, real], complete: true }, t1Nft: NFT, tracked: null });
    expect(linkTarget({ me, nft: NFT, owner: me, own: several, trackedOfOwner: null })).toBe("untrusted");
    // another key: a box planted with R4 = Alice is not her reserve until the tracker says so
    expect(linkTarget({ me, nft: PLANT, owner: other, own, trackedOfOwner: [tr(NFT, other)] })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own, trackedOfOwner: null })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own, trackedOfOwner: [tr(PLANT, me)] })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own, trackedOfOwner: [{ owner: other, nft: PLANT, token: "11".repeat(32) }] })).toBe("untrusted");
    expect(linkTarget({ me, nft: PLANT, owner: other, own, trackedOfOwner: [tr(PLANT, other)] })).toBe("other");
    expect(trackedAs(other, PLANT, [tr(PLANT, other)])).toBe(true);
  });
});
