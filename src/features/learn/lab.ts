// Sandbox helpers shared by the Learn labs: the real Ergo AVL+ backend (WebAssembly, loaded once, lazily), the lab
// cast and a few sandbox constants. Lab keys are derived from public names (src/viz/core/lab.ts): play money only.
import { useEffect, useState } from "react";
import { DEFAULT_GENESIS_HEIGHT, getAvlBackend, type AvlBackend } from "@/protocol";

/** First block of every sandbox economy. */
export const LAB_HEIGHT = DEFAULT_GENESIS_HEIGHT;

let pending: Promise<{ backend: AvlBackend; real: boolean }> | null = null;

/** The real Ergo AVL+ backend (ergo_avltree_rust compiled to WebAssembly); the simulated one if it cannot load. */
export function loadAvl(): Promise<{ backend: AvlBackend; real: boolean }> {
  if (!pending) {
    pending = (async () => {
      try {
        const m = await import("@/protocol/avl-wasm");
        return { backend: await m.loadErgoAvlBackend(), real: true };
      } catch {
        return { backend: getAvlBackend(), real: false };
      }
    })();
  }
  return pending;
}

/** null while loading. */
export function useAvl(enabled = true): { backend: AvlBackend; real: boolean } | null {
  const [state, setState] = useState<{ backend: AvlBackend; real: boolean } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void loadAvl().then((s) => { if (live) setState(s); });
    return () => { live = false; };
  }, [enabled]);
  return state;
}

/** Runs heavy sandbox work after the current frame so a click paints its pressed state first. */
export function later<T>(fn: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    requestAnimationFrame(() => window.setTimeout(() => { try { resolve(fn()); } catch (e) { reject(e); } }, 0));
  });
}

/** True once the element has come within `margin` of the viewport (for lazy figures). */
export function useNear<T extends Element>(ref: React.RefObject<T>, margin = "400px"): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, margin, near]);
  return near;
}
