// T1 (design §2) and Withdraw: the tracker's payload checked byte for byte, our builder against the chain's T1, the
// checks, coin selection and P2PK signing with a synthetic key.
import { describe, expect, it } from "vitest";
import { bytesToHex } from "../../protocol/bytes";
import { keyPairFromSecret } from "../../protocol/keys";
import { p2pkAddress, p2sAddress } from "./address";
import {
  BROADCAST_BODY_MAX_BYTES, EMPTY_RESERVE_R5, FEE_TREE_HEX, MIN_BOX_NANOERG, NANOERG_PER_ERG, RESERVE_TREE_HEX, TRACKER_NFT, p2pkTree, reserveAddress,
} from "./constants";
import { ISSUER_A, RECEIVER_B, T1 } from "./fixtures/chain";
import { parseJson, utf8Length } from "./json";
import { nodeTxFromJson, type UnsignedTx } from "./model";
import {
  buildReserveCreation, buildWithdraw, checkReserveCreation, checkReservePayload, checkWithdraw, P2PK_MAX_INPUTS, parseReservePayload, planReserveCreation, reserveRegisters,
  selectCoins, signP2pkTransaction, verifyP2pkTransaction,
} from "./p2pk";
import { computeTxId, serializeCandidate } from "./serialize";
import { secretBytes, p2pkBox, trackerRefusal } from "./testkit";

const ERG = NANOERG_PER_ERG;
const FEE = 1_000_000n;

function payloadText(o: { owner?: string; address?: string; value?: bigint; nft?: string; amount?: number; registers?: Record<string, string>; fee?: bigint; change?: string; requests?: number } = {}): string {
  const owner = o.owner ?? ISSUER_A;
  const regs = o.registers ?? { R6: `0e20${TRACKER_NFT}`, R4: `07${owner}`, R7: "0500", R5: EMPTY_RESERVE_R5 }; // HashMap order
  const req = `{"address":"${o.address ?? reserveAddress()}","value":${o.value ?? ERG},"assets":[{"token_id":"${o.nft ?? T1.v1.inputs[0].boxId}","amount":${o.amount ?? 1}}],"registers":${JSON.stringify(regs)}}`;
  const reqs = Array(o.requests ?? 1).fill(req).join(",");
  return `{"success":true,"data":{"requests":[${reqs}],"fee":${o.fee ?? FEE},"change_address":"${o.change ?? p2pkAddress(owner)}"},"error":null}`;
}

describe("T1: the tracker's payload", () => {
  const want = { owner: ISSUER_A, amount: ERG, nftId: T1.v1.inputs[0].boxId };

  it("passes when it is the pinned template", () => {
    const p = parseReservePayload(payloadText());
    expect(p).toMatchObject({ requestCount: 1, value: ERG, fee: FEE, address: reserveAddress() });
    expect(checkReservePayload(p, want)).toEqual({ ok: true });
  });

  it.each<[string, Parameters<typeof payloadText>[0], string]>([
    ["two requests", { requests: 2 }, "requests"],
    ["the fee contract's address", { address: p2sAddress(FEE_TREE_HEX) }, "address"],
    ["a P2PK address", { address: p2pkAddress(RECEIVER_B) }, "address"],
    ["another value", { value: 2n * ERG }, "value"],
    ["another NFT id", { nft: "00".repeat(32) }, "assets"],
    ["two NFT units", { amount: 2 }, "assets"],
    ["an R8", { registers: { R4: `07${ISSUER_A}`, R5: EMPTY_RESERVE_R5, R6: `0e20${TRACKER_NFT}`, R7: "0500", R8: "0500" } }, "registers"],
    ["another owner in R4", { registers: { R4: `07${RECEIVER_B}`, R5: EMPTY_RESERVE_R5, R6: `0e20${TRACKER_NFT}`, R7: "0500" } }, "registers"],
    ["a refund already started", { registers: { R4: `07${ISSUER_A}`, R5: EMPTY_RESERVE_R5, R6: `0e20${TRACKER_NFT}`, R7: "0502" } }, "registers"],
    ["bytes after R5", { registers: { R4: `07${ISSUER_A}`, R5: `${EMPTY_RESERVE_R5}00`, R6: `0e20${TRACKER_NFT}`, R7: "0500" } }, "registers"],
    ["a fee above 2 M", { fee: 2_000_001n }, "fee"],
    ["a fee below 1 M", { fee: 999_999n }, "fee"],
    ["change to someone else", { change: p2pkAddress(RECEIVER_B) }, "change-address"],
  ])("refuses %s", (_name, o, rule) => {
    const r = checkReservePayload(parseReservePayload(payloadText(o)), want);
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });

  it("passes a refusal through", () => {
    expect(() => parseReservePayload(trackerRefusal("tracker starting"))).toThrow(/tracker starting/);
  });
});

describe("T1: the transaction", () => {
  const inBox = T1.v1.inputs[0];
  const height = T1.v1.outputs[0].creationHeight;
  const ours = () => buildReserveCreation({ owner: ISSUER_A, inputs: [inBox], amount: ERG, fee: FEE, height });

  it("builds the chain's reserve box byte for byte; in the chain's output order it is the chain's T1", () => {
    const tx = ours();
    expect(tx.outputs.map((o) => o.value)).toEqual([ERG, inBox.value - ERG - FEE, FEE]);
    expect(bytesToHex(serializeCandidate(tx.outputs[0]))).toBe(bytesToHex(serializeCandidate(T1.v1.outputs[0])));
    // The canary put the fee before the change; we write [reserve, change, fee] (design §2.2).
    expect(computeTxId({ ...tx, outputs: [tx.outputs[0], tx.outputs[2], tx.outputs[1]] })).toBe(T1.v1.id);
    expect(checkReserveCreation(tx, [inBox], { owner: ISSUER_A, amount: ERG, fee: FEE, height })).toEqual({ ok: true });
  });

  it("the chain's own T1 layout [reserve, fee, change] is not ours and is refused", () => {
    expect(checkReserveCreation(T1.unsigned, [inBox], { owner: ISSUER_A, amount: ERG, fee: FEE, height }).ok).toBe(false);
  });

  type Mut = (tx: UnsignedTx) => void;
  it.each<[string, Mut, string, Partial<{ amount: bigint; cap: bigint; fee: bigint }>?]>([
    ["an amount above the default cap", () => {}, "amount", { amount: ERG, cap: ERG / 2n }],
    ["a cap above 10 ERG", () => {}, "amount", { cap: 11n * ERG }],
    ["an amount below 0.1 ERG", () => {}, "amount", { amount: ERG / 20n }],
    ["a fee outside 1–2 M", () => {}, "fee", { fee: 3_000_000n }],
    ["a data input", (t) => (t.dataInputs = ["00".repeat(32)]), "inputs"],
    ["an extension", (t) => (t.inputs[0].extension = [{ key: 0, value: "0200" }]), "inputs"],
    ["the reserve to another script", (t) => (t.outputs[0].ergoTree = p2pkTree(ISSUER_A)), "reserve-output"],
    ["two NFT units", (t) => (t.outputs[0].tokens = [{ ...t.outputs[0].tokens[0], amount: 2n }]), "reserve-output"],
    ["another NFT id", (t) => (t.outputs[0].tokens = [{ tokenId: "00".repeat(32), amount: 1n }]), "reserve-output"],
    ["an R8 on the reserve", (t) => t.outputs[0].registers.push("0500"), "reserve-output"],
    ["the change to someone else", (t) => (t.outputs[1].ergoTree = p2pkTree(RECEIVER_B)), "change-output"],
    ["a token minted in the change", (t) => (t.outputs[1].tokens = [{ tokenId: "11".repeat(32), amount: 5n }]), "change-output"],
    ["the fee to the owner", (t) => (t.outputs[2].ergoTree = p2pkTree(ISSUER_A)), "fee-output"],
    ["a fourth output", (t) => t.outputs.push({ ...t.outputs[2] }), "outputs"],
    ["another creation height", (t) => (t.outputs[2].creationHeight = height + 1), "creation-height"],
    ["ERG out of balance", (t) => (t.outputs[1].value = t.outputs[1].value - 1n), "totals"],
  ])("refuses %s", (_name, mutate, rule, w) => {
    const tx = ours();
    mutate(tx);
    const r = checkReserveCreation(tx, [inBox], { owner: ISSUER_A, amount: w?.amount ?? ERG, fee: w?.fee ?? FEE, height, cap: w?.cap });
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });

  it("refuses inputs that are not verified owner boxes", () => {
    const tx = ours();
    expect(checkReserveCreation(tx, [{ ...inBox, value: inBox.value + 1n }], { owner: ISSUER_A, amount: ERG, fee: FEE, height }).ok).toBe(false);
    expect(checkReserveCreation(tx, [inBox], { owner: RECEIVER_B, amount: ERG, fee: FEE, height }).ok).toBe(false);
    const twice = { ...tx, inputs: [tx.inputs[0], tx.inputs[0]] };
    const r = checkReserveCreation(twice, [inBox, inBox], { owner: ISSUER_A, amount: ERG, fee: FEE, height });
    expect(r.ok ? "ok" : r.rule).toBe("inputs");
  });

  it("the chain's T1 proof verifies as a P2PK transaction", () => {
    expect(verifyP2pkTransaction(T1.signed, T1.v1.inputs)).toBe(true);
    expect(verifyP2pkTransaction({ ...T1.signed, outputs: T1.signed.outputs.slice(0, 2) }, T1.v1.inputs)).toBe(false);
  });
});

describe("coins, signing and broadcast JSON (synthetic key)", () => {
  const me = keyPairFromSecret(11n);
  const secret = secretBytes(11n);
  const height = 1_922_500;

  it("plans, builds, checks and signs a T1", () => {
    const boxes = [p2pkBox(me.pubHex, 300_000_000n, { index: 0 }), p2pkBox(me.pubHex, 1_500_000_000n, { index: 1 })];
    const plan = planReserveCreation(boxes, me.pubHex, ERG, FEE)!;
    expect(plan.inputs.map((b) => b.boxId)).toEqual([boxes[1].boxId]); // largest token-free box first
    expect(plan).toMatchObject({ amount: ERG, nftId: boxes[1].boxId, change: 499_000_000n });
    const tx = buildReserveCreation({ owner: me.pubHex, inputs: plan.inputs, amount: plan.amount, fee: FEE, height });
    expect(checkReserveCreation(tx, plan.inputs, { owner: me.pubHex, amount: plan.amount, fee: FEE, height })).toEqual({ ok: true });
    const { signed, txId, nodeJson } = signP2pkTransaction(tx, plan.inputs, secret);
    expect(txId).toBe(computeTxId(tx));
    expect(verifyP2pkTransaction(signed, plan.inputs)).toBe(true);
    expect(utf8Length(nodeJson)).toBeLessThan(BROADCAST_BODY_MAX_BYTES);
    const back = nodeTxFromJson(parseJson(nodeJson));
    expect(back.id).toBe(txId);
    expect(back.outputs[0].ergoTree).toBe(RESERVE_TREE_HEX);
    expect(back.outputs[0].registers).toEqual(reserveRegisters(me.pubHex));
    expect(() => signP2pkTransaction(tx, plan.inputs, secretBytes(12n))).toThrow();
  });

  it("dust goes to the reserve, or (above the cap) the amount drops so the change is 0.001 ERG", () => {
    const one = [p2pkBox(me.pubHex, ERG / 2n + FEE + 400_000n)];
    expect(planReserveCreation(one, me.pubHex, ERG / 2n, FEE)).toMatchObject({ amount: ERG / 2n + 400_000n, change: 0n });
    const atCap = [p2pkBox(me.pubHex, ERG + FEE + 400_000n)];
    const p = planReserveCreation(atCap, me.pubHex, ERG, FEE)!;
    expect(p).toMatchObject({ amount: ERG - (MIN_BOX_NANOERG - 400_000n), change: MIN_BOX_NANOERG });
    const tx = buildReserveCreation({ owner: me.pubHex, inputs: p.inputs, amount: p.amount, fee: FEE, height });
    expect(tx.outputs.map((o) => o.value)).toEqual([p.amount, MIN_BOX_NANOERG, FEE]);
    expect(checkReserveCreation(tx, p.inputs, { owner: me.pubHex, amount: p.amount, fee: FEE, height }).ok).toBe(true);
    expect(planReserveCreation([p2pkBox(me.pubHex, ERG)], me.pubHex, ERG, FEE)).toBeNull();
  });

  it("token boxes are spent only when needed, and their tokens always reach the change", () => {
    const tok = { tokenId: "7c".repeat(32), amount: 42n };
    const boxes = [p2pkBox(me.pubHex, 600_000_000n, { tokens: [tok], index: 0 }), p2pkBox(me.pubHex, 600_000_000n, { index: 1 })];
    expect(selectCoins(boxes, me.pubHex, 500_000_000n)!.tokens).toEqual([]);
    const sel = selectCoins(boxes, me.pubHex, 1_000_000_000n)!;
    expect(sel.tokens).toEqual([tok]);
    const tx = buildReserveCreation({ owner: me.pubHex, inputs: sel.inputs, amount: 1_000_000_000n - FEE, fee: FEE, height });
    expect(tx.outputs[1].tokens).toEqual([tok]);
    expect(checkReserveCreation(tx, sel.inputs, { owner: me.pubHex, amount: 1_000_000_000n - FEE, fee: FEE, height })).toEqual({ ok: true });
    // A token box with no room for a change box is not enough.
    expect(selectCoins([p2pkBox(me.pubHex, ERG + FEE, { tokens: [tok] })], me.pubHex, ERG + FEE)).toBeNull();
    expect(() => buildReserveCreation({ owner: me.pubHex, inputs: [p2pkBox(me.pubHex, ERG + FEE, { tokens: [tok] })], amount: ERG, fee: FEE, height })).toThrow();
    expect(() => selectCoins([{ ...boxes[0], value: 1n }], me.pubHex, 1n)).toThrow(/hash/);
    expect(() => selectCoins([p2pkBox(RECEIVER_B, ERG)], me.pubHex, 1n)).toThrow(/P2PK/);
  });

  it("withdraws to an address: [destination, change, fee], tokens stay with the owner", () => {
    const tok = { tokenId: "7c".repeat(32), amount: 42n };
    const inputs = [p2pkBox(me.pubHex, 700_000_000n, { tokens: [tok] })];
    const to = p2pkAddress(RECEIVER_B);
    const tx = buildWithdraw({ owner: me.pubHex, inputs, to, amount: 500_000_000n, fee: FEE, height });
    expect(tx.outputs.map((o) => [o.ergoTree, o.value])).toEqual([[p2pkTree(RECEIVER_B), 500_000_000n], [p2pkTree(me.pubHex), 199_000_000n], [FEE_TREE_HEX, FEE]]);
    expect(tx.outputs[1].tokens).toEqual([tok]);
    expect(checkWithdraw(tx, inputs, { owner: me.pubHex, to, amount: 500_000_000n, fee: FEE })).toEqual({ ok: true });
    const { signed } = signP2pkTransaction(tx, inputs, secret);
    expect(verifyP2pkTransaction(signed, inputs)).toBe(true);
    // Sweep without tokens: no change output.
    const free = [p2pkBox(me.pubHex, 300_000_000n)];
    const sweep = buildWithdraw({ owner: me.pubHex, inputs: free, to, amount: 300_000_000n - FEE, fee: FEE, height });
    expect(sweep.outputs.length).toBe(2);
    expect(checkWithdraw(sweep, free, { owner: me.pubHex, to, amount: 300_000_000n - FEE, fee: FEE })).toEqual({ ok: true });
  });

  it(`${P2PK_MAX_INPUTS} inputs always fit the broadcast route, for T1 and for a Withdraw to P2PK, with 15 token types`, () => {
    // The largest JSON: 19-digit token amounts, a 17-digit change (more than all ERG there is), the 10 ERG cap, 2M fee.
    const tokens = Array.from({ length: 15 }, (_, i) => ({ tokenId: i.toString(16).padStart(2, "0").repeat(32), amount: (1n << 62n) + BigInt(i) }));
    const big = 90_000_000n * ERG;
    const inputs = Array.from({ length: P2PK_MAX_INPUTS }, (_, i) => p2pkBox(me.pubHex, i === 0 ? big : 100_000_000n, { index: i, tokens: i === 0 ? tokens : [] }));
    const total = inputs.reduce((a, b) => a + b.value, 0n);
    const t1 = buildReserveCreation({ owner: me.pubHex, inputs, amount: 10n * ERG, fee: 2_000_000n, height });
    expect(String(t1.outputs[1].value).length).toBe(17);
    const wd = buildWithdraw({ owner: me.pubHex, inputs, to: p2pkAddress(me.pubHex), amount: total / 2n, fee: 2_000_000n, height });
    for (const tx of [t1, wd]) expect(utf8Length(signP2pkTransaction(tx, inputs, secret).nodeJson)).toBeLessThanOrEqual(BROADCAST_BODY_MAX_BYTES);
  });

  it("refuses to sign what the broadcast route would not take (16 KB)", () => {
    const inputs = Array.from({ length: 80 }, (_, i) => p2pkBox(me.pubHex, 10_000_000n, { index: i }));
    const tx = buildWithdraw({ owner: me.pubHex, inputs, to: p2pkAddress(RECEIVER_B), amount: 800_000_000n - FEE, fee: FEE, height });
    expect(() => signP2pkTransaction(tx, inputs, secret)).toThrow(/broadcast/);
  });

  it("refuses withdrawals to the reserve contract, the fee contract, P2SH or testnet, and dust", () => {
    const inputs = [p2pkBox(me.pubHex, 700_000_000n)];
    const w = { owner: me.pubHex, inputs, amount: 500_000_000n, fee: FEE, height };
    expect(() => buildWithdraw({ ...w, to: reserveAddress() })).toThrow(/reserve/);
    expect(() => buildWithdraw({ ...w, to: p2sAddress(FEE_TREE_HEX) })).toThrow(/fee/);
    expect(() => buildWithdraw({ ...w, to: p2pkAddress(RECEIVER_B, "testnet") })).toThrow();
    expect(() => buildWithdraw({ ...w, to: p2pkAddress(RECEIVER_B), amount: 999_999n })).toThrow();
    expect(() => buildWithdraw({ ...w, to: p2pkAddress(RECEIVER_B), amount: 700_000_000n - FEE - 1n })).toThrow(/change/);
    const tx = buildWithdraw({ ...w, to: p2pkAddress(RECEIVER_B) });
    const r = checkWithdraw(tx, inputs, { owner: me.pubHex, to: p2pkAddress(ISSUER_A), amount: 500_000_000n, fee: FEE });
    expect(r.ok ? "ok" : r.rule).toBe("destination");
  });
});
