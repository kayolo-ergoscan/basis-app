// The shared start queue (one request per second, user actions first), the tracker clock from `Date` headers, and the
// raw GET/POST client (the wallet's way in, raw.ts). fetch is a fake; nothing leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerClock } from "./clock";
import { createTrackerClient } from "./client";
import { createStartQueue } from "./queue";
import { createRawClient } from "./raw";

const T0 = 1_800_000_000_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); });
afterEach(() => { vi.useRealTimers(); });

describe("start queue", () => {
  it("starts at once when idle, then ≥ 1 s apart, FIFO", async () => {
    const q = createStartQueue(1000);
    const at: [string, number][] = [];
    const go = (name: string) => q.wait().then(() => { at.push([name, Date.now() - T0]); });
    const all = Promise.all([go("a"), go("b"), go("c")]);
    await vi.advanceTimersByTimeAsync(3000);
    await all;
    expect(at).toEqual([["a", 0], ["b", 1000], ["c", 2000]]);
    expect(q.started()).toBe(3);
  });

  it("a user action goes ahead of the polls that wait, never inside the gap", async () => {
    const q = createStartQueue(1000);
    const at: [string, number][] = [];
    const go = (name: string, priority: "user" | "poll") => q.wait({ priority }).then(() => { at.push([name, Date.now() - T0]); });
    const all = [go("p1", "poll"), go("p2", "poll"), go("p3", "poll")];
    await vi.advanceTimersByTimeAsync(200);
    all.push(go("u", "user"));
    await vi.advanceTimersByTimeAsync(4000);
    await Promise.all(all);
    expect(at).toEqual([["p1", 0], ["u", 1000], ["p2", 2000], ["p3", 3000]]);
  });

  it("an aborted wait leaves the queue; the next start keeps the gap", async () => {
    const q = createStartQueue(1000);
    const at: [string, number][] = [];
    const ctrl = new AbortController();
    const a = q.wait().then(() => at.push(["a", Date.now() - T0]));
    const b = q.wait({ signal: ctrl.signal }).then(() => at.push(["b", Date.now() - T0]), (e: Error) => at.push([e.message, Date.now() - T0]));
    const c = q.wait().then(() => at.push(["c", Date.now() - T0]));
    await vi.advanceTimersByTimeAsync(300);
    ctrl.abort();
    expect(q.waiting()).toBe(1);
    await vi.advanceTimersByTimeAsync(2000);
    await Promise.all([a, b, c]);
    expect(at).toEqual([["a", 0], ["aborted", 300], ["c", 1000]]);
    await expect(q.wait({ signal: ctrl.signal })).rejects.toThrow("aborted");
  });
});

describe("tracker clock", () => {
  it("is null before a sample, then the median of the last 5 offsets corrected by RTT/2", () => {
    let local = T0;
    const c = createServerClock(() => local);
    expect(c.offset()).toBeNull();
    expect(c.now()).toBe(T0);
    // server 3 s ahead; the request took 400 ms, so the server stamped it at the local midpoint
    const d = (ms: number) => new Date(ms).toUTCString();
    c.sample(d(T0 + 3000), T0 - 200, T0 + 200);
    expect(c.offset()).toBe(3000);
    c.sample(d(T0 + 60_000 + 3000), T0 + 60_000, T0 + 60_000);
    c.sample(d(T0 + 120_000 + 9000), T0 + 120_000, T0 + 120_000);     // one wild sample
    expect(c.offset()).toBe(3000);
    c.sample(null, T0, T0);
    c.sample("not a date", T0, T0);
    c.sample(d(T0), T0, T0 + 20_000);                                    // too slow to say anything
    expect(c.samples()).toBe(3);
    for (let i = 0; i < 5; i++) c.sample(d(T0 + 1000 * i - 1000), T0 + 1000 * i, T0 + 1000 * i);
    expect(c.samples()).toBe(5);
    expect(c.offset()).toBe(-1000);
    local = T0 + 10_000;
    expect(c.now()).toBe(T0 + 9000);
    c.reset();
    expect(c.offset()).toBeNull();
  });

  it("truncated Date headers never put the estimate ahead of the server", () => {
    const c = createServerClock(() => T0);
    // the server is exactly 0 ms ahead, its header drops the 999 ms
    c.sample(new Date(T0 + 999 - (T0 + 999) % 1000).toUTCString(), T0 + 999, T0 + 999);
    expect(c.offset()!).toBeLessThanOrEqual(0);
  });
});

describe("raw requests", () => {
  function fake(answers: { status: number; body: string; date?: string }[]) {
    const calls: { url: string; init: RequestInit; at: number }[] = [];
    const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {}, at: Date.now() });
      const a = answers.length > 1 ? answers.shift()! : answers[0];
      return new Response(a.body, { status: a.status, headers: { "content-type": "application/json", ...(a.date ? { date: a.date } : {}) } });
    });
    return { impl: impl as unknown as typeof fetch, calls };
  }

  it("POSTs the body byte for byte, returns any status as an answer, samples the clock", async () => {
    const f = fake([{ status: 409, body: `{"success":false,"data":null,"error":"x"}`, date: new Date(T0 + 5000).toUTCString() }]);
    const c = createRawClient({ base: "/api/tracker", fetchImpl: f.impl, now: () => Date.now() });
    const body = `{"b":1,"a":2}`;
    const a = await c.raw("/notes", { method: "POST", body, priority: "user" });
    expect(a).toMatchObject({ ok: true, status: 409, text: `{"success":false,"data":null,"error":"x"}` });
    expect(f.calls[0].url).toBe("/api/tracker/notes");
    expect(f.calls[0].init).toMatchObject({ method: "POST", body, credentials: "omit", cache: "no-store" });
    expect((f.calls[0].init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(c.clock.offset()).toBe(5000);
    expect(c.log().at(-1)).toMatchObject({ route: "POST /notes", status: 409 });
  });

  it("shares the queue with the app-wide client's typed reads and reports a timeout as no answer", async () => {
    const calls: number[] = [];
    const impl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(Date.now());
      return new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))));
    }) as unknown as typeof fetch;
    const queue = createStartQueue(1000, () => Date.now());
    const c = createTrackerClient({ fetchImpl: impl, now: () => Date.now(), timeoutMs: 3000, queue });
    const r = createRawClient({ base: "/api/tracker", fetchImpl: impl, now: () => Date.now(), timeoutMs: 3000, queue });
    const p1 = c.state();
    const p2 = r.raw("/tracker/pending-tx");
    await vi.advanceTimersByTimeAsync(5000);
    expect(await p2).toMatchObject({ ok: false, kind: "timeout" });
    expect((await p1).ok).toBe(false);
    expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(1000);
  });
});
