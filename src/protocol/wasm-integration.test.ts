// The engine on the REAL Ergo AVL+ (avl-wasm/): every digest and proof is chain bytes, and the reserve
// contract evaluator verifies the proofs statelessly ("verified" mode).
import { beforeAll, describe, expect, it } from "vitest";
import { bytesToHex } from "./bytes";
import { getAvlBackend, setAvlBackend, SIMULATED_AVL, useAvlBackend, type AvlBackend } from "./avl";
import { Economy } from "./economy";
import { ERGO_AVL_WASM } from "./index";
import { erg } from "./note";
import { acceptAllPolicy } from "./policy";
import { basisAvlRegister, EMPTY_AVL_DIGEST_HEX } from "./registers";
import { runScenario, SCENARIOS } from "./scenarios";

let wasm: AvlBackend;

beforeAll(async () => {
  wasm = await useAvlBackend(ERGO_AVL_WASM);
  setAvlBackend(SIMULATED_AVL); // keep the global default; pass the backend explicitly below
});

describe("engine × real Ergo AVL+ (WASM)", () => {
  it("loads the backend through the registry", () => {
    expect(wasm.simulated).toBe(false);
    expect(wasm.verifier).not.toBeNull();
    expect(getAvlBackend().id).toBe("simulated");
    expect(bytesToHex(wasm.createMap(32).digest())).toBe(EMPTY_AVL_DIGEST_HEX);
  });

  it("redeems with proofs verified against real digests", () => {
    const eco = new Economy({ seed: "wasm", avl: wasm });
    eco.addParticipant({ id: "op", kind: "tracker-operator", erg: erg(2) });
    eco.addParticipant({ id: "alice", erg: erg(20) });
    eco.addParticipant({ id: "bob", erg: erg(1) });
    eco.createTracker({ id: "t", operator: "op", globalPolicy: acceptAllPolicy() });
    const { reserve } = eco.createReserve({ owner: "alice", amount: erg(10) });
    eco.pay({ from: "alice", to: "bob", amount: erg(2) });
    eco.mine(10);
    const r = eco.redeem({ receiver: "bob", issuer: "alice", amount: erg(1) });
    expect(r.ok, r.message).toBe(true);
    expect(r.eval!.proofMode).toBe("verified");
    const r2 = eco.redeem({ receiver: "bob", issuer: "alice" });
    expect(r2.ok, r2.message).toBe(true);
    expect(reserve!.tree.simulated).toBe(false);
    expect(reserve!.registersHex().R5).toBe(basisAvlRegister(reserve!.tree.digest()));
    // double redemption with #7 omitted: the real AVL insert proof cannot be built/verified
    eco.pay({ from: "alice", to: "bob", amount: erg(1) });
    eco.mine(10);
    const bad = eco.redeem({ receiver: "bob", issuer: "alice", tamper: { omitReserveLookup: true } });
    expect(bad.ok).toBe(false);
    expect(bad.eval!.failed).toContain("properRedemptionTree");
    expect(Economy.replay(eco.events, { avl: wasm }).stateHash()).toBe(eco.stateHash());
  });

  for (const s of SCENARIOS) {
    if (s.id === "agent-swarm") continue;
    it(`${s.id} plays identically on the real AVL+`, () => {
      const { results, eco } = runScenario(s.id, { economy: { avl: wasm } });
      for (const r of results) expect(r.outcome.ok, `${s.id} / ${r.id}: ${r.outcome.detail}`).toBe(true);
      const redeemed = eco.events.filter((e) => e.type === "reserve.redeemed");
      for (const t of eco.trackers.values()) expect(t.map.simulated).toBe(false);
      expect(redeemed.length === 0 || eco.reserves.size > 0).toBe(true);
    });
  }

  it("agent swarm (small) on the real AVL+", () => {
    const { results } = runScenario("agent-swarm", { economy: { avl: wasm }, params: { agents: 8, burst1: 150, burst2: 250 } });
    for (const r of results) expect(r.outcome.ok, `${r.id}: ${r.outcome.detail}`).toBe(true);
  });
});
