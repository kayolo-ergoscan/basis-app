// The tracker's own unsigned_tx (R3's dry-run build, as the canary printed it). A shape fixture: field names, order
// and values are the tracker's; the whitespace is the canary's pretty-printing, so no raw-span test uses it.
import { beforeAll, describe, expect, it } from "vitest";
import type { AvlBackend } from "../../protocol/avl";
import { FEE_TREE_HEX, RESERVE_TREE_HEX, p2pkTree } from "./constants";
import { checkRedemptionContract, loadContractAvl } from "./contract";
import { EXT, R3, R3_DRYRUN_UNSIGNED_TEXT, R3_RESERVE_IN, R3_TRACKER, RECEIVER_B } from "./fixtures/chain";
import { r3Chain, r3Expect, r3Parts } from "./fixtures/r3-build";
import { parseJson } from "./json";
import { unsignedTxFromJson } from "./model";
import { checkRedemption, parseBuildResponse } from "./redemption";
import { computeTxId } from "./serialize";
import { trackerBuildResponse, trackerUnsignedTxJson } from "./testkit";

const dry = unsignedTxFromJson(parseJson(R3_DRYRUN_UNSIGNED_TEXT), "dry-run unsigned_tx");

describe("R3's dry-run unsigned_tx (the tracker's own output)", () => {
  it("reads with our parser: one input, one data input, the three round-4 outputs, Scala order", () => {
    expect(dry.inputs.map((i) => i.boxId)).toEqual([R3_RESERVE_IN.boxId]);
    expect(dry.dataInputs).toEqual([R3_TRACKER.boxId]);
    expect(dry.outputs.map((o) => o.value)).toEqual([550_000_000n, 99_000_000n, 1_000_000n]);
    expect(dry.outputs.map((o) => o.ergoTree)).toEqual([RESERVE_TREE_HEX, p2pkTree(RECEIVER_B), FEE_TREE_HEX]);
    expect(dry.inputs[0].extension.map((e) => e.key)).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4]);
  });

  it("has exactly the field names, order and number format the test kit rebuilds (whitespace aside)", () => {
    expect(R3_DRYRUN_UNSIGNED_TEXT.replace(/\s+/g, "")).toBe(trackerUnsignedTxJson(dry));
  });

  it("is R3 but for the tracker's signature (#6, a fresh nonce per build)", () => {
    const differ = dry.inputs[0].extension.filter((e) => EXT.R3.entries.find((x) => x.key === e.key)?.value !== e.value).map((e) => e.key);
    expect(differ).toEqual([6]);
    expect(dry.outputs).toEqual(R3.unsigned.outputs);
    expect(computeTxId(dry)).not.toBe(R3.v1.id);
    const withChainSig = { ...dry, inputs: [{ ...dry.inputs[0], extension: dry.inputs[0].extension.map((e) => (e.key === 6 ? EXT.R3.entries.find((x) => x.key === 6)! : e)) }] };
    expect(computeTxId(withChainSig)).toBe(R3.v1.id);
  });

  describe("wrapped in a build answer", () => {
    let avl: AvlBackend;
    beforeAll(async () => {
      avl = await loadContractAvl();
    });

    it("passes L1 (its #6 is a second real tracker signature over the note) and L2", () => {
      const parts = { ...r3Parts(), unsigned: dry };
      const l1 = checkRedemption(parseBuildResponse(trackerBuildResponse(parts)), r3Chain(), r3Expect());
      if (!l1.ok) throw new Error(`${l1.rule}: ${l1.message}`);
      expect(l1.txId).toBe(computeTxId(dry));
      const l2 = checkRedemptionContract(l1, r3Chain(), R3.v1.inclusionHeight!, avl);
      if (!l2.ok) throw new Error(`${l2.rule}: ${l2.message}`);
      expect(l2.eval?.newRedeemedTotal).toBe(450_000_000n);
    });
  });
});
