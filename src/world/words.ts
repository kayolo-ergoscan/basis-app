// Three words + fingerprint for a public key (VISUAL §8.6): BIP-39 English words for bits 0–10, 11–21 and
// 22–32 (most significant bit first) of blake2b256(pk). If the ui kit ships its own implementation at
// src/ui/engine/words.ts, it is used instead (same contract), so every page shows the same words.
import { wordlist } from "@scure/bip39/wordlists/english";
import { blake2b256, hexToBytes, type Hex } from "@/protocol";

type WordsFn = (pk: Hex | Uint8Array) => unknown;

const uiModules = import.meta.glob("/src/ui/engine/words.ts", { eager: true }) as Record<string, Record<string, unknown>>;

function uiWordsFn(): WordsFn | null {
  for (const mod of Object.values(uiModules)) {
    for (const name of ["threeWords", "keyWords", "wordsFor", "words"]) {
      const f = mod[name];
      if (typeof f === "function") return f as WordsFn;
    }
  }
  return null;
}

const ui = uiWordsFn();

function asTriple(v: unknown): [string, string, string] | null {
  if (Array.isArray(v) && v.length === 3 && v.every((w) => typeof w === "string")) return v as [string, string, string];
  if (typeof v === "string") {
    const parts = v.split(/[\s·,.-]+/).filter(Boolean);
    if (parts.length === 3) return parts as [string, string, string];
  }
  return null;
}

/** Local implementation of VISUAL §8.6 (BIP-39 English, 33 bits MSB-first of blake2b256(pk)). */
export function threeWordsLocal(pk: Hex | Uint8Array): [string, string, string] {
  const bytes = typeof pk === "string" ? hexToBytes(pk) : pk;
  const h = blake2b256(bytes);
  const w0 = (h[0] << 3) | (h[1] >> 5);
  const w1 = ((h[1] & 0x1f) << 6) | (h[2] >> 2);
  const w2 = ((h[2] & 0x03) << 9) | (h[3] << 1) | (h[4] >> 7);
  return [wordlist[w0], wordlist[w1], wordlist[w2]];
}

const cache = new Map<string, [string, string, string]>();

/** The three words of a key (cached). Uses src/ui/engine/words.ts when present. */
export function threeWords(pk: Hex | Uint8Array): [string, string, string] {
  const hex = typeof pk === "string" ? pk.toLowerCase() : Array.from(pk, (b) => b.toString(16).padStart(2, "0")).join("");
  const hit = cache.get(hex);
  if (hit) return hit;
  let out: [string, string, string] | null = null;
  if (ui) {
    try {
      out = asTriple(ui(hex)) ?? asTriple(ui(hexToBytes(hex)));
    } catch {
      out = null;
    }
  }
  out ??= threeWordsLocal(hex);
  if (cache.size > 2048) cache.clear();
  cache.set(hex, out);
  return out;
}

/** "word · word · word" (VISUAL §8.6 joiner). */
export function threeWordsText(pk: Hex | Uint8Array): string {
  return threeWords(pk).join(" · ");
}

/** Where the words come from: "ui-engine" (src/ui/engine/words.ts) or "world" (local §8.6 port). */
export const WORDS_SOURCE: "ui-engine" | "world" = ui ? "ui-engine" : "world";

/** "02d9…60b6": first 4 + … + last 4 hex characters of the compressed key (VISUAL §4.3). */
export function fingerprint(pub: Hex): string {
  const h = pub.toLowerCase();
  return `${h.slice(0, 4)}…${h.slice(-4)}`;
}
