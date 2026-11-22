// Numbers follow the page language (operator, 22 Nov 2026; UX review §8 #8): RU «9,545 ERG», «1 240,00» with a thin
// space in the thousands; EN "9.545 ERG", "1,240.00". One switch (setLang → setNumberLang) moves every formatter: the
// kit's, the world's, the X-rays', the chain's, /network's and the house typography of prose. The height pill says
// «Блок»/Block, and Russian never shortens blocks to «блк» or «бл.».
import { afterAll, describe, expect, it } from "vitest";
import { ERG } from "@/protocol";
import { fmtInt as chainInt } from "@/chain/decode";
import { copy } from "@/content";
import { amount } from "@/features/network/fmt";
import { int, money, numberLang, parseMoney, units } from "@/ui/engine/money";
import { fmtAmount as vizAmount, ERG_UNIT } from "@/viz/core/format";
import { fmtUnits, parseAmount } from "@/world/format";
import { worldText } from "@/world/i18n";
import { getLang, setLang, translate } from "./lang";

const T = " ⁠";
const N = " ";
const was = getLang();
afterAll(() => setLang(was));

const NANO_9545 = 9_545_000_000n;
const NANO_1240 = 1_240_000_000_000n;

describe("numbers per language", () => {
  it("RU: decimal comma and thin-space thousands everywhere at once", () => {
    setLang("ru");
    expect(numberLang()).toBe("ru");
    expect(units(NANO_9545, 9, 3)).toBe("9,545"); // the Home tile and the line under it
    expect(money(1240)).toBe(`1${T}240,00`);
    expect(int(1922434)).toBe(`1${T}922${T}434`);
    expect(fmtUnits(NANO_1240, 9)).toBe(`1${T}240,00`); // world: feed lines, toasts
    expect(vizAmount(NANO_9545, ERG_UNIT)).toBe(`9,545${N}ERG`); // X-rays
    expect(chainInt(1922434)).toBe(`1${T}922${T}434`);
    expect(amount(NANO_9545, 9)).toBe("9,545"); // /network
    expect(worldText("world.code.fee-funds", undefined, "ru")).toMatch(/0,001[ \u00a0]ERG/);
  });

  it("EN: comma thousands and a decimal point everywhere at once", () => {
    setLang("en");
    expect(numberLang()).toBe("en");
    expect(units(NANO_9545, 9, 3)).toBe("9.545");
    expect(money(1240)).toBe("1,240.00");
    expect(int(1922434)).toBe("1,922,434");
    expect(fmtUnits(NANO_1240, 9)).toBe("1,240.00");
    expect(vizAmount(NANO_9545, ERG_UNIT)).toBe(`9.545${N}ERG`);
    expect(chainInt(1922434)).toBe("1,922,434");
    expect(amount(NANO_9545, 9)).toBe("9.545");
  });

  it("inputs read back what the page wrote, in both languages", () => {
    for (const l of ["en", "ru"] as const) {
      setLang(l);
      expect(parseAmount(fmtUnits(NANO_1240, 9), ERG)).toBe(NANO_1240);
      expect(parseAmount(units(NANO_9545, 9, 3), ERG)).toBe(NANO_9545);
      expect(parseMoney(money(-1240.5))).toBe(-1240.5);
    }
  });

  it("prose follows the same rule: EN «2,160 blk», RU «2 160 блоков»", () => {
    expect(copy.emergencyRule.en).toContain("2,160");
    expect(copy.refundRule.en).toContain("43,200");
    expect(copy.emergencyRule.ru).toContain(`2${T}160${N}блоков`);
    expect(copy.refundRule.ru).toContain(`43${T}200${N}блоков`);
  });
});

describe("blocks in words", () => {
  it("the height pill says what the number is: «Блок»/Block", () => {
    expect([translate("app.height.label", undefined, "ru"), translate("app.height.label", undefined, "en")]).toEqual(["Блок", "Block"]);
  });

  it("Russian strings never shorten blocks to «блк» or «бл.»", () => {
    const bundles = import.meta.glob<{ default?: { ru?: Record<string, unknown> } }>("/src/**/{i18n,strings}.ts", { eager: true });
    const bad: string[] = [];
    let seen = 0;
    for (const [path, m] of Object.entries(bundles)) {
      for (const [k, v] of Object.entries(m.default?.ru ?? {})) {
        if (typeof v !== "string") continue;
        seen++;
        if (/(?<!\p{L})(блк|бл\.)/u.test(v)) bad.push(`${path} ${k}`);
      }
    }
    expect(bad).toEqual([]);
    expect(seen).toBeGreaterThan(2000);
  });

  it("hand-set English strings group thousands with a comma, not a space", () => {
    const raw = import.meta.glob<{ default?: { en?: Record<string, unknown> } }>(
      ["/src/app/i18n.ts", "/src/chain/i18n.ts", "/src/world/i18n.ts", "/src/ui/i18n.ts", "/src/features/network/strings.ts", "/src/features/home/{i18n,strings}.ts"],
      { eager: true },
    );
    const bad: string[] = [];
    for (const [path, m] of Object.entries(raw)) {
      for (const [k, v] of Object.entries(m.default?.en ?? {})) {
        if (typeof v === "string" && /\d(?: | ⁠?)\d{3}(?!\d)/.test(v)) bad.push(`${path} ${k}`);
      }
    }
    expect(bad).toEqual([]);
    expect(Object.keys(raw)).toHaveLength(7);
  });
});
