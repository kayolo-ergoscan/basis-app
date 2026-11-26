# Basis — an independent interface

The web app behind **https://basis.ergoscan.me**. It is an unofficial interface to Basis, the off-chain notes protocol with
on-chain reserves on Ergo by kushti / Better Money Labs. It is made by ErgoScan, not by Better Money Labs.

Basis is an experiment. On Ergo mainnet, use small amounts only.

## What is in it

- **Sandbox.** The whole protocol runs in the browser with real cryptography and play money:
  - secp256k1 Schnorr notes over the real 80-byte message;
  - the real Ergo AVL+ tree (WebAssembly, `avl-wasm/`);
  - the reserve contract evaluated rule by rule;
  - a tracker emulator, scenarios and a time machine.
- **Observatory.** Everything Basis-shaped on Ergo mainnet, read-only: reserves, trackers, redemptions, contracts and
  incidents.
- **Mainnet wallet (beta, since 22 Nov 2026), `/wallet/mainnet`.** It works with the ErgoScan Basis tracker.
  - The key is made in the browser and never leaves it. A passphrase protects it: PBKDF2-SHA256 with 600 000
    iterations derives an AES-256-GCM key, and the encrypted record stays in IndexedDB. You keep an encrypted backup
    file.
  - Every signature needs a hold on the button. Large actions ask for the passphrase again.
  - The tracker builds each redemption. Before signing, the wallet checks the transaction rule by rule and runs the
    pinned reserve contract on it.
  - Not built yet: reserve top-up and refund, token reserves.

## Build and test

Node 20.

```
npm ci
npm test            # vitest
npm run build       # tsc + vite → dist/
npm run dev         # http://127.0.0.1:5173
```

In development, `/v1` (the ErgoScan API) and `/api/tracker` (the tracker) go through Vite's proxy to the ErgoScan
server's local ports. On your own machine, point them at the public site:

```
BASIS_API=https://api.ergoscan.me BASIS_TRACKER=https://basis.ergoscan.me/api/tracker npm run dev
```

`avl-wasm/` is the source of `src/protocol/avl-wasm/avl.wasm`:
- the Rust crate `ergo_avltree_rust` 0.1.1, pinned, behind a small C ABI;
- Rust 1.85.0, target `wasm32-unknown-unknown`;
- rebuild with `avl-wasm/build.sh --test`.

How it was validated against the chain is in `src/protocol/avl-wasm/README.md`.

The scripts in `scripts/` are the ones used on the ErgoScan server (build lock, low priority, release folders). For a
plain build you only need the npm commands above.

## Where things are

| Path | What |
| --- | --- |
| `src/protocol/` | The engine: notes, signatures, AVL+, the reserve contract, scenarios. `PROTOCOL_API.md` documents it. |
| `src/mainnet/` | The mainnet wallet's core:<br>• `vault/`: keys and the passphrase<br>• `tx/`: building and checking transactions<br>• `net/`: tracker and node calls<br>• `flows/`: the flows' logic<br>`vault/` and `tx/` each have a README. |
| `src/features/wallet/mainnet/` | The wallet pages: setup, fund, reserve, pay, receive, redeem, withdraw, activity, settings |
| `src/chain/` | The mainnet observatory (ErgoScan API `/v1`, with a strict request budget) |
| `src/world/`, `src/features/play/` | The sandbox |
| `src/content/` | Long-form EN/RU texts, FAQ, glossary, history |
| `src/ui/` | The design system ("Intaglio"); live at `/kit` |

## Developer circle

`src/content/circle.json` is this site's list at https://basis.ergoscan.me/learn/circle: people and projects that
accept Basis notes for their work. To join:
1. make your button in the mainnet wallet: Receive → "A button for your project";
2. put it in your project's README;
3. open a pull request that adds your entry at the end of the file. Leave out `checked`: it is set at review, once the
   key in your entry matches the key in your README's button.

`src/content/circle.ts` lists the fields and their limits; `src/content/circle.test.ts` checks every entry.

The first entry is ErgoScan itself; its button:

[![Support with a Basis note](https://basis.ergoscan.me/badge.svg)](https://basis.ergoscan.me/wallet/mainnet/pay#to=023316d27ad52bd767e5e97e2ecba3f0dbc2f92095875f918fcaa95ae6711b1207&nft=f5178dc4063042bdf77cd0f4a55d0893d6dbcf0b3d14eb4de25282b2c4e3f29f&name=ErgoScan&memo=ErgoScan)

## Tracker

The tracker the wallet uses is our fork of `BetterMoneyLabs/basis-tracker`, at
https://github.com/kayolo-ergoscan/basis-tracker (branch `ergoscan`).

## Security

The wallet had two independent reviews before release: keys and signing, and transactions and money. Every finding was
fixed and re-reviewed. The site sends a strict Content-Security-Policy: scripts only from the site itself, and no
inline code.

Please report vulnerabilities privately through this repository's Security tab ("Report a vulnerability"), not in a
public issue.

## License

CC0 1.0 Universal, the same as Basis itself (see `LICENSE`). `avl-wasm/` is MIT OR Apache-2.0, as its `Cargo.toml`
says.
