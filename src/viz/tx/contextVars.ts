// Context extension of a reserve input, as a transaction carries it. Ergo serialises the extension in the
// iteration order of the Scala Map the wallet built: up to 4 entries keep insertion order (Map1–Map4), from 5 on
// it is an immutable.HashMap (Scala 2.12 HashTrieMap): keys ordered by the 5-bit chunks of `improve(key.##)`.
// For a redemption that gives 0, 5, 1, 6, 2, (7), 3, 8, 4. Pure; tested.

import { contextVarsHex, type ContextVar } from "@/protocol";

/** scala.collection.immutable.HashMap.improve (2.12) on an Int hash. */
export function scalaImprove(hcode: number): number {
  let h = (hcode + ~(hcode << 9)) | 0;
  h ^= h >>> 14;
  h = (h + (h << 4)) | 0;
  return h ^ (h >>> 10);
}

/** Iteration order of a Scala 2.12 immutable Map with these Byte keys (insertion order = ascending for ≤ 4). */
export function scalaMapOrder(keys: readonly number[]): number[] {
  const ks = [...new Set(keys)];
  if (ks.length <= 4) return ks.sort((a, b) => a - b);
  const rec = (group: number[], level: number): number[] => {
    if (group.length <= 1 || level >= 35) return group;
    const buckets = new Map<number, number[]>();
    for (const k of group) {
      const idx = (scalaImprove(k) >>> level) & 0x1f;
      const b = buckets.get(idx);
      if (b) b.push(k);
      else buckets.set(idx, [k]);
    }
    return [...buckets.keys()].sort((a, b) => a - b).flatMap((i) => rec(buckets.get(i)!, level + 5));
  };
  return rec(ks, 0);
}

export type VarMeaning = "action" | "receiver" | "ownerSig" | "totalDebt" | "timestamp" | "insertProof" | "trackerSig" | "reserveLookup" | "trackerLookup" | "other";

/** What each variable means to basis.es / basis-token.es. */
export const CONTEXT_VAR_MEANING: Record<number, VarMeaning> = {
  0: "action",
  1: "receiver",
  2: "ownerSig",
  3: "totalDebt",
  4: "timestamp",
  5: "insertProof",
  6: "trackerSig",
  7: "reserveLookup",
  8: "trackerLookup",
};

export interface ExtensionRow {
  id: number;
  meaning: VarMeaning;
  type: string;
  /** Raw value hex (Long as 8 bytes big-endian). */
  hex: string;
  /** Serialised constant: type code ‖ value. */
  wire: string;
  /** Engine's short value text (decimal for Byte/Long, "N bytes" otherwise). */
  value: string;
  /** Raw value length in bytes. */
  size: number;
  v: ContextVar;
}

export function extensionRows(vars: Record<number, ContextVar> | undefined): ExtensionRow[] {
  if (!vars) return [];
  const hex = contextVarsHex(vars);
  return scalaMapOrder(Object.keys(vars).map(Number)).map((id) => {
    const h = hex[`#${id}`];
    return { id, meaning: CONTEXT_VAR_MEANING[id] ?? "other", type: h.type, hex: h.hex, wire: h.wire, value: h.value, size: h.hex.length / 2, v: vars[id] };
  });
}

/** The extension's bytes: count, then key ‖ constant per entry, in map order. */
export function extensionHex(rows: readonly ExtensionRow[]): string {
  const n = rows.length.toString(16).padStart(2, "0");
  return n + rows.map((r) => r.id.toString(16).padStart(2, "0") + r.wire).join("");
}
