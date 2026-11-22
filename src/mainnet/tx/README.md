# `src/mainnet/tx`: the mainnet transaction core

This module turns tracker answers and `/v1` boxes into checked bytes, and then into signed transactions. It covers design §1, §2.3, §3.1–3.5 and §8.4 (`/root/basis/qa/wallet-mainnet-design.md`).

It does **no network, no storage and no DOM.** The UI layer does those things:
- fetches through the existing FIFO;
- keeps the key in the vault;
- shows the review screens.

Everything is pure TypeScript on the noble libraries the app already ships, plus `avl.wasm` for L2.

Import from `src/mainnet/tx` (the `index.ts` barrel). Inside the repo, use **relative imports**. The vite alias `@` points at the main tree (`/root/basis/app/src`), not at a worktree.

## Conventions

- **Hex is lowercase**, with no `0x`. Keys are 33-byte compressed (`02…`/`03…`); ids are 32 bytes.
- **Amounts are `bigint`** in nanoERG, everywhere. A parsed JSON number never passes through a JS `number`.
- **Box registers** are a dense list from R4: `registers[0]` is R4. Each is one serialized constant in hex. Use `register(box, "R5")` to read one by name.
- **Context extension**: `ExtensionEntry[]`, kept in the order the text had.
- **Checks never throw for a refusal.** They return `{ ok: false, rule, message }`. Show `message` as plain text and log `rule`. Builders and signers throw when called with impossible input.
- **Never re-stringify a tracker answer.** Never `JSON.parse` it for anything you send back. Use `parseJson`, which keeps key order, raw numbers and spans, and refuses duplicate keys, and echo the original text by span.

## Modules

| File | What |
| --- | --- |
| `json.ts` | Strict JSON with spans (`parseJson`, `rawText`, `replaceSpan`, `at`) and typed readers (`asU64`, `asHex`, …) that throw `ShapeError(path)` |
| `model.ts` | `ErgoBox`, `BoxCandidate`, `UnsignedTx`, `SignedTx`, plus the parsers for the three shapes. `boxFromV1` reads `/v1/boxes/{id}` and outputs. `inputBoxFromV1` reads `/v1` inputs: `index` there is the spending position, so it uses `outputIndex`/`outputTransactionId`. `txFromV1` reads a `/v1` transaction (no extension). `unsignedTxFromJson` reads the tracker's `unsigned_tx`. `nodeTxFromJson` reads node-shape partial or signed transactions. |
| `serialize.ts` | The node's bytes: `serializeBox`, `computeBoxId`, `boxIdHolds`, `bytesToSign`, `computeTxId`, `serializeSignedTx`, `outputBoxes`, `signedTxToNodeJson`, and the Scala `HashMap` extension order (`scalaHashMapOrder`, `nodeExtensionOrder`) |
| `address.ts` | A strict base58 address codec: `parseAddress` (throws `AddressError` with `reason`), `p2pkAddress`, `p2sAddress`, `addressOfTree`, `p2pkKeyOf`, `treeOfAddress` (mainnet P2PK/P2S only) |
| `constants.ts` | Appendix A, pinned: `RESERVE_TREE_HEX` (764 B), `FEE_TREE_HEX`, `TRACKER_NFT`, `TRACKER_PK`, `EMPTY_RESERVE_R5`, `R7_NO_REFUND`, `reserveAddress()`, the amount limits (D5), and the body caps |
| `provedlog.ts` | `proveDlog(message, secret32)` (hedged nonce, self-verified), `verifyDlog(pk, message, proof)`, `publicKeyOf(secret32)` |
| `messages.ts` | `noteMessage` (80 B), `buildRequestMessage` (131 B ERG, 198 B token), `signBasis`, `verifyBasis` (Basis Schnorr, not ProveDlog) |
| `redemption.ts` | Redemption: `parseStoredNote`, `checkNoteForRedemption`, `signedBuildRequest`, `parseBuildResponse`, **`checkRedemption` (L1)**, `signRedemption`, `spliceRedemptionProof`, `redemptionSubmitBody`, `parseSubmitResponse`, `TrackerRefusal` |
| `contract.ts` | **L2**: `loadContractAvl`, `checkRedemptionContract`, `checkReserveContract` |
| `p2pk.ts` | T1 and Withdraw: `selectCoins`, `planReserveCreation`, `parseReservePayload`, `checkReservePayload`, `buildReserveCreation`, `checkReserveCreation`, `buildWithdraw`, `checkWithdraw`, `signP2pkTransaction`, `verifyP2pkTransaction` |
| `testkit.ts` | **Tests and UI fixtures only, never in production code.** `syntheticRedemption()`, `trackerBuildResponse()`, `trackerRefusal()`, `p2pkBox()`, `secretBytes()` |
| `fixtures/` | Mainnet JSON, saved byte for byte (see `fixtures/chain.ts`), plus R3's rebuilt build answer (`fixtures/r3-build.ts`) |

Secrets are always **32-byte `Uint8Array`s**. The vault hands them in, and nothing here keeps them.

## Redemption (design §3.2)

```ts
import * as tx from "../mainnet/tx";

// 1. GET /notes/issuer/{i}/recipient/{me}: the note must be committed and cover the amount; its signature is checked here.
const note = tx.checkNoteForRedemption(tx.parseStoredNote(text), { issuer, recipient: me, amount });
if (!note.ok) return show(note.rule, note.message);

// 2. GET /tracker/state, /tracker/pending-tx: wait while a commit is pending (UI side).
// 3. Sign the build request. request_timestamp = the server-aligned clock (±120 s), above the previous one.
const req = tx.signedBuildRequest(secret, { issuer, recipient: me, amount, issuerSignature: note.expect.issuerSignature, requestTimestamp });
// POST /redemption/build with req.body (a string; send it as is).

// 4. Read the answer: raw spans and parsed copies. Throws TrackerRefusal (success:false), JsonSyntaxError or ShapeError.
const build = tx.parseBuildResponse(answerText);

// 5. Re-read both boxes from the chain: GET /v1/boxes/{build.reserveBoxId} and /v1/boxes/{build.trackerBoxId}.
const chain = { inputs: [tx.boxFromV1(tx.parseJson(reserveText))], dataInputs: [tx.boxFromV1(tx.parseJson(trackerText))] };

// 6. L1, then L2.
const l1 = tx.checkRedemption(build, chain, { ...note.expect, currentTrackerBoxId, tipHeight });
if (!l1.ok) return show(l1.rule, l1.message);                 // nothing is signed
const l2 = tx.checkRedemptionContract(l1, chain, tipHeight + 1, await tx.loadContractAvl());
if (!l2.ok) return show(l2.rule, l2.message);                 // l2.eval feeds the contract X-ray (every check)

// 7. Hold to sign: ProveDlog over l1.bytesToSign, self-verified, spliced into the tracker's partial_tx text.
const signed = tx.signRedemption(l1, secret);

// 8. POST /redemption/submit. The body echoes unsigned_tx byte for byte; it throws above 64 KB.
const body = tx.redemptionSubmitBody(l1, signed);
const { txId } = tx.parseSubmitResponse(submitAnswerText);    // compare with signed.txId; a mismatch is a warning
```

**What L1 checks** (`L1Rule`, in this order; the first failure stops it):

| Rule | What it checks |
| --- | --- |
| `fee-paid-by` | The build says `"recipient"` |
| `fee-limit` | The fee is ≤ `maxFee`, by default 0.001 ERG |
| `payout` | amount − fee > 0 and ≥ 0.001 ERG. The build reports exactly that payout, to P2PK(recipient), with no change. |
| `box-ids` | The transaction names the boxes you read from the chain, and each one hashes to its id |
| `box-binaries` | The tracker's `input_box_binaries` and `data_box_binaries` equal those boxes byte for byte |
| `tracker-key` | The keys are well formed; the tracker key is not the recipient; the issuer is not the recipient |
| `tracker-box` | The only data input is `tracker_box_id` and is the current one (`currentTrackerBoxId`, if given). Token 0 is (NFT, 1). R4 = `07‖TRACKER_PK`. |
| `reserve-input` | There is exactly one input, the reserve, under the pinned tree. R4 = the issuer, R6 = `0e20‖NFT`, tokens = [(its NFT, 1)]. |
| `extension-order` | The raw key order is Scala's order, in both `unsigned_tx` and `partial_tx` |
| `extension-keys` | The keys are exactly {0…6, 8}, plus 7 when `is_first_redemption` is false |
| `extension-values` | #0 = `0200`. #1 = the recipient. #2 = the note's signature. #3 = the committed total (and `total_debt`). #4 = the timestamp. #5, #7 and #8 are each exactly one Coll[Byte]. |
| `tracker-signature` | #6 is 65 bytes and verifies under `TRACKER_PK` over the 80-byte note message |
| `outputs` | There are exactly 3 outputs |
| `reserve-output` | Output 0 keeps the tree, the tokens, R4 and R6. Its value is reserve − amount, ≥ 0.001 ERG. R5 is an AvlTree (flags 03, keyLength 32, no valueLength). R7 is equal. There are exactly 4 registers. |
| `payout-output` | Output 1 is `0008cd‖recipient` = payout, with no tokens and no registers |
| `fee-output` | Output 2 is the fee tree = fee, with no tokens and no registers |
| `creation-height` | No output is below its input. When `tipHeight` is given, every output is within tip − 15 … tip + 2. |
| `totals` | ERG in = ERG out. No token is minted or burned. The NFT sits only first in output 0. With this layout the output rules already imply all of this; it is kept as defense in depth. |
| `ids` | `partial_tx` is this transaction: one input, an empty proof, the same bytes to sign, the same id, the same output box ids |
| `malformed` | Something could not be read at all |

**L2** (`L2Rule`): the contract engine (`protocol/reserve.ts`) runs on the real transaction with the stock AVL+ verifier.
- **AVL proofs:**
  - #8 is checked against the tracker's R5;
  - #7 is checked against the reserve's own tree;
  - #5 must be an `insert` on a first redemption and an `insertOrUpdate` later, and it must give output 0's R5.
- **Signatures:** #2 and #6, read as the contract reads them.
- **Rule names:** a failure is named by the engine's check id (`trackerDebtCorrect`, `properRedemptionTree`, …). The adapter adds:
  - `adapter`: something cannot be mapped faithfully;
  - `verifier`: no stateless verifier;
  - `tree-params`: the output tree's flags or lengths changed, or the flags forbid the update;
  - `redeem-shape`;
  - `redeemed-total`: the contract's `newRedeemedTotal` must equal the build's `new_already_redeemed`, and the amount redeemed must equal the amount.
- **The replay that only L2 catches:** an `insert` on a key the reserve tree already holds. The tracker's vendored AVL would upsert it; the chain refuses it.
- **Backend:** `loadContractAvl()` loads `avl.wasm` once and never switches the sandbox's global backend.

**Signing:** `signRedemption` does these steps and throws on any failure:
1. derives the key's pk and refuses any key that is not the note's recipient;
2. proves `l1.bytesToSign`;
3. splices the proof into `partial_tx` at `inputs[0].spendingProof.proofBytes`, which must be `""` before;
4. re-reads the result;
5. checks that the bytes, the id and the proof are all as expected, and that nothing but the slot changed.

## T1: creating the reserve (design §2)

```ts
const plan = tx.planReserveCreation(unspentOwnerBoxes, owner, amount, fee, cap); // change 0 or ≥ 0.001 ERG
// POST /reserves/create { nft_id: plan.nftId, owner_pubkey: owner, erg_amount: plan.amount }
const payload = tx.parseReservePayload(answerText);
const p = tx.checkReservePayload(payload, { owner, amount: plan.amount, nftId: plan.nftId });
if (!p.ok) return show(p.rule, "The tracker's reserve template differs from the one this app knows. Nothing was signed.");
const t1 = tx.buildReserveCreation({ owner, inputs: plan.inputs, amount: plan.amount, fee: payload.fee, height: tip });
const c = tx.checkReserveCreation(t1, plan.inputs, { owner, amount: plan.amount, fee: payload.fee, height: tip, cap });
if (!c.ok) return show(c.rule, c.message);
const { txId, nodeJson } = tx.signP2pkTransaction(t1, plan.inputs, secret);  // throws above 16 KB
// journal(txId, nodeJson), then POST /api/tracker/node/transactions with nodeJson (D1)
```

- **Boxes:** pass confirmed, unspent boxes at P2PK(owner) from `/v1/boxes/unspent/byAddress/{addr}`. Every box is hashed against its id, and a box that does not hash makes selection throw.
- **Coin choice:** token-free boxes come first, largest first. Tokens always reach the change output.
- **Dust:** dust below 0.001 ERG is added to the reserve. When that would pass `cap`, the amount is lowered instead, so that the change is exactly 0.001 ERG; read the final `plan.amount`.
- **Output order:** `[reserve, change?, fee]` (design §2.2). Mainnet T1 was built by the canary as `[reserve, fee, change]`. Our builder reproduces T1's reserve box byte for byte, and gives T1's id in T1's order (`p2pk.test.ts`).
- **Amount limits (D5):** `cap` defaults to 1 ERG (`RESERVE_DEFAULT_CAP_NANOERG`). Pass up to `RESERVE_HARD_CAP_NANOERG` (10 ERG) only after the explicit "I understand". The floor is 0.1 ERG.

## Withdraw

`buildWithdraw({ owner, inputs, to, amount, fee, height })` gives `[destination, change?, fee]`. `checkWithdraw` checks it, then `signP2pkTransaction` signs it.
- **`to`:** a mainnet P2PK or P2S address. The reserve contract, the fee contract, P2SH and testnet addresses are refused.
- **Tokens** stay with the owner, in the change output.

## Errors to expect

| Error | Source | What it means |
| --- | --- | --- |
| `TrackerRefusal` | `envelopeData`, `parse*` | `{success:false}`. `reason` is cut to 300 characters; show it as plain text. |
| `JsonSyntaxError(offset)` | `parseJson` | Not strict JSON, a duplicate key, or trailing data |
| `ShapeError(path)` | the readers | A missing field, wrong type, bad hex, or a value out of range |
| `AddressError(reason)` | `address.ts` | `format`, `checksum`, `prefix`, `network`, `key` or `type` |

## Tests (`scripts/check.sh test src/mainnet`)

- **`serialize.test.ts`:**
  - T1, R1, R2 and R3: the id recomputed from `/v1` (plus the reserve extension, which `/v1` does not carry) equals the chain's, and so does the signed size;
  - every box id;
  - Scala order against the chain;
  - ascending order gives another id.
- **`provedlog.test.ts`:** our verifier accepts the on-chain proofs: the T1 owner, the receiver on R1–R3, and the tracker's fee inputs of R1–R2. It also covers the Fiat–Shamir preimage, sign/verify and tamper cases.
- **`messages.test.ts`:**
  - the `basis_core` worked examples: the 80-byte note, the 131-byte and 198-byte build requests, and the debt keys;
  - R3 #2 and #6 verify on mainnet.
- **`json.test.ts`:** spans round-trip byte for byte on every fixture, plus the strictness cases.
- **`redemption.test.ts`:**
  - L1 passes on R3, and the chain's R3 proof covers our `bytesToSign`;
  - splicing that proof rebuilds R3 byte for byte;
  - there are 43 mutations, each failing exactly its rule;
  - signing uses a synthetic key;
  - the submit body and the build request.
- **`contract.test.ts`:**
  - L2 passes on R1, R2 and R3 with the proofs verified;
  - the replay (R2 without #7) fails;
  - tampered copies fail.
- **`p2pk.test.ts`:** the T1 payload (13 mutations), T1 against the chain, the T1 checks, dust and the cap, tokens, Withdraw, and the 16 KB guard.

For UI work without the network, `syntheticRedemption({ first })` gives a build that passes L1, with known keys (secrets 2, 3 and 5), and `parts` you can mutate. Its AVL proofs are placeholders, so L2 refuses it. For a build that passes both L1 and L2, use `fixtures/r3-build.ts`; it cannot be signed, because the receiver key is not here.
