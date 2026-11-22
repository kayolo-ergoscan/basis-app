// Test kit (not imported by the app): tracker answers rebuilt in the tracker's exact JSON shape, and a synthetic
// redemption with known keys, so the flows can be exercised without the network or a real key.
//
// Shapes (6113b8d):
//   • unsigned_tx — redemption_build.rs `json!` with serde_json preserve_order, compact:
//       {"inputs":[{"boxId","extension":{…Scala order}}],"dataInputs":[{"boxId"}],
//        "outputs":[{"value","ergoTree","creationHeight","assets":[{"tokenId","amount"}],"additionalRegisters":{…}}]}
//   • partial_tx — ergo-lib's Transaction JSON with ProofBytes::Empty:
//       {"id","inputs":[{"boxId","spendingProof":{"proofBytes":"","extension":{…}}}],"dataInputs":[{"boxId"}],
//        "outputs":[{"boxId","value","ergoTree","assets","creationHeight","additionalRegisters","transactionId","index"}]}
//   • the answer — {"success":true,"data":{RedemptionBuildResponse fields in struct order},"error":null}.
import { bigToBytes, bytesToHex } from "../../protocol/bytes";
import { keyPairFromSecret, type KeyPair } from "../../protocol/keys";
import { basisAvlRegister, encodeCollByte, encodeLong } from "../../protocol/registers";
import { p2pkAddress } from "./address";
import { FEE_TREE_HEX, RESERVE_TREE_HEX, p2pkTree } from "./constants";
import { jsonString as q } from "./json";
import { noteMessage, signBasis } from "./messages";
import { REGISTER_NAMES, type BoxCandidate, type ErgoBox, type ExtensionEntry, type Hex, type Token, type UnsignedTx } from "./model";
import type { ChainBoxes, RedemptionExpectation } from "./redemption";
import { computeBoxId, computeTxId, nodeExtensionOrder, outputBoxes, serializeBox } from "./serialize";

const assets = (tokens: readonly Token[]) => `[${tokens.map((t) => `{"tokenId":${q(t.tokenId)},"amount":${t.amount}}`).join(",")}]`;
const registers = (regs: readonly Hex[]) => `{${regs.map((r, i) => `${q(REGISTER_NAMES[i])}:${q(r)}`).join(",")}}`;
/** As listed (the tracker has already put it in Scala order). */
const extension = (ext: readonly ExtensionEntry[]) => `{${ext.map((e) => `${q(String(e.key))}:${q(e.value)}`).join(",")}}`;

/** `unsigned_tx` exactly as redemption_build.rs writes it. */
export function trackerUnsignedTxJson(tx: UnsignedTx): string {
  const inputs = tx.inputs.map((i) => `{"boxId":${q(i.boxId)},"extension":${extension(i.extension)}}`).join(",");
  const dataInputs = tx.dataInputs.map((d) => `{"boxId":${q(d)}}`).join(",");
  const outputs = tx.outputs
    .map((o) => `{"value":${o.value},"ergoTree":${q(o.ergoTree)},"creationHeight":${o.creationHeight},"assets":${assets(o.tokens)},"additionalRegisters":${registers(o.registers)}}`)
    .join(",");
  return `{"inputs":[${inputs}],"dataInputs":[${dataInputs}],"outputs":[${outputs}]}`;
}

export interface PartialOverrides {
  id?: Hex;
  proofs?: Hex[];
  boxIds?: Hex[];
}

/** `partial_tx` as ergo-lib serializes the transaction with empty proofs (or `proofs`). */
export function ergoLibTxJson(tx: UnsignedTx, o: PartialOverrides = {}): string {
  const id = o.id ?? computeTxId(tx);
  const boxes = outputBoxes(tx, computeTxId(tx));
  const inputs = tx.inputs.map((i, n) => `{"boxId":${q(i.boxId)},"spendingProof":{"proofBytes":${q(o.proofs?.[n] ?? "")},"extension":${extension(i.extension)}}}`).join(",");
  const dataInputs = tx.dataInputs.map((d) => `{"boxId":${q(d)}}`).join(",");
  const outputs = tx.outputs
    .map(
      (out, n) =>
        `{"boxId":${q(o.boxIds?.[n] ?? boxes[n].boxId)},"value":${out.value},"ergoTree":${q(out.ergoTree)},"assets":${assets(out.tokens)},` +
        `"creationHeight":${out.creationHeight},"additionalRegisters":${registers(out.registers)},"transactionId":${q(id)},"index":${n}}`,
    )
    .join(",");
  return `{"id":${q(id)},"inputs":[${inputs}],"dataInputs":[${dataInputs}],"outputs":[${outputs}]}`;
}

export interface BuildSummary {
  reserveBoxId: Hex;
  trackerBoxId: Hex;
  reserveOutputValue: bigint;
  recipientOutputValue: bigint;
  totalDebt: bigint;
  changeAmount: bigint;
  changeAddress: string;
  recipientAddress: string;
  isFirstRedemption: boolean;
  fee: bigint;
  newAlreadyRedeemed: bigint;
  feePaidBy: string;
}

export interface BuildParts {
  unsigned: UnsignedTx;
  /** Defaults to ergoLibTxJson(unsigned). */
  partialJson?: string;
  /** Defaults to trackerUnsignedTxJson(unsigned). */
  unsignedJson?: string;
  inputs: ErgoBox[];
  dataInputs: ErgoBox[];
  /** Hex binaries; default serializeBox of the boxes. */
  inputBinaries?: Hex[];
  dataBinaries?: Hex[];
  summary: BuildSummary;
}

/** A `POST /redemption/build` answer in the tracker's shape. */
export function trackerBuildResponse(p: BuildParts): string {
  const s = p.summary;
  const bins = (l: readonly Hex[]) => `[${l.map(q).join(",")}]`;
  const data =
    `{"unsigned_tx":${p.unsignedJson ?? trackerUnsignedTxJson(p.unsigned)},"partial_tx":${p.partialJson ?? ergoLibTxJson(p.unsigned)},` +
    `"input_box_binaries":${bins(p.inputBinaries ?? p.inputs.map((b) => bytesToHex(serializeBox(b))))},` +
    `"data_box_binaries":${bins(p.dataBinaries ?? p.dataInputs.map((b) => bytesToHex(serializeBox(b))))},"headers":[],` +
    `"reserve_box_id":${q(s.reserveBoxId)},"tracker_box_id":${q(s.trackerBoxId)},"reserve_output_value":${s.reserveOutputValue},` +
    `"recipient_output_value":${s.recipientOutputValue},"total_debt":${s.totalDebt},"change_amount":${s.changeAmount},` +
    `"change_address":${q(s.changeAddress)},"recipient_address":${q(s.recipientAddress)},"is_first_redemption":${s.isFirstRedemption},` +
    `"fee":${s.fee},"new_already_redeemed":${s.newAlreadyRedeemed},"fee_paid_by":${q(s.feePaidBy)}}`;
  return `{"success":true,"data":${data},"error":null}`;
}

/** A refusal in the tracker's envelope. */
export function trackerRefusal(error: string): string {
  return `{"success":false,"data":null,"error":${q(error)}}`;
}

// ─── a synthetic redemption with known keys ─────────────────────────────────────────────────────

export interface SyntheticRedemption {
  text: string;
  parts: BuildParts;
  chain: ChainBoxes;
  expect: RedemptionExpectation;
  issuer: KeyPair;
  recipient: KeyPair;
  tracker: KeyPair;
}

export interface SyntheticOptions {
  /** Default 2. */
  issuerSecret?: bigint;
  /** Default 3. */
  recipientSecret?: bigint;
  /** Default 5. */
  trackerSecret?: bigint;
  /** Default 0x5a × 32. */
  trackerNft?: Hex;
  reserveValue?: bigint;
  amount?: bigint;
  fee?: bigint;
  totalDebt?: bigint;
  timestamp?: bigint;
  /** Default true: keys {0…6, 8}; false adds #7. */
  first?: boolean;
  height?: number;
}

/**
 * A redemption build that passes L1 under `expect` (tracker key and NFT overridden), with every box id real. The AVL
 * proofs (#5, #7, #8) and the output tree are placeholders: L2 does not accept it.
 */
export function syntheticRedemption(o: SyntheticOptions = {}): SyntheticRedemption {
  const issuer = keyPairFromSecret(o.issuerSecret ?? 2n);
  const recipient = keyPairFromSecret(o.recipientSecret ?? 3n);
  const tracker = keyPairFromSecret(o.trackerSecret ?? 5n);
  const nft = o.trackerNft ?? "5a".repeat(32);
  const reserveValue = o.reserveValue ?? 650_000_000n;
  const amount = o.amount ?? 100_000_000n;
  const fee = o.fee ?? 1_000_000n;
  const totalDebt = o.totalDebt ?? 600_000_000n;
  const timestamp = o.timestamp ?? 1_795_357_991_710n;
  const first = o.first ?? true;
  const height = o.height ?? 1_922_400;

  const reserveBody = {
    value: reserveValue,
    ergoTree: RESERVE_TREE_HEX,
    creationHeight: height - 30,
    tokens: [{ tokenId: "ab".repeat(32), amount: 1n }],
    registers: [`07${issuer.pubHex}`, basisAvlRegister("11".repeat(33)), `0e20${nft}`, "0500"],
    transactionId: "c1".repeat(32),
    index: 0,
  };
  const reserve: ErgoBox = { ...reserveBody, boxId: computeBoxId(reserveBody) };
  const trackerBody = {
    value: 1_000_000n,
    ergoTree: p2pkTree(tracker.pubHex),
    creationHeight: height - 5,
    tokens: [{ tokenId: nft, amount: 1n }],
    registers: [`07${tracker.pubHex}`, basisAvlRegister("22".repeat(33)), `0e20${nft}`],
    transactionId: "d2".repeat(32),
    index: 0,
  };
  const trackerBox: ErgoBox = { ...trackerBody, boxId: computeBoxId(trackerBody) };

  const message = noteMessage({ issuer: issuer.pubHex, recipient: recipient.pubHex, totalDebt, timestamp, trackerNft: nft });
  const secret32 = (k: KeyPair) => secretBytes(k.secret);
  const issuerSig = bytesToHex(signBasis(message, secret32(issuer), issuer.pubHex));
  const trackerSig = bytesToHex(signBasis(message, secret32(tracker), tracker.pubHex));
  const entries: ExtensionEntry[] = [
    { key: 0, value: "0200" },
    { key: 1, value: `07${recipient.pubHex}` },
    { key: 2, value: encodeCollByte(issuerSig) },
    { key: 3, value: encodeLong(totalDebt) },
    { key: 4, value: encodeLong(timestamp) },
    { key: 5, value: encodeCollByte("05".repeat(40)) },
    { key: 6, value: encodeCollByte(trackerSig) },
    ...(first ? [] : [{ key: 7, value: encodeCollByte("07".repeat(40)) }]),
    { key: 8, value: encodeCollByte("08".repeat(40)) },
  ];
  const outputs: BoxCandidate[] = [
    { ...pick(reserve), value: reserveValue - amount, registers: [reserve.registers[0], basisAvlRegister("33".repeat(33)), reserve.registers[2], reserve.registers[3]], creationHeight: height },
    { value: amount - fee, ergoTree: p2pkTree(recipient.pubHex), creationHeight: height, tokens: [], registers: [] },
    { value: fee, ergoTree: FEE_TREE_HEX, creationHeight: height, tokens: [], registers: [] },
  ];
  const unsigned: UnsignedTx = { inputs: [{ boxId: reserve.boxId, extension: nodeExtensionOrder(entries) }], dataInputs: [trackerBox.boxId], outputs };
  const parts: BuildParts = {
    unsigned,
    inputs: [reserve],
    dataInputs: [trackerBox],
    summary: {
      reserveBoxId: reserve.boxId,
      trackerBoxId: trackerBox.boxId,
      reserveOutputValue: reserveValue - amount,
      recipientOutputValue: amount - fee,
      totalDebt,
      changeAmount: 0n,
      changeAddress: "",
      recipientAddress: p2pkAddress(recipient.pubHex),
      isFirstRedemption: first,
      fee,
      newAlreadyRedeemed: amount,
      feePaidBy: "recipient",
    },
  };
  return {
    text: trackerBuildResponse(parts),
    parts,
    chain: { inputs: [reserve], dataInputs: [trackerBox] },
    expect: { issuer: issuer.pubHex, recipient: recipient.pubHex, amount, totalDebt, timestamp, issuerSignature: issuerSig, trackerNft: nft, trackerPk: tracker.pubHex, tipHeight: height },
    issuer,
    recipient,
    tracker,
  };
}

function pick(b: ErgoBox): BoxCandidate {
  return { value: b.value, ergoTree: b.ergoTree, creationHeight: b.creationHeight, tokens: b.tokens.map((t) => ({ ...t })), registers: [...b.registers] };
}

/** A secret scalar as the 32 big-endian bytes the signers take. */
export function secretBytes(secret: bigint): Uint8Array {
  return bigToBytes(secret, 32);
}

/** A P2PK box of `owner` with a real id (for T1 / Withdraw tests). */
export function p2pkBox(owner: Hex, value: bigint, opts: { tokens?: Token[]; creationHeight?: number; transactionId?: Hex; index?: number } = {}): ErgoBox {
  const body = { value, ergoTree: p2pkTree(owner), creationHeight: opts.creationHeight ?? 1_922_000, tokens: opts.tokens ?? [], registers: [], transactionId: opts.transactionId ?? "e3".repeat(32), index: opts.index ?? 0 };
  return { ...body, boxId: computeBoxId(body) };
}
