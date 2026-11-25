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
import { bigToBytes, bytesToHex, hexToBytes, u64be } from "../../protocol/bytes";
import type { AvlBackend } from "../../protocol/avl";
import { debtKey, reserveKey, reserveTreeValue } from "../../protocol/note";
import { keyPairFromSecret, type KeyPair } from "../../protocol/keys";
import { EMPTY_AVL_DIGEST_HEX, basisAvlRegister, encodeCollByte, encodeLong } from "../../protocol/registers";
import { p2pkAddress } from "./address";
import { FEE_TREE_HEX, RESERVE_TREE_HEX, TRACKER_NFT, p2pkTree } from "./constants";
import { jsonString as q } from "./json";
import { noteMessage, signBasis } from "./messages";
import { REGISTER_NAMES, type BoxCandidate, type ErgoBox, type ExtensionEntry, type Hex, type Token, type UnsignedTx } from "./model";
import type { ChainBoxes, RedemptionExpectation } from "./redemption";
import { bytesToSign, computeBoxId, computeTxId, nodeExtensionOrder, outputBoxes, serializeBox } from "./serialize";
import { proveDlog } from "./provedlog";
import { TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX } from "./tokens";
import type { Denomination } from "./messages";

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
  /** R8, R9 on the reserve input (the tracker's output drops them). */
  reserveExtra?: Hex[];
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
    registers: [`07${issuer.pubHex}`, basisAvlRegister("11".repeat(33)), `0e20${nft}`, "0500", ...(o.reserveExtra ?? [])],
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

/** The verify review's grief (wallet-t3 P2-1): a reserve of `owner` with R7 = 0 and an R8 Coll[Byte] padding the box to
 *  exactly `size` bytes (MaxBoxSize by default), as anyone's top-up may leave it. */
export function paddedReserveBox(owner: Hex, value: bigint, size = 4096): ErgoBox {
  const vlq = (n: number) => { let h = ""; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; h += b.toString(16).padStart(2, "0"); } while (n); return h; };
  for (let n = 0; n < size; n++) {
    const b = reserveBox(owner, value, { extra: [`0e${vlq(n)}${"00".repeat(n)}`] });
    if (serializeBox(b).length === size) return b;
  }
  throw new Error(`no padding makes the box ${size} bytes`);
}

/** A reserve box of `owner` under the pinned contract and our tracker, with a real id (top-up and refund tests). */
export function reserveBox(owner: Hex, value: bigint, opts: { nft?: Hex; r5?: Hex; r6?: Hex; /** null: no R7 */ r7?: bigint | null; /** R8, R9 after R7 */ extra?: Hex[]; tree?: Hex; creationHeight?: number; tokens?: Token[]; transactionId?: Hex } = {}): ErgoBox {
  const body = {
    value,
    ergoTree: opts.tree ?? RESERVE_TREE_HEX,
    creationHeight: opts.creationHeight ?? 1_922_314,
    tokens: opts.tokens ?? [{ tokenId: opts.nft ?? "a7".repeat(32), amount: 1n }],
    registers: [`07${owner}`, opts.r5 ?? basisAvlRegister(EMPTY_AVL_DIGEST_HEX), opts.r6 ?? `0e20${TRACKER_NFT}`, ...(opts.r7 === null ? [] : [encodeLong(opts.r7 ?? 0n), ...(opts.extra ?? [])])],
    transactionId: opts.transactionId ?? "d4".repeat(32),
    index: 0,
  };
  return { ...body, boxId: computeBoxId(body) };
}

// ─── a synthetic token redemption ───────────────────────────────────────────────────────────────

export interface SyntheticTokenOptions extends Omit<SyntheticOptions, "reserveValue" | "fee"> {
  tokenId: Hex;
  /** Raw token units in the reserve before. Default 2 000. */
  reserveTokens?: bigint;
  /** nanoERG of the tracker's fee boxes. Default [5 000 000]. */
  feeBoxes?: bigint[];
  /** The key the fee boxes sit at (default the tracker's): the proof-reuse attack puts the recipient's here. */
  feeKeySecret?: bigint;
  fee?: bigint;
  /**
   * A real AVL+ backend (loadContractAvl): the trees and proofs are then real, made the way the tracker makes them
   * (basis_store generate_*_proof): the tracker tree holds the pair's debt key → totalDebt and #8 is its lookup proof;
   * the reserve tree holds `prior` (and `others`), #7 is its lookup proof when `prior` is given, #5 an insertOrUpdate
   * proof of ts ‖ (prior + amount) and output R5 the digest after it. `first` then follows `prior`.
   */
  avl?: AvlBackend;
  /** With `avl`: what the reserve tree already holds for this pair (a later redemption). */
  prior?: { timestamp: bigint; redeemed: bigint };
  /** With `avl`: other receivers' entries in the reserve tree and other pairs' debts in the tracker tree. Default 2. */
  others?: number;
  /**
   * With `avl`: the denomination under which the tracker tree holds this pair's debt, and the key #8 proves (default
   * the reserve's token). "erg" or another token id: a tracker answering with the wrong debt (L2 must refuse it).
   */
  trackerHolds?: "erg" | Hex;
}

/**
 * A token redemption build in the tracker's layout (redemption_build.rs, fee_paid_by "tracker"): inputs [token reserve,
 * fee boxes], outputs [reserve (ERG kept, token less the amount), recipient (0.001 ERG + tokens), fee, change], the fee
 * inputs proved by the fee key in partial_tx. It passes L1. With `avl` its trees and AVL proofs are real and it passes
 * L2 too (tokenredemption.l2.test.ts); without `avl` the proofs are placeholders and L2 refuses it.
 */
export function syntheticTokenRedemption(o: SyntheticTokenOptions) {
  const issuer = keyPairFromSecret(o.issuerSecret ?? 2n);
  const recipient = keyPairFromSecret(o.recipientSecret ?? 3n);
  const tracker = keyPairFromSecret(o.trackerSecret ?? 5n);
  const feeKey = keyPairFromSecret(o.feeKeySecret ?? o.trackerSecret ?? 5n);
  const nft = o.trackerNft ?? "5a".repeat(32);
  const denomination: Denomination = `token:${o.tokenId}`;
  const reserveTokens = o.reserveTokens ?? 2_000n;
  const amount = o.amount ?? 300n;
  const fee = o.fee ?? 1_000_000n;
  const totalDebt = o.totalDebt ?? 1_000n;
  const timestamp = o.timestamp ?? 1_795_357_991_710n;
  const first = o.avl ? !o.prior : o.first ?? true;
  const height = o.height ?? 1_922_400;
  const real = o.avl ? realTokenTrees(o.avl, issuer.pubHex, recipient.pubHex, o.tokenId, totalDebt, timestamp, amount, o.prior ?? null, o.others ?? 2, o.trackerHolds ?? o.tokenId) : null;
  const reserveBody = {
    value: TOKEN_RESERVE_BOX_NANOERG,
    ergoTree: TOKEN_RESERVE_TREE_HEX,
    creationHeight: height - 30,
    tokens: [{ tokenId: "ab".repeat(32), amount: 1n }, { tokenId: o.tokenId, amount: reserveTokens }],
    registers: [`07${issuer.pubHex}`, basisAvlRegister(real?.reserveBefore ?? "11".repeat(33)), `0e20${nft}`, "0500", ...(o.reserveExtra ?? [])],
    transactionId: "c1".repeat(32),
    index: 0,
  };
  const reserve: ErgoBox = { ...reserveBody, boxId: computeBoxId(reserveBody) };
  const trackerBody = { value: 1_000_000n, ergoTree: p2pkTree(tracker.pubHex), creationHeight: height - 5, tokens: [{ tokenId: nft, amount: 1n }], registers: [`07${tracker.pubHex}`, basisAvlRegister(real?.tracker ?? "22".repeat(33)), `0e20${nft}`], transactionId: "d2".repeat(32), index: 0 };
  const trackerBox: ErgoBox = { ...trackerBody, boxId: computeBoxId(trackerBody) };
  const feeBoxes: ErgoBox[] = (o.feeBoxes ?? [5_000_000n]).map((value, i) => {
    const body = { value, ergoTree: p2pkTree(feeKey.pubHex), creationHeight: height - 50, tokens: [], registers: [], transactionId: "e4".repeat(32), index: i };
    return { ...body, boxId: computeBoxId(body) };
  });
  const message = noteMessage({ issuer: issuer.pubHex, recipient: recipient.pubHex, totalDebt, timestamp, trackerNft: nft, denomination });
  const secret32 = (k: KeyPair) => secretBytes(k.secret);
  const issuerSig = bytesToHex(signBasis(message, secret32(issuer), issuer.pubHex));
  const trackerSig = bytesToHex(signBasis(message, secret32(tracker), tracker.pubHex));
  const entries: ExtensionEntry[] = [
    { key: 0, value: "0200" },
    { key: 1, value: `07${recipient.pubHex}` },
    { key: 2, value: encodeCollByte(issuerSig) },
    { key: 3, value: encodeLong(totalDebt) },
    { key: 4, value: encodeLong(timestamp) },
    { key: 5, value: encodeCollByte(real?.insertProof ?? "05".repeat(40)) },
    { key: 6, value: encodeCollByte(trackerSig) },
    ...(first ? [] : [{ key: 7, value: encodeCollByte(real?.lookupProof ?? "07".repeat(40)) }]),
    { key: 8, value: encodeCollByte(real?.trackerProof ?? "08".repeat(40)) },
  ];
  const feeTotal = feeBoxes.reduce((a, b) => a + b.value, 0n);
  const change = feeTotal - fee - 1_000_000n;
  const outputs: BoxCandidate[] = [
    { value: reserve.value, ergoTree: TOKEN_RESERVE_TREE_HEX, creationHeight: height, tokens: [{ ...reserve.tokens[0] }, { tokenId: o.tokenId, amount: reserveTokens - amount }], registers: [reserve.registers[0], basisAvlRegister(real?.reserveAfter ?? "33".repeat(33)), reserve.registers[2], reserve.registers[3]] },
    { value: 1_000_000n, ergoTree: p2pkTree(recipient.pubHex), creationHeight: height, tokens: [{ tokenId: o.tokenId, amount }], registers: [] },
    { value: fee, ergoTree: FEE_TREE_HEX, creationHeight: height, tokens: [], registers: [] },
    ...(change > 0n ? [{ value: change, ergoTree: p2pkTree(tracker.pubHex), creationHeight: height, tokens: [], registers: [] }] : []),
  ];
  const unsigned: UnsignedTx = { inputs: [{ boxId: reserve.boxId, extension: nodeExtensionOrder(entries) }, ...feeBoxes.map((b) => ({ boxId: b.boxId, extension: [] }))], dataInputs: [trackerBox.boxId], outputs };
  const toSign = bytesToSign(unsigned);
  const proofs = ["", ...feeBoxes.map(() => bytesToHex(proveDlog(toSign, secret32(feeKey))))];
  const parts: BuildParts = {
    unsigned,
    partialJson: ergoLibTxJson(unsigned, { proofs }),
    inputs: [reserve, ...feeBoxes],
    dataInputs: [trackerBox],
    summary: {
      reserveBoxId: reserve.boxId, trackerBoxId: trackerBox.boxId, reserveOutputValue: reserve.value, recipientOutputValue: 1_000_000n, totalDebt,
      changeAmount: change > 0n ? change : 0n, changeAddress: p2pkAddress(tracker.pubHex), recipientAddress: p2pkAddress(recipient.pubHex), isFirstRedemption: first,
      fee, newAlreadyRedeemed: (o.avl ? o.prior?.redeemed ?? 0n : 0n) + amount, feePaidBy: "tracker",
    },
  };
  return {
    text: trackerBuildResponse(parts),
    parts,
    chain: { inputs: [reserve, ...feeBoxes], dataInputs: [trackerBox] } as ChainBoxes,
    expect: { issuer: issuer.pubHex, recipient: recipient.pubHex, amount, totalDebt, timestamp, issuerSignature: issuerSig, trackerNft: nft, trackerPk: tracker.pubHex, tipHeight: height, denomination } as RedemptionExpectation,
    issuer, recipient, tracker, proofs,
  };
}

/**
 * The trees of a token redemption as the tracker keeps them (basis_store lib.rs): the tracker tree keyed by
 * blake2b256(owner ‖ receiver ‖ token id) → totalDebt (8 bytes), the reserve tree keyed by blake2b256(owner ‖
 * receiver) → timestamp ‖ redeemed (16 bytes, denomination-free keys: only which tree is namespaced). #5 is an
 * InsertOrUpdate proof for both first and later redemptions, as generate_reserve_insert_proof makes it; the contract
 * runs it as insert (no #7) or insertOrUpdate (#7), and the prover's bytes are the same for both.
 */
function realTokenTrees(avl: AvlBackend, owner: Hex, receiver: Hex, tokenId: Hex, totalDebt: bigint, timestamp: bigint, amount: bigint, prior: { timestamp: bigint; redeemed: bigint } | null, others: number, holds: "erg" | Hex) {
  const trackerTree = avl.createMap(32);
  const reserveTree = avl.createMap(32);
  const tokenBytes = hexToBytes(tokenId);
  for (let i = 0; i < others; i++) {
    const other = keyPairFromSecret(100n + BigInt(i)).pubHex;
    trackerTree.insert(debtKey(owner, other, tokenBytes), u64be(1_000n + BigInt(i)));
    trackerTree.insert(debtKey(owner, other, null), u64be(7_000_000n + BigInt(i)));
    reserveTree.insert(reserveKey(owner, other), reserveTreeValue(timestamp - 1_000n - BigInt(i), 10n + BigInt(i)));
  }
  const dKey = debtKey(owner, receiver, holds === "erg" ? null : hexToBytes(holds));
  trackerTree.insert(dKey, u64be(totalDebt));
  const rKey = reserveKey(owner, receiver);
  if (prior) reserveTree.insert(rKey, reserveTreeValue(prior.timestamp, prior.redeemed));
  const before = reserveTree.digest();
  const lookupProof = prior ? bytesToHex(reserveTree.proofFor(rKey)) : null;
  const ins = reserveTree.prove([{ op: "insertOrUpdate", key: rKey, value: reserveTreeValue(timestamp, (prior?.redeemed ?? 0n) + amount) }]);
  if (bytesToHex(ins.digestBefore) !== bytesToHex(before)) throw new Error("the insert proof does not start at the reserve's digest");
  return {
    tracker: bytesToHex(trackerTree.digest()),
    trackerProof: bytesToHex(trackerTree.proofFor(dKey)),
    reserveBefore: bytesToHex(before),
    lookupProof,
    insertProof: bytesToHex(ins.proof),
    reserveAfter: bytesToHex(ins.digestAfter),
  };
}
