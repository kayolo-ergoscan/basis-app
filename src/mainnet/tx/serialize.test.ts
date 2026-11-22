// Golden: the serializer against mainnet. Every id below is recomputed from the /v1 JSON (plus the reserve
// extension, which /v1 does not carry) and must equal the chain's.
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "../../protocol/bytes";
import { ALL, EXT, R1, R2, R3, R3_RESERVE_IN, R3_TRACKER, T1 } from "./fixtures/chain";
import { parseJson } from "./json";
import { nodeTxFromJson, type ExtensionEntry } from "./model";
import {
  boxIdHolds, bytesToSign, computeBoxId, computeTxId, isNodeExtensionOrder, nodeExtensionOrder, outputBoxes, scalaHashMapOrder, serializeBox, serializeCandidate,
  serializeSignedTx, signedTxToNodeJson, tokenTable, unsignedOf,
} from "./serialize";

describe("transaction ids and sizes equal the chain", () => {
  it("the fixtures are the transactions the design names", () => {
    expect(T1.v1.id).toBe("5b88633ea0467f2333ce3b5b878d85620341b2984659011dcda27ac700edf518");
    expect(R1.v1.id).toBe("72a41040dd0f8999bba988ab03ff27c93d31a44d1a5b6e93e324167bad1a4f8e");
    expect(R2.v1.id).toBe("cb4b9f3bb7669ba75efdf59d19dcb0baab65fb1c225ae5a6ecc0e081429b01ad");
    expect(R3.v1.id).toBe("e7c18808d210ec87df2bece213fc6dc448e3292bf98d4ec737ee70eeb18ba520");
    expect([T1, R1, R2, R3].map((t) => t.v1.inclusionHeight)).toEqual([1922314, 1922325, 1922336, 1922369]);
    for (const [t, e] of [[R1, EXT.R1], [R2, EXT.R2], [R3, EXT.R3]] as const) {
      expect(e.txId).toBe(t.v1.id);
      expect(e.inclusionHeight).toBe(t.v1.inclusionHeight);
      expect(e.input0BoxId).toBe(t.v1.inputs[0].boxId);
    }
  });

  for (const t of ALL) {
    it(`${t.name}: blake2b256(bytesToSign) is the id`, () => {
      expect(computeTxId(t.unsigned)).toBe(t.v1.id);
    });
    it(`${t.name}: the signed bytes have the chain's size`, () => {
      expect(serializeSignedTx(t.signed).length).toBe(t.v1.size);
    });
    it(`${t.name}: every input, data input and output box hashes to its id`, () => {
      for (const b of [...t.v1.inputs, ...t.v1.dataInputs, ...t.v1.outputs]) {
        expect(computeBoxId(b)).toBe(b.boxId);
        expect(boxIdHolds(b)).toBe(true);
      }
      expect(outputBoxes(t.unsigned).map((b) => b.boxId)).toEqual(t.v1.outputs.map((b) => b.boxId));
    });
  }

  it("R3 is the transaction the coordinator announced", () => {
    expect(R3.v1.inputs.map((b) => b.boxId)).toEqual(["b05b94a2c7df8cf7ffb3c1b3663b6658a86a52c51340e70fa9c4785251e511b1"]);
    expect(R3.v1.dataInputs.map((b) => b.boxId)).toEqual(["7ced33b22b29364898bd27bbe17d26e80aac5c8683b57cd45240f058227a3560"]);
    expect(R3.v1.outputs.map((b) => b.value)).toEqual([550_000_000n, 99_000_000n, 1_000_000n]);
    expect(R3.v1.outputs[0].boxId.startsWith("619613ea")).toBe(true);
    expect(R3.v1.outputs[1].boxId).toBe("4a85d415de9ae7dc29af761566aa8ba495ba32b006161292fb026b071b4d88a1");
  });

  it("the /v1/boxes copies of R3's reserve and tracker box are the boxes the transaction names", () => {
    expect(boxIdHolds(R3_RESERVE_IN)).toBe(true);
    expect(boxIdHolds(R3_TRACKER)).toBe(true);
    expect(bytesToHex(serializeBox(R3_RESERVE_IN))).toBe(bytesToHex(serializeBox(R3.v1.inputs[0])));
    expect(bytesToHex(serializeBox(R3_TRACKER))).toBe(bytesToHex(serializeBox(R3.v1.dataInputs[0])));
  });

  it("a changed value, token, register or index changes the box id", () => {
    const b = R3_RESERVE_IN;
    expect(boxIdHolds({ ...b, value: b.value + 1n })).toBe(false);
    expect(boxIdHolds({ ...b, tokens: [{ ...b.tokens[0], amount: 2n }] })).toBe(false);
    expect(boxIdHolds({ ...b, registers: b.registers.slice(0, 3) })).toBe(false);
    expect(boxIdHolds({ ...b, index: b.index + 1 })).toBe(false);
    expect(boxIdHolds({ ...b, creationHeight: b.creationHeight + 1 })).toBe(false);
  });
});

describe("context extension order (Scala 2.12 immutable.HashMap)", () => {
  it("reproduces the orders the chain used", () => {
    expect(scalaHashMapOrder([0, 1, 2, 3, 4, 5, 6, 8])).toEqual([0, 5, 1, 6, 2, 3, 8, 4]);
    expect(scalaHashMapOrder([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4]);
    expect(EXT.R1.entries.map((e) => e.key)).toEqual([0, 5, 1, 6, 2, 3, 8, 4]);
    expect(EXT.R2.entries.map((e) => e.key)).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4]);
    expect(EXT.R3.entries.map((e) => e.key)).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4]);
  });

  it("depends only on the set of keys", () => {
    expect(scalaHashMapOrder([8, 4, 6, 0, 2, 5, 1, 3])).toEqual([0, 5, 1, 6, 2, 3, 8, 4]);
    expect(scalaHashMapOrder([7, 3, 5, 1, 8, 0, 2, 6, 4])).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4]);
    expect(() => scalaHashMapOrder([1, 1, 2, 3, 4])).toThrow();
  });

  it("keeps up to 4 entries as given (Map1…Map4)", () => {
    const four: ExtensionEntry[] = [3, 1, 2, 0].map((key) => ({ key, value: "0200" }));
    expect(nodeExtensionOrder(four).map((e) => e.key)).toEqual([3, 1, 2, 0]);
    expect(isNodeExtensionOrder(four)).toBe(true);
  });

  for (const t of [R1, R2, R3]) {
    it(`${t.name}: ascending order gives another id, and the node order of any listing gives the chain's`, () => {
      const ext = t.unsigned.inputs[0].extension;
      const ascending = [...ext].sort((a, b) => a.key - b.key);
      const withExt = (e: ExtensionEntry[]) => ({ ...t.unsigned, inputs: [{ ...t.unsigned.inputs[0], extension: e }, ...t.unsigned.inputs.slice(1)] });
      expect(isNodeExtensionOrder(ext)).toBe(true);
      expect(isNodeExtensionOrder(ascending)).toBe(false);
      expect(computeTxId(withExt(ascending), { extensionOrder: "as-given" })).not.toBe(t.v1.id);
      expect(computeTxId(withExt(ascending))).toBe(t.v1.id);
      expect(computeTxId(withExt([...ext].reverse()))).toBe(t.v1.id);
      expect(computeTxId(t.unsigned, { extensionOrder: "as-given" })).toBe(t.v1.id);
    });
  }
});

describe("bytes", () => {
  it("bytesToSign has an empty proof per input and the extension", () => {
    const b = bytesToSign(R3.unsigned);
    expect(b[0]).toBe(1); // one input
    expect(bytesToHex(b.subarray(1, 33))).toBe(R3.v1.inputs[0].boxId);
    expect(b[33]).toBe(0); // empty proof
    expect(b[34]).toBe(9); // nine context variables
    expect(b[35]).toBe(0); // #0 first …
    expect(bytesToHex(b.subarray(36, 38))).toBe("0200"); // … = Byte 0
  });

  it("the token table lists output tokens in first-appearance order: T1 mints its NFT", () => {
    const nft = T1.v1.inputs[0].boxId;
    expect(tokenTable(T1.unsigned.outputs)).toEqual([nft]);
    expect(T1.v1.outputs[0].tokens).toEqual([{ tokenId: nft, amount: 1n }]);
    expect(tokenTable(R3.unsigned.outputs)).toEqual([R3.v1.inputs[0].tokens[0].tokenId]);
  });

  it("a candidate is the start of its box bytes", () => {
    const out = R3.v1.outputs[0];
    const cand = bytesToHex(serializeCandidate(out));
    expect(bytesToHex(serializeBox(out)).startsWith(cand)).toBe(true);
    expect(bytesToHex(serializeBox(out)).slice(cand.length)).toBe(`${R3.v1.id}00`);
  });

  it("node JSON round-trips to the same bytes, with bare integers and the extension in node order", () => {
    for (const t of ALL) {
      const json = signedTxToNodeJson(t.signed);
      expect(json).not.toMatch(/"value":"/);
      const back = nodeTxFromJson(parseJson(json));
      expect(back.id).toBe(t.v1.id);
      expect(bytesToHex(serializeSignedTx(back))).toBe(bytesToHex(serializeSignedTx(t.signed)));
      expect(computeTxId(unsignedOf(back), { extensionOrder: "as-given" })).toBe(t.v1.id);
    }
  });

  it("refuses what the node could not serialize", () => {
    const bad = { ...R3.unsigned, inputs: [{ ...R3.unsigned.inputs[0], extension: [{ key: 128, value: "0200" }] }] };
    expect(() => bytesToSign(bad)).toThrow();
    const empty = { ...R3.unsigned, inputs: [{ ...R3.unsigned.inputs[0], extension: [{ key: 1, value: "" }] }] };
    expect(() => bytesToSign(empty)).toThrow();
    const shortId = { ...R3.unsigned, dataInputs: ["00"] };
    expect(() => bytesToSign(shortId)).toThrow();
    expect(hexToBytes(R3.v1.id).length).toBe(32);
  });
});
