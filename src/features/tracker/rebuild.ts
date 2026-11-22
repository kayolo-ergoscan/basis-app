// Proof trees for any commitment in the timeline.
//
// The engine keeps lookup trees only for the current box, the previous one and the newest confirmed one (a real
// tracker keeps only its live tree too). For an older row we rebuild that box's tree from the town's log: every
// note version written before the commitment, in log order, exactly as the tracker applied them. The result is
// accepted only when its digest equals the digest committed in that box, so a rebuild can never show a proof
// for the wrong tree. The work runs in short slices, so the page never stalls.

import { bytesToHex, hexToBytes, trackerTreeValue, type AuthenticatedMap, type Economy, type Hex } from "@/protocol";

export interface TreeSource {
  /** "kept": the engine still holds this box's tree; "rebuilt": recomputed from the log and checked. */
  kind: "kept" | "rebuilt";
  map: AuthenticatedMap;
  digest: Hex;
}

interface Op {
  seq: number;
  key: Hex;
  total: bigint;
}

/** Every write to the tracker tree before `seq`, in the order the tracker made them. */
export function treeOpsBefore(eco: Economy, trackerId: string, seq: number): Op[] {
  const t = eco.t(trackerId);
  const ops: Op[] = [];
  for (const rec of t.notes.values()) {
    for (const v of rec.history) {
      if (v.seq >= seq) break;
      const e = eco.events[v.seq];
      if (e && e.type === "note.issued" && e.omitted) continue;
      ops.push({ seq: v.seq, key: rec.key, total: v.totalDebt });
    }
  }
  ops.sort((a, b) => a.seq - b.seq);
  return ops;
}

const cache = new Map<string, TreeSource>();
const CACHE_MAX = 3;

function remember(id: string, src: TreeSource): void {
  cache.set(id, src);
  while (cache.size > CACHE_MAX) {
    const [old, v] = cache.entries().next().value as [string, TreeSource];
    cache.delete(old);
    const m = v.map as AuthenticatedMap & { free?: () => void };
    if (v.kind === "rebuilt" && typeof m.free === "function") m.free();
  }
}

const yieldToPage = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * The tree committed by box `boxId` (created by the event at `seq`). Resolves to null when the rebuilt digest
 * does not match (then no proof is shown) or when `signal` is aborted.
 */
export async function treeFor(
  eco: Economy,
  trackerId: string,
  row: { seq: number; boxId: Hex; digest: Hex },
  o: { signal?: { aborted: boolean }; onProgress?: (done: number, total: number) => void; sliceMs?: number } = {},
): Promise<TreeSource | null> {
  const t = eco.t(trackerId);
  const box = t.boxes.find((b) => b.boxId === row.boxId);
  if (box?.tree) return { kind: "kept", map: box.tree, digest: box.digest };
  const id = `${eco.seed}|${trackerId}|${row.boxId}`;
  const hit = cache.get(id);
  if (hit) return hit;
  const ops = treeOpsBefore(eco, trackerId, row.seq);
  const map = t.avl.createMap(32);
  const slice = o.sliceMs ?? 8;
  let t0 = performance.now();
  for (let i = 0; i < ops.length; i++) {
    map.insertOrUpdate(hexToBytes(ops[i].key), trackerTreeValue(ops[i].total));
    if (performance.now() - t0 > slice) {
      o.onProgress?.(i + 1, ops.length);
      await yieldToPage();
      if (o.signal?.aborted) return null;
      t0 = performance.now();
    }
  }
  o.onProgress?.(ops.length, ops.length);
  const digest = bytesToHex(map.digest());
  if (digest !== row.digest) {
    const m = map as AuthenticatedMap & { free?: () => void };
    if (typeof m.free === "function") m.free();
    return null;
  }
  const src: TreeSource = { kind: "rebuilt", map, digest };
  remember(id, src);
  return src;
}
