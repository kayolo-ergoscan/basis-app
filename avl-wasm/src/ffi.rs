//! C ABI for the browser (hand-written TS glue, no wasm-bindgen).
//!
//! Conventions
//! * Inputs: JS asks for a scratch buffer (`avl_scratch(len)` -> ptr; or owns one with
//!   `avl_alloc` / `avl_dealloc`), writes bytes there and
//!   passes (ptr, len) pairs that point into it. Rust copies what it keeps.
//! * Outputs: variable-length results go to one OUT buffer, read with `avl_out_ptr()` /
//!   `avl_out_len()` right after the call (valid until the next call).
//! * Return values: i32. >= 0 success (meaning per function), < 0 an `ErrorCode` with a UTF-8
//!   message in OUT.
//! * Handles: provers and verifiers live in slabs; a handle is index + 1.
//! * A Rust panic is a wasm trap. The panic message is kept and can be read with
//!   `avl_panic_ptr()` / `avl_panic_len()`; the TS glue then discards the instance.

use alloc::boxed::Box;
use alloc::string::ToString;
use alloc::vec::Vec;
use core::cell::RefCell;

use crate::engine::{self, AvlError, ErrorCode, OpKind, Prover, Verifier};

pub const ABI_VERSION: i32 = 1;

struct State {
    out: Vec<u8>,
    provers: Vec<Option<Box<Prover>>>,
    verifiers: Vec<Option<Box<Verifier>>>,
}

std::thread_local! {
    static STATE: RefCell<State> = const { RefCell::new(State { out: Vec::new(), provers: Vec::new(), verifiers: Vec::new() }) };
    static SCRATCH: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    static PANIC_MSG: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

fn with_state<R>(f: impl FnOnce(&mut State) -> R) -> R {
    STATE.with(|s| f(&mut s.borrow_mut()))
}

fn input<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    if len == 0 || ptr.is_null() {
        &[]
    } else {
        // SAFETY: JS passes a region it obtained from avl_scratch (or avl_alloc) of >= len bytes.
        unsafe { core::slice::from_raw_parts(ptr, len) }
    }
}

fn set_out(s: &mut State, bytes: &[u8]) {
    s.out.clear();
    s.out.extend_from_slice(bytes);
}

fn fail(s: &mut State, e: AvlError) -> i32 {
    set_out(s, e.message.as_bytes());
    e.code as i32
}

fn bad_handle(s: &mut State) -> i32 {
    fail(s, AvlError::new(ErrorCode::BadHandle, "unknown or freed handle"))
}

fn value_length_arg(v: i32) -> Option<usize> {
    if v < 0 {
        None
    } else {
        Some(v as usize)
    }
}

fn limit_arg(v: i32) -> Option<usize> {
    if v < 0 {
        None
    } else {
        Some(v as usize)
    }
}

fn slab_put<T>(slab: &mut Vec<Option<Box<T>>>, item: T) -> i32 {
    if let Some(i) = slab.iter().position(|x| x.is_none()) {
        slab[i] = Some(Box::new(item));
        (i + 1) as i32
    } else {
        slab.push(Some(Box::new(item)));
        slab.len() as i32
    }
}

fn slab_get<T>(slab: &mut [Option<Box<T>>], h: u32) -> Option<&mut T> {
    if h == 0 {
        return None;
    }
    slab.get_mut(h as usize - 1).and_then(|x| x.as_deref_mut())
}

/// Result of an operation: 0 = key was absent, 1 = key was present (old value in OUT).
fn op_result(s: &mut State, r: Result<Option<Vec<u8>>, AvlError>) -> i32 {
    match r {
        Ok(None) => {
            s.out.clear();
            0
        }
        Ok(Some(v)) => {
            set_out(s, &v);
            1
        }
        Err(e) => fail(s, e),
    }
}

// --- runtime ----------------------------------------------------------------------------------

/// Call once after instantiation. Installs the panic hook. Returns the ABI version.
#[no_mangle]
pub extern "C" fn avl_init() -> i32 {
    std::panic::set_hook(Box::new(|info| {
        let msg = info.to_string();
        let _ = PANIC_MSG.try_with(|m| {
            if let Ok(mut m) = m.try_borrow_mut() {
                m.clear();
                m.extend_from_slice(msg.as_bytes());
            }
        });
    }));
    ABI_VERSION
}

/// Ensures the scratch input buffer holds at least `len` bytes and returns its address.
/// The address can change between calls (re-read it every time).
#[no_mangle]
pub extern "C" fn avl_scratch(len: usize) -> *mut u8 {
    SCRATCH.with(|b| {
        let mut b = b.borrow_mut();
        if b.len() < len {
            b.resize(len, 0);
        }
        b.as_mut_ptr()
    })
}

/// Allocates `len` bytes in the wasm memory for the caller, for inputs that must outlive the
/// next call (the scratch buffer is simpler otherwise). 0 when out of memory. Release with
/// `avl_dealloc(ptr, len)`.
#[no_mangle]
pub extern "C" fn avl_alloc(len: usize) -> *mut u8 {
    match core::alloc::Layout::from_size_align(len.max(1), 1) {
        // SAFETY: the layout has a non-zero size
        Ok(layout) => unsafe { alloc::alloc::alloc(layout) },
        Err(_) => core::ptr::null_mut(),
    }
}

/// Frees a buffer returned by `avl_alloc` (pass the same `len`).
///
/// # Safety
/// `ptr` must come from `avl_alloc(len)` and not have been freed already.
#[no_mangle]
pub unsafe extern "C" fn avl_dealloc(ptr: *mut u8, len: usize) {
    if ptr.is_null() {
        return;
    }
    if let Ok(layout) = core::alloc::Layout::from_size_align(len.max(1), 1) {
        alloc::alloc::dealloc(ptr, layout);
    }
}

#[no_mangle]
pub extern "C" fn avl_out_ptr() -> *const u8 {
    with_state(|s| s.out.as_ptr())
}

#[no_mangle]
pub extern "C" fn avl_out_len() -> usize {
    with_state(|s| s.out.len())
}

#[no_mangle]
pub extern "C" fn avl_panic_ptr() -> *const u8 {
    PANIC_MSG.with(|m| m.borrow().as_ptr())
}

#[no_mangle]
pub extern "C" fn avl_panic_len() -> usize {
    PANIC_MSG.with(|m| m.borrow().len())
}

/// Version string -> OUT. Returns its length.
#[no_mangle]
pub extern "C" fn avl_version() -> i32 {
    with_state(|s| {
        let v = engine::version_string();
        set_out(s, v.as_bytes());
        v.len() as i32
    })
}

/// blake2b256(data) -> OUT (32 bytes). Returns 32.
#[no_mangle]
pub extern "C" fn avl_blake2b256(ptr: *const u8, len: usize) -> i32 {
    let h = engine::blake2b256(input(ptr, len));
    with_state(|s| {
        set_out(s, &h);
        32
    })
}

/// Digest of an empty tree -> OUT (33 bytes). value_len < 0 = variable length values.
#[no_mangle]
pub extern "C" fn avl_empty_digest(key_len: u32, value_len: i32) -> i32 {
    with_state(|s| match engine::empty_digest(key_len as usize, value_length_arg(value_len)) {
        Ok(d) => {
            set_out(s, &d);
            d.len() as i32
        }
        Err(e) => fail(s, e),
    })
}

// --- prover -----------------------------------------------------------------------------------

/// New empty prover. Returns a handle (> 0) or an error code.
#[no_mangle]
pub extern "C" fn avl_prover_new(key_len: u32, value_len: i32) -> i32 {
    with_state(|s| match Prover::new(key_len as usize, value_length_arg(value_len)) {
        Ok(p) => slab_put(&mut s.provers, p),
        Err(e) => fail(s, e),
    })
}

#[no_mangle]
pub extern "C" fn avl_prover_free(h: u32) -> i32 {
    with_state(|s| {
        if h == 0 || h as usize > s.provers.len() || s.provers[h as usize - 1].is_none() {
            return bad_handle(s);
        }
        s.provers[h as usize - 1] = None;
        0
    })
}

/// One authenticated operation (kind: 0 lookup, 1 insert, 2 update, 3 insertOrUpdate,
/// 4 remove, 5 removeIfExists). 0 = key was absent, 1 = present (old value in OUT), < 0 error.
#[no_mangle]
pub extern "C" fn avl_prover_op(
    h: u32,
    kind: u32,
    key_ptr: *const u8,
    key_len: usize,
    val_ptr: *const u8,
    val_len: usize,
) -> i32 {
    let key = input(key_ptr, key_len).to_vec();
    let val = input(val_ptr, val_len).to_vec();
    with_state(|s| {
        let kind = match OpKind::from_u32(kind) {
            Some(k) => k,
            None => return fail(s, AvlError::new(ErrorCode::BadArgument, "unknown operation kind")),
        };
        let r = match slab_get(&mut s.provers, h) {
            Some(p) => p.apply(kind, &key, &val),
            None => return bad_handle(s),
        };
        op_result(s, r)
    })
}

/// Unauthenticated lookup (no proof effect): 0 absent, 1 present (value in OUT).
#[no_mangle]
pub extern "C" fn avl_prover_peek(h: u32, key_ptr: *const u8, key_len: usize) -> i32 {
    let key = input(key_ptr, key_len).to_vec();
    with_state(|s| {
        let r = match slab_get(&mut s.provers, h) {
            Some(p) => p.peek(&key),
            None => return bad_handle(s),
        };
        op_result(s, Ok(r))
    })
}

/// Current digest -> OUT (33 bytes). Returns 33.
#[no_mangle]
pub extern "C" fn avl_prover_digest(h: u32) -> i32 {
    with_state(|s| {
        let d = match slab_get(&mut s.provers, h) {
            Some(p) => p.digest(),
            None => return bad_handle(s),
        };
        set_out(s, &d);
        d.len() as i32
    })
}

/// Proof for the operations since the last proof -> OUT. Returns its length.
#[no_mangle]
pub extern "C" fn avl_prover_proof(h: u32) -> i32 {
    with_state(|s| {
        let proof = match slab_get(&mut s.provers, h) {
            Some(p) => p.generate_proof(),
            None => return bad_handle(s),
        };
        set_out(s, &proof);
        proof.len() as i32
    })
}

/// Deep copy of the current tree with a clean proof state. Returns the new handle.
#[no_mangle]
pub extern "C" fn avl_prover_fork(h: u32) -> i32 {
    with_state(|s| {
        let copy = match slab_get(&mut s.provers, h) {
            Some(p) => p.fork(),
            None => return bad_handle(s),
        };
        slab_put(&mut s.provers, copy)
    })
}

/// [size u32][pending u32][height u32][key_len u32][value_len i32] -> OUT. Returns 20.
#[no_mangle]
pub extern "C" fn avl_prover_info(h: u32) -> i32 {
    with_state(|s| {
        let info = match slab_get(&mut s.provers, h) {
            Some(p) => {
                let mut b = Vec::with_capacity(20);
                b.extend_from_slice(&(p.size() as u32).to_be_bytes());
                b.extend_from_slice(&(p.pending() as u32).to_be_bytes());
                b.extend_from_slice(&(p.height() as u32).to_be_bytes());
                b.extend_from_slice(&(p.key_length() as u32).to_be_bytes());
                b.extend_from_slice(&(p.value_length().map(|v| v as i32).unwrap_or(-1)).to_be_bytes());
                b
            }
            None => return bad_handle(s),
        };
        set_out(s, &info);
        20
    })
}

/// Pre-order dump of the tree (see engine::Prover::dump) -> OUT. Returns its length.
#[no_mangle]
pub extern "C" fn avl_prover_dump(h: u32) -> i32 {
    with_state(|s| {
        let d = match slab_get(&mut s.provers, h) {
            Some(p) => p.dump(),
            None => return bad_handle(s),
        };
        set_out(s, &d);
        d.len() as i32
    })
}

// --- verifier ---------------------------------------------------------------------------------

/// New verifier replaying `proof` from `digest` (33 bytes). max_ops / max_deletes < 0 = no
/// limit (what sigma's AvlTree methods use). Returns a handle; a bad proof gives a handle in
/// the failed state (see avl_verifier_digest), bad arguments give an error code.
#[no_mangle]
pub extern "C" fn avl_verifier_new(
    digest_ptr: *const u8,
    digest_len: usize,
    proof_ptr: *const u8,
    proof_len: usize,
    key_len: u32,
    value_len: i32,
    max_ops: i32,
    max_deletes: i32,
) -> i32 {
    let digest = input(digest_ptr, digest_len).to_vec();
    let proof = input(proof_ptr, proof_len).to_vec();
    with_state(|s| {
        match Verifier::new(
            &digest,
            &proof,
            key_len as usize,
            value_length_arg(value_len),
            limit_arg(max_ops),
            limit_arg(max_deletes),
        ) {
            Ok(v) => slab_put(&mut s.verifiers, v),
            Err(e) => fail(s, e),
        }
    })
}

#[no_mangle]
pub extern "C" fn avl_verifier_free(h: u32) -> i32 {
    with_state(|s| {
        if h == 0 || h as usize > s.verifiers.len() || s.verifiers[h as usize - 1].is_none() {
            return bad_handle(s);
        }
        s.verifiers[h as usize - 1] = None;
        0
    })
}

/// Same as avl_prover_op, replayed on the verifier.
#[no_mangle]
pub extern "C" fn avl_verifier_op(
    h: u32,
    kind: u32,
    key_ptr: *const u8,
    key_len: usize,
    val_ptr: *const u8,
    val_len: usize,
) -> i32 {
    let key = input(key_ptr, key_len).to_vec();
    let val = input(val_ptr, val_len).to_vec();
    with_state(|s| {
        let kind = match OpKind::from_u32(kind) {
            Some(k) => k,
            None => return fail(s, AvlError::new(ErrorCode::BadArgument, "unknown operation kind")),
        };
        let r = match slab_get(&mut s.verifiers, h) {
            Some(v) => v.apply(kind, &key, &val),
            None => return bad_handle(s),
        };
        op_result(s, r)
    })
}

/// Digest after the replayed operations -> OUT (33 bytes), or VerifierFailed (message in OUT).
#[no_mangle]
pub extern "C" fn avl_verifier_digest(h: u32) -> i32 {
    with_state(|s| {
        let (d, err) = match slab_get(&mut s.verifiers, h) {
            Some(v) => (v.digest(), v.error().cloned()),
            None => return bad_handle(s),
        };
        match d {
            Some(d) => {
                set_out(s, &d);
                d.len() as i32
            }
            None => fail(
                s,
                AvlError::new(
                    ErrorCode::VerifierFailed,
                    err.map(|e| e.message).unwrap_or_else(|| "verifier failed".to_string()),
                ),
            ),
        }
    })
}

/// Number of live provers and verifiers (leak check): (provers << 16) | verifiers.
#[no_mangle]
pub extern "C" fn avl_live_handles() -> i32 {
    with_state(|s| {
        let p = s.provers.iter().filter(|x| x.is_some()).count() as i32;
        let v = s.verifiers.iter().filter(|x| x.is_some()).count() as i32;
        (p.min(0x7fff) << 16) | v.min(0xffff)
    })
}
