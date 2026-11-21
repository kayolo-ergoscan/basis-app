import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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
    rollupOptions: {
      output: {
        manualChunks: {
          three: ["three", "@react-three/fiber", "@react-three/drei"],
          crypto: ["@noble/curves/secp256k1", "@noble/hashes/blake2b"],
        },
      },
    },
  },
});
