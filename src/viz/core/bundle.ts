// House typography for the viz bundles (VISUAL §4.3): digit groups with U+2009 U+2060, NBSP between a number and
// its unit, curly quotes / «ёлочки», RU short words kept with the next word. Uses the content module's `typo`,
// so the X-rays and the prose follow one rule set.
import type { Dict, I18nBundle } from "@/app/types";
import { typo } from "@/content/types";

function apply(d: Partial<Dict>, lang: "en" | "ru"): Partial<Dict> {
  const out: Partial<Dict> = {};
  for (const [k, v] of Object.entries(d)) if (typeof v === "string") out[k] = typo(v, lang);
  return out;
}

export function vizBundle(b: I18nBundle): I18nBundle {
  return { en: apply(b.en, "en") as Dict, ru: apply(b.ru, "ru") };
}
