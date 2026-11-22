# src/viz — protocol X-rays

Owner: protocol visualisation. Showcase with live engine data: **/lab/viz** (`src/features/vizlab`).

Import everything from `@/viz`. Components take engine objects from `@/protocol` as props. They never fetch
anything, never write to storage, and never keep state outside React. Copy lives in `src/viz/**/i18n.ts`, and the
shell merges those bundles on its own, so a feature imports only the component.

## Rules for callers

- **Sandbox.** Every lab key and demo tracker is a sandbox object. Label it with `t("viz.sandbox")`. `labKey(name)`
  derives a key from a public name and must never hold real value.
- **Faces.** Most panels have a Story face (words) and a Machine face (bytes). Pass `face` to fix one; otherwise
  the reader switches with `FaceToggle`.
- **Colour.** The panels use tokens from `src/ui/tokens.css` only. Holo marks only proven facts (MATCH, a committed
  digest, a valid signature). A failed condition is `--alarm`. Nothing is ever orange.
- **Motion.** The X-ray steps through the conditions once it scrolls into view. With reduced motion or `?still`
  it shows the final state at once.
- **Numbers** are formatted like VISUAL §4.3: thin-space thousands, an NBSP before the unit, 2 dp for amounts,
  blocks first and then ≈ time (120 s per block).

## Components

| Component | Feed it | Shows |
|---|---|---|
| `ContractXray` | `evaluation`: a `ReserveEval`, or any Economy result carrying `eval`/`tx` (`eco.redeem(...)`, `topUp`, `initiateRefund`) | basis.es with line numbers and a lamp gutter. Conditions light up in contract order. Each one shows actual against required, e.g. "redeemed 1.50 ERG > owed − already redeemed 1.20 ERG". Then a verdict. Content's annotations appear on hover or tap. A refusal before the contract (wallet or tracker) shows as "not reached", with the condition it protects. Optional: `contract`, `action`, `focus` (reason codes), `mode` "compact" (relevant lines) or "full" (the whole file), `animate`. |
| `SignatureXray` | `xray={eco.xray(noteRecord)}`, or `pub` + `message` + `signature` | The 80-byte message grid, then a ‖ z. The challenge e = blake2b256(a ‖ msg ‖ pk) with the e[0] < 0x80 rule, then z < 2^255, then both sides of g^z = a·x^e. Tap a byte to flip a bit (`tamper`); the X-ray names the condition that breaks. `signer` is "issuer" or "tracker". |
| `SignLab` | optional `issuer`, `receiver`, `amount`, `timestampMs` | Sign it yourself with lab keys, showing every nonce retry until e[0] < 0x80. |
| `SelfTest` | nothing (`initialOpen?: "TV001"…`) | Checks TV001–TV004 from the signature spec in the browser with the engine's verifier: TV001 valid, TV002/TV003/TV004 invalid (TV003 by the challenge rule). |
| `TxLens` | `tx: SimTx`, plus `evaluation`, `event`, `nameOf` | Inputs, the data input (the tracker box and its age), and outputs with R4–R7 and tokens. The context variables come in the Scala map order the node writes (0,5,1,6,2,(7),3,8,4). Shows the 0.001 ERG miner fee and who pays it, and a value-flow strip. `kind` is inferred: redeem, top-up, refund-init, refund-complete, create, clearing. `synthCreateTx(reserve)` draws a create transaction for a reserve the sandbox made without one; pass `synthesized` with it. |
| `AvlProofViewer` | `digest` (33 bytes), `proof`, `lookupKey`, `backend` | The digest with its glyph, the proof cut into segments, and the verifier run with the backend named → MATCH. Tap a byte, or pass `tamper`, to see MISMATCH. `valueKind` "tracker" reads a total debt; "reserve" reads a timestamp and the amount redeemed. |
| `AvlTreeView` | `map` (`tracker.map` or `reserve.tree`), `version` | The tree drawing and the entries in key order. Inserts animate and the digest change pings. The fingerprint glyph is deterministic. `keyName(hex)` labels keys ("Alice → Bob"). Pass a bumping `version` (e.g. `eco.events.length`), because the map mutates in place. |
| `DigestGlyph` | `digest` | The deterministic glyph alone: `holo` for committed, `stale` for an old digest. |
| `EventFeed` | `events` (`eco.events`), `version`, `nameOf` | One line per event, with chips for notes, chain, reserves, tracker, alerts and rejections. An "inServer" badge marks what today's tracker server emits. The list is virtualised (10 000+ rows) and follows the newest event until the reader scrolls up. `onSelect`/`selectedSeq` link it to other panels. |
| `StatusLadder` | `{...ladderFromEconomy(eco, noteRecord)}` or a `LadderInput` | local_only → pending → confirmed. ETA = blocks to the next commit + the updater cycle that sees 2 confirmations (≤ 5 blocks + 2). "Can redeem now" = confirmed && redeemable > 0. |
| `ExitClocks` | `height`, `boxCreationHeight` (the tracker box), `r7` | Emergency: the dial of box age against 2 160 blocks; it opens at creation + 2 161. Exit: R7 + 43 200 blocks (≈ 60 days). `show` is "both", "emergency" or "exit". |
| `DebtKeyTool` | optional keys / token id | blake2b256(owner33 ‖ receiver33 [‖ tokenId32]), plus the reserve key. |
| `MessageBuilder` | optional `debtKey`, `totalDebt`, `timestampMs`, `trackerNftId` | Builds the 80 bytes field by field. The layout is `MESSAGE_LAYOUT`, which equals the engine's `messageLayout`. |
| `NoteVerifyTool` | `initial?` (JSON) | Paste `{issuer, receiver, totalDebt, timestamp, trackerNftId, signature}`; the tracker's own field names work too. It rebuilds the message, verifies, and shows the SignatureXray. |
| `TemplateHashTool` | `initial?` (ErgoTree hex or P2S address) | header → template → SHA-256 (WebCrypto, or noble as a fallback), compared with the known templates (KNOWLEDGE §d.5). Legacy templates are flagged. |

## Helpers (pure functions, usable in tests)

`resolveEvaluation`, `buildRows`, `verdictOf`, `findingFor` (the actual-vs-required line), `OFFCHAIN_REASON_CHECK`
(refusal code → the contract condition it protects) · `ALL_CHECK_IDS`, `checksOf`, `deriveContractMap` ·
`scalaMapOrder`, `extensionRows`, `CONTEXT_VAR_MEANING` · `proofAnatomy`, `rootMatches`, `recomputeRootLabel` ·
`describeLine`, `groupOf`, `EVENT_TYPES` · `ladderModel`, `ladderFromEconomy`, `emergencyModel`, `exitModel` ·
`debtKeyParts`, `buildMessage`, `parseNoteJson`, `analyzeTemplate`, `sha256Hex`, `KNOWN_TEMPLATES` · `labKey`,
`LAB_TRACKER_NFT`.

## Minimal use

```tsx
import { ContractXray, EventFeed, StatusLadder, ladderFromEconomy } from "@/viz";

const r = eco.redeem({ issuer: "alice", receiver: "bob", amount: erg("1.5"), force: true });
<ContractXray evaluation={r} />                       // fails at properlyRedeemed, with the numbers
<EventFeed events={eco.events} version={eco.events.length} nameOf={(id) => eco.participants.get(id)?.name ?? id} />  // re-render after each engine call
<StatusLadder {...ladderFromEconomy(eco, eco.note("alice", "bob")!)} />
```

## Mounting the tools at /learn/tools (the learn feature)

```tsx
import { DebtKeyTool, MessageBuilder, NoteVerifyTool, TemplateHashTool } from "@/viz";

<DebtKeyTool />        {/* blake2b256(owner ‖ receiver [‖ tokenId]) */}
<MessageBuilder />     {/* the 80 bytes a note signs */}
<NoteVerifyTool />     {/* paste a note's JSON, verify its signature */}
<TemplateHashTool />   {/* ErgoTree or P2S address → template → SHA-256 → which Basis contract */}
```

Each tool is self-contained, with no props needed, and runs only in the page. The X-rays need `@/protocol` objects, so
for a page with no sandbox, use the tools, `SelfTest` and `ContractXray` with no `evaluation` (it then shows the source
and the conditions in contract order, with no verdict).

## Tests

`scripts/check.sh test src/viz` covers the following:
- the TV vectors;
- the Scala order on real redeem transactions, compared with content's `contextVarOrder`;
- every check and every engine refusal code renders in words in EN and RU;
- every event type has a line;
- the components render with no raw keys in either language;
- RU covers every key with the same placeholders, and no forbidden words appear;
- MessageBuilder equals `noteMessage`, and `debtKeyParts` equals `debtKey`/`reserveKey`;
- the sample template hashes equal the chain decoder and seed.json;
- the clock arithmetic;
- the /lab/viz showcase on the wasm backend.
