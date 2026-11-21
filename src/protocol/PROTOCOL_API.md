# Basis protocol engine: API

`src/protocol/` is pure TypeScript: no React, no network, no `localStorage`. Import everything from `@/protocol`.

It is bit-exact with `contract/basis.es`, `contract/basis-token.es` and the Rust tracker (BetterMoneyLabs/basis-tracker @ 43e2173). That covers:

- the 80-byte note message;
- Ergo Schnorr signatures, including the contract's signed-integer view;
- debt keys and reserve keys;
- register encodings;
- the empty AVL+ digest;
- every reserve-contract check;
- the tracker server's rules: check order, error texts, FIFO, rate limit, the box-updater cycle and two-phase exchanges.

Two things are simulated:

- **Wall-clock and blocks.** The `BlockClock` uses 120 s blocks.
- **AVL+ trees.** The default backend is simulated. `useAvlBackend(ERGO_AVL_WASM)` switches to the real Ergo AVL+ (WASM), which produces real digests and proofs.

```ts
import { Economy, erg, runScenario, ScenarioRun, TimeMachine, useAvlBackend, ERGO_AVL_WASM } from "@/protocol";
```

---

## 1. Primitives (`bytes`, `keys`, `note`, `registers`, `schnorr`)

| API | What it does |
|---|---|
| `demoKeyPair(name, salt?)` | Deterministic demo key, derived as blake2b("salt/name"). It is public by construction. |
| `keyPairFromSecret(secret)` | Builds a key pair from a secret. |
| `randomKeyPair()` | A fresh random key pair. |
| `nickname(pub)`, `shortId(pub)` | Human labels for a key. |
| `debtKey(owner, receiver, denom?)` | The tracker-tree key: `blake2b256(owner‖receiver[‖tokenId])`. The tokenId is appended only for token denominations. |
| `reserveKey(owner, receiver)` | The reserve-tree (R5) key. It **never** includes a tokenId, not even in `basis-token.es`. |
| `noteMessage(key, total, tsMs, trackerNft)` | The 80-byte message. `messageLayout(msg)` gives coloured byte segments for the X-ray view. |
| `parseNoteMessage(msg)` | Splits a message back into its fields. |
| `erg("1.5")` | Converts ERG to nanoERG. |
| `parseUnits` / `formatUnits` | Parse and format token amounts. |
| `tokenDenomination(tokenId, symbol, decimals)` | Returns `{ id: "token:<hex>", … }`. ERG is `"erg"`. |
| `sign(msg, key)` | Ergo Schnorr signature: `a(33) ‖ z(32)` with `e = blake2b256(a‖msg‖pk)`. The nonce is deterministic: the signer retries until `e[0] < 0x80` and `z < 2^255`. |
| `signWithTrace(msg, key)` | The same, plus every rejected nonce attempt. |
| `verify(pub, msg, sig)` | Returns `{ ok, failure? }`. Failure reasons are in `VERIFY_FAILURE_TEXT`. |
| `contractSignatureHolds(pub, msg, sig)` | The contract's exact view, using signed `byteArrayToBigInt` and `decodePoint`. It can throw where `verify` would only return false. |
| `explain(pub, msg, sig)` | `SignatureXray` for the Learn and X-ray views: every step and check with its bytes. |
| `encodeGroupElement`, `encodeCollByte`, `encodeLong`, `encodeAvlTree`, `decodeRegister`, `basisAvlRegister(digest)` | Register hex exactly as it appears on chain. |
| `EMPTY_AVL_DIGEST_HEX` | `4ec61f48…160900`. |

**Performance note.** noble 1.7.0's `multiplyUnsafe` is wrong on windowed points. The engine therefore uses `multiply` for G and for cached keys (see `warmPublicKey`). Do not "optimise" it back.

## 2. AVL (`avl`)

- **`AuthenticatedMap`.** Methods: `get`, `has`, `insert`, `update`, `insertOrUpdate`, `digest()` (33 bytes), `proofFor(key)`, `prove(ops)` (proof without applying) and `clone()`. Property: `simulated`.
- **`AvlBackend`.** Has `createMap` and a stateless verifier: `lookup`, `insert`, `insertOrUpdate`, `update`.
- **Registry.**
  - `registerAvlBackend(id, backend | loader)`, `listAvlBackends()`.
  - `await useAvlBackend(id)` loads a backend and makes it the default.
  - `setAvlBackend`, `getAvlBackend`, `onAvlBackendChange`.
  - `index.ts` registers `ERGO_AVL_WASM` lazily, through `import("./avl-wasm")`.
- **Per economy.** You can pass a backend to one economy only: `new Economy({ avl })`. Scenarios also accept `{ economy: { avl } }`.
- **Simulated vs real.** The simulated map uses the real empty digest, but every other digest is a sandbox digest (16-bit-bucket sparse Merkle tree). Real AVL+ digests depend on insertion order. The adapter therefore replays its operation log on `clone()`.

## 3. Policies (`policy`)

- **Format.** The tracker's own acceptance-policy format, `AcceptanceConfig`:

  ```
  { default: "accept" | "reject", root?: string, predicates: PredicateConfig[] }
  ```

  Predicate types are `whitelist {holders, max_debt?}`, `collateralization {min_ratio, no_pending_refund?}`, `all_of`, `any_of`, `not`, `credit_cap`… (see the type).
- **Evaluation.** `evaluateAcceptance(cfg, ctx, "per-recipient" | "global")` returns `{ acceptable, root, trace }` and is used for the wallet-side decision. The trace short-circuits like the server does.
- **Redemption gate.** `checkRedemptionCompliance(input)` is an exact port of `check_redemption_policy_compliance`. It returns one of:
  - `ok`, with mode `no-other-holders | compliant | mixed | fifo-oldest`;
  - `failed_policy_violation`;
  - `failed_not_oldest_note`.
- **Presets.**
  - `cowPolicy(trusted, minRatio, maxDebt)`: collateral or whitelist.
  - `creditCapsPolicy`.
  - `collateralPolicy(minRatio, requireNoRefund)`.
  - `defaultCollateralPolicy()`: the server's suggested 100 % policy.
  - `acceptAllPolicy()`.
  - `EMPTY_POLICY`: the shipped default, `reject` with no predicates.
- **Tools.**
  - `validatePolicy(cfg)` returns the builder's error text.
  - `policyRootName(cfg, "builder" | "redemption-check")`: the two server evaluators pick the root differently.
  - `hasRootAmbiguity(cfg)`.
  - Serialisation: `policyToJson`, `policyFromJson`, `policyToToml`. u64 values are written as bare numbers.

## 4. Clock (`clock`)

- **`BlockClock`.**
  - Reads: `height`, `nowMs()`, `timeOfHeight(h)`.
  - Moves: `tick(n)`, `setHeight(h)`, `observe(ms)`. Time never goes backwards.
  - Conversions: `blocksForRealtime(ms)`; `blocksToDuration(blocks)` returns strings such as "3 d".
- **Constants.**
  - `EMERGENCY_BLOCKS` = 2160.
  - `REFUND_PERIOD_BLOCKS` = 43 200.
  - `MIN_TOP_UP_NANOERG` = 0.1 ERG.
  - `MIN_TOP_UP_TOKEN_UNITS` = 1.
  - `MINER_FEE_NANOERG` = `MIN_BOX_VALUE_NANOERG` = 0.001 ERG.
  - `TRACKER_UPDATE_INTERVAL_MS` = 600 s (5 blocks).
  - `MIN_CONFIRMATION_DEPTH` = 2.
  - `REDEMPTION_BUILDS_PER_PAIR_PER_HOUR` = 60.

## 5. Reserve contract (`reserve`)

**`evaluateReserveSpend(tx, inputIndex, { avl })`** returns a `ReserveEval`: `{ ok, contract, action, actionName, checks[], failed[], error, emergency, redeemed, newRedeemedTotal, message, debtKey, reserveKey, proofMode }`.

- Each check is `{ id, outcome: "true" | "false" | "throws" | "skipped", expr, detail }`. They follow the contract's lazy `&&` order, so a check after the first false is marked `skipped`.
- **Check ids.** These are the names to use for UI copy.
  - Prologue: `actionVar outputExists ownerKey reserveTokens`.
  - Self-preservation: `uniqueReserveInput scriptPreserved tokensPreserved tokenIdsPreserved ergPreserved ownerPreserved trackerNftPreserved`.
  - Action 0, redeem: `trackerIdCorrect trackerDebtCorrect timestampCorrect properRedemptionTree properReserveSignature properlyRedeemed trackerSigValid refundPreserved receiverSignature`.
  - Action 1, top up: `treePreserved topUpAmount`.
  - Action 2, initiate refund: `valueNotDecreased refundHeightValid refundNotStarted ownerSignature`.
  - Action 3, complete refund: `refundStarted refundPeriodOver`.
  - Anything else: `invalidAction`.

**`ReserveSim`** is one reserve over time: its box, its redemption tree (R5) and its history.

- **Builders.** Each returns a `SimTx`:
  - `buildRedeem({ receiver, totalDebt, timestamp, amount, issuerSig, trackerSig, trackerBox, height, tamper? })`;
  - `buildTopUp(amount, payer, height)`;
  - `buildInitiateRefund(r7, height, signers?)`;
  - `buildCompleteRefund(height, signers?)`.
- **Checks and reads.**
  - `evaluate(tx)` runs the contract checks.
  - `collateral()`.
  - Refund state: `refundHeight()`, `refundPending()`, `refundUnlockHeight()`.
  - `redeemedFor(pub)` returns `{ timestamp, redeemed }`.
  - `digestHex()`, `registersHex()`.
- **`RedeemTamper`** builds broken transactions on purpose, for the "try to cheat" UI. Options:
  - Proofs: `omitReserveLookup`, `forceReserveLookup`, `trackerProof`, `reserveProof`, `insertProof`, `staleOutputTree`.
  - Values and tokens: `extraTaken`, `ergDelta`, `outputTokens`.
  - Outputs and inputs: `outputR7`, `outputScript`, `extraInputs`.
  - Signers and context variables: `signers`, `totalDebtVar`, `receiverVar`, `dropVars`.
- **Other exports.**
  - `combineRedemptions(parts, height, extraSigners)` builds one atomic transaction with up to 10 reserve inputs.
  - `trackerBoxFor(...)` builds the tracker data input.
  - `contextVarsHex(tx.contextVars[i])` gives the context-extension hex for the X-ray view.

## 6. Tracker (`tracker`)

`TrackerSim` is the server emulator. You normally drive it through `Economy`, but its state is public for the Tracker console. Each entry below lists the state or method, then the server behaviour it reproduces.

- **`notes`** (Map key → `NoteRecord`)
  - Each record holds `{ issuer, receiver, denom, totalDebt, timestamp, amountRedeemed, waived, history[], omitted, tracker }`.
  - `history` holds every signed version.
- **`boxes`** (`TrackerBoxRecord[]`)
  - Each box is a commitment: `{ boxId, txId, digest, creationHeight, confirmedHeight, tree }`.
- **`status(rec)`**
  - Returns `local` until the latest version is in the committed tree.
  - It becomes `pending` in the committing cycle.
  - It becomes `confirmed` at the next updater cycle at which depth ≥ 2, which is one 600 s cycle later.
- **`checkNote(sub, nowMs)`** (`POST /notes`), in the server's order:
  1. offline
  2. censorship
  3. NFT mismatch (409)
  4. denomination
  5. i64 range
  6. future timestamp (no tolerance)
  7. past timestamp
  8. decrease
  9. signature

  **No acceptance policy is evaluated here.**
- **`authorizeRedemption(...)`** (`/redemption/build` and `/tracker/signature`)
  - Refusal codes, in order: `tracker-offline`, `not-found`, `stale-committed-debt`, `note-not-committed`, `note-not-confirmed`, `rate-limited`, `multiple-reserves`, `no-reserve`, then the FIFO and policy gate.
  - `Economy.redeem` adds two wallet-side checks before this gate: `insufficient-collateral` and `nothing-to-redeem`.
  - `worstCase` checks the full outstanding amount, as `/tracker/signature` does.
- **`exchanges`** and **`decideExchange(x, boxId)`** (`POST /notes/exchange`, two-phase)
  - Decisions are `wait`, `apply` or `cancel` with the server's reason text.
- **`options`** (`TrackerOptions`)
  - Fields: `coSign`, `autoCommit`, `commitIntervalBlocks`, `skipIfUnchanged` (the real updater: an idle tracker ages), `enforceAcceptancePolicy`, `minDepth`, `rateLimitPerHour`.
  - `coSign` is `on-redemption` (the real server) or `on-submit` (the contract docs).
- **Box age and emergency**
  - `boxAge(h)`, `emergencyOpensAt()`, `emergencyOpen(h)`.
  - The emergency path opens when the box is more than 2160 blocks old.

## 7. Economy (`economy`): the event-sourced world

```ts
const eco = new Economy({ seed: "demo", lazySignatures: true /* default */, avl? });
eco.addParticipant({ id: "alice", name: "Alice", kind: "human" | "agent" | "business" | "tracker-operator", erg: erg(10), tokens?: [[denomId, units]] });
eco.createTracker({ id: "t1", operator: "op", denoms?: [tokenDenomId], options?, globalPolicy? });   // the first tracker is the default
eco.createReserve({ owner: "alice", amount: erg(5), denom?, tracker?, id? });                       // → ActionOutcome { ok, reserve, tx, eval }
eco.pay({ from: "alice", to: "bob", amount: erg(1) });                                              // → PayResult { ok, record, code, acceptance }
eco.mine(10);                                                                                       // box updater cycles, confirmations, phase-2 exchanges
eco.redeem({ receiver: "bob", issuer: "alice" });                                                   // → RedemptionOutcome { ok, stage, code, amount, eval, tx, compliance, emergency }
```

### Commands

Every command validates first, then emits events. Refusals are events too, so the UI can show them in the feed.

- **Setup**
  - Denominations and participants: `addDenomination`, `addParticipant`, `addParticipantWithKey`, `fund`, `setOnline` (mesh mode).
  - Trackers: `createTracker`, `setTrackerOptions`, `setGlobalPolicy`.
  - Receiver rules: `setPolicy(id, cfg | null)` and `setCreditLine(creditor, debtor, limit, denom)`.
  - Story helpers: `annotate`, `markStep`.
- **Payments**
  - **`pay`.** The receiver's wallet checks its policy first, or the credit line when no policy is set. Then the tracker runs `checkNote`. Then the note is witnessed.
    - Test options: `signature`, `timestamp`, `totalDebt`, `trackerNftId`, `skipAcceptance`.
  - **`selfNote({ who, amount })`.** An A→A note, which is how an owner withdraws part of a live reserve.
  - **`novate({ issuer, from, to, amount })`.** The issuer signs a new note to `to`; `from` records a waiver. The waiver is invisible to the tracker and unenforceable on chain.
  - **`exchange({ issuer, receiver, from, fromAmount, to, toAmount })`.** The two-phase cross-denomination swap, with 4 signatures.
    - Use `exchangeSignatures(trackerId, id)` to inspect them.
  - **Offline notes.** `payOffline` signs while offline; `syncOffline()` submits later in signing order.
  - **`checkAcceptance(...)`.** A dry run of the receiver's decision.
- **Chain**
  - Blocks: `mine(n)`, `mineTo(h)`.
  - `commit(trackerId, { force })` runs a manual updater cycle.
  - `disappear`, `reappear`.
  - `setCensorship(trackerId, "off" | "refuse" | "omit", targets)`.
- **Reserves**
  - `createReserve`.
  - `topUp({ reserve, amount, by })`: anyone may top up, with no signature.
  - `initiateRefund({ reserve, r7? })`, `completeRefund({ reserve })`.
- **Redemption**
  - **`redeem(opts)`.** Runs the wallet check, then the tracker gate, then the transaction, then contract evaluation.
  - **Options.** Defaults are given in brackets.
    - `amount`: how much to redeem [everything still claimable, capped by `maxPayout(reserve)`].
    - `emergency`: `true`, `false` or `"auto"` ["auto" = only when the tracker is offline and the box is older than 2160].
    - `force`: skip the wallet and tracker checks so the contract decides, used by "try to cheat" buttons.
    - `worstCase`.
    - `tamper`.
  - **`redemptionPreview(...)`.** What a holder could redeem right now, and what blocks it.
  - **`maxPayout(reserve)`.** The server always leaves 0.001 ERG in an ERG reserve and at least one unit in a token reserve.
- **Clearing**
  - Debt views: `debtEdges(denom)`, `netPositions(denom)` and `settlementPlan(denom)` (greedy netting).
  - `findCycles(denom, maxLen)` lists debt cycles.
  - `previewClearing(cycle)` shows the effect of clearing a cycle without doing it.
  - **`clearCycle(cycle, { mode })`** clears one cycle:
    - `"onchain"`: one atomic transaction in which every debtor's reserve pays its creditor. It needs a co-signature per leg and allows at most 10 legs.
    - `"waivers"`: off-chain clearing.
    - `"auto"`: picks one of the two.
- **Signatures**
  - `signatures(rec, { version, includeTracker })` returns the message, the issuer's signature, whether it verifies, and the tracker's signature: the one handed out, or a preview.
  - `xray(rec, { who })` gives the signature X-ray.
  - **Lazy signatures.**
    - Under `lazySignatures`, a note version is signed when first needed: on redemption, on `signatures()`, or through `materialize(budgetMs)` (call it from `requestIdleCallback`).
    - `pendingSignatures()` counts the versions still waiting.
    - Nonces are deterministic, so the same seed always produces the same signature bytes.
    - Lazy and eager runs give identical state hashes.

### Views

All views are pure reads.

| View | What it returns |
|---|---|
| `p(id)`, `t(id?)`, `r(id)` | Participant, tracker and reserve lookups. |
| `balance(id, denom)` | Wallet balance. |
| `coverage(id, denom)` | `{ collateral, liabilities, ratio, level: critical<1.0 / warning<1.2 / caution<1.5 / ok / none, label: TUI reserve label }`. |
| `balanceSheet(id, denom)` | Assets and liabilities. Each has an "on-chain" variant that ignores waivers. Also the self-note, reserve, wallet, net, coverage and per-counterparty lines. |
| `graph(denom?)` | `{ nodes: GraphNode[], edges: GraphEdge[] }`, ready for a force graph. |
| `notesOf(id)`, `note(issuer, receiver, denom?, tracker?)`, `noteStatus(rec)` | Notes and their status. |
| `stats()` | Totals for the HUD. |
| `stateHash()` | Canonical state hash, used for determinism checks. |

### Events (`events`)

`eco.events` is the full log. `eco.subscribe(fn)` is called after each event is applied. Each event is `{ seq, height, timeMs, type, … }`. The event types are:

- **World:** `genesis`, `denomination.added`, `participant.joined`, `participant.status`, `wallet.funded`.
- **Trackers:** `tracker.created`, `tracker.committed`, `tracker.confirmed`, `tracker.status`, `tracker.censorship`, `tracker.policy`, `tracker.options`.
- **Policies and credit:** `policy.set`, `credit.set`.
- **Notes:** `note.issued`, `note.rejected`, `note.offline`, `waiver`.
- **Chain:** `chain.mined {from, to}`.
- **Reserves:** `reserve.created`, `reserve.toppedUp`, `reserve.redeemed`, `reserve.refundInitiated`, `reserve.refundCompleted`, `redemption.rejected`, `action.rejected`.
- **Feed:** `nostr {kind, inServer}`.
  - `inServer` tells the UI whether the real server emits this event today.
  - It does for redemptions and top-ups, which come from the scanner.
  - Commitments and the 80 % / 100 % alerts exist only in the spec and are simulated here.
- **Exchanges:** `exchange.staged`, `exchange.applied`, `exchange.cancelled`, `exchange.rejected`.
- **Clearing:** `clearing.settled`, `clearing.rejected`.
- **Story:** `scenario.step`, `annotation`.

`INFORMATIONAL_EVENTS` (rejections, steps, annotations) never change state. `describeEvent(e, nameOf)` gives a one-line English text. `eventsToJson` / `eventsFromJson` write logs as bigint-safe JSON (`{"$n": "…"}`).

**⚠ Keys in the log.** `participant.joined` stores how to re-derive the key. A demo key is stored as its salt and label. A key created from a secret is stored as the **secret itself**, so never use a real key in the sandbox.

### Replay

- `Economy.replay(events, { avl })` rebuilds a whole economy from a log.
- `eco.clone()` copies an economy.
- `eco.ingest(e)` applies one more event.
- Reducers only apply data that is already in the event, so a replay never re-runs checks or crypto.

## 8. Time machine (`timemachine`)

```ts
const tm = new TimeMachine(eco, { checkpointEvery: 256 });
tm.stateAt(seq);                 // fresh Economy right after event seq (frontier + clone checkpoints → O(checkpointEvery))
tm.stateAtHeight(h);             // state at the end of block h (also inside long chain.mined ranges)
tm.fork(seq);                    // a live alternate history; mutate freely, the original is untouched
TimeMachine.diff(a, b);          // wallets / notes / reserves / trackers that differ + divergedAt
tm.marks(m => m.kind === "step");// timeline points: step | money | chain | tracker | alert | reject
tm.sync(eco);                    // append the live economy's new events
tm.verify(eco);                  // full replay hash == live hash
checkDeterminism(() => build()); // build twice, compare hashes
```

## 9. Scenarios (`scenarios`)

`SCENARIOS` / `listScenarios()` list 11 presets. Each has `{ id, title, tagline, description, features, cast, steps }`:

| id | What it shows |
|---|---|
| `cafe-on-credit` | Cumulative notes, a café policy with a trust line, commit, redemption, partial redemption, no reserve behind trust. |
| `agent-swarm` | Thousands of lazy-signed micro-payments, atomic loop clearing, netting, signature audit. Its params are `agents`, `burst1` and `burst2`. |
| `village-lets` | Hour token, credit lines, offline mesh and sync, credit limit, waiver clearing, Σ balances = 0. |
| `free-bank` | Deposits by top-up, banknotes, novation, loans, alerts, a bank run under FIFO, the waiver that blocks the queue, recapitalisation, self-note withdrawal. |
| `tracker-vanishes` | The tracker goes offline; a redemption at box age 2160 fails; the emergency redemption at 2161 succeeds; the uncommitted tail is lost. |
| `refund-race` | Refund notice, policies refuse new notes, FIFO redemption, an early completion fails, completion at 43 200, a late holder gets nothing. |
| `triangle-novation` | Novation, a refused decrease, and the waiver the contract cannot enforce: Alice pays 8 for 5. |
| `clearing-circle` | A 5-business loop cleared in one transaction with 5 reserve inputs. |
| `censoring-tracker` | Omission, detection, frozen redemptions with the emergency path shut, refusal, exit to another tracker. |
| `idle-tracker` | The real updater skips unchanged digests, so the emergency path opens while the tracker is alive; heartbeat mode closes it. |
| `currency-exchange` | A two-phase ERG→USE exchange is applied; a stranger's top-up cancels a second one, and nothing is restored. |

```ts
const run = new ScenarioRun("free-bank", { seed?, params?, economy? });
run.current;                       // next ScenarioStep { id, title, text, waitBlocks, focus }
const r = run.step();              // runs it + mines waitBlocks → StepResult { outcome: { ok, detail }, fromSeq, toSeq, minedBlocks }
run.step({ mine: false }); /* animate: */ run.eco.mine(1) … ; run.settle();   // evaluates the after-mining check
run.eventsOf(r);                   // events of that step, for the feed
run.runAll();  runScenario(id)     // headless
```

Every step's `outcome.ok` says whether the protocol behaved as the story claims. The tests assert this for all steps on both AVL backends.

## 10. Performance (measured on this box)

- **`agent-swarm` with defaults** (24 agents, 5,000 payments, 6 on-chain clearings): about 0.62 s for the whole scenario. 5,000 payments alone take about 0.25 s (about 20,000 payments/s).
- **Signatures:** a materialised signature costs about 0.4 ms, so the UI can pay that cost during idle time.
- **Replays and time travel:** a full replay costs the same as the original run, but needs no signing.
- **`stateAt`:** cost grows with `checkpointEvery`, not with the length of the log.
