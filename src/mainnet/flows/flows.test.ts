// The wallet flows' pure logic: amounts, receipts and requests (verified before anything is watched), notes (total,
// timestamp, body, signature), coins (T1, Withdraw, Combine, destinations), the receiver's view of a note, watched
// issuers and the journal steps from what the chain shows.
import { afterEach, describe, expect, it } from "vitest";
import { bytesToHex } from "../../protocol/bytes";
import {
  FEE_TREE_HEX, MINER_FEE_NANOERG, P2PK_MAX_INPUTS, RESERVE_TREE_HEX, TRACKER_NFT, checkReserveCreation, checkWithdraw, noteMessage, p2pkAddress, p2pkTree,
  parseStoredNote, publicKeyOf, reserveAddress, verifyBasis, buildReserveCreation, parseJson, checkRedemption, parseBuildResponse, redemptionSubmitBody, signRedemption,
  type StoredNote,
} from "../tx";
import type { JournalEntry, JournalState } from "../vault";
import { p2pkBox, secretBytes, syntheticRedemption } from "../tx/testkit";
import { TEXT } from "../tx/fixtures/chain";
import { dpOf, ergInput, ergPlain, parseErg } from "./amount";
import { setNumberLang, units } from "../../ui/engine/money";
import { balanceOf, checkDestination, maxWithdraw, mempoolCreatesReserve, planCancel, planCombine, planT1, planWithdraw, spendable, t1CreateBody } from "./coins";
import {
  PREV_NOTE_AHEAD_MS, checkPreviousNote, coverage, laterNoteCovers, noteBody, noteEntryFields, noteTimestamp, pairJournalOf, pairStateOf, reserveCoverage, reserveTag, signNote, storedIsEntry,
} from "./notes";
import { decodeReceipt, encodeReceipt, fragmentOf, parseRequest, receiptLink, requestLink, verifyReceipt } from "./receipt";
import { REDEEM_MIN, noteView, payoutOf, redeemableAmount, submitBodyOf, submitVerdict } from "./redeem";
import { FAILED_FOLLOW_BLOCKS, FINAL_RECHECK_DEPTH, depthAt, followsFailed, followsFinal, nextTrackState } from "./track";
import { localProblem, problemOf } from "../net";
import { parseWatchStore, unwatchIssuer, watchExtras, watchIssuer } from "./watch";

const SK_A = secretBytes(2n), SK_B = secretBytes(3n);
const A = bytesToHex(publicKeyOf(SK_A)), B = bytesToHex(publicKeyOf(SK_B));
const T0 = 1_795_000_000_000;

describe("amounts", () => {
  afterEach(() => setNumberLang("en"));

  it("reads what people type, exactly, and refuses the rest", () => {
    expect(parseErg("1.5")).toBe(1_500_000_000n);
    expect(parseErg("1,5")).toBe(1_500_000_000n);
    expect(parseErg(" 0.001 ")).toBe(1_000_000n);
    expect(parseErg("1 000.000000001")).toBe(1_000_000_000_001n);
    expect(parseErg(".25")).toBe(250_000_000n);
    for (const bad of ["", "0", "0.0", "-1", "1.0000000001", "abc", "1e9", "1.2.3"]) expect(parseErg(bad)).toBeNull();
  });

  it("EN: a dot decimal; a comma before exactly three digits is a thousands group, refused, never 1 ERG (money P2-7)", () => {
    expect(parseErg("1,000", "en")).toBeNull();
    expect(parseErg("0,001", "en")).toBeNull();
    expect(parseErg("1,240.50", "en")).toBeNull();
    expect(parseErg("1,5", "en")).toBe(1_500_000_000n);
    expect(parseErg("1,0001", "en")).toBe(1_000_100_000n);
    expect(parseErg("9.545", "en")).toBe(9_545_000_000n);
    expect(parseErg("1240.5", "en")).toBe(1_240_500_000_000n);
    expect(ergInput(9_545_000_000n, "en")).toBe("9.545");
  });

  it("RU: a decimal comma and spaced groups, as the page shows them", () => {
    expect(parseErg("9,545", "ru")).toBe(9_545_000_000n);
    expect(parseErg("0,001", "ru")).toBe(1_000_000n);
    expect(parseErg("1 240,00", "ru")).toBe(1_240_000_000_000n);
    expect(parseErg("1\u2009\u2060240,5", "ru")).toBe(1_240_500_000_000n);
    expect(parseErg("1\u00a0240,5", "ru")).toBe(1_240_500_000_000n);
    expect(parseErg("2.5", "ru")).toBe(2_500_000_000n);
    expect(parseErg("1.240,5", "ru")).toBeNull();
    expect(parseErg("1,2,3", "ru")).toBeNull();
    expect(ergInput(9_545_000_000n, "ru")).toBe("9,545");
    expect(ergInput(12n * 1_000_000_000n, "ru")).toBe("12");
    // the page language is the default: what the language switch sets (setNumberLang)
    setNumberLang("ru");
    expect(parseErg("0,5")).toBe(500_000_000n);
    expect(ergInput(500_000_000n)).toBe("0,5");
    expect(units(9_545_000_000n, 9, 3)).toBe("9,545");
    expect(units(1_240_000_000_000n, 9, 2)).toBe("1\u2009\u2060240,00");
    setNumberLang("en");
    expect(parseErg("0,500")).toBeNull();
    expect(ergInput(500_000_000n)).toBe("0.5");
    expect(units(1_240_000_000_000n, 9, 2)).toBe("1,240.00");
  });

  it("machine text stays plain", () => {
    expect(ergPlain(1_500_000_000n)).toBe("1.5");
    expect(ergPlain(1_000_000n)).toBe("0.001");
    expect(ergPlain(12n * 1_000_000_000n)).toBe("12");
    expect(dpOf(1_000_000n)).toBe(3);
    expect(dpOf(1_500_000_000n)).toBe(2);
    expect(dpOf(1n)).toBe(9);
  });
});

describe("receipts and requests", () => {
  const signed = signNote(SK_A, { issuer: A, recipient: B, total: 300_000_000n, timestamp: BigInt(T0) });

  it("a receipt round-trips through the fragment and is verified before use", () => {
    const text = encodeReceipt(signed.receipt);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    const link = receiptLink("https://basis.ergoscan.me", signed.receipt);
    expect(link.startsWith("https://basis.ergoscan.me/wallet/mainnet/receive#note=")).toBe(true);
    const back = decodeReceipt(fragmentOf(new URL(link).hash).note);
    expect(back).toEqual({ ok: true, receipt: signed.receipt });
    expect(verifyReceipt(signed.receipt)).toBe(true);
  });

  it("refuses a changed total, another tracker, a bad signature and junk", () => {
    const j = (o: Record<string, unknown>) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const base = { v: 1, nft: TRACKER_NFT, i: A, r: B, a: "300000000", ts: String(T0), s: signed.signature };
    expect(decodeReceipt(j(base)).ok).toBe(true);
    expect(decodeReceipt(j({ ...base, a: "300000001" }))).toEqual({ ok: false, reason: "signature" });
    expect(decodeReceipt(j({ ...base, nft: "11".repeat(32) }))).toEqual({ ok: false, reason: "tracker" });
    expect(decodeReceipt(j({ ...base, v: 2 }))).toEqual({ ok: false, reason: "version" });
    expect(decodeReceipt(j({ ...base, r: A }))).toEqual({ ok: false, reason: "same-key" });
    expect(decodeReceipt(j({ ...base, i: "04" + "11".repeat(32) }))).toEqual({ ok: false, reason: "keys" });
    expect(decodeReceipt("!!!")).toEqual({ ok: false, reason: "format" });
    expect(decodeReceipt(j({ ...base, a: 3 }))).toEqual({ ok: false, reason: "format" });
    // a timestamp no Date can show is refused before anything renders it (keys P2-4), even when signed for real
    const far = signNote(SK_A, { issuer: A, recipient: B, total: 1n, timestamp: 8_640_000_000_000_001n });
    expect(decodeReceipt(j({ ...base, a: "1", ts: "8640000000000001", s: far.signature }))).toEqual({ ok: false, reason: "format" });
    const last = signNote(SK_A, { issuer: A, recipient: B, total: 1n, timestamp: 8_640_000_000_000_000n });
    const ok = decodeReceipt(j({ ...base, a: "1", ts: "8640000000000000", s: last.signature }));
    expect(ok.ok && new Date(Number(ok.receipt.timestamp)).toISOString()).toBe("+275760-09-13T00:00:00.000Z");
  });

  it("a payment request names a key, maybe an amount, and only our tracker", () => {
    const link = requestLink("https://x", { to: B, amount: 250_000_000n, nft: TRACKER_NFT });
    expect(link).toBe(`https://x/wallet/mainnet/pay#to=${B}&amount=250000000&nft=${TRACKER_NFT}`);
    expect(parseRequest(new URL(link).hash)).toEqual({ to: B, amount: 250_000_000n, nft: TRACKER_NFT });
    expect(parseRequest(`#to=${B}`)).toEqual({ to: B, amount: null, nft: TRACKER_NFT });
    expect(parseRequest(`#to=${B}&nft=${"11".repeat(32)}`)).toBeNull();
    expect(parseRequest(`#to=nothing`)).toBeNull();
    expect(parseRequest(`#to=${B}&amount=-5`)!.amount).toBeNull();
  });
});

describe("notes", () => {
  it("the timestamp is after the pair's last note and 2 s behind the tracker's clock", () => {
    expect(noteTimestamp(null, T0)).toBe(BigInt(T0 - 2000));
    expect(noteTimestamp(BigInt(T0 - 5000), T0)).toBe(BigInt(T0 - 2000));
    expect(noteTimestamp(BigInt(T0), T0)).toBe(BigInt(T0 + 1));
  });

  it("the body is the tracker's CreateNoteRequest, signed over the 80-byte message", () => {
    const s = signNote(SK_A, { issuer: A, recipient: B, total: 600_000_000n, timestamp: 1_795_351_000_000n });
    expect(s.body).toBe(`{"recipient_pubkey":"${B}","amount":600000000,"timestamp":1795351000000,"signature":"${s.signature}","issuer_pubkey":"${A}","tracker_nft_id":"${TRACKER_NFT}","denomination":"erg"}`);
    expect(noteBody({ issuer: A, recipient: B, total: 600_000_000n, timestamp: 1_795_351_000_000n, signature: s.signature })).toBe(s.body);
    expect(verifyBasis(A, noteMessage({ issuer: A, recipient: B, totalDebt: 600_000_000n, timestamp: 1_795_351_000_000n, trackerNft: TRACKER_NFT }), s.signature)).toBe(true);
    expect(() => signNote(SK_A, { issuer: A, recipient: A, total: 1n, timestamp: 1n })).toThrow();
    expect(() => signNote(SK_B, { issuer: A, recipient: B, total: 1n, timestamp: 1n })).toThrow();
  });

  it("pair state and coverage (the passphrase rule is the vault's: vault/__tests__/policy.test.ts)", () => {
    const n = parseStoredNote(TEXT.frontNote);
    expect(pairStateOf(n)).toEqual({ total: n.amountCollected, redeemed: n.amountRedeemed, timestamp: n.timestamp });
    expect(pairStateOf(null)).toBeNull();
    expect(coverage(1_000_000_000n, 500_000_000n)).toBe(200);
    expect(coverage(1n, 0n)).toBeNull();
    // a redemption mined, not yet counted by the tracker: the low figure settles (money P2-8)
    expect(reserveCoverage({ collateral: 500_000_000n, debt: 1_000_000_000n, pendingRedemption: 500_000_000n })).toEqual({ pct: 50, settled: 100, settling: true });
    expect(reserveCoverage({ collateral: 500_000_000n, debt: 1_000_000_000n, pendingRedemption: 0n })).toEqual({ pct: 50, settled: 50, settling: false });
  });
  it("the tag says settling while a redemption waits and the reserve is covered once it counts; a shortfall keeps its band", () => {
    // the case seen on 22 Nov: 0.15 ERG against 0.20 promised, 0.05 of it already redeemed → 100 % settled, was «Тревога»
    expect(reserveTag({ collateral: 150_000_000n, debt: 200_000_000n, pendingRedemption: 50_000_000n })).toEqual({ kind: "settling" });
    expect(reserveTag({ collateral: 150_000_000n, debt: 100_000_000n, pendingRedemption: 100_000_000n })).toEqual({ kind: "settling" });
    expect(reserveTag({ collateral: 50_000_000n, debt: 200_000_000n, pendingRedemption: 50_000_000n })).toEqual({ kind: "band", pct: 25 });
    expect(reserveTag({ collateral: 150_000_000n, debt: 200_000_000n, pendingRedemption: 0n })).toEqual({ kind: "band", pct: 75 });
    expect(reserveTag({ collateral: 110_000_000n, debt: 100_000_000n, pendingRedemption: 0n })).toEqual({ kind: "band", pct: 110 });
    expect(reserveTag({ collateral: 150_000_000n, debt: 0n, pendingRedemption: 0n })).toEqual({ kind: "none" });
  });
});

describe("the pair's previous note, before a new one is signed on top of it", () => {
  const NOW = T0;
  const stored = (o: Partial<StoredNote> = {}, signedTotal?: bigint): StoredNote => {
    const total = o.amountCollected ?? 500_000_000n;
    const ts = o.timestamp ?? BigInt(NOW - 60_000);
    const sig = signNote(SK_A, { issuer: A, recipient: B, total: signedTotal ?? total, timestamp: ts }).signature;
    return { issuer: A, recipient: B, amountCollected: total, amountRedeemed: 100_000_000n, timestamp: ts, signature: sig, trackerNft: TRACKER_NFT, denomination: "erg", confirmation: null, ...o };
  };
  const want = (accepted = 0n) => ({ issuer: A, recipient: B, accepted, serverNowMs: NOW });
  let n = 0;
  const entry = (state: JournalState, total: bigint, o: { attempts?: number; to?: string; pub?: string; sig?: string; ts?: bigint } = {}): JournalEntry => {
    n++;
    return {
      v: 1, id: `e${n}`, kind: "note", pub: o.pub ?? A, state, txId: null, signedRaw: "{}", unsignedRaw: null, inputs: [], createdAt: n, updatedAt: n,
      sendAttempts: o.attempts ?? 1, firstSendAt: null, lastSendAt: null, lastHeight: null, inclusionHeight: null, error: null, retiredAt: null,
      meta: { to: o.to ?? B, total: total.toString(), ts: String(o.ts ?? BigInt(NOW - 1000 + n)), sig: o.sig ?? "ab".repeat(65), status: "draft" },
    };
  };

  it("a note of this key passes, with what it says; none is fine only when the journal knows of no accepted one", () => {
    const s = stored();
    expect(checkPreviousNote(s, want())).toEqual({ ok: true, prev: { total: 500_000_000n, redeemed: 100_000_000n, timestamp: s.timestamp, signature: s.signature } });
    expect(checkPreviousNote(null, want())).toEqual({ ok: true, prev: null });
    expect(checkPreviousNote(null, want(1n))).toMatchObject({ ok: false, rule: "prev-missing" });
  });

  it("an inflated total, a foreign or broken signature, another tracker, another pair or token: refused", () => {
    // the attack of P0-1: the tracker raises amount_collected, the signature is still the one over the real total
    expect(checkPreviousNote(stored({ amountCollected: 50_000_000_000n }, 1_000_000_000n), want())).toMatchObject({ ok: false, rule: "prev-signature" });
    const otherKey = signNote(SK_B, { issuer: B, recipient: A, total: 500_000_000n, timestamp: BigInt(NOW - 60_000) }).signature;
    expect(checkPreviousNote(stored({ signature: otherKey }), want())).toMatchObject({ ok: false, rule: "prev-signature" });
    expect(checkPreviousNote(stored({ signature: "00".repeat(65) }), want())).toMatchObject({ ok: false, rule: "prev-signature" });
    expect(checkPreviousNote(stored({ timestamp: BigInt(NOW - 59_000) }, undefined), want()).ok).toBe(true);
    const moved = stored();
    expect(checkPreviousNote({ ...moved, timestamp: moved.timestamp + 1n }, want())).toMatchObject({ ok: false, rule: "prev-signature" });
    expect(checkPreviousNote(stored({ trackerNft: "11".repeat(32) }), want())).toMatchObject({ ok: false, rule: "prev-tracker" });
    expect(checkPreviousNote(stored({ denomination: "token" }), want())).toMatchObject({ ok: false, rule: "prev-denomination" });
    expect(checkPreviousNote(stored({ recipient: A }), want())).toMatchObject({ ok: false, rule: "prev-pair" });
    expect(checkPreviousNote(stored(), { ...want(), issuer: B })).toMatchObject({ ok: false, rule: "prev-pair" });
  });

  it("dated after the tracker's clock (beyond the margin) or older than what the tracker took from this browser: refused", () => {
    expect(checkPreviousNote(stored({ timestamp: BigInt(NOW + PREV_NOTE_AHEAD_MS) }), want()).ok).toBe(true);
    expect(checkPreviousNote(stored({ timestamp: BigInt(NOW + PREV_NOTE_AHEAD_MS + 1) }), want())).toMatchObject({ ok: false, rule: "prev-ahead" });
    expect(checkPreviousNote(stored(), want(500_000_000n)).ok).toBe(true);
    expect(checkPreviousNote(stored(), want(500_000_001n))).toMatchObject({ ok: false, rule: "prev-older" });
  });

  it("the journal: accepted = the highest sent, committed or final total; uncertain = sent once without an answer", () => {
    const list = [
      entry("final", 300_000_000n), entry("sent", 500_000_000n), entry("failed", 900_000_000n), entry("abandoned", 950_000_000n),
      entry("signed", 800_000_000n, { attempts: 0 }), entry("signed", 700_000_000n), entry("signed", 750_000_000n),
      entry("confirmed", 990_000_000n, { to: "02" + "77".repeat(32) }), entry("sent", 999_000_000n, { pub: B }),
    ];
    const pj = pairJournalOf(list, A, B);
    expect(pj.accepted).toBe(500_000_000n);
    expect(pj.uncertain.map((e) => e.meta.total)).toEqual(["750000000", "700000000"]);
    expect(pairJournalOf([], A, B)).toEqual({ accepted: 0n, uncertain: [] });
    expect(noteEntryFields({ ...list[0], meta: { to: B, total: "1e9", ts: "1", sig: "x" } })).toBeNull();
  });

  it("a stored note is a recorded one only with the same total, timestamp and signature", () => {
    const s = stored();
    const e = entry("signed", s.amountCollected, { ts: s.timestamp, sig: s.signature });
    expect(storedIsEntry(s, e)).toBe(true);
    expect(storedIsEntry({ ...s, amountCollected: s.amountCollected + 1n }, e)).toBe(false);
    expect(storedIsEntry({ ...s, timestamp: s.timestamp + 1n }, e)).toBe(false);
    expect(storedIsEntry({ ...s, signature: "cd".repeat(65) }, e)).toBe(false);
    expect(storedIsEntry({ ...s, recipient: A }, e)).toBe(false);
  });
});

it("a later note of the same key covers an unanswered one when its total is at least as high (two devices)", () => {
  expect(laterNoteCovers({ total: 5n }, { total: 5n })).toBe(true);
  expect(laterNoteCovers({ total: 7n }, { total: 5n })).toBe(true);
  expect(laterNoteCovers({ total: 4n }, { total: 5n })).toBe(false);
});

describe("coins", () => {
  const big = p2pkBox(A, 1_100_000_000n);
  const small = p2pkBox(A, 50_000_000n, { index: 1 });
  const token = p2pkBox(A, 2_000_000n, { index: 2, tokens: [{ tokenId: "44".repeat(32), amount: 5n }] });
  const list = [{ box: big, height: 1922300 }, { box: small, height: 1922301 }, { box: token, height: 1922302 }, { box: p2pkBox(A, 9n * 1_000_000_000n, { index: 3 }), height: null }];

  it("spendable: confirmed, not in flight, not spent in the mempool; the balance counts them", () => {
    const usable = spendable(list, new Set([small.boxId]), [{ id: "aa".repeat(32), spends: [token.boxId], outputs: [] }]);
    expect(usable.map((b) => b.boxId)).toEqual([big.boxId]);
    expect(balanceOf(list, usable)).toMatchObject({ nano: 1_100_000_000n, free: 1_100_000_000n, boxes: 1, inFlight: 3 });
    expect(balanceOf(list, spendable(list, new Set()))).toMatchObject({ nano: 1_152_000_000n, tokenBoxes: 1 });
  });

  it("T1 plan: amount limits, short funds, the create body, and a T1 the checks accept", () => {
    const usable = spendable(list, new Set());
    expect(planT1(usable, A, 50_000_000n, MINER_FEE_NANOERG, 1_000_000_000n)).toMatchObject({ ok: false, why: "amount" });
    expect(planT1(usable, A, 2_000_000_000n, MINER_FEE_NANOERG, 1_000_000_000n)).toMatchObject({ ok: false, why: "amount" });
    expect(planT1([small], A, 100_000_000n, MINER_FEE_NANOERG, 1_000_000_000n)).toMatchObject({ ok: false, why: "short", have: 50_000_000n });
    const p = planT1(usable, A, 1_000_000_000n, MINER_FEE_NANOERG, 1_000_000_000n);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.plan).toMatchObject({ amount: 1_000_000_000n, nftId: big.boxId, change: 99_000_000n });
    expect(t1CreateBody(p.plan, A)).toBe(`{"nft_id":"${big.boxId}","owner_pubkey":"${A}","erg_amount":1000000000}`);
    expect(JSON.parse(t1CreateBody(p.plan, A)).erg_amount).toBe(1_000_000_000);
    const tx = buildReserveCreation({ owner: A, inputs: p.plan.inputs, amount: p.plan.amount, fee: MINER_FEE_NANOERG, height: 1922310 });
    expect(checkReserveCreation(tx, p.plan.inputs, { owner: A, amount: p.plan.amount, fee: MINER_FEE_NANOERG, height: 1922310, cap: 1_000_000_000n })).toEqual({ ok: true });
    const many = Array.from({ length: P2PK_MAX_INPUTS + 5 }, (_, i) => p2pkBox(A, 3_000_000n, { index: i }));
    expect(planT1(many, A, 150_000_000n, MINER_FEE_NANOERG, 1_000_000_000n)).toMatchObject({ ok: false, why: "too-many-boxes" });
    const combine = planCombine(many, A, p2pkAddress(A), 1922310);
    expect(combine).toMatchObject({ ok: true, count: P2PK_MAX_INPUTS, sent: 50n * 3_000_000n - MINER_FEE_NANOERG });
    expect(mempoolCreatesReserve([{ id: "a", spends: [], outputs: [{ ergoTree: p2pkTree(A), address: null, value: 1n }] }], { pub: A, address: p2pkAddress(A) })).toBeNull();
  });

  it("T1 precheck: a mempool reserve is this key's only by its R4, or by spending this key's boxes and no reserve (canary 22 Nov)", () => {
    const me = { pub: B, address: p2pkAddress(B) };
    const res = (r4?: string | null) => ({ ergoTree: RESERVE_TREE_HEX, address: reserveAddress(), value: 640_000_000n, ...(r4 === undefined ? {} : { r4 }) });
    const pay = { ergoTree: p2pkTree(B), address: p2pkAddress(B), value: 19_000_000n };
    const reserveIn = { boxId: "a1".repeat(32), ergoTree: RESERVE_TREE_HEX, address: reserveAddress() };
    const mineIn = { boxId: "b1".repeat(32), ergoTree: p2pkTree(B), address: p2pkAddress(B) };
    // the live case: B redeemed 0.02 ERG from A's reserve; the new reserve box is A's (R4 = 07‖A)
    const redemption = { id: "r", spends: [reserveIn.boxId], inputs: [reserveIn], outputs: [res(`07${A}`), pay] };
    expect(mempoolCreatesReserve([redemption], me)).toBeNull();
    expect(mempoolCreatesReserve([{ ...redemption, outputs: [res(), pay] }], me)).toBeNull(); // no registers: it spends a reserve
    // B's own T1: found by R4, or, without registers, by spending B's boxes and no reserve
    const t1 = { id: "t", spends: [mineIn.boxId], inputs: [mineIn], outputs: [res(`07${B}`), pay] };
    expect(mempoolCreatesReserve([redemption, t1], me)?.id).toBe("t");
    expect(mempoolCreatesReserve([{ ...t1, outputs: [res(), pay] }], me)?.id).toBe("t");
    expect(mempoolCreatesReserve([{ ...t1, outputs: [res(null), pay] }], me)).toBeNull(); // registers given, no R4
    expect(mempoolCreatesReserve([{ ...t1, inputs: undefined, outputs: [res(), pay] }], me)).toBeNull(); // nothing proves it is B's
  });

  it("Cancel a refused transaction: one of its own boxes back to the key, the smallest that pays the fee, tokens kept", () => {
    const own = p2pkAddress(A);
    const tiny = p2pkBox(A, 1_500_000n, { index: 7 });
    const c = planCancel([big.boxId, small.boxId, tiny.boxId], [big, small, tiny, token], A, own, 1922310);
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    expect(c.inputs.map((b) => b.boxId)).toEqual([small.boxId]); // tiny cannot pay the fee and keep 0.001 ERG
    expect(c.tx.outputs.map((o) => [o.ergoTree, o.value])).toEqual([[p2pkTree(A), 50_000_000n - MINER_FEE_NANOERG], [FEE_TREE_HEX, MINER_FEE_NANOERG]]);
    expect(checkWithdraw(c.tx, c.inputs, { owner: A, to: own, amount: c.sent, fee: MINER_FEE_NANOERG, height: 1922310 })).toEqual({ ok: true });
    const rich = p2pkBox(A, 10_000_000n, { index: 8, tokens: [{ tokenId: "45".repeat(32), amount: 9n }] });
    const t = planCancel([rich.boxId], [rich], A, own, 1922310);
    expect(t.ok && t.tx.outputs[1].tokens).toEqual([{ tokenId: "45".repeat(32), amount: 9n }]);
    expect(t.ok && t.change).toBe(1_000_000n);
    expect(planCancel([big.boxId], [small], A, own, 1922310)).toMatchObject({ ok: false, why: "short" }); // spent already
    expect(planCancel([tiny.boxId, token.boxId], [tiny, token], A, own, 1922310)).toMatchObject({ ok: false, why: "dust" });
  });

  it("Withdraw: destinations, the maximum, tokens stay, dust goes to the destination", () => {
    expect(checkDestination(p2pkAddress(B))).toMatchObject({ ok: true, p2pk: true });
    expect(checkDestination(reserveAddress())).toEqual({ ok: false, reason: "reserve" });
    expect(checkDestination(p2pkAddress(A), p2pkAddress(A))).toEqual({ ok: false, reason: "own" });
    expect(checkDestination("9notAnAddress")).toMatchObject({ ok: false });
    expect(checkDestination("")).toEqual({ ok: false, reason: "format" });
    const usable = [big, small, token];
    expect(maxWithdraw(usable)).toBe(1_150_000_000n - MINER_FEE_NANOERG);
    const to = p2pkAddress(B);
    const w = planWithdraw(usable, A, to, 1_149_500_000n, MINER_FEE_NANOERG, 1922310);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.sent).toBe(1_149_500_000n + 0n);
    expect(checkWithdraw(w.tx, w.inputs, { owner: A, to, amount: w.sent, fee: MINER_FEE_NANOERG, height: 1922310 })).toEqual({ ok: true });
    const dusty = planWithdraw([big], A, to, 1_098_500_000n, MINER_FEE_NANOERG, 1922310);
    expect(dusty.ok && dusty.sent).toBe(1_099_000_000n);
    expect(dusty.ok && dusty.change).toBe(0n);
    expect(planWithdraw([small], A, to, 900_000_000n, MINER_FEE_NANOERG, 1922310)).toMatchObject({ ok: false, why: "short" });
    expect(planWithdraw([small], A, to, 10n, MINER_FEE_NANOERG, 1922310)).toMatchObject({ ok: false, why: "dust" });
  });
});

describe("receiver's view", () => {
  it("only the committed total is redeemable; the payout is the amount minus the fee", () => {
    const n = parseStoredNote(TEXT.frontNote);
    const v = noteView(n);
    expect(v.total).toBe(n.amountCollected);
    expect(v.outstanding).toBe(n.amountCollected - n.amountRedeemed);
    const local = noteView({ ...n, confirmation: { status: "local_only", confirmedTotalDebt: null, redeemable: false, redeemableAmount: 0n, confirmedBoxId: null, confirmedHeight: null } });
    expect(local).toMatchObject({ stage: "local", redeemableNow: 0n });
    const committed = noteView({ ...n, confirmation: { status: "confirmed", confirmedTotalDebt: n.amountCollected, redeemable: true, redeemableAmount: 150_000_000n, confirmedBoxId: null, confirmedHeight: 1922366 } });
    expect(committed).toMatchObject({ stage: "committed", redeemableNow: 150_000_000n });
    expect(redeemableAmount(100_000_000n, committed)).toBe("ok");
    expect(redeemableAmount(200_000_000n, committed)).toBe("above");
    expect(redeemableAmount(1_000_000n, committed)).toBe("below-min");
    expect(redeemableAmount(1_000_000n, local)).toBe("none");
    expect(payoutOf(100_000_000n)).toBe(99_000_000n);
    expect(REDEEM_MIN).toBe(2_000_000n);
  });
});

describe("redemption submit from the journal", () => {
  it("rebuilds the submit body byte for byte", () => {
    const s = syntheticRedemption();
    const l1 = checkRedemption(parseBuildResponse(s.text), s.chain, s.expect);
    if (!l1.ok) throw new Error(l1.message);
    const signed = signRedemption(l1, secretBytes(s.recipient.secret));
    const body = redemptionSubmitBody(l1, signed);
    expect(submitBodyOf({ signedRaw: signed.signedRaw, unsignedRaw: l1.build.unsignedRaw, issuer: l1.expect.issuer, recipient: l1.expect.recipient, amount: l1.expect.amount, newRedeemed: l1.build.newAlreadyRedeemed })).toBe(body);
    expect(submitBodyOf({ signedRaw: signed.signedRaw, unsignedRaw: l1.build.unsignedRaw, issuer: l1.expect.issuer, recipient: l1.expect.recipient, amount: l1.expect.amount + 1n, newRedeemed: l1.build.newAlreadyRedeemed })).not.toBe(body);
  });

  it("what a submit answer means: only a definite refusal closes it, a used build after an attempt is in doubt", () => {
    const env = (error: string) => JSON.stringify({ success: false, data: null, error });
    const at = (status: number, text: string) => problemOf("submit", { ok: true, status, text, retryAfterMs: null, sentAt: 0, receivedAt: 1 });
    const used = at(409, env("Unknown, expired or already-used unsigned_tx. Call POST /redemption/build again to obtain a fresh one."));
    expect(submitVerdict(null, 0)).toBe("sent");
    expect(submitVerdict(used, 0)).toBe("failed"); // our first attempt: the build was never ours to use
    expect(submitVerdict(used, 1)).toBe("in-doubt"); // most likely our earlier attempt used it
    expect(submitVerdict(at(500, env("the node did not answer for redemption x; the tracker watches the chain for it")), 0)).toBe("sent");
    expect(submitVerdict(at(500, env("the node did not accept redemption x; build it again with POST /redemption/build")), 0)).toBe("failed");
    expect(submitVerdict(at(500, env("the tracker cannot record redemption x, so it did not submit it; build it again")), 2)).toBe("failed");
    expect(submitVerdict(at(400, env("partial_tx does not match")), 0)).toBe("failed");
    expect(submitVerdict(localProblem("too-large"), 0)).toBe("failed");
    for (const p of [at(408, ""), at(500, env("other")), at(502, "<html>"), at(429, env("slow down")), localProblem("timeout"), localProblem("network"), localProblem("aborted")]) {
      expect(submitVerdict(p, 0)).toBe("unknown");
      expect(submitVerdict(p, 3)).toBe("unknown");
    }
  });
});

describe("watched issuers", () => {
  it("keeps verified receipts per key, newest first, never the key itself", () => {
    const r1 = signNote(SK_A, { issuer: A, recipient: B, total: 1n, timestamp: 10n }).receipt;
    const r2 = signNote(SK_A, { issuer: A, recipient: B, total: 2n, timestamp: 20n }).receipt;
    let l = watchIssuer([], B, A, { receipt: r2, now: 5 });
    l = watchIssuer(l, B, A, { receipt: r1, name: "Alice" });
    expect(l).toEqual([{ pk: A, name: "Alice", addedAt: 5, receipt: { total: "2", timestamp: "20", signature: r2.signature } }]);
    expect(watchIssuer(l, B, B)).toEqual(l);
    const store = parseWatchStore(JSON.stringify({ [B]: [...l, { pk: "junk" }, l[0]] }));
    expect(store[B]).toEqual(l);
    expect(parseWatchStore("{")).toEqual({});
    expect(watchExtras(l)).toEqual({ watchedIssuers: [A], contacts: [{ pub: A, name: "Alice" }] });
    expect(unwatchIssuer(l, A)).toEqual([]);
  });
});

describe("following a transaction", () => {
  const e = (state: "signed" | "sent" | "mempool" | "confirmed", inclusionHeight: number | null = null) => ({ state, inclusionHeight, sendAttempts: 1 });
  it("mempool → depth 1 → depth 2 is final; a drop goes back to sent; only proof fails it", () => {
    expect(nextTrackState(e("sent"), { status: null, inMempool: true })).toEqual({ state: "mempool", inclusionHeight: null });
    expect(nextTrackState(e("mempool"), { status: null, inMempool: true })).toBeNull();
    expect(nextTrackState(e("mempool"), { status: { inclusionHeight: 100, confirmations: 1 }, inMempool: false })).toEqual({ state: "confirmed", inclusionHeight: 100 });
    expect(nextTrackState(e("confirmed", 100), { status: { inclusionHeight: 100, confirmations: 2 }, inMempool: false })).toEqual({ state: "final", inclusionHeight: 100 });
    expect(nextTrackState(e("mempool"), { status: null, inMempool: false })).toEqual({ state: "sent", inclusionHeight: null });
    expect(nextTrackState(e("sent"), { status: null, inMempool: false })).toBeNull();
    expect(nextTrackState(e("sent"), { status: null, inMempool: false, conflict: true })!.state).toBe("failed");
    expect(nextTrackState(e("sent"), { status: null, inMempool: false, trackerBoxSpent: true })!.error).toContain("Build again");
    expect(depthAt(100, 101)).toBe(2);
    expect(depthAt(null, 101)).toBe(0);
  });

  it("a failed entry that was sent is looked for 30 more blocks; only the chain reopens it", () => {
    const f = { state: "failed" as const, inclusionHeight: null, sendAttempts: 1 };
    expect(nextTrackState(f, { status: { inclusionHeight: 200, confirmations: 1 }, inMempool: false })).toEqual({ state: "confirmed", inclusionHeight: 200 });
    expect(nextTrackState(f, { status: { inclusionHeight: 200, confirmations: 3 }, inMempool: false })).toEqual({ state: "final", inclusionHeight: 200 });
    expect(nextTrackState(f, { status: null, inMempool: true })).toEqual({ state: "mempool", inclusionHeight: null });
    expect(nextTrackState(f, { status: null, inMempool: false, conflict: true, trackerBoxSpent: true })).toBeNull();
    const tx = { state: "failed" as const, txId: "ab".repeat(32), sendAttempts: 1, meta: { failedAt: 1000 } };
    expect(followsFailed(tx, 1000 + FAILED_FOLLOW_BLOCKS)).toBe(true);
    expect(followsFailed(tx, 1001 + FAILED_FOLLOW_BLOCKS)).toBe(false);
    expect(followsFailed({ ...tx, meta: {} }, 5000)).toBe(true); // the watcher stamps the height first
    expect(followsFailed({ ...tx, sendAttempts: 0 }, 1000)).toBe(false); // never sent: nothing to look for
    expect(followsFailed({ ...tx, txId: null }, 1000)).toBe(false);
    expect(followsFailed({ ...tx, state: "final" }, 1000)).toBe(false);
  });

  it("a final entry is checked again until depth 10: a deep reorg sends it back", () => {
    const fin = { state: "final" as const, inclusionHeight: 500, sendAttempts: 1 };
    expect(nextTrackState(fin, { status: { inclusionHeight: 500, confirmations: 4 }, inMempool: false })).toBeNull();
    expect(nextTrackState(fin, { status: { inclusionHeight: 503, confirmations: 1 }, inMempool: false })).toEqual({ state: "confirmed", inclusionHeight: 503 });
    expect(nextTrackState(fin, { status: null, inMempool: true })).toEqual({ state: "mempool", inclusionHeight: null });
    expect(nextTrackState(fin, { status: null, inMempool: false, conflict: true })).toEqual({ state: "sent", inclusionHeight: null });
    const e = { state: "final" as const, txId: "cd".repeat(32), inclusionHeight: 500 };
    expect(followsFinal(e, 500 + FINAL_RECHECK_DEPTH - 1)).toBe(true);
    expect(followsFinal(e, 500 + FINAL_RECHECK_DEPTH)).toBe(false);
    expect(followsFinal({ ...e, state: "confirmed" }, 501)).toBe(false);
  });
});

it("the R3 fixture parses with the strict reader (sanity for the receiver's screens)", () => {
  expect(() => parseJson(TEXT.r3Tracker)).not.toThrow();
});
