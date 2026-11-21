// TEMPORARY probe written by the protocol review; deleted after the review.
import { describe, expect, it } from "vitest";
import { Economy } from "./economy";
import { erg, noteMessage } from "./note";
import { acceptAllPolicy, defaultCollateralPolicy } from "./policy";
import { contractSignatureHolds, sign, verify } from "./schnorr";
import { concatBytes, hexToBytes } from "./bytes";
import { demoKeyPair } from "./keys";

function basic() {
  const eco = new Economy({ seed: "probe", lazySignatures: true });
  eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", erg: erg(100) });
  eco.addParticipant({ id: "bob", erg: erg(1) });
  eco.addParticipant({ id: "carol", erg: erg(10) });
  eco.createTracker({ id: "t1", name: "T", operator: "op", globalPolicy: acceptAllPolicy() });
  return eco;
}

describe("probe", () => {
  it("busy tracker: unchanged confirmed note while a new box is pending", () => {
    const eco = basic();
    eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    const rec = eco.note("alice", "bob")!;
    console.log("after 10 blocks", eco.noteStatus(rec));
    eco.pay({ from: "carol", to: "alice", amount: erg(1), skipAcceptance: true });
    eco.mine(5);
    console.log("after another payment + 5 blocks", eco.noteStatus(rec), "box confirmed?", eco.t().isConfirmed());
    const r = eco.redeem({ receiver: "bob", issuer: "alice" });
    console.log("redeem", r.ok, r.code);
  });

  it("66-byte signature a || 00 || z", () => {
    const k = demoKeyPair("alice");
    const msg = noteMessage(new Uint8Array(32).fill(7), 5n, 6n, new Uint8Array(32).fill(9));
    const s = sign(msg, k);
    const s66 = concatBytes(s.slice(0, 33), new Uint8Array([0]), s.slice(33));
    let r: unknown;
    try { r = contractSignatureHolds(k.pub, msg, s66); } catch (e) { r = (e as Error).message; }
    console.log("contract view of 66-byte sig:", r, "verify():", verify(k.pub, msg, s66).ok);
  });

  it("triangle balance sheet after betrayal", () => {
    const eco = new Economy({ seed: "tri" });
    eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(2) });
    eco.addParticipant({ id: "alice", erg: erg(15) });
    eco.addParticipant({ id: "bob", erg: erg(1) });
    eco.addParticipant({ id: "carol", erg: erg(1) });
    eco.createTracker({ id: "delta", name: "Delta", operator: "op", globalPolicy: defaultCollateralPolicy() });
    eco.createReserve({ owner: "alice", amount: erg(10), id: "alice-vault" });
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    eco.novate({ issuer: "alice", from: "bob", to: "carol", amount: erg(3) });
    eco.mine(10);
    console.log("carol redeem", eco.redeem({ receiver: "carol", issuer: "alice" }).ok);
    console.log("bob redeem", eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(5) }).ok);
    const b = eco.balanceSheet("bob");
    const a = eco.balanceSheet("alice");
    console.log("bob assets", b.assets, "assetsOnChain", b.assetsOnChain, "lines", b.counterparties);
    console.log("alice liabilities", a.liabilities, "onChain", a.liabilitiesOnChain);
    console.log("edges", eco.debtEdges());
  });
});
