# Basis UI kit

Everything a feature needs to draw Basis in its Lamplight look: a small town at night, where light carries meaning.
Import components and helpers from `@/ui`, and app services from `@/app`.
Every component appears live, in its real states, at **`/kit`**. Open it next to this file.

```tsx
import { Page, PageHead, Section, Card, Key, Num, Note, toast } from "@/ui";
import { useT, rich, useHeight, pulse, usePulse, useTheme } from "@/app";
```

**Contents:**
1. [Rules first](#1-rules-first)
2. [Adding a feature](#2-adding-a-feature)
3. [Tokens, themes and lights](#3-tokens-themes-and-lights)
4. [Type and utility classes](#4-type-and-utility-classes)
5. [Layout primitives](#5-layout-primitives-visual-5)
6. [Numbers and money](#6-numbers-and-money)
7. [i18n](#7-i18n)
8. [Theme, motion and viewer settings](#8-theme-motion-and-viewer-settings)
9. [The pulse](#9-the-pulse)
10. [Chain height, commands and shortcuts](#10-chain-height-commands-and-shortcuts)
11. [Components](#11-components)
12. [Hooks and engine helpers](#12-hooks-and-engine-helpers)
13. [Accessibility](#13-accessibility-visual-15)
14. [Do and don't](#14-do-and-dont-visual-16)

---

## 1. Rules first

- **Tokens only.** Write no hex colours in features. Use `var(--ink)`, `var(--metal)` and the rest (§3). The seal and note engines own their inks.
- **Ink, paper and three lights, one job each:**
  - ink — words and numbers;
  - paper — notes and seals (lit paper in both themes: the things you hold);
  - unlit (hatch, outline) — on trust;
  - gold light (`--metal*`) — ERG or tokens locked or moving on Ergo;
  - moonlight (`--holo`, `--moon*`) — proven in the latest digest.

  Window light (`--lamp`, warm white) is the town and you: the mark, your house, steps done, the primary key. It never
  means money. Nothing else may borrow the three lights; gold stays a yellow gold, never orange.
- **Signals:**
  - `--up` (verdigris) is for amounts in your favour.
  - `--alarm` is only for "something is wrong".
  - "You owe" is ink with a minus sign, never red.
- **Numbers** go through `money()` or `<Num>`, never `toFixed` or `toLocaleString`. See §6.
- **Every string** comes from an i18n key, in both EN and RU. See §7.
- **One commitment means one pulse.** Never fire `pulse.commit` on a timer. See §9.
- **At most one gold (`metal`) key** (the action that moves money) and one alarm toast per view. The primary key is window light, not gold.

## 2. Adding a feature

A feature is a folder `src/features/<id>/` holding three files. The shell discovers them with `import.meta.glob`, so there is no shared registry to edit.

```tsx
// src/features/wallet/route.tsx
import type { FeatureRoute } from "@/app/types";
const route: FeatureRoute = {
  id: "wallet",
  path: "/wallet/*",                       // "/*" when the feature has sub-routes; home is "/"
  load: () => import("./Page"),            // lazy: its own chunk, shown inside <Suspense> with the window loader
  nav: { order: 2, labelKey: "nav.wallet" }, // 0 Story · 1 Play · 2 Wallet · 3 Network · 4 Tracker · 5 Learn; null = not in the nav
  titleKey: "wallet.title",                // document.title = t(titleKey) + " · Basis"
  commands: [{ id: "wallet.open", labelKey: "wallet.cmd.open", to: "/wallet", keywords: "notes balance" }],
};
export default route;
```

```tsx
// src/features/wallet/Page.tsx
import { Page, PageHead } from "@/ui";
import { useT } from "@/app";
export default function WalletPage() {
  const t = useT();
  return <Page><PageHead eyebrow={t("wallet.eyebrow")} title={t("wallet.title")} lede={t("wallet.lede")} /></Page>;
}
```

```ts
// src/features/wallet/i18n.ts — every key starts with the feature id
import type { I18nBundle } from "@/app/types";
export default {
  en: { "wallet.title": "Wallet", "wallet.eyebrow": "Your notes", "wallet.lede": "…" },
  ru: { "wallet.title": "Кошелёк", "wallet.eyebrow": "Ваши расписки", "wallet.lede": "…" },
} satisfies I18nBundle;
```

**Create `Page.tsx` before `route.tsx`.** The route glob is eager, so in dev a `route.tsx` that imports a missing `./Page` breaks the whole app (a 500 on every page) until the file exists.

The shell gives every route:
- an error boundary that resets on navigation;
- `<Suspense>` with `<PageLoading>`;
- the title;
- scroll restoration (top on push; the saved position on back and forward; `#hash` wins);
- a 240 ms fade with an 8 px rise.

Sub-routes inside a feature use relative `<Routes>`.

## 3. Tokens, themes and lights

`src/ui/tokens.css` holds every value. Contrast was checked on 25 Nov 2026: every text token passes 4.5 : 1 on every
surface in both themes. `--ink-4`, `--metal`, `--moon` and `--lamp` are fills and rules, never body text: words use
`--metal-ink` and `--moon-ink`.

**Themes:**
- **Night** is `:root` / `.theme-dark`: an indigo night sky, panes lit from inside.
- **Day** (the light theme; its stored name stays `cotton`) is `:root[data-theme="light"]` / `.theme-light`: the same town
  by daylight, tuned on its own (navy ink, white panes, deeper gold and moon for words), not an inversion of Night.

The scope classes change tokens only. Add `background: var(--bg)` when a scoped block needs its own page colour.

| Group | Tokens |
|---|---|
| Surfaces | `--bg` `--bg-2` `--surface` (panes) `--surface-2` (selected, hover, card top) `--well` (inputs, segments) `--pane-hi` (a pane's top highlight) `--sky` (the page background) |
| Rules | `--rule` (1 px dividers) `--rule-2` (stronger: tag outlines, selected segments) |
| Ink | `--ink` `--ink-2` (body) `--ink-3` (labels, ≥ 4.5 : 1) `--ink-4` (decoration only) |
| Paper (notes, seals) | `--paper` `--paper-hi` `--paper-ink` `--paper-ink-2` `--paper-rule` |
| Gold light | `--metal` `--metal-hi` `--metal-lo` `--metal-ink` (text) `--metal-wash` `--foil-metal` (gradient) `--foil-text` `--glow-metal` `--on-metal` |
| Moonlight | `--holo` (gradient, proof only) `--holo-stale` (digest old) `--moon` `--moon-ink` (text) `--moon-wash` `--glow-moon` |
| Window light | `--lamp` `--glow-lamp` (the mark, your house, the loader, the town's windows) |
| Signals | `--up` `--up-wash` · `--alarm` `--alarm-fill` `--on-alarm` `--alarm-wash` |
| Keys | `--key-bg/fg/skirt/hi` `--glow-key` (primary: window light) · `--key2-*` (default: a pane) |
| Town | `--town-wall` `--town-wall-2` `--town-roof` `--town-win` `--town-street` `--town-star` |
| Depth | `--shade` (an rgb triple: `rgba(var(--shade), .5)`) `--shadow-a` `--hatch` `--field-rgb` `--field-a` |
| Type | `--f-display` (Unbounded) `--f-ui` (Geist) `--f-mono` (Geist Mono) |
| Space | `--s1`…`--s12` = 4 8 12 16 20 24 32 40 48 64 96 128 |
| Radius | `--r-paper` 16 · `--r-note` 12 · `--r-key` 12 · `--r-sheet` 24 · `--r-pill` 999 · `--r-win` 4 (lamps are small windows) |
| Motion | `--t-press` 90 · `--t-fast` 160 · `--t-base` 240 · `--t-slow` 420 · `--t-roll` 900 · `--t-pulse` 1400 ms; `--ease-out` `--ease-io` `--ease-press` |
| Frame | `--container` 1520 px · `--gutter` clamp(16px, 3.4vw, 64px) |

Unlit (on trust) is the `.hatch` class or the `--hatch` background. Gold (backed on Ergo) is `.foil`.

**Fonts** are self-hosted woff2 under `src/ui/fonts/` (Unbounded, a Latin and a Cyrillic subset of the variable font,
weights 400–800) and from `@fontsource-variable` (Geist, Geist Mono). All three are under the SIL Open Font License 1.1;
the licence texts are in `public/licenses/` and next to the font files.

## 4. Type and utility classes

**Type:**

| Class | Use |
|---|---|
| `.t-hero` | Display (Unbounded 700), 40–76 px. The `<em>` second beat is quieter ink (`--ink-2`); a page may light it gold only when it names value on Ergo. Once per page. |
| `.t-h1` `.t-h2` | Section and page titles (Unbounded 650 / 600). The `<em>` second beat is quieter ink, never italic. |
| `.t-h3` / `.t-title` `.t-h4` | Card titles (Geist 600). |
| `.t-lede` | Intro paragraph (`--ink-2`). |
| `.t-body` `.t-small` | Body and small text. |
| `.t-money` | Display money (Unbounded 650, tabular, ≥ 24 px). Gold (`--metal-ink`) only when it is on Ergo. |
| `.t-measure-l` `.t-measure` `.t-measure-s` | Geist tabular measures; `.unit` for the unit after them. |
| `.label` | Geist 600 11.5 px caps label (`--ink-3`); a `<b>` inside is ink. |
| `.eyebrow` | The label row above a title. |
| `.prose` / `.textlink` / `.reading` | Long text, underlined links, and a 720 px measure. |

**Utilities:**
- `.num` gives tabular lining figures.
- `.mono`, `.serif` (the display face; the name is kept for old call sites), `.hex` (mono, breaks anywhere), `.nowrap`.
- Colours: `.dim` (ink-3), `.ink`, `.ink-2`, `.up`, `.alarm-t`, `.metal-t`.
- `.sr-only` / `.sr` hide text visually but keep it for screen readers.

**Component classes that features may reuse:**
- Cards: `.card` with `.card-h`, `.card-b` and `.card-f` (or use `<Card>`).
- Hardware: `.key`, `.pill`, `.chip`, `.seg`, `.tag`.
- Tables: `.tbl` (with `.tbl-wrap`).
- Ledgers: `.ledger`; lights: `.hatch` (unlit), `.foil` (gold).

Never restyle them per feature. If one is missing a variant, ask the ui-shell owner.

## 5. Layout primitives (VISUAL §5)

| Component | Props | Notes |
|---|---|---|
| `Page` | `wide? className? style?` | The container plus page padding. Every feature page starts with it. |
| `PageHead` | `eyebrow? title lede? actions? as?` | 7/5 columns, title and lede aligned to the end; `as` is h1 by default. |
| `Section` | `id? no? title? lede? aside? rule? className?` | A `section.sec` with the numbered head ("03 · Note") and a top rule. |
| `SectionHead` | `no? title? lede? aside?` | The head alone. |
| `Grid` | `cols? (2 · 3 · 4 · 12) gap?` | A 24 px gap. 4 columns fold to 2 at ≤ 1280. Every grid is one column at ≤ 1000. |
| `Col` | `span? spanL?` | Inside `Grid cols={12}`. `spanL` applies at ≤ 1280. |
| `Card` | `title? aside? footer? flush? as? id?` | E1: flat surface, a 1 px rule, no shadow. A string `title` becomes the mono caps head. |
| `Stack` · `Cluster` · `Spread` | `gap?` | Column · wrapping row · space-between row. |

```tsx
<Page>
  <PageHead eyebrow={t("x.eyebrow")} title={rich(t("x.title"))} lede={t("x.lede")} actions={<Key variant="primary" icon="pay">{t("x.pay")}</Key>} />
  <Grid><Col span={7} spanL={12}><Card title={t("x.notes")}>…</Card></Col><Col span={5} spanL={12}>…</Col></Grid>
  <Section id="history" no="02 · History" title={rich(t("x.h2"))} lede={t("x.h2.lede")}>…</Section>
</Page>
```

**Breakpoints:**
- ≤ 1280: the nav links fold into ⌘K and the menu.
- ≤ 1000: one column.
- ≤ 640: phone. Gutter 16, nav 56, the tab bar is shown, tables with `stack` become rows, and the graph scrolls inside its card (min width 860).

**Phone layout:**
- The shell pads the bottom for the tab bar. Do not add your own.
- No horizontal page scroll at 390 px. Long hex goes in `.hex` or `<Hex>`, and wide things go in an `overflow-x: auto` box.
- **Elevation:** at most two levels per view, not counting keys. E0 is sections, E1 cards, E3 notes, E4 overlays.

## 6. Numbers and money

All formatting is locale-independent: EN and RU use the same separators.

| Helper | Result |
|---|---|
| `money(1240)` | `1 240.00`: thousands are U+2009 + U+2060, the minus is U+2212 |
| `money(0.0004, 4)` | `0.0004` |
| `int(1921400)` | `1 921 400` |
| `units(1240_000_000_000n, 9)` / `erg(nano)` | `1 240.00` (exact bigint, rounds half up) |
| `signed(n, dp, "favour" \| "owe" \| "auto" \| "none")` | `+1 240.00` only in your favour; `−320.00` when you owe |
| `pct(132)` / `ratioPct(1.32)` | `132 %` |
| `withUnit("500.00", "ERG")` | `500.00 ERG` (U+00A0 before the unit) |
| `blk(2160)` · `humanTime(2160, lang)` · `blocksAndTime(2160, lang)` | `2 160 blk` · `≈ 3 d` · both. 1 block ≈ 2 min. |
| `short(hex, 4, 4)` · `groupHex(hex)` | `9f3c…c7e1` · grouped digest |
| `parseMoney("1 240,5")` | `1240.5` (accepts spaces and a comma), or `null` |
| constants | `THIN`, `NBSP`, `MINUS`, `ELLIPSIS`, `MIN_PER_BLOCK` |

```tsx
<Num value={1240} sign="favour" unit="ERG" tone="up" />            // +1 240.00 ERG in verdigris
<Num value={-320} unit="ERG" />                                    // −320.00 ERG in ink (owing is not an alarm)
<Num value={3_400_000_000_000n} decimals={9} unit="ERG" tone="metal" />
```

- `<Num>` and `<Odometer>` respect the privacy setting (`•••`). Pass `reveal` only on machine faces.
- Inside i18n strings, pass formatted values as variables: `t("x.left", { v: money(left) })`. Never type separators by hand.
- **Fees:** the protocol fee is none (basis.es). The miner fee is 0.001 ERG.
- **Wallet policy:** 150 / 120 / 100 % is wallet policy, not a contract rule. Say so wherever it is shown.

## 7. i18n

- Every folder with strings has an `i18n.ts`: `default { en, ru } satisfies I18nBundle`. The shell merges every `/src/**/i18n.ts`.
- **Keys** start with their owner: `nav.` / `app.` / `ui.` (the shell and kit), `<featureId>.`, `content.`.
- A missing RU key falls back to EN.
- **The first language** comes from `localStorage["basis.lang"]`, else `navigator.language` (`ru*` → RU), else EN.

```tsx
const t = useT();                       // re-renders on language change; t.lang is "en" | "ru"
t("wallet.left", { v: money(760) })     // {var} substitution
t.p("wallet.notes", 5)                  // plural: wallet.notes_one / _few / _many / _other (Intl.PluralRules); adds {n}
t.p("wallet.notes", n, { n: int(n) })   // format the number yourself when it can reach 1 000
rich(t("home.h1"))                      // **bold**, *em* (the quieter second beat), `mono`, {var} with React nodes
<T k="home.lede" vars={{ total: <Num value={1240} /> }} />
translate("x.y") / translatePlural(...) // outside React (toasts fired from stores); getLang() / setLang("ru")
const { lang, setLang, toggle } = useLang();
```

- RU plural keys need `_one`, `_few`, `_many` and `_other`. EN needs `_one` and `_other`.
- **Big string tables:** every `i18n.ts` is eager and ships in the main chunk on every page. When a feature has hundreds of keys that only its lazy page needs, split them:
  - keep the nav, title and command keys in `i18n.ts`;
  - put the rest in `strings.ts`, with the same `{ en, ru }` shape;
  - call `addI18n(strings)` at the top level of the lazy page module.

  `/kit` does this (`features/kit/strings.ts`).
- Copy follows VISUAL §14: calm sentences, no exclamation marks, two names on every note, and "raise your note", not "send".

## 8. Theme, motion and viewer settings

**Theme:**
- `useTheme()` returns `{ theme: "night" | "cotton", setTheme, toggle }` ("cotton" is the stored name of Day); `getTheme()` and `toggleTheme()` work outside React.
- It is stored in `localStorage["basis.theme"]`.
- **The first visit** follows `prefers-color-scheme`, else Night.
- `public/boot.js` applies the theme before paint (`<html data-theme="dark|light">`), which avoids a flash.
- `?theme=cotton` forces Day.

**Motion and settings:**
- `useUiSettings()` / `setUiSettings(patch)` are stored in `localStorage["basis.ui"]` and hold four settings:
  - `motion`: `"system" | "reduce"`. Reduce adds `:root.rm`.
  - `confirmPress`: every hold-to-act becomes "press, then press again to confirm".
  - `privacy`: amounts show as `•••`.
  - `sounds`: reserved; off.
- `useReducedMotion()` / `prefersReducedMotion()` are true for the OS setting, the in-app switch, or `?still`.
- `?still` (`:root.still`) freezes every animation, for screenshots.
- **Rule:** any JS-driven motion (odometer, parallax) must check `prefersReducedMotion()`. CSS transitions and the town's keyframes already collapse to 1 ms or stand still.

## 9. The pulse

The pulse is the one event in the product: a tracker commitment. Sources:
- the sandbox world, when its tracker commits;
- mainnet polling, when a new digest appears.

**One commitment = one pulse,** everywhere at once. The note's foil strip flashes, the nav chip, the mark's window and the town's clock tower catch moonlight, the live tape moves, and one proof toast appears.

```ts
import { pulse, usePulse } from "@/app";
pulse.commit({ source: "sandbox", trackerId: "t1", digest, height, noteKeys: [hex(noteKey)] }); // only from a real commitment
usePulse((p) => refresh(p.height), (p) => p.trackerId === myTracker);                    // subscribe in React
pulse.last();                                                                             // the latest one, or null
```

- `<Note state="committed" noteKey=… trackerId=…>` flashes by itself when `noteKeys` includes its key or the tracker matches.
- For your own elements, use `usePulseClass(ref, filter)`, which adds `.pulse-on` for 1400 ms, or `flash(el)`.
- **Never fire a pulse from a timer in production.** A demo or replay must be labelled SANDBOX. The /kit "Fire a commitment" key is the pattern: `features/kit/pulse.ts`.

## 10. Chain height, commands and shortcuts

```ts
const { height, lastBlockId, updatedAt, error } = useHeight(); // GET /v1/info every 30 s, paused while the tab is hidden; height is null until the first answer
```

**Chain data** only comes through `/v1/...` (the Vite proxy to the tracker API). Never call the node.

**Commands (⌘K):**
- Route-level commands come from `route.commands` (i18n label keys).
- Dynamic commands come from `useCommands([{ id, label, sub?, keywords?, group?, icon?, to? | run?, kbd? }], deps)` while mounted. Their labels must already be translated.
- `openCommandBar(query?)` and `openHelp()` open the palette and the help sheet.
- Pasting a 64-hex id offers `/network/tx/<id>` and `/network/reserve/<id>`.

**Shortcuts:**
- `⌘K` / `Ctrl K` opens the palette and `?` opens help.
- `P` Play, `W` Wallet, `N` Network, `L` Learn.
- `T` switches the theme and `M` flips the face (Story ↔ Machine); `Esc` closes.
- They are ignored while typing or when an overlay is open. Use `isTyping(e)` in your own handlers.

## 11. Components

Props marked `?` are optional; defaults are in brackets. Every specimen lives at `/kit`, and the section anchors are listed in each heading.

### Basics (`/kit#keys`, `#tokens`)

| Component | Props |
|---|---|
| `Icon` | `name` (see `ICON_NAMES`), `size? [18]`, `title?` (decorative without it) |
| `Lamp` | `state? "signed" \| "tracked" \| "committed" \| "stale" \| "live" \| "alarm" \| "off"`, `size?`, `label?` (shape first: ○ ◐ ●, drawn as a small window; committed is lit with moonlight) |
| `Tag` | `tone? "plain" \| "ok" \| "watch" \| "warn" \| "under" \| "metal" \| "up" \| "agent"`, `glyph?`, `title?` |
| `CoverageTag` | `pct`, `long?`, `small?`. Bands: `coverageBand(pct)` → fine ≥ 150 · watch ≥ 120 · warn ≥ 100 · under. The tag names the reserve in words (`ui.cov.tag.*`: "Reserve fine"); the bare band words (`ui.cov.*`) are for the scale under a coverage bar |
| `FlowTrail` | `steps: string[]`, `at`, `label`: the steps of one action (who / fill in → check and sign → done), the current one `aria-current="step"`. Put it under the flow's title |
| `AgentTag` | `small?` (the dashed "AI" tag) |
| `Chip` | `lamp?`, `label?`, `value?`, `href? \| onClick?`, `title?`, `chipRef?` |
| `Seg` | `options [{value,label,title?}]`, `value`, `onChange`, `ariaLabel`, `mono?` |
| `Tabs` | `tabs [{id,label,count?,disabled?}]`, `value`, `onChange`, `mono?`, `block?`, `ariaLabel?`, `idBase?` (arrow keys, roving tabindex) |
| `Switch` | `checked`, `onChange`, `label?`, `help?`, `disabled?`, `ariaLabel?` |
| `Callout` | `tone? "info" \| "policy" \| "sandbox" \| "metal" \| "proof" \| "alarm" \| "calm"`, `title?`, `icon? \| false` |
| `Num` | `value (number \| bigint)`, `decimals?`, `dp? [2]`, `sign? "auto" \| "favour" \| "owe" \| "none"`, `unit?`, `tone? "up" \| "alarm" \| "metal" \| "dim"`, `reveal?` |
| `Hex` | `value`, `head? [4]`, `tail? [4]`, `grouped?`, `copy?` |
| `CopyButton` · `Kbd` · `Digest` | `value, label?, small?` · children · `value, label?, head? [16], tail? [10]` |
| `Honest` | `tracker?`. "Cannot steal · Can censor": put it next to every tracker. |
| `Checks` | `stage 0–3` (nothing · signed · witnessed · on Ergo), `issuer?`, `tracker?`, `block?` |
| `TrackerTile` | `id? ["T-01"]`, `stale?`, `size? "sm" \| "md" \| "lg"` (the holo tracker mark) |

```tsx
<Cluster><Chip lamp="live" label="Ergo" value={int(height)} /><CoverageTag pct={132} long /><Tag tone="agent">AI</Tag></Cluster>
<Tabs ariaLabel={t("x.view")} value={tab} onChange={setTab} tabs={[{ id: "notes", label: t("x.notes"), count: 5 }, { id: "policy", label: t("x.policy") }]} />
<Callout tone="policy" title={t("x.policy.t")}>{t("x.policy.b")}</Callout>
```

### Key (`/kit#keys`)

`Key` is the only button. It takes the button attributes plus these props:

| Prop | Meaning |
|---|---|
| `variant? ["default"]` | `primary` (window light: the main action, white in Night, navy in Day) · `default` (a pane) · `metal` (gold: only where ERG moves on Ergo, one per view) · `quiet` · `danger` |
| `size? ["md"]` | `"sm" \| "md" \| "lg"` |
| `icon?` | An icon name; icon-only when there are no children (give it an `aria-label`) |
| `kbd?` | A trailing shortcut hint ("P") |
| `block?` / `tall?` | Full width / the phone action key (icon over label, 62 px) |
| `hold?` | `true` = 1200 ms (on-chain), `"sign"` = 700 ms, or ms. With the `confirmPress` setting it becomes press, then press again. |
| `onAct?` | Called on a completed hold, or on click for a normal key |
| `holdFill?` · `showSecs?` | The hold progress fill · show "0.7 s" (default for holds) |
| `to?` / `href?` | A router link / an external link (new tab) with key styles |

```tsx
<Key variant="primary" icon="pay" kbd="P" to="/play">{t("x.play")}</Key>
<Key variant="primary" hold="sign" onAct={sign}>{t("x.holdSign", { v: money(1240) })}</Key>
<Key variant="metal" hold onAct={redeem}>{t("x.holdRedeem", { v: money(500) })}</Key>
<Key variant="quiet" onClick={close}>{t("x.cancel")}</Key>
```

### Seals (`/kit#seals`)

| Component | Props |
|---|---|
| `KeySeal` | `pk (hex \| bytes)`, `agent?` (octagon), `size? "sm" \| "md" \| "lg" \| "xl"` (28 / 40 / 56 / 96) or px, `rim? boolean \| 0–1` (the gold rim means it has a reserve; a fraction is coverage / 200 %), `badge?`, `title?` |
| `PairSeal` | `pairKey` (blake2b256(issuer ‖ receiver [‖ token])), `size? [84]`, `detail?`, `paper?`, `live?` (inline SVG, hero only), `flat?` |
| `SealId` | `pk`, `name`, `agent?`, `rim?`, `size? ["lg"]`, `words? [true]` (three BIP-39 words), `fingerprint? [true]`, `sub?`, `badge?` |
| `BrandSeal` | `size? [30]`, `pulse? [true]`: the old engraved seal mark; kept for the engines, not used by the shell |
| `GuillocheField` | `seed`, `focus? [x, y]`, `still?`, `dim?`, `lines?`, `rings?`, `pulseFilter?`: an engraved field; kept, no page uses it now |

### The town (`/kit#seals`)

The picture language of the site, drawn from tokens in `src/ui/components/Town.tsx`. All of it is decoration: no data,
no new states, `aria-hidden`, except `HouseLights` with a `label`.

| Component | Props |
|---|---|
| `BrandMark` | `size? [30]`, `pulse? [true]`: the Basis mark, a window with its lower pane lit; it catches moonlight once per commitment |
| `Skyline` | `seed? [7]`, `lit? [.22]`, `height? [120]`, `span? [1200]`, `tower?` (x of a tracker's clock tower), `towerFilter?` (which commitments light the tower): a row of houses (footer, home hero, play stage, kit) |
| `HouseLights` | `steps: boolean[]`, `now?`, `size? [88]`, `label?`: your house, one window per step, lit when done (the wallet's setup steps). Without `label` it is `aria-hidden`, so put it next to a list that says the same in words |
| `WindowLoader` | `size? [64]`: three windows light up in turn; still under reduced motion (used by `Loading`) |

```tsx
<SealId pk={pk} name="Alice" rim />             // seal + three words + fingerprint: how people are named
<PairSeal pairKey={pairKey(issuerPk, receiverPk)} size={120} />
```

Art identifies; it never proves. Show the fingerprint and the three words next to any seal people must trust.

### Note (`/kit#note`)

`Note` is the cumulative IOU: two names, one total that only grows.

| Prop | Meaning |
|---|---|
| `issuer`, `receiver` | Both names are always printed (it is never a bearer note) |
| `issuerPk?`, `receiverPk?`, `noteKey?` | Keys; the note key is derived when omitted |
| `amount`, `unit? ["ERG"]`, `dp? [2]`, `prev?` | The cumulative total and the previous total ("was 1 000.00") |
| `limit?`, `settled?` | The receiver's limit for the issuer (0 hides the cap bar) and the amount redeemed |
| `state? "signed" \| "tracked" \| "committed" \| "stale"` | Foil: grey, grey, holo, grey-stale. Holo only when committed. |
| `tracker?`, `trackerId?`, `digest?`, `block?`, `sigA?`, `sigT?` | Printed proof; the signatures draw the autograph and the machine mark |
| `lite?` · `live?` · `odometer?` · `loupe?` · `bare?` | Cheap art · inline SVG (one per view) · roll the total · hover loupe ×4 · no face text |
| `onClick?`, `ariaLabel?`, `decorative?` | — |

Related components:
- `NoteThumb` takes the `Note` props plus `width? [200]` and `children?` (the text beside it).
- `NoteStub` takes `amount, unit?, label?, dp?`: the metal stub of a redemption.
- `NoteStack` takes `front`, `back? []`, `parallax? [true]` and `children?`: the hero stack.
- `TornNote` takes `seed?` and `children?`: 404 and void.
- `Loupe` takes `zoom? [4]`, `size? [168]` and children.
- `Odometer` takes `value, dp?, allowBack? (time machine only), live?, prefix?, reveal?`. The wheels roll forwards only.

```tsx
<Note issuer="Alice" receiver="Bob" amount={1240} prev={1000} limit={2000} state="committed" tracker="T-01" trackerId="t1" digest={d} block={h} loupe />
<NoteThumb {...note} width={160} />
<NoteStack front={{ ...note, live: true, odometer: true }} back={[n2, n3]} />
```

### Measures (`/kit#reserve`, `#flows`)

| Component | Props | Encoding (VISUAL §9) |
|---|---|---|
| `CoverageMeter` | `value`, `ghost?`, `scale? [true]` | Domain 50–200 %, ticks 100 / 120 / 150; `ghost` = the dashed "before" needle |
| `Coin` | `coverage`, `size? [170]`, `label? [true]` | A reeded gold coin; the ring maps 0–200 % |
| `CapBar` | `limit`, `amount`, `settled?`, `added?`, `height?`, `ink?` | settled (metal) │ outstanding (ink) │ headroom (hatch) |
| `MiniCap` | `used 0–1`, `kind? "out" \| "settled" \| "near"`, `width?` | The 4 px list bar; alarm at ≥ 80 % |
| `BackedTrustBar` | `backed 0–1`, `legend? [true]` | metal │ hatch with "85 % backed · 15 % on trust" |
| `BacksBar` | `items [{label, amount}]`, `locked`, `dp?` | Who this reserve backs, plus the spare part |
| `Dial` | `blocks`, `size? [150]`, `labels?`, `max? [2160]` | The dead-man dial; bands from `trackerBand(blocks)`: < 120 on time · < 720 late · < 2160 silent · emergency |
| `Heartbeat` | `n? [96]`, `commits?`, `now? [true]`, `silent?`, `label?` | Commits are holo, "now" is verdigris |
| `Ledger` | `rows [{label, sub?, value, tone?}]`, `sum?`, `caption?` | Right-aligned figures, a 2 px rule above the sum |
| `OdoLedger` · `Wheels` | `debt, redeemed, dp?` · `value, lead?` | Debt − redeemed = outstanding, on wheels |
| `Tear` | `keep, torn, keepLabel?, tornLabel?, dp?` | The redeem tear-off |
| `GrowthPreview` | `from, to, unit?, dp?, size?` | `1 000.00 → 1 240.00` |

```tsx
<CoverageMeter value={132} ghost={146} />
<CapBar limit={2000} amount={1000} added={240} />
<Ledger rows={[{ label: t("x.fromReserve"), value: <Num value={500} unit="ERG" /> }, { label: t("x.fee"), sub: "none in basis.es", value: "0.00" }]}
        sum={{ label: t("x.receive"), value: <Num value={500} unit="ERG" tone="metal" />, tone: "metal" }} />
```

### Cards (`/kit#reserve`, `#note`)

| Component | Props |
|---|---|
| `ReserveCard` | `owner`, `pk`, `boxes?`, `tracker?`, `coverage`, `locked`, `outstanding`, `canIssue?`, `topUp?`, `backs?`, `tokens? [{label, pct}]`, `exitAt?` (null = no exit notice), `onTopUp?`, `inspectHref?`, `footnote?`, `unit?` |
| `TrackerCard` | `id?`, `nft`, `blocksAgo`, `height?`, `notes?`, `digest`, `commits?`, `trackerId?`, `footnote?` |
| `EclipseCard` | `id?`, `silentBlocks`, `note?` (calm, not an alarm: emergency redeem opens after 2160 silent blocks) |
| `Tape` | `source "sandbox" \| "mainnet"`, `events [{type, lamp?, parties, amount?}]`, `right?`, `framed?` |

### Graph (`/kit#graph`)

`Graph` draws a 2D debt graph: arrows point at the creditor, the tube is the limit, and the body is what is owed. The body is metal when the debtor has a reserve and hatched when on trust.

**Props:**
- `nodes [{ id, label?, pk?, agent?, reserve? (%), sub?, x?, y?, side? }]`
- `edges [{ from (debtor), to (creditor), amount, limit, bend?, backed? }]`
- `loops? [{ edges: ["A>B", …], label, at? }]`
- `width? [1400]`, `height? [600]`: the viewBox
- `view?` / `onViewChange?`: `"graph" | "table"`
- `selected?` / `onSelect?`: `{ kind: "node" | "edge", id }`
- `labels? "auto" | "all" | "hover"`
- `tools? [true]`, `legend? [true]`, `toolbar?`, `ariaLabel?`, `unit?`

**Behaviour:**
- Without `x`/`y` the layout uses d3-force: charge −900, link 260, collide 70. The first loop is pinned to a ring. The layout is deterministic.
- Edge labels: `"auto"` shows them all for ≤ 24 edges, else on hover and selection.
- With more than 16 nodes, each node shows only its name until it is hovered or selected.
- Hovering a reserve is the gravity check: the edges it backs stay and the rest drop to 14 %.
- The table view (debts and people) is the screen-reader path.
- Zoom: the keys, or Ctrl/⌘ + wheel; drag pans while zoomed.
- On phone the graph scrolls inside its card and starts centred.

```tsx
<Graph nodes={nodes} edges={edges} loops={[{ edges: ["Alice>Bob", "Bob>Dan", "Dan>Alice"], label: t("x.loop", { v: money(40) }) }]}
       selected={sel} onSelect={setSel} ariaLabel={t("x.graph")} />
```

### Table (`/kit#tokens`, `#graph`)

`Table<R>` props:
- `columns [{ key, label, align?, lead?, render?, textLabel?, width? }]`
- `rows`, `rowKey(row, i)`
- `onRowClick?` (Enter works too), `selected?(row)`
- `stack?` (rows become label/value blocks on phone)
- `caption?` (screen readers; `showCaption` makes it visible), `foot?`, `empty?`

### Overlays

**`Sheet`:**
- Props: `open`, `onClose`, `title`, `sub?`, `lead?`, `aside?`, `footer?`, `placement? "auto" | "bottom" | "side"`, `width? [480]`, `ariaLabel?`.
- `"auto"` is a side sheet on desktop and a bottom sheet on phone.
- It is modal: a scrim (click closes), Esc, a focus trap, and focus returns on close.

**`Popover`:**
- Props: `trigger(props)`, `children`, `align?`.
- It closes on an outside click and on Esc.

**`toast(input | string)`** returns an id. Input fields:
- `kind? "proof" | "up" | "metal" | "alarm" | "info"`
- `title`, `detail?`, `mono?`, `icon?`
- `ttl? [4000; alarm 0 = sticky]`
- `action? {label, onClick}`

Shorthands: `toast.proof(title, detail)`, `.up`, `.metal`, `.alarm`, `.dismiss(id)`.

Behaviour:
- At most three toasts, newest on top. A new alarm replaces the previous alarm.
- `<Toaster />` is mounted once by the shell.
- `<Toast>` is the static view, for /kit.

```tsx
toast.up(t("x.raised", { name: "Bob", v: money(1240) }), t("x.signed"));
toast({ kind: "alarm", title: t("x.under"), detail: t("x.topUp", { v: money(64.2) }) });
```

### Inputs (`/kit#inputs`)

| Component | Props |
|---|---|
| `Field` | `label`, `help?` (always state the headroom left), `error?` (replaces help; the number stays ink), one child input |
| `AmountInput` | `value` (string), `onChange`, `unit? ["ERG"]`, `plus?`, `max? {label, onMax, disabled?}`, `invalid?` and the input attributes |
| `TextInput` | `value`, `onChange`, `mono?`, `icon?`, `invalid?`, `trailing?` |
| `KeyField` | `value`, `onChange`, `resolve?(s) → {name, pk, agent?} \| null`, `invalid?`: a pasted key or name resolves to a seal |

```tsx
<Field label={t("x.amount")} help={rich(t("x.headroom", { v: money(760) }))} error={over ? t("x.over", { v: money(over) }) : undefined}>
  <AmountInput value={v} onChange={setV} plus max={{ label: t("x.max"), onMax: () => setV(String(left)) }} invalid={!!over} />
</Field>
```

### Faces (`/kit#machine`)

- `FaceTabs` takes `value?`, `onChange?`, `labels?` and `idBase?`. It is the Story / Machine switch (RU: Смысл / Байты).
- `Faces` takes `human`, `machine` and `value?`.
- `useLens()` returns `[lens, setLens]`. The lens is global, and `M` flips it.

**Rule:** give every card that has protocol data a machine face.

```tsx
const [lens] = useLens();
<Faces value={lens} human={<p>{rich(t("x.sentence"))}</p>} machine={<Bytes segments={segs} />} />
```

### Bytes and time

**`Bytes`** shows segmented hex with offsets.
- Props: `segments [{ label, bytes (hex | Uint8Array), tone? "k" | "t" | "ts" | "n" | "a" | "u" | "m" | "g" | "plain", value? }]`, `cols? [16, 8 on phone]`, `offsets?`, `legend?`, `ariaLabel?`.
- `be(v, len)` builds big-endian bytes; `byteGroups(hex)` groups hex.

**`Countdown`** shows blocks ↔ time.
- Props: `blocks?` or `target` + `height`, `lead? "blocks" | "time"`, `toggle? [true]`, `label?`.
- Pressing it swaps which unit leads.

### Policy (`/kit#policy`)

| Component | Props |
|---|---|
| `PolicySentence` | `parts (string \| PolicyPill)[]`, `predicates? [{label, metal?}]`. A pill is `{ id, label, pk?, agent?, metal?, edit? }`; `edit` is the popover editor. |
| `TypedCall` | `fn`, `args [name, string \| number \| boolean \| {num}]`, `check? {key, value, rest?}` |
| `CommandBar` | `query`, `label?`, `call?` (TypedCall props), `actions?` |

### States (`/kit#states`)

| Component | Props |
|---|---|
| `Empty` | `title`, `text?`, `action? {label, to? \| onClick?}` (one primary key), `ghost?` |
| `Loading` · `Engraving` · `PageLoading` | `label?, seed?, lines? [3]` · `seed?, size? [92]` · `label?`. Loading draws three windows lighting up in turn, not a spinner; `Engraving` stays for old call sites. |
| `ErrorState` | `title`, `text?` (what to do, in words), `onRetry?`, `retryLabel?`, `detail?` (mono), `children?` |

## 12. Hooks and engine helpers

**Hooks:**
- `useMedia(q)`, `useIsPhone()` (≤ 640), `useFinePointer()`.
- `useUid(prefix)`, `useEscape(active, fn)`, `isTyping(e)`.
- `flash(el, cls?, ms?)`, `usePulseClass(ref, filter?, cls?)`.

**Engine** (pure TS, tested against the tile; the SHA-256 snapshots cover 16 keys):
- `keyHash(pk)`, `pairKey(a, b, token?)`.
- `threeWords(pk)`, `wordsLine(pk)`.
- `inksFor(pairKey)`, `INKS`.
- Demo data: `demoKey(name)`, `demoPair(a, b)`, `DEMO_PK`, `DEMO_NAMES`, `DEMO_TRACKER_NFT`, `isDemoAgent`, `demoNoteSigs`.

Use the demo data only in the sandbox and in `/kit`.

## 13. Accessibility (VISUAL §15)

- **Focus:** a 2 px ink outline with a 2 px offset and a 4 px halo, never removed. The skip link goes to `#main`.
- **Shape first:** every state must read in greyscale. Lamps are ○ ◐ ●; tags, hatch versus metal, and words carry the rest. Never use colour alone.
- **Contrast:** text tokens are ≥ 4.5 : 1. `--ink-4` is decoration only.
- **Hold-to-act** always has the `confirmPress` alternative and a visible duration. Keys need a 44 px touch target on phone (`.key` sizes do this).
- **Screen readers:**
  - Icon-only keys need an `aria-label`.
  - Decorative art is `aria-hidden` (`Icon` without `title`; `Note decorative`).
  - The graph has a table view.
  - Odometer totals announce politely (`live`).
  - Toasts are `aria-live`, and an alarm is assertive.
- **Motion:** honour reduced motion (§8). Nothing flashes more than once per commitment.
- **Language:** `<html lang>` follows the language.

## 14. Do and don't (VISUAL §16)

| Never | Instead |
|---|---|
| Orange anywhere (ErgoScan's colour on the same host). | Ink, paper and the three lights; gold stays a yellow gold. |
| Gold on a generic button, the mark, the town or a border. | Gold only where ERG or tokens are locked or move. |
| Foil or holo on a note that is not in the latest digest. | Grey foil plus "not yet in a digest". |
| "Send", "transfer", coins flying between wallets. | "Raise your note to Bob to 1 240.00." |
| Red for "you owe". | Words and a minus sign; red only when something is wrong. |
| A banknote you could hand to someone else. | Both names on every note; the seal is the pair. |
| Loops that pulse for no reason; town lights that flicker. | One commitment = one pulse of moonlight. Silence is a state. |
| "Trustless", "guaranteed", "safe", "unstoppable". | "Cannot steal · Can censor", next to every tracker. |
| The display face in body text or below 13 px. | Geist for every small number, label and sentence. |
| A 3D graph, a hairball, or a pie chart for coverage. | A 2D graph with arrows, labels and tubes; a linear meter. |
| Glass, blur or neon on cards and notes. | Lit panes: a flat fill, a 1 px rule, one soft top highlight. |
| A seal shown as proof of identity. | Seal + fingerprint + three words; proof is the signature and digest. |
| U+202F or a regular space inside numbers. | U+2009 + U+2060; units after U+00A0. |
| A fee the contract does not have. | "Protocol fee: none (basis.es)". |
| More than one gold key or one alarm toast per view. | Pick the one action that moves money. |
| Emoji, exclamation marks, rocket energy. | Calm sentences. |
