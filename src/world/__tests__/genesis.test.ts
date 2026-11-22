import { beforeAll, describe, expect, it } from "vitest";
import { Economy, ERGO_AVL_WASM, eventsFromJson, eventsToJson, SIMULATED_AVL, setAvlBackend, useAvlBackend, type AvlBackend } from "@/protocol";
import { buildTown, SUSE_ID, TOWN_TRACKER, GENESIS_HISTORY_BLOCKS, SANDBOX_GENESIS_HEIGHT } from "../town/genesis";
import { buildEmptyWorld, buildSmallWorld } from "../runs";

let wasm: AvlBackend;
beforeAll(async () => {
  wasm = await useAvlBackend(ERGO_AVL_WASM);
  setAvlBackend(SIMULATED_AVL);
});

describe("town genesis", () => {
  it("is deterministic (simulated and real AVL+)", () => {
    for (const avl of [SIMULATED_AVL, wasm]) {
      const a = buildTown({ avl });
      const b = buildTown({ avl });
      expect(a.stateHash()).toBe(b.stateHash());
      expect(eventsToJson(a.events)).toBe(eventsToJson(b.events));
      const r = Economy.replay(eventsFromJson(eventsToJson(a.events)), { avl });
      expect(r.stateHash()).toBe(a.stateHash());
    }
  });

  it("has the promised shape: healthy, thin and pure-credit issuers, both denominations, all statuses", () => {
    const eco = buildTown({ avl: wasm });
    expect(eco.clock.height - eco.clock.genesisHeight).toBe(GENESIS_HISTORY_BLOCKS);
    // sandbox blocks are counted from 1, so they never look like real Ergo blocks (≈ 1.9 M)
    expect(SANDBOX_GENESIS_HEIGHT).toBe(1);
    expect(eco.clock.genesisHeight).toBe(SANDBOX_GENESIS_HEIGHT);
    for (const w of [buildSmallWorld("h", wasm), buildEmptyWorld("h", wasm)]) expect(w.clock.genesisHeight).toBe(SANDBOX_GENESIS_HEIGHT);
    const alice = eco.coverage("alice", "erg");
    const bakery = eco.coverage("bakery", "erg");
    const dan = eco.coverage("dan", "erg");
    expect(alice.ratio!).toBeGreaterThanOrEqual(1.5);
    expect(bakery.ratio!).toBeGreaterThan(1.0);
    expect(bakery.ratio!).toBeLessThan(1.2);
    expect(dan.reserves).toBe(0);
    expect(dan.liabilities).toBeGreaterThan(0n);
    expect(eco.coverage("cafe", SUSE_ID).ratio!).toBeGreaterThan(1.2);
    const statuses = new Set([...eco.t(TOWN_TRACKER).notes.values()].map((n) => eco.noteStatus(n)));
    expect(statuses.has("confirmed")).toBe(true);
    expect(statuses.has("local")).toBe(true);
    expect(eco.events.some((e) => e.type === "reserve.redeemed")).toBe(true);
    expect(eco.events.some((e) => e.type === "tracker.committed")).toBe(true);
    expect([...eco.t(TOWN_TRACKER).notes.values()].every((n) => n.omitted === false)).toBe(true);
  });
});
