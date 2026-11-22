// The Learn book: its pages, in reading order, grouped in three parts. One table drives the index, the sticky
// contents, the prev/next pager, the ⌘K commands and the reading-time line.

export type LearnPageId = "how" | "signature" | "contract" | "avl" | "trust" | "tools" | "api" | "history" | "faq" | "glossary" | "sources";
export type LearnKind = "read" | "lab" | "reference";

export interface LearnPage {
  id: LearnPageId;
  path: `/learn/${string}`;
  part: 1 | 2 | 3;
  numeral: string;
  kind: LearnKind;
  /** Minutes for a lab (interactive pages); read pages compute it from their text. */
  labMinutes?: number;
}

export const LEARN_PAGES: LearnPage[] = [
  { id: "how", path: "/learn/how", part: 1, numeral: "I", kind: "read" },
  { id: "signature", path: "/learn/signature", part: 1, numeral: "II", kind: "lab", labMinutes: 8 },
  { id: "contract", path: "/learn/contract", part: 1, numeral: "III", kind: "lab", labMinutes: 12 },
  { id: "avl", path: "/learn/avl", part: 1, numeral: "IV", kind: "lab", labMinutes: 9 },
  { id: "trust", path: "/learn/trust", part: 2, numeral: "V", kind: "read" },
  { id: "tools", path: "/learn/tools", part: 2, numeral: "VI", kind: "lab", labMinutes: 6 },
  { id: "api", path: "/learn/api", part: 2, numeral: "VII", kind: "reference" },
  { id: "history", path: "/learn/history", part: 3, numeral: "VIII", kind: "read" },
  { id: "faq", path: "/learn/faq", part: 3, numeral: "IX", kind: "reference" },
  { id: "glossary", path: "/learn/glossary", part: 3, numeral: "X", kind: "reference" },
  { id: "sources", path: "/learn/sources", part: 3, numeral: "XI", kind: "reference" },
];

export const PARTS: { n: 1 | 2 | 3; numeral: string }[] = [
  { n: 1, numeral: "I" },
  { n: 2, numeral: "II" },
  { n: 3, numeral: "III" },
];

export function pageOf(id: LearnPageId): LearnPage {
  return LEARN_PAGES.find((p) => p.id === id)!;
}

export function neighbours(id: LearnPageId): { prev: LearnPage | null; next: LearnPage | null } {
  const i = LEARN_PAGES.findIndex((p) => p.id === id);
  return { prev: i > 0 ? LEARN_PAGES[i - 1] : null, next: i >= 0 && i < LEARN_PAGES.length - 1 ? LEARN_PAGES[i + 1] : null };
}

/** Reading speed for prose (words per minute); Russian words are longer. */
const WPM = { en: 210, ru: 170 } as const;

/** Minutes to read these strings (at least 1). */
export function readingMinutes(texts: readonly string[], lang: "en" | "ru", extra = 0): number {
  let words = 0;
  for (const s of texts) words += s.split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WPM[lang] + extra));
}

/** Play scenarios each chapter can send the reader to (ids from src/protocol SCENARIOS). */
export type ScenarioRef =
  | "cafe-on-credit"
  | "agent-swarm"
  | "village-lets"
  | "free-bank"
  | "tracker-vanishes"
  | "refund-race"
  | "triangle-novation"
  | "clearing-circle"
  | "censoring-tracker"
  | "idle-tracker"
  | "currency-exchange";
