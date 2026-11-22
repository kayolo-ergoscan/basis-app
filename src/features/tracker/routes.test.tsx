// The tracker section's addresses: the menu's «Трекер» opens ErgoScan's real tracker (/tracker/mainnet), the sandbox
// console is /tracker/practice and is the switch's second tab («Учебный»/Practice), every link that means the sandbox
// console names /tracker/practice, and the old addresses keep working (/tracker and unknown sub-pages redirect).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, describe, expect, it } from "vitest";
import { getLang, setLang, translate } from "@/app/lang";
import { hrefOf, NAV } from "@/app/routes";
import { personas } from "@/content";
import "./Page"; // merges the lazy strings, typeset as on the site
import pageSrc from "./Page.tsx?raw";
import { ModeSwitch, SubNav, TRACKER_HOME, TRACKER_PRACTICE, trackerHomeOf } from "./parts";
import route from "./route";

type Lang = "en" | "ru";

function render(at: string, node: JSX.Element): string {
  // react-router's MemoryRouter and Link use useLayoutEffect, which React only warns about on the server
  const error = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) error(...a); };
  try {
    return renderToStaticMarkup(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>);
  } finally {
    console.error = error;
  }
}
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);
const text = (html: string) => html.replace(/<[^>]+>/g, "");
/** The opening tag of the link to `href` (attributes in any order). */
const linkTo = (html: string, href: string) => html.match(new RegExp(`<a [^>]*href="${href}"[^>]*>`))?.[0] ?? "";

const was = getLang();
afterAll(() => setLang(was));

describe("tracker addresses", () => {
  it("the menu's «Трекер» is /tracker, and /tracker opens ErgoScan's tracker on mainnet", () => {
    expect(NAV.map((r) => r.id)).toContain("tracker");
    expect(hrefOf(route)).toBe("/tracker");
    expect(TRACKER_HOME).toBe("/tracker/mainnet");
    expect(pageSrc).toContain('<Route index element={<ToTrackerHome />} />');
    expect(pageSrc).toContain('<Route path="mainnet" element={<Mainnet />} />');
  });

  it("the sandbox console lives at /tracker/practice", () => {
    expect(TRACKER_PRACTICE).toBe("/tracker/practice");
    expect(pageSrc).toContain('<Route path="practice" element={<Console />} />');
  });

  it("old and unknown addresses keep working: they redirect to the mainnet tracker with their query and hash", () => {
    expect(pageSrc).toContain('<Route path="*" element={<ToTrackerHome />} />');
    expect(pageSrc).toMatch(/<Navigate to=\{trackerHomeOf\(search, hash\)\} replace \/>/);
    expect(trackerHomeOf()).toBe("/tracker/mainnet");
    expect(trackerHomeOf("?key=02ab", "#lookup")).toBe("/tracker/mainnet?key=02ab#lookup");
    // /tracker/run and /tracker/api stay where they were
    expect(pageSrc).toContain('<Route path="run" element={<RunOwn />} />');
    expect(pageSrc).toContain('<Route path="api" element={<ApiMirror />} />');
  });

  it("⌘K: the tracker command opens mainnet, and the practice tracker has its own command", () => {
    const cmd = (id: string) => route.commands?.find((c) => c.id === id);
    expect(cmd("tracker.open")?.to).toBe(TRACKER_HOME);
    expect(cmd("tracker.practice")?.to).toBe(TRACKER_PRACTICE);
    for (const lang of ["en", "ru"] as Lang[]) {
      expect(translate("tracker.cmd.practice", undefined, lang)).not.toBe("tracker.cmd.practice");
    }
  });

  it("every link that means the sandbox console names /tracker/practice; no link names the bare /tracker", () => {
    const operator = personas.find((p) => p.start.to.startsWith("/tracker"));
    expect(operator?.start.to).toBe(TRACKER_PRACTICE);
    const files = import.meta.glob<string>("/src/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true });
    const bare = /(?:\bto=|\bto:\s*|navigate\()\s*\{?\s*["'`]\/tracker["'`?#]/;
    const offenders = Object.entries(files)
      .filter(([path]) => !/\.test\.tsx?$/.test(path))
      .filter(([, src]) => bare.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
    expect(Object.keys(files).length).toBeGreaterThan(100);
  });
});

for (const lang of ["en", "ru"] as Lang[]) {
  describe(`tracker switch, ${lang.toUpperCase()}`, () => {
    const T = (k: string) => translate(k, undefined, lang);

    it("mainnet is the first tab, the practice tracker the second", () => {
      setLang(lang);
      const html = render(TRACKER_PRACTICE, <ModeSwitch mode="sim" />);
      expect(hrefs(html)).toEqual([TRACKER_HOME, TRACKER_PRACTICE]);
      const s = text(html);
      expect(s.indexOf(T("tracker.mode.main"))).toBeGreaterThan(-1);
      expect(s.indexOf(T("tracker.mode.sim"))).toBeGreaterThan(s.indexOf(T("tracker.mode.main")));
      expect(T("tracker.mode.sim")).toBe(lang === "ru" ? "Учебный" : "Practice");
      expect(linkTo(html, TRACKER_PRACTICE)).toContain('aria-current="page"');
      expect(linkTo(html, TRACKER_HOME)).not.toContain("aria-current");
    });

    it("the practice page says it is a practice tracker with play money, and where the real one is", () => {
      const plain = (x: string) => x.replace(/[\u00a0\u2009\u2060]/g, " ").replace(/ {2,}/g, " ");
      expect(plain(T("tracker.h1"))).toBe(lang === "ru" ? "Учебный *трекер*" : "Practice *tracker*");
      expect(plain(T("tracker.lede"))).toMatch(lang === "ru" ? /^Это учебный трекер песочницы, деньги игровые\..*на вкладке «Основная сеть»\.$/ : /^This is the sandbox's practice tracker; the money is play money\..*on the Mainnet tab\.$/);
      expect(T("tracker.lede")).toContain(T("tracker.mode.main") === "Mainnet" ? "Mainnet" : "Основная сеть");
    });

    it("the console tab of the sub-nav is on for both modes and opens mainnet", () => {
      setLang(lang);
      for (const at of [TRACKER_HOME, TRACKER_PRACTICE]) {
        const html = render(at, <SubNav />);
        expect(hrefs(html)[0]).toBe(TRACKER_HOME);
        expect(linkTo(html, TRACKER_HOME)).toContain('class="on"');
      }
    });
  });
}
