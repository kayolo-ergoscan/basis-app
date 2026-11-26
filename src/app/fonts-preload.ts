// Start the Cyrillic font downloads early on a Russian page (VISUAL §4.1). The two critical Latin files are preloaded
// by index.html; the @font-face rules are in src/ui/fonts.css.
//
// Not by <link rel=preload>: added from script after the first render, such a link raced the stylesheet's own request
// for the same file, Chrome did not match the two, and on every Russian page the Cyrillic display face was fetched
// twice, with "preloaded using link preload but not used within a few seconds" in the console. document.fonts.load()
// goes through the @font-face rule itself: the browser fetches exactly the face whose unicode-range covers the sample
// glyph, once, or reuses the request already on its way.
const CYRILLIC = ['400 1em "Geist Variable"', '600 1em "Unbounded Variable"'];
// the mono face's Cyrillic file (13 KB) only once the page is idle: the first page that sets numbers with Russian units
// in mono (the mainnet wallet's forms) then draws them at once, without a swap that moves the line (motion round)
const LATER = ['500 1em "Geist Mono Variable"'];

/** Call once at boot and again when the language changes. */
export function preloadFonts(lang: "en" | "ru") {
  if (lang !== "ru" || typeof document === "undefined" || !document.fonts?.load) return;
  const load = (f: string) => document.fonts.load(f, "Ж").catch(() => { /* a font that fails to load falls back; nothing to do */ });
  for (const f of CYRILLIC) void load(f);
  const later = () => { for (const f of LATER) void load(f); };
  const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof idle === "function") idle(later, { timeout: 4000 });
  else setTimeout(later, 1500);
}
