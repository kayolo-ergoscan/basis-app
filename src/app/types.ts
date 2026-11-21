// Shared contracts between the shell (src/app) and the feature folders (src/features/<id>).
// Owned by the orchestrator. Do not change the shapes without the orchestrator; additive optional fields are OK.
import type { ComponentType } from "react";

/** Every feature folder exports one of these as the default export of `src/features/<id>/route.tsx`.
 *  The shell discovers them with import.meta.glob("/src/features/* /route.tsx", { eager: true }) — no shared file to edit. */
export interface FeatureRoute {
  /** Folder name, e.g. "play". */
  id: string;
  /** React-router path pattern, e.g. "/play/*" (use "/*" suffix when the feature has sub-routes). Home is "/". */
  path: string;
  /** Lazy page: () => import("./Page") with a default-exported component. The shell wraps it in <Suspense>. */
  load: () => Promise<{ default: ComponentType }>;
  /** Top navigation entry; null = not in the nav (detail pages, dev pages). order: 0 Story, 1 Play, 2 Wallet, 3 Network, 4 Tracker, 5 Learn. */
  nav: { order: number; labelKey: string; icon?: string; mobile?: boolean } | null;
  /** Command palette entries (⌘K). Labels are i18n keys. */
  commands?: { id: string; labelKey: string; to: string; keywords?: string }[];
  /** Page <title> i18n key (the shell sets document.title = t(titleKey) + " · Basis"). */
  titleKey?: string;
}

/** Flat dictionaries. Every key is prefixed by its owner: "nav.", "app.", "ui." (shell/ui), "<featureId>." (features), "content." (src/content).
 *  Each owner keeps its own file `i18n.ts` exporting `default { en: {...}, ru: {...} } satisfies I18nBundle`.
 *  The shell merges all bundles found by import.meta.glob("/src/** /i18n.ts", { eager: true }). Missing ru → falls back to en. */
export type Lang = "en" | "ru";
export type Dict = Record<string, string>;
export interface I18nBundle { en: Dict; ru: Partial<Dict> }
