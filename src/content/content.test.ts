// Content checks: contract ranges and hashes, reason coverage against the engine's own unions, bilingual
// completeness, Russian typography and the copy guard (forbidden words only inside marked "this is NOT" sentences).

import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import reserveSrc from "@/protocol/reserve.ts?raw";
import trackerSrc from "@/protocol/tracker.ts?raw";
import schnorrSrc from "@/protocol/schnorr.ts?raw";
import * as C from "./index";
import type { Annotation, ContractId, LineRange, Text } from "./index";

// ---------------------------------------------------------------- helpers

/** String literals of `export type <name> = … ;` in an engine source file. */
function unionLiterals(src: string, name: string): string[] {
  const start = src.indexOf(`export type ${name} =`);
  if (start < 0) throw new Error(`type ${name} not found`);
  const end = src.indexOf(";", start);
  const body = src
    .slice(start, end)
    .split("\n")
    .map((l) => l.replace(/\/\/.*$/, ""))
    .join("\n");
  return [...body.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function isText(v: unknown): v is Text {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  return keys.length === 2 && typeof (v as Text).en === "string" && typeof (v as Text).ru === "string";
}

interface Found {
  path: string;
  text: Text;
}

/** Every Text reachable from a value, plus the EN/RU pairs of contract annotations. */
function collectTexts(root: unknown, path: string, out: Found[], seen = new Set<unknown>()): Found[] {
  if (root === null || typeof root !== "object") return out;
  if (seen.has(root)) return out;
  seen.add(root);
  if (isText(root)) {
    out.push({ path, text: root });
    return out;
  }
  if (Array.isArray(root)) {
    root.forEach((v, i) => collectTexts(v, `${path}[${i}]`, out, seen));
    return out;
  }
  const o = root as Record<string, unknown>;
  for (const pair of ["title", "text", "warning"]) {
    const en = o[`${pair}EN`];
    const ru = o[`${pair}RU`];
    if (typeof en === "string" || typeof ru === "string") out.push({ path: `${path}.${pair}EN/RU`, text: { en: String(en ?? ""), ru: String(ru ?? "") } });
  }
  for (const [k, v] of Object.entries(o)) collectTexts(v, `${path}.${k}`, out, seen);
  return out;
}

const exported = C as unknown as Record<string, unknown>;
const texts: Found[] = [];
for (const [name, value] of Object.entries(exported)) {
  if (name === "contentI18n" || name === "DENIALS") continue;
  collectTexts(value, name, texts);
}
// Function-built copy, with sample inputs.
texts.push({ path: "copy.mainnetFootnote(99)", text: C.copy.mainnetFootnote({ boxes: 99, erg: "8.995", height: 1921849 }) });
texts.push({ path: "copy.mainnetFootnote(1)", text: C.copy.mainnetFootnote({ boxes: 1, erg: "0.1" }) });
texts.push({ path: "copy.asOfBlock", text: C.copy.asOfBlock(1921849) });

/** Remove quoted and code spans (verbatim server strings, identifiers) before style checks. */
const unquote = (s: string) => s.replace(/“[^”]*”|«[^»]*»|‘[^’]*’|`[^`]*`/g, "");

// ---------------------------------------------------------------- copy guard

const SPACE = "[\\s\\u00a0\\u2009\\u2060]*";
const FORBIDDEN_EN: RegExp[] = [
  /\btrustless\b/i,
  /\bguarantee(d|s|ing)?\b/i,
  /\bsafe(ly|r|st)?\b/i,
  /\bsafety\b/i,
  /\blaunched\b/i,
  /\bofficial(ly)?\b/i,
  new RegExp(`(?<![\\d.,])2${SPACE}%`),
  /\b(7|seven)[\s -]+days?\b/i,
  /\bbearer\b/i,
  /\bunstoppable\b/i,
  /\blive on mainnet\b/i,
  /\bcensorship-resistant\b/i,
  /\brisk-free\b/i,
  /\binsured\b/i,
  /\baudited\b/i,
  /\bAPY\b/,
  /\byields?\b/i,
];
const FORBIDDEN_RU: RegExp[] = [
  /гарантир/iu,
  /(?<!\p{L})безопасн(?!ост)/iu,
  /запущен/iu,
  /(?<!\p{L})официальн/iu,
  new RegExp(`(?<![\\d.,])2${SPACE}%`, "u"),
  /(?<!\d)7[\s ]+(дн|сут)/iu,
  /(?<!\p{L})семь[\s ]+(дн|сут)/iu,
  /на[\s ]+предъявителя/iu,
  /бездовер/iu,
  /аудирован/iu,
  /прош[её]л[\s ]+аудит/iu,
  /доходност/iu,
];
const NEGATION_EN = /\b(not|no|never|nothing|none|cannot|neither|nor|without)\b|n[’']t\b/i;
const NEGATION_RU = /(?<!\p{L})(не|нет|ни|никогда|ничего|нельзя|без)(?!\p{L})/iu;

function sentences(s: string): string[] {
  return s.split(/(?<=[.!?…])\s+/u);
}

function guardViolations(s: string, lang: "en" | "ru"): string[] {
  const rules = lang === "en" ? FORBIDDEN_EN : FORBIDDEN_RU;
  const neg = lang === "en" ? NEGATION_EN : NEGATION_RU;
  const bad: string[] = [];
  for (const sentence of sentences(s)) {
    for (const rule of rules) {
      if (!rule.test(sentence)) continue;
      // copy-guard: denial — allowed only in a registered denial() string whose sentence carries a negation.
      if (!C.DENIALS.has(s)) bad.push(`"${rule.source}" outside denial(): ${sentence}`);
      else if (!neg.test(sentence)) bad.push(`"${rule.source}" in a denial without negation: ${sentence}`);
    }
  }
  return bad;
}

// ---------------------------------------------------------------- tests

describe("contracts", () => {
  const ids: ContractId[] = ["basis", "token"];

  it("sources are verbatim at the pinned ref (sha256 of the joined lines)", () => {
    for (const id of ids) {
      const c = C.contracts[id];
      const body = c.lines.join("\n") + (c.trailingNewline ? "\n" : "");
      expect(bytesToHex(sha256(utf8ToBytes(body))), c.file).toBe(c.sha256);
      expect(c.gitRef).toBe(C.GIT_REF);
      expect(c.url).toContain(C.GIT_REF);
      expect(c.lines.length).toBe(470);
    }
  });

  it("annotations are inside the source, sorted, non-overlapping and bilingual", () => {
    for (const id of ids) {
      const n = C.contracts[id].lines.length;
      const list: Annotation[] = C.annotations[id];
      expect(list.length).toBeGreaterThan(40);
      let prevTo = 0;
      for (const a of list) {
        expect(a.from, `${id}:${a.id}`).toBeGreaterThanOrEqual(1);
        expect(a.to, `${id}:${a.id}`).toBeLessThanOrEqual(n);
        expect(a.from, `${id}:${a.id}`).toBeLessThanOrEqual(a.to);
        expect(a.from, `${id}:${a.id} overlaps`).toBeGreaterThan(prevTo);
        prevTo = a.to;
        for (const f of [a.titleEN, a.titleRU, a.textEN, a.textRU]) expect(f.trim().length, `${id}:${a.id}`).toBeGreaterThan(0);
        if (a.warningEN !== undefined || a.warningRU !== undefined) {
          expect(a.warningEN?.trim(), `${id}:${a.id} warningEN`).toBeTruthy();
          expect(a.warningRU?.trim(), `${id}:${a.id} warningRU`).toBeTruthy();
        }
      }
    }
  });

  it("every meaningful code line is covered by some annotation", () => {
    for (const id of ids) {
      const c = C.contracts[id];
      const covered = new Set<number>();
      for (const a of C.annotations[id]) for (let l = a.from; l <= a.to; l++) covered.add(l);
      const firstCode = Math.min(...C.annotations[id].filter((a) => a.section === "code").map((a) => a.from));
      const missing = c.lines
        .map((text, i) => ({ text, line: i + 1 }))
        .filter(({ text, line }) => line >= firstCode && text.trim() !== "" && !text.trim().startsWith("//") && !/^[{}()\s]*$/.test(text) && !covered.has(line));
      expect(missing.map((m) => `${m.line}: ${m.text.trim()}`), id).toEqual([]);
    }
  });

  it("every engine ReserveCheckId has reasonLines inside the sources", () => {
    const checks = unionLiterals(reserveSrc, "ReserveCheckId");
    expect(checks.length).toBeGreaterThanOrEqual(30);
    for (const check of checks) {
      const rl = (C.reasonLines as Record<string, { basis: LineRange[]; token: LineRange[] }>)[check];
      expect(rl, check).toBeDefined();
      const only = (C.CONTRACT_ONLY as Record<string, ContractId | undefined>)[check];
      if (only !== "token") expect(rl.basis.length, `${check} basis`).toBeGreaterThan(0);
      if (only !== "basis") expect(rl.token.length, `${check} token`).toBeGreaterThan(0);
      for (const id of ids) {
        const n = C.contracts[id].lines.length;
        for (const r of rl[id]) {
          expect(r.from, `${check} ${id}`).toBeGreaterThanOrEqual(1);
          expect(r.to, `${check} ${id}`).toBeLessThanOrEqual(n);
          expect(r.from, `${check} ${id}`).toBeLessThanOrEqual(r.to);
        }
      }
    }
  });

  it("a check named as a val in the contract is mapped onto that val's line", () => {
    for (const id of ids) {
      const lines = C.contracts[id].lines;
      for (const [check, rl] of Object.entries(C.reasonLines)) {
        const valLine = lines.findIndex((l) => new RegExp(`\\bval ${check}\\b`).test(l)) + 1;
        if (valLine === 0) continue;
        const hit = rl[id].some((r) => r.from <= valLine && valLine <= r.to);
        expect(hit, `${id}: ${check} (val at line ${valLine})`).toBe(true);
      }
    }
  });

  it("action line sets cover the four actions without gaps in order", () => {
    for (const id of ids) {
      const n = C.contracts[id].lines.length;
      for (const key of ["prelude", 0, 1, 2, 3] as const) {
        const set = C.actionLines[id][key];
        expect(set.length, `${id} ${key}`).toBeGreaterThan(0);
        for (const r of set) expect(r.to <= n && r.from >= 1 && r.from <= r.to, `${id} ${key}`).toBe(true);
      }
      expect(C.actionLines[id][0][0].from).toBeGreaterThan(C.actionLines[id].prelude[0].to);
    }
  });
});

describe("reasons", () => {
  it("covers every engine code: contract checks, tracker errors, X-ray checks", () => {
    for (const c of unionLiterals(reserveSrc, "ReserveCheckId")) expect(C.reserveCheckReasons[c as keyof typeof C.reserveCheckReasons], c).toBeDefined();
    const trackerCodes = unionLiterals(trackerSrc, "TrackerErrorCode");
    expect(trackerCodes.length).toBeGreaterThanOrEqual(20);
    for (const c of trackerCodes) {
      const r = C.trackerReasons[c as keyof typeof C.trackerReasons];
      expect(r, c).toBeDefined();
      if (r.mirrors) expect(C.reasonLines[r.mirrors].basis.length, `${c} → ${r.mirrors}`).toBeGreaterThan(0);
    }
    for (const c of unionLiterals(schnorrSrc, "XrayCheckId")) expect(C.xrayReasons[c as keyof typeof C.xrayReasons], c).toBeDefined();
    expect(C.reasonFor("failed_not_oldest_note")?.title.en).toBeTruthy();
    expect(C.reasonFor("no-such-code")).toBeUndefined();
  });
});

describe("bilingual text", () => {
  it("found a meaningful number of strings", () => {
    expect(texts.length).toBeGreaterThan(800);
  });

  it("includes the ready-made programs, so the copy guard and the typography checks cover them", () => {
    for (const name of ["clientPrograms", "clients"]) expect(texts.some((f) => f.path.startsWith(name)), name).toBe(true);
    expect(texts.filter((f) => f.path.startsWith("clients.")).length).toBeGreaterThanOrEqual(12);
  });

  it("every EN and RU string is non-empty", () => {
    const empty = texts.filter((f) => !f.text.en.trim() || !f.text.ru.trim()).map((f) => f.path);
    expect(empty).toEqual([]);
  });

  it("i18n bundle: every key has both languages", () => {
    const { en, ru } = C.contentI18n;
    expect(Object.keys(en).length).toBeGreaterThan(30);
    for (const k of Object.keys(en)) {
      expect(en[k]?.trim(), k).toBeTruthy();
      expect(ru[k]?.trim(), k).toBeTruthy();
    }
  });

  it("Russian typography: «ёлочки», no straight quotes, no hyphen dashes, NBSP after numbers", () => {
    const bad: string[] = [];
    for (const { path, text } of texts) {
      const s = text.ru;
      const plain = unquote(s);
      if (/"/.test(plain)) bad.push(`${path}: straight quote: ${s}`);
      if (/ - /.test(plain)) bad.push(`${path}: hyphen as dash: ${s}`);
      if (/\.\.\./.test(s)) bad.push(`${path}: three dots: ${s}`);
      if (/\d [\p{L}]/u.test(plain)) bad.push(`${path}: plain space after a number: ${s}`);
    }
    expect(bad).toEqual([]);
  });

  it("English typography: no hyphen dashes, no straight quotes in prose", () => {
    const bad: string[] = [];
    for (const { path, text } of texts) {
      const plain = unquote(text.en);
      if (/ - /.test(plain)) bad.push(`${path}: hyphen as dash: ${text.en}`);
      if (/\.\.\./.test(text.en)) bad.push(`${path}: three dots: ${text.en}`);
    }
    expect(bad).toEqual([]);
  });

  it("copy guard: forbidden words appear only inside marked denials with a negation", () => {
    const bad: string[] = [];
    for (const { path, text } of texts) {
      for (const v of guardViolations(text.en, "en")) bad.push(`${path} [en] ${v}`);
      for (const v of guardViolations(text.ru, "ru")) bad.push(`${path} [ru] ${v}`);
    }
    expect(bad).toEqual([]);
  });

  it("copy guard catches what it should", () => {
    expect(guardViolations("Basis is trustless.", "en").length).toBe(1);
    expect(guardViolations("The fee is 2 %.", "en").length).toBe(1);
    expect(guardViolations("Coverage of 120 % and 12 % are fine.", "en").length).toBe(0);
    expect(guardViolations("This is an unofficial interface.", "en").length).toBe(0);
    expect(guardViolations("Протокол гарантирует выплату.", "ru").length).toBe(1);
    expect(guardViolations("Ревью безопасности прошло.", "ru").length).toBe(0);
    expect(guardViolations("Это неофициальный интерфейс.", "ru").length).toBe(0);
  });
});

describe("modules", () => {
  it("how it works: 8–10 chapters with facts and figures; moments point at chapters", () => {
    expect(C.chapters.length).toBeGreaterThanOrEqual(8);
    expect(C.chapters.length).toBeLessThanOrEqual(10);
    const ids = new Set(C.chapters.map((c) => c.id));
    expect(ids.size).toBe(C.chapters.length);
    C.chapters.forEach((c, i) => {
      expect(c.n).toBe(i + 1);
      expect(c.body.length).toBeGreaterThanOrEqual(3);
      expect(c.fact.en.length).toBeGreaterThan(0);
      if (c.lines) expect(c.lines.to).toBeLessThanOrEqual(C.contracts[c.lines.contract].lines.length);
      for (const term of c.terms) expect(C.glossary.some((g) => g.id === term), `${c.id} → ${term}`).toBe(true);
    });
    expect(C.moments.map((m) => m.id)).toEqual(["promise", "stamp", "trust", "back", "redeem"]);
    for (const m of C.moments) expect(ids.has(m.chapter), m.chapter).toBe(true);
  });

  it("personas, spectrum", () => {
    expect(C.personas.map((p) => p.id)).toEqual(["operator", "backer", "merchant", "member", "integrator", "agent"]);
    expect(C.spectrum.tiers.map((x) => x.id)).toEqual(["pure-credit", "collateralized-credit", "backed-money"]);
  });

  it("faq: 12–16 entries including the required questions", () => {
    expect(C.faq.length).toBeGreaterThanOrEqual(12);
    expect(C.faq.length).toBeLessThanOrEqual(16);
    const ids = C.faq.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ["who-issues", "what-stands-behind", "can-i-be-cheated", "investment", "work-quality", "no-blockchain", "fee", "tracker-disappears", "tracker-censors", "lose-money", "nautilus", "launched"]) {
      expect(ids, id).toContain(id);
    }
  });

  it("glossary: 40+ unique terms with valid cross-references", () => {
    expect(C.glossary.length).toBeGreaterThanOrEqual(40);
    const ids = new Set(C.glossary.map((g) => g.id));
    expect(ids.size).toBe(C.glossary.length);
    for (const g of C.glossary) {
      expect(g.en.trim() && g.ru.trim(), g.id).toBeTruthy();
      for (const s of g.see ?? []) expect(ids.has(s), `${g.id} → ${s}`).toBe(true);
    }
  });

  it("history: 2022 → 2026-11 in date order, every event sourced, people known", () => {
    const ev = C.historyEvents;
    expect(ev[0].date.startsWith("2022")).toBe(true);
    expect(ev[ev.length - 1].date.startsWith("2026-11")).toBe(true);
    for (let i = 1; i < ev.length; i++) expect(ev[i].date >= ev[i - 1].date, `${ev[i - 1].id} → ${ev[i].id}`).toBe(true);
    const handles = new Set(C.people.map((p) => p.handle));
    for (const e of ev) {
      expect(e.sources.length + (e.chain?.length ?? 0), e.id).toBeGreaterThan(0);
      for (const c of e.chain ?? []) expect(c.id, e.id).toMatch(/^[0-9a-f]{64}$/);
      for (const p of e.people ?? []) expect(handles.has(p), `${e.id}: ${p}`).toBe(true);
    }
    expect(C.chainUrl({ kind: "tx", id: ev.find((e) => e.id === "first-redemption")!.chain![0].id })).toMatch(/^https:\/\/ergoscan\.me\/tx\/18d155ea/);
  });

  it("tracker API: 35 unique endpoints, numbered, grouped", () => {
    const eps = C.apiEndpoints;
    expect(eps.length).toBe(35);
    expect(eps.map((e) => e.n)).toEqual(Array.from({ length: 35 }, (_, i) => i + 1));
    expect(new Set(eps.map((e) => `${e.method} ${e.path}`)).size).toBe(35);
    const groups = new Set(C.apiGroups.map((g) => g.id));
    for (const e of eps) {
      expect(groups.has(e.group), e.id).toBe(true);
      expect(e.response.length, e.id).toBeGreaterThan(0);
      if (e.method === "POST") expect(e.request, e.id).toBeTruthy();
    }
    for (const g of groups) expect(eps.some((e) => e.group === g), g).toBe(true);
    expect(eps.filter((e) => e.role === "admin").map((e) => e.path)).toEqual(["/redeem/complete"]);
    expect(eps.filter((e) => e.role === "public").map((e) => e.path)).toEqual(["/"]);
  });

  it("ready-made programs: the three crates at the pinned commit, 3–5 points each, ErgoScan's tracker address", () => {
    expect(C.clientPrograms.map((c) => c.name)).toEqual(["basis-cli", "basis-ui", "basis-mcp"]);
    expect(C.clientPrograms.map((c) => c.crate)).toEqual(["crates/basis_cli", "crates/basis_app", "crates/basis_mcp"]);
    for (const c of C.clientPrograms) {
      // built like the links in sources.ts: the repo, the pinned commit, the path
      expect(c.url, c.id).toBe(`https://github.com/BetterMoneyLabs/basis-tracker/tree/${C.GIT_REF}/${c.crate}`);
      expect(c.does.length, c.id).toBeGreaterThanOrEqual(3);
      expect(c.does.length, c.id).toBeLessThanOrEqual(5);
    }
    expect(C.ERGOSCAN_TRACKER_URL).toBe("https://basis.ergoscan.me/api/tracker");
    expect(C.CLIENTS_HREF).toBe("/learn/api#clients");
    // the 150/120/100 % warnings carry the shared "wallet policy, not contract rules" line
    expect(C.clientPrograms.find((c) => c.id === "tui")?.note).toBe(C.copy.thresholdsArePolicy);
  });

  it("ready-made programs: what ErgoScan's tracker accepts and refuses, as catalogue routes", () => {
    const route = (id: string) => {
      const e = C.apiEndpoints.find((x) => x.id === id);
      expect(e, id).toBeDefined();
      return `${e!.method} ${e!.path}`;
    };
    const ids = (groups: { endpoints: string[] }[]) => groups.flatMap((g) => g.endpoints);
    expect(ids(C.clients.accepted).map(route)).toEqual([
      "GET /", "GET /tracker/state", "GET /tracker/latest-box-id", "GET /tracker/pending-tx",
      "GET /config/reserve-contract-p2s", "GET /config/reserve-token", "GET /config/reserve-collateral",
      "GET /reserves", "GET /reserves/{box_id}", "GET /reserves/issuer/{pk}",
      "GET /key-status/{pk}", "GET /notes/issuer/{issuer}/recipient/{recipient}", "POST /notes/state",
      "POST /notes",
      "POST /reserves/create",
    ]);
    expect(ids(C.clients.refused).map(route)).toEqual([
      "POST /redemption/build", "POST /redeem", "POST /redemption/prepare", "GET /tracker/proof",
      "GET /notes/issuer/{pk}", "GET /notes/recipient/{pk}",
      "GET /events",
    ]);
    // a family with no single entry: every /acceptance/* route of the catalogue
    const families = C.clients.refused.flatMap((g: { paths?: string[] }) => g.paths ?? []);
    expect(families).toEqual(["/acceptance/*"]);
    expect(C.apiEndpoints.filter((e) => e.path.startsWith("/acceptance/")).length).toBe(3);
    // nothing is both accepted and refused
    const yes = new Set(ids(C.clients.accepted));
    expect(ids(C.clients.refused).filter((x) => yes.has(x))).toEqual([]);
  });

  it("sources: first-party URLs only, every source in a group", () => {
    const grouped = new Set(C.sourceGroups.flatMap((g) => g.ids));
    for (const s of Object.values(C.sources)) {
      expect(grouped.has(s.id as never), s.id).toBe(true);
      expect(s.url, s.id).toMatch(/^https:\/\/(github\.com\/BetterMoneyLabs\/|www\.ergoforum\.org\/t\/|t\.me\/chaincashtalks)/);
    }
  });

  it("trust: open issues are dated and sourced", () => {
    for (const i of C.trust.openIssues) {
      expect(i.since, i.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(i.sources.length, i.id).toBeGreaterThan(0);
    }
    for (const id of ["proof-digest-mismatch", "review-findings", "staged-exchange", "no-decrease", "censorship"]) {
      expect(C.trust.openIssues.some((i) => i.id === id), id).toBe(true);
    }
  });
});
