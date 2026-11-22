// L2: the contract engine with the stock AVL+ (avl.wasm) on the real transactions. R1, R2 and R3 pass; a replay
// (insert on a key the reserve tree already holds) and tampered copies fail.
import { beforeAll, describe, expect, it } from "vitest";
import type { AvlBackend } from "../../protocol/avl";
import { getAvlBackend } from "../../protocol/avl";
import { encodeLong } from "../../protocol/registers";
import { checkRedemptionContract, checkReserveContract, loadContractAvl, simTxOf, type ContractInput } from "./contract";
import { R1, R2, R3, RECEIVER_B, type ChainTx } from "./fixtures/chain";
import { r3Chain, r3Expect, r3Parts } from "./fixtures/r3-build";
import type { ExtensionEntry } from "./model";
import { checkRedemption, parseBuildResponse } from "./redemption";
import { nodeExtensionOrder } from "./serialize";
import { trackerBuildResponse } from "./testkit";

let avl: AvlBackend;
beforeAll(async () => {
  avl = await loadContractAvl();
});

function input(t: ChainTx, ext?: (e: ExtensionEntry[]) => ExtensionEntry[]): ContractInput {
  const e = t.unsigned.inputs[0].extension;
  const tx = ext ? { ...t.unsigned, inputs: [{ ...t.unsigned.inputs[0], extension: ext(e.map((x) => ({ ...x }))) }, ...t.unsigned.inputs.slice(1)] } : t.unsigned;
  return { tx, inputs: t.v1.inputs, dataInputs: t.v1.dataInputs, signers: [RECEIVER_B], height: t.v1.inclusionHeight! };
}

describe("L2 on the chain's redemptions", () => {
  it("loads the stock AVL+ verifier without switching the sandbox backend", () => {
    expect(avl.verifier).not.toBeNull();
    expect(avl.simulated).toBe(false);
    expect(getAvlBackend().id).not.toBe(avl.id);
  });

  for (const [t, redeemed, total] of [[R1, 100_000_000n, 100_000_000n], [R2, 250_000_000n, 350_000_000n], [R3, 100_000_000n, 450_000_000n]] as const) {
    it(`${t.name}: every contract check passes, with the proofs verified`, () => {
      const r = checkReserveContract(input(t), avl);
      if (!r.ok) throw new Error(`${r.rule}: ${r.message}`);
      expect(r.eval?.proofMode).toBe("verified");
      expect(r.eval?.action).toBe(0);
      expect(r.eval?.outputIndex).toBe(0);
      expect(r.eval?.emergency).toBe(false);
      expect(r.eval?.redeemed).toBe(redeemed);
      expect(r.eval?.newRedeemedTotal).toBe(total);
      expect(r.eval?.checks.every((c) => c.outcome === "true" || c.outcome === "skipped")).toBe(true);
    });
  }

  it("a replay fails: R2 without #7 makes the contract `insert` a key the reserve tree already holds", () => {
    const r = checkReserveContract(input(R2, (e) => nodeExtensionOrder(e.filter((x) => x.key !== 7))), avl);
    expect(r.ok).toBe(false);
    expect(r.rule).toBe("properRedemptionTree");
  });

  it.each<[string, (e: ExtensionEntry[]) => ExtensionEntry[], string]>([
    ["a total above the committed one", (e) => e.map((x) => (x.key === 3 ? { key: 3, value: encodeLong(700_000_000n) } : x)), "trackerDebtCorrect"],
    ["#6 replaced by #2", (e) => e.map((x) => (x.key === 6 ? { key: 6, value: e.find((y) => y.key === 2)!.value } : x)), "trackerSigValid"],
    ["#5 of another transaction", (e) => e.map((x) => (x.key === 5 ? { key: 5, value: R2.unsigned.inputs[0].extension.find((y) => y.key === 5)!.value } : x)), "properRedemptionTree"],
    ["#4 older than the last redemption", (e) => e.map((x) => (x.key === 4 ? { key: 4, value: encodeLong(1n) } : x)), "timestampCorrect"],
    ["a non-canonical Long", (e) => e.map((x) => (x.key === 3 ? { key: 3, value: `${x.value}00` } : x)), "adapter"],
    ["a constant type the engine does not model", (e) => e.map((x) => (x.key === 5 ? { key: 5, value: "0101" } : x)), "adapter"],
  ])("R3 refuses %s", (_name, mutate, rule) => {
    const r = checkReserveContract(input(R3, mutate), avl);
    expect(r.ok).toBe(false);
    expect(r.rule).toBe(rule);
  });

  it("R3 refuses a transaction the receiver does not sign", () => {
    const r = checkReserveContract({ ...input(R3), signers: [] }, avl);
    expect(r.rule).toBe("receiverSignature");
  });

  it("R3 refuses an output tree with other flags (the engine compares digests only)", () => {
    const i = input(R3);
    const r5 = i.tx.outputs[0].registers[1];
    const tx = { ...i.tx, outputs: i.tx.outputs.map((o, n) => (n === 0 ? { ...o, registers: o.registers.map((r, k) => (k === 1 ? `${r5.slice(0, 68)}07${r5.slice(70)}` : r)) } : o)) };
    const r = checkReserveContract({ ...i, tx }, avl);
    expect(r.rule).toBe("tree-params");
  });

  it("refuses a backend without a stateless verifier, and an input that is not the reserve", () => {
    expect(checkReserveContract(input(R3), { ...avl, verifier: null }).rule).toBe("verifier");
    expect(checkReserveContract({ ...input(R1), inputIndex: 1 }, avl).rule).toBe("adapter");
  });
});

describe("L2 on a build that passed L1", () => {
  it("R3: the contract redeems the amount and records the build's new total", () => {
    const l1 = checkRedemption(parseBuildResponse(trackerBuildResponse(r3Parts())), r3Chain(), r3Expect());
    if (!l1.ok) throw new Error(l1.message);
    const r = checkRedemptionContract(l1, r3Chain(), R3.v1.inclusionHeight!, avl);
    if (!r.ok) throw new Error(`${r.rule}: ${r.message}`);
    expect(r.eval?.newRedeemedTotal).toBe(450_000_000n);
  });

  it("refuses a build whose new_already_redeemed is not what the contract records", () => {
    const parts = r3Parts();
    parts.summary.newAlreadyRedeemed = 400_000_000n;
    const l1 = checkRedemption(parseBuildResponse(trackerBuildResponse(parts)), r3Chain(), r3Expect());
    if (!l1.ok) throw new Error(l1.message);
    expect(checkRedemptionContract(l1, r3Chain(), R3.v1.inclusionHeight!, avl).rule).toBe("redeemed-total");
  });
});

describe("simTxOf (the review screens' TxLens)", () => {
  it("maps a real redemption faithfully, and gives null for a box the engine does not model", () => {
    const sim = simTxOf(input(R3));
    expect(sim?.id).toBe(R3.v1.id);
    expect(sim?.inputs[0].script).toBe("basis.es");
    expect(sim?.outputs.map((o) => o.script)).toEqual(["basis.es", `p2pk:${RECEIVER_B}`, "miner-fee"]);
    expect(sim?.contextVars[0][1]).toEqual({ type: "GroupElement", value: RECEIVER_B });
    const odd = { ...R3.v1.inputs[0], registers: [...R3.v1.inputs[0].registers.slice(0, 3), "0101"] };
    expect(simTxOf({ ...input(R3), inputs: [odd] })).toBeNull();
  });
});
