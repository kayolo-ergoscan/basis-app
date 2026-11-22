# src/content — protocol content, EN and RU

Typed data modules for /learn, Home and every explanation in the app. **No React here.** Pages import from
`@/content` and render. Everything is pinned to basis-tracker commit **43e2173** (2026-11-10). Mainnet facts are
as of **h1921849** (2026-11-21). KNOWLEDGE.md wins where older notes disagree.

```ts
import { chapters, moments, faq, copy, pick, type Text } from "@/content";
<h2>{pick(chapters[0].title, lang)}</h2>
```

## 1. Rules for pages

- **`Text = { en, ru }`.** Every human string comes in both languages, and there is no fallback. Render it with `pick(text, lang)` or `text[lang]`.
- **Typography is already applied.** `t()` adds thin separators in groups ("43 200"), NBSP between a number and its unit,
  NBSP after short Russian words, «ёлочки» in RU, “curly” quotes in EN and a real "…".
  - Do not re-format these strings.
  - Do not `.toUpperCase()` RU prose (`copy.eyebrow` is already set).
  - `typo()` is idempotent if you build your own string.
- **Inline code** inside a `Text` is marked with backticks, for example: \`amount\`. Split on backticks and render the odd parts as `<code>`.
- **Mono facts** (`fact()`: chapter `fact`, `copy.facts`, moment `fact`, tier `policy`) go in the mono face. Quotes are left as typed.
- **Numbers.** Prose numbers are static text: a decimal comma in RU (0,1 ERG), mono code is unchanged.
  - Live numbers on a page go through the ui `money()` / `Num` helpers, never through content.
- **Chain links.** On-chain ids are `ChainRef {kind: "tx"|"box"|"token"|"address", id, height?, label?}`.
  - Build the link with `chainUrl(ref)` (ergoscan.me, through `@/chain/links`).
  - Show the id with `chainShort(ref)`.
- **Sources.** Modules cite `SourceId`s, so a typo is a type error.
  - `sources[id]` gives `{kind, title, url, date?, by?, note?}`.
  - `sourceGroups` gives the /learn/sources page.
  - Only first-party URLs are allowed: the BetterMoneyLabs GitHub, ergoforum and t.me/chaincashtalks.
- **Copy guard.** These words may appear only inside an explicit "this is NOT …" sentence built with `denial()`:
  - EN: trustless, guaranteed, safe, launched, official, 2 %, 7 days, bearer;
  - RU: гарантир…, безопасный, запущен, официальн…, 2 %, 7 дней, на предъявителя.

  The test checks that each such sentence carries a negation. If you need such a sentence on a page, ask the content owner
  for a `denial()` string instead of writing your own.

## 2. Modules

| File | Main exports | For |
|---|---|---|
| `copy.ts` | `copy.*` (see §3), `ruPlural` | the shell, Home, every page |
| `i18n.ts` | default bundle: `content.<key>` and `content.<key>.<sub>`, plus `content.asOfBlockTpl` | `t("content.trackerLine")` in the shell |
| `moments.ts` | `moments` (Promise · Stamp · Trust · Back · Redeem), `momentsTitle`, `momentsLede` | Home "five moments" |
| `personas.ts` | `personas` (operator, backer, merchant, member, integrator, agent), `personasTitle/Lede` | Home, /learn |
| `spectrum.ts` | `spectrum {title, lede, tiers[3], defaultPolicy, grossNote, sources}` | Home, /learn/how ch. 6 |
| `howItWorks.ts` | `chapters` (10), `howItWorksTitle/Lede` | /learn/how |
| `trust.ts` | `trust {tracker.can/cannot, issuer.can/cannot, holder, enforcement, status, reviews, openIssues, statusLabels, enforcerLabels}` | /learn/trust |
| `faq.ts` | `faq` (16), `faqTitle` | /learn/faq |
| `glossary.ts` | `glossary` (60+ terms), `glossaryGroups`, `glossaryTitle` | /learn/glossary, tooltips |
| `history.ts` | `historyEvents`, `people`, `eras`, `eventKinds`, `historyTitle/Lede/AsOf`, `peopleTitle` | /learn/history |
| `sources.ts` | `sources`, `source(id)`, `sourceGroups`, `sourcesIntro`, `SourceId` | /learn/sources, citations |
| `trackerApi.ts` | `apiEndpoints` (35), `apiGroups` (12), `trackerApi {envelope, statusCodes, roles, auth, limits, gotchas, …}` | /learn/api |
| `contracts.ts` | `contracts`, `annotations`, `reasonLines`, `CONTRACT_ONLY`, `actionLines`, `actionTabs`, `contextVars`, `contextVarOrder`, `notChecked`, `GIT_REF*` | Contract X-ray, /learn/contracts |
| `contractSource.ts` | `basisEs`, `basisTokenEs` (verbatim, 470 lines each, sha256-checked) | viz/contract |
| `reasons.ts` | `reserveCheckReasons`, `trackerReasons`, `xrayReasons`, `complianceModes`, `noteStatuses`, `censorshipModes`, `redemptionStages`, `economyReasons`, `reasonFor(code)` | every failure message |
| `links.ts` | `chainUrl(ref)`, `chainShort(ref)` | history, network |
| `types.ts` | `Text`, `t`, `fact`, `denial`, `pick`, `typo`, `NBSP`, `THIN`, `LineRange`, `LineRef`, `ChainRef`, `FigureId`, `AppRoute`, `InternalLink` | everyone |

### Shapes, in short

```ts
Chapter    { id, n, title, lede, body: Text[], fact: Text, figure: FigureId, lines?: LineRef, terms: string[], sources }
Moment     { id, n, numeral, title, text, fact, mini: FigureId, miniAlt, chapter }            // chapter = Chapter.id
Persona    { id, title, who, oneLiner, needs, gives, caveat, start: {label, to: AppRoute}, scenario: ScenarioId, sources }
SpectrumTier { id, n, title, short, explanation, policy (mono), chain, protection, risk, example }
Faq        { id, q, short, a: Text[], tags, asked?: {who, quote (verbatim EN), source}, links?: InternalLink[], sources }
Term       { id, group, en, ru, alsoEN?, alsoRU?, def: Text, code?, see?: string[] }
HistoryEvent { id, date "YYYY-MM-DD"|"YYYY-MM", precision, era, kind, title, text, milestone?, sources, chain?: ChainRef[], people? }
OpenIssue  { id, title, status, since, text, impact, items?, sources }                       // trust.openIssues
TrustItem  { id, text, detail?, by: "contract"|"tracker"|"wallet"|"social"|"nobody", lines?: LineRef[], sources }
ApiEndpoint { n, id, method, path, query?, role, group, purpose, request?, response, status?, errors?: {status, message, when?}[], gotchas?, legacy? }
Annotation { id, from, to, titleEN, titleRU, textEN, textRU, kind, section: "doc"|"code", action?, checks?, warningEN?, warningRU? }
```

- **Figures.** `figure` / `mini` are suggestions. Map the ids you have to components and render nothing for unknown ids.
  - Chapter figures: note-odometer, signature-grid, tracker-ladder, digest-pulse, reserve-registers, money-spectrum,
    contract-xray, emergency-dial, exit-timeline, clearing-loop.
  - Moment minis: note-odometer, two-stamps, digest-pulse, reserve-coin, tear-off.
- **API examples are code.** `request` and `response` are plain strings, the same in both languages, and illustrative: hex is
  shortened with "…" and amounts are raw units. Show the `trackerApi.illustrative` line above them.
  - `errors[].message` holds exact server text.

## 3. Shared copy (`copy.*`)

| Group | Keys |
|---|---|
| Status | `mainnetHonest`, `currentContractsEmpty`, `testUse`, `legacyBadge`, `topUpClosed` |
| Brand | `independence`, `independenceLong`, `brandTag` ("unofficial · ErgoScan"), `brandFull`, `eyebrow`, `heroHeadline {line1, line2}`, `noEndorsement` |
| Tracker | `trackerLine` (Cannot steal · Can censor), `trackerLineLong` |
| Fees | `fee` (Protocol fee: none (basis.es) · Miner fee 0.001 ERG), `feeProtocol`, `feeMiner`, `feeOffchain`, `feeDenial` |
| Mainnet footnote | `mainnetFootnoteStatic`, `mainnetFootnote({boxes, erg, height?})` (RU plural inside), `asOfBlock(h)` |
| Sandbox | `sandbox`, `sandboxLabel`, `sandboxNothingReal`, `sandboxKey`, `realCrypto` |
| Rules | `emergencyRule`, `emergencyIsAvailability`, `refundRule`, `refundCreditors`, `topUpRule`, `topUpRuleToken`, `boundForever`, `thresholdsArePolicy`, `coverageAdvisory`, `noteIsPromise`, `noteNotBearer`, `matchNotSolvency`, `totalsOnlyGrow`, `directionHint`, `consentToDebt`, `nautilusCannotSign` |
| Mono | `facts {emergency, refund, topUp, message, signature, fee, minerFee}` |

Use these instead of rewording them, so the site says each of these things one way only.

## 4. Contract X-ray data

- **Line numbers.** `contracts.basis.lines` and `contracts.token.lines` hold the verbatim sources. Line numbers are 1-based and match GitHub at 43e2173.
- **`annotations[id]`.** Sorted and non-overlapping, they cover every non-comment code line. `section: "doc"` blocks explain the
  header comment.
  - A `warning*` field marks a stale comment in the source. Show it as a note, not as an error.
- **`reasonLines[check]`.** `{basis: LineRange[], token: LineRange[]}` for every engine `ReserveCheckId`.
  - `LineRange.action` tells which branch a range belongs to when a check appears in several.
  - `CONTRACT_ONLY` lists checks that exist in one contract only.
- **`actionLines[id][key]`.** Line sets for `"prelude" | 0 | 1 | 2 | 3`.
- **`contextVarOrder`.** Gives the Scala extension key order (first redemption `0,5,1,6,2,3,8,4`, later `0,5,1,6,2,7,3,8,4`).
- **`trackerReasons[code].mirrors`.** Names the contract check behind a tracker rule, so a page can show the server message
  and the contract line together.

## 5. Russian terminology (use these everywhere)

| EN | RU |
|---|---|
| note / IOU | расписка (also «долговая расписка», IOU) |
| issuer / receiver / holder | эмитент / получатель / держатель |
| redeem / redemption | погасить / погашение |
| emergency redemption | аварийное погашение |
| refund (owner exit) | возврат резерва |
| top up | пополнение, пополнить |
| tracker / tracker box | трекер / бокс трекера |
| reserve / collateral | резерв / обеспечение |
| coverage | покрытие |
| acceptance policy | политика приёма |
| credit line / limit | кредитная линия / кредитный лимит |
| cumulative total | накопленный итог |
| outstanding | непогашенный остаток |
| debt key | ключ долга |
| digest / commitment | дайджест / фиксация |
| local · pending · confirmed | локально · ожидает · подтверждено |
| self-note | расписка самому себе |
| denomination | валюта расписки |
| clearing / netting / set-off | клиринг / взаимозачёт / зачёт |
| novation | новация (перевод долга) |
| FIFO | очередь по старшинству (FIFO) |
| context variable / data input | контекстная переменная / data-вход |
| Schnorr signature / challenge / nonce | подпись Шнорра / вызов / нонс |
| box / miner fee | бокс / комиссия майнера |
| security review | ревью безопасности (never «аудит» for the reviews) |
| sandbox / play money | песочница / игровые деньги |

The RU headline is «Платите словом. Погашайте на Ergo.»

## 6. Tests

`scripts/check.sh test src/content` runs `content.test.ts`. It checks:

- **Contracts.** Each contract's sha256 at the pinned ref. Every annotation range lies inside its source, and annotations are sorted, do not overlap and are bilingual. Every meaningful code line is covered.
- **Engine codes.** Every `ReserveCheckId`, `TrackerErrorCode` and `XrayCheckId` (parsed from the engine source with `?raw`) has reasons and contract lines.
- **Strings.** Every EN and RU string (more than 1 200 of them) is non-empty. RU typography: no straight quotes, no " - ", no "...", NBSP after numbers.
- **Copy guard.** As described in §1.
- **Counts and links.** 8–10 chapters, 6 personas, 12–16 FAQ entries including the required ones, 40+ glossary terms, a history from 2022 to
  2026-11 in date order, 35 unique endpoints, and only first-party source URLs.

## 7. Known gaps

- No page renders this content yet. /learn and Home own the layout.
- History dates are UTC days. Two ChainCash-era events have month precision.
- `trackerApi` examples are illustrative. A few response shapes for the legacy routes are abbreviated with `"…": "…"`.
- The mainnet numbers in `copy.mainnetFootnoteStatic` and the FAQ are as of h1921849. Live pages should use
  `copy.mainnetFootnote({...})` with numbers from the chain module.
