// Rate limiter and block budget with fake timers: src/chain ≤ 1 req/s (+ the shell's 1 poll per 30 s ≤ 2 req/s for the
// app), background ≤ 6 per block (4 kept for the shell's height poll), user-started loads outside that budget up to a
// safety cap, background yields to interactive, hidden tab pauses background, final answers kept for the tab, retries
// with backoff, timeouts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHAIN_BUDGET, ChainApiError, createChainApi, finalBox, finalTx, type ChainApiConfig } from "./api";

type FetchFn = ChainApiConfig["fetchImpl"];

function okFetch(log: number[], body: unknown = { ok: true }): FetchFn {
  return (async () => {
    log.push(Date.now());
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as FetchFn;
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1_800_000_000_000); });
afterEach(() => { vi.useRealTimers(); });

describe("token bucket", () => {
  it("starts at most 1 src/chain request per second, so with the shell's height poll no second holds more than 2", async () => {
    const starts: number[] = [];
    const api = createChainApi({ fetchImpl: okFetch(starts), perBlock: 100, heightReserve: 0, random: () => 0 });
    const all = Promise.all(Array.from({ length: 7 }, (_, i) => api.get(`/x/${i}`)));
    await vi.advanceTimersByTimeAsync(7000);
    await all;
    const t0 = starts[0];
    expect(starts.map((t) => t - t0)).toEqual([0, 1000, 2000, 3000, 4000, 5000, 6000]);
    // the shell polls /v1/info every 30 s on its own clock; put a poll anywhere and count every 1-second window
    for (const poll of [t0, t0 + 1, t0 + 499, t0 + 999, t0 + 2500]) {
      const all2 = [...starts, poll].sort((a, b) => a - b);
      for (const t of all2) expect(all2.filter((u) => u >= t && u < t + 1000).length).toBeLessThanOrEqual(2);
    }
  });
});

describe("per-block budget", () => {
  it("gives src/chain 2 of the 6 per-block requests by default and refills on a new block", async () => {
    const starts: number[] = [];
    const api = createChainApi({ fetchImpl: okFetch(starts), isHidden: () => false });
    api.newBlock(100);
    expect(api.budgetLeft()).toBe(2);
    const a = api.get("/a", { lane: "background" });
    const b = api.get("/b", { lane: "background" });
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([a, b]);
    await expect(api.get("/c", { lane: "background" })).rejects.toMatchObject({ kind: "budget" });
    expect(api.canSpend("background")).toBe(false);
    api.noteHeightPoll();
    expect(api.stats()).toMatchObject({ perBlock: 6, usedThisBlock: 3, requests: 2 });
    api.newBlock(100);                      // same height: no new budget
    expect(api.budgetLeft()).toBe(0);
    api.newBlock(101);
    expect(api.budgetLeft()).toBe(2);
    const c = api.get("/c", { lane: "background" });
    await vi.advanceTimersByTimeAsync(1000);
    await c;
    expect(starts.length).toBe(3);
  });

  it("does not hold user-started loads by the block budget: they go out at once, one per second", async () => {
    const starts: number[] = [];
    const api = createChainApi({ fetchImpl: okFetch(starts), isHidden: () => false });
    api.newBlock(100);
    await Promise.all([api.get("/a", { lane: "background" }), api.get("/b", { lane: "background" }), vi.advanceTimersByTimeAsync(1000)]);
    expect(api.budgetLeft()).toBe(0);                                   // the background share of this block is spent
    expect(api.budgetLeft("interactive")).toBe(CHAIN_BUDGET.userPerBlock);
    const t0 = Date.now();
    const user = Promise.all(["/tx/1", "/box/2", "/tracker/3", "/reserve/4", "/mempool/5"].map((p) => api.get(p)));
    await vi.advanceTimersByTimeAsync(5000);
    await expect(user).resolves.toHaveLength(5);                        // no new block was needed
    const mine = starts.slice(2);
    expect(mine[0] - t0).toBeLessThanOrEqual(1000);                     // the next token after the last background start
    expect(mine.slice(1).map((t, i) => t - mine[i])).toEqual([1000, 1000, 1000, 1000]);
    await expect(api.get("/bg", { lane: "background" })).rejects.toMatchObject({ kind: "budget" });
    expect(api.budgetLeft("interactive")).toBe(CHAIN_BUDGET.userPerBlock - 5);
    expect(api.stats()).toMatchObject({ usedThisBlock: 2, byLane: { background: 2, interactive: 5 } });
  });

  it("caps user-started loads per block as a safety net: over it they wait for the next block and background yields", async () => {
    const starts: number[] = [];
    const api = createChainApi({ fetchImpl: okFetch(starts), isHidden: () => false, userPerBlock: 3 });
    api.newBlock(100);
    await Promise.all([api.get("/u1"), api.get("/u2"), api.get("/u3"), vi.advanceTimersByTimeAsync(3000)]);
    let done = false;
    const user = api.get<{ ok: boolean }>("/u4").then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);
    expect(api.budgetLeft("interactive")).toBe(0);
    expect(api.canSpend("background")).toBe(false);                      // a waiting user request goes first
    api.newBlock(101);
    await expect(api.get("/bg", { lane: "background" })).rejects.toMatchObject({ kind: "budget" });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(user).resolves.toEqual({ ok: true });
    expect(api.canSpend("background")).toBe(true);
    expect(starts.length).toBe(4);
  });

  it("opens a new budget epoch by time when no block arrives for 4 minutes", async () => {
    const api = createChainApi({ fetchImpl: okFetch([]), isHidden: () => false });
    api.newBlock(100);
    await Promise.all([api.get("/a", { lane: "background" }), api.get("/b", { lane: "background" }), vi.advanceTimersByTimeAsync(1000)]);
    expect(api.budgetLeft()).toBe(0);
    await vi.advanceTimersByTimeAsync(240_000);
    expect(api.budgetLeft()).toBe(2);
  });
});

describe("final answers", () => {
  const memStorage = () => {
    const m = new Map<string, string>();
    return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
  };

  it("knows which answers can no longer change", () => {
    expect(finalTx({ inclusionHeight: 98 }, 100)).toBe(true);
    expect(finalTx({ inclusionHeight: 99 }, 100)).toBe(false);          // one block on top: a reorg could still drop it
    expect(finalTx({ inclusionHeight: 98 }, -1)).toBe(false);           // no block seen yet
    expect(finalTx({}, 100)).toBe(false);
    expect(finalBox({ spentTransactionId: "ab" })).toBe(true);
    expect(finalBox({ spentTransactionId: null })).toBe(false);         // unspent: it can still be spent
  });

  it("keeps a final answer for the tab, so opening it again costs no request", async () => {
    const starts: number[] = [];
    const tx = { id: "t", inclusionHeight: 90 };
    const store = memStorage();
    const api = createChainApi({ fetchImpl: okFetch(starts, tx), isHidden: () => false, storage: store });
    api.newBlock(100);
    const first = api.get<typeof tx>("/transactions/t", { final: finalTx });
    await vi.advanceTimersByTimeAsync(10);
    await expect(first).resolves.toEqual(tx);
    await expect(api.get("/transactions/t", { final: finalTx })).resolves.toEqual(tx);
    await expect(api.get("/transactions/t", { lane: "background" })).resolves.toEqual(tx);
    expect(starts.length).toBe(1);
    // a reload of the tab: a new client reads it back from sessionStorage
    const again: number[] = [];
    const api2 = createChainApi({ fetchImpl: okFetch(again, tx), isHidden: () => false, storage: store });
    await expect(api2.get("/transactions/t")).resolves.toEqual(tx);
    expect(again.length).toBe(0);
  });

  it("asks again for answers that can still change, and keeps no more than its limit in storage", async () => {
    const starts: number[] = [];
    const store = memStorage();
    const api = createChainApi({ fetchImpl: okFetch(starts, { spentTransactionId: null }), isHidden: () => false, storage: store });
    api.newBlock(100);
    for (let i = 0; i < 2; i++) {
      const p = api.get("/boxes/u", { final: finalBox });
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    }
    expect(starts.length).toBe(2);
    const spent = createChainApi({ fetchImpl: okFetch([], { spentTransactionId: "s" }), isHidden: () => false, storage: store, userPerBlock: 100 });
    for (let i = 0; i < 40; i++) {
      const p = spent.get(`/boxes/${i}`, { final: finalBox });
      await vi.advanceTimersByTimeAsync(1000);
      await p;
    }
    const kept = [...store.m.keys()].filter((k) => k.startsWith("basis.chain.final.v1:"));
    expect(kept.length).toBe(24);
    expect(JSON.parse(store.m.get("basis.chain.final.v1")!)).toHaveLength(24);
    expect(kept).toContain("basis.chain.final.v1:/boxes/39");
    expect(kept).not.toContain("basis.chain.final.v1:/boxes/0");
  });
});

describe("visibility", () => {
  it("refuses background requests while hidden and still serves the user", async () => {
    let hidden = true;
    const starts: number[] = [];
    const api = createChainApi({ fetchImpl: okFetch(starts), isHidden: () => hidden });
    await expect(api.get("/bg", { lane: "background" })).rejects.toMatchObject({ kind: "hidden" });
    const user = api.get("/user");
    await vi.advanceTimersByTimeAsync(10);
    await user;
    hidden = false;
    const bg = api.get("/bg", { lane: "background" });
    await vi.advanceTimersByTimeAsync(1000);
    await bg;
    expect(starts.length).toBe(2);
  });
});

describe("retries and timeouts", () => {
  it("retries 5xx with exponential backoff, each attempt counted", async () => {
    const starts: number[] = [];
    let n = 0;
    const f: FetchFn = (async () => {
      starts.push(Date.now());
      n++;
      return n < 3 ? new Response("busy", { status: 503 }) : new Response('{"height":1}', { status: 200 });
    }) as FetchFn;
    // a fast bucket isolates the backoff; with the default 1/s the second attempt would wait for its token until 1000 ms
    const api = createChainApi({ fetchImpl: f, perBlock: 10, heightReserve: 0, random: () => 0, backoffMs: 800, ratePerSec: 100 });
    const p = api.get<{ height: number }>("/info");
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toEqual({ height: 1 });
    expect(starts.map((t) => t - starts[0])).toEqual([0, 800, 2400]);
    expect(api.stats().requests).toBe(3);
  });

  it("does not retry a 404 and gives up after the retries", async () => {
    const api404 = createChainApi({ fetchImpl: (async () => new Response("no", { status: 404 })) as FetchFn, perBlock: 10, heightReserve: 0 });
    await expect(api404.get("/boxes/x")).rejects.toMatchObject({ kind: "http", status: 404 });
    expect(api404.stats().requests).toBe(1);
    const api500 = createChainApi({ fetchImpl: (async () => new Response("x", { status: 500 })) as FetchFn, perBlock: 10, heightReserve: 0, retries: 1, random: () => 0 });
    const p = api500.get("/x").catch((e) => e);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await p).toBeInstanceOf(ChainApiError);
    expect(api500.stats().requests).toBe(2);
  });

  it("aborts a hung request after timeoutMs", async () => {
    const f: FetchFn = ((_: unknown, init?: RequestInit) =>
      new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as FetchFn;
    const api = createChainApi({ fetchImpl: f, timeoutMs: 3000, retries: 0, perBlock: 10, heightReserve: 0 });
    const p = api.get("/slow").catch((e) => e);
    await vi.advanceTimersByTimeAsync(3001);
    expect(await p).toMatchObject({ kind: "timeout" });
    expect(api.log()[0]).toMatchObject({ path: "/slow", status: "timeout" });
  });

  it("parses JSON with amounts as strings and reports non-JSON", async () => {
    const api = createChainApi({ fetchImpl: (async () => new Response('{"value":"1000000000"}')) as FetchFn, perBlock: 10, heightReserve: 0 });
    await expect(api.get<{ value: string }>("/b")).resolves.toEqual({ value: "1000000000" });
    const bad = createChainApi({ fetchImpl: (async () => new Response("<html>")) as FetchFn, perBlock: 10, heightReserve: 0 });
    await expect(bad.get("/b")).rejects.toMatchObject({ kind: "parse" });
  });
});
