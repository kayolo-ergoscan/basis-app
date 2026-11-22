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

// Dev: /v1 goes to the ErgoScan API contour (:4401), the same place Caddy sends it on basis.ergoscan.me.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": "/root/basis/app/src" } },
  server: { host: "127.0.0.1", proxy: { "/v1": { target: "http://127.0.0.1:4401", changeOrigin: false } } },
  preview: { host: "127.0.0.1", proxy: { "/v1": { target: "http://127.0.0.1:4401", changeOrigin: false } } },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { output: { manualChunks } },
  },
});
