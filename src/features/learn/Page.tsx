// /learn: the book. The index is a landing page; every chapter renders inside BookLayout (contents rail,
// reading column, pager). Each chapter is its own lazy chunk, so the index and the reference pages never load
// the protocol engine, and the engine-heavy labs load only when opened.
import { Route, Routes } from "react-router-dom";
import { addI18n } from "@/app";
import { lazyChunk, loadParts } from "@/app/chunk";
import { typo } from "@/content";
import strings from "./strings";
import { BookLayout, NotInBook } from "./layout";
import { LEARN_CHUNKS as C, learnChunkOf } from "./chunks";
import "./learn.css";

const typeset = (d: Record<string, string>, lang: "en" | "ru") => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typo(v, lang)]));
addI18n({ en: typeset(strings.en, "en"), ru: typeset(strings.ru, "ru") });

/** A switch loads the chapter's own chunk first (src/app/motion.ts). */
export const warm = (pathname: string, code: boolean) => { const c = learnChunkOf(pathname); return loadParts(c ? [c] : [], code); };

const IndexPage = lazyChunk(C[""]);
const HowPage = lazyChunk(C.how);
const SignaturePage = lazyChunk(C.signature);
const ContractPage = lazyChunk(C.contract);
const AvlPage = lazyChunk(C.avl);
const TrustPage = lazyChunk(C.trust);
const ToolsPage = lazyChunk(C.tools);
const ApiPage = lazyChunk(C.api);
const HistoryPage = lazyChunk(C.history);
const FaqPage = lazyChunk(C.faq);
const GlossaryPage = lazyChunk(C.glossary);
const SourcesPage = lazyChunk(C.sources);
const DevPage = lazyChunk(C.developers);
const CirclePage = lazyChunk(C.circle);

export default function LearnPage() {
  return (
    <Routes>
      <Route index element={<IndexPage />} />
      {/* beside the book, not a chapter: no contents rail, no pager, not in the reading progress */}
      <Route path="developers" element={<DevPage />} />
      <Route path="circle" element={<CirclePage />} />
      <Route element={<BookLayout />}>
        <Route path="how" element={<HowPage />} />
        <Route path="signature" element={<SignaturePage />} />
        <Route path="contract" element={<ContractPage />} />
        <Route path="avl" element={<AvlPage />} />
        <Route path="trust" element={<TrustPage />} />
        <Route path="tools" element={<ToolsPage />} />
        <Route path="api" element={<ApiPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="faq" element={<FaqPage />} />
        <Route path="glossary" element={<GlossaryPage />} />
        <Route path="sources" element={<SourcesPage />} />
      </Route>
      <Route path="*" element={<NotInBook />} />
    </Routes>
  );
}
