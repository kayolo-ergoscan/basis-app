// Performance budgets of the world layer (numbers printed for the report): bot traffic per block, replay
// (restore) time of a typical town, the slowest synchronous slice of every scenario step.
import { beforeAll, describe, expect, it } from "vitest";
import { Economy, ERGO_AVL_WASM, listScenarios, setAvlBackend, useAvlBackend, type AvlBackend, type ScenarioId } from "@/protocol";
import { runBots, type PaymentRequest } from "../town/bots";
import { buildTown, TOWN_SEED } from "../town/genesis";
import { RunController } from "../runs";
import { getScenario } from "@/protocol";

let wasm: AvlBackend;
beforeAll(async () => {
  wasm = await useAvlBackend(ERGO_AVL_WASM);
  setAvlBackend(wasm);
});

const now = () => performance.now();

/** Longest gap between event-loop turns while `work` runs (what a user would feel as a freeze). */
async function maxBlock(work: () => Promise<unknown>): Promise<number> {
  let last = now();
  let worst = 0;
  let on = true;
  const probe = () => {
    const t = now();
    worst = Math.max(worst, t - last);
    last = t;
    if (on) setTimeout(probe, 0);
  };
  setTimeout(probe, 0);
  await work();
  on = false;
  const t = now();
  worst = Math.max(worst, t - last);
  return worst;
}

describe("world performance", () => {
  it("a typical town restores well under 300 ms", () => {
    const eco = buildTown({ avl: wasm });
    const requests: PaymentRequest[] = [];
    const t0 = now();
    // a typical session: one hour of the default clock (2 s per block) = 1 800 blocks
    for (let i = 0; i < 1800; i++) {
      eco.mine(1);
      runBots(eco, TOWN_SEED, requests);
    }
    const live = now() - t0;
    const events = eco.events.slice();
    const r0 = now();
    const back = Economy.replay(events, { avl: wasm });
    const replayMs = now() - r0;
    console.log(`[world perf] 1800 blocks with bots: ${events.length} events (${(events.length / 1800).toFixed(2)}/block), live ${live.toFixed(0)} ms, replay ${replayMs.toFixed(0)} ms (${((replayMs / events.length) * 1000).toFixed(1)} µs/event)`);
    expect(back.stateHash()).toBe(eco.stateHash());
    expect(replayMs).toBeLessThan(300);
  });

  it("no scenario step blocks the event loop for long", async () => {
    const rows: string[] = [];
    let worstAll = 0;
    for (const s of listScenarios()) {
      const run = new RunController({ mode: "scenario", scenario: getScenario(s.id as ScenarioId), seed: `scenario/${s.id}`, avl: wasm });
      const worst = await maxBlock(() => run.runAll());
      worstAll = Math.max(worstAll, worst);
      rows.push(`${s.id}: ${worst.toFixed(0)} ms`);
      expect(run.results.every((r) => r.outcome.ok)).toBe(true);
      run.dispose();
    }
    console.log(`[world perf] longest blocking slice per scenario run: ${rows.join(", ")}`);
    expect(worstAll).toBeLessThan(100); // the brief: no freeze longer than ~100 ms
  }, 120_000);
});
