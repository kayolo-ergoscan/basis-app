// Pulse bus (VISUAL §17): one event — a tracker commitment — from the sandbox world or from mainnet polling.
// Orchestrator-owned API: ui-shell may improve internals (reduced motion, batching) but must keep these exports.
import { useEffect, useRef } from "react";

export interface Pulse {
  source: "sandbox" | "mainnet";
  trackerId: string;      // sandbox tracker id (e.g. "t1") or mainnet tracker NFT id (hex)
  digest: string;         // hex of the committed AVL digest (33 bytes)
  height: number;         // block height of the commitment
  noteKeys?: string[];    // debt keys (hex) whose totals changed in this commitment, when known
}

type Fn = (p: Pulse) => void;
const subs = new Set<Fn>();
let last: Pulse | null = null;

export const pulse = {
  commit(p: Pulse) {
    last = p;
    for (const f of [...subs]) { try { f(p); } catch (e) { console.warn("pulse subscriber failed", e); } }
  },
  subscribe(f: Fn): () => void { subs.add(f); return () => { subs.delete(f); }; },
  last(): Pulse | null { return last; },
};

/** React: run fn on every pulse (latest fn is used; no resubscribe on rerender). */
export function usePulse(fn: Fn, filter?: (p: Pulse) => boolean) {
  const ref = useRef(fn); ref.current = fn;
  const fRef = useRef(filter); fRef.current = filter;
  useEffect(() => pulse.subscribe((p) => { if (!fRef.current || fRef.current(p)) ref.current(p); }), []);
}
