// Token reserves (basis-token.es): the box read in its denomination, top-up / refund start / completion built, L1 with
// mutations, L2 (the contract engine with avl.wasm) and the signer, on synthetic boxes with known keys.
import { beforeAll, describe, expect, it } from "vitest";
import type { AvlBackend } from "../../protocol/avl";
import { keyPairFromSecret } from "../../protocol/keys";
import { encodeLong } from "../../protocol/registers";
import { FEE_TREE_HEX, MINER_FEE_NANOERG, RESERVE_TREE_HEX, p2pkTree } from "./constants";
import { checkReserveActionContract, loadContractAvl } from "./contract";
import type { ErgoBox, UnsignedTx } from "./model";
import { REFUND_PERIOD_BLOCKS, buildRefundComplete, buildRefundStart, buildTopUp, checkReserveAction, readAnyReserve, readReserve, signReserveAction, verifyReserveAction, type ReserveActionWant } from "./reserveaction";
import { p2pkBox, reserveBox, secretBytes } from "./testkit";
import { RSADA_TOKEN_ID, SIGUSD_TOKEN_ID, TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX } from "./tokens";

let avl: AvlBackend;
beforeAll(async () => {
  avl = await loadContractAvl();
});

const FEE = MINER_FEE_NANOERG;
const TIP = 1_925_000;
const SIG = `token:${SIGUSD_TOKEN_ID}` as const;
const ADA = `token:${RSADA_TOKEN_ID}` as const;
const payer = keyPairFromSecret(2n);
const owner = keyPairFromSecret(3n);
const NFT = "a7".repeat(32);
const OTHER = "c9".repeat(32);
const tokenReserve = (amount: bigint, o: { r7?: bigint; value?: bigint } = {}) =>
  reserveBox(owner.pubHex, o.value ?? TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount }], r7: o.r7 });
const clone = (tx: UnsignedTx): UnsignedTx => ({ inputs: tx.inputs.map((i) => ({ boxId: i.boxId, extension: i.extension.map((e) => ({ ...e })) })), dataInputs: [...tx.dataInputs], outputs: tx.outputs.map((o) => ({ ...o, tokens: o.tokens.map((t) => ({ ...t })), registers: [...o.registers] })) });

describe("a token reserve box", () => {
  const box = tokenReserve(500n);
  it("reads in its own denomination only", () => {
    const r = readReserve(box, SIG);
    if (!r.ok) throw new Error(r.message);
    expect(r.info).toMatchObject({ owner: owner.pubHex, nft: NFT, refundHeight: 0n, denom: SIG, collateral: 500n });
    expect(r.info.token?.symbol).toBe("SigUSD");
    expect(readReserve(box)).toMatchObject({ ok: false, rule: "contract" });
    expect(readReserve(box, ADA)).toMatchObject({ ok: false, rule: "tokens" });
    expect(readReserve(box, `token:${"03".repeat(32)}`)).toMatchObject({ ok: false, rule: "contract" });
    expect(readAnyReserve(box).ok && readAnyReserve(box)).toMatchObject({ info: { denom: SIG } });
    // an ERG reserve is not read as a token reserve
    expect(readReserve(reserveBox(owner.pubHex, 10n ** 9n), SIG)).toMatchObject({ ok: false, rule: "contract" });
  });

  it.each<[string, () => ErgoBox]>([
    ["one token only", () => reserveBox(owner.pubHex, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX })],
    ["three tokens", () => reserveBox(owner.pubHex, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }, { tokenId: OTHER, amount: 1n }] })],
    ["the NFT amount 2", () => reserveBox(owner.pubHex, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 2n }, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }] })],
    ["the ERG tree with the token", () => reserveBox(owner.pubHex, TOKEN_RESERVE_BOX_NANOERG, { tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }] })],
  ])("refuses %s", (_n, b) => expect(readReserve(b(), SIG).ok).toBe(false));
});

describe("token top-up", () => {
  const reserve = tokenReserve(500n);
  const coins = [p2pkBox(payer.pubHex, 5_000_000n, { index: 1, tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }, { tokenId: OTHER, amount: 7n }] })];
  const amount = 200n;
  const tx = buildTopUp({ reserve, payer: payer.pubHex, inputs: coins, amount, fee: FEE, height: TIP, denom: SIG });
  const inputs = [reserve, ...coins];
  const want: ReserveActionWant = { kind: "topup", signer: payer.pubHex, height: TIP, fee: FEE, amount, denom: SIG };

  it("adds the tokens, keeps the ERG; the change keeps the rest and every other token", () => {
    expect(tx.outputs[0]).toMatchObject({ value: reserve.value, ergoTree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: NFT, amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 700n }] });
    expect(tx.outputs[0].registers).toEqual(reserve.registers);
    expect(tx.outputs[1]).toMatchObject({ value: 4_000_000n, ergoTree: p2pkTree(payer.pubHex), tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 100n }, { tokenId: OTHER, amount: 7n }] });
    expect(tx.outputs[2].ergoTree).toBe(FEE_TREE_HEX);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
  });

  it("is refused without the denomination (the screen asked for ERG) and under another token", () => {
    expect(checkReserveAction(tx, inputs, { ...want, denom: undefined })).toMatchObject({ ok: false, rule: "reserve" });
    expect(checkReserveAction(tx, inputs, { ...want, denom: ADA })).toMatchObject({ ok: false, rule: "reserve" });
  });

  it("L2: the token contract accepts it as a top-up into output 0, no signature", () => {
    const r = checkReserveActionContract(tx, inputs, "topup", [], TIP + 1, avl);
    if (!r.ok) throw new Error(`${r.rule}: ${r.message}`);
    expect(r.eval?.contract).toBe("basis-token.es");
    expect(r.eval?.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["tokenIdsPreserved", "ergPreserved", "topUpAmount"]));
  });

  const mutations: [string, string, (t: UnsignedTx) => void][] = [
    ["ERG taken out of the reserve", "reserve-output", (t) => { t.outputs[0].value -= 1n; t.outputs[1].value += 1n; }],
    ["one token unit less in the reserve", "reserve-output", (t) => { t.outputs[0].tokens[1].amount -= 1n; t.outputs[1].tokens[0].amount += 1n; }],
    ["the reserve under the ERG tree", "reserve-output", (t) => { t.outputs[0].ergoTree = RESERVE_TREE_HEX; }],
    ["another token left out of the change", "change-output", (t) => { t.outputs[1].tokens = t.outputs[1].tokens.slice(0, 1); }],
    ["the token's rest burned", "change-output", (t) => { t.outputs[1].tokens = t.outputs[1].tokens.slice(1); }],
    ["R5 changed", "reserve-output", (t) => { t.outputs[0].registers[1] = t.outputs[0].registers[1].replace(/.{2}$/, "01"); }],
  ];
  it.each(mutations)("L1 refuses %s", (_n, rule, f) => {
    const t = clone(tx);
    f(t);
    expect(checkReserveAction(t, inputs, want)).toMatchObject({ ok: false, rule });
  });

  it("refuses less than one whole token (our floor) and more tokens than the boxes hold", () => {
    expect(() => buildTopUp({ reserve, payer: payer.pubHex, inputs: coins, amount: 99n, fee: FEE, height: TIP, denom: SIG })).toThrow();
    expect(checkReserveAction(tx, inputs, { ...want, amount: 99n })).toMatchObject({ ok: false, rule: "amount" });
    expect(() => buildTopUp({ reserve, payer: payer.pubHex, inputs: coins, amount: 301n, fee: FEE, height: TIP, denom: SIG })).toThrow();
  });

  it("dust below 0.001 ERG goes into the box, never to the miner", () => {
    const tight = [p2pkBox(payer.pubHex, 1_400_000n, { index: 3, tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 200n }] })];
    const t = buildTopUp({ reserve, payer: payer.pubHex, inputs: tight, amount: 200n, fee: FEE, height: TIP, denom: SIG, add: 400_000n });
    expect(t.outputs.length).toBe(2);
    expect(t.outputs[0].value).toBe(reserve.value + 400_000n);
    expect(checkReserveAction(t, [reserve, ...tight], { ...want, add: 400_000n })).toEqual({ ok: true });
    expect(checkReserveAction(t, [reserve, ...tight], want)).toMatchObject({ ok: false });
    expect(checkReserveActionContract(t, [reserve, ...tight], "topup", [], TIP + 1, avl).ok).toBe(true);
  });

  it("signs: the reserve input with no proof, the payer's boxes proved", () => {
    const s = signReserveAction(tx, inputs, secretBytes(payer.secret), "topup");
    expect(s.signed.inputs[0].proof).toBe("");
    expect(verifyReserveAction(s.signed, inputs, "topup")).toBe(true);
  });
});

describe("token refund", () => {
  const reserve = tokenReserve(500n);
  const fees = [p2pkBox(owner.pubHex, 3_000_000n, { index: 4 })];
  const r7 = BigInt(TIP + 10);
  const start = buildRefundStart({ reserve, owner: owner.pubHex, inputs: fees, fee: FEE, height: TIP, refundHeight: r7 });
  const startWant: ReserveActionWant = { kind: "refund-start", signer: owner.pubHex, height: TIP, fee: FEE, refundHeight: r7, denom: SIG };

  it("start: both tokens and the ERG kept, R7 set; L1 and L2 pass; the owner signs", () => {
    expect(start.outputs[0]).toMatchObject({ value: reserve.value, tokens: reserve.tokens });
    expect(start.outputs[0].registers[3]).toBe(encodeLong(r7));
    expect(checkReserveAction(start, [reserve, ...fees], startWant)).toEqual({ ok: true });
    const l2 = checkReserveActionContract(start, [reserve, ...fees], "refund-start", [owner.pubHex], TIP + 1, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    expect(checkReserveActionContract(start, [reserve, ...fees], "refund-start", [payer.pubHex], TIP + 1, avl).ok).toBe(false);
    const s = signReserveAction(start, [reserve, ...fees], secretBytes(owner.secret), "refund-start");
    expect(verifyReserveAction(s.signed, [reserve, ...fees], "refund-start")).toBe(true);
    const bad = clone(start);
    bad.outputs[0].tokens[1].amount -= 1n;
    expect(checkReserveAction(bad, [reserve, ...fees], startWant)).toMatchObject({ ok: false, rule: "reserve-output" });
  });

  it("completion: the fee from the box's 0.002 ERG; the owner gets 0.001 ERG with the NFT and every token", () => {
    const started = tokenReserve(500n, { r7: 1_800_000n });
    const tip = 1_800_000 + REFUND_PERIOD_BLOCKS;
    const end = buildRefundComplete({ reserve: started, owner: owner.pubHex, fee: FEE, height: tip });
    expect(end.outputs[0]).toMatchObject({ value: TOKEN_RESERVE_BOX_NANOERG - FEE, ergoTree: p2pkTree(owner.pubHex), tokens: started.tokens });
    const want: ReserveActionWant = { kind: "refund-end", signer: owner.pubHex, height: tip, fee: FEE, denom: SIG };
    expect(checkReserveAction(end, [started], want)).toEqual({ ok: true });
    const l2 = checkReserveActionContract(end, [started], "refund-end", [owner.pubHex], tip + 1, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    expect(checkReserveAction(end, [started], { ...want, height: tip - 2 })).toMatchObject({ ok: false, rule: "refund-state" });
    const burn = clone(end);
    burn.outputs[0].tokens = burn.outputs[0].tokens.slice(0, 1);
    expect(checkReserveAction(burn, [started], want)).toMatchObject({ ok: false });
  });
});
