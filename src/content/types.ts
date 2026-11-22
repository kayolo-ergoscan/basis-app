// Shared shapes and typography for src/content. No React here: pages import these modules and render them.
//
// Every human-readable string is a `Text` ({ en, ru }). Build it with `t()` so both languages get the house
// typography (VISUAL §4.3): thin space + word joiner as the thousands separator ("43 200"), NBSP between a number
// and its unit ("0.1 ERG", "60 дней"), NBSP before an em dash, curly quotes in EN and «ёлочки» in RU.
//
// Authoring shorthand understood by `typo()`:
//   "43 200"      → digits grouped with U+2009 U+2060 (never breaks)
//   "150 %"       → U+2009 U+2060 before the percent sign
//   "3 days"      → NBSP between a number and the next word
//   "~"           → an explicit NBSP where the automatic rules do not reach
//   "..."         → "…"
//   "a" quotes    → “a” (EN) or «a» (RU)
//
// Copy guard: the words listed in `FORBIDDEN` (content.test.ts) may appear only inside an explicit
// "this is NOT …" sentence built with `denial()`. The test checks that every such sentence carries a negation.

import type { Lang } from "@/app/types";

export type { Lang };

/** One string in both languages. */
export interface Text {
  en: string;
  ru: string;
}

export const NBSP = " ";
/** Thin space + word joiner: the VISUAL §4.3 thousands separator (also used before %). */
export const THIN = " ⁠";

const RU_SHORT_WORDS = /(^|[\s(«„—–])(в|В|и|И|к|К|с|С|у|У|о|О|а|А|я|Я|не|Не|ни|Ни|но|Но|на|На|по|По|за|За|из|Из|от|От|до|До|об|Об|во|Во|ко|Ко|со|Со|же|ли) (?=[^\s—–])/g;

export interface TypoOptions {
  /** Convert straight quotes and apostrophes (prose). Off for mono protocol facts. */
  quotes?: boolean;
}

/** House typography for one language. Idempotent. */
export function typo(input: string, lang: Lang, o: TypoOptions = {}): string {
  const quotes = o.quotes ?? true;
  let s = input.replace(/~/g, NBSP).replace(/\.\.\./g, "…");
  // thousands: "1 750 639" → grouped with THIN (repeat for long numbers)
  for (let i = 0; i < 4; i++) s = s.replace(/(\d) (\d{3})(?!\d)/g, `$1${THIN}$2`);
  // percent
  s = s.replace(/(\d)[  ]%/g, `$1${THIN}%`);
  // number + following word, unit or ≈
  s = s.replace(/(\d) (?=[\p{L}≈×])/gu, `$1${NBSP}`);
  s = s.replace(/≈ /g, `≈${NBSP}`);
  s = s.replace(/ — /g, `${NBSP}— `);
  if (lang === "ru") {
    // keep short prepositions and conjunctions with the next word (two passes for "и в …")
    s = s.replace(RU_SHORT_WORDS, `$1$2${NBSP}`).replace(RU_SHORT_WORDS, `$1$2${NBSP}`);
  }
  if (quotes) {
    s = lang === "ru" ? s.replace(/"([^"]*)"/g, "«$1»") : s.replace(/"([^"]*)"/g, "“$1”");
    s = s.replace(/(\p{L})'(\p{L})/gu, "$1’$2");
    if (lang === "en") s = s.replace(/(\s|^)'([^']*)'/g, "$1‘$2’");
  }
  return s;
}

/** A bilingual prose string with house typography. `ru` is required: there is no fallback to EN. */
export function t(en: string, ru: string): Text {
  return { en: typo(en, "en"), ru: typo(ru, "ru") };
}

/** A mono protocol fact (formulas, constants, register names). Grouping and NBSP apply, quotes are left alone. */
export function fact(en: string, ru: string = en): Text {
  return { en: typo(en, "en", { quotes: false }), ru: typo(ru, "ru", { quotes: false }) };
}

const denials = new Set<string>();

/**
 * copy-guard: denial — an explicit "this is NOT …" sentence. Only strings built here may contain a forbidden word
 * (trustless, guaranteed, safe, launched, official, "2 %", "7 days", bearer, …), and the sentence holding the word
 * must contain a negation (not / no / never / nothing / none / n't · не / нет / ни / никогда / ничего / без).
 */
export function denial(en: string, ru: string): Text {
  const text = t(en, ru);
  denials.add(text.en);
  denials.add(text.ru);
  return text;
}

/** Strings registered by `denial()` (read by the copy-guard test). */
export const DENIALS: ReadonlySet<string> = denials;

/** Pick one language. */
export function pick(text: Text, lang: Lang): string {
  return text[lang];
}

/** A contract source range, 1-based and inclusive, as the X-ray highlights it. */
export interface LineRange {
  from: number;
  to: number;
  /** Action whose branch this range belongs to, when the same check appears in several branches. */
  action?: 0 | 1 | 2 | 3;
}

export type ContractId = "basis" | "token";

/** A pointer into one of the two contracts. */
export interface LineRef {
  contract: ContractId;
  from: number;
  to: number;
}

/** An on-chain object to link (pages build the ergoscan.me URL with the chain module's link helper). */
export interface ChainRef {
  kind: "tx" | "box" | "token" | "address";
  id: string;
  height?: number;
  label?: Text;
}

/** Figure ids suggested for chapters and moments. Pages map them to components; unknown ids render nothing. */
export type FigureId =
  | "note-odometer"
  | "signature-grid"
  | "tracker-ladder"
  | "digest-pulse"
  | "reserve-registers"
  | "money-spectrum"
  | "contract-xray"
  | "emergency-dial"
  | "exit-timeline"
  | "clearing-loop"
  | "two-stamps"
  | "reserve-coin"
  | "tear-off";

/** In-app routes that content may link to (PRODUCT §2). */
export type AppRoute =
  | "/"
  | "/play"
  | `/play/${string}`
  | "/wallet"
  | `/wallet/${string}`
  | "/network"
  | `/network/${string}`
  | "/tracker"
  | `/tracker/${string}`
  | "/learn"
  | `/learn/${string}`;

export interface InternalLink {
  label: Text;
  to: AppRoute;
}
