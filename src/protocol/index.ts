// Basis protocol engine — pure TypeScript, no React, no network. See PROTOCOL_API.md.
//
//   bytes, keys, note, registers, schnorr  — bit-exact primitives (80-byte note message, Ergo Schnorr)
//   avl                                     — AuthenticatedMap (simulated default; real Ergo AVL+ via WASM)
//   policy                                  — acceptance policies, both server evaluators, FIFO compliance
//   clock                                   — 120 s blocks, protocol windows
//   reserve                                 — basis.es / basis-token.es evaluator + reserve state
//   tracker                                 — tracker server emulator
//   events, economy, clearing               — event-sourced economy
//   timemachine, scenarios                  — replays, forks, presets

import { registerAvlBackend } from "./avl";

export * from "./bytes";
export * from "./keys";
export * from "./note";
export * from "./registers";
export * from "./schnorr";
export * from "./rng";
export * from "./avl";
export * from "./policy";
export * from "./clock";
export * from "./reserve";
export * from "./tracker";
export * from "./events";
export * from "./clearing";
export * from "./economy";
export * from "./timemachine";
export * from "./scenarios";

/** Id of the real Ergo AVL+ backend (avl-wasm/, loaded lazily on `useAvlBackend(ERGO_AVL_WASM)`). */
export const ERGO_AVL_WASM = "ergo-avl-wasm";

registerAvlBackend(ERGO_AVL_WASM, () => import("./avl-wasm").then((m) => m.backend));
