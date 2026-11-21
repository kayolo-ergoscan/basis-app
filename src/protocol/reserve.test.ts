// basis.es / basis-token.es evaluator: every check id is triggered at least once, plus the protocol
// boundaries (emergency 2160/2161, refund 43 200), double redemption, timestamp replay and partial redemption.
import { describe, expect, it } from "vitest";
import { bytesToHex } from "./bytes";
import { EMERGENCY_BLOCKS, MIN_BOX_VALUE_NANOERG, MIN_TOP_UP_NANOERG, REFUND_PERIOD_BLOCKS } from "./clock";
import { Economy } from "./economy";
import { demoKeyPair } from "./keys";
import { erg, noteMessage, tokenDenomination } from "./note";
import { acceptAllPolicy } from "./policy";
import { combineRedemptions, evaluateReserveSpend, trackerBoxFor, type RedeemBuild, type ReserveCheckId, type ReserveEval, type SimTx } from "./reserve";
import { sign } from "./schnorr";

const USE = tokenDenomination("a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669", "USE", 3);

function world(o: { token?: boolean } = {}) {
  const eco = new Economy({ seed: "reserve-tests", lazySignatures: false });
  eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", erg: erg(50), tokens: [[USE.id, 100_000n]] });
  eco.addParticipant({ id: "bob", erg: erg(1) });
  eco.addParticipant({ id: "carol", erg: erg(1) });
  eco.addDenomination(USE);
  eco.createTracker({ id: "t", operator: "op", denoms: [USE.id], globalPolicy: acceptAllPolicy() });
  const denom = o.token ? USE.id : "erg";
  const { reserve } = eco.createReserve({ owner: "alice", amount: o.token ? 50_000n : erg(10), denom, id: "vault" });
  eco.pay({ from: "alice", to: "bob", amount: o.token ? 5_000n : erg(5), denom });
  eco.mine(10);
  const t = eco.t();
  const bob = eco.p("bob");
  const rec = eco.note("alice", "bob", denom)!;
  const sigs = eco.signatures(rec, { includeTracker: true });
  const build = (over: Partial<RedeemBuild> = {}): SimTx =>
    reserve!.buildRedeem({
      receiver: bob.pub,
      totalDebt: rec.totalDebt,
      timestamp: rec.timestamp,
      amount: o.token ? 2_000n : erg(2),
      issuerSig: sigs.issuerSig,
      trackerSig: sigs.trackerSig!,
      trackerBox: t.dataInput(),
      height: eco.clock.height,
      ...over,
    }).tx;
  return { eco, reserve: reserve!, t, rec, sigs, build, bob, alice: eco.p("alice"), carol: eco.p("carol") };
}

function mutable(tx: SimTx): SimTx {
  return {
    ...tx,
    inputs: tx.inputs.map((b) => ({ ...b, registers: { ...b.registers }, tokens: b.tokens.map((x) => ({ ...x })) })),
    outputs: tx.outputs.map((b) => ({ ...b, registers: { ...b.registers }, tokens: b.tokens.map((x) => ({ ...x })) })),
    contextVars: Object.fromEntries(Object.entries(tx.contextVars).map(([k, v]) => [k, { ...v }])),
    signers: [...tx.signers],
  };
}

function expectFail(ev: ReserveEval, id: ReserveCheckId, outcome?: "false" | "throws") {
  expect(ev.ok).toBe(false);
  expect(ev.failed).toContain(id);
  if (outcome) expect(ev.checks.find((c) => c.id === id)!.outcome).toBe(outcome);
}

describe("basis.es action 0 (redeem)", () => {
  it("a well-formed redemption passes every check", () => {
    const w = world();
    const ev = w.reserve.evaluate(w.build());
    expect(ev.ok, ev.error?.message).toBe(true);
    expect(ev.actionName).toBe("redeem");
    expect(ev.redeemed).toBe(erg(2));
    expect(ev.checks.every((c) => c.outcome === "true")).toBe(true);
    expect(ev.message).toBe(bytesToHex(noteMessage(w.rec.key, w.rec.totalDebt, w.rec.timestamp, w.t.nftId)));
  });

  it("prologue: actionVar, outputExists, ownerKey throw", () => {
    const w = world();
    expectFail(w.reserve.evaluate(w.build({ tamper: { dropVars: [0] } })), "actionVar", "throws");
    const tx = mutable(w.build());
    tx.contextVars[0][0] = { type: "Byte", value: 7 };
    expectFail(w.reserve.evaluate(tx), "outputExists", "throws");
    const tx2 = mutable(w.build());
    delete tx2.inputs[0].registers.R4;
    expectFail(w.reserve.evaluate(tx2), "ownerKey", "throws");
  });

  it("refundHeightRead: an R7 of another type throws in every action (getReg InvalidType, evaluated up front)", () => {
    const w = world();
    const h = w.eco.clock.height;
    for (const tx of [mutable(w.build()), mutable(w.reserve.buildTopUp(erg(1), w.alice.pub, h)), mutable(w.reserve.buildCompleteRefund(h))]) {
      tx.inputs[0].registers.R7 = { type: "Coll[Byte]", value: "00" };
      expectFail(w.reserve.evaluate(tx), "refundHeightRead", "throws");
    }
  });

  it("selfPreserved: unique input, script, tokens, owner, tracker NFT (lazy &&)", () => {
    const w = world();
    const self = w.reserve.box!;
    expectFail(w.reserve.evaluate(w.build({ tamper: { extraInputs: [{ ...self, boxId: "ff".repeat(32) }] } })), "uniqueReserveInput", "false");
    const ev = w.reserve.evaluate(w.build({ tamper: { outputScript: "other" } }));
    expectFail(ev, "scriptPreserved", "false");
    expect(ev.checks.find((c) => c.id === "ownerPreserved")!.outcome).toBe("skipped");
    expectFail(w.reserve.evaluate(w.build({ tamper: { outputTokens: [{ tokenId: "aa".repeat(32), amount: 1n }] } })), "tokensPreserved", "false");
    const tx = mutable(w.build());
    tx.outputs[0].registers.R4 = { type: "GroupElement", value: w.carol.pub };
    expectFail(w.reserve.evaluate(tx), "ownerPreserved", "false");
    const tx2 = mutable(w.build());
    tx2.outputs[0].registers.R6 = { type: "Coll[Byte]", value: "11".repeat(32) };
    expectFail(w.reserve.evaluate(tx2), "trackerNftPreserved", "false");
  });

  it("trackerIdCorrect: a data input with another NFT", () => {
    const w = world();
    const box = w.t.currentBox()!;
    const fake = trackerBoxFor({ boxId: "ee".repeat(32), nftId: "11".repeat(32), trackerPub: w.t.pub, tree: box.tree!, creationHeight: box.creationHeight });
    expectFail(w.reserve.evaluate(w.build({ trackerBox: fake })), "trackerIdCorrect", "false");
  });

  it("trackerDebtCorrect: claiming more than committed (false) or an uncommitted key (throws)", () => {
    const w = world();
    const ev = w.reserve.evaluate(w.build({ tamper: { totalDebtVar: erg(6) } }));
    expectFail(ev, "trackerDebtCorrect", "false");
    expect(ev.failed).toContain("properReserveSignature");
    const ev2 = w.reserve.evaluate(w.build({ tamper: { receiverVar: w.carol.pub } }));
    expectFail(ev2, "trackerDebtCorrect", "throws");
  });

  it("properReserveSignature: signed by someone else", () => {
    const w = world();
    const forged = sign(noteMessage(w.rec.key, w.rec.totalDebt, w.rec.timestamp, w.t.nftId), w.carol.key);
    expectFail(w.reserve.evaluate(w.build({ issuerSig: forged })), "properReserveSignature", "false");
  });

  it("trackerSigValid: wrong co-signer, and an empty signature while the box is fresh", () => {
    const w = world();
    const wrong = sign(noteMessage(w.rec.key, w.rec.totalDebt, w.rec.timestamp, w.t.nftId), w.alice.key);
    expectFail(w.reserve.evaluate(w.build({ trackerSig: wrong })), "trackerSigValid", "false");
    const ev = w.reserve.evaluate(w.build({ trackerSig: new Uint8Array() }));
    expectFail(ev, "trackerSigValid", "false");
    expect(ev.emergency).toBe(true);
  });

  it("emergency boundary: box age 2160 fails, 2161 passes", () => {
    const w = world();
    const created = w.t.currentBox()!.creationHeight;
    const at = (age: number) => w.reserve.evaluate(w.build({ trackerSig: new Uint8Array(), height: created + age }));
    expect(EMERGENCY_BLOCKS).toBe(2160);
    expectFail(at(2160), "trackerSigValid", "false");
    const ok = at(2161);
    expect(ok.ok, ok.error?.message).toBe(true);
    expect(ok.emergency).toBe(true);
  });

  it("properlyRedeemed: more than the note allows, or nothing", () => {
    const w = world();
    expectFail(w.reserve.evaluate(w.build({ amount: erg(6) })), "properlyRedeemed", "false");
    expectFail(w.reserve.evaluate(w.build({ amount: 0n })), "properlyRedeemed", "false");
  });

  it("properRedemptionTree: stale output tree (false) or a garbage proof (throws)", () => {
    const w = world();
    expectFail(w.reserve.evaluate(w.build({ tamper: { staleOutputTree: true } })), "properRedemptionTree", "false");
    expectFail(w.reserve.evaluate(w.build({ tamper: { insertProof: new Uint8Array([1, 2, 3]) } })), "properRedemptionTree", "throws");
  });

  it("refundPreserved and receiverSignature", () => {
    const w = world();
    expectFail(w.reserve.evaluate(w.build({ tamper: { outputR7: 123n } })), "refundPreserved", "false");
    expectFail(w.reserve.evaluate(w.build({ tamper: { signers: [] } })), "receiverSignature", "false");
  });

  it("partial redemptions add up; the room is enforced on-chain", () => {
    const w = world();
    expect(w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(2) }).ok).toBe(true);
    expect(w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(3) }).ok).toBe(true);
    expect(w.reserve.redeemedFor(w.bob.pub)!.redeemed).toBe(erg(5));
    const over = w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(1), force: true });
    expect(over.ok).toBe(false);
    expect(over.eval!.failed).toContain("properlyRedeemed");
  });

  it("double redemption: omitting #7 makes the AVL insert throw", () => {
    const w = world();
    expect(w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(2) }).ok).toBe(true);
    const r = w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(3), tamper: { omitReserveLookup: true } });
    expect(r.ok).toBe(false);
    const c = r.eval!.checks.find((x) => x.id === "properRedemptionTree")!;
    expect(c.outcome).toBe("throws");
    // sending #7 on a FIRST redemption throws too (get(...).get on None)
    const w2 = world();
    const ev = w2.reserve.evaluate(w2.build({ tamper: { forceReserveLookup: true } }));
    expectFail(ev, "timestampCorrect", "throws");
  });

  it("timestamp replay: an older note version after a newer one was redeemed", () => {
    const w = world();
    const v1 = { totalDebt: w.rec.totalDebt, timestamp: w.rec.timestamp, sig: w.sigs.issuerSig };
    // same total, newer timestamp (allowed by the tracker: not a decrease)
    expect(w.eco.pay({ from: "alice", to: "bob", amount: 0n, totalDebt: w.rec.totalDebt }).ok).toBe(true);
    w.eco.mine(10);
    expect(w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(1) }).ok).toBe(true);
    const ts = w.eco.note("alice", "bob")!.timestamp;
    expect(ts > v1.timestamp).toBe(true);
    const trackerSig = w.t.coSign(w.rec, v1.totalDebt, v1.timestamp);
    const tx = w.reserve.buildRedeem({ receiver: w.bob.pub, totalDebt: v1.totalDebt, timestamp: v1.timestamp, amount: erg(1), issuerSig: v1.sig, trackerSig, trackerBox: w.t.dataInput(), height: w.eco.clock.height }).tx;
    const ev = w.reserve.evaluate(tx);
    expectFail(ev, "timestampCorrect", "false");
    expect(ev.failed).toEqual(["timestampCorrect"]);
    // the same (newest) timestamp again is fine: the contract uses >=, so partial redemptions work
    expect(w.eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(1) }).ok).toBe(true);
  });

  it("atomic clearing: one owner may not have two reserve inputs; at most 10 legs", () => {
    const w = world();
    const a = w.build();
    const b = mutable(w.build({ amount: erg(1), salt: "b" }));
    b.inputs[0] = { ...b.inputs[0], boxId: "cd".repeat(32) };
    const tx = combineRedemptions([{ tx: a }, { tx: b }], w.eco.clock.height);
    const ev = evaluateReserveSpend(tx, 0);
    expectFail(ev, "uniqueReserveInput", "false");
    expect(() => combineRedemptions(Array.from({ length: 11 }, () => ({ tx: a })), 1)).toThrow(/at most 10/);
  });
});

describe("basis-token.es", () => {
  it("token redemption passes; the receiver gets tokens + 0.001 ERG", () => {
    const w = world({ token: true });
    const tx = w.build();
    const ev = w.reserve.evaluate(tx);
    expect(ev.ok, ev.error?.message).toBe(true);
    expect(ev.contract).toBe("basis-token.es");
    expect(tx.outputs[1].value).toBe(MIN_BOX_VALUE_NANOERG);
    expect(tx.outputs[1].tokens[0].amount).toBe(2_000n);
    // split keys: the tracker key is suffixed by the token id, the reserve key is not
    expect(ev.debtKey).not.toBe(ev.reserveKey);
  });

  it("reserveTokens, tokenIdsPreserved, ergPreserved", () => {
    const w = world({ token: true });
    const tx = mutable(w.build());
    tx.inputs[0].tokens = [];
    expectFail(evaluateReserveSpend(tx, 0), "reserveTokens", "throws");
    const t = w.reserve.box!.tokens;
    expectFail(w.reserve.evaluate(w.build({ tamper: { outputTokens: [{ tokenId: "99".repeat(32), amount: 1n }, { ...t[1], amount: t[1].amount - 2_000n }] } })), "tokenIdsPreserved", "false");
    expectFail(w.reserve.evaluate(w.build({ tamper: { ergDelta: -1n } })), "ergPreserved", "false");
  });

  it("top-up needs at least one token unit", () => {
    const w = world({ token: true });
    expect(w.reserve.evaluate(w.reserve.buildTopUp(1n, w.alice.pub, w.eco.clock.height)).ok).toBe(true);
    expectFail(w.reserve.evaluate(w.reserve.buildTopUp(0n, w.alice.pub, w.eco.clock.height)), "topUpAmount", "false");
  });
});

describe("basis.es actions 1–3", () => {
  it("top-up: ≥ 0.1 ERG, tree and R7 untouched; anyone may pay", () => {
    const w = world();
    const h = w.eco.clock.height;
    expect(w.reserve.evaluate(w.reserve.buildTopUp(MIN_TOP_UP_NANOERG, w.carol.pub, h)).ok).toBe(true);
    expectFail(w.reserve.evaluate(w.reserve.buildTopUp(MIN_TOP_UP_NANOERG - 1n, w.carol.pub, h)), "topUpAmount", "false");
    const tx = mutable(w.reserve.buildTopUp(erg(1), w.carol.pub, h));
    tx.outputs[0].registers.R5 = { type: "AvlTree", digest: "00".repeat(33) };
    expectFail(w.reserve.evaluate(tx), "treePreserved", "false");
    const tx2 = mutable(w.reserve.buildTopUp(erg(1), w.carol.pub, h));
    tx2.outputs[0].registers.R7 = { type: "Long", value: 5n };
    expectFail(w.reserve.evaluate(tx2), "refundPreserved", "false");
  });

  it("initiate refund: owner only, R7 ≥ HEIGHT, one-shot, nothing withdrawn", () => {
    const w = world();
    const h = w.eco.clock.height;
    expect(w.reserve.evaluate(w.reserve.buildInitiateRefund(BigInt(h), h)).ok).toBe(true);
    expectFail(w.reserve.evaluate(w.reserve.buildInitiateRefund(BigInt(h - 1), h)), "refundHeightValid", "false");
    expectFail(w.reserve.evaluate(w.reserve.buildInitiateRefund(BigInt(h), h, [w.bob.pub])), "ownerSignature", "false");
    const tx = mutable(w.reserve.buildInitiateRefund(BigInt(h), h));
    tx.outputs[0].value -= 1n;
    expectFail(w.reserve.evaluate(tx), "valueNotDecreased", "false");
    const tx2 = mutable(w.reserve.buildInitiateRefund(BigInt(h), h));
    tx2.outputs[0].registers.R5 = { type: "AvlTree", digest: "00".repeat(33) };
    expectFail(w.reserve.evaluate(tx2), "treePreserved", "false");
    expect(w.eco.initiateRefund({ reserve: "vault" }).ok).toBe(true);
    expectFail(w.reserve.evaluate(w.reserve.buildInitiateRefund(BigInt(h + 1), h + 1)), "refundNotStarted", "false");
  });

  it("complete refund: started, 43 200 blocks after R7, owner signs", () => {
    const w = world();
    expectFail(w.reserve.evaluate(w.reserve.buildCompleteRefund(w.eco.clock.height)), "refundStarted", "false");
    w.eco.initiateRefund({ reserve: "vault" });
    const r7 = Number(w.reserve.refundHeight());
    expect(REFUND_PERIOD_BLOCKS).toBe(43200);
    expectFail(w.reserve.evaluate(w.reserve.buildCompleteRefund(r7 + 43199)), "refundPeriodOver", "false");
    expect(w.reserve.evaluate(w.reserve.buildCompleteRefund(r7 + 43200)).ok).toBe(true);
    expectFail(w.reserve.evaluate(w.reserve.buildCompleteRefund(r7 + 43200, [w.bob.pub])), "ownerSignature", "false");
  });

  it("unknown action byte", () => {
    const w = world();
    const tx = mutable(w.reserve.buildTopUp(erg(1), w.alice.pub, w.eco.clock.height));
    tx.contextVars[0][0] = { type: "Byte", value: 40 };
    expectFail(w.reserve.evaluate(tx), "invalidAction", "false");
  });

  it("every check id of the evaluator is covered by this file", () => {
    const covered: ReserveCheckId[] = [
      "actionVar", "outputExists", "ownerKey", "reserveTokens", "refundHeightRead", "uniqueReserveInput", "scriptPreserved", "tokensPreserved", "tokenIdsPreserved",
      "ergPreserved", "ownerPreserved", "trackerNftPreserved", "trackerIdCorrect", "trackerDebtCorrect", "timestampCorrect", "properRedemptionTree",
      "properReserveSignature", "properlyRedeemed", "trackerSigValid", "refundPreserved", "receiverSignature", "treePreserved", "topUpAmount",
      "valueNotDecreased", "refundHeightValid", "refundNotStarted", "ownerSignature", "refundStarted", "refundPeriodOver", "invalidAction",
    ];
    expect(new Set(covered).size).toBe(30);
    void demoKeyPair;
  });
});
