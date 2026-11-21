# avl-wasm: the real Ergo AVL+ tree in the browser

`avl.wasm` is the Rust crate **`ergo_avltree_rust` 0.1.1 from crates.io** compiled to WebAssembly.
It is the same crate that sigma-rust and the Basis tracker (`crates/basis_trees`) use. A small
hand-written C ABI wraps it, with no wasm-bindgen. The TypeScript glue is `avl-wasm.ts`.
`backend.ts` plugs it into the protocol engine's `AuthenticatedMap` (`../avl.ts`).

Digests and proofs are the chain's bytes. The tests rebuild real mainnet reserve trees, match the
output boxes' R5 digests, and regenerate the proofs found in confirmed mainnet transactions byte
for byte.

| | |
|---|---|
| `avl.wasm` | 120,121 bytes, 44,073 gzipped. No imports. Loads in 6–11 ms in Chromium 157 |
| JS glue (Vite bundle of `index.ts` with `../avl.ts` and @noble blake2b) | 27.7 KB, 9.95 KB gzipped |
| speed (Chromium) | 2,000 inserts plus 200 proofs in 30 ms |
| source crate | `/root/basis/avl-wasm` (Rust 1.85.0, `cdylib`; build with `./build.sh --test`) |

## Use

```ts
import { initAvl, ErgoAvlProver, verifyAvlProof, sigmaAvl, emptyAvlDigest } from "./avl-wasm";

await initAvl();                       // once; browser: the bundled asset, node/vitest: the file next to the module
const reserve = ErgoAvlProver.create(); // key 32 bytes, variable-length values: both Basis trees
reserve.insert(key, value);             // strict: KeyExists if present (sigma AvlTree.insert)
reserve.digest();                       // 33 bytes = R5 digest (root label ‖ height)
const p5 = reserve.prove([{ kind: "insertOrUpdate", key, value: next }]); // context var #5, tree unchanged
const p7 = reserve.proveLookup(key);    // context var #7 (#8 on the tracker tree)
verifyAvlProof(digest, p5.proof, [{ kind: "insertOrUpdate", key, value: next }]); // { ok, digest, results }
sigmaAvl.insert({ digest, flags: 0x03 }, [[key, value]], proof); // node semantics, incl. script errors
```

Every call is synchronous once `initAvl()` has resolved. Keys and values are `Uint8Array` or hex.

**Protocol engine backend.** The owner of `../avl.ts` (the protocol engine) wires it in with two lines:

```ts
registerAvlBackend("ergo-avl-wasm", () => import("./avl-wasm").then((m) => m.backend));
await useAvlBackend("ergo-avl-wasm"); // maps created afterwards are real Ergo AVL+ (simulated: false)
```

- `backend` is a lazy thenable, so `avl.wasm` is fetched only when the backend is awaited.
- `loadErgoAvlBackend(source?)` does the same as a plain function.
- The simulated map stays the default until then.
- `ErgoAvlMap` implements `AuthenticatedMap`:
  - `prove()` is `generateProofForOperations`;
  - `clone()` is a deep copy, not an operation-log replay;
  - errors are `AvlOperationError` / `AvlProofError`.
- `ergoAvlVerifier` implements the stateless `AvlVerifier`.

## API (avl-wasm.ts)

| | |
|---|---|
| `initAvl(source?)` | loads once. `source`: URL, bytes, `Response` or `WebAssembly.Module`. Returns `{ version, abi, wasmBytes, restarts }` |
| `ErgoAvlProver.create({ keyLength = 32, valueLength = null })` | empty tree. `ErgoAvlProver.from(ops)` replays operations (the AVL+ shape depends on order) |
| `.insert / .update / .insertOrUpdate / .remove / .removeIfExists / .lookup` | these throw `AvlError`. `.apply(op)` returns `{ ok, old? } \| { ok: false, error }` and never throws |
| `.get(key)` | unauthenticated read, not part of any proof |
| `.generateProof()` | proof of every operation since the previous call, against the digest current then |
| `.prove(ops)` / `.proveLookup(key)` | proof from the current digest without changing the tree (they run on a fork) |
| `.fork()` | independent deep copy, including pending operations, with a clean proof state |
| `.digest()`, `.size`, `.height`, `.pending`, `.info()` | tree state |
| `.dump()`, `.entries()` | whole tree with labels and balances (for drawing it); entries in key order |
| `.free()` | releases wasm memory now; otherwise a `FinalizationRegistry` does it |
| `ErgoAvlVerifier.create(digest, proof, { maxNumOperations?, maxDeletes? })` | `.apply(op)`, `.digest()` (null once failed), `.failure()` |
| `verifyAvlProof(digest, proof, ops, params?)` | one shot. `{ ok, digest, results, failedAt?, error? }`; never throws for bad proofs |
| `sigmaAvl.get / getMany / contains / insert / insertOrUpdate / update / remove` | sigma's `AvlTree` methods: flags, `None`, script errors |
| `decodeAvlProof(proof)` | pure TS proof X-ray: labels, leaves, balances, direction bits, byte offsets |
| `emptyAvlDigest()`, `avlBlake2b256()`, `avlLiveHandles()`, `avlInfo()` | helpers |

`AvlError.code` is one of:

| Code | Meaning |
|---|---|
| `KeyExists` | insert of a key that is present |
| `KeyMissing` | update or remove of an absent key |
| `KeyOutOfRange` | key is all `00` or all `ff`; these are the sentinels |
| `BadArgument` | wrong key length, or a fixed-length value of the wrong size |
| `ProofInvalid` | the proof does not authenticate |
| `VerifierFailed` | the verifier already failed |
| `Trap` | the wasm instance crashed (see Hardening) |
| `NotInitialised` | `initAvl()` has not resolved |
| `Internal` | none of the above |

## Semantics (same as the chain)

**Trees.**
- Both Basis trees: key length 32, variable-length values.
  - Tracker tree: `blake2b256(owner‖receiver[‖tokenId])` → 8-byte `totalDebt`.
  - Reserve tree: `blake2b256(owner‖receiver)` → `timestamp(8) ‖ redeemed(8)`.
- Empty digest `4ec61f48…e160900`: the root label of the lone −∞ leaf, height 0.

**Operations.**
- Same as `BatchAVLProver` / `BatchAVLVerifier` in scrypto and in crates.io 0.1.1:
  - insert is strict;
  - update needs the key;
  - insertOrUpdate, remove, removeIfExists;
  - lookup proves absence too.
- In the prover, a failed operation changes nothing and is not pending.
- In the verifier, a failed operation fails the verifier for good, as on the JVM.

**Proofs.**
- A proof does not say which operations it is for: the verifier is told, and in the contract the
  script supplies them.
- An update of an existing key does not change the tree's shape. So its proof equals the lookup
  proof of that key. On chain, #7 == #5 in tx `cfcd8579…`.
- The tracker's real proofs come from basis_trees `generate_proof_for_operations`. `prove()` is
  the same thing on a deep copy.

**What sigma's `AvlTree` methods do.** These were read from the sigmastate / sigma-rust sources
and match what the mainnet transactions show. They have not been run here.

| method | flag not set | bad proof or a failing entry |
|---|---|---|
| `get` | — | script error ("Tree proof is incorrect") |
| `contains` | — | `false` |
| `insert` | `None` | **script error** ("Incorrect insert") |
| `insertOrUpdate` (v6) | `None` | script error |
| `update`, `remove` | `None` | `None` |

The verifier runs with the tree's key length and value length, and with no operation limits.

Basis calls `.get` on these Options, so a `None` fails the spend as well. In `sigmaAvl` that is a
result with `value === null`.

**Replay protection.**
- A first redemption sends no #7. The contract then uses `insert`, which must fail when the pair
  is already in the tree.
- The tests check exactly this with real bytes: `sigmaAvl.insert` with the on-chain #5 of tx
  `cfcd8579…` is a script error (`KeyExists`).
- Answer to `research/notes/01-contracts.md` "Open conflict about insert semantics":
  - crates.io 0.1.1 and the JVM reject the replay;
  - the tracker's vendored copy would accept it.

## Why crates.io and not the vendored copy

`basis-tracker/temp/vendors/ergo_avltree_rust` differs from crates.io 0.1.1 in one place only,
`operation.rs`. There, `Insert` of a present key becomes an update ("JVM / Basis-compatible
behavior"). But that is not what the JVM does:
- scrypto's `Insert` fails on an existing key;
- sigma turns that failure into a script error;
- the reserve contract depends on it.

So the vendored copy is fine for the tracker's own local reduction and wrong for emulating the
chain. We pin `ergo_avltree_rust = "=0.1.1"`; the crate archive's sha256 is
`040e68223ab3775e54463c0f97b340d8fe6b4080acc5236fb4c19da477650668`.

**Also for the tracker team:** basis_trees' verifier "miscomputes the final label on the update
path".
- The cause is its resolver. It returns a dummy `Leaf`, and `AVLTree::copy()` resolves pruned
  children through it, which replaces sibling labels.
- The fix is the sigma-rust resolver, `Node::LabelOnly(NodeHeader::new(Some(digest), None))`. We
  use it everywhere.

## Hardening

- **The crate's verifier panics on malformed proofs.** It indexes `proof[i]` and calls
  `stack.pop().unwrap()`. In wasm a panic would trap.
  - The verifier here, `safe_verifier.rs`, is a bounds-checked port of the crate's
    `BatchAVLVerifier`. It runs the crate's own modify, rotation and label code, so the semantics
    are the same.
  - The native tests compare it with the crate's verifier on every random proof and on 485
    mutated mainnet proofs: all 121 truncations, 363 bit flips and trailing bytes.
  - Wherever the crate does not panic, the two agree exactly.
- **Crafted trees.** Someone who also chooses the digest can describe a degenerate tree tens of
  thousands of levels deep.
  - Building, rejecting and freeing such a tree are iterative, at any depth: labels are hashed
    bottom-up, and teardown is non-recursive. This is tested at 100,000 levels on a 256 KiB
    native stack and at 300,000 levels in wasm.
  - Lookups through such a tree recurse in the crate and work up to about 3,000 levels (the wasm
    stack is 1 MiB). Deeper ones trap.
  - Honest trees are at most about 1.44·log2(n) deep: 13 for 2,000 entries, about 44 for a
    billion.
- **Crashes are contained.**
  - Verifiers live in their own wasm instance, separate from the provers, and a spare instance is
    kept ready.
  - Any trap, stack overflow or out-of-memory poisons only its instance. The glue replaces that
    instance, and the operation reports `ProofInvalid`.
  - Objects that lived in a crashed prover instance throw `Trap`. Rebuild them from your event
    log.
- **Build paths are stripped.** `.cargo/config.toml` remaps the build paths, so `avl.wasm`
  contains no `/root/...` strings.

## Validation (all passing)

1. **Empty digest.** `4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900`. It
   equals:
   - R5 of fresh mainnet reserves, e.g. `3857cf9f…` and `aa8340fc…`;
   - `EMPTY_AVL_DIGEST_HEX` in `../registers.ts`.
2. **Mainnet redemptions, replayed with sigma semantics** (`vectors-chain.json`; the proofs come
   from the transactions' context extensions):

   | tx | height | what |
   |---|---|---|
   | `4b65c7cd…` | 1832709 | first redemption: #8 → totalDebt 0.2 ERG, `insert` #5 → R5 of `8dc21481…` (`f91e7e76…01`) |
   | `cfcd8579…` | 1833071 | second redemption of the same pair: #7 → previous `ts ‖ 0.1 ERG`, `insertOrUpdate` #5 → R5 of `3ae59d54…` (`d077c133…01`) |
   | `85b14cc0…` | 1827032 | older InsertOnly reserve: #8 → 0.4 ERG, `insert` #5 → R5 of `9b748164…` (`616188e2…01`) |

   - The prover regenerates the on-chain #5, #7 and #8 bytes exactly.
   - It also rebuilds tracker box `b9c4bdbd…`'s digest `8f8e9d30…01`.
   - It reproduces 4 more digests of older reserves after one redemption.
3. **Native ≡ wasm.**
   - `cargo test --test vectors` runs 4 seeded scenarios (2,800 operations, 761 of them failing
     on purpose, and 957 proofs):
     - tracker-like with 8-byte values;
     - reserve-like with 16-byte values;
     - mixed variable-length;
     - fixed-length.
   - Each proof is replayed on our verifier and on the crate's.
   - The test writes `vectors/random-full.json`.
   - `scripts/compare.mjs` replays every operation, proof byte and digest through the raw wasm
     ABI. Result: `OK: wasm == native`.
4. **vitest** (`avl-wasm.test.ts`, 20 tests):
   - regenerates the same operations in TS and matches the native rolling hashes and checkpoints
     (`vectors-random.json`);
   - the mainnet vectors through `sigmaAvl` and through the `AuthenticatedMap` backend;
   - prover API, fork independence, verifier limits;
   - hostile proofs, crash recovery, leak check.
5. **Browser.** The Vite bundle of `index.ts` loads `avl.wasm` in headless Chromium 157, and the
   mainnet vectors match there too.

## C ABI (abi 1)

- **Inputs.** Write bytes into `avl_scratch(len)`, or into a buffer you own via
  `avl_alloc(len)` / `avl_dealloc(ptr, len)`. Pass `(ptr, len)` pairs.
- **Results.**
  - `i32`: ≥ 0 means success, < 0 is an error code with a UTF-8 message in the OUT buffer.
  - Byte results go to OUT, read with `avl_out_ptr()` / `avl_out_len()` right after the call.
- **Handles.** Integer handles for provers and verifiers.
- **Lengths.** `value_len < 0` means variable length. Verifier limits `< 0` mean no limit.

| Group | Exports |
|---|---|
| Runtime | `avl_init` (returns 1), `avl_version`, `avl_panic_ptr` / `avl_panic_len`, `avl_live_handles` |
| Hashing | `avl_blake2b256(ptr, len)`, `avl_empty_digest(key_len, value_len)` |
| Prover | `avl_prover_new` / `_free` / `_op(h, kind, key, val)` / `_peek` / `_digest` / `_proof` / `_fork` / `_info` / `_dump` |
| Verifier | `avl_verifier_new(digest, proof, key_len, value_len, max_ops, max_deletes)` / `_op` / `_digest` / `_free` |

Operation `kind`: 0 lookup, 1 insert, 2 update, 3 insertOrUpdate, 4 remove, 5 removeIfExists.

Op return value: 0 = key was absent; 1 = key was present, with the old value in OUT.

Error codes:

| Code | Error |
|---|---|
| −1 | `BadHandle` |
| −2 | `BadArgument` |
| −3 | `KeyExists` |
| −4 | `KeyMissing` |
| −5 | `ProofInvalid` |
| −6 | `VerifierFailed` |
| −7 | `KeyOutOfRange` |
| −8 | `Internal` |

## Rebuild

```sh
cd /root/basis/avl-wasm && ./build.sh --test
```

The script:
- runs at `nice 19` / `ionice -c3` under `/root/basis/.build.lock`, with `cargo -j 3`;
- runs the native tests and builds the wasm (`opt-level = "z"`, LTO, `panic = "abort"`, stripped);
- copies `avl.wasm` and the vectors here;
- runs `compare.mjs`.

Then run the app tests: `npx vitest run src/protocol/avl-wasm`.
