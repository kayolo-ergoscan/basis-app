// Basis Schnorr signatures over secp256k1, bit-exact with contract/basis.es, basis-token.es,
// crates/basis_core/src/impls.rs (SchnorrVerifier / schnorr_sign) and scala/.../offchain/SigUtils.scala.
//
//   signature = a(33, compressed point a = k·G) ‖ z(32, big-endian)
//   e         = blake2b256(a ‖ message ‖ pubkey)            ("strong" Fiat–Shamir, pubkey included)
//   z         = k + e·x  (mod n)
//   check     : g^z == a · X^e        (multiplicative notation of the contract)
//               z·G == a + e·X        (additive notation used here)
//
// Contract compatibility: the reserve contract reads z and e with ErgoScript's SIGNED `byteArrayToBigInt`.
// A 32-byte value with the top bit set becomes negative there and the on-chain equation no longer holds,
// so (exactly like the Rust and Scala signers) we retry the nonce until e[0] < 0x80 and z < 2^255, and the
// verifier (like the Rust tracker) rejects signatures that break either rule.
//
// Nonces are DETERMINISTIC by default (RFC 6979 in spirit): k₀ = H(domain ‖ secret ‖ H(message) ‖ round).
// Same key + same message → same signature, which keeps sandbox replays and the time machine byte-stable.
// Candidates per round: k₀+j for j = 0..7 (R_j = R_0 + j·G, one point addition each), and for each of them
// n−k (the same point negated, prefix flipped). P(a candidate passes both top-bit rules) ≈ 1/4, so one
// scalar multiplication almost always suffices. Only the accepted candidate is ever published; rejected
// z values are never exposed (two related candidates would reveal the secret key).

import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bigToBytes,
  blake2b256,
  bytesToBig,
  bytesToHex,
  bytesToSignedBig,
  concatBytes,
  equalBytes,
  toBytes,
  utf8,
  type Hex,
} from "./bytes";
import { CURVE_N, Point, type CurvePoint, type KeyPair, keyPairFromSecret } from "./keys";

export const SIGNATURE_LENGTH = 65;
const N = CURVE_N;
const G = Point.BASE;
const TWO_255 = 1n << 255n;
const NONCE_DOMAIN = utf8("basis/schnorr-nonce/v1");

/** e = blake2b256(a ‖ message ‖ pubkey). */
export function challenge(a: Uint8Array, message: Uint8Array, pub: Uint8Array): Uint8Array {
  return blake2b256(a, message, pub);
}

/** True when a big-endian value survives the contract's signed `byteArrayToBigInt` (top bit clear). */
export function isContractCompatible32(bytes: Uint8Array): boolean {
  return bytes.length > 0 && bytes[0] < 0x80;
}

// ---------- scalar multiplication ----------
// IMPORTANT: in @noble/curves 1.7.0 `multiplyUnsafe` returns WRONG points for any point that carries
// precomputed windows (including Point.BASE). It is only used here on fresh, non-windowed points.
// Windowed points (G and hot public keys) always go through the constant-time `multiply`, which is correct.

/** k·G, correct for every k (0 → identity). */
function mulG(k: bigint): CurvePoint {
  const r = ((k % N) + N) % N;
  return r === 0n ? Point.ZERO : G.multiply(r);
}

/** k·P for a point P that has NO precomputed window (fresh from fromHex). */
function mulP(P: CurvePoint, k: bigint): CurvePoint {
  const r = ((k % N) + N) % N;
  return r === 0n || P.equals(Point.ZERO) ? Point.ZERO : P.multiplyUnsafe(r);
}

// ---------- public-key point cache ----------
// Decompressing a key costs a square root; multiplying an arbitrary point costs ~1.2 ms in pure JS.
// Hot keys (the ones the tracker verifies over and over) get a precomputed window: W=4 after a few uses
// (≈0.4 ms per multiplication), W=8 for the hottest few (≈0.23 ms).

interface CachedPoint {
  point: CurvePoint;
  uses: number;
  window: 0 | 4 | 8;
}
const pointCache = new Map<string, CachedPoint>();
let w4Keys = 0;
let w8Keys = 0;
const MAX_CACHED_POINTS = 4096;
const MAX_W4_KEYS = 64;
const MAX_W8_KEYS = 8;
const W4_AFTER_USES = 3;
const W8_AFTER_USES = 64;

function cachedPubPoint(pub: Uint8Array): CachedPoint | null {
  const hex = bytesToHex(pub);
  let c = pointCache.get(hex);
  if (!c) {
    if (pub.length !== 33 || (pub[0] !== 0x02 && pub[0] !== 0x03)) return null;
    let p: CurvePoint;
    try {
      p = Point.fromHex(pub);
    } catch {
      return null;
    }
    if (pointCache.size >= MAX_CACHED_POINTS) {
      for (const [k, v] of pointCache) {
        if (v.window === 0) {
          pointCache.delete(k);
          break;
        }
      }
    }
    c = { point: p, uses: 0, window: 0 };
    pointCache.set(hex, c);
  }
  c.uses++;
  if (c.window === 0 && c.uses >= W4_AFTER_USES && w4Keys < MAX_W4_KEYS) {
    c.point._setWindowSize(4);
    c.window = 4;
    w4Keys++;
  } else if (c.window === 4 && c.uses >= W8_AFTER_USES && w8Keys < MAX_W8_KEYS) {
    c.point._setWindowSize(8);
    c.window = 8;
    w8Keys++;
    w4Keys--;
  }
  return c;
}

/** e·X using the cache entry's window when it has one. */
function mulCached(c: CachedPoint, k: bigint): CurvePoint {
  const r = ((k % N) + N) % N;
  if (r === 0n) return Point.ZERO;
  return c.window === 0 ? c.point.multiplyUnsafe(r) : c.point.multiply(r);
}

/** Warms the cache for a key that will be verified often (e.g. the tracker key). */
export function warmPublicKey(pub: Uint8Array | Hex, window: 4 | 8 = 8): void {
  const b = toBytes(pub);
  const c = cachedPubPoint(b);
  if (!c || c.window >= window) return;
  if (window === 8 && w8Keys < MAX_W8_KEYS) {
    if (c.window === 4) w4Keys--;
    c.point._setWindowSize(8);
    c.window = 8;
    w8Keys++;
  } else if (c.window === 0 && w4Keys < MAX_W4_KEYS) {
    c.point._setWindowSize(4);
    c.window = 4;
    w4Keys++;
  }
}

// ---------- signing ----------

export type NonceMode = "deterministic" | "random";

export interface SignOptions {
  /** "deterministic" (default): k₀ = H(domain ‖ secret ‖ H(msg) ‖ round [‖ extraEntropy]). "random": CSPRNG. */
  nonce?: NonceMode;
  /** Mixed into deterministic nonces (e.g. a seeded RNG draw); same entropy → same signature. */
  extraEntropy?: Uint8Array;
  /** Safety valve on rounds (each round = 1 scalar multiplication + up to 16 candidates). */
  maxRounds?: number;
}

export type SignRejection = "e-top-bit" | "z-top-bit" | "z-zero";

export interface SignAttempt {
  round: number;
  /** k = k₀ + step; "+R" uses k, "-R" uses n−k (the same point negated, prefix flipped). */
  step: number;
  candidate: "+R" | "-R";
  a: Hex;
  e: Hex;
  eTopBit: boolean;
  /** Only reported for z checks; the rejected z itself is never exposed (it would leak the key). */
  zTopBit: boolean | null;
  accepted: boolean;
  rejectedBy?: SignRejection;
}

export interface SignTrace {
  signature: Uint8Array;
  signatureHex: Hex;
  pub: Hex;
  message: Hex;
  /** Candidates tried in order; only the accepted one is ever published. */
  attempts: SignAttempt[];
  /** Scalar multiplications spent (candidates after the first come from cheap point additions). */
  multiplications: number;
}

type Signer = KeyPair | bigint;

function signerParts(signer: Signer): { s: bigint; pub: Uint8Array; secret32: Uint8Array } {
  const kp = typeof signer === "bigint" ? keyPairFromSecret(signer) : signer;
  return { s: kp.secret, pub: kp.pub, secret32: bigToBytes(kp.secret, 32) };
}

function nonceFor(secret32: Uint8Array, msgHash: Uint8Array, round: number, opts: SignOptions): bigint {
  if (opts.nonce === "random") return bytesToBig(secp256k1.utils.randomPrivateKey());
  const ctr = new Uint8Array([round >>> 24, (round >>> 16) & 0xff, (round >>> 8) & 0xff, round & 0xff]);
  const h = opts.extraEntropy ? blake2b256(NONCE_DOMAIN, secret32, msgHash, ctr, opts.extraEntropy) : blake2b256(NONCE_DOMAIN, secret32, msgHash, ctr);
  return (bytesToBig(h) % (N - 1n)) + 1n;
}

function flipPrefix(a: Uint8Array): Uint8Array {
  const out = a.slice();
  out[0] = out[0] === 0x02 ? 0x03 : 0x02;
  return out;
}

const STEPS_PER_ROUND = 8;

function signCore(message: Uint8Array, signer: Signer, opts: SignOptions, trace: SignAttempt[] | null): { sig: Uint8Array; mults: number } {
  const { s, pub, secret32 } = signerParts(signer);
  const msgHash = blake2b256(message);
  const maxRounds = opts.maxRounds ?? 64;
  for (let round = 0; round < maxRounds; round++) {
    const k0 = nonceFor(secret32, msgHash, round, opts);
    let R = G.multiply(k0);
    for (let step = 0; step < STEPS_PER_ROUND; step++) {
      if (step > 0) R = R.add(G);
      const k = (k0 + BigInt(step)) % N;
      if (k === 0n || R.equals(Point.ZERO)) continue;
      const aPlus = R.toRawBytes(true);
      for (let c = 0; c < 2; c++) {
        const a = c === 0 ? aPlus : flipPrefix(aPlus);
        const kk = c === 0 ? k : N - k;
        const cand = c === 0 ? "+R" : "-R";
        const e = challenge(a, message, pub);
        if (e[0] >= 0x80) {
          trace?.push({ round, step, candidate: cand, a: bytesToHex(a), e: bytesToHex(e), eTopBit: true, zTopBit: null, accepted: false, rejectedBy: "e-top-bit" });
          continue;
        }
        // e < 2^255 < n: no reduction needed, identical to the contract's view of e.
        const z = (kk + bytesToBig(e) * s) % N;
        if (z === 0n || z >= TWO_255) {
          trace?.push({ round, step, candidate: cand, a: bytesToHex(a), e: bytesToHex(e), eTopBit: false, zTopBit: z !== 0n, accepted: false, rejectedBy: z === 0n ? "z-zero" : "z-top-bit" });
          continue;
        }
        trace?.push({ round, step, candidate: cand, a: bytesToHex(a), e: bytesToHex(e), eTopBit: false, zTopBit: false, accepted: true });
        return { sig: concatBytes(a, bigToBytes(z, 32)), mults: round + 1 };
      }
    }
  }
  throw new Error("could not find a contract-compatible nonce (maxRounds exhausted)");
}

/** Signs `message` (normally the 80-byte note message). Returns the 65-byte a ‖ z signature. */
export function sign(message: Uint8Array | Hex, signer: Signer, opts: SignOptions = {}): Uint8Array {
  return signCore(toBytes(message), signer, opts, null).sig;
}

/** Same as `sign`, plus every candidate tried and why it was rejected — for the signature X-ray. */
export function signWithTrace(message: Uint8Array | Hex, signer: Signer, opts: SignOptions = {}): SignTrace {
  const m = toBytes(message);
  const attempts: SignAttempt[] = [];
  const { sig, mults } = signCore(m, signer, opts, attempts);
  const pub = typeof signer === "bigint" ? keyPairFromSecret(signer).pubHex : signer.pubHex;
  return { signature: sig, signatureHex: bytesToHex(sig), pub, message: bytesToHex(m), attempts, multiplications: mults };
}

// ---------- verification ----------

export type VerifyFailure =
  | "length"
  | "a-prefix"
  | "z-zero"
  | "z-top-bit"
  | "pubkey-invalid"
  | "a-not-on-curve"
  | "e-top-bit"
  | "equation";

export const VERIFY_FAILURE_TEXT: Record<VerifyFailure, string> = {
  length: "signature must be exactly 65 bytes: a (33) ‖ z (32)",
  "a-prefix": "a must be a compressed point (first byte 0x02 or 0x03)",
  "z-zero": "z is all zeros",
  "z-top-bit": "z ≥ 2^255: the contract's signed byteArrayToBigInt reads it as negative",
  "pubkey-invalid": "public key is not a valid compressed secp256k1 point",
  "a-not-on-curve": "a does not decode to a point on secp256k1",
  "e-top-bit": "challenge e = blake2b256(a ‖ msg ‖ pk) has its top bit set: the contract reads it as negative",
  equation: "z·G ≠ a + e·X (g^z ≠ a·x^e)",
};

export interface VerifyResult {
  ok: boolean;
  reason?: VerifyFailure;
  message: string;
}

const OK_RESULT: VerifyResult = { ok: true, message: "valid" };

function fail(reason: VerifyFailure): VerifyResult {
  return { ok: false, reason, message: VERIFY_FAILURE_TEXT[reason] };
}

/**
 * Verifies like the Rust tracker (`SchnorrVerifier::verify_signature`), whose rules coincide with what the
 * reserve contract can execute: format → key → top-bit rules → g^z == a·x^e. Check order mirrors the Rust code.
 */
export function verify(pub: Uint8Array | Hex, message: Uint8Array | Hex, signature: Uint8Array | Hex): VerifyResult {
  let sig: Uint8Array, pk: Uint8Array, msg: Uint8Array;
  try {
    sig = toBytes(signature);
    pk = toBytes(pub);
    msg = toBytes(message);
  } catch {
    return fail("length");
  }
  if (sig.length !== SIGNATURE_LENGTH) return fail("length");
  const a = sig.subarray(0, 33);
  const zb = sig.subarray(33, 65);
  if (a[0] !== 0x02 && a[0] !== 0x03) return fail("a-prefix");
  if (zb.every((x) => x === 0)) return fail("z-zero");
  if (!isContractCompatible32(zb)) return fail("z-top-bit");
  const X = cachedPubPoint(pk);
  if (!X) return fail("pubkey-invalid");
  const e = challenge(a, msg, pk);
  if (!isContractCompatible32(e)) {
    // The Rust verifier parses `a` before computing e; report a broken `a` first, like it does.
    if (!pointOrNull(a)) return fail("a-not-on-curve");
    return fail("e-top-bit");
  }
  const z = bytesToBig(zb); // < 2^255 < n
  const eInt = bytesToBig(e); // < 2^255 < n
  // R' = z·G − e·X must be exactly the point a.
  const Rp = G.multiply(z).subtract(mulCached(X, eInt));
  if (!Rp.equals(Point.ZERO) && equalBytes(Rp.toRawBytes(true), a)) return OK_RESULT;
  if (!pointOrNull(a)) return fail("a-not-on-curve");
  return fail("equation");
}

export function isValidSignature(pub: Uint8Array | Hex, message: Uint8Array | Hex, signature: Uint8Array | Hex): boolean {
  return verify(pub, message, signature).ok;
}

function pointOrNull(b: Uint8Array): CurvePoint | null {
  try {
    return Point.fromHex(b);
  } catch {
    return null;
  }
}

function compressOrNull(p: CurvePoint | null): Hex | null {
  if (!p) return null;
  if (p.equals(Point.ZERO)) return "00".repeat(33);
  return bytesToHex(p.toRawBytes(true));
}


export type XrayCheckId = "length" | "a-prefix" | "z-zero" | "z-top-bit" | "pubkey-invalid" | "a-not-on-curve" | "e-top-bit" | "equation";

export interface XrayCheck {
  id: XrayCheckId;
  label: string;
  ok: boolean | null;
  detail: string;
}

/** Everything the signature X-ray view shows: inputs, intermediate values, both sides of the equation, verdict. */
export interface SignatureXray {
  ok: boolean;
  reason?: VerifyFailure;
  reasonText?: string;
  pubkey: Hex;
  message: Hex;
  signature: Hex;
  a: Hex | null;
  z: Hex | null;
  zDecimal: string | null;
  zTopBit: boolean | null;
  /** a ‖ message ‖ pubkey — the challenge preimage. */
  challengeInput: Hex | null;
  e: Hex | null;
  eDecimal: string | null;
  eTopBit: boolean | null;
  /** z·G compressed (g^z). */
  lhs: Hex | null;
  /** a + e·X compressed (a·x^e). */
  rhs: Hex | null;
  /** The plain group equation with unsigned z and e. */
  equationHolds: boolean | null;
  /**
   * What the ErgoScript interpreter computes: z and e read with SIGNED byteArrayToBigInt.
   * Identical to the plain equation when both top bits are clear.
   */
  contractView: {
    zSigned: string | null;
    eSigned: string | null;
    lhs: Hex | null;
    rhs: Hex | null;
    holds: boolean | null;
    note: string;
  };
  checks: XrayCheck[];
  failed?: XrayCheckId;
}

/** Full verification trace of one signature (slower than `verify`; meant for the X-ray UI and tests). */
export function explain(pub: Uint8Array | Hex, message: Uint8Array | Hex, signature: Uint8Array | Hex): SignatureXray {
  const pk = safeBytes(pub);
  const msg = safeBytes(message) ?? new Uint8Array();
  const sig = safeBytes(signature) ?? new Uint8Array();
  const checks: XrayCheck[] = [];
  const verdict = verify(pk ?? new Uint8Array(), msg, sig);

  const lenOk = sig.length === SIGNATURE_LENGTH;
  checks.push({ id: "length", label: "65 bytes: a(33) ‖ z(32)", ok: lenOk, detail: `${sig.length} bytes` });
  const a = lenOk ? sig.subarray(0, 33) : null;
  const zb = lenOk ? sig.subarray(33, 65) : null;
  const aPrefixOk = a ? a[0] === 0x02 || a[0] === 0x03 : null;
  checks.push({ id: "a-prefix", label: "a is compressed (0x02/0x03)", ok: aPrefixOk, detail: a ? `prefix 0x${a[0].toString(16).padStart(2, "0")}` : "n/a" });
  const zZero = zb ? zb.every((x) => x === 0) : null;
  checks.push({ id: "z-zero", label: "z ≠ 0", ok: zZero === null ? null : !zZero, detail: zb ? (zZero ? "all zero" : "non-zero") : "n/a" });
  const zTop = zb ? !isContractCompatible32(zb) : null;
  checks.push({ id: "z-top-bit", label: "z < 2^255 (z[0] < 0x80)", ok: zTop === null ? null : !zTop, detail: zb ? `z[0] = 0x${zb[0].toString(16).padStart(2, "0")}` : "n/a" });
  const X = pk ? pointOrNull(pk) : null;
  const pkOk = !!X && !!pk && pk.length === 33 && (pk[0] === 2 || pk[0] === 3);
  checks.push({ id: "pubkey-invalid", label: "public key is a valid point", ok: pkOk, detail: pk ? `${pk.length} bytes` : "unparseable" });
  const A = a && aPrefixOk ? pointOrNull(a) : null;
  checks.push({ id: "a-not-on-curve", label: "a decodes to a curve point", ok: a ? !!A : null, detail: a ? (A ? "on curve" : "not a point") : "n/a" });

  let e: Uint8Array | null = null;
  let challengeInput: Uint8Array | null = null;
  if (a && pk) {
    challengeInput = concatBytes(a, msg, pk);
    e = blake2b256(challengeInput);
  }
  const eTop = e ? !isContractCompatible32(e) : null;
  checks.push({ id: "e-top-bit", label: "e < 2^255 (e[0] < 0x80)", ok: eTop === null ? null : !eTop, detail: e ? `e[0] = 0x${e[0].toString(16).padStart(2, "0")}` : "n/a" });

  let lhs: CurvePoint | null = null;
  let rhs: CurvePoint | null = null;
  let holds: boolean | null = null;
  let lhsC: CurvePoint | null = null;
  let rhsC: CurvePoint | null = null;
  let holdsC: boolean | null = null;
  const zU = zb ? bytesToBig(zb) : null;
  const eU = e ? bytesToBig(e) : null;
  const zS = zb ? bytesToSignedBig(zb) : null;
  const eS = e ? bytesToSignedBig(e) : null;
  if (A && X && zU !== null && eU !== null && zS !== null && eS !== null) {
    lhs = mulG(zU);
    rhs = A.add(mulP(X, eU));
    holds = lhs.equals(rhs);
    lhsC = mulG(zS);
    rhsC = A.add(mulP(X, eS));
    holdsC = lhsC.equals(rhsC);
  }
  checks.push({
    id: "equation",
    label: "z·G == a + e·X",
    ok: holds,
    detail: holds === null ? "not evaluated" : holds ? "both sides are the same point" : "the two sides differ",
  });

  const failedCheck = verdict.ok ? undefined : (verdict.reason as XrayCheckId);
  return {
    ok: verdict.ok,
    reason: verdict.reason,
    reasonText: verdict.ok ? undefined : verdict.message,
    pubkey: pk ? bytesToHex(pk) : "",
    message: bytesToHex(msg),
    signature: bytesToHex(sig),
    a: a ? bytesToHex(a) : null,
    z: zb ? bytesToHex(zb) : null,
    zDecimal: zU !== null ? zU.toString() : null,
    zTopBit: zTop,
    challengeInput: challengeInput ? bytesToHex(challengeInput) : null,
    e: e ? bytesToHex(e) : null,
    eDecimal: eU !== null ? eU.toString() : null,
    eTopBit: eTop,
    lhs: compressOrNull(lhs),
    rhs: compressOrNull(rhs),
    equationHolds: holds,
    contractView: {
      zSigned: zS !== null ? zS.toString() : null,
      eSigned: eS !== null ? eS.toString() : null,
      lhs: compressOrNull(lhsC),
      rhs: compressOrNull(rhsC),
      holds: holdsC,
      note:
        zTop || eTop
          ? "A top bit is set, so byteArrayToBigInt yields a negative number; the interpreter's equation differs from the plain one and the redemption fails on-chain."
          : "Both top bits are clear: the contract sees exactly the same z and e.",
    },
    checks,
    failed: failedCheck,
  };
}

function safeBytes(v: Uint8Array | Hex): Uint8Array | null {
  try {
    return toBytes(v);
  } catch {
    return null;
  }
}

// ---------- the contract's own view ----------

/** An ErgoScript evaluation exception (the transaction is invalid, not merely `false`). */
export class ContractThrow extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractThrow";
  }
}

/** ErgoScript `decodePoint`: 33 bytes; a leading 0x00 encodes the identity point; anything else must be on the curve. */
export function contractDecodePoint(bytes: Uint8Array): CurvePoint {
  if (bytes.length !== 33) throw new ContractThrow(`decodePoint: expected 33 bytes, got ${bytes.length}`);
  if (bytes[0] === 0x00) return Point.ZERO;
  try {
    return Point.fromHex(bytes);
  } catch {
    throw new ContractThrow("decodePoint: bytes are not a valid secp256k1 point");
  }
}

const BIGINT_MIN = -(1n << 255n);
const BIGINT_MAX = (1n << 255n) - 1n;

/**
 * ErgoScript `byteArrayToBigInt` = `new java.math.BigInteger(bytes).to256BitValueExact`: signed two's
 * complement of ANY non-empty length, accepted while bitLength ≤ 255, i.e. the value lies in
 * [−2^255, 2^255 − 1]. Longer encodings are fine when they are sign-extended (00‖x, ff‖x, …), so the
 * contract accepts e.g. a 66-byte signature a ‖ 00 ‖ z that the tracker's 65-byte rule rejects.
 */
export function contractBigInt(bytes: Uint8Array): bigint {
  if (bytes.length === 0) throw new ContractThrow("byteArrayToBigInt: zero-length array (BigInteger throws)");
  const v = bytesToSignedBig(bytes);
  if (v < BIGINT_MIN || v > BIGINT_MAX) throw new ContractThrow("byteArrayToBigInt: BigInteger out of 256 bit range (bitLength > 255)");
  return v;
}

/**
 * Exactly the contract's expression:
 *   a = decodePoint(sig.slice(0,33)); z = byteArrayToBigInt(sig.slice(33, size))
 *   e = byteArrayToBigInt(blake2b256(sig.slice(0,33) ++ message ++ pk.getEncoded))
 *   g.exp(z) == a.multiply(pk.exp(e))          (exp of a negative scalar is taken mod n)
 * Returns the boolean; throws ContractThrow where the interpreter would throw.
 */
export function contractSignatureHolds(pub: Uint8Array | Hex, message: Uint8Array | Hex, signature: Uint8Array | Hex): boolean {
  const pk = toBytes(pub);
  const msg = toBytes(message);
  const sig = toBytes(signature);
  const aBytes = sig.slice(0, 33);
  const zBytes = sig.slice(33);
  const A = contractDecodePoint(aBytes);
  const z = contractBigInt(zBytes);
  const X = contractDecodePoint(pk);
  const e = contractBigInt(blake2b256(aBytes, msg, pk));
  const lhs = mulG(z);
  const rhs = A.add(mulP(X, e));
  return lhs.equals(rhs);
}

/** Splits a signature into its parts (no validation). */
export function splitSignature(signature: Uint8Array | Hex): { a: Hex; z: Hex } {
  const s = toBytes(signature);
  return { a: bytesToHex(s.subarray(0, 33)), z: bytesToHex(s.subarray(33)) };
}
