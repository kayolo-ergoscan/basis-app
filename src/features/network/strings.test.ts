// The /network strings: every EN key has a RU twin with the same {placeholders}, plural sets are complete, and none of
// the words VISUAL §14 bans appear in either language. Also checks the small pure helpers the pages lean on.
import { describe, expect, it } from "vitest";
import page from "./strings";
import route from "./i18n";
import { amount, monthLabel, sid } from "./fmt";
import overviewSrc from "./Overview.tsx?raw";
import trackersSrc from "./Trackers.tsx?raw";

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
  it("names months on an axis in the nominative", () => {
    expect(monthLabel(Date.UTC(2026, 4, 1), "ru")).toBe("май");
    expect(monthLabel(Date.UTC(2026, 0, 1), "en")).toBe("Jan 2026");
  });
});

describe("plain words on the tracker cards (UX review, 22 Nov 2026)", () => {
  const en = page.en as Record<string, string>;
  const ru = page.ru as Record<string, string>;
  const plain = (x: string) => x.replace(/[\u00a0\u2009\u2060]/g, " ").replace(/ {2,}/g, " ");

  it("the emergency window is explained once per page, under the cards, not in every card", () => {
    expect(overviewSrc).toContain("export function TrackerPanel({ tr, tip, compact, idle = true }");
    expect(overviewSrc).toContain('{idle && <p className="nw-em-idle">{t("network.em.idle")}</p>}');
    for (const src of [overviewSrc, trackersSrc]) {
      expect(src).toMatch(/<TrackerPanel key=\{tr\.nft\} tr=\{tr\} tip=\{obs\.height\} idle=\{false\} \/>/);
      expect(src.match(/nw-em-idle nw-em-idle-once/g)).toHaveLength(1);
    }
    expect(plain(en["network.em.idle"])).toMatch(/^The window opens on time, not on failure\. If a tracker has written nothing to Ergo for about 3 days \(2,160 blk\)/);
    expect(plain(ru["network.em.idle"])).toMatch(/^Окно открывается по времени, а не по поломке\. Если трекер около 3 дней \(2 160 блоков\)/);
  });

  it("the trackers page says what a tracker NFT is in words; R4 and R5 are under «Подробнее»", () => {
    expect(en["network.tl.lede"]).not.toMatch(/\bR[45]\b/);
    expect(ru["network.tl.lede"]).not.toMatch(/\bR[45]\b/);
    expect(plain(en["network.tl.techText"])).toContain("names a key in R4 and commits a digest of notes in R5");
    expect(plain(ru["network.tl.techText"])).toContain("называет ключ в R4 и фиксирует дайджест расписок в R5");
    expect(trackersSrc).toContain('<summary>{t("network.tl.tech")}</summary>');
  });
});
