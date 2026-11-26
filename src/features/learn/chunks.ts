// The Learn book's lazy pages (each its own chunk), shared by route.tsx (a page switch loads the chapter first,
// src/app/motion.ts) and Page.tsx (renders it).
import { chunk, type Chunk } from "@/app/chunk";
import type { ComponentType } from "react";

type PageMod = { default: ComponentType };
export const LEARN_CHUNKS: Record<string, Chunk<PageMod>> = {
  "": chunk(() => import("./pages/IndexPage")),
  how: chunk(() => import("./pages/HowPage")),
  signature: chunk(() => import("./pages/SignaturePage")),
  contract: chunk(() => import("./pages/ContractPage")),
  avl: chunk(() => import("./pages/AvlPage")),
  trust: chunk(() => import("./pages/TrustPage")),
  tools: chunk(() => import("./pages/ToolsPage")),
  api: chunk(() => import("./pages/ApiPage")),
  history: chunk(() => import("./pages/HistoryPage")),
  faq: chunk(() => import("./pages/FaqPage")),
  glossary: chunk(() => import("./pages/GlossaryPage")),
  sources: chunk(() => import("./pages/SourcesPage")),
  developers: chunk(() => import("./pages/DevPage")),
  circle: chunk(() => import("./pages/CirclePage")),
};
/** The chunk a /learn path renders (none for an address outside the book). */
export const learnChunkOf = (pathname: string): Chunk<PageMod> | undefined => LEARN_CHUNKS[pathname.replace(/^\/learn\/?/, "").split("/")[0]];
