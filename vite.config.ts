import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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

// Dev and preview:
//   /v1/*          → the ErgoScan API contour (:4401), the same place Caddy sends it on basis.ergoscan.me;
//   /api/tracker/* → our tracker's front (nginx on :3050), prefix stripped. The front adds the key itself, allows only
//                    the public read routes and limits each IP; the app never talks to the tracker (:3048) directly.
const proxy = {
  "/v1": { target: "http://127.0.0.1:4401", changeOrigin: false },
  "/api/tracker/": { target: "http://127.0.0.1:3050", changeOrigin: false, rewrite: (p: string) => p.replace(/^\/api\/tracker/, "") || "/" },
};

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": "/root/basis/app/src" } },
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
