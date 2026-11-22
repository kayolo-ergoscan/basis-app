// The general register codec (registerCodec.ts) against the fixed encoders the first load keeps (registers.ts).
import { describe, expect, it } from "vitest";
import { hexToBytes } from "./bytes";
import { decodeRegister, encodeAvlTree, unzigzag64 } from "./registerCodec";
import { AVL_FLAGS_INSERT, AVL_FLAGS_UPDATE, EMPTY_AVL_DIGEST_HEX, basisAvlRegister, encodeLong, zigzag64 } from "./registers";

describe("register codec", () => {
  it("basisAvlRegister is encodeAvlTree with insert+update, 32-byte keys and no value length", () => {
    for (const digest of [EMPTY_AVL_DIGEST_HEX, "11".repeat(33), "ab".repeat(33)]) {
      const general = encodeAvlTree({ digest, flags: AVL_FLAGS_INSERT | AVL_FLAGS_UPDATE, keyLength: 32, valueLength: null });
      expect(basisAvlRegister(digest)).toBe(general);
      expect(basisAvlRegister(hexToBytes(digest))).toBe(general);
      expect(decodeRegister(general)).toEqual({ type: "AvlTree", digest, flags: 3, keyLength: 32, valueLength: null });
    }
    expect(() => basisAvlRegister("11".repeat(32))).toThrow();
  });

  it("encodes and decodes any AvlTree (value length set, long key length)", () => {
    const t = { digest: "22".repeat(33), flags: 7, keyLength: 300, valueLength: 128 };
    expect(decodeRegister(encodeAvlTree(t))).toEqual({ type: "AvlTree", ...t });
  });

  it("unzigzag64 inverts zigzag64 over the whole Long range", () => {
    for (const v of [0n, 1n, -1n, 2n, -2n, 1_000_000_000n, -(2n ** 63n), 2n ** 63n - 1n]) {
      expect(unzigzag64(zigzag64(v))).toBe(v);
      expect(decodeRegister(encodeLong(v))).toEqual({ type: "Long", value: v });
    }
  });
});
