// The live layer end to end with a fake /v1: scheduling within the block budget, a new tracker commit → mainnet pulse,
// a changed template → one full list → batched spent/unspent merge, interactive box decode, first looks at what the
// user opened on the interactive lane, the lookup of a tracker NFT outside the seed, final answers kept for the tab.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import seedJson from "./seed.json";
import { createChainApi, type ChainApiConfig } from "./api";
import { CURRENT_TEMPLATES, p2pkAddress, p2sAddress } from "./decode";
import { contractIndex } from "./model";
import { createChainStore, FIRST_LOOK_NFTS } from "./store";
import type { ApiBox, Seed } from "./types";
import type { Pulse } from "@/app/pulse";

const seed = seedJson as unknown as Seed;
const H = seed.asOf.height;

function reserveBox(id: string): ApiBox {
  const r = seed.reserves.find((x) => x.id === id)!;
  const c = contractIndex(seed).byId.get(r.contract)!;
  return {
    boxId: r.id, transactionId: r.tx, value: r.value, creationHeight: r.height, ergoTree: c.ergoTree, address: p2sAddress(c.ergoTree),
    assets: [{ tokenId: r.nft!.id, amount: "1" }, ...(r.collateral ? [{ tokenId: r.collateral.id, amount: r.collateral.amount }] : [])],
    additionalRegisters: r.regs, spentTransactionId: null,
  };
}

function trackerBox(nft: string, id: string, height: number, digest: string): ApiBox {
  const t = seed.trackers.find((x) => x.nft === nft)!;
  const b = t.lastTrackerBox!;
  return {
    boxId: id, transactionId: "ee".repeat(32), value: b.value, creationHeight: height, ergoTree: `0008cd${b.key}`, address: b.addr,
    assets: [{ tokenId: nft, amount: "1" }], additionalRegisters: { R4: `07${b.key}`, R5: `64${digest}032000` }, spentTransactionId: null,
  };
}

/** ErgoScan's tracker NFT: minted after the snapshot, so the seed does not list it. */
const OURS = "f5178dc4063042bdf77cd0f4a55d0893d6dbcf0b3d14eb4de25282b2c4e3f29f";
const CURRENT_ERG = contractIndex(seed).list.find((c) => c.current && c.kind === "erg")!;

/** An unspent reserve under the current ERG contract (owner key and tree borrowed from a seed reserve), R6 = `r6`. */
function liveReserve(id: string, r6: string, height: number): ApiBox {
  const r = seed.reserves.find((x) => !x.spent && x.owner && x.regs.R5)!;
  return {
    boxId: id, transactionId: "aa".repeat(32), value: "550000000", creationHeight: height, ergoTree: CURRENT_ERG.ergoTree, address: p2sAddress(CURRENT_ERG.ergoTree),
    assets: [{ tokenId: id.slice(0, 62) + "bb", amount: "1" }], additionalRegisters: { R4: r.regs.R4, R5: r.regs.R5, R6: `0e20${r6}` }, spentTransactionId: null,
  };
}

/** Block time of the snapshot's block in these fakes; block H + n is n × 2 min later. */
const TS0 = 1_795_000_000_000;

/** The tx that made `out` from a plain wallet box (a reserve creation), mined at `height`; its output as a tx answer kept
 *  from before any spend shows it (unspent). */
function creationTx(out: ApiBox, height: number) {
  const key = seed.reserves.find((x) => x.owner)!.owner!.key;
  const funding: ApiBox = { boxId: out.assets[0].tokenId, transactionId: "0f".repeat(32), value: "250000000", creationHeight: height - 1, ergoTree: `0008cd${key}`, address: "", assets: [], additionalRegisters: {}, spentTransactionId: out.transactionId };
  return { id: out.transactionId, inclusionHeight: height, timestamp: TS0 + (height - H) * 120_000, inputs: [funding], dataInputs: [], outputs: [{ ...out, spentTransactionId: null, settlementHeight: height }], size: 600 };
}

/** A tracker box (a key in R4, a tree in R5) that holds `nft`. */
function boxHolding(nft: string, id: string, height: number): ApiBox {
  return { ...trackerBox("4e2eef33d424388d6efec14a792020738dd47663007a2025afb1891b95e4e8b5", id, height, "ab".repeat(32) + "02"), assets: [{ tokenId: nft, amount: "1" }] };
}

interface Fake { routes: Map<string, () => unknown>; calls: string[] }
function fakeFetch(f: Fake): ChainApiConfig["fetchImpl"] {
  return (async (url: string) => {
    const path = String(url).replace(/^\/v1/, "");
    f.calls.push(path);
    const key = path.split("?")[0];
    const h = f.routes.get(key);
    if (!h) return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
    const body = h();
    return typeof body === "number" ? new Response("no", { status: body }) : new Response(JSON.stringify(body), { status: 200 });
  }) as ChainApiConfig["fetchImpl"];
}

/** A quiet chain: every template and tracker NFT answers exactly what the seed expects. */
function quietChain(): Map<string, () => unknown> {
  const routes = new Map<string, () => unknown>();
  const byId = contractIndex(seed).byId;
  const byHash = new Map<string, ApiBox[]>();
  for (const r of seed.reserves) {
    if (r.spent) continue;
    const c = byId.get(r.contract)!;
    if (!byHash.has(c.templateHash)) byHash.set(c.templateHash, []);
    byHash.get(c.templateHash)!.push(reserveBox(r.id));
  }
  for (const [hash, boxes] of byHash) {
    boxes.sort((a, b) => b.creationHeight - a.creationHeight);
    routes.set(`/boxes/unspent/byErgoTreeTemplateHash/${hash}`, () => ({ items: boxes, total: boxes.length, hasMore: false }));
  }
  for (const t of seed.trackers) {
    if (!t.currentBox) continue;
    const b = t.lastTrackerBox;
    routes.set(`/boxes/unspent/byTokenId/${t.nft}`, () => ({
      items: [b && b.box === t.currentBox ? trackerBox(t.nft, t.currentBox!, b.height, b.digest) : { ...trackerBox(seed.trackers[9].nft, t.currentBox!, 1, "00".repeat(33)), assets: [{ tokenId: t.nft, amount: "1" }], additionalRegisters: {} }],
      total: 1,
    }));
  }
  routes.set("/defi/basis", () => ({ reserveCount: 17, ergLockedNano: "202000000", trackerCount: 4, tipHeight: H, reserves: [] }));
  return routes;
}

function setup(routes: Map<string, () => unknown>) {
  const fake: Fake = { routes, calls: [] };
  const pulses: Pulse[] = [];
  const api = createChainApi({ fetchImpl: fakeFetch(fake), isHidden: () => false, random: () => 0 });
  const chain = createChainStore({ api, loadSeed: async () => seed, pulse: { commit: (p) => pulses.push(p) }, isHidden: () => false });
  return { fake, pulses, api, chain };
}

/** Runs one block: the shell's poll sees `height`, then lets the scheduler spend its slots. */
async function block(chain: ReturnType<typeof createChainStore>, height: number) {
  chain.onHeight(height, Date.now());
  await vi.advanceTimersByTimeAsync(2000);
  await chain.tick();
  await vi.advanceTimersByTimeAsync(2000);
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("chain store", () => {
  it("spends at most 2 data requests per block, starts with the detector, finds nothing on a quiet chain", async () => {
    const { fake, chain } = setup(quietChain());
    const release = chain.acquire();
    await vi.advanceTimersByTimeAsync(10);
    for (let h = H + 1; h <= H + 10; h++) {
      const before = fake.calls.length;
      await block(chain, h);
      expect(fake.calls.length - before).toBeLessThanOrEqual(2);
    }
    expect(fake.calls.slice(0, 2)).toEqual([
      `/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}?limit=20`,
      `/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.multiToken}?limit=20`,
    ]);
    // the first sweep reaches the live trackers and the legacy templates
    expect(fake.calls.some((c) => c.startsWith("/boxes/unspent/byTokenId/4e2eef33"))).toBe(true);
    expect(fake.calls.some((c) => c.startsWith("/boxes/unspent/byErgoTreeTemplateHash/"))).toBe(true);
    const obs = chain.getObservatory()!;
    expect(obs.detector.checkedHeight).toBeGreaterThanOrEqual(H);
    expect(obs.live.budget.perBlock).toBe(6);
    expect(obs.live.changes).toBe(0);
    expect(obs.unspent.length).toBe(58);
    // every target at least once within 10 blocks: 2 detector + 5 tracker NFTs + 6 legacy templates + host index
    expect(new Set(fake.calls).size).toBe(14);
    expect(fake.calls.length).toBeLessThanOrEqual(2 + 9 * 2);
    expect(obs.trackers.map((t) => t.status)).toEqual(seed.trackers.map((t) => t.status));
    release();
  });

  it("turns a new tracker box into a mainnet pulse and a live commit", async () => {
    const nft = "34dd2a13c19a711f64f9259992adb13bf9c33424945c07b070b95744774d0319";
    const digest = "ab".repeat(32) + "02";
    const routes = quietChain();
    routes.set(`/boxes/unspent/byTokenId/${nft}`, () => ({ items: [trackerBox(nft, "cd".repeat(32), H + 3, digest)], total: 1 }));
    const { pulses, chain } = setup(routes);
    chain.acquire();
    const releaseFocus = chain.focus("tracker", nft);
    await vi.advanceTimersByTimeAsync(10);
    await block(chain, H + 5);
    expect(pulses).toEqual([{ source: "mainnet", trackerId: nft, digest, height: H + 3 }]);
    const t = chain.getObservatory()!.index.trackers.get(nft)!;
    expect(t.status).toBe("live");
    expect(t.source).toBe("live");
    expect(t.commits[t.commits.length - 1]).toMatchObject({ digest, source: "live", height: H + 3 });
    expect(t.emergency).toMatchObject({ open: false, opensAt: H + 3 + 2161 });
    expect(t.counts.trackerBoxes).toBe(seed.trackers.find((x) => x.nft === nft)!.counts.trackerBoxes + 1);
    // the same box again is not a new commit
    await block(chain, H + 8);
    expect(pulses.length).toBe(1);
    releaseFocus();
  });

  it("calls an NFT burned only after two empty answers in different blocks", async () => {
    const nft = "1b8bf82db92827ed930ad33bffe3539e2774664a5f38d7967340f9682d3c981b";
    const routes = quietChain();
    routes.set(`/boxes/unspent/byTokenId/${nft}`, () => ({ items: [], total: 0 }));
    const { chain, fake } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 1, Date.now());
    chain.focus("tracker", nft);
    // the first look answers empty; the rest of that block brings no second answer
    await vi.advanceTimersByTimeAsync(4000);
    expect(fake.calls.filter((c) => c.includes(nft)).length).toBe(1);
    expect(chain.getObservatory()!.index.trackers.get(nft)!.status).toBe("live");
    await block(chain, H + 2);
    expect(fake.calls.filter((c) => c.includes(nft)).length).toBe(2);
    expect(chain.getObservatory()!.index.trackers.get(nft)!.status).toBe("burned");
    const r = chain.getObservatory()!.unspent.find((x) => x.r6 === nft)!;
    expect(r.exit?.class).toBe("refund");
  });

  it("follows a changed template: one full list, a batched merge, the spending tx", async () => {
    const pb9o = seed.contracts.find((c) => c.short === "pB9o")!;
    const ids = seed.reserves.filter((r) => r.contract === pb9o.id && !r.spent).map((r) => r.id);
    expect(ids.length).toBe(19);
    const goneId = ids[0];
    const rest = ids.slice(1).map(reserveBox).sort((a, b) => b.creationHeight - a.creationHeight);
    const routes = quietChain();
    routes.set(`/boxes/unspent/byErgoTreeTemplateHash/${pb9o.templateHash}`, () => ({ items: rest, total: rest.length, hasMore: false }));
    routes.set(`/boxes/${goneId}`, () => ({ ...reserveBox(goneId), spentTransactionId: "ff".repeat(32) }));
    routes.set(`/transactions/${"ff".repeat(32)}`, () => 404);
    const { chain, fake } = setup(routes);
    chain.acquire();
    await vi.advanceTimersByTimeAsync(10);
    for (let h = H + 1; h <= H + 12; h++) await block(chain, h);
    const obs = chain.getObservatory()!;
    expect(obs.unspent.length).toBe(57);
    const gone = obs.index.reserves.get(goneId)!;
    expect(gone.unspent).toBe(false);
    expect(gone.spent).toMatchObject({ tx: "ff".repeat(32), seenLive: true });
    expect(obs.totals.unspent).toBe(57);
    expect(obs.live.changes).toBeGreaterThan(0);
    const tplCalls = fake.calls.filter((c) => c.startsWith(`/boxes/unspent/byErgoTreeTemplateHash/${pb9o.templateHash}`));
    expect(tplCalls).toEqual([
      `/boxes/unspent/byErgoTreeTemplateHash/${pb9o.templateHash}?limit=1`,
      `/boxes/unspent/byErgoTreeTemplateHash/${pb9o.templateHash}?limit=50`,
    ]);
    // the other unspent pB9o reserves now carry a live confirmation
    expect(obs.index.reserves.get(ids[1])!.checked?.height).toBeGreaterThan(H);
  });

  it("decodes any box on demand (interactive) and caches it", async () => {
    const id = seed.reserves[0].id;
    const { chain, fake } = setup(new Map([[`/boxes/${id}`, () => reserveBox(id)]]));
    const p = chain.fetchBox(id);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    const b = chain.store.getState().boxes[id];
    expect(b.state).toBe("ok");
    expect(b.data?.contract?.id).toBe(seed.reserves[0].contract);
    expect(b.data?.templateHash).toBe(contractIndex(seed).byId.get(seed.reserves[0].contract)!.templateHash);
    const n = fake.calls.filter((c) => c === `/boxes/${id}`).length;
    await chain.fetchBox(id);
    expect(fake.calls.filter((c) => c === `/boxes/${id}`).length).toBe(n);
    await chain.fetchBox("nothex");
    expect(chain.store.getState().boxes["nothex"].state).toBe("error");
  });

  it("looks up a tracker NFT outside the seed at once: the exit reads 'checking' until it answers, never 'needs a tracker'", async () => {
    const id = "61".repeat(32);
    const routes = quietChain();
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => ({ items: [liveReserve(id, OURS, H + 2)], total: 1 }));
    routes.set(`/boxes/unspent/byTokenId/${OURS}`, () => ({ items: [boxHolding(OURS, "7c".repeat(32), H + 1)], total: 1 }));
    const { chain, fake, api, pulses } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 3, Date.now());
    await vi.advanceTimersByTimeAsync(10);
    // the detector found the reserve; where its R6 NFT is has not been answered yet
    let r = chain.getObservatory()!.index.reserves.get(id)!;
    expect(r.exit).toMatchObject({ class: "refund+redeem-checking", redeem: "checking", reason: { code: "tracker-unknown" } });
    expect(r.exit!.line.en).toMatch(/checking where tracker NFT/i);
    expect(r.exit!.line.ru).toMatch(/проверяем, где сейчас NFT трекера/i);
    await vi.advanceTimersByTimeAsync(1000);
    // the lookup went out on the interactive lane in the same block, although the detectors took the background share
    expect(fake.calls).toContain(`/boxes/unspent/byTokenId/${OURS}`);
    expect(api.stats().byLane.interactive).toBe(1);
    r = chain.getObservatory()!.index.reserves.get(id)!;
    expect(r.exit).toMatchObject({ class: "refund+redeem", redeem: "now", reason: { code: "tracker-live", trackerBox: "7c".repeat(32) } });
    expect(r.exit!.emergency).toMatchObject({ boxHeight: H + 1, open: false });
    // a lookup, not a commit: no pulse, the seed's trackers and the counts stay as they were
    expect(pulses).toEqual([]);
    expect(chain.getObservatory()!.trackers.length).toBe(seed.trackers.length);
    expect(chain.getObservatory()!.index.trackers.has(OURS)).toBe(false);
  });

  it("opens a reserve at once: its first looks go out on the interactive lane, later re-checks stay in the block budget", async () => {
    const id = "62".repeat(32);
    const routes = quietChain();
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => ({ items: [liveReserve(id, OURS, H + 2)], total: 1 }));
    routes.set(`/boxes/${id}`, () => liveReserve(id, OURS, H + 2));
    routes.set(`/boxes/unspent/byTokenId/${OURS}`, () => ({ items: [boxHolding(OURS, "7c".repeat(32), H + 1)], total: 1 }));
    routes.set(`/transactions/${"aa".repeat(32)}`, () => creationTx(liveReserve(id, OURS, H + 2), H + 2));
    const { chain, fake, api } = setup(routes);
    chain.acquire();
    chain.focus("reserve", id);
    chain.onHeight(H + 3, Date.now());
    await vi.advanceTimersByTimeAsync(5000);
    // all in the first block: two detector lists (background) + the reserve's box, its contract's mempool, its tracker
    // NFT and the tx that made it (interactive) — nobody waits for the next block
    expect(new Set(fake.calls)).toEqual(new Set([
      `/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}?limit=20`,
      `/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.multiToken}?limit=20`,
      `/boxes/${id}`,
      `/mempool/transactions/byAddress/${CURRENT_ERG.p2sFull}`,
      `/boxes/unspent/byTokenId/${OURS}`,
      `/transactions/${"aa".repeat(32)}`,
    ]));
    expect(api.stats().byLane).toMatchObject({ background: 2, interactive: 4 });
    const r = chain.getObservatory()!.index.reserves.get(id)!;
    expect(r.exit?.class).toBe("refund+redeem");
    expect(r.pending).toBe(0);
    expect(r.checked?.height).toBe(H + 3);
    // its "created" line has the block's time and the creation, read from that tx
    expect(r).toMatchObject({ origin: "creation", at: new Date(TS0 + 2 * 120_000).toISOString().replace(/\.\d{3}Z$/, "Z") });
    // later blocks: re-checks are background work, at most 2 per block
    for (let h = H + 4; h <= H + 14; h++) {
      const before = api.stats().byLane.interactive;
      const calls = fake.calls.length;
      await block(chain, h);
      expect(api.stats().byLane.interactive).toBe(before);
      expect(fake.calls.length - calls).toBeLessThanOrEqual(2);
    }
  });

  it("gives at most FIRST_LOOK_NFTS unfocused NFTs outside the seed a first look on the interactive lane", async () => {
    const nfts = Array.from({ length: FIRST_LOOK_NFTS + 2 }, (_, i) => `${i + 1}`.repeat(64).slice(0, 64));
    const routes = quietChain();
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => ({ items: nfts.map((n, i) => liveReserve(`${7 + i}`.repeat(64).slice(0, 64), n, H + 2)), total: nfts.length }));
    const { chain, fake, api } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 3, Date.now());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(api.stats().byLane.interactive).toBe(FIRST_LOOK_NFTS);
    expect(nfts.filter((n) => fake.calls.includes(`/boxes/unspent/byTokenId/${n}`)).length).toBe(FIRST_LOOK_NFTS);
    // the rest come in the background, before the live trackers of the seed
    await block(chain, H + 4);
    expect(nfts.every((n) => fake.calls.includes(`/boxes/unspent/byTokenId/${n}`))).toBe(true);
    expect(api.stats().byLane.interactive).toBe(FIRST_LOOK_NFTS);
  });

  it("tries a failed detector list again on the next block, not after its 6-block interval", async () => {
    const routes = quietChain();
    let fails = 1;   // a 400 is an answer, not retried: the whole check fails
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => (fails-- > 0 ? 400 : { items: [], total: 0 }));
    const { chain } = setup(routes);
    chain.acquire();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(chain.getObservatory()!.detector.templates.find((t) => t.hash === CURRENT_TEMPLATES.erg)!.checkedAt).toBeNull();
    await block(chain, H + 1);
    await block(chain, H + 2);
    expect(chain.getObservatory()!.detector.templates.find((t) => t.hash === CURRENT_TEMPLATES.erg)!.checkedAt).not.toBeNull();
  });

  it("keeps a final transaction for the tab: opening it again costs no request", async () => {
    const txId = "9a".repeat(32);
    const routes = new Map<string, () => unknown>([[`/transactions/${txId}`, () => ({ id: txId, inclusionHeight: H, timestamp: 1_790_000_000_000, inputs: [], dataInputs: [], outputs: [] })]]);
    const { chain, fake } = setup(routes);
    chain.onHeight(H + 10, Date.now());
    const p = chain.fetchTx(txId);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(chain.store.getState().txs[txId].state).toBe("ok");
    chain.resetLive();                                  // the store forgets it; the api still holds the final answer
    const q = chain.fetchTx(txId);
    await vi.advanceTimersByTimeAsync(1000);
    await q;
    expect(chain.store.getState().txs[txId].state).toBe("ok");
    expect(fake.calls.filter((c) => c === `/transactions/${txId}`).length).toBe(1);
  });

  // ── after the snapshot: a reserve under the current ERG contract, 1 → 0.9 → 0.65 ERG (the shape of ErgoScan's test
  //    reserve on 22 Nov 2026), its first two boxes made and spent after the snapshot ──
  const TRK = "4e2eef33d424388d6efec14a792020738dd47663007a2025afb1891b95e4e8b5";   // a live tracker of the seed
  const [C0, R1, R2, R3] = ["c0", "d1", "d2", "d3"].map((x) => x.repeat(32));
  const [A, B, C, D] = ["a1", "b1", "c1", "e1"].map((x) => x.repeat(32));
  const curBox = (id: string, tx: string, value: string, height: number, spentTx: string | null): ApiBox => {
    const r = seed.reserves.find((x) => !x.spent && x.owner && x.regs.R5)!;
    return {
      boxId: id, transactionId: tx, value, creationHeight: height, settlementHeight: height + 1, ergoTree: CURRENT_ERG.ergoTree, address: p2sAddress(CURRENT_ERG.ergoTree),
      assets: [{ tokenId: "0c".repeat(32), amount: "1" }], additionalRegisters: { R4: r.regs.R4, R5: r.regs.R5, R6: `0e20${TRK}` }, spentTransactionId: spentTx,
    };
  };
  const RECEIVER = p2pkAddress(seed.reserves.find((x) => x.owner)!.owner!.key);
  /** The tx that spent `from` and made `to`, paying the difference to RECEIVER, against a tracker box of TRK. */
  const redemptionTx = (from: ApiBox, to: ApiBox) => {
    const h = to.settlementHeight!;
    const key = seed.reserves.find((x) => x.owner)!.owner!.key;
    return {
      id: to.transactionId, inclusionHeight: h, timestamp: TS0 + (h - H) * 120_000, size: 700,
      inputs: [{ ...from, spentTransactionId: to.transactionId }],
      dataInputs: [trackerBox(TRK, "7d".repeat(32), h - 30, "ab".repeat(32) + "02")],
      outputs: [{ ...to, spentTransactionId: null }, { boxId: `${to.boxId.slice(0, 62)}99`, transactionId: to.transactionId, value: String(BigInt(from.value) - BigInt(to.value)), creationHeight: h - 1, ergoTree: `0008cd${key}`, address: RECEIVER, assets: [], additionalRegisters: {}, spentTransactionId: null }],
    };
  };
  const boxA = curBox(A, C0, "1000000000", H + 463, R1), boxB = curBox(B, R1, "900000000", H + 473, R2), boxC = curBox(C, R2, "650000000", H + 485, null);

  it("counts redemptions after the snapshot from the detector's boxes at once, then reads their txs in the budget, newest first", async () => {
    const routes = quietChain();
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => ({ items: [boxC, boxB, boxA], total: 3 }));
    routes.set(`/transactions/${C0}`, () => creationTx(boxA, H + 464));
    routes.set(`/transactions/${R1}`, () => redemptionTx(boxA, boxB));
    routes.set(`/transactions/${R2}`, () => redemptionTx(boxB, boxC));
    const { chain, fake, api } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 600, Date.now());
    await vi.advanceTimersByTimeAsync(3000);
    // the first block: the two detector lists, nothing else — and every redemption the boxes show already counts
    expect(fake.calls.length).toBe(2);
    let obs = chain.getObservatory()!;
    expect(obs.totals.redemptions).toBe(43);
    expect(obs.redemptions.slice(0, 2).map((x) => [x.tx, x.fromBoxes, x.amount])).toEqual([[R2, true, 250_000_000n], [R1, true, 100_000_000n]]);
    expect(obs.index.trackers.get(TRK)!.redemptions.slice(0, 2)).toEqual([R2, R1]);
    // the box made and spent after the snapshot is a known reserve box: that reserve's earlier state
    expect(obs.index.reserves.get(A)).toMatchObject({ unspent: false, next: B, spent: { tx: R1 } });
    expect(obs.index.reserves.get(B)).toMatchObject({ prev: A, next: C });
    expect(obs.unspent.length).toBe(58 + 1);
    // later blocks: the txs are read in the background budget, newest first, each once
    for (let h = H + 601; h <= H + 608; h++) {
      const before = fake.calls.length;
      await block(chain, h);
      expect(fake.calls.length - before).toBeLessThanOrEqual(2);
    }
    const txCalls = fake.calls.filter((c) => c.startsWith("/transactions/"));
    expect(txCalls).toEqual([`/transactions/${R2}`, `/transactions/${R1}`, `/transactions/${C0}`]);
    expect(api.stats().byLane.interactive).toBe(0);
    obs = chain.getObservatory()!;
    expect(obs.totals.redemptions).toBe(43);
    expect(obs.index.redemptions.get(R2)).toMatchObject({ fromBoxes: false, receiver: RECEIVER, tracker: { box: "7d".repeat(32), age: 30 } });
    // its creation is read too; the tx's copy of the box does not undo the spend the detector saw
    expect(obs.index.reserves.get(A)).toMatchObject({ origin: "creation", unspent: false, at: new Date(TS0 + 464 * 120_000).toISOString().replace(/\.\d{3}Z$/, "Z") });
    expect(obs.unspent.length).toBe(58 + 1);
    expect(obs.index.reserves.get(B)?.at).not.toBeNull();
    // "Paid by" from the same reads: the depositor of the creation; the redemptions had no other input
    expect(obs.index.reserves.get(A)).toMatchObject({ creatorState: "known", creator: p2pkAddress(seed.reserves.find((x) => x.owner)!.owner!.key) });
    expect([obs.index.reserves.get(B)?.creatorState, obs.index.reserves.get(C)?.creatorState]).toEqual(["redeemed", "redeemed"]);
    expect(obs.live.lastError).toBeNull();
  });

  it("replaces a box it saw unspent once the detector sees it spent: one unspent box per reserve", async () => {
    let spent = false;
    const boxD = curBox(D, R3, "600000000", H + 620, null);
    const routes = quietChain();
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => (spent
      ? { items: [boxD, { ...boxC, spentTransactionId: R3 }, boxB, boxA], total: 4 }
      : { items: [boxC, boxB, boxA], total: 3 }));
    const { chain } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 600, Date.now());
    await vi.advanceTimersByTimeAsync(3000);
    expect(chain.getObservatory()!.index.reserves.get(C)?.unspent).toBe(true);
    spent = true;
    for (let h = H + 601; h <= H + 612; h++) await block(chain, h);
    const obs = chain.getObservatory()!;
    expect(obs.unspent.filter((r) => r.source === "live").map((r) => r.id)).toEqual([D]);
    expect(obs.index.reserves.get(C)).toMatchObject({ unspent: false, next: D });
    expect(obs.totals.redemptions).toBe(41 + 3);
  });

  it("knows a reserve box made and spent after the snapshot from a tx the user opens, even when the detector never listed it", async () => {
    const routes = quietChain();
    routes.set(`/transactions/${R1}`, () => redemptionTx(boxA, boxB));
    const { chain } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 600, Date.now());
    const p = chain.fetchTx(R1);
    await vi.advanceTimersByTimeAsync(3000);
    await p;
    const obs = chain.getObservatory()!;
    expect(obs.index.reserves.get(A)).toMatchObject({ source: "live", unspent: false, next: B });
    expect(obs.index.reserves.get(B)).toMatchObject({ prev: A, origin: "redemption" });
    expect(obs.index.redemptions.get(R1)).toMatchObject({ fromBoxes: false, reserveIn: A, receiver: RECEIVER });
    expect(obs.totals.redemptions).toBe(42);
  });

  it("does not merge a transaction from before the snapshot when it is opened (the seed already has its block)", async () => {
    const x = seed.reserves.find((r) => !r.spent && r.kind === "erg" && r.nft)!;
    const tx = "9b".repeat(32);
    const out = { ...reserveBox(x.id), boxId: "9c".repeat(32), transactionId: tx, value: String(BigInt(x.value) + 100_000_000n) };
    const routes = new Map<string, () => unknown>([[`/transactions/${tx}`, () => ({
      id: tx, inclusionHeight: H - 5, timestamp: TS0, inputs: [{ ...reserveBox(x.id), spentTransactionId: tx }], dataInputs: [], outputs: [out],
    })]]);
    const { chain } = setup(routes);
    chain.onHeight(H + 10, Date.now());
    await chain.ensureSeed();
    const p = chain.fetchTx(tx);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(chain.store.getState().txs[tx].data?.kind).toBe("top-up");
    const obs = chain.getObservatory()!;
    expect([obs.totals.topUps, obs.unspent.length, obs.reserves.length]).toEqual([seed.totals.topUps, 58, 99]);
  });

  it("looks up a reserve box id it does not know: a box made after the snapshot joins, spent or not", async () => {
    const routes = new Map<string, () => unknown>([[`/boxes/${A}`, () => boxA]]);
    const { chain } = setup(routes);
    await chain.ensureSeed();
    expect(chain.getObservatory()!.index.reserves.has(A)).toBe(false);
    const p = chain.fetchBox(A);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(chain.store.getState().boxes[A].state).toBe("ok");
    expect(chain.getObservatory()!.index.reserves.get(A)).toMatchObject({ source: "live", unspent: false, spent: { tx: R1 } });
    // a plain box is decoded, not taken for a reserve
    const plain = "5e".repeat(32);
    routes.set(`/boxes/${plain}`, () => ({ ...boxA, boxId: plain, ergoTree: `0008cd${seed.reserves.find((x) => x.owner)!.owner!.key}` }));
    const q = chain.fetchBox(plain);
    await vi.advanceTimersByTimeAsync(1000);
    await q;
    expect(chain.getObservatory()!.index.reserves.has(plain)).toBe(false);
  });

  it("takes a 404 for a tx as an answer: no error, asked again only some blocks later", async () => {
    const routes = quietChain();
    routes.set(`/boxes/byErgoTreeTemplateHash/${CURRENT_TEMPLATES.erg}`, () => ({ items: [boxB, boxA], total: 2 }));
    routes.set(`/transactions/${C0}`, () => 404);
    routes.set(`/transactions/${R1}`, () => 404);
    routes.set(`/transactions/${R2}`, () => 404);
    const { chain, fake } = setup(routes);
    chain.acquire();
    chain.onHeight(H + 600, Date.now());
    await vi.advanceTimersByTimeAsync(3000);
    for (let h = H + 601; h <= H + 606; h++) await block(chain, h);
    const reads = (id: string) => fake.calls.filter((c) => c === `/transactions/${id}`).length;
    expect([reads(R2), reads(R1), reads(C0)]).toEqual([1, 1, 1]);
    expect(chain.getObservatory()!.live.lastError).toBeNull();
    expect(chain.getObservatory()!.index.redemptions.get(R1)?.fromBoxes).toBe(true);
    // asked again, but never twice within INTERVALS.detector (6) blocks
    const at: number[] = [];
    for (let h = H + 607; h <= H + 620; h++) {
      const n = reads(R1);
      await block(chain, h);
      if (reads(R1) > n) at.push(h);
    }
    expect(at.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < at.length; i++) expect(at[i] - at[i - 1]).toBeGreaterThanOrEqual(6);
  });

  it("does nothing while no hook is mounted", async () => {
    const { chain, fake } = setup(new Map());
    await chain.ensureSeed();
    await block(chain, H + 1);
    expect(fake.calls.length).toBe(0);
  });
});
