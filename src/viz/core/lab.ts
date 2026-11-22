// Sandbox identities for the X-rays and tools: keys derived from public names (never for real value) and a
// sandbox tracker NFT id. One place so the sign lab, the tools and the showcase agree.

import { blake2b256, bytesToHex, demoKeyPair, utf8, type KeyPair } from "@/protocol";

export const LAB_NAMES = ["Alice", "Bob", "Carol", "Dave"] as const;
export type LabName = (typeof LAB_NAMES)[number];
export const LAB_SALT = "basis-viz-lab";
/** A sandbox tracker NFT id: blake2b256("basis-viz-lab/tracker-nft"). */
export const LAB_TRACKER_NFT = bytesToHex(blake2b256(utf8("basis-viz-lab/tracker-nft")));
/** 2026-01-01 00:00:00 UTC. */
export const LAB_DEFAULT_TS = 1_767_225_600_000n;

const cache = new Map<string, KeyPair>();
export function labKey(name: string): KeyPair {
  let k = cache.get(name);
  if (!k) {
    k = demoKeyPair(name, LAB_SALT);
    cache.set(name, k);
  }
  return k;
}

/** Sandbox name of a public key, if it is one of the lab keys. */
export function labNameOf(pubHex: string): LabName | undefined {
  const h = pubHex.toLowerCase();
  return LAB_NAMES.find((n) => labKey(n).pubHex === h);
}
