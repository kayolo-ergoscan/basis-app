// Token Withdraw: SigUSD / rsADA from the key to a P2PK address. The plan (token boxes first, dust to the destination,
// what is short), the builder, and the check with one mutation per rule; the destination refusals are Withdraw's (the
// reserve contracts, the token one included, and the fee tree) plus any script address. Signed with a TEST key.
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { maxTokenWithdraw, planTokenWithdraw, tokenWithdrawErgNeed } from "../flows/coins";
import { p2pkAddress, p2sAddress } from "./address";
import { FEE_TREE_HEX, MINER_FEE_NANOERG, MIN_BOX_NANOERG, RESERVE_TREE_HEX, p2pkTree } from "./constants";
import type { ErgoBox, UnsignedTx } from "./model";
import { signP2pkTransaction, verifyP2pkTransaction } from "./p2pk";
import { p2pkBox, secretBytes } from "./testkit";
import { RSADA_TOKEN_ID, SIGUSD_TOKEN_ID, TOKEN_RESERVE_TREE_HEX, reserveTokenById } from "./tokens";
import { TOKEN_WITHDRAW_BOX_NANOERG, buildTokenWithdraw, checkTokenWithdraw } from "./tokenwithdraw";

const me = keyPairFromSecret(3n);
const owner = me.pubHex;
const to = p2pkAddress(keyPairFromSecret(2n).pubHex);
const SIG = reserveTokenById(SIGUSD_TOKEN_ID)!;
const ADA = reserveTokenById(RSADA_TOKEN_ID)!;
const OTHER = "77".repeat(32);
const FEE = MINER_FEE_NANOERG;
const TIP = 1_925_000;
const clone = (tx: UnsignedTx): UnsignedTx => ({ inputs: tx.inputs.map((i) => ({ ...i, extension: [...i.extension] })), dataInputs: [...tx.dataInputs], outputs: tx.outputs.map((o) => ({ ...o, tokens: o.tokens.map((t) => ({ ...t })), registers: [...o.registers] })) });

const sigBox = p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 800n }, { tokenId: OTHER, amount: 3n }], index: 1 });
const adaBox = p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: RSADA_TOKEN_ID, amount: 5_000_000n }], index: 3 });
const ergBox = p2pkBox(owner, 50_000_000n, { index: 2 });
const boxes = [ergBox, adaBox, sigBox];

function planned(amount = 500n, token = SIG, list: ErgoBox[] = boxes) {
  const p = planTokenWithdraw(list, owner, to, token, amount, FEE, TIP);
  if (!p.ok) throw new Error(`plan: ${p.why}`);
  return p;
}
const wantOf = (p: ReturnType<typeof planned>) => ({ owner, to, token: p.token, amount: p.sent, ergValue: p.ergValue, fee: FEE, height: TIP });

describe("the token Withdraw plan", () => {
  it("the token's boxes first, then ERG; the destination gets 0.001 ERG and exactly the tokens; the rest stays", () => {
    const p = planned(500n);
    expect(p.inputs.map((b) => b.boxId)).toEqual([sigBox.boxId, ergBox.boxId]);
    expect(p.ergValue).toBe(TOKEN_WITHDRAW_BOX_NANOERG);
    expect(p.tx.outputs[0]).toMatchObject({ ergoTree: p2pkTree(keyPairFromSecret(2n).pubHex), value: 1_000_000n, tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 500n }] });
    expect(p.tx.outputs[1]).toMatchObject({ ergoTree: p2pkTree(owner), value: 51_000_000n - 2_000_000n, tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }, { tokenId: OTHER, amount: 3n }] });
    expect(p.tx.outputs[2]).toMatchObject({ ergoTree: FEE_TREE_HEX, value: FEE, tokens: [] });
    expect(p.changeTokens).toEqual([{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }, { tokenId: OTHER, amount: 3n }]);
    expect(checkTokenWithdraw(p.tx, p.inputs, wantOf(p))).toEqual({ ok: true });
    // rsADA: the SigUSD box is not touched
    const a = planned(5_000_000n, ADA);
    expect(a.inputs.map((b) => b.boxId)).toEqual([adaBox.boxId, ergBox.boxId]);
    expect(a.changeTokens).toEqual([]);
    expect(checkTokenWithdraw(a.tx, a.inputs, wantOf(a))).toEqual({ ok: true });
  });

  it("ERG dust with no change box goes into the destination box, never to the miner", () => {
    const only = p2pkBox(owner, 2_400_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 500n }] });
    const p = planned(500n, SIG, [only]);
    expect(p.ergValue).toBe(1_400_000n);
    expect(p.change).toBe(0n);
    expect(p.tx.outputs.length).toBe(2);
    expect(checkTokenWithdraw(p.tx, p.inputs, wantOf(p))).toEqual({ ok: true });
  });

  it("says what is short, and refuses 0 and too many boxes", () => {
    expect(planTokenWithdraw(boxes, owner, to, SIG, 801n, FEE, TIP)).toMatchObject({ ok: false, why: "short-tokens", need: 801n, have: 800n });
    // the need the screen shows (second review LOW-5a): the 0.001 ERG box, the fee and 0.001 ERG for the change box
    expect(planTokenWithdraw([sigBox], owner, to, SIG, 500n, FEE, TIP)).toMatchObject({ ok: false, why: "short-erg", need: 3_000_000n, have: 1_000_000n });
    expect(planTokenWithdraw(boxes, owner, to, SIG, 0n, FEE, TIP)).toEqual({ ok: false, why: "amount" });
    const many = Array.from({ length: 51 }, (_, i) => p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 1n }], index: i, transactionId: "f1".repeat(32) }));
    expect(planTokenWithdraw([...many, ergBox], owner, to, SIG, 51n, FEE, TIP)).toEqual({ ok: false, why: "too-many-boxes" });
    expect(maxTokenWithdraw([...many, ergBox], SIGUSD_TOKEN_ID)).toBe(50n);
    expect(maxTokenWithdraw(boxes, SIGUSD_TOKEN_ID)).toBe(800n);
    expect(tokenWithdrawErgNeed()).toBe(2_000_000n);
  });

  it("refuses the reserve contracts, the fee contract, a script and a testnet address, and the boxes of another key", () => {
    for (const bad of [p2sAddress(RESERVE_TREE_HEX), p2sAddress(TOKEN_RESERVE_TREE_HEX), p2sAddress(FEE_TREE_HEX), p2sAddress("0008d3"), p2pkAddress(keyPairFromSecret(2n).pubHex, "testnet")]) {
      expect(planTokenWithdraw(boxes, owner, bad, SIG, 500n, FEE, TIP)).toMatchObject({ ok: false, why: "build" });
      const p = planned(500n);
      expect(checkTokenWithdraw(p.tx, p.inputs, { ...wantOf(p), to: bad })).toMatchObject({ ok: false, rule: "destination" });
    }
    expect(() => planTokenWithdraw([p2pkBox(keyPairFromSecret(2n).pubHex, 5_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 9n }] })], owner, to, SIG, 1n, FEE, TIP)).toThrow();
  });
});

describe("the token Withdraw check, one mutation per rule", () => {
  const p = planned(500n);
  const want = wantOf(p);
  const refused = (f: (t: UnsignedTx) => void, w: Partial<typeof want> = {}, inputs: ErgoBox[] = p.inputs) => {
    const tx = clone(p.tx);
    f(tx);
    return checkTokenWithdraw(tx, inputs, { ...want, ...w });
  };
  it.each([
    ["token", () => refused(() => {}, { token: { ...SIG } })],
    ["token", () => refused(() => {}, { amount: 0n })],
    ["inputs", () => refused((t) => { t.inputs[0].extension = [{ key: 0, value: "0200" }]; })],
    ["inputs", () => refused((t) => { t.inputs.reverse(); })],
    ["inputs", () => refused((t) => { t.dataInputs = [ergBox.boxId]; })],
    ["inputs", () => refused(() => {}, {}, [{ ...p.inputs[0], value: p.inputs[0].value + 1n }, p.inputs[1]])],
    ["outputs", () => refused((t) => { t.outputs.push({ ...t.outputs[2] }); })],
    ["destination", () => refused((t) => { t.outputs[0].tokens[0].amount = 499n; t.outputs[1].tokens[0].amount = 301n; })],
    ["destination", () => refused((t) => { t.outputs[0].tokens.push({ tokenId: OTHER, amount: 3n }); t.outputs[1].tokens.pop(); })],
    ["destination", () => refused((t) => { t.outputs[0].ergoTree = p2pkTree(owner); })],
    ["destination", () => refused((t) => { t.outputs[0].value += 1n; t.outputs[1].value -= 1n; })],
    ["destination", () => refused((t) => { t.outputs[0].registers = ["0500"]; })],
    ["destination", () => refused(() => {}, { ergValue: 2_000_000n })],
    ["change-output", () => refused((t) => { t.outputs[1].tokens.pop(); })],
    ["change-output", () => refused((t) => { t.outputs[1].tokens.reverse(); })],
    ["change-output", () => refused((t) => { t.outputs[1].ergoTree = p2pkTree(keyPairFromSecret(2n).pubHex); })],
    ["change-output", () => refused((t) => { t.outputs.splice(1, 1); })],
    ["fee-output", () => refused((t) => { t.outputs[2].value += 1n; t.outputs[1].value -= 1n; })],
    ["fee-output", () => refused((t) => { t.outputs[2].ergoTree = p2pkTree(owner); })],
    ["fee-output", () => refused(() => {}, { fee: 3_000_000n })],
    ["creation-height", () => refused((t) => { t.outputs[1].creationHeight -= 1; })],
    ["totals", () => refused((t) => { t.outputs[1].value += 1n; })],
    ["totals", () => refused(() => {}, { amount: 900n })],
  ] as const)("%s", (rule, f) => {
    expect(f()).toMatchObject({ ok: false, rule });
  });
});

describe("the box value and fee ranges, on balanced transactions (second review MEDIUM-1)", () => {
  // built by the builder with `want` matching, so no equality rule refuses first: only the range lines can
  const build = (ergValue: bigint, fee: bigint) => {
    const inputs = [sigBox, ergBox];
    const tx = buildTokenWithdraw({ owner, inputs, to, token: SIG, amount: 500n, ergValue, fee, height: TIP });
    return checkTokenWithdraw(tx, inputs, { owner, to, token: SIG, amount: 500n, ergValue, fee, height: TIP });
  };
  it("the destination box holds 0.001 ERG plus dust below 0.001 ERG, never 0.002 ERG or more", () => {
    expect(build(1_999_999n, FEE)).toEqual({ ok: true });
    expect(build(2_000_000n, FEE)).toMatchObject({ ok: false, rule: "destination", message: expect.stringMatching(/^the destination box value 2000000 nanoERG is not 0\.001 ERG/) });
    expect(build(40_000_000n, FEE)).toMatchObject({ ok: false, rule: "destination", message: expect.stringMatching(/is not 0\.001 ERG/) });
  });
  it("the fee is 0.001 … 0.002 ERG", () => {
    expect(build(TOKEN_WITHDRAW_BOX_NANOERG, 2_000_000n)).toEqual({ ok: true });
    expect(build(TOKEN_WITHDRAW_BOX_NANOERG, 3_000_000n)).toMatchObject({ ok: false, rule: "fee-output", message: expect.stringMatching(/^the fee 3000000 is outside/) });
    expect(build(TOKEN_WITHDRAW_BOX_NANOERG, 999_999n)).toMatchObject({ ok: false, rule: "fee-output", message: expect.stringMatching(/^the fee 999999 is outside/) });
  });
});

describe("MaxBoxSize", () => {
  it("a change box over 4096 bytes (many other tokens) is refused; the rule is the size, not the count", () => {
    const many = Array.from({ length: 130 }, (_, i) => ({ tokenId: (i + 1).toString(16).padStart(64, "b"), amount: 1n }));
    const big = [p2pkBox(owner, 2_000_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 10n }, ...many] })];
    const p = planned(5n, SIG, big);
    expect(checkTokenWithdraw(p.tx, p.inputs, wantOf(p))).toMatchObject({ ok: false, rule: "box-size", message: expect.stringMatching(/^output 1 would be \d+ bytes/) });
    const fit = [p2pkBox(owner, 2_000_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 10n }, ...many.slice(0, 99)] })];
    const q = planned(5n, SIG, fit);
    expect(checkTokenWithdraw(q.tx, q.inputs, wantOf(q))).toEqual({ ok: true });
  });
});

describe("signing", () => {
  it("the key proves every input; the signed transaction verifies", () => {
    const p = planned(250n);
    const s = signP2pkTransaction(p.tx, p.inputs, secretBytes(me.secret));
    expect(verifyP2pkTransaction(s.signed, p.inputs)).toBe(true);
    expect(s.nodeJson).toContain(SIGUSD_TOKEN_ID);
  });

  it("the builder refuses what the check would refuse", () => {
    expect(() => buildTokenWithdraw({ owner, inputs: [sigBox, ergBox], to, token: SIG, amount: 801n, ergValue: TOKEN_WITHDRAW_BOX_NANOERG, fee: FEE, height: TIP })).toThrow(/less than/);
    expect(() => buildTokenWithdraw({ owner, inputs: [sigBox, ergBox], to, token: SIG, amount: 1n, ergValue: MIN_BOX_NANOERG - 1n, fee: FEE, height: TIP })).toThrow();
    expect(() => buildTokenWithdraw({ owner, inputs: [sigBox, ergBox], to: p2sAddress(TOKEN_RESERVE_TREE_HEX), token: SIG, amount: 1n, ergValue: TOKEN_WITHDRAW_BOX_NANOERG, fee: FEE, height: TIP })).toThrow(/reserve contract/);
    expect(() => buildTokenWithdraw({ owner, inputs: [sigBox], to, token: SIG, amount: 1n, ergValue: TOKEN_WITHDRAW_BOX_NANOERG, fee: FEE, height: TIP })).toThrow();
  });
});
