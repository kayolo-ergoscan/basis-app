// Preload the woff2 files the first paint needs (VISUAL §4.1): Latin always, Cyrillic when the page is in Russian.
// The @font-face rules come from the Fontsource packages (src/ui/fonts.ts); these links only start the downloads early.
import geistLatin from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import geistCyr from "@fontsource-variable/geist/files/geist-cyrillic-wght-normal.woff2?url";
import monoLatin from "@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2?url";
import serifLatin from "@fontsource-variable/noto-serif-display/files/noto-serif-display-latin-wdth-normal.woff2?url";
import serifCyr from "@fontsource-variable/noto-serif-display/files/noto-serif-display-cyrillic-wdth-normal.woff2?url";
import serifLatinIt from "@fontsource-variable/noto-serif-display/files/noto-serif-display-latin-wdth-italic.woff2?url";

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

/** Call once at boot and again when the language changes. */
export function preloadFonts(lang: "en" | "ru") {
  [geistLatin, monoLatin, serifLatin, serifLatinIt].forEach(add);
  if (lang === "ru") [geistCyr, serifCyr].forEach(add);
}
