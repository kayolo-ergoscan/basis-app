// Feature discovery: every src/features/<id>/route.tsx default-exports a FeatureRoute (see types.ts). Route modules are
// eager (tiny: ids, paths, labels); pages are lazy chunks loaded on first visit.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { FeatureRoute } from "./types";

const mods = import.meta.glob<{ default: FeatureRoute }>("/src/features/*/route.tsx", { eager: true });

export const ROUTES: FeatureRoute[] = Object.entries(mods)
  .map(([file, m]) => {
    const r = m?.default;
    if (!r || typeof r.load !== "function" || typeof r.path !== "string") {
      if (import.meta.env.DEV) console.warn(`[routes] ${file} has no valid default FeatureRoute`);
      return null;
    }
    return r;
  })
  .filter((r): r is FeatureRoute => !!r)
  // more specific paths first; "/" last among equals
  .sort((a, b) => (a.path === "/" ? 1 : b.path === "/" ? -1 : b.path.length - a.path.length));

/** Nav entries sorted by order (0 Story … 5 Learn). */
export const NAV = ROUTES.filter((r) => r.nav).sort((a, b) => a.nav!.order - b.nav!.order);

/** The link target of a route ("/play/*" → "/play"). */
export const hrefOf = (r: FeatureRoute) => r.path.replace(/\/\*$/, "") || "/";

const lazies = new Map<string, LazyExoticComponent<ComponentType>>();
/** One React.lazy per feature (stable across renders). */
export function pageOf(r: FeatureRoute): LazyExoticComponent<ComponentType> {
  let c = lazies.get(r.id);
  if (!c) { c = lazy(r.load); lazies.set(r.id, c); }
  return c;
}
/** Warm a feature chunk (on nav hover / focus). */
export const preload = (r: FeatureRoute) => { void r.load().catch(() => {}); };

/** The route a pathname belongs to (for titles and the active nav link). */
export function routeFor(pathname: string): FeatureRoute | undefined {
  return ROUTES.find((r) => {
    const base = hrefOf(r);
    if (r.path === "/") return pathname === "/";
    return pathname === base || pathname.startsWith(base + "/");
  });
}
