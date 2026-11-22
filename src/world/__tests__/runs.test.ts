import { beforeAll, describe, expect, it } from "vitest";
import { ERGO_AVL_WASM, eventsToJson, listScenarios, runScenario, setAvlBackend, useAvlBackend, type AvlBackend, type ScenarioId } from "@/protocol";
import { createFreeRun, createRun, importRun, RunController, RunImportError } from "../runs";
import { describeEvent } from "../feed";
import { ensureAvl } from "../avl";

let wasm: AvlBackend;
beforeAll(async () => {
  wasm = await useAvlBackend(ERGO_AVL_WASM);
  setAvlBackend(wasm);
  const { backend } = await ensureAvl();
  expect(backend.id).toBe(wasm.id);
});

const ids = listScenarios().map((s) => s.id as ScenarioId);

describe("scenario runs", () => {
  it("step() mirrors the engine: same log and state hash as runScenario, every outcome ok", async () => {
    for (const id of ids) {
      const engine = runScenario(id);
      const run = await createRun(id);
      await run.runAll();
      expect(run.results.map((r) => r.outcome.ok)).toEqual(engine.results.map((r) => r.outcome.ok));
      expect(run.results.every((r) => r.outcome.ok), id).toBe(true);
      expect(run.eco.events.length, id).toBe(engine.eco.events.length);
      expect(run.eco.stateHash(), id).toBe(engine.eco.stateHash());
      const s = run.store.getState();
      run.flush();
      expect(run.store.getState().ok).toBe(true);
      expect(run.store.getState().status).toBe("done");
      expect(s.scenario?.id).toBe(id);
      run.dispose();
    }
  }, 120_000);

  it("animate() mines block by block and every step still tells its story", async () => {
    for (const id of ids) {
      if (id === "agent-swarm") continue; // same steps as step(); covered above
      const run = await createRun(id);
      while (!run.done) {
        const r = await run.animate({ blockMs: 0, maxFrames: 6 });
        expect(r.outcome.ok, `${id}/${r.id}: ${r.outcome.detail}`).toBe(true);
      }
      run.dispose();
    }
  }, 120_000);

  it("current step, outcomes and events of a step", async () => {
    const run = await createRun("cafe-on-credit");
    const first = run.store.getState().current;
    expect(first?.index).toBe(0);
    const r = await run.step();
    expect(run.eventsOf(r)[0].type).toBe("scenario.step");
    expect(run.eventsOf(0).length).toBe(r.toSeq - r.fromSeq + 1);
    run.flush();
    const s = run.store.getState();
    expect(s.results).toHaveLength(1);
    expect(s.current?.index).toBe(1);
    expect(s.status).toBe("ready");
    // settle after a step without mining
    const r2 = await run.step({ mine: false });
    run.flush();
    expect(run.store.getState().pending).toBe(true);
    run.mine(r2.index >= 0 ? (run.scenario!.steps[r2.index].waitBlocks ?? 0) : 0);
    run.settle();
    run.flush();
    expect(run.store.getState().pending).toBe(false);
    expect(run.store.getState().tampered).toBe(false); // the step's own wait, mined by the page
    // the page-driven mining is recorded: an export re-runs it exactly
    const back = await importRun(run.exportJson());
    expect(back.mode).toBe("scenario");
    expect(back.eco.stateHash()).toBe(run.eco.stateHash());
    back.dispose();
    run.dispose();
  });

  it("time machine: stateAt, view, fork, diff, marks, verify", async () => {
    const run = await createRun("free-bank");
    await run.runAll();
    const mid = Math.floor(run.eco.events.length / 2);
    const past = run.stateAt(mid);
    expect(past.events.length).toBe(mid + 1);
    expect(run.view(mid)).not.toBeNull();
    run.flush();
    expect(run.store.getState().viewSeq).toBe(mid);
    expect(run.store.getState().view?.events.length).toBe(mid + 1);
    run.view(null);
    run.flush();
    expect(run.store.getState().view).toBeNull();
    const d = run.diff(mid);
    expect(d.height.a).toBeLessThanOrEqual(d.height.b);
    expect(run.marks((m) => m.kind === "step").length).toBe(run.scenario!.steps.length + 1);
    expect(run.verify().ok).toBe(true);
    const fork = run.fork(mid);
    expect(fork.mode).toBe("fork");
    const before = run.eco.stateHash();
    fork.mine(50);
    expect(fork.eco.clock.height).toBeGreaterThan(past.clock.height);
    expect(run.eco.stateHash()).toBe(before); // the original is untouched
    fork.dispose();
    run.dispose();
  });

  it("export → import: a scenario run is re-run live (same hash); a tampered one is replayed", async () => {
    const run = await createRun("triangle-novation", { seed: "share/1" });
    await run.step();
    await run.animate({ blockMs: 0, maxFrames: 3 });
    const json = run.exportJson();
    const back = await importRun(json);
    expect(back.mode).toBe("scenario");
    expect(back.index).toBe(run.index);
    expect(back.eco.stateHash()).toBe(run.eco.stateHash());
    expect(eventsToJson(back.eco.events)).toBe(eventsToJson(run.eco.events));
    await back.runAll();
    expect(back.results.every((r) => r.outcome.ok)).toBe(true);

    run.mine(3); // a command outside the story
    const replay = await importRun(run.exportJson());
    expect(replay.mode).toBe("replay");
    expect(replay.eco.stateHash()).toBe(run.eco.stateHash());
    await expect(replay.step()).rejects.toThrow();
    await expect(importRun("{\"head\":{}}")).rejects.toBeInstanceOf(RunImportError);
    for (const r of [run, back, replay]) r.dispose();
  });

  it("free mode on a fresh small world", async () => {
    const free = await createFreeRun({ seed: "free/test" });
    expect(free.mode).toBe("free");
    expect(free.store.getState().status).toBe("free");
    const r = free.pay({ from: "alice", to: "bob", amount: 1_000_000_000n });
    expect(r.ok).toBe(true);
    free.mine(12);
    const red = free.redeem({ receiver: "bob", issuer: "alice", amount: 500_000_000n });
    expect(red.ok, red.ok ? "" : `${red.code}: ${red.message}`).toBe(true);
    const items = free.eco.events.map((e) => describeEvent(free.eco, e, "en"));
    expect(items.some((i) => i.type === "reserve.redeemed" && i.text.includes("Bob"))).toBe(true);
    const back = await importRun(free.exportJson());
    expect(back.mode).toBe("free");
    expect(back.eco.stateHash()).toBe(free.eco.stateHash());
    const empty = await createFreeRun({ world: "empty" });
    expect(empty.eco.participants.size).toBe(1);
    const townCopy = await createFreeRun({ world: "town" });
    expect(townCopy.eco.participants.has("you")).toBe(false);
    for (const x of [free, back, empty, townCopy]) x.dispose();
  });

  it("store updates are batched: one notification for a whole step", async () => {
    const run = new RunController({ mode: "scenario", scenario: (await import("@/protocol")).getScenario("clearing-circle"), seed: "scenario/clearing-circle", avl: wasm });
    let n = 0;
    const unsub = run.store.subscribe(() => n++);
    await run.step();
    await new Promise((r) => setTimeout(r, 5));
    expect(n).toBeGreaterThan(0);
    expect(n).toBeLessThanOrEqual(3);
    unsub();
    run.dispose();
  });
});
