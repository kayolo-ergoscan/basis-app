// /learn: the book. The index is a landing page; every chapter renders inside BookLayout (contents rail,
// reading column, pager). Each chapter is its own lazy chunk, so the index and the reference pages never load
// the protocol engine, and the engine-heavy labs load only when opened.
import { lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { addI18n } from "@/app";
import { typo } from "@/content";
import strings from "./strings";
import { BookLayout, NotInBook } from "./layout";
import "./learn.css";

const typeset = (d: Record<string, string>, lang: "en" | "ru") => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typo(v, lang)]));
addI18n({ en: typeset(strings.en, "en"), ru: typeset(strings.ru, "ru") });

const IndexPage = lazy(() => import("./pages/IndexPage"));
const HowPage = lazy(() => import("./pages/HowPage"));
const SignaturePage = lazy(() => import("./pages/SignaturePage"));
const ContractPage = lazy(() => import("./pages/ContractPage"));
const AvlPage = lazy(() => import("./pages/AvlPage"));
const TrustPage = lazy(() => import("./pages/TrustPage"));
const ToolsPage = lazy(() => import("./pages/ToolsPage"));
const ApiPage = lazy(() => import("./pages/ApiPage"));
const HistoryPage = lazy(() => import("./pages/HistoryPage"));
const FaqPage = lazy(() => import("./pages/FaqPage"));
const GlossaryPage = lazy(() => import("./pages/GlossaryPage"));
const SourcesPage = lazy(() => import("./pages/SourcesPage"));

export default function LearnPage() {
  return (
    <Routes>
      <Route index element={<IndexPage />} />
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
