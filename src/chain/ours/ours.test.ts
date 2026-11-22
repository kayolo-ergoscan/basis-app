// Our tracker, read-only: the client (shape, bigints, 404/429/503, timeout, one request per second), the view model
// (status, emergency clock, totals) and the poller (cadence, visibility, backoff, saved answers, events, one pulse).
// fetch is a fake that answers like the front on :3050 did on 2026-11-22.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Pulse } from "@/app/pulse";
import { createTrackerClient, parseKeyInput, parseReserves, quoteBigInts, type TrackerClient } from "./client";
import { p2pkAddress } from "../decode";
import { commitEvent, isOurTestReserve, oursExtra, ourView, reserveEvents, statusOf } from "./model";
import { createOursStore, feeFundsOf, OURS_STORAGE_KEY, type OursState } from "./store";
import { OUR_TRACKER, OURS_POLL, STALE_AFTER_BLOCKS, type FeeFunds, type TrackedReserve, type TrackerState } from "./types";

const T0 = 1_800_000_000_000;
const EMPTY = "4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900";
const BOX1 = OUR_TRACKER.firstBox;
const BOX2 = "77".repeat(32);
const KEY = "02f17d2d625b7f40f2b1a0ffb5d45fa35be371984ac3a6590945c28c28b99b5fc8";
const OWNER = "03" + "ab".repeat(32);

const stateBody = (box: string = BOX1, digest: string = EMPTY, height = 1_922_276) =>
  `{"success":true,"data":{"local_digest":"${digest}","confirmed_digest":"${digest}","confirmed_box_id":"${box}","confirmed_height":${height},"pending_digest":null,"pending_tx_id":null,"pending_submitted_height":null,"tracker_box_id":"${box}"},"error":null}`;
const reserveJson = (o: { box?: string; owner?: string; collateral?: string; nft?: string; token?: string } = {}) =>
  `{"box_id":"${o.box ?? "aa".repeat(32)}","owner_pubkey":"${o.owner ?? OWNER}","collateral_amount":${o.collateral ?? "1000000000"},"total_debt":0,"tracker_nft_id":"${o.nft ?? OUR_TRACKER.nft}",${o.token ? `"reserve_token_id":"${o.token}",` : ""}"last_updated_height":1922300,"last_updated_timestamp":1795346722196,"collateralization_ratio":999999.0,"refund_initiation_height":0}`;
const reservesBody = (items: string[] = []) => `{"success":true,"data":[${items.join(",")}],"error":null}`;
const NOT_FOUND = `{"success":false,"data":null,"error":"not found"}`;

type Answer = { status?: number; body: string; headers?: Record<string, string> } | "hang" | "throw";

/** A fake fetch: routes → queued answers (the last one repeats). Records every call with its time. */
function fakeFetch(routes: Record<string, Answer[]>) {
  const calls: { url: string; at: number }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, at: Date.now() });
    const route = Object.keys(routes).find((r) => url === `/api/tracker${r}`);
    if (!route) return new Response(NOT_FOUND, { status: 404 });
    const q = routes[route];
    const a = q.length > 1 ? q.shift()! : q[0];
    if (a === "throw") throw new TypeError("Failed to fetch");
    if (a === "hang") {
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    }
    return new Response(a.body, { status: a.status ?? 200, headers: { "content-type": "application/json", ...(a.headers ?? {}) } });
  });
  return { impl: impl as unknown as typeof fetch, calls, mock: impl };
}

const clientWith = (f: ReturnType<typeof fakeFetch>, extra: Parameters<typeof createTrackerClient>[0] = {}): TrackerClient =>
  createTrackerClient({ fetchImpl: f.impl, now: () => Date.now(), ...extra });

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, map: m };
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

// ─────────────────────────────────────────────────────────────────────────────────────────── client

describe("tracker client", () => {
  it("reads /tracker/state into a typed model", async () => {
    const f = fakeFetch({ "/tracker/state": [{ body: stateBody() }] });
    const a = await clientWith(f).state();
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.data).toEqual({ localDigest: EMPTY, confirmedDigest: EMPTY, confirmedBox: BOX1, confirmedHeight: 1_922_276, pending: null, trackerBox: BOX1 });
    expect(f.calls[0].url).toBe("/api/tracker/tracker/state");
    const init = f.mock.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
  });

  it("keeps u64 amounts exact (they arrive as JSON numbers)", async () => {
    const max = "18446744073709551615";
    expect(quoteBigInts(`{"collateral_amount":${max},"x":1}`, ["collateral_amount"])).toBe(`{"collateral_amount":"${max}","x":1}`);
    const f = fakeFetch({ "/reserves": [{ body: reservesBody([reserveJson({ collateral: max })]) }] });
    const a = await clientWith(f).reserves();
    expect(a.ok && a.data.list[0].collateral).toBe(18446744073709551615n);
    expect(a.ok && a.data.list[0].ratio).toBeNull(); // 999999.0 = no debt, not a ratio
  });

  it("skips reserve entries it cannot read, never guesses", () => {
    const r = parseReserves([JSON.parse(quoteBigInts(reserveJson(), ["collateral_amount", "total_debt"])), { box_id: "zz" }, null]);
    expect(r).toMatchObject({ invalid: 2 });
    expect(r!.list).toHaveLength(1);
    expect(r!.list[0]).toMatchObject({ owner: OWNER, nft: OUR_TRACKER.nft, token: null, collateral: 1_000_000_000n });
  });

  it("names 404, 429, 503, bad JSON and success:false", async () => {
    const f = fakeFetch({
      "/tracker/state": [
        { status: 404, body: NOT_FOUND },
        { status: 429, body: `{"success":false,"data":null,"error":"too many requests"}`, headers: { "retry-after": "7" } },
        { status: 503, body: "Service Unavailable" },
        { body: "<html>" },
        { body: `{"success":false,"data":null,"error":"tracker not ready"}` },
      ],
    });
    const c = clientWith(f, { minGapMs: 0 });
    const kinds = [];
    for (let i = 0; i < 5; i++) kinds.push(await c.state());
    expect(kinds.map((a) => (a.ok ? "ok" : a.kind))).toEqual(["notFound", "rate", "unavailable", "shape", "http"]);
    expect(kinds[0].ok === false && kinds[0].message).toBe("not found");
    expect(kinds[1].ok === false && kinds[1].retryAfterMs).toBe(7000);
    expect(kinds[4].ok === false && kinds[4].message).toBe("tracker not ready");
    expect(c.requests()).toBe(5);
  });

  it("gives up after the timeout, and reports a network failure", async () => {
    const f = fakeFetch({ "/tracker/state": ["hang"], "/reserves": ["throw"] });
    const c = clientWith(f, { minGapMs: 0 });
    const p = c.state();
    await vi.advanceTimersByTimeAsync(OURS_POLL.timeoutMs + 1);
    expect(await p).toMatchObject({ ok: false, kind: "timeout" });
    expect(await c.reserves()).toMatchObject({ ok: false, kind: "network" });
  });

  it("starts at most one request per second, in order", async () => {
    const f = fakeFetch({ "/tracker/state": [{ body: stateBody() }], "/reserves": [{ body: reservesBody() }], [`/key-status/${KEY}`]: [{ body: `{"success":true,"data":{"issuer_pubkey":"${KEY}","note_count":0,"last_updated":0,"has_pending_refund":false,"denominations":[]},"error":null}` }] });
    const c = clientWith(f);
    const all = Promise.all([c.state(), c.reserves(), c.keyStatus(KEY), c.state()]);
    await vi.advanceTimersByTimeAsync(5000);
    const res = await all;
    expect(res.every((a) => a.ok)).toBe(true);
    expect(f.calls.map((x) => x.url)).toEqual(["/api/tracker/tracker/state", "/api/tracker/reserves", `/api/tracker/key-status/${KEY}`, "/api/tracker/tracker/state"]);
    for (let i = 1; i < f.calls.length; i++) expect(f.calls[i].at - f.calls[i - 1].at).toBeGreaterThanOrEqual(1000);
  });

  it("key status: refuses a bad key without a request, reads the honest empty answer", async () => {
    const f = fakeFetch({ [`/key-status/${KEY}`]: [{ body: `{"success":true,"data":{"issuer_pubkey":"07${KEY}","note_count":0,"last_updated":0,"has_pending_refund":false,"denominations":[{"denomination":"erg","symbol":"ERG","decimals":9,"total_debt":0,"collateral":5000000000,"collateralization_ratio":999999.0,"note_count":0,"has_pending_refund":false}]},"error":null}` }] });
    const c = clientWith(f);
    expect(await c.keyStatus("02abc")).toMatchObject({ ok: false, kind: "invalid" });
    expect(f.calls).toHaveLength(0);
    const a = await c.keyStatus(KEY.toUpperCase());
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.data.key).toBe(KEY);
    expect(a.data.denominations[0]).toMatchObject({ symbol: "ERG", collateral: 5_000_000_000n, debt: 0n, ratio: null });
  });

  it("key input: a public key or a mainnet P2PK address", () => {
    expect(parseKeyInput(` ${KEY} `)).toEqual({ ok: true, key: KEY, from: "hex" });
    expect(parseKeyInput(OUR_TRACKER.address)).toEqual({ ok: true, key: KEY, from: "address" });
    expect(parseKeyInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseKeyInput("04" + "11".repeat(32))).toEqual({ ok: false, reason: "format" });
    const broken = OUR_TRACKER.address.slice(0, -1) + (OUR_TRACKER.address.endsWith("W") ? "X" : "W");
    expect(parseKeyInput(broken)).toMatchObject({ ok: false });
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────── model

const st = (box: string, digest: string, height: number): TrackerState =>
  ({ localDigest: digest, confirmedDigest: digest, confirmedBox: box, confirmedHeight: height, pending: null, trackerBox: box });
const res = (owner: string, box: string, nft: string = OUR_TRACKER.nft, collateral = 1n, token: string | null = null): TrackedReserve =>
  ({ box, owner, collateral, debt: 0n, nft, token, updatedHeight: 1, updatedAt: 0, ratio: null, refundHeight: 0 });

describe("view model", () => {
  const base: OursState = { active: true, hidden: false, state: null, reserves: null, fees: null, fresh: null, stateError: null, reservesError: null, failures: 0, backoff: null, events: [], requests: 0 };

  it("status: connecting, live, stale, unreachable; a 429 after an answer keeps the answer", () => {
    expect(statusOf(base, null)).toBe("connecting");
    expect(statusOf({ ...base, fresh: T0 }, 10)).toBe("live");
    expect(statusOf({ ...base, fresh: T0 }, STALE_AFTER_BLOCKS)).toBe("live");
    expect(statusOf({ ...base, fresh: T0 }, STALE_AFTER_BLOCKS + 1)).toBe("stale");
    expect(statusOf({ ...base, fresh: T0, stateError: { kind: "unavailable", status: 503, message: "", at: T0 + 1 } }, 10)).toBe("unreachable");
    expect(statusOf({ ...base, fresh: T0, stateError: { kind: "rate", status: 429, message: "", at: T0 + 1 } }, 10)).toBe("live");
    expect(statusOf({ ...base, stateError: { kind: "rate", status: 429, message: "", at: T0 } }, null)).toBe("unreachable");
  });

  it("emergency window, age and totals come only from answers and the tip", () => {
    const s: OursState = {
      ...base, fresh: T0,
      state: { data: st(BOX1, EMPTY, 1_922_276), at: T0, cached: false },
      reserves: { data: { list: [res(OWNER, "aa".repeat(32), OUR_TRACKER.nft, 2_000_000_000n), res(KEY, "bb".repeat(32), OUR_TRACKER.nft, 5n, "cc".repeat(32)), res(KEY, "dd".repeat(32), "ee".repeat(32), 9n)], invalid: 1 }, at: T0, cached: false },
    };
    const v = ourView(s, 1_922_300);
    expect(v).toMatchObject({ status: "live", box: BOX1, digest: EMPTY, inSync: true, height: 1_922_276, age: 24, skipped: 2 });
    expect(v.emergency).toMatchObject({ open: false, opensAt: 1_922_276 + 2161, blocksLeft: 2161 - 24 });
    expect(v.totals).toEqual({ count: 2, ergNano: 2_000_000_000n, tokens: [{ id: "cc".repeat(32), raw: 5n, count: 1 }] });
    const unknown = ourView({ ...base }, null);
    expect(unknown).toMatchObject({ box: null, digest: null, height: null, age: null, emergency: null, reserves: null, totals: null, fees: null });
  });

  it("events: a new box is a commit (a heartbeat when the digest stays), a new issuer is a new reserve", () => {
    expect(commitEvent(null, st(BOX1, EMPTY, 1), T0)).toBeNull();
    expect(commitEvent(st(BOX1, EMPTY, 1), st(BOX1, EMPTY, 1), T0)).toBeNull();
    expect(commitEvent(st(BOX1, EMPTY, 1), st(BOX2, EMPTY, 721), T0)).toMatchObject({ kind: "commit", box: BOX2, heartbeat: true, height: 721 });
    expect(commitEvent(st(BOX1, EMPTY, 1), st(BOX2, "12".repeat(33), 50), T0)).toMatchObject({ kind: "commit", heartbeat: false, digest: "12".repeat(33) });
    expect(reserveEvents(null, [res(OWNER, "aa".repeat(32))], T0)).toEqual([]);
    const prev = [res(OWNER, "aa".repeat(32))];
    // the same issuer in a new box (top-up) is not a new reserve; another tracker's reserve is never ours
    expect(reserveEvents(prev, [res(OWNER, "ab".repeat(32)), res(KEY, "cd".repeat(32), "ee".repeat(32))], T0)).toEqual([]);
    expect(reserveEvents(prev, [res(OWNER, "aa".repeat(32)), res(KEY, "cd".repeat(32))], T0)).toMatchObject([{ kind: "reserve", owner: KEY, box: "cd".repeat(32) }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────────── store

const FEES: FeeFunds = { nano: 997_000_000n, boxes: 1, partial: false };

function setup(routes: Record<string, Answer[]>, o: { hidden?: () => boolean; storage?: ReturnType<typeof memStorage> | null; fees?: (a: string, first: boolean) => Promise<FeeFunds> } = {}) {
  const f = fakeFetch(routes);
  const client = clientWith(f);
  const pulses: Pulse[] = [];
  let last: Pulse | null = null;
  const fees = vi.fn(o.fees ?? (async () => FEES));
  const s = createOursStore({
    client,
    feesOf: fees,
    pulse: { commit: (p) => { pulses.push(p); last = p; }, last: () => last },
    now: () => Date.now(),
    isHidden: o.hidden ?? (() => false),
    random: () => 0,
    storage: o.storage === undefined ? memStorage() : o.storage,
  });
  return { f, s, pulses, fees, get: () => s.store.getState(), setLast: (p: Pulse) => { last = p; } };
}

const urls = (f: ReturnType<typeof fakeFetch>) => f.calls.map((c) => c.url.replace("/api/tracker", ""));

describe("poller", () => {
  it("state every 30 s, reserves every 120 s; nothing while hidden or unwatched", async () => {
    let hidden = false;
    const { f, s, get, fees } = setup({ "/tracker/state": [{ body: stateBody() }], "/reserves": [{ body: reservesBody() }] }, { hidden: () => hidden });
    const release = s.acquire();
    await vi.advanceTimersByTimeAsync(2500);
    expect(urls(f)).toEqual(["/tracker/state", "/reserves"]);
    expect(get()).toMatchObject({ fresh: expect.any(Number), stateError: null, reservesError: null });
    expect(get().reserves?.data.list).toEqual([]);
    expect(fees).not.toHaveBeenCalled(); // no page that shows the fee funds: no /v1 read
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls(f).filter((u) => u === "/tracker/state")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(urls(f).filter((u) => u === "/tracker/state")).toHaveLength(5);
    expect(urls(f).filter((u) => u === "/reserves")).toHaveLength(2);
    // hidden: no request at all for ten minutes
    hidden = true;
    const n = f.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.calls.length).toBe(n);
    hidden = false;
    void s.tick();
    await vi.advanceTimersByTimeAsync(1500);
    expect(urls(f).slice(n)).toEqual(["/tracker/state", "/reserves"]);
    // released: polling stops
    release();
    const m = f.calls.length;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(f.calls.length).toBe(m);
    // every start ≥ 1 s apart
    for (let i = 1; i < f.calls.length; i++) expect(f.calls[i].at - f.calls[i - 1].at).toBeGreaterThanOrEqual(1000);
    s.dispose();
  });

  it("backs off on 503 (30 s, 60 s, …) and honours a long Retry-After on 429", async () => {
    const { f, s, get } = setup({
      "/tracker/state": [{ status: 503, body: "x" }, { status: 503, body: "x" }, { status: 429, body: `{"success":false,"data":null,"error":"slow down"}`, headers: { "retry-after": "300" } }, { body: stateBody() }],
      "/reserves": [{ body: reservesBody() }],
    });
    s.acquire();
    await vi.advanceTimersByTimeAsync(100);
    expect(get().stateError).toMatchObject({ kind: "unavailable", status: 503 });
    expect(get().failures).toBe(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(f.calls).toHaveLength(2);
    expect(get().failures).toBe(2);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(f.calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(f.calls).toHaveLength(3);
    expect(get().stateError).toMatchObject({ kind: "rate" });
    expect(get().backoff?.kind).toBe("rate");
    await vi.advanceTimersByTimeAsync(295_000);
    expect(f.calls).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(urls(f).slice(3, 5)).toEqual(["/tracker/state", "/reserves"]);
    expect(get()).toMatchObject({ stateError: null, reservesError: null, failures: 0, backoff: null });
    s.dispose();
  });

  it("keeps the last good answer with its age; a new visit shows it as saved, then unreachable if the tracker is down", async () => {
    const storage = memStorage();
    const a = setup({ "/tracker/state": [{ body: stateBody() }], "/reserves": [{ body: reservesBody([reserveJson()]) }] }, { storage });
    a.s.acquire({ fees: true });
    await vi.advanceTimersByTimeAsync(1500);
    a.s.dispose();
    expect(storage.map.has(OURS_STORAGE_KEY)).toBe(true);
    const savedAt = a.get().state!.at;

    vi.setSystemTime(T0 + 3_600_000);
    const b = setup({ "/tracker/state": ["throw"], "/reserves": ["throw"] }, { storage, fees: async () => { throw new Error("budget"); } });
    b.s.acquire({ fees: true });
    expect(b.get().state).toMatchObject({ cached: true, at: savedAt });
    expect(b.get().reserves?.data.list[0].collateral).toBe(1_000_000_000n);
    expect(b.get().fees).toMatchObject({ cached: true, data: FEES });
    await vi.advanceTimersByTimeAsync(100);
    const v = ourView(b.get(), 1_922_300);
    expect(v).toMatchObject({ status: "unreachable", cached: true, answeredAt: savedAt, box: BOX1, height: 1_922_276 });
    expect(v.error).toMatchObject({ kind: "network" });
    expect(b.get().events).toEqual([]); // a saved answer is never an event
    b.s.dispose();
  });

  it("ignores a broken saved entry", () => {
    const storage = memStorage();
    storage.setItem(OURS_STORAGE_KEY, `{"v":1,"state":{"raw":"{\\"success\\":true,\\"data\\":{\\"x\\":1}}","at":1}}`);
    const { s, get } = setup({ "/tracker/state": ["hang"] }, { storage });
    s.acquire();
    expect(get().state).toBeNull();
    s.dispose();
  });

  it("a new box is one event and one mainnet pulse; a new reserve is one event", async () => {
    const { s, get, pulses, fees } = setup({
      "/tracker/state": [{ body: stateBody() }, { body: stateBody() }, { body: stateBody(BOX2, EMPTY, 1_922_996) }],
      "/reserves": [{ body: reservesBody() }, { body: reservesBody([reserveJson({ nft: "ee".repeat(32), owner: "02" + "11".repeat(32) }), reserveJson()]) }],
    });
    s.acquire({ fees: true });
    expect(fees).toHaveBeenCalledTimes(1); // at once, before the first tracker request
    await vi.advanceTimersByTimeAsync(1500);
    expect(get().events).toEqual([]);
    expect(pulses).toEqual([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get().events).toHaveLength(1);
    expect(get().events[0]).toMatchObject({ kind: "commit", box: BOX2, heartbeat: true, height: 1_922_996 });
    expect(pulses).toEqual([{ source: "mainnet", trackerId: OUR_TRACKER.nft, digest: EMPTY, height: 1_922_996 }]);
    await vi.waitFor(() => expect(fees).toHaveBeenCalledTimes(2)); // fee funds re-read after the commit
    expect(fees.mock.calls).toEqual([[OUR_TRACKER.address, true], [OUR_TRACKER.address, false]]); // first read waits for budget, refreshes do not
    await vi.advanceTimersByTimeAsync(60_000);
    expect(get().events.map((e) => e.kind)).toEqual(["reserve", "commit"]);
    expect(get().events[0]).toMatchObject({ owner: OWNER });
    expect(pulses).toHaveLength(1);
    s.dispose();
  });

  it("does not pulse twice when the chain module already pulsed this commitment", async () => {
    const h = setup({ "/tracker/state": [{ body: stateBody() }, { body: stateBody(BOX2, EMPTY, 1_922_996) }], "/reserves": [{ body: reservesBody() }] });
    h.s.acquire();
    await vi.advanceTimersByTimeAsync(1500);
    h.setLast({ source: "mainnet", trackerId: OUR_TRACKER.nft, digest: EMPTY, height: 1_922_996 });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.get().events).toHaveLength(1);
    expect(h.pulses).toEqual([]);
    h.s.dispose();
  });

  it("key lookups share the queue and are refused while the front asks to slow down", async () => {
    const { s, f } = setup({
      "/tracker/state": [{ status: 429, body: `{"success":false,"data":null,"error":"slow down"}`, headers: { "retry-after": "120" } }, { body: stateBody() }],
      "/reserves": [{ body: reservesBody() }],
      [`/key-status/${KEY}`]: [{ body: `{"success":true,"data":{"issuer_pubkey":"${KEY}","note_count":0,"last_updated":0,"has_pending_refund":false,"denominations":[]},"error":null}` }],
    });
    s.acquire();
    await vi.advanceTimersByTimeAsync(100);
    const r = await s.lookupKey(KEY);
    expect(r).toMatchObject({ ok: false, kind: "rate" });
    expect(f.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(121_000);
    const p = s.lookupKey(KEY);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await p).toMatchObject({ ok: true, data: { notes: 0, denominations: [] } });
    s.dispose();
  });
});

describe("fee funds", () => {
  const box = (value: string | number, tokens = 0) => ({ boxId: "ab".repeat(32), value, assets: Array.from({ length: tokens }, () => ({ tokenId: OUR_TRACKER.nft, amount: "1" })) });
  it("counts only token-free boxes: the box with the tracker NFT is not fee money", () => {
    expect(feeFundsOf({ items: [box("995000000"), box("1000000", 1)], total: 2, hasMore: false })).toEqual({ nano: 995_000_000n, boxes: 1, partial: false });
    expect(feeFundsOf({ items: [box("1000000", 1)], total: 1 })).toEqual({ nano: 0n, boxes: 0, partial: false });
    expect(feeFundsOf({ items: [box(5), box("18446744073709551615")], total: 2 }).nano).toBe(18_446_744_073_709_551_620n);
  });
  it("marks a list with more pages as a lower bound, and refuses an unexpected shape", () => {
    expect(feeFundsOf({ items: [box("1")], total: 150, hasMore: true }).partial).toBe(true);
    expect(feeFundsOf({ items: [box("1")], total: 150 }).partial).toBe(true);
    expect(() => feeFundsOf({ nanoErgs: "1" })).toThrow();
    expect(() => feeFundsOf({ items: [{ value: "1.5", assets: [] }] })).toThrow();
    expect(() => feeFundsOf({ items: [{ value: "1" }] })).toThrow();
    expect(() => feeFundsOf({ items: [{ value: 2 ** 60, assets: [] }] })).toThrow();
  });
  it("is read only for pages that show it, once at mount", async () => {
    const { s, fees } = setup({ "/tracker/state": [{ body: stateBody() }], "/reserves": [{ body: reservesBody() }] });
    const r1 = s.acquire();
    expect(fees).not.toHaveBeenCalled();
    const r2 = s.acquire({ fees: true });
    expect(fees).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2500);
    const r3 = s.acquire({ fees: true }); // a second page that shows it: the session already has it
    await vi.advanceTimersByTimeAsync(31_000);
    expect(fees).toHaveBeenCalledTimes(1);
    r1(); r2(); r3();
    s.dispose();
  });
});

describe("counts", () => {
  it("adds our tracker once to snapshot counts until a snapshot lists its NFT", () => {
    const idx = (nfts: string[]) => ({ index: { trackers: new Map(nfts.map((n) => [n, {}])) } }) as unknown as Parameters<typeof oursExtra>[0];
    expect(oursExtra(null)).toBe(0);
    expect(oursExtra(idx(["aa".repeat(32)]))).toBe(1);
    expect(oursExtra(idx(["aa".repeat(32), OUR_TRACKER.nft]))).toBe(0);
  });
});

describe("ErgoScan test reserve", () => {
  it("is recognised only by its exact owner key, the key of 9euZX3…4e5U", () => {
    const k = OUR_TRACKER.testReserveOwner;
    expect(k).toMatch(/^0[23][0-9a-f]{64}$/);
    const addr = p2pkAddress(k);
    expect(addr.slice(0, 6)).toBe("9euZX3");
    expect(addr.slice(-4)).toBe("4e5U");
    expect(isOurTestReserve(k)).toBe(true);
    expect(isOurTestReserve(k.slice(0, -2) + "08")).toBe(false);
    expect(isOurTestReserve(k.slice(0, 20))).toBe(false);
    expect(isOurTestReserve(addr)).toBe(false);
    expect(isOurTestReserve(null)).toBe(false);
    expect(isOurTestReserve(undefined)).toBe(false);
  });
});
