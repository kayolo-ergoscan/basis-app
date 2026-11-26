// The wallet's two lazy pages (the sandbox town wallet and the mainnet wallet), shared by route.tsx (a switch loads the
// right one first, src/app/motion.ts) and Entry.tsx (renders it).
import { chunk, part } from "@/app/chunk";

export const sandboxPage = chunk(() => import("./Page"));
export const mainnetPage = chunk(() => import("./mainnet/Page"));
/** The mainnet wallet's storage, opened for a switch (never ahead of one: no hover opens it). */
export const mainnetVault = part(() => mainnetPage.load().then((m) => m.warm()));
export const isMainnetPath = (p: string) => /^\/wallet\/mainnet(\/|$)/.test(p);
