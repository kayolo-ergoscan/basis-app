// The mainnet wallet's context: the vault, its state, the journal, the key and the chain height, for every screen.
import { createContext, useContext } from "react";
import type { JournalEntry, MainnetVault, VaultState } from "@/mainnet/vault";

export interface Me { pub: string; address: string; tree: string }

export interface MwContext {
  vault: MainnetVault;
  state: VaultState;
  entries: readonly JournalEntry[];
  me: Me | null;
  height: number | null;
}

export const MwCtx = createContext<MwContext | null>(null);

export function useMw(): MwContext {
  const c = useContext(MwCtx);
  if (!c) throw new Error("useMw() outside the mainnet wallet");
  return c;
}
