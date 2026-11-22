// Preload the woff2 files the first paint needs (VISUAL §4.1): Latin always, Cyrillic when the page is in Russian.
// The @font-face rules come from the Fontsource packages (src/ui/fonts.ts); these links only start the downloads early.
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import geistCyr from "@fontsource-variable/geist/files/geist-cyrillic-wght-normal.woff2?url";
import serifLatin from "@fontsource-variable/noto-serif-display/files/noto-serif-display-latin-wdth-normal.woff2?url";
import serifCyr from "@fontsource-variable/noto-serif-display/files/noto-serif-display-cyrillic-wdth-normal.woff2?url";

const done = new Set<string>();
function add(href: string) {
  if (done.has(href) || typeof document === "undefined") return;
  done.add(href);
  const l = document.createElement("link");
  l.rel = "preload";
  l.as = "font";
  l.type = "font/woff2";
  l.href = href;
  l.crossOrigin = "anonymous";
  document.head.appendChild(l);
}

/** Call once at boot and again when the language changes. The two critical Latin files are already preloaded by
 *  index.html; mono and the italic follow, then the Cyrillic pair for Russian. A preload whose file the CSS already
 *  requested would fetch it twice, so only files not yet in the resource timeline are added. */
export function preloadFonts(lang: "en" | "ru") {
  const seen = new Set(typeof performance !== "undefined" ? performance.getEntriesByType("resource").map((e) => e.name) : []);
  // mono and the italic are left to the CSS: by the time this runs their fetch has usually started, and a late preload
  // would request them a second time
  const want = [geistLatin, serifLatin, ...(lang === "ru" ? [geistCyr, serifCyr] : [])];
  want.filter((h) => !seen.has(new URL(h, location.href).href)).forEach(add);
}
