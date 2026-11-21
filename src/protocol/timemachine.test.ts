import { describe, expect, it } from "vitest";
import { Economy } from "./economy";
import type { EconomyEvent } from "./events";
import { erg } from "./note";
import { runScenario, ScenarioRun } from "./scenarios";
import { checkDeterminism, heightAfter, TimeMachine } from "./timemachine";

describe("time machine", () => {
  it("stateAt(seq) equals the live state captured right after each event", () => {
    const run = new ScenarioRun("free-bank");
    const live = new Map<number, string>();
    run.eco.subscribe((e: EconomyEvent) => live.set(e.seq, run.eco.stateHash()));
    run.runAll();
    const tm = new TimeMachine(run.eco, { checkpointEvery: 16 });
    const seqs = [...live.keys()];
    expect(seqs.length).toBeGreaterThan(40);
    // forwards (frontier), then backwards and random (checkpoints)
    for (const s of seqs) expect(tm.stateAt(s).stateHash(), `seq ${s}`).toBe(live.get(s));
    for (const s of [...seqs].reverse().filter((_, i) => i % 3 === 0)) expect(tm.stateAt(s).stateHash(), `seq ${s}`).toBe(live.get(s));
    expect(tm.verify(run.eco).ok).toBe(true);
  });

  it("states handed out are independent copies", () => {
    const { eco } = runScenario("cafe-on-credit");
    const tm = new TimeMachine(eco);
    const a = tm.stateAt(10);
    const h = a.stateHash();
    a.pay({ from: "alice", to: "cafe", amount: erg(1), skipAcceptance: true });
    expect(tm.stateAt(10).stateHash()).toBe(h);
    expect(eco.stateHash()).toBe(Economy.replay(eco.events).stateHash());
  });

  it("fork: an alternate history diverges, the original is untouched", () => {
    const { eco } = runScenario("tracker-vanishes");
    const tm = new TimeMachine(eco);
    const vanish = eco.events.find((e) => e.type === "tracker.status" && e.online === false)!;
    const fork = tm.fork(vanish.seq - 1); // just before the tracker disappears
    expect(fork.t().online).toBe(true);
    fork.mine(10);
    const r = fork.redeem({ receiver: "bob", issuer: "alice" });
    expect(r.ok, r.message).toBe(true);
    expect(r.amount).toBe(erg(4)); // with an honest tracker the uncommitted +1 is committed and paid
    const d = TimeMachine.diff(eco, fork);
    expect(d.divergedAt).toBe(vanish.seq);
    expect(d.wallets.find((w) => w.participant === "bob")).toBeDefined();
    expect(tm.verify(eco).ok).toBe(true);
  });

  it("stateAtHeight lands inside long mined ranges", () => {
    const { eco } = runScenario("refund-race");
    const tm = new TimeMachine(eco);
    const big = eco.events.find((e) => e.type === "chain.mined" && e.to - e.from > 1000)!;
    expect(big).toBeDefined();
    const mid = Math.floor((heightAfter(big) + big.height) / 2);
    const s = tm.stateAtHeight(mid);
    expect(s.clock.height).toBe(mid);
    expect(s.r("alice-vault").active).toBe(true);
    expect(tm.stateAtHeight(eco.clock.height).stateHash()).toBe(eco.stateHash());
    expect(tm.seqAtHeight(eco.events[0].height - 1)).toBe(-1);
  });

  it("deterministic: the same scenario twice gives identical logs, signatures and hashes", () => {
    const res = checkDeterminism(() => runScenario("clearing-circle").eco);
    expect(res.ok).toBe(true);
    const a = runScenario("agent-swarm", { params: { agents: 10, burst1: 200, burst2: 300 } }).eco;
    const b = runScenario("agent-swarm", { params: { agents: 10, burst1: 200, burst2: 300 } }).eco;
    expect(a.stateHash()).toBe(b.stateHash());
    const ra = [...a.t().notes.values()][7];
    const rb = [...b.t().notes.values()][7];
    expect(a.signatures(ra).issuerSig).toEqual(b.signatures(rb).issuerSig);
    const c = runScenario("agent-swarm", { seed: "another", params: { agents: 10, burst1: 200, burst2: 300 } }).eco;
    expect(c.stateHash()).not.toBe(a.stateHash());
  });

  it("marks: steps, money and alerts for the scrubber", () => {
    const { eco } = runScenario("free-bank");
    const tm = new TimeMachine(eco);
    const steps = tm.marks((m) => m.kind === "step");
    expect(steps.length).toBe(12);
    expect(tm.marks((m) => m.kind === "alert").length).toBeGreaterThanOrEqual(2);
    expect(tm.marks((m) => m.kind === "reject").length).toBeGreaterThanOrEqual(3);
    expect(tm.marks((m) => m.kind === "money").every((m) => m.label.length > 0)).toBe(true);
  });

  it("sync appends a continuation and refuses a different log", () => {
    const run = new ScenarioRun("triangle-novation");
    run.step();
    const tm = new TimeMachine(run.eco);
    const n = tm.length;
    run.runAll();
    expect(tm.sync(run.eco)).toBe(run.eco.events.length - n);
    expect(tm.stateAt(tm.lastSeq).stateHash()).toBe(run.eco.stateHash());
    const other = runScenario("cafe-on-credit").eco;
    expect(() => tm.sync(other)).toThrow(/continuation/);
  });
});
