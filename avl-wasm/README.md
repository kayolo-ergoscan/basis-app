# basis-avl-wasm

`ergo_avltree_rust` 0.1.1 (crates.io, pinned) behind a tiny C ABI, compiled to
`wasm32-unknown-unknown` for the Basis sandbox. The documentation, API, semantics and validation
results are in `../src/protocol/avl-wasm/README.md`.

| Path | What |
|---|---|
| `src/engine.rs` | safe API: `Prover` (with deep `fork`), `Verifier`, prechecks, error codes |
| `src/safe_verifier.rs` | bounds-checked port of the crate's `BatchAVLVerifier`: no panics on bad proofs, iterative build and teardown |
| `src/ffi.rs` | C exports (`avl_*`) |
| `tests/vectors.rs` | mainnet vectors, random sequences against the crate's verifier, fuzz, crafted deep trees; writes `vectors/random-*.json` |
| `tests/chain_bruteforce.rs` | `#[ignore]` tools used to recover timestamps of older on-chain reserve values |
| `scripts/compare.mjs` | replays `vectors/random-full.json` and the chain vectors through the raw wasm ABI |
| `build.sh` | low-priority build under `/root/basis/.build.lock`; `--test` runs everything |
