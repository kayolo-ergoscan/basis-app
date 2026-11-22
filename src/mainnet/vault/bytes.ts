// Byte helpers of the vault: strict base64, wiping, and the scan that stops a secret callback from handing the key
// back. Never call toB64 on a secret: base64 strings cannot be wiped.
import { hexToBytes } from "@noble/hashes/utils";

const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function toB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

/** Strict base64 (standard alphabet, padded). `len`: exact length, or [min, max]. Null when it does not fit. */
export function fromB64(s: unknown, len?: number | readonly [number, number]): Uint8Array | null {
  if (typeof s !== "string" || !B64_RE.test(s)) return null;
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  if (typeof len === "number" && out.length !== len) return null;
  if (Array.isArray(len) && (out.length < len[0] || out.length > len[1])) return null;
  return out;
}

export function wipe(...arrays: Array<Uint8Array | null | undefined>): void {
  for (const a of arrays) a?.fill(0);
}

/** Byte equality without an early exit. */
export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export function utf8Length(s: string): number {
  return new TextEncoder().encode(s).length;
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || hay.length < needle.length) return -1;
  const first = needle[0];
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue;
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

const HEX_RUN = /[0-9a-fA-F]{64,}/g;
/** Standard base64 and base64url (32 bytes take at least 43 characters). Padding is not needed to find the bytes. */
const B64_RUN = /[A-Za-z0-9+/_-]{43,}/g;
/** Byte values written as text, as JSON.stringify(Array.from(bytes)) does. */
const BYTE_LIST = /\d{1,3}(?:\s*,\s*\d{1,3}){31,}/g;
const MAX_SCAN_CHARS = 1 << 20;
const MAX_DEPTH = 12;
const MAX_PARTS = 50_000;

const B64_VALUE = new Int8Array(128).fill(-1);
[..."ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"].forEach((c, i) => (B64_VALUE[c.charCodeAt(0)] = i));
B64_VALUE["-".charCodeAt(0)] = 62;
B64_VALUE["_".charCodeAt(0)] = 63;

/** Base64 characters (either alphabet) read as a bit stream, every 8 bits one byte. */
function b64Bits(s: string): Uint8Array {
  const out = new Uint8Array(Math.floor((s.length * 6) / 8));
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < s.length; i++) {
    acc = ((acc << 6) | B64_VALUE[s.charCodeAt(i)]) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Runs of byte values (integers 0–255) in a list of numbers; anything else ends a run. */
function byteRuns(values: readonly unknown[], min: number): Uint8Array[] {
  const runs: Uint8Array[] = [];
  let cur: number[] = [];
  const flush = () => {
    if (cur.length >= min) runs.push(Uint8Array.from(cur));
    cur.fill(0);
    cur = [];
  };
  for (const x of values) {
    if (typeof x === "number" && Number.isInteger(x) && x >= 0 && x <= 255) cur.push(x);
    else flush();
  }
  flush();
  return runs;
}

const hitAndWipe = (bytes: Uint8Array, secret: Uint8Array): boolean => {
  const hit = indexOfBytes(bytes, secret) >= 0;
  bytes.fill(0);
  return hit;
};

/** The secret in a string: hex, base64 or base64url at any offset, a list of its byte values, its decimal scalar. The
 *  secret's own encodings are never built (the decimal excepted, for random keys only). */
function stringHolds(s: string, secret: Uint8Array, dec: string | null): boolean {
  if (s.length < 40) return false;
  if (dec !== null && s.includes(dec)) return true;
  for (const m of s.matchAll(HEX_RUN)) {
    const run = m[0];
    for (let off = 0; off < 2; off++) {
      const n = (run.length - off) & ~1;
      if (n >= secret.length * 2 && hitAndWipe(hexToBytes(run.slice(off, off + n).toLowerCase()), secret)) return true;
    }
  }
  for (const m of s.matchAll(B64_RUN)) {
    for (let off = 0; off < 4 && m[0].length - off >= 43; off++) if (hitAndWipe(b64Bits(m[0].slice(off)), secret)) return true;
  }
  for (const m of s.matchAll(BYTE_LIST)) {
    for (const run of byteRuns(m[0].split(",").map((x) => Number(x.trim())), secret.length)) if (hitAndWipe(run, secret)) return true;
  }
  return false;
}

function scalarOf(secret: Uint8Array): bigint {
  let v = 0n;
  for (const b of secret) v = (v << 8n) | BigInt(b);
  return v;
}

/**
 * Scans a secret callback's output (or what it threw) for the secret. Best effort, but broad: the same bytes (typed
 * arrays, buffers, arrays of byte values, also inside larger ones); its hex, base64 or base64url in any string, at any
 * offset; its byte values written as a list; its scalar as a bigint or in decimal. Walks arrays, objects (keys too),
 * Maps, Sets and Errors (message, stack, cause, errors). Fails closed: a function or a promise anywhere, more than
 * 12 levels, more than 50 000 parts or a string over 1 MiB count as holding the secret.
 */
export function holdsSecret(value: unknown, secret: Uint8Array): boolean {
  let budget = MAX_PARTS;
  let scalar: bigint | undefined;
  let dec: string | null | undefined;
  const seen = new Set<object>();
  const visit = (v: unknown, depth: number): boolean => {
    if (budget-- <= 0 || depth > MAX_DEPTH) return true;
    if (typeof v === "string") {
      if (v.length > MAX_SCAN_CHARS) return true;
      if (dec === undefined) {
        const d = (scalar ??= scalarOf(secret)).toString();
        dec = d.length >= 40 ? d : null; // a random key has ~77 digits; tiny test scalars would match everything
      }
      return stringHolds(v, secret, dec);
    }
    if (typeof v === "bigint") return v === (scalar ??= scalarOf(secret));
    if (typeof v === "function") return true;
    if (v === null || typeof v !== "object") return false;
    if (seen.has(v)) return false;
    seen.add(v);
    if (typeof (v as { then?: unknown }).then === "function") return true;
    if (v instanceof Uint8Array) return indexOfBytes(v, secret) >= 0;
    if (ArrayBuffer.isView(v)) return indexOfBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), secret) >= 0;
    if (v instanceof ArrayBuffer) return indexOfBytes(new Uint8Array(v), secret) >= 0;
    const next = depth + 1;
    if (v instanceof Error) {
      const e = v as Error & { cause?: unknown; errors?: unknown };
      if (visit(e.message, next) || visit(e.stack, next) || visit(e.cause, next) || visit(e.errors, next)) return true;
    }
    if (v instanceof Map) {
      for (const [k, x] of v) if (visit(k, next) || visit(x, next)) return true;
      return false;
    }
    if (v instanceof Set) {
      for (const x of v) if (visit(x, next)) return true;
      return false;
    }
    if (Array.isArray(v)) {
      if (v.length >= secret.length && byteRuns(v, secret.length).some((run) => hitAndWipe(run, secret))) return true;
      for (const x of v) if (visit(x, next)) return true;
      return false;
    }
    for (const [k, x] of Object.entries(v)) if (visit(k, next) || visit(x, next)) return true;
    return false;
  };
  return visit(value, 0);
}
