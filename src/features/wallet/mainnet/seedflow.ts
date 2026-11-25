// The seed-phrase import of the start screen, without React: list the addresses of the words, find the one the user
// expects, and bring the chosen key into the vault through vault.importHex. The words and the mnemonic password are
// never held here: they are read from the two fields on screen when needed (SeedFields), and those fields are emptied
// once the key is in. What comes back is public (indexes, public keys, addresses).
import { parseKeyInput } from "@/chain/ours";
import { SEED_MAX_INDEX, checkMnemonic, seedFromMnemonic, seedKeys, seedSecret, type MainnetVault, type SeedKey, type SeedProblem } from "@/mainnet/vault";

/** The two fields that hold the words and the mnemonic password (on screen: the DOM, never React state). */
export interface SeedFields {
  words(): string;
  password(): string;
  /** Empties both. */
  clear(): void;
}

export type SeedList = { ok: true; keys: SeedKey[] } | { ok: false; problem: SeedProblem };

/** Reads the fields, checks the words and derives addresses 0 … SEED_MAX_INDEX − 1 (public keys only; the seed is
 *  wiped before this returns). */
export async function listSeedKeys(f: SeedFields): Promise<SeedList> {
  const c = checkMnemonic(f.words());
  if (!c.ok) return { ok: false, problem: problemOf(c) };
  const seed = await seedFromMnemonic(c.phrase, f.password());
  try {
    return { ok: true, keys: seedKeys(seed, 0, SEED_MAX_INDEX) };
  } finally {
    seed.fill(0);
  }
}

const problemOf = (c: SeedProblem): SeedProblem =>
  c.reason === "word" ? { reason: "word", at: c.at } : c.reason === "count" ? { reason: "count", count: c.count } : { reason: c.reason };

export type ExpectedMatch =
  | { k: "empty" }
  | { k: "bad"; reason: "format" | "notP2pk" | "checksum" | "testnet" }
  | { k: "found"; key: SeedKey }
  | { k: "none" };

/** The address (or 66-hex public key) the user expects, looked up among the derived keys. */
export function findExpected(keys: readonly SeedKey[], text: string): ExpectedMatch {
  const p = parseKeyInput(text);
  if (!p.ok) return p.reason === "empty" ? { k: "empty" } : { k: "bad", reason: p.reason };
  const key = keys.find((x) => x.pub === p.key);
  return key ? { k: "found", key } : { k: "none" };
}

/**
 * Derives the chosen key again from the fields (it must still be the one shown: "changed" otherwise) and hands its 32
 * bytes to vault.importHex under the new Basis passphrase; the bytes are wiped whatever happens. Once the key is in,
 * the fields are emptied. The vault never replaces a key already in this browser (it throws "exists").
 */
export async function importSeedKey(
  vault: Pick<MainnetVault, "importHex">,
  f: SeedFields,
  pick: Pick<SeedKey, "index" | "pub">,
  passphrase: string,
): Promise<{ ok: true; alreadyPresent: boolean } | { ok: false; reason: "changed" }> {
  const c = checkMnemonic(f.words());
  if (!c.ok) return { ok: false, reason: "changed" };
  const seed = await seedFromMnemonic(c.phrase, f.password());
  let secret: Uint8Array;
  try {
    if (seedKeys(seed, pick.index, 1)[0].pub !== pick.pub) return { ok: false, reason: "changed" };
    secret = seedSecret(seed, pick.index);
  } finally {
    seed.fill(0);
  }
  try {
    const r = await vault.importHex(secret, passphrase);
    f.clear();
    return { ok: true, alreadyPresent: r.alreadyPresent };
  } finally {
    secret.fill(0);
  }
}
