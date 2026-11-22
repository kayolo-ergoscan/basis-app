// /play strings: both languages, the copy rules (PRODUCT §1), and the first scenario a newcomer plays («Кафе в долг»)
// told in plain words; its technical details (basis.es, R6, the redemption tree) live in the «Осмотр» panel.
import { describe, expect, it } from "vitest";
import inspectorSrc from "./Inspector.tsx?raw";
import strings from "./strings";

const EN = strings.en as Record<string, string>;
const RU = strings.ru as Record<string, string>;
const plain = (s = "") => s.replace(/[  ⁠ ]/g, " ").replace(/ {2,}/g, " ");
const BANNED_EN = [/trustless/i, /guarante/i, /\bsafe(ly|r|st)?\b/i, /unstoppable/i, /live on mainnet/i, /\blaunched\b/i, /\bofficial/i, /\byields?\b/i, /\bAPY\b/, /(?<![\d.,])2 ?%/, /\bbearer\b/i];
const BANNED_RU = [/гарант/iu, /(?<!\p{L})безопасн/iu, /(?<!\p{L})официальн/iu, /доходност/iu, /запущен/iu, /бездовер/iu, /(?<![\d.,])2 ?%/u, /на[\s ]+предъявителя/iu];

describe("play strings", () => {
  it("EN and RU have the same keys", () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(RU).sort());
  });

  it("use none of the banned words", () => {
    for (const [k, s] of Object.entries(EN)) for (const b of BANNED_EN) expect([k, b.test(s)]).toEqual([k, false]);
    for (const [k, s] of Object.entries(RU)) for (const b of BANNED_RU) expect([k, b.test(s)]).toEqual([k, false]);
  });
});

describe("«Кафе в долг» in plain words", () => {
  const steps = Object.keys(EN).filter((k) => k.startsWith("play.sc.cafe-on-credit.") && k.endsWith(".x"));

  it("has its ten steps, none of them in protocol jargon", () => {
    expect(steps).toHaveLength(10);
    for (const k of steps) {
      expect([k, /basis\.es|\bR[4-7]\b|redemption tree|80 bytes|witness/i.test(EN[k])]).toEqual([k, false]);
      expect([k, /basis\.es|\bR[4-7]\b|дерев|80 байт|заверяет/i.test(RU[k])]).toEqual([k, false]);
    }
  });

  it("the first step says what a reserve is for", () => {
    expect(plain(EN["play.sc.cafe-on-credit.reserve.x"])).toBe("Alice locks 20 ERG in a reserve to back her notes. The reserve works with the Riverside tracker. Nothing has been paid out yet.");
    expect(plain(RU["play.sc.cafe-on-credit.reserve.x"])).toBe("Алиса кладёт 20 ERG в резерв — это залог под её расписки. Резерв работает с трекером Riverside. Выплат из него ещё не было.");
  });

  it("the reserve panel of «Осмотр» still names the contract, the box and the tracker in R6", () => {
    expect(inspectorSrc).toContain('{r.contract === "basis-token" ? "basis-token.es" : "basis.es"}');
    expect(inspectorSrc).toContain("· R6 → {tr ? displayName(eco, tr.id, lang)");
    expect(EN["play.ins.r.tree"]).toBe("Redemption tree (R5)");
  });
});
