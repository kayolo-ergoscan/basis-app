// Token T1: coins with a token, the tracker's payload, the builder, and the check with one mutation per rule.
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { p2pkAddress, p2sAddress } from "./address";
import { FEE_TREE_HEX, MINER_FEE_NANOERG, MIN_BOX_NANOERG, RESERVE_TREE_HEX, p2pkTree } from "./constants";
import type { ErgoBox, UnsignedTx } from "./model";
import { reserveRegisters, type ReservePayload } from "./p2pk";
import { p2pkBox } from "./testkit";
import { buildTokenReserveCreation, checkTokenReserveCreation, checkTokenReservePayload, planTokenReserveCreation, selectTokenCoins } from "./tokenreserve";
import { RESERVE_TOKENS, SIGUSD_TOKEN_ID, TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX, reserveTokenById, tokenReserveAddress } from "./tokens";

const owner = keyPairFromSecret(3n).pubHex;
const SIG = reserveTokenById(SIGUSD_TOKEN_ID)!;
const OTHER = "77".repeat(32);
const FEE = MINER_FEE_NANOERG;
const TIP = 1_925_000;
const clone = (tx: UnsignedTx): UnsignedTx => ({ inputs: tx.inputs.map((i) => ({ ...i, extension: [...i.extension] })), dataInputs: [...tx.dataInputs], outputs: tx.outputs.map((o) => ({ ...o, tokens: o.tokens.map((t) => ({ ...t })), registers: [...o.registers] })) });

const tokenBox = p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 800n }, { tokenId: OTHER, amount: 3n }], index: 1 });
const ergBox = p2pkBox(owner, 50_000_000n, { index: 2 });

describe("coins with a token", () => {
  it("token boxes first, then ERG; the change keeps the rest of the token and every other token", () => {
    const s = selectTokenCoins([ergBox, tokenBox], owner, SIGUSD_TOKEN_ID, 500n, TOKEN_RESERVE_BOX_NANOERG + FEE);
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.sel.inputs.map((b) => b.boxId)).toEqual([tokenBox.boxId, ergBox.boxId]);
    expect(s.sel.tokens).toEqual([{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }, { tokenId: OTHER, amount: 3n }]);
    expect(s.sel.leftover).toBe(51_000_000n - 3_000_000n);
  });

  it("says what is short: the token, or ERG (with 0.001 ERG for the change box)", () => {
    expect(selectTokenCoins([tokenBox, ergBox], owner, SIGUSD_TOKEN_ID, 801n, 3_000_000n)).toEqual({ ok: false, why: "short-tokens", need: 801n, have: 800n });
    const r = selectTokenCoins([tokenBox], owner, SIGUSD_TOKEN_ID, 500n, 3_000_000n);
    expect(r.ok === false && r.why).toBe("short-erg");
  });

  it("refuses a box of another key", () => {
    expect(() => selectTokenCoins([p2pkBox(keyPairFromSecret(2n).pubHex, 1n)], owner, SIGUSD_TOKEN_ID, 1n, 1n)).toThrow();
  });
});

describe("the plan", () => {
  it("amount within the token's floor and cap; 0.002 ERG in the box", () => {
    const p = planTokenReserveCreation([tokenBox, ergBox], owner, SIG, 500n, FEE);
    expect(p.ok && p.plan.ergValue).toBe(TOKEN_RESERVE_BOX_NANOERG);
    expect(p.ok && p.plan.nftId).toBe(tokenBox.boxId);
    expect(planTokenReserveCreation([tokenBox, ergBox], owner, SIG, 99n, FEE)).toEqual({ ok: false, why: "amount", min: 100n, max: 500n });
    expect(planTokenReserveCreation([tokenBox, ergBox], owner, SIG, 501n, FEE)).toEqual({ ok: false, why: "amount", min: 100n, max: 500n });
    expect(planTokenReserveCreation([tokenBox, ergBox], owner, SIG, 800n, FEE, 10_000n)).toMatchObject({ ok: true });
    const over = planTokenReserveCreation([tokenBox, ergBox], owner, SIG, 2_600n, FEE, 10_000n);
    expect(over).toEqual({ ok: false, why: "amount", min: 100n, max: 2_500n });
  });

  it("ERG dust with no change box goes into the reserve box, never to the miner", () => {
    const only = p2pkBox(owner, 3_400_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 500n }] });
    const p = planTokenReserveCreation([only], owner, SIG, 500n, FEE);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan.ergValue).toBe(2_400_000n);
    expect(p.plan.change).toBe(0n);
    const tx = buildTokenReserveCreation({ owner, inputs: p.plan.inputs, token: SIG, amount: 500n, ergValue: p.plan.ergValue, fee: FEE, height: TIP });
    expect(tx.outputs.length).toBe(2);
    expect(checkTokenReserveCreation(tx, p.plan.inputs, { owner, token: SIG, amount: 500n, ergValue: p.plan.ergValue, fee: FEE, height: TIP })).toEqual({ ok: true });
  });
});

describe("the tracker's payload", () => {
  const payload = (o: Partial<ReservePayload> = {}): ReservePayload => ({
    text: "", requestCount: 1, address: tokenReserveAddress(), value: TOKEN_RESERVE_BOX_NANOERG,
    assets: [{ tokenId: tokenBox.boxId, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 500n }],
    registers: Object.fromEntries(reserveRegisters(owner).map((v, i) => [`R${4 + i}`, v])), fee: FEE, changeAddress: p2pkAddress(owner), ...o,
  });
  const want = { owner, token: SIG, amount: 500n, ergValue: TOKEN_RESERVE_BOX_NANOERG, nftId: tokenBox.boxId };

  it("passes byte for byte", () => expect(checkTokenReservePayload(payload(), want)).toEqual({ ok: true }));

  it.each<[string, Partial<ReservePayload>]>([
    ["address", { address: p2sAddress(RESERVE_TREE_HEX) }],
    ["value", { value: TOKEN_RESERVE_BOX_NANOERG + 1n }],
    ["assets", { assets: [{ tokenId: tokenBox.boxId, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 501n }] }],
    ["assets", { assets: [{ tokenId: tokenBox.boxId, amount: 1n }, { tokenId: RESERVE_TOKENS[1].id, amount: 500n }] }],
    ["assets", { assets: [{ tokenId: tokenBox.boxId, amount: 1n }] }],
    ["registers", { registers: { R4: `07${owner}`, R5: "00", R6: "00", R7: "0500" } }],
    ["fee", { fee: 3_000_000n }],
    ["change-address", { changeAddress: p2pkAddress(keyPairFromSecret(2n).pubHex) }],
    ["requests", { requestCount: 2 }],
  ])("refuses %s", (rule, o) => {
    const r = checkTokenReservePayload(payload(o), want);
    expect(r.ok === false && r.rule).toBe(rule);
  });

  it("refuses a look-alike token table entry", () => {
    const r = checkTokenReservePayload(payload(), { ...want, token: { ...SIG } });
    expect(r.ok).toBe(false);
  });
});

describe("the token T1", () => {
  const p = planTokenReserveCreation([tokenBox, ergBox], owner, SIG, 500n, FEE);
  if (!p.ok) throw new Error("plan");
  const inputs: ErgoBox[] = p.plan.inputs;
  const want = { owner, token: SIG, amount: 500n, ergValue: TOKEN_RESERVE_BOX_NANOERG, fee: FEE, height: TIP };
  const tx = buildTokenReserveCreation({ ...want, inputs });

  it("is [reserve (token contract, NFT + token), change with the rest, fee] and passes", () => {
    expect(tx.outputs[0].ergoTree).toBe(TOKEN_RESERVE_TREE_HEX);
    expect(tx.outputs[0].tokens).toEqual([{ tokenId: tokenBox.boxId, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 500n }]);
    expect(tx.outputs[1].tokens).toEqual([{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }, { tokenId: OTHER, amount: 3n }]);
    expect(tx.outputs[1].ergoTree).toBe(p2pkTree(owner));
    expect(tx.outputs[2].ergoTree).toBe(FEE_TREE_HEX);
    expect(checkTokenReserveCreation(tx, inputs, want)).toEqual({ ok: true });
  });

  const mutations: [string, string, (t: UnsignedTx) => void][] = [
    ["the ERG tree", "reserve-output", (t) => { t.outputs[0].ergoTree = RESERVE_TREE_HEX; }],
    ["one token unit more in the reserve", "reserve-output", (t) => { t.outputs[0].tokens[1].amount = 501n; t.outputs[1].tokens[0].amount = 299n; }],
    ["the NFT amount 2", "reserve-output", (t) => { t.outputs[0].tokens[0].amount = 2n; }],
    ["a token left out of the change", "change-output", (t) => { t.outputs[1].tokens = t.outputs[1].tokens.slice(0, 1); }],
    ["the change to another key", "change-output", (t) => { t.outputs[1].ergoTree = p2pkTree(keyPairFromSecret(2n).pubHex); }],
    ["ERG moved to the fee", "fee-output", (t) => { t.outputs[1].value -= 1n; t.outputs[2].value += 1n; }],
    ["a register more", "reserve-output", (t) => { t.outputs[0].registers.push("0500"); }],
    ["an extension on an input", "inputs", (t) => { t.inputs[1].extension = [{ key: 0, value: "0200" }]; }],
    ["a data input", "inputs", (t) => { t.dataInputs.push("aa".repeat(32)); }],
    ["the creation height", "creation-height", (t) => { t.outputs[0].creationHeight -= 1; }],
  ];
  it.each(mutations)("refuses %s", (_n, rule, f) => {
    const t = clone(tx);
    f(t);
    const r = checkTokenReserveCreation(t, inputs, want);
    expect(r.ok === false && r.rule).toBe(rule);
  });

  it("refuses an amount over the cap, a cap over 25 SigUSD, and ERG beyond the box value", () => {
    expect(checkTokenReserveCreation(tx, inputs, { ...want, cap: 400n })).toMatchObject({ ok: false, rule: "amount" });
    expect(checkTokenReserveCreation(tx, inputs, { ...want, cap: 2_600n })).toMatchObject({ ok: false, rule: "amount" });
    expect(checkTokenReserveCreation(tx, inputs, { ...want, ergValue: TOKEN_RESERVE_BOX_NANOERG + MIN_BOX_NANOERG })).toMatchObject({ ok: false, rule: "amount" });
  });

  it("refuses a box not at the owner's key", () => {
    const foreign = p2pkBox(keyPairFromSecret(2n).pubHex, 50_000_000n);
    const t = buildTokenReserveCreation({ ...want, inputs: [tokenBox, foreign] });
    expect(checkTokenReserveCreation(t, [tokenBox, foreign], want)).toMatchObject({ ok: false, rule: "inputs" });
  });
});
