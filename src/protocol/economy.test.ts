import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "./bytes";
import { MINER_FEE_NANOERG, MIN_BOX_VALUE_NANOERG } from "./clock";
import { Economy } from "./economy";
import { eventsFromJson, eventsToJson } from "./events";
import { erg, noteMessage, tokenDenomination } from "./note";
import { acceptAllPolicy, collateralPolicy, creditCapsPolicy } from "./policy";
import { contractSignatureHolds, verify } from "./schnorr";

function basic(opts: { lazy?: boolean } = {}) {
  const eco = new Economy({ seed: "test", lazySignatures: opts.lazy ?? true });
  eco.addParticipant({ id: "op", name: "Tracker operator", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", name: "Alice", erg: erg(100) });
  eco.addParticipant({ id: "bob", name: "Bob's café", kind: "business", erg: erg(1) });
  eco.addParticipant({ id: "carol", name: "Carol", erg: erg(10) });
  eco.createTracker({ id: "t1", name: "Tracker One", operator: "op", globalPolicy: acceptAllPolicy() });
  return eco;
}

describe("economy: pay → commit → confirm → redeem", () => {
  it("runs the full happy path with real signatures and contract evaluation", () => {
    const eco = basic();
    const res = eco.createReserve({ owner: "alice", amount: erg(10) });
    expect(res.ok).toBe(true);
    expect(eco.balance("alice")).toBe(erg(90) - MINER_FEE_NANOERG);
    const p1 = eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    expect(p1.ok).toBe(true);
    const p2 = eco.pay({ from: "alice", to: "bob", amount: erg("0.5") });
    expect(p2.ok).toBe(true);
    const rec = eco.note("alice", "bob")!;
    expect(rec.totalDebt).toBe(erg("1.5"));
    expect(rec.history.length).toBe(2);
    expect(eco.noteStatus(rec)).toBe("local");

    // not committed yet → the tracker refuses
    const early = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(early.ok).toBe(false);
    expect(early.code).toBe("note-not-committed");

    eco.mine(5); // updater runs at an interval boundary
    expect(eco.t("t1").boxes.length).toBe(2);
    expect(eco.noteStatus(rec)).toBe("pending");
    const pending = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(pending.code).toBe("note-not-confirmed");
    eco.mine(1);
    expect(eco.noteStatus(rec)).toBe("pending"); // the updater only looks again at its next 600 s cycle
    eco.mine(4);
    expect(eco.noteStatus(rec)).toBe("confirmed");

    const opBefore = eco.balance("op");
    const r = eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(1) });
    expect(r.ok, r.message).toBe(true);
    expect(r.eval!.ok).toBe(true);
    expect(r.emergency).toBe(false);
    expect(eco.balance("bob")).toBe(erg(2));
    expect(eco.balance("op")).toBe(opBefore - MINER_FEE_NANOERG);
    expect(eco.r(res.reserve!.id).collateral()).toBe(erg(9));
    expect(eco.note("alice", "bob")!.amountRedeemed).toBe(erg(1));

    // signatures are real and verify under the contract's rules
    const s = eco.signatures(rec, { includeTracker: true });
    expect(s.issuerSigOk).toBe(true);
    expect(contractSignatureHolds(eco.p("alice").pub, s.message, s.issuerSig)).toBe(true);
    expect(verify(eco.t("t1").pub, s.message, s.trackerSig!).ok).toBe(true);

    // partial redemption, the second leg uses #7 (insertOrUpdate)
    const r2 = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(r2.ok, r2.message).toBe(true);
    expect(r2.amount).toBe(erg("0.5"));
    expect(eco.r(res.reserve!.id).redeemedFor(eco.p("bob").pub)!.redeemed).toBe(erg("1.5"));
    const r3 = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(r3.ok).toBe(false);
    expect(r3.code).toBe("nothing-to-redeem");
  });

  it("eager and lazy runs produce byte-identical signatures and state", () => {
    const run = (lazy: boolean) => {
      const eco = basic({ lazy });
      eco.createReserve({ owner: "alice", amount: erg(10) });
      for (let i = 0; i < 5; i++) eco.pay({ from: "alice", to: i % 2 ? "bob" : "carol", amount: erg(1) + BigInt(i) });
      eco.mine(10);
      eco.redeem({ receiver: "bob", issuer: "alice" });
      return eco;
    };
    const lazy = run(true);
    const eager = run(false);
    expect(lazy.stateHash()).toBe(eager.stateHash());
    const rl = lazy.note("alice", "carol")!;
    const re = eager.note("alice", "carol")!;
    expect(bytesToHex(lazy.signatures(rl).issuerSig)).toBe(re.issuerSig);
    expect(lazy.pendingSignatures(false)).toBeGreaterThan(0);
    lazy.materialize(10_000, false);
    expect(lazy.pendingSignatures(false)).toBe(0);
  });

  it("tracker rejections: decrease, replayed timestamp, future timestamp, forged signature, wrong NFT", () => {
    const eco = basic();
    eco.pay({ from: "alice", to: "bob", amount: erg(2) });
    const rec = eco.note("alice", "bob")!;
    expect(eco.pay({ from: "alice", to: "bob", amount: 0n, totalDebt: erg(1) }).code).toBe("debt-decrease-not-permitted");
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1), timestamp: rec.timestamp }).code).toBe("past-timestamp");
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1), timestamp: eco.clock.nowMs() + 60_000n }).code).toBe("future-timestamp");
    const forged = new Uint8Array(65);
    forged.set(hexToBytes(eco.p("alice").pub), 0);
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1), signature: forged }).code).toBe("invalid-signature");
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1), trackerNftId: "11".repeat(32) }).code).toBe("tracker-nft-mismatch");
    expect(eco.pay({ from: "alice", to: "bob", amount: 1n << 63n }).code).toBe("amount-exceeds-contract-range");
    expect(eco.note("alice", "bob")!.totalDebt).toBe(erg(2));
  });

  it("receiver policies and credit lines gate acceptance", () => {
    const eco = basic();
    eco.setPolicy("bob", collateralPolicy(1.0));
    const r = eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("policy-rejected");
    eco.createReserve({ owner: "alice", amount: erg(2) });
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1) }).ok).toBe(true);
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(2) }).code).toBe("policy-rejected"); // 3 > 2 collateral

    eco.setPolicy("carol", creditCapsPolicy([{ issuer: eco.p("alice").pub, cap: erg(3) }]));
    expect(eco.pay({ from: "alice", to: "carol", amount: erg(2) }).ok).toBe(true);
    expect(eco.pay({ from: "alice", to: "carol", amount: erg(2) }).code).toBe("policy-rejected");

    eco.setCreditLine("carol", "bob", erg(1));
    expect(eco.pay({ from: "bob", to: "carol", amount: erg("0.6") }).ok).toBe(false); // carol's whitelist only has alice
    eco.setPolicy("carol", null);
    expect(eco.pay({ from: "bob", to: "carol", amount: erg("0.6") }).ok).toBe(true);
    const over = eco.pay({ from: "bob", to: "carol", amount: erg("0.6") });
    expect(over.code).toBe("credit-limit");
  });

  it("emergency redemption after the tracker vanishes (2160 vs 2161 blocks)", () => {
    const eco = basic();
    eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(3) });
    eco.mine(10);
    const box = eco.t().currentBox()!;
    eco.pay({ from: "alice", to: "bob", amount: erg(1) }); // never committed
    eco.disappear("t1");
    eco.mineTo(box.creationHeight + 2160);
    const tooEarly = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(tooEarly.ok).toBe(false);
    expect(tooEarly.code).toBe("tracker-offline");
    const forced = eco.redeem({ receiver: "bob", issuer: "alice", emergency: true });
    expect(forced.ok).toBe(false);
    expect(forced.stage).toBe("contract");
    expect(forced.eval!.failed).toContain("trackerSigValid");
    eco.mine(1);
    const ok = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(ok.ok, ok.message).toBe(true);
    expect(ok.emergency).toBe(true);
    expect(ok.amount).toBe(erg(3)); // only the committed total
    expect(eco.balance("bob")).toBe(erg(1) + erg(3) - MINER_FEE_NANOERG);
  });

  it("refund: initiate, holders still redeem, complete only after 43200 blocks", () => {
    const eco = basic();
    const { reserve } = eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(2) });
    eco.mine(10);
    expect(eco.initiateRefund({ reserve: reserve!.id }).ok).toBe(true);
    const r7 = Number(reserve!.refundHeight());
    expect(eco.initiateRefund({ reserve: reserve!.id }).ok).toBe(false);
    const red = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(red.ok, red.message).toBe(true);
    eco.mineTo(r7 + 43200 - 1);
    const early = eco.completeRefund({ reserve: reserve!.id });
    expect(early.ok).toBe(false);
    expect(early.eval!.failed).toContain("refundPeriodOver");
    eco.mine(1);
    const before = eco.balance("alice");
    const done = eco.completeRefund({ reserve: reserve!.id });
    expect(done.ok, done.message).toBe(true);
    expect(eco.balance("alice")).toBe(before + erg(8) - MINER_FEE_NANOERG);
    expect(reserve!.active).toBe(false);
  });

  it("token reserve: basis-token.es, tracker adds the 0.001 ERG output box", () => {
    const eco = basic();
    const use = tokenDenomination("a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669", "USE", 3);
    eco.addDenomination(use);
    eco.fund("alice", use.id, 50_000n);
    const t = eco.t("t1");
    t.denoms.add(use.id);
    const { reserve, ok } = eco.createReserve({ owner: "alice", amount: 40_000n, denom: use.id });
    expect(ok).toBe(true);
    expect(eco.pay({ from: "alice", to: "bob", amount: 1_500n, denom: use.id }).ok).toBe(true);
    eco.mine(10);
    const opBefore = eco.balance("op");
    const r = eco.redeem({ receiver: "bob", issuer: "alice", denom: use.id });
    expect(r.ok, r.message).toBe(true);
    expect(r.eval!.contract).toBe("basis-token.es");
    expect(eco.balance("bob", use.id)).toBe(1_500n);
    expect(eco.balance("bob")).toBe(erg(1) + MIN_BOX_VALUE_NANOERG);
    expect(eco.balance("op")).toBe(opBefore - MINER_FEE_NANOERG - MIN_BOX_VALUE_NANOERG);
    expect(reserve!.collateral()).toBe(38_500n);
    const tu = eco.topUp({ reserve: reserve!.id, amount: 1n });
    expect(tu.ok, tu.message).toBe(true);
  });

  it("novation: B pays C with A's debt (new A→C note + B's waiver)", () => {
    const eco = basic();
    eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    const n = eco.novate({ issuer: "alice", from: "bob", to: "carol", amount: erg(2) });
    expect(n.ok).toBe(true);
    expect(eco.note("alice", "carol")!.totalDebt).toBe(erg(2));
    expect(eco.note("alice", "bob")!.totalDebt).toBe(erg(5));
    expect(eco.note("alice", "bob")!.waived).toBe(erg(2));
    const bs = eco.balanceSheet("bob");
    expect(bs.assets).toBe(erg(3));
    expect(bs.assetsOnChain).toBe(erg(5));
    expect(eco.balanceSheet("alice").liabilities).toBe(erg(5));
    expect(eco.balanceSheet("alice").liabilitiesOnChain).toBe(erg(7));
    expect(eco.novate({ issuer: "alice", from: "bob", to: "carol", amount: erg(4) }).ok).toBe(false);
  });

  it("clearing a 3-cycle on-chain in one atomic transaction", () => {
    const eco = basic();
    eco.addParticipant({ id: "dave", erg: erg(10) });
    for (const id of ["alice", "carol", "dave"]) eco.createReserve({ owner: id, amount: erg(5) });
    eco.pay({ from: "alice", to: "carol", amount: erg(3) });
    eco.pay({ from: "carol", to: "dave", amount: erg(2) });
    eco.pay({ from: "dave", to: "alice", amount: erg(4) });
    eco.mine(10);
    const cycles = eco.findCycles();
    expect(cycles.length).toBe(1);
    expect(cycles[0].amount).toBe(erg(2));
    const w = { alice: eco.balance("alice"), carol: eco.balance("carol"), dave: eco.balance("dave") };
    const c = eco.clearCycle(cycles[0], { mode: "onchain" });
    expect(c.ok, c.message).toBe(true);
    expect(c.tx!.inputs.length).toBe(3);
    expect(c.evals!.every((e) => e.ok)).toBe(true);
    expect(eco.balance("alice")).toBe(w.alice + erg(2));
    expect(eco.balance("carol")).toBe(w.carol + erg(2));
    expect(eco.balance("dave")).toBe(w.dave + erg(2));
    expect(c.stats!.grossAfter).toBe(erg(3));
    expect(eco.findCycles().length).toBe(0);
  });

  it("event log round-trips through JSON and replays to the same state", () => {
    const eco = basic();
    eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    eco.redeem({ receiver: "bob", issuer: "alice" });
    const json = eventsToJson(eco.events);
    const copy = Economy.replay(eventsFromJson(json));
    expect(copy.stateHash()).toBe(eco.stateHash());
    expect(copy.events.length).toBe(eco.events.length);
  });

  it("note message equals the bytes the contract verifies", () => {
    const eco = basic();
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    const rec = eco.note("alice", "bob")!;
    const s = eco.signatures(rec);
    expect(bytesToHex(s.message)).toBe(bytesToHex(noteMessage(rec.key, rec.totalDebt, rec.timestamp, eco.t().nftId)));
  });
});
