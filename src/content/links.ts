// Links for content: on-chain refs go to ergoscan.me through the chain module's explorer table (one place).

import { explorer } from "@/chain/links";
import type { ChainRef } from "./types";

/** The ergoscan.me URL of an on-chain object named in content (history events, mainnet facts). */
export function chainUrl(ref: ChainRef): string {
  return explorer[ref.kind](ref.id);
}

/** A short label for a chain id: first 8 and last 4 hex characters. */
export function chainShort(ref: ChainRef): string {
  return ref.id.length > 16 ? `${ref.id.slice(0, 8)}…${ref.id.slice(-4)}` : ref.id;
}
