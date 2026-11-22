// Small, dependency-free formatters for world strings (feed lines, toasts). Pages should render numbers with
// the ui kit's money()/Num; these follow the same VISUAL §4.3 rules so inline text matches:
// thin space + word joiner as the thousands separator, U+2212 minus, 2 dp (up to 4 dp for micro amounts).
import { ERG, formatUnits, parseUnits, type DenomId, type DenominationInfo, type Economy } from "@/protocol";

export const THIN = " ⁠";
export const MINUS = "−";
export const NBSP = " ";

export function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** Denomination info for an id (ERG, a token the economy knows, or a placeholder). */
export function denomInfo(eco: Pick<Economy, "denominations"> | null | undefined, denom: DenomId): DenominationInfo {
  return eco?.denominations.get(denom) ?? (denom === "erg" ? ERG : { id: denom, symbol: "token", decimals: 0 });
}

export function symbolOf(eco: Pick<Economy, "denominations"> | null | undefined, denom: DenomId): string {
  return denomInfo(eco, denom).symbol;
}

function roundTo(x: bigint, decimals: number, dp: number): bigint {
  if (dp >= decimals) return x * 10n ** BigInt(dp - decimals);
  const scale = 10n ** BigInt(decimals - dp);
  return (x + scale / 2n) / scale;
}

/**
 * "1 240.00" for UI text. dp "auto" (default): 2 dp, or up to 4 dp when 2 dp would show 0.00 for a non-zero
 * amount (agent micro-prices), or the exact value when even 4 dp is 0.
 */
export function fmtUnits(v: bigint, decimals: number, o: { dp?: number | "auto"; sign?: "auto" | "always" | "never" } = {}): string {
  const neg = v < 0n;
  const x = neg ? -v : v;
  let dp: number;
  if (o.dp === undefined || o.dp === "auto") {
    dp = Math.min(2, decimals);
    if (x !== 0n && roundTo(x, decimals, dp) === 0n) dp = Math.min(4, decimals);
    if (x !== 0n && roundTo(x, decimals, dp) === 0n) dp = decimals;
  } else dp = Math.min(o.dp, decimals);
  const r = roundTo(x, decimals, dp);
  const base = 10n ** BigInt(dp);
  const int = groupThousands((r / base).toString());
  const frac = dp > 0 ? "." + (r % base).toString().padStart(dp, "0") : "";
  const sign = neg ? (o.sign === "never" ? "" : MINUS) : o.sign === "always" && x !== 0n ? "+" : "";
  return `${sign}${int}${frac}`;
}

/** "500.00 ERG" (number + NBSP + symbol). */
export function fmtAmount(v: bigint, info: DenominationInfo, o: { dp?: number | "auto"; sign?: "auto" | "always" | "never"; symbol?: boolean } = {}): string {
  const n = fmtUnits(v, info.decimals, o);
  return o.symbol === false ? n : `${n}${NBSP}${info.symbol}`;
}

/** Amount in a denomination of an economy. */
export function fmtDenom(eco: Pick<Economy, "denominations"> | null | undefined, v: bigint, denom: DenomId, o: { dp?: number | "auto"; sign?: "auto" | "always" | "never"; symbol?: boolean } = {}): string {
  return fmtAmount(v, denomInfo(eco, denom), o);
}

/** Exact machine value ("1500000000"), for the machine face. */
export function fmtRaw(v: bigint): string {
  return v.toString();
}

/** Parses a user-typed amount ("1.5", "1 240,50") into base units; null when it is not a valid amount. */
export function parseAmount(text: string, info: DenominationInfo): bigint | null {
  const s = text.replace(/[\s ⁠  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  try {
    return parseUnits(s, info.decimals);
  } catch {
    return null;
  }
}

/** "12 %" (integer percent; one decimal below 1 %). null → "—". */
export function fmtPercent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return "—";
  const p = ratio * 100;
  const s = p < 1 && p > 0 ? p.toFixed(1) : Math.round(p).toString();
  return `${groupThousands(s)}${THIN}%`;
}

/** "02d9…60b6" (VISUAL §4.3: first 4 + … + last 4). */
export function shortHex(hex: string, head = 4, tail = 4): string {
  const h = hex.toLowerCase();
  return h.length > head + tail + 1 ? `${h.slice(0, head)}…${h.slice(-tail)}` : h;
}

/** Digest grouped by 4 ("9f3c 1a2d 07be … e1"): head groups + last byte. */
export function groupHex(hex: string, groups = 4): string {
  const h = hex.toLowerCase();
  const parts: string[] = [];
  for (let i = 0; i < Math.min(groups * 4, h.length); i += 4) parts.push(h.slice(i, i + 4));
  return h.length > groups * 4 ? `${parts.join(" ")} … ${h.slice(-2)}` : parts.join(" ");
}

/** "37 blk" with NBSP. */
export function fmtBlocks(n: number): string {
  return `${groupThousands(String(Math.round(n)))}${NBSP}blk`;
}

/** Re-export for convenience: exact decimal string without grouping ("1.5"). */
export function plainUnits(v: bigint, decimals: number): string {
  return formatUnits(v, decimals);
}
