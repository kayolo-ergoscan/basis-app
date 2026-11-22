// World-level state that is not part of the engine's event log: payment requests, contacts and settings.
// Persisted next to the log (TownMeta.world) and broadcast to follower tabs.
import { erg, type DenomId } from "@/protocol";
import type { PaymentRequest } from "./bots";

export type Speed = "paused" | "realistic" | "fast" | "turbo";
export const SPEEDS: readonly Speed[] = ["paused", "realistic", "fast", "turbo"];
/** Real milliseconds per sandbox block at each speed (paused: no blocks). */
export const SPEED_BLOCK_MS: Record<Speed, number | null> = { paused: null, realistic: 120_000, fast: 2_000, turbo: 200 };
/** While the tab is hidden, the clock slows to at most one block per 30 s. */
export const HIDDEN_BLOCK_MS = 30_000;
export const DEFAULT_SPEED: Speed = "fast";

export interface Contact {
  /** Participant id in the town. */
  id: string;
  label?: string;
  note?: string;
  favorite: boolean;
  addedHeight: number;
}

export interface WorldData {
  v: 1;
  requests: PaymentRequest[];
  contacts: Contact[];
  settings: { speed: Speed };
  nextRequest: number;
}

export const FAUCET_ERG = erg(50);
export const FAUCET_SUSE = 200_000n; // 200.000 sUSE (3 decimals)
/** A refill is allowed once per this many blocks (or any time the wallet holds < 1 ERG). */
export const FAUCET_COOLDOWN_BLOCKS = 360;
export const MAX_REQUESTS = 50;

export function emptyWorld(): WorldData {
  return { v: 1, requests: [], contacts: [], settings: { speed: DEFAULT_SPEED }, nextRequest: 1 };
}

export function worldToJson(w: WorldData): string {
  return JSON.stringify(w, (_k, v) => (typeof v === "bigint" ? { $n: v.toString() } : v));
}

export function worldFromJson(json: string | undefined | null): WorldData {
  if (!json) return emptyWorld();
  try {
    const w = JSON.parse(json, (_k, v) => (v && typeof v === "object" && typeof v.$n === "string" && Object.keys(v).length === 1 ? BigInt(v.$n) : v)) as WorldData;
    if (w?.v !== 1) return emptyWorld();
    const base = emptyWorld();
    return { ...base, ...w, settings: { ...base.settings, ...w.settings }, requests: w.requests ?? [], contacts: w.contacts ?? [] };
  } catch {
    return emptyWorld();
  }
}

export function cloneWorld(w: WorldData): WorldData {
  return worldFromJson(worldToJson(w));
}

export type { DenomId };
