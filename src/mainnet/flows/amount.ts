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
