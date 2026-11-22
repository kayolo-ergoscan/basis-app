import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { DEV_FIXTURE_ROUTE, devFixtureHandler, type DevFixtureRequest, type DevFixtureResponse } from "./src/mainnet/tx/devfixture";

// Vendor chunks (function form, so only modules that are really imported land in a chunk):
//   react  — react, react-dom, scheduler and the router: the shell needs them on every page;
//   hashes — @noble/hashes (blake2b/sha256), shared by the shell's seals and every protocol page.
// @noble/curves is not named: Rollup keeps it with the lazy wallet / world / protocol chunks that import it, so the
// secp256k1 code is never preloaded on a page that does not sign anything. three.js is not used by the app.
function manualChunks(id: string): string | undefined {
  if (!id.includes("/node_modules/")) return undefined;
  if (/\/node_modules\/(react|react-dom|scheduler|react-router|react-router-dom|@remix-run\/router)\//.test(id)) return "react";
  if (id.includes("/node_modules/@noble/hashes/")) return "hashes";
  return undefined;
}

// Release guard: a text that still waits for facts carries the FILL marker ("[[" + "FILL", see
// src/content/placeholders.test.ts). `vite build` refuses every app module that still holds it, so scripts/build.sh
// fails until the text is written; the dev server shows the placeholder as it is.
const SRC_DIR = new URL("./src/", import.meta.url).pathname; // this tree's src, worktrees included
const FILL_MARK = "[[" + "FILL";
const refuseUnfilled: Plugin = {
  name: "refuse-unfilled",
  apply: "build",
  transform(code, id) {
    if (id.startsWith(SRC_DIR) && code.includes(FILL_MARK)) {
      this.error(`src/${id.slice(SRC_DIR.length)} still holds a ${FILL_MARK}…]] placeholder: write the text before building`);
    }
    return null;
  },
};

// Dev only, opt-in: `BASIS_DEV_FIXTURES=1 npx vite` lets the closed wallet canary save raw tracker answers, exactly as
// received, as test fixtures in /root/basis/qa/fixtures/ (src/mainnet/tx/devfixture.ts). Never in a build, a preview
// or vitest; new files only (flag "wx"); the handler checks the method, a custom header, the Origin, the name and size.
const DEV_FIXTURE_DIR = "/root/basis/qa/fixtures/";
const processEnv = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const saveDevFixtures: Plugin = {
  name: "basis-dev-fixtures",
  apply: (_config, env) => env.command === "serve" && !env.isPreview && env.mode !== "test" && processEnv.BASIS_DEV_FIXTURES === "1",
  configureServer(server) {
    const handle = devFixtureHandler(async (name, bytes) => {
      const fsModule = "node:fs/promises"; // a variable: this project has no Node types
      const fs = (await import(/* @vite-ignore */ fsModule)) as { writeFile(path: string, data: Uint8Array, opts: { flag: "wx" }): Promise<void> };
      try {
        await fs.writeFile(DEV_FIXTURE_DIR + name, bytes, { flag: "wx" });
        return "saved";
      } catch (e) {
        if ((e as { code?: string }).code === "EEXIST") return "exists";
        throw e;
      }
    });
    server.middlewares.use(DEV_FIXTURE_ROUTE, (req, res) => handle(req as unknown as DevFixtureRequest, res as unknown as DevFixtureResponse));
  },
};

// Dev and preview:
//   /v1/*          → the ErgoScan API contour (:4401), the same place Caddy sends it on basis.ergoscan.me;
//   /api/tracker/* → our tracker's front (nginx on :3050), prefix stripped. The front adds the key itself, allows only
//                    the public read routes and limits each IP; the app never talks to the tracker (:3048) directly.
const proxy = {
  "/v1": { target: "http://127.0.0.1:4401", changeOrigin: false },
  "/api/tracker/": { target: "http://127.0.0.1:3050", changeOrigin: false, rewrite: (p: string) => p.replace(/^\/api\/tracker/, "") || "/" },
};

export default defineConfig({
  plugins: [react(), refuseUnfilled, saveDevFixtures],
  // Relative to this file, so a worktree under /root/basis/app-wt/ resolves `@/` to its own src, not the main tree.
  resolve: { alias: { "@": new URL("./src", import.meta.url).pathname } },
  server: { host: "127.0.0.1", proxy },
  preview: { host: "127.0.0.1", proxy },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks } },
  },
});
