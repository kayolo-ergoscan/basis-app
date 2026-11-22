// Number, hex and time formatting for the protocol X-rays (VISUAL §4.3), built on the kit's money helpers
// (src/ui/engine/money.ts): numbers in the page language (RU "1 240,00", EN "1,240.00"), minus U+2212, units after
// U+00A0, blocks first.
// The one addition: an X-ray never rounds a number it compares, so amounts get as many decimals as they need.
// Pure functions: no DOM, usable in tests.

import type { DenominationInfo } from "@/protocol";
import { blk, blocksAndTime, groupDigits as kitGroup, humanTime, int as kitInt, ratioPct, units as kitUnits } from "@/ui/engine/money";

export const THIN = "\u2009\u2060";
export const MINUS = "\u2212";
export const NBSP = "\u00a0";
export const BLOCK_SECONDS = 120;

export type VizLang = "en" | "ru";

/** "1240000" → "1,240,000" (EN) / "1 240 000" (RU, thin non-breaking separators). */
export function groupDigits(s: string): string {
  return kitGroup(s);
}

export function fmtInt(n: number | bigint): string {
  return typeof n === "bigint" ? kitUnits(n, 0, 0) : kitInt(Math.trunc(n));
}

/**
 * Exact decimal rendering of integer units: at least `minDp` decimals (UI: 2), more only when the value
 * needs them, at most `maxDp` when given (then rounded half-up by the kit's units()).
 */
export function fmtUnits(v: bigint, decimals: number, opts: { minDp?: number; maxDp?: number; plus?: boolean } = {}): string {
  const x = v < 0n ? -v : v;
  const frac = decimals > 0 ? (x % 10n ** BigInt(decimals)).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  const minDp = Math.min(opts.minDp ?? 2, decimals);
  let dp = Math.max(minDp, frac.length);
  if (opts.maxDp !== undefined) dp = Math.min(dp, Math.max(opts.maxDp, minDp));
  return (opts.plus && v > 0n ? "+" : "") + kitUnits(v, decimals, dp);
}

/** nanoERG → "1.50 ERG". */
export function fmtErg(nano: bigint, opts: { minDp?: number; maxDp?: number; plus?: boolean; unit?: boolean } = {}): string {
  const s = fmtUnits(nano, 9, opts);
  return opts.unit === false ? s : `${s}${NBSP}ERG`;
}

export interface UnitInfo {
  symbol: string;
  decimals: number;
}

export const ERG_UNIT: UnitInfo = { symbol: "ERG", decimals: 9 };

export function unitOf(denom?: DenominationInfo | UnitInfo | null): UnitInfo {
  if (!denom) return ERG_UNIT;
  return { symbol: denom.symbol, decimals: denom.decimals };
}

/** Raw units of a denomination → "1.50 ERG" / "12.00 sUSE". */
export function fmtAmount(v: bigint, unit: UnitInfo = ERG_UNIT, opts: { minDp?: number; maxDp?: number; plus?: boolean; unit?: boolean } = {}): string {
  const s = fmtUnits(v, unit.decimals, { minDp: unit.decimals === 0 ? 0 : opts.minDp, maxDp: opts.maxDp, plus: opts.plus });
  return opts.unit === false ? s : `${s}${NBSP}${unit.symbol}`;
}

/** Raw integer with its base unit, for the machine face: "1 500 000 000 nanoERG". */
export function fmtRaw(v: bigint, unit: UnitInfo = ERG_UNIT): string {
  const name = unit.symbol === "ERG" && unit.decimals === 9 ? "nanoERG" : unit.decimals === 0 ? unit.symbol : `${unit.symbol} units`;
  return `${fmtInt(v)}${NBSP}${name}`;
}

export function fmtPercent(ratio: number): string {
  return ratioPct(ratio);
}

// ---------- blocks and time ----------

export function fmtBlocks(n: number, lang: VizLang = "en"): string {
  return blk(n, lang);
}

/** Human time of a block count, 120 s each, with its "≈": "≈ 1 h 14 min", "≈ 3 days", "≈ 60 days". */
export function fmtDuration(blocks: number, lang: VizLang = "en"): string {
  return humanTime(Math.abs(blocks), lang);
}

/** "37 blk · ≈ 1 h 14 min" — blocks first, then human time (VISUAL §4.3). */
export function fmtBlocksTime(blocks: number, lang: VizLang = "en"): string {
  return blocksAndTime(blocks, lang);
}

/** Milliseconds since epoch → "2026-01-01 00:24:00 UTC" (fixed format, locale-free, deterministic). */
export function fmtTimestamp(ms: bigint | number, opts: { seconds?: boolean } = {}): string {
  const n = typeof ms === "bigint" ? Number(ms) : ms;
  if (!Number.isFinite(n) || Math.abs(n) > 8.64e15) return "—";
  const iso = new Date(n).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, opts.seconds === false ? 16 : 19)}${NBSP}UTC`;
}

export function fmtClock(ms: bigint | number): string {
  const n = typeof ms === "bigint" ? Number(ms) : ms;
  if (!Number.isFinite(n) || Math.abs(n) > 8.64e15) return "—";
  return new Date(n).toISOString().slice(11, 19);
}

// ---------- hex ----------

/** "02d9…60b6": first 4 + … + last 4 hex chars (VISUAL §4.3). */
export function shortHex(hex: string, head = 4, tail = 4): string {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

/** Digest grouped by 4: "9f3c 1a2d 07be …". */
export function groupHex(hex: string, group = 4): string {
  const out: string[] = [];
  for (let i = 0; i < hex.length; i += group) out.push(hex.slice(i, i + group));
  return out.join(" ");
}

export function byteHex(b: number): string {
  return (b & 0xff).toString(16).padStart(2, "0");
}

export function toHexStr(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += byteHex(b[i]);
  return s;
}

export function parseHexInput(s: string): Uint8Array | null {
  const h = s.trim().replace(/^0x/i, "").replace(/[\s:,_-]/g, "");
  if (h.length === 0 || h.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(h)) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesLabel(n: number, lang: VizLang = "en"): string {
  return lang === "ru" ? `${fmtInt(n)}${NBSP}Б` : `${fmtInt(n)}${NBSP}B`;
}
