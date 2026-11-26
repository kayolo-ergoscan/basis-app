// src/content: typed, bilingual protocol content for /learn, Home and every explanation in the app.
// No React. Pages import from "@/content" and render; see CONTENT_API.md for shapes and rules.

export * from "./types";
export { basisEs, basisTokenEs } from "./contractSource";
export * from "./contracts";
export * from "./sources";
export * from "./copy";
export * from "./moments";
export * from "./personas";
export * from "./spectrum";
export * from "./howItWorks";
export * from "./trust";
export * from "./faq";
export * from "./glossary";
export * from "./history";
export * from "./trackerApi";
export * from "./clients";
export * from "./trackerExamples";
export * from "./reasons";
export * from "./links";
export * from "./repos";
export { default as contentI18n } from "./i18n";
