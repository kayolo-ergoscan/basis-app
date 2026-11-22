// Mainnet fixtures for the tests (not imported by the app). Fetched once, GET only, from the ErgoScan API contour
// (127.0.0.1:4401 /v1) and our tracker's front (127.0.0.1:3050), saved byte for byte:
//   t1.tx.json   /v1/transactions/5b88633e…f518  T1: the reserve creation (block 1 922 314)
//   r1.tx.json   /v1/transactions/72a41040…4f8e  R1: first redemption, 8-entry extension, old layout (fee input)
//   r2.tx.json   /v1/transactions/cb4b9f3b…01ad  R2: second redemption, 9 entries, old layout
//   r3.tx.json   /v1/transactions/e7c18808…a520  R3: round 4, the fee from the payout, the reserve the only input
//   r3.reserve-in.box.json  /v1/boxes/b05b94a2…11b1  the reserve R3 spends
//   r3.tracker.box.json     /v1/boxes/7ced33b2…3560  the tracker box R3 reads
//   front.config-reserve-contract-p2s.json  GET /config/reserve-contract-p2s
//   front.note-r3-pair.json                 GET /notes/issuer/0233…1207/recipient/0214…7cd8 (after R3)
//   extensions.json  the reserve input's context extension of R1–R3 in serialization order (/v1 has none): the
//                    canary logs of the submitted runs, cross-checked with the node's indexer.
import { asArray, asHex, asObject, asSafeInt, parseJson, required } from "../json";
import { boxFromV1, txFromV1, type BoxCandidate, type ErgoBox, type ExtensionEntry, type Hex, type SignedTx, type UnsignedTx, type V1Transaction } from "../model";
import { unsignedOf } from "../serialize";
import extensionsText from "./extensions.json?raw";
import frontP2sText from "./front.config-reserve-contract-p2s.json?raw";
import frontNoteText from "./front.note-r3-pair.json?raw";
import r1Text from "./r1.tx.json?raw";
import r2Text from "./r2.tx.json?raw";
import r3ReserveText from "./r3.reserve-in.box.json?raw";
import r3TrackerText from "./r3.tracker.box.json?raw";
import r3Text from "./r3.tx.json?raw";
import t1Text from "./t1.tx.json?raw";

export const TEXT = { t1: t1Text, r1: r1Text, r2: r2Text, r3: r3Text, r3ReserveIn: r3ReserveText, r3Tracker: r3TrackerText, frontP2s: frontP2sText, frontNote: frontNoteText, extensions: extensionsText };

export const ISSUER_A = "023316d27ad52bd767e5e97e2ecba3f0dbc2f92095875f918fcaa95ae6711b1207";
export const RECEIVER_B = "02148f7e4215d2545a5814f687cf759ced024aab71d90c7bf9c93fef3f9abc7cd8";

export interface Extension {
  txId: Hex;
  inclusionHeight: number;
  input0BoxId: Hex;
  entries: ExtensionEntry[];
}

function readExtensions(): Record<"R1" | "R2" | "R3", Extension> {
  const root = asObject(parseJson(extensionsText), "extensions");
  const one = (name: "R1" | "R2" | "R3"): Extension => {
    const o = asObject(required(root, name, "extensions"), name);
    return {
      txId: asHex(required(o, "txId", name), `${name}.txId`, 32),
      inclusionHeight: asSafeInt(required(o, "inclusionHeight", name), `${name}.inclusionHeight`),
      input0BoxId: asHex(required(o, "input0BoxId", name), `${name}.input0BoxId`, 32),
      entries: asArray(required(o, "extensionSerializationOrder", name), `${name}.extensionSerializationOrder`).items.map((n, i) => {
        const e = asObject(n, `${name}[${i}]`);
        return { key: asSafeInt(required(e, "key", `${name}[${i}]`), `${name}[${i}].key`, 127), value: asHex(required(e, "value", `${name}[${i}]`), `${name}[${i}].value`) };
      }),
    };
  };
  return { R1: one("R1"), R2: one("R2"), R3: one("R3") };
}

export const EXT = readExtensions();

export interface ChainTx {
  name: string;
  v1: V1Transaction;
  /** The /v1 transaction with the reserve extension restored (input 0 of R1–R3): what the block holds. */
  signed: SignedTx;
  unsigned: UnsignedTx;
}

export function candidateOf(b: BoxCandidate): BoxCandidate {
  return { value: b.value, ergoTree: b.ergoTree, creationHeight: b.creationHeight, tokens: b.tokens.map((t) => ({ ...t })), registers: [...b.registers] };
}

function chainTx(name: string, text: string, ext0: ExtensionEntry[] | null): ChainTx {
  const v1 = txFromV1(parseJson(text), name);
  const signed: SignedTx = {
    inputs: v1.inputs.map((b, i) => ({ boxId: b.boxId, proof: b.proof, extension: i === 0 && ext0 ? ext0.map((e) => ({ ...e })) : [] })),
    dataInputs: v1.dataInputs.map((b) => b.boxId),
    outputs: v1.outputs.map(candidateOf),
  };
  return { name, v1, signed, unsigned: unsignedOf(signed) };
}

export const T1 = chainTx("T1", t1Text, null);
export const R1 = chainTx("R1", r1Text, EXT.R1.entries);
export const R2 = chainTx("R2", r2Text, EXT.R2.entries);
export const R3 = chainTx("R3", r3Text, EXT.R3.entries);
export const ALL = [T1, R1, R2, R3];

export const R3_RESERVE_IN: ErgoBox = boxFromV1(parseJson(r3ReserveText), "r3.reserve-in");
export const R3_TRACKER: ErgoBox = boxFromV1(parseJson(r3TrackerText), "r3.tracker");
