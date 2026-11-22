// Copy and mapping completeness: every engine check and refusal code renders in EN and RU, every event type has a
// line, the viz and /lab/viz bundles are complete in RU with the same placeholders and none of the forbidden words,
// and rendered components never show a raw key.
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { setLang } from "@/app/lang";
import { loadErgoAvlBackend } from "@/protocol/avl-wasm";
import type { EconomyEvent } from "@/protocol";
import { buildShowcase, namer, type Showcase } from "@/features/vizlab/demo";
import vizlabI18n from "@/features/vizlab/i18n";
import { ALL_CHECK_IDS } from "../contract/lines";
import { maybe, reasonTitle, vizKeys } from "../core/lang";
import { describeLine, EVENT_TYPES } from "../feed/describe";
import { ContractXray } from "../contract/ContractXray";
import { SignatureXray } from "../signature/SignatureXray";
import { SelfTest } from "../signature/SelfTest";
import { SignLab } from "../signature/SignLab";
import { TxLens, synthCreateTx } from "../tx/TxLens";
import { AvlProofViewer } from "../avl/AvlProofViewer";
import { AvlTreeView } from "../avl/AvlTreeView";
import { EventFeed } from "../feed/EventFeed";
import { StatusLadder } from "../clocks/StatusLadder";
import { ExitClocks } from "../clocks/ExitClocks";
import { DebtKeyTool } from "../tools/DebtKeyTool";
import { MessageBuilder } from "../tools/MessageBuilder";
import { NoteVerifyTool } from "../tools/NoteVerifyTool";
import { TemplateHashTool } from "../tools/TemplateHashTool";
import { ERG_UNIT } from "../core/format";

import economySrc from "@/protocol/economy.ts?raw";
import trackerSrc from "@/protocol/tracker.ts?raw";
import policySrc from "@/protocol/policy.ts?raw";
import clearingSrc from "@/protocol/clearing.ts?raw";
import reserveSrc from "@/protocol/reserve.ts?raw";
import eventsSrc from "@/protocol/events.ts?raw";

const SOURCES: Record<string, string> = { "economy.ts": economySrc, "tracker.ts": trackerSrc, "policy.ts": policySrc, "clearing.ts": clearingSrc, "reserve.ts": reserveSrc, "events.ts": eventsSrc };
const src = (f: string) => SOURCES[f];

/** Every refusal code the engine can emit: `code: "…"` literals, codes passed to refusal helpers, TrackerErrorCode. */
function engineCodes(): string[] {
  const out = new Set<string>();
  for (const f of ["economy.ts", "tracker.ts", "policy.ts", "clearing.ts", "reserve.ts"]) {
    const s = src(f);
    for (const m of s.matchAll(/code: "([a-z0-9_-]+)"/g)) out.add(m[1]);
    // every quoted kebab/snake word among the first three arguments of a refusal helper (messages have spaces)
    for (const m of s.matchAll(/(?:refuse|reject|fail|deny|rejected)[A-Za-z]*\(([^()]*)/g))
      for (const a of m[1].split(",").slice(0, 3)) {
        const lit = /^\s*"([a-z0-9_-]+)"\s*$/.exec(a);
        if (lit) out.add(lit[1]);
      }
  }
  const t = src("tracker.ts");
  const u = t.slice(t.indexOf("export type TrackerErrorCode"), t.indexOf(";", t.indexOf("export type TrackerErrorCode")));
  for (const m of u.matchAll(/"([a-z0-9_-]+)"/g)) out.add(m[1]);
  // who refused (a stage or an actor), not why
  for (const by of ["wallet", "tracker", "issuer", "receiver", "credit-line"]) out.delete(by);
  return [...out].sort();
}

let show: Showcase;
beforeAll(async () => {
  show = buildShowcase(await loadErgoAvlBackend());
});
afterAll(() => setLang("en"));

describe("mapping completeness", () => {
  test("every contract check has a title and a why, EN and RU", () => {
    for (const lang of ["en", "ru"] as const)
      for (const id of ALL_CHECK_IDS) {
        expect(maybe(lang, `viz.check.${id}`), `${lang} ${id}`).toBeTruthy();
        expect(maybe(lang, `viz.check.${id}.why`), `${lang} ${id}.why`).toBeTruthy();
      }
  });
  test("every engine refusal code renders in words, EN and RU", () => {
    const codes = engineCodes();
    expect(codes.length).toBeGreaterThan(20);
    for (const lang of ["en", "ru"] as const) for (const c of codes) expect(reasonTitle(lang, c), `${lang}: ${c}`).not.toBe(c);
  });
  test("every event type is known to the feed, and the union in events.ts has no type the feed misses", () => {
    const s = src("events.ts");
    const types = new Set([...s.matchAll(/type: "([a-z.]+)"/g)].map((m) => m[1]));
    for (const t of types) expect(EVENT_TYPES, t).toContain(t);
  });
  test("every event of the showcase has a line in EN and RU without raw keys", () => {
    for (const lang of ["en", "ru"] as const) {
      const ctx = { lang, nameOf: namer(show.eco), unitOf: () => ERG_UNIT };
      for (const e of show.events) {
        const line = describeLine(e as EconomyEvent, ctx);
        expect(line.text, e.type).not.toMatch(/viz\.|\{[a-z]+\}/);
      }
    }
  });
});

describe("copy rules", () => {
  const FORBIDDEN_EN = /\b(trustless|guaranteed?|safe|unstoppable|live on mainnet|launched|official|yield|apy|bearer)\b|\b2\s*[ ⁠  ]*%|\b7 days\b/i;
  const FORBIDDEN_RU = /гарантир|безопасн|запущен|официальн|на предъявителя|7 дней|\b2\s*[ ⁠  ]*%/i;
  const bundles: Array<[string, { en: Record<string, string>; ru: Partial<Record<string, string>> }]> = [
    ["viz", vizKeys()],
    ["vizlab", vizlabI18n],
  ];
  const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
  test.each(bundles)("%s: RU has every key, with the same placeholders", (_n, b) => {
    for (const [k, v] of Object.entries(b.en)) {
      const ru = b.ru[k];
      expect(ru, `missing RU ${k}`).toBeTruthy();
      expect(vars(ru!), k).toBe(vars(v));
    }
  });
  test.each(bundles)("%s: none of the forbidden words", (_n, b) => {
    for (const [k, v] of Object.entries(b.en)) expect(v, k).not.toMatch(FORBIDDEN_EN);
    for (const [k, v] of Object.entries(b.ru)) expect(v ?? "", k).not.toMatch(FORBIDDEN_RU);
  });
  test("no protocol fee is ever claimed; the miner fee is 0.001 ERG", () => {
    const all = Object.values(vizKeys().en).join("\n");
    expect(all).not.toMatch(/protocol fee of|redemption fee of/i);
    expect(all).toMatch(/0\.001 ?ERG|0\.001 ERG/);
  });
});

describe("components render without raw keys (EN and RU)", () => {
  const html = () => {
    const s = show;
    const nameOf = namer(s.eco);
    return [
      renderToStaticMarkup(<ContractXray evaluation={s.cheat} />),
      renderToStaticMarkup(<ContractXray evaluation={s.honest} mode="full" />),
      renderToStaticMarkup(<ContractXray evaluation={s.topUp} />),
      renderToStaticMarkup(<ContractXray />),
      renderToStaticMarkup(<ContractXray contract="basis-token" action={0} mode="full" />),
      renderToStaticMarkup(<SignatureXray xray={s.eco.xray(s.record)} face="machine" />),
      renderToStaticMarkup(<SignLab />),
      renderToStaticMarkup(<SelfTest initialOpen="TV003" />),
      renderToStaticMarkup(<TxLens tx={s.honest.tx!} evaluation={s.honest.eval} event={s.honest.event} nameOf={nameOf} />),
      renderToStaticMarkup(<TxLens tx={s.cheat.tx!} evaluation={s.cheat.eval} nameOf={nameOf} face="machine" />),
      renderToStaticMarkup(<TxLens tx={synthCreateTx(s.eco.r("alice-res"))} synthesized nameOf={nameOf} />),
      renderToStaticMarkup(<TxLens tx={s.clearing!.tx!} nameOf={nameOf} />),
      renderToStaticMarkup(<AvlProofViewer digest={s.proof!.digest} proof={s.proof!.proof} lookupKey={s.proof!.key} backend={s.backend} valueKind="tracker" face="machine" />),
      renderToStaticMarkup(<AvlTreeView map={s.eco.t("t1").map} valueKind="tracker" committed />),
      renderToStaticMarkup(<AvlTreeView map={s.eco.r("alice-res").tree} valueKind="reserve" />),
      renderToStaticMarkup(<EventFeed events={s.events} nameOf={nameOf} follow={false} />),
      renderToStaticMarkup(<StatusLadder {...s.ladder.local} />),
      renderToStaticMarkup(<StatusLadder {...s.ladder.confirmed} />),
      renderToStaticMarkup(<ExitClocks height={5000} boxCreationHeight={1000} r7={4000} />),
      renderToStaticMarkup(<ExitClocks height={50000} boxCreationHeight={1000} r7={null} />),
      renderToStaticMarkup(<DebtKeyTool />),
      renderToStaticMarkup(<MessageBuilder />),
      renderToStaticMarkup(<NoteVerifyTool />),
      renderToStaticMarkup(<TemplateHashTool />),
    ].join("\n");
  };
  test.each(["en", "ru"] as const)("%s", (lang) => {
    setLang(lang);
    const out = html();
    const raw = out.match(/\bviz\.[a-z][\w.-]*/g) ?? [];
    expect(raw).toEqual([]);
    expect(out).not.toMatch(/\{[a-z]+\}/);
    if (lang === "ru") expect(out).toMatch(/[а-я]/);
  });
});
