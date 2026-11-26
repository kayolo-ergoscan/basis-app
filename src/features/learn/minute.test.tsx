// /learn/how#minute: «Basis in one minute» is the page's first section (the request page's «what is Basis» key lands
// on it), six sentences in EN and RU and a way into the sandbox; the chapters follow it. The copy rules cover these
// texts in learn.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, describe, expect, it } from "vitest";
import { getLang, setLang, translate } from "@/app/lang";
import { chapters } from "@/content";
import "./Page"; // the page module merges the lazy strings, typeset as on the site
import HowPage, { MINUTE } from "./pages/HowPage";

function render(lang: "en" | "ru"): string {
  setLang(lang);
  // react-router's MemoryRouter and Link use useLayoutEffect, which React only warns about on the server
  const error = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) error(...a); };
  try {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={["/learn/how#minute"]}>
        <HowPage />
      </MemoryRouter>,
    );
  } finally {
    console.error = error;
  }
}

const was = getLang();
afterAll(() => setLang(was));

for (const lang of ["en", "ru"] as const) {
  describe(`/learn/how#minute, ${lang.toUpperCase()}`, () => {
    const T = (k: string) => translate(k, undefined, lang);
    const html = render(lang);

    it("is the first section, before the first chapter", () => {
      expect(MINUTE).toBe("minute");
      const at = html.indexOf(`<section id="${MINUTE}"`);
      expect(at).toBeGreaterThan(-1);
      expect(html.indexOf("<section id=")).toBe(at);
      expect(html.indexOf(`<section id="${chapters[0].id}"`)).toBeGreaterThan(at);
    });

    it("says it in six sentences and opens the sandbox", () => {
      const ps = ["p1", "p2", "p3"].map((p) => T(`learn.how.min.${p}`));
      const sentences = ps.join(" ").split(/(?<=[.!?])\s+/).filter(Boolean);
      expect(sentences.length).toBe(6);
      const sec = html.slice(html.indexOf(`<section id="${MINUTE}"`), html.indexOf(`<section id="${chapters[0].id}"`));
      expect(sec).toContain('href="/play"');
      expect(sec.match(/<p class="lrn-p">/g)?.length).toBe(3);
    });
  });
}
