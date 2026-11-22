// ProveDlog: the Sigma proof that spends a box guarded by (or reducing to) proveDlog(pk), as design §3.5 gives it.
// Checked against the mainnet proofs of T1 (owner input), R1–R3 (receiver on the reserve input) and the tracker's fee
// inputs of R1–R2 in provedlog.test.ts.
//
//   a = g^r                          (33 bytes compressed)
//   c = blake2b256( 01 0027 10 01 08 cd ‖ pk ‖ 73 00 ‖ 0021 ‖ a ‖ message )[0..24]
//       (the Fiat–Shamir tree of one leaf: the leaf's proposition as the ErgoTree 100108cd‖pk‖7300, then its commitment)
//   z = r + c·sk  (mod n)
//   proof = c (24 bytes) ‖ z (32 bytes) = 56 bytes
//   verify: a' = g^z · pk^(−c), then c' from a' must equal c
//
// The message is the transaction's bytesToSign. The proof does not depend on the script: it is valid wherever the
// input reduces to proveDlog(pk).
//
// Nonces are hedged: r = HMAC-SHA256(sk, "ergo-provedlog-v1" ‖ message ‖ 32 random bytes) mod n. The same key also
// makes Basis Schnorr signatures (notes, build requests) with deterministic nonces of another domain, so the two nonce
// spaces never meet (a nonce reused across the two would reveal the key).
//
// noble 1.7.0: `multiplyUnsafe` is wrong on windowed points (see protocol/schnorr.ts), so only `multiply` is used.
import { secp256k1 } from "@noble/curves/secp256k1";
import { sha256 } from "@noble/hashes/sha256";
import { bigToBytes, blake2b256, bytesToBig, concatBytes, equalBytes, hexToBytes, utf8 } from "../../protocol/bytes";

const Point = secp256k1.ProjectivePoint;
type CurvePoint = InstanceType<typeof Point>;
const N = secp256k1.CURVE.n;
const G = Point.BASE;

export const PROOF_BYTES = 56;
export const CHALLENGE_BYTES = 24;
const FS_PREFIX = hexToBytes("010027100108cd");
const FS_POSTFIX = hexToBytes("73000021");
const NONCE_TAG = utf8("ergo-provedlog-v1");

/**
 * HMAC-SHA256 (RFC 2104) on noble's sha256. Not `@noble/hashes/hmac`: that module is in the first load's graph (the
 * shell's curve code imports it), so using it here would put its code in the first load; this stays in the wallet's
 * lazy chunk. Checked against RFC 4231 and noble's hmac in provedlog.test.ts.
 */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const block = new Uint8Array(64);
  block.set(key.length > 64 ? sha256(key) : key);
  const inner = sha256.create();
  const outer = sha256.create();
  for (let i = 0; i < 64; i++) block[i] ^= 0x36;
  inner.update(block);
  for (let i = 0; i < 64; i++) block[i] ^= 0x36 ^ 0x5c;
  outer.update(block);
  block.fill(0);
  const ih = inner.update(message).digest();
  const out = outer.update(ih).digest();
  ih.fill(0);
  return out;
}

/** The challenge c for key `pk` and commitment `a` (both 33 bytes) over `message`. */
export function provedlogChallenge(pk: Uint8Array, a: Uint8Array, message: Uint8Array): Uint8Array {
  return blake2b256(FS_PREFIX, pk, FS_POSTFIX, a, message).subarray(0, CHALLENGE_BYTES);
}

function mul(P: CurvePoint, k: bigint): CurvePoint {
  const r = ((k % N) + N) % N;
  return r === 0n ? Point.ZERO : P.multiply(r);
}

/** Compressed encoding; the identity is 33 zero bytes, as sigmastate's GroupElementSerializer writes it. */
function encode(P: CurvePoint): Uint8Array {
  return P.equals(Point.ZERO) ? new Uint8Array(33) : P.toRawBytes(true);
}

function secretScalar(secret: Uint8Array): bigint {
  if (secret.length !== 32) throw new Error("the secret key must be 32 bytes");
  const s = bytesToBig(secret);
  if (s <= 0n || s >= N) throw new Error("the secret key is not in [1, n − 1]");
  return s;
}

/** The compressed public key of a 32-byte secret. */
export function publicKeyOf(secret: Uint8Array): Uint8Array {
  return G.multiply(secretScalar(secret)).toRawBytes(true);
}

/** Verifies a 56-byte ProveDlog proof of `pk` over `message`. z is taken mod n, as the node does. */
export function verifyDlog(pk: Uint8Array, message: Uint8Array, proof: Uint8Array): boolean {
  if (proof.length !== PROOF_BYTES || pk.length !== 33 || (pk[0] !== 0x02 && pk[0] !== 0x03)) return false;
  let P: CurvePoint;
  try {
    P = Point.fromHex(pk);
  } catch {
    return false;
  }
  const c = proof.subarray(0, CHALLENGE_BYTES);
  const z = bytesToBig(proof.subarray(CHALLENGE_BYTES));
  const a = mul(G, z).subtract(mul(P, bytesToBig(c)));
  return equalBytes(provedlogChallenge(pk, encode(a), message), c);
}

export interface ProveOptions {
  /** 32 bytes mixed into the nonce instead of fresh randomness (tests only: same input → same proof). */
  entropy?: Uint8Array;
}

/**
 * Proves knowledge of `secret` over `message` (a transaction's bytesToSign). The proof is verified before it is
 * returned; a proof that does not verify throws instead.
 */
export function proveDlog(message: Uint8Array, secret: Uint8Array, opts: ProveOptions = {}): Uint8Array {
  const sk = secretScalar(secret);
  const pk = G.multiply(sk).toRawBytes(true);
  for (let attempt = 0; attempt < 4; attempt++) {
    const rnd = opts.entropy ?? secp256k1.utils.randomPrivateKey();
    if (rnd.length !== 32) throw new Error("entropy must be 32 bytes");
    const r = bytesToBig(hmacSha256(secret, concatBytes(NONCE_TAG, message, rnd))) % N;
    if (r === 0n) {
      if (opts.entropy) throw new Error("degenerate nonce");
      continue;
    }
    const a = G.multiply(r).toRawBytes(true);
    const c = provedlogChallenge(pk, a, message);
    const z = (r + bytesToBig(c) * sk) % N;
    const proof = concatBytes(c, bigToBytes(z, 32));
    if (!verifyDlog(pk, message, proof)) throw new Error("the proof does not verify (refusing to return it)");
    return proof;
  }
  throw new Error("could not draw a nonce");
}
