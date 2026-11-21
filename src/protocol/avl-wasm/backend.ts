// The real Ergo AVL+ tree as a backend of the protocol engine (../avl.ts): AuthenticatedMap +
// stateless AvlVerifier over avl.wasm. Register it with
//
//   registerAvlBackend("ergo-avl-wasm", () => import("./avl-wasm").then((m) => m.backend));
//   await useAvlBackend("ergo-avl-wasm");
//
// `backend` is a lazy thenable: avl.wasm is fetched only when it is awaited.

import { AvlOperationError, AvlProofError, type AuthenticatedMap, type AvlBackend, type AvlOperation, type AvlProofResult, type AvlVerifier } from "../avl";
import { AvlError, ErgoAvlProver, avlHex, initAvl, verifyAvlProof, type AvlOp, type AvlVerifyResult, type AvlWasmSource } from "./avl-wasm";

export const ERGO_AVL_BACKEND_ID = "ergo-avl-wasm";

function toOp(o: AvlOperation): AvlOp {
  return o.op === "lookup" ? { kind: "lookup", key: o.key } : { kind: o.op, key: o.key, value: o.value };
}

/** Engine errors as the protocol engine's two error classes (anything else is rethrown as is). */
function translate(err: AvlError, op: string, key: Uint8Array): Error {
  const k = avlHex(key);
  switch (err.code) {
    case "KeyExists":
      return new AvlOperationError(`${op}: key ${k} already exists`);
    case "KeyMissing":
      return new AvlOperationError(`${op}: key ${k} does not exist`);
    case "KeyOutOfRange":
      return new AvlOperationError(`${op}: key ${k} is a sentinel (all 00 or all ff) and cannot be stored`);
    case "BadArgument":
      return new AvlOperationError(`${op}: ${err.message}`);
    case "ProofInvalid":
    case "VerifierFailed":
      return new AvlProofError(`Tree proof is incorrect: ${err.message}`);
    default:
      return err;
  }
}

/**
 * AuthenticatedMap over ErgoAvlProver: digests and proofs are the bytes the chain uses.
 * The prover never keeps a pending batch between calls, so proofFor() is exactly the lookup
 * proof a tracker would hand out for the current digest.
 */
export class ErgoAvlMap implements AuthenticatedMap {
  readonly backend = ERGO_AVL_BACKEND_ID;
  readonly simulated = false;
  readonly keyLength: number;
  #t: ErgoAvlProver;

  constructor(keyLength = 32, tree?: ErgoAvlProver) {
    this.keyLength = keyLength;
    this.#t = tree ?? ErgoAvlProver.create({ keyLength, valueLength: null });
  }

  /** The underlying prover, for X-ray views (dump(), height). Leave no operations pending on it. */
  get prover(): ErgoAvlProver {
    return this.#t;
  }

  get size(): number {
    return this.#t.size;
  }

  private checkKey(key: Uint8Array, op: string): void {
    if (key.length !== this.keyLength) throw new AvlOperationError(`${op}: key must be ${this.keyLength} bytes (got ${key.length})`);
  }

  get(key: Uint8Array): Uint8Array | undefined {
    this.checkKey(key, "get");
    return this.#t.get(key);
  }

  has(key: Uint8Array): boolean {
    return this.get(key) !== undefined;
  }

  private mutate(op: AvlOperation): void {
    this.checkKey(op.key, op.op);
    const r = this.#t.apply(toOp(op));
    // Close the batch even after a failure: the next proof then starts at the current digest and
    // shows no nodes visited by the failed attempt.
    this.#t.generateProof();
    if (!r.ok) throw translate(r.error, op.op, op.key);
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

  digest(): Uint8Array {
    return this.#t.digest();
  }

  proofFor(key: Uint8Array): Uint8Array {
    this.checkKey(key, "lookup");
    const r = this.#t.apply({ kind: "lookup", key });
    const proof = this.#t.generateProof();
    if (!r.ok) throw translate(r.error, "lookup", key);
    return proof;
  }

  prove(ops: AvlOperation[]): AvlProofResult {
    for (const o of ops) this.checkKey(o.key, o.op);
    const r = this.#t.prove(ops.map(toOp));
    const results: (Uint8Array | null)[] = [];
    r.results.forEach((x, i) => {
      if (!x.ok) throw translate(x.error, ops[i].op, ops[i].key);
      results.push(x.old ?? null);
    });
    return { proof: r.proof, digestBefore: r.startDigest, digestAfter: r.digest, results };
  }

  clone(): AuthenticatedMap {
    return new ErgoAvlMap(this.keyLength, this.#t.fork());
  }

  entries(): Array<[Uint8Array, Uint8Array]> {
    return this.#t.entries().map((e) => [e.key, e.value] as [Uint8Array, Uint8Array]);
  }

  /** Releases the wasm memory now (otherwise when garbage-collected). */
  free(): void {
    this.#t.free();
  }
}

function fail(r: AvlVerifyResult, op: string, key: Uint8Array | undefined): never {
  const e = r.error ?? new AvlError("ProofInvalid", "proof rejected");
  if (e.code === "KeyExists" && key) throw new AvlOperationError(`${op}: key ${avlHex(key)} already exists`);
  throw new AvlProofError(`Tree proof is incorrect: ${e.message}`);
}

/**
 * Stateless verification as the reserve contract runs it (sigma's AvlTree.get / insert /
 * insertOrUpdate; no operation limits; key length = the key's length, 32 in Basis).
 */
export const ergoAvlVerifier: AvlVerifier = {
  lookup(digest, key, proof) {
    const r = verifyAvlProof(digest, proof, [{ kind: "lookup", key }], { keyLength: key.length });
    if (!r.ok) fail(r, "lookup", key);
    const first = r.results[0];
    return first.ok && first.old ? first.old : null;
  },
  insert(digest, entries, proof) {
    const r = verifyAvlProof(digest, proof, entries.map(([key, value]) => ({ kind: "insert" as const, key, value })), { keyLength: entries[0]?.[0].length ?? 32 });
    if (!r.ok) fail(r, "insert", r.failedAt !== undefined && r.failedAt >= 0 ? entries[r.failedAt][0] : undefined);
    return r.digest!;
  },
  insertOrUpdate(digest, entries, proof) {
    const r = verifyAvlProof(digest, proof, entries.map(([key, value]) => ({ kind: "insertOrUpdate" as const, key, value })), { keyLength: entries[0]?.[0].length ?? 32 });
    if (!r.ok) fail(r, "insertOrUpdate", undefined);
    return r.digest!;
  },
};

/** The backend object; call after initAvl() has resolved (or use loadErgoAvlBackend). */
export function createErgoAvlBackend(): AvlBackend {
  return {
    id: ERGO_AVL_BACKEND_ID,
    label: "Ergo AVL+ (ergo_avltree_rust 0.1.1 in WebAssembly): the chain's digests and proofs",
    simulated: false,
    createMap: (keyLength = 32) => new ErgoAvlMap(keyLength),
    verifier: ergoAvlVerifier,
  };
}

/** Loads avl.wasm (once) and returns the backend. */
export async function loadErgoAvlBackend(source?: AvlWasmSource): Promise<AvlBackend> {
  await initAvl(source);
  return createErgoAvlBackend();
}

/** Lazy thenable for registerAvlBackend loaders: avl.wasm loads only when this is awaited. */
export const backend: PromiseLike<AvlBackend> = {
  then<A = AvlBackend, B = never>(
    onfulfilled?: ((value: AvlBackend) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return loadErgoAvlBackend().then(onfulfilled, onrejected);
  },
};
