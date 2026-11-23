// The reserve's own actions as the wallet plans them (design §9): which boxes pay, the final amounts, and the state a
// reserve is in. The transactions themselves are tx/reserveaction.ts (build, L1, sign); the contract is L2.
//   • top-up: anyone's current reserve of our tracker, never one in refund; ≥ 0.1 ERG; dust goes into the reserve;
//   • refund start: the owner's box pays the 0.001 ERG fee (the reserve's value may not go down); R7 = tip + 10;
//   • refund completion: from HEIGHT ≥ R7 + 43 200; the reserve pays its own fee and goes to the owner's address.
import {
  MIN_BOX_NANOERG, P2PK_MAX_INPUTS, REFUND_START_AHEAD, RESERVE_HARD_CAP_NANOERG, RESERVE_TREE_HEX, TOP_UP_MIN_NANOERG, buildRefundComplete, buildRefundStart, buildTopUp,
  readReserve, refundClock, selectCoins, type ErgoBox, type RefundClock, type UnsignedTx,
} from "../tx";
import type { MempoolTx, UnspentBox } from "../net";

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
  let use = sel;
  const dust = sel.tokens.length === 0 && sel.leftover > 0n && sel.leftover < MIN_BOX_NANOERG ? sel.leftover : 0n;
  let final = amount + dust;
  if (dust > 0n && final > max) {
    // at the cap the dust cannot go into the reserve: first one more coin, so the change is a real box and the amount
    // stays; else a lower amount (change exactly 0.001 ERG), never below 0.1 ERG: then 0.001 ERG more is what is short
    const more = selectCoins(boxes, payer, amount + fee + MIN_BOX_NANOERG);
    if (more && more.inputs.length <= RESERVE_ACTION_MAX_INPUTS) {
      use = more;
      final = amount;
    } else {
      final = amount - (MIN_BOX_NANOERG - dust);
      if (final < TOP_UP_MIN_NANOERG) return { ok: false, why: "short", need: amount + fee + MIN_BOX_NANOERG, have: boxes.reduce((a, b) => a + b.value, 0n) };
    }
  }
  const change = use.inputs.reduce((a, b) => a + b.value, 0n) - final - fee;
  try {
    const tx = buildTopUp({ reserve, payer, inputs: use.inputs, amount: final, fee, height });
    return { ok: true, inputs: use.inputs, tx, amount: final, change };
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

// ─── which reserve is this key's own ──────────────────────────────────────────────────────────────

/** One reserve the tracker follows, by its reserve NFT. The tracker's /reserves entry names a box (its `nft` field is
 *  the tracker's own NFT): the wallet reads the reserve NFT from that box (features/wallet/mainnet/data.ts trackedRefs).
 *  `genuine`: the NFT was minted by its owner, i.e. the box whose id is the NFT id sat at the owner's P2PK (a token id
 *  is the id of the minting transaction's first input). The tracker can be made to name a planted box (re-review P1-1):
 *  only a genuine NFT is believed. */
export interface TrackedRef { owner: string; nft: string; token: string | null; genuine: boolean }

/** The NFT of this key's reserve as the wallet trusts it (trustedNft); the refusals are OwnReserve's. */
export type TrustedNft =
  | { ok: true; nft: string }
  /** none: no T1 here and the tracker follows no reserve of this key; untrusted: no T1 and the tracker is not read, or
   *  it follows several genuine reserves of this key; unproven: it names reserves, none minted by this key */
  | { ok: false; why: "none" | "untrusted" | "unproven" }
  /** this wallet's T1 NFT is not among the genuine reserves the tracker follows for this key */
  | { ok: false; why: "disagree"; t1: string; tracker: string[] };

export type OwnReserve =
  /** `others`: reserve-tree boxes at the key (the best-effort listing) other than the reserve; ignored for signing,
   *  shown as a warning */
  | { ok: true; box: UnspentBox; nft: string; others: UnspentBox[] }
  | Exclude<TrustedNft, { ok: true }>
  /** the box holding the trusted NFT is under the reserve contract but not this key's reserve of our tracker */
  | { ok: false; why: "mismatch"; boxes: UnspentBox[]; nft: string };

/**
 * Which NFT is this key's reserve (re-review P1-1): its own T1's always (the NFT id is the T1's first input, a box of
 * this key); otherwise the one reserve the tracker follows for this key whose NFT this key minted. Tracker entries
 * that fail that check are dropped; with a T1, the T1 NFT must be among the remaining ones (when there are any).
 */
export function trustedNft(o: { owner: string; t1Nft: string | null; tracked: readonly TrackedRef[] | null }): TrustedNft {
  const named = o.tracked === null ? null : o.tracked.filter((r) => r.owner === o.owner && r.token === null);
  const proven = named === null ? null : [...new Set(named.filter((r) => r.genuine).map((r) => r.nft))];
  if (o.t1Nft) {
    if (proven && proven.length > 0 && !proven.includes(o.t1Nft)) return { ok: false, why: "disagree", t1: o.t1Nft, tracker: proven };
    return { ok: true, nft: o.t1Nft };
  }
  if (named === null || proven === null) return { ok: false, why: "untrusted" };
  if (proven.length === 1) return { ok: true, nft: proven[0] };
  if (proven.length > 1) return { ok: false, why: "untrusted" };
  return { ok: false, why: named.length > 0 ? "unproven" : "none" };
}

/**
 * The key's own reserve, never a planted one (review 2, P1; the coordinator's decision; re-review P1-1/P1-2). The NFT
 * comes from what this wallet trusts (trustedNft); the reserve is the one unspent box that holds it, found by an exact
 * lookup by token (`held`, reserveByNft), never in the global listing, which anyone can flood: it must be under the
 * reserve contract with R4 = this key and R6 = our tracker. The listing of reserve boxes at the key (`listing`, best
 * effort, may be incomplete or missing) only feeds the warning about other boxes: it never blocks.
 */
export function ownReserve(o: { owner: string; trusted: TrustedNft; held: UnspentBox | null; listing: { boxes: readonly UnspentBox[] } | null }): OwnReserve {
  if (!o.trusted.ok) return o.trusted;
  const nft = o.trusted.nft;
  // the NFT in no unspent box (the T1 is not in a block yet), or out of the reserve contract (a completed refund)
  if (!o.held || o.held.box.ergoTree !== RESERVE_TREE_HEX) return { ok: false, why: "none" };
  const r = readReserve(o.held.box);
  if (!r.ok || r.info.owner !== o.owner || r.info.nft !== nft) return { ok: false, why: "mismatch", boxes: [o.held], nft };
  const seen = new Set([o.held.box.boxId]);
  const others: UnspentBox[] = [];
  for (const u of o.listing?.boxes ?? []) if (!seen.has(u.box.boxId)) { seen.add(u.box.boxId); others.push(u); }
  return { ok: true, box: o.held, nft, others };
}

/**
 * Another key's reserve is topped up only when our tracker tracks this NFT as that owner's ERG reserve, as its only
 * genuine one (minted by that owner: TrackedRef.genuine): if the tracker follows a second genuine box with R4 = that
 * owner, the wallet does not pick between them; entries the owner did not mint are not counted.
 */
export function trackedAs(owner: string, nft: string, tracked: readonly TrackedRef[] | null): boolean {
  if (!tracked) return false;
  const theirs = new Set(tracked.filter((r) => r.owner === owner && r.token === null && r.genuine).map((r) => r.nft));
  return theirs.size === 1 && theirs.has(nft);
}

/** The tracker names this NFT as the owner's reserve, but the owner did not mint it (re-review P1-1). */
export function namedUnproven(owner: string, nft: string, tracked: readonly TrackedRef[] | null): boolean {
  return !!tracked && tracked.some((r) => r.owner === owner && r.nft === nft && !r.genuine);
}

/**
 * A `?nft=` link's reserve (the observatory's Top up key): this key's own only when it is the trusted one (ownReserve),
 * another key's only when our tracker tracks it as that owner's and that owner minted it. "unproven": the tracker
 * names it, the owner did not mint it; "untrusted": refuse.
 */
export function linkTarget(o: { me: string; nft: string; owner: string; own: OwnReserve; trackedOfOwner: readonly TrackedRef[] | null }): "own" | "other" | "untrusted" | "unproven" {
  if (o.owner === o.me) return o.own.ok && o.own.nft === o.nft ? "own" : !o.own.ok && o.own.why === "unproven" ? "unproven" : "untrusted";
  if (trackedAs(o.owner, o.nft, o.trackedOfOwner)) return "other";
  return namedUnproven(o.owner, o.nft, o.trackedOfOwner) ? "unproven" : "untrusted";
}
