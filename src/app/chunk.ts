// Lazy chunks that a page switch can load ahead (src/app/motion.ts): a chunk loads once, remembers its module, and
// lazyChunk() renders an already loaded chunk at once, without a Suspense fallback (React.lazy accepts any thenable; a
// thenable that answers synchronously resolves the lazy component in the same render). So a switch whose chunks are
// loaded first never shows a loader frame or a half-built page.
import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/** Something a view needs before it can render in full: a code chunk, or a data snapshot. */
export interface Part {
  ready(): boolean;
  load(): Promise<unknown>;
  /** Data, not code: loaded for a switch, never ahead of one (src/app/routes.ts warmPath). */
  data?: boolean;
}
export interface Chunk<M> extends Part {
  get(): M | undefined;
  load(): Promise<M>;
}

/** One lazily imported module. A failed load can be tried again. */
export function chunk<M>(loader: () => Promise<M>): Chunk<M> {
  let mod: M | undefined;
  let p: Promise<M> | null = null;
  return {
    ready: () => mod !== undefined,
    get: () => mod,
    load: () => (p ??= loader().then((m) => (mod = m), (e: unknown) => { p = null; throw e; })),
  };
}

/** A data part, ready once its promise has resolved (a snapshot, the wallet's storage). */
export function part(loader: () => Promise<unknown>): Part {
  let done = false;
  let p: Promise<unknown> | null = null;
  return {
    data: true,
    ready: () => done,
    load: () => (p ??= loader().then((v) => { done = true; return v; }, (e: unknown) => { p = null; throw e; })),
  };
}

/** Loads the parts that are not ready (data parts only when `code` is false); null when there is nothing to load. */
export function loadParts(parts: readonly Part[], code = false): Promise<unknown> | null {
  const missing = parts.filter((p) => !p.ready() && !(code && p.data));
  return missing.length ? Promise.all(missing.map((p) => p.load())) : null;
}

type Mod<P> = { default: ComponentType<P> };
/** React.lazy over a chunk: renders at once when the chunk is already loaded, else suspends as React.lazy does. */
export function lazyChunk<P = object>(c: Chunk<Mod<P>>): LazyExoticComponent<ComponentType<P>> {
  return lazy(() => {
    const m = c.get();
    if (m) return { then: (ok: (v: Mod<P>) => void) => ok(m) } as unknown as Promise<Mod<P>>;
    return c.load();
  });
}
