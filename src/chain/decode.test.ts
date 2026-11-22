// Decoders on real mainnet fixtures from the seed (scripts/make-seed.mjs ← research/data/onchain.json).
import { describe, expect, it } from "vitest";
import { setNumberLang } from "@/ui/engine/money";
import { decodeRegister } from "@/protocol/registerCodec";
import seedJson from "./seed.json";
import type { Seed } from "./types";
import {
  EMPTY_DIGEST, USE_LOOKALIKE_ID, USE_TOKEN_ID, addressOfErgoTree, avlOpsOfTemplate, base58Decode, base58Encode, basisParams,
  blocksToApprox, bytesToHex, decodeAvlTreeRegister, decodeBasisRegisters, decodeConstant, decodeLongRegister, emergencyClock,
  fmtInt, formatUnits, hexToBytes, p2pkAddress, p2pkKeyOfTree, p2sAddress, parseAddress, parseErgoTree, refundClock, shortHex,
  templateHash, templateHashSync, tokenKind,
} from "./decode";

const seed = seedJson as unknown as Seed;
const ONCHAIN = "/root/basis/research/data/onchain.json";
// node:fs without @types/node in the app (tests run in Node; the specifier is built so tsc does not resolve it)
const fs = (await import(/* @vite-ignore */ `node:${"fs"}`)) as { existsSync(p: string): boolean; readFileSync(p: string, enc: "utf8"): string };
const existsSync = (p: string) => fs.existsSync(p);
const readFileSync = (p: string, enc: "utf8") => fs.readFileSync(p, enc);

describe("registers (KNOWLEDGE Appendix B, verifier's fixes)", () => {
  it("decodes R4/R5/R6/R7 of all 99 reserves exactly as the snapshot", () => {
    let checked = 0;
    for (const r of seed.reserves) {
      const d = decodeBasisRegisters(r.regs, r.nft ? [{ tokenId: r.nft.id }] : []);
      expect(d.key).toBe(r.owner?.key ?? null);
      if (r.r5) {
        expect(d.tree?.digest).toBe(r.r5.digest);
        expect(d.tree?.flags).toBe(r.r5.flags);
        expect(d.tree?.keyLength).toBe(r.r5.keyLength);
        expect(d.tree?.valueLength).toBe(r.r5.valueLength);
        expect(d.tree?.empty).toBe(r.r5.empty);
        expect(d.tree?.zero).toBe(r.r5.zero);
      } else expect(d.tree).toBeNull();
      expect(d.nft).toBe(r.r6);
      expect(d.ownNft).toBe(r.nft?.id ?? null);
      expect(d.hasR7).toBe(r.r7 !== null);
      expect(d.refundHeight).toBe(BigInt(r.r7 ?? 0));
      expect(d.valid).toBe(!!(r.owner && r.r5 && !r.r5.zero && r.r6));
      checked++;
    }
    expect(checked).toBe(99);
  });

  it("agrees with the protocol engine's decodeRegister on every reserve register", () => {
    for (const r of seed.reserves) {
      for (const [k, hex] of Object.entries(r.regs)) {
        if (!hex) continue;
        let e: ReturnType<typeof decodeRegister>;
        try { e = decodeRegister(hex); } catch { continue; }   // malformed on purpose (the 2 bad R4s)
        const mine = decodeConstant(hex);
        if (e.type === "GroupElement") expect(mine.value).toBe(e.value);
        if (e.type === "Coll[Byte]") expect(mine.value).toBe(e.value);
        if (e.type === "Long") expect(mine.value).toBe(e.value);
        if (e.type === "AvlTree") {
          const t = decodeAvlTreeRegister(hex)!;
          expect([t.digest, t.flags, t.keyLength, t.valueLength]).toEqual([e.digest, e.flags, e.keyLength, e.valueLength]);
        }
        expect(k).toMatch(/^R[4-7]$/);
      }
    }
  });

  it("reads R7 0500 as 0 and longer Longs exactly", () => {
    expect(decodeLongRegister("0500")).toBe(0n);
    expect(decodeLongRegister("05e0cdea01")).toBe(1921904n);
    expect(decodeLongRegister("05dfcdea01")).toBe(-1921904n);
    expect(decodeLongRegister("0502")).toBe(1n);
    expect(decodeLongRegister("0501")).toBe(-1n);
    expect(decodeLongRegister("07aa")).toBeNull();
    const r7 = seed.reserves.filter((r) => r.regs.R7);
    expect(r7.length).toBeGreaterThan(0);
    for (const r of r7) expect(decodeLongRegister(r.regs.R7!)).toBe(BigInt(r.r7 ?? 0));
  });

  it("flags the two malformed owner keys and the zero digest", () => {
    const bad = seed.reserves.filter((r) => !r.owner);
    expect(bad.length).toBe(2);
    for (const r of bad) expect(decodeBasisRegisters(r.regs).issues).toContain("R4-not-GroupElement");
    const zero = seed.reserves.find((r) => r.r5?.zero)!;
    expect(decodeBasisRegisters(zero.regs).issues).toContain("R5-zero-digest");
  });

  it("decodes the empty tree and generic constants", () => {
    const t = decodeAvlTreeRegister(`64${EMPTY_DIGEST}032000`)!;
    expect(t).toMatchObject({ empty: true, zero: false, flags: 3, insert: true, update: true, remove: false, keyLength: 32, valueLength: null });
    expect(decodeConstant("0500")).toMatchObject({ type: "Long", value: 0n });
    expect(decodeConstant("04c0d102")).toMatchObject({ type: "Int", value: 21600 });
    expect(decodeConstant(`0e20${"ab".repeat(32)}`)).toMatchObject({ type: "Coll[Byte]", value: "ab".repeat(32) });
    expect(decodeConstant("zz").error).toBeTruthy();
  });

  it("decodes tracker boxes (trackerValid without R6)", () => {
    for (const t of seed.trackers) {
      const b = t.lastTrackerBox;
      if (!b) continue;
      const d = decodeBasisRegisters(b.regs, [{ tokenId: t.nft }]);
      expect(d.key).toBe(b.key);
      expect(d.tree?.digest).toBe(b.digest);
      expect(d.trackerValid).toBe(!b.zero);
    }
  });
});

describe("addresses", () => {
  it("derives every owner P2PK address from its R4 key (base58, prefix 0x01, blake2b256 checksum)", () => {
    const owners = seed.reserves.filter((r) => r.owner);
    expect(owners.length).toBe(97);
    for (const r of owners) expect(p2pkAddress(r.owner!.key)).toBe(r.owner!.addr);
    for (const t of seed.trackers) for (const k of t.keys) expect(p2pkAddress(k.key)).toBe(k.addr);
  });

  it("knows Alice and Bob from the repository's demo names", () => {
    const alice = Object.entries(seed.labels).find(([, n]) => n === "Alice")![0];
    const owner = seed.reserves.find((r) => r.owner?.addr === alice)!;
    expect(p2pkAddress(owner.owner!.key)).toBe(alice);
    const parsed = parseAddress(alice);
    expect(parsed).toMatchObject({ network: "mainnet", type: "P2PK", checksumOk: true });
    expect(parsed.content).toBe(owner.owner!.key);
  });

  it("derives each contract's P2S from its ErgoTree", () => {
    for (const c of seed.contracts) {
      const a = p2sAddress(c.ergoTree);
      expect(a.length).toBe(c.p2s.length);
      expect(a.startsWith(c.p2s.head)).toBe(true);
      expect(a.endsWith(c.p2s.tail)).toBe(true);
      expect(parseAddress(a)).toMatchObject({ type: "P2S", checksumOk: true, content: c.ergoTree });
    }
  });

  it.skipIf(!existsSync(ONCHAIN))("matches the full P2S strings in onchain.json", () => {
    const oj = JSON.parse(readFileSync(ONCHAIN, "utf8")) as { contracts: { id: string; address: string }[] };
    for (const c of seed.contracts) expect(p2sAddress(c.ergoTree)).toBe(oj.contracts.find((x) => x.id === c.id)!.address);
  });

  it("round-trips base58 with leading zeros", () => {
    for (const hex of ["", "00", "0000ff", "00010203", "ff".repeat(40), bytesToHex(Uint8Array.from({ length: 300 }, (_, i) => (i * 37) & 0xff))]) {
      expect(bytesToHex(base58Decode(base58Encode(hexToBytes(hex))))).toBe(hex);
    }
    expect(base58Encode(hexToBytes("0000"))).toBe("11");
  });

  it("tells P2PK trees from scripts", () => {
    const r = seed.reserves.find((x) => x.owner)!;
    const tree = `0008cd${r.owner!.key}`;
    expect(p2pkKeyOfTree(tree)).toBe(r.owner!.key);
    expect(addressOfErgoTree(tree)).toBe(r.owner!.addr);
    expect(p2pkKeyOfTree(seed.contracts[0].ergoTree)).toBeNull();
    expect(() => p2pkAddress("02ab")).toThrow();
  });
});

describe("ErgoTree and the template hash (SHA-256 of the template bytes)", () => {
  it("reproduces the registry: header, version, constants, template hash, AVL ops, parameters", async () => {
    for (const c of seed.contracts) {
      const t = parseErgoTree(c.ergoTree);
      expect(t.headerHex).toBe(c.header);
      expect(t.version).toBe(c.version);
      expect(t.hasSize).toBe(c.hasSize);
      expect(t.segregated).toBe(c.segregated);
      expect(t.bytes).toBe(c.treeBytes);
      expect(t.constants.length).toBe(c.constantsCount);
      expect(templateHashSync(c.ergoTree)).toBe(c.templateHash);
      expect(await templateHash(c.ergoTree)).toBe(c.templateHash);   // WebCrypto (Node 20 has crypto.subtle)
      expect(avlOpsOfTemplate(t.template)).toEqual(c.avlOps);
      expect(basisParams(t.constants, c.kind)).toEqual(c.params);
    }
  });

  it("uses the noble path when WebCrypto is missing", async () => {
    const g = globalThis as { crypto?: Crypto };
    const saved = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    try {
      Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
      expect(g.crypto).toBeUndefined();
      expect(await templateHash(seed.contracts[2].ergoTree)).toBe(seed.contracts[2].templateHash);
    } finally {
      if (saved) Object.defineProperty(globalThis, "crypto", saved);
    }
  });

  it("finds the stale W52 constant and the 2160 / 43200 parameters", () => {
    const w52 = seed.contracts.find((c) => c.short === "W52")!;
    expect(w52.params.emergency).toEqual({ unit: "ms", value: 604800000 });
    const cur = seed.contracts.filter((c) => c.current);
    expect(cur.map((c) => c.templateHash).sort()).toEqual(["6e7d9a0e012e556d78a84cb373eca1b279695e7b48731b9158fd0ddd3faeff01", "8699a5572dd93d3fc1d6b33157d26bb1451c4cdd4e969e6e08e50b18e32f4feb"]);
    for (const c of cur) expect(c.params).toMatchObject({ emergency: { unit: "blocks", value: 2160 }, refundBlocks: 43200 });
  });
});

describe("tokens, numbers, clocks", () => {
  it("tells USE from the look-alike by id, never by name", () => {
    expect(tokenKind(USE_TOKEN_ID)).toBe("use");
    expect(tokenKind(USE_LOOKALIKE_ID.toUpperCase())).toBe("use-lookalike");
    expect(tokenKind("00".repeat(32))).toBe("other");
    expect(seed.tokens[USE_TOKEN_ID]).toMatchObject({ name: "USE", decimals: 3, kind: "use" });
    expect(seed.tokens[USE_LOOKALIKE_ID]).toMatchObject({ name: "USE", decimals: 6, kind: "use-lookalike" });
  });

  it("formats exact units and VISUAL numbers", () => {
    expect(formatUnits(8995000000n, 9)).toBe("8.995");
    expect(formatUnits("3400", 3)).toBe("3.4");
    expect(formatUnits(2700000n, 6)).toBe("2.7");
    expect(formatUnits(-50000000n, 9)).toBe("-0.05");
    expect(fmtInt(43200)).toBe("43,200"); // numbers follow the page language (EN here; RU "43 200")
    setNumberLang("ru");
    try { expect(fmtInt(43200)).toBe("43\u2009\u2060200"); } finally { setNumberLang("en"); }
    expect(shortHex("02d9aaaaaaaa60b6")).toBe("02d9…60b6");
    expect(blocksToApprox(2160)).toBe("≈ 3 d");
    expect(blocksToApprox(43200, "ru")).toBe("≈ 60 дн");
  });

  it("opens the emergency clock at creationHeight + 2161", () => {
    expect(emergencyClock(1000, 3160)).toMatchObject({ age: 2160, open: false, opensAt: 3161, blocksLeft: 1 });
    expect(emergencyClock(1000, 3161)).toMatchObject({ age: 2161, open: true, blocksLeft: 0 });
    const live = seed.trackers.find((t) => t.status === "live")!;
    expect(emergencyClock(live.lastTrackerBox!.height, seed.asOf.height).open).toBe(true);
  });

  it("counts the refund down from R7 + 43200", () => {
    expect(refundClock(0, 2_000_000)).toMatchObject({ started: false, ready: false });
    expect(refundClock(1_900_000, 1_943_199)).toMatchObject({ started: true, completesAt: 1_943_200, blocksLeft: 1, ready: false });
    expect(refundClock(1_900_000n, 1_943_200)).toMatchObject({ ready: true, blocksLeft: 0 });
  });
});
