// Ergo AVL+ authenticated dictionary in the browser: the real ergo_avltree_rust 0.1.1 (the crate
// sigma-rust and the Basis tracker use) compiled to avl.wasm, behind a hand-written glue over its
// C ABI. Digests and proofs are byte-identical to the chain (evidence in README.md).
//
//   await initAvl();                          // once: loads avl.wasm (119 KB, 43 KB gzipped)
//   const t = ErgoAvlProver.create();         // 32-byte keys, variable-length values (Basis trees)
//   t.insert(key, value);
//   t.digest();                               // 33 bytes = root label ‖ height
//   const proof = t.generateProof();          // proof of the operations since the previous proof
//   verifyAvlProof(oldDigest, proof, [{ kind: "insert", key, value }]);  // { ok, digest, results }
//
// After initAvl() resolves, every call is synchronous. No DOM; the only network access is the one
// fetch of avl.wasm (pass the bytes to initAvl to avoid it). The AuthenticatedMap adapter for the
// protocol engine is in ./backend.ts.

import wasmUrl from "./avl.wasm?url";

type BytesLike = Uint8Array | string;

export type AvlOpKind = "lookup" | "insert" | "update" | "insertOrUpdate" | "remove" | "removeIfExists";

/** Operation codes of the C ABI (same numbering as engine.rs OpKind). */
export const AVL_OP_CODE: Readonly<Record<AvlOpKind, number>> = {
  lookup: 0,
  insert: 1,
  update: 2,
  insertOrUpdate: 3,
  remove: 4,
  removeIfExists: 5,
};

export interface AvlOp {
  kind: AvlOpKind;
  key: BytesLike;
  /** insert / update / insertOrUpdate only */
  value?: BytesLike;
}

/** ok: `old` is the value the key had before the operation (undefined = the key was absent). */
export type AvlOpResult = { ok: true; old?: Uint8Array } | { ok: false; error: AvlError };

export type AvlErrorCode =
  | "BadHandle"
  | "BadArgument"
  | "KeyExists"
  | "KeyMissing"
  | "ProofInvalid"
  | "VerifierFailed"
  | "KeyOutOfRange"
  | "Internal"
  | "Trap"
  | "NotInitialised";

const ERROR_BY_RC: Readonly<Record<number, AvlErrorCode>> = {
  [-1]: "BadHandle",
  [-2]: "BadArgument",
  [-3]: "KeyExists",
  [-4]: "KeyMissing",
  [-5]: "ProofInvalid",
  [-6]: "VerifierFailed",
  [-7]: "KeyOutOfRange",
  [-8]: "Internal",
};

export class AvlError extends Error {
  readonly code: AvlErrorCode;
  /** raw negative return code of the wasm call (0 for errors raised by this glue) */
  readonly rc: number;
  constructor(code: AvlErrorCode, message: string, rc = 0) {
    super(message);
    this.name = "AvlError";
    this.code = code;
    this.rc = rc;
  }
}

export interface TreeParams {
  /** default 32 (blake2b256 debt keys) */
  keyLength?: number;
  /** null / undefined = variable-length values (both Basis trees); a number = fixed length */
  valueLength?: number | null;
}

export interface VerifierParams extends TreeParams {
  /** Limits for untrusted proofs, as BatchAVLVerifier takes them. sigma's AvlTree methods use none. */
  maxNumOperations?: number;
  maxDeletes?: number;
}

// ---------------------------------------------------------------------------------------------
// byte helpers (local: this module has no dependencies)
// ---------------------------------------------------------------------------------------------

const HEX = "0123456789abcdef";

export function avlHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += HEX[b[i] >> 4] + HEX[b[i] & 15];
  return s;
}

export function avlBytes(v: BytesLike): Uint8Array {
  if (typeof v !== "string") return v;
  const h = v.startsWith("0x") || v.startsWith("0X") ? v.slice(2) : v;
  if (h.length % 2 !== 0 || /[^0-9a-fA-F]/.test(h)) throw new AvlError("BadArgument", "invalid hex string");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

const EMPTY = new Uint8Array(0);

function concat(parts: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

// ---------------------------------------------------------------------------------------------
// wasm engine
// ---------------------------------------------------------------------------------------------

const ABI_VERSION = 1;

interface AvlExports {
  memory: WebAssembly.Memory;
  avl_init(): number;
  avl_scratch(len: number): number;
  avl_alloc(len: number): number;
  avl_dealloc(ptr: number, len: number): void;
  avl_out_ptr(): number;
  avl_out_len(): number;
  avl_panic_ptr(): number;
  avl_panic_len(): number;
  avl_version(): number;
  avl_blake2b256(ptr: number, len: number): number;
  avl_empty_digest(keyLen: number, valueLen: number): number;
  avl_prover_new(keyLen: number, valueLen: number): number;
  avl_prover_free(h: number): number;
  avl_prover_op(h: number, kind: number, kp: number, kl: number, vp: number, vl: number): number;
  avl_prover_peek(h: number, kp: number, kl: number): number;
  avl_prover_digest(h: number): number;
  avl_prover_proof(h: number): number;
  avl_prover_fork(h: number): number;
  avl_prover_info(h: number): number;
  avl_prover_dump(h: number): number;
  avl_verifier_new(dp: number, dl: number, pp: number, pl: number, keyLen: number, valueLen: number, maxOps: number, maxDel: number): number;
  avl_verifier_free(h: number): number;
  avl_verifier_op(h: number, kind: number, kp: number, kl: number, vp: number, vl: number): number;
  avl_verifier_digest(h: number): number;
  avl_live_handles(): number;
}

let restarts = 0;

/** One wasm instance (its own linear memory). */
class Engine {
  readonly x: AvlExports;
  /** set after a crash: the instance is never called again */
  poisoned: string | null = null;

  constructor(instance: WebAssembly.Instance) {
    this.x = instance.exports as unknown as AvlExports;
    const abi = this.x.avl_init();
    if (abi !== ABI_VERSION) throw new AvlError("Internal", `avl.wasm speaks ABI ${abi}, this glue expects ${ABI_VERSION}`);
  }

  private mem(): Uint8Array {
    return new Uint8Array(this.x.memory.buffer);
  }

  /** Copies the parts into the scratch buffer; returns [ptr0, len0, ptr1, len1, ...]. */
  put(...parts: Uint8Array[]): number[] {
    let total = 0;
    for (const p of parts) total += p.length;
    const base = this.x.avl_scratch(total); // may grow memory: take the view afterwards
    const m = this.mem();
    const out: number[] = [];
    let off = base;
    for (const p of parts) {
      m.set(p, off);
      out.push(off, p.length);
      off += p.length;
    }
    return out;
  }

  /** Copy of the output buffer of the last call. */
  out(): Uint8Array {
    const p = this.x.avl_out_ptr();
    const n = this.x.avl_out_len();
    return this.mem().slice(p, p + n);
  }

  text(): string {
    return new TextDecoder().decode(this.out());
  }

  error(rc: number): AvlError {
    return new AvlError(ERROR_BY_RC[rc] ?? "Internal", this.text() || `avl error ${rc}`, rc);
  }

  /**
   * Runs wasm calls. Anything thrown from inside the instance other than our own AvlError (a
   * Rust panic = RuntimeError "unreachable", a stack overflow = RangeError, out of memory)
   * leaves its memory in an unknown state: the instance is poisoned, never called again, and
   * the call fails with AvlError("Trap"). Objects living in it fail the same way from then on.
   */
  call<T>(f: (x: AvlExports) => T): T {
    if (this.poisoned !== null) throw new AvlError("Trap", `AVL engine stopped after a crash: ${this.poisoned}`);
    try {
      return f(this.x);
    } catch (e) {
      if (e instanceof AvlError) throw e;
      let msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      try {
        const p = this.x.avl_panic_ptr();
        const n = this.x.avl_panic_len();
        if (n > 0) msg = new TextDecoder().decode(this.mem().slice(p, p + n));
      } catch {
        /* memory unreadable: keep the JS message */
      }
      this.poisoned = msg;
      restarts++;
      throw new AvlError("Trap", `AVL engine crashed: ${msg}`);
    }
  }
}

export type AvlWasmSource = string | URL | ArrayBuffer | ArrayBufferView | WebAssembly.Module | Response;

let compiled: WebAssembly.Module | null = null;
let initPromise: Promise<void> | null = null;
/** Provers live here. */
let proverEngine: Engine | null = null;
/** Verifiers live in a separate instance: a crash on a hostile proof cannot touch any prover. */
let verifierEngine: Engine | null = null;
/** A ready instance kept aside, so replacing a crashed one needs no synchronous instantiation. */
let spareEngine: Engine | null = null;
let spareLoading = false;
let wasmBytes = 0;

function asBytes(v: ArrayBuffer | ArrayBufferView): Uint8Array {
  return v instanceof ArrayBuffer ? new Uint8Array(v) : new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
}

async function fetchBytes(url: string | URL): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new AvlError("NotInitialised", `cannot fetch avl.wasm: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Browser: the bundled asset URL. Node (vitest, scripts): the file next to this module. */
async function defaultBytes(): Promise<Uint8Array> {
  const proc = (globalThis as { process?: { versions?: { node?: string } } }).process;
  if (typeof proc?.versions?.node === "string" && import.meta.url.startsWith("file:")) {
    const fsModule = "node:fs/promises"; // a variable: invisible to the bundler and to tsc
    const fs = (await import(/* @vite-ignore */ fsModule)) as { readFile(p: URL): Promise<Uint8Array> };
    const file = "avl.wasm";
    return new Uint8Array(await fs.readFile(new URL(file, import.meta.url)));
  }
  return fetchBytes(wasmUrl);
}

async function compile(source: AvlWasmSource | undefined): Promise<WebAssembly.Module> {
  if (source instanceof WebAssembly.Module) return source;
  let bytes: Uint8Array;
  if (source === undefined) bytes = await defaultBytes();
  else if (typeof source === "string" || source instanceof URL) bytes = await fetchBytes(source);
  else if (typeof Response !== "undefined" && source instanceof Response) bytes = new Uint8Array(await source.arrayBuffer());
  else bytes = asBytes(source as ArrayBuffer | ArrayBufferView);
  wasmBytes = bytes.byteLength;
  return WebAssembly.compile(bytes);
}

async function newEngine(module: WebAssembly.Module): Promise<Engine> {
  return new Engine(await WebAssembly.instantiate(module, {}));
}

function refillSpare(): void {
  const module = compiled;
  if (spareEngine || spareLoading || !module) return;
  spareLoading = true;
  newEngine(module)
    .then((e) => {
      spareEngine = e;
    })
    .catch(() => {
      /* the next replacement instantiates synchronously */
    })
    .finally(() => {
      spareLoading = false;
    });
}

function replacement(): Engine {
  const e = spareEngine ?? new Engine(new WebAssembly.Instance(compiled!, {}));
  spareEngine = null;
  refillSpare();
  return e;
}

export interface AvlEngineInfo {
  version: string;
  abi: number;
  /** size of the loaded avl.wasm (0 when a compiled Module was passed in) */
  wasmBytes: number;
  /** wasm instances that crashed and were replaced since load (0 in normal operation) */
  restarts: number;
}

/**
 * Loads avl.wasm (once; later calls wait for the first and ignore their argument). Default
 * source: the bundled asset in the browser, the file next to this module in node. Or pass a URL,
 * bytes, a Response or a compiled Module.
 */
export async function initAvl(source?: AvlWasmSource): Promise<AvlEngineInfo> {
  if (!initPromise) {
    const p = (async () => {
      const module = await compile(source);
      const engines = [await newEngine(module), await newEngine(module), await newEngine(module)];
      compiled = module;
      [proverEngine, verifierEngine, spareEngine] = engines;
    })();
    initPromise = p;
    p.catch(() => {
      if (initPromise === p) initPromise = null; // allow a retry
    });
  }
  await initPromise;
  return avlInfo();
}

export function avlReady(): boolean {
  return proverEngine !== null && verifierEngine !== null;
}

function provers(): Engine {
  if (!proverEngine) throw new AvlError("NotInitialised", "call `await initAvl()` first");
  if (proverEngine.poisoned !== null) proverEngine = replacement();
  return proverEngine;
}

function verifiers(): Engine {
  if (!verifierEngine) throw new AvlError("NotInitialised", "call `await initAvl()` first");
  if (verifierEngine.poisoned !== null) verifierEngine = replacement();
  return verifierEngine;
}

export function avlInfo(): AvlEngineInfo {
  const e = provers();
  const version = e.call((x) => {
    x.avl_version();
    return e.text();
  });
  return { version, abi: ABI_VERSION, wasmBytes, restarts };
}

/** blake2b256 computed by the wasm (the hash that labels tree nodes). */
export function avlBlake2b256(...parts: BytesLike[]): Uint8Array {
  const e = provers();
  const data = concat(parts.map(avlBytes));
  return e.call((x) => {
    const [p, n] = e.put(data);
    x.avl_blake2b256(p, n);
    return e.out();
  });
}

/** Digest of an empty tree. (32, variable) = 4ec61f48…160900 = R5 of every fresh Basis reserve. */
export function emptyAvlDigest(params: TreeParams = {}): Uint8Array {
  const e = provers();
  const { keyLength, valueLength } = normParams(params);
  return e.call((x) => {
    const rc = x.avl_empty_digest(keyLength, valueLength ?? -1);
    if (rc < 0) throw e.error(rc);
    return e.out();
  });
}

/** Live wasm objects (provers, verifiers) not yet freed, for leak checks. */
export function avlLiveHandles(): { provers: number; verifiers: number } {
  const p = provers().call((x) => x.avl_live_handles());
  const v = verifiers().call((x) => x.avl_live_handles());
  return { provers: p >>> 16, verifiers: v & 0xffff };
}

function normParams(p: TreeParams): { keyLength: number; valueLength: number | null } {
  const keyLength = p.keyLength ?? 32;
  const valueLength = p.valueLength ?? null;
  if (!Number.isInteger(keyLength) || keyLength < 1 || keyLength > 255) throw new AvlError("BadArgument", "keyLength must be 1..255");
  if (valueLength !== null && (!Number.isInteger(valueLength) || valueLength < 0 || valueLength > 0x7fffffff))
    throw new AvlError("BadArgument", "valueLength must be a non-negative integer or null");
  return { keyLength, valueLength };
}

// objects garbage-collected without free(): release their wasm memory
type Held = { engine: Engine; handle: number; kind: "prover" | "verifier" };
const finalizer: FinalizationRegistry<Held> | null =
  typeof FinalizationRegistry !== "undefined"
    ? new FinalizationRegistry<Held>((h) => {
        if (h.engine.poisoned !== null) return;
        try {
          h.engine.call((x) => (h.kind === "prover" ? x.avl_prover_free(h.handle) : x.avl_verifier_free(h.handle)));
        } catch {
          /* poisoned now: nothing to free */
        }
      })
    : null;

function opResult(e: Engine, rc: number): AvlOpResult {
  if (rc === 0) return { ok: true };
  if (rc === 1) return { ok: true, old: e.out() };
  return { ok: false, error: e.error(rc) };
}

function unwrap(r: AvlOpResult): Uint8Array | undefined {
  if (!r.ok) throw r.error;
  return r.old;
}

function opBytes(op: AvlOp): { code: number; key: Uint8Array; value: Uint8Array } | AvlError {
  const code = AVL_OP_CODE[op.kind];
  if (code === undefined) return new AvlError("BadArgument", `unknown operation ${String(op.kind)}`);
  try {
    return { code, key: avlBytes(op.key), value: op.value === undefined ? EMPTY : avlBytes(op.value) };
  } catch (err) {
    return err instanceof AvlError ? err : new AvlError("BadArgument", String(err));
  }
}

// ---------------------------------------------------------------------------------------------
// prover
// ---------------------------------------------------------------------------------------------

export interface AvlTreeInfo {
  size: number;
  /** successful operations since the last generateProof() */
  pending: number;
  height: number;
  keyLength: number;
  valueLength: number | null;
}

export type AvlTreeNode =
  | { kind: "internal"; balance: -1 | 0 | 1; key: Uint8Array; label: Uint8Array; left: AvlTreeNode; right: AvlTreeNode }
  | { kind: "leaf"; key: Uint8Array; value: Uint8Array; nextKey: Uint8Array; label: Uint8Array }
  | { kind: "pruned"; label: Uint8Array };

type InternalNode = Extract<AvlTreeNode, { kind: "internal" }>;

/**
 * The prover: BatchAVLProver over AVLTree(keyLength, valueLength), as the tracker runs it for
 * its tree (basis_trees) and as anyone can run it to rebuild a reserve tree from its history.
 * A failed operation leaves the tree as it was.
 */
export class ErgoAvlProver {
  readonly keyLength: number;
  readonly valueLength: number | null;
  #engine: Engine;
  #h: number;
  #freed = false;
  #token = {};

  private constructor(engine: Engine, handle: number, keyLength: number, valueLength: number | null) {
    this.#engine = engine;
    this.#h = handle;
    this.keyLength = keyLength;
    this.valueLength = valueLength;
    finalizer?.register(this, { engine, handle, kind: "prover" }, this.#token);
  }

  /** An empty tree. Requires initAvl() to have resolved. */
  static create(params: TreeParams = {}): ErgoAvlProver {
    const e = provers();
    const { keyLength, valueLength } = normParams(params);
    const h = e.call((x) => x.avl_prover_new(keyLength, valueLength ?? -1));
    if (h <= 0) throw e.error(h);
    return new ErgoAvlProver(e, h, keyLength, valueLength);
  }

  /** create(), loading the wasm first if needed. */
  static async open(params: TreeParams = {}): Promise<ErgoAvlProver> {
    await initAvl();
    return ErgoAvlProver.create(params);
  }

  /** A tree built by replaying operations in order (the AVL+ shape depends on the order). */
  static from(ops: Iterable<AvlOp>, params: TreeParams = {}): ErgoAvlProver {
    const t = ErgoAvlProver.create(params);
    try {
      for (const op of ops) unwrap(t.apply(op));
    } catch (err) {
      t.free();
      throw err;
    }
    t.generateProof(); // start with a clean proof state
    return t;
  }

  private live(): number {
    if (this.#freed) throw new AvlError("BadHandle", "prover was freed");
    return this.#h;
  }

  private read(f: (x: AvlExports, h: number) => number): Uint8Array {
    const e = this.#engine;
    const h = this.live();
    return e.call((x) => {
      const rc = f(x, h);
      if (rc < 0) throw e.error(rc);
      return e.out();
    });
  }

  /** 33 bytes: root label (32) ‖ tree height (1). */
  digest(): Uint8Array {
    return this.read((x, h) => x.avl_prover_digest(h));
  }

  digestHex(): string {
    return avlHex(this.digest());
  }

  info(): AvlTreeInfo {
    const b = this.read((x, h) => x.avl_prover_info(h));
    const vl = u32(b, 16) | 0;
    return { size: u32(b, 0), pending: u32(b, 4), height: u32(b, 8), keyLength: u32(b, 12), valueLength: vl < 0 ? null : vl };
  }

  get size(): number {
    return this.info().size;
  }

  get height(): number {
    return this.info().height;
  }

  /** Successful operations waiting for generateProof(). */
  get pending(): number {
    return this.info().pending;
  }

  /** Any operation. Never throws for protocol failures (KeyExists, KeyMissing, BadArgument...). */
  apply(op: AvlOp): AvlOpResult {
    const e = this.#engine;
    const h = this.live();
    const b = opBytes(op);
    if (b instanceof AvlError) return { ok: false, error: b };
    return e.call((x) => {
      const [kp, kl, vp, vl] = e.put(b.key, b.value);
      return opResult(e, x.avl_prover_op(h, b.code, kp, kl, vp, vl));
    });
  }

  applyAll(ops: Iterable<AvlOp>): AvlOpResult[] {
    const out: AvlOpResult[] = [];
    for (const op of ops) out.push(this.apply(op));
    return out;
  }

  /** Authenticated lookup (goes into the next proof). The value, or undefined if absent. */
  lookup(key: BytesLike): Uint8Array | undefined {
    return unwrap(this.apply({ kind: "lookup", key }));
  }

  /** Strict insert: KeyExists if present, exactly like sigma's AvlTree.insert. */
  insert(key: BytesLike, value: BytesLike): void {
    unwrap(this.apply({ kind: "insert", key, value }));
  }

  /** Update of a present key (KeyMissing otherwise). Returns the old value. */
  update(key: BytesLike, value: BytesLike): Uint8Array {
    return unwrap(this.apply({ kind: "update", key, value }))!;
  }

  /** Returns the old value, undefined if the key was new. */
  insertOrUpdate(key: BytesLike, value: BytesLike): Uint8Array | undefined {
    return unwrap(this.apply({ kind: "insertOrUpdate", key, value }));
  }

  remove(key: BytesLike): Uint8Array {
    return unwrap(this.apply({ kind: "remove", key }))!;
  }

  removeIfExists(key: BytesLike): Uint8Array | undefined {
    return unwrap(this.apply({ kind: "removeIfExists", key }));
  }

  /** Unauthenticated read: does not touch proofs. */
  get(key: BytesLike): Uint8Array | undefined {
    const e = this.#engine;
    const h = this.live();
    const k = avlBytes(key);
    return e.call((x) => {
      const [kp, kl] = e.put(k);
      const rc = x.avl_prover_peek(h, kp, kl);
      if (rc < 0) throw e.error(rc);
      return rc === 1 ? e.out() : undefined;
    });
  }

  has(key: BytesLike): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Proof of every operation since the previous call (or since creation), against the digest
   * that was current then; starts a new batch. This is what the tracker publishes, and what goes
   * into context vars #5 / #7 / #8.
   */
  generateProof(): Uint8Array {
    return this.read((x, h) => x.avl_prover_proof(h));
  }

  /**
   * Independent deep copy of the current state (pending operations included) with a clean
   * proof state. For "what if" proofs and snapshots, e.g. the tracker's committed tree while its
   * live tree moves on.
   */
  fork(): ErgoAvlProver {
    const e = this.#engine;
    const h = this.live();
    const f = e.call((x) => x.avl_prover_fork(h));
    if (f <= 0) throw e.error(f);
    return new ErgoAvlProver(e, f, this.keyLength, this.valueLength);
  }

  /**
   * Lookup proof for `key` against the current digest, leaving this tree and its pending batch
   * alone (runs on a fork). Context var #8 (tracker tree) or #7 (reserve tree).
   */
  proveLookup(key: BytesLike): { proof: Uint8Array; value: Uint8Array | undefined; digest: Uint8Array } {
    const f = this.fork();
    try {
      const value = f.lookup(key);
      return { proof: f.generateProof(), value, digest: f.digest() };
    } finally {
      f.free();
    }
  }

  /**
   * Proof for a batch of operations from the current digest, without changing this tree
   * (BatchAVLProver.generateProofForOperations). A redemption's context var #5 is
   * prove([{ kind: "insertOrUpdate", key, value: timestamp ‖ redeemed }]).
   */
  prove(ops: AvlOp[]): { proof: Uint8Array; startDigest: Uint8Array; digest: Uint8Array; results: AvlOpResult[] } {
    const f = this.fork();
    try {
      const startDigest = f.digest();
      const results = f.applyAll(ops);
      return { proof: f.generateProof(), startDigest, digest: f.digest(), results };
    } finally {
      f.free();
    }
  }

  /** The whole tree with labels, for drawing it. Includes the -∞ sentinel leaf (key 00…00). */
  dump(): AvlTreeNode {
    const b = this.read((x, h) => x.avl_prover_dump(h));
    const kl = this.keyLength;
    let i = 0;
    const take = (n: number) => {
      if (i + n > b.length) throw new AvlError("Internal", "truncated tree dump");
      return b.slice(i, (i += n));
    };
    // iterative pre-order decoding: internal = 01 balance key label, then left and right
    const open: Array<{ node: InternalNode; filled: number }> = [];
    let root: AvlTreeNode | null = null;
    const attach = (n: AvlTreeNode) => {
      const top = open[open.length - 1];
      if (!top) root = n;
      else if (top.filled++ === 0) top.node.left = n;
      else {
        top.node.right = n;
        open.pop();
      }
    };
    do {
      const tag = take(1)[0];
      if (tag === 1) {
        const balance = ((take(1)[0] << 24) >> 24) as -1 | 0 | 1;
        const key = take(kl);
        const label = take(32);
        const node = { kind: "internal", balance, key, label } as InternalNode;
        attach(node);
        open.push({ node, filled: 0 });
      } else if (tag === 0) {
        const key = take(kl);
        const value = take(u32(take(4), 0));
        const nextKey = take(kl);
        const label = take(32);
        attach({ kind: "leaf", key, value, nextKey, label });
      } else if (tag === 2) {
        attach({ kind: "pruned", label: take(32) });
      } else throw new AvlError("Internal", `unexpected node tag ${tag} in tree dump`);
    } while (open.length > 0);
    return root!;
  }

  /** All entries in key order (the -∞ sentinel leaf left out). */
  entries(): Array<{ key: Uint8Array; value: Uint8Array }> {
    const out: Array<{ key: Uint8Array; value: Uint8Array }> = [];
    const stack: AvlTreeNode[] = [this.dump()];
    while (stack.length) {
      const n = stack.pop()!;
      if (n.kind === "internal") stack.push(n.right, n.left);
      else if (n.kind === "leaf" && n.key.some((x) => x !== 0)) out.push({ key: n.key, value: n.value });
    }
    return out;
  }

  /** Releases the wasm memory now (otherwise when garbage-collected). Idempotent. */
  free(): void {
    if (this.#freed) return;
    this.#freed = true;
    finalizer?.unregister(this.#token);
    if (this.#engine.poisoned !== null) return;
    try {
      this.#engine.call((x) => x.avl_prover_free(this.#h));
    } catch {
      /* engine poisoned meanwhile */
    }
  }
}

// ---------------------------------------------------------------------------------------------
// verifier
// ---------------------------------------------------------------------------------------------

/**
 * The verifier: what the reserve contract does with context vars #5 #7 #8. Rebuilds the
 * revealed part of the tree from a proof, checks it against a digest, replays operations and
 * yields the new digest. A bad proof or a failed operation leaves it failed (digest null).
 */
export class ErgoAvlVerifier {
  readonly keyLength: number;
  readonly valueLength: number | null;
  #engine: Engine;
  #h: number;
  #freed = false;
  #token = {};

  private constructor(engine: Engine, handle: number, keyLength: number, valueLength: number | null) {
    this.#engine = engine;
    this.#h = handle;
    this.keyLength = keyLength;
    this.valueLength = valueLength;
    finalizer?.register(this, { engine, handle, kind: "verifier" }, this.#token);
  }

  /** Throws only for bad arguments (digest not 33 bytes, bad lengths); a bad proof gives a failed verifier. */
  static create(startDigest: BytesLike, proof: BytesLike, params: VerifierParams = {}): ErgoAvlVerifier {
    const e = verifiers();
    const { keyLength, valueLength } = normParams(params);
    const d = avlBytes(startDigest);
    const p = avlBytes(proof);
    const lim = (v: number | undefined) => (v === undefined ? -1 : Math.max(0, Math.min(Math.floor(v), 0x7fffffff)));
    const h = e.call((x) => {
      const [dp, dl, pp, pl] = e.put(d, p);
      return x.avl_verifier_new(dp, dl, pp, pl, keyLength, valueLength ?? -1, lim(params.maxNumOperations), lim(params.maxDeletes));
    });
    if (h <= 0) throw e.error(h);
    return new ErgoAvlVerifier(e, h, keyLength, valueLength);
  }

  private live(): number {
    if (this.#freed) throw new AvlError("BadHandle", "verifier was freed");
    return this.#h;
  }

  /** Never throws for protocol failures; one failure fails the verifier for good (as on the JVM). */
  apply(op: AvlOp): AvlOpResult {
    const e = this.#engine;
    const h = this.live();
    const b = opBytes(op);
    if (b instanceof AvlError) return { ok: false, error: b };
    try {
      return e.call((x) => {
        const [kp, kl, vp, vl] = e.put(b.key, b.value);
        return opResult(e, x.avl_verifier_op(h, b.code, kp, kl, vp, vl));
      });
    } catch (err) {
      if (err instanceof AvlError && err.code === "Trap") return { ok: false, error: new AvlError("ProofInvalid", err.message) };
      throw err;
    }
  }

  lookup(key: BytesLike): Uint8Array | undefined {
    return unwrap(this.apply({ kind: "lookup", key }));
  }

  /** Digest after the replayed operations; null if the proof or an operation failed. */
  digest(): Uint8Array | null {
    const e = this.#engine;
    const h = this.live();
    if (e.poisoned !== null) return null;
    try {
      return e.call((x) => (x.avl_verifier_digest(h) === 33 ? e.out() : null));
    } catch {
      return null;
    }
  }

  /** Why the verifier failed (null while it is healthy). */
  failure(): AvlError | null {
    const e = this.#engine;
    const h = this.live();
    if (e.poisoned !== null) return new AvlError("ProofInvalid", `verifier crashed: ${e.poisoned}`);
    try {
      return e.call((x) => {
        const rc = x.avl_verifier_digest(h);
        return rc === 33 ? null : e.error(rc);
      });
    } catch (err) {
      return new AvlError("ProofInvalid", err instanceof Error ? err.message : String(err));
    }
  }

  free(): void {
    if (this.#freed) return;
    this.#freed = true;
    finalizer?.unregister(this.#token);
    if (this.#engine.poisoned !== null) return;
    try {
      this.#engine.call((x) => x.avl_verifier_free(this.#h));
    } catch {
      /* engine poisoned meanwhile */
    }
  }
}

export interface AvlVerifyResult {
  /** the proof matched the start digest and every operation succeeded */
  ok: boolean;
  /** digest after all operations (null when !ok) */
  digest: Uint8Array | null;
  /** results of the operations attempted (up to and including the failing one) */
  results: AvlOpResult[];
  /** index of the first failing operation; -1 = the proof itself was rejected */
  failedAt?: number;
  error?: AvlError;
}

/** One shot: replays `ops` with `proof` from `startDigest`. Never throws for bad proofs. */
export function verifyAvlProof(startDigest: BytesLike, proof: BytesLike, ops: AvlOp[], params: VerifierParams = {}): AvlVerifyResult {
  let v: ErgoAvlVerifier;
  try {
    v = ErgoAvlVerifier.create(startDigest, proof, params);
  } catch (err) {
    const error = err instanceof AvlError ? err : new AvlError("BadArgument", String(err));
    return { ok: false, digest: null, results: [], failedAt: -1, error };
  }
  try {
    const initial = v.failure();
    if (initial) return { ok: false, digest: null, results: [], failedAt: -1, error: initial };
    const results: AvlOpResult[] = [];
    for (let i = 0; i < ops.length; i++) {
      const r = v.apply(ops[i]);
      results.push(r);
      if (!r.ok) return { ok: false, digest: null, results, failedAt: i, error: r.error };
    }
    const digest = v.digest();
    if (digest) return { ok: true, digest, results };
    return { ok: false, digest: null, results, error: v.failure() ?? new AvlError("ProofInvalid", "proof rejected") };
  } finally {
    v.free();
  }
}

// ---------------------------------------------------------------------------------------------
// sigma AvlTree methods, as the node evaluates them
// ---------------------------------------------------------------------------------------------

export const AVL_INSERT_ALLOWED = 0x01;
export const AVL_UPDATE_ALLOWED = 0x02;
export const AVL_REMOVE_ALLOWED = 0x04;

/** An AvlTree value as it sits in a register (R5 of a reserve or tracker box). */
export interface SigmaAvlTree {
  digest: BytesLike;
  /** insert 0x01 | update 0x02 | remove 0x04. Current Basis reserves 0x03 (the default here) */
  flags?: number;
  keyLength?: number;
  valueLength?: number | null;
}

/** What the ErgoScript expression yields, or that its evaluation throws (the spend fails). */
export type SigmaAvlOutcome<T> = { scriptError: false; value: T } | { scriptError: true; message: string };

function treeParams(t: SigmaAvlTree): VerifierParams {
  return { keyLength: t.keyLength ?? 32, valueLength: t.valueLength ?? null };
}

const why = (r: AvlVerifyResult) => r.error?.message ?? "rejected";

/**
 * sigma's AvlTree methods (the verifier gets the tree's keyLength and valueLengthOpt and no
 * operation limits):
 * - get(key, proof): Some(value) / None (proven absent); a bad proof is a script error
 * - contains(key, proof): true / false; a bad proof is false
 * - insert(entries, proof): None when inserts are not allowed; any failing entry (e.g. the key is
 *   already there) is a script error, "Incorrect insert". With context var #7 omitted, Basis
 *   relies on exactly this for replay protection.
 * - insertOrUpdate (v6): None unless insert AND update are allowed; failure is a script error
 * - update / remove: None when not allowed or when any entry fails
 */
export const sigmaAvl = {
  get(tree: SigmaAvlTree, key: BytesLike, proof: BytesLike): SigmaAvlOutcome<Uint8Array | undefined> {
    const r = verifyAvlProof(tree.digest, proof, [{ kind: "lookup", key }], treeParams(tree));
    if (!r.ok) return { scriptError: true, message: `Tree proof is incorrect (${why(r)})` };
    const first = r.results[0];
    return { scriptError: false, value: first.ok ? first.old : undefined };
  },

  getMany(tree: SigmaAvlTree, keys: BytesLike[], proof: BytesLike): SigmaAvlOutcome<Array<Uint8Array | undefined>> {
    const r = verifyAvlProof(tree.digest, proof, keys.map((key) => ({ kind: "lookup" as const, key })), treeParams(tree));
    if (!r.ok) return { scriptError: true, message: `Tree proof is incorrect (${why(r)})` };
    return { scriptError: false, value: r.results.map((x) => (x.ok ? x.old : undefined)) };
  },

  contains(tree: SigmaAvlTree, key: BytesLike, proof: BytesLike): boolean {
    const r = verifyAvlProof(tree.digest, proof, [{ kind: "lookup", key }], treeParams(tree));
    return r.ok && r.results[0].ok && r.results[0].old !== undefined;
  },

  insert(tree: SigmaAvlTree, entries: Array<[BytesLike, BytesLike]>, proof: BytesLike): SigmaAvlOutcome<Uint8Array | null> {
    if (((tree.flags ?? 0x03) & AVL_INSERT_ALLOWED) === 0) return { scriptError: false, value: null };
    const r = verifyAvlProof(tree.digest, proof, entries.map(([key, value]) => ({ kind: "insert" as const, key, value })), treeParams(tree));
    if (!r.ok) return { scriptError: true, message: `Incorrect insert (${why(r)})` };
    return { scriptError: false, value: r.digest };
  },

  insertOrUpdate(tree: SigmaAvlTree, entries: Array<[BytesLike, BytesLike]>, proof: BytesLike): SigmaAvlOutcome<Uint8Array | null> {
    const f = tree.flags ?? 0x03;
    if ((f & AVL_INSERT_ALLOWED) === 0 || (f & AVL_UPDATE_ALLOWED) === 0) return { scriptError: false, value: null };
    const r = verifyAvlProof(tree.digest, proof, entries.map(([key, value]) => ({ kind: "insertOrUpdate" as const, key, value })), treeParams(tree));
    if (!r.ok) return { scriptError: true, message: `Incorrect insertOrUpdate (${why(r)})` };
    return { scriptError: false, value: r.digest };
  },

  update(tree: SigmaAvlTree, entries: Array<[BytesLike, BytesLike]>, proof: BytesLike): SigmaAvlOutcome<Uint8Array | null> {
    if (((tree.flags ?? 0x03) & AVL_UPDATE_ALLOWED) === 0) return { scriptError: false, value: null };
    const r = verifyAvlProof(tree.digest, proof, entries.map(([key, value]) => ({ kind: "update" as const, key, value })), treeParams(tree));
    return { scriptError: false, value: r.ok ? r.digest : null };
  },

  remove(tree: SigmaAvlTree, keys: BytesLike[], proof: BytesLike): SigmaAvlOutcome<Uint8Array | null> {
    if (((tree.flags ?? 0x03) & AVL_REMOVE_ALLOWED) === 0) return { scriptError: false, value: null };
    const r = verifyAvlProof(tree.digest, proof, keys.map((key) => ({ kind: "remove" as const, key })), treeParams(tree));
    return { scriptError: false, value: r.ok ? r.digest : null };
  },
};

// ---------------------------------------------------------------------------------------------
// proof X-ray (pure TS, for the UI)
// ---------------------------------------------------------------------------------------------

export type AvlProofPart =
  | { kind: "label"; offset: number; size: number; label: Uint8Array }
  | { kind: "leaf"; offset: number; size: number; key: Uint8Array; keyFromPrevious: boolean; nextKey: Uint8Array; value: Uint8Array }
  | { kind: "internal"; offset: number; size: 1; balance: number }
  | { kind: "end"; offset: number; size: 1 }
  | { kind: "directions"; offset: number; size: number; bits: number[] };

export interface DecodedAvlProof {
  /** post-order packed tree, the end marker, then the direction bits */
  parts: AvlProofPart[];
  labels: number;
  leaves: number;
  internals: number;
  /** bytes per section */
  bytes: { labels: number; leaves: number; balances: number; directions: number };
  /** false when the bytes do not parse (truncated / malformed); `parts` then holds what parsed */
  wellFormed: boolean;
  error?: string;
}

/**
 * Splits a serialized AD proof into its parts with the verifier's parser (no hashing): the
 * revealed nodes in post order (0x03 = label of a pruned subtree, 0x02 = leaf, any other byte =
 * internal node with that balance, -1/0/1), 0x04 = end of tree, then one direction bit per
 * internal node walked (1 = left), least significant bit first.
 */
export function decodeAvlProof(proof: BytesLike, params: TreeParams = {}): DecodedAvlProof {
  const p = avlBytes(proof);
  const { keyLength, valueLength } = normParams(params);
  const parts: AvlProofPart[] = [];
  const bytes = { labels: 0, leaves: 0, balances: 0, directions: 0 };
  let labels = 0;
  let leaves = 0;
  let internals = 0;
  let depth = 0;
  let i = 0;
  let prevNext: Uint8Array | null = null;
  const fail = (error: string): DecodedAvlProof => ({ parts, labels, leaves, internals, bytes, wellFormed: false, error });
  for (;;) {
    if (i >= p.length) return fail("no end-of-tree marker");
    const n = p[i];
    const at = i;
    if (n === 4) {
      parts.push({ kind: "end", offset: at, size: 1 });
      i++;
      break;
    }
    i++;
    if (n === 3) {
      if (i + 32 > p.length) return fail("truncated label");
      parts.push({ kind: "label", offset: at, size: 33, label: p.slice(i, i + 32) });
      i += 32;
      bytes.labels += 33;
      labels++;
      depth++;
      prevNext = null;
    } else if (n === 2) {
      let key: Uint8Array;
      const fromPrev = prevNext !== null;
      if (prevNext !== null) key = prevNext;
      else {
        if (i + keyLength > p.length) return fail("truncated leaf key");
        key = p.slice(i, i + keyLength);
        i += keyLength;
      }
      if (i + keyLength > p.length) return fail("truncated next-leaf key");
      const nextKey = p.slice(i, i + keyLength);
      i += keyLength;
      let vl = valueLength;
      if (vl === null) {
        if (i + 4 > p.length) return fail("truncated value length");
        vl = u32(p, i);
        i += 4;
      }
      if (i + vl > p.length) return fail("truncated value");
      const value = p.slice(i, i + vl);
      i += vl;
      parts.push({ kind: "leaf", offset: at, size: i - at, key, keyFromPrevious: fromPrev, nextKey, value });
      bytes.leaves += i - at;
      leaves++;
      depth++;
      prevNext = nextKey;
    } else {
      if (depth < 2) return fail("internal node without two children");
      depth--;
      parts.push({ kind: "internal", offset: at, size: 1, balance: (n << 24) >> 24 });
      bytes.balances++;
      internals++;
    }
  }
  if (depth !== 1) return fail("packed tree does not have exactly one root");
  const dir = p.slice(i);
  const bits: number[] = [];
  for (let b = 0; b < dir.length * 8; b++) bits.push((dir[b >> 3] >> (b & 7)) & 1);
  parts.push({ kind: "directions", offset: i, size: dir.length, bits });
  bytes.directions = dir.length;
  return { parts, labels, leaves, internals, bytes, wellFormed: true };
}
