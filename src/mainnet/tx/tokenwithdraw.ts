// Token Withdraw: SigUSD or rsADA from the key to a P2PK address, as Withdraw sends ERG (p2pk.ts). The transaction is
// [destination (0.001 ERG + the tokens), change?, fee]: the destination box carries exactly the amount of the one
// token, the change every other token of the inputs and the rest of this one, ERG in = ERG out and per token id
// in = out. The check refuses the reserve contracts (ERG and token), the fee contract and any script address.
import { parseAddress } from "./address";
import { FEE_TREE_HEX, MIN_BOX_NANOERG, T1_FEE_MAX_NANOERG, T1_FEE_MIN_NANOERG, p2pkTree } from "./constants";
import type { BoxCandidate, ErgoBox, Hex, UnsignedTx } from "./model";
import { destinationTree, outputHeight, type CheckResult } from "./p2pk";
import { boxIdHolds, oversizedOutput, oversizedText } from "./serialize";
import { sameTokenList, tokenTotalsOf, tokensLess } from "./tokenreserve";
import { reserveTokenById, type ReserveToken } from "./tokens";

/** nanoERG in the destination box of a token Withdraw: the smallest box the wallet makes (plus any dust). */
export const TOKEN_WITHDRAW_BOX_NANOERG = MIN_BOX_NANOERG;

export interface TokenWithdrawInput {
  owner: Hex;
  inputs: ErgoBox[];
  /** A mainnet P2PK address (never the key's own: the screen refuses it). */
  to: string;
  token: ReserveToken;
  /** Raw units of the token to the destination. */
  amount: bigint;
  /** nanoERG in the destination box: TOKEN_WITHDRAW_BOX_NANOERG, plus dust below MIN_BOX_NANOERG. */
  ergValue: bigint;
  fee: bigint;
  height: number;
}

const sum = (v: readonly bigint[]): bigint => v.reduce((a, b) => a + b, 0n);
const tokenIn = (b: ErgoBox, id: Hex): bigint => b.tokens.reduce((s, t) => (t.tokenId === id ? s + t.amount : s), 0n);

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

/** A P2PK destination's tree (the reserve trees, the fee tree and script addresses refused). */
function p2pkDestinationTree(to: string): Hex {
  const tree = destinationTree(to);
  const a = parseAddress(to);
  if (a.network !== "mainnet" || a.type !== "P2PK") throw new Error("a token withdrawal goes to a mainnet P2PK address");
  return tree;
}

/** The unsigned token Withdraw: [destination, change?, fee], no data inputs, no extensions. */
export function buildTokenWithdraw(w: TokenWithdrawInput): UnsignedTx {
  const tree = p2pkDestinationTree(w.to);
  if (reserveTokenById(w.token.id) !== w.token) throw new Error("not one of the wallet's tokens");
  if (w.inputs.length === 0) throw new Error("a withdrawal needs at least one input");
  if (w.amount < 1n) throw new Error("a token withdrawal sends at least 1 raw unit");
  if (w.ergValue < TOKEN_WITHDRAW_BOX_NANOERG) throw new Error(`the destination box holds at least ${TOKEN_WITHDRAW_BOX_NANOERG} nanoERG`);
  if (sum(w.inputs.map((b) => tokenIn(b, w.token.id))) < w.amount) throw new Error(`the inputs hold less than ${w.amount} of ${w.token.symbol}`);
  const h = outputHeight(w.height, w.inputs);
  const change = sum(w.inputs.map((b) => b.value)) - w.ergValue - w.fee;
  const tokens = tokensLess(w.inputs, w.token.id, w.amount);
  if (change < 0n) throw new Error("the inputs do not cover the box and the fee");
  if ((change > 0n || tokens.length > 0) && change < MIN_BOX_NANOERG) throw new Error(`change ${change} nanoERG is below ${MIN_BOX_NANOERG}`);
  const outputs: BoxCandidate[] = [{ value: w.ergValue, ergoTree: tree, creationHeight: h, tokens: [{ tokenId: w.token.id, amount: w.amount }], registers: [] }];
  if (change > 0n) outputs.push({ value: change, ergoTree: p2pkTree(w.owner), creationHeight: h, tokens, registers: [] });
  outputs.push({ value: w.fee, ergoTree: FEE_TREE_HEX, creationHeight: h, tokens: [], registers: [] });
  return { inputs: w.inputs.map((b) => ({ boxId: b.boxId, extension: [] })), dataInputs: [], outputs };
}

export type TokenWithdrawRule = "token" | "inputs" | "outputs" | "destination" | "change-output" | "fee-output" | "creation-height" | "totals" | "box-size";

/**
 * Before signing a token Withdraw, as checkWithdraw before an ERG one: owner-only inputs with verified ids and no
 * context variables; exactly [destination, change?, fee]; the destination a P2PK address (never a reserve contract,
 * the token one included, or the fee contract) with `ergValue` and exactly [token × amount]; the change at P2PK(owner)
 * with every other token and the rest of this one, in order; the fee token-free and in range; ERG in = ERG out; per
 * token id in = out (nothing minted or burned); every output at most 4096 bytes, created at outputHeight(tip, inputs).
 */
export function checkTokenWithdraw(tx: UnsignedTx, inputs: readonly ErgoBox[], want: { owner: Hex; to: string; token: ReserveToken; amount: bigint; ergValue: bigint; fee: bigint; height: number }): CheckResult<TokenWithdrawRule> {
  return run<TokenWithdrawRule>((refuse) => {
    const tk = want.token;
    if (reserveTokenById(tk.id) !== tk) refuse("token", "not one of the wallet's tokens");
    if (want.amount < 1n) refuse("token", "a token withdrawal sends at least 1 raw unit");
    let dest: Hex = "";
    try {
      dest = p2pkDestinationTree(want.to);
    } catch (e) {
      refuse("destination", (e as Error).message);
    }
    if (want.ergValue < TOKEN_WITHDRAW_BOX_NANOERG || want.ergValue >= TOKEN_WITHDRAW_BOX_NANOERG + MIN_BOX_NANOERG) refuse("destination", `the destination box value ${want.ergValue} nanoERG is not 0.001 ERG (plus dust below 0.001 ERG)`);
    if (want.fee < T1_FEE_MIN_NANOERG || want.fee > T1_FEE_MAX_NANOERG) refuse("fee-output", `the fee ${want.fee} is outside ${T1_FEE_MIN_NANOERG} … ${T1_FEE_MAX_NANOERG}`);
    const owner = p2pkTree(want.owner);
    if (tx.inputs.length === 0 || tx.inputs.length !== inputs.length || tx.dataInputs.length !== 0) refuse("inputs", "the inputs do not match the boxes");
    tx.inputs.forEach((inp, i) => {
      if (inp.boxId !== inputs[i].boxId || inp.extension.length !== 0 || inputs[i].ergoTree !== owner || !boxIdHolds(inputs[i])) refuse("inputs", `input ${i} is not an owner box with a verified id`);
    });
    if (new Set(tx.inputs.map((i) => i.boxId)).size !== tx.inputs.length) refuse("inputs", "a box is spent twice");
    if (sum(inputs.map((b) => tokenIn(b, tk.id))) < want.amount) refuse("totals", `the inputs hold less than ${want.amount} of ${tk.symbol}`);
    const outs = tx.outputs;
    if (outs.length !== 2 && outs.length !== 3) refuse("outputs", `${outs.length} outputs; a withdrawal has [destination, change?, fee]`);
    const [d, change, fee] = outs.length === 3 ? [outs[0], outs[1], outs[2]] : [outs[0], null, outs[1]];
    if (d.ergoTree !== dest || d.value !== want.ergValue || !sameTokenList(d.tokens, [{ tokenId: tk.id, amount: want.amount }]) || d.registers.length !== 0) {
      refuse("destination", `output 0 is not ${want.amount} raw units of ${tk.symbol} with ${want.ergValue} nanoERG to the destination`);
    }
    const rest = tokensLess(inputs, tk.id, want.amount);
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
    const tout = tokenTotalsOf(outs.map((o) => o.tokens));
    if (tin.size !== tout.size || [...tin].some(([id, n]) => tout.get(id) !== n)) refuse("totals", "a token would be minted, burned or changed");
  });
}
