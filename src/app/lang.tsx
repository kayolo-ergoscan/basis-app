// i18n runtime. Bundles: every src/**/i18n.ts exports `default { en, ru } satisfies I18nBundle`; they are merged here.
// Language: localStorage "basis.lang", else navigator.language (ru* → RU), else EN. Missing RU keys fall back to EN,
// missing keys render as the key itself. Interpolation: "{name}". Plurals: tp(key, n) looks up key_one / key_few /
// key_many / key_other via Intl.PluralRules. Rich text: <T k="…"/> turns **bold**, *italic* and {var} into nodes.
import { Fragment, useMemo, useSyncExternalStore, type ReactNode } from "react";
import type { Dict, I18nBundle, Lang } from "./types";

const mods = import.meta.glob<{ default: I18nBundle }>("/src/**/i18n.ts", { eager: true });
const EN: Dict = {};
const RU: Partial<Dict> = {};
for (const m of Object.values(mods)) {
  const b = m?.default;
  if (!b) continue;
  Object.assign(EN, b.en);
  Object.assign(RU, b.ru);
}

/** Merge a bundle at runtime. For big string tables that only a lazy page needs (they stay out of the main chunk):
 *  keep the nav / title / command keys in the eager i18n.ts and call addI18n(strings) at the top level of the lazy
 *  page module, so the strings are in place before that page renders. */
export function addI18n(b: I18nBundle) {
  Object.assign(EN, b.en);
  Object.assign(RU, b.ru);
}

const KEY = "basis.lang";
function initial(): Lang {
  try { const s = localStorage.getItem(KEY); if (s === "en" || s === "ru") return s; } catch { /* ignore */ }
  const nav = (typeof navigator !== "undefined" && ((navigator.languages && navigator.languages[0]) || navigator.language)) || "en";
  return nav.toLowerCase().startsWith("ru") ? "ru" : "en";
}

let lang: Lang = typeof window === "undefined" ? "en" : initial();
const subs = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = lang;

export function getLang(): Lang { return lang; }
export function setLang(l: Lang) {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  if (typeof document !== "undefined") document.documentElement.lang = l;
  for (const f of [...subs]) f();
}
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

export type Vars = Record<string, string | number>;
const warned = new Set<string>();

/** Raw lookup with RU → EN fallback. */
export function lookup(key: string, l: Lang = lang): string | undefined {
  return (l === "ru" ? RU[key] : undefined) ?? EN[key];
}
function interp(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Translate outside React (uses the current language). */
export function translate(key: string, vars?: Vars, l: Lang = lang): string {
  const s = lookup(key, l);
  if (s == null) {
    if (import.meta.env.DEV && !warned.has(key)) { warned.add(key); console.warn(`[i18n] missing key: ${key}`); }
    return key;
  }
  return interp(s, vars);
}

const rules: Record<Lang, Intl.PluralRules> = { en: new Intl.PluralRules("en"), ru: new Intl.PluralRules("ru") };
/** Plural lookup: key_one | key_few | key_many | key_other, then key. {n} is available in the string. */
export function translatePlural(key: string, n: number, vars?: Vars, l: Lang = lang): string {
  const cat = rules[l].select(n);
  const k = [`${key}_${cat}`, `${key}_other`, key].find((x) => lookup(x, l) != null) ?? key;
  return translate(k, { n, ...vars }, l);
}

export interface TFn {
  (key: string, vars?: Vars): string;
  /** Plural form for n. */
  p(key: string, n: number, vars?: Vars): string;
  /** True when the key exists (in this language or EN). */
  has(key: string): boolean;
  lang: Lang;
}

/** React: the translate function for the current language (re-renders on language change). */
export function useT(): TFn {
  const l = useSyncExternalStore(subscribe, () => lang, () => lang);
  return useMemo(() => {
    const t = ((key: string, vars?: Vars) => translate(key, vars, l)) as TFn;
    t.p = (key, n, vars) => translatePlural(key, n, vars, l);
    t.has = (key) => lookup(key, l) != null;
    t.lang = l;
    return t;
  }, [l]);
}

/** React: { lang, setLang, toggle }. */
export function useLang(): { lang: Lang; setLang: (l: Lang) => void; toggle: () => void } {
  const l = useSyncExternalStore(subscribe, () => lang, () => lang);
  return { lang: l, setLang, toggle: () => setLang(l === "en" ? "ru" : "en") };
}

/** Rich text: **bold**, *italic*, `mono` and {var} (vars may be React nodes). */
export function rich(s: string, vars?: Record<string, ReactNode>): ReactNode {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|\{(\w+)\}/g;
  let last = 0, m: RegExpExecArray | null, i = 0;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] != null) out.push(<b key={i++}>{rich(m[1], vars)}</b>);
    else if (m[2] != null) out.push(<em key={i++}>{rich(m[2], vars)}</em>);
    else if (m[3] != null) out.push(<span key={i++} className="mono">{m[3]}</span>);
    else if (m[4] != null) out.push(<Fragment key={i++}>{vars && m[4] in vars ? vars[m[4]] : m[0]}</Fragment>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length === 1 ? out[0] : <>{out}</>;
}

/** <T k="home.lede" vars={{ total: <Num value={1240} /> }} /> */
export function T({ k, vars }: { k: string; vars?: Record<string, ReactNode> }) {
  const t = useT();
  const raw = lookup(k, t.lang) ?? k;
  return <>{rich(raw, vars)}</>;
}

/** Every merged key (for the /kit i18n table and tests). */
export const i18nKeys = (): { en: number; ru: number } => ({ en: Object.keys(EN).length, ru: Object.keys(RU).length });
