// Self-hosted fonts (VISUAL §4.1): the three Fontsource variable packages and nothing else. Every family ships Latin and
// Cyrillic subsets; @font-face unicode-range means a browser downloads only the subsets a page uses, so the italics
// load lazily on first italic glyph. Preloads for the normal Latin/Cyrillic files are added by src/app/fonts-preload.ts.
import "@fontsource-variable/noto-serif-display/wdth.css";
import "@fontsource-variable/noto-serif-display/wdth-italic.css";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
