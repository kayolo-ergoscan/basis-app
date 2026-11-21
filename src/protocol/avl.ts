// Authenticated key → value maps (the AVL+ trees in tracker R5 and reserve R5).
//
// The engine talks to one interface, `AuthenticatedMap`, and to an optional stateless `AvlVerifier`.
// Two kinds of backend can sit behind it:
//   • "simulated" (this file, default): a deterministic Merkle-ised sorted map. It authenticates exactly like
//     a real tree (proofs are checked against digests, tampering is caught), but its digests and proof bytes
//     are NOT Ergo AVL+ bytes. Every map and every digest it produces is flagged `simulated: true`.
//     The digest of an EMPTY map is the real Ergo empty AVL+ digest (what a fresh reserve's R5 holds).
//   • a real Ergo AVL+ backend (src/protocol/avl-wasm/, built by another engineer) registered at runtime
//     with `registerAvlBackend` / `useAvlBackend`, async init allowed.
//
// Simulated layout: a binary Merkle tree of depth 16 over the first two key bytes; leaf i is the sorted
// bucket of all entries whose key starts with i (big-endian u16).
//   leaf  = blake2b256(0x00 ‖ VLQ(n) ‖ (key ‖ VLQ(len) ‖ value)*)
//   node  = blake2b256(0x01 ‖ left ‖ right)
//   digest = root(32) ‖ 0x10      (0x10 = depth 16; an empty map uses the real empty AVL+ digest)
// Proof bytes: "BSIM" ‖ 0x01 ‖ VLQ(keyLength) ‖ VLQ(parts) ‖ parts, one part per operation:
//   VLQ(bucket) ‖ VLQ(n) ‖ entries ‖ 16 sibling hashes (leaf level first).

import { blake2b256, bytesToHex, compareBytes, concatBytes, equalBytes, hexToBytes, type Hex } from "./bytes";
import { EMPTY_AVL_DIGEST_HEX, vlqDecode, vlqEncode } from "./registers";

export type AvlOperation =
  | { op: "lookup"; key: Uint8Array }
  | { op: "insert"; key: Uint8Array; value: Uint8Array }
  | { op: "update"; key: Uint8Array; value: Uint8Array }
  | { op: "insertOrUpdate"; key: Uint8Array; value: Uint8Array };

/** The proof does not authenticate against the digest (sigma: "Tree proof is incorrect"). */
export class AvlProofError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvlProofError";
  }
}

/** The operation itself is impossible: insert of a present key, update of a missing key. */
export class AvlOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AvlOperationError";
  }
}

export interface AvlProofResult {
  proof: Uint8Array;
  digestBefore: Uint8Array;
  digestAfter: Uint8Array;
  /** Per operation: the value found before the operation (null when absent). */
  results: (Uint8Array | null)[];
}

export interface AuthenticatedMap {
  /** Backend id, e.g. "simulated" or "ergo-avl-wasm". */
  readonly backend: string;
  /** True when digests/proofs are not real Ergo AVL+ bytes. */
  readonly simulated: boolean;
  readonly keyLength: number;
  readonly size: number;
  get(key: Uint8Array): Uint8Array | undefined;
  has(key: Uint8Array): boolean;
  /** Throws AvlOperationError when the key exists. */
  insert(key: Uint8Array, value: Uint8Array): void;
  /** Throws AvlOperationError when the key is missing. */
  update(key: Uint8Array, value: Uint8Array): void;
  insertOrUpdate(key: Uint8Array, value: Uint8Array): void;
  /** 33 bytes: root label ‖ height, as stored in an AvlTree register. */
  digest(): Uint8Array;
  /** Lookup proof for `key` against the current digest (works for present and absent keys). */
  proofFor(key: Uint8Array): Uint8Array;
  /** Proof for a batch of operations WITHOUT applying them (BatchAVLProver.generateProofForOperations). */
  prove(ops: AvlOperation[]): AvlProofResult;
  clone(): AuthenticatedMap;
  /** All entries in key order. */
  entries(): Array<[Uint8Array, Uint8Array]>;
}

/** Stateless verification, the way the reserve contract runs `AvlTree.get/insert/insertOrUpdate`. */
export interface AvlVerifier {
  /** Value or null (absent). Throws AvlProofError when the proof does not match the digest. */
  lookup(digest: Uint8Array, key: Uint8Array, proof: Uint8Array): Uint8Array | null;
  /** New digest. Throws AvlProofError (bad proof) or AvlOperationError (key present). */
  insert(digest: Uint8Array, entries: Array<[Uint8Array, Uint8Array]>, proof: Uint8Array): Uint8Array;
  /** New digest. Throws AvlProofError on a bad proof. */
  insertOrUpdate(digest: Uint8Array, entries: Array<[Uint8Array, Uint8Array]>, proof: Uint8Array): Uint8Array;
}

export interface AvlBackend {
  readonly id: string;
  readonly label: string;
  readonly simulated: boolean;
  createMap(keyLength?: number): AuthenticatedMap;
  /** Null when the backend cannot verify proofs statelessly; the engine then replays against the box's own map. */
  readonly verifier: AvlVerifier | null;
}

export const EMPTY_AVL_DIGEST: Uint8Array = hexToBytes(EMPTY_AVL_DIGEST_HEX);

// ---------------------------------------------------------------------------------------------
// simulated backend
// ---------------------------------------------------------------------------------------------

const DEPTH = 16;
const LEAF_BASE = 1 << DEPTH;
const HEIGHT_BYTE = 0x10;
const MAGIC = Uint8Array.of(0x42, 0x53, 0x49, 0x4d); // "BSIM"
const PROOF_VERSION = 1;

type Entry = readonly [Uint8Array, Uint8Array];

function leafHash(entries: readonly Entry[]): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(0x00), vlqEncode(entries.length)];
  for (const [k, v] of entries) parts.push(k, vlqEncode(v.length), v);
  return blake2b256(...parts);
}

const NODE_TAG = Uint8Array.of(0x01);
function nodeHash(l: Uint8Array, r: Uint8Array): Uint8Array {
  return blake2b256(NODE_TAG, l, r);
}

/** DEFAULTS[l] = hash of an empty subtree whose root sits at level l (0 = root, 16 = leaf). */
const DEFAULTS: Uint8Array[] = (() => {
  const d: Uint8Array[] = new Array(DEPTH + 1);
  d[DEPTH] = leafHash([]);
  for (let l = DEPTH - 1; l >= 0; l--) d[l] = nodeHash(d[l + 1], d[l + 1]);
  return d;
})();

function bucketOf(key: Uint8Array): number {
  return (key[0] << 8) | key[1];
}

function digestFromRoot(root: Uint8Array): Uint8Array {
  if (equalBytes(root, DEFAULTS[0])) return EMPTY_AVL_DIGEST.slice();
  return concatBytes(root, Uint8Array.of(HEIGHT_BYTE));
}

function rootFromDigest(d: Uint8Array): Uint8Array {
  if (d.length !== 33) throw new AvlProofError(`digest must be 33 bytes (got ${d.length})`);
  if (equalBytes(d, EMPTY_AVL_DIGEST)) return DEFAULTS[0];
  if (d[32] !== HEIGHT_BYTE) throw new AvlProofError("digest was not produced by the simulated backend");
  return d.subarray(0, 32);
}

function findIndex(entries: readonly Entry[], key: Uint8Array): { found: boolean; index: number } {
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const c = compareBytes(entries[mid][0], key);
    if (c === 0) return { found: true, index: mid };
    if (c < 0) lo = mid + 1;
    else hi = mid;
  }
  return { found: false, index: lo };
}

/** Applies one operation to a bucket (copy-on-write). Returns the new bucket and the previous value. */
function applyToBucket(bucket: readonly Entry[], op: AvlOperation): { next: readonly Entry[]; before: Uint8Array | null } {
  const { found, index } = findIndex(bucket, op.key);
  const before = found ? bucket[index][1] : null;
  switch (op.op) {
    case "lookup":
      return { next: bucket, before };
    case "insert":
      if (found) throw new AvlOperationError(`insert: key ${bytesToHex(op.key)} already exists`);
      break;
    case "update":
      if (!found) throw new AvlOperationError(`update: key ${bytesToHex(op.key)} does not exist`);
      break;
    case "insertOrUpdate":
      break;
  }
  const next = bucket.slice();
  const entry: Entry = [op.key.slice(), op.value.slice()];
  if (found) next[index] = entry;
  else next.splice(index, 0, entry);
  return { next, before };
}

function climb(bucket: number, leaf: Uint8Array, siblings: readonly Uint8Array[]): Uint8Array {
  let idx = LEAF_BASE + bucket;
  let h = leaf;
  for (let i = 0; i < DEPTH; i++) {
    h = idx & 1 ? nodeHash(siblings[i], h) : nodeHash(h, siblings[i]);
    idx >>= 1;
  }
  return h;
}

function leafOrDefault(bucket: readonly Entry[]): Uint8Array {
  return bucket.length === 0 ? DEFAULTS[DEPTH] : leafHash(bucket);
}

interface ProofPart {
  bucket: number;
  entries: Entry[];
  siblings: Uint8Array[];
}

function encodeProof(keyLength: number, parts: ProofPart[]): Uint8Array {
  const out: Uint8Array[] = [MAGIC, Uint8Array.of(PROOF_VERSION), vlqEncode(keyLength), vlqEncode(parts.length)];
  for (const p of parts) {
    out.push(vlqEncode(p.bucket), vlqEncode(p.entries.length));
    for (const [k, v] of p.entries) out.push(k, vlqEncode(v.length), v);
    out.push(...p.siblings);
  }
  return concatBytes(...out);
}

function decodeProof(proof: Uint8Array): { keyLength: number; parts: ProofPart[] } {
  try {
    if (proof.length < 7 || !equalBytes(proof.subarray(0, 4), MAGIC)) throw new Error("bad magic");
    if (proof[4] !== PROOF_VERSION) throw new Error("bad version");
    let pos = 5;
    const kl = vlqDecode(proof, pos);
    const keyLength = Number(kl.value);
    pos = kl.next;
    const pc = vlqDecode(proof, pos);
    pos = pc.next;
    const parts: ProofPart[] = [];
    for (let i = 0; i < Number(pc.value); i++) {
      const b = vlqDecode(proof, pos);
      pos = b.next;
      const n = vlqDecode(proof, pos);
      pos = n.next;
      const entries: Entry[] = [];
      for (let j = 0; j < Number(n.value); j++) {
        const k = proof.subarray(pos, pos + keyLength);
        pos += keyLength;
        const vl = vlqDecode(proof, pos);
        pos = vl.next;
        const v = proof.subarray(pos, pos + Number(vl.value));
        pos += Number(vl.value);
        if (k.length !== keyLength || v.length !== Number(vl.value)) throw new Error("truncated entry");
        entries.push([k, v]);
      }
      const siblings: Uint8Array[] = [];
      for (let s = 0; s < DEPTH; s++) {
        const h = proof.subarray(pos, pos + 32);
        if (h.length !== 32) throw new Error("truncated siblings");
        siblings.push(h);
        pos += 32;
      }
      parts.push({ bucket: Number(b.value), entries, siblings });
    }
    return { keyLength, parts };
  } catch (e) {
    throw new AvlProofError(`malformed proof: ${(e as Error).message}`);
  }
}

class SimulatedMap implements AuthenticatedMap {
  readonly backend = "simulated";
  readonly simulated = true;
  readonly keyLength: number;
  private buckets: Map<number, readonly Entry[]>;
  private nodes: Map<number, Uint8Array>;
  private dirty: Set<number>;
  private count: number;

  constructor(keyLength = 32, init?: { buckets: Map<number, readonly Entry[]>; nodes: Map<number, Uint8Array>; dirty: Set<number>; count: number }) {
    if (keyLength < 2) throw new Error("simulated AVL needs keys of at least 2 bytes");
    this.keyLength = keyLength;
    this.buckets = init ? new Map(init.buckets) : new Map();
    this.nodes = init ? new Map(init.nodes) : new Map();
    this.dirty = init ? new Set(init.dirty) : new Set();
    this.count = init ? init.count : 0;
  }

  get size(): number {
    return this.count;
  }

  private checkKey(key: Uint8Array): void {
    if (key.length !== this.keyLength) throw new AvlOperationError(`key must be ${this.keyLength} bytes (got ${key.length})`);
  }

  get(key: Uint8Array): Uint8Array | undefined {
    this.checkKey(key);
    const b = this.buckets.get(bucketOf(key));
    if (!b) return undefined;
    const { found, index } = findIndex(b, key);
    return found ? b[index][1] : undefined;
  }

  has(key: Uint8Array): boolean {
    return this.get(key) !== undefined;
  }

  private mutate(op: AvlOperation): void {
    this.checkKey(op.key);
    const bi = bucketOf(op.key);
    const bucket = this.buckets.get(bi) ?? [];
    const { next, before } = applyToBucket(bucket, op);
    if (before === null) this.count++;
    this.buckets.set(bi, next);
    this.dirty.add(bi);
  }

  insert(key: Uint8Array, value: Uint8Array): void {
    this.mutate({ op: "insert", key, value });
  }

  update(key: Uint8Array, value: Uint8Array): void {
    this.mutate({ op: "update", key, value });
  }

  insertOrUpdate(key: Uint8Array, value: Uint8Array): void {
    this.mutate({ op: "insertOrUpdate", key, value });
  }

  private flush(): void {
    if (this.dirty.size === 0) return;
    let level = new Set<number>();
    for (const b of this.dirty) {
      const idx = LEAF_BASE + b;
      const entries = this.buckets.get(b);
      if (entries && entries.length > 0) this.nodes.set(idx, leafHash(entries));
      else this.nodes.delete(idx);
      level.add(idx >> 1);
    }
    this.dirty.clear();
    for (let l = DEPTH - 1; l >= 0; l--) {
      const next = new Set<number>();
      for (const idx of level) {
        const lh = this.nodes.get(idx * 2);
        const rh = this.nodes.get(idx * 2 + 1);
        if (!lh && !rh) this.nodes.delete(idx);
        else this.nodes.set(idx, nodeHash(lh ?? DEFAULTS[l + 1], rh ?? DEFAULTS[l + 1]));
        if (idx > 1) next.add(idx >> 1);
      }
      level = next;
    }
  }

  private root(): Uint8Array {
    this.flush();
    return this.nodes.get(1) ?? DEFAULTS[0];
  }

  digest(): Uint8Array {
    return digestFromRoot(this.root());
  }

  proofFor(key: Uint8Array): Uint8Array {
    return this.prove([{ op: "lookup", key }]).proof;
  }

  prove(ops: AvlOperation[]): AvlProofResult {
    const rootBefore = this.root();
    const obuckets = new Map<number, readonly Entry[]>();
    const onodes = new Map<number, Uint8Array>();
    const node = (idx: number, level: number): Uint8Array => onodes.get(idx) ?? this.nodes.get(idx) ?? DEFAULTS[level];
    const parts: ProofPart[] = [];
    const results: (Uint8Array | null)[] = [];
    for (const op of ops) {
      this.checkKey(op.key);
      const bi = bucketOf(op.key);
      const bucket = obuckets.get(bi) ?? this.buckets.get(bi) ?? [];
      const siblings: Uint8Array[] = [];
      let idx = LEAF_BASE + bi;
      for (let l = DEPTH; l >= 1; l--) {
        siblings.push(node(idx ^ 1, l));
        idx >>= 1;
      }
      parts.push({ bucket: bi, entries: bucket.map(([k, v]) => [k, v] as Entry), siblings });
      const { next, before } = applyToBucket(bucket, op);
      results.push(before);
      if (next !== bucket) {
        obuckets.set(bi, next);
        // recompute the path in the overlay
        let i = LEAF_BASE + bi;
        let h = leafOrDefault(next);
        onodes.set(i, h);
        for (let l = DEPTH; l >= 1; l--) {
          const sib = node(i ^ 1, l);
          h = i & 1 ? nodeHash(sib, h) : nodeHash(h, sib);
          i >>= 1;
          onodes.set(i, h);
        }
      }
    }
    const rootAfter = onodes.get(1) ?? rootBefore;
    return { proof: encodeProof(this.keyLength, parts), digestBefore: digestFromRoot(rootBefore), digestAfter: digestFromRoot(rootAfter), results };
  }

  clone(): AuthenticatedMap {
    return new SimulatedMap(this.keyLength, { buckets: this.buckets, nodes: this.nodes, dirty: this.dirty, count: this.count });
  }

  entries(): Array<[Uint8Array, Uint8Array]> {
    const keys = [...this.buckets.keys()].sort((a, b) => a - b);
    const out: Array<[Uint8Array, Uint8Array]> = [];
    for (const k of keys) for (const [ek, ev] of this.buckets.get(k)!) out.push([ek, ev]);
    return out;
  }
}

function verifyOps(digest: Uint8Array, ops: AvlOperation[], proof: Uint8Array): { digestAfter: Uint8Array; results: (Uint8Array | null)[] } {
  let root = rootFromDigest(digest);
  const { keyLength, parts } = decodeProof(proof);
  if (parts.length < ops.length) throw new AvlProofError(`proof covers ${parts.length} operation(s), ${ops.length} requested`);
  const results: (Uint8Array | null)[] = [];
  ops.forEach((op, i) => {
    if (op.key.length !== keyLength) throw new AvlProofError(`key length ${op.key.length} ≠ proof key length ${keyLength}`);
    const part = parts[i];
    if (part.bucket !== bucketOf(op.key)) throw new AvlProofError("proof does not cover this key");
    for (let j = 0; j < part.entries.length; j++) {
      if (bucketOf(part.entries[j][0]) !== part.bucket) throw new AvlProofError("proof bucket holds a foreign key");
      if (j > 0 && compareBytes(part.entries[j - 1][0], part.entries[j][0]) >= 0) throw new AvlProofError("proof bucket is not sorted");
    }
    const computed = climb(part.bucket, leafOrDefault(part.entries), part.siblings);
    if (!equalBytes(computed, root)) throw new AvlProofError("Tree proof is incorrect: path does not lead to the digest");
    const { next, before } = applyToBucket(part.entries, op);
    results.push(before === null ? null : before.slice());
    root = climb(part.bucket, leafOrDefault(next), part.siblings);
  });
  return { digestAfter: digestFromRoot(root), results };
}

export const simulatedVerifier: AvlVerifier = {
  lookup(digest, key, proof) {
    return verifyOps(digest, [{ op: "lookup", key }], proof).results[0];
  },
  insert(digest, entries, proof) {
    return verifyOps(
      digest,
      entries.map(([key, value]) => ({ op: "insert" as const, key, value })),
      proof,
    ).digestAfter;
  },
  insertOrUpdate(digest, entries, proof) {
    return verifyOps(
      digest,
      entries.map(([key, value]) => ({ op: "insertOrUpdate" as const, key, value })),
      proof,
    ).digestAfter;
  },
};

export const SIMULATED_AVL: AvlBackend = {
  id: "simulated",
  label: "Simulated authenticated map (digests are not Ergo AVL+ bytes)",
  simulated: true,
  createMap: (keyLength = 32) => new SimulatedMap(keyLength),
  verifier: simulatedVerifier,
};

/** Human-readable view of a simulated proof, for the X-ray. Returns null for proofs of other backends. */
export function describeProof(proof: Uint8Array): { keyLength: number; parts: Array<{ bucket: number; entries: Array<{ key: Hex; value: Hex }>; siblings: Hex[] }> } | null {
  try {
    const { keyLength, parts } = decodeProof(proof);
    return {
      keyLength,
      parts: parts.map((p) => ({
        bucket: p.bucket,
        entries: p.entries.map(([k, v]) => ({ key: bytesToHex(k), value: bytesToHex(v) })),
        siblings: p.siblings.map(bytesToHex),
      })),
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------
// backend registry (the WASM engineer plugs the real Ergo AVL+ in here)
// ---------------------------------------------------------------------------------------------

type BackendLoader = () => Promise<AvlBackend>;
const registry = new Map<string, AvlBackend | BackendLoader>([["simulated", SIMULATED_AVL]]);
let current: AvlBackend = SIMULATED_AVL;
const listeners = new Set<(b: AvlBackend) => void>();

/** Registers a backend or an async loader (e.g. `() => import("./avl-wasm").then(m => m.backend)`). */
export function registerAvlBackend(id: string, backend: AvlBackend | BackendLoader): void {
  registry.set(id, backend);
}

export function listAvlBackends(): string[] {
  return [...registry.keys()];
}

/** Loads (if needed) and activates a backend. Economies created afterwards use it. */
export async function useAvlBackend(id: string): Promise<AvlBackend> {
  const entry = registry.get(id);
  if (!entry) throw new Error(`unknown AVL backend "${id}"`);
  const backend = typeof entry === "function" ? await entry() : entry;
  registry.set(id, backend);
  setAvlBackend(backend);
  return backend;
}

export function setAvlBackend(backend: AvlBackend): void {
  current = backend;
  for (const l of listeners) l(backend);
}

export function getAvlBackend(): AvlBackend {
  return current;
}

/** The backend with this id when it is active or already loaded (never starts a load). */
export function loadedAvlBackend(id: string | undefined): AvlBackend | undefined {
  if (!id) return undefined;
  if (current.id === id) return current;
  const entry = registry.get(id);
  return entry && typeof entry !== "function" ? entry : undefined;
}

export function onAvlBackendChange(listener: (b: AvlBackend) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createAuthenticatedMap(keyLength = 32, backend: AvlBackend = current): AuthenticatedMap {
  return backend.createMap(keyLength);
}

/** The smallest surface a foreign AVL+ implementation needs to expose. */
export interface MinimalAvlMap {
  get(key: Uint8Array): Uint8Array | undefined | null;
  insert(key: Uint8Array, value: Uint8Array): void;
  update(key: Uint8Array, value: Uint8Array): void;
  insertOrUpdate(key: Uint8Array, value: Uint8Array): void;
  digest(): Uint8Array;
  proofFor(key: Uint8Array): Uint8Array;
  /** Optional: proof for a batch without applying it. */
  prove?(ops: AvlOperation[]): { proof: Uint8Array; digestAfter: Uint8Array };
  /** Optional: release WASM memory. */
  free?(): void;
}

/**
 * Wraps a foreign map (e.g. WASM) into a full AuthenticatedMap: adds size/entries/has, and clone() by
 * replaying the operation log in its original order (real AVL+ digests depend on insertion order).
 */
export function adaptAvlMap(id: string, factory: () => MinimalAvlMap, keyLength = 32): AuthenticatedMap {
  return new AdaptedMap(id, factory, keyLength, []);
}

class AdaptedMap implements AuthenticatedMap {
  readonly simulated = false;
  private inner: MinimalAvlMap;
  private log: Array<[Uint8Array, Uint8Array]>;
  private index = new Map<string, Uint8Array>();
  constructor(
    readonly backend: string,
    private factory: () => MinimalAvlMap,
    readonly keyLength: number,
    log: Array<[Uint8Array, Uint8Array]>,
  ) {
    this.inner = factory();
    this.log = [];
    for (const [k, v] of log) this.insertOrUpdate(k, v);
  }
  get size() {
    return this.index.size;
  }
  get(key: Uint8Array) {
    return this.index.get(bytesToHex(key));
  }
  has(key: Uint8Array) {
    return this.index.has(bytesToHex(key));
  }
  insert(key: Uint8Array, value: Uint8Array) {
    if (this.has(key)) throw new AvlOperationError(`insert: key ${bytesToHex(key)} already exists`);
    this.inner.insert(key, value);
    this.record(key, value);
  }
  update(key: Uint8Array, value: Uint8Array) {
    if (!this.has(key)) throw new AvlOperationError(`update: key ${bytesToHex(key)} does not exist`);
    this.inner.update(key, value);
    this.record(key, value);
  }
  insertOrUpdate(key: Uint8Array, value: Uint8Array) {
    this.inner.insertOrUpdate(key, value);
    this.record(key, value);
  }
  private record(key: Uint8Array, value: Uint8Array) {
    this.log.push([key.slice(), value.slice()]);
    this.index.set(bytesToHex(key), value.slice());
  }
  digest() {
    return this.inner.digest();
  }
  proofFor(key: Uint8Array) {
    return this.inner.proofFor(key);
  }
  prove(ops: AvlOperation[]): AvlProofResult {
    const digestBefore = this.digest();
    const results = ops.map((o) => this.get(o.key) ?? null);
    if (this.inner.prove) {
      const r = this.inner.prove(ops);
      return { proof: r.proof, digestBefore, digestAfter: r.digestAfter, results };
    }
    if (ops.every((o) => o.op === "lookup") && ops.length === 1) {
      return { proof: this.proofFor(ops[0].key), digestBefore, digestAfter: digestBefore, results };
    }
    // Fall back: apply to a replayed copy to learn the digest; the proof is then the lookup proof only.
    const copy = this.clone();
    for (const o of ops) if (o.op !== "lookup") copy[o.op](o.key, o.value);
    return { proof: this.proofFor(ops[0].key), digestBefore, digestAfter: copy.digest(), results };
  }
  clone(): AuthenticatedMap {
    return new AdaptedMap(this.backend, this.factory, this.keyLength, this.log);
  }
  entries(): Array<[Uint8Array, Uint8Array]> {
    return [...this.index.entries()].map(([k, v]) => [hexToBytes(k), v] as [Uint8Array, Uint8Array]).sort((a, b) => compareBytes(a[0], b[0]));
  }
}
