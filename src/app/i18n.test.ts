// The shell's strings: both languages, the copy rules (PRODUCT §1), and the banner every page shows — plain words
// first (an unofficial site, an experiment, small amounts on mainnet), no jargon in its first words.
import { describe, expect, it } from "vitest";
import i18n from "./i18n";

const EN = i18n.en as Record<string, string>;
const RU = i18n.ru as Record<string, string>;
const BANNED_EN = [/trustless/i, /guarante/i, /\bsafe(ly|r|st)?\b/i, /unstoppable/i, /live on mainnet/i, /\blaunched\b/i, /\bofficial/i, /\byields?\b/i, /\bAPY\b/, /\b7 days\b/i, /(?<![\d.,])2 ?%/, /\bbearer\b/i];
const BANNED_RU = [/гарант/iu, /(?<!\p{L})безопасн/iu, /(?<!\p{L})официальн/iu, /доходност/iu, /запущен/iu, /бездовер/iu, /(?<!\d)7[\s ]+дн/iu, /(?<![\d.,])2 ?%/u, /на[\s ]+предъявителя/iu];

describe("shell strings", () => {
  it("EN and RU have the same keys", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(RU).sort());
  });

  it("use none of the banned words", () => {
    for (const [k, s] of Object.entries(EN)) for (const b of BANNED_EN) expect([k, b.test(s)]).toEqual([k, false]);
    for (const [k, s] of Object.entries(RU)) for (const b of BANNED_RU) expect([k, b.test(s)]).toEqual([k, false]);
  });

  it("the banner starts with who made the site and says Basis is an experiment, small amounts only", () => {
    const plain = (s: string) => s.replace(/ /g, " ");
    expect(plain(EN["app.banner"])).toBe("An unofficial site by ErgoScan (not by Better Money Labs). Basis is an experiment: on Ergo mainnet, use small amounts only.");
    expect(plain(RU["app.banner"])).toBe("Неофициальный сайт от ErgoScan (не от Better Money Labs). Basis — эксперимент: в основной сети Ergo — только небольшие суммы.");
  });

  it("names: «Главная», «Тёмная / Светлая», «Кошелёк (бета)»", () => {
    expect([EN["nav.story"], RU["nav.story"]]).toEqual(["Home", "Главная"]);
    expect([EN["app.theme.night"], EN["app.theme.cotton"], RU["app.theme.night"], RU["app.theme.cotton"]]).toEqual(["Dark", "Light", "Тёмная", "Светлая"]);
    expect([EN["app.openWallet"], RU["app.openWallet"]]).toEqual(["Wallet (beta)", "Кошелёк (бета)"]);
  });
});
