// Planning the reserve's own actions: top-up coins and caps (D5), dust into the reserve, the refund start's fee box and
// R7 = tip + 10, the completion's clock, and the mempool conflict on the reserve box.
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { MINER_FEE_NANOERG, MIN_BOX_NANOERG, REFUND_PERIOD_BLOCKS, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, checkReserveAction, p2pkTree } from "../tx";
import { p2pkBox, reserveBox } from "../tx/testkit";
import { blocksToDays, mempoolSpending, planRefundComplete, planRefundStart, planTopUp, reserveLife, topUpMax } from "./reserveops";

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
