// Home strings: both languages, the copy rules (PRODUCT §1), and the first screen a newcomer reads — what it is and why
// in two sentences, one main button «Начать здесь»/Start here to the sandbox, the sandbox wallet named honestly.
import { describe, expect, it } from "vitest";
import heroSrc from "./Hero.tsx?raw";
import i18n from "./i18n";
import strings from "./strings";

const EN = { ...(i18n.en as Record<string, string>), ...(strings.en as Record<string, string>) };
const RU = { ...(i18n.ru as Record<string, string>), ...(strings.ru as Record<string, string>) };
const PLURAL = /_(one|few|many|other)$/;

const BANNED_EN = [/trustless/i, /guarante/i, /\bsafe(ly|r|st)?\b/i, /\bsafety\b/i, /unstoppable/i, /live on mainnet/i, /\blaunched\b/i, /\bofficial/i, /\byields?\b/i, /\bAPY\b/, /\b(7|seven) days\b/i, /(?<![\d.,])2 ?%/, /\bbearer\b/i, /risk-free/i];
const BANNED_RU = [/гарант/iu, /(?<!\p{L})безопасн/iu, /(?<!\p{L})официальн/iu, /доходност/iu, /запущен/iu, /бездовер/iu, /(?<!\d)7[\s ]+(дн|сут)/iu, /(?<![\d.,])2 ?%/u, /на[\s ]+предъявителя/iu];

describe("home strings", () => {
  it("EN and RU have the same keys (RU adds plural forms)", () => {
    const base = (k: string) => k.replace(PLURAL, "");
    expect([...new Set(Object.keys(EN).map(base))].sort()).toEqual([...new Set(Object.keys(RU).map(base))].sort());
  });

  it("use none of the banned words", () => {
    for (const [k, s] of Object.entries(EN)) for (const b of BANNED_EN) expect([k, b.test(s)]).toEqual([k, false]);
    for (const [k, s] of Object.entries(RU)) for (const b of BANNED_RU) expect([k, b.test(s)]).toEqual([k, false]);
  });

  it("Russian prose uses «» quotes, never straight double quotes", () => {
    for (const [k, s] of Object.entries(RU)) expect([k, s.includes('"')]).toEqual([k, false]);
  });
});

describe("home first screen", () => {
  it("says what Basis is and why in two sentences, in both languages", () => {
    const sentences = (s: string) => s.replace(/\*\*/g, "").split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(sentences(EN["home.lede"])).toHaveLength(2);
    expect(sentences(RU["home.lede"])).toHaveLength(2);
    expect(EN["home.lede"]).toMatch(/^Basis is \*\*notes instead of transfers\*\*/);
    expect(RU["home.lede"]).toMatch(/^Basis — это \*\*расписки вместо переводов\*\*/);
  });

  it("has one main button, «Начать здесь»/Start here, and it opens the sandbox", () => {
    expect([EN["home.cta.play"], RU["home.cta.play"]]).toEqual(["Start here", "Начать здесь"]);
    expect(heroSrc.match(/variant="primary"/g)).toHaveLength(1);
    expect(heroSrc).toContain('<Key variant="primary" size="lg" kbd="P" to="/play">{t("home.cta.play")}</Key>');
  });

  it("names the wallet honestly: a sandbox wallet, never «Открыть кошелёк»", () => {
    expect([EN["home.cta.wallet"], RU["home.cta.wallet"]]).toEqual(["Sandbox wallet", "Игровой кошелёк"]);
    for (const s of Object.values(EN)) expect(s).not.toMatch(/^Open (a )?wallet$/);
    for (const s of Object.values(RU)) expect(s).not.toMatch(/^Откр(ыть|ойте) кошел[её]к$/);
  });

  it("the legend puts the meaning first and the material in brackets", () => {
    for (const m of ["line", "metal", "light"]) {
      expect(EN[`home.mat.${m}.sub`]).toMatch(/^\(.+\)$/);
      expect(RU[`home.mat.${m}.sub`]).toMatch(/^\(.+\)$/);
    }
  });
});
