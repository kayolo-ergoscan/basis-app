// World strings: every key prefixed world., translated to Russian with the same placeholders and plural forms,
// and no wording the honesty rules forbid (PRODUCT §1, VISUAL §14).
import { describe, expect, it } from "vitest";
import bundle, { castName, worldPlural, worldText, WORLD_KEYS } from "../i18n";
import { RESIDENTS } from "../town/genesis";

const en = bundle.en as Record<string, string>;
const ru = bundle.ru as Record<string, string>;
const placeholders = (s: string) => [...s.matchAll(/\{([a-zA-Z0-9_@]+)\}/g)].map((m) => m[1]).sort();

const FORBIDDEN_EN = [/trustless/i, /guarantee/i, /\bsafe(ly|ty)?\b/i, /unstoppable/i, /live on mainnet/i, /\blaunch(ed)?\b/i, /\bofficial/i, /\byield\b/i, /\bAPY\b/i, /2\s?% fee/i, /7 days/i, /\bbearer\b/i];
const FORBIDDEN_RU = [/гарант/i, /безопасн/i, /официальн/i, /доходност/i, /7 дн/i, /предъявител/i, /запущен/i, /неостановим/i, /без доверия/i];
// the only products this sandbox may name: none besides its own; venue/tool names never appear in copy
const THIRD_PARTY = [/ergoscan/i, /explorer/i, /обозревател/i, /\bUSE\b/, /SigUSD/i, /nautilus/i, /metamask/i];

describe("world i18n", () => {
  it("every key starts with world. and has a Russian translation with the same placeholders", () => {
    const missing: string[] = [];
    const mismatched: string[] = [];
    for (const k of Object.keys(en)) {
      expect(k.startsWith("world."), k).toBe(true);
      if (!(k in ru)) {
        missing.push(k);
        continue;
      }
      const base = k.replace(/_(one|few|many|other)$/, "");
      if (base !== k) continue; // plural forms may drop {n} in Russian ("один блок")
      if (placeholders(en[k]).join() !== placeholders(ru[k]).join()) mismatched.push(`${k}: ${placeholders(en[k])} vs ${placeholders(ru[k])}`);
    }
    expect(missing).toEqual([]);
    expect(mismatched).toEqual([]);
    for (const k of Object.keys(ru)) expect(k in en, `ru-only key ${k}`).toBe(true);
    expect(WORLD_KEYS.length).toBe(Object.keys(en).length);
  });

  it("Russian plurals have one/few/many/other", () => {
    const bases = new Set(Object.keys(en).filter((k) => /_(one|other)$/.test(k)).map((k) => k.replace(/_(one|few|many|other)$/, "")));
    for (const b of bases) for (const f of ["one", "few", "many", "other"]) expect(ru[`${b}_${f}`], `${b}_${f}`).toBeTruthy();
    expect(worldPlural("world.blocks", 1, {}, "ru")).toMatch(/1\D+блок$/);
    expect(worldPlural("world.blocks", 3, {}, "ru")).toMatch(/блока$/);
    expect(worldPlural("world.blocks", 5, {}, "ru")).toMatch(/блоков$/);
    expect(worldPlural("world.blocks", 21, {}, "ru")).toMatch(/блок$/);
    expect(worldPlural("world.blocks", 2, {}, "en")).toMatch(/blocks$/);
  });

  it("no forbidden or third-party wording in either language", () => {
    const bad: string[] = [];
    for (const [k, v] of Object.entries(en)) for (const re of [...FORBIDDEN_EN, ...THIRD_PARTY]) if (re.test(v)) bad.push(`en ${k}: ${v}`);
    for (const [k, v] of Object.entries(ru)) for (const re of [...FORBIDDEN_RU, ...FORBIDDEN_EN, ...THIRD_PARTY]) if (re.test(v)) bad.push(`ru ${k}: ${v}`);
    expect(bad).toEqual([]);
  });

  it("policy numbers are wallet policy, not contract rules; sandbox is named as such", () => {
    expect(en["world.policy.disclaimer"]).toMatch(/wallet/i);
    expect(ru["world.policy.disclaimer"]).toMatch(/кошел/i);
    expect(en["world.sandbox.keyLabel"]).toMatch(/sandbox/i);
    expect(ru["world.sandbox.keyLabel"]).toMatch(/песочниц/i);
  });

  it("names and interpolation", () => {
    for (const r of RESIDENTS) {
      expect(castName(r.id, "en")).toBeTruthy();
      expect(castName(r.id, "ru")).toBeTruthy();
    }
    expect(worldText("world.toast.refused", { reason: "world.code.credit-limit" }, "ru")).not.toMatch(/\{|world\./);
    expect(worldText("world.no-such-key", {}, "en")).toBe("world.no-such-key");
  });
});
