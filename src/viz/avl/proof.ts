// AVL+ proof X-ray helpers. Real Ergo AVL+ proofs (wasm backend) are split with the verifier's own parser
// (decodeAvlProof) and their root label is recomputed here from the revealed nodes: leaf = blake2b256(0x00 ‖ key ‖
// value ‖ nextKey), internal = blake2b256(0x01 ‖ balance ‖ left ‖ right). Sandbox proofs (simulated backend) are
// described structurally. Pure; tested against the wasm verifier.

import { blake2b256, describeProof, equalBytes, type AvlBackend } from "@/protocol";
import { decodeAvlProof, type AvlProofPart } from "@/protocol/avl-wasm";
import type { ByteSeg } from "../core/primitives";

export interface ProofSegment {
  from: number;
  length: number;
  kind: "label" | "leaf" | "internal" | "end" | "directions" | "sandbox";
  part?: AvlProofPart;
}

export interface ProofAnatomy {
  format: "ergo-avl" | "sandbox" | "unknown";
  segments: ProofSegment[];
  counts: { labels: number; leaves: number; internals: number };
  /** Root label recomputed from the proof (Ergo AVL+ only). */
  root: Uint8Array | null;
  wellFormed: boolean;
  error?: string;
  sandbox?: ReturnType<typeof describeProof>;
}

const ZERO = new Uint8Array([0]);
const ONE = new Uint8Array([1]);

/** Root label of the revealed tree (post order: labels and leaves push, internals pop two). */
export function recomputeRootLabel(parts: readonly AvlProofPart[]): Uint8Array | null {
  const st: Uint8Array[] = [];
  for (const p of parts) {
    if (p.kind === "label") st.push(p.label);
    else if (p.kind === "leaf") st.push(blake2b256(ZERO, p.key, p.value, p.nextKey));
    else if (p.kind === "internal") {
      const r = st.pop();
      const l = st.pop();
      if (!l || !r) return null;
      st.push(blake2b256(ONE, new Uint8Array([p.balance & 0xff]), l, r));
    } else if (p.kind === "end") break;
  }
  return st.length === 1 ? st[0] : null;
}

export function proofAnatomy(proof: Uint8Array, backend: Pick<AvlBackend, "simulated"> | null): ProofAnatomy {
  if (backend && backend.simulated) {
    const d = describeProof(proof);
    return {
      format: d ? "sandbox" : "unknown",
      segments: [{ from: 0, length: proof.length, kind: "sandbox" }],
      counts: { labels: d ? d.parts.reduce((s, p) => s + p.siblings.length, 0) : 0, leaves: d ? d.parts.reduce((s, p) => s + p.entries.length, 0) : 0, internals: 0 },
      root: null,
      wellFormed: !!d,
      sandbox: d,
    };
  }
  const dec = decodeAvlProof(proof, { keyLength: 32, valueLength: null });
  const segments: ProofSegment[] = dec.parts.map((p) => ({ from: p.offset, length: p.size, kind: p.kind, part: p }));
  return {
    format: "ergo-avl",
    segments,
    counts: { labels: dec.labels, leaves: dec.leaves, internals: dec.internals },
    root: dec.wellFormed ? recomputeRootLabel(dec.parts) : null,
    wellFormed: dec.wellFormed,
    error: dec.error,
  };
}

export function rootMatches(a: ProofAnatomy, digest: Uint8Array): boolean | null {
  if (!a.root) return null;
  return equalBytes(a.root, digest.subarray(0, 32));
}

const TONE: Record<ProofSegment["kind"], string> = { label: "label", leaf: "leaf", internal: "node", end: "end", directions: "dir", sandbox: "dim" };

export function proofByteSegs(a: ProofAnatomy, names: Record<ProofSegment["kind"], string>): ByteSeg[] {
  return a.segments.filter((s) => s.length > 0).map((s) => ({ from: s.from, length: s.length, tone: TONE[s.kind], label: names[s.kind] }));
}
