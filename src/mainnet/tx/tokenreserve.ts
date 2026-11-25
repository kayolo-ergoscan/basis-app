// T1 for a token reserve (basis-token.es): the same pipeline and the same checks as the ERG T1 (p2pk.ts), with the
// token's own layout. The tracker answers POST /reserves/create with `token_id` and `token_amount` (api.rs
// create_reserve) by a payload for the token contract; the wallet builds the transaction from its own boxes:
//
//   T1 (token): [reserve(ergValue, [NFT = inputs[0].boxId × 1, token × amount], R4 owner, R5 empty, R6 our NFT, R7 0),
//                change to P2PK(owner) with every other token and the rest of the token, if any, miner fee]
//
// ergValue = TOKEN_RESERVE_BOX_NANOERG (0.002 ERG), plus any ERG dust below 0.001 ERG when no change box is left
// (dust never goes to the miner). Every token of the spent boxes goes to the change except `amount` of the reserve
// token: nothing is burned, nothing but the NFT is minted.
import { parseAddress, treeOfAddress } from "./address";
import { FEE_TREE_HEX, MIN_BOX_NANOERG, T1_FEE_MAX_NANOERG, T1_FEE_MIN_NANOERG, p2pkTree } from "./constants";
import type { BoxCandidate, ErgoBox, Hex, Token, UnsignedTx } from "./model";
import { mergedTokens, outputHeight, reserveRegisters, type CheckResult, type ReservePayload, type ReservePayloadRule, type ReserveCreationRule } from "./p2pk";
import { boxIdHolds, oversizedOutput, oversizedText } from "./serialize";
import { TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX, reserveTokenById, tokenReserveAddress, type ReserveToken } from "./tokens";

class Refused<R extends string> extends Error {
  constructor(readonly rule: R, message: string) {
    super(message);
  }
}

function run<R extends string>(fn: (refuse: (rule: R, message: string) => never) => void): CheckResult<R> {
  try {
    fn((rule, message) => { throw new Refused(rule, message); });
    return { ok: true };
  } catch (e) {
    if (e instanceof Refused) return { ok: false, rule: e.rule as R, message: e.message };
    throw e;
  }
}

const sum = (v: readonly bigint[]): bigint => v.reduce((a, b) => a + b, 0n);
const byValueDesc = (a: ErgoBox, b: ErgoBox) => (a.value === b.value ? 0 : a.value > b.value ? -1 : 1);
const tokenIn = (b: { tokens: Token[] }, id: Hex): bigint => b.tokens.reduce((s, t) => (t.tokenId === id ? s + t.amount : s), 0n);

/** Every token of `boxes` (merged, first-appearance order) less `amount` of `id`; a token that reaches 0 is left out. */
export function tokensLess(boxes: readonly { tokens: Token[] }[], id: Hex, amount: bigint): Token[] {
  return mergedTokens(boxes).map((t) => (t.tokenId === id ? { tokenId: t.tokenId, amount: t.amount - amount } : t)).filter((t) => t.amount > 0n);
}

/** The same list, id by id and amount by amount, in the same order. */
export const sameTokenList = (a: readonly Token[], b: readonly Token[]): boolean => a.length === b.length && a.every((t, i) => b[i].tokenId === t.tokenId && b[i].amount === t.amount);

/** Per token id, the total over `lists`. */
export function tokenTotalsOf(lists: readonly (readonly Token[])[]): Map<Hex, bigint> {
  const m = new Map<Hex, bigint>();
  for (const l of lists) for (const t of l) m.set(t.tokenId, (m.get(t.tokenId) ?? 0n) + t.amount);
  return m;
}

// ─── coins with a token ─────────────────────────────────────────────────────────────────────────

export interface TokenSelection {
  inputs: ErgoBox[];
  /** ERG left after `ergNeed`. */
  leftover: bigint;
  /** What goes to the change: every token of the inputs less `tokenNeed` of the token. */
  tokens: Token[];
}

export type TokenSelectionResult =
  | { ok: true; sel: TokenSelection }
  | { ok: false; why: "short-tokens"; need: bigint; have: bigint }
  | { ok: false; why: "short-erg"; need: bigint; have: bigint };

/**
 * Boxes at P2PK(owner) that hold `tokenNeed` of `tokenId` and `ergNeed` nanoERG: boxes with the token first (most of it
 * first), then token-free boxes (largest first), then other token boxes. When the change keeps any token, at least
 * MIN_BOX_NANOERG must remain for it. Every box must be at P2PK(owner) and hash to its id.
 */
export function selectTokenCoins(boxes: readonly ErgoBox[], owner: Hex, tokenId: Hex, tokenNeed: bigint, ergNeed: bigint): TokenSelectionResult {
  const tree = p2pkTree(owner);
  for (const b of boxes) {
    if (b.ergoTree !== tree) throw new Error(`box ${b.boxId} is not at P2PK(owner)`);
    if (!boxIdHolds(b)) throw new Error(`box ${b.boxId} does not hash to its id`);
  }
  const haveTokens = sum(boxes.map((b) => tokenIn(b, tokenId)));
  if (haveTokens < tokenNeed) return { ok: false, why: "short-tokens", need: tokenNeed, have: haveTokens };
  const withT = boxes.filter((b) => tokenIn(b, tokenId) > 0n).sort((a, b) => { const x = tokenIn(a, tokenId), y = tokenIn(b, tokenId); return x === y ? byValueDesc(a, b) : x > y ? -1 : 1; });
  const picked: ErgoBox[] = [];
  let got = 0n;
  for (const b of withT) {
    if (got >= tokenNeed) break;
    picked.push(b);
    got += tokenIn(b, tokenId);
  }
  const enough = () => {
    const left = sum(picked.map((b) => b.value)) - ergNeed;
    return left >= 0n && (tokensLess(picked, tokenId, tokenNeed).length === 0 || left >= MIN_BOX_NANOERG);
  };
  const rest = [...boxes.filter((b) => b.tokens.length === 0).sort(byValueDesc), ...boxes.filter((b) => b.tokens.length > 0 && !picked.includes(b)).sort(byValueDesc)];
  for (const b of rest) {
    if (enough()) break;
    picked.push(b);
  }
  if (!enough()) return { ok: false, why: "short-erg", need: ergNeed + MIN_BOX_NANOERG, have: sum(boxes.map((b) => b.value)) };
  return { ok: true, sel: { inputs: picked, leftover: sum(picked.map((b) => b.value)) - ergNeed, tokens: tokensLess(picked, tokenId, tokenNeed) } };
}

// ─── the tracker's payload ──────────────────────────────────────────────────────────────────────

/**
 * The tracker's token T1 payload, byte for byte against the pinned constants (as checkReservePayload for ERG): the
 * token contract's mainnet P2S, the ERG value we asked for, exactly [NFT × 1, token × amount], R4–R7 exactly, the fee
 * in range, the change to P2PK(owner).
 */
export function checkTokenReservePayload(p: ReservePayload, want: { owner: Hex; token: ReserveToken; amount: bigint; ergValue: bigint; nftId: Hex }): CheckResult<ReservePayloadRule> {
  return run<ReservePayloadRule>((refuse) => {
    if (reserveTokenById(want.token.id) !== want.token) refuse("assets", "not one of the wallet's reserve tokens");
    if (p.requestCount !== 1) refuse("requests", `${p.requestCount} payment requests; expected exactly one`);
    let tree: Hex | null = null;
    try {
      const a = parseAddress(p.address);
      tree = a.network === "mainnet" && a.type === "P2S" ? a.ergoTree : null;
    } catch {
      tree = null;
    }
    if (tree !== TOKEN_RESERVE_TREE_HEX || p.address !== tokenReserveAddress()) refuse("address", "the reserve address is not the mainnet P2S of the pinned token reserve contract");
    if (p.value !== want.ergValue) refuse("value", `the payload asks for ${p.value} nanoERG in the box; we chose ${want.ergValue}`);
    const a = p.assets;
    if (a.length !== 2 || a[0].tokenId !== want.nftId || a[0].amount !== 1n || a[1].tokenId !== want.token.id || a[1].amount !== want.amount) {
      refuse("assets", `the payload's assets are not [{inputs[0].boxId, 1}, {${want.token.symbol}, ${want.amount}}]`);
    }
    const regs = reserveRegisters(want.owner);
    if (Object.keys(p.registers).sort().join() !== "R4,R5,R6,R7" || regs.some((v, i) => p.registers[`R${4 + i}`] !== v)) refuse("registers", "the payload's registers are not exactly R4 owner, R5 empty tree, R6 our tracker NFT, R7 0");
    if (p.fee < T1_FEE_MIN_NANOERG || p.fee > T1_FEE_MAX_NANOERG) refuse("fee", `the fee ${p.fee} nanoERG is outside ${T1_FEE_MIN_NANOERG} … ${T1_FEE_MAX_NANOERG}`);
    let change: Hex | null = null;
    try {
      change = treeOfAddress(p.changeAddress);
    } catch {
      change = null;
    }
    if (change !== p2pkTree(want.owner)) refuse("change-address", "the change address is not P2PK(owner)");
  });
}

// ─── plan, build, check ─────────────────────────────────────────────────────────────────────────

export interface TokenReservePlan {
  inputs: ErgoBox[];
  token: ReserveToken;
  /** Raw token units in the reserve. */
  amount: bigint;
  /** nanoERG in the reserve box: 0.002 ERG, plus any dust. */
  ergValue: bigint;
  nftId: Hex;
  /** ERG change: 0 or at least 0.001 ERG. */
  change: bigint;
  /** Tokens in the change. */
  changeTokens: Token[];
}

export type TokenPlanResult =
  | { ok: true; plan: TokenReservePlan }
  | { ok: false; why: "amount"; min: bigint; max: bigint }
  | Extract<TokenSelectionResult, { ok: false }>;

/** Coins and the box value for a token reserve of `amount` raw units: the key must hold the tokens and 0.002 ERG +
 *  the fee (+ 0.001 ERG for a change box when one is left). */
export function planTokenReserveCreation(boxes: readonly ErgoBox[], owner: Hex, token: ReserveToken, amount: bigint, fee: bigint, cap: bigint = token.defaultCap): TokenPlanResult {
  const max = cap > token.hardCap ? token.hardCap : cap;
  if (amount < token.min || amount > max) return { ok: false, why: "amount", min: token.min, max };
  const s = selectTokenCoins(boxes, owner, token.id, amount, TOKEN_RESERVE_BOX_NANOERG + fee);
  if (!s.ok) return s;
  const { inputs, leftover, tokens } = s.sel;
  const dust = tokens.length === 0 && leftover > 0n && leftover < MIN_BOX_NANOERG ? leftover : 0n;
  return { ok: true, plan: { inputs, token, amount, ergValue: TOKEN_RESERVE_BOX_NANOERG + dust, nftId: inputs[0].boxId, change: leftover - dust, changeTokens: tokens } };
}

export interface TokenReserveCreationInput {
  owner: Hex;
  inputs: ErgoBox[];
  token: ReserveToken;
  amount: bigint;
  ergValue: bigint;
  fee: bigint;
  height: number;
}

/** The unsigned token T1: [reserve, change?, fee], no data inputs, no extensions. */
export function buildTokenReserveCreation(t: TokenReserveCreationInput): UnsignedTx {
  if (t.inputs.length === 0) throw new Error("T1 needs at least one input");
  const h = outputHeight(t.height, t.inputs);
  const change = sum(t.inputs.map((b) => b.value)) - t.ergValue - t.fee;
  const tokens = tokensLess(t.inputs, t.token.id, t.amount);
  if (sum(t.inputs.map((b) => tokenIn(b, t.token.id))) < t.amount) throw new Error(`the inputs hold less than ${t.amount} of ${t.token.symbol}`);
  if (change < 0n) throw new Error("the inputs do not cover the box value and the fee");
  if ((change > 0n || tokens.length > 0) && change < MIN_BOX_NANOERG) throw new Error(`change ${change} nanoERG is below ${MIN_BOX_NANOERG}`);
  const outputs: BoxCandidate[] = [
    { value: t.ergValue, ergoTree: TOKEN_RESERVE_TREE_HEX, creationHeight: h, tokens: [{ tokenId: t.inputs[0].boxId, amount: 1n }, { tokenId: t.token.id, amount: t.amount }], registers: reserveRegisters(t.owner) },
  ];
  if (change > 0n) outputs.push({ value: change, ergoTree: p2pkTree(t.owner), creationHeight: h, tokens, registers: [] });
  outputs.push({ value: t.fee, ergoTree: FEE_TREE_HEX, creationHeight: h, tokens: [], registers: [] });
  return { inputs: t.inputs.map((b) => ({ boxId: b.boxId, extension: [] })), dataInputs: [], outputs };
}

/**
 * The token T1, as checkReserveCreation checks the ERG one: owner-only inputs (ids verified by hash), exactly
 * [reserve, change?, fee]; the reserve under the pinned token contract with [NFT × 1, token × amount] and the exact
 * registers; every other token of the inputs (and the rest of this one) in the change; ERG in = ERG out; per token id
 * in = out, the NFT the only new token; every output at most 4096 bytes. `cap` never above the token's hard cap.
 */
export function checkTokenReserveCreation(tx: UnsignedTx, inputs: readonly ErgoBox[], want: { owner: Hex; token: ReserveToken; amount: bigint; ergValue: bigint; fee: bigint; height: number; cap?: bigint }): CheckResult<ReserveCreationRule> {
  return run<ReserveCreationRule>((refuse) => {
    const tk = want.token;
    if (reserveTokenById(tk.id) !== tk) refuse("amount", "not one of the wallet's reserve tokens");
    const cap = want.cap ?? tk.defaultCap;
    if (cap > tk.hardCap) refuse("amount", `the cap is above the ${tk.symbol} maximum`);
    if (want.amount < tk.min || want.amount > cap) refuse("amount", `the reserve amount ${want.amount} is outside ${tk.min} … ${cap} raw units of ${tk.symbol}`);
    if (want.ergValue < TOKEN_RESERVE_BOX_NANOERG || want.ergValue >= TOKEN_RESERVE_BOX_NANOERG + MIN_BOX_NANOERG) refuse("amount", `the box value ${want.ergValue} nanoERG is not 0.002 ERG (plus dust below 0.001 ERG)`);
    if (want.fee < T1_FEE_MIN_NANOERG || want.fee > T1_FEE_MAX_NANOERG) refuse("fee", `the fee ${want.fee} is outside ${T1_FEE_MIN_NANOERG} … ${T1_FEE_MAX_NANOERG}`);
    const owner = p2pkTree(want.owner);
    if (tx.inputs.length === 0 || tx.inputs.length !== inputs.length) refuse("inputs", "the inputs do not match the boxes");
    tx.inputs.forEach((inp, i) => {
      const b = inputs[i];
      if (inp.boxId !== b.boxId) refuse("inputs", `input ${i} is not box ${b.boxId}`);
      if (inp.extension.length !== 0) refuse("inputs", `input ${i} carries a context extension`);
      if (b.ergoTree !== owner) refuse("inputs", `input ${i} is not at P2PK(owner)`);
      if (!boxIdHolds(b)) refuse("inputs", `box ${b.boxId} does not hash to its id`);
    });
    if (new Set(tx.inputs.map((i) => i.boxId)).size !== tx.inputs.length) refuse("inputs", "a box is spent twice");
    if (tx.dataInputs.length !== 0) refuse("inputs", "T1 has no data inputs");
    const nft = inputs[0].boxId;
    if (mergedTokens(inputs as ErgoBox[]).some((t) => t.tokenId === nft)) refuse("totals", "the NFT id is already a token of an input");
    if (sum(inputs.map((b) => tokenIn(b, tk.id))) < want.amount) refuse("totals", `the inputs hold less than ${want.amount} of ${tk.symbol}`);
    const rest = tokensLess(inputs, tk.id, want.amount);
    const outs = tx.outputs;
    if (outs.length !== 2 && outs.length !== 3) refuse("outputs", `${outs.length} outputs; T1 has [reserve, change?, fee]`);
    const [reserve, change, fee] = outs.length === 3 ? [outs[0], outs[1], outs[2]] : [outs[0], null, outs[1]];
    const regs = reserveRegisters(want.owner);
    if (
      reserve.ergoTree !== TOKEN_RESERVE_TREE_HEX ||
      reserve.value !== want.ergValue ||
      !sameTokenList(reserve.tokens, [{ tokenId: nft, amount: 1n }, { tokenId: tk.id, amount: want.amount }]) ||
      reserve.registers.length !== 4 ||
      regs.some((v, i) => reserve.registers[i] !== v)
    ) {
      refuse("reserve-output", `output 0 is not the reserve: pinned token contract, ${want.ergValue} nanoERG, [NFT 1, ${tk.symbol} ${want.amount}], R4 owner, R5 empty tree, R6 our NFT, R7 0`);
    }
    if (change) {
      if (change.ergoTree !== owner || change.value < MIN_BOX_NANOERG || !sameTokenList(change.tokens, rest) || change.registers.length !== 0) refuse("change-output", "output 1 is not the change to P2PK(owner) with every other token and at least 0.001 ERG");
    } else if (rest.length > 0) {
      refuse("change-output", "tokens would be left without a change output: they would be burned");
    }
    if (fee.ergoTree !== FEE_TREE_HEX || fee.value !== want.fee || fee.tokens.length !== 0 || fee.registers.length !== 0) refuse("fee-output", "the last output is not the token-free miner fee");
    const big = oversizedOutput(outs);
    if (big) refuse("box-size", oversizedText(big));
    const at = outputHeight(want.height, inputs);
    for (const [i, o] of outs.entries()) if (o.creationHeight !== at) refuse("creation-height", `output ${i} is created at ${o.creationHeight}, not at ${at}`);
    if (sum(inputs.map((b) => b.value)) !== sum(outs.map((o) => o.value))) refuse("totals", "ERG in differs from ERG out");
    const tin = tokenTotalsOf(inputs.map((b) => b.tokens));
    tin.set(nft, 1n);
    const tout = tokenTotalsOf(outs.map((o) => o.tokens));
    if (tin.size !== tout.size || [...tin].some(([id, n]) => tout.get(id) !== n)) refuse("totals", "a token would be minted, burned or changed");
  });
}
