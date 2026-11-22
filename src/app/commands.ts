// ⌘K command registry. Static commands come from FeatureRoute.commands; features can add live ones while mounted:
//   useCommands([{ id: "wallet.pay", label: "Pay Bob", run: () => open() }])
import { useEffect, useSyncExternalStore } from "react";
import type { IconName } from "@/ui/components/Icon";

export interface Command {
  id: string;
  /** Visible label (already translated). */
  label: string;
  /** Second line (mono): a path or an id. */
  sub?: string;
  /** Extra search words. */
  keywords?: string;
  group?: "go" | "actions" | "id" | "settings" | "dev" | "terms" | "faq";
  icon?: IconName;
  /** Either navigate… */
  to?: string;
  /** …or run. */
  run?: () => void;
  /** Shortcut hint shown at the right ("P"). */
  kbd?: string;
}

/** A FAQ question as the bar needs it (content `faq`: id, question, one-line answer). */
export interface FaqQuestion { id: string; q: { en: string; ru: string }; short: { en: string; ru: string } }

/** FAQ questions as commands (→ /learn/faq#q-<id>, which opens that answer): the label is the question in the reader's
 *  language; both languages and the short answer are search words, so «Nautilus» or «потерять» find their answer. */
export function faqCommands(list: readonly FaqQuestion[], lang: "en" | "ru"): Command[] {
  return list.map((f) => ({
    id: "faq." + f.id,
    label: lang === "ru" ? f.q.ru : f.q.en,
    sub: `/learn/faq#q-${f.id}`,
    to: `/learn/faq#q-${f.id}`,
    group: "faq" as const,
    icon: "learn" as const,
    keywords: `${f.q.en} ${f.q.ru} ${f.short.en} ${f.short.ru}`,
  }));
}

/** How well a command answers the query: 0 = not at all; every word must appear in its label, line, words or path. */
export function score(c: Command, q: string): number {
  if (!q) return 1;
  const hay = `${c.label} ${c.sub ?? ""} ${c.keywords ?? ""} ${c.to ?? ""}`.toLowerCase();
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.every((w) => hay.includes(w))) return 0;
  const l = c.label.toLowerCase();
  return l.startsWith(words[0]) ? 3 : l.includes(words[0]) ? 2 : 1;
}

let dynamic: Command[] = [];
const subs = new Set<() => void>();
const emit = () => { for (const f of [...subs]) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** React: add commands while the component is mounted (labels must already be translated). */
export function useCommands(cmds: Command[], deps: unknown[] = []) {
  useEffect(() => {
    dynamic = [...dynamic.filter((c) => !cmds.some((x) => x.id === c.id)), ...cmds];
    emit();
    return () => { dynamic = dynamic.filter((c) => !cmds.some((x) => x.id === c.id)); emit(); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
export const useDynamicCommands = () => useSyncExternalStore(subscribe, () => dynamic, () => dynamic);

/** Open the command bar from anywhere. */
let opener: ((q?: string) => void) | null = null;
export const setCommandOpener = (f: ((q?: string) => void) | null) => { opener = f; };
export const openCommandBar = (q?: string) => opener?.(q);

/** Open the shortcuts / display settings sheet from anywhere. */
let helpOpener: (() => void) | null = null;
export const setHelpOpener = (f: (() => void) | null) => { helpOpener = f; };
export const openHelp = () => helpOpener?.();
