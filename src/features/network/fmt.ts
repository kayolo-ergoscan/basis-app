// Formatting for mainnet data (VISUAL §4.3). Amounts are exact bigints from @/chain; they go through the ui `units()`
// helper (thin-space groups, U+2212 minus). Mainnet test amounts are tiny (0.001–1 ERG), so a fixed 2 dp would print
// "0.00" for a 0.003 ERG reserve: `dpFor` keeps at least 2 decimals and adds more only when the value needs them.
import { blk, humanTime, int, short, units, NBSP } from "@/ui";
import { parseAddress, type Hex, type TokenAmount, type TokenKind } from "@/chain";
import type { Lang } from "@/app/types";

export type { Lang };

/** Smallest dp ≥ min that shows `raw` exactly (capped at the token's decimals). */
export function dpFor(raw: bigint, decimals: number, min = 2): number {
  if (decimals <= min) return decimals;
  let r = raw < 0n ? -raw : raw;
  let dp = decimals;
  while (dp > min && r % 10n === 0n) { r /= 10n; dp--; }
  return dp;
}

/** Exact amount: 8 995 000 000 nanoERG → "8.995"; 100 000 000 → "0.10"; 3 400 raw USE (3 dp) → "3.40". */
export const amount = (raw: bigint, decimals: number, min = 2): string => units(raw, decimals, dpFor(raw, decimals, min));
export const ergs = (nano: bigint, min = 2): string => amount(nano, 9, min);

/** Russian prose keeps a decimal comma (CONTENT_API §1); figures in cards and tables keep the dot. */
export const proseNum = (s: string, lang: Lang): string => (lang === "ru" ? s.replace(/(\d)\.(\d)/g, "$1,$2") : s);

/** Unit label of a token, told apart by id (never by name): the look-alike is always marked as a test token. */
export function tokenUnit(kind: TokenKind | "erg", lang: Lang): string {
  if (kind === "erg") return "ERG";
  if (kind === "use") return "USE";
  if (kind === "use-lookalike") return lang === "ru" ? "«USE» (тест)" : "“USE” (test)";
  return lang === "ru" ? "токен" : "token";
}

export const tokenStr = (t: Pick<TokenAmount, "amount" | "decimals" | "kind">, lang: Lang): string =>
  `${amount(t.amount, t.decimals)}${NBSP}${tokenUnit(t.kind, lang)}`;

const MONTHS: Record<Lang, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  ru: ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"],
};

/** "10 Nov 2026" / "10 ноя 2026" (UTC). */
export function date(iso: string | null | undefined, lang: Lang, year = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${d.getUTCDate()}${NBSP}${MONTHS[lang][d.getUTCMonth()]}${year ? `${NBSP}${d.getUTCFullYear()}` : ""}`;
}
/** "10 Nov 2026 · 21:06 UTC". */
export function dateTime(iso: string | null | undefined, lang: Lang): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${date(iso, lang)} · ${hh}:${mm}${NBSP}UTC`;
}
/** "Nov 2026" axis label. */
// Month names on an axis stand alone (nominative in Russian: «май», not «мая»).
const MONTHS_ALONE: Record<Lang, string[]> = { en: MONTHS.en, ru: ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"] };
/** Month tick label; the year is added in January and, with `withYear`, on the first tick of an axis. */
export function monthLabel(ms: number, lang: Lang, withYear = false): string {
  const d = new Date(ms);
  return `${MONTHS_ALONE[lang][d.getUTCMonth()]}${withYear || d.getUTCMonth() === 0 ? ` ${d.getUTCFullYear()}` : ""}`;
}

export const blocks = (n: number, lang: Lang): string => blk(n, lang);
export const approx = (n: number, lang: Lang): string => humanTime(n, lang);
export const blocksApprox = (n: number, lang: Lang): string => `${blk(n, lang)} · ${humanTime(n, lang)}`;
export const height = (h: number): string => int(h);

/** A shortened id never splits across lines: a word joiner after the ellipsis (UAX #14 allows a break after "…"). */
const keep = (s: string): string => s.replace("…", "…\u2060");
export const sid = (h: string | null | undefined, a = 4, b = 4): string => (h ? keep(short(h, a, b)) : "—");
/** Short address: first 6 + … + last 4. */
export const sAddr = (a: string | null | undefined): string => (a ? keep(short(a, 6, 4)) : "—");

/** Public key behind a P2PK address (for its seal), else null. */
export function keyOfAddress(addr: string | null | undefined): Hex | null {
  if (!addr) return null;
  try {
    const p = parseAddress(addr);
    return p.type === "P2PK" && p.content.length === 66 ? p.content : null;
  } catch {
    return null;
  }
}

/** Block → approximate UTC time, anchored on a known (height, time) pair, 120 s per block. */
export function timeOfHeight(h: number, anchor: { height: number; at: string }): number {
  return Date.parse(anchor.at) + (h - anchor.height) * 120_000;
}

export const byValueDesc = <T extends { value: bigint }>(a: T, b: T) => (b.value > a.value ? 1 : b.value < a.value ? -1 : 0);
