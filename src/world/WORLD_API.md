# Sandbox world API (`@/world`)

The state layer every page uses: the persistent **town** (one shared sandbox economy per browser), the
**sandbox wallet** ("You"), typed **commands**, the block **clock** with resident bots, **pulses**, persistence and
multi-tab, and **scenario runs** for /play. Framework-light: zustand vanilla stores plus a few React hooks.

```ts
import { town, useTown, useWallet, useClock, useFeed, createRun, useRun, useRunState } from "@/world";
```

Everything here is play money on a simulated chain. Pages label it so (`world.sandbox.*` strings). The engine
underneath is `@/protocol` (PROTOCOL_API.md); this layer never changes its rules.

---

## 1. The town

`town` is a singleton `Town`. It boots on first use (any hook, or `await town.ready()`):

1. loads the real Ergo AVL+ tree (wasm). After an error or 10 s it falls back to the simulated map and
   `state.avl.fallback` is true. Show `state.avl.simulated` in the UI (`world.avl.*` strings);
2. opens storage (IndexedDB, else localStorage, else memory) and elects the tab that runs the town;
3. restores the stored log (replay in 12 ms slices, progress in `state.load.progress`) or builds the genesis.

Genesis (PRODUCT §4.1) is deterministic for the seed `sandbox-town/v1`:

- tracker `T-01` "Town tracker", operated by `op`;
- residents: `alice bob carol dan eve` (people), `cafe bakery` (businesses), `scout quill` (agents);
- ERG plus the sandbox token `sUSE` (`SUSE_ID`);
- reserves of different coverage: Alice healthy (≈ 175 %), the bakery thin (≈ 110 %), the café in sUSE,
  the agents small; Dan is a pure-credit issuer with no reserve;
- credit lines and policies, and 46 blocks of history.

### `TownState` (`town.store`, zustand; at most one update per animation frame)

| field | |
|---|---|
| `v` | bumps once per frame in which anything changed |
| `status` | `"idle" \| "booting" \| "restoring" \| "waiting-leader" \| "ready" \| "error"` (+ `error`) |
| `eco` | the live `Economy`. **Read only.** Change it through commands |
| `height`, `events` | block height and log length |
| `avl` | `{ id, simulated, fallback, label, error, loadMs }` |
| `role` | `"leader"`: this tab runs the town. `"follower"`: another tab does and commands are forwarded. `"solo"`: no Web Locks |
| `clock` | `{ speed, blockMs, hidden, driven, running }` |
| `persistence` | `{ kind: "indexeddb" \| "localstorage" \| "memory", savedEvents, saving, error }` |
| `load` | `{ ms, events, restored, note, progress }`. `note` explains a recovery (unreadable store → new town) |
| `joined` | You are in the town |
| `faucetIn` | blocks until the faucet can be used again (0 = now) |
| `requests` | `PaymentRequest[]`: your requests to residents and how they were answered |
| `contacts` | `Contact[]` `{ id, label?, note?, favorite, addedHeight }` |
| `lastCommit` | the latest tracker commitment (`Pulse`), also on boot |
| `notices` | the latest 20 notices about You, newest first |
| `epoch` | id of the current town history (it changes on reset or a new key) |

Other members: `town.economy` (same as `state.eco`), `town.tabRole`, `town.worldData()`,
`town.onNotice(fn)` (toasts about You), `town.onEvents(fn)` (engine events as applied in this tab), and
`town.flush()` (publish now; tests only).

### Multi-tab

Only one tab runs the clock, the bots and storage (Web Locks election, BroadcastChannel). The other tabs
mirror its log live and send their commands to it. Results come back as the same typed outcomes. When that tab
closes, another takes over with the same history. While it is hidden, a visible tab drives its clock, so the
town keeps a normal pace. `status === "waiting-leader"` means another tab runs the town and this one is
syncing: show `world.status.waiting-leader`. Without Web Locks every tab is `"solo"` and they agree through the
channel.

### Reset

`town.reset()` starts the town again from genesis, and You rejoin with the same key. A different or wiped key
also starts a new town, because the old one is tied to the old key.

---

## 2. The wallet: "You"

`town.wallet` is a `SandboxWallet`. Its store `town.wallet.store` holds `{ status: "none" | "ready", identity, v }`
and never contains the secret.

```ts
await town.createIdentity({ name: "Mira" });      // WebCrypto RNG; { replace: true } discards an existing key + its town
await town.importIdentity(hex, { replace: true }); // 64 hex chars (0x allowed), 1 ≤ k < n
await town.importBackup(json, passphrase, { replace: true });
const { filename, json } = await town.wallet.exportBackup(passphrase); // PBKDF2-SHA256 210 000 + AES-GCM
await town.wallet.verifyBackup(json, passphrase); // also marks the key as backed up
town.wallet.rename("Mira");
await town.wipeWallet();
```

`WalletIdentity` has `pubHex`, `fingerprint` ("0279…1798"), `words` (three words, VISUAL §8.6), `name`,
`source` ("created" | "imported" | "backup" | "restored"), `backedUp`, `sandbox: true` and `label`
(`SANDBOX_KEY_LABEL`).

The key record lives in localStorage under `basis.world.wallet.v1`, labelled as a sandbox key. The town's
log also holds it, because the engine replays You from it. If the browser loses the wallet record, the town
gives the key back on boot (`source: "restored"`). Errors are `WalletError` with a `code`: `exists`,
`invalid-hex`, `out-of-range`, `weak-passphrase`, `wrong-passphrase`, `bad-backup`, `no-identity` or
`no-crypto`.

`threeWords(pub)` and `fingerprint(pub)` come from `@/world` (re-exported). When `src/ui/engine/words.ts`
exists its `threeWords` is used, and `WORDS_SOURCE === "ui-engine"`; a test checks that it matches the local
port.

**Joining.** Call `town.join()` once a key exists. It adds You with 50 play ERG and 200 sUSE, the café opens a
small tab for newcomers, Alice sends a 0.5 ERG welcome note, and alice, cafe and dan become contacts.
`town.faucet()` gives another 50 play ERG (cooldown `FAUCET_COOLDOWN_BLOCKS`; it is always open when you hold
less than 1 ERG). Strings for the buttons: `world.join.button`, `world.join.about` ({erg}, {suse}),
`world.faucet.button` ({amount}: "Get 50 play ERG"), `world.faucet.ready`, `world.faucet.wait` ({height}, {blocks}).

---

## 3. Commands and outcomes

Every command is async and returns a typed outcome. Outcomes are plain data: bigints stay bigints, and they
contain no engine objects. Commands queue one after another. In a follower tab they run in the leader tab.

| call | outcome | notes |
|---|---|---|
| `join({ name? })`, `faucet()` | `SimpleOutcome` | |
| `pay({ to, amount, denom?, memo? })` | `PayOutcome` | `delta`, `totalBefore`, `totalAfter` (cumulative), `note` |
| `selfNote({ amount, denom?, memo? })` | `PayOutcome` (`kind: "self-note"`) | |
| `request({ from, amount, denom?, memo? })` | `RequestOutcome` `{ requestId, dueHeight }` | the resident answers after 2–5 blocks, by its policy and `REQUEST_LIMITS` |
| `cancelRequest(id)` | `RequestOutcome` | |
| `redeem({ issuer, amount?, denom?, emergency? })` | `RedeemOutcome` | `emergency` defaults to `"auto"`; returns `eval` (contract X-ray), `tx`, `txId`, `stage`, `compliance` |
| `createReserve({ amount, denom? })` | `ReserveOutcome` | one reserve per denomination (`reserve-exists`) |
| `topUp({ reserve, amount })` | `ReserveOutcome` | |
| `initiateRefund({ reserve })` | `ReserveOutcome` `{ unlockHeight }` | |
| `completeRefund({ reserve })` | `ReserveOutcome` | refused until `unlockHeight` |
| `novate({ issuer, to, amount, denom?, memo? })` | `PayOutcome` (`kind: "novate"`) | |
| `exchange({ issuer, from, fromAmount, to, toAmount })` | `ExchangeOutcomeView` | |
| `setPolicy({ preset, params? })` or `setPolicy({ policy })` | `SimpleOutcome` | presets in `POLICY_PRESETS`; `null` clears |
| `setCreditLine({ debtor, limit, denom? })` | `SimpleOutcome` | `limit: null` removes the cap |
| `contacts.add(id, o)`, `.update(id, o)`, `.remove(id)` | `SimpleOutcome` | |
| `tracker.commit()`, `.setOnline(b)`, `.setHeartbeat(b)`, `.setCensorship(mode, targets)` | `SimpleOutcome` | god-mode tools |
| `clock.setSpeed(s)`, `.pause()`, `.mine(n)`, `.tick(n)` | `SimpleOutcome` | see §4 |
| `reset()` | `SimpleOutcome` | |

Every outcome carries:

- `ok`;
- `kind`;
- `code` (an engine or world refusal code, for example `policy-rejected`, `credit-limit`, `note-not-confirmed`,
  `not-joined` or `tab-timeout`);
- `message` (technical English; do not show it to people);
- `events`: the seq range the command appended, or `null`;
- `toast: { kind: "proof" | "up" | "metal" | "alarm" | "info", titleKey, detailKey?, params, sticky?, refs? }`.

Render a toast with `worldText(toast.titleKey, toast.params, lang)`. Params that start with `@` are participant
ids rendered as names. For any refusal, `toast.detailKey` is `world.code.<code>`.

Previews are pure reads and work in any tab:

- `town.previewPay({ to, amount, denom? })` returns
  `{ totalBefore, totalAfter, acceptance (with trace), creditLine, outstanding, trackerOnline, censored, ok, etaBlocks }`;
- `town.previewRedeem({ issuer, denom? })` returns a `RedemptionPreviewView`
  (`canRedeemNow`, `maxAmount`, `path`, `blockers`, `etaBlocks`, `fee`, `preflight`, …).

---

## 4. Clock and bots

| speed | block every | |
|---|---|---|
| `paused` | none | |
| `realistic` | 120 s | Ergo's pace |
| `fast` | 2 s | the default |
| `turbo` | 0.2 s | |

`clock.mine(n)` jumps n blocks: nobody acts, and due requests are answered. `clock.tick(n)` mines n blocks one
by one with the residents acting, which is what the running clock does.

A hidden tab slows to one block per 30 s, unless a visible tab of the same town drives it (`clock.driven`).

Bots decide every block from `Rng("<seed>/bots/<height>")`, so the town's life is deterministic for a seed and
does not depend on which tab ran it. They act only on ticks. Residents:

- pay each other;
- pay You sometimes;
- redeem;
- top up thin reserves;
- clear loops of debt;
- answer your requests.

---

## 5. Pulses

On every `tracker.committed` the town calls
`pulse.commit({ source: "sandbox", trackerId, digest, height, noteKeys })` from `@/app/pulse`. It does this in
every tab, because each tab has its own bus. `noteKeys` are the debt keys whose totals entered or changed in
that commitment. The pulse bus does not replay the latest commitment on boot; read `state.lastCommit` for that.

---

## 6. Read helpers (pure functions of an `Economy`)

| helper | returns |
|---|---|
| `noteSummary(eco, rec, viewer?)` | one note: totals, `outstanding`, `claim`, `status`, `direction`, `backed`, `agent` |
| `notesFor(eco, id, { tab?, denom? })` | a wallet's notes (`tab`: all / owed-to-you / you-owe / agents / self) |
| `noteHistory(eco, issuer, receiver, denom?, tracker?)` | every version: message bytes, signature, commitment, state |
| `redemptionPreview(eco, receiver, issuer, denom?, tracker?)` | what can be redeemed now and what blocks it |
| `balanceSheet(eco, id, denom?)` | assets, liabilities, backed or trust part, reserves |
| `graphSnapshot(eco, denom?, { seed?, you? })` | nodes and edges with stable positions in [-1, 1]², cached per log length |
| `trackerTimeline(eco, tracker?, { limit? })` | commitments, newest first, with depth and changed keys |
| `uncommittedKeys(eco, tracker?)`, `commitChangedKeys(eco, seq)` | |
| `denominations(eco)` | ERG first |
| `POLICY_PRESETS`, `policyFromPreset`, `checkPolicy`, `presetOf` | policy presets (wallet policy, never contract rules) |

Formatting follows VISUAL number rules: `fmtDenom(eco, v, denom, { dp?, sign?, symbol? })`, `fmtUnits`,
`parseAmount`, `fmtPercent`, `shortHex`, `groupHex`, `fmtBlocks`.

**Feed.** `feed(eco, { participant?, hideChain = true, hideRefused?, limit = 50, before? }, lang, { cast?, you?, name? })`
returns `FeedItem[]`, newest first. Each item has `{ seq, height, type, tone, key, params, text, who, mine, refs, amount? }`.
`describeEvent(eco, e, lang, o)` gives one row. `cast: true` shows the town's residents by their localized names.

**Strings.** Strings live in `src/world/i18n.ts`, with keys prefixed `world.`, in EN and RU. Helpers:

- `worldText(key, params, lang)`;
- `worldPlural(key, n, params, lang)`;
- `castName(id, lang)`.

Pages can also use the app's `t()`, which sees these keys, but only `worldText` resolves `@id` params.

---

## 7. Scenario runs (/play)

Each run has its own economy, never the town. In step mode it runs exactly like the engine's `ScenarioRun`:
a test checks the same log and state hash as `runScenario` for every scenario.

```ts
const run = await createRun("cafe-on-credit", { seed?, params? });   // default seed "scenario/<id>"
const free = await createFreeRun({ world: "small" | "empty" | "town", seed? });
const back = await importRun(json);                                  // RunImportError on bad input
```

`RunController` methods:

| member | |
|---|---|
| `store` | zustand `RunState`, at most one update per frame |
| `step({ mine? })` | the next step, then its `waitBlocks` (`mine: false` leaves it `pending`; call `settle()`) |
| `animate({ blockMs = 250, maxFrames = 40 })` | the step, then its blocks a stride per frame, then settle; `skip()` finishes at once |
| `runAll()` | all remaining steps, yielding between them |
| `settle()` | evaluates the step's after-mining `check` |
| `eventsOf(result \| index)` | the events of a step, starting with its `scenario.step` marker |
| `results`, `index`, `done`, `current` | `StepResult { outcome: { ok, detail }, fromSeq, toSeq, minedBlocks }` |
| `exec(fn)`, `pay(o)`, `redeem(o)`, `mine(n)`, `commit(tracker?)` | free-mode commands; in a scenario they mark the run `tampered` |
| `stateAt(seq)`, `stateAtHeight(h)` | a fresh economy at that point (time machine, checkpoints every 256 events) |
| `view(seq \| null)` | time travel for the page: `state.view` / `state.viewSeq` (null = live) |
| `marks(filter?)` | timeline marks (step, money, chain, tracker, alert, reject) |
| `diff(a, b = live)` | `StateDiff` between two seqs or economies |
| `fork(seq?)` | a new free-mode run on an alternate history; the original is untouched |
| `verify()` | a full replay lands on the live state hash |
| `exportJson()` | `{ head: { format: "basis-sandbox-run", scenario, seed, params, index, mining, … }, events }` |
| `dispose()` | |

`RunState` fields:

- `v`, `mode` ("scenario" | "free" | "fork" | "replay"), `status` ("ready" | "running" | "animating" | "done" | "free");
- `scenario` (title, tagline, description, features, cast, params);
- `steps`, `current`, `index`, `results`, `pending`, `animating { step, mined, total }`, `busy`;
- `eco`, `view`, `viewSeq`, `height`, `events`;
- `ok` (all steps ok), `continuable`, `tampered`, `avl`.

**Import.** An imported scenario run is re-run from its seed and params, and stays live and continuable when the
state hash matches. A tampered run (with commands outside the story) loads read-only (`mode: "replay"`), and
forks and free commands still work. A run made from a key secret is never exported; the town's log is not a
run.

**Heavy steps.** The agent swarm's bursts, loop clearing and signature audit run in slices of 20 ms or less,
with the same engine calls in the same order, so the swarm never blocks the tab longer than about 20–40 ms on
this box. The time machine builds its checkpoints in idle slices once the page uses time travel.

---

## 8. Hooks

| hook | |
|---|---|
| `useTown(selector)` | selects from `TownState` with a shallow-equal result, and boots the town |
| `useTownReady()` | `{ ready, status, role, error, avl, load, persistence }` |
| `useTownView((eco, state) => value, deps)` | a value derived from the live economy, recomputed once per changed frame |
| `useWallet()` | `{ status, identity, v }` |
| `useClock()` | `{ speed, blockMs, hidden, driven, running, height }` |
| `useFeed(query)` | `FeedItem[]` in the current language |
| `useNotices(fn)` | calls `fn` for each notice about You |
| `useRun(spec)` | `{ run, error }` for `{ scenario, seed?, params? }`, `{ free, seed? }` or `{ json }`; disposes on change or unmount |
| `useRunState(run, selector)` | selects from a run's state |
| `useRunView(run, (eco, state) => value, deps)` | derived from the economy the page shows (the time-travel view or live) |

---

## 9. Examples

### Home (town at a glance)

```tsx
function TownStrip() {
  const { ready, role, avl } = useTownReady();
  const { height, lastCommit } = useTown((s) => ({ height: s.height, lastCommit: s.lastCommit }));
  const { speed } = useClock();
  const graph = useTownView((eco) => graphSnapshot(eco, "erg", { you: YOU }));
  const items = useFeed({ limit: 8 });
  if (!ready) return <TownLoading />;          // role === "follower": "The town is running in another tab"
  return <>
    <Badge>{t("world.sandbox.badge")}</Badge>{avl?.simulated && <Badge>{t("world.avl.simulated")}</Badge>}
    <Graph nodes={graph!.nodes} edges={graph!.edges} />
    {items.map((i) => <FeedRow key={i.seq} tone={i.tone} text={i.text} />)}
  </>;
}
```

### Wallet

```tsx
const { identity } = useWallet();
const joined = useTown((s) => s.joined);
const notes = useTownView((eco) => (joined ? notesFor(eco, YOU, { tab: "owed-to-you" }) : []), [joined]);
const sheet = useTownView((eco) => (joined ? balanceSheet(eco, YOU) : null), [joined]);
useNotices((n) => toast(worldText(n.titleKey, n.params, lang), n.kind));

async function onPay(to: string, text: string) {
  const amount = parseAmount(text, denomInfo(town.economy, "erg"));
  if (amount === null) return;
  const r = await town.pay({ to, amount, memo: "coffee" });
  showToast(r.toast);                           // ok: "Café now holds 0.40 ERG from you (+0.10)"
}
async function onRedeem(issuer: string) {
  const p = town.previewRedeem({ issuer });     // p.blockers → explain why not yet
  const r = await town.redeem({ issuer });      // r.eval → contract X-ray, r.tx → transaction lens
}
// identity: <Words words={identity.words} /> <code>{identity.fingerprint}</code> + identity.label
```

### Play

```tsx
function Scenario({ id }: { id: ScenarioId }) {
  const { run } = useRun({ scenario: id });
  const s = useRunState(run, (s) => ({ status: s.status, current: s.current, results: s.results, animating: s.animating }));
  const graph = useRunView(run, (eco) => graphSnapshot(eco, "erg"));
  const marks = useMemo(() => run?.marks((m) => m.kind === "step") ?? [], [run, s?.results.length]);
  if (!run || !s) return <Loading />;
  return <>
    <StepCard step={s.current} onNext={() => run.animate()} onSkip={() => run.skip()} />
    <Scrubber marks={marks} onScrub={(seq) => run.view(seq)} onLive={() => run.view(null)} />
    <Graph {...graph!} />
    <button onClick={() => download(`${id}.json`, run.exportJson())}>Export</button>
  </>;
}
```

### Tracker

```tsx
const rows = useTownView((eco) => trackerTimeline(eco, TOWN_TRACKER, { limit: 30 }));
const last = useTown((s) => s.lastCommit);    // also: pulse.subscribe(...) for live commits
<button onClick={() => town.tracker.commit()}>Commit now</button>
<button onClick={() => town.tracker.setOnline(false)}>Take the tracker offline</button>
<button onClick={() => town.tracker.setCensorship("refuse", [YOU])}>Censor me</button>
```

---

## 10. Tests and performance

To make a test town, build it with memory storage, no tab election and no timers, then drive the clock by hand:
`new Town({ kv: new MemoryKV(), tabs: null, autoClock: false, wallet: new SandboxWallet(memStorage), avl })`.
See `__tests__/helpers.ts`. For multi-tab tests, `localTabEnv(new LocalLocks(), new LocalChannelHub(), id)`
mimics Web Locks and BroadcastChannel in one process.

Measured on this box (vitest, wasm AVL+):

- a 1 800-block town with bots has ≈ 3 900 events and replays in ≈ 40 ms;
- the slowest synchronous slice of any scenario run is 20–40 ms (agent swarm or clearing circle; the higher
  figure under parallel test load), with the time-machine warm-up included.

`src/world/check/browser-check.mjs` checks the platform in real Chromium, with no dev server:

- Web Locks election and promotion;
- BroadcastChannel order and bigint;
- IndexedDB;
- WebCrypto PBKDF2 210 000 + AES-GCM;
- the wasm compiled from bytes served with a non-wasm MIME type, both the source file and the emitted
  `dist/assets/avl-<hash>.wasm` when a build exists;
- requestAnimationFrame.
