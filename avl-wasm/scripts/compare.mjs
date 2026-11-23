// Loads avl.wasm in node and replays the vectors written by the native test
// (cargo test --test vectors): every operation result, every proof byte, every digest must be
// identical to the native build. Also replays the real mainnet redemptions.
//
//   node scripts/compare.mjs <avl.wasm> <random-full.json> <chain-vectors.json>
//
// Deliberately standalone (raw ABI, no app code) so it checks the wasm itself.
import { readFileSync } from "node:fs";

const [wasmPath, fullPath, chainPath] = process.argv.slice(2);
if (!wasmPath || !fullPath) {
  console.error("usage: node compare.mjs <avl.wasm> <random-full.json> [chain-vectors.json]");
  process.exit(2);
}

const hex = (b) => Buffer.from(b).toString("hex");
const unhex = (s) => Uint8Array.from(Buffer.from(s, "hex"));

const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {});
const x = instance.exports;
if (x.avl_init() !== 1) throw new Error("unexpected ABI version");

function mem() {
  return new Uint8Array(x.memory.buffer);
}
// write several byte arrays into the scratch buffer, return [ptr, len] pairs
function put(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const base = x.avl_scratch(total);
  const m = mem();
  let off = base;
  const out = [];
  for (const p of parts) {
    m.set(p, off);
    out.push(off, p.length);
    off += p.length;
  }
  return out;
}
function out() {
  const p = x.avl_out_ptr();
  const n = x.avl_out_len();
  return mem().slice(p, p + n);
}
function text() {
  return new TextDecoder().decode(out());
}

const proverNew = (vl) => x.avl_prover_new(32, vl === null ? -1 : vl);
function proverOp(h, kind, key, value) {
  const [kp, kl, vp, vlen] = put(key, value);
  const rc = x.avl_prover_op(h, kind, kp, kl, vp, vlen);
  return { code: rc, old: rc === 1 ? out() : null, msg: rc < 0 ? text() : null };
}
function verifierNew(digest, proof, vl, maxOps = -1, maxDel = -1) {
  const [dp, dl, pp, pl] = put(digest, proof);
  const h = x.avl_verifier_new(dp, dl, pp, pl, 32, vl === null ? -1 : vl, maxOps, maxDel);
  if (h <= 0) throw new Error("verifier_new: " + text());
  return h;
}
function verifierOp(h, kind, key, value) {
  const [kp, kl, vp, vlen] = put(key, value);
  const rc = x.avl_verifier_op(h, kind, kp, kl, vp, vlen);
  return { code: rc, old: rc === 1 ? out() : null, msg: rc < 0 ? text() : null };
}
function digestOf(fn, h) {
  const rc = fn(h);
  return rc === 33 ? out() : null;
}
let failures = 0;
function check(cond, what) {
  if (!cond) {
    failures++;
    console.error("MISMATCH:", what);
    if (failures > 20) process.exit(1);
  }
}

// --- random sequences -------------------------------------------------------------------------
const full = JSON.parse(readFileSync(fullPath, "utf8"));
let nOps = 0;
let nProofs = 0;
for (const sc of full.scenarios) {
  const vl = sc.params.valueLength;
  const p = proverNew(vl);
  let start = digestOf(x.avl_prover_digest, p);
  let batch = [];
  let pi = 0;
  for (let i = 0; i < sc.ops.length; i++) {
    const op = sc.ops[i];
    const key = unhex(op.key);
    const value = unhex(op.value);
    const r = proverOp(p, op.kind, key, value);
    nOps++;
    check(r.code === op.result.code, `${sc.params.name} op ${i} code ${r.code} != ${op.result.code} (${r.msg})`);
    if (op.result.code === 1) check(hex(r.old) === op.result.old, `${sc.params.name} op ${i} old value`);
    if (r.code >= 0) batch.push({ kind: op.kind, key, value, old: r.old });
    if (op.proofAfter) {
      const n = x.avl_prover_proof(p);
      const proof = out();
      check(n === proof.length, "proof length");
      const expected = sc.proofs[pi++];
      check(hex(proof) === expected.proof, `${sc.params.name} proof after op ${i}`);
      const digest = digestOf(x.avl_prover_digest, p);
      check(hex(digest) === expected.digest, `${sc.params.name} digest after op ${i}`);
      check(hex(start) === expected.start, `${sc.params.name} start digest`);
      const v = verifierNew(start, proof, vl);
      for (const b of batch) {
        const rv = verifierOp(v, b.kind, b.key, b.value);
        check(rv.code === (b.old ? 1 : 0), `${sc.params.name} verifier op code ${rv.code} ${rv.msg}`);
        if (b.old) check(hex(rv.old) === hex(b.old), "verifier old value");
      }
      check(hex(digestOf(x.avl_verifier_digest, v) ?? []) === expected.digest, `${sc.params.name} verifier digest`);
      x.avl_verifier_free(v);
      nProofs++;
      batch = [];
      start = digest;
    }
  }
  check(hex(digestOf(x.avl_prover_digest, p)) === sc.summary.finalDigest, `${sc.params.name} final digest`);
  x.avl_prover_free(p);
}
console.log(`random: ${full.scenarios.length} scenarios, ${nOps} ops, ${nProofs} proofs replayed in wasm`);

// --- real mainnet redemptions -------------------------------------------------------------------
if (chainPath) {
  const cv = JSON.parse(readFileSync(chainPath, "utf8"));
  const digestOfR5 = (r5) => unhex(r5.slice(2, 68));
  const be = (n) => {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(n));
    return b;
  };
  const cat = (...a) => {
    const o = new Uint8Array(a.reduce((n, p) => n + p.length, 0));
    let i = 0;
    for (const p of a) {
      o.set(p, i);
      i += p.length;
    }
    return o;
  };
  const blake = (b) => {
    const [pp, pl] = put(b);
    x.avl_blake2b256(pp, pl);
    return out();
  };
  x.avl_empty_digest(32, -1);
  check(hex(out()) === cv.emptyDigest.digest, "empty digest");
  for (const r of cv.redemptions) {
    const key = blake(cat(unhex(r.owner), unhex(r.receiver)));
    const before = digestOfR5(r.reserveIn.R5);
    const after = digestOfR5(r.reserveOut.R5);
    const redeemed = r.reserveIn.value - r.reserveOut.value;
    // tracker lookup (#8)
    const tv = verifierNew(digestOfR5(r.tracker.R5), unhex(r.proof8), null);
    const t = verifierOp(tv, 0, key, new Uint8Array());
    check(t.code === 1 && hex(t.old) === hex(be(r.totalDebt)), r.name + ": tracker lookup");
    x.avl_verifier_free(tv);
    let prev = 0;
    if (r.proof7) {
      const lv = verifierNew(before, unhex(r.proof7), null);
      const l = verifierOp(lv, 0, key, new Uint8Array());
      check(l.code === 1, r.name + ": reserve lookup");
      prev = Number(new DataView(l.old.buffer).getBigUint64(8));
      x.avl_verifier_free(lv);
    }
    const value = cat(be(r.timestamp), be(prev + redeemed));
    const kind = r.proof7 ? 3 : 1;
    const v = verifierNew(before, unhex(r.proof5), null);
    const res = verifierOp(v, kind, key, value);
    check(res.code >= 0, r.name + ": reserve update " + res.msg);
    check(hex(digestOf(x.avl_verifier_digest, v) ?? []) === hex(after), r.name + ": new reserve digest");
    x.avl_verifier_free(v);
  }
  // proofs regenerated byte for byte (reserve aa8340fc: insert, then lookup + insertOrUpdate)
  const [r1, r2] = cv.redemptions;
  const key = blake(cat(unhex(r1.owner), unhex(r1.receiver)));
  const p = proverNew(null);
  const v1 = cat(be(r1.timestamp), be(100000000));
  proverOp(p, 1, key, v1);
  x.avl_prover_proof(p);
  check(hex(out()) === r1.proof5, "insert proof bytes == on-chain #5");
  const f1 = x.avl_prover_fork(p);
  proverOp(f1, 0, key, new Uint8Array());
  x.avl_prover_proof(f1);
  check(hex(out()) === r2.proof7, "lookup proof bytes == on-chain #7");
  const f2 = x.avl_prover_fork(p);
  proverOp(f2, 3, key, cat(be(r2.timestamp), be(200000000)));
  x.avl_prover_proof(f2);
  check(hex(out()) === r2.proof5, "insertOrUpdate proof bytes == on-chain #5");
  check(hex(digestOf(x.avl_prover_digest, f2)) === hex(digestOfR5(r2.reserveOut.R5)), "digest == on-chain R5");
  for (const h of [p, f1, f2]) x.avl_prover_free(h);
  console.log(`chain: ${cv.redemptions.length} mainnet redemptions replayed, proofs regenerated byte-exact`);
}

// caller-owned buffers (avl_alloc / avl_dealloc) work like the scratch buffer
{
  const data = new TextEncoder().encode("basis avl_alloc check, 64 bytes long ......................");
  const [sp, sl] = put(data);
  x.avl_blake2b256(sp, sl);
  const viaScratch = hex(out());
  const p = x.avl_alloc(data.length);
  check(p !== 0, "avl_alloc returned null");
  mem().set(data, p);
  x.avl_blake2b256(p, data.length);
  check(hex(out()) === viaScratch, "hash of an avl_alloc buffer");
  x.avl_dealloc(p, data.length);
}

const live = x.avl_live_handles();
check(live === 0, "leaked handles: " + live.toString(16));
if (failures) {
  console.error(`FAILED: ${failures} mismatches`);
  process.exit(1);
}
console.log("OK: wasm == native");
