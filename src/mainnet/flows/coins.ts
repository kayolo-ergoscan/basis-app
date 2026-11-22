// The free ERG at the wallet's key, and the P2PK spends built from it: T1 (the reserve), Withdraw, and "Combine small
// boxes" (a Withdraw to the key's own address when a spend needs more than P2PK_MAX_INPUTS boxes, tx README). Boxes
// are confirmed and unspent per /v1; boxes that an open journal entry or a mempool transaction spends are left out.
import {
  MINER_FEE_NANOERG, MIN_BOX_NANOERG, P2PK_MAX_INPUTS, RESERVE_HARD_CAP_NANOERG, RESERVE_MIN_NANOERG, RESERVE_TREE_HEX, buildWithdraw, mergedTokens,
  parseAddress, planReserveCreation, selectCoins, treeOfAddress, FEE_TREE_HEX, type ErgoBox, type ReservePlan, type UnsignedTx,
} from "../tx";
import type { MempoolTx, UnspentBox } from "../net";

export interface Balance {
  /** Confirmed, spendable nanoERG (token boxes included). */
  nano: bigint;
  /** Of which in token-free boxes. */
  free: bigint;
  boxes: number;
  /** Boxes that carry tokens (their tokens always stay at the key). */
  tokenBoxes: number;
  /** Spent by an open journal entry or a mempool transaction: not counted. */
  inFlight: number;
}

/** The confirmed boxes no open journal entry and no mempool transaction spends. */
export function spendable(list: readonly UnspentBox[], inFlight: ReadonlySet<string>, mempool: readonly MempoolTx[] = []): ErgoBox[] {
  const busy = new Set<string>(inFlight);
  for (const tx of mempool) for (const id of tx.spends) busy.add(id);
  return list.filter((u) => u.height !== null && !busy.has(u.box.boxId)).map((u) => u.box);
}

export function balanceOf(list: readonly UnspentBox[], usable: readonly ErgoBox[]): Balance {
  const ids = new Set(usable.map((b) => b.boxId));
  let nano = 0n, free = 0n, tokenBoxes = 0;
  for (const b of usable) {
    nano += b.value;
    if (b.tokens.length) tokenBoxes++; else free += b.value;
  }
  return { nano, free, boxes: usable.length, tokenBoxes, inFlight: list.filter((u) => !ids.has(u.box.boxId)).length };
}

/** What one T1 needs at the key: the reserve plus the miner fee. */
export const t1Need = (amount: bigint, fee: bigint = MINER_FEE_NANOERG): bigint => amount + fee;

export type T1Plan =
  | { ok: true; plan: ReservePlan }
  | { ok: false; why: "short"; need: bigint; have: bigint }
  | { ok: false; why: "too-many-boxes"; inputs: number }
  | { ok: false; why: "amount"; min: bigint; max: bigint };

/** Coins and the final amount for a reserve of `amount` (design §2.2), or why not. */
export function planT1(boxes: readonly ErgoBox[], owner: string, amount: bigint, fee: bigint, cap: bigint): T1Plan {
  if (cap > RESERVE_HARD_CAP_NANOERG) cap = RESERVE_HARD_CAP_NANOERG;
  if (amount < RESERVE_MIN_NANOERG || amount > cap) return { ok: false, why: "amount", min: RESERVE_MIN_NANOERG, max: cap };
  const plan = planReserveCreation(boxes, owner, amount, fee, cap);
  if (!plan) {
    const have = boxes.reduce((a, b) => a + b.value, 0n);
    return { ok: false, why: "short", need: amount + fee, have };
  }
  if (plan.inputs.length > P2PK_MAX_INPUTS) return { ok: false, why: "too-many-boxes", inputs: plan.inputs.length };
  return { ok: true, plan };
}

/** `POST /reserves/create` for this plan (the final amount, the NFT id = the first input's box id). */
export const t1CreateBody = (plan: ReservePlan, owner: string): string =>
  `{"nft_id":"${plan.nftId}","owner_pubkey":"${owner}","erg_amount":${plan.amount}}`;

/** A pending transaction in the mempool that creates a box under the reserve contract (T1 precheck, §2.2). */
export const mempoolCreatesReserve = (mempool: readonly MempoolTx[]): MempoolTx | null =>
  mempool.find((tx) => tx.outputs.some((o) => o.ergoTree === RESERVE_TREE_HEX)) ?? null;

// ─── Withdraw ───────────────────────────────────────────────────────────────────────────────────

export type DestinationRefusal = "format" | "checksum" | "network" | "type" | "reserve" | "fee" | "own";

/** A destination the wallet sends to: a mainnet P2PK or P2S address that is not a Basis reserve or the fee contract. */
export function checkDestination(address: string, own?: string): { ok: true; tree: string; p2pk: boolean } | { ok: false; reason: DestinationRefusal } {
  const a = address.trim();
  if (!a) return { ok: false, reason: "format" };
  let p;
  try { p = parseAddress(a); } catch (e) {
    const r = (e as { reason?: string }).reason;
    return { ok: false, reason: r === "checksum" ? "checksum" : r === "network" ? "network" : r === "type" ? "type" : "format" };
  }
  if (p.network !== "mainnet") return { ok: false, reason: "network" };
  if (p.type !== "P2PK" && p.type !== "P2S") return { ok: false, reason: "type" };
  let tree: string;
  try { tree = treeOfAddress(a); } catch { return { ok: false, reason: "format" }; }
  if (tree === RESERVE_TREE_HEX) return { ok: false, reason: "reserve" };
  if (tree === FEE_TREE_HEX) return { ok: false, reason: "fee" };
  if (own && a === own) return { ok: false, reason: "own" };
  return { ok: true, tree, p2pk: p.type === "P2PK" };
}

/** The most a Withdraw can send: every token-free box, less the fee (token boxes stay, with their tokens). */
export function maxWithdraw(boxes: readonly ErgoBox[], fee: bigint = MINER_FEE_NANOERG): bigint {
  const free = boxes.filter((b) => b.tokens.length === 0);
  const n = Math.min(free.length, P2PK_MAX_INPUTS);
  const sum = [...free].sort((a, b) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1)).slice(0, n).reduce((a, b) => a + b.value, 0n);
  const v = sum - fee;
  return v >= MIN_BOX_NANOERG ? v : 0n;
}

export type WithdrawPlan =
  | { ok: true; inputs: ErgoBox[]; tx: UnsignedTx; change: bigint; /** what the destination gets (the amount, plus any dust) */ sent: bigint }
  | { ok: false; why: "short" | "too-many-boxes" | "dust" | "build"; message?: string };

export function planWithdraw(boxes: readonly ErgoBox[], owner: string, to: string, amount: bigint, fee: bigint, height: number): WithdrawPlan {
  if (amount < MIN_BOX_NANOERG) return { ok: false, why: "dust" };
  const sel = selectCoins(boxes, owner, amount + fee);
  if (!sel) return { ok: false, why: "short" };
  if (sel.inputs.length > P2PK_MAX_INPUTS) return { ok: false, why: "too-many-boxes" };
  // change below 0.001 ERG goes to the destination, never to the miner
  const dust = sel.tokens.length === 0 && sel.leftover > 0n && sel.leftover < MIN_BOX_NANOERG ? sel.leftover : 0n;
  try {
    const tx = buildWithdraw({ owner, inputs: sel.inputs, to, amount: amount + dust, fee, height });
    return { ok: true, inputs: sel.inputs, tx, change: sel.leftover - dust, sent: amount + dust };
  } catch (e) {
    return { ok: false, why: "build", message: e instanceof Error ? e.message : String(e) };
  }
}

/** "Combine small boxes": the smallest token-free boxes, up to P2PK_MAX_INPUTS, into one box at the key's own address. */
export function planCombine(boxes: readonly ErgoBox[], owner: string, ownAddress: string, height: number, fee: bigint = MINER_FEE_NANOERG): WithdrawPlan & { count?: number } {
  const small = boxes.filter((b) => b.tokens.length === 0).sort((a, b) => (a.value === b.value ? 0 : a.value < b.value ? -1 : 1)).slice(0, P2PK_MAX_INPUTS);
  if (small.length < 2) return { ok: false, why: "short" };
  const sum = small.reduce((a, b) => a + b.value, 0n);
  if (sum - fee < MIN_BOX_NANOERG) return { ok: false, why: "dust" };
  try {
    const tx = buildWithdraw({ owner, inputs: small, to: ownAddress, amount: sum - fee, fee, height });
    return { ok: true, inputs: small, tx, change: 0n, sent: sum - fee, count: small.length };
  } catch (e) {
    return { ok: false, why: "build", message: e instanceof Error ? e.message : String(e) };
  }
}

/** True for the signer's "spend fewer boxes" refusal (above the 16 KB broadcast limit): offer Combine, not an error. */
export const isBroadcastLimit = (e: unknown): boolean => e instanceof Error && /broadcast limit/.test(e.message);

export { mergedTokens };
