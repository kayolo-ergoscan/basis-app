// ProveDlog against mainnet: the on-chain proofs of T1 (owner input), R1–R3 (receiver on the reserve input) and the
// tracker's fee inputs of R1–R2 verify over our bytesToSign; our own proofs verify and tampering breaks them.
import { describe, expect, it } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bigToBytes, blake2b256, bytesToHex, concatBytes, hexToBytes } from "../../protocol/bytes";
import { keyPairFromSecret } from "../../protocol/keys";
import { p2pkKeyOfTree } from "./constants";
import { ALL, ISSUER_A, R1, R2, R3, RECEIVER_B, T1 } from "./fixtures/chain";
import { PROOF_BYTES, proveDlog, provedlogChallenge, publicKeyOf, verifyDlog } from "./provedlog";
import { bytesToSign } from "./serialize";

describe("on-chain proofs verify", () => {
  it("T1: every input is the owner's P2PK and its proof verifies", () => {
    const msg = bytesToSign(T1.unsigned);
    for (const inp of T1.v1.inputs) {
      expect(p2pkKeyOfTree(inp.ergoTree)).toBe(ISSUER_A);
      expect(verifyDlog(hexToBytes(ISSUER_A), msg, hexToBytes(inp.proof))).toBe(true);
    }
  });

  for (const t of [R1, R2, R3]) {
    it(`${t.name}: the receiver's proof of the reserve input verifies`, () => {
      const proof = hexToBytes(t.v1.inputs[0].proof);
      expect(proof.length).toBe(PROOF_BYTES);
      expect(verifyDlog(hexToBytes(RECEIVER_B), bytesToSign(t.unsigned), proof)).toBe(true);
    });
  }

  it("R1, R2: the tracker's fee inputs verify under the key of their P2PK tree", () => {
    for (const t of [R1, R2]) {
      expect(t.v1.inputs.length).toBe(2);
      const pk = p2pkKeyOfTree(t.v1.inputs[1].ergoTree)!;
      expect(verifyDlog(hexToBytes(pk), bytesToSign(t.unsigned), hexToBytes(t.v1.inputs[1].proof))).toBe(true);
    }
  });

  it("a proof is bound to its bytes and its key", () => {
    const proof = hexToBytes(R3.v1.inputs[0].proof);
    const msg = bytesToSign(R3.unsigned);
    expect(verifyDlog(hexToBytes(ISSUER_A), msg, proof)).toBe(false);
    expect(verifyDlog(hexToBytes(RECEIVER_B), bytesToSign(R2.unsigned), proof)).toBe(false);
    const other = msg.slice();
    other[other.length - 1] ^= 1;
    expect(verifyDlog(hexToBytes(RECEIVER_B), other, proof)).toBe(false);
    for (const i of [0, 23, 24, 55]) {
      const p = proof.slice();
      p[i] ^= 0x01;
      expect(verifyDlog(hexToBytes(RECEIVER_B), msg, p)).toBe(false);
    }
  });

  it("refuses malformed input without throwing", () => {
    const msg = bytesToSign(R3.unsigned);
    const proof = hexToBytes(R3.v1.inputs[0].proof);
    expect(verifyDlog(hexToBytes(RECEIVER_B), msg, proof.subarray(0, 55))).toBe(false);
    expect(verifyDlog(hexToBytes(RECEIVER_B), msg, new Uint8Array(56))).toBe(false);
    expect(verifyDlog(hexToBytes(`04${RECEIVER_B.slice(2)}`), msg, proof)).toBe(false);
    expect(verifyDlog(hexToBytes(`02${"00".repeat(32)}`), msg, proof)).toBe(false); // not on the curve
    expect(verifyDlog(new Uint8Array(32), msg, proof)).toBe(false);
  });
});

describe("our proofs", () => {
  const secret = bigToBytes(0x1234567890abcdefn, 32);
  const pk = keyPairFromSecret(0x1234567890abcdefn).pub;
  const msg = bytesToSign(R3.unsigned);

  it("derive the same public key as the protocol engine", () => {
    expect(bytesToHex(publicKeyOf(secret))).toBe(bytesToHex(pk));
  });

  it("verify, are 56 bytes, and are hedged (same entropy → same proof, other entropy → other proof)", () => {
    const e1 = new Uint8Array(32).fill(1);
    const e2 = new Uint8Array(32).fill(2);
    const p1 = proveDlog(msg, secret, { entropy: e1 });
    expect(p1.length).toBe(56);
    expect(verifyDlog(pk, msg, p1)).toBe(true);
    expect(bytesToHex(proveDlog(msg, secret, { entropy: e1 }))).toBe(bytesToHex(p1));
    const p2 = proveDlog(msg, secret, { entropy: e2 });
    expect(bytesToHex(p2)).not.toBe(bytesToHex(p1));
    expect(verifyDlog(pk, msg, p2)).toBe(true);
    const p3 = proveDlog(msg, secret); // fresh randomness
    expect(verifyDlog(pk, msg, p3)).toBe(true);
    expect(bytesToHex(p3)).not.toBe(bytesToHex(p1));
  });

  it("sign every fixture's bytes", () => {
    for (const t of ALL) expect(verifyDlog(pk, bytesToSign(t.unsigned), proveDlog(bytesToSign(t.unsigned), secret))).toBe(true);
  });

  it("refuse bad secrets", () => {
    expect(() => proveDlog(msg, new Uint8Array(31))).toThrow();
    expect(() => proveDlog(msg, new Uint8Array(32))).toThrow();
    expect(() => proveDlog(msg, new Uint8Array(32).fill(0xff))).toThrow(); // ≥ n
    expect(() => proveDlog(msg, secret, { entropy: new Uint8Array(16) })).toThrow();
  });

  it("the challenge is the Fiat–Shamir hash of the one-leaf tree (design Appendix A)", () => {
    const proof = hexToBytes(R3.v1.inputs[0].proof);
    const c = proof.subarray(0, 24);
    const z = BigInt(`0x${bytesToHex(proof.subarray(24))}`);
    const P = secp256k1.ProjectivePoint;
    const a = P.BASE.multiply(z).subtract(P.fromHex(RECEIVER_B).multiply(BigInt(`0x${bytesToHex(c)}`))).toRawBytes(true);
    const preimage = concatBytes(hexToBytes("010027100108cd"), hexToBytes(RECEIVER_B), hexToBytes("73000021"), a, msg);
    expect(bytesToHex(blake2b256(preimage).subarray(0, 24))).toBe(bytesToHex(c));
    expect(bytesToHex(provedlogChallenge(hexToBytes(RECEIVER_B), a, msg))).toBe(bytesToHex(c));
  });
});
