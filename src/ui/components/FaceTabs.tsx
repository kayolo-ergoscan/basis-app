// Two faces (VISUAL §12.1): the Story face (human words) and the Machine face (bytes, registers, signatures).
// One global lens for the whole app; the shell toggles it with the M key. Components read it with useLens().
import { useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { Tabs } from "./primitives";

export type Lens = "human" | "machine";
const KEY = "basis.lens";
let lens: Lens = (() => { try { return localStorage.getItem(KEY) === "machine" ? "machine" : "human"; } catch { return "human"; } })();
const subs = new Set<() => void>();
export function setLens(l: Lens) {
  lens = l;
  try { localStorage.setItem(KEY, l); } catch { /* ignore */ }
  for (const f of [...subs]) f();
}
export const toggleLens = () => setLens(lens === "human" ? "machine" : "human");
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
/** React: [lens, setLens]. */
export function useLens(): [Lens, (l: Lens) => void] {
  return [useSyncExternalStore(subscribe, () => lens, () => lens), setLens];
}

export interface FaceTabsProps {
  /** Controlled value; defaults to the global lens. */
  value?: Lens;
  onChange?: (l: Lens) => void;
  labels?: { human?: ReactNode; machine?: ReactNode };
  idBase?: string;
}
/** Story / Machine tabs (mono). Press M anywhere to flip. */
export function FaceTabs({ value, onChange, labels, idBase }: FaceTabsProps) {
  const t = useT();
  const [g, setG] = useLens();
  const v = value ?? g;
  return (
    <Tabs<Lens> mono ariaLabel={t("ui.face.aria")} idBase={idBase} value={v} onChange={onChange ?? setG}
      tabs={[{ id: "human", label: labels?.human ?? t("ui.face.human") }, { id: "machine", label: labels?.machine ?? t("ui.face.machine") }]} />
  );
}

/** Renders `human` or `machine` by the lens. */
export function Faces({ human, machine, value }: { human: ReactNode; machine: ReactNode; value?: Lens }) {
  const [g] = useLens();
  return <>{(value ?? g) === "machine" ? machine : human}</>;
}
