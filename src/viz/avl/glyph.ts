// Deterministic fingerprint of a digest: a 32-spoke rosette (one spoke per root-label byte) inside rings that
// count the tree height. Same bytes → same glyph; one changed byte moves one spoke. Pure geometry for tests.

export interface GlyphGeometry {
  /** Closed path through the 32 spoke tips (SVG d). */
  outline: string;
  /** The 32 spokes as line segments [x1, y1, x2, y2]. */
  spokes: Array<[number, number, number, number]>;
  rings: number[];
  /** Height byte (digest[32]) when present. */
  height: number | null;
}

export function digestGlyph(digest: Uint8Array, size = 64): GlyphGeometry {
  const c = size / 2;
  const rMin = size * 0.17;
  const rMax = size * 0.47;
  const label = digest.subarray(0, 32);
  const n = Math.max(1, label.length);
  const pts: Array<[number, number]> = [];
  const spokes: GlyphGeometry["spokes"] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = rMin + ((label[i] ?? 0) / 255) * (rMax - rMin);
    const x = c + Math.cos(a) * r;
    const y = c + Math.sin(a) * r;
    pts.push([x, y]);
    spokes.push([+(c + Math.cos(a) * rMin * 0.55).toFixed(2), +(c + Math.sin(a) * rMin * 0.55).toFixed(2), +x.toFixed(2), +y.toFixed(2)]);
  }
  const outline = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join(" ") + " Z";
  const height = digest.length > 32 ? digest[32] : null;
  const ringCount = height === null ? 1 : Math.max(1, Math.min(6, height));
  const rings = Array.from({ length: ringCount }, (_, k) => +(rMin * (0.35 + (0.6 * (k + 1)) / ringCount)).toFixed(2));
  return { outline, spokes, rings, height };
}
