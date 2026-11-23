// The observatory model on the seed: exit classes equal the snapshot's, totals equal KNOWLEDGE §i.1, honest copy.
import { describe, expect, it } from "vitest";
import seedJson from "./seed.json";
import type { ApiBox, ApiTx, ExitClass, Seed } from "./types";
import { EMPTY_DIGEST, USE_LOOKALIKE_ID, USE_TOKEN_ID, assessExit, describeExit, formatUnits, p2sAddress } from "./decode";
import { boxDelta, boxDetail, boxLinks, buildObservatory, contractIndex, emptyLive, idleStatus, interpretTx, liveBoxFromApi, liveTrackerLookup, totalsSource, trackerLookup } from "./model";
import { CURRENT_TEMPLATES } from "./decode";

const seed = seedJson as unknown as Seed;
const H = seed.asOf.height;
const obs = buildObservatory({ seed, live: emptyLive(), tip: H });

const BANNED = [/trustless/i, /guarantee/i, /\bsafe\b/i, /unstoppable/i, /live on mainnet/i, /launched/i, /official/i, /\byield\b/i, /\bAPY\b/, /7 days/i, /2 ?%/, /bearer/i];

describe("exit assessment (same rules as KNOWLEDGE §i.1)", () => {
  it("gives every unspent reserve the snapshot's class", () => {
    expect(obs.unspent.length).toBe(58);
    for (const r of obs.unspent) expect([r.id, r.exit?.class]).toEqual([r.id, r.snapshotExit]);
  });

  it("counts 21 locked / 33 refund / 3 refund+redeem / 1 redeem-if-tracker, with the snapshot's value", () => {
    const n = (c: ExitClass) => obs.totals.exit[c].boxes;
    expect([n("locked"), n("refund"), n("refund+redeem"), n("redeem-if-tracker"), n("redeem"), n("refund+redeem-if-tracker")]).toEqual([21, 33, 3, 1, 0, 0]);
    for (const c of ["locked", "refund", "refund+redeem", "redeem-if-tracker"] as const) {
      expect(obs.totals.exit[c].nano.toString()).toBe(seed.totals.exit[c].nano);
      const tok = Object.fromEntries(obs.totals.exit[c].tokens.map((t) => [t.id, t.amount.toString()]));
      expect(tok).toEqual(seed.totals.exit[c].tokens);
    }
    expect(formatUnits(obs.totals.exit.locked.nano, 9)).toBe("4.14");
    expect(formatUnits(obs.totals.exit.refund.nano, 9)).toBe("4.748");
  });

  it("explains the special cases", () => {
    // the two malformed R4s (57fd28d1 holds its own NFT in R6; 43087367 names 160aca8a, which sits inside 57fd28d1)
    for (const id of ["57fd28d1", "43087367"]) expect(obs.unspent.find((r) => r.id.startsWith(id))?.exit?.reason.code).toBe("r4-invalid");
    const viaLocked = obs.unspent.filter((r) => r.exit?.reason.code === "tracker-locked" && !r.r6?.startsWith("b159ad5c"));
    expect(viaLocked.length).toBeGreaterThan(0);
    for (const r of viaLocked) expect(r.exit?.reason).toMatchObject({ releasable: false });
    // b159ad5c sits inside 96Hr reserve 188d9e34 (as that reserve's own NFT); its owner could free it with a refund
    const holder = obs.index.reserves.get("188d9e34ab82f338681441ececd1db3d5b1729071222895ad7fda505d1a3df24")!;
    expect(holder.exit?.reason.code).toBe("tracker-own-nft");
    const releasable = obs.unspent.filter((r) => r.r6?.startsWith("b159ad5c") && r.id !== holder.id);
    expect(releasable.length).toBe(12);
    for (const r of releasable) expect(r.exit?.reason).toMatchObject({ code: "tracker-locked", releasable: true });
    expect(releasable[0].exit?.line.en).toMatch(/comes free only if that reserve's owner completes a refund/);
    const unusedRef = obs.unspent.find((r) => r.exit?.class === "redeem-if-tracker")!;
    expect(unusedRef.id.startsWith("f444cbf4")).toBe(true);
    expect(unusedRef.exit?.reason).toMatchObject({ code: "tracker-unused", holder: "9gZLYYtsC6EUhj4SK2XySR9duVorTcQxHK8oE4ZTdUEpReTXcAK" });
    const live = obs.unspent.filter((r) => r.exit?.class === "refund+redeem");
    expect(live.map((r) => r.exit!.emergency?.open)).toEqual([true, true, true]);
    const empty = live.find((r) => r.r6?.startsWith("4e2eef33"))!;
    expect(empty.exit?.reason).toMatchObject({ code: "tracker-live", emptyTree: true });
    expect(empty.exit?.line.en).toMatch(/committed tree is empty/);
  });

  it("writes plain, allowed copy in EN and RU", () => {
    for (const r of obs.unspent) {
      for (const s of [r.exit!.line.en, r.exit!.line.ru]) {
        expect(s.length).toBeGreaterThan(20);
        for (const b of BANNED) expect(s).not.toMatch(b);
        expect(s).not.toMatch(/undefined|null|NaN/);
      }
      expect(r.exit!.line.ru).toMatch(/[а-я]/);
    }
  });

  it("follows the refund clock and a newly live tracker", () => {
    const refundable = obs.unspent.find((r) => r.exit?.class === "refund" && r.contract?.short === "pB9o")!;
    const c = refundable.contract!;
    const base = { ownerExit: c.ownerExit, ownerKey: refundable.owner!.key, tree: refundable.r5, r6: refundable.r6, ownNft: refundable.nft!.id, tracker: null };
    const pending = assessExit({ ...base, r7: H - 100, tip: H });
    expect(pending.refund).toBe("pending");
    expect(pending.refundClock).toMatchObject({ completesAt: H - 100 + 43200, blocksLeft: 43100 });
    expect(assessExit({ ...base, r7: H - 43200, tip: H }).refund).toBe("ready");
    // where the R6 NFT is has not been looked up yet: "checking", never "needs a tracker box"
    const unknown = assessExit({ ...base, r7: 0, tip: H });
    expect(unknown).toMatchObject({ class: "refund+redeem-checking", redeem: "checking", reason: { code: "tracker-unknown" } });
    expect(describeExit(unknown, "en")).toMatch(/checking where tracker NFT/i);
    expect(describeExit(unknown, "ru")).toMatch(/проверяем, где сейчас NFT трекера/i);
    expect(describeExit(unknown, "en")).not.toMatch(/tracker box appears|has not been checked/);
    expect(assessExit({ ...base, ownerExit: false, r7: 0, tip: H }).class).toBe("redeem-checking");
    const t = obs.index.trackers.get("34dd2a13c19a711f64f9259992adb13bf9c33424945c07b070b95744774d0319")!;
    const withLive = assessExit({ ...base, r7: 0, tip: H, tracker: trackerLookup(seed, t) });
    expect(withLive.class).toBe("refund+redeem");
    expect(describeExit(withLive, "en")).toMatch(/no longer needs its signature/);
  });
});

describe("which block the reserve totals stand for (home and /network label them with it)", () => {
  const listed = () => {
    const live = emptyLive();
    for (const hash of [CURRENT_TEMPLATES.erg, CURRENT_TEMPLATES.multiToken]) live.detector.templates[hash] = { total: 0, checkedAt: 1, checkedHeight: H + 5 };
    return { ...live, detector: { ...live.detector, checkedAt: 1, checkedHeight: H + 5 } };
  };
  it("is 'checking' until this tab has listed both current templates live: no snapshot numbers under a live label", () => {
    expect(totalsSource(buildObservatory({ seed, live: emptyLive(), tip: H + 5 }))).toBe("checking");
    const one = emptyLive();
    one.detector.templates[CURRENT_TEMPLATES.erg] = { total: 1, checkedAt: 1, checkedHeight: H + 5 };
    expect(totalsSource(buildObservatory({ seed, live: one, tip: H + 5 }))).toBe("checking");
  });
  it("is 'live' at the live height once both are listed, and needs that height", () => {
    const o = buildObservatory({ seed, live: listed(), tip: H + 7 });
    expect(totalsSource(o)).toBe("live");
    expect(o.height).toBe(H + 7);
    expect(totalsSource(buildObservatory({ seed, live: listed(), tip: null }))).toBe("checking");
  });
  it("is 'snapshot' when the live layer failed before that first look", () => {
    expect(totalsSource(buildObservatory({ seed, live: emptyLive(), tip: H + 5, status: { ...idleStatus(), online: false, lastError: "network down" } }))).toBe("snapshot");
    expect(totalsSource(buildObservatory({ seed, live: emptyLive(), tip: H + 5, status: { ...idleStatus(), lastError: "HTTP 502" } }))).toBe("snapshot");
  });
});

describe("a tracker NFT outside the seed", () => {
  const nft = "f5178dc4063042bdf77cd0f4a55d0893d6dbcf0b3d14eb4de25282b2c4e3f29f";
  it("is unknown (null) until the live layer answers, then a live tracker with its box height", () => {
    expect(liveTrackerLookup(seed, nft, undefined)).toBeNull();
    const key = seed.trackers.find((t) => t.lastTrackerBox)!.lastTrackerBox!.key;
    const box = liveBoxFromApi({
      boxId: "7c".repeat(32), transactionId: "ee".repeat(32), value: "1000000", creationHeight: H + 3, ergoTree: `0008cd${key}`, address: "",
      assets: [{ tokenId: nft, amount: "1" }], additionalRegisters: { R4: `07${key}`, R5: `64${"ab".repeat(32)}02032000` }, spentTransactionId: null,
    });
    expect(liveTrackerLookup(seed, nft, { checkedAt: 1, checkedHeight: H + 4, box, newCommits: [] })).toMatchObject({ status: "live", currentBox: "7c".repeat(32), trackerBoxHeight: H + 3 });
    expect(liveTrackerLookup(seed, nft, { checkedAt: 1, checkedHeight: H + 4, box: null, newCommits: [] })).toMatchObject({ status: "burned", trackerBoxHeight: null });
  });
});

describe("totals equal the snapshot (KNOWLEDGE: 99 / 58 / 41 / 12, 8.995 ERG + 3.4 USE + 2.7 look-alike)", () => {
  it("matches every headline number", () => {
    const t = obs.totals;
    expect([t.reserveBoxes, t.unspent, t.redemptions, t.trackerNfts]).toEqual([99, 58, 41, 12]);
    expect(formatUnits(t.unspentNano, 9)).toBe("8.995");
    const tok = Object.fromEntries(t.unspentTokens.map((x) => [x.id, x]));
    expect(formatUnits(tok[USE_TOKEN_ID].amount, 3)).toBe("3.4");
    expect(formatUnits(tok[USE_LOOKALIKE_ID].amount, 6)).toBe("2.7");
    expect(tok[USE_LOOKALIKE_ID].kind).toBe("use-lookalike");
    expect(t.unspentTokens.map((x) => x.kind)).toEqual(["use", "use-lookalike"]);   // real USE first, the look-alike next
    expect(formatUnits(t.redeemedNano, 9)).toBe("3.21");
    expect(t.depositedNano.toString()).toBe(seed.totals.depositedNano);
    expect([t.ownerKeys, t.malformedOwners, t.receivers]).toEqual([26, 2, 5]);
    expect([t.trackerBoxes, t.trackerBoxesReadable]).toEqual([seed.totals.trackerBoxes, seed.totals.trackerBoxesReadable]);
    expect(obs.owners.filter((o) => o.key).length).toBe(26);
    expect(obs.receivers.length).toBe(5);
    expect(obs.hostIndex).toMatchObject({ source: "seed", reserveCount: 17, listedKnown: 17, unspentHere: 58, notListed: 41 });
  });

  it("keeps tracker statuses, beats and the incident lists", () => {
    const by = Object.fromEntries(obs.trackers.map((t) => [t.nft.slice(0, 8), t.status]));
    expect(by).toEqual({
      dbfbbaf9: "locked", "160aca8a": "locked", "69c5d7a4": "stale", "5a79a4b3": "unused", "8b1ab583": "locked", "000b0695": "burned",
      b159ad5c: "locked", f7f55159: "burned", "4e2eef33": "live", "34dd2a13": "live", "1b8bf82d": "live", "3391ccf0": "burned",
    });
    const readable = obs.trackers.reduce((s, t) => s + t.beats.length, 0);
    expect(readable).toBe(seed.totals.trackerBoxesReadable);
    for (const t of obs.trackers) for (let i = 1; i < t.beats.length; i++) expect(t.beats[i]).toBeGreaterThanOrEqual(t.beats[i - 1]);
    expect(obs.incidents.burns.length).toBe(3);
    expect(obs.incidents.locks.length).toBe(4);
    expect(obs.incidents.basisNamedNfts.count).toBe(69);
    expect(obs.detector).toMatchObject({ watching: true, found: [] });
    expect(obs.detector.templates.map((x) => x.total)).toEqual([0, 0]);
  });

  it("links the lineage and redemptions", () => {
    for (const x of obs.redemptions) {
      const rin = obs.index.reserves.get(x.reserveIn)!;
      expect(rin.next).toBe(x.reserveOut);
      expect(obs.index.reserves.get(x.reserveOut)?.prev).toBe(x.reserveIn);
      expect(x.emergencyWindow).toBe((x.tracker?.age ?? 0) > 2160);
    }
    const first = obs.index.redemptions.get("18d155eaa1343d4738e7c13eef6b69d78ceab802595081aba274b0176cbeaf0d")!;
    expect(formatUnits(first.amount, 9)).toBe("0.05");
    expect(first.receiverLabel).toBe("Bob");
    expect(first.tracker?.age).toBe(799);
  });
});

// ── /v1 box and tx shapes built from seed facts (the same fields the API returns) ──
function apiReserveBox(id: string): ApiBox {
  const r = seed.reserves.find((x) => x.id === id)!;
  const c = contractIndex(seed).byId.get(r.contract)!;
  return {
    boxId: r.id, transactionId: r.tx, value: r.value, creationHeight: r.height, ergoTree: c.ergoTree, address: p2sAddress(c.ergoTree),
    assets: [{ tokenId: r.nft!.id, amount: 1 }, ...(r.collateral ? [{ tokenId: r.collateral.id, amount: r.collateral.amount }] : [])],
    additionalRegisters: Object.fromEntries(Object.entries(r.regs).map(([k, v]) => [k, { serializedValue: v!, sigmaType: "?" }])),
    spentTransactionId: r.spent?.tx ?? null,
  };
}

describe("interpreters for /v1 boxes and transactions", () => {
  it("decodes a reserve box from the explorer shape and finds its contract", () => {
    const b = apiReserveBox(seed.reserves[0].id);
    const lb = liveBoxFromApi(b);
    expect(lb.basis.key).toBe(seed.reserves[0].owner?.key ?? null);
    const d = boxDetail(seed, b, contractIndex(seed).byId.get(seed.reserves[0].contract)!.templateHash);
    expect(d.role).toBe("reserve");
    expect(d.addressMatches).toBe(true);
    expect(d.contract?.id).toBe(seed.reserves[0].contract);
    expect(d.registers.map((r) => r.name)).toEqual(Object.keys(seed.reserves[0].regs).sort());
  });

  it("explains a redemption: reserve in/out, tracker data input, payout, fee", () => {
    const x = seed.redemptions.find((y) => y.unit === "erg" && y.tracker)!;
    const rin = apiReserveBox(x.reserveIn);
    const rout = { ...apiReserveBox(x.reserveOut), transactionId: x.tx };
    const t = seed.trackers.find((y) => y.nft === x.tracker.nft)!;
    const trackerBox: ApiBox = {
      boxId: x.tracker.box, transactionId: "00".repeat(32), value: "1000000", creationHeight: x.tracker.height,
      ergoTree: `0008cd${x.tracker.key}`, address: x.tracker.addr, assets: [{ tokenId: t.nft, amount: 1 }],
      additionalRegisters: { R4: `07${x.tracker.key}`, R5: `64${EMPTY_DIGEST}032000` }, spentTransactionId: null,
    };
    const payout: ApiBox = {
      boxId: "11".repeat(32), transactionId: x.tx, value: x.amount, creationHeight: x.height, ergoTree: "0008cd" + x.owner.key,
      address: x.receiver, assets: [], additionalRegisters: {}, spentTransactionId: null,
    };
    const fee: ApiBox = {
      boxId: "22".repeat(32), transactionId: x.tx, value: x.fee, creationHeight: x.height,
      ergoTree: "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a70173007301", address: "2iHkR7CW", assets: [], additionalRegisters: {}, spentTransactionId: null,
    };
    const tx: ApiTx = { id: x.tx, inclusionHeight: x.height, timestamp: x.ts, inputs: [rin], dataInputs: [trackerBox], outputs: [rout, payout, fee], size: x.size };
    const d = interpretTx(seed, tx);
    expect(d.kind).toBe("redemption");
    expect(d.amount).toEqual({ unit: "erg", raw: BigInt(x.amount) });
    expect(d.reserveIn?.boxId).toBe(x.reserveIn);
    expect(d.reserveOut?.boxId).toBe(x.reserveOut);
    expect(d.tracker?.boxId).toBe(x.tracker.box);
    expect(d.trackerAge).toBe(x.tracker.age);
    expect(d.emergencyWindow).toBe(x.emergencyWindow);
    expect(d.receiver).toBe(x.receiver);
    expect(d.fee).toBe(BigInt(x.fee));
    expect(d.outputs.map((o) => o.role)).toEqual(["reserve-out", "payout", "fee"]);
  });

  it("finds the receiver when the miner fee comes out of the redeemed amount (no fee payer: ErgoScan's tracker, tx 378566d0)", () => {
    const CUR = contractIndex(seed).list.find((c) => c.current && c.kind === "erg")!;
    const own = seed.reserves.find((x) => !x.spent && x.owner && x.regs.R5)!;
    const nft = "0c".repeat(32), tx = "37".repeat(32);
    const res = (id: string, value: string, txId: string): ApiBox => ({
      boxId: id, transactionId: txId, value, creationHeight: H + 700, ergoTree: CUR.ergoTree, address: p2sAddress(CUR.ergoTree),
      assets: [{ tokenId: nft, amount: "1" }], additionalRegisters: { R4: own.regs.R4, R5: own.regs.R5, R6: `0e20${"f5".repeat(32)}` }, spentTransactionId: null,
    });
    const receiver = seed.redemptions[0].receiver;
    const out = (id: string, value: string, ergoTree: string, address: string): ApiBox => ({ boxId: id, transactionId: tx, value, creationHeight: H + 713, ergoTree, address, assets: [], additionalRegisters: {}, spentTransactionId: null });
    const d = interpretTx(seed, {
      id: tx, inclusionHeight: H + 714, timestamp: 1_795_380_957_650, size: 634,
      inputs: [{ ...res("d4".repeat(32), "100000000", "36".repeat(32)), spentTransactionId: tx }], dataInputs: [],
      outputs: [res("37".repeat(32), "80000000", tx), out("46".repeat(32), "19000000", "0008cd" + own.owner!.key, receiver),
        out("3a".repeat(32), "1000000", "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a70173007301", "2iHkR7CW")],
    });
    expect(d).toMatchObject({ kind: "redemption", amount: { unit: "erg", raw: 20_000_000n }, receiver, fee: 1_000_000n });
    expect(d.outputs.map((o) => o.role)).toEqual(["reserve-out", "payout", "fee"]);
  });
});

// ── after the snapshot: reserve boxes found live, spent ones included (the real case of 22–23 Nov 2026: ErgoScan's
//    test reserve 1 → 0.9 → … ERG, a box made and spent after the snapshot) ──
describe("reserves and redemptions after the snapshot, from the boxes alone", () => {
  const CUR = contractIndex(seed).list.find((c) => c.current && c.kind === "erg")!;
  const own = seed.reserves.find((x) => !x.spent && x.owner && x.regs.R5)!;
  const TRK = "4e2eef33d424388d6efec14a792020738dd47663007a2025afb1891b95e4e8b5";   // a live tracker of the seed
  const NFT = "0c".repeat(32);
  const [C0, R1, R2] = ["c0", "d1", "d2"].map((x) => x.repeat(32));
  const [A, B, C] = ["a1", "b1", "c1"].map((x) => x.repeat(32));
  const box = (id: string, tx: string, value: string, height: number, spentTx: string | null): ApiBox => ({
    boxId: id, transactionId: tx, value, creationHeight: height, settlementHeight: height + 1, ergoTree: CUR.ergoTree, address: p2sAddress(CUR.ergoTree),
    assets: [{ tokenId: NFT, amount: "1" }], additionalRegisters: { R4: own.regs.R4, R5: own.regs.R5, R6: `0e20${TRK}` }, spentTransactionId: spentTx,
  });
  // A (1 ERG, made by C0) → R1 → B (0.9) → R2 → C (0.65, unspent)
  const boxes = [box(A, C0, "1000000000", H + 463, R1), box(B, R1, "900000000", H + 473, R2), box(C, R2, "650000000", H + 485, null)];
  const live = () => {
    const l = emptyLive();
    for (const b of boxes) l.extraReserves[b.boxId] = liveBoxFromApi(b);
    return l;
  };
  const S = seed.totals;

  it("counts each redemption once: in the totals, the list, the reserve's lineage and its tracker", () => {
    const o = buildObservatory({ seed, live: live(), tip: H + 600 });
    expect(o.totals.redemptions).toBe(41 + 2);
    expect(o.redemptions.length).toBe(43);
    expect(o.totals.redeemedNano - BigInt(seed.totals.redeemedNano)).toBe(100_000_000n + 250_000_000n);
    expect(o.totals.byContract[CUR.id]).toMatchObject({ boxes: 3, unspent: 1, redemptions: 2 });
    const [r2, r1] = o.redemptions.filter((x) => x.fromBoxes);
    expect(r2).toMatchObject({ tx: R2, height: H + 486, reserveIn: B, reserveOut: C, amount: 250_000_000n, unit: "erg", receiver: null, tracker: null, trackerNft: TRK, source: "live" });
    expect(r2.owner).toEqual({ key: own.owner!.key, addr: own.owner!.addr });
    expect(r1).toMatchObject({ tx: R1, reserveIn: A, reserveOut: B, amount: 100_000_000n });
    // the lineage: a box made and spent after the snapshot is that reserve's earlier box, not an unknown one
    expect(o.index.reserves.get(A)).toMatchObject({ source: "live", unspent: false, next: B, prev: null, spent: { tx: R1, height: H + 474 } });
    expect(o.index.reserves.get(B)).toMatchObject({ prev: A, next: C, origin: "redemption", unspent: false });
    expect(o.index.reserves.get(C)).toMatchObject({ prev: B, origin: "redemption", unspent: true });
    expect(o.unspent.filter((r) => r.source === "live").map((r) => r.id)).toEqual([C]);
    // deposited: the reserve's first box, not its latest
    expect(o.totals.depositedNano - BigInt(S.depositedNano)).toBe(1_000_000_000n);
    // per tracker: the same list the totals count
    const t = o.index.trackers.get(TRK)!;
    expect(t.redemptions.slice(0, 2)).toEqual([R2, R1]);
    expect(t.redemptions.length).toBe(seed.redemptions.filter((x) => x.tracker.nft === TRK).length + 2);
  });

  it("swaps in the read transaction without counting it twice", () => {
    const l = live();
    const key = seed.trackers.find((x) => x.nft === TRK)!.lastTrackerBox!.key;
    const receiver = seed.redemptions[0].receiver;
    const tx: ApiTx = {
      id: R1, inclusionHeight: H + 474, timestamp: 1_795_380_000_000, size: 700,
      inputs: [boxes[0]],
      dataInputs: [{ boxId: "7d".repeat(32), transactionId: "ee".repeat(32), value: "1000000", creationHeight: H + 400, ergoTree: `0008cd${key}`, address: "", assets: [{ tokenId: TRK, amount: "1" }], additionalRegisters: { R4: `07${key}`, R5: `64${"ab".repeat(32)}02032000` }, spentTransactionId: null }],
      outputs: [boxes[1], { boxId: "11".repeat(32), transactionId: R1, value: "100000000", creationHeight: H + 473, ergoTree: "0008cd" + own.owner!.key, address: receiver, assets: [], additionalRegisters: {}, spentTransactionId: null }],
    };
    l.txs[R1] = interpretTx(seed, tx);
    const o = buildObservatory({ seed, live: l, tip: H + 600 });
    expect(o.redemptions.length).toBe(43);
    expect(o.index.redemptions.get(R1)).toMatchObject({ fromBoxes: false, receiver, trackerNft: TRK, tracker: { box: "7d".repeat(32), age: 74 } });
    expect(o.index.redemptions.get(R2)?.fromBoxes).toBe(true);
    expect(o.index.reserves.get(B)?.at).toBe("2026-11-22T20:40:00Z");
  });

  it("names who paid for the box from the tx that made it: checking until it is read, then the depositor or the fee", () => {
    // nothing read yet: every box found live waits for its tx (the page says "checking…", never "—")
    let o = buildObservatory({ seed, live: live(), tip: H + 600 });
    for (const id of [A, B, C]) expect(o.index.reserves.get(id)).toMatchObject({ creator: null, creatorState: "checking" });
    const l = live();
    const depositor = own.owner!.addr;
    const other = seed.redemptions[0].receiver;
    const wallet = (id: string, addr: string, value: string, tx: string): ApiBox => ({ boxId: id, transactionId: "0f".repeat(32), value, creationHeight: H + 400, ergoTree: `0008cd${own.owner!.key}`, address: addr, assets: [], additionalRegisters: {}, spentTransactionId: tx });
    // the creation: two wallet inputs, the one with more ERG paid (the snapshot's rule)
    l.txs[C0] = interpretTx(seed, { id: C0, inclusionHeight: H + 464, timestamp: 1_795_379_000_000, inputs: [wallet("e1".repeat(32), other, "10000000", C0), wallet("e2".repeat(32), depositor, "1200000000", C0)], dataInputs: [], outputs: [{ ...boxes[0], spentTransactionId: null }] });
    // R1: a redemption whose fee a wallet input paid; R2: one with no other input (the fee came out of the redeemed ERG)
    l.txs[R1] = interpretTx(seed, { id: R1, inclusionHeight: H + 474, timestamp: 1_795_380_000_000, inputs: [boxes[0], wallet("e3".repeat(32), other, "5000000", R1)], dataInputs: [], outputs: [boxes[1]] });
    l.txs[R2] = interpretTx(seed, { id: R2, inclusionHeight: H + 486, timestamp: 1_795_381_000_000, inputs: [boxes[1]], dataInputs: [], outputs: [boxes[2]] });
    expect([l.txs[C0].kind, l.txs[R1].kind, l.txs[R2].kind]).toEqual(["creation", "redemption", "redemption"]);
    o = buildObservatory({ seed, live: l, tip: H + 600 });
    expect(o.index.reserves.get(A)).toMatchObject({ creator: depositor, creatorState: "known" });
    expect(o.index.reserves.get(B)).toMatchObject({ creator: other, creatorState: "known" });
    expect(o.index.reserves.get(C)).toMatchObject({ creator: null, creatorState: "redeemed" });
    // the snapshot: a creation names its depositor, a box made by a redemption that redemption's fee payer
    for (const r of seed.reserves) {
      const v = obs.index.reserves.get(r.id)!;
      const want = r.creator ?? seed.redemptions.find((x) => x.reserveOut === r.id)?.feePayers[0] ?? null;
      expect([r.id, v.creator, v.creatorState]).toEqual([r.id, want, want ? "known" : "none"]);
    }
    expect(obs.reserves.filter((r) => r.creatorState === "known").length).toBe(99);
  });

  it("measures a token reserve by its collateral, and calls a top-up or a refund start no redemption", () => {
    const tok = (amount: bigint) => ({ id: USE_TOKEN_ID, amount, decimals: 3, name: "USE", kind: "use" as const, label: "USE" });
    expect(boxDelta({ kind: "token", value: 3_000_000n, collateral: tok(3400n) }, { value: 3_000_000n, collateral: tok(3000n) })).toEqual({ unit: USE_TOKEN_ID, raw: 400n });
    expect(boxDelta({ kind: "token", value: 3_000_000n, collateral: tok(3400n) }, { value: 1_000_000n, collateral: tok(3400n) })).toBeNull();
    expect(boxDelta({ kind: "erg", value: 900n, collateral: null }, { value: 1000n, collateral: null })).toBeNull();
    expect(boxDelta({ kind: "erg", value: 900n, collateral: null }, { value: 900n, collateral: null })).toBeNull();
  });

  it("links a seed reserve seen spent live to the box its spending tx made", () => {
    const r = seed.reserves.find((x) => !x.spent && x.kind === "erg" && x.nft)!;
    const c = contractIndex(seed).byId.get(r.contract)!;
    const l = emptyLive();
    l.spent[r.id] = { tx: R1, height: null, seenAt: 1 };
    const next = liveBoxFromApi({ boxId: B, transactionId: R1, value: String(BigInt(r.value) - 1000n), creationHeight: H + 10, ergoTree: c.ergoTree, address: "", assets: [{ tokenId: r.nft!.id, amount: "1" }], additionalRegisters: r.regs, spentTransactionId: null });
    l.extraReserves[B] = next;
    expect(boxLinks(seed, l, [next]).get(B)).toBe(r.id);
    const o = buildObservatory({ seed, live: l, tip: H + 20 });
    expect(o.index.reserves.get(r.id)?.next).toBe(B);
    expect(o.index.redemptions.get(R1)).toMatchObject({ fromBoxes: true, amount: 1000n, reserveIn: r.id });
  });
});
