// Rate limiter and block budget with fake timers: src/chain ≤ 1 req/s (+ the shell's 1 poll per 30 s ≤ 2 req/s for the
// app), ≤ 6 per block (4 kept for the shell's height poll),
// background yields to interactive, hidden tab pauses background, retries with backoff, timeouts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChainApiError, createChainApi, type ChainApiConfig } from "./api";

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

  it("lets an interactive request wait for the next block, and background yield to it", async () => {
    const starts: number[] = [];
    const api = createChainApi({ fetchImpl: okFetch(starts), isHidden: () => false });
    api.newBlock(100);
    await Promise.all([api.get("/a", { lane: "background" }), api.get("/b"), vi.advanceTimersByTimeAsync(1000)]);
    let done = false;
    const user = api.get<{ ok: boolean }>("/box").then((r) => { done = true; return r; });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(done).toBe(false);
    expect(api.canSpend("background")).toBe(false);
    api.newBlock(101);
    await expect(api.get("/bg", { lane: "background" })).rejects.toMatchObject({ kind: "budget" });   // the waiting user request goes first
    await vi.advanceTimersByTimeAsync(600);
    await expect(user).resolves.toEqual({ ok: true });
    expect(starts.length).toBe(3);
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
