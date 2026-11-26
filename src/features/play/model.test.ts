// /play model: the stage layout, the time-machine mapping, transaction / refusal rebuilds and the cheats, on every
// engine scenario (real AVL+ backend, like src/world/__tests__/runs.test.ts).
import { beforeAll, describe, expect, it } from "vitest";
import { ERGO_AVL_WASM, setAvlBackend, useAvlBackend, type ScenarioId, type SimTx } from "@/protocol";
import { createFreeRun, createRun, scenarioList, type RunController } from "@/world";
import { buildStage, CHEATS, reserveWord, denomViews, marksOf, ONCHAIN_TYPES, rebuildRefusal, rebuildTx, REFUSAL_TYPES, runCheat, segmentsOf, seqOfX, xOfSeq, type CheatId } from "./model";

beforeAll(async () => {
  setAvlBackend(await useAvlBackend(ERGO_AVL_WASM));
});

const ids = scenarioList().map((s) => s.id as ScenarioId);
const synth = (): SimTx => ({ id: "synth" }) as unknown as SimTx;

const EXPECTED: Record<CheatId, string> = {
  double: "properRedemptionTree",
  replay: "timestampCorrect",
  over: "properlyRedeemed",
  forged: "properReserveSignature",
  early: "trackerSigValid",
  refund: "refundPeriodOver",
};

function checkCheats(run: RunController, label: string, seen: Record<string, number>) {
  const eco = run.store.getState().view ?? run.eco;
  const hash = eco.stateHash();
  const len = eco.events.length;
  for (const id of CHEATS) {
    const r = runCheat(id, eco, "en");
    if (!r) continue;
    seen[id] = (seen[id] ?? 0) + 1;
    expect(r.passed, `${label} ${id}`).toBe(false);
    // the card names the first failing check in contract order: it must be the one this cheat is about
    if (r.stage === "contract") expect(r.failed[0], `${label} ${id} ${r.code} ${r.message} [${r.failed.join(",")}]`).toBe(EXPECTED[id]);
    else expect(id === "over" || id === "early" || id === "double", `${label} ${id} refused at ${r.stage}: ${r.code}`).toBe(true);
  }
  // the run itself never changes
  expect(eco.events.length).toBe(len);
  expect(eco.stateHash()).toBe(hash);
}

describe("play model on every scenario", () => {
  it("lays out the stage, maps the timeline and rebuilds every transaction and refusal", async () => {
    const stats: Record<string, { tx: number; matched: number; refusals: number; rebuiltEval: number }> = {};
    for (const id of ids) {
      const run = await createRun(id);
      await run.runAll();
      const eco = run.eco;
      // stage
      for (const d of denomViews(eco).filter((x) => x.notes > 0)) {
        for (const [w, h] of [
          [1240, 760],
          [390, 560],
        ]) {
          const m = buildStage(eco, d.id, w, h, "ru");
          expect(m.nodes.length, id).toBeGreaterThan(0);
          for (const n of m.nodes) expect(Number.isFinite(n.x) && Number.isFinite(n.y), `${id} node ${n.id}`).toBe(true);
          for (const e of m.edges) expect(e.d.includes("NaN"), `${id} edge ${e.id}`).toBe(false);
          expect(m.netSum, `${id} Σ net`).toBe(0n);
          if (m.loop) expect(m.loop.x > 0 && m.loop.x < w && m.loop.y > 0 && m.loop.y < h, `${id} loop mark inside the stage`).toBe(true);
        }
      }
      // timeline
      const st = run.store.getState();
      const last = eco.events.length - 1;
      const segs = segmentsOf(st.results, last, st.steps.length, true);
      let prev = -1;
      for (let s = 0; s <= last; s += Math.max(1, Math.floor(last / 300))) {
        const x = xOfSeq(segs, s);
        expect(x, `${id} x(${s})`).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = x;
        expect(seqOfX(segs, x, last), `${id} seq(x(${s}))`).toBe(s);
      }
      const { marks } = marksOf(eco);
      for (let i = 1; i < marks.length; i++) expect(marks[i].seq).toBeGreaterThan(marks[i - 1].seq);
      // transactions and refusals
      const s0 = { tx: 0, matched: 0, refusals: 0, rebuiltEval: 0 };
      const chain = eco.events.filter((e) => ONCHAIN_TYPES.has(e.type) && e.type !== "reserve.created");
      for (const e of chain.slice(0, 40)) {
        const tv = rebuildTx(run, eco, e, synth);
        if (e.type === "clearing.settled" && e.mode !== "onchain") continue;
        expect(tv, `${id} tx for ${e.type} #${e.seq}`).not.toBeNull();
        s0.tx++;
        if (tv?.matches) s0.matched++;
      }
      for (const e of eco.events.filter((x) => REFUSAL_TYPES.has(x.type)).slice(0, 20)) {
        const rv = rebuildRefusal(run, e);
        expect(rv, `${id} refusal #${e.seq}`).not.toBeNull();
        s0.refusals++;
        if (rv?.outcome) s0.rebuiltEval++;
      }
      stats[id] = s0;
      run.dispose();
    }
    // every rebuilt transaction carries the recorded id
    for (const [id, s] of Object.entries(stats)) expect(s.matched, `${id}: ${JSON.stringify(s)}`).toBe(s.tx);
    console.info("[play] rebuilds", JSON.stringify(stats));
  }, 300_000);

  it("every cheat is refused, at the check the panel names, without touching the run", async () => {
    const seen: Record<string, number> = {};
    for (const id of ids) {
      if (id === "agent-swarm") continue;
      const run = await createRun(id);
      const half = Math.ceil(run.store.getState().steps.length / 2);
      for (let i = 0; i < half; i++) await run.step();
      checkCheats(run, `${id}@${half}`, seen);
      await run.runAll();
      checkCheats(run, `${id}@end`, seen);
      run.dispose();
    }
    console.info("[play] cheats tried", JSON.stringify(seen));
    for (const id of CHEATS) expect(seen[id] ?? 0, id).toBeGreaterThan(0);
  }, 300_000);

  it("free mode: cheats wait for a committed note, then every one is refused", async () => {
    const run = await createFreeRun({ seed: "test/free" });
    const seen: Record<string, number> = {};
    expect(runCheat("double", run.eco, "en")).toBeNull();
    run.exec((eco) => eco.pay({ from: "alice", to: "bob", amount: 2_000_000_000n }));
    run.mine(12);
    checkCheats(run, "free", seen);
    for (const id of CHEATS) expect(seen[id] ?? 0, id).toBeGreaterThan(0);
    run.dispose();
  }, 120_000);
});

describe("the reserve line beside a seal", () => {
  it("prints the coverage up to 999 %, and the reserve itself past that", () => {
    const plain = (s: string) => s.replace(/[\s\u2060]/g, "");
    expect(plain(reserveWord(4, 2_000_000_000n, 9, "ERG"))).toBe("400%");
    expect(plain(reserveWord(9.99, 2_000_000_000n, 9, "ERG"))).toBe("999%");
    expect(plain(reserveWord(200, 20_000_000_000n, 9, "ERG"))).toMatch(/^20[.,]00ERG$/);
  });
});
