// Self-hosted fonts (VISUAL §4.1): the three Fontsource variable families, Latin and Cyrillic subsets only (src/ui/fonts.css,
// generated from the packages). @font-face unicode-range means a browser downloads only the subsets a page uses, so the
// italics load lazily on first italic glyph. The normal Latin files are preloaded by index.html; on a Russian page
// src/app/fonts-preload.ts starts the Cyrillic ones early.
import "./fonts.css";
