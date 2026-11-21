// Tracker server emulator: create_note check order, censorship, confirmation cycle, the redemption gate
// (not-committed / not-confirmed / stale / multiple reserves / rate limit / min remainder) and exchanges.
import { describe, expect, it } from "vitest";
import { MIN_BOX_VALUE_NANOERG } from "./clock";
import { Economy, maxPayout } from "./economy";
import { erg, tokenDenomination } from "./note";
import { acceptAllPolicy, collateralPolicy } from "./policy";
import type { NoteSubmission } from "./tracker";

const USE = tokenDenomination("a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669", "USE", 3);

function world(o: { reserve?: boolean; heartbeat?: boolean } = {}) {
  const eco = new Economy({ seed: "tracker-tests" });
  eco.addDenomination(USE);
  eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", erg: erg(60), tokens: [[USE.id, 100_000n]] });
  eco.addParticipant({ id: "bob", erg: erg(1) });
  eco.addParticipant({ id: "carol", erg: erg(1) });
  eco.createTracker({ id: "t", operator: "op", denoms: [USE.id], globalPolicy: acceptAllPolicy(), options: o.heartbeat ? { skipIfUnchanged: false } : undefined });
  if (o.reserve !== false) eco.createReserve({ owner: "alice", amount: erg(10), id: "vault" });
  return { eco, t: eco.t(), alice: eco.p("alice"), bob: eco.p("bob"), carol: eco.p("carol") };
}

describe("POST /notes: check order (server order: reachability, censorship, NFT, denomination, range, time, decrease, signature)", () => {
  it("first failing check wins", () => {
    const { eco, t, alice, bob } = world();
    const now = eco.clock.nowMs();
    const sub = (o: Partial<NoteSubmission> = {}): NoteSubmission => ({ issuer: alice.pub, receiver: bob.pub, denom: "erg", totalDebt: erg(1), timestamp: now, trackerNftId: t.nftId, issuerSig: new Uint8Array(65), ...o });
    // everything wrong at once → offline is reported first
    const all = sub({ trackerNftId: "11".repeat(32), denom: `token:${"22".repeat(32)}` as const, timestamp: now + 10_000n, totalDebt: 1n << 63n });
    t.online = false;
    expect(t.checkNote(all, now)).toMatchObject({ ok: false, code: "tracker-offline", http: 503 });
    t.online = true;
    t.censorship = { mode: "refuse", targets: new Set([alice.pub]) };
    expect(t.checkNote(all, now)).toMatchObject({ code: "censored" });
    t.censorship = { mode: "off", targets: new Set() };
    expect(t.checkNote(all, now)).toMatchObject({ code: "tracker-nft-mismatch", http: 409 });
    expect(t.checkNote({ ...all, trackerNftId: t.nftId }, now)).toMatchObject({ code: "invalid-denomination", http: 400 });
    expect(t.checkNote({ ...all, trackerNftId: t.nftId, denom: "erg" }, now)).toMatchObject({ code: "amount-exceeds-contract-range" });
    expect(t.checkNote(sub({ timestamp: now + 1n }), now)).toMatchObject({ code: "future-timestamp" });
    expect(t.checkNote(sub(), now)).toMatchObject({ code: "invalid-signature" });
    // lazy submission (no signature yet) passes
    expect(t.checkNote(sub({ issuerSig: null }), now)).toMatchObject({ ok: true, omitted: false });
  });

  it("past timestamp is checked before the decrease, both before the signature", () => {
    const { eco, t, alice, bob } = world();
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(2) }).ok).toBe(true);
    const rec = t.note(alice.pub, bob.pub)!;
    const now = eco.clock.nowMs();
    const base: NoteSubmission = { issuer: alice.pub, receiver: bob.pub, denom: "erg", totalDebt: erg(1), timestamp: rec.timestamp, trackerNftId: t.nftId, issuerSig: new Uint8Array(65) };
    expect(t.checkNote(base, now)).toMatchObject({ code: "past-timestamp" });
    expect(t.checkNote({ ...base, timestamp: rec.timestamp + 1n }, rec.timestamp + 1n)).toMatchObject({ code: "debt-decrease-not-permitted" });
    expect(t.checkNote({ ...base, timestamp: rec.timestamp + 1n, totalDebt: erg(2) }, rec.timestamp + 1n)).toMatchObject({ code: "invalid-signature" });
  });

  it("create_note evaluates no acceptance policy (the receiver's wallet does)", () => {
    const { eco } = world();
    eco.setPolicy("bob", collateralPolicy(100, true)); // impossible to satisfy
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1) }).code).toBe("policy-rejected");
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1), skipAcceptance: true }).ok).toBe(true);
  });
});

describe("box updater and confirmation", () => {
  it("local → pending at the next 600 s cycle → confirmed one cycle later (depth ≥ 2)", () => {
    const { eco, t, alice, bob } = world();
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    const rec = t.note(alice.pub, bob.pub)!;
    expect(eco.noteStatus(rec)).toBe("local");
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("note-not-committed");
    const toBoundary = 5 - (eco.clock.height % 5 === 0 ? 5 : eco.clock.height % 5);
    eco.mine(toBoundary || 5);
    expect(eco.noteStatus(rec)).toBe("pending");
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("note-not-confirmed");
    eco.mine(5);
    expect(eco.noteStatus(rec)).toBe("confirmed");
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).ok).toBe(true);
  });

  it("an unchanged digest is not re-committed (idle tracker ages); the heartbeat option re-commits", () => {
    const idle = world();
    idle.eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    idle.eco.mine(10);
    const boxes = idle.t.boxes.length;
    idle.eco.mine(100);
    expect(idle.t.boxes.length).toBe(boxes);
    expect(idle.t.boxAge(idle.eco.clock.height)).toBeGreaterThan(100);
    const hb = world({ heartbeat: true });
    hb.eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    hb.eco.mine(10);
    const b0 = hb.t.boxes.length;
    hb.eco.mine(100);
    expect(hb.t.boxes.length).toBeGreaterThan(b0);
    expect(hb.t.boxAge(hb.eco.clock.height)).toBeLessThan(10);
  });

  it("censorship 'omit' accepts the note but keeps it out of the committed tree", () => {
    const { eco, t, alice, bob } = world();
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    eco.setCensorship("t", "omit", ["alice"]);
    expect(eco.pay({ from: "alice", to: "bob", amount: erg(1) }).ok).toBe(true);
    expect(eco.pay({ from: "carol", to: "bob", amount: erg("0.1"), skipAcceptance: true }).ok).toBe(true);
    const boxes = t.boxes.length;
    eco.mine(10);
    expect(t.boxes.length).toBe(boxes + 1);
    const rec = t.note(alice.pub, bob.pub)!;
    expect(rec.totalDebt).toBe(erg(2));
    expect(t.committedTotal(rec.key)).toBe(erg(1));
    // the stored (latest) version is never confirmed, so the tracker will not co-sign even the committed 1 ERG
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("note-not-confirmed");
  });
});

describe("redemption gate", () => {
  it("multiple tracked reserves in one denomination: the tracker refuses to sign", () => {
    const { eco } = world();
    eco.createReserve({ owner: "alice", amount: erg(5), id: "vault-2" });
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("multiple-reserves");
  });

  it("no tracked reserve: refused (the policy cannot be evaluated)", () => {
    const { eco } = world({ reserve: false });
    eco.pay({ from: "alice", to: "bob", amount: erg(1), skipAcceptance: true });
    eco.mine(10);
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("no-reserve");
  });

  it("rate limit: 60 builds per pair per hour", () => {
    const { eco } = world();
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    for (let i = 0; i < 60; i++) expect(eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("0.001") }).ok).toBe(true);
    expect(eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("0.001") }).code).toBe("rate-limited");
    eco.mine(30); // one hour of 120 s blocks
    expect(eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("0.001") }).ok).toBe(true);
    // replay restores the limiter state
    const replay = Economy.replay(eco.events);
    expect(replay.stateHash()).toBe(eco.stateHash());
  });

  it("an ERG reserve keeps 0.001 ERG; a token reserve keeps one unit", () => {
    const { eco } = world();
    eco.pay({ from: "alice", to: "bob", amount: erg(12), skipAcceptance: true });
    eco.mine(10);
    const vault = eco.r("vault");
    expect(maxPayout(vault)).toBe(erg(10) - MIN_BOX_VALUE_NANOERG);
    expect(eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(10) }).code).toBe("insufficient-collateral");
    const r = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(r.ok && r.amount).toBe(erg(10) - MIN_BOX_VALUE_NANOERG);
    expect(vault.collateral()).toBe(MIN_BOX_VALUE_NANOERG);
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("nothing-to-redeem");
    eco.createReserve({ owner: "alice", amount: 3_000n, denom: USE.id, id: "use" });
    eco.pay({ from: "alice", to: "carol", amount: 5_000n, denom: USE.id, skipAcceptance: true });
    eco.mine(10);
    const t = eco.redeem({ receiver: "carol", issuer: "alice", denom: USE.id });
    expect(t.ok && t.amount).toBe(2_999n);
  });

  it("the FIFO gate is the tracker's alone: an idle box lets the owner's self-note drain the reserve first", () => {
    const { eco } = world();
    eco.setGlobalPolicy("t", collateralPolicy(1.0, false));
    eco.pay({ from: "alice", to: "bob", amount: erg(8) });
    // the owner over-issues a self-note; through the tracker its redemption is refused (distressed → FIFO, it is the youngest)
    eco.selfNote({ who: "alice", amount: erg(9) });
    eco.mine(10);
    expect(eco.redeem({ receiver: "alice", issuer: "alice" }).code).toBe("failed_not_oldest_note");
    // three idle days later the emergency path needs no tracker at all
    eco.mine(2161);
    const drain = eco.redeem({ receiver: "alice", issuer: "alice", emergency: true });
    expect(drain.ok, drain.message).toBe(true);
    expect(drain.amount).toBe(erg(9));
    const bob = eco.redeem({ receiver: "bob", issuer: "alice", emergency: true });
    expect(bob.ok && bob.amount).toBe(erg(10) - erg(9) - MIN_BOX_VALUE_NANOERG);
  });

  it("stale committed debt: a consented decrease must be committed before the edge redeems", () => {
    const { eco } = world();
    eco.createReserve({ owner: "alice", amount: 50_000n, denom: USE.id, id: "use" });
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    eco.mine(10);
    const x = eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(2), to: USE.id, toAmount: 4_000n });
    expect(x.ok, x.message).toBe(true);
    expect(eco.redeem({ receiver: "bob", issuer: "alice" }).code).toBe("stale-committed-debt");
  });
});

describe("POST /notes/exchange", () => {
  it("validation: same denomination, no from-reserve, one in flight per pair, overflow", () => {
    const { eco } = world();
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    eco.pay({ from: "bob", to: "carol", amount: erg("0.5"), skipAcceptance: true });
    eco.mine(10);
    expect(eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: 1n, to: "erg", toAmount: 1n }).code).toBe("invalid-exchange");
    expect(eco.exchange({ issuer: "bob", receiver: "carol", from: "erg", fromAmount: 1n, to: USE.id, toAmount: 1n }).code).toBe("no-reserve");
    expect(eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(6), to: USE.id, toAmount: 1n }).code).toBe("invalid-exchange");
    expect(eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(1), to: USE.id, toAmount: 1_000n }).ok).toBe(true);
    const again = eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(1), to: USE.id, toAmount: 1_000n });
    expect(again.code).toBe("invalid-exchange");
    expect(again.message).toMatch(/already staged/);
  });

  it("phase 2 waits for confirmation, then applies; a new note on the to-edge cancels", () => {
    const { eco, t } = world();
    eco.pay({ from: "alice", to: "bob", amount: erg(5) });
    eco.mine(10);
    const a = eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(1), to: USE.id, toAmount: 2_000n });
    const x = t.exchanges.get(a.exchange!.id)!;
    expect(t.decideExchange(x, eco.r("vault").box!.boxId)).toEqual({ decision: "wait" });
    eco.mine(15);
    expect(x.status).toBe("applied");
    // second exchange; Alice issues a USE note to Bob while it is staged → cancelled
    const b = eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(1), to: USE.id, toAmount: 2_000n });
    eco.pay({ from: "alice", to: "bob", amount: 500n, denom: USE.id, skipAcceptance: true });
    eco.mine(15);
    const y = t.exchanges.get(b.exchange!.id)!;
    expect(y.status).toBe("cancelled");
    expect(y.reason).toMatch(/to-edge changed/);
    expect(eco.note("alice", "bob")!.totalDebt).toBe(erg(3)); // the from-edge decrease stays
  });

  it("the global predicate gates the to-edge (only when predicates are configured)", () => {
    const { eco } = world();
    eco.setGlobalPolicy("t", collateralPolicy(100, false));
    eco.pay({ from: "alice", to: "bob", amount: erg(5), skipAcceptance: true });
    eco.mine(10);
    expect(eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: erg(1), to: USE.id, toAmount: 1n }).code).toBe("exchange-policy-rejected");
  });
});
