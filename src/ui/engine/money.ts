// Number formatting (VISUAL §4.3). Locale-independent on purpose: EN and RU use the same separators.
//   thousands: U+2009 thin space + U+2060 word joiner ("1 240.00", never breaks, never U+202F)
//   minus:     U+2212; "+" only for amounts in your favour
//   percent:   "132 %" (thin space + joiner); units after U+00A0 ("500.00 ERG", "37 blk")

export const THIN = " ⁠";
export const NBSP = " ";
export const MINUS = "−";
export const ELLIPSIS = "…";

export type FmtLang = "en" | "ru";

const group = (i: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);

/** money(1240) → "1 240.00"; money(-320) → "−320.00"; money(0.0004, 4) → "0.0004". (Port of the tile's money.) */
export function money(n: number, dp = 2): string {
  const [i, f] = Math.abs(n).toFixed(dp).split(".");
  return (n < 0 ? MINUS : "") + group(i) + (dp ? "." + f : "");
}

/** Integer with thousands separators: int(1921400) → "1 921 400". */
export const int = (n: number): string => money(Math.round(n), 0);

/** Exact formatting of integer units (nanoERG, token units) with `decimals`, rounded half-up to `dp` places.
 *  units(1240_000_000_000n, 9) → "1 240.00". dp defaults to 2 (UI); pass dp = decimals for the machine face. */
export function units(v: bigint, decimals: number, dp = 2): string {
  const neg = v < 0n;
  let a = neg ? -v : v;
  let shown = dp;
  if (dp < decimals) {
    const div = 10n ** BigInt(decimals - dp);
    const q = a / div, r = a % div;
    a = r * 2n >= div ? q + 1n : q;
  } else {
    a = a * 10n ** BigInt(dp - decimals);
  }
  const s = a.toString().padStart(shown + 1, "0");
  const i = s.slice(0, s.length - shown), f = s.slice(s.length - shown);
  return (neg && a !== 0n ? MINUS : "") + group(i) + (shown ? "." + f : "");
}

/** nanoERG → "1 240.00" (2 dp). */
export const erg = (nano: bigint, dp = 2): string => units(nano, 9, dp);

export type SignMode = "auto" | "favour" | "owe" | "none";
/** Signed amount. favour → "+1 240.00" (the only place "+" appears); owe → "−320.00"; auto → "−" for negatives only. */
export function signed(n: number, dp = 2, mode: SignMode = "auto"): string {
  const abs = money(Math.abs(n), dp);
  if (mode === "favour") return (n === 0 ? "" : "+") + abs;
  if (mode === "owe") return (n === 0 ? "" : MINUS) + abs;
  if (mode === "none") return abs;
  return (n < 0 ? MINUS : "") + abs;
}

/** Percent from a percent value: pct(132) → "132 %"; pct(0.42) → "0.4 %" (one decimal below 1 %). */
export function pct(percent: number): string {
  if (!Number.isFinite(percent)) return "∞" + THIN + "%";
  const a = Math.abs(percent);
  const s = a > 0 && a < 1 ? (Math.round(percent * 10) / 10).toFixed(1) : money(Math.round(percent), 0);
  return s.replace("-", MINUS) + THIN + "%";
}
/** Percent from a ratio: ratioPct(1.32) → "132 %". */
export const ratioPct = (ratio: number): string => pct(ratio * 100);

/** A number followed by a unit after a no-break space: unit("500.00", "ERG") → "500.00 ERG". */
export const withUnit = (value: string, u: string): string => value + NBSP + u;

const BLK: Record<FmtLang, string> = { en: "blk", ru: "блк" };
/** blk(2160) → "2 160 blk" (RU "2 160 блк"). */
export const blk = (n: number, lang: FmtLang = "en"): string => withUnit(int(n), BLK[lang]);

/** Minutes per Ergo block (VISUAL §4.3: 1 block ≈ 2 min). */
export const MIN_PER_BLOCK = 2;

const pluralRu = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};
const UNITS: Record<FmtLang, { min: string; h: string; d: string; days: (n: number) => string }> = {
  en: { min: "min", h: "h", d: "d", days: (n) => (n === 1 ? "day" : "days") },
  ru: { min: "мин", h: "ч", d: "д", days: (n) => pluralRu(n, "день", "дня", "дней") },
};

/** Human time of a block count, blocks × 2 min: 37 → "≈ 1 h 14 min"; 1348 → "≈ 1 d 21 h"; 2160 → "≈ 3 days"; 43200 → "≈ 60 days". */
export function humanTime(blocks: number, lang: FmtLang = "en"): string {
  const U = UNITS[lang];
  const mins = Math.max(0, Math.round(blocks)) * MIN_PER_BLOCK;
  if (mins < 60) return `≈${NBSP}${mins}${NBSP}${U.min}`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60), m = mins % 60;
    return `≈${NBSP}${h}${NBSP}${U.h}` + (m ? ` ${m}${NBSP}${U.min}` : "");
  }
  if (mins < 7 * 24 * 60) {
    let d = Math.floor(mins / 1440), h = Math.round((mins - d * 1440) / 60);
    if (h === 24) { d += 1; h = 0; }
    return h ? `≈${NBSP}${d}${NBSP}${U.d} ${h}${NBSP}${U.h}` : `≈${NBSP}${d}${NBSP}${U.days(d)}`;
  }
  const d = Math.round(mins / 1440);
  return `≈${NBSP}${int(d)}${NBSP}${U.days(d)}`;
}

/** Blocks first, then human time: "37 blk · ≈ 1 h 14 min". */
export const blocksAndTime = (blocks: number, lang: FmtLang = "en"): string => `${blk(blocks, lang)} · ${humanTime(blocks, lang)}`;

/** First a + "…" + last b hex chars: short("02d9…60b6"). */
export const short = (h: string, a = 4, b = 4): string => (h.length <= a + b + 1 ? h : h.slice(0, a) + ELLIPSIS + h.slice(-b));

/** Digest grouped by 4: groupHex(d) → "9f3c 1a2d 07be 55c0 … e1"; groupHex(d, 16, 10) → "9f3c 1a2d 07be 55c0 … 2d18 f0c7 e1". */
export function groupHex(h: string, head = 16, tail = 2): string {
  const g = (s: string) => (s.match(/.{1,4}/g) || []).join(" ");
  if (head + tail >= h.length) return g(h);
  return `${g(h.slice(0, head))} ${ELLIPSIS} ${g(h.slice(h.length - tail))}`;
}

/** Parse a typed amount ("1 240.50", "1240,5") into a number; null when it is not a number. */
export function parseMoney(s: string): number | null {
  const t = s.replace(/[\s ⁠  ]/g, "").replace(",", ".").replace(MINUS, "-");
  if (!/^-?\d*(\.\d*)?$/.test(t) || t === "" || t === "." || t === "-") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Visible glyphs of a money string (the word joiner has no width): used to size note amounts. */
export const glyphCount = (s: string): number => s.replace(/⁠/g, "").length;
