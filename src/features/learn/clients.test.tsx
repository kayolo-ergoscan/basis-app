// Ready-made programs (/learn/api#clients): the block renders in EN and RU as the page's first section, with the
// three programs, ErgoScan's tracker address, the code links at the pinned commit, the redemption caveat and every
// route linked to its catalogue entry; the ⌘K bar finds it by the words people type. The tracker's Code card link is
// checked in tracker.test.ts; the copy rules cover these texts in content.test.ts and in learn.test.ts.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getLang, setLang, translate } from "@/app/lang";
import { CLIENTS_HREF, ERGOSCAN_TRACKER_URL, GIT_REF, apiEndpoints, clientPrograms, clients, pick, type Text } from "@/content";
import "./Page"; // the page module merges the lazy strings, typeset as on the site
import ApiPage from "./pages/ApiPage";
import i18n from "./i18n";
import route from "./route";

type Lang = "en" | "ru";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");
/** The text a reader sees: tags dropped (so `<code>` and `<wbr>` vanish), entities decoded. */
const text = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
/** A content Text as it reads on the page: inline code marks become plain code. */
const seen = (x: Text, lang: Lang) => pick(x, lang).replace(/`/g, "");

function render(lang: Lang): string {
  setLang(lang);
  // react-router's MemoryRouter and Link use useLayoutEffect, which React only warns about on the server
  const error = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) error(...a); };
  try {
    return renderToStaticMarkup(
      <MemoryRouter initialEntries={[CLIENTS_HREF]}>
        <ApiPage />
      </MemoryRouter>,
    );
  } finally {
    console.error = error;
  }
}

const was = getLang();
afterAll(() => setLang(was));

for (const lang of ["en", "ru"] as const) {
  describe(`ready-made programs on /learn/api, ${lang.toUpperCase()}`, () => {
    let html = "";
    let s = "";
    beforeAll(() => {
      html = render(lang);
      s = text(html);
    });
    const T = (k: string) => translate(k, undefined, lang);

    it("is the page's first section, under the anchor the other pages link to", () => {
      expect(CLIENTS_HREF).toBe("/learn/api#clients");
      const at = html.indexOf('<section id="clients"');
      expect(at).toBeGreaterThan(-1);
      expect(html.indexOf("<section id=")).toBe(at);
      expect(html.indexOf('<section id="basics"')).toBeGreaterThan(at);
      expect(s).toContain(T("learn.api.s.clients").replace(/\*/g, ""));
    });

    it("says whose programs they are, then gives ErgoScan's tracker address", () => {
      expect(s).toContain(pick(clients.lede, lang));
      expect(s.indexOf(pick(clients.lede, lang))).toBeLessThan(s.indexOf(T("learn.api.cl.addr")));
      expect(html).toContain(`<code>${ERGOSCAN_TRACKER_URL}</code>`);
    });

    it("has a card for each program: name, one line, its points, ErgoScan's tracker, the code at the pinned commit", () => {
      for (const c of clientPrograms) {
        expect(html, c.id).toContain(`<h3>${c.name}</h3>`);
        expect(s, c.id).toContain(seen(c.line, lang));
        for (const d of c.does) expect(s, c.id).toContain(seen(d, lang));
        if (c.note) expect(s, c.id).toContain(seen(c.note, lang));
        expect(c.url).toBe(`https://github.com/BetterMoneyLabs/basis-tracker/tree/${GIT_REF}/${c.crate}`);
        expect(html, c.id).toContain(`href="${c.url}"`);
      }
      expect(html.split(`<span class="label">${esc(T("learn.api.cl.with"))}</span>`).length - 1).toBe(clientPrograms.length);
      expect(s).toContain(`${T("learn.api.cl.yes")}: ${pick(clients.withTracker.yes, lang)}`);
      expect(s).toContain(`${T("learn.api.cl.no")}: ${pick(clients.withTracker.no, lang)}`);
      expect(s).toContain(pick(clients.foot, lang));
    });

    it("states the redemption caveat and links every route to its entry in the catalogue below", () => {
      expect(s).toContain(pick(clients.redemption, lang));
      expect(s).toContain(T("learn.api.cl.routes"));
      expect(s).toContain(pick(clients.routesLede, lang));
      for (const g of [...clients.accepted, ...clients.refused]) {
        expect(s, g.id).toContain(pick(g.title, lang));
        if (g.text) expect(s, g.id).toContain(seen(g.text, lang));
        for (const id of g.endpoints) {
          expect(apiEndpoints.some((e) => e.id === id), id).toBe(true);
          expect(html, id).toContain(`href="#ep-${id}"`);
          expect(html, id).toContain(`id="ep-${id}"`);
        }
      }
      expect(html).toContain("<code>/acceptance/*</code>");
    });

    it("never shows a raw key", () => {
      expect(s).not.toMatch(/learn\.(api|cmd)\.[\w.]+/);
    });
  });
}

describe("the ⌘K bar finds the ready-made programs", () => {
  const cmd = route.commands?.find((c) => c.to === CLIENTS_HREF);
  // the bar's own rule (score() in src/app/overlays.tsx): every word of the query is in the label, path or keywords
  const finds = (q: string, label: string) => {
    const hay = `${label} ${cmd?.to ?? ""} ${cmd?.keywords ?? ""} ${cmd?.to ?? ""}`.toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  };

  it("has a command that opens the block, labelled in both languages", () => {
    expect(cmd).toBeDefined();
    expect((i18n.en as Record<string, string>)[cmd!.labelKey]).toBeTruthy();
    expect((i18n.ru as Record<string, string>)[cmd!.labelKey]).toBeTruthy();
  });

  for (const q of ["cli", "tui", "mcp", "терминал", "агенты", "программы", "клиенты"]) {
    it(`by "${q}"`, () => {
      for (const lang of ["en", "ru"] as const) expect(finds(q, (i18n[lang] as Record<string, string>)[cmd!.labelKey]), lang).toBe(true);
    });
  }
});
