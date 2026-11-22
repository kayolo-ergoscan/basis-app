// The live layer end to end with a fake /v1: scheduling within the block budget, a new tracker commit → mainnet pulse,
// a changed template → one full list → batched spent/unspent merge, interactive box decode.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import seedJson from "./seed.json";
import { createChainApi, type ChainApiConfig } from "./api";
import { CURRENT_TEMPLATES, p2sAddress } from "./decode";
import { contractIndex } from "./model";
import { createChainStore } from "./store";
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

interface Fake { routes: Map<string, () => unknown>; calls: string[] }
function fakeFetch(f: Fake): ChainApiConfig["fetchImpl"] {
  return (async (url: string) => {
    const path = String(url).replace(/^\/v1/, "");
    f.calls.push(path);
    const key = path.split("?")[0];
    const h = f.routes.get(key);
    if (!h) return new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 });
    const body = h();
    return body === 404 ? new Response("not found", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
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
    chain.focus("tracker", nft);
    await vi.advanceTimersByTimeAsync(10);
    await block(chain, H + 1);
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

  it("does nothing while no hook is mounted", async () => {
    const { chain, fake } = setup(new Map());
    await chain.ensureSeed();
    await block(chain, H + 1);
    expect(fake.calls.length).toBe(0);
  });
});
