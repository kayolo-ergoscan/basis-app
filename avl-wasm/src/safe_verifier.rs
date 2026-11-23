//! A bounds-checked copy of `ergo_avltree_rust::batch_avl_verifier::BatchAVLVerifier`.
//!
//! Only the proof *parsing* (reconstruct_tree) and the three direction-reading hooks are
//! re-implemented here, line for line with the crate (and with JVM scrypto's
//! `BatchAVLVerifier`). The AVL algorithm itself (modify_helper, delete_helper, rotations,
//! labels) is the crate's own `AuthenticatedTreeOps` default code.
//!
//! Why: the crate indexes the proof with `proof[i]` and `stack.pop().unwrap()`. A malformed or
//! truncated proof therefore panics, which in wasm32 is an `unreachable` trap that can leave
//! the module in an undefined state. The JVM verifier turns the same inputs into a `Failure`.
//! Here every out-of-range read is an `Err`, so a bad proof is just "proof rejected".
//!
//! Semantics are unchanged for every proof the crate (or the JVM) can parse:
//! same tree, same directions bits, same digest, same results.

use alloc::rc::Rc;
use alloc::vec::Vec;
use anyhow::{anyhow, bail, ensure, Result};
use bytes::Bytes;
use ergo_avltree_rust::authenticated_tree_ops::{AuthenticatedTreeOps, AuthenticatedTreeOpsBase};
use ergo_avltree_rust::batch_node::{AVLTree, InternalNode, LeafNode, Node, NodeHeader, NodeId};
use ergo_avltree_rust::operation::{ADDigest, ADKey, ADValue, Digest32, Operation, DIGEST_LENGTH};

// Same constants as ergo_avltree_rust::batch_node (they are pub(crate) there).
const LEAF_IN_PACKAGED_PROOF: u8 = 2;
const LABEL_IN_PACKAGED_PROOF: u8 = 3;
const END_OF_TREE_IN_PACKAGED_PROOF: u8 = 4;

/// The resolver sigma-rust uses: a pruned subtree stays a label. (basis_trees passes a
/// resolver that fabricates a dummy *leaf*; in a verifier that silently replaces sibling
/// labels and produces a wrong digest after any modification.)
pub fn label_only_resolver(digest: &Digest32) -> Node {
    Node::LabelOnly(NodeHeader::new(Some(*digest), None))
}

/// Drops a tree without recursion. Rust drops nested `Rc` nodes recursively, and a crafted proof
/// can describe a tree far deeper than the wasm stack; this takes uniquely owned nodes apart
/// one at a time. Nodes still shared with another tree are left to their other owner.
pub fn teardown(root: NodeId) {
    let mut stack: Vec<NodeId> = alloc::vec![root];
    while let Some(n) = stack.pop() {
        if let Ok(cell) = Rc::try_unwrap(n) {
            if let Node::Internal(i) = cell.into_inner() {
                stack.push(i.left);
                stack.push(i.right);
            }
        }
    }
}

/// Partial trees of a reconstruction, taken apart without recursion if it fails.
struct PartialTrees(Vec<NodeId>);

impl Drop for PartialTrees {
    fn drop(&mut self) {
        for n in self.0.drain(..) {
            teardown(n);
        }
    }
}

pub struct SafeVerifier {
    proof: Vec<u8>,
    base: AuthenticatedTreeOpsBase,
    directions_index: usize,
    last_right_step: usize,
    replay_index: usize,
    /// set when the directions bit string ran out during the current operation
    exhausted: bool,
}

impl SafeVerifier {
    pub fn new(
        starting_digest: &[u8],
        proof: &[u8],
        key_length: usize,
        value_length: Option<usize>,
        max_num_operations: Option<usize>,
        max_deletes: Option<usize>,
    ) -> Result<SafeVerifier> {
        let tree = AVLTree::new(label_only_resolver, key_length, value_length);
        let mut verifier = SafeVerifier {
            proof: proof.to_vec(),
            base: AuthenticatedTreeOpsBase::new(tree, false),
            directions_index: 0,
            last_right_step: 0,
            replay_index: 0,
            exhausted: false,
        };
        verifier.reconstruct_tree(starting_digest, max_num_operations, max_deletes)?;
        Ok(verifier)
    }

    fn slice(&self, from: usize, len: usize) -> Result<&[u8]> {
        let to = from.checked_add(len).ok_or_else(|| anyhow!("proof is malformed (length overflow)"))?;
        self.proof
            .get(from..to)
            .ok_or_else(|| anyhow!("proof is truncated (needs {} bytes at offset {})", len, from))
    }

    fn reconstruct_tree(
        &mut self,
        starting_digest: &[u8],
        max_num_operations: Option<usize>,
        max_deletes: Option<usize>,
    ) -> Result<()> {
        let key_length = self.base.tree.key_length;
        ensure!(key_length > 0, "key length must be positive");
        ensure!(
            starting_digest.len() == DIGEST_LENGTH + 1,
            "starting digest must be {} bytes",
            DIGEST_LENGTH + 1
        );
        let height = starting_digest[DIGEST_LENGTH] as usize;
        self.base.tree.height = height;

        // Same bound as the crate / scrypto (eprint 2016/994, Appendix B), computed in u64 so
        // that native and wasm32 builds agree even for absurd arguments.
        let max_nodes: u64 = if let Some(real_num_operations) = max_num_operations {
            let real_num_operations = real_num_operations as u64;
            let mut log_num_ops: u64 = 0;
            let mut temp: u64 = 1;
            while temp < real_num_operations {
                temp = temp.saturating_mul(2);
                log_num_ops += 1;
            }
            let temp = 1 + core::cmp::max(height as u64, log_num_ops);
            let hnew = temp + temp / 2;
            let real_max_deletes = max_deletes.map(|d| d as u64).unwrap_or(real_num_operations);
            real_num_operations
                .saturating_add(real_max_deletes)
                .saturating_mul(2 * height as u64 + 1)
                .saturating_add(real_max_deletes.saturating_mul(hnew))
                .saturating_add(1)
        } else {
            0
        };

        let mut num_nodes: u64 = 0;
        let mut i: usize = 0;
        let mut previous_leaf: Option<NodeId> = None;
        let mut stack = PartialTrees(Vec::new());
        loop {
            let n = *self
                .proof
                .get(i)
                .ok_or_else(|| anyhow!("proof is truncated (no end-of-tree marker)"))?;
            if n == END_OF_TREE_IN_PACKAGED_PROOF {
                break;
            }
            i += 1;
            num_nodes += 1;
            ensure!(
                max_num_operations.is_none() || num_nodes <= max_nodes,
                "proof is too long for the allowed number of operations"
            );
            match n {
                LABEL_IN_PACKAGED_PROOF => {
                    let mut label: Digest32 = Default::default();
                    label.copy_from_slice(self.slice(i, DIGEST_LENGTH)?);
                    i += DIGEST_LENGTH;
                    stack.0.push(Node::new_label(&label));
                    previous_leaf = None;
                }
                LEAF_IN_PACKAGED_PROOF => {
                    let key = if let Some(prev) = &previous_leaf {
                        self.base.tree.next_node_key(prev)
                    } else {
                        let k = Bytes::copy_from_slice(self.slice(i, key_length)?);
                        i += key_length;
                        k
                    };
                    let next_leaf_key = Bytes::copy_from_slice(self.slice(i, key_length)?);
                    i += key_length;
                    let value_length = match self.base.tree.value_length {
                        Some(vl) => vl,
                        None => {
                            let b = self.slice(i, 4)?;
                            let vl = u32::from_be_bytes([b[0], b[1], b[2], b[3]]) as usize;
                            i += 4;
                            vl
                        }
                    };
                    let value = Bytes::copy_from_slice(self.slice(i, value_length)?);
                    i += value_length;
                    let leaf = LeafNode::new(&key, &value, &next_leaf_key);
                    stack.0.push(leaf.clone());
                    previous_leaf = Some(leaf);
                }
                _ => {
                    let right = stack.0.pop().ok_or_else(|| anyhow!("proof is malformed (stack underflow)"))?;
                    let left = match stack.0.pop() {
                        Some(l) => l,
                        None => {
                            teardown(right);
                            bail!("proof is malformed (stack underflow)");
                        }
                    };
                    let node = InternalNode::new(None, &left, &right, n as i8);
                    // Hash bottom-up while the children's labels are fresh. Same labels as the
                    // crate's lazy recursive computation, but no recursion as deep as the tree:
                    // a crafted proof can describe a degenerate tree tens of thousands of levels
                    // deep, and the wasm stack is small.
                    let _ = self.base.tree.label(&node);
                    stack.0.push(node);
                }
            }
        }

        ensure!(stack.0.len() == 1, "proof is malformed (expected exactly one root)");
        let root = stack.0.pop().unwrap();
        if !starting_digest.starts_with(&self.base.tree.label(&root)) {
            teardown(root);
            bail!("proof does not match the starting digest");
        }
        self.base.tree.root = Some(root);
        // Directions start right after the packed tree (after the end-of-tree byte)
        self.directions_index = (i + 1) * 8;
        Ok(())
    }

    /// Same contract as `BatchAVLVerifier::perform_one_operation`: Ok(Some(old value)),
    /// Ok(None) when the key is (proven) absent, Err when the operation fails or the proof is
    /// wrong. After one failure every later operation fails and `digest()` is None.
    pub fn perform_one_operation(&mut self, operation: &Operation) -> Result<Option<ADValue>> {
        self.replay_index = self.directions_index;
        self.exhausted = false;
        let root = match self.base.tree.root.as_ref() {
            Some(r) => r.clone(),
            None => bail!("verifier already failed"),
        };
        let mut res = self.return_result_of_one_operation(operation, &root);
        if self.exhausted && res.is_ok() {
            res = Err(anyhow!("proof directions exhausted"));
        }
        if res.is_err() {
            if let Some(r) = self.base.tree.root.take() {
                teardown(r);
            }
            self.base.tree.height = 0;
        }
        // the pre-operation root: only nodes the operation replaced are really freed here
        teardown(root);
        res
    }

    pub fn failed(&self) -> bool {
        self.base.tree.root.is_none()
    }
}

impl Drop for SafeVerifier {
    fn drop(&mut self) {
        if let Some(r) = self.base.tree.root.take() {
            teardown(r);
        }
    }
}

impl AuthenticatedTreeOps for SafeVerifier {
    fn get_state(&self) -> &AuthenticatedTreeOpsBase {
        &self.base
    }

    fn state(&mut self) -> &mut AuthenticatedTreeOpsBase {
        &mut self.base
    }

    fn key_matches_leaf(&mut self, key: &ADKey, leaf: &LeafNode) -> Result<bool> {
        if self.exhausted {
            bail!("proof directions exhausted");
        }
        // Verifier has no keys in internal nodes: the key is either the leaf's key or lies
        // strictly between the leaf's key and its next-leaf key (eprint 2016/994, App. B).
        let leaf_key = leaf.hdr.key.as_ref().ok_or_else(|| anyhow!("proof leaf without key"))?;
        if *key == *leaf_key {
            Ok(true)
        } else {
            ensure!(*key > *leaf_key, "proof does not cover this key");
            ensure!(*key < leaf.next_node_key, "proof does not cover this key");
            Ok(false)
        }
    }

    fn next_direction_is_left(&mut self, _key: &ADKey, _r: &InternalNode) -> bool {
        let ret = match self.proof.get(self.directions_index >> 3) {
            Some(b) => (b & (1u8 << (self.directions_index & 7))) != 0,
            None => {
                // The JVM throws here. We mark the operation failed and walk left until the
                // traversal stops (a leaf -> key_matches_leaf errors, a label -> bail).
                self.exhausted = true;
                true
            }
        };
        if !ret {
            self.last_right_step = self.directions_index;
        }
        self.directions_index += 1;
        ret
    }

    fn replay_comparison(&mut self) -> i32 {
        // Only called during the second (deletion) pass, over bits the first pass already read.
        let bit_is_zero = match self.proof.get(self.replay_index >> 3) {
            Some(b) => (b & (1u8 << (self.replay_index & 7))) == 0,
            None => false,
        };
        let ret = if self.replay_index == self.last_right_step {
            0
        } else if bit_is_zero && self.replay_index < self.last_right_step {
            1
        } else {
            -1
        };
        self.replay_index += 1;
        ret
    }
}

/// Convenience for tests: digest as owned bytes.
pub fn digest_of(v: &SafeVerifier) -> Option<ADDigest> {
    v.digest()
}
