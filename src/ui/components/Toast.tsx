// Toasts (VISUAL §12.10): 360–420 wide, a 3 px material edge, a 34 px icon tile, title, detail and relative time.
// At most 3 stacked, newest on top, 4 s each; alarm toasts stay until dismissed and only one alarm is shown at a time.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { Icon, type IconName } from "./Icon";
import { Lamp } from "./primitives";

export type ToastKind = "proof" | "up" | "metal" | "alarm" | "info";
export interface ToastInput {
  kind?: ToastKind;
  title: ReactNode;
  detail?: ReactNode;
  /** Detail in mono (digests, tx ids). */
  mono?: boolean;
  icon?: IconName;
  /** ms; default 4000, alarm 0 (sticky). */
  ttl?: number;
  /** Optional action rendered under the text. */
  action?: { label: ReactNode; onClick: () => void };
}
export interface ToastItem extends ToastInput { id: number; at: number; kind: ToastKind }

let items: ToastItem[] = [];
let seq = 0;
const subs = new Set<() => void>();
const emit = () => { for (const f of [...subs]) f(); };
const timers = new Map<number, ReturnType<typeof setTimeout>>();

/** Show a toast; returns its id. */
export function toast(t: ToastInput | string): number {
  const input: ToastInput = typeof t === "string" ? { title: t } : t;
  const kind = input.kind ?? "info";
  const id = ++seq;
  let next = items;
  if (kind === "alarm") next = next.filter((x) => x.kind !== "alarm"); // one alarm toast per view
  next = [{ ...input, kind, id, at: Date.now() }, ...next];
  for (const x of next.slice(3)) clear(x.id);
  items = next.slice(0, 3);
  const ttl = input.ttl ?? (kind === "alarm" ? 0 : 4000);
  if (ttl > 0) arm(id, ttl);
  emit();
  return id;
}
function arm(id: number, ms: number) {
  clear(id);
  timers.set(id, setTimeout(() => dismissToast(id), ms));
}
function clear(id: number) {
  const tm = timers.get(id);
  if (tm) clearTimeout(tm);
  timers.delete(id);
}
/** Remove a toast by id. */
export function dismissToast(id: number) {
  clear(id);
  const n = items.filter((x) => x.id !== id);
  if (n.length !== items.length) { items = n; emit(); }
}
toast.dismiss = dismissToast;
toast.proof = (title: ReactNode, detail?: ReactNode) => toast({ kind: "proof", title, detail, mono: true });
toast.up = (title: ReactNode, detail?: ReactNode) => toast({ kind: "up", title, detail });
toast.metal = (title: ReactNode, detail?: ReactNode) => toast({ kind: "metal", title, detail });
toast.alarm = (title: ReactNode, detail?: ReactNode) => toast({ kind: "alarm", title, detail });

const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useToasts = () => useSyncExternalStore(subscribe, () => items, () => items);

const ICON_OF: Record<ToastKind, IconName> = { proof: "stamp", up: "in", metal: "coin", alarm: "warn", info: "info" };
const COLOR_OF: Record<ToastKind, string> = { proof: "var(--ink)", up: "var(--up)", metal: "var(--metal-ink)", alarm: "var(--alarm)", info: "var(--ink-2)" };

function useAgo(at: number): string {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const i = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(i); }, []);
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 2) return t("ui.time.now");
  if (s < 60) return t("ui.time.s", { n: s });
  return t("ui.time.m", { n: Math.floor(s / 60) });
}

export interface ToastViewProps extends ToastInput { onClose?: () => void; time?: string; at?: number }

/** One toast, presentational (the kit shows it statically; the Toaster renders the live stack). */
export function Toast({ kind = "info", title, detail, mono, icon, onClose, time, at, action }: ToastViewProps) {
  const t = useT();
  return (
    <div className={`toast ${kind}`} role={kind === "alarm" ? "alert" : "status"}>
      <span className="ic" style={{ color: COLOR_OF[kind] }}>
        {kind === "proof" && !icon ? <Lamp state="committed" size={14} /> : <Icon name={icon ?? ICON_OF[kind]} />}
      </span>
      <div style={{ minWidth: 0 }}>
        <b>{title}</b>
        {detail != null && <span className={mono ? "mono" : undefined}>{detail}</span>}
        {action && <div style={{ marginTop: 8 }}><button className="key sm" onClick={action.onClick}>{action.label}</button></div>}
      </div>
      <span className="tr">
        {time != null ? <span className="t">{time}</span> : at != null ? <AgoStamp at={at} /> : null}
        {onClose && <button className="x" onClick={onClose} aria-label={t("ui.close")}>×</button>}
      </span>
    </div>
  );
}
function AgoStamp({ at }: { at: number }) {
  return <span className="t">{useAgo(at)}</span>;
}

/** Mount once (the shell does): the live toast stack, bottom right (above the tab bar on phone). */
export function Toaster() {
  const list = useToasts();
  const hover = useRef(false);
  return (
    <div
      className="toasts"
      aria-live="polite"
      onMouseEnter={() => { hover.current = true; for (const x of list) clear(x.id); }}
      onMouseLeave={() => { hover.current = false; for (const x of list) if (x.kind !== "alarm" && (x.ttl ?? 4000) > 0) arm(x.id, 2000); }}
    >
      {list.map((x) => <Toast key={x.id} {...x} at={x.at} onClose={() => dismissToast(x.id)} />)}
    </div>
  );
}
