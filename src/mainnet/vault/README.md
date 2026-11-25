# src/mainnet/vault: the mainnet key vault and its journal

One secp256k1 key per browser (K1: random, no seed words are made or kept; a key from another Ergo wallet can be
imported from its words, see `importHex`). It is encrypted at rest with PBKDF2-HMAC-SHA256 (600 000
iterations) and AES-256-GCM, and stored in IndexedDB. The vault keeps no plaintext secret between uses: an unlocked
session holds a non-extractable AES key and the ciphertext, and every use decrypts a fresh copy and wipes it. Signing
happens in one tab at a time (Web Locks). A backup file must be verified before anything is signed. A write-ahead
journal stores every signed transaction before it is sent.

Design: `/root/basis/qa/wallet-mainnet-design.md` §4 (keys, backup, journal), §6.2–6.3 (UI states), §8.3 (risks). The
vault has no texts and no React: the UI maps states and error codes to its own words (PRODUCT.md §1).

It is fully separate from the sandbox key (`src/world/identity.ts`). It has its own database, formats, additional data,
lock and channel names. Nothing here imports `src/world`, and nothing here touches localStorage.

## Use

```ts
import { getMainnetVault, attachAutoLock, isVaultError } from "../../mainnet/vault"; // from src/features/<id>/ (see Notes)

const vault = await getMainnetVault();            // the page's one vault; never throws for a missing feature
const stop = attachAutoLock(vault);               // idle, hidden and page-leave locks; call stop() on teardown
const state = useSyncExternalStore(vault.subscribe, vault.getState);
const entries = useSyncExternalStore(vault.journal.subscribe, vault.journal.getSnapshot);
```

Each method is async unless marked otherwise. Each one throws a `VaultError` with a `code` (see Errors). Operations of
one tab run one at a time. `lock()` is never queued: it wins at once.

## State (`vault.getState()`)

The object is frozen and stays the same until something changes. `subscribe(fn)` returns an unsubscribe function.

| Field | Meaning |
| --- | --- |
| `status` | `loading` → `none` \| `locked` \| `unlocked`; `damaged` (the stored record is unreadable); `unsupported` (see `missing`) |
| `key` | `{ pub, address, createdAt, backedUpAt, source }` for `locked` and `unlocked`, else null. `source`: `created`, `backup`, `hex` |
| `backedUp` | A backup file was proven to decrypt to this key. Funding and every signature wait for it (design §4.3) |
| `lockReason` | Why it locked last: `manual`, `idle` (10 min), `hidden` (2 min, or the page was left), `taken-over` (another tab took the signer), `lost` (the browser dropped the Web Lock), `storage-changed` (the record changed or vanished), `wiped`; null after an unlock |
| `missing` | For `unsupported`: `indexeddb`, `webcrypto`, `web-locks`. No mainnet key is possible in this browser |
| `persisted` | `navigator.storage.persist()`: true granted, false refused, null unknown |
| `v` | Bumps on every change |

The design's key flow `none → created (unbacked) → backed-up`, `unlocked ⇄ locked` (§6.2) is `status` plus `backedUp`.
For `damaged`, `backedUp` says whether that record had a verified backup.

## Key lifecycle

| Call | What it does | Throws |
| --- | --- | --- |
| `create(passphrase)` → `{ state, persisted }` | A new random key. The vault is unlocked afterwards (so the backup can be downloaded at once) and not backed up | `weak-passphrase`, `exists`, `damaged`, `locked-elsewhere`, `tracker-key-refused` |
| `exportBackup({ extras? })` → `{ filename, json }` | The backup file of the unlocked key, with the watched issuers and contacts sealed inside. Offer it as a download (`application/json`) | `locked`, `bad-input` (extras) |
| `verifyBackup(fileText, passphrase)` → state | The user loads the file again and types the passphrase. A match sets `backedUpAt`. Works locked or unlocked | `bad-backup`, `backup-other-key`, `wrong-passphrase`, `no-key`, `damaged` |
| `restoreFromBackup(fileText, passphrase, { takeOver? })` → `{ state, alreadyPresent, extras, extrasUnreadable, persisted }` | Restores into a browser without a key; unlocked and backed up afterwards. The same key already here: the file only counts as a verified backup (`alreadyPresent`). `extras` are decrypted and returned as untrusted input; `extrasUnreadable` means the file has extras that do not open (the key restores without them) | `bad-backup`, `wrong-passphrase`, `exists`, `damaged`, `locked-elsewhere`, `tracker-key-refused` |
| `importHex(key, passphrase, { takeOver? })` → `{ state, alreadyPresent, persisted }` | For experts: a 64-hex key from another tool (`0x`, spaces and capitals are allowed), or the 32 bytes of a key derived from a seed phrase (`seed.ts`; copied at once, the caller wipes its own array). `source` is `hex` either way. Never replaces a key already here. Not backed up until a file is verified. This browser's sandbox key (its record's public key, `env.sandboxPub`) is refused: the sandbox keeps its secret as plain text (keys review P2-7) | `invalid-hex`, `out-of-range`, `weak-passphrase`, `exists`, `damaged`, `locked-elsewhere`, `tracker-key-refused`, `sandbox-key-refused` |
| `unlock(passphrase, { takeOver? })` → state | Opens the session in this tab. When it is already open, it still checks the passphrase | `no-key`, `damaged`, `wrong-passphrase`, `locked-elsewhere`, `tracker-key-refused`, `locked` (lock() came first) |
| `lock(reason = "manual")` (sync) | Drops the session and releases the Web Lock. It never throws | |
| `confirmPassphrase(passphrase)` → boolean | True when the passphrase opens the stored key. It changes nothing | `no-key`, `damaged` |
| `wipe({ confirmUnbacked?, journal?, takeOver? })` → state | Forgets the key in this browser. A key without a verified backup needs `confirmUnbacked: true`. The journal stays unless `journal: true` and every entry of the key is closed | `not-backed-up`, `journal-unresolved`, `locked-elsewhere` |
| `refresh()` → state | Re-reads the record and `persisted` (the channel already does this for changes in other tabs) | |

Seed phrase (`seed.ts`, for a key that already lives in Nautilus or another Ergo wallet): `checkMnemonic(words)` →
`{ ok, phrase, count }` or a reason (`empty`, `word` with its number from 1, `count`, `checksum`; English list, 12–24
words, spaces, line breaks and capitals tolerated, NFKD); `seedFromMnemonic(words, password)` → the 64-byte BIP39 seed
(the caller wipes it); `seedKeys(seed, from, count)` → `{ index, pub, address }` along EIP-3 `m/44'/429'/0'/0/i`,
indexes 0–49; `seedSecret(seed, index)` → the 32 bytes for `importHex`. The vault keeps no words, no path and no index;
the legacy derivation of node wallets before 1627 is not supported.

A typical new key: `checkPassphrase` (meter) → `create` → `exportBackup` (download) → `verifyBackup` (the user loads the
file back) → only then the Fund screen. `importHex` needs the same two backup steps. `parseBackup(text,
VAULT.KDF_ITERATIONS)` reads a file without a passphrase, for a preview (`pub`, `address`, `createdAt`; the extras
stay sealed). It throws `bad-backup`.

Passphrase: `checkPassphrase(p)` → `{ ok, length, strength 0–4, issues }`, where `issues` holds `too-short`,
`one-kind`, `repeats`, `sequence` or `common` (codes only). The hard rule is 12 code points after NFKC; the strength is a
hint. The vault never stores the passphrase. Each of `create`, `unlock`, `verifyBackup`, `restoreFromBackup`,
`importHex`, `confirmPassphrase` and a `withSecret` with `passphrase` runs one 600 000-iteration derivation, so show
progress. The design expects 0.5–1.5 s on phones.

## Using the key

`withSecret(purpose, fn, { passphrase? })` is the only way to the secret.

- **Purposes:** `t1`, `note`, `redeem`, `withdraw`, `topup`, `refund-start`, `refund-end`, `build-request`, `export-hex`.
- **What it needs:** an unlocked session in this tab, and a verified backup (`export-hex` excepted).
- **The callback:** `fn(secret, pub)` is called synchronously. `secret` is a 32-byte copy, wiped when `fn` returns, and
  `pub` holds the 33 bytes of the compressed public key.
  - Sign inside `fn` and return the result.
  - Never keep `secret`, copy it out, or pass it to async code.
  - A callback that returns a promise is refused: `async-callback`.
- **The leak scan:** what `fn` returns or throws is checked for the secret (`secret-in-output`). It finds:
  - the bytes, also inside larger buffers, views and arrays of numbers;
  - its hex, base64 or base64url in any string, at any offset;
  - its byte values written as a list;
  - its decimal value, or the bigint scalar.

  It fails closed: a function or a promise anywhere, more than 12 levels, more than 50 000 parts or a string over
  1 MiB counts as a leak. An error from `fn` that does not hold the secret passes through unchanged.
- **`passphrase`:** asks for the passphrase again, which runs one derivation. The vault enforces when (§4.2, keys
  review P1-2, `policy.ts`):
  - `t1` (a reserve creation moves the whole reserve) and `export-hex`: always;
  - `withdraw`: unless every output of the signed transaction pays this key's own P2PK tree or the miner-fee tree, and
    the fee outputs add up to at most `MINER_FEE_NANOERG` (Combine, a cancel back to the key); `signToJournal` reads the
    signed bytes with the strict parser and drops them when the rule is broken. Whatever the passphrase, a withdrawal
    spends only boxes at this key's P2PK without context variables (`spendsOnlyOwnBoxes`; `opts.inputBoxes`, required,
    each bound to its input by its id), so it can never sign a reserve's refund completion;
  - `note`: when the notes signed since the passphrase was last typed (the unlock counts, so does any use with
    `passphrase`), this one included, promise more than 25 % of the reserve's value **on chain** (`opts.note.reserveValue`,
    read from /v1, never the tracker's figure: the box that holds the reserve NFT the wallet trusts, found by an exact
    lookup, never the listing at the key; 0 = none it can prove, then it always asks). A note promises its increment over
    the pair's previous note, which must be this key's (its signature is checked);
  - `topup`, `refund-start`, `refund-end` (the reserve's own actions, `src/mainnet/tx/reserveaction.ts`): always. A
    top-up may send money to another key's reserve for good; a refund start can never be undone. `signToJournal` also
    drops signed bytes whose outputs are not the action's layout (`reserveActionPaysRight`): a top-up or refund start is
    [the reserve contract, change to this key?, a miner fee of at most `MINER_FEE_NANOERG`], a completion is [this
    key, the miner fee]; the reserve output keeps R6 = our tracker and R4 = this key (refund start) or the owner the
    screen reviewed (top-up: `opts.reserveOwner`, required);
  - `redeem`, `build-request`: never. A redemption pays only this key: `signToJournal("redeem")` refuses (`bad-input`)
    signed bytes that are not exactly [the reserve, P2PK(this key), a miner fee of at most `REDEEM_MAX_FEE_NANOERG`],
    or that are not a redemption: one input whose #0 is action 0, and an output 0 that is not this key's own reserve
    (a refund start or a top-up with change has the same output layout); that one input is a reserve-contract box
    (`redeemsReserveBox`: `opts.inputBoxes` = the reviewed box, required, bound to the input by its id).

  A direct `withSecret` for `t1`, `withdraw`, `note`, `topup`, `refund-start` or `refund-end` always needs `passphrase` (the vault cannot see what such a
  callback signs). `notePolicy(intent)` tells the review screen the same answer `signToJournal` will give. The rule
  binds the app's own flows; code injected into the page could still call `withSecret("redeem", …)` with any callback,
  which is what the CSP is for.
- **`export-hex`:** always needs `passphrase`, and it is the one purpose whose output is not scanned: its output is the
  key. Show it behind a hold and a warning (§4.3). Never put it in state, storage or a URL, and clear it from the screen
  afterwards.
- **Hold-to-sign:** every signature is an explicit hold (§4.2). That is the UI's part.

`signToJournal(kind, fn, { passphrase?, note? })` → `JournalEntry` signs and records in one step; use it for every
T1, redemption, withdrawal and note. `fn` returns the journal fields `{ txId, signedRaw, unsignedRaw?, inputs, meta?,
height? }`. For a T1, the journal is checked before the key is touched (`t1-exists`). A note needs `note: { recipient,
total, reserveValue, prev }` (what it promises); the signed `POST /notes` body must be exactly that note. If the journal
or a rule refuses the entry, the signed bytes are dropped and never sent.

```ts
const entry = await vault.signToJournal("withdraw", (sk) => {
  const signed = signTransaction(unsigned, sk);    // src/mainnet/tx (part 2)
  return { txId: signed.id, signedRaw: signed.json, inputs: signed.inputIds, meta: { amount: "1000000" }, height };
});
await vault.journal.markSending(entry.id);       // right before every (re)send
await submit(entry.signedRaw);                     // the exact stored text, every time
await vault.journal.update(entry.id, { state: "sent" });
```

## Journal (`vault.journal`)

It uses the same database, store `journal`. Signed transactions hold no secrets, and the journal never holds the key.

**Write-ahead:**
1. Sign, then `record()` (or `signToJournal`), before anything is sent.
2. Call `markSending(id)` right before every broadcast or submit. `sendAttempts === 0` proves an entry was never sent.
3. Send `entry.signedRaw` byte for byte.
4. Call `update(id, patch)` with what the chain or the tracker shows.

On page load, `unresolved(pub)` lists the open entries: poll them, and rebroadcast the same bytes.

| Method | |
| --- | --- |
| `record(input)` → entry | Validates and stores. Recording the same `txId` with the same bytes again returns the stored entry; the same `txId` with other bytes is `bad-input` |
| `markSending(id)` → entry | `sendAttempts + 1`, `firstSendAt`, `lastSendAt`. Throws `bad-transition` for a closed entry |
| `update(id, { state?, lastHeight?, inclusionHeight?, error?, meta? })` → entry | `error` is cut to 300 characters (render it as text); `meta` is merged |
| `abandon(id)` → entry | Only `signed` with `sendAttempts === 0`. Anything that may have reached the network can only fail |
| `retireT1(id)` → entry | A `final` T1 whose reserve was fully refunded (seen on chain) stops blocking a new T1 |
| `get(id)`, `list({ pub?, kind?, open? })`, `unresolved(pub?)`, `activeT1(pub)` | Fresh from storage, newest first |
| `inFlightInputs(pub?)` → `Set` | Box ids spent by open entries: coin selection must skip them |
| `claimTimestamp(scope, candidateMs)` → ms | Strictly increasing per scope, across reloads and tabs: max(last + 1, candidate). It is stored before use |
| `lastTimestamp(scope)` | The last claim, or null |
| `rewindTimestamp(scope, refusedMs, toMs)` → boolean | After the server refused that very claim for its clock window (a build request more than 120 s off): the last claim becomes `toMs`. Nothing changes when a later claim was made, or `toMs` is not lower |
| `getSnapshot()`, `subscribe(fn)`, `reload()` | For React: all entries, newest first. Other tabs' changes arrive by themselves |

Scopes: `buildScope(receiver)` for redemption build requests (`claimTimestamp(buildScope(me), serverNow)`), and
`noteScope(issuer, recipient)` for notes (`claimTimestamp(noteScope(me, to), max(pairTs + 1, serverNow − 2000))`,
design §6.6).

**States:** `signed`, `sent`, `mempool`, `confirmed` (these four are open: `OPEN_STATES`), then `final`, `failed`,
`abandoned`.

| From | Allowed next |
| --- | --- |
| `signed` | `sent`, `mempool`, `confirmed`, `final`, `failed` (and `abandoned` through `abandon()`) |
| `sent`, `mempool`, `confirmed` | each other (a drop from the mempool, a reorg), `final`, `failed` |
| `final` | `sent`, `mempool`, `confirmed` (a reorg deeper than 2 blocks; flows/track.ts checks again until depth 10) |
| `failed` | `mempool`, `confirmed`, `final` (the chain has the last word: a failed entry that was sent is still looked for, flows/track.ts) |
| `abandoned` | nothing |

**One reserve per key:**
- At most one T1 per key that is not failed, abandoned or retired. The rule is atomic across tabs and throws
  `t1-exists` with `detail.id` and `detail.state`.
- It is stricter than the design's "while unresolved", on purpose. A second reserve is quarantined, and every new note
  is refused until a 60-day refund (§8.3).
- The flow's precheck (tracker, mempool) still runs before a T1.
- Mark a T1 `failed` only when the chain proves it can never confirm.

**Limits:**

| Field | Limit |
| --- | --- |
| `signedRaw`, `unsignedRaw` | JSON text up to 64 KiB. A `redeem` keeps `unsignedRaw` (the submit echoes it byte for byte) |
| `txId` | 64 hex for every transaction kind (`t1`, `redeem`, `withdraw`, `topup`, `refund-start`, `refund-end`); null for `note`. It must equal the id inside `signedRaw` |
| `inputs` | 1–256 unique lowercase 64-hex box ids for transactions; none for a note |
| `meta` | Up to 32 flat fields, named `/^[A-Za-z][A-Za-z0-9_]{0,31}$/`. Values: strings (≤ 2048), finite numbers, booleans or null. Amounts go in as decimal strings |

A redemption build older than 30 minutes is dropped and built again (§4.5). Compare `createdAt` yourself.

## Tabs

- **The signer lock:** `create`, `restoreFromBackup`, `importHex` and `unlock` take the Web Lock `basis-mainnet-sign`,
  and the session keeps it until it locks.
- **A second tab:**
  - It gets `locked-elsewhere`.
  - `signingElsewhere()` → boolean tells it before it asks for the passphrase ("Signing is open in another tab", §4.2).
  - `{ takeOver: true }` takes the lock; the other tab locks at once with `lockReason: "taken-over"`.
- **Without Web Locks:** the vault is `unsupported`. It fails closed, so two tabs never sign.
- **Sync between tabs:** BroadcastChannel `basis-mainnet-vault`. Key changes (create, backup, wipe) and journal
  changes in one tab show up in the others.

## Auto-lock

`attachAutoLock(vault, dom?, throttleMs = 1000)` → `stop()` forwards DOM events to the vault, and the vault keeps the
clock.
- **Activity** (`pointerdown`, `keydown`, `wheel`, `touchstart`) pushes the 10-minute idle deadline back.
- **A hidden tab** locks after 2 minutes.
- **`pagehide` and `freeze`** lock at once.
- **Late timers** (background tabs, a sleeping laptop) never leave the key usable, because every use checks the clock
  first.
- **`expiresAt()`** gives a countdown (ms since 1970, or null). `touch()` and `setHidden(h)` are what the wiring calls.
- **Times:** `openVault({ idleLockMs, hiddenLockMs })` changes them (tests). The defaults are `VAULT.IDLE_LOCK_MS` and
  `VAULT.HIDDEN_LOCK_MS`.

## persist()

`create`, `restoreFromBackup` and `importHex` ask `navigator.storage.persist()` first, while the click is fresh. The
answer goes in the result and in `state.persisted`. With `false` or `null`, the browser may clear the key with the site
data: that is why the verified backup comes first (§4.5, §6.7). `requestPersistence()` asks again (call it from a
click).

## Formats

IndexedDB `basis-mainnet` v1 has three stores:
- `vault`: record `key-v1`;
- `journal`: key = entry id;
- `meta`: `ts|<scope>` → `{ last, at }`.

Each call runs as one transaction over the three stores.

**Key record:**
```
{ format: "basis-mainnet-key", v: 1, network: "mainnet", pub, address,
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: 600000, salt },        // salt: base64, 16 bytes
  cipher: { name: "AES-GCM", iv, tagLength: 128, aad: "basis-mainnet-key/v1|<pub>" },  // iv: base64, 12 bytes
  ct, createdAt, backedUpAt, source }                                       // ct: base64, 32 + 16 bytes
```

The record is checked against itself: the address and the additional data must name its `pub`. A record below the work
factor is `damaged`.

**Backup file:**
```
{ format: "basis-mainnet-key-backup", v: 1, network: "mainnet", pub, address, kdf, cipher, ct,
  createdAt /* ISO */, howToDecrypt,
  extras?: { cipher: { name: "AES-GCM", iv, tagLength: 128, aad: "basis-mainnet-key-backup/v1|<pub>|extras" }, ct } }
```

- **Encryption:** the same salt and work factor as the record, a fresh IV, and additional data
  `basis-mainnet-key-backup/v1|<pub>`.
- **`howToDecrypt`:** the recipe, so any PBKDF2 and AES-GCM tool can recover the key without this site. A test
  decrypts with the recipe alone.
- **Filename:** `basis-mainnet-key-<pub[2..10]>-<YYYY-MM-DD>.json`; at most 256 KiB.
- **What is refused:** a sandbox backup, another network, and a work factor below 600 000.
- **`extras`:** the watched issuers and contacts (`{ watchedIssuers?, contacts?: { pub, name? }[] }`).
  - They are sealed, so a found file shows nobody's counterparties. They are the JSON (UTF-8) under the same key as
    `ct`, with their own IV and the additional data above: `howToDecrypt` works for them with `extras.cipher` and
    `extras.ct`.
  - At most 100 issuers, 200 contacts and 64-character names; the plaintext is at most 128 KiB.
  - After decryption, bad entries are dropped and the lists are cut to the limits.
  - Restore returns them as untrusted input, so show them before using them.
  - Extras that do not decrypt or parse (changed bytes, another format) give `extrasUnreadable: true`, and the key
    still restores. `parseBackup` gives `extras: null` for an envelope it cannot read.

## Errors

Every error is a `VaultError`: `{ name: "VaultError", code, message, detail }`. Test it with `isVaultError(e, code?)`.
- `message` is a fixed developer sentence. The UI shows its own text for `code`.
- `detail` holds only ids, state names, feature names and DOMException names.
- No error ever holds the secret, the passphrase or a file's contents.

| Code | Meaning |
| --- | --- |
| `unsupported` | IndexedDB, WebCrypto or Web Locks is missing (`detail.missing`), or the vault was closed |
| `storage-failed` | An IndexedDB request failed. `detail.reason` is the DOMException name (`QuotaExceededError` …), or `early-commit` or `closed` |
| `no-key` | No key in this browser |
| `exists` | Another key is here already: wipe it first (after its backup) |
| `damaged` | The stored record is unreadable. Offer a restore from the file after `wipe({ confirmUnbacked })` |
| `weak-passphrase` | Fewer than 12 characters after NFKC |
| `wrong-passphrase` | A wrong passphrase, or changed encrypted data (AES-GCM cannot tell them apart) |
| `passphrase-required` | A use that needs `passphrase` without it (`detail.reason`: `export-hex`, `t1`, `withdraw`, `note`, `withdraw-foreign`, `note-over-quarter`, `note-no-reserve`) |
| `bad-backup` | Not a well-formed mainnet key backup (a sandbox file included), or its secret does not match its `pub` |
| `backup-other-key` | The file holds another key than this browser's |
| `invalid-hex`, `out-of-range` | Not 64 hex characters, or not in [1, n − 1] |
| `tracker-key-refused` | ErgoScan's tracker key (see below) |
| `sandbox-key-refused` | This browser's sandbox key: `importHex` never takes it (keys review P2-7) |
| `locked` | The session is locked (or locked itself meanwhile) |
| `locked-elsewhere` | Another tab holds the signer (`takeOver` takes it) |
| `not-backed-up` | No verified backup yet: nothing is signed, and a wipe needs `confirmUnbacked` |
| `async-callback` | The secret callback returned a promise |
| `secret-in-output` | The secret callback returned or threw the secret, or something that could not be checked |
| `bad-input` | A malformed argument or journal entry |
| `t1-exists` | This key already has a reserve creation in the journal (`detail.id`, `detail.state`) |
| `not-found`, `bad-transition` | No such journal entry, or a state change that is not allowed |
| `journal-unresolved` | `wipe({ journal: true })` while some entries of the key are open |

### The tracker key

`create`, `restoreFromBackup`, `importHex` and `unlock` refuse a key whose compressed public key is ErgoScan's tracker
key `02f17d2d…b99b5fc8`. That is `TRACKER_PUBLIC_KEY`, the same as `OUR_TRACKER.key` in `src/chain/ours/types.ts`. They
also refuse its negation, the same x with the other parity, because its secret is n minus the tracker's.
- **Why:** it is the server's signing key and pays the commit fees, so it never lives in a browser.
- **How:** only public keys are compared, never a secret.
- **When:** a file that names the tracker's key is refused before any derivation; a decrypted or typed secret is refused
  after its public key is derived and before anything is stored.

Suggested texts for `tracker-key-refused`:
- RU: «Это ключ трекера ErgoScan. Он живёт только на сервере; на сайте его использовать нельзя.»
- EN: "This is ErgoScan's tracker key. It lives only on the server and cannot be used on this site."

## Security notes

- **The secret in memory:** it exists only while an operation needs it, as a `Uint8Array` that is wiped right after:
  - a `withSecret` callback;
  - the checks and re-encryptions inside create, unlock, export, verify, restore and import.

  The design allows keeping it while unlocked (§4.2); this vault keeps only the non-extractable AES key and the
  ciphertext instead.
- **What the vault never does:** log anything, touch the console, or put the secret in state, errors, JSON
  (`JSON.stringify(vault)` gives `{ type, status, pub }`), `String(vault)`, Node's inspect, storage, channel messages
  or the journal. The leak test checks all of these after a full session.
- **`unsafeTestKdfIterations`** (tests only) is refused in a production build.
- **The scan is a second line.** The first line is code that signs inside the callback and returns only signatures or
  signed transactions.

## Tests

- **Run:** `BASIS_APP=/root/basis/app-wt/vault scripts/check.sh test src/mainnet`.
- **Doubles:** `__tests__/fakes.ts` holds them, because the repo has no `fake-indexeddb`, jsdom or happy-dom:
  - **IndexedDB:** it is strict about the browser's rule. A transaction ends when its callback awaits anything but its
    own requests.
  - **Others:** Web Locks (ifAvailable, steal, query), BroadcastChannel, a manual clock and a StorageManager.
  - **WebCrypto:** Node's real one.
- **For flow tests:**
  `openVault({ env: new FakeBrowser().env("tab-a"), unsafeTestKdfIterations: TEST_ITERATIONS })`. Several `env()`
  calls on one `FakeBrowser` are tabs of one profile.

## Notes

- **Imports:** in a worktree, the Vite alias `@` points at the main tree (`/root/basis/app/src`), while tsc maps it to
  the worktree. Import this folder with relative paths.
- **Exports:** `index.ts` exports the public API and `VAULT` (the constants).
