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
  /** Lazy page: () => import("./Page") with a default-exported component. The shell wraps it in <Suspense>. The module
   *  may also export `warm` (see FeatureModule): what a path needs besides the module itself. */
  load: () => Promise<FeatureModule>;
  /** Where the menu and the ⌘K "go" entry link to, when it is not the path's base (the wallet opens its mainnet tab). */
  href?: string;
  /** Top navigation entry; null = not in the nav (detail pages, dev pages). order: 0 Story, 1 Play, 2 Wallet, 3 Network, 4 Tracker, 5 Learn. */
  nav: { order: number; labelKey: string; icon?: string; mobile?: boolean } | null;
  /** Command palette entries (⌘K). Labels are i18n keys. */
  commands?: { id: string; labelKey: string; to: string; keywords?: string }[];
  /** Page <title> i18n key (the shell sets document.title = t(titleKey) + " · Basis"). */
  titleKey?: string;
}

/** A feature's lazy page module. `warm(pathname, code)`: loads what that path needs besides this module (its own lazy
 *  sub-pages; data such as a snapshot, unless `code`), or null when all of it is here; a page switch waits for it, so
 *  the new view renders in full at once (src/app/motion.ts). It lives in the lazy module, so the shell's first chunk
 *  carries none of it. */
export interface FeatureModule {
  default: ComponentType;
  warm?: (pathname: string, code: boolean) => Promise<unknown> | null;
}

/** Flat dictionaries. Every key is prefixed by its owner: "nav.", "app.", "ui." (shell/ui), "<featureId>." (features), "content." (src/content).
 *  Each owner keeps its own file `i18n.ts` exporting `default { en: {...}, ru: {...} } satisfies I18nBundle`.
 *  The shell merges all bundles found by import.meta.glob("/src/** /i18n.ts", { eager: true }). Missing ru → falls back to en. */
export type Lang = "en" | "ru";
export type Dict = Record<string, string>;
export interface I18nBundle { en: Dict; ru: Partial<Dict> }
