// Identity inks (VISUAL §3.4): hues 190–330° plus graphite. Never red (alarm), green (in your favour) or gold (metal),
// so a seal can never be read as debt, gain or backing. These literals are the only raw hex allowed outside tokens.css.

export interface Ink { name: string; c: string; t: string }
export interface InkPair { a: Ink; b: Ink }
/** A loose ink pair for custom seals (the brand seal uses paper inks with no tint). */
export interface InkLike { name?: string; c: string; t?: string }

export const INKS: readonly Ink[] = [
  { name: "Petrol", c: "#0F566B", t: "#CFE3E6" },
  { name: "Prussian", c: "#1B416F", t: "#D2DDEC" },
  { name: "Lapis", c: "#204F99", t: "#D3DFF3" },
  { name: "Indigo", c: "#33388E", t: "#D9DAF1" },
  { name: "Violet", c: "#523590", t: "#E0D7F0" },
  { name: "Purple", c: "#692F84", t: "#EAD6EF" },
  { name: "Plum", c: "#7A2C68", t: "#F0D5E7" },
  { name: "Graphite", c: "#2B2D33", t: "#DEDCD6" },
];

/** a = INKS[key[0] % 8], b = INKS[(key[0] + 1 + key[1] % 7) % 8]; b is never a. */
export function inksFor(key: Uint8Array): InkPair {
  const a = INKS[key[0] % 8];
  const b = INKS[(key[0] + 1 + (key[1] % 7)) % 8];
  return { a, b };
}

/** Paper print inks for the brand seal (VISUAL §12.12): paper-ink / paper-ink-2. */
export const BRAND_INKS = { a: { c: "#17171A" }, b: { c: "#4A463F" } } as const;
/** Paper colour of seal discs. */
export const SEAL_PAPER = "#F4EEE0";
