// Fidelity to the real code: each test pins a point where the engine once disagreed with basis.es /
// basis-token.es, the contract's Schnorr expression or the reference tracker (basis_server, basis_store).
import { describe, expect, it } from "vitest";
import { registerAvlBackend, SIMULATED_AVL, type AvlBackend } from "./avl";
import { bytesToHex, concatBytes, hexToBytes, I64_MAX } from "./bytes";
import { Economy } from "./economy";
import { demoKeyPair } from "./keys";
import { erg, noteMessage, tokenDenomination } from "./note";
import { acceptAllPolicy, defaultCollateralPolicy } from "./policy";
import { contextVarsHex, type ReserveCheckId, type ReserveEval, type SimTx } from "./reserve";
import { ContractThrow, contractBigInt, contractSignatureHolds, sign, verify } from "./schnorr";
import { TimeMachine } from "./timemachine";

const USE = tokenDenomination("a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669", "USE", 3);

function mutable(tx: SimTx): SimTx {
  return {
    ...tx,
    inputs: tx.inputs.map((b) => ({ ...b, registers: { ...b.registers }, tokens: b.tokens.map((x) => ({ ...x })) })),
    outputs: tx.outputs.map((b) => ({ ...b, registers: { ...b.registers }, tokens: b.tokens.map((x) => ({ ...x })) })),
    contextVars: Object.fromEntries(Object.entries(tx.contextVars).map(([k, v]) => [k, { ...v }])),
    signers: [...tx.signers],
  };
}

function expectThrows(ev: ReserveEval, id: ReserveCheckId) {
  expect(ev.ok).toBe(false);
  expect(ev.failed).toContain(id);
  expect(ev.checks.find((c) => c.id === id)!.outcome).toBe("throws");
}

function reserveWorld() {
  const eco = new Economy({ seed: "fidelity", lazySignatures: false });
  eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", erg: erg(50) });
  eco.addParticipant({ id: "bob", erg: erg(1) });
  eco.createTracker({ id: "t", operator: "op", globalPolicy: acceptAllPolicy() });
  const { reserve } = eco.createReserve({ owner: "alice", amount: erg(10), id: "vault" });
  eco.pay({ from: "alice", to: "bob", amount: erg(5) });
  eco.mine(10);
  const t = eco.t();
  const rec = eco.note("alice", "bob")!;
  const sigs = eco.signatures(rec, { includeTracker: true });
  const redeemTx = (): SimTx =>
    mutable(
      reserve!.buildRedeem({
        receiver: eco.p("bob").pub,
        totalDebt: rec.totalDebt,
        timestamp: rec.timestamp,
        amount: erg(2),
        issuerSig: sigs.issuerSig,
        trackerSig: sigs.trackerSig!,
        trackerBox: t.dataInput(),
        height: eco.clock.height,
      }).tx,
    );
  return { eco, reserve: reserve!, redeemTx };
}

describe("Schnorr: the contract's own reading of the signature bytes", () => {
  const k = demoKeyPair("alice");
  const msg = noteMessage(new Uint8Array(32).fill(7), 5n, 6n, new Uint8Array(32).fill(9));

  it("z is sliced to the end and read as a signed BigInt: a sign-extended 66-byte signature holds on-chain", () => {
    const s = sign(msg, k);
    expect(contractSignatureHolds(k.pub, msg, s)).toBe(true);
    const s66 = concatBytes(s.slice(0, 33), new Uint8Array([0]), s.slice(33));
    expect(contractSignatureHolds(k.pub, msg, s66)).toBe(true);
    expect(verify(k.pub, msg, s66).ok).toBe(false); // the tracker (Rust) insists on exactly 65 bytes
    expect(() => contractSignatureHolds(k.pub, msg, s.slice(0, 33))).toThrow(ContractThrow); // empty z: BigInteger throws
  });

  it("byteArrayToBigInt accepts any length while the value fits 256-bit signed", () => {
    expect(() => contractBigInt(new Uint8Array())).toThrow(ContractThrow);
    expect(contractBigInt(hexToBytes("007f" + "ff".repeat(31)))).toBe((1n << 255n) - 1n);
    expect(() => contractBigInt(hexToBytes("0080" + "00".repeat(31)))).toThrow(ContractThrow); // 2^255
    expect(contractBigInt(hexToBytes("ff80" + "00".repeat(31)))).toBe(-(1n << 255n));
    expect(() => contractBigInt(hexToBytes("ff7f" + "ff".repeat(31)))).toThrow(ContractThrow); // −2^255 − 1
    expect(contractBigInt(hexToBytes("80" + "00".repeat(31)))).toBe(-(1n << 255n)); // 32 bytes, top bit set: negative
  });
});

describe("reserve contract: reads that throw instead of defaulting", () => {
  it("context var #7 of another type throws (getVar InvalidType), even on a first redemption", () => {
    const w = reserveWorld();
    const tx = w.redeemTx();
    tx.contextVars[0][7] = { type: "Long", value: 1n };
    expectThrows(w.reserve.evaluate(tx), "timestampCorrect");
  });

  it("a same-script input with a non-GroupElement R4 makes the uniqueness filter throw; one without R4 is skipped", () => {
    const w = reserveWorld();
    const self = w.reserve.box!;
    const junk = mutable(w.redeemTx());
    junk.inputs.push({ ...self, boxId: "ff".repeat(32), registers: { ...self.registers, R4: { type: "Coll[Byte]", value: "00" } } });
    expectThrows(w.reserve.evaluate(junk), "uniqueReserveInput");
    const bare = mutable(w.redeemTx());
    const { R4: _r4, ...noR4 } = self.registers;
    void _r4;
    bare.inputs.push({ ...self, boxId: "fe".repeat(32), registers: noR4 });
    expect(w.reserve.evaluate(bare).checks.find((c) => c.id === "uniqueReserveInput")!.outcome).toBe("true");
  });

  it("complete refund also evaluates selfPreserved (an eager ValDef): its throws count", () => {
    const w = reserveWorld();
    const tx = mutable(w.reserve.buildCompleteRefund(w.eco.clock.height));
    tx.inputs[0].registers.R7 = { type: "Long", value: 1n };
    expect(w.reserve.evaluate(tx).ok).toBe(true);
    // the output selected by #0 carries the reserve script but no R4: selfOut.R4[GroupElement].get throws
    tx.outputs[0] = { ...tx.outputs[0], script: w.reserve.box!.script, registers: {} };
    const ev = w.reserve.evaluate(tx);
    expect(ev.ok).toBe(false);
    expect(ev.checks.find((c) => c.id === "ownerPreserved")?.outcome).toBe("throws");
  });

  it("R7 near Long.MaxValue: initiate refund accepts it, refundHeight + 43 200 then overflows and the refund never completes", () => {
    const w = reserveWorld();
    const h = w.eco.clock.height;
    expect(w.reserve.evaluate(w.reserve.buildInitiateRefund(I64_MAX - 100n, h)).ok).toBe(true);
    const tx = mutable(w.reserve.buildCompleteRefund(h));
    tx.inputs[0].registers.R7 = { type: "Long", value: I64_MAX - 100n };
    expectThrows(w.reserve.evaluate(tx), "refundPeriodOver");
  });

  it("the context-extension X-ray shows the serialised constants", () => {
    const pub = bytesToHex(demoKeyPair("bob").pub);
    const x = contextVarsHex({ 0: { type: "Byte", value: 0 }, 1: { type: "GroupElement", value: pub }, 4: { type: "Long", value: 1n }, 6: { type: "Coll[Byte]", value: "" } });
    expect(x["#0"].wire).toBe("0200");
    expect(x["#1"].wire).toBe(`07${pub}`);
    expect(x["#4"].wire).toBe("0502"); // zigzag(1) = 2
    expect(x["#4"].hex).toBe("0000000000000001");
    expect(x["#6"].wire).toBe("0e00"); // the empty tracker signature of an emergency redemption
  });
});

describe("tracker: per-note confirmation like the reference server", () => {
  function busy() {
    const eco = new Economy({ seed: "fidelity-busy" });
    eco.addDenomination(USE);
    eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(5) });
    eco.addParticipant({ id: "alice", erg: erg(100), tokens: [[USE.id, 100_000n]] });
    eco.addParticipant({ id: "bob", erg: erg(1) });
    eco.addParticipant({ id: "carol", erg: erg(1) });
    eco.createTracker({ id: "t", operator: "op", denoms: [USE.id], globalPolicy: acceptAllPolicy() });
    eco.createReserve({ owner: "alice", amount: erg(10), id: "vault" });
    return eco;
  }

  it("while a new box waits for depth, an unchanged note stays confirmed and redeemable; a changed one is pending", () => {
    const eco = busy();
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.pay({ from: "alice", to: "carol", amount: erg(1) });
    eco.mine(10);
    const bob = eco.note("alice", "bob")!;
    const carol = eco.note("alice", "carol")!;
    expect(eco.noteStatus(bob)).toBe("confirmed");
    eco.pay({ from: "alice", to: "carol", amount: erg(1) });
    eco.mine(5);
    expect(eco.t().committedTotal(carol.key)).toBe(erg(2));
    expect(eco.t().isConfirmed()).toBe(false);
    expect(eco.noteStatus(bob)).toBe("confirmed");
    expect(eco.noteStatus(carol)).toBe("pending");
    expect(eco.redeem({ receiver: "carol", issuer: "alice" }).code).toBe("note-not-confirmed");
    const r = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(r.ok, r.message).toBe(true);
    expect(Economy.replay(eco.events).stateHash()).toBe(eco.stateHash());
  });

  it("stale committed debt is judged against the confirmed box (confirmed_total_debt), not the pending one", () => {
    const eco = busy();
    eco.createReserve({ owner: "alice", amount: 50_000n, denom: USE.id, id: "use" });
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    eco.mine(10);
    const rec = eco.note("alice", "bob")!;
    expect(eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(2), to: USE.id, toAmount: 4_000n }).ok).toBe(true);
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("stale-committed-debt");
    eco.mine(5); // the decrease is in the newest box, which is not confirmed yet
    expect(eco.t().committedTotal(rec.key)).toBe(erg(3));
    expect(eco.t().confirmedTotal(rec.key)).toBe(erg(5));
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("stale-committed-debt");
    eco.mine(5);
    const r = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(r.ok, r.message).toBe(true);
    expect(r.amount).toBe(erg(3));
  });

  it("the rate limiter counts attempts the tracker refuses after letting them through", () => {
    const eco = busy();
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    eco.pay({ from: "alice", to: "bob", amount: erg(1) }); // committed next cycle, confirmed the one after
    eco.mine(5);
    const limit = eco.t().options.rateLimitPerHour;
    for (let i = 0; i < limit; i++) expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("note-not-confirmed");
    eco.mine(5);
    expect(eco.noteStatus(eco.note("alice", "bob")!)).toBe("confirmed");
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("rate-limited");
    expect(Economy.replay(eco.events).stateHash()).toBe(eco.stateHash());
  });
});

describe("economy: books and replays", () => {
  it("a holder who redeems past its own waiver never shows a negative claim", () => {
    const eco = new Economy({ seed: "fidelity-triangle" });
    eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(2) });
    eco.addParticipant({ id: "alice", erg: erg(15) });
    eco.addParticipant({ id: "bob", erg: erg(1) });
    eco.addParticipant({ id: "carol", erg: erg(1) });
    eco.createTracker({ id: "t", operator: "op", globalPolicy: defaultCollateralPolicy() });
    eco.createReserve({ owner: "alice", amount: erg(10), id: "vault" });
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    eco.novate({ issuer: "alice", from: "bob", to: "carol", amount: erg(3) });
    eco.mine(10);
    expect(eco.redeem({ receiver: "carol", issuer: "alice" }).ok).toBe(true);
    // Bob waived 3 of his 5 when he passed them to Carol, then redeems all 5: the contract allows it
    const betrayal = eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(5) });
    expect(betrayal.ok, betrayal.message).toBe(true);
    const b = eco.balanceSheet("bob");
    const a = eco.balanceSheet("alice");
    expect(b.assets).toBe(0n);
    expect(b.assetsOnChain).toBe(0n);
    expect(a.liabilities).toBe(0n);
    expect(b.counterparties.every((l) => l.owesMe >= 0n && l.iOwe >= 0n)).toBe(true);
    expect(eco.debtEdges().every((e) => e.amount >= 0n)).toBe(true);
  });

  it("replays use the AVL backend recorded in genesis; a time machine defaults to its source's backend", () => {
    const other: AvlBackend = { ...SIMULATED_AVL, id: "simulated-copy" };
    registerAvlBackend(other.id, other);
    const eco = new Economy({ seed: "fidelity-avl", avl: other });
    eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(2) });
    eco.addParticipant({ id: "alice", erg: erg(20) });
    eco.addParticipant({ id: "bob", erg: erg(1) });
    eco.createTracker({ id: "t", operator: "op", globalPolicy: acceptAllPolicy() });
    eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(2) });
    eco.mine(10);
    expect(eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(1) }).ok).toBe(true);
    expect(Economy.replay(eco.events).avl).toBe(other);
    const tm = new TimeMachine(eco);
    expect(tm.stateAt(tm.lastSeq).avl).toBe(other);
    expect(tm.stateAt(3).avl).toBe(other);
    expect(tm.verify(eco).ok).toBe(true);
  });
});
