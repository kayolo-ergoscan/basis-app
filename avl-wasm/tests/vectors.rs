//! Native test suite. Run: cargo test (writes vectors/random-full.json and
//! vectors/random-compact.json, read by scripts/compare.mjs and the app's vitest test).
//!
//! 1. empty-tree digest == mainnet Basis reserve R5
//! 2. real mainnet redemptions: tracker lookup proofs, reserve lookup / insert /
//!    insertOrUpdate proofs replay to the on-chain output R5; our prover regenerates the
//!    on-chain proof bytes exactly
//! 3. seeded random sequences (prover vs verifier vs the crate's own verifier)
//! 4. fork independence, malformed proofs never panic

use basis_avl_wasm::engine::{blake2b256, empty_digest, ErrorCode, OpKind, Prover, Verifier};
use basis_avl_wasm::safe_verifier::label_only_resolver;
use bytes::Bytes;
use ergo_avltree_rust::authenticated_tree_ops::AuthenticatedTreeOps;
use ergo_avltree_rust::batch_avl_verifier::BatchAVLVerifier;
use ergo_avltree_rust::batch_node::AVLTree;
use ergo_avltree_rust::operation::{KeyValue, Operation};
use serde_json::{json, Value};
use std::path::PathBuf;

fn unhex(s: &str) -> Vec<u8> {
    assert!(s.len() % 2 == 0, "odd hex");
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

fn be(x: u64) -> Vec<u8> {
    x.to_be_bytes().to_vec()
}

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn digest_from_r5(r5: &str) -> Vec<u8> {
    // AvlTree constant: 0x64 | digest(33) | flags | keyLength VLQ | valueLengthOpt
    assert!(r5.starts_with("64"));
    unhex(&r5[2..2 + 66])
}

/// The crate's own verifier (with the sigma-rust resolver), as a reference for SafeVerifier.
fn crate_verify(
    digest: &[u8],
    proof: &[u8],
    value_length: Option<usize>,
    ops: &[(OpKind, Vec<u8>, Vec<u8>)],
) -> Option<(Vec<Option<Vec<u8>>>, Vec<u8>)> {
    let tree = AVLTree::new(label_only_resolver, 32, value_length);
    let mut v = BatchAVLVerifier::new(&Bytes::copy_from_slice(digest), &Bytes::copy_from_slice(proof), tree, None, None).ok()?;
    let mut res = Vec::new();
    for (k, key, val) in ops {
        let key = Bytes::copy_from_slice(key);
        let kv = KeyValue { key: key.clone(), value: Bytes::copy_from_slice(val) };
        let op = match k {
            OpKind::Lookup => Operation::Lookup(key),
            OpKind::Insert => Operation::Insert(kv),
            OpKind::Update => Operation::Update(kv),
            OpKind::InsertOrUpdate => Operation::InsertOrUpdate(kv),
            OpKind::Remove => Operation::Remove(key),
            OpKind::RemoveIfExists => Operation::RemoveIfExists(key),
        };
        res.push(v.perform_one_operation(&op).ok()?.map(|b| b.to_vec()));
    }
    Some((res, v.digest()?.to_vec()))
}

// -------------------------------------------------------------------------------------------
// 1. empty tree
// -------------------------------------------------------------------------------------------

#[test]
fn empty_tree_digest_is_the_mainnet_reserve_r5() {
    let d = empty_digest(32, None).unwrap();
    assert_eq!(hex(&d), "4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900");
    // R5 of Basis reserve 3857cf9f6e4394b9819363d5ffa9720fdc2982ebf1d19b3a53cdfcf72da3934e
    // (mainnet h 1639835) = 64 | 4ec61f..0900 | 03 | 20 | 00
    let r5 = "644ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900032000";
    assert_eq!(digest_from_r5(r5), d);
    // fixed value lengths give other empty digests (the -inf leaf holds a zero value)
    assert_ne!(empty_digest(32, Some(8)).unwrap(), d);
    assert_ne!(empty_digest(32, Some(16)).unwrap(), d);
}

// -------------------------------------------------------------------------------------------
// 2. real mainnet redemptions
// -------------------------------------------------------------------------------------------

fn chain_vectors() -> Value {
    let p = crate_dir().join("vectors/chain-vectors.json");
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v[k].as_str().unwrap_or_else(|| panic!("missing {}", k))
}

fn debt_key(owner: &str, receiver: &str) -> Vec<u8> {
    let mut b = unhex(owner);
    b.extend(unhex(receiver));
    blake2b256(&b).to_vec()
}

#[test]
fn mainnet_redemptions_replay_to_the_onchain_digests() {
    let cv = chain_vectors();
    for r in cv["redemptions"].as_array().unwrap() {
        let name = s(r, "name");
        let key = debt_key(s(r, "owner"), s(r, "receiver"));
        let tracker_digest = digest_from_r5(s(&r["tracker"], "R5"));
        let before = digest_from_r5(s(&r["reserveIn"], "R5"));
        let after = digest_from_r5(s(&r["reserveOut"], "R5"));
        let total_debt = r["totalDebt"].as_u64().unwrap();
        let ts = r["timestamp"].as_u64().unwrap();
        let redeemed = r["reserveIn"]["value"].as_u64().unwrap() - r["reserveOut"]["value"].as_u64().unwrap();
        let proof5 = unhex(s(r, "proof5"));
        let proof8 = unhex(s(r, "proof8"));
        let proof7 = r["proof7"].as_str().map(unhex);

        // #8: trackerTree.get(key, proof).get == totalDebt (sigma: verifier without limits)
        let mut tv = Verifier::new(&tracker_digest, &proof8, 32, None, None, None).unwrap();
        let got = tv.apply(OpKind::Lookup, &key, &[]).unwrap().expect("tracker tree holds the note");
        assert_eq!(got, be(total_debt), "{}: tracker value", name);
        assert_eq!(tv.digest().unwrap(), tracker_digest, "lookups do not change the digest");
        let reference = crate_verify(&tracker_digest, &proof8, None, &[(OpKind::Lookup, key.clone(), vec![])]).unwrap();
        assert_eq!(reference.0[0].as_ref().unwrap(), &got);

        // #7 (optional): SELF.R5.get(key, proof) -> ts || redeemedDebt
        let (stored_ts, redeemed_before) = match &proof7 {
            Some(p7) => {
                let mut rv = Verifier::new(&before, p7, 32, None, None, None).unwrap();
                let v = rv.apply(OpKind::Lookup, &key, &[]).unwrap().expect("reserve tree holds the pair");
                assert_eq!(v.len(), 16);
                (u64::from_be_bytes(v[0..8].try_into().unwrap()), u64::from_be_bytes(v[8..16].try_into().unwrap()))
            }
            None => (0, 0),
        };
        assert!(ts >= stored_ts);
        let new_value = [be(ts), be(redeemed_before + redeemed)].concat();

        // #5: insert (no #7) or insertOrUpdate (#7 present) -> must equal the output R5 digest
        let kind = if proof7.is_some() { OpKind::InsertOrUpdate } else { OpKind::Insert };
        let mut rv = Verifier::new(&before, &proof5, 32, None, None, None).unwrap();
        let old = rv.apply(kind, &key, &new_value).unwrap();
        assert_eq!(old.is_some(), proof7.is_some(), "{}", name);
        assert_eq!(hex(&rv.digest().unwrap()), hex(&after), "{}: new reserve digest", name);
        let reference = crate_verify(&before, &proof5, None, &[(kind, key.clone(), new_value.clone())]).unwrap();
        assert_eq!(reference.1, after, "crate verifier agrees");

        // replay protection: the same proof with strict insert must fail when the key exists
        if proof7.is_some() {
            let mut rv = Verifier::new(&before, &proof5, 32, None, None, None).unwrap();
            let e = rv.apply(OpKind::Insert, &key, &new_value).unwrap_err();
            assert_eq!(e.code, ErrorCode::KeyExists);
            assert!(rv.digest().is_none(), "a failed operation kills the verifier");
        }
    }
}

#[test]
fn mainnet_proof_bytes_are_regenerated_exactly() {
    let cv = chain_vectors();
    let reds = cv["redemptions"].as_array().unwrap();
    let first = &reds[0];
    let second = &reds[1];
    let tui = &reds[2];

    // Reserve aa8340fc -> 8dc21481 -> 3ae59d54 (two redemptions of one note)
    let key = debt_key(s(first, "owner"), s(first, "receiver"));
    let mut p = Prover::new(32, None).unwrap();
    assert_eq!(p.digest(), digest_from_r5(s(&first["reserveIn"], "R5")));
    let v1 = [be(first["timestamp"].as_u64().unwrap()), be(100_000_000)].concat();
    assert_eq!(p.apply(OpKind::Insert, &key, &v1).unwrap(), None);
    let proof = p.generate_proof();
    assert_eq!(hex(&proof), s(first, "proof5"), "insert proof (#5) of tx 4b65c7cd");
    assert_eq!(p.digest(), digest_from_r5(s(&first["reserveOut"], "R5")));

    let mut lookup = p.fork();
    assert_eq!(lookup.apply(OpKind::Lookup, &key, &[]).unwrap(), Some(v1.clone()));
    assert_eq!(hex(&lookup.generate_proof()), s(second, "proof7").to_string(), "lookup proof (#7) of tx cfcd8579");

    let v2 = [be(second["timestamp"].as_u64().unwrap()), be(200_000_000)].concat();
    let mut upd = p.fork();
    assert_eq!(upd.apply(OpKind::InsertOrUpdate, &key, &v2).unwrap(), Some(v1.clone()));
    assert_eq!(hex(&upd.generate_proof()), s(second, "proof5"), "insertOrUpdate proof (#5) of tx cfcd8579");
    assert_eq!(upd.digest(), digest_from_r5(s(&second["reserveOut"], "R5")));
    // the persistent prover is untouched by its forks
    assert_eq!(p.digest(), digest_from_r5(s(&second["reserveIn"], "R5")));
    // update proofs and lookup proofs of the same key are the same bytes (the proof is the old path)
    assert_eq!(s(second, "proof5"), s(second, "proof7"));

    // Reserve 2ced1079 -> 9b748164, and its tracker tree (one note: Alice -> Bob, 0.4 ERG)
    let key = debt_key(s(tui, "owner"), s(tui, "receiver"));
    let mut p = Prover::new(32, None).unwrap();
    let v = [be(tui["timestamp"].as_u64().unwrap()), be(100_000_000)].concat();
    p.apply(OpKind::Insert, &key, &v).unwrap();
    assert_eq!(hex(&p.generate_proof()), s(tui, "proof5"), "insert proof (#5) of tx 85b14cc0");
    assert_eq!(p.digest(), digest_from_r5(s(&tui["reserveOut"], "R5")));

    let mut tracker = Prover::new(32, None).unwrap();
    tracker.apply(OpKind::Insert, &key, &be(tui["totalDebt"].as_u64().unwrap())).unwrap();
    let _commit = tracker.generate_proof();
    assert_eq!(tracker.digest(), digest_from_r5(s(&tui["tracker"], "R5")), "tracker box b9c4bdbd R5");
    tracker.apply(OpKind::Lookup, &key, &[]).unwrap();
    assert_eq!(hex(&tracker.generate_proof()), s(tui, "proof8"), "tracker lookup proof (#8) of tx 85b14cc0");
}

#[test]
fn mainnet_digests_of_older_redemptions() {
    let cv = chain_vectors();
    for d in cv["digestOnly"].as_array().unwrap() {
        let key = debt_key(s(d, "owner"), s(d, "receiver"));
        let mut p = Prover::new(32, None).unwrap();
        let v = [be(d["timestamp"].as_u64().unwrap()), be(d["redeemed"].as_u64().unwrap())].concat();
        p.apply(OpKind::Insert, &key, &v).unwrap();
        assert_eq!(hex(&p.digest()), s(d, "after"), "{}", s(d, "name"));
    }
}

// -------------------------------------------------------------------------------------------
// 3. seeded random sequences (the TS test regenerates the same operations)
// -------------------------------------------------------------------------------------------

/// xorshift32, seed != 0. Mirrored in avl-wasm.test.ts.
struct Rng(u32);
impl Rng {
    fn next(&mut self) -> u32 {
        let mut x = self.0;
        x ^= x << 13;
        x ^= x >> 17;
        x ^= x << 5;
        self.0 = x;
        x
    }
    fn below(&mut self, n: u32) -> u32 {
        self.next() % n
    }
    fn bytes(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| (self.next() >> 24) as u8).collect()
    }
}

struct Scenario {
    name: &'static str,
    seed: u32,
    value_length: Option<usize>,
    /// value size for generated values: Some(n) fixed, None random 0..=48
    value_size: Option<usize>,
    ops: usize,
    pool: usize,
}

pub const SCENARIOS: &[(&str, u32, i32, i32, usize, usize)] = &[
    // name, seed, valueLength (-1 = variable), valueSize (-1 = random 0..48), ops, pool
    ("tracker-8", 0x9e3779b9, -1, 8, 1000, 600),
    ("reserve-16", 0x85ebca6b, -1, 16, 1000, 600),
    ("mixed-var", 0xc2b2ae35, -1, -1, 400, 200),
    ("fixed-8", 0x27d4eb2f, 8, 8, 400, 200),
];

fn scenarios() -> Vec<Scenario> {
    SCENARIOS
        .iter()
        .map(|(name, seed, vl, vs, ops, pool)| Scenario {
            name,
            seed: *seed,
            value_length: if *vl < 0 { None } else { Some(*vl as usize) },
            value_size: if *vs < 0 { None } else { Some(*vs as usize) },
            ops: *ops,
            pool: *pool,
        })
        .collect()
}

#[derive(Clone)]
struct GenOp {
    kind: OpKind,
    key: Vec<u8>,
    value: Vec<u8>,
    proof_after: bool,
}

fn generate(sc: &Scenario) -> Vec<GenOp> {
    let mut rng = Rng(sc.seed);
    let mut pool = Vec::new();
    while pool.len() < sc.pool {
        let k = rng.bytes(32);
        if k.iter().all(|b| *b == 0) || k.iter().all(|b| *b == 0xff) {
            continue;
        }
        pool.push(k);
    }
    let mut out = Vec::new();
    for i in 0..sc.ops {
        let r = rng.below(100);
        let kind = if r < 30 {
            OpKind::Insert
        } else if r < 50 {
            OpKind::InsertOrUpdate
        } else if r < 65 {
            OpKind::Update
        } else if r < 85 {
            OpKind::Lookup
        } else if r < 92 {
            OpKind::Remove
        } else {
            OpKind::RemoveIfExists
        };
        let mut key = pool[rng.below(sc.pool as u32) as usize].clone();
        let special = rng.below(64);
        if special == 0 {
            key = vec![0u8; 32]; // -inf sentinel: rejected
        } else if special == 1 {
            key.truncate(31); // wrong key length: rejected
        }
        let mut value = Vec::new();
        if kind == OpKind::Insert || kind == OpKind::Update || kind == OpKind::InsertOrUpdate {
            let mut n = match sc.value_size {
                Some(n) => n,
                None => rng.below(49) as usize,
            };
            if sc.value_length.is_some() && rng.below(50) == 0 {
                n += 1; // wrong length for a fixed-length tree: rejected
            }
            value = rng.bytes(n);
        }
        let proof_after = rng.below(3) == 0 || i + 1 == sc.ops;
        out.push(GenOp { kind, key, value, proof_after });
    }
    out
}

/// Canonical record of one operation result, hashed into the rolling hash (mirrored in TS).
fn op_record(op: &GenOp, res: &Result<Option<Vec<u8>>, basis_avl_wasm::AvlError>) -> Vec<u8> {
    let mut b = vec![op.kind as u8];
    b.extend((op.key.len() as u32).to_be_bytes());
    b.extend(&op.key);
    b.extend((op.value.len() as u32).to_be_bytes());
    b.extend(&op.value);
    match res {
        Ok(None) => b.extend(0i32.to_be_bytes()),
        Ok(Some(v)) => {
            b.extend(1i32.to_be_bytes());
            b.extend((v.len() as u32).to_be_bytes());
            b.extend(v);
        }
        Err(e) => b.extend((e.code as i32).to_be_bytes()),
    }
    b
}

fn proof_record(proof: &[u8], digest: &[u8]) -> Vec<u8> {
    let mut b = vec![0xffu8];
    b.extend((proof.len() as u32).to_be_bytes());
    b.extend(proof);
    b.extend(digest);
    b
}

fn roll(h: &mut [u8; 32], record: &[u8]) {
    let mut b = h.to_vec();
    b.extend(record);
    *h = blake2b256(&b);
}

#[test]
fn random_sequences_prover_matches_verifier_and_writes_vectors() {
    let mut full = Vec::new();
    let mut compact = Vec::new();
    for sc in scenarios() {
        let ops = generate(&sc);
        let mut p = Prover::new(32, sc.value_length).unwrap();
        let mut start_digest = p.digest();
        let mut batch: Vec<(OpKind, Vec<u8>, Vec<u8>, Option<Vec<u8>>)> = Vec::new();
        let mut rolling = [0u8; 32];
        let mut ops_json = Vec::new();
        let mut proofs_json = Vec::new();
        let mut checkpoints = Vec::new();
        let (mut ok, mut failed, mut nproofs, mut max_height) = (0usize, 0usize, 0usize, 0usize);
        for (i, op) in ops.iter().enumerate() {
            let res = p.apply(op.kind, &op.key, &op.value);
            roll(&mut rolling, &op_record(op, &res));
            ops_json.push(json!({
                "kind": op.kind as u32,
                "key": hex(&op.key),
                "value": hex(&op.value),
                "proofAfter": op.proof_after,
                "result": match &res {
                    Ok(None) => json!({"code": 0}),
                    Ok(Some(v)) => json!({"code": 1, "old": hex(v)}),
                    Err(e) => json!({"code": e.code as i32}),
                },
            }));
            match &res {
                Ok(old) => {
                    ok += 1;
                    batch.push((op.kind, op.key.clone(), op.value.clone(), old.clone()));
                }
                Err(_) => failed += 1,
            }
            if op.proof_after {
                let proof = p.generate_proof();
                let digest = p.digest();
                roll(&mut rolling, &proof_record(&proof, &digest));
                nproofs += 1;
                max_height = max_height.max(p.height());
                // replay on the verifier: same results, same digest
                let mut v = Verifier::new(&start_digest, &proof, 32, sc.value_length, None, None).unwrap();
                for (k, key, val, old) in &batch {
                    assert_eq!(&v.apply(*k, key, val).unwrap(), old, "{} op {}", sc.name, i);
                }
                assert_eq!(v.digest().unwrap(), digest, "{} proof {}", sc.name, nproofs);
                // and on the crate's own verifier
                let triples: Vec<_> = batch.iter().map(|(k, a, b, _)| (*k, a.clone(), b.clone())).collect();
                let reference = crate_verify(&start_digest, &proof, sc.value_length, &triples).unwrap();
                assert_eq!(reference.1, digest);
                // tight limits (as basis_trees uses: one op, no deletes) accept a one-op proof
                if batch.len() == 1 && !matches!(batch[0].0, OpKind::Remove | OpKind::RemoveIfExists) {
                    let mut v = Verifier::new(&start_digest, &proof, 32, sc.value_length, Some(1), Some(0)).unwrap();
                    v.apply(batch[0].0, &batch[0].1, &batch[0].2).unwrap();
                    assert_eq!(v.digest().unwrap(), digest);
                }
                proofs_json.push(json!({
                    "afterOp": i,
                    "start": hex(&start_digest),
                    "proof": hex(&proof),
                    "digest": hex(&digest),
                    "ops": batch.len(),
                }));
                batch.clear();
                start_digest = digest;
            }
            if (i + 1) % 100 == 0 {
                checkpoints.push(json!({"afterOp": i, "digest": hex(&p.digest()), "size": p.size()}));
            }
        }
        assert!(failed > 0 && ok > failed, "{}: the sequence must exercise failures too", sc.name);
        let params = json!({
            "name": sc.name,
            "seed": sc.seed,
            "keyLength": 32,
            "valueLength": sc.value_length,
            "valueSize": sc.value_size,
            "ops": sc.ops,
            "pool": sc.pool,
        });
        let summary = json!({
            "okOps": ok,
            "failedOps": failed,
            "proofs": nproofs,
            "maxHeight": max_height,
            "finalSize": p.size(),
            "finalDigest": hex(&p.digest()),
            "rollingHash": hex(&rolling),
        });
        println!("{} {}", params, summary);
        full.push(json!({"params": params, "summary": summary, "ops": ops_json, "proofs": proofs_json}));
        compact.push(json!({"params": params, "summary": summary, "checkpoints": checkpoints}));
    }
    let out = crate_dir().join("vectors");
    std::fs::write(out.join("random-full.json"), serde_json::to_string(&json!({"scenarios": full})).unwrap()).unwrap();
    std::fs::write(
        out.join("random-compact.json"),
        serde_json::to_string_pretty(&json!({
            "about": "Seeded random AVL+ sequences (xorshift32). Ops are regenerated by the test; results, proofs and digests are folded into rollingHash = blake2b256(prev || record).",
            "scenarios": compact
        }))
        .unwrap(),
    )
    .unwrap();
}

// -------------------------------------------------------------------------------------------
// 4. fork independence, malformed proofs
// -------------------------------------------------------------------------------------------

#[test]
fn fork_is_a_deep_independent_copy() {
    let mut rng = Rng(7);
    let keys: Vec<Vec<u8>> = (0..200).map(|_| rng.bytes(32)).collect();
    let vals: Vec<Vec<u8>> = (0..200).map(|_| rng.bytes(8)).collect();
    let mut p = Prover::new(32, None).unwrap();
    for i in 0..150 {
        p.apply(OpKind::Insert, &keys[i], &vals[i]).unwrap();
    }
    let _ = p.generate_proof();
    let start = p.digest();
    // pending operations in the source, then fork
    for i in 150..160 {
        p.apply(OpKind::Insert, &keys[i], &vals[i]).unwrap();
    }
    let base = p.digest();
    let mut f = p.fork();
    assert_eq!(f.digest(), base);
    assert_eq!(f.pending(), 0);
    assert_eq!(f.size(), p.size());
    assert_eq!(p.pending(), 10);
    // mutate the fork heavily: inserts, updates of shared leaves, removals
    for i in 160..200 {
        f.apply(OpKind::Insert, &keys[i], &vals[i]).unwrap();
    }
    for i in 100..130 {
        f.apply(OpKind::Update, &keys[i], &vals[i + 1]).unwrap();
    }
    for i in 0..40 {
        f.apply(OpKind::Remove, &keys[i], &[]).unwrap();
    }
    let fork_proof = f.generate_proof();
    // the source did not move and its pending proof is intact
    assert_eq!(p.digest(), base);
    assert_eq!(p.peek(&keys[100]), Some(vals[100].clone()));
    assert_eq!(p.peek(&keys[0]), Some(vals[0].clone()));
    assert_eq!(p.peek(&keys[170]), None);
    let proof = p.generate_proof();
    let mut v = Verifier::new(&start, &proof, 32, None, None, None).unwrap();
    for i in 150..160 {
        assert_eq!(v.apply(OpKind::Insert, &keys[i], &vals[i]).unwrap(), None);
    }
    assert_eq!(v.digest().unwrap(), base);
    // the fork's proof verifies from the fork point
    let mut v = Verifier::new(&base, &fork_proof, 32, None, None, None).unwrap();
    for i in 160..200 {
        v.apply(OpKind::Insert, &keys[i], &vals[i]).unwrap();
    }
    for i in 100..130 {
        assert_eq!(v.apply(OpKind::Update, &keys[i], &vals[i + 1]).unwrap(), Some(vals[i].clone()));
    }
    for i in 0..40 {
        v.apply(OpKind::Remove, &keys[i], &[]).unwrap();
    }
    assert_eq!(v.digest().unwrap(), f.digest());
    assert_eq!(f.size(), 160);
}

#[test]
fn malformed_proofs_are_rejected_without_panicking() {
    let cv = chain_vectors();
    let second = &cv["redemptions"].as_array().unwrap()[1];
    let key = debt_key(s(second, "owner"), s(second, "receiver"));
    let before = digest_from_r5(s(&second["reserveIn"], "R5"));
    let value = [be(second["timestamp"].as_u64().unwrap()), be(200_000_000)].concat();
    let good = unhex(s(second, "proof5"));
    let ops = vec![(OpKind::InsertOrUpdate, key.clone(), value.clone())];
    let mut accepted = 0;
    let mut rejected = 0;
    let quiet = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let mut variants: Vec<Vec<u8>> = Vec::new();
    for cut in 0..good.len() {
        variants.push(good[..cut].to_vec());
    }
    for i in 0..good.len() {
        for bit in [0u8, 3, 7] {
            let mut m = good.clone();
            m[i] ^= 1 << bit;
            variants.push(m);
        }
    }
    variants.push([good.clone(), vec![0u8; 3]].concat());
    for m in &variants {
        let mut v = Verifier::new(&before, m, 32, None, None, None).unwrap();
        let ours = v.apply(OpKind::InsertOrUpdate, &key, &value).ok().and_then(|_| v.digest());
        let theirs = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| crate_verify(&before, m, None, &ops)));
        match theirs {
            Ok(Some((_, d))) => assert_eq!(ours, Some(d), "agree when the crate accepts"),
            Ok(None) | Err(_) => assert_eq!(ours, None, "reject when the crate rejects or panics"),
        }
        if ours.is_some() {
            accepted += 1;
        } else {
            rejected += 1;
        }
    }
    std::panic::set_hook(quiet);
    // only trailing garbage after the directions and flips of unused direction bits survive
    assert!(rejected > accepted * 4, "accepted {} rejected {}", accepted, rejected);
}

// -------------------------------------------------------------------------------------------
// 5. crafted deep trees (an attacker who also picks the digest can describe any shape)
// -------------------------------------------------------------------------------------------

/// A degenerate "tree" `depth` levels deep: every level a pruned left subtree, one real leaf at
/// the bottom on the far right. Returns (key, value, digest, proof).
fn crafted_chain(depth: usize) -> (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) {
    let key = blake2b256(&[7u8]).to_vec();
    let value = be(42);
    let ff = vec![0xffu8; 32];
    let lefts: Vec<[u8; 32]> = (0..depth).map(|i| blake2b256(&(i as u32).to_be_bytes())).collect();
    let mut proof = Vec::with_capacity(depth * 35 + 100);
    for l in &lefts {
        proof.push(3);
        proof.extend_from_slice(l);
    }
    proof.push(2);
    proof.extend(&key);
    proof.extend(&ff);
    proof.extend(8u32.to_be_bytes());
    proof.extend(&value);
    proof.extend(std::iter::repeat(1u8).take(depth)); // internal nodes, balance +1
    proof.push(4);
    proof.extend(std::iter::repeat(0u8).take((depth + 7) / 8)); // directions: always right
    let mut label = blake2b256(&[&[0u8][..], &key, &value, &ff].concat());
    for l in lefts.iter().rev() {
        label = blake2b256(&[&[1u8, 1u8][..], &l[..], &label[..]].concat());
    }
    let mut digest = label.to_vec();
    digest.push(depth.min(255) as u8);
    (key, value, digest, proof)
}

#[test]
fn crafted_deep_trees_match_the_crate_and_never_recurse_on_build_or_drop() {
    // moderate depth: the same answer as the crate's own verifier (and the JVM)
    let (key, value, digest, proof) = crafted_chain(2000);
    let mut v = Verifier::new(&digest, &proof, 32, None, None, None).unwrap();
    assert_eq!(v.apply(OpKind::Lookup, &key, &[]).unwrap(), Some(value.clone()));
    assert_eq!(v.digest().unwrap(), digest);
    let reference = crate_verify(&digest, &proof, None, &[(OpKind::Lookup, key.clone(), vec![])]).unwrap();
    assert_eq!(reference.0[0].as_ref().unwrap(), &value);
    assert_eq!(reference.1, digest);

    // 100 000 levels on a 256 KiB stack: building, rejecting, failing and dropping are iterative
    std::thread::Builder::new()
        .stack_size(256 * 1024)
        .spawn(|| {
            let (key, _value, digest, proof) = crafted_chain(100_000);
            let v = Verifier::new(&digest, &proof, 32, None, None, None).unwrap();
            assert!(!v.failed(), "{:?}", v.error().map(|e| &e.message));
            drop(v);
            let mut wrong = digest.clone();
            wrong[0] ^= 1;
            let v = Verifier::new(&wrong, &proof, 32, None, None, None).unwrap();
            assert!(v.failed());
            let mut v = Verifier::new(&digest, &proof, 32, None, None, None).unwrap();
            assert!(v.apply(OpKind::Insert, &key[..31], &[1]).is_err()); // fails, tree torn down
            assert!(v.digest().is_none());
            let mut truncated = proof.clone();
            truncated.truncate(proof.len() - 20_000); // many partial subtrees on the stack
            assert!(Verifier::new(&digest, &truncated, 32, None, None, None).unwrap().failed());
        })
        .unwrap()
        .join()
        .unwrap();
}
