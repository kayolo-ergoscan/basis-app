// The /network strings: every EN key has a RU twin with the same {placeholders}, plural sets are complete, and none of
// the words VISUAL §14 bans appear in either language. Also checks the small pure helpers the pages lean on.
import { describe, expect, it } from "vitest";
import page from "./strings";
import route from "./i18n";
import { AXIS_CH_PX, amount, axisEdge, monthLabel, sid } from "./fmt";

const BANNED_EN = [/trustless/i, /guarantee/i, /\bsafe/i, /safety/i, /unstoppable/i, /live on mainnet/i, /launched/i, /official/i, /\byield\b/i, /\bAPY\b/, /7 days/i, /2 ?%/, /bearer/i, /censorship-resistant/i, /risk-free/i, /insured/i, /audited/i];
const BANNED_RU = [/гарант/i, /безопасн/i, /официальн/i, /доходност/i, /запущен/i, /7 ?дн/i, /2 ?%/, /на предъявителя/i, /бездовер/i, /аудирован/i];
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
const PLURAL = /_(one|few|many|other)$/;

for (const [name, bundle] of [["page", page], ["route", route]] as const) {
  describe(`network ${name} strings`, () => {
    const en = bundle.en as Record<string, string>;
    const ru = bundle.ru as Record<string, string>;

    it("keys start with network.", () => {
      for (const k of [...Object.keys(en), ...Object.keys(ru)]) expect([k, k.startsWith("network.")]).toEqual([k, true]);
    });

    it("has the same keys and placeholders in EN and RU", () => {
      for (const k of Object.keys(en)) {
        if (PLURAL.test(k)) continue;
        expect([k, k in ru]).toEqual([k, true]);
        expect([k, vars(ru[k])]).toEqual([k, vars(en[k])]);
      }
      for (const k of Object.keys(ru)) {
        if (PLURAL.test(k)) continue;
        expect([k, k in en]).toEqual([k, true]);
      }
    });

    it("plural keys come in full sets (EN one/other, RU one/few/many/other)", () => {
      const bases = new Set([...Object.keys(en), ...Object.keys(ru)].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
      for (const b of bases) {
        for (const f of ["one", "other"]) expect([b, `${b}_${f}` in en]).toEqual([b, true]);
        for (const f of ["one", "few", "many", "other"]) expect([b, `${b}_${f}` in ru]).toEqual([b, true]);
      }
    });

    it("RU plural sentences carry the count (41 is a Russian \"one\" form)", () => {
      for (const [k, v] of Object.entries(ru)) if (/_one$/.test(k) && !k.startsWith("network.det.count")) expect([k, /\{n\}/.test(v)]).toEqual([k, true]);
    });

    it("uses none of the banned words", () => {
      for (const [k, v] of Object.entries(en)) for (const re of BANNED_EN) expect([k, re.test(v)]).toEqual([k, false]);
      for (const [k, v] of Object.entries(ru)) for (const re of BANNED_RU) expect([k, re.test(v)]).toEqual([k, false]);
    });
  });
}

describe("network formatters", () => {
  it("prints raw token amounts with their decimals and no float drift", () => {
    expect(amount(100n, 3)).toBe("0.10");
    expect(amount(2_700_000n, 6)).toBe("2.70");
    expect(amount(1n, 0)).toBe("1");
  });
  it("shortens ids head…tail and keeps them on one line", () => {
    // a line may break after "…" (UAX #14), so a word joiner holds the tail to the head
    expect(sid("0123456789abcdef", 4, 4)).toBe("0123…\u2060cdef");
    expect(sid("0123456789abcdef", 4, 4).replace("\u2060", "")).toBe("0123…cdef");
  });
  it("keeps axis labels inside the plot: a first tick on the left edge (a phone) sets its label to the right", () => {
    const px = (s: string) => s.length * AXIS_CH_PX;
    expect(axisEdge(0, px(monthLabel(Date.UTC(2026, 2, 1), "ru")), 358)).toBe("start");     // «МАР» on /network/redemptions
    expect(axisEdge(40, px("апр"), 358)).toBeNull();
    expect(axisEdge(355, px("ноя"), 358)).toBe("end");
    expect(axisEdge(132, px(monthLabel(Date.UTC(2026, 2, 1), "ru", true)), 1400)).toBeNull(); // desktop: lane labels on the left
  });
  it("names months on an axis in the nominative", () => {
    expect(monthLabel(Date.UTC(2026, 4, 1), "ru")).toBe("май");
    expect(monthLabel(Date.UTC(2026, 0, 1), "en")).toBe("Jan 2026");
  });
});
