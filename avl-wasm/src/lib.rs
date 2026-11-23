//! basis-avl-wasm: the Ergo AVL+ authenticated dictionary (crates.io ergo_avltree_rust 0.1.1,
//! the implementation sigma-rust and the Basis tracker use) compiled for the browser.
//!
//! * `engine`  - safe Rust API (Prover, Verifier), shared by wasm and native tests
//! * `safe_verifier` - the crate's BatchAVLVerifier with bounds-checked proof parsing
//! * `ffi`     - the C ABI exported from avl.wasm (see README in the app folder)

extern crate alloc;

pub mod engine;
pub mod ffi;
pub mod safe_verifier;

pub use engine::{blake2b256, empty_digest, AvlError, ErrorCode, OpKind, Prover, Verifier};
