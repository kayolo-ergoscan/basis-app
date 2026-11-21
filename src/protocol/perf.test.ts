// Performance budget: the agent swarm with 5 000 payments must run in well under 2 s with lazy signatures,
// and the signatures must still be real (materialise a sample and verify it under the contract's rules).
import { describe, expect, it } from "vitest";
import { contractSignatureHolds } from "./schnorr";
import { getScenario, ScenarioRun, swarmBurst } from "./scenarios";

describe("performance", () => {
  it("agent swarm: 5 000 payments < 2 s, sampled signatures valid", () => {
    const t0 = performance.now();
    const run = new ScenarioRun(getScenario("agent-swarm"), { params: { agents: 24, burst1: 1000, burst2: 4000 } });
    const results = run.runAll();
    const total = performance.now() - t0;
    for (const r of results) expect(r.outcome.ok, `${r.id}: ${r.outcome.detail}`).toBe(true);
    const s = run.eco.stats();
    expect(s.payments).toBeGreaterThanOrEqual(4500);
    console.log(`[perf] agent-swarm: ${s.payments} payments over ${s.notes} notes, ${run.eco.events.length} events, ${total.toFixed(0)} ms total`);
    expect(total).toBeLessThan(2000);

    // materialise a sample of lazily-signed note versions and check them exactly as basis.es would
    const notes = [...run.eco.t().notes.values()];
    let checked = 0;
    for (let i = 0; i < notes.length; i += Math.ceil(notes.length / 40)) {
      const rec = notes[i];
      const sig = run.eco.signatures(rec);
      expect(sig.issuerSigOk).toBe(true);
      expect(contractSignatureHolds(rec.issuer, sig.message, sig.issuerSig)).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThanOrEqual(30);
  });

  it("raw payment throughput (lazy signatures)", () => {
    const run = new ScenarioRun("agent-swarm", { params: { agents: 32, burst1: 0, burst2: 0 } });
    run.step(); // reserves + policies
    const r = swarmBurst(run.eco, run.ctx, 5000, "throughput");
    console.log(`[perf] 5 000 payments: ${r.ms.toFixed(0)} ms (${((r.ok / r.ms) * 1000).toFixed(0)} payments/s), ${r.rejected} rejected by policy`);
    expect(r.ok + r.rejected).toBe(5000);
    expect(r.ms).toBeLessThan(2000);
  });

  it("materialize() signs pending versions within a time budget", () => {
    const run = new ScenarioRun("agent-swarm", { params: { agents: 12, burst1: 400, burst2: 0 } });
    run.step();
    run.step();
    const before = run.eco.pendingSignatures();
    expect(before).toBeGreaterThan(0);
    const t0 = performance.now();
    let done = 0;
    while (run.eco.pendingSignatures() > 0) done += run.eco.materialize(8);
    const ms = performance.now() - t0;
    console.log(`[perf] materialised ${done} signatures in ${ms.toFixed(0)} ms (${(ms / Math.max(1, done)).toFixed(2)} ms each)`);
    expect(done).toBe(before);
  });
});
