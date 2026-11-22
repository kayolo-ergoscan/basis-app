// Frame batching: many engine events → at most one store update per animation frame. In a hidden tab (no
// frames) or outside a browser it falls back to a short timer, so state still settles.

type Cancel = () => void;

function schedule(fn: () => void): Cancel {
  const visible = typeof document === "undefined" || document.visibilityState !== "hidden";
  if (visible && typeof requestAnimationFrame === "function") {
    const id = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(id);
  }
  const id = setTimeout(fn, typeof document === "undefined" ? 0 : 100);
  return () => clearTimeout(id);
}

export class FrameBatcher {
  private cancel: Cancel | null = null;
  private dirty = false;

  constructor(private readonly flush: () => void) {}

  /** Something changed: flush on the next frame (once). */
  mark(): void {
    this.dirty = true;
    if (this.cancel) return;
    this.cancel = schedule(() => {
      this.cancel = null;
      this.run();
    });
  }

  /** Flush synchronously now (tests, or right before a command resolves). */
  flushNow(): void {
    if (this.cancel) {
      this.cancel();
      this.cancel = null;
    }
    this.run();
  }

  private run(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.flush();
  }

  dispose(): void {
    this.cancel?.();
    this.cancel = null;
    this.dirty = false;
  }
}

/** Yields to the event loop (between chunks of heavy work). MessageChannel avoids timer clamping. */
export function yieldToLoop(): Promise<void> {
  if (typeof MessageChannel !== "undefined") {
    return new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        ch.port2.close();
        resolve();
      };
      ch.port2.postMessage(0);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export const now = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

/** Runs `step(i)` for i in [0, n) in slices of ~`budgetMs`, yielding between slices. */
export async function chunked(n: number, step: (i: number) => void, o: { budgetMs?: number; onProgress?: (done: number) => void } = {}): Promise<void> {
  const budget = o.budgetMs ?? 12;
  let i = 0;
  while (i < n) {
    const t0 = now();
    while (i < n && now() - t0 < budget) step(i++);
    o.onProgress?.(i);
    if (i < n) await yieldToLoop();
  }
}
