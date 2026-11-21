import { describe, expect, it } from "vitest";
import { Economy } from "./economy";
import { eventsFromJson, eventsToJson } from "./events";
import { listScenarios, runScenario, SCENARIOS, ScenarioRun } from "./scenarios";
import { TimeMachine } from "./timemachine";

describe("scenarios", () => {
  it("has at least the 9 required presets", () => {
    const ids = listScenarios().map((s) => s.id);
    for (const id of ["cafe-on-credit", "agent-swarm", "village-lets", "free-bank", "tracker-vanishes", "refund-race", "triangle-novation", "clearing-circle", "censoring-tracker"]) {
      expect(ids).toContain(id);
    }
    expect(ids.length).toBeGreaterThanOrEqual(9);
  });

  for (const s of SCENARIOS) {
    it(`${s.id}: every step behaves as the story says, and the log replays exactly`, () => {
      const params = s.id === "agent-swarm" ? { agents: 12, burst1: 300, burst2: 600 } : undefined;
      const { eco, results } = runScenario(s.id, { params });
      for (const r of results) expect(r.outcome.ok, `${s.id} / ${r.id}: ${r.outcome.detail}`).toBe(true);
      expect(results.length).toBe(s.steps.length);
      const replay = Economy.replay(eventsFromJson(eventsToJson(eco.events)));
      expect(replay.stateHash()).toBe(eco.stateHash());
    });
  }

  it("steps can be played without mining (the UI animates the blocks)", () => {
    const run = new ScenarioRun("cafe-on-credit");
    let mined = 0;
    while (!run.done) {
      const step = run.current!;
      const r = run.step({ mine: false });
      expect(r.minedBlocks).toBe(0);
      if (step.waitBlocks) {
        for (let i = 0; i < step.waitBlocks; i++) run.eco.mine(1);
        mined += step.waitBlocks;
      }
      run.settle();
      expect(r.minedBlocks).toBe(step.waitBlocks ?? 0);
    }
    expect(run.results.every((r) => r.outcome.ok)).toBe(true);
    expect(mined).toBe(20);
    expect(new TimeMachine(run.eco).marks((m) => m.kind === "step").length).toBe(run.scenario.steps.length + 1);
  });
});
