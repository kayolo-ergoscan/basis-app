// Three words (VISUAL §8.6): the BIP-39 English words of bits 0–10, 11–21 and 22–32 of blake2b256(pk), most significant
// bit first (33 bits). Read them aloud to check a key over a radio. Words identify; they never prove.
import { wordlist } from "@scure/bip39/wordlists/english";
import { keyHash } from "./seal";

export function threeWordsOfHash(h: Uint8Array): [string, string, string] {
  const w0 = (h[0] << 3) | (h[1] >> 5);
  const w1 = ((h[1] & 0x1f) << 6) | (h[2] >> 2);
  const w2 = ((h[2] & 0x03) << 9) | (h[3] << 1) | (h[4] >> 7);
  return [wordlist[w0], wordlist[w1], wordlist[w2]];
}

/** Three BIP-39 words of blake2b256(pk). pk is hex or bytes. */
export const threeWords = (pk: string | Uint8Array): [string, string, string] => threeWordsOfHash(keyHash(pk));
/** "crane · bloom · harbor" */
export const wordsLine = (pk: string | Uint8Array): string => threeWords(pk).join(" · ");
