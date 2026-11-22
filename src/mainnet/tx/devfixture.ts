// Dev only: during the closed wallet canary, save a raw tracker answer as a test fixture, exactly as received, in
// /root/basis/qa/fixtures/. Two halves:
//   • the page calls `saveDevFixture(name, text)` right after `await res.text()` and before parsing;
//   • the dev server writes the bytes (vite.config.ts, plugin "basis-dev-fixtures", wired with `devFixtureHandler`).
// Both are off unless it is a dev build (`import.meta.env.DEV`; false in every `vite build`) served by a dev server
// started with BASIS_DEV_FIXTURES=1. Files are never overwritten; names and sizes are checked on both sides.
//
//   const text = await res.text();
//   void saveDevFixture("wallet-canary-redemption-build.json", text);   // never throws, never blocks the flow
//   const build = parseBuildResponse(text);

export const DEV_FIXTURE_ROUTE = "/__basis/fixtures/";
/** Lowercase letters, digits and hyphens, then .json or .txt: no path, no dots, no overwrite of other names. */
export const DEV_FIXTURE_NAME = /^[a-z0-9][a-z0-9-]{0,63}\.(?:json|txt)$/;
export const DEV_FIXTURE_MAX_BYTES = 256 * 1024;
/** A custom header: a page of another site cannot send it without a CORS preflight, which the route never approves. */
export const DEV_FIXTURE_HEADER = "x-basis-dev-fixture";

/** "saved"; "exists" (a file of that name is already there, left untouched); "off" (no dev server with the plugin). */
export type DevFixtureResult = "saved" | "exists" | "off" | "failed";

/** POSTs `text` as UTF-8, byte for byte. Throws only for a bad name or size. */
export async function postDevFixture(name: string, text: string, fetchFn: typeof fetch = fetch): Promise<DevFixtureResult> {
  if (!DEV_FIXTURE_NAME.test(name)) throw new Error(`fixture name ${JSON.stringify(name)}: use lowercase letters, digits and hyphens, then .json or .txt`);
  const body = new TextEncoder().encode(text);
  if (body.length > DEV_FIXTURE_MAX_BYTES) throw new Error(`fixture of ${body.length} bytes is above ${DEV_FIXTURE_MAX_BYTES}`);
  try {
    const res = await fetchFn(DEV_FIXTURE_ROUTE + name, { method: "POST", headers: { "content-type": "text/plain; charset=utf-8", [DEV_FIXTURE_HEADER]: "1" }, body });
    if (res.status === 201) return "saved";
    if (res.status === 409) return "exists";
    if (res.status === 404) return "off";
    return "failed";
  } catch {
    return "failed";
  }
}

/** Saves a raw answer for the tests in a dev build; "off" in production builds. Never throws. */
export async function saveDevFixture(name: string, text: string): Promise<DevFixtureResult> {
  if (!import.meta.env.DEV) return "off";
  try {
    return await postDevFixture(name, text);
  } catch {
    return "failed";
  }
}

// ─── the dev server's half ──────────────────────────────────────────────────────────────────────

/** The parts of Node's request and response the handler uses (this project has no Node types). */
export interface DevFixtureRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on(event: "data", listener: (chunk: Uint8Array) => void): unknown;
  on(event: "end", listener: () => void): unknown;
}

export interface DevFixtureResponse {
  statusCode: number;
  setHeader(name: string, value: string): unknown;
  end(body: string): unknown;
}

/** Writes new files only: "exists" when the name is taken (the writer opens with flag "wx"). */
export type DevFixtureWriter = (name: string, bytes: Uint8Array) => Promise<"saved" | "exists">;

/**
 * Connect middleware for `DEV_FIXTURE_ROUTE` (mounted there, so `req.url` is "/<name>"): POST only, the custom
 * header, a same-machine Origin when there is one (http://127.0.0.1, localhost or [::1], any port: a browser always
 * sends Origin on a POST, so this also stops DNS rebinding), a valid name, at most 256 KB. 201 saved, 409 exists.
 */
export function devFixtureHandler(write: DevFixtureWriter): (req: DevFixtureRequest, res: DevFixtureResponse) => void {
  return (req, res) => {
    const reply = (status: number, text: string) => {
      res.statusCode = status;
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.end(text);
    };
    const origin = req.headers.origin;
    const name = (req.url ?? "").replace(/^\//, "").split("?")[0];
    if (req.method !== "POST") return reply(405, "POST only");
    if (req.headers[DEV_FIXTURE_HEADER] !== "1") return reply(403, `${DEV_FIXTURE_HEADER} missing`);
    if (origin !== undefined && !(typeof origin === "string" && /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d{1,5})?$/.test(origin))) return reply(403, "another origin");
    if (!DEV_FIXTURE_NAME.test(name)) return reply(400, "bad fixture name");
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size <= DEV_FIXTURE_MAX_BYTES) chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > DEV_FIXTURE_MAX_BYTES) return reply(413, `above ${DEV_FIXTURE_MAX_BYTES} bytes`);
      const bytes = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        bytes.set(c, at);
        at += c.length;
      }
      write(name, bytes).then(
        (r) => reply(r === "saved" ? 201 : 409, r),
        (e) => reply(500, `not saved: ${(e as Error).message}`),
      );
    });
  };
}
