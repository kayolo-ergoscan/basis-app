// What the vault takes from the browser. Tests pass doubles for every field; pages use browserEnv().
import { sandboxPubInBrowser } from "../key-markers";
import type { LockManagerLike } from "./locks";
import type { StorageManagerLike } from "./persist";

export interface ChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  readonly subtle: SubtleCrypto;
}

export interface VaultEnv {
  indexedDB: IDBFactory | null;
  crypto: CryptoLike | null;
  locks: LockManagerLike | null;
  storage: StorageManagerLike | null;
  channel: (name: string) => ChannelLike | null;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  /** The sandbox key's public key in this browser (keys review P2-7: never imported as a mainnet key); optional. */
  sandboxPub?: () => string | null;
}

function tryGet<T>(get: () => T): T | null {
  try {
    return get() ?? null;
  } catch {
    return null; // e.g. SecurityError when site data is blocked
  }
}

export function browserEnv(): VaultEnv {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const idb = tryGet(() => (typeof indexedDB !== "undefined" ? indexedDB : null));
  const c = tryGet(() => globalThis.crypto);
  const locks = tryGet(() => nav?.locks ?? null);
  const storage = tryGet(() => nav?.storage ?? null);
  return {
    indexedDB: idb,
    crypto: c && typeof c.getRandomValues === "function" && c.subtle ? c : null,
    locks: locks && typeof locks.request === "function" ? locks : null,
    storage: storage && typeof storage.persist === "function" ? storage : null,
    channel: (name) => tryGet(() => (typeof BroadcastChannel !== "undefined" ? (new BroadcastChannel(name) as unknown as ChannelLike) : null)),
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    sandboxPub: sandboxPubInBrowser,
  };
}
