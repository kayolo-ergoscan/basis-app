// Reading time of the read pages, from the content they render (labs carry a fixed estimate in pages.ts).
import { chapters, historyEvents, trust, type Text } from "@/content";
import type { Lang } from "@/app/types";
import { LEARN_PAGES, readingMinutes, type LearnPageId } from "./pages";

function texts(lang: Lang, items: (Text | undefined)[]): string[] {
  return items.filter((x): x is Text => !!x).map((x) => x[lang]);
}

const cache = new Map<string, number>();

export function pageMinutes(id: LearnPageId, lang: Lang): number | null {
  const key = id + lang;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const page = LEARN_PAGES.find((p) => p.id === id)!;
  let n: number | null = page.labMinutes ?? null;
  if (id === "how") {
    // the figures are worth about half a minute each
    n = readingMinutes(texts(lang, chapters.flatMap((c) => [c.title, c.lede, ...c.body, c.fact])), lang, chapters.length * 0.5);
  } else if (id === "trust") {
    const items = [
      ...trust.tracker.can, ...trust.tracker.cannot, ...trust.issuer.can, ...trust.issuer.cannot,
    ].flatMap((x) => [x.text, x.detail]);
    n = readingMinutes(
      texts(lang, [
        trust.lede, ...items, ...trust.holder.can, ...trust.enforcement.contract, ...trust.enforcement.tracker,
        ...trust.enforcement.wallet, ...trust.enforcement.nobody, trust.status.text,
        ...trust.openIssues.flatMap((x) => [x.title, x.text, x.impact]), ...trust.reviews.flatMap((x) => [x.title, x.text]),
      ]),
      lang,
    );
  } else if (id === "history") {
    n = readingMinutes(texts(lang, historyEvents.flatMap((e) => [e.title, e.text])), lang);
  }
  if (n !== null) cache.set(key, n);
  return n;
}

/** Minutes for the whole book (read and lab pages; reference pages are looked up, not read). */
export function bookMinutes(lang: Lang): number {
  let n = 0;
  for (const p of LEARN_PAGES) if (p.kind !== "reference") n += pageMinutes(p.id, lang) ?? 0;
  return n;
}
