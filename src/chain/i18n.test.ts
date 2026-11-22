// The chain strings: every EN key has a RU twin with the same {placeholders}, numbers use the U+2009 U+2060 separator,
// and none of the words VISUAL §14 bans appear in either language.
import { describe, expect, it } from "vitest";
import bundle from "./i18n";

const BANNED_EN = [/trustless/i, /guarantee/i, /\bsafe\b/i, /unstoppable/i, /live on mainnet/i, /launched/i, /official/i, /\byield\b/i, /\bAPY\b/, /7 days/i, /2 ?%/, /bearer/i];
const BANNED_RU = [/гарант/i, /безопасн/i, /официальн/i, /доходност/i, /запущен/i, /7 дн/i, /2 ?%/, /на предъявителя/i];
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("chain i18n", () => {
  const en = bundle.en as Record<string, string>;
  const ru = bundle.ru as Record<string, string>;

  it("has the same keys and placeholders in EN and RU (RU adds _few/_many plural forms)", () => {
    for (const k of Object.keys(en)) {
      expect(k.startsWith("chain.")).toBe(true);
      expect([k, k in ru]).toEqual([k, true]);
      expect([k, vars(ru[k])]).toEqual([k, vars(en[k])]);
    }
    for (const k of Object.keys(ru)) {
      if (k in en) continue;
      const m = /^(.*)_(few|many)$/.exec(k);
      expect([k, !!m && `${m[1]}_other` in en]).toEqual([k, true]);
      expect([k, vars(ru[k])]).toEqual([k, vars(en[`${m![1]}_other`])]);
    }
  });

  it("avoids the banned words and plain-space thousands", () => {
    for (const s of Object.values(en)) for (const b of BANNED_EN) expect(s).not.toMatch(b);
    for (const s of Object.values(ru)) for (const b of BANNED_RU) expect(s).not.toMatch(b);
    for (const s of [...Object.values(en), ...Object.values(ru)]) expect(s).not.toMatch(/\d \d{3}\b/);
  });
});
