// Ergo Schnorr test vectors TV001–TV004, copied as data from BetterMoneyLabs/basis-tracker
// specs/SCHNORR_SIGNATURE_SPEC.md (CC0). The self-test panel and the viz tests run them through the engine's
// `verify` (the tracker's rules, which coincide with what the reserve contract can execute).
import type { VerifyFailure } from "@/protocol";

export interface SchnorrVector {
  id: "TV001" | "TV002" | "TV003" | "TV004";
  title: { en: string; ru: string };
  issuerPub: string;
  recipientPub: string;
  amount: bigint;
  timestampMs: bigint;
  message: string;
  signature: string;
  expected: boolean;
  /** The rule that must reject it (invalid vectors). */
  expectedFailure?: VerifyFailure;
}

const ISSUER = "02fc84de78d191f6b47b6ba97bf1eb5ba3b541c8ca247461f41dafdd6db11bc063";
const RECIPIENT = "023bc6f9ff8a2af3992d23c145de5a868bae6b80a3dd3b24a1de4c6486472e9dbd";
const MSG_TV001 = "76a4d85b3cac6917e0f0565ebcdc2fbf7656662ca97ef40b9ed1db70c211851f000000003b9aca0000000195e97f78004242424242424242424242424242424242424242424242424242424242424242";

export const SCHNORR_VECTORS: readonly SchnorrVector[] = [
  {
    id: "TV001",
    title: { en: "Standard valid signature", ru: "Обычная верная подпись" },
    issuerPub: ISSUER,
    recipientPub: RECIPIENT,
    amount: 1000000000n,
    timestampMs: 1743379200000n,
    message: MSG_TV001,
    signature: "027742dac59ea73f7f8710648f17b9fb8ccf570460a727c02b28a6e2f310ebf4711397afdac9e6cc799beedc3309ef2b4989598768f65ea78b95151c844e86408f",
    expected: true,
  },
  {
    id: "TV002",
    title: { en: "All-zero signature", ru: "Подпись из одних нулей" },
    issuerPub: ISSUER,
    recipientPub: RECIPIENT,
    amount: 1000000000n,
    timestampMs: 1743379200000n,
    message: MSG_TV001,
    signature: "00".repeat(65),
    expected: false,
  },
  {
    id: "TV003",
    title: { en: "Challenge with its top bit set", ru: "Вызов с установленным старшим битом" },
    issuerPub: "02b651a75c3cec621fa493dfa45fbb42ff77943acdceeb9543163d76e3d81cb645",
    recipientPub: RECIPIENT,
    amount: 500000000n,
    timestampMs: 1743379201000n,
    message: "52eb0beb0bd0e86206e0a817785aadabbef08730fd5654ea65ebcbe1ef1b3b9e000000001dcd650000000195e97f7be84242424242424242424242424242424242424242424242424242424242424242",
    signature: "02d052ebc2a622f61681dc9ad52a8cd062acc4c6acf9ba6cfdd507ae886b8054701319d7378338904e89be9604c16825a06fd831afa598248e3f3902be9d270c39",
    expected: false,
    expectedFailure: "e-top-bit",
  },
  {
    id: "TV004",
    title: { en: "Signed by another key", ru: "Подписано другим ключом" },
    issuerPub: ISSUER,
    recipientPub: RECIPIENT,
    amount: 1000000000n,
    timestampMs: 1743379200000n,
    message: MSG_TV001,
    signature: "0240d01f20717b244800f147d2c9b559cd836c19aea344071c1639be2a22870e772bdbbaf89bb715fcc8c4ec7d8df464fb196c83a9616ef0ccd392f5ae8022d072",
    expected: false,
  },
];
