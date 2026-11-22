// ERG amounts as people type them, and back. nanoERG are bigint everywhere; a typed amount never passes through a float.

export const NANO = 1_000_000_000n;

/** "1.5", "1,5", "0.001", "1 000.25" (spaces, thin spaces, word joiners) → nanoERG; null when it is not an amount
 *  with at most 9 decimals, or is 0. */
export function parseErg(input: string): bigint | null {
  const s = input.replace(/[\s ⁠  ']/g, "").replace(",", ".");
  if (!/^\d{1,11}(\.\d{0,9})?$/.test(s) && !/^\.\d{1,9}$/.test(s)) return null;
  const [w, f = ""] = s.split(".");
  const nano = BigInt(w || "0") * NANO + BigInt((f + "000000000").slice(0, 9));
  return nano > 0n ? nano : null;
}

/** nanoERG → "1.5", "0.001", "12" (no grouping, "." decimal): for inputs and links. */
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
