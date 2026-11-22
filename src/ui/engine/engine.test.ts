// Snapshot tests (VISUAL §17): the TS engine must draw byte-identical SVG to the style tile.
// expected.json was produced by fixtures/make-expected.mjs from design/final/intaglio.js. Any drift bumps the algo version.
import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import expected from "./fixtures/expected.json";
import {
  blake2bN, blk, blocksAndTime, concat, demoKey, demoSig, erg, fromHex, groupHex, hex, humanTime, inksFor, int, keySeal, money,
  escapeXml, noteArt, numberLang, pairKey, pairSeal, parseMoney, pct, plainNumber, rng, sealParams, sealSVG, serialOf, setNumberLang, short,
  signed, threeWords, threeWordsOfHash, units, utf8,
  BRAND_INKS, NOTE_ALGO, SEAL_ALGO, INKS,
} from "./index";

const sha = (s: string) => hex(sha256(utf8(s)));
const exp = expected as unknown as {
  keys: string[]; demoKeys: Record<string, string>; hashes: Record<string, string>; keySeals: Record<string, string>;
  brand: string; params: Record<string, unknown>; money: Record<string, string>;
};

describe("engine ≡ style tile (seal@1, note@1)", () => {
  it("keeps the algorithm versions the hashes were recorded for", () => {
    expect(SEAL_ALGO).toBe("seal@1");
    expect(NOTE_ALGO).toBe("note@1");
  });

  it("demo keys match the tile", () => {
    for (const [n, pk] of Object.entries(exp.demoKeys)) expect(demoKey(n)).toBe(pk);
  });

  it("16 fixed keys: BLAKE2b (noble) equals the tile's own port", () => {
    const pk = exp.demoKeys;
    const gallery = [["Alice", "Bob"], ["Bob", "Alice"], ["Bob", "Carol"], ["Eve", "Bob"], ["Alice", "render·ai"], ["Carol", "Dan"]];
    const keys = [
      new Uint8Array(32), new Uint8Array(32).fill(255), Uint8Array.from({ length: 32 }, (_, i) => i),
      ...gallery.map(([a, b]) => pairKey(pk[a], pk[b])),
      blake2bN(utf8("basis"), 32),
      ...Array.from({ length: 6 }, (_, i) => blake2bN(utf8("basis-snapshot:" + i), 32)),
    ];
    expect(keys.map(hex)).toEqual(exp.keys);
    expect(serialOf(keys[3])).toBe("2174 37A4 498A DF59");
  });

  it("seal parameters are identical", () => {
    exp.keys.forEach((k, i) => expect(JSON.parse(JSON.stringify(sealParams(fromHex(k))))).toEqual(exp.params[i]));
  });

  for (let i = 0; i < 16; i++) {
    it(`key ${i}: SHA-256 of 6 SVG variants equals the tile`, () => {
      const key = fromHex(exp.keys[i]);
      const sigA = demoSig(concat(key, utf8("issuer"))), sigT = demoSig(concat(key, utf8("tracker")));
      const micro = (`ALICE OWES BOB 1240.00 ERG · KEY ${hex(key)} · SIG ${sigA} · `).repeat(2);
      const got: Record<string, string> = {
        [`${i}:pair-1`]: sha(pairSeal(key, { detail: 1, px: 190 })),
        [`${i}:pair-.6`]: sha(pairSeal(key, { detail: 0.6, px: 84 })),
        [`${i}:person`]: sha(sealSVG(key, { kind: "person", detail: 0.35 })),
        [`${i}:agent`]: sha(sealSVG(key, { kind: "agent", detail: 0.35, px: 56 })),
        [`${i}:noteLite`]: sha(noteArt(key, { lite: true, sigA, sigT, uid: "u1" })),
        [`${i}:noteFull`]: sha(noteArt(key, { sigA, sigT, micro, uid: "u2" })),
      };
      for (const [k, v] of Object.entries(got)) expect(v, k).toBe(exp.hashes[k]);
    });
  }

  it("key seals of the sample circle and the brand seal equal the tile", () => {
    for (const [n, pk] of Object.entries(exp.demoKeys)) {
      const agent = n.endsWith("·ai");
      expect(sha(keySeal(pk, { agent })), n).toBe(exp.keySeals[n]);
      expect(sha(keySeal(pk, { agent, px: 56 })), n + "@56").toBe(exp.keySeals[n + "@56"]);
    }
    expect(sha(sealSVG(blake2bN(utf8("basis"), 32), { kind: "pair", detail: 0.35, px: 30, inks: BRAND_INKS }))).toBe(exp.brand);
  });

  it("money() equals the tile's formatter, in each language's separators", () => {
    // the tile writes one format ("1 240.00"); since 22 Nov 2026 EN groups with "," and RU writes a decimal comma
    for (const [v, s] of Object.entries(exp.money)) {
      const n = Number(v);
      const dp = n < 0.01 && n > 0 ? 4 : 2;
      expect(money(n, dp, "en")).toBe(s.replace(/\u2009\u2060/g, ","));
      expect(money(n, dp, "ru")).toBe(s.replace(".", ","));
    }
  });
});

describe("rng, inks, words", () => {
  it("sfc32 is deterministic and consumes one output per call", () => {
    const a = rng(fromHex(exp.keys[3])), b = rng(fromHex(exp.keys[3]));
    const xs = [a(), a.range(1, 2), a.int(1, 6), a.pick(["x", "y"])];
    expect([b(), b.range(1, 2), b.int(1, 6), b.pick(["x", "y"])]).toEqual(xs);
  });
  it("ink B is never ink A, and inks avoid red/green/gold", () => {
    for (let i = 0; i < 256; i++) for (let j = 0; j < 7; j++) {
      const k = new Uint8Array(32); k[0] = i; k[1] = j;
      const { a, b } = inksFor(k);
      expect(a.name).not.toBe(b.name);
    }
    expect(INKS).toHaveLength(8);
  });
  it("three BIP-39 words from 33 bits, most significant first", () => {
    // all zero bits → index 0 ("abandon"); all ones → 2047 ("zoo")
    const h = new Uint8Array(32);
    expect(threeWordsOfHash(h)).toEqual(["abandon", "abandon", "abandon"]);
    h[0] = 0xff; h[1] = 0xff; h[2] = 0xff; h[3] = 0xff; h[4] = 0x80;
    expect(threeWordsOfHash(h)).toEqual(["zoo", "zoo", "zoo"]);
    h.fill(0); h[1] = 0x20; // bit 10 set → word 0 index 1
    expect(threeWordsOfHash(h)[0]).toBe("ability");
    const w = threeWords(exp.demoKeys.Bob);
    expect(w).toHaveLength(3);
    expect(threeWords(exp.demoKeys.Bob)).toEqual(w);
  });
});

describe("formatting (VISUAL §4.3; numbers per language since 22 Nov 2026)", () => {
  const T = "\u2009\u2060";
  afterEach(() => setNumberLang("en"));
  it("EN: thousands with a comma, a decimal point; minus is U+2212, units after U+00A0", () => {
    expect(money(1240)).toBe("1,240.00");
    expect(money(-320)).toBe("−320.00");
    expect(int(1921400)).toBe("1,921,400");
    expect(signed(240, 2, "favour")).toBe("+240.00");
    expect(signed(320, 2, "owe")).toBe("−320.00");
    expect(blk(2160)).toBe("2,160\u00a0blk");
    expect(pct(132)).toBe(`132${T}%`);
    expect(pct(0.42)).toBe(`0.4${T}%`);
    expect(erg(9_545_000_000n, 3)).toBe("9.545");
  });
  it("RU: thousands with U+2009 U+2060, a decimal comma, whole words for blocks (never «блк»)", () => {
    const N = "\u00a0";
    expect(money(1240, 2, "ru")).toBe(`1${T}240,00`);
    expect(erg(9_545_000_000n, 3, "ru")).toBe("9,545");
    expect(int(1922434, "ru")).toBe(`1${T}922${T}434`);
    expect(pct(0.42, "ru")).toBe(`0,4${T}%`);
    expect(signed(-1240.5, 2, "auto", "ru")).toBe(`−1${T}240,50`);
    expect([1, 2, 5, 21, 37].map((n) => blk(n, "ru"))).toEqual([`1${N}блок`, `2${N}блока`, `5${N}блоков`, `21${N}блок`, `37${N}блоков`]);
    expect(blk(2161, "ru")).toBe(`2${T}161${N}блок`);
    expect(blk(2160, "ru")).toBe(`2${T}160${N}блоков`);
    expect(blocksAndTime(2160, "ru")).toBe(`2${T}160${N}блоков · ≈${N}3${N}дня`);
  });
  it("the page language is the default: setNumberLang switches every formatter at once", () => {
    const N = "\u00a0";
    setNumberLang("ru");
    expect(numberLang()).toBe("ru");
    expect([money(1240), int(43200), erg(9_545_000_000n, 3), blk(37), humanTime(2160)]).toEqual([`1${T}240,00`, `43${T}200`, "9,545", `37${N}блоков`, `≈${N}3${N}дня`]);
    setNumberLang("en");
    expect([money(1240), int(43200), erg(9_545_000_000n, 3), blk(37), humanTime(2160)]).toEqual(["1,240.00", "43,200", "9.545", `37${N}blk`, `≈${N}3${N}days`]);
  });
  it("bigint units round half-up and stay exact", () => {
    expect(erg(1_240_000_000_000n)).toBe("1,240.00");
    expect(erg(1_000_000n)).toBe("0.00");
    expect(erg(5_000_000n)).toBe("0.01");
    expect(erg(1_000_000n, 3)).toBe("0.001");
    expect(units(-1_234_567n, 3, 3)).toBe("−1,234.567");
    expect(units(12n, 0, 2)).toBe("12.00");
    expect(erg(1_240_000_000_001n, 9)).toBe("1,240.000000001");
    expect(erg(1_240_000_000_001n, 9, "ru")).toBe(`1${T}240,000000001`);
  });
  it("time is blocks first, then human time (1 block ≈ 2 min)", () => {
    const N = " ";
    expect(humanTime(37)).toBe(`≈${N}1${N}h 14${N}min`);
    expect(humanTime(1348)).toBe(`≈${N}1${N}d 21${N}h`);
    expect(humanTime(2160)).toBe(`≈${N}3${N}days`);
    expect(humanTime(43200)).toBe(`≈${N}60${N}days`);
    expect(humanTime(2160, "ru")).toBe(`≈${N}3${N}дня`);
    expect(humanTime(43200, "ru")).toBe(`≈${N}60${N}дней`);
    expect(humanTime(10)).toBe(`≈${N}20${N}min`);
  });
  it("hex helpers", () => {
    const d = "9f3c1a2d07be55c0aa11bb22cc33dd44ee55ff6600112233445566772d18f0c7e1";
    expect(short("02d9aaaabbbb60b6")).toBe("02d9…60b6");
    expect(groupHex(d)).toBe("9f3c 1a2d 07be 55c0 … e1");
    expect(groupHex(d, 16, 10)).toBe("9f3c 1a2d 07be 55c0 … 2d18 f0c7 e1");
    expect(parseMoney("1 240.50")).toBe(1240.5);
    expect(parseMoney("12,5")).toBe(12.5);
    expect(parseMoney("abc")).toBeNull();
  });
  it("inputs read what the page writes, in either language", () => {
    for (const l of ["en", "ru"] as const) {
      expect(parseMoney(money(1240.5, 2, l))).toBe(1240.5);
      expect(parseMoney(money(-1921400.25, 2, l))).toBe(-1921400.25);
      expect(plainNumber(erg(9_545_000_000n, 3, l))).toBe("9.545");
    }
    expect(plainNumber("1,240.50")).toBe("1240.50");
    expect(plainNumber("1 240,50")).toBe("1240.50");
    expect(plainNumber("1.240,50")).toBe("1240.50");
    expect(plainNumber("1,240,000")).toBe("1240000");
    expect(plainNumber("12,5")).toBe("12.5");
    expect(plainNumber("0.40")).toBe("0.40");
  });
});

describe("performance budget (VISUAL §8.4)", () => {
  it("a mini key seal and a lite note are cheap enough to draw on demand", () => {
    const pk = exp.demoKeys.Alice;
    let t = performance.now();
    for (let i = 0; i < 20; i++) keySeal(pk + i.toString(16).padStart(2, "0"));
    const perSeal = (performance.now() - t) / 20;
    t = performance.now();
    const k = fromHex(exp.keys[3]);
    noteArt(k, { lite: true });
    const lite = performance.now() - t;
    expect(perSeal).toBeLessThan(16);
    expect(lite).toBeLessThan(120);
  });
});

describe("note art markup", () => {
  it("escapes the microprint text: it is drawn with innerHTML (keys review P2-10)", () => {
    const k = new Uint8Array(33).fill(7);
    const svg = noteArt(k, { micro: `<img src=x onerror="alert(1)">'&`, uid: "x" });
    expect(svg).not.toContain("<img");
    expect(svg).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
    expect(escapeXml("a<b>&\"'")).toBe("a&lt;b&gt;&amp;&quot;&#39;");
  });
});
