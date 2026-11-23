//! Safe Rust API over ergo_avltree_rust 0.1.1, shared by the wasm ABI (ffi.rs) and the native
//! tests. Mirrors how basis-tracker's `basis_trees` drives the prover (AVLTree::new(.., 32,
//! None), BatchAVLProver, Insert / Update / InsertOrUpdate / Lookup, generate_proof, digest)
//! and how sigma's AvlTree methods drive the verifier (BatchAVLVerifier, no operation limits).

use alloc::format;
use alloc::rc::Rc;
use alloc::string::{String, ToString};
use alloc::vec::Vec;
use bytes::Bytes;
use core::cell::RefCell;
use ergo_avltree_rust::authenticated_tree_ops::AuthenticatedTreeOps;
use ergo_avltree_rust::batch_avl_prover::BatchAVLProver;
use ergo_avltree_rust::batch_node::{AVLTree, InternalNode, LeafNode, Node, NodeHeader, NodeId};
use ergo_avltree_rust::operation::{KeyValue, Operation};

use crate::safe_verifier::{label_only_resolver, SafeVerifier};

pub const DIGEST_SIZE: usize = 33;

/// Operation kinds as passed over the ABI (and used in test vectors).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u32)]
pub enum OpKind {
    Lookup = 0,
    Insert = 1,
    Update = 2,
    InsertOrUpdate = 3,
    Remove = 4,
    RemoveIfExists = 5,
}

impl OpKind {
    pub fn from_u32(k: u32) -> Option<OpKind> {
        Some(match k {
            0 => OpKind::Lookup,
            1 => OpKind::Insert,
            2 => OpKind::Update,
            3 => OpKind::InsertOrUpdate,
            4 => OpKind::Remove,
            5 => OpKind::RemoveIfExists,
            _ => return None,
        })
    }
    pub fn name(self) -> &'static str {
        match self {
            OpKind::Lookup => "lookup",
            OpKind::Insert => "insert",
            OpKind::Update => "update",
            OpKind::InsertOrUpdate => "insertOrUpdate",
            OpKind::Remove => "remove",
            OpKind::RemoveIfExists => "removeIfExists",
        }
    }
    pub fn has_value(self) -> bool {
        matches!(self, OpKind::Insert | OpKind::Update | OpKind::InsertOrUpdate)
    }
}

/// Error classes, also the negative return codes of the ABI.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(i32)]
pub enum ErrorCode {
    BadHandle = -1,
    BadArgument = -2,
    KeyExists = -3,
    KeyMissing = -4,
    ProofInvalid = -5,
    VerifierFailed = -6,
    KeyOutOfRange = -7,
    Internal = -8,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AvlError {
    pub code: ErrorCode,
    pub message: String,
}

impl AvlError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> AvlError {
        AvlError { code, message: message.into() }
    }
}

pub type AvlResult<T> = core::result::Result<T, AvlError>;

fn hex(b: &[u8]) -> String {
    const H: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(b.len() * 2);
    for x in b {
        s.push(H[(x >> 4) as usize] as char);
        s.push(H[(x & 15) as usize] as char);
    }
    s
}

fn build_operation(kind: OpKind, key: &[u8], value: &[u8]) -> Operation {
    let key = Bytes::copy_from_slice(key);
    let kv = || KeyValue { key: key.clone(), value: Bytes::copy_from_slice(value) };
    match kind {
        OpKind::Lookup => Operation::Lookup(key.clone()),
        OpKind::Insert => Operation::Insert(kv()),
        OpKind::Update => Operation::Update(kv()),
        OpKind::InsertOrUpdate => Operation::InsertOrUpdate(kv()),
        OpKind::Remove => Operation::Remove(key.clone()),
        OpKind::RemoveIfExists => Operation::RemoveIfExists(key.clone()),
    }
}

/// Checks done before handing an operation to the crate. Every one of them is a case in which
/// the crate (and the JVM) would fail the operation too; doing it here gives a readable error
/// and avoids the crate's `assert!` on fixed value lengths (a wasm trap).
fn precheck(
    kind: OpKind,
    key: &[u8],
    value: &[u8],
    key_length: usize,
    value_length: Option<usize>,
) -> AvlResult<()> {
    if key.len() != key_length {
        return Err(AvlError::new(
            ErrorCode::BadArgument,
            format!("key must be {} bytes, got {}", key_length, key.len()),
        ));
    }
    if key.iter().all(|b| *b == 0) {
        return Err(AvlError::new(
            ErrorCode::KeyOutOfRange,
            "key 00..00 is the tree's -infinity sentinel and cannot be used",
        ));
    }
    if key.iter().all(|b| *b == 0xff) {
        return Err(AvlError::new(
            ErrorCode::KeyOutOfRange,
            "key ff..ff is the tree's +infinity sentinel and cannot be used",
        ));
    }
    if kind.has_value() {
        if let Some(vl) = value_length {
            if value.len() != vl {
                return Err(AvlError::new(
                    ErrorCode::BadArgument,
                    format!("value must be {} bytes in this tree, got {}", vl, value.len()),
                ));
            }
        }
        if value.len() > u32::MAX as usize {
            return Err(AvlError::new(ErrorCode::BadArgument, "value too long"));
        }
    }
    Ok(())
}

/// Maps a crate error (anyhow) to an error class. The crate's messages (pinned 0.1.1):
/// "Key .. already exists", "Key .. does not exists", "Should never reach this point..",
/// ensure!-failures from key_matches_leaf, our SafeVerifier messages.
fn classify(kind: OpKind, key: &[u8], err: &anyhow::Error, in_verifier: bool) -> AvlError {
    let msg = err.to_string();
    if msg.contains("already exists") {
        return AvlError::new(ErrorCode::KeyExists, format!("{}: key {} already exists", kind.name(), hex(key)));
    }
    if msg.contains("does not exist") {
        return AvlError::new(ErrorCode::KeyMissing, format!("{}: key {} does not exist", kind.name(), hex(key)));
    }
    if in_verifier {
        return AvlError::new(ErrorCode::ProofInvalid, format!("{}: proof rejected ({})", kind.name(), msg));
    }
    AvlError::new(ErrorCode::Internal, format!("{}: {}", kind.name(), msg))
}

fn digest_vec(d: Option<Bytes>) -> Option<Vec<u8>> {
    d.map(|b| b.to_vec())
}

// ---------------------------------------------------------------------------------------------
// Prover
// ---------------------------------------------------------------------------------------------

pub struct Prover {
    inner: BatchAVLProver,
    key_length: usize,
    value_length: Option<usize>,
    size: usize,
    pending: usize,
}

impl Prover {
    /// Empty tree. `value_length` None = variable length values (what Basis uses for both the
    /// tracker tree, key -> totalDebt (8 bytes), and the reserve tree, key -> ts||redeemed
    /// (16 bytes)).
    pub fn new(key_length: usize, value_length: Option<usize>) -> AvlResult<Prover> {
        if key_length == 0 || key_length > 255 {
            return Err(AvlError::new(ErrorCode::BadArgument, "key length must be 1..=255"));
        }
        if let Some(vl) = value_length {
            if vl > (1 << 24) {
                return Err(AvlError::new(ErrorCode::BadArgument, "value length too large"));
            }
        }
        let tree = AVLTree::new(label_only_resolver, key_length, value_length);
        // collect_changed_nodes only feeds removed_nodes() (persistent storage); it has no
        // effect on digests or proofs, so we keep it off to save memory.
        let inner = BatchAVLProver::new(tree, false);
        Ok(Prover { inner, key_length, value_length, size: 0, pending: 0 })
    }

    pub fn key_length(&self) -> usize {
        self.key_length
    }
    pub fn value_length(&self) -> Option<usize> {
        self.value_length
    }
    /// Number of keys (sentinels excluded).
    pub fn size(&self) -> usize {
        self.size
    }
    /// Successful operations performed since the last generate_proof().
    pub fn pending(&self) -> usize {
        self.pending
    }
    pub fn height(&self) -> usize {
        self.inner.base.tree.height
    }

    /// 33 bytes: root label (32) followed by the tree height (1).
    pub fn digest(&self) -> Vec<u8> {
        digest_vec(self.inner.digest()).expect("prover always has a root")
    }

    /// Performs one authenticated operation. Ok(Some(old value)) / Ok(None) like the crate;
    /// a failed operation leaves the tree and the pending proof unchanged.
    pub fn apply(&mut self, kind: OpKind, key: &[u8], value: &[u8]) -> AvlResult<Option<Vec<u8>>> {
        precheck(kind, key, value, self.key_length, self.value_length)?;
        let op = build_operation(kind, key, value);
        match self.inner.perform_one_operation(&op) {
            Ok(old) => {
                match kind {
                    OpKind::Insert => self.size += 1,
                    OpKind::InsertOrUpdate if old.is_none() => self.size += 1,
                    OpKind::Remove => self.size -= 1,
                    OpKind::RemoveIfExists if old.is_some() => self.size -= 1,
                    _ => {}
                }
                self.pending += 1;
                Ok(old.map(|b| b.to_vec()))
            }
            Err(e) => Err(classify(kind, key, &e, false)),
        }
    }

    /// Proof for all successful operations since the previous call (the crate's
    /// generate_proof). Starts a new batch.
    pub fn generate_proof(&mut self) -> Vec<u8> {
        self.pending = 0;
        self.inner.generate_proof().to_vec()
    }

    /// Unauthenticated lookup: no effect on proofs.
    pub fn peek(&self, key: &[u8]) -> Option<Vec<u8>> {
        if key.len() != self.key_length {
            return None;
        }
        self.inner
            .unauthenticated_lookup(&Bytes::copy_from_slice(key))
            .map(|b| b.to_vec())
    }

    /// Independent deep copy of the CURRENT tree (pending operations included), with a clean
    /// proof state: the copy's next proof starts from this prover's current digest.
    /// (AVLTree::clone() is shallow - Rc<RefCell<Node>> - and must not be used for this.)
    pub fn fork(&self) -> Prover {
        let src = &self.inner.base.tree;
        let root = src.root.as_ref().map(deep_copy);
        let tree = AVLTree {
            root,
            height: src.height,
            key_length: src.key_length,
            value_length: src.value_length,
            resolver: label_only_resolver,
        };
        let inner = BatchAVLProver::new(tree, false);
        Prover {
            inner,
            key_length: self.key_length,
            value_length: self.value_length,
            size: self.size,
            pending: 0,
        }
    }

    /// Pre-order dump of the whole tree, for visualisation:
    ///   internal: 0x01, balance (i8), key (key_length), label (32)
    ///   leaf:     0x00, key (key_length), value length (u32 BE), value, next key, label (32)
    pub fn dump(&self) -> Vec<u8> {
        let mut out = Vec::new();
        if let Some(root) = &self.inner.base.tree.root {
            dump_node(root, &mut out);
        }
        out
    }
}

fn clean_header(h: &NodeHeader) -> NodeHeader {
    NodeHeader { visited: false, is_new: false, label: h.label, key: h.key.clone() }
}

fn deep_copy(node: &NodeId) -> NodeId {
    let n = node.borrow();
    let copy = match &*n {
        Node::Internal(i) => Node::Internal(InternalNode {
            hdr: clean_header(&i.hdr),
            balance: i.balance,
            left: deep_copy(&i.left),
            right: deep_copy(&i.right),
        }),
        Node::Leaf(l) => Node::Leaf(LeafNode {
            hdr: clean_header(&l.hdr),
            value: l.value.clone(),
            next_node_key: l.next_node_key.clone(),
        }),
        Node::LabelOnly(h) => Node::LabelOnly(clean_header(h)),
    };
    Rc::new(RefCell::new(copy))
}

fn dump_node(node: &NodeId, out: &mut Vec<u8>) {
    let label = node.borrow_mut().label();
    // Holding a shared borrow of this node while recursing is fine: children are other cells.
    let n = node.borrow();
    match &*n {
        Node::Internal(i) => {
            out.push(1);
            out.push(i.balance as u8);
            out.extend_from_slice(i.hdr.key.as_ref().map(|k| &k[..]).unwrap_or(&[]));
            out.extend_from_slice(&label);
            dump_node(&i.left, out);
            dump_node(&i.right, out);
        }
        Node::Leaf(l) => {
            out.push(0);
            out.extend_from_slice(l.hdr.key.as_ref().map(|k| &k[..]).unwrap_or(&[]));
            out.extend_from_slice(&(l.value.len() as u32).to_be_bytes());
            out.extend_from_slice(&l.value);
            out.extend_from_slice(&l.next_node_key);
            out.extend_from_slice(&label);
        }
        Node::LabelOnly(_) => {
            out.push(2);
            out.extend_from_slice(&label);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Verifier
// ---------------------------------------------------------------------------------------------

pub struct Verifier {
    inner: Option<SafeVerifier>,
    key_length: usize,
    value_length: Option<usize>,
    /// why the verifier failed (construction or an operation); None while healthy
    error: Option<AvlError>,
}

impl Verifier {
    /// Replays `proof` against `starting_digest`. Never fails for a bad proof: the verifier
    /// then starts in the failed state (as the JVM's does: digest None, all operations fail).
    pub fn new(
        starting_digest: &[u8],
        proof: &[u8],
        key_length: usize,
        value_length: Option<usize>,
        max_num_operations: Option<usize>,
        max_deletes: Option<usize>,
    ) -> AvlResult<Verifier> {
        if key_length == 0 || key_length > 255 {
            return Err(AvlError::new(ErrorCode::BadArgument, "key length must be 1..=255"));
        }
        if starting_digest.len() != DIGEST_SIZE {
            return Err(AvlError::new(ErrorCode::BadArgument, "starting digest must be 33 bytes"));
        }
        match SafeVerifier::new(starting_digest, proof, key_length, value_length, max_num_operations, max_deletes) {
            Ok(v) => Ok(Verifier { inner: Some(v), key_length, value_length, error: None }),
            Err(e) => Ok(Verifier {
                inner: None,
                key_length,
                value_length,
                error: Some(AvlError::new(ErrorCode::ProofInvalid, e.to_string())),
            }),
        }
    }

    pub fn failed(&self) -> bool {
        self.error.is_some()
    }

    pub fn error(&self) -> Option<&AvlError> {
        self.error.as_ref()
    }

    pub fn apply(&mut self, kind: OpKind, key: &[u8], value: &[u8]) -> AvlResult<Option<Vec<u8>>> {
        if let Some(e) = &self.error {
            return Err(AvlError::new(
                ErrorCode::VerifierFailed,
                format!("verifier already failed: {}", e.message),
            ));
        }
        let res = match precheck(kind, key, value, self.key_length, self.value_length) {
            Err(e) => Err(e),
            Ok(()) => {
                let op = build_operation(kind, key, value);
                let v = self.inner.as_mut().expect("healthy verifier has a tree");
                v.perform_one_operation(&op).map_err(|e| classify(kind, key, &e, true))
            }
        };
        match res {
            Ok(old) => Ok(old.map(|b| b.to_vec())),
            Err(e) => {
                // a failed operation kills the verifier (JVM: topNode = null)
                self.inner = None;
                self.error = Some(e.clone());
                Err(e)
            }
        }
    }

    /// Digest after the operations replayed so far; None once the verifier failed.
    pub fn digest(&self) -> Option<Vec<u8>> {
        if self.error.is_some() {
            return None;
        }
        self.inner.as_ref().and_then(|v| digest_vec(v.digest()))
    }
}

/// Digest of an empty tree (the -infinity leaf alone).
pub fn empty_digest(key_length: usize, value_length: Option<usize>) -> AvlResult<Vec<u8>> {
    Ok(Prover::new(key_length, value_length)?.digest())
}

pub fn blake2b256(data: &[u8]) -> [u8; 32] {
    use blake2::digest::Digest;
    let mut h = ergo_avltree_rust::batch_node::Blake2b256::new();
    h.update(data);
    let mut out = [0u8; 32];
    out.copy_from_slice(&h.finalize());
    out
}

pub fn version_string() -> String {
    "basis-avl-wasm 0.1.0; ergo_avltree_rust 0.1.1 (crates.io); blake2b256; abi 1".to_string()
}
