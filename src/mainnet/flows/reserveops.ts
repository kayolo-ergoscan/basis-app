// The reserve's own actions as the wallet plans them (design §9): which boxes pay, the final amounts, and the state a
// reserve is in. The transactions themselves are tx/reserveaction.ts (build, L1, sign); the contract is L2.
//   • top-up: anyone's current reserve of our tracker, never one in refund; ≥ 0.1 ERG; dust goes into the reserve;
//   • refund start: the owner's box pays the 0.001 ERG fee (the reserve's value may not go down); R7 = tip + 10;
//   • refund completion: from HEIGHT ≥ R7 + 43 200; the reserve pays its own fee and goes to the owner's address.
import {
  MIN_BOX_NANOERG, P2PK_MAX_INPUTS, REFUND_START_AHEAD, RESERVE_HARD_CAP_NANOERG, TOP_UP_MIN_NANOERG, buildRefundComplete, buildRefundStart, buildTopUp, refundClock,
  selectCoins, type ErgoBox, type RefundClock, type UnsignedTx,
} from "../tx";
import type { MempoolTx } from "../net";

/** Boxes a reserve action may spend at the wallet's key besides the reserve (one input fewer than a P2PK spend). */
export const RESERVE_ACTION_MAX_INPUTS = P2PK_MAX_INPUTS - 1;

/**
 * The most one top-up may add (D5, the beta caps): to the wallet's own reserve, up to `cap` for the reserve in total; to
 * another key's reserve, `cap` per top-up (the wallet does not cap someone else's reserve). Never above 10 ERG.
 */
export function topUpMax(own: boolean, reserveValue: bigint, cap: bigint): bigint {
  const c = cap > RESERVE_HARD_CAP_NANOERG ? RESERVE_HARD_CAP_NANOERG : cap;
  if (!own) return c;
  const room = c - reserveValue;
  return room > 0n ? room : 0n;
}

export type TopUpPlan =
  | { ok: true; inputs: ErgoBox[]; tx: UnsignedTx; /** what the reserve gains (the amount, plus any dust) */ amount: bigint; change: bigint }
  | { ok: false; why: "amount"; min: bigint; max: bigint }
  | { ok: false; why: "short"; need: bigint; have: bigint }
  | { ok: false; why: "too-many-boxes" }
  | { ok: false; why: "build"; message: string };

/**
 * Coins for a top-up of `amount` (design §9): the wallet's confirmed boxes, change 0 or ≥ 0.001 ERG. Dust below that
 * goes into the reserve; when that would pass `max`, the amount is lowered so that the change is exactly 0.001 ERG.
 */
export function planTopUp(boxes: readonly ErgoBox[], payer: string, reserve: ErgoBox, amount: bigint, fee: bigint, height: number, max: bigint): TopUpPlan {
  if (amount < TOP_UP_MIN_NANOERG || amount > max) return { ok: false, why: "amount", min: TOP_UP_MIN_NANOERG, max };
  const sel = selectCoins(boxes, payer, amount + fee);
  if (!sel) return { ok: false, why: "short", need: amount + fee, have: boxes.reduce((a, b) => a + b.value, 0n) };
  if (sel.inputs.length > RESERVE_ACTION_MAX_INPUTS) return { ok: false, why: "too-many-boxes" };
  const dust = sel.tokens.length === 0 && sel.leftover > 0n && sel.leftover < MIN_BOX_NANOERG ? sel.leftover : 0n;
  let final = amount + dust;
  if (dust > 0n && final > max) {
    final = amount - (MIN_BOX_NANOERG - dust);
    if (final < TOP_UP_MIN_NANOERG) return { ok: false, why: "amount", min: TOP_UP_MIN_NANOERG, max };
  }
  try {
    const tx = buildTopUp({ reserve, payer, inputs: sel.inputs, amount: final, fee, height });
    return { ok: true, inputs: sel.inputs, tx, amount: final, change: sel.leftover + amount - final };
  } catch (e) {
    return { ok: false, why: "build", message: e instanceof Error ? e.message : String(e) };
  }
}

export type RefundStartPlan =
  | { ok: true; inputs: ErgoBox[]; tx: UnsignedTx; refundHeight: bigint; /** dust that goes into the reserve */ add: bigint; change: bigint }
  | { ok: false; why: "short"; need: bigint; have: bigint }
  | { ok: false; why: "too-many-boxes" }
  | { ok: false; why: "build"; message: string };

/** The refund start at `height` (the tip): R7 = tip + 10, the miner fee from the owner's own boxes. */
export function planRefundStart(boxes: readonly ErgoBox[], owner: string, reserve: ErgoBox, fee: bigint, height: number): RefundStartPlan {
  const sel = selectCoins(boxes, owner, fee);
  if (!sel) return { ok: false, why: "short", need: fee, have: boxes.reduce((a, b) => a + b.value, 0n) };
  if (sel.inputs.length > RESERVE_ACTION_MAX_INPUTS) return { ok: false, why: "too-many-boxes" };
  const add = sel.tokens.length === 0 && sel.leftover > 0n && sel.leftover < MIN_BOX_NANOERG ? sel.leftover : 0n;
  const refundHeight = BigInt(height + REFUND_START_AHEAD);
  try {
    const tx = buildRefundStart({ reserve, owner, inputs: sel.inputs, fee, height, refundHeight, add });
    return { ok: true, inputs: sel.inputs, tx, refundHeight, add, change: sel.leftover - add };
  } catch (e) {
    return { ok: false, why: "build", message: e instanceof Error ? e.message : String(e) };
  }
}

export type RefundCompletePlan =
  | { ok: true; tx: UnsignedTx; payout: bigint }
  | { ok: false; why: "no-refund" }
  | { ok: false; why: "waiting"; clock: RefundClock }
  | { ok: false; why: "small" };

/** The completion at `height` (the tip), only once the next block may hold it. */
export function planRefundComplete(owner: string, reserve: ErgoBox, refundHeight: bigint, fee: bigint, height: number): RefundCompletePlan {
  const clock = refundClock(refundHeight, height);
  if (!clock) return { ok: false, why: "no-refund" };
  if (!clock.open) return { ok: false, why: "waiting", clock };
  if (reserve.value - fee < MIN_BOX_NANOERG) return { ok: false, why: "small" };
  return { ok: true, tx: buildRefundComplete({ reserve, owner, fee, height }), payout: reserve.value - fee };
}

/** A pending transaction that already spends `boxId` (the reserve): a second spend would conflict with it. */
export const mempoolSpending = (mempool: readonly MempoolTx[], boxId: string): MempoolTx | null => mempool.find((t) => t.spends.includes(boxId)) ?? null;

/** Blocks → about how many days (720 blocks a day, the contract's own count), rounded up; 0 for none. */
export const blocksToDays = (blocks: number): number => (blocks <= 0 ? 0 : Math.ceil(blocks / 720));

export type ReserveLife =
  | { kind: "active" }
  | { kind: "refund"; clock: RefundClock };

/** Where a reserve stands, from R7 (the chain's or the tracker's) and the tip. */
export function reserveLife(refundHeight: bigint | number, tip: number | null): ReserveLife {
  const r7 = BigInt(refundHeight);
  if (r7 <= 0n) return { kind: "active" };
  const clock = refundClock(r7, tip ?? 0);
  return { kind: "refund", clock: clock! };
}
