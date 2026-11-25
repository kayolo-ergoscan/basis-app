// Token reserves in the vault: the note budget per denomination (never summed across units), the token note body,
// one T1 per key and denomination, and the redemption / reserve-action guards in the token layouts. TEST keys only.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { keyPairFromSecret } from "../../../protocol/keys";
import { checkRedemption, parseBuildResponse, signRedemption, type CheckedRedemption } from "../../tx/redemption";
import { buildTopUp, signReserveAction } from "../../tx/reserveaction";
import { p2pkAddress } from "../../tx/address";
import { signP2pkTransaction } from "../../tx/p2pk";
import { reserveTokenById } from "../../tx/tokens";
import { planTokenWithdraw } from "../../flows/coins";
import { p2pkBox, reserveBox, secretBytes, syntheticTokenRedemption } from "../../tx/testkit";
import { SIGUSD_TOKEN_ID, RSADA_TOKEN_ID, TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TREE_HEX } from "../../tx/tokens";
import { signNote } from "../../flows/notes";
import { checkNoteBody, notePolicy, promiseKey, redeemsReserveBox, redemptionPaysOwnKey, reserveActionPaysRight, type NoteIntent, type PairPromise } from "../policy";
import { FakeBrowser, PASS } from "./fakes";
import { backUp, code, openTab, randomPub } from "./helpers";

const SIG = `token:${SIGUSD_TOKEN_ID}` as const;
const ADA = `token:${RSADA_TOKEN_ID}` as const;
const SK_HEX = "1f".repeat(32);
const SK = Uint8Array.from(SK_HEX.match(/../g)!.map((h) => parseInt(h, 16)));
const ME = bytesToHex(secp256k1.getPublicKey(SK, true));
const T0 = 1_795_000_000_000n;

describe("the note budget per denomination", () => {
  const to = randomPub();
  it("ERG promised in the session does not count toward SigUSD, nor the other way round", () => {
    const promised = new Map<string, PairPromise>([[promiseKey(to), { base: 0n, top: 900_000_000n }]]);
    const tok: NoteIntent = { recipient: to, total: 100n, reserveValue: 1_000n, prev: null, denomination: SIG };
    expect(notePolicy(ME, tok, promised)).toMatchObject({ since: 0n, after: 100n, passphrase: false });
    expect(notePolicy(ME, { ...tok, total: 300n }, promised).passphrase).toBe(true); // 300 of 1 000 is over 25 %
    const withSig = new Map<string, PairPromise>([[promiseKey(to, SIG), { base: 0n, top: 240n }]]);
    expect(notePolicy(ME, { recipient: to, total: 100_000_000n, reserveValue: 1_000_000_000n, prev: null }, withSig)).toMatchObject({ since: 0n, after: 100_000_000n });
    expect(notePolicy(ME, { ...tok, total: 10n, denomination: ADA }, withSig).since).toBe(0n);
    expect(promiseKey(to)).toBe(to);
  });

  it("checks the previous note under the token message, and refuses an unknown denomination", () => {
    const prev = signNote(SK, { issuer: ME, recipient: to, total: 50n, timestamp: T0, denomination: SIG });
    const tok: NoteIntent = { recipient: to, total: 100n, reserveValue: 1_000n, prev: { total: 50n, timestamp: T0, signature: prev.signature }, denomination: SIG };
    expect(notePolicy(ME, tok, new Map()).added).toBe(50n);
    expect(() => notePolicy(ME, { ...tok, denomination: undefined }, new Map())).toThrow(); // the ERG message does not verify
    expect(() => notePolicy(ME, { ...tok, denomination: `token:${"03".repeat(32)}` as never }, new Map())).toThrow();
  });

  it("the signed body must carry the declared denomination", () => {
    const s = signNote(SK, { issuer: ME, recipient: to, total: 100n, timestamp: T0, denomination: SIG });
    expect(s.body).toContain(`"denomination":"${SIG}"`);
    const intent: NoteIntent = { recipient: to, total: 100n, reserveValue: 1_000n, prev: null, denomination: SIG };
    expect(() => checkNoteBody(s.body, ME, intent)).not.toThrow();
    expect(() => checkNoteBody(s.body, ME, { ...intent, denomination: undefined })).toThrow();
    expect(signNote(SK, { issuer: ME, recipient: to, total: 1n, timestamp: T0 }).body).toContain('"denomination":"erg"');
  });
});

describe("one T1 per key and denomination", () => {
  it("an ERG T1 does not block a SigUSD T1; a second SigUSD T1 is refused; meta.denom must match", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.importHex(SK_HEX, PASS);
    await backUp(v);
    let n = 0;
    const t1 = (meta: Record<string, string> = {}) => () => {
      const id = (++n).toString(16).padStart(2, "0").repeat(32);
      return { txId: id, signedRaw: JSON.stringify({ id }), inputs: [(n + 100).toString(16).padStart(2, "0").repeat(32)], meta };
    };
    expect((await v.signToJournal("t1", t1(), { passphrase: PASS })).kind).toBe("t1");
    expect(await code(v.signToJournal("t1", t1(), { passphrase: PASS }))).toBe("t1-exists");
    const sig = await v.signToJournal("t1", t1({ denom: SIG }), { passphrase: PASS, denom: SIG });
    expect(sig.meta.denom).toBe(SIG);
    expect(await code(v.signToJournal("t1", t1({ denom: SIG }), { passphrase: PASS, denom: SIG }))).toBe("t1-exists");
    expect(await code(v.signToJournal("t1", t1({ denom: SIG }), { passphrase: PASS, denom: ADA }))).toBe("bad-input");
    expect(await code(v.signToJournal("t1", t1(), { passphrase: PASS, denom: ADA }))).toBe("bad-input");
    expect((await v.signToJournal("t1", t1({ denom: ADA }), { passphrase: PASS, denom: ADA })).meta.denom).toBe(ADA);
    expect((await v.journal.activeT1(ME))?.meta.denom).toBeUndefined();
    expect((await v.journal.activeT1(ME, SIG))?.id).toBe(sig.id);
    v.close();
  });
});

describe("the guards in the token layouts", () => {
  const s = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID });
  const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, s.expect) as CheckedRedemption;
  if (!l1.ok) throw new Error("l1");
  const signed = signRedemption(l1, secretBytes(3n));

  it("a token redemption pays this key: [token reserve, P2PK(me) with the tokens, fee, the tracker's change]", () => {
    expect(redemptionPaysOwnKey(signed.signedRaw, s.recipient.pubHex)).toBe(true);
    expect(redemptionPaysOwnKey(signed.signedRaw, s.issuer.pubHex)).toBe(false);
    // the change back to this key would be a layout the wallet never signs
    expect(redemptionPaysOwnKey(signed.signedRaw.split(`0008cd${s.tracker.pubHex}`).join(`0008cd${s.recipient.pubHex}`), s.recipient.pubHex)).toBe(false);
  });

  it("spends the token reserve and only the tracker's own token-free boxes", () => {
    expect(redeemsReserveBox(signed.signedRaw, s.chain.inputs, s.tracker.pubHex)).toBe(true);
    expect(redeemsReserveBox(signed.signedRaw, s.chain.inputs)).toBe(false); // the real tracker key is another one
    expect(redeemsReserveBox(signed.signedRaw, s.chain.inputs.slice(0, 1), s.tracker.pubHex)).toBe(false);
    const attack = syntheticTokenRedemption({ tokenId: SIGUSD_TOKEN_ID, feeKeySecret: 3n });
    const raw = parseBuildResponse(attack.text).partialRaw;
    expect(redeemsReserveBox(raw, attack.chain.inputs, s.tracker.pubHex)).toBe(false);
  });

  it("a token top-up pays the token reserve of the reviewed owner, change to this key", () => {
    const payer = keyPairFromSecret(2n);
    const owner = keyPairFromSecret(3n).pubHex;
    const reserve = reserveBox(owner, TOKEN_RESERVE_BOX_NANOERG, { tree: TOKEN_RESERVE_TREE_HEX, tokens: [{ tokenId: "a7".repeat(32), amount: 1n }, { tokenId: SIGUSD_TOKEN_ID, amount: 500n }] });
    const coins = [p2pkBox(payer.pubHex, 5_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }] })];
    const tx = buildTopUp({ reserve, payer: payer.pubHex, inputs: coins, amount: 200n, fee: 1_000_000n, height: 1_925_000, denom: SIG });
    const raw = signReserveAction(tx, [reserve, ...coins], secretBytes(payer.secret), "topup").nodeJson;
    expect(reserveActionPaysRight(raw, payer.pubHex, "topup", owner)).toBe(true);
    expect(reserveActionPaysRight(raw, payer.pubHex, "topup", payer.pubHex)).toBe(false);
  });
});

describe("a token Withdraw in the vault", () => {
  it("signs as a withdrawal of this key's boxes, to another address only with the passphrase", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.importHex(SK_HEX, PASS);
    await backUp(v);
    const boxes = [p2pkBox(ME, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 800n }], index: 1 }), p2pkBox(ME, 20_000_000n, { index: 2 })];
    const sign = (to: string) => {
      const p = planTokenWithdraw(boxes, ME, to, reserveTokenById(SIGUSD_TOKEN_ID)!, 300n, 1_000_000n, 1_925_000);
      if (!p.ok) throw new Error(p.why);
      return (sk: Uint8Array) => {
        const s = signP2pkTransaction(p.tx, p.inputs, sk);
        return { txId: s.txId, signedRaw: s.nodeJson, inputs: p.inputs.map((x) => x.boxId), meta: { amount: "300", to, denom: SIG } };
      };
    };
    const other = p2pkAddress(keyPairFromSecret(2n).pubHex);
    expect(await code(v.signToJournal("withdraw", sign(other), { inputBoxes: boxes }))).toBe("passphrase-required");
    const e = await v.signToJournal("withdraw", sign(other), { inputBoxes: boxes, passphrase: PASS });
    expect(e.state).toBe("signed");
    expect(e.meta.denom).toBe(SIG);
    // the boxes must be the inputs, bound to their ids
    expect(await code(v.signToJournal("withdraw", sign(other), { inputBoxes: [boxes[1], boxes[0]], passphrase: PASS }))).toBe("bad-input");
    v.close();
  });
});
