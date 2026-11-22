// Wallet hooks: viewer preferences, number formatting (VISUAL §4.3), names, outcome toasts and the one model
// read per frame. Preferences are per-viewer conveniences in localStorage (every access guarded).
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type RefObject } from "react";
import { useT } from "@/app/lang";
import type { DenomId } from "@/protocol";
import { blk, humanTime, int, MINUS, NBSP, pct as pctFmt, toast, units, useMedia, useUiSettings } from "@/ui";
import { castName, town, useTownView, useWallet, worldText, YOU, type AnyOutcome, type Toast as WorldToast } from "@/world";
import { walletModel, type Unit, type WalletModel } from "./model";

// ---------------------------------------------------------------------------------------------
// preferences (per viewer)
// ---------------------------------------------------------------------------------------------

export interface WalletPrefs {
  /** Amounts: 2 decimals (VISUAL) or every decimal of the unit. */
  amounts: "2dp" | "exact";
  /** Durations: blocks first (VISUAL) or time first. */
  durations: "blocks" | "time";
  /** Notes list order. */
  sort: "amount" | "recent";
  /** Denomination of the balance sheet. */
  denom: DenomId;
  tourDone: boolean;
  backupSkipped: boolean;
}

const PREFS_KEY = "basis.wallet.prefs.v1";
const DEFAULTS: WalletPrefs = { amounts: "2dp", durations: "blocks", sort: "amount", denom: "erg", tourDone: false, backupSkipped: false };

function readPrefs(): WalletPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<WalletPrefs>) };
  } catch {
    /* storage blocked: defaults */
  }
  return { ...DEFAULTS };
}

let prefs: WalletPrefs = typeof window === "undefined" ? { ...DEFAULTS } : readPrefs();
const subs = new Set<() => void>();

export function setPrefs(patch: Partial<WalletPrefs>): void {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the setting lasts for this page only */
  }
  for (const f of [...subs]) f();
}

export function usePrefs(): WalletPrefs {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => prefs,
    () => prefs,
  );
}

// ---------------------------------------------------------------------------------------------
// layout
// ---------------------------------------------------------------------------------------------

/** One column (phone and narrow tablets): flows become full pages. */
export const useNarrow = () => useMedia("(max-width: 1000px)");

// ---------------------------------------------------------------------------------------------
// names
// ---------------------------------------------------------------------------------------------

/** Display name of a town participant: your own name for You, the cast name (localised) for residents. */
export function useNameOf(): (id: string) => string {
  const { identity } = useWallet();
  const t = useT();
  return useCallback(
    (id: string) => {
      if (id === YOU) {
        // "You" is the identity's default name (nothing typed): show it in the page language
        const own = identity?.name?.trim();
        return (own && own !== "You" ? own : castName(YOU, t.lang)) || "You";
      }
      return castName(id, t.lang) ?? town.economy?.participants.get(id)?.name ?? id;
    },
    [identity?.name, t.lang],
  );
}

const painted = [true, false, false];
/** False for the first frame(s) of the first heavy page view, then true (and true at once on later mounts).
 *  Stage 1 waits one painted frame, stage 2 one more, so a cold load splits into short tasks. */
export function useAfterFirstPaint(stage: 1 | 2 = 1): boolean {
  const [ok, setOk] = useState(painted[stage]);
  useEffect(() => {
    if (ok) return;
    let frame = 0;
    let timer = 0;
    let left = stage;
    const step = () => {
      frame = requestAnimationFrame(() => {
        timer = window.setTimeout(() => {
          left -= 1;
          if (left > 0) return step();
          for (let k = 1; k <= stage; k++) painted[k] = true;
          setOk(true);
        }, 0);
      });
    };
    step();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [ok, stage]);
  return ok;
}

/** After an action the result replaces a long form: show its top (the right column scrolls itself; a phone page
 *  scrolls the window when the result starts above the header). */
export function useRevealOnMount(ref: RefObject<HTMLElement | null>, ready: boolean): void {
  useEffect(() => {
    const el = ref.current;
    if (!el || !ready) return;
    const col = el.closest(".wl-col-r");
    if (col) col.scrollTop = 0;
    else if (el.getBoundingClientRect().top < 64) el.scrollIntoView({ block: "start", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [ref, ready]);
}

/** Display name for a public key or a participant id (TxLens and X-ray captions); undefined when unknown. */
export function useNameOfPub(): (pubOrId: string) => string | undefined {
  const nameOf = useNameOf();
  return useCallback(
    (x: string) => {
      const eco = town.economy;
      if (!eco) return undefined;
      const id = eco.participants.has(x) ? x : eco.idOf(x);
      return id ? nameOf(id) : undefined;
    },
    [nameOf],
  );
}

/** worldText in the current language, with your name for "@you". */
export function useWT() {
  const t = useT();
  const nameOf = useNameOf();
  return useCallback(
    (key: string, params?: Record<string, string | number>) =>
      worldText(key, params && groupBig(params), t.lang, { name: (id) => (id === YOU ? nameOf(YOU) : undefined) }),
    [t.lang, nameOf],
  );
}

/** World toasts pass heights and block counts as bare digits ("1643257"); print them grouped (VISUAL §4.3). */
function groupBig(params: Record<string, string | number>): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(params)) out[k] = (typeof v === "number" && Number.isInteger(v) && Math.abs(v) >= 10_000) || (typeof v === "string" && /^\d{5,9}$/.test(v)) ? int(Number(v)) : v;
  return out;
}

/** Shows an outcome's toast (VISUAL §12.10); refusals also come back to the caller to explain in place. */
export function useOutcomeToast() {
  const wt = useWT();
  const t = useT();
  return useCallback(
    (o: AnyOutcome | { toast: WorldToast }, extra?: { quiet?: boolean }) => {
      if (extra?.quiet) return;
      const x = o.toast;
      const ru = (s: string) => (t.lang === "ru" ? s.replace(/(\d)\.(\d)/g, "$1,$2") : s);
      toast({ kind: x.kind, title: ru(wt(x.titleKey, x.params)), detail: x.detailKey ? ru(wt(x.detailKey, x.params)) : undefined, ttl: x.sticky ? 0 : undefined });
    },
    [wt, t.lang],
  );
}

// ---------------------------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------------------------

export interface Fmt {
  lang: "en" | "ru";
  priv: boolean;
  dpOf: (u: Unit) => number;
  /** "1 240.00" (no sign), privacy aware. */
  amt: (v: bigint, u: Unit, o?: { sign?: "favour" | "owe" | "auto" | "none"; unit?: boolean; dp?: number; reveal?: boolean }) => string;
  /** The same inside a sentence: RU uses a decimal comma in prose. */
  prose: (s: string) => string;
  /** "37 blk · ≈ 1 h 14 min" (or time first). */
  dur: (blocks: number) => string;
  blocks: (n: number) => string;
  /** A block height ("1 921 400"), no unit. */
  height: (n: number) => string;
  pct: (ratio: number | null) => string;
}

export function useFmt(): Fmt {
  const t = useT();
  const ui = useUiSettings();
  const p = usePrefs();
  return useMemo(() => {
    const lang = t.lang;
    const dpOf = (u: Unit) => (p.amounts === "exact" ? u.decimals : Math.min(2, u.decimals));
    const amt: Fmt["amt"] = (v, u, o = {}) => {
      if (ui.privacy && !o.reveal) return "•••";
      const abs = units(v < 0n ? -v : v, u.decimals, o.dp ?? dpOf(u), lang);
      const s = o.sign ?? "auto";
      const sign = v === 0n ? "" : s === "favour" ? "+" : s === "owe" ? MINUS : s === "auto" && v < 0n ? MINUS : "";
      return `${sign}${abs}${o.unit ? NBSP + u.symbol : ""}`;
    };
    const prose = (s: string) => (lang === "ru" ? s.replace(/(\d)\.(\d)/g, "$1,$2") : s);
    const dur = (n: number) => (p.durations === "time" ? `${humanTime(n, lang)} · ${blk(n, lang)}` : `${blk(n, lang)} · ${humanTime(n, lang)}`);
    const pct = (r: number | null) => (r === null || !Number.isFinite(r) ? "—" : pctFmt(r * 100 < 1 && r > 0 ? Math.round(r * 1000) / 10 : Math.round(r * 100), lang));
    return { lang, priv: ui.privacy, dpOf, amt, prose, dur, blocks: (n: number) => blk(n, lang), height: (n: number) => int(n, lang), pct };
  }, [t.lang, ui.privacy, p.amounts, p.durations]);
}

// ---------------------------------------------------------------------------------------------
// the model
// ---------------------------------------------------------------------------------------------

export function useWalletModel(denom: DenomId): WalletModel | null {
  return useTownView((eco) => walletModel(eco, denom), [denom]);
}

/** Gendered key lookup: `${key}.${g}` (RU forms) falls back to `key`. */
export function useTg() {
  const t = useT();
  return useCallback((key: string, g: string | undefined, vars?: Record<string, string | number>) => (g && t.has(`${key}.${g}`) && t.lang === "ru" ? t(`${key}.${g}`, vars) : t(key, vars)), [t]);
}
