// ⌘K command registry. Static commands come from FeatureRoute.commands; features can add live ones while mounted:
//   useCommands([{ id: "wallet.pay", label: "Pay Bob", run: () => open() }])
import { useEffect, useSyncExternalStore } from "react";
import type { IconName } from "@/ui/components/Icon";

export interface Command {
  id: string;
  /** Visible label (already translated). */
  label: string;
  /** Second line (mono): a path or an id. */
  sub?: string;
  /** Extra search words. */
  keywords?: string;
  group?: "go" | "actions" | "id" | "settings" | "dev";
  icon?: IconName;
  /** Either navigate… */
  to?: string;
  /** …or run. */
  run?: () => void;
  /** Shortcut hint shown at the right ("P"). */
  kbd?: string;
}

let dynamic: Command[] = [];
const subs = new Set<() => void>();
const emit = () => { for (const f of [...subs]) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };

/** React: add commands while the component is mounted (labels must already be translated). */
export function useCommands(cmds: Command[], deps: unknown[] = []) {
  useEffect(() => {
    dynamic = [...dynamic.filter((c) => !cmds.some((x) => x.id === c.id)), ...cmds];
    emit();
    return () => { dynamic = dynamic.filter((c) => !cmds.some((x) => x.id === c.id)); emit(); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
export const useDynamicCommands = () => useSyncExternalStore(subscribe, () => dynamic, () => dynamic);

/** Open the command bar from anywhere. */
let opener: ((q?: string) => void) | null = null;
export const setCommandOpener = (f: ((q?: string) => void) | null) => { opener = f; };
export const openCommandBar = (q?: string) => opener?.(q);

/** Open the shortcuts / display settings sheet from anywhere. */
let helpOpener: (() => void) | null = null;
export const setHelpOpener = (f: (() => void) | null) => { helpOpener = f; };
export const openHelp = () => helpOpener?.();
