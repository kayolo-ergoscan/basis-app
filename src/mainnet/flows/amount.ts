// ERG amounts as people type them, and back. nanoERG are bigint everywhere; a typed amount never passes through a float.
// Typed amounts follow the page language (operator decision 5, 22 Nov 2026; the formats of src/ui/engine/money.ts):
//   RU: decimal comma, groups by spaces: «1 240,5», «0,001» (a dot is read as the decimal mark too);
//   EN: decimal point: "1240.5", "0.001". A comma followed by exactly three digits is a thousands group in English,
//       never a decimal: "1,000" is refused instead of read as 1 ERG (money review P2-7); "1,5" still reads 1.5.
import { decimalMark, numberLang, type FmtLang } from "../../ui/engine/money";

export const NANO = 1_000_000_000n;

/** A typed amount → nanoERG in the page language (see above); null when it is not an amount with at most 9 decimals,
 *  or is 0. Spaces, thin spaces, no-break spaces and word joiners are groups and go. */
export function parseErg(input: string, lang: FmtLang = numberLang()): bigint | null {
  let s = input.replace(/[\s\u00a0\u2009\u2060\u202f']/g, "");
  if (lang === "en" && /,\d{3}(?!\d)/.test(s)) return null;
  if ((s.match(/[.,]/g) ?? []).length > 1) return null;
  s = s.replace(",", ".");
  if (!/^\d{1,11}(\.\d{0,9})?$/.test(s) && !/^\.\d{1,9}$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const nano = BigInt(w || "0") * NANO + BigInt((f + "000000000").slice(0, 9));
  return nano > 0n ? nano : null;
}

/** nanoERG as an input's text in the page language: "1.5" (EN), «1,5» (RU); no grouping. */
export const ergInput = (nano: bigint, lang: FmtLang = numberLang()): string => ergPlain(nano).replace(".", decimalMark(lang));

/** nanoERG → "1.5", "0.001", "12" (no grouping, "." decimal): for links and machine text. */
export function ergPlain(nano: bigint): string {
  const neg = nano < 0n;
  const v = neg ? -nano : nano;
  const w = v / NANO;
  const f = (v % NANO).toString().padStart(9, "0").replace(/0+$/, "");
  return (neg ? "-" : "") + w.toString() + (f ? "." + f : "");
}

/** The fewest decimals (at least `min`) that show `nano` exactly: mainnet amounts are small, so 2 fixed decimals would
 *  print 0.001 ERG as "0.00". */
export function dpOf(nano: bigint, min = 2): number {
  let r = nano < 0n ? -nano : nano;
  let dp = 9;
  while (dp > min && r % 10n === 0n) { r /= 10n; dp--; }
  return dp;
}

// ─── any denomination (token reserves) ──────────────────────────────────────────────────────────

/** A typed amount → raw units with `decimals` decimals (the same reading as parseErg: page language, groups, no float);
 *  null when it is not an amount with at most `decimals` decimals, or is 0, or has more than 12 whole digits. */
export function parseUnits(input: string, decimals: number, lang: FmtLang = numberLang()): bigint | null {
  if (decimals === 9) return parseErg(input, lang);
  let s = input.replace(/[\s  ⁠ ']/g, "");
  if (lang === "en" && /,\d{3}(?!\d)/.test(s)) return null;
  if ((s.match(/[.,]/g) ?? []).length > 1) return null;
  s = s.replace(",", ".");
  const frac = decimals > 0 ? `(\\.\\d{0,${decimals}})?` : "";
  if (!new RegExp(`^\\d{1,12}${frac}$`).test(s) && !(decimals > 0 && new RegExp(`^\\.\\d{1,${decimals}}$`).test(s))) return null;
  const [w, f = ""] = s.split(".");
  const raw = BigInt(w || "0") * 10n ** BigInt(decimals) + (decimals > 0 ? BigInt((f + "0".repeat(decimals)).slice(0, decimals)) : 0n);
  return raw > 0n ? raw : null;
}

/** Raw units → "1.5", "0.01", "12" (no grouping, "." decimal). */
export function unitsPlain(raw: bigint, decimals: number): string {
  if (decimals === 9) return ergPlain(raw);
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const one = 10n ** BigInt(decimals);
  const f = decimals > 0 ? (v % one).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  return (neg ? "-" : "") + (v / one).toString() + (f ? "." + f : "");
}

/** Raw units as an input's text in the page language. */
export const unitsInput = (raw: bigint, decimals: number, lang: FmtLang = numberLang()): string => unitsPlain(raw, decimals).replace(".", decimalMark(lang));

/** The fewest decimals (at least min(2, decimals)) that show `raw` exactly. */
export function dpOfUnits(raw: bigint, decimals: number): number {
  if (decimals === 9) return dpOf(raw);
  let r = raw < 0n ? -raw : raw;
  let dp = decimals;
  const min = Math.min(2, decimals);
  while (dp > min && r % 10n === 0n) { r /= 10n; dp--; }
  return dp;
}
