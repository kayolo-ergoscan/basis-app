// When the vault asks for the passphrase again (keys review P1-2, operator decision 2): a reserve creation always; a
// withdrawal unless it pays only this key; notes once everything signed since the passphrase was typed promises more
// than 25 % of the reserve's on-chain value. Enforced in the vault, whatever the screen asks. Random TEST keys only.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { FEE_TREE_HEX, RESERVE_TREE_HEX, TRACKER_NFT, p2pkTree } from "../../tx/constants";
import { p2pkAddress } from "../../tx/address";
import { signP2pkTransaction } from "../../tx/p2pk";
import { p2pkBox, paddedReserveBox, reserveBox, secretBytes, syntheticRedemption } from "../../tx/testkit";
import { buildRefundStart, buildTopUp, signReserveAction } from "../../tx/reserveaction";
import { checkRedemption, parseBuildResponse, signRedemption } from "../../tx/redemption";
import { planCombine, planWithdraw } from "../../flows/coins";
import { signNote } from "../../flows/notes";
import { checkNoteBody, notePolicy, paysOnlyOwnKey, redemptionPaysOwnKey, reserveActionPaysRight, type NoteIntent } from "../policy";
import type { MainnetVault } from "../vault";
import { FakeBrowser, OTHER_PASS, PASS } from "./fakes";
import { backUp, code, openTab, randomPub } from "./helpers";

const ERG = 1_000_000_000n;
const SK_HEX = "1f".repeat(32);
const SK = Uint8Array.from(SK_HEX.match(/../g)!.map((h) => parseInt(h, 16)));
const ME = bytesToHex(secp256k1.getPublicKey(SK, true));
const T0 = 1_795_000_000_000n;

async function ready(): Promise<{ b: FakeBrowser; v: MainnetVault }> {
  const b = new FakeBrowser();
  const v = await openTab(b);
  await v.importHex(SK_HEX, PASS);
  await backUp(v);
  return { b, v };
}

/** A note of ME exactly as Pay signs it: the callback returns the journal fields. */
function noteFn(to: string, total: bigint, ts: bigint) {
  let touched = false;
  const fn = (sk: Uint8Array) => {
    touched = true;
    const s = signNote(sk, { issuer: ME, recipient: to, total, timestamp: ts });
    return { txId: null, signedRaw: s.body, inputs: [], meta: { to, total: total.toString(), ts: ts.toString(), sig: s.signature } };
  };
  return { fn, touched: () => touched };
}

const intent = (to: string, total: bigint, reserveValue: bigint, prev: NoteIntent["prev"] = null): NoteIntent => ({ recipient: to, total, reserveValue, prev });
/** A previous note of ME, signed for real (the tracker would store exactly this). */
const prevOf = (to: string, total: bigint, ts: bigint) => ({ total, timestamp: ts, signature: signNote(SK, { issuer: ME, recipient: to, total, timestamp: ts }).signature });

const txJson = (trees: string[], id = "ab".repeat(32), values: (string | number)[] = []) =>
  `{"id":"${id}","inputs":[],"dataInputs":[],"outputs":[${trees.map((ergoTree, i) => `{"value":${values[i] ?? 1000000},"ergoTree":"${ergoTree}","assets":[],"additionalRegisters":{},"creationHeight":1}`).join(",")}]}`;

/** A reserve action's node JSON: output 0, when it is the reserve, carries R4 = `owner` and R6 = `r6`. */
const actJson = (trees: string[], owner: string, o: { id?: string; values?: (string | number)[]; r6?: string } = {}) =>
  txJson(trees, o.id, o.values).replace(`"ergoTree":"${RESERVE_TREE_HEX}","assets":[],"additionalRegisters":{}`,
    `"ergoTree":"${RESERVE_TREE_HEX}","assets":[],"additionalRegisters":{"R4":"07${owner}","R5":"64","R6":"0e20${o.r6 ?? TRACKER_NFT}","R7":"0500"}`);

/** A signed redemption in node JSON: one input with #0 (action 0, output 0 = "0200"), output 0 a reserve of `owner`. */
const redeemJson = (trees: string[], o: { id?: string; owner?: string; ext0?: string; inputs?: number; values?: (string | number)[]; boxId?: string } = {}) => {
  const input = `{"boxId":"${o.boxId ?? "dd".repeat(32)}","spendingProof":{"proofBytes":"${"ab".repeat(56)}","extension":{"0":"${o.ext0 ?? "0200"}","1":"07${"02".padEnd(66, "1")}"}}}`;
  const regs = (i: number) => (i === 0 ? `{"R4":"07${o.owner ?? randomPub()}","R5":"64","R6":"0e20","R7":"0500"}` : "{}");
  return `{"id":"${o.id ?? "ab".repeat(32)}","inputs":[${Array(o.inputs ?? 1).fill(input).join(",")}],"dataInputs":[{"boxId":"${"ee".repeat(32)}"}],"outputs":[${trees.map((ergoTree, i) => `{"value":${o.values?.[i] ?? 1000000},"ergoTree":"${ergoTree}","assets":[],"additionalRegisters":${regs(i)},"creationHeight":1}`).join(",")}]}`;
};

describe("mainnet vault: the passphrase rules", () => {
  it("a reserve creation always needs the passphrase; t1, withdraw and note need it through withSecret too", async () => {
    const { v } = await ready();
    let touched = 0;
    const t1 = () => { touched++; return { txId: "aa".repeat(32), signedRaw: "{}", inputs: ["bb".repeat(32)] }; };
    expect(await code(v.signToJournal("t1", t1))).toBe("passphrase-required");
    expect(await code(v.signToJournal("t1", t1, { passphrase: OTHER_PASS }))).toBe("wrong-passphrase");
    expect(touched).toBe(0);
    expect((await v.signToJournal("t1", t1, { passphrase: PASS })).kind).toBe("t1");
    expect(touched).toBe(1);
    for (const purpose of ["t1", "withdraw", "note", "export-hex"] as const) {
      expect(await code(v.withSecret(purpose, () => { touched++; return 1; }))).toBe("passphrase-required");
    }
    expect(touched).toBe(1);
    expect(await v.withSecret("withdraw", () => 5, { passphrase: PASS })).toBe(5);
    // a redemption pays only this key (L1): no passphrase, as before
    expect(await v.withSecret("redeem", () => 2)).toBe(2);
    expect(await v.withSecret("build-request", () => 3)).toBe(3);
    v.close();
  });

  it("a withdrawal pays only this key and the miner fee without it; anything else needs it, and is never recorded", async () => {
    const { v } = await ready();
    const own = `0008cd${ME}`;
    let n = 0;
    // the coin a withdrawal spends, bound to its id (re-review LOW: only this key's boxes, no context variables)
    const coin = p2pkBox(ME, 30_000_000n, { index: 7 });
    const spending = (raw: string, b: { boxId: string } = coin, ext = "{}") =>
      raw.replace('"inputs":[]', `"inputs":[{"boxId":"${b.boxId}","spendingProof":{"proofBytes":"${"ab".repeat(56)}","extension":${ext}}}]`);
    const mine = { inputBoxes: [coin] };
    const w = (trees: string[], b: { boxId: string } = coin, ext = "{}") => () => {
      const id = (++n).toString(16).padStart(2, "0").repeat(32);
      return { txId: id, signedRaw: spending(txJson(trees, id), b, ext), inputs: [b.boxId] };
    };
    expect((await v.signToJournal("withdraw", w([own, FEE_TREE_HEX]), mine)).state).toBe("signed");
    const foreign = `0008cd${randomPub()}`;
    expect(await code(v.signToJournal("withdraw", w([foreign, own, FEE_TREE_HEX]), mine))).toBe("passphrase-required");
    expect(await code(v.signToJournal("withdraw", w([]), mine))).toBe("passphrase-required");
    expect(await code(v.signToJournal("withdraw", () => ({ txId: "cc".repeat(32), signedRaw: "not json", inputs: [] }), mine))).toBe("bad-input");
    // a refund completion pays [this key, the fee] too: under "withdraw" it is refused, passphrase or not
    const reserve = reserveBox(ME, 2_000_000_000n);
    expect(await code(v.signToJournal("withdraw", w([own, FEE_TREE_HEX], reserve, '{"0":"021e"}'), { inputBoxes: [reserve] }))).toBe("bad-input");
    expect(await code(v.signToJournal("withdraw", w([own, FEE_TREE_HEX], reserve), { inputBoxes: [reserve], passphrase: PASS }))).toBe("bad-input");
    expect(await code(v.signToJournal("withdraw", w([own, FEE_TREE_HEX], coin, '{"0":"021e"}'), mine))).toBe("bad-input");
    // the boxes are required, must hash to the inputs' ids, and be this key's
    expect(await code(v.signToJournal("withdraw", w([own, FEE_TREE_HEX])))).toBe("bad-input");
    expect(await code(v.signToJournal("withdraw", w([own, FEE_TREE_HEX]), { inputBoxes: [{ ...coin, value: coin.value + 1n }] }))).toBe("bad-input");
    const theirCoin = p2pkBox(randomPub(), 30_000_000n);
    expect(await code(v.signToJournal("withdraw", w([own, FEE_TREE_HEX], theirCoin), { inputBoxes: [theirCoin], passphrase: PASS }))).toBe("bad-input");
    expect(await v.journal.list({ kind: "withdraw" })).toHaveLength(1);
    expect((await v.signToJournal("withdraw", w([foreign, own, FEE_TREE_HEX]), { passphrase: PASS, ...mine })).state).toBe("signed");
    // the real signer's JSON: Combine (back to this key) goes through; a withdrawal elsewhere does not
    const boxes = [p2pkBox(ME, 30_000_000n), p2pkBox(ME, 40_000_000n, { index: 1 })];
    const combine = planCombine(boxes, ME, p2pkAddress(ME), 1_922_400);
    if (!combine.ok) throw new Error("no combine plan");
    const signed = (tx: typeof combine.tx, inputs: typeof boxes) => () => {
      const r = signP2pkTransaction(tx, inputs, SK);
      return { txId: r.txId, signedRaw: r.nodeJson, inputs: inputs.map((x) => x.boxId) };
    };
    expect((await v.signToJournal("withdraw", signed(combine.tx, combine.inputs), { inputBoxes: combine.inputs })).state).toBe("signed");
    const away = planWithdraw(boxes, ME, p2pkAddress(randomPub()), 50_000_000n, 1_000_000n, 1_922_400);
    if (!away.ok) throw new Error("no withdraw plan");
    expect(await code(v.signToJournal("withdraw", signed(away.tx, away.inputs), { inputBoxes: away.inputs }))).toBe("passphrase-required");
    expect(p2pkTree(ME)).toBe(own);
    expect(paysOnlyOwnKey(txJson([own]), ME)).toBe(true);
    expect(paysOnlyOwnKey(txJson([own.toUpperCase()]), ME)).toBe(false);
    // the miner fee is at most the wallet's own (1 000 000 nanoERG) in all: everything to the fee tree needs it
    expect(paysOnlyOwnKey(txJson([own, FEE_TREE_HEX], undefined, [5, 1000001]), ME)).toBe(false);
    expect(paysOnlyOwnKey(txJson([own, FEE_TREE_HEX, FEE_TREE_HEX], undefined, [5, 600000, 600000]), ME)).toBe(false);
    expect(paysOnlyOwnKey(txJson([FEE_TREE_HEX], undefined, ["18446744073709551615"]), ME)).toBe(false);
    expect(paysOnlyOwnKey(txJson([own, FEE_TREE_HEX], undefined, [9007199254740993, 1000000]), ME)).toBe(true);
    expect(paysOnlyOwnKey(txJson([own, FEE_TREE_HEX], undefined, [5, 1000000]).replace(`"inputs"`, `"outputs":[],"inputs"`), ME)).toBe(false); // duplicate key
    const toFee = (() => {
      const id = "ee".repeat(32);
      return () => ({ txId: id, signedRaw: spending(txJson([own, FEE_TREE_HEX], id, [1000, 68_000_000])), inputs: [coin.boxId] });
    })();
    const sent = await v.journal.list({ kind: "withdraw" });
    expect(await code(v.signToJournal("withdraw", toFee, mine))).toBe("passphrase-required");
    expect(await v.journal.list({ kind: "withdraw" })).toHaveLength(sent.length);
    v.close();
  });

  it("a redemption must pay this key: [the reserve, P2PK(this key), a miner fee of at most 0.001 ERG]", async () => {
    const { v } = await ready();
    const own = `0008cd${ME}`;
    const R = [RESERVE_TREE_HEX, own, FEE_TREE_HEX];
    expect(redemptionPaysOwnKey(redeemJson(R), ME)).toBe(true);
    expect(redemptionPaysOwnKey(redeemJson([RESERVE_TREE_HEX, `0008cd${randomPub()}`, FEE_TREE_HEX]), ME)).toBe(false);
    expect(redemptionPaysOwnKey(redeemJson(R, { values: [1, 1, 1000001] }), ME)).toBe(false);
    expect(redemptionPaysOwnKey(redeemJson([RESERVE_TREE_HEX, own, own, FEE_TREE_HEX]), ME)).toBe(false);
    expect(redemptionPaysOwnKey(redeemJson([own, RESERVE_TREE_HEX, FEE_TREE_HEX]), ME)).toBe(false);
    // the same layout is a refund start with change, a top-up with change: only a redemption passes
    expect(redemptionPaysOwnKey(redeemJson(R, { ext0: "0214" }), ME)).toBe(false); // action 2
    expect(redemptionPaysOwnKey(redeemJson(R, { ext0: "020a" }), ME)).toBe(false); // action 1
    expect(redemptionPaysOwnKey(redeemJson(R, { owner: ME }), ME)).toBe(false); // this key's own reserve
    expect(redemptionPaysOwnKey(redeemJson(R, { inputs: 2 }), ME)).toBe(false); // the reserve plus a box of this key
    expect(redemptionPaysOwnKey(redeemJson(R, { inputs: 0 }), ME)).toBe(false);
    expect(redemptionPaysOwnKey(txJson(R), ME)).toBe(false); // no input at all
    expect(redemptionPaysOwnKey(redeemJson(R).replace('"0":"0200",', ""), ME)).toBe(false); // no #0
    // a real signed redemption (the synthetic build that passes L1, signed by its receiver) passes
    const syn = syntheticRedemption();
    const l1 = checkRedemption(parseBuildResponse(syn.text), syn.chain, syn.expect);
    if (!l1.ok) throw new Error(l1.message);
    const real = signRedemption(l1, secretBytes(syn.recipient.secret));
    expect(redemptionPaysOwnKey(real.signedRaw, syn.expect.recipient)).toBe(true);
    expect(redemptionPaysOwnKey(real.signedRaw, syn.expect.issuer)).toBe(false);
    // the reviewed reserve box, bound to the input's id (re-review LOW: input 0 is a reserve-contract box)
    const rb = reserveBox(randomPub(), 2_000_000_000n);
    const reviewed = { inputBoxes: [rb] };
    const r = (raw: string, id: string) => () => ({ txId: id, signedRaw: raw, unsignedRaw: "{}", inputs: [rb.boxId] });
    expect(await code(v.signToJournal("redeem", r(redeemJson([RESERVE_TREE_HEX, `0008cd${randomPub()}`, FEE_TREE_HEX], { id: "a1".repeat(32), boxId: rb.boxId }), "a1".repeat(32)), reviewed))).toBe("bad-input");
    expect(await code(v.signToJournal("redeem", r(redeemJson(R, { id: "a3".repeat(32), ext0: "0214", owner: ME, boxId: rb.boxId }), "a3".repeat(32)), reviewed))).toBe("bad-input");
    // the same bytes, but the input is a box of this key (a "redemption" that spends the wallet's own coin), or unbound
    const coin = p2pkBox(ME, 3_000_000_000n);
    expect(await code(v.signToJournal("redeem", r(redeemJson(R, { id: "a4".repeat(32), boxId: coin.boxId }), "a4".repeat(32)), { inputBoxes: [coin] }))).toBe("bad-input");
    expect(await code(v.signToJournal("redeem", r(redeemJson(R, { id: "a5".repeat(32), boxId: rb.boxId }), "a5".repeat(32))))).toBe("bad-input");
    expect(await code(v.signToJournal("redeem", r(redeemJson(R, { id: "a6".repeat(32), boxId: rb.boxId }), "a6".repeat(32)), { inputBoxes: [{ ...rb, value: 1n }] }))).toBe("bad-input");
    expect(await v.journal.list({ kind: "redeem" })).toEqual([]);
    expect((await v.signToJournal("redeem", r(redeemJson(R, { id: "a2".repeat(32), boxId: rb.boxId }), "a2".repeat(32)), reviewed)).state).toBe("signed");
    v.close();
  });

  it("notes: over 25 % of the on-chain reserve, counted over everything signed since the passphrase was typed", async () => {
    const { v } = await ready();
    const [r1, r2, r3] = [randomPub(), randomPub(), randomPub()];
    const reserve = 1n * ERG;
    // the split of P1-2: four notes of exactly 25 % each; only the first goes without the passphrase
    const a = noteFn(r1, reserve / 4n, T0);
    expect(v.notePolicy(intent(r1, reserve / 4n, reserve))).toMatchObject({ added: reserve / 4n, since: 0n, after: reserve / 4n, passphrase: false });
    await v.signToJournal("note", a.fn, { note: intent(r1, reserve / 4n, reserve) });
    expect(v.notePolicy(intent(r2, 1n, reserve))).toMatchObject({ since: reserve / 4n, after: reserve / 4n + 1n, passphrase: true });
    const b = noteFn(r2, reserve / 4n, T0 + 1n);
    expect(await code(v.signToJournal("note", b.fn, { note: intent(r2, reserve / 4n, reserve) }))).toBe("passphrase-required");
    expect(b.touched()).toBe(false);
    // typed again: signed, and a new count starts
    await v.signToJournal("note", b.fn, { note: intent(r2, reserve / 4n, reserve), passphrase: PASS });
    expect(v.notePolicy(intent(r3, reserve / 4n, reserve))).toMatchObject({ since: 0n, passphrase: false });
    await v.signToJournal("note", noteFn(r3, reserve / 4n, T0 + 2n).fn, { note: intent(r3, reserve / 4n, reserve) });
    // raising r1's note (its previous one, really signed by this key) adds only the increment, and that is over
    const prev = prevOf(r1, reserve / 4n, T0);
    expect(v.notePolicy(intent(r1, reserve / 4n + 50_000_000n, reserve, prev))).toMatchObject({ added: 50_000_000n, since: reserve / 4n, passphrase: true });
    expect(await code(v.signToJournal("note", noteFn(r1, reserve / 4n + 50_000_000n, T0 + 3n).fn, { note: intent(r1, reserve / 4n + 50_000_000n, reserve, prev) }))).toBe("passphrase-required");
    // a bigger reserve on chain leaves room; no reserve known (0) always asks
    expect(v.notePolicy(intent(r1, reserve / 4n + 50_000_000n, 10n * ERG, prev)).passphrase).toBe(false);
    const r4 = randomPub();
    expect(await code(v.signToJournal("note", noteFn(r4, 1n, T0).fn, { note: intent(r4, 1n, 0n) }))).toBe("passphrase-required");
    // a lock ends the count; the unlock is a passphrase entry
    v.lock();
    await v.unlock(PASS);
    expect(v.notePolicy(intent(r1, reserve / 4n + 50_000_000n, reserve, prev))).toMatchObject({ since: 0n, added: 50_000_000n, passphrase: false });
    v.close();
  });

  it("notes: the previous note must be this key's, the total above it, and the signed body the declared note", async () => {
    const { v } = await ready();
    const to = randomPub();
    const reserve = 10n * ERG;
    const real = prevOf(to, 1n * ERG, T0);
    // the tracker's inflated total under the real signature, or a signature of another key: refused before signing
    const inflated = noteFn(to, 6n * ERG, T0 + 1n);
    expect(await code(v.signToJournal("note", inflated.fn, { note: intent(to, 6n * ERG, reserve, { ...real, total: 5n * ERG }), passphrase: PASS }))).toBe("bad-input");
    const otherSk = secp256k1.utils.randomPrivateKey();
    const otherPub = bytesToHex(secp256k1.getPublicKey(otherSk, true));
    const foreignSig = signNote(otherSk, { issuer: otherPub, recipient: to, total: 1n * ERG, timestamp: T0 }).signature;
    expect(await code(v.signToJournal("note", inflated.fn, { note: intent(to, 6n * ERG, reserve, { ...real, signature: foreignSig }) }))).toBe("bad-input");
    expect(inflated.touched()).toBe(false);
    expect(await code(v.signToJournal("note", noteFn(to, 1n * ERG, T0 + 1n).fn, { note: intent(to, 1n * ERG, reserve, real) }))).toBe("bad-input");
    expect(await code(v.signToJournal("note", noteFn(to, 1n, T0).fn))).toBe("bad-input");
    expect(await code(v.signToJournal("note", noteFn(ME, 1n, T0).fn, { note: intent(ME, 1n, reserve) }))).toBe("bad-input");
    // the callback signs something else than it declared: dropped, nothing recorded
    expect(await code(v.signToJournal("note", noteFn(to, 2n * ERG, T0 + 1n).fn, { note: intent(to, 1n * ERG + 1n, reserve, real) }))).toBe("bad-input");
    expect(await code(v.signToJournal("note", noteFn(randomPub(), 1n * ERG + 1n, T0 + 1n).fn, { note: intent(to, 1n * ERG + 1n, reserve, real) }))).toBe("bad-input");
    expect(await v.journal.list({ kind: "note" })).toEqual([]);
    const ok = await v.signToJournal("note", noteFn(to, 1n * ERG + 1n, T0 + 1n).fn, { note: intent(to, 1n * ERG + 1n, reserve, real) });
    expect(ok.meta.total).toBe("1000000001");
    v.close();
  });

  it("the pure rule and the body check", () => {
    const to = randomPub();
    const m = new Map<string, { base: bigint; top: bigint }>();
    expect(notePolicy(ME, intent(to, 100n, 400n), m)).toEqual({ added: 100n, since: 0n, after: 100n, reserveValue: 400n, passphrase: false });
    expect(notePolicy(ME, intent(to, 101n, 400n), m).passphrase).toBe(true);
    m.set(to, { base: 0n, top: 100n });
    // the same pair signed again (a retry at a new timestamp) is not counted twice
    expect(notePolicy(ME, intent(to, 100n, 400n), m)).toMatchObject({ since: 100n, after: 100n, passphrase: false });
    expect(() => notePolicy(ME, intent(to, 0n, 400n), m)).toThrow();
    expect(() => notePolicy(ME, intent(to, 1n, -1n), m)).toThrow();
    const s = signNote(SK, { issuer: ME, recipient: to, total: 7n, timestamp: T0 });
    expect(() => checkNoteBody(s.body, ME, intent(to, 7n, 1n))).not.toThrow();
    expect(() => checkNoteBody(s.body, ME, intent(to, 8n, 1n))).toThrow();
    expect(() => checkNoteBody(s.body.replace(TRACKER_NFT, "00".repeat(32)), ME, intent(to, 7n, 1n))).toThrow();
    expect(() => checkNoteBody(s.body, randomPub(), intent(to, 7n, 1n))).toThrow();
    // only the top-level amount counts: a nested "amount" before it, or a second one, never passes for another total
    const nested = s.body.replace("{", `{"x":{"amount":8},`);
    expect(() => checkNoteBody(nested, ME, intent(to, 8n, 1n))).toThrow();
    expect(() => checkNoteBody(nested, ME, intent(to, 7n, 1n))).not.toThrow();
    expect(() => checkNoteBody(s.body.replace("{", `{"amount":8,`), ME, intent(to, 8n, 1n))).toThrow();
    expect(() => checkNoteBody(s.body.replace("{", `{"amount":8,`), ME, intent(to, 7n, 1n))).toThrow();
  });

  it("top-up and refund always need the passphrase, and pay only [the reserve or this key, change to this key, fee ≤ 0.001 ERG]", async () => {
    const { v } = await ready();
    const own = `0008cd${ME}`;
    const OTHER = randomPub();
    const other = `0008cd${OTHER}`;
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, FEE_TREE_HEX], OTHER), ME, "topup", OTHER)).toBe(true);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, FEE_TREE_HEX], ME), ME, "topup", ME)).toBe(true);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, FEE_TREE_HEX], ME), ME, "refund-start")).toBe(true);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, other, FEE_TREE_HEX], ME), ME, "topup", ME)).toBe(false);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, FEE_TREE_HEX], ME, { values: [1, 1, 1000001] }), ME, "topup", ME)).toBe(false);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, own, FEE_TREE_HEX], ME), ME, "topup", ME)).toBe(false);
    expect(reserveActionPaysRight(txJson([own, FEE_TREE_HEX]), ME, "topup", ME)).toBe(false);
    expect(reserveActionPaysRight(txJson([own, FEE_TREE_HEX]), ME, "refund-end")).toBe(true);
    expect(reserveActionPaysRight(txJson([other, FEE_TREE_HEX]), ME, "refund-end")).toBe(false);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, FEE_TREE_HEX], ME), ME, "refund-end")).toBe(false);
    // the real signer's node JSON passes, for the reviewed owner only
    const coin = p2pkBox(ME, 500_000_000n, { index: 4 });
    const theirs = reserveBox(OTHER, 2_000_000_000n);
    const realTop = signReserveAction(buildTopUp({ reserve: theirs, payer: ME, inputs: [coin], amount: 100_000_000n, fee: 1_000_000n, height: 1_925_000 }), [theirs, coin], SK, "topup");
    expect(reserveActionPaysRight(realTop.nodeJson, ME, "topup", OTHER)).toBe(true);
    expect(reserveActionPaysRight(realTop.nodeJson, ME, "topup", ME)).toBe(false);
    const mine = reserveBox(ME, 2_000_000_000n);
    const realStart = signReserveAction(buildRefundStart({ reserve: mine, owner: ME, inputs: [coin], fee: 1_000_000n, height: 1_925_000, refundHeight: 1_925_010n, add: 0n }), [mine, coin], SK, "refund-start");
    expect(reserveActionPaysRight(realStart.nodeJson, ME, "refund-start")).toBe(true);
    // a reserve without R7 (read as 0, wallet-t3): the same guard, for a top-up that keeps it so and a start that writes it
    const bare = reserveBox(ME, 2_000_000_000n, { r7: null });
    const bareTop = signReserveAction(buildTopUp({ reserve: bare, payer: ME, inputs: [coin], amount: 100_000_000n, fee: 1_000_000n, height: 1_925_000 }), [bare, coin], SK, "topup");
    expect(reserveActionPaysRight(bareTop.nodeJson, ME, "topup", ME)).toBe(true);
    const bareStart = signReserveAction(buildRefundStart({ reserve: bare, owner: ME, inputs: [coin], fee: 1_000_000n, height: 1_925_000, refundHeight: 1_925_010n, add: 0n }), [bare, coin], SK, "refund-start");
    expect(reserveActionPaysRight(bareStart.nodeJson, ME, "refund-start")).toBe(true);
    // one a stranger's top-up gave an R8 and an R9 (the contract never reads them): the same
    const extra = reserveBox(ME, 2_000_000_000n, { extra: ["0402", `08cd${OTHER}`] });
    const extraTop = signReserveAction(buildTopUp({ reserve: extra, payer: ME, inputs: [coin], amount: 100_000_000n, fee: 1_000_000n, height: 1_925_000 }), [extra, coin], SK, "topup");
    expect(reserveActionPaysRight(extraTop.nodeJson, ME, "topup", ME)).toBe(true);
    const extraStart = signReserveAction(buildRefundStart({ reserve: extra, owner: ME, inputs: [coin], fee: 1_000_000n, height: 1_925_000, refundHeight: 1_925_010n, add: 0n }), [extra, coin], SK, "refund-start");
    expect(reserveActionPaysRight(extraStart.nodeJson, ME, "refund-start")).toBe(true);
    // one padded to 4096 bytes (P2-1): the wallet's top-up and start drop R8, R9, and the guard passes both
    const padded = paddedReserveBox(ME, 200_000_000n);
    const padTop = signReserveAction(buildTopUp({ reserve: padded, payer: ME, inputs: [coin], amount: 100_000_000n, fee: 1_000_000n, height: 1_925_000 }), [padded, coin], SK, "topup");
    expect(reserveActionPaysRight(padTop.nodeJson, ME, "topup", ME)).toBe(true);
    const padStart = signReserveAction(buildRefundStart({ reserve: padded, owner: ME, inputs: [coin], fee: 1_000_000n, height: 1_925_000, refundHeight: 1_925_010n, add: 0n }), [padded, coin], SK, "refund-start");
    expect(reserveActionPaysRight(padStart.nodeJson, ME, "refund-start")).toBe(true);
    // the reserve output: our tracker (R6), the reviewed owner for a top-up, this key for a refund start
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, FEE_TREE_HEX], ME, { r6: "11".repeat(32) }), ME, "topup", ME)).toBe(false);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, FEE_TREE_HEX], ME, { r6: "11".repeat(32) }), ME, "refund-start")).toBe(false);
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, FEE_TREE_HEX], OTHER), ME, "topup", ME)).toBe(false); // reviewed as own
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, own, FEE_TREE_HEX], OTHER), ME, "topup")).toBe(false); // no reviewed owner
    expect(reserveActionPaysRight(actJson([RESERVE_TREE_HEX, FEE_TREE_HEX], OTHER), ME, "refund-start")).toBe(false);
    expect(reserveActionPaysRight(txJson([RESERVE_TREE_HEX, FEE_TREE_HEX]), ME, "refund-start")).toBe(false); // no registers
    let touched = 0;
    const act = (raw: (id: string) => string, id: string) => () => { touched++; return { txId: id, signedRaw: raw(id), inputs: ["dd".repeat(32)] }; };
    const top = (owner: string, trees = [RESERVE_TREE_HEX, own, FEE_TREE_HEX]) => (id: string) => actJson(trees, owner, { id });
    for (const kind of ["topup", "refund-start", "refund-end"] as const) {
      const raw = kind === "refund-end" ? (id: string) => txJson([own, FEE_TREE_HEX], id) : top(ME);
      expect(await code(v.signToJournal(kind, act(raw, "c1".repeat(32)), { reserveOwner: ME }))).toBe("passphrase-required");
      expect(await code(v.withSecret(kind, () => 1))).toBe("passphrase-required");
    }
    expect(touched).toBe(0);
    expect(await code(v.signToJournal("topup", act(top(ME), "c7".repeat(32)), { passphrase: PASS }))).toBe("bad-input"); // no reserveOwner
    expect(touched).toBe(0);
    expect(await code(v.signToJournal("topup", act(top(ME, [RESERVE_TREE_HEX, other, FEE_TREE_HEX]), "c2".repeat(32)), { passphrase: PASS, reserveOwner: ME }))).toBe("bad-input");
    expect(await code(v.signToJournal("topup", act(top(OTHER), "c8".repeat(32)), { passphrase: PASS, reserveOwner: ME }))).toBe("bad-input");
    expect(await code(v.signToJournal("refund-end", act((id) => txJson([other, FEE_TREE_HEX], id), "c3".repeat(32)), { passphrase: PASS }))).toBe("bad-input");
    expect(await code(v.signToJournal("refund-start", act(top(OTHER, [RESERVE_TREE_HEX, FEE_TREE_HEX]), "c9".repeat(32)), { passphrase: PASS }))).toBe("bad-input");
    expect(await v.journal.list({ kind: "topup" })).toEqual([]);
    const e = await v.signToJournal("topup", act(top(OTHER), "c4".repeat(32)), { passphrase: PASS, reserveOwner: OTHER });
    expect([e.kind, e.state, e.txId]).toEqual(["topup", "signed", "c4".repeat(32)]);
    expect((await v.signToJournal("refund-start", act(top(ME, [RESERVE_TREE_HEX, FEE_TREE_HEX]), "c5".repeat(32)), { passphrase: PASS })).kind).toBe("refund-start");
    expect((await v.signToJournal("refund-end", act((id) => txJson([own, FEE_TREE_HEX], id), "c6".repeat(32)), { passphrase: PASS })).kind).toBe("refund-end");
    v.close();
  });
});
