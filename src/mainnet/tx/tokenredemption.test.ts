// Token redemption L1 (fee_paid_by "tracker"): the tracker's layout passes; every rule refuses its mutation; the fee
// inputs must be the tracker's own proved boxes (never the recipient's: its proof would spend them too); the splice
// touches only the reserve slot. The build request and the note check carry the denomination.
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { p2pkTree, TRACKER_NFT } from "./constants";
import { buildRequestMessage, noteMessage, signBasis, verifyBasis } from "./messages";
import { parseJson } from "./json";
import { nodeTxFromJson, type UnsignedTx } from "./model";
import { checkNoteForRedemption, checkRedemption, parseBuildResponse, signRedemption, signedBuildRequest, spliceRedemptionProof, type CheckedRedemption, type StoredNote } from "./redemption";
import { secretBytes, syntheticTokenRedemption, trackerBuildResponse, ergoLibTxJson } from "./testkit";
import { bytesToHex } from "../../protocol/bytes";
import { bytesToSign } from "./serialize";
import { proveDlog } from "./provedlog";
import { RSADA_TOKEN_ID, SIGUSD_TOKEN_ID, TOKEN_RESERVE_TREE_HEX } from "./tokens";

const SIG = `token:${SIGUSD_TOKEN_ID}` as const;
const base = () => syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID });

/** Rebuild the answer after a change to the unsigned transaction, the fee proofs signed again by `feeSecret`. */
function rebuilt(s: ReturnType<typeof base>, f: (t: UnsignedTx) => void, feeSecret = 5n) {
  const u: UnsignedTx = JSON.parse(JSON.stringify(s.parts.unsigned, (_k, v) => (typeof v === "bigint" ? `${v}n` : v)), (_k, v) => (typeof v === "string" && /^\d+n$/.test(v) ? BigInt(v.slice(0, -1)) : v));
  f(u);
  const toSign = bytesToSign(u);
  const proofs = ["", ...u.inputs.slice(1).map(() => bytesToHex(proveDlog(toSign, secretBytes(feeSecret))))];
  return parseBuildResponse(trackerBuildResponse({ ...s.parts, unsigned: u, partialJson: ergoLibTxJson(u, { proofs }), unsignedJson: undefined }));
}

describe("token redemption L1", () => {
  it("the tracker's layout passes: the recipient gets the tokens and 0.001 ERG, the tracker pays the fee", () => {
    const s = base();
    const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, s.expect);
    if (!l1.ok) throw new Error(`${l1.rule}: ${l1.message}`);
    expect(l1.denom).toBe(SIG);
    expect(l1.token?.symbol).toBe("SigUSD");
    expect(l1.payout).toBe(300n);
    expect(l1.payoutErg).toBe(1_000_000n);
    expect(l1.feePaidBy).toBe("tracker");
    expect(l1.feeInputs).toBe(1);
    expect(l1.reserveAfter.ergoTree).toBe(TOKEN_RESERVE_TREE_HEX);
    expect(l1.reserveAfter.tokens[1]).toEqual({ tokenId: SIGUSD_TOKEN_ID, amount: 1_700n });
  });

  it("is refused as an ERG redemption, and under another token", () => {
    const s = base();
    const b = parseBuildResponse(s.text);
    expect(checkRedemption(b, s.chain, { ...s.expect, denomination: undefined })).toMatchObject({ ok: false });
    expect(checkRedemption(b, s.chain, { ...s.expect, denomination: `token:${RSADA_TOKEN_ID}` })).toMatchObject({ ok: false });
    expect(checkRedemption(b, s.chain, { ...s.expect, denomination: `token:${"03".repeat(32)}` })).toMatchObject({ ok: false, rule: "malformed" });
  });

  it("refuses fee boxes at the recipient's own key (the proof-reuse attack), even when correctly proved", () => {
    const s = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, feeKeySecret: 3n });
    expect(checkRedemption(parseBuildResponse(s.text), s.chain, s.expect)).toMatchObject({ ok: false, rule: "reserve-input" });
  });

  it("refuses fee inputs the tracker key did not prove", () => {
    const s = base();
    const bad = { ...s.parts, partialJson: ergoLibTxJson(s.parts.unsigned, { proofs: ["", s.proofs[1].replace(/^../, "00")] }) };
    expect(checkRedemption(parseBuildResponse(trackerBuildResponse(bad)), s.chain, s.expect)).toMatchObject({ ok: false, rule: "ids" });
    const empty = { ...s.parts, partialJson: ergoLibTxJson(s.parts.unsigned, { proofs: ["", ""] }) };
    expect(checkRedemption(parseBuildResponse(trackerBuildResponse(empty)), s.chain, s.expect)).toMatchObject({ ok: false, rule: "ids" });
  });

  it("refuses a build the recipient would pay for", () => {
    const s = base();
    const b = parseBuildResponse(s.text.replace('"fee_paid_by":"tracker"', '"fee_paid_by":"recipient"'));
    expect(checkRedemption(b, s.chain, s.expect)).toMatchObject({ ok: false, rule: "fee-paid-by" });
  });

  const mutations: [string, string, (t: UnsignedTx) => void][] = [
    ["ERG taken out of the reserve", "reserve-output", (t) => { t.outputs[0].value -= 1_000n; t.outputs[3].value += 1_000n; }],
    ["one token unit kept back from the recipient", "reserve-output", (t) => { t.outputs[0].tokens[1].amount += 1n; t.outputs[1].tokens[0].amount -= 1n; }],
    ["the reserve under the ERG tree", "reserve-output", (t) => { t.outputs[0].ergoTree = p2pkTree(keyPairFromSecret(9n).pubHex); }],
    ["the payout to another key", "payout-output", (t) => { t.outputs[1].ergoTree = p2pkTree(keyPairFromSecret(9n).pubHex); }],
    ["the payout with a second token", "payout-output", (t) => { t.outputs[1].tokens.push({ tokenId: "ee".repeat(32), amount: 1n }); }],
    ["R7 changed", "reserve-output", (t) => { t.outputs[0].registers[3] = "0502"; }],
    ["the change with a token", "outputs", (t) => { t.outputs[3].tokens = [{ tokenId: "ee".repeat(32), amount: 1n }]; }],
    ["a fifth output", "outputs", (t) => { t.outputs.push({ ...t.outputs[2] }); t.outputs[3].value -= t.outputs[2].value; }],
  ];
  it.each(mutations)("refuses %s", (_n, rule, f) => {
    const s = base();
    const l1 = checkRedemption(rebuilt(s, f), s.chain, s.expect);
    expect(l1.ok ? "ok" : l1.rule).toBe(rule);
  });

  it("redeems at most all but one raw unit (the tracker keeps the token in the box; an empty token amount does not even parse)", () => {
    const s = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, reserveTokens: 300n, amount: 299n });
    expect(checkRedemption(parseBuildResponse(s.text), s.chain, s.expect).ok).toBe(true);
    const all = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, reserveTokens: 300n, amount: 300n });
    expect(() => parseBuildResponse(all.text)).toThrow();
    expect(checkRedemption(parseBuildResponse(s.text), s.chain, { ...s.expect, amount: 300n }).ok).toBe(false);
  });

  it("refuses a tracker signature over the ERG message", () => {
    const s = base();
    const ergMsg = noteMessage({ issuer: s.expect.issuer, recipient: s.expect.recipient, totalDebt: s.expect.totalDebt, timestamp: s.expect.timestamp, trackerNft: s.expect.trackerNft! });
    const sig = bytesToHex(signBasis(ergMsg, secretBytes(5n), s.tracker.pubHex));
    const l1 = checkRedemption(rebuilt(s, (t) => {
      const e = t.inputs[0].extension.find((x) => x.key === 6)!;
      e.value = `0e41${sig}`;
    }), s.chain, s.expect);
    expect(l1).toMatchObject({ ok: false, rule: "tracker-signature" });
  });

  it("signs the reserve input only; the tracker's fee proofs stay as they were", () => {
    const s = base();
    const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, s.expect) as CheckedRedemption;
    const signed = signRedemption(l1, secretBytes(3n));
    const back = nodeTxFromJson(parseJson(signed.signedRaw), "signed_tx");
    expect(back.inputs[0].proof).toBe(signed.proof);
    expect(back.inputs[1].proof).toBe(s.proofs[1]);
    expect(() => spliceRedemptionProof(l1, new Uint8Array(56))).toThrow();
  });
});

describe("the token build request and the token note", () => {
  const recipient = keyPairFromSecret(3n);
  const issuer = keyPairFromSecret(2n);
  it("binds the denomination into the signed message and the body; ERG stays byte for byte", () => {
    const r = { issuer: issuer.pubHex, recipient: recipient.pubHex, amount: 300n, issuerSignature: "aa".repeat(65), requestTimestamp: 1_795_000_000_000n };
    const t = signedBuildRequest(secretBytes(3n), { ...r, denomination: SIG });
    expect(t.body).toContain(`"denomination":"${SIG}"`);
    expect(t.message.length).toBe(198);
    expect(verifyBasis(recipient.pubHex, buildRequestMessage({ trackerNft: TRACKER_NFT, ...r, denomination: SIG }), t.signature)).toBe(true);
    const e = signedBuildRequest(secretBytes(3n), r);
    expect(e.body).toContain('"denomination":"erg"');
    expect(() => signedBuildRequest(secretBytes(3n), { ...r, denomination: `token:${"03".repeat(32)}` })).toThrow();
  });

  it("checks the note in its denomination, with the token message", () => {
    const ts = 1_795_000_000_000n;
    const msg = noteMessage({ issuer: issuer.pubHex, recipient: recipient.pubHex, totalDebt: 1_000n, timestamp: ts, trackerNft: TRACKER_NFT, denomination: SIG });
    const note: StoredNote = {
      issuer: issuer.pubHex, recipient: recipient.pubHex, amountCollected: 1_000n, amountRedeemed: 0n, timestamp: ts, signature: bytesToHex(signBasis(msg, secretBytes(2n), issuer.pubHex)),
      trackerNft: TRACKER_NFT, denomination: SIG, confirmation: { status: "confirmed", confirmedTotalDebt: 1_000n, redeemable: true, redeemableAmount: 1_000n, confirmedBoxId: null, confirmedHeight: 1 },
    };
    const want = { issuer: issuer.pubHex, recipient: recipient.pubHex, amount: 300n };
    const ok = checkNoteForRedemption(note, { ...want, denomination: SIG });
    expect(ok.ok && ok.expect.denomination).toBe(SIG);
    expect(checkNoteForRedemption(note, want)).toMatchObject({ ok: false, rule: "note-denomination" });
    expect(checkNoteForRedemption(note, { ...want, denomination: `token:${RSADA_TOKEN_ID}` })).toMatchObject({ ok: false, rule: "note-denomination" });
    expect(checkNoteForRedemption({ ...note, denomination: "erg" }, want)).toMatchObject({ ok: false, rule: "note-signature" });
  });
});
