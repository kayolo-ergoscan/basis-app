//! One-off recovery of note timestamps from on-chain reserve digests (run with --ignored).
//!
//! Some public mainnet redemptions are documented (keys, amounts) but the payment timestamp
//! (context var #4) is not available to us. For a one-key reserve tree the digest is
//!   root = H(01 || 00 || H(00 || 00^32 || "" || K) || H(00 || K || ts || redeemed || ff^32)) || 01
//! so the timestamp can be recovered by search. A hit is a 256-bit hash match: it confirms the
//! value encoding and gives a real vector for the update (insertOrUpdate on an existing key) path.
use basis_avl_wasm::engine::blake2b256;

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len()).step_by(2).map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap()).collect()
}

fn key(a: &str, b: &str) -> Vec<u8> {
    let mut v = unhex(a);
    v.extend(unhex(b));
    blake2b256(&v).to_vec()
}

fn search(k: &[u8], amount: u64, from: u64, to: u64, want: &str) -> Option<u64> {
    let want = unhex(want);
    assert_eq!(want.len(), 33);
    assert_eq!(want[32], 1, "only one-key trees (height 1)");
    let mut inf = vec![0u8];
    inf.extend(vec![0u8; 32]);
    inf.extend(k);
    let l_inf = blake2b256(&inf);
    let mut leaf = vec![0u8];
    leaf.extend(k);
    leaf.extend(0u64.to_be_bytes());
    leaf.extend(amount.to_be_bytes());
    leaf.extend(vec![0xffu8; 32]);
    let ts_at = 1 + 32;
    let mut root = vec![1u8, 0u8];
    root.extend(l_inf);
    root.extend([0u8; 32]);
    for ts in from..=to {
        leaf[ts_at..ts_at + 8].copy_from_slice(&ts.to_be_bytes());
        let l = blake2b256(&leaf);
        root[34..66].copy_from_slice(&l);
        let r = blake2b256(&root);
        if r[..] == want[..32] {
            return Some(ts);
        }
    }
    None
}

#[test]
#[ignore]
fn recover_ninth_test_second_redemption_timestamp() {
    let k9 = key(
        "022880fde8cace85c2c810fb32c5441a32198b0f7a122b9a672cfb7e50eb898cdc",
        "03dbc83fe0c803d370575d2a513247b741f2fe4fe45756cd9983ce087d788697a7",
    );
    // self-check of the formula on the known first redemption (ts from the tracker report)
    let first = search(
        &k9,
        100_000_000,
        1784494415054,
        1784494415054,
        "f91e7e764bd5cd630eb53d582a72a2f2bdaa1ca1459b2f6d79680bc8b1a32ebd01",
    );
    assert_eq!(first, Some(1784494415054));
    // second redemption (tx cfcd8579..., box 3ae59d54...): cumulative 0.2 ERG, ts between the
    // original payment and the block that included it
    let t0 = std::time::Instant::now();
    let second = search(
        &k9,
        200_000_000,
        1784494415054,
        1784538845549,
        "d077c133e112d2d124a44ce9823308648007b6e442f7051c255ff9eb6dea15cf01",
    );
    println!("second redemption ts = {:?} ({:?})", second, t0.elapsed());
}

#[test]
#[ignore]
fn recover_third_test_note_timestamp() {
    let kab = key(
        "0377709166937fcdc08bf7e841b31684e2377f489914c97ef7148de14d9c6e1f83",
        "03af13e39dd0ccc7429f9dfa5a056b71a8f5160eaf179763a03e0b55d8feec2cea",
    );
    // box 95cac238... (tx 96c55b39..., h 1825612): first redemption of 0.2 ERG of a 0.4 ERG note
    let from: u64 = std::env::var("FROM").ok().and_then(|s| s.parse().ok()).unwrap_or(1783700000000);
    let to: u64 = std::env::var("TO").ok().and_then(|s| s.parse().ok()).unwrap_or(1783760000000);
    let t0 = std::time::Instant::now();
    let ts = search(
        &kab,
        200_000_000,
        from,
        to,
        "c6db7c180c70664a4d71c8dd3c43ec47842e7d691d8e399753a793d32a4318b301",
    );
    println!("third test note ts = {:?} ({:?})", ts, t0.elapsed());
}
