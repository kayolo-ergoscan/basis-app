// The AVL backend every sandbox economy uses (town and scenario runs): the real Ergo AVL+ tree compiled to
// WebAssembly by default, the simulated map when the module cannot load. The UI shows which (AvlInfo).
//
// How the wasm is loaded (src/protocol/avl-wasm.ts, read-only): `import wasmUrl from "./avl.wasm?url"` makes
// Vite emit the module as a hashed asset (dist/assets/avl-<hash>.wasm); the browser fetches it and compiles it
// with WebAssembly.compile(bytes), so the server's MIME type does not matter. Under node (vitest) the file is
// read from disk next to the module.
import { ERGO_AVL_WASM, SIMULATED_AVL, useAvlBackend, type AvlBackend } from "@/protocol";
import { now } from "./frame";

export interface AvlInfo {
  id: string;
  /** True for the simulated map (its digests are not Ergo AVL+ bytes). Show it in the UI. */
  simulated: boolean;
  /** True when the real backend was wanted but failed to load (see `error`). */
  fallback: boolean;
  label: string;
  error: string | null;
  loadMs: number;
}

let avlPromise: Promise<{ backend: AvlBackend; info: AvlInfo }> | null = null;
let loaded: { backend: AvlBackend; info: AvlInfo } | null = null;

/** Loads the real Ergo AVL+ (wasm) once; falls back to the simulated map, with the reason, after an error or 10 s. */
export function ensureAvl(o: { timeoutMs?: number } = {}): Promise<{ backend: AvlBackend; info: AvlInfo }> {
  avlPromise ??= (async () => {
    const t0 = now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const backend = await Promise.race([
        useAvlBackend(ERGO_AVL_WASM),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("avl.wasm did not load within 10 s")), o.timeoutMs ?? 10_000);
        }),
      ]);
      loaded = { backend, info: { id: backend.id, simulated: backend.simulated, fallback: false, label: backend.label, error: null, loadMs: now() - t0 } };
    } catch (e) {
      loaded = { backend: SIMULATED_AVL, info: { id: SIMULATED_AVL.id, simulated: true, fallback: true, label: SIMULATED_AVL.label, error: (e as Error)?.message ?? String(e), loadMs: now() - t0 } };
    } finally {
      if (timer) clearTimeout(timer);
    }
    return loaded;
  })();
  return avlPromise;
}

/** Synchronous access after ensureAvl() resolved (scenario runs created from an event handler). */
export function loadedAvl(): { backend: AvlBackend; info: AvlInfo } | null {
  return loaded;
}
