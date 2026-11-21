// avl.wasm loaded in node: real mainnet vectors, the native test's random sequences (bit-exact),
// the sigma AvlTree semantics the reserve contract relies on, the AuthenticatedMap backend, and
// robustness against hostile proofs.
import { describe, expect, it, beforeAll } from "vitest";
import { blake2b256 } from "../bytes";
import { AvlOperationError, AvlProofError } from "../avl";
import { EMPTY_AVL_DIGEST_HEX } from "../registers";
import {
  AVL_OP_CODE,
  ErgoAvlProver,
  ErgoAvlVerifier,
  avlBlake2b256,
  avlHex,
  avlBytes,
  avlInfo,
  avlLiveHandles,
  decodeAvlProof,
  emptyAvlDigest,
  initAvl,
  sigmaAvl,
  verifyAvlProof,
  type AvlOpKind,
  type AvlOpResult,
} from "./avl-wasm";
import { ErgoAvlMap, backend, ergoAvlVerifier, loadErgoAvlBackend } from "./index";
import chainJson from "./vectors-chain.json";
import randomJson from "./vectors-random.json";

interface Redemption {
  name: string;
  tx: string;
  reserveIn: { box: string; value: number; R5: string };
  reserveOut: { box: string; value: number; R5: string };
  tracker: { box: string; R5: string; nft: string };
  owner: string;
  receiver: string;
  totalDebt: number;
  timestamp: number;
  proof5: string;
  proof7: string | null;
  proof8: string;
}
interface ChainVectors {
  emptyDigest: { digest: string };
  redemptions: Redemption[];
  digestOnly: Array<{ name: string; owner: string; receiver: string; timestamp: number; redeemed: number; after: string }>;
}
interface Scenario {
  params: { name: string; seed: number; keyLength: number; valueLength: number | null; valueSize: number | null; ops: number; pool: number };
  summary: { okOps: number; failedOps: number; proofs: number; maxHeight: number; finalSize: number; finalDigest: string; rollingHash: string };
  checkpoints: Array<{ afterOp: number; digest: string; size: number }>;
}

const chain = chainJson as unknown as ChainVectors;
const random = randomJson as unknown as { scenarios: Scenario[] };

const hex = avlHex;
const unhex = (s: string) => avlBytes(s);
const be64 = (n: number | bigint) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n));
  return b;
};
const cat = (...a: Uint8Array[]) => {
  const o = new Uint8Array(a.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of a) {
    o.set(p, i);
    i += p.length;
  }
  return o;
};
/** AvlTree register: 64 ‖ digest(33) ‖ flags ‖ keyLength ‖ valueLengthOpt */
const r5digest = (r5: string) => unhex(r5.slice(2, 68));
const r5flags = (r5: string) => parseInt(r5.slice(68, 70), 16);
const debtKey = (owner: string, receiver: string) => blake2b256(unhex(owner), unhex(receiver));

beforeAll(async () => {
  await initAvl(); // node: reads avl.wasm next to the module
});

describe("engine", () => {
  it("loads, reports its version, hashes like @noble", () => {
    const info = avlInfo();
    expect(info.version).toContain("ergo_avltree_rust 0.1.1");
    expect(info.wasmBytes).toBeGreaterThan(50_000);
    expect(info.wasmBytes).toBeLessThan(200_000);
    const data = new TextEncoder().encode("basis");
    expect(hex(avlBlake2b256(data))).toBe(hex(blake2b256(data)));
  });

  it("empty tree digest = mainnet reserve R5 = the engine's constant", () => {
    const d = hex(emptyAvlDigest());
    expect(d).toBe("4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900");
    expect(d).toBe(chain.emptyDigest.digest);
    expect(d).toBe(EMPTY_AVL_DIGEST_HEX);
    const t = ErgoAvlProver.create();
    expect(t.digestHex()).toBe(d);
    expect(t.size).toBe(0);
    t.free();
  });
});

describe("real mainnet redemptions (sigma semantics)", () => {
  for (const r of chain.redemptions) {
    it(`${r.name}: #8, #7, #5 replay to the output box's R5`, () => {
      const key = debtKey(r.owner, r.receiver);
      const tracker = { digest: r5digest(r.tracker.R5), flags: r5flags(r.tracker.R5) };
      const reserveIn = { digest: r5digest(r.reserveIn.R5), flags: r5flags(r.reserveIn.R5) };
      const redeemed = BigInt(r.reserveIn.value - r.reserveOut.value);

      // trackerTree.get(key, #8).get == totalDebt
      const t = sigmaAvl.get(tracker, key, r.proof8);
      expect(t.scriptError).toBe(false);
      if (t.scriptError) return;
      expect(hex(t.value!)).toBe(hex(be64(r.totalDebt)));

      // SELF.R5.get(key, #7) -> timestamp ‖ redeemed so far (none on the first redemption)
      let before = 0n;
      if (r.proof7) {
        const g = sigmaAvl.get(reserveIn, key, r.proof7);
        expect(g.scriptError).toBe(false);
        if (g.scriptError) return;
        before = new DataView(g.value!.buffer, g.value!.byteOffset).getBigUint64(8);
      }
      const value = cat(be64(r.timestamp), be64(before + redeemed));
      const out = r.proof7 ? sigmaAvl.insertOrUpdate(reserveIn, [[key, value]], r.proof5) : sigmaAvl.insert(reserveIn, [[key, value]], r.proof5);
      expect(out.scriptError).toBe(false);
      if (out.scriptError) return;
      expect(hex(out.value!)).toBe(hex(r5digest(r.reserveOut.R5)));

      // replay protection: a strict insert of a key that is already there is a script error
      if (r.proof7) {
        const replay = sigmaAvl.insert(reserveIn, [[key, value]], r.proof5);
        expect(replay.scriptError).toBe(true);
      }
      // a forged tracker value never verifies
      const forged = verifyAvlProof(tracker.digest, unhex(r.proof8), [{ kind: "update", key, value: be64(r.totalDebt * 2) }]);
      expect(forged.ok ? hex(forged.digest!) : null).not.toBe(hex(tracker.digest));
    });
  }

  it("the prover regenerates the on-chain proof bytes exactly", () => {
    const [r1, r2, r3] = chain.redemptions;
    const key = debtKey(r1.owner, r1.receiver);
    const reserve = ErgoAvlProver.create();
    reserve.insert(key, cat(be64(r1.timestamp), be64(100_000_000)));
    expect(hex(reserve.generateProof())).toBe(r1.proof5);
    expect(hex(reserve.digest())).toBe(hex(r5digest(r1.reserveOut.R5)));

    const look = reserve.proveLookup(key);
    expect(hex(look.proof)).toBe(r2.proof7);
    const upd = reserve.prove([{ kind: "insertOrUpdate", key, value: cat(be64(r2.timestamp), be64(200_000_000)) }]);
    expect(hex(upd.proof)).toBe(r2.proof5);
    expect(hex(upd.digest)).toBe(hex(r5digest(r2.reserveOut.R5)));
    expect(hex(reserve.digest())).toBe(hex(r5digest(r2.reserveIn.R5))); // prove() changed nothing
    reserve.free();

    const k3 = debtKey(r3.owner, r3.receiver);
    const trackerTree = ErgoAvlProver.from([{ kind: "insert", key: k3, value: be64(r3.totalDebt) }]);
    expect(hex(trackerTree.digest())).toBe(hex(r5digest(r3.tracker.R5)));
    expect(hex(trackerTree.proveLookup(k3).proof)).toBe(r3.proof8);
    trackerTree.free();
  });

  it("older reserves: digests after one redemption", () => {
    for (const d of chain.digestOnly) {
      const t = ErgoAvlProver.from([{ kind: "insert", key: debtKey(d.owner, d.receiver), value: cat(be64(d.timestamp), be64(d.redeemed)) }]);
      expect(t.digestHex(), d.name).toBe(d.after);
      t.free();
    }
  });

  it("decodes proof bytes for the X-ray", () => {
    const [r1, r2] = chain.redemptions;
    const first = decodeAvlProof(r1.proof5);
    expect(first.wellFormed).toBe(true);
    expect(first.leaves).toBe(1); // the -inf sentinel leaf of an empty tree
    expect(first.internals).toBe(0);
    const leaf = first.parts[0];
    expect(leaf.kind === "leaf" && hex(leaf.key)).toBe("00".repeat(32));
    // second redemption: root = (sentinel leaf pruned to its label, the note's leaf)
    const second = decodeAvlProof(r2.proof5);
    expect(second.wellFormed).toBe(true);
    expect([second.labels, second.leaves, second.internals]).toEqual([1, 1, 1]);
    const noteLeaf = second.parts.find((p) => p.kind === "leaf");
    expect(noteLeaf?.kind === "leaf" && hex(noteLeaf.key)).toBe(hex(debtKey(r2.owner, r2.receiver)));
    expect(noteLeaf?.kind === "leaf" && hex(noteLeaf.value)).toBe(hex(cat(be64(chain.redemptions[0].timestamp), be64(100_000_000))));
    expect(second.bytes.labels + second.bytes.leaves + second.bytes.balances + 1 + second.bytes.directions).toBe(unhex(r2.proof5).length);
    expect(decodeAvlProof(r2.proof5.slice(0, 100)).wellFormed).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// random sequences: the same operations as tests/vectors.rs, results folded into a rolling hash
// ---------------------------------------------------------------------------------------------

class XorShift32 {
  constructor(private s: number) {}
  next(): number {
    let x = this.s;
    x = (x ^ (x << 13)) >>> 0;
    x = (x ^ (x >>> 17)) >>> 0;
    x = (x ^ (x << 5)) >>> 0;
    this.s = x;
    return x;
  }
  below(n: number): number {
    return this.next() % n;
  }
  bytes(n: number): Uint8Array {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = this.next() >>> 24;
    return b;
  }
}

interface GenOp {
  kind: AvlOpKind;
  key: Uint8Array;
  value: Uint8Array;
  proofAfter: boolean;
}

function generate(p: Scenario["params"]): GenOp[] {
  const rng = new XorShift32(p.seed);
  const pool: Uint8Array[] = [];
  while (pool.length < p.pool) {
    const k = rng.bytes(32);
    if (k.every((b) => b === 0) || k.every((b) => b === 0xff)) continue;
    pool.push(k);
  }
  const ops: GenOp[] = [];
  for (let i = 0; i < p.ops; i++) {
    const r = rng.below(100);
    const kind: AvlOpKind = r < 30 ? "insert" : r < 50 ? "insertOrUpdate" : r < 65 ? "update" : r < 85 ? "lookup" : r < 92 ? "remove" : "removeIfExists";
    let key = pool[rng.below(p.pool)];
    const special = rng.below(64);
    if (special === 0) key = new Uint8Array(32);
    else if (special === 1) key = key.slice(0, 31);
    let value = new Uint8Array(0);
    if (kind === "insert" || kind === "update" || kind === "insertOrUpdate") {
      let n = p.valueSize ?? rng.below(49);
      if (p.valueLength !== null && rng.below(50) === 0) n += 1;
      value = rng.bytes(n);
    }
    const coin = rng.below(3) === 0;
    ops.push({ kind, key, value, proofAfter: coin || i + 1 === p.ops });
  }
  return ops;
}

const u32be = (n: number) => Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255);

function opRecord(op: GenOp, res: AvlOpResult): Uint8Array {
  const head = cat(Uint8Array.of(AVL_OP_CODE[op.kind]), u32be(op.key.length), op.key, u32be(op.value.length), op.value);
  if (!res.ok) return cat(head, u32be(res.error.rc >>> 0));
  if (res.old === undefined) return cat(head, u32be(0));
  return cat(head, u32be(1), u32be(res.old.length), res.old);
}

describe("random sequences, bit-exact with the native build", () => {
  for (const sc of random.scenarios) {
    it(`${sc.params.name}: ${sc.params.ops} ops`, () => {
      const ops = generate(sc.params);
      const t = ErgoAvlProver.create({ valueLength: sc.params.valueLength });
      let rolling: Uint8Array = new Uint8Array(32);
      let start = t.digest();
      let batch: Array<{ op: GenOp; old: Uint8Array | undefined }> = [];
      let ok = 0;
      let failed = 0;
      let proofs = 0;
      let maxHeight = 0;
      const checkpoints: Scenario["checkpoints"] = [];
      ops.forEach((op, i) => {
        const res = t.apply({ kind: op.kind, key: op.key, value: op.value });
        rolling = blake2b256(rolling, opRecord(op, res));
        if (res.ok) {
          ok++;
          batch.push({ op, old: res.old });
        } else failed++;
        if (op.proofAfter) {
          const proof = t.generateProof();
          const digest = t.digest();
          rolling = blake2b256(rolling, Uint8Array.of(0xff), u32be(proof.length), proof, digest);
          proofs++;
          maxHeight = Math.max(maxHeight, t.height);
          const v = verifyAvlProof(start, proof, batch.map((b) => ({ kind: b.op.kind, key: b.op.key, value: b.op.value })), { valueLength: sc.params.valueLength });
          expect(v.ok).toBe(true);
          expect(hex(v.digest!)).toBe(hex(digest));
          v.results.forEach((x, j) => expect(x.ok && x.old ? hex(x.old) : null).toBe(batch[j].old ? hex(batch[j].old!) : null));
          batch = [];
          start = digest;
        }
        if ((i + 1) % 100 === 0) checkpoints.push({ afterOp: i, digest: t.digestHex(), size: t.size });
      });
      expect(checkpoints).toEqual(sc.checkpoints);
      expect({ okOps: ok, failedOps: failed, proofs, maxHeight, finalSize: t.size, finalDigest: t.digestHex(), rollingHash: hex(rolling) }).toEqual(sc.summary);
      t.free();
    });
  }
});

// ---------------------------------------------------------------------------------------------
// prover API
// ---------------------------------------------------------------------------------------------

describe("prover", () => {
  const rng = new XorShift32(0x1234567);
  const keys = Array.from({ length: 64 }, () => rng.bytes(32));
  const vals = keys.map(() => rng.bytes(16));

  it("strict insert, update, remove, entries in key order, dump", () => {
    const t = ErgoAvlProver.create();
    keys.forEach((k, i) => t.insert(k, vals[i]));
    expect(t.size).toBe(64);
    expect(t.pending).toBe(64);
    expect(() => t.insert(keys[0], vals[1])).toThrowError(/exist/);
    const dup = t.apply({ kind: "insert", key: keys[0], value: vals[1] });
    expect(dup.ok === false && dup.error.code).toBe("KeyExists");
    const miss = t.apply({ kind: "update", key: rng.bytes(32), value: vals[0] });
    expect(miss.ok === false && miss.error.code).toBe("KeyMissing");
    const sentinel = t.apply({ kind: "insert", key: new Uint8Array(32).fill(0xff), value: vals[0] });
    expect(sentinel.ok === false && sentinel.error.code).toBe("KeyOutOfRange");
    expect(t.pending).toBe(64); // failures are not pending operations
    expect(hex(t.update(keys[1], vals[2]))).toBe(hex(vals[1]));
    expect(hex(t.remove(keys[2]))).toBe(hex(vals[2]));
    expect(t.get(keys[2])).toBeUndefined();
    expect(t.size).toBe(63);

    const e = t.entries();
    expect(e.length).toBe(63);
    const sorted = e.map((x) => hex(x.key));
    expect([...sorted].sort()).toEqual(sorted);
    const root = t.dump();
    expect(root.kind).toBe("internal");
    if (root.kind === "internal") expect(hex(root.label)).toBe(hex(t.digest()).slice(0, 64));
    t.free();
  });

  it("fork is independent, prove() does not move the tree", () => {
    const t = ErgoAvlProver.from(keys.slice(0, 40).map((key, i) => ({ kind: "insert" as const, key, value: vals[i] })));
    const d0 = t.digestHex();
    const f = t.fork();
    for (let i = 40; i < 64; i++) f.insert(keys[i], vals[i]);
    f.remove(keys[0]);
    expect(t.digestHex()).toBe(d0);
    expect(t.get(keys[0])).toBeDefined();
    expect(f.get(keys[0])).toBeUndefined();
    const p = t.prove([{ kind: "insert", key: keys[50], value: vals[50] }, { kind: "lookup", key: keys[3] }]);
    expect(t.digestHex()).toBe(d0);
    expect(hex(p.startDigest)).toBe(d0);
    const v = verifyAvlProof(d0, p.proof, [{ kind: "insert", key: keys[50], value: vals[50] }, { kind: "lookup", key: keys[3] }]);
    expect(v.ok).toBe(true);
    expect(hex(v.digest!)).toBe(hex(p.digest));
    t.free();
    f.free();
  });

  it("verifier limits: one-operation proofs pass maxNumOperations 1 / maxDeletes 0", () => {
    const t = ErgoAvlProver.from(keys.slice(0, 30).map((key, i) => ({ kind: "insert" as const, key, value: vals[i] })));
    const d = t.digest();
    t.insert(keys[31], vals[31]);
    const proof = t.generateProof();
    const v = ErgoAvlVerifier.create(d, proof, { maxNumOperations: 1, maxDeletes: 0 });
    expect(v.apply({ kind: "insert", key: keys[31], value: vals[31] }).ok).toBe(true);
    expect(hex(v.digest()!)).toBe(t.digestHex());
    v.free();
    t.free();
  });
});

// ---------------------------------------------------------------------------------------------
// the protocol engine's AuthenticatedMap
// ---------------------------------------------------------------------------------------------

describe("AuthenticatedMap backend", () => {
  it("loads through the lazy thenable and behaves like the contract expects", async () => {
    const b = await backend;
    expect(b.id).toBe("ergo-avl-wasm");
    expect(b.simulated).toBe(false);
    const again = await loadErgoAvlBackend();
    expect(again.id).toBe(b.id);

    const [r1, r2] = chain.redemptions;
    const key = debtKey(r1.owner, r1.receiver);
    const m = b.createMap(32) as ErgoAvlMap;
    expect(hex(m.digest())).toBe(EMPTY_AVL_DIGEST_HEX);

    // first redemption: proof #5 for an insert, without applying it
    const v1 = cat(be64(r1.timestamp), be64(100_000_000));
    const p1 = m.prove([{ op: "insert", key, value: v1 }]);
    expect(hex(p1.proof)).toBe(r1.proof5);
    expect(p1.results).toEqual([null]);
    expect(hex(m.digest())).toBe(EMPTY_AVL_DIGEST_HEX);
    expect(hex(b.verifier!.insert(m.digest(), [[key, v1]], p1.proof))).toBe(hex(r5digest(r1.reserveOut.R5)));
    m.insert(key, v1);
    expect(hex(m.digest())).toBe(hex(r5digest(r1.reserveOut.R5)));
    expect(() => m.insert(key, v1)).toThrow(AvlOperationError);

    // second redemption: #7 = proofFor(key), #5 = prove(insertOrUpdate)
    const p7 = m.proofFor(key);
    expect(hex(p7)).toBe(r2.proof7);
    expect(hex(ergoAvlVerifier.lookup(m.digest(), key, p7)!)).toBe(hex(v1));
    const v2 = cat(be64(r2.timestamp), be64(200_000_000));
    const p5 = m.prove([{ op: "insertOrUpdate", key, value: v2 }]);
    expect(hex(p5.proof)).toBe(r2.proof5);
    expect(hex(p5.results[0]!)).toBe(hex(v1));
    expect(hex(ergoAvlVerifier.insertOrUpdate(m.digest(), [[key, v2]], p5.proof))).toBe(hex(r5digest(r2.reserveOut.R5)));
    expect(() => ergoAvlVerifier.insert(m.digest(), [[key, v2]], p5.proof)).toThrow(AvlOperationError);
    expect(() => ergoAvlVerifier.lookup(m.digest(), key, p7.slice(0, 40))).toThrow(AvlProofError);

    // absent keys: proven absent, not an error
    const other = blake2b256(new TextEncoder().encode("nobody"));
    expect(ergoAvlVerifier.lookup(m.digest(), other, m.proofFor(other))).toBeNull();

    const c = m.clone();
    c.update(key, v2);
    expect(hex(c.digest())).toBe(hex(r5digest(r2.reserveOut.R5)));
    expect(hex(m.digest())).toBe(hex(r5digest(r1.reserveOut.R5)));
    expect(m.entries().length).toBe(1);
    expect(m.size).toBe(1);
    expect(() => m.update(other, v2)).toThrow(AvlOperationError);
    expect(() => m.get(new Uint8Array(31))).toThrow(AvlOperationError);
    m.free();
    (c as ErgoAvlMap).free();
  });
});

// ---------------------------------------------------------------------------------------------
// hostile input
// ---------------------------------------------------------------------------------------------

/**
 * A crafted (digest, proof) pair: a degenerate "tree" `depth` levels deep (each level a pruned
 * left subtree and the rest on the right), one real leaf at the bottom. Proof = the labels in
 * post order, the leaf, `depth` balance bytes, end marker, `depth` direction bits "right".
 */
function craftedChain(depth: number) {
  const key = blake2b256(Uint8Array.of(7));
  const value = be64(42);
  const ff = new Uint8Array(32).fill(0xff);
  const leaf = cat(Uint8Array.of(2), key, ff, u32be(8), value);
  const proof = new Uint8Array(depth * 33 + leaf.length + depth + 1 + Math.ceil(depth / 8));
  const lefts: Uint8Array[] = [];
  for (let i = 0; i < depth; i++) {
    const l = blake2b256(u32be(i));
    lefts.push(l);
    proof[i * 33] = 3;
    proof.set(l, i * 33 + 1);
  }
  let at = depth * 33;
  proof.set(leaf, at);
  at += leaf.length;
  proof.fill(1, at, at + depth); // internal nodes, balance +1
  proof[at + depth] = 4; // end of tree; the direction bytes stay 0 = right
  let label = blake2b256(Uint8Array.of(0), key, value, ff);
  for (let i = depth - 1; i >= 0; i--) label = blake2b256(Uint8Array.of(1, 1), lefts[i], label);
  return { key, value, digest: cat(label, Uint8Array.of(Math.min(depth, 255))), proof };
}

describe("hostile proofs", () => {
  it("truncations and bit flips never throw; whatever is accepted gives the true digest", () => {
    const r = chain.redemptions[1];
    const key = debtKey(r.owner, r.receiver);
    const before = r5digest(r.reserveIn.R5);
    const want = hex(r5digest(r.reserveOut.R5));
    const value = cat(be64(r.timestamp), be64(200_000_000));
    const good = unhex(r.proof5);
    const variants: Uint8Array[] = [];
    for (let cut = 0; cut < good.length; cut++) variants.push(good.slice(0, cut));
    for (let i = 0; i < good.length; i++)
      for (const bit of [0, 4, 7]) {
        const m = good.slice();
        m[i] ^= 1 << bit;
        variants.push(m);
      }
    variants.push(cat(good, new Uint8Array(5)));
    let accepted = 0;
    for (const p of variants) {
      const v = verifyAvlProof(before, p, [{ kind: "insertOrUpdate", key, value }]);
      if (v.ok) {
        accepted++;
        expect(hex(v.digest!)).toBe(want);
      }
    }
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(variants.length / 4);
    expect(avlInfo().restarts).toBe(0);
  });

  it("a crafted 1000-level tree verifies like on the JVM", () => {
    const c = craftedChain(1000);
    const v = verifyAvlProof(c.digest, c.proof, [{ kind: "lookup", key: c.key }]);
    expect(v.ok).toBe(true);
    expect(hex(v.results[0].ok ? v.results[0].old! : new Uint8Array())).toBe(hex(c.value));
    expect(hex(v.digest!)).toBe(hex(c.digest));
  });

  it("a crafted 100 000-level tree fails cleanly and the engine recovers", () => {
    const c = craftedChain(100_000);
    const v = verifyAvlProof(c.digest, c.proof, [{ kind: "lookup", key: c.key }]);
    if (v.ok) expect(hex(v.results[0].ok ? v.results[0].old! : new Uint8Array())).toBe(hex(c.value));
    // whatever happened, verification and proving still work
    const r = chain.redemptions[0];
    const ok = sigmaAvl.get({ digest: r5digest(r.tracker.R5) }, debtKey(r.owner, r.receiver), r.proof8);
    expect(ok.scriptError).toBe(false);
    const t = ErgoAvlProver.create();
    t.insert(debtKey(r.owner, r.receiver), cat(be64(r.timestamp), be64(100_000_000)));
    expect(hex(t.digest())).toBe(hex(r5digest(r.reserveOut.R5)));
    t.free();
  });

  it("frees what it allocates", () => {
    const live = avlLiveHandles();
    const t = ErgoAvlProver.create();
    const f = t.fork();
    expect(avlLiveHandles().provers).toBe(live.provers + 2);
    t.free();
    f.free();
    t.free(); // idempotent
    expect(avlLiveHandles()).toEqual(live);
    expect(() => t.digest()).toThrowError(/freed/);
  });
});
