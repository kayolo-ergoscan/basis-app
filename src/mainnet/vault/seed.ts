// Import from a seed phrase: the words of an existing Ergo wallet (Nautilus and others, EIP-3) → one of its keys, which
// then goes into the vault like a hex key (vault.importHex). BIP39 (English list, checksum, NFKD, PBKDF2-HMAC-SHA512
// with "mnemonic" + password) → BIP32 private derivation along m/44'/429'/0'/0/i. The vault itself never makes, keeps
// or backs up words: this module only reads them, and keeps nothing.
//
// BIP32 is written here on noble (HMAC-SHA512 and secp256k1, both already used by the app) instead of adding a library:
// only private derivation along one fixed path is needed (no extended-key strings), and the app's node_modules are
// shared with the main tree. Vectors from two other implementations check it (__tests__/seed.test.ts).
// The legacy derivation of node wallets before 1627 (EIP-3) is not supported.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToNumberBE, numberToBytesBE } from "@noble/curves/abstract/utils";
import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { wipe } from "./bytes";
import { VaultError } from "./errors";
import type { Hex } from "./keys";
import { addressOf } from "./record";

/** The word counts BIP39 allows (128–256 bits of entropy). */
export const SEED_WORD_COUNTS: readonly number[] = [12, 15, 18, 21, 24];
/** Address indexes offered and searched: 0 … SEED_MAX_INDEX − 1. */
export const SEED_MAX_INDEX = 50;
/** EIP-3: m / 44' / 429' / account' / 0 / index, account 0. */
export const SEED_PATH = "m/44'/429'/0'/0";

const HARDENED = 0x80000000;
const ACCOUNT_PATH = [44 + HARDENED, 429 + HARDENED, 0 + HARDENED, 0];
const N = secp256k1.CURVE.n;
const WORDS: ReadonlySet<string> = new Set(wordlist);
const MASTER_KEY = utf8ToBytes("Bitcoin seed");

/** Why words are refused: none, a word outside the English list (its number, from 1), a count BIP39 does not allow, or a
 *  checksum that does not match (a wrong word or a wrong order). */
export type SeedProblem = { reason: "empty" } | { reason: "word"; at: number } | { reason: "count"; count: number } | { reason: "checksum" };

/** One address of the phrase. Public only. */
export interface SeedKey {
  index: number;
  pub: Hex;
  address: string;
}

/**
 * The words as BIP39 reads them: NFKD, lower case, one space between words. Extra spaces, tabs, line breaks, no-break
 * and zero-width spaces between or around the words are dropped.
 */
export function normalizeMnemonic(input: string): string {
  if (typeof input !== "string") return "";
  return input.normalize("NFKD").toLowerCase().split(/[\s​-‍⁠]+/u).filter(Boolean).join(" ");
}

/** Checks the words: the English list first (the first unknown word, by number), then the count, then the checksum. */
export function checkMnemonic(input: string): { ok: true; phrase: string; count: number } | ({ ok: false } & SeedProblem) {
  const phrase = normalizeMnemonic(input);
  if (!phrase) return { ok: false, reason: "empty" };
  const words = phrase.split(" ");
  const bad = words.findIndex((w) => !WORDS.has(w));
  if (bad >= 0) return { ok: false, reason: "word", at: bad + 1 };
  if (!SEED_WORD_COUNTS.includes(words.length)) return { ok: false, reason: "count", count: words.length };
  if (!validateMnemonic(phrase, wordlist)) return { ok: false, reason: "checksum" };
  return { ok: true, phrase, count: words.length };
}

/**
 * The 64-byte BIP39 seed of checked words and the optional mnemonic password (taken exactly as typed, NFKD; an empty
 * one is no password). The caller wipes it. Throws "bad-input" for words that do not pass checkMnemonic.
 */
export async function seedFromMnemonic(words: string, password = ""): Promise<Uint8Array> {
  const c = checkMnemonic(words);
  if (!c.ok) throw new VaultError("bad-input", "these words are not a valid BIP39 phrase");
  return mnemonicToSeed(c.phrase, typeof password === "string" ? password : "");
}

interface Node {
  key: Uint8Array;
  chain: Uint8Array;
}

const wipeNode = (n: Node): void => {
  wipe(n.key);
  wipe(n.chain);
};

/** Splits HMAC output into key and chain code (and wipes it); the key must be in [1, n − 1]. */
function nodeOf(i: Uint8Array, key: (il: bigint) => bigint): Node {
  try {
    const il = bytesToNumberBE(i.subarray(0, 32));
    // BIP32: such an index is skipped; the chance is below 2^-127, so it is refused instead of guessed
    if (il >= N) throw new VaultError("out-of-range", "this derivation step gives no valid key");
    const k = key(il);
    if (k <= 0n || k >= N) throw new VaultError("out-of-range", "this derivation step gives no valid key");
    return { key: numberToBytesBE(k, 32), chain: i.slice(32) };
  } finally {
    wipe(i);
  }
}

function masterNode(seed: Uint8Array): Node {
  if (!(seed instanceof Uint8Array) || seed.length < 16 || seed.length > 64) throw new VaultError("bad-input", "a BIP32 seed has 16 to 64 bytes");
  return nodeOf(hmac(sha512, MASTER_KEY, seed), (il) => il);
}

/** CKDpriv: hardened (index ≥ 2^31) from 0x00 ‖ key, soft from the compressed public key; then ‖ ser32(index). */
function childNode(parent: Node, index: number): Node {
  const data = new Uint8Array(37);
  if (index >= HARDENED) data.set(parent.key, 1);
  else data.set(secp256k1.getPublicKey(parent.key, true), 0);
  new DataView(data.buffer).setUint32(33, index >>> 0, false);
  try {
    const k = bytesToNumberBE(parent.key);
    return nodeOf(hmac(sha512, parent.chain, data), (il) => (il + k) % N);
  } finally {
    wipe(data);
  }
}

/** Any path below the master (numbers, hardened ones with HARDENED added). Exported for the BIP32 vectors only. */
export function deriveSecretAt(seed: Uint8Array, path: readonly number[]): { secret: Uint8Array; chain: Uint8Array } {
  let n = masterNode(seed);
  for (const i of path) {
    if (!Number.isInteger(i) || i < 0 || i > 0xffffffff) {
      wipeNode(n);
      throw new VaultError("bad-input", "a derivation index is a 32-bit number");
    }
    let c: Node;
    try { c = childNode(n, i); } finally { wipeNode(n); }
    n = c;
  }
  return { secret: n.key, chain: n.chain };
}

const checkIndex = (i: number): void => {
  if (!Number.isInteger(i) || i < 0 || i >= SEED_MAX_INDEX) throw new VaultError("bad-input", `an address index is 0 to ${SEED_MAX_INDEX - 1}`);
};

/** The public keys and mainnet addresses at indexes [from, from + count) of m/44'/429'/0'/0. Nothing secret is kept. */
export function seedKeys(seed: Uint8Array, from = 0, count = SEED_MAX_INDEX): SeedKey[] {
  checkIndex(from);
  checkIndex(from + count - 1);
  const acc = deriveSecretAt(seed, ACCOUNT_PATH);
  const node = { key: acc.secret, chain: acc.chain };
  const out: SeedKey[] = [];
  try {
    for (let i = from; i < from + count; i++) {
      const c = childNode(node, i);
      try {
        const pub = bytesToHex(secp256k1.getPublicKey(c.key, true));
        out.push({ index: i, pub, address: addressOf(pub) });
      } finally {
        wipeNode(c);
      }
    }
  } finally {
    wipeNode(node);
  }
  return out;
}

/** The 32-byte secret key at m/44'/429'/0'/0/index. The caller wipes it (vault.importHex takes it as is). */
export function seedSecret(seed: Uint8Array, index: number): Uint8Array {
  checkIndex(index);
  const r = deriveSecretAt(seed, [...ACCOUNT_PATH, index]);
  wipe(r.chain);
  return r.secret;
}
