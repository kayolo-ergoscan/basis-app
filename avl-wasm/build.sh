#!/usr/bin/env bash
# Builds avl.wasm (release, opt-level z, LTO, stripped) at the lowest CPU/IO priority, under the
# shared build lock, and copies it into the app. Usage: ./build.sh [--test]
#   --test  also runs the native tests (regenerates vectors/) and the wasm comparison script.
set -euo pipefail
cd "$(dirname "$0")"
export CARGO_TARGET_DIR=/root/basis/avl-wasm/target
LOCK=/root/basis/.build.lock
OUT=/root/basis/app/src/protocol/avl-wasm
LOW="nice -n 19 ionice -c3"

if [[ "${1:-}" == "--test" ]]; then
  flock -w 900 "$LOCK" $LOW cargo test -j 3 --test vectors
fi

flock -w 900 "$LOCK" $LOW cargo build -j 3 --release --target wasm32-unknown-unknown
WASM="$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/basis_avl_wasm.wasm"
install -m 644 "$WASM" "$OUT/avl.wasm"
install -m 644 vectors/chain-vectors.json "$OUT/vectors-chain.json"
install -m 644 vectors/random-compact.json "$OUT/vectors-random.json"

bytes=$(stat -c %s "$OUT/avl.wasm")
gz=$(gzip -9 -c "$OUT/avl.wasm" | wc -c)
echo "avl.wasm: $bytes bytes ($gz gzipped), sha256 $(sha256sum "$OUT/avl.wasm" | cut -c1-16)"

if [[ "${1:-}" == "--test" ]]; then
  $LOW node scripts/compare.mjs "$OUT/avl.wasm" vectors/random-full.json vectors/chain-vectors.json
fi
