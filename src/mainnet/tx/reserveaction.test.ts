// Top-up (#0 = 10), refund start (#0 = 20) and refund completion (#0 = 30): the reserve box read, the builders, L1
// with one mutation per rule, L2 (the contract engine with avl.wasm) on the real transaction, and the signer with
// synthetic keys. The top-up runs on the chain's own reserve box (R3's input, non-empty tree); the refund on a
// synthetic reserve whose owner key is known here.
import { beforeAll, describe, expect, it } from "vitest";
import type { AvlBackend } from "../../protocol/avl";
import { keyPairFromSecret } from "../../protocol/keys";
import { encodeLong } from "../../protocol/registers";
import { FEE_TREE_HEX, MINER_FEE_NANOERG, MIN_BOX_NANOERG, RESERVE_TREE_HEX, p2pkTree } from "./constants";
import { checkReserveActionContract, loadContractAvl } from "./contract";
import { ISSUER_A, R3_RESERVE_IN } from "./fixtures/chain";
import { parseJson } from "./json";
import { nodeTxFromJson, type ErgoBox, type UnsignedTx } from "./model";
import {
  REFUND_PERIOD_BLOCKS, REFUND_START_AHEAD, actionVar, buildRefundComplete, buildRefundStart, buildTopUp, checkReserveAction, readReserve, refundClock,
  signReserveAction, verifyReserveAction, type ReserveActionWant,
} from "./reserveaction";
import { computeBoxId, computeTxId } from "./serialize";
import { p2pkBox, reserveBox, secretBytes } from "./testkit";

let avl: AvlBackend;
beforeAll(async () => {
  avl = await loadContractAvl();
});

const FEE = MINER_FEE_NANOERG;
const ERG = 1_000_000_000n;
const TIP = 1_925_000;
const payer = keyPairFromSecret(2n);
const owner = keyPairFromSecret(3n);
const stranger = keyPairFromSecret(5n);
const sk = (k: typeof payer) => secretBytes(k.secret);

const clone = (tx: UnsignedTx): UnsignedTx => ({
  inputs: tx.inputs.map((i) => ({ boxId: i.boxId, extension: i.extension.map((e) => ({ ...e })) })),
  dataInputs: [...tx.dataInputs],
  outputs: tx.outputs.map((o) => ({ ...o, tokens: o.tokens.map((t) => ({ ...t })), registers: [...o.registers] })),
});

describe("the reserve box", () => {
  it("reads the chain's reserve (R3's input): owner, NFT, no refund", () => {
    const r = readReserve(R3_RESERVE_IN);
    if (!r.ok) throw new Error(r.message);
    expect(r.info.owner).toBe(ISSUER_A);
    expect(r.info.nft).toBe(R3_RESERVE_IN.tokens[0].tokenId);
    expect(r.info.refundHeight).toBe(0n);
  });

  it.each<[string, () => ErgoBox, string]>([
    ["a box that does not hash to its id", () => ({ ...reserveBox(owner.pubHex, ERG), value: 2n * ERG }), "box-id"],
    ["a legacy template (another tree)", () => reserveBox(owner.pubHex, ERG, { tree: `${RESERVE_TREE_HEX.slice(0, -2)}00` }), "contract"],
    ["a P2PK box", () => p2pkBox(owner.pubHex, ERG), "contract"],
    ["two tokens", () => reserveBox(owner.pubHex, ERG, { tokens: [{ tokenId: "a7".repeat(32), amount: 1n }, { tokenId: "b8".repeat(32), amount: 5n }] }), "tokens"],
    ["another tracker in R6", () => reserveBox(owner.pubHex, ERG, { r6: `0e20${"11".repeat(32)}` }), "tracker"],
  ])("refuses %s", (_n, box, rule) => {
    const r = readReserve(box());
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });

  it("refuses a non-canonical R7, an Int in R7 and an R5 that is not a tree", () => {
    const b = reserveBox(owner.pubHex, ERG);
    const withRegs = (regs: string[]): ErgoBox => {
      const body = { value: b.value, ergoTree: b.ergoTree, creationHeight: b.creationHeight, tokens: b.tokens, registers: regs, transactionId: b.transactionId, index: 0 };
      return { ...body, boxId: computeBoxId(body) };
    };
    expect(readReserve(withRegs(b.registers)).ok).toBe(true);
    for (const regs of [[...b.registers.slice(0, 3), "0400"], [...b.registers.slice(0, 3), "058000"], [b.registers[0], "0e0100", b.registers[2], b.registers[3]], b.registers.slice(0, 2)]) {
      const r = readReserve(withRegs(regs));
      expect(r.ok ? "ok" : r.rule).toBe("registers");
    }
  });

  it("reads a pending refund", () => {
    const r = readReserve(reserveBox(owner.pubHex, ERG, { r7: 1_924_000n }));
    expect(r.ok && r.info.refundHeight).toBe(1_924_000n);
  });

  it("counts the refund down to HEIGHT ≥ R7 + 43 200 (the next block is tip + 1)", () => {
    expect(refundClock(0n, TIP)).toBeNull();
    const r7 = 1_900_000n;
    const unlock = Number(r7) + REFUND_PERIOD_BLOCKS;
    expect(refundClock(r7, unlock - 2)).toEqual({ startedAt: r7, unlockAt: BigInt(unlock), blocksLeft: 1, open: false });
    expect(refundClock(r7, unlock - 1)).toMatchObject({ blocksLeft: 0, open: true });
    expect(refundClock(r7, unlock + 500)).toMatchObject({ blocksLeft: 0, open: true });
    expect(refundClock(r7, Number(r7))).toMatchObject({ blocksLeft: REFUND_PERIOD_BLOCKS - 1, open: false });
  });

  it("action bytes: 10, 20, 30 as Byte constants", () => {
    expect([actionVar("topup"), actionVar("refund-start"), actionVar("refund-end")]).toEqual(["020a", "0214", "021e"]);
  });
});

// ─── top-up ─────────────────────────────────────────────────────────────────────────────────────

describe("top-up", () => {
  const coins = [p2pkBox(payer.pubHex, 300_000_000n, { index: 1 }), p2pkBox(payer.pubHex, 50_000_000n, { index: 2, tokens: [{ tokenId: "c9".repeat(32), amount: 7n }] })];
  const amount = 200_000_000n;
  const reserve = R3_RESERVE_IN;
  const tx = buildTopUp({ reserve, payer: payer.pubHex, inputs: coins, amount, fee: FEE, height: TIP });
  const inputs = [reserve, ...coins];
  const want: ReserveActionWant = { kind: "topup", signer: payer.pubHex, height: TIP, fee: FEE, amount };

  it("builds [reserve + amount, change with every token, fee], the reserve's registers byte for byte", () => {
    expect(tx.inputs[0]).toEqual({ boxId: reserve.boxId, extension: [{ key: 0, value: "020a" }] });
    expect(tx.outputs.map((o) => o.value)).toEqual([reserve.value + amount, 350_000_000n - amount - FEE, FEE]);
    expect(tx.outputs[0].registers).toEqual(reserve.registers);
    expect(tx.outputs[0].tokens).toEqual(reserve.tokens);
    expect(tx.outputs[1]).toMatchObject({ ergoTree: p2pkTree(payer.pubHex), tokens: [{ tokenId: "c9".repeat(32), amount: 7n }] });
    expect(tx.outputs[2].ergoTree).toBe(FEE_TREE_HEX);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
  });

  it("L2: the contract accepts it as a top-up into output 0, with no signature of the reserve's owner", () => {
    const r = checkReserveActionContract(tx, inputs, "topup", [payer.pubHex], TIP + 1, avl);
    if (!r.ok) throw new Error(`${r.rule}: ${r.message}`);
    expect(r.eval?.actionName).toBe("top-up");
    expect(r.eval?.checks.map((c) => c.id)).toEqual(expect.arrayContaining(["uniqueReserveInput", "treePreserved", "refundPreserved", "topUpAmount"]));
    expect(checkReserveActionContract(tx, inputs, "topup", [], TIP + 1, avl).ok).toBe(true);
  });

  it("L2 takes the payer's boxes with registers the engine does not model (Int, SigmaProp, Coll[Coll[Byte]]) as opaque", () => {
    const odd = { ...p2pkBox(payer.pubHex, 300_000_000n, { index: 3 }), registers: ["0402", `08cd${payer.pubHex}`, "1a020101020203"] };
    const oddBox = { ...odd, boxId: computeBoxId(odd) };
    const t = buildTopUp({ reserve, payer: payer.pubHex, inputs: [oddBox], amount, fee: FEE, height: TIP });
    expect(checkReserveAction(t, [reserve, oddBox], want)).toEqual({ ok: true });
    const r = checkReserveActionContract(t, [reserve, oddBox], "topup", [payer.pubHex], TIP + 1, avl);
    if (!r.ok) throw new Error(`${r.rule}: ${r.message}`);
    // the reserve itself stays strict: an output reserve with an Int register is still refused
    const bad = clone(t);
    bad.outputs[0].registers = [...bad.outputs[0].registers.slice(0, 3), "0402"];
    expect(checkReserveActionContract(bad, [reserve, oddBox], "topup", [payer.pubHex], TIP + 1, avl).ok).toBe(false);
  });

  it("L2 refuses less than 0.1 ERG and a changed R5 (the contract's own rules)", () => {
    const small = clone(tx);
    small.outputs[0].value = reserve.value + 99_999_999n;
    small.outputs[1].value += amount - 99_999_999n;
    expect(checkReserveActionContract(small, inputs, "topup", [payer.pubHex], TIP + 1, avl)).toMatchObject({ ok: false, rule: "topUpAmount" });
    const tree = clone(tx);
    tree.outputs[0].registers[1] = `64ff${tree.outputs[0].registers[1].slice(4)}`;
    expect(checkReserveActionContract(tree, inputs, "topup", [payer.pubHex], TIP + 1, avl)).toMatchObject({ ok: false, rule: "treePreserved" });
  });

  it("signs only the payer's boxes: the reserve's proof stays empty, #0 = 10 in the node JSON", () => {
    const s = signReserveAction(tx, inputs, sk(payer), "topup");
    expect(s.txId).toBe(computeTxId(tx));
    expect(s.signed.inputs[0].proof).toBe("");
    expect(s.signed.inputs.slice(1).every((i) => i.proof.length === 112)).toBe(true);
    expect(verifyReserveAction(s.signed, inputs, "topup")).toBe(true);
    const back = nodeTxFromJson(parseJson(s.nodeJson), "node");
    expect(back.inputs[0]).toMatchObject({ boxId: reserve.boxId, extension: [{ key: 0, value: "020a" }] });
    expect(s.nodeJson).toContain(`"proofBytes":"","extension":{"0":"020a"}`);
  });

  it("the signer refuses boxes of another key", () => {
    expect(() => signReserveAction(tx, inputs, sk(stranger), "topup")).toThrow(/P2PK\(this key\)/);
  });

  it("works for the owner's own reserve too, and puts no change output when there is none", () => {
    const mine = reserveBox(payer.pubHex, 500_000_000n);
    const c = [p2pkBox(payer.pubHex, 100_000_000n + FEE, { index: 3 })];
    const t = buildTopUp({ reserve: mine, payer: payer.pubHex, inputs: c, amount: 100_000_000n, fee: FEE, height: TIP });
    expect(t.outputs.length).toBe(2);
    expect(checkReserveAction(t, [mine, ...c], { ...want, amount: 100_000_000n })).toEqual({ ok: true });
    expect(checkReserveActionContract(t, [mine, ...c], "topup", [payer.pubHex], TIP + 1, avl).ok).toBe(true);
  });

  type Mut = [string, (t: UnsignedTx, i: ErgoBox[], w: ReserveActionWant) => void, string];
  it.each<Mut>([
    ["a reserve in refund", (_t, i) => { i[0] = reserveBox(owner.pubHex, ERG, { r7: 5n }); }, "refund-state"],
    ["a legacy reserve", (_t, i) => { i[0] = reserveBox(owner.pubHex, ERG, { tree: `${RESERVE_TREE_HEX.slice(0, -2)}00` }); }, "reserve"],
    ["less than 0.1 ERG asked", (_t, _i, w) => { w.amount = 99_999_999n; }, "amount"],
    ["a fee of 0.0011 ERG", (_t, _i, w) => { w.fee = 1_100_000n; }, "fee"],
    ["a data input", (t) => { t.dataInputs.push("aa".repeat(32)); }, "inputs"],
    ["#0 = 20 on the reserve", (t) => { t.inputs[0].extension[0].value = "0214"; }, "action-var"],
    ["a second context variable", (t) => { t.inputs[0].extension.push({ key: 1, value: "0500" }); }, "action-var"],
    ["an extension on a payer box", (t) => { t.inputs[1].extension.push({ key: 0, value: "020a" }); }, "inputs"],
    ["a box of another key", (_t, i) => { i[1] = p2pkBox(stranger.pubHex, 300_000_000n, { index: 1 }); }, "inputs"],
    ["four outputs", (t) => { t.outputs.splice(2, 0, { ...t.outputs[1] }); }, "outputs"],
    ["another owner in R4", (t) => { t.outputs[0].registers[0] = `07${stranger.pubHex}`; }, "reserve-output"],
    ["R7 changed", (t) => { t.outputs[0].registers[3] = encodeLong(9n); }, "reserve-output"],
    ["the NFT moved out", (t) => { t.outputs[0].tokens = []; }, "reserve-output"],
    ["a smaller top-up than asked", (t) => { t.outputs[0].value -= 1n; t.outputs[1].value += 1n; }, "reserve-output"],
    ["change to another key", (t) => { t.outputs[1].ergoTree = p2pkTree(stranger.pubHex); }, "change-output"],
    ["a token left out of the change", (t) => { t.outputs[1].tokens = []; }, "change-output"],
    ["a fee output of another tree", (t) => { t.outputs[2].ergoTree = p2pkTree(stranger.pubHex); }, "fee-output"],
    ["another creation height", (t) => { t.outputs[2].creationHeight = TIP - 1; }, "creation-height"],
    ["ERG left to the miner", (t) => { t.outputs[1].value -= 5n; }, "totals"],
  ])("L1 refuses %s", (_n, mutate, rule) => {
    const t = clone(tx);
    const i = [...inputs];
    const w = { ...want };
    mutate(t, i, w);
    const r = checkReserveAction(t, i, w);
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });

  it("the builder refuses less than 0.1 ERG and change below 0.001 ERG", () => {
    expect(() => buildTopUp({ reserve, payer: payer.pubHex, inputs: coins, amount: 99_999_999n, fee: FEE, height: TIP })).toThrow(/at least/);
    const exact = [p2pkBox(payer.pubHex, 100_000_000n + FEE + 1n)];
    expect(() => buildTopUp({ reserve, payer: payer.pubHex, inputs: exact, amount: 100_000_000n, fee: FEE, height: TIP })).toThrow(/below/);
  });
});

// ─── refund start ───────────────────────────────────────────────────────────────────────────────

describe("refund start", () => {
  const reserve = reserveBox(owner.pubHex, 400_000_000n);
  const coins = [p2pkBox(owner.pubHex, 20_000_000n, { index: 4 })];
  const r7 = BigInt(TIP + REFUND_START_AHEAD);
  const tx = buildRefundStart({ reserve, owner: owner.pubHex, inputs: coins, fee: FEE, height: TIP, refundHeight: r7 });
  const inputs = [reserve, ...coins];
  const want: ReserveActionWant = { kind: "refund-start", signer: owner.pubHex, height: TIP, fee: FEE, refundHeight: r7 };

  it("builds [the reserve with R7 = tip + 10, change, fee]; the value stays, the fee comes from the owner's box", () => {
    expect(tx.inputs[0].extension).toEqual([{ key: 0, value: "0214" }]);
    expect(tx.outputs[0].value).toBe(reserve.value);
    expect(tx.outputs[0].registers).toEqual([...reserve.registers.slice(0, 3), encodeLong(r7)]);
    expect(tx.outputs.map((o) => o.value)).toEqual([reserve.value, 20_000_000n - FEE, FEE]);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
  });

  it("L2: the contract accepts it at the next block and up to R7 itself, signed by the owner", () => {
    for (const h of [TIP + 1, Number(r7)]) {
      const r = checkReserveActionContract(tx, inputs, "refund-start", [owner.pubHex], h, avl);
      if (!r.ok) throw new Error(`${h} ${r.rule}: ${r.message}`);
      expect(r.eval?.actionName).toBe("initiate-refund");
    }
  });

  it("L2 refuses it in a block after R7, without the owner's signature, and on a reserve already in refund", () => {
    expect(checkReserveActionContract(tx, inputs, "refund-start", [owner.pubHex], Number(r7) + 1, avl)).toMatchObject({ ok: false, rule: "refundHeightValid" });
    expect(checkReserveActionContract(tx, inputs, "refund-start", [payer.pubHex], TIP + 1, avl)).toMatchObject({ ok: false, rule: "ownerSignature" });
    const started = reserveBox(owner.pubHex, 400_000_000n, { r7: 1_900_000n });
    const again = buildRefundStart({ reserve: started, owner: owner.pubHex, inputs: coins, fee: FEE, height: TIP, refundHeight: r7 });
    expect(checkReserveActionContract(again, [started, ...coins], "refund-start", [owner.pubHex], TIP + 1, avl)).toMatchObject({ ok: false, rule: "refundNotStarted" });
    expect(checkReserveAction(again, [started, ...coins], want)).toMatchObject({ ok: false, rule: "refund-state" });
  });

  it("signs the reserve with the owner's key (proveDlog) and the fee box; another key cannot", () => {
    const s = signReserveAction(tx, inputs, sk(owner), "refund-start");
    expect(s.signed.inputs.map((i) => i.proof.length)).toEqual([112, 112]);
    expect(verifyReserveAction(s.signed, inputs, "refund-start")).toBe(true);
    expect(s.nodeJson).toContain(`"extension":{"0":"0214"}`);
    expect(() => signReserveAction(tx, inputs, sk(payer), "refund-start")).toThrow(/owner/);
  });

  it("puts change below 0.001 ERG into the reserve, never to the miner", () => {
    const c = [p2pkBox(owner.pubHex, FEE + 400_000n, { index: 5 })];
    const t = buildRefundStart({ reserve, owner: owner.pubHex, inputs: c, fee: FEE, height: TIP, refundHeight: r7, add: 400_000n });
    expect(t.outputs.map((o) => o.value)).toEqual([reserve.value + 400_000n, FEE]);
    expect(checkReserveAction(t, [reserve, ...c], want)).toEqual({ ok: true });
    expect(checkReserveActionContract(t, [reserve, ...c], "refund-start", [owner.pubHex], TIP + 1, avl).ok).toBe(true);
    expect(() => buildRefundStart({ reserve, owner: owner.pubHex, inputs: c, fee: FEE, height: TIP, refundHeight: r7, add: MIN_BOX_NANOERG })).toThrow();
  });

  type Mut = [string, (t: UnsignedTx, i: ErgoBox[], w: ReserveActionWant) => void, string];
  it.each<Mut>([
    ["another key's reserve", (_t, _i, w) => { w.signer = payer.pubHex; }, "owner"],
    ["R7 at the tip (backdated for the next block)", (_t, _i, w) => { w.refundHeight = BigInt(TIP); }, "refund-state"],
    ["R7 far ahead", (_t, _i, w) => { w.refundHeight = BigInt(TIP + 21); }, "refund-state"],
    ["R7 not what was asked", (t) => { t.outputs[0].registers[3] = encodeLong(r7 + 1n); }, "reserve-output"],
    ["R5 changed", (t) => { t.outputs[0].registers[1] = `64ff${t.outputs[0].registers[1].slice(4)}`; }, "reserve-output"],
    ["value taken out", (t) => { t.outputs[0].value -= 1n; t.outputs[1].value += 1n; }, "reserve-output"],
    ["a top-up's #0", (t) => { t.inputs[0].extension[0].value = "020a"; }, "action-var"],
    ["no fee box", (t, i) => { t.inputs.pop(); i.pop(); }, "inputs"],
  ])("L1 refuses %s", (_n, mutate, rule) => {
    const t = clone(tx);
    const i = [...inputs];
    const w = { ...want };
    mutate(t, i, w);
    const r = checkReserveAction(t, i, w);
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });
});

// ─── refund completion ──────────────────────────────────────────────────────────────────────────

describe("refund completion", () => {
  const r7 = 1_900_000n;
  const unlock = Number(r7) + REFUND_PERIOD_BLOCKS;
  const tipOpen = unlock - 1; // the next block is the first that may hold it
  const reserve = reserveBox(owner.pubHex, 400_000_000n, { r7 });
  const tx = buildRefundComplete({ reserve, owner: owner.pubHex, fee: FEE, height: tipOpen });
  const want: ReserveActionWant = { kind: "refund-end", signer: owner.pubHex, height: tipOpen, fee: FEE };

  it("builds [everything less the fee, with the NFT, to the owner, fee] from the reserve alone", () => {
    expect(tx.inputs).toEqual([{ boxId: reserve.boxId, extension: [{ key: 0, value: "021e" }] }]);
    expect(tx.outputs.map((o) => [o.ergoTree, o.value])).toEqual([[p2pkTree(owner.pubHex), reserve.value - FEE], [FEE_TREE_HEX, FEE]]);
    expect(tx.outputs[0].tokens).toEqual(reserve.tokens);
    expect(checkReserveAction(tx, [reserve], want)).toEqual({ ok: true });
  });

  it("L2: the contract accepts it from HEIGHT = R7 + 43 200 on, and refuses one block earlier", () => {
    const ok = checkReserveActionContract(tx, [reserve], "refund-end", [owner.pubHex], unlock, avl);
    if (!ok.ok) throw new Error(`${ok.rule}: ${ok.message}`);
    expect(ok.eval?.actionName).toBe("complete-refund");
    expect(checkReserveActionContract(tx, [reserve], "refund-end", [owner.pubHex], unlock - 1, avl)).toMatchObject({ ok: false, rule: "refundPeriodOver" });
    expect(checkReserveActionContract(tx, [reserve], "refund-end", [payer.pubHex], unlock, avl)).toMatchObject({ ok: false, rule: "ownerSignature" });
  });

  it("L1 keeps the button shut until then, and refuses a reserve with no refund started", () => {
    expect(checkReserveAction(tx, [reserve], { ...want, height: tipOpen - 1 })).toMatchObject({ ok: false, rule: "refund-state" });
    const fresh = reserveBox(owner.pubHex, 400_000_000n);
    const t = buildRefundComplete({ reserve: fresh, owner: owner.pubHex, fee: FEE, height: tipOpen });
    expect(checkReserveAction(t, [fresh], want)).toMatchObject({ ok: false, rule: "refund-state" });
    expect(checkReserveActionContract(t, [fresh], "refund-end", [owner.pubHex], unlock, avl)).toMatchObject({ ok: false, rule: "refundStarted" });
  });

  it.each<[string, (t: UnsignedTx) => void, string]>([
    ["the payout to another key", (t) => { t.outputs[0].ergoTree = p2pkTree(stranger.pubHex); }, "payout-output"],
    ["the NFT burned", (t) => { t.outputs[0].tokens = []; }, "payout-output"],
    ["a bigger fee", (t) => { t.outputs[0].value -= 1n; t.outputs[1].value += 1n; }, "payout-output"],
    ["a third output", (t) => { t.outputs.splice(1, 0, { ...t.outputs[1] }); }, "outputs"],
  ])("L1 refuses %s", (_n, mutate, rule) => {
    const t = clone(tx);
    mutate(t);
    const r = checkReserveAction(t, [reserve], want);
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });

  it("signs with the owner's key; the builder refuses a reserve too small to pay the fee", () => {
    const s = signReserveAction(tx, [reserve], sk(owner), "refund-end");
    expect(verifyReserveAction(s.signed, [reserve], "refund-end")).toBe(true);
    expect(s.nodeJson).toContain(`"extension":{"0":"021e"}`);
    expect(() => buildRefundComplete({ reserve: reserveBox(owner.pubHex, FEE + MIN_BOX_NANOERG - 1n, { r7 }), owner: owner.pubHex, fee: FEE, height: tipOpen })).toThrow(/too little/);
  });
});

describe("a reserve without R7 (wallet-t3: the contract reads SELF.R7[Long].getOrElse(0L), l. 234; so does the tracker)", () => {
  const bare = reserveBox(owner.pubHex, 400_000_000n, { r7: null });
  const coins = [p2pkBox(owner.pubHex, 300_000_000n, { index: 6 })];
  const inputs = [bare, ...coins];

  it("reads as R7 = 0; still nothing but R4–R6 or R4–R7", () => {
    expect(bare.registers).toHaveLength(3);
    const r = readReserve(bare);
    if (!r.ok) throw new Error(r.message);
    expect(r.info).toMatchObject({ owner: owner.pubHex, refundHeight: 0n });
    const withRegs = (regs: string[]) => {
      const body = { value: bare.value, ergoTree: bare.ergoTree, creationHeight: bare.creationHeight, tokens: bare.tokens, registers: regs, transactionId: bare.transactionId, index: 0 };
      return { ...body, boxId: computeBoxId(body) };
    };
    expect(readReserve(withRegs(bare.registers.slice(0, 2)))).toMatchObject({ ok: false, rule: "registers" });
    expect(readReserve(withRegs([...bare.registers.slice(0, 2), "0400"]))).toMatchObject({ ok: false });
    expect(refundClock(r.info.refundHeight, TIP)).toBeNull();
  });

  it("a top-up keeps it without R7: L1, L2 and the signer pass; L1 refuses an output that adds or changes registers", () => {
    const amount = 200_000_000n;
    const tx = buildTopUp({ reserve: bare, payer: owner.pubHex, inputs: coins, amount, fee: FEE, height: TIP });
    const want: ReserveActionWant = { kind: "topup", signer: owner.pubHex, height: TIP, fee: FEE, amount };
    expect(tx.outputs[0].registers).toEqual(bare.registers);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
    const l2 = checkReserveActionContract(tx, inputs, "topup", [owner.pubHex], TIP + 1, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    const s = signReserveAction(tx, inputs, sk(owner), "topup");
    expect(verifyReserveAction(s.signed, inputs, "topup")).toBe(true);
    // R7 = 0 added would pass the contract, but the wallet keeps the registers byte for byte
    const added = clone(tx);
    added.outputs[0].registers = [...bare.registers, encodeLong(0n)];
    expect(checkReserveAction(added, inputs, want)).toMatchObject({ ok: false, rule: "reserve-output" });
    const started = clone(tx);
    started.outputs[0].registers = [...bare.registers, encodeLong(BigInt(TIP + 10))];
    expect(checkReserveAction(started, inputs, want)).toMatchObject({ ok: false, rule: "reserve-output" });
    expect(checkReserveActionContract(started, inputs, "topup", [owner.pubHex], TIP + 1, avl)).toMatchObject({ ok: false, rule: "refundPreserved" });
    // and a reserve with R7 = 0 may not lose it in a top-up either
    const withR7 = reserveBox(owner.pubHex, 400_000_000n);
    const dropped = clone(buildTopUp({ reserve: withR7, payer: owner.pubHex, inputs: coins, amount, fee: FEE, height: TIP }));
    dropped.outputs[0].registers = dropped.outputs[0].registers.slice(0, 3);
    expect(checkReserveAction(dropped, [withR7, ...coins], want)).toMatchObject({ ok: false, rule: "reserve-output" });
  });

  it("a refund start writes R7: L1, L2 and the signer pass; one without R7 in the output is refused by both", () => {
    const r7 = BigInt(TIP + REFUND_START_AHEAD);
    const tx = buildRefundStart({ reserve: bare, owner: owner.pubHex, inputs: coins, fee: FEE, height: TIP, refundHeight: r7 });
    const want: ReserveActionWant = { kind: "refund-start", signer: owner.pubHex, height: TIP, fee: FEE, refundHeight: r7 };
    expect(tx.outputs[0].registers).toEqual([...bare.registers, encodeLong(r7)]);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
    const l2 = checkReserveActionContract(tx, inputs, "refund-start", [owner.pubHex], TIP + 1, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    expect(l2.eval?.actionName).toBe("initiate-refund");
    const s = signReserveAction(tx, inputs, sk(owner), "refund-start");
    expect(verifyReserveAction(s.signed, inputs, "refund-start")).toBe(true);
    const none = clone(tx);
    none.outputs[0].registers = bare.registers.slice();
    expect(checkReserveAction(none, inputs, want)).toMatchObject({ ok: false, rule: "reserve-output" });
    expect(checkReserveActionContract(none, inputs, "refund-start", [owner.pubHex], TIP + 1, avl).ok).toBe(false);
    // no completion before a start: R7 absent is no refund
    const end = buildRefundComplete({ reserve: bare, owner: owner.pubHex, fee: FEE, height: TIP + REFUND_PERIOD_BLOCKS });
    expect(checkReserveAction(end, [bare], { kind: "refund-end", signer: owner.pubHex, height: TIP + REFUND_PERIOD_BLOCKS, fee: FEE })).toMatchObject({ ok: false, rule: "refund-state" });
  });
});

describe("a reserve with R8 and R9 (wallet-t3: the contract never reads them, so anyone's top-up may add them)", () => {
  // an Int and a SigmaProp: types the engine does not model, which it must leave out, not refuse
  const EXTRA = ["0402", `08cd${stranger.pubHex}`];
  const reserve = reserveBox(owner.pubHex, 400_000_000n);
  const coins = [p2pkBox(owner.pubHex, 300_000_000n, { index: 7 })];
  const strangerCoins = [p2pkBox(stranger.pubHex, 300_000_000n, { index: 8 })];

  it("a stranger's top-up that adds them passes the contract: the grief the wallet must survive", () => {
    const tx = clone(buildTopUp({ reserve, payer: stranger.pubHex, inputs: strangerCoins, amount: 100_000_000n, fee: FEE, height: TIP }));
    tx.outputs[0].registers = [...reserve.registers, ...EXTRA];
    const r = checkReserveActionContract(tx, [reserve, ...strangerCoins], "topup", [stranger.pubHex], TIP + 1, avl);
    if (!r.ok) throw new Error(`${r.rule}: ${r.message}`);
  });

  const grieved = reserveBox(owner.pubHex, 500_000_000n, { extra: EXTRA });
  const inputs = [grieved, ...coins];

  it("reads as the owner's reserve, R8 and R9 ignored; R7 is still read strictly", () => {
    expect(grieved.registers).toHaveLength(6);
    const r = readReserve(grieved);
    if (!r.ok) throw new Error(r.message);
    expect(r.info).toMatchObject({ owner: owner.pubHex, refundHeight: 0n });
    expect(readReserve(reserveBox(owner.pubHex, ERG, { extra: ["0500"] })).ok).toBe(true);
  });

  it("a top-up keeps them byte for byte: L1, L2, the signer; dropping or changing one is refused", () => {
    const amount = 200_000_000n;
    const tx = buildTopUp({ reserve: grieved, payer: owner.pubHex, inputs: coins, amount, fee: FEE, height: TIP });
    const want: ReserveActionWant = { kind: "topup", signer: owner.pubHex, height: TIP, fee: FEE, amount };
    expect(tx.outputs[0].registers).toEqual(grieved.registers);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
    const l2 = checkReserveActionContract(tx, inputs, "topup", [owner.pubHex], TIP + 1, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    expect(verifyReserveAction(signReserveAction(tx, inputs, sk(owner), "topup").signed, inputs, "topup")).toBe(true);
    const dropped = clone(tx);
    dropped.outputs[0].registers = grieved.registers.slice(0, 4);
    expect(checkReserveAction(dropped, inputs, want)).toMatchObject({ ok: false, rule: "reserve-output" });
    const changed = clone(tx);
    changed.outputs[0].registers[4] = "0404";
    expect(checkReserveAction(changed, inputs, want)).toMatchObject({ ok: false, rule: "reserve-output" });
  });

  it("a refund start writes R7 and keeps R8 and R9 (l. 454 asks nothing of them): L1, L2, the signer", () => {
    const r7 = BigInt(TIP + REFUND_START_AHEAD);
    const tx = buildRefundStart({ reserve: grieved, owner: owner.pubHex, inputs: coins, fee: FEE, height: TIP, refundHeight: r7 });
    const want: ReserveActionWant = { kind: "refund-start", signer: owner.pubHex, height: TIP, fee: FEE, refundHeight: r7 };
    expect(tx.outputs[0].registers).toEqual([...grieved.registers.slice(0, 3), encodeLong(r7), ...EXTRA]);
    expect(checkReserveAction(tx, inputs, want)).toEqual({ ok: true });
    const l2 = checkReserveActionContract(tx, inputs, "refund-start", [owner.pubHex], TIP + 1, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    expect(verifyReserveAction(signReserveAction(tx, inputs, sk(owner), "refund-start").signed, inputs, "refund-start")).toBe(true);
    const dropped = clone(tx);
    dropped.outputs[0].registers = dropped.outputs[0].registers.slice(0, 4);
    expect(checkReserveAction(dropped, inputs, want)).toMatchObject({ ok: false, rule: "reserve-output" });
    // and a reserve without R7 still gets exactly R4–R7
    const bare = reserveBox(owner.pubHex, 400_000_000n, { r7: null });
    expect(buildRefundStart({ reserve: bare, owner: owner.pubHex, inputs: coins, fee: FEE, height: TIP, refundHeight: r7 }).outputs[0].registers).toHaveLength(4);
  });

  it("the completion of a started one with R8 and R9: L1, L2, the signer", () => {
    const r7 = 1_900_000n;
    const unlock = Number(r7) + REFUND_PERIOD_BLOCKS;
    const started = reserveBox(owner.pubHex, 400_000_000n, { r7, extra: EXTRA });
    const tx = buildRefundComplete({ reserve: started, owner: owner.pubHex, fee: FEE, height: unlock - 1 });
    expect(checkReserveAction(tx, [started], { kind: "refund-end", signer: owner.pubHex, height: unlock - 1, fee: FEE })).toEqual({ ok: true });
    const l2 = checkReserveActionContract(tx, [started], "refund-end", [owner.pubHex], unlock, avl);
    if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
    expect(verifyReserveAction(signReserveAction(tx, [started], sk(owner), "refund-end").signed, [started], "refund-end")).toBe(true);
  });
});
