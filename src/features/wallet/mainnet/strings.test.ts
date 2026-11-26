// The mainnet wallet's strings: both languages carry the same keys and placeholders, and none of the words PRODUCT.md §1
// bans (the shell's lists, src/app/i18n.test.ts). Then key setup's warnings and the seed tab's words.
import { describe, expect, it } from "vitest";
import strings from "./strings";
import startSrc from "./Start.tsx?raw";
import requestSrc from "./request.tsx?raw";

const EN = strings.en as Record<string, string>;
const RU = strings.ru as Record<string, string>;
const BANNED_EN = [/trustless/i, /guarante/i, /\bsafe(ly|r|st)?\b/i, /unstoppable/i, /live on mainnet/i, /\blaunched\b/i, /\bofficial/i];
const BANNED_RU = [/гарант/iu, /(?<!\p{L})безопасн/iu, /(?<!\p{L})официальн/iu, /запущен/iu, /бездовер/iu];
const holes = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort().join(",");

describe("mainnet wallet strings", () => {
  it("EN and RU have the same keys and the same placeholders", () => {
    expect(Object.keys(RU).sort()).toEqual(Object.keys(EN).sort());
    for (const k of Object.keys(EN)) expect([k, holes(RU[k] ?? "")]).toEqual([k, holes(EN[k])]);
  });

  it("use none of the banned words", () => {
    for (const [k, s] of Object.entries(EN)) for (const b of BANNED_EN) expect([k, b.test(s)]).toEqual([k, false]);
    for (const [k, s] of Object.entries(RU)) for (const b of BANNED_RU) expect([k, b.test(s)]).toEqual([k, false]);
  });
});

// Key setup puts the form first: one warning line above it, the four warnings under «More» (in the page before a key
// exists, so they are read before it is made), and all four again with the backup step once the key exists.

describe("key setup: the form first, every warning kept", () => {
  it("the four warnings are one list, shown under «More» before a key exists and in the page once it does", () => {
    const list = startSrc.slice(startSrc.indexOf("function WarnList()"), startSrc.indexOf("function Hero("));
    for (const k of ["small", "key", "storage", "experimental"]) expect([k, list.includes(`t("mw.warn.${k}")`)]).toEqual([k, true]);
    expect(startSrc).toMatch(/<details className="mw-warn-more">\s*<summary>\{t\("mw\.start\.warnMore"\)\}<\/summary>\s*<WarnList \/>/);
    expect(startSrc).toMatch(/state\.status === "none"\) \{\s*body = \(\s*<>\s*<WarnLine \/>\s*<Seg /);
    expect(startSrc).toContain('<Hero warnings={state.status !== "none" && state.status !== "loading"} />');
    expect(EN["mw.start.warnLine"]).toBe("The key lives only in this browser; only the backup file and its passphrase bring it back. Small amounts only.");
    expect(RU["mw.start.warnLine"]).toBe("Ключ хранится только в этом браузере, вернуть его можно только файлом копии и паролем. Только небольшие суммы.");
  });

  it("the seed tab says what it does, with the advice beside it; the seed field keeps its attributes", () => {
    expect([EN["mw.start.tab.seed"], RU["mw.start.tab.seed"]]).toEqual(["Move a key from an Ergo wallet", "Перенести ключ из кошелька Ergo"]);
    expect(RU["mw.start.seedTip"]).toBe("Лучше — отдельный кошелёк с небольшой суммой.");
    expect(startSrc).toMatch(/t\("mw\.start\.seedTip"\)[\s\S]{0,200}t\("mw\.start\.seedB"\)/);
    expect(startSrc).toContain('<SecretField ref={wordsEl} name="basis-seed-import" flat shown={shown} onInput={typed}');
  });

  it("the request page's «what is Basis» key opens the one-minute section", () => {
    expect(requestSrc).toContain('to="/learn/how#minute"');
  });
});
