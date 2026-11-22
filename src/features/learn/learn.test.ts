// Learn: every contract-lab path does what its button says (both contracts), the EN and RU bundles match key for key
// with the same placeholders, and no string uses a word the copy rules forbid.
import { describe, expect, it } from "vitest";
import { getAvlBackend } from "@/protocol";
import strings from "./strings";
import i18n from "./i18n";
import { runPath, type LabContract, type PathId } from "./contractLab";
import { LEARN_PAGES, neighbours, readingMinutes } from "./pages";
import indexSrc from "./pages/IndexPage.tsx?raw";
import howFigSrc from "./figures/how.tsx?raw";

const BAD_CHECK: Record<PathId, string> = { 0: "properlyRedeemed", 1: "topUpAmount", 2: "ownerSignature", 3: "refundPeriodOver" };

describe("contract lab", () => {
  const backend = getAvlBackend();
  for (const contract of ["basis", "basis-token"] as LabContract[]) {
    for (const action of [0, 1, 2, 3] as PathId[]) {
      it(`${contract} path ${action}: the honest run passes the contract`, () => {
        const r = runPath(backend, contract, action, "ok");
        expect(r.outcome.ok, `${r.outcome.code}: ${r.outcome.message}`).toBe(true);
        expect(r.outcome.eval?.ok).toBe(true);
        expect(r.outcome.eval?.contract).toBe(contract === "basis" ? "basis.es" : "basis-token.es");
      });
      it(`${contract} path ${action}: the other run fails in the contract at ${BAD_CHECK[action]}`, () => {
        const r = runPath(backend, contract, action, "bad");
        expect(r.outcome.ok).toBe(false);
        expect(r.before).toBeUndefined();
        expect(r.outcome.eval?.error?.check).toBe(BAD_CHECK[action]);
      });
      it(`${contract} path ${action}: the legend marks every condition (all held on the honest run, only ${BAD_CHECK[action]} failed on the other)`, () => {
        const ok = runPath(backend, contract, action, "ok").outcome.eval!;
        expect(ok.checks.filter((c) => c.ok !== true).map((c) => c.id)).toEqual([]);
        const bad = runPath(backend, contract, action, "bad").outcome.eval!;
        expect(bad.checks.filter((c) => c.ok === false).map((c) => c.id)).toEqual([BAD_CHECK[action]]);
      });
    }
  }
});

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const plain = (k: string) => k.replace(/_(one|few|many|other)$/, "");

describe("strings", () => {
  for (const [name, b] of [["strings", strings], ["i18n", i18n]] as const) {
    const en = b.en as Record<string, string>;
    const ru = b.ru as Record<string, string>;
    it(`${name}: every key is prefixed learn. and exists in both languages`, () => {
      for (const k of Object.keys(en)) expect(k.startsWith("learn.")).toBe(true);
      const enBase = new Set(Object.keys(en).map(plain));
      const ruBase = new Set(Object.keys(ru).map(plain));
      expect([...enBase].filter((k) => !ruBase.has(k))).toEqual([]);
      expect([...ruBase].filter((k) => !enBase.has(k))).toEqual([]);
    });
    it(`${name}: RU plurals have one/few/many/other, EN plurals one/other`, () => {
      for (const k of Object.keys(en).filter((x) => x.endsWith("_other"))) {
        const b0 = plain(k);
        expect(en[`${b0}_one`], b0).toBeDefined();
        for (const f of ["one", "few", "many", "other"]) expect(ru[`${b0}_${f}`], `${b0}_${f}`).toBeDefined();
      }
    });
    it(`${name}: the same placeholders in both languages`, () => {
      for (const k of Object.keys(en)) {
        const r = ru[k] ?? ru[`${plain(k)}_other`];
        if (r === undefined) continue;
        expect(placeholders(r), k).toBe(placeholders(en[k]));
      }
    });
    it(`${name}: no forbidden words`, () => {
      const EN = [/\btrustless\b/i, /\bguarantee/i, /\bsafe(ly|r|st|ty)?\b/i, /\blaunched\b/i, /\bofficial/i, /(?<![\d.,])2\s?%/, /\b(7|seven)[\s -]+days?\b/i, /\bbearer\b/i, /\baudited\b/i, /\byields?\b/i];
      const RU = [/гарантир/iu, /(?<!\p{L})безопасн(?!ост)/iu, /запущен/iu, /(?<!\p{L})официальн/iu, /(?<![\d.,])2[\s  ]?%/u, /(?<!\d)7[\s ]+(дн|сут)/iu, /на[\s ]+предъявителя/iu];
      for (const [k, v] of Object.entries(en)) for (const re of EN) expect(re.test(v), `${k}: ${v}`).toBe(false);
      for (const [k, v] of Object.entries(ru)) for (const re of RU) expect(re.test(v), `${k}: ${v}`).toBe(false);
    });
  }
});

describe("book", () => {
  it("every page has a title, a contents label, a heading and a description in both languages", () => {
    for (const p of LEARN_PAGES) {
      for (const f of ["title", "toc", "head", "desc"]) {
        expect((strings.en as Record<string, string>)[`learn.page.${p.id}.${f}`], `${p.id}.${f}`).toBeTruthy();
        expect((strings.ru as Record<string, string>)[`learn.page.${p.id}.${f}`], `${p.id}.${f} ru`).toBeTruthy();
      }
    }
  });
  it("the pager walks the whole book in order", () => {
    const seen: string[] = [];
    let cur: (typeof LEARN_PAGES)[number] | null = LEARN_PAGES[0];
    while (cur) { seen.push(cur.id); cur = neighbours(cur.id).next; }
    expect(seen).toEqual(LEARN_PAGES.map((p) => p.id));
  });
  it("reading time is at least a minute", () => {
    expect(readingMinutes(["one two three"], "en")).toBe(1);
    expect(readingMinutes([Array(420).fill("word").join(" ")], "en")).toBe(2);
  });
});

describe("materials and colours in the page code (VISUAL §1, §3)", () => {
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("decorative plates and figures carry no holo foil (holo = proven only) and no raw colours", () => {
    // (vitest does not load .css, even with ?raw, so the stylesheet itself is checked by eye and by the critic's audit)
    for (const src of [indexSrc, howFigSrc]) {
      expect(src.length).toBeGreaterThan(2000);
      expect(code(src).match(/#[0-9a-fA-F]{6}\b/g) ?? []).toEqual([]);
      expect(code(src)).not.toContain("--holo");
    }
  });
  it("the kit's .tear grid is never reused as a wrapper class", () => {
    expect(howFigSrc).not.toMatch(/className="tear"/);
  });
});

