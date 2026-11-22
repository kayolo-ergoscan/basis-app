import { describe, expect, it } from "vitest";
import {
  DEV_FIXTURE_HEADER, DEV_FIXTURE_MAX_BYTES, DEV_FIXTURE_ROUTE, devFixtureHandler, postDevFixture, type DevFixtureRequest, type DevFixtureResponse, type DevFixtureWriter,
} from "./devfixture";
import { r3BuildText } from "./fixtures/r3-build";

function fakeFetch(status: number, seen: Array<{ url: string; init: RequestInit }>): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

/** Runs the handler on one request; resolves with the status, the reply and what was written. */
function serve(req: { method?: string; url?: string; headers?: Record<string, string>; body?: Uint8Array[] }, exists = false) {
  const written: Array<[string, Uint8Array]> = [];
  const write: DevFixtureWriter = async (name, bytes) => {
    if (exists) return "exists";
    written.push([name, bytes]);
    return "saved";
  };
  return new Promise<{ status: number; text: string; written: typeof written }>((resolve) => {
    const listeners: Record<string, (c?: Uint8Array) => void> = {};
    const r: DevFixtureRequest = {
      method: req.method ?? "POST",
      url: req.url,
      headers: req.headers ?? { [DEV_FIXTURE_HEADER]: "1" },
      on: ((event: string, l: (c?: Uint8Array) => void) => {
        listeners[event] = l;
      }) as DevFixtureRequest["on"],
    };
    const res: DevFixtureResponse = { statusCode: 0, setHeader: () => undefined, end: (text: string) => resolve({ status: res.statusCode, text, written }) };
    devFixtureHandler(write)(r, res);
    for (const c of req.body ?? []) listeners.data?.(c);
    listeners.end?.();
  });
}

describe("dev fixtures (closed wallet canary)", () => {
  it("the page posts the answer byte for byte with the custom header", async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const text = r3BuildText();
    expect(await postDevFixture("wallet-canary-redemption-build.json", text, fakeFetch(201, seen))).toBe("saved");
    expect(seen[0].url).toBe(`${DEV_FIXTURE_ROUTE}wallet-canary-redemption-build.json`);
    expect(seen[0].init.method).toBe("POST");
    expect((seen[0].init.headers as Record<string, string>)[DEV_FIXTURE_HEADER]).toBe("1");
    expect(new TextDecoder().decode(seen[0].init.body as Uint8Array)).toBe(text);
    expect(await postDevFixture("a.json", "{}", fakeFetch(409, []))).toBe("exists");
    expect(await postDevFixture("a.json", "{}", fakeFetch(404, []))).toBe("off");
    expect(await postDevFixture("a.json", "{}", fakeFetch(500, []))).toBe("failed");
    for (const bad of ["../x.json", "A.json", "x.js", ".json", "a/b.json", "a.b.json", `${"a".repeat(65)}.json`]) await expect(postDevFixture(bad, "{}", fakeFetch(201, []))).rejects.toThrow();
    await expect(postDevFixture("big.json", "x".repeat(DEV_FIXTURE_MAX_BYTES + 1), fakeFetch(201, []))).rejects.toThrow();
  });

  it("the server half writes new files only, for same-machine POSTs with the header", async () => {
    const body = [new TextEncoder().encode('{"success":'), new TextEncoder().encode("true}")];
    const ok = await serve({ url: "/wallet-canary-build.json", headers: { [DEV_FIXTURE_HEADER]: "1", origin: "http://127.0.0.1:5173" }, body });
    expect(ok.status).toBe(201);
    expect(ok.written.map(([n, b]) => [n, new TextDecoder().decode(b)])).toEqual([["wallet-canary-build.json", '{"success":true}']]);
    expect((await serve({ url: "/x.json", body }, true)).status).toBe(409);
    expect((await serve({ method: "GET", url: "/x.json" })).status).toBe(405);
    expect((await serve({ url: "/x.json", headers: {} })).status).toBe(403);
    expect((await serve({ url: "/x.json", headers: { [DEV_FIXTURE_HEADER]: "1", origin: "https://example.org" } })).status).toBe(403);
    expect((await serve({ url: "/x.json", headers: { [DEV_FIXTURE_HEADER]: "1", origin: "http://127.0.0.1.example.org:5173" } })).status).toBe(403);
    expect((await serve({ url: "/y.json", headers: { [DEV_FIXTURE_HEADER]: "1", origin: "http://localhost:4173" }, body })).status).toBe(201);
    expect((await serve({ url: "/../secrets.json" })).status).toBe(400);
    expect((await serve({ url: "/x.json", body: [new Uint8Array(DEV_FIXTURE_MAX_BYTES + 1)] })).status).toBe(413);
  });
});
