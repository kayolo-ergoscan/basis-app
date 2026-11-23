// Start the Cyrillic font downloads early on a Russian page (VISUAL §4.1). The two critical Latin files are preloaded
// by index.html; the @font-face rules come from the Fontsource packages (src/ui/fonts.css).
//
// Not by <link rel=preload>: added from script after the first render, such a link raced the stylesheet's own request
// for the same file, Chrome did not match the two, and on every Russian page the Cyrillic serif (52 KB) was fetched
// twice, with "preloaded using link preload but not used within a few seconds" in the console. document.fonts.load()
// goes through the @font-face rule itself: the browser fetches exactly the face whose unicode-range covers the sample
// glyph, once, or reuses the request already on its way.
const CYRILLIC = ['400 1em "Geist Variable"', '400 1em "Noto Serif Display Variable"'];

/** Call once at boot and again when the language changes. */
export function preloadFonts(lang: "en" | "ru") {
  if (lang !== "ru" || typeof document === "undefined" || !document.fonts?.load) return;
  for (const f of CYRILLIC) document.fonts.load(f, "Ж").catch(() => { /* a font that fails to load falls back; nothing to do */ });
}
