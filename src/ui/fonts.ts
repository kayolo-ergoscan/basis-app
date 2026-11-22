// Self-hosted fonts (VISUAL §4.1): the three Fontsource variable families, Latin and Cyrillic subsets only (src/ui/fonts.css,
// generated from the packages). @font-face unicode-range means a browser downloads only the subsets a page uses, so the
// italics load lazily on first italic glyph. Preloads for the normal Latin/Cyrillic files are added by src/app/fonts-preload.ts.
import "./fonts.css";
