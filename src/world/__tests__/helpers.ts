// Test helpers: an in-memory wallet storage and a town on in-memory storage without timers.
import { ERGO_AVL_WASM, setAvlBackend, useAvlBackend, type AvlBackend } from "@/protocol";
import { SandboxWallet, type WalletStorage } from "../identity";
import { MemoryKV, type KV } from "../persist";
import { Town, type TownOptions } from "../town";
import { DEFAULT_TOWN_GENESIS_MS } from "../town/genesis";

export function memWalletStorage(): WalletStorage & { value: string | null } {
  const s = {
    value: null as string | null,
    read: () => s.value,
    write: (v: string) => {
      s.value = v;
    },
    clear: () => {
      s.value = null;
    },
  };
  return s;
}

let wasm: AvlBackend | null = null;
export async function wasmBackend(): Promise<AvlBackend> {
  wasm ??= await useAvlBackend(ERGO_AVL_WASM);
  setAvlBackend(wasm);
  return wasm;
}

/** A town on memory storage: no election, no clock timers, no visibility watching, fixed genesis time. */
export async function testTown(o: Partial<TownOptions> & { kv?: KV; storage?: WalletStorage } = {}): Promise<{ town: Town; kv: KV; storage: WalletStorage }> {
  const avl = await wasmBackend();
  const kv = o.kv ?? new MemoryKV();
  const storage = o.storage ?? memWalletStorage();
  const town = new Town({ kv, tabs: null, wallet: new SandboxWallet(storage), autoClock: false, avl, watchVisibility: false, genesisTimeMs: DEFAULT_TOWN_GENESIS_MS, saveDebounceMs: 5, pulses: false, ...o });
  await town.ready();
  return { town, kv, storage };
}

export const flushTimers = (ms = 0) => new Promise((r) => setTimeout(r, ms));
