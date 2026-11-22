// The /wallet strings and pure helpers: every EN key has a RU twin with the same {placeholders} (RU may add gendered
// `.f/.m/.n` forms and plural sets), no banned copy (VISUAL §14) in either language, every static t("wallet.…") key
// used by the pages exists, and the request-link / amount / policy-cap helpers behave.
import { describe, expect, it } from "vitest";
import type { AcceptanceConfig } from "@/protocol";
import page from "./strings";
import eager from "./i18n";
import route from "./route";
import { makePayLink, parsePayLink, plainAmount, policyCapFor, share } from "./lib/model";

const BANNED_EN = [
  /trustless/i,
  /guarantee/i,
  /\bsafe(ly|ty)?\b/i,
  /\blaunched\b/i,
  /\bofficial/i,
  /(^|[^\d.,])2[\s ⁠ ]*%/,
  /\b7[\s ]*days?\b/i,
  /seven days/i,
  /bearer/i,
  /unstoppable/i,
  /live on mainnet/i,
  /censorship-resistant/i,
  /risk-free/i,
  /insured/i,
  /audited/i,
  /\bAPY\b/,
  /\byield/i,
];
const BANNED_RU = [
  /гарантир/i,
  /безопасн/i,
  /запущен/i,
  /официальн/i,
  /(^|[^\d.,])2[\s ⁠ ]*%/,
  /(^|\D)7[\s ]*(дн|сут)/i,
  /семь дн/i,
  /на предъявителя/i,
  /бездовер/i,
  /аудирован/i,
  /прош[её]л аудит/i,
  /доходност/i,
];
const PLURAL = /_(one|few|many|other)$/;
const GENDER = /\.(f|m|n)$/;
const vars = (s: string) => [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();

const EN = { ...(eager.en as Record<string, string>), ...(page.en as Record<string, string>) };
const RU = { ...(eager.ru as Record<string, string>), ...(page.ru as Record<string, string>) };

describe("wallet strings", () => {
  it("every key starts with wallet.", () => {
    for (const k of [...Object.keys(EN), ...Object.keys(RU)]) expect([k, k.startsWith("wallet.")]).toEqual([k, true]);
  });

  it("EN and RU have the same keys and placeholders (RU adds gendered and plural forms)", () => {
    for (const k of Object.keys(EN)) {
      if (PLURAL.test(k)) continue;
      expect([k, k in RU]).toEqual([k, true]);
      expect([k, vars(RU[k] ?? "")]).toEqual([k, vars(EN[k])]);
    }
    for (const k of Object.keys(RU)) {
      if (PLURAL.test(k)) continue;
      const base = GENDER.test(k) ? k.replace(GENDER, "") : k;
      expect([k, base in EN]).toEqual([k, true]);
      expect([k, vars(RU[k])]).toEqual([k, vars(EN[base] ?? "")]);
    }
  });

  it("plural keys come in full sets (EN one/other, RU one/few/many/other) with the same placeholders", () => {
    const bases = new Set([...Object.keys(EN), ...Object.keys(RU)].filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
    expect(bases.size).toBeGreaterThan(0);
    for (const b of bases) {
      for (const f of ["one", "other"]) expect([b, `${b}_${f}` in EN]).toEqual([b, true]);
      for (const f of ["one", "few", "many", "other"]) {
        expect([b, `${b}_${f}` in RU]).toEqual([b, true]);
        expect([b, f, vars(RU[`${b}_${f}`] ?? "")]).toEqual([b, f, vars(EN[`${b}_other`] ?? "")]);
      }
    }
  });

  it("gendered RU keys come in full f/m/n sets", () => {
    const bases = new Set(Object.keys(RU).filter((k) => GENDER.test(k)).map((k) => k.replace(GENDER, "")));
    for (const b of bases) for (const g of ["f", "m", "n"]) expect([b, `${b}.${g}` in RU]).toEqual([b, true]);
  });

  it("uses none of the banned words", () => {
    for (const [k, v] of Object.entries(EN)) for (const re of BANNED_EN) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
    for (const [k, v] of Object.entries(RU)) for (const re of BANNED_RU) expect([k, String(re), re.test(v)]).toEqual([k, String(re), false]);
  });

  it("Russian prose uses «» quotes, never straight double quotes", () => {
    for (const [k, v] of Object.entries(RU)) expect([k, v.includes('"')]).toEqual([k, false]);
  });

  it("the redeem breakdown states the protocol fee as none (shared copy.fee)", () => {
    const redeem = import.meta.glob("./flows/Redeem.tsx", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    expect(Object.values(redeem).join("")).toContain("copy.feeProtocol");
    for (const v of [...Object.values(EN), ...Object.values(RU)]) expect([v, /protocol fee: (?!none)|комиссия протокола: (?!нет)/i.test(v)]).toEqual([v, false]);
  });

  it("every static wallet.* key the pages use exists", () => {
    const src = import.meta.glob(["./**/*.tsx", "./**/*.ts", "!./**/*.test.ts", "!./strings.ts", "!./i18n.ts"], { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const used = new Set<string>();
    for (const text of Object.values(src)) for (const m of text.matchAll(/["'](wallet\.[A-Za-z0-9_.]+)["']/g)) if (!m[1].endsWith(".")) used.add(m[1]);
    expect(used.size).toBeGreaterThan(100);
    const missing = [...used].filter((k) => !(k in EN) && !(`${k}_other` in EN) && !route.commands?.some((c) => c.id === k) && k !== route.titleKey);
    expect(missing).toEqual([]);
  });
});

describe("wallet route", () => {
  it("is /wallet/* with nav order 2 and labelled commands", () => {
    expect(route.id).toBe("wallet");
    expect(route.path).toBe("/wallet/*");
    expect(route.nav?.order).toBe(2);
    const title = route.titleKey ?? "";
    expect(title in EN && title in RU).toBe(true);
    for (const c of route.commands ?? []) {
      expect([c.id, c.labelKey in EN, c.labelKey in RU]).toEqual([c.id, true, true]);
      expect([c.id, c.to?.startsWith("/wallet")]).toEqual([c.id, true]);
    }
  });
});

describe("wallet helpers", () => {
  const pk = "02" + "ab".repeat(32);

  it("request links round-trip through parsePayLink", () => {
    const link = makePayLink("https://example.test", { to: pk, amount: "1.25", memo: "for the flour", tracker: "T-01" });
    expect(link.startsWith("https://example.test/wallet/pay?")).toBe(true);
    expect(link).not.toContain("denom=");
    expect(parsePayLink(link)).toEqual({ to: pk, amount: "1.25", denom: undefined, memo: "for the flour", tracker: "T-01" });
    const token = makePayLink("http://127.0.0.1:5180", { to: pk, amount: "38", denom: "token:x", tracker: "T-01" });
    expect(parsePayLink(token)).toMatchObject({ to: pk, amount: "38", denom: "token:x" });
  });

  it("parsePayLink accepts a bare key and a basis: URI, and refuses junk", () => {
    expect(parsePayLink(`  ${pk.toUpperCase()}  `)).toEqual({ to: pk });
    expect(parsePayLink(`basis:${pk}?amount=2,50`)).toMatchObject({ to: pk, amount: "2,50" });
    expect(parsePayLink("")).toEqual({ error: "empty" });
    expect(parsePayLink("hello")).toEqual({ error: "format" });
    expect(parsePayLink(`https://x/wallet/pay?to=${pk}&amount=1e9`)).toEqual({ error: "format" });
    expect(parsePayLink(`https://x/wallet/pay?to=04${"ab".repeat(32)}`)).toEqual({ error: "format" });
    const long = parsePayLink(`https://x/wallet/pay?to=${pk}&memo=${"m".repeat(200)}`);
    expect("to" in long && long.memo?.length).toBe(80);
  });

  it("plainAmount prints exact decimals without float drift", () => {
    expect(plainAmount(1_250_000_000n, 9)).toBe("1.25");
    expect(plainAmount(0n, 9)).toBe("0");
    expect(plainAmount(38_000n, 3)).toBe("38");
    expect(plainAmount(-5n, 3)).toBe("-0.005");
    expect(plainAmount(123_456_789_012_345_678n, 9)).toBe("123456789.012345678");
  });

  it("policyCapFor takes the largest whitelist max_debt that lists the key", () => {
    const other = "03" + "cd".repeat(32);
    const cfg: AcceptanceConfig = {
      default: "reject",
      root: "any",
      predicates: [
        { type: "whitelist", name: "a", holders: [other, pk.toUpperCase()], max_debt: 2_000_000_000n },
        { type: "whitelist", name: "b", holders: [pk], max_debt: 3_000_000_000n },
        { type: "whitelist", name: "c", holders: [pk], max_debt: null },
        { type: "collateralization", name: "d", min_ratio: 1 },
        { type: "any_of", name: "any", predicates: ["a", "b", "c", "d"] },
      ],
    };
    expect(policyCapFor(cfg, pk)).toBe(3_000_000_000n);
    expect(policyCapFor(cfg, "02" + "ef".repeat(32))).toBeNull();
    expect(policyCapFor(null, pk)).toBeNull();
  });

  it("share is a clamped 0…1 fraction and 0 for an empty whole", () => {
    expect(share(1n, 0n)).toBe(0);
    expect(share(1n, 4n)).toBe(0.25);
    expect(share(9n, 4n)).toBe(1);
  });
});
