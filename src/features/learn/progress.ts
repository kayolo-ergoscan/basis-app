// Your reading progress in the book: the chapters you read to (nearly) the end, kept in this browser only (a per-reader
// convenience; nothing leaves the browser). Every access is guarded: private windows and blocked storage simply show
// no progress.
import { useEffect, useState } from "react";

const KEY = "basis.learn.read";
const subs = new Set<() => void>();

export function readChapters(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY);
    const a: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/** Marks a chapter read (once); every view of the progress updates. */
export function markRead(id: string): void {
  const s = readChapters();
  if (s.has(id)) return;
  s.add(id);
  try { localStorage.setItem(KEY, JSON.stringify([...s])); } catch { /* storage blocked: progress stays as it is */ }
  subs.forEach((f) => f());
}

export function useReadChapters(): Set<string> {
  const [v, set] = useState(readChapters);
  useEffect(() => {
    const f = () => set(readChapters());
    subs.add(f);
    addEventListener("storage", f);
    return () => { subs.delete(f); removeEventListener("storage", f); };
  }, []);
  return v;
}
