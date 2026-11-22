// Strict JSON with spans: every value keeps its exact [start, end) offsets in the source text, objects keep their key
// order, and numbers stay as their raw text.
//
// Why not JSON.parse:
//   • JSON.parse moves integer-like keys ("0", "5", "1", …) to ascending order, which loses the order of a context
//     extension (part of the transaction id) and changes the text the tracker fingerprints on submit;
//   • it reads u64 amounts as floats;
//   • on a duplicate key it silently keeps the last value, while another parser may keep the first.
//
// So: we never re-stringify a tracker answer. We read copies through this parser, and we echo or splice the original
// text by its spans. Duplicate keys, trailing data and anything outside RFC 8259 are refused.

export interface Span {
  /** Offset of the first character (UTF-16 index into the source string). */
  start: number;
  /** Offset just after the last character. */
  end: number;
}

export interface JsonObject extends Span { kind: "object"; entries: JsonEntry[] }
export interface JsonEntry { key: string; keySpan: Span; value: JsonNode }
export interface JsonArray extends Span { kind: "array"; items: JsonNode[] }
export interface JsonString extends Span { kind: "string"; value: string }
/** `raw` is the number exactly as written, e.g. "1000000" or "1e3". */
export interface JsonNumber extends Span { kind: "number"; raw: string }
export interface JsonBool extends Span { kind: "bool"; value: boolean }
export interface JsonNull extends Span { kind: "null" }
export type JsonNode = JsonObject | JsonArray | JsonString | JsonNumber | JsonBool | JsonNull;

export class JsonSyntaxError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`);
    this.name = "JsonSyntaxError";
  }
}

export interface ParseOptions {
  /** How many objects and arrays may be nested (default 64). */
  maxDepth?: number;
}

const WS = new Set([0x20, 0x09, 0x0a, 0x0d]);

/** Parses one JSON text (RFC 8259, no duplicate keys). Throws JsonSyntaxError. */
export function parseJson(text: string, opts: ParseOptions = {}): JsonNode {
  const maxDepth = opts.maxDepth ?? 64;
  let i = 0;
  const n = text.length;

  const fail = (msg: string, at = i): never => {
    throw new JsonSyntaxError(msg, at);
  };
  const skipWs = () => {
    while (i < n && WS.has(text.charCodeAt(i))) i++;
  };

  function parseString(): JsonString {
    const start = i;
    i++; // opening quote
    let out = "";
    let chunk = i;
    for (;;) {
      if (i >= n) fail("unterminated string", start);
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(chunk, i);
        i++;
        return { kind: "string", value: out, start, end: i };
      }
      if (c < 0x20) fail("control character in string");
      if (c === 0x5c) {
        out += text.slice(chunk, i);
        const e = text[i + 1];
        switch (e) {
          case '"': out += '"'; i += 2; break;
          case "\\": out += "\\"; i += 2; break;
          case "/": out += "/"; i += 2; break;
          case "b": out += "\b"; i += 2; break;
          case "f": out += "\f"; i += 2; break;
          case "n": out += "\n"; i += 2; break;
          case "r": out += "\r"; i += 2; break;
          case "t": out += "\t"; i += 2; break;
          case "u": {
            const h = text.slice(i + 2, i + 6);
            if (!/^[0-9a-fA-F]{4}$/.test(h)) fail("bad \\u escape");
            out += String.fromCharCode(parseInt(h, 16));
            i += 6;
            break;
          }
          default:
            fail("bad escape");
        }
        chunk = i;
        continue;
      }
      i++;
    }
  }

  function parseNumber(): JsonNumber {
    const start = i;
    const m = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(text.slice(i, Math.min(n, i + 400)));
    if (!m || m[0].length === 0) fail("bad number");
    i += m![0].length;
    return { kind: "number", raw: m![0], start, end: i };
  }

  function literal<T extends JsonNode>(word: string, node: Omit<T, "start" | "end">): T {
    const start = i;
    if (text.startsWith(word, i)) {
      i += word.length;
      return { ...node, start, end: i } as T;
    }
    return fail("unexpected token");
  }

  /** `depth` = how many objects and arrays enclose this value; at most `maxDepth` may be open at once. */
  function parseValue(depth: number): JsonNode {
    skipWs();
    if (i >= n) fail("unexpected end");
    const c = text[i];
    if ((c === "{" || c === "[") && depth >= maxDepth) fail("nesting too deep");
    if (c === "{") {
      const start = i;
      i++;
      const entries: JsonEntry[] = [];
      const seen = new Set<string>();
      skipWs();
      if (text[i] === "}") {
        i++;
        return { kind: "object", entries, start, end: i };
      }
      for (;;) {
        skipWs();
        if (text[i] !== '"') fail("expected a key");
        const k = parseString();
        if (seen.has(k.value)) fail(`duplicate key ${JSON.stringify(k.value)}`, k.start);
        seen.add(k.value);
        skipWs();
        if (text[i] !== ":") fail("expected ':'");
        i++;
        const value = parseValue(depth + 1);
        entries.push({ key: k.value, keySpan: { start: k.start, end: k.end }, value });
        skipWs();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "}") { i++; return { kind: "object", entries, start, end: i }; }
        fail("expected ',' or '}'");
      }
    }
    if (c === "[") {
      const start = i;
      i++;
      const items: JsonNode[] = [];
      skipWs();
      if (text[i] === "]") {
        i++;
        return { kind: "array", items, start, end: i };
      }
      for (;;) {
        items.push(parseValue(depth + 1));
        skipWs();
        if (text[i] === ",") { i++; continue; }
        if (text[i] === "]") { i++; return { kind: "array", items, start, end: i }; }
        fail("expected ',' or ']'");
      }
    }
    if (c === '"') return parseString();
    if (c === "t") return literal<JsonBool>("true", { kind: "bool", value: true });
    if (c === "f") return literal<JsonBool>("false", { kind: "bool", value: false });
    if (c === "n") return literal<JsonNull>("null", { kind: "null" });
    if (c === "-" || (c >= "0" && c <= "9")) return parseNumber();
    return fail("unexpected character");
  }

  const root = parseValue(0);
  skipWs();
  if (i !== n) fail("trailing data after the JSON value");
  return root;
}

/** The exact source text of a node (or any span). */
export function rawText(text: string, span: Span): string {
  return text.slice(span.start, span.end);
}

/** `text` with `span` replaced by `replacement`; nothing else changes. */
export function replaceSpan(text: string, span: Span, replacement: string): string {
  if (span.start < 0 || span.end > text.length || span.start > span.end) throw new RangeError("span outside the text");
  return text.slice(0, span.start) + replacement + text.slice(span.end);
}

/** Follows object keys and array indexes; undefined when any step is missing or of the wrong kind. */
export function at(node: JsonNode | undefined, ...path: (string | number)[]): JsonNode | undefined {
  let cur = node;
  for (const step of path) {
    if (!cur) return undefined;
    if (typeof step === "number") {
      if (cur.kind !== "array") return undefined;
      cur = cur.items[step];
    } else {
      if (cur.kind !== "object") return undefined;
      cur = cur.entries.find((e) => e.key === step)?.value;
    }
  }
  return cur;
}

/** UTF-8 length of a string: what a request body really weighs. */
export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

// ─── typed readers: every refusal names the path ────────────────────────────────────────────────

export class ShapeError extends Error {
  constructor(readonly path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "ShapeError";
  }
}

const U64_MAX = (1n << 64n) - 1n;

export function asObject(node: JsonNode | undefined, path: string): JsonObject {
  if (!node || node.kind !== "object") throw new ShapeError(path, "expected an object");
  return node;
}

export function asArray(node: JsonNode | undefined, path: string): JsonArray {
  if (!node || node.kind !== "array") throw new ShapeError(path, "expected an array");
  return node;
}

export function member(o: JsonObject, key: string): JsonNode | undefined {
  return o.entries.find((e) => e.key === key)?.value;
}

export function required(o: JsonObject, key: string, path: string): JsonNode {
  const v = member(o, key);
  if (!v) throw new ShapeError(`${path}.${key}`, "missing");
  return v;
}

export function asString(node: JsonNode | undefined, path: string): string {
  if (!node || node.kind !== "string") throw new ShapeError(path, "expected a string");
  return node.value;
}

export function asBool(node: JsonNode | undefined, path: string): boolean {
  if (!node || node.kind !== "bool") throw new ShapeError(path, "expected true or false");
  return node.value;
}

/** Lowercase hex; `bytes` fixes the decoded length. */
export function asHex(node: JsonNode | undefined, path: string, bytes?: number): string {
  const s = asString(node, path);
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(s)) throw new ShapeError(path, "expected hex");
  if (bytes !== undefined && s.length !== bytes * 2) throw new ShapeError(path, `expected ${bytes} bytes of hex, got ${s.length / 2}`);
  return s.toLowerCase();
}

/**
 * An unsigned 64-bit integer, exact: a JSON integer (no sign, fraction or exponent) or a string of decimal digits
 * (the /v1 shape quotes amounts).
 */
export function asU64(node: JsonNode | undefined, path: string): bigint {
  let digits: string;
  if (node && node.kind === "number") digits = node.raw;
  else if (node && node.kind === "string") digits = node.value;
  else throw new ShapeError(path, "expected an integer");
  if (!/^(?:0|[1-9][0-9]*)$/.test(digits)) throw new ShapeError(path, `not an unsigned integer: ${JSON.stringify(digits.slice(0, 40))}`);
  const v = BigInt(digits);
  if (v > U64_MAX) throw new ShapeError(path, "above 2^64 - 1");
  return v;
}

/** A non-negative safe integer (heights, indexes, counts). */
export function asSafeInt(node: JsonNode | undefined, path: string, max = Number.MAX_SAFE_INTEGER): number {
  const v = asU64(node, path);
  if (v > BigInt(max)) throw new ShapeError(path, `above ${max}`);
  return Number(v);
}

// ─── writing ────────────────────────────────────────────────────────────────────────────────────

/** A JSON string literal for ASCII-safe values (hex, addresses, fixed words). */
export function jsonString(s: string): string {
  return JSON.stringify(s);
}
