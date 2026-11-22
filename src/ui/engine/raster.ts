// Caches for engraved art (VISUAL §8.4 performance): every seal and note except the one live hero/detail note is
// shown as an image, not as live SVG, and both the SVG strings and their image URLs are kept in 64-entry LRUs keyed by
// (algoVersion, key, variant, detail, px). An <img> with an SVG source is rasterized by the browser at its display size
// (crisp at any DPR) and costs one DOM node instead of thousands of path nodes.
import { hex } from "./bytes";
import { NOTE_ALGO, noteArt, type NoteArtOptions } from "./noteArt";
import { keyHash, SEAL_ALGO, sealSVG, type SealOptions } from "./seal";

class LRU<V> {
  private m = new Map<string, V>();
  constructor(private max: number, private onEvict?: (v: V) => void) {}
  get(k: string): V | undefined {
    const v = this.m.get(k);
    if (v !== undefined) { this.m.delete(k); this.m.set(k, v); }
    return v;
  }
  set(k: string, v: V) {
    if (this.m.has(k)) this.m.delete(k);
    this.m.set(k, v);
    while (this.m.size > this.max) {
      const first = this.m.keys().next().value as string;
      const ev = this.m.get(first)!;
      this.m.delete(first);
      this.onEvict?.(ev);
    }
  }
  get size() { return this.m.size; }
}

const svgCache = new LRU<string>(64);
// Blob URLs are revoked a minute after eviction so an <img> that is still loading never loses its source.
const urlCache = new LRU<string>(64, (u) => { if (u.startsWith("blob:")) setTimeout(() => URL.revokeObjectURL(u), 60_000); });

const canBlob = () => typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Blob !== "undefined";

/** Memoised SVG string by cache key. */
export function cachedSvg(cacheKey: string, make: () => string): string {
  let s = svgCache.get(cacheKey);
  if (s === undefined) { s = make(); svgCache.set(cacheKey, s); }
  return s;
}

/** Image URL (blob: or data:) of a memoised SVG string. Read it on every render; do not keep it in state. */
export function svgUrl(cacheKey: string, make: () => string): string {
  let u = urlCache.get(cacheKey);
  if (u === undefined) {
    const svg = cachedSvg(cacheKey, make);
    u = canBlob() ? URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" })) : "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    urlCache.set(cacheKey, u);
  }
  return u;
}

const optKey = (o: object) => JSON.stringify(o);

/** Seal SVG for a 32-byte seed, memoised. */
export const sealSvgCached = (seed: Uint8Array, o: SealOptions = {}): string =>
  cachedSvg(`${SEAL_ALGO}|${hex(seed)}|${optKey(o)}`, () => sealSVG(seed, o));
/** Seal image URL for a 32-byte seed, memoised. */
export const sealUrl = (seed: Uint8Array, o: SealOptions = {}): string =>
  svgUrl(`${SEAL_ALGO}|${hex(seed)}|${optKey(o)}`, () => sealSVG(seed, o));

const seedCache = new LRU<Uint8Array>(256);
/** blake2b256(pk), memoised (key seals are drawn often). */
export function keySeed(pk: string): Uint8Array {
  let s = seedCache.get(pk);
  if (!s) { s = keyHash(pk); seedCache.set(pk, s); }
  return s;
}

/** Note art SVG, memoised. */
export const noteArtCached = (key: Uint8Array, o: NoteArtOptions = {}): string =>
  cachedSvg(`${NOTE_ALGO}|${hex(key)}|${optKey(o)}`, () => noteArt(key, o));
/** Note art image URL, memoised (lite notes, stacks and thumbnails). */
export const noteArtUrl = (key: Uint8Array, o: NoteArtOptions = {}): string =>
  svgUrl(`${NOTE_ALGO}|${hex(key)}|${optKey(o)}`, () => noteArt(key, o));
