// Language for the viz components: a thin layer over the shell's i18n runtime (src/app/lang.tsx merges every
// src/**/i18n.ts, ours included). Kept as one import point so the X-rays can also translate outside React
// (event descriptions, findings) and tests can read the viz bundles alone.

import { useCallback } from "react";
import { lookup, setLang, translate as shellTranslate, useLang } from "@/app/lang";
import { reasonFor } from "@/content/reasons";
import type { Dict, I18nBundle } from "@/app/types";
import type { VizLang } from "./format";

const modules = import.meta.glob<{ default: I18nBundle }>("/src/viz/**/i18n.ts", { eager: true });

/** The viz bundles alone (tests check RU coverage and copy rules on them). */
export function vizKeys(): { en: Dict; ru: Partial<Dict> } {
  const en: Dict = {};
  const ru: Partial<Dict> = {};
  for (const m of Object.values(modules)) {
    Object.assign(en, m.default.en);
    Object.assign(ru, m.default.ru);
  }
  return { en, ru };
}

/** Switches the app language (the showcase's own switch, tests). */
export function setVizLang(lang: VizLang): void {
  setLang(lang);
}

export function useVizLang(): VizLang {
  return useLang().lang;
}

export type TFn = (key: string, vars?: Record<string, string | number>) => string;

/** Translate outside React for a given language. */
export function translate(lang: VizLang, key: string, vars?: Record<string, string | number>): string {
  return shellTranslate(key, vars, lang);
}

export function useVizT(): TFn {
  const lang = useVizLang();
  return useCallback((key: string, vars?: Record<string, string | number>) => shellTranslate(key, vars, lang), [lang]);
}

/** Picks the current language from an inline { en, ru } pair (content data, annotations). */
export function pick(lang: VizLang, v: string | { en: string; ru?: string } | undefined | null): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  return (lang === "ru" ? v.ru : undefined) ?? v.en;
}

/** Translate a key that may not exist: null instead of the key (and no missing-key warning). */
export function maybe(lang: VizLang, key: string, vars?: Record<string, string | number>): string | null {
  return lookup(key, lang) === undefined ? null : shellTranslate(key, vars, lang);
}

/**
 * A refusal or check code in words: our viz.reason / viz.check copy first, then content's reasonFor(code), then the
 * engine's own message, then the code itself.
 */
export function reasonTitle(lang: VizLang, code: string, message?: string): string {
  return maybe(lang, `viz.reason.${code}`) ?? maybe(lang, `viz.check.${code}`) ?? (reasonFor(code) ? pick(lang, reasonFor(code)!.title) : null) ?? message ?? code;
}

/** The longer explanation of a code (content's reasonFor text, then our check "why"), or null. */
export function reasonText(lang: VizLang, code: string): string | null {
  const r = reasonFor(code);
  return r ? pick(lang, r.text) : maybe(lang, `viz.check.${code}.why`);
}
