// The observatory model on the seed: exit classes equal the snapshot's, totals equal KNOWLEDGE §i.1, honest copy.
import { describe, expect, it } from "vitest";
import seedJson from "./seed.json";
import type { ApiBox, ApiTx, ExitClass, Seed } from "./types";
import { EMPTY_DIGEST, USE_LOOKALIKE_ID, USE_TOKEN_ID, assessExit, describeExit, formatUnits, p2sAddress } from "./decode";
import { boxDetail, buildObservatory, contractIndex, emptyLive, interpretTx, liveBoxFromApi, liveTrackerLookup, trackerLookup } from "./model";

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
});
