// The mainnet wallet's strings: both languages carry the same keys and placeholders, and none of the words PRODUCT.md §1
// bans (the shell's lists, src/app/i18n.test.ts).
import { describe, expect, it } from "vitest";
import strings from "./strings";

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
