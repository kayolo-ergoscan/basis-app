// The developer circle (/learn/circle): empty, it invites (a dashed "your entry here", «Be the first», the three steps
// with the wallet's button and the pull request) and links no payment; with entries, each card's key opens that
// entry's request link, the other currencies sit beside it, and the reviewer's check names its day and the README.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getLang, setLang, translate } from "@/app/lang";
import { CIRCLE_GITHUB, circleLink, readCircle, type CircleEntry } from "@/content/circle";
import "./Page"; // the page module merges the lazy strings, typeset as on the site
import CirclePage from "./pages/CirclePage";

// the list the page renders: empty (as shipped) or the sample entries below (test data, never shipped)
const list = vi.hoisted(() => ({ now: [] as CircleEntry[] }));
vi.mock("@/content/circle", async (orig) => {
  const real = await orig<typeof import("@/content/circle")>();
  return { ...real, get CIRCLE() { return list.now; } };
});

type Lang = "en" | "ru";
const K2 = "02c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5";
const K3 = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const SAMPLE = readCircle([
  { name: "Лена", project: "ergo-tools", url: "https://github.com/example/ergo-tools", about: "Box and register tools <i>for Ergo</i>", key: K2, checked: "2026-11-26" },
  { name: "Sam & Co", project: "notes-cli", url: "https://example.org/notes-cli", about: "A terminal client", key: K3, denoms: ["sigusd", "erg", "rsada"], readme: "https://example.org/notes-cli/readme", checked: "2026-11-27" },
]).entries;

const amp = (s: string) => s.replace(/&/g, "&amp;");
const text = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const plain = (s: string) => s.replace(/\*/g, "");

function render(lang: Lang, page: JSX.Element = <CirclePage />, at = "/learn/circle"): string {
  setLang(lang);
  const error = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) error(...a); };
  try {
    return renderToStaticMarkup(<MemoryRouter initialEntries={[at]}>{page}</MemoryRouter>);
  } finally {
    console.error = error;
  }
}

const was = getLang();
afterAll(() => setLang(was));

for (const lang of ["en", "ru"] as const) {
  const T = (k: string, v?: Record<string, string | number>) => translate(k, v, lang);

  describe(`the circle, empty, ${lang.toUpperCase()}`, () => {
    it("invites: the empty line, a dashed «your entry here», «Be the first» and the three steps", () => {
      list.now = [];
      const html = render(lang);
      const s = text(html);
      expect(s).toContain(T("learn.cc.empty"));
      expect(html).toContain('class="cc-card ghost"');
      expect(s).toContain(T("learn.cc.ghost"));
      expect(s).toContain(plain(T("learn.cc.joinH.empty")));
      for (const k of ["s1.t", "s2.t", "s3.t"]) expect(s).toContain(T(`learn.cc.${k}`));
      expect(html).not.toContain("cc-list");
    });

    it("links the wallet's button maker and the pull request; links no payment", () => {
      list.now = [];
      const html = render(lang);
      expect(html).toContain('href="/wallet/mainnet/receive"');
      expect(html).toContain(`href="${CIRCLE_GITHUB.edit}"`);
      expect(html).toContain(`href="${CIRCLE_GITHUB.file}"`);
      expect(html).toContain(`src="${lang === "ru" ? "/badge-ru.svg" : "/badge.svg"}"`);
      expect(html).not.toContain("/wallet/mainnet/pay");
      // the ghost's key is a disabled button, not a link
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*<span class="lbl">[^<]*<\/span><\/button>/);
    });

    it("the template is the file's shape, with the field names the test reads", () => {
      list.now = [];
      const s = text(render(lang));
      for (const f of ["name", "project", "url", "about", "key", "denoms"]) expect(s).toContain(`"${f}": `);
      expect(s).not.toContain('"checked"');
    });
  });

  describe(`the circle with entries, ${lang.toUpperCase()}`, () => {
    it("lists every entry with its count, and the join steps after the list", () => {
      list.now = SAMPLE;
      const html = render(lang);
      const s = text(html);
      expect(html.match(/class="cc-card"/g)).toHaveLength(2);
      expect(html).not.toContain("cc-card ghost");
      expect(s).not.toContain(T("learn.cc.empty"));
      expect(s).toContain(lang === "ru" ? "2 записи" : "2 entries");
      expect(s).toContain(plain(T("learn.cc.joinH")));
      expect(html.indexOf('id="list"')).toBeLessThan(html.indexOf('id="join"'));
    });

    it("each key opens the entry's request link in its first currency; the others sit beside it", () => {
      list.now = SAMPLE;
      const html = render(lang);
      expect(html).toContain(`href="${amp(circleLink("", SAMPLE[0], "erg"))}"`);
      expect(html).toContain(`href="${amp(circleLink("", SAMPLE[1], "sigusd"))}"`);
      expect(html).toContain(`href="${amp(circleLink("", SAMPLE[1], "erg"))}"`);
      expect(html).toContain(`href="${amp(circleLink("", SAMPLE[1], "rsada"))}"`);
      expect(html.match(/\/wallet\/mainnet\/pay#/g)).toHaveLength(4);
      expect(text(html).match(new RegExp(T("learn.cc.support"), "g"))).toHaveLength(2);
    });

    it("shows the reviewer's check with its day and the README, and the people's links are nofollow", () => {
      list.now = SAMPLE;
      const html = render(lang);
      const s = text(html);
      const day = new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date("2026-11-27T12:00:00Z"));
      expect(s).toContain(T("learn.cc.match"));
      expect(s).toContain(T("learn.cc.checked", { date: day }));
      expect(html).toContain('href="https://example.org/notes-cli/readme" target="_blank" rel="noreferrer nofollow"');
      expect(html).toContain('href="https://github.com/example/ergo-tools" target="_blank" rel="noreferrer nofollow"');
    });

    it("shows people's words as text, never as markup", () => {
      list.now = SAMPLE;
      const html = render(lang);
      expect(html).toContain("Box and register tools &lt;i&gt;for Ergo&lt;/i&gt;");
      expect(html).not.toContain("<i>for Ergo</i>");
      expect(html).toContain("Sam &amp; Co");
    });
  });
}
