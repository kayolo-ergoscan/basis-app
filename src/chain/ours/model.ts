// src/chain/ours/model.ts — pure: what the pages show about our tracker, derived from the store's last answers, the
// chain tip and the clock. No network, no React. Every value is null when its source is unknown ("—" on screen).
import { emergencyClock } from "../decode";
import type { DetectorState, EmergencyClock, Hex, Observatory } from "../types";
import { type FeeFunds, OUR_TRACKER, STALE_AFTER_BLOCKS, type OurEvent, type TrackedReserve, type TrackerState } from "./types";
import type { OursState } from "./store";

/**
 *  connecting  — no answer in this session yet and no failure (a saved answer may be shown meanwhile);
 *  live        — /tracker/state answered and the tracker box is at most 750 blocks old (the 720-block heartbeat plus
 *                slack), or the chain height is not known yet;
 *  stale       — answered, but the box is older than that: the tracker has not posted even its heartbeat;
 *  unreachable — the latest /tracker/state request failed (the last good answer stays on screen with its age). A 429
 *                after an answer is not "unreachable": the front only asked this page to wait.
 */
export type OurStatus = "connecting" | "live" | "stale" | "unreachable";

export interface ReserveTotals {
  count: number;
  /** nanoERG in ERG reserves. */
  ergNano: bigint;
  /** Raw units per token id, for token reserves (never added to ERG). */
  tokens: { id: Hex; raw: bigint; count: number }[];
}

export interface OurView {
  status: OurStatus;
  /** When the shown tracker state was answered (ms), and whether it was saved by this browser in an earlier visit. */
  answeredAt: number | null;
  cached: boolean;
  tip: number | null;
  box: Hex | null;
  digest: Hex | null;
  /** The live tree matches the committed digest (null: unknown). */
  inSync: boolean | null;
  /** creationHeight of the tracker box (the emergency clock's start). */
  height: number | null;
  /** Blocks since that height. */
  age: number | null;
  emergency: EmergencyClock | null;
  pending: TrackerState["pending"];
  /** Reserves bound to our tracker (R6 = our NFT), newest first; null until /reserves answered. */
  reserves: TrackedReserve[] | null;
  totals: ReserveTotals | null;
  /** Entries the app could not read, and reserves the tracker reported for another NFT (never shown as ours). */
  skipped: number;
  reservesAt: number | null;
  reservesCached: boolean;
  reservesError: OursState["reservesError"];
  /** Fee money at the tracker address (token-free boxes; each commit's miner fee comes from them); null when not read. */
  fees: FeeFunds | null;
  feesAt: number | null;
  feesCached: boolean;
  events: OurEvent[];
  /** The latest /tracker/state failure (null after an answer). */
  error: OursState["stateError"];
  /** The front answered 429: this page waits before it asks again. */
  limited: boolean;
  backoffUntil: number | null;
}

export const boundToUs = (r: Pick<TrackedReserve, "nft">, nft: Hex = OUR_TRACKER.nft): boolean => r.nft === nft;

export function reserveTotals(list: readonly TrackedReserve[]): ReserveTotals {
  let ergNano = 0n;
  const tokens = new Map<Hex, { raw: bigint; count: number }>();
  for (const r of list) {
    if (!r.token) { ergNano += r.collateral; continue; }
    const x = tokens.get(r.token) ?? { raw: 0n, count: 0 };
    x.raw += r.collateral;
    x.count++;
    tokens.set(r.token, x);
  }
  return { count: list.length, ergNano, tokens: [...tokens.entries()].map(([id, x]) => ({ id, ...x })) };
}

export function statusOf(s: Pick<OursState, "stateError" | "fresh">, age: number | null): OurStatus {
  const e = s.stateError;
  // A 429 only says the front wants fewer requests from this page: after an answer in this session, that answer
  // stands (shown with its age) and the status is judged from it. Any other failure makes the tracker unreachable.
  if (e && !(e.kind === "rate" && s.fresh)) return "unreachable";
  if (!s.fresh) return "connecting";
  if (age !== null && age > STALE_AFTER_BLOCKS) return "stale";
  return "live";
}

/** ErgoScan's own test reserve: its owner key is exactly OUR_TRACKER.testReserveOwner. Keys reach the pages normalized
 *  (lowercase hex: the tracker client's normalizeKey, the chain decoder), so the whole key is compared as it is. */
export function isOurTestReserve(ownerKey: string | null | undefined): boolean {
  return ownerKey === OUR_TRACKER.testReserveOwner;
}

/** Who uses the current contracts, from the detector's live list (it makes no request of its own). */
export type CurrentUse =
  | { kind: "test" }                                // every box there is ErgoScan's test reserve (spent states included)
  | { kind: "others"; n: number; ours: boolean };   // n unspent reserves of other owners; ours: the test reserve is unspent

/** null while that is not known: before the detector has checked both current templates live, or while its list holds
 *  fewer boxes than a template has (it reads one page of each). A box with an unreadable owner counts as another owner. */
export function currentUse(d: DetectorState | null | undefined): CurrentUse | null {
  if (!d || d.templates.length === 0 || d.checkedAt == null) return null;
  for (const x of d.templates) {
    if (x.checkedAt == null || x.total == null) return null;
    if (d.found.filter((b) => b.templateHash === x.hash).length < x.total) return null;
  }
  const mine = (b: DetectorState["found"][number]) => isOurTestReserve(b.owner?.key);
  const others = d.found.filter((b) => b.unspent && !mine(b)).length;
  if (others > 0) return { kind: "others", n: others, ours: d.found.some((b) => b.unspent && mine(b)) };
  return d.found.every(mine) ? { kind: "test" } : null;
}

/** Our tracker's NFT was minted (block 1 922 275) after the snapshot the observatory is built from, so snapshot counts
 *  of tracker NFTs miss it: pages add this (1) to them. 0 once a newer snapshot lists the NFT, or while none is loaded. */
export function oursExtra(obs: Pick<Observatory, "index"> | null): 0 | 1 {
  return obs && !obs.index.trackers.has(OUR_TRACKER.nft) ? 1 : 0;
}

export function ourView(s: OursState, tip: number | null): OurView {
  const st = s.state?.data ?? null;
  const height = st?.confirmedHeight ?? null;
  const age = height !== null && tip !== null ? Math.max(0, tip - height) : null;
  const all = s.reserves?.data.list ?? null;
  const ours = all ? all.filter((r) => boundToUs(r)).sort((a, b) => b.updatedHeight - a.updatedHeight || (a.box < b.box ? -1 : 1)) : null;
  return {
    status: statusOf(s, age),
    answeredAt: s.state?.at ?? null,
    cached: !!s.state?.cached,
    tip,
    box: st?.confirmedBox ?? st?.trackerBox ?? null,
    digest: st?.confirmedDigest ?? null,
    inSync: st && st.confirmedDigest ? st.localDigest === st.confirmedDigest : null,
    height,
    age,
    emergency: height !== null && tip !== null ? emergencyClock(height, tip) : null,
    pending: st?.pending ?? null,
    reserves: ours,
    totals: ours ? reserveTotals(ours) : null,
    skipped: s.reserves ? s.reserves.data.invalid + (all!.length - ours!.length) : 0,
    reservesAt: s.reserves?.at ?? null,
    reservesCached: !!s.reserves?.cached,
    reservesError: s.reservesError,
    fees: s.fees?.data ?? null,
    feesAt: s.fees?.at ?? null,
    feesCached: !!s.fees?.cached,
    events: s.events,
    error: s.stateError,
    limited: s.backoff?.kind === "rate",
    backoffUntil: s.backoff?.until ?? null,
  };
}

/** The events one fresh answer adds after the previous fresh answer of this session (none for the first one). */
export function commitEvent(prev: TrackerState | null, cur: TrackerState, at: number): OurEvent | null {
  if (!prev || !cur.confirmedBox) return null;
  if (prev.confirmedBox === cur.confirmedBox && prev.confirmedDigest === cur.confirmedDigest) return null;
  return {
    id: `c:${cur.confirmedBox}`,
    kind: "commit",
    at,
    box: cur.confirmedBox,
    digest: cur.confirmedDigest,
    height: cur.confirmedHeight,
    // the same digest posted in a new box: the tracker re-committed to stay alive
    heartbeat: !!prev.confirmedDigest && prev.confirmedDigest === cur.confirmedDigest && prev.confirmedBox !== cur.confirmedBox,
  };
}

/** A reserve is new when its issuer had no reserve in that denomination before (a top-up or redemption only moves
 *  an existing reserve to a new box, and is not a new reserve). Only reserves bound to our tracker count. */
export function reserveEvents(prev: readonly TrackedReserve[] | null, cur: readonly TrackedReserve[], at: number): OurEvent[] {
  if (!prev) return [];
  const pairs = new Set(prev.filter((r) => boundToUs(r)).map((r) => `${r.owner}:${r.token ?? "erg"}`));
  return cur
    .filter((r) => boundToUs(r) && !pairs.has(`${r.owner}:${r.token ?? "erg"}`))
    .map((r) => ({ id: `r:${r.box}`, kind: "reserve" as const, at, box: r.box, owner: r.owner, collateral: r.collateral, token: r.token, height: r.updatedHeight }));
}

/** How long ago, in the unit the pages print ("12 s", "3 min", "5 h", "2 d"); under 5 s is "just now". */
export function agoParts(ms: number): { unit: "now" | "s" | "m" | "h" | "d"; n: number } {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return { unit: "now", n: 0 };
  if (s < 60) return { unit: "s", n: s };
  const m = Math.floor(s / 60);
  if (m < 60) return { unit: "m", n: m };
  const h = Math.floor(m / 60);
  if (h < 48) return { unit: "h", n: h };
  return { unit: "d", n: Math.floor(h / 24) };
}
