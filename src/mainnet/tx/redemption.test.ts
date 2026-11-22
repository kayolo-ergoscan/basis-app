// Redemption: the stored note, L1 on R3 (positive, and one mutation per rule), the splice of the chain's own proof
// (which must rebuild R3 byte for byte), signing with a synthetic key, the submit body and the build request.
import { sha256 } from "@noble/hashes/sha256";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes, utf8 } from "../../protocol/bytes";
import { encodeLong } from "../../protocol/registers";
import { p2pkAddress } from "./address";
import { p2pkTree, FEE_TREE_HEX, SUBMIT_BODY_MAX_BYTES } from "./constants";
import { ISSUER_A, R2, R3, RECEIVER_B, T1, TEXT } from "./fixtures/chain";
import { R3_AMOUNT, r3BuildText, r3Chain, r3Expect, r3Parts } from "./fixtures/r3-build";
import { asString, asU64, at, JsonSyntaxError, parseJson, rawText, utf8Length } from "./json";
import { verifyBasis } from "./messages";
import { nodeTxFromJson, type ExtensionEntry } from "./model";
import { verifyDlog } from "./provedlog";
import {
  checkNoteForRedemption, checkRedemption, envelopeData, parseBuildResponse, parseStoredNote, parseSubmitResponse, redemptionSubmitBody, signedBuildRequest,
  signRedemption, spliceRedemptionProof, TrackerRefusal, type ChainBoxes, type L1Rule, type RedemptionExpectation,
} from "./redemption";
import { computeBoxId, nodeExtensionOrder, serializeBox, serializeSignedTx } from "./serialize";
import { ergoLibTxJson, secretBytes, syntheticRedemption, trackerBuildResponse, trackerRefusal, type BuildParts } from "./testkit";

const G = "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const G2 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";

function l1Of(parts: BuildParts = r3Parts(), chain: ChainBoxes = r3Chain(), expect: RedemptionExpectation = r3Expect()) {
  return checkRedemption(parseBuildResponse(trackerBuildResponse(parts)), chain, expect);
}

function setExt(p: BuildParts, f: (e: ExtensionEntry[]) => ExtensionEntry[]) {
  p.unsigned.inputs[0].extension = f(p.unsigned.inputs[0].extension);
}

function extValue(p: BuildParts, key: number): string {
  return p.unsigned.inputs[0].extension.find((e) => e.key === key)!.value;
}

function setVar(p: BuildParts, key: number, value: string) {
  setExt(p, (e) => e.map((x) => (x.key === key ? { key, value } : x)));
}

describe("the stored note (step 1)", () => {
  const note = parseStoredNote(TEXT.frontNote);

  it("reads the front's answer exactly", () => {
    expect(note).toMatchObject({ issuer: ISSUER_A, recipient: RECEIVER_B, amountCollected: 600_000_000n, amountRedeemed: 450_000_000n, timestamp: 1_795_357_991_710n, denomination: "erg" });
    expect(note.confirmation).toMatchObject({ status: "confirmed", confirmedTotalDebt: 600_000_000n, redeemable: true, redeemableAmount: 150_000_000n, confirmedHeight: 1922364 });
  });

  it("passes for an amount up to what is redeemable, with the issuer's signature checked locally", () => {
    const r = checkNoteForRedemption(note, { issuer: ISSUER_A, recipient: RECEIVER_B, amount: R3_AMOUNT });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.expect).toMatchObject({ totalDebt: 600_000_000n, timestamp: 1_795_357_991_710n, issuerSignature: note.signature, amount: R3_AMOUNT });
    expect(checkNoteForRedemption(note, { issuer: ISSUER_A, recipient: RECEIVER_B, amount: 150_000_000n }).ok).toBe(true);
  });

  it.each<[string, (n: typeof note) => typeof note, bigint, string]>([
    ["above redeemable", (n) => n, 150_000_001n, "note-redeemable"],
    ["zero", (n) => n, 0n, "note-redeemable"],
    ["not committed", (n) => ({ ...n, confirmation: { ...n.confirmation!, confirmedTotalDebt: 500_000_000n } }), 1n, "note-committed"],
    ["no confirmation", (n) => ({ ...n, confirmation: null }), 1n, "note-committed"],
    ["a token note", (n) => ({ ...n, denomination: `token:${"7c".repeat(32)}` }), 1n, "note-denomination"],
    ["another tracker", (n) => ({ ...n, trackerNft: "5a".repeat(32) }), 1n, "note-tracker"],
    ["another pair", (n) => ({ ...n, recipient: G }), 1n, "note-pair"],
    ["a signature over another total", (n) => ({ ...n, amountCollected: 600_000_001n, confirmation: { ...n.confirmation!, confirmedTotalDebt: 600_000_001n } }), 1n, "note-signature"],
  ])("refuses %s", (_name, mutate, amount, rule) => {
    const r = checkNoteForRedemption(mutate(note), { issuer: ISSUER_A, recipient: RECEIVER_B, amount });
    expect(r.ok ? "ok" : r.rule).toBe(rule);
  });
});

describe("L1 on R3 (rebuilt from the chain)", () => {
  it("passes, names the chain's transaction and boxes, and the chain's proof covers exactly our bytes", () => {
    const l1 = l1Of();
    if (!l1.ok) throw new Error(`${l1.rule}: ${l1.message}`);
    expect(l1.txId).toBe(R3.v1.id);
    expect(l1.payout).toBe(99_000_000n);
    expect(l1.fee).toBe(1_000_000n);
    expect(l1.reserveNft).toBe(R3.v1.inputs[0].tokens[0].tokenId);
    expect(l1.reserveAfter.boxId).toBe(R3.v1.outputs[0].boxId);
    expect(l1.payoutBox.boxId).toBe("4a85d415de9ae7dc29af761566aa8ba495ba32b006161292fb026b071b4d88a1");
    expect(verifyDlog(hexToBytes(RECEIVER_B), l1.bytesToSign, hexToBytes(R3.v1.inputs[0].proof))).toBe(true);
  });

  it("splicing the chain's proof into partial_tx gives R3 byte for byte", () => {
    const l1 = l1Of();
    if (!l1.ok) throw new Error(l1.message);
    const signed = spliceRedemptionProof(l1, hexToBytes(R3.v1.inputs[0].proof));
    const back = nodeTxFromJson(parseJson(signed.signedRaw));
    expect(bytesToHex(serializeSignedTx(back))).toBe(bytesToHex(serializeSignedTx(R3.signed)));
    expect(serializeSignedTx(back).length).toBe(R3.v1.size);
    // Only the proof slot changed.
    const raw = l1.build.partialRaw;
    const at0 = raw.indexOf('"proofBytes":""') + '"proofBytes":"'.length;
    expect(signed.signedRaw).toBe(raw.slice(0, at0) + R3.v1.inputs[0].proof + raw.slice(at0));
    // A proof of another transaction, or of the right one under another key, is refused.
    expect(() => spliceRedemptionProof(l1, hexToBytes(R2.v1.inputs[0].proof))).toThrow();
    expect(() => spliceRedemptionProof(l1, hexToBytes(T1.v1.inputs[0].proof))).toThrow();
  });

  it("the submit body echoes unsigned_tx byte for byte and stays under the front's cap", () => {
    const l1 = l1Of();
    if (!l1.ok) throw new Error(l1.message);
    const signed = spliceRedemptionProof(l1, hexToBytes(R3.v1.inputs[0].proof));
    const body = redemptionSubmitBody(l1, signed);
    const o = parseJson(body);
    expect(rawText(body, at(o, "unsigned_tx")!)).toBe(l1.build.unsignedRaw);
    expect(rawText(body, at(o, "signed_tx")!)).toBe(signed.signedRaw);
    expect(bytesToHex(sha256(utf8(rawText(body, at(o, "unsigned_tx")!))))).toBe(bytesToHex(sha256(utf8(l1.build.unsignedRaw))));
    expect(asString(at(o, "issuer_pubkey"), "i")).toBe(ISSUER_A);
    expect(asString(at(o, "recipient_pubkey"), "r")).toBe(RECEIVER_B);
    expect(asU64(at(o, "redeemed_amount"), "a")).toBe(R3_AMOUNT);
    expect(asU64(at(o, "new_already_redeemed"), "n")).toBe(450_000_000n);
    expect(utf8Length(body)).toBeLessThan(SUBMIT_BODY_MAX_BYTES);
    expect(() => JSON.parse(body)).not.toThrow();
    expect(() => redemptionSubmitBody(l1, { ...signed, txId: "00".repeat(32) })).toThrow();
  });

  const reserveIn = r3Chain().inputs[0];
  const MUTATIONS: Array<[string, L1Rule, (p: BuildParts, x: RedemptionExpectation, c: ChainBoxes) => void]> = [
    ["the tracker pays the fee", "fee-paid-by", (p) => (p.summary.feePaidBy = "tracker")],
    ["a 2 M fee with a 98 M payout", "fee-limit", (p) => {
      p.summary.fee = 2_000_000n;
      p.summary.recipientOutputValue = 98_000_000n;
      p.unsigned.outputs[1].value = 98_000_000n;
      p.unsigned.outputs[2].value = 2_000_000n;
    }],
    ["the build reports the full amount as payout", "payout", (p) => (p.summary.recipientOutputValue = R3_AMOUNT)],
    ["the build reports change", "payout", (p) => (p.summary.changeAmount = 5n)],
    ["another amount than the build's", "payout", (_p, x) => (x.amount = 90_000_000n)],
    ["the build reports another payout address", "payout", (p) => (p.summary.recipientAddress = p2pkAddress(ISSUER_A))],
    ["the chain copy of the reserve does not hash to its id", "box-ids", (_p, _x, c) => (c.inputs[0] = { ...c.inputs[0], value: c.inputs[0].value + 1n })],
    ["the transaction reads another data box", "box-ids", (p) => (p.unsigned.dataInputs = ["00".repeat(32)])],
    ["the tracker's binary is another box", "box-binaries", (p) => (p.inputBinaries = [bytesToHex(serializeBox({ ...reserveIn, index: 1 }))])],
    ["the tracker key is the recipient", "tracker-key", (_p, x) => (x.trackerPk = RECEIVER_B)],
    ["the tracker box was replaced meanwhile", "tracker-box", (_p, x) => (x.currentTrackerBoxId = "00".repeat(32))],
    ["the tracker box holds another key", "tracker-box", (_p, x) => (x.trackerPk = G)],
    ["a second input", "reserve-input", (p, _x, c) => {
      const extra = T1.v1.inputs[0];
      p.unsigned.inputs.push({ boxId: extra.boxId, extension: [] });
      p.inputs.push(extra);
      c.inputs.push(extra);
    }],
    ["the reserve sits under another script", "reserve-input", (p, _x, c) => {
      const { boxId: _drop, ...body } = { ...reserveIn, ergoTree: FEE_TREE_HEX };
      const moved = { ...body, boxId: computeBoxId(body) };
      p.unsigned.inputs[0].boxId = moved.boxId;
      p.inputs[0] = moved;
      c.inputs[0] = moved;
      p.summary.reserveBoxId = moved.boxId;
    }],
    ["another issuer", "reserve-input", (_p, x) => (x.issuer = G)],
    ["the extension in ascending order", "extension-order", (p) => setExt(p, (e) => [...e].sort((a, b) => a.key - b.key))],
    ["partial_tx lists another order", "extension-order", (p) => {
      p.partialJson = ergoLibTxJson({ ...p.unsigned, inputs: [{ ...p.unsigned.inputs[0], extension: [...p.unsigned.inputs[0].extension].sort((a, b) => a.key - b.key) }] });
    }],
    ["#7 on a first redemption", "extension-keys", (p) => (p.summary.isFirstRedemption = true)],
    ["no #7 on a later redemption", "extension-keys", (p) => setExt(p, (e) => nodeExtensionOrder(e.filter((x) => x.key !== 7)))],
    ["#0 redeems into output 1", "extension-values", (p) => setVar(p, 0, "0201")],
    ["#1 is the issuer", "extension-values", (p) => setVar(p, 1, `07${ISSUER_A}`)],
    ["#2 is not the stored note's signature", "extension-values", (p, x) => (x.issuerSignature = extValue(p, 6).slice(4))],
    ["#3 is not the committed total", "extension-values", (_p, x) => (x.totalDebt = 500_000_000n)],
    ["#3 and total_debt above the note", "extension-values", (p) => {
      p.summary.totalDebt = 700_000_000n;
      setVar(p, 3, encodeLong(700_000_000n));
    }],
    ["#4 is not the note timestamp", "extension-values", (_p, x) => (x.timestamp = x.timestamp + 1n)],
    ["#5 is not a Coll[Byte]", "extension-values", (p) => setVar(p, 5, "0580989abc04")],
    ["#6 replaced by #2", "tracker-signature", (p) => setVar(p, 6, extValue(p, 2))],
    ["a fourth output", "outputs", (p) => p.unsigned.outputs.push({ value: 1_000_000n, ergoTree: p2pkTree(ISSUER_A), creationHeight: p.unsigned.outputs[0].creationHeight, tokens: [], registers: [] })],
    ["the reserve keeps too much", "reserve-output", (p) => (p.unsigned.outputs[0].value = 560_000_000n)],
    ["the reserve output goes elsewhere", "reserve-output", (p) => (p.unsigned.outputs[0].ergoTree = p2pkTree(ISSUER_A))],
    ["the reserve output drops R7", "reserve-output", (p) => (p.unsigned.outputs[0].registers = p.unsigned.outputs[0].registers.slice(0, 3))],
    ["the reserve output starts a refund", "reserve-output", (p) => (p.unsigned.outputs[0].registers[3] = encodeLong(5n))],
    ["the reserve output R5 is not a tree", "reserve-output", (p) => (p.unsigned.outputs[0].registers[1] = "0500")],
    ["the payout goes to the issuer", "payout-output", (p) => (p.unsigned.outputs[1].ergoTree = p2pkTree(ISSUER_A))],
    ["the payout is the full amount", "payout-output", (p) => (p.unsigned.outputs[1].value = R3_AMOUNT)],
    ["the payout carries a register", "payout-output", (p) => (p.unsigned.outputs[1].registers = ["0500"])],
    ["the fee output is larger than the fee", "fee-output", (p) => (p.unsigned.outputs[2].value = 2_000_000n)],
    ["outputs created below the input", "creation-height", (p) => p.unsigned.outputs.forEach((o) => (o.creationHeight = reserveIn.creationHeight - 1))],
    ["outputs created far from the tip", "creation-height", (_p, x) => (x.tipHeight = R3.v1.inclusionHeight! + 100)],
    ["partial_tx names another id", "ids", (p) => (p.partialJson = ergoLibTxJson(p.unsigned, { id: "00".repeat(32) }))],
    ["partial_tx already holds a proof", "ids", (p) => (p.partialJson = ergoLibTxJson(p.unsigned, { proofs: [R3.v1.inputs[0].proof] }))],
    ["partial_tx is another transaction", "ids", (p) => {
      p.partialJson = ergoLibTxJson({ ...p.unsigned, outputs: p.unsigned.outputs.map((o, i) => (i === 0 ? { ...o, creationHeight: o.creationHeight + 1 } : o)) });
    }],
    ["partial_tx names another output box", "ids", (p) => (p.partialJson = ergoLibTxJson(p.unsigned, { boxIds: ["00".repeat(32)] }))],
  ];

  it.each(MUTATIONS)("refuses: %s (%s)", (_name, rule, mutate) => {
    const parts = r3Parts();
    const x = r3Expect();
    const chain = r3Chain();
    mutate(parts, x, chain);
    const l1 = checkRedemption(parseBuildResponse(trackerBuildResponse(parts)), chain, x);
    expect(l1.ok ? "ok" : `${l1.rule}: ${l1.message}`).toMatch(new RegExp(`^${rule}: `));
  });

  it("every L1 rule but `totals` has a mutation that fails it alone (totals is implied by the output rules here)", () => {
    const covered = new Set(MUTATIONS.map((m) => m[1]));
    const all: L1Rule[] = ["fee-paid-by", "fee-limit", "payout", "box-ids", "box-binaries", "tracker-key", "tracker-box", "reserve-input", "extension-order", "extension-keys", "extension-values", "tracker-signature", "outputs", "reserve-output", "payout-output", "fee-output", "creation-height", "ids"];
    for (const r of all) expect(covered.has(r)).toBe(true);
  });

  it("refuses broken answers before any check", () => {
    expect(() => parseBuildResponse(trackerRefusal("the build expired"))).toThrow(TrackerRefusal);
    expect(() => parseBuildResponse(r3BuildText().replace('"fee":1000000,', '"fee":1000000,"fee":1,'))).toThrow(JsonSyntaxError);
    expect(() => parseBuildResponse(r3BuildText().replace('"fee":1000000,', '"fee":"1e6",'))).toThrow();
    expect(() => parseBuildResponse(r3BuildText().replace('"partial_tx":', '"partial":'))).toThrow();
    try {
      envelopeData(trackerRefusal("x".repeat(400)));
    } catch (e) {
      expect(e).toBeInstanceOf(TrackerRefusal);
      expect((e as TrackerRefusal).reason.length).toBe(300);
    }
  });
});

describe("signing a redemption (synthetic keys)", () => {
  for (const first of [true, false]) {
    it(`${first ? "first" : "later"} redemption: L1 passes, the receiver key proves it, only the slot changes`, () => {
      const s = syntheticRedemption({ first });
      const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, s.expect);
      if (!l1.ok) throw new Error(`${l1.rule}: ${l1.message}`);
      const a = signRedemption(l1, secretBytes(s.recipient.secret));
      const b = signRedemption(l1, secretBytes(s.recipient.secret));
      expect(a.txId).toBe(l1.txId);
      expect(b.txId).toBe(l1.txId);
      expect(a.proof).not.toBe(b.proof); // hedged nonces
      expect(verifyDlog(s.recipient.pub, l1.bytesToSign, hexToBytes(a.proof))).toBe(true);
      expect(a.signedRaw.replace(a.proof, "")).toBe(l1.build.partialRaw);
      const body = redemptionSubmitBody(l1, a);
      expect(utf8Length(body)).toBeLessThan(SUBMIT_BODY_MAX_BYTES);
      expect(() => signRedemption(l1, secretBytes(s.issuer.secret))).toThrow(/recipient/);
      expect(() => signRedemption(l1, secretBytes(s.tracker.secret))).toThrow(/recipient/);
    });
  }

  it("a failed check cannot be signed", () => {
    const s = syntheticRedemption();
    const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, { ...s.expect, amount: 1n });
    expect(l1.ok).toBe(false);
    expect(() => signRedemption(l1 as never, secretBytes(s.recipient.secret))).toThrow();
  });
});

describe("the build request and the submit answer", () => {
  it("signs the basis_core worked example and writes the canary's body", () => {
    const sig65 = "ab".repeat(65);
    const r = signedBuildRequest(secretBytes(2n), { issuer: G, recipient: G2, amount: 500_000_000n, issuerSignature: sig65, requestTimestamp: 1_795_305_660_000n, trackerNft: "5a".repeat(32) });
    expect(bytesToHex(r.message)).toBe("62617369732d6275696c642d7631" + "5a".repeat(32) + G + G2 + "657267" + "000000001dcd6500" + "000001a2008e5e60");
    expect(verifyBasis(G2, r.message, r.signature)).toBe(true);
    expect(r.body).toBe(
      `{"issuer_pubkey":"${G}","recipient_pubkey":"${G2}","amount":500000000,"issuer_signature":"${sig65}","emergency":false,` +
        `"denomination":"erg","request_timestamp":1795305660000,"receiver_signature":"${r.signature}"}`,
    );
    expect(() => signedBuildRequest(secretBytes(3n), { issuer: G, recipient: G2, amount: 1n, issuerSignature: sig65, requestTimestamp: 1n })).toThrow();
    expect(() => signedBuildRequest(secretBytes(2n), { issuer: G, recipient: G2, amount: 0n, issuerSignature: sig65, requestTimestamp: 1n })).toThrow();
    expect(() => signedBuildRequest(secretBytes(2n), { issuer: G, recipient: G2, amount: 1n, issuerSignature: "ab", requestTimestamp: 1n })).toThrow();
  });

  it("reads the submit answer", () => {
    expect(parseSubmitResponse(`{"success":true,"data":{"tx_id":"${R3.v1.id}"},"error":null}`).txId).toBe(R3.v1.id);
    expect(() => parseSubmitResponse(trackerRefusal("Unknown, expired or already-used unsigned_tx"))).toThrow(TrackerRefusal);
  });
});
