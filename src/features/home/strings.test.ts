// Home strings: both languages, the copy rules (PRODUCT §1), and the first screen a newcomer reads — what it is and why
// in two sentences, one main button «Начать здесь»/Start here to the sandbox, the sandbox wallet named honestly.
import { describe, expect, it } from "vitest";
import { CLIENTS_HREF, faq, moments } from "@/content";
import { FAQ_HREF, faqHref, HOME_FAQ } from "./Faq";
import heroSrc from "./Hero.tsx?raw";
import momentsSrc from "./Moments.tsx?raw";
import pageSrc from "./Page.tsx?raw";
import spectrumSrc from "./Spectrum.tsx?raw";
import i18n from "./i18n";
import strings from "./strings";

const EN = { ...(i18n.en as Record<string, string>), ...(strings.en as Record<string, string>) };
const RU = { ...(i18n.ru as Record<string, string>), ...(strings.ru as Record<string, string>) };
const PLURAL = /_(one|few|many|other)$/;
/** Content text as plain words: house typography (no-break and thin spaces, word joiners) read as ordinary spaces. */
const plain = (s = "") => s.replace(/[\u00a0\u2009\u2060\u202f]/g, " ").replace(/ {2,}/g, " ");

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

describe("questions forward", () => {
  it("the first screen links the FAQ next to the main buttons, and so does «Для кого это»", () => {
    expect(FAQ_HREF).toBe("/learn/faq");
    expect(heroSrc).toContain('<Link className="textlink home-how" to={FAQ_HREF}>{t("home.cta.faq")}');
    expect(spectrumSrc).toContain('to={FAQ_HREF}>{t("home.cta.faq")}');
    expect([EN["home.cta.faq"], RU["home.cta.faq"]]).toEqual(["Questions and answers", "Вопросы и ответы"]);
  });

  it("Home answers three questions with the FAQ's own short answers and links each full answer", () => {
    expect(pageSrc).toMatch(/<Spectrum \/>\s*<HomeFaq \/>/);
    expect([...HOME_FAQ]).toEqual(["lose-money", "tracker-disappears", "launched"]);
    const qs = HOME_FAQ.map((id) => faq.find((f) => f.id === id));
    expect(qs.map((f) => plain(f?.q.ru))).toEqual(["Могу ли я потерять деньги?", "Что, если трекер исчезнет?", "Можно ли уже с настоящими ERG?"]);
    expect(qs.map((f) => plain(f?.q.en))).toEqual(["Can I lose money?", "What if the tracker disappears?", "Can I use real ERG yet?"]);
    for (const f of qs) expect(f?.short.en && f.short.ru).toBeTruthy();
    expect(HOME_FAQ.map(faqHref)).toEqual(["/learn/faq#q-lose-money", "/learn/faq#q-tracker-disappears", "/learn/faq#q-launched"]);
  });

  it("the real-ERG answer is honest: not on this site, play money, an experiment", () => {
    const f = faq.find((x) => x.id === "launched")!;
    expect(plain(f.short.en)).toMatch(/^Not on this site: its wallet is a sandbox with play money\./);
    expect(plain(f.short.ru)).toMatch(/^Не на этом сайте: его кошелёк — песочница с игровыми деньгами\./);
    expect(plain(f.short.en)).toMatch(/experimental: use small amounts only\.$/);
    expect(f.links?.map((l) => l.to)).toEqual(["/network", CLIENTS_HREF]);
  });
});

describe("five moments", () => {
  it("the protocol formulas sit under «Подробнее для разработчиков»/For developers, folded (М8)", () => {
    expect(momentsSrc).toMatch(/<details className="fact-d">\s*<summary>\{t\("home\.m\.dev"\)\}<\/summary>\s*<div className="fact">/);
    expect(momentsSrc).not.toMatch(/<details className="fact-d" open/);
    expect([EN["home.m.dev"], RU["home.m.dev"]]).toEqual(["For developers", "Подробнее для разработчиков"]);
  });

  it("each moment is two sentences, and «Доверие» says what the digest proves and what it does not", () => {
    const sentences = (s: string) => plain(s).split(/(?<=[.!?])\s+/).filter(Boolean);
    for (const m of moments) for (const lang of ["en", "ru"] as const) expect([m.id, lang, sentences(m.text[lang]).length]).toEqual([m.id, lang, 2]);
    const trust = moments.find((m) => m.id === "trust")!;
    expect(plain(trust.text.ru)).toBe("Раз в несколько минут трекер записывает в Ergo короткий отпечаток всех расписок — дайджест. По нему любой проверит, что расписка учтена, но не то, хватит ли у должника денег.");
    expect(plain(trust.text.en)).toBe("Every few minutes the tracker writes a short fingerprint of all notes to Ergo: the digest. Anyone can use it to check that a note is counted, but not whether the payer can pay.");
  });
});
