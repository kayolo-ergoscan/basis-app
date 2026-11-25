// Theme: Night (dark, default) and Cotton (light). Stored under "basis.theme" as "night" | "cotton".
// First visit follows prefers-color-scheme (VISUAL §3); with no OS preference it is Night. ?theme=night|cotton|dark|light
// forces a theme for one page view without storing it. public/boot.js applies the same rule before first paint.
import { useSyncExternalStore } from "react";

export type Theme = "night" | "cotton";
const KEY = "basis.theme";

const norm = (v: string | null | undefined): Theme | null =>
  v === "cotton" || v === "light" ? "cotton" : v === "night" || v === "dark" ? "night" : null;

function initial(): Theme {
  if (typeof document === "undefined") return "night";
  const fromDom = norm(document.documentElement.dataset.theme);
  if (fromDom) return fromDom;
  const q = norm(new URLSearchParams(location.search).get("theme"));
  if (q) return q;
  try { const s = norm(localStorage.getItem(KEY)); if (s) return s; } catch { /* ignore */ }
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: light)").matches ? "cotton" : "night";
}

let theme: Theme = initial();
const subs = new Set<() => void>();

function apply(t: Theme) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = t === "cotton" ? "light" : "dark";
  // both scheme-specific metas follow the chosen theme (the browser bar matches the page, not the OS)
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", t === "cotton" ? "#F3F2EE" : "#0A0E1B"));
}
apply(theme);

export function getTheme(): Theme { return theme; }
export function setTheme(t: Theme) {
  theme = t;
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  apply(t);
  for (const f of [...subs]) f();
}
export const toggleTheme = () => setTheme(theme === "night" ? "cotton" : "night");
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** React: { theme, setTheme, toggle }; theme is "night" | "cotton". */
export function useTheme(): { theme: Theme; setTheme: (t: Theme) => void; toggle: () => void } {
  const t = useSyncExternalStore(subscribe, () => theme, () => theme);
  return { theme: t, setTheme, toggle: toggleTheme };
}
