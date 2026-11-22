// The strict JSON reader: order kept, numbers exact, spans byte-exact on every fixture.
import { describe, expect, it } from "vitest";
import { TEXT } from "./fixtures/chain";
import { r3BuildText } from "./fixtures/r3-build";
import { asHex, asU64, at, JsonSyntaxError, parseJson, rawText, replaceSpan, ShapeError, utf8Length, type JsonNode } from "./json";
import { parseBuildResponse } from "./redemption";

function* walk(n: JsonNode): Generator<JsonNode> {
  yield n;
  if (n.kind === "object") for (const e of n.entries) yield* walk(e.value);
  if (n.kind === "array") for (const i of n.items) yield* walk(i);
}

/** A span-free dump: equal for equal JSON values written the same way. */
function dump(n: JsonNode): unknown {
  switch (n.kind) {
    case "object":
      return n.entries.map((e) => [e.key, dump(e.value)]);
    case "array":
      return n.items.map(dump);
    case "string":
      return ["s", n.value];
    case "number":
      return ["n", n.raw];
    case "bool":
      return n.value;
    case "null":
      return null;
  }
}

describe("parseJson", () => {
  it("keeps the key order JSON.parse loses", () => {
    const text = '{"0":"0200","5":"0e00","1":"07ab","10":"x"}';
    const o = parseJson(text);
    expect(o.kind === "object" && o.entries.map((e) => e.key)).toEqual(["0", "5", "1", "10"]);
    expect(Object.keys(JSON.parse(text))).toEqual(["0", "1", "5", "10"]);
  });

  it("keeps numbers exact", () => {
    const o = parseJson('{"a":18446744073709551615,"b":9007199254740993,"c":"600000000"}');
    expect(asU64(at(o, "a"), "a")).toBe(18446744073709551615n);
    expect(asU64(at(o, "b"), "b")).toBe(9007199254740993n);
    expect(asU64(at(o, "c"), "c")).toBe(600000000n);
    expect(() => asU64(parseJson("18446744073709551616"), "x")).toThrow(ShapeError);
    expect(() => asU64(parseJson("1.0"), "x")).toThrow(ShapeError);
    expect(() => asU64(parseJson("1e3"), "x")).toThrow(ShapeError);
    expect(() => asU64(parseJson("-1"), "x")).toThrow(ShapeError);
    expect(() => asU64(parseJson('"01"'), "x")).toThrow(ShapeError);
  });

  it("reads strings with escapes", () => {
    const s = parseJson('"a\\"b\\\\c\\u00e9\\n\\ud83d\\ude00"');
    expect(s.kind === "string" && s.value).toBe('a"b\\cé\n😀');
  });

  it.each([
    ['{"a":1,"a":2}', "duplicate key"],
    ['{"a":1} x', "trailing data"],
    ["01", "leading zero"],
    ['{"a":}', "missing value"],
    ['{"a":1,}', "trailing comma"],
    ["[1,]", "trailing comma"],
    ["'a'", "single quotes"],
    ['"\\x"', "bad escape"],
    ['"a\nb"', "raw control character"],
    ["NaN", "not JSON"],
    ["", "empty"],
    ['{"a" 1}', "missing colon"],
    ["1.", "bad number"],
    ["-", "bad number"],
  ])("refuses %s (%s)", (text) => {
    expect(() => parseJson(text)).toThrow(JsonSyntaxError);
  });

  it("refuses nesting deeper than maxDepth", () => {
    expect(() => parseJson("[".repeat(65) + "]".repeat(65))).toThrow(JsonSyntaxError);
    expect(() => parseJson("[".repeat(10) + "]".repeat(10), { maxDepth: 5 })).toThrow(JsonSyntaxError);
    expect(parseJson("[".repeat(64) + "]".repeat(64)).kind).toBe("array");
  });

  it("hex readers lowercase and check the length", () => {
    expect(asHex(parseJson('"AbCd"'), "x")).toBe("abcd");
    expect(() => asHex(parseJson('"abc"'), "x")).toThrow(ShapeError);
    expect(() => asHex(parseJson('"zz"'), "x")).toThrow(ShapeError);
    expect(() => asHex(parseJson('"abcd"'), "x", 3)).toThrow(ShapeError);
  });

  it("measures UTF-8", () => {
    expect(utf8Length("é😀a")).toBe(2 + 4 + 1);
  });
});

describe("spans", () => {
  const texts = { ...TEXT, r3Build: r3BuildText() };

  for (const [name, text] of Object.entries(texts)) {
    it(`${name}: every node's span re-reads as the same value, and replacing a span by itself changes nothing`, () => {
      const root = parseJson(text);
      let n = 0;
      for (const node of walk(root)) {
        const raw = rawText(text, node);
        expect(dump(parseJson(raw))).toEqual(dump(node));
        if (node.kind === "string") expect(JSON.parse(raw)).toBe(node.value);
        if (n % 97 === 0) expect(replaceSpan(text, node, raw)).toBe(text);
        n++;
      }
      expect(n).toBeGreaterThan(3);
    });
  }

  it("the build's unsigned_tx and partial_tx are exact slices of the answer", () => {
    const text = r3BuildText();
    const b = parseBuildResponse(text);
    expect(text.slice(b.unsignedSpan.start, b.unsignedSpan.end)).toBe(b.unsignedRaw);
    expect(text.slice(b.partialSpan.start, b.partialSpan.end)).toBe(b.partialRaw);
    expect(text.indexOf(`"unsigned_tx":${b.unsignedRaw},`)).toBe(text.indexOf('"unsigned_tx":'));
    expect(b.unsignedRaw.startsWith('{"inputs":[{"boxId":')).toBe(true);
    // The extension keys stay in the tracker's (Scala) order in the raw text.
    const ext = at(parseJson(b.unsignedRaw), "inputs", 0, "extension");
    expect(ext?.kind === "object" && ext.entries.map((e) => e.key)).toEqual(["0", "5", "1", "6", "2", "7", "3", "8", "4"]);
  });

  it("a splice changes only its span", () => {
    const text = '{"inputs":[{"boxId":"aa","spendingProof":{"proofBytes":"","extension":{"0":"0200"}}}]}';
    const slot = at(parseJson(text), "inputs", 0, "spendingProof", "proofBytes")!;
    const out = replaceSpan(text, slot, '"beef"');
    expect(out).toBe('{"inputs":[{"boxId":"aa","spendingProof":{"proofBytes":"beef","extension":{"0":"0200"}}}]}');
    expect(() => replaceSpan(text, { start: 5, end: 2 }, "")).toThrow(RangeError);
  });
});
