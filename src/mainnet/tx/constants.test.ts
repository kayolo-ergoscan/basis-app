// The pinned constants (design Appendix A) against the chain and our front.
import { sha256 } from "@noble/hashes/sha256";
import { describe, expect, it } from "vitest";
import { OUR_TRACKER } from "../../chain/ours/types";
import { blake2b256, bytesToHex, hexToBytes } from "../../protocol/bytes";
import {
  EMPTY_RESERVE_R5, FEE_TREE_HEX, R7_NO_REFUND, RESERVE_TEMPLATE_HASH, RESERVE_TREE_BLAKE2B256, RESERVE_TREE_BYTES, RESERVE_TREE_HEX, RESERVE_TREE_SHA256, TRACKER_NFT, TRACKER_PK,
  p2pkKeyOfTree, p2pkTree,
} from "./constants";
import { ALL, ISSUER_A, R1, R2, R3, R3_RESERVE_IN, R3_TRACKER, T1 } from "./fixtures/chain";
import { CURRENT_TEMPLATES, templateHashSync } from "../../chain/decode";
import { register } from "./model";

describe("pinned constants", () => {
  it("the reserve tree: 764 bytes, header 0x1b, the pinned hashes", () => {
    const t = hexToBytes(RESERVE_TREE_HEX);
    expect(t.length).toBe(RESERVE_TREE_BYTES);
    expect(t[0]).toBe(0x1b);
    expect(bytesToHex(sha256(t))).toBe("760b84d23538708f9997f5598f02bdc7e3b90d4d52f47d5ab3744aa71cdae4f6");
    expect(bytesToHex(sha256(t))).toBe(RESERVE_TREE_SHA256);
    expect(bytesToHex(blake2b256(t))).toBe(RESERVE_TREE_BLAKE2B256);
    expect(templateHashSync(RESERVE_TREE_HEX)).toBe(RESERVE_TEMPLATE_HASH);
    expect(CURRENT_TEMPLATES.erg).toBe(RESERVE_TEMPLATE_HASH);
  });

  it("every reserve on chain sits under the pinned tree", () => {
    expect(T1.v1.outputs[0].ergoTree).toBe(RESERVE_TREE_HEX);
    for (const t of [R1, R2, R3]) {
      expect(t.v1.inputs[0].ergoTree).toBe(RESERVE_TREE_HEX);
      expect(t.v1.outputs[0].ergoTree).toBe(RESERVE_TREE_HEX);
    }
    expect(R3_RESERVE_IN.ergoTree).toBe(RESERVE_TREE_HEX);
  });

  it("the miner-fee tree pays every fee output", () => {
    expect(FEE_TREE_HEX).toBe(
      "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304",
    );
    for (const t of ALL) expect(t.v1.outputs.filter((o) => o.ergoTree === FEE_TREE_HEX).length).toBe(1);
  });

  it("the tracker: NFT, key and box agree", () => {
    expect(TRACKER_NFT).toBe("f5178dc4063042bdf77cd0f4a55d0893d6dbcf0b3d14eb4de25282b2c4e3f29f");
    expect(OUR_TRACKER.nft).toBe(TRACKER_NFT);
    expect(R3_TRACKER.tokens[0]).toEqual({ tokenId: TRACKER_NFT, amount: 1n });
    expect(register(R3_TRACKER, "R4")).toBe(`07${TRACKER_PK}`);
    expect(R3_TRACKER.ergoTree).toBe(p2pkTree(TRACKER_PK));
  });

  it("a new reserve's registers are T1's: R4 owner, R5 empty tree, R6 our NFT, R7 0", () => {
    const r = T1.v1.outputs[0];
    expect(EMPTY_RESERVE_R5).toBe("644ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900032000");
    expect(r.registers).toEqual([`07${ISSUER_A}`, EMPTY_RESERVE_R5, `0e20${TRACKER_NFT}`, R7_NO_REFUND]);
    expect(register(R3_RESERVE_IN, "R6")).toBe(`0e20${TRACKER_NFT}`);
    expect(register(R3_RESERVE_IN, "R7")).toBe(R7_NO_REFUND);
  });

  it("P2PK trees", () => {
    expect(p2pkTree(ISSUER_A)).toBe(`0008cd${ISSUER_A}`);
    expect(p2pkKeyOfTree(`0008cd${ISSUER_A}`)).toBe(ISSUER_A);
    expect(p2pkKeyOfTree(RESERVE_TREE_HEX)).toBeNull();
    expect(() => p2pkTree(ISSUER_A.toUpperCase())).toThrow();
  });
});
