import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "./bytes";
import { demoKeyPair, keyPairFromSecret } from "./keys";
import { debtKey, messageLayout, noteMessage, parseNoteMessage, reserveKey, tokenDenomination } from "./note";
import { contractSignatureHolds, explain, sign, signWithTrace, verify } from "./schnorr";

// Vectors from specs/SCHNORR_SIGNATURE_SPEC.md and crates/basis_store/src/schnorr_test_vectors.rs
// (BetterMoneyLabs/basis-tracker @ 43e2173). All use tracker NFT id 0x42 × 32.
const NFT = "42".repeat(32);
const A = "02fc84de78d191f6b47b6ba97bf1eb5ba3b541c8ca247461f41dafdd6db11bc063";
const B = "023bc6f9ff8a2af3992d23c145de5a868bae6b80a3dd3b24a1de4c6486472e9dbd";
const MSG1 = "76a4d85b3cac6917e0f0565ebcdc2fbf7656662ca97ef40b9ed1db70c211851f000000003b9aca0000000195e97f78004242424242424242424242424242424242424242424242424242424242424242";

interface Vector {
  id: string;
  pub: string;
  msg: string;
  sig: string;
  valid: boolean;
  reason?: string;
}

const VECTORS: Vector[] = [
  { id: "TV001", pub: A, msg: MSG1, sig: "027742dac59ea73f7f8710648f17b9fb8ccf570460a727c02b28a6e2f310ebf4711397afdac9e6cc799beedc3309ef2b4989598768f65ea78b95151c844e86408f", valid: true },
  { id: "TV002", pub: A, msg: MSG1, sig: "00".repeat(65), valid: false },
  {
    id: "TV003",
    pub: "02b651a75c3cec621fa493dfa45fbb42ff77943acdceeb9543163d76e3d81cb645",
    msg: "52eb0beb0bd0e86206e0a817785aadabbef08730fd5654ea65ebcbe1ef1b3b9e000000001dcd650000000195e97f7be84242424242424242424242424242424242424242424242424242424242424242",
    sig: "02d052ebc2a622f61681dc9ad52a8cd062acc4c6acf9ba6cfdd507ae886b8054701319d7378338904e89be9604c16825a06fd831afa598248e3f3902be9d270c39",
    valid: false,
    reason: "e-top-bit",
  },
  { id: "TV004", pub: A, msg: MSG1, sig: "0240d01f20717b244800f147d2c9b559cd836c19aea344071c1639be2a22870e772bdbbaf89bb715fcc8c4ec7d8df464fb196c83a9616ef0ccd392f5ae8022d072", valid: false },
  { id: "TV005", pub: A, msg: MSG1, sig: "036eb16f1611ae82edfd2ca30251e6fbbb3eae03173eb16e270e53ce7f755342a16d86d89db441bb8905f86110f3e615ffaf3ceb9d7b1992c0d14d0e3cbf7f3931", valid: false },
  { id: "TV006", pub: A, msg: MSG1, sig: "028c3d344aefd0caa6a16ffdab0bd154b457585cd998e5ac80b86286a796f33f1e53488afbc8e3160caab535bac018b81bd62acea9b64c2a426d08727d42193720", valid: false },
  { id: "TV007", pub: A, msg: MSG1, sig: "03baecb66840002c131c54134b0abde112a0405f3d6d1d384b5815857ee68b9e624ba6d7c176c8631633c7e609af34f9e389f99c6e3fd64e16aa743956d66e1e11", valid: false },
  { id: "TV008", pub: A, msg: MSG1, sig: "0282fcc89cb99e3491bb43d1797ff2567fde0620ea38d78f937ae122ae0acf2f897169bcb397037aeb94eda8ee6e5642781f8fe1d85f33bc6a8ed5a440760fd029", valid: false },
  {
    id: "TV009",
    pub: A,
    msg: "76a4d85b3cac6917e0f0565ebcdc2fbf7656662ca97ef40b9ed1db70c211851fffffffffffffffffffffffffffffffff4242424242424242424242424242424242424242424242424242424242424242",
    sig: "03917db7e61b54d50409c0447ebd27caa124d2702aa0ae5651381cd662162307c8055e54abdd0ba40be01c695edf95b9026c94f286a3353f63d1e2348e5d455c2f",
    valid: false,
    reason: "e-top-bit",
  },
  {
    id: "TV010",
    pub: A,
    msg: "76a4d85b3cac6917e0f0565ebcdc2fbf7656662ca97ef40b9ed1db70c211851f000000000000000000000000000000004242424242424242424242424242424242424242424242424242424242424242",
    sig: "0235f9989903d1e2ee8c274ba5494119b6deef7cd0d0e15dc07190011b524c891d5deec9c943adce1891dc5977cda361da0a81e81bbf489b3a7f6b8d2c15116ad4",
    valid: true,
  },
  {
    id: "TV011",
    pub: A,
    msg: "76a4d85b3cac6917e0f0565ebcdc2fbf7656662ca97ef40b9ed1db70c211851f000000001dcd650000000195e97f7fd04242424242424242424242424242424242424242424242424242424242424242",
    sig: "02001d67f568ace3b32c68bd9cfdd3795d5df0f5057b4d837935578697675c8e334668c7b923ae13df8dd9725ac66c63a4ca6f05cc2e7d1c3d23abdcb750dea923",
    valid: true,
  },
  {
    id: "TV012",
    pub: A,
    msg: "967d7eb07055cb7ab02e6a8956d3e3213715a945050d236d983972bad5c60565000000003b9aca0000000195e97f78004242424242424242424242424242424242424242424242424242424242424242",
    sig: "03f0f0df97d7c1cc78cd9f3fa98c944bcc32c04c4827d3ac0488d9b19cc30549783023efc493827d880225ebabda4553cbdd7c1e872891e6ddfc9f7713efe76971",
    valid: true,
  },
];

describe("Schnorr test vectors (spec + Rust)", () => {
  for (const v of VECTORS) {
    it(`${v.id} → ${v.valid}`, () => {
      const r = verify(v.pub, v.msg, v.sig);
      expect(r.ok).toBe(v.valid);
      if (v.reason) expect(r.reason).toBe(v.reason);
      // the contract's own expression agrees with the tracker verifier on every vector
      let contract: boolean;
      try {
        contract = contractSignatureHolds(v.pub, v.msg, v.sig);
      } catch {
        contract = false;
      }
      expect(contract).toBe(v.valid);
    });
  }

  it("TV003 and TV009 satisfy the plain equation but fail the contract's signed reading", () => {
    for (const id of ["TV003", "TV009"]) {
      const v = VECTORS.find((x) => x.id === id)!;
      const x = explain(v.pub, v.msg, v.sig);
      expect(x.eTopBit).toBe(true);
      expect(x.equationHolds).toBe(true);
      expect(x.contractView.holds).toBe(false);
      expect(x.ok).toBe(false);
      expect(x.failed).toBe("e-top-bit");
    }
    const tv003 = explain(VECTORS[2].pub, VECTORS[2].msg, VECTORS[2].sig);
    expect(tv003.e).toBe("dabdc82a6add16a23e6124ccea24b8e77013909cdc06821245f7a4e5c8a0d8da");
  });

  it("explain() exposes the intermediate values of a valid signature", () => {
    const v = VECTORS[0];
    const x = explain(v.pub, v.msg, v.sig);
    expect(x.ok).toBe(true);
    expect(x.a).toBe(v.sig.slice(0, 66));
    expect(x.z).toBe(v.sig.slice(66));
    expect(x.lhs).toBe(x.rhs);
    expect(x.contractView.holds).toBe(true);
    expect(x.challengeInput!.length).toBe((33 + 80 + 33) * 2);
    expect(x.checks.every((c) => c.ok === true)).toBe(true);
  });

  it("explain() names the first failed check", () => {
    const x = explain(A, MSG1, "00".repeat(65));
    expect(x.ok).toBe(false);
    expect(x.failed).toBe("a-prefix");
    const short = explain(A, MSG1, "02".repeat(10));
    expect(short.failed).toBe("length");
  });
});

describe("note message construction", () => {
  it("MSG1 = key(A,B) ‖ 1 ERG ‖ ts ‖ NFT", () => {
    const m = noteMessage(debtKey(A, B), 1_000_000_000n, 1_743_379_200_000n, NFT);
    expect(bytesToHex(m)).toBe(MSG1);
    const p = parseNoteMessage(m);
    expect(p.totalDebt).toBe(1_000_000_000n);
    expect(p.timestamp).toBe(1_743_379_200_000n);
    expect(messageLayout(m).map((s) => s.length)).toEqual([32, 8, 8, 32]);
  });

  it("spec example: key, debt and timestamp encodings", () => {
    const owner = "0377709166937fcdc08bf7e841b31684e2377f489914c97ef7148de14d9c6e1f83";
    const receiver = "03af13e39dd0ccc7429f9dfa5a056b71a8f5160eaf179763a03e0b55d8feec2cea";
    expect(bytesToHex(debtKey(owner, receiver))).toBe("6995ccf33c8a09705612e6ee3808bb4cedb48cb7b7c019ecdc68b74e7ed912a4");
    const m = noteMessage(debtKey(owner, receiver), 50_000_000n, 1_743_379_200_000n, NFT);
    expect(bytesToHex(m.subarray(32, 40))).toBe("0000000002faf080");
    expect(bytesToHex(m.subarray(40, 48))).toBe("00000195e97f7800");
  });

  it("TV009 message: u64::MAX amount and timestamp", () => {
    const m = noteMessage(debtKey(A, B), (1n << 64n) - 1n, (1n << 64n) - 1n, NFT);
    expect(bytesToHex(m)).toBe(VECTORS[8].msg);
  });

  it("TV012: token denomination key differs from the ERG key; reserve key stays unsuffixed", () => {
    const use = tokenDenomination("a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669", "USE", 3);
    const m = noteMessage(debtKey(A, B, use.id), 1_000_000_000n, 1_743_379_200_000n, NFT);
    expect(bytesToHex(m)).toBe(VECTORS[11].msg);
    expect(bytesToHex(m)).not.toBe(MSG1);
    expect(bytesToHex(reserveKey(A, B))).toBe(bytesToHex(debtKey(A, B)));
  });

  it("Rust redemption vector (impls.rs): issuer and tracker signatures over the same message", () => {
    const owner = "0377709166937fcdc08bf7e841b31684e2377f489914c97ef7148de14d9c6e1f83";
    const receiver = "03af13e39dd0ccc7429f9dfa5a056b71a8f5160eaf179763a03e0b55d8feec2cea";
    const nft = "07".repeat(32);
    const m = noteMessage(debtKey(owner, receiver), 200_000_000n, 1_785_019_966_273n, nft);
    const issuerSig = "03fc7cfadcebc74723abadb74a84259911be52a1692a99dee43991913540cc3e360940916c9cc92b89bcdacd7a393b3bef0708799554f700fa1313a7cea2e5314f";
    const trackerSig = "02cb34354b024e2a58b5c558ad74eb25fdd5774ee70804d1fa75b075c30acc81db1fe4d1a822e89aacdce5c0766ae5fe89cbd6ff55b82533494f748d7be87bc099";
    const trackerPub = "024e564477ff457c601c01ad1cc31903f8b27b7d5e515bd03138891d8152d787b2";
    expect(verify(owner, m, issuerSig).ok).toBe(true);
    expect(verify(trackerPub, m, trackerSig).ok).toBe(true);
    expect(contractSignatureHolds(trackerPub, m, trackerSig)).toBe(true);
  });
});

describe("signing", () => {
  it("signatures verify, respect both top-bit rules and are deterministic", () => {
    const kp = demoKeyPair("alice");
    for (let i = 0; i < 40; i++) {
      const m = noteMessage(debtKey(kp.pub, demoKeyPair("bob").pub), BigInt(i * 1000 + 1), 1_767_225_600_000n + BigInt(i), NFT);
      const s1 = sign(m, kp);
      const s2 = sign(m, kp);
      expect(bytesToHex(s1)).toBe(bytesToHex(s2));
      expect(s1.length).toBe(65);
      expect(s1[33] < 0x80).toBe(true);
      expect(verify(kp.pub, m, s1).ok).toBe(true);
      expect(contractSignatureHolds(kp.pub, m, s1)).toBe(true);
    }
  });

  it("random nonces also produce valid signatures", () => {
    const kp = keyPairFromSecret(12345678901234567890n);
    const m = hexToBytes(MSG1);
    const s = sign(m, kp, { nonce: "random" });
    expect(verify(kp.pub, m, s).ok).toBe(true);
  });

  it("signWithTrace records rejected candidates", () => {
    const kp = demoKeyPair("carol");
    let sawRejection = false;
    for (let i = 0; i < 12 && !sawRejection; i++) {
      const m = noteMessage(debtKey(kp.pub, demoKeyPair("dave").pub), BigInt(i + 1), 1n, NFT);
      const t = signWithTrace(m, kp);
      expect(t.attempts[t.attempts.length - 1].accepted).toBe(true);
      if (t.attempts.length > 1) {
        sawRejection = true;
        expect(t.attempts.some((a) => a.rejectedBy === "e-top-bit" || a.rejectedBy === "z-top-bit")).toBe(true);
      }
    }
    expect(sawRejection).toBe(true);
  });

  it("verify rejects a tampered message and a wrong key", () => {
    const kp = demoKeyPair("erin");
    const m = noteMessage(debtKey(kp.pub, demoKeyPair("frank").pub), 5n, 6n, NFT);
    const s = sign(m, kp);
    const m2 = m.slice();
    m2[40] ^= 1;
    const bad = verify(kp.pub, m2, s);
    expect(bad.ok).toBe(false);
    expect(["equation", "e-top-bit"]).toContain(bad.reason);
    expect(verify(demoKeyPair("frank").pub, m, s).ok).toBe(false);
  });
});
