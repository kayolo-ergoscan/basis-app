// Self-hosted fonts: Unbounded (display, src/ui/fonts/), Geist and Geist Mono (Fontsource packages), Latin and Cyrillic
// subsets only (src/ui/fonts.css). @font-face unicode-range means a browser downloads only the subsets a page uses. The
// Latin UI and display files are preloaded by index.html; on a Russian page src/app/fonts-preload.ts starts the
// Cyrillic ones early.
import "./fonts.css";
