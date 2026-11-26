// The tracker's lazy pages (the two consoles and the API mirror; /run is in the frame's own chunk), shared by route.tsx
// (a switch loads the page first, src/app/motion.ts) and Page.tsx (renders it at once once loaded).
import { chunk, type Part } from "@/app/chunk";

export const consolePage = chunk(() => import("./Console"));
export const mainnetPage = chunk(() => import("./Mainnet"));
export const apiPage = chunk(() => import("./ApiMirror"));

/** The practice console and the API mirror run on the sandbox town (they show a loader until it runs). */
export const usesTown = (pathname: string) => /^\/tracker\/(practice|api)(\/|$)/.test(pathname);

/** The lazy page a /tracker path shows (none for /run; /tracker itself and unknown paths lead to the mainnet console). */
export function trackerChunkOf(pathname: string): Part | null {
  const p = pathname.replace(/^\/tracker\/?/, "").split("/")[0];
  if (p === "practice") return consolePage;
  if (p === "api") return apiPage;
  if (p === "run") return null;
  return mainnetPage;
}
