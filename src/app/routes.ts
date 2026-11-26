// Feature discovery: every src/features/<id>/route.tsx default-exports a FeatureRoute (see types.ts). Route modules are
// eager (tiny: ids, paths, labels); pages are lazy chunks loaded on first visit, or ahead of a switch (warmPath).
import type { ComponentType, LazyExoticComponent } from "react";
import { chunk, lazyChunk, type Chunk, type Part } from "./chunk";
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

/** The base of a route ("/play/*" → "/play"): what its pages start with. */
export const hrefOf = (r: FeatureRoute) => r.path.replace(/\/\*$/, "") || "/";
/** Where the menu links to: the route's own `href` (the wallet → its mainnet tab), else its base. */
export const linkOf = (r: FeatureRoute) => r.href ?? hrefOf(r);

const chunks = new Map<string, Chunk<{ default: ComponentType }>>();
const chunkOf = (r: FeatureRoute) => { let c = chunks.get(r.id); if (!c) { c = chunk(r.load); chunks.set(r.id, c); } return c; };
const lazies = new Map<string, LazyExoticComponent<ComponentType>>();
/** One lazy page per feature (stable across renders); an already loaded chunk renders without a fallback. */
export function pageOf(r: FeatureRoute): LazyExoticComponent<ComponentType> {
  let c = lazies.get(r.id);
  if (!c) { c = lazyChunk(chunkOf(r)); lazies.set(r.id, c); }
  return c;
}
/** Warm a feature chunk (on nav hover / focus). */
export const preload = (r: FeatureRoute) => { void chunkOf(r).load().catch(() => {}); };

/** What a path needs before its view can render in full (the feature chunk, then the feature's own parts for that
 *  path); null when everything is here already. `code`: code chunks only, no data (a pointer resting on a link loads
 *  code ahead; data, such as opening the wallet's storage, waits for the switch itself). */
export function warmPath(pathname: string, code = false): Promise<unknown> | null {
  const r = routeFor(pathname);
  if (!r) return null;
  return loadParts([chunkOf(r), ...(r.parts?.(pathname) ?? [])], code);
}

/** Loads the parts that are not ready (data parts only when `code` is false); null when there is nothing to load. */
export function loadParts(parts: readonly Part[], code = false): Promise<unknown> | null {
  const missing = parts.filter((p) => !p.ready() && !(code && p.data));
  return missing.length ? Promise.all(missing.map((p) => p.load())) : null;
}

/** The route a pathname belongs to (for titles and the active nav link). */
export function routeFor(pathname: string): FeatureRoute | undefined {
  return ROUTES.find((r) => {
    const base = hrefOf(r);
    if (r.path === "/") return pathname === "/";
    return pathname === base || pathname.startsWith(base + "/");
  });
}
