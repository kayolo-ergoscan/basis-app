import { describe, expect, it } from "vitest";
import { OUR_TRACKER } from "../../chain/ours/types";
import { blake2b256, concatBytes, hexToBytes } from "../../protocol/bytes";
import { AddressError, addressOfTree, base58Decode, base58Encode, p2pkAddress, p2pkKeyOf, p2sAddress, parseAddress, treeOfAddress } from "./address";
import { FEE_TREE_HEX, RESERVE_TREE_HEX, TRACKER_PK, reserveAddress } from "./constants";
import { ISSUER_A, TEXT } from "./fixtures/chain";
import { asString, at, parseJson, type JsonNode } from "./json";

function reason(f: () => unknown): string | null {
  try {
    f();
    return null;
  } catch (e) {
    return e instanceof AddressError ? e.reason : `other: ${(e as Error).message}`;
  }
}

/** Every (ergoTree, address) pair /v1 gives for the boxes of a transaction. */
function pairs(text: string): Array<[string, string]> {
  const tx = parseJson(text);
  const out: Array<[string, string]> = [];
  for (const list of ["inputs", "dataInputs", "outputs"]) {
    const arr = at(tx, list);
    if (arr?.kind !== "array") continue;
    for (const b of arr.items as JsonNode[]) out.push([asString(at(b, "ergoTree"), "ergoTree"), asString(at(b, "address"), "address")]);
  }
  return out;
}

describe("addresses", () => {
  it("our tracker's address holds the tracker key, and encodes back", () => {
    expect(TRACKER_PK).toBe("02f17d2d625b7f40f2b1a0ffb5d45fa35be371984ac3a6590945c28c28b99b5fc8");
    expect(p2pkKeyOf(OUR_TRACKER.address)).toBe(TRACKER_PK);
    expect(p2pkAddress(TRACKER_PK)).toBe(OUR_TRACKER.address);
  });

  it("every address /v1 shows for the fixtures' boxes is the address of its tree", () => {
    let n = 0;
    for (const text of [TEXT.t1, TEXT.r1, TEXT.r2, TEXT.r3]) {
      for (const [tree, addr] of pairs(text)) {
        expect(addressOfTree(tree)).toBe(addr);
        expect(treeOfAddress(addr)).toBe(tree);
        n++;
      }
    }
    expect(n).toBeGreaterThan(12);
  });

  it("the front's reserve P2S is the pinned reserve tree", () => {
    const p2s = asString(at(parseJson(TEXT.frontP2s), "data"), "data");
    expect(p2s).toBe(reserveAddress());
    const a = parseAddress(p2s);
    expect(a).toMatchObject({ network: "mainnet", type: "P2S" });
    expect(a.ergoTree).toBe(RESERVE_TREE_HEX);
    expect(addressOfTree(FEE_TREE_HEX).startsWith("2iHkR7CW")).toBe(true);
  });

  it("refuses typos, other networks, P2SH and keys off the curve", () => {
    const a = p2pkAddress(ISSUER_A);
    const flipped = a.slice(0, 10) + (a[10] === "x" ? "y" : "x") + a.slice(11);
    expect(reason(() => parseAddress(flipped))).toBe("checksum");
    expect(reason(() => parseAddress(`${a.slice(0, -1)}0`))).toBe("format"); // 0 is not base58
    expect(reason(() => parseAddress(` ${a}`))).toBe("format");
    expect(reason(() => parseAddress("9f"))).toBe("format");

    const testnet = p2pkAddress(ISSUER_A, "testnet");
    expect(parseAddress(testnet)).toMatchObject({ network: "testnet", type: "P2PK" });
    expect(reason(() => p2pkKeyOf(testnet))).toBe("network");
    expect(reason(() => treeOfAddress(testnet))).toBe("network");

    const body = concatBytes(Uint8Array.of(0x02), blake2b256(hexToBytes(RESERVE_TREE_HEX)).subarray(0, 24));
    const p2sh = base58Encode(concatBytes(body, blake2b256(body).subarray(0, 4)));
    expect(parseAddress(p2sh)).toMatchObject({ network: "mainnet", type: "P2SH", ergoTree: null });
    expect(reason(() => treeOfAddress(p2sh))).toBe("type");
    expect(reason(() => p2pkKeyOf(reserveAddress()))).toBe("type");

    const offCurve = concatBytes(Uint8Array.of(0x01, 0x02), new Uint8Array(32));
    expect(reason(() => parseAddress(base58Encode(concatBytes(offCurve, blake2b256(offCurve).subarray(0, 4)))))).toBe("key");
    const badPrefix = concatBytes(Uint8Array.of(0x24), new Uint8Array(33));
    expect(reason(() => parseAddress(base58Encode(concatBytes(badPrefix, blake2b256(badPrefix).subarray(0, 4)))))).toBe("prefix");
    expect(reason(() => p2pkAddress(`04${ISSUER_A.slice(2)}`))).toBe("key");
    expect(reason(() => p2sAddress(""))).toBe("format");
  });

  it("base58 keeps leading zeros", () => {
    for (const hex of ["", "00", "0000ff", "00010203", "ff".repeat(40)]) {
      const b = hexToBytes(hex);
      expect(base58Decode(base58Encode(b))).toEqual(b);
    }
    expect(base58Encode(hexToBytes("0000"))).toBe("11");
  });
});
