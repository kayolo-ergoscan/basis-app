// src/chain/hooks.ts — React hooks over the chain store. Every hook mounts the live layer (ref-counted): the seed loads
// lazily, the scheduler spends the per-block budget, everything pauses while the tab is hidden.
//
// useHeight() is the shell's (src/app/height.ts): one /v1/info poller for the whole app. The chain store listens to it
// for new blocks instead of polling the height itself.
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { useHeight as useShellHeight } from "@/app/height";
import { isHex } from "./decode";
import { chain, type ChainState, type Fetched } from "./store";
import type { BoxDetail, DetectorState, Hex, LiveStatus, Observatory, RedemptionView, ReserveView, TrackerView, TxDetail } from "./types";

export { useHeight, getHeight, type HeightState } from "@/app/height";

function useChainSelector<T>(sel: (s: ChainState) => T): T {
  const snap = useCallback(() => sel(chain.store.getState()), [sel]);
  return useSyncExternalStore(chain.store.subscribe, snap, snap);
}

const selObservatory = (s: ChainState) => chain.getObservatory(s);
const selStatus = (s: ChainState) => s.status;

/** Mounts the live layer and feeds it the shell's height. Optional focus on one reserve or tracker. */
function useLive(focus?: { kind: "reserve" | "tracker"; id: string | null | undefined }) {
  const h = useShellHeight();
  useEffect(() => chain.acquire(), []);
  useEffect(() => { chain.onHeight(h.height, h.updatedAt); }, [h.height, h.updatedAt]);
  const kind = focus?.kind;
  const id = focus?.id ? focus.id.toLowerCase() : null;
  useEffect(() => (kind && id ? chain.focus(kind, id) : undefined), [kind, id]);
}

/** The whole observatory: seed (as of block N) merged with live updates. null while the seed loads (one lazy chunk). */
export function useObservatory(): Observatory | null {
  useLive();
  return useChainSelector(selObservatory);
}

/** Live layer status: enabled/hidden/online, last error, budget used this block. */
export function useChainStatus(): LiveStatus {
  useLive();
  return useChainSelector(selStatus);
}

export interface ReserveResult {
  loading: boolean;              // seed not loaded yet, or an unknown box id is being looked up
  reserve: ReserveView | null;   // null = not a known reserve box (yet)
  tracker: TrackerView | null;   // the tracker its R6 names
  lineage: ReserveView[];        // the chain of boxes of this reserve (same NFT), oldest first
  redemptions: RedemptionView[]; // redemptions that spent a box of this lineage, newest first
}

/** One reserve box (any of the 99, or one found live). Focus: checked at once, then every 10 blocks; its P2S mempool every 3.
 *  A box id the observatory does not know yet is looked up once (interactive, kept for the tab): a reserve box made after
 *  the snapshot — still unspent or already spent — then joins the live layer, anything else is "not a known reserve". */
export function useReserve(boxId: string | null | undefined): ReserveResult {
  useLive({ kind: "reserve", id: boxId });
  const obs = useChainSelector(selObservatory);
  const id = (boxId || "").toLowerCase();
  const lookup = !!obs && !obs.index.reserves.has(id) && isHex(id, 32);
  const sel = useCallback((s: ChainState) => (lookup ? s.boxes[id] : undefined), [lookup, id]);
  const fetched = useChainSelector(sel);
  useEffect(() => { if (lookup) void chain.fetchBox(id); }, [lookup, id]);
  const looking = lookup && (!fetched || fetched.state === "loading");
  return useMemo(() => {
    if (!obs || looking) return { loading: true, reserve: null, tracker: null, lineage: [], redemptions: [] };
    const reserve = obs.index.reserves.get(id) ?? null;
    if (!reserve) return { loading: false, reserve: null, tracker: null, lineage: [], redemptions: [] };
    const lineage: ReserveView[] = [];
    const seen = new Set<Hex>();
    let first: ReserveView = reserve;
    while (first.prev && obs.index.reserves.has(first.prev) && !seen.has(first.prev)) { seen.add(first.prev); first = obs.index.reserves.get(first.prev)!; }
    for (let r: ReserveView | undefined = first; r && !lineage.includes(r); r = r.next ? obs.index.reserves.get(r.next) : undefined) lineage.push(r);
    const ids = new Set(lineage.map((r) => r.id));
    const redemptions = obs.redemptions.filter((x) => ids.has(x.reserveIn));
    return { loading: false, reserve, tracker: reserve.r6 ? obs.index.trackers.get(reserve.r6) ?? null : null, lineage, redemptions };
  }, [obs, id, looking]);
}

export interface TrackerResult {
  loading: boolean;
  tracker: TrackerView | null;
  reserves: ReserveView[];       // reserves whose R6 names this NFT (unspent first)
  redemptions: RedemptionView[]; // redemptions it served, newest first
}

/** One tracker NFT. Focus: its unspent box is checked at once, then every 2 blocks; a new box emits a mainnet pulse. */
export function useTracker(nft: string | null | undefined): TrackerResult {
  useLive({ kind: "tracker", id: nft });
  const obs = useChainSelector(selObservatory);
  return useMemo(() => {
    if (!obs) return { loading: true, tracker: null, reserves: [], redemptions: [] };
    const tracker = obs.index.trackers.get((nft || "").toLowerCase()) ?? null;
    if (!tracker) return { loading: false, tracker: null, reserves: [], redemptions: [] };
    const reserves = tracker.reserves.map((id) => obs.index.reserves.get(id)).filter((r): r is ReserveView => !!r);
    const set = new Set(tracker.redemptions);
    return { loading: false, tracker, reserves, redemptions: obs.redemptions.filter((x) => set.has(x.tx)) };
  }, [obs, nft]);
}

export interface RedemptionResult {
  loading: boolean;
  redemption: RedemptionView | null;   // from the seed (41) or seen live
  detail: TxDetail | null;             // inputs, data inputs, outputs with roles (only with { detail: true })
  detailState: Fetched<TxDetail>["state"] | "idle";
  error: string | null;
}

/** One redemption by tx id. `{ detail: true }` also fetches the whole transaction once (interactive lane, cached). */
export function useRedemption(txId: string | null | undefined, opts: { detail?: boolean } = {}): RedemptionResult {
  useLive();
  const obs = useChainSelector(selObservatory);
  const key = (txId || "").toLowerCase();
  const sel = useCallback((s: ChainState) => (key ? s.txs[key] : undefined), [key]);
  const fetched = useChainSelector(sel);
  const want = !!opts.detail;
  useEffect(() => { if (want && key) void chain.fetchTx(key); }, [want, key]);
  return useMemo(() => ({
    loading: !obs,
    redemption: obs?.index.redemptions.get(key) ?? null,
    detail: fetched?.data ?? null,
    detailState: fetched?.state ?? "idle",
    error: fetched?.error ?? null,
  }), [obs, key, fetched]);
}

const IDLE_DETECTOR: DetectorState = { watching: true, templates: [], found: [], checkedHeight: null, checkedAt: null };

/** Boxes at the current templates (ERG 6e7d9a0e…, multi-token 8699a557…). found = [] until a first deployment. */
export function useDetector(): DetectorState {
  useLive();
  const obs = useChainSelector(selObservatory);
  return obs?.detector ?? IDLE_DETECTOR;
}

export interface BoxResult {
  state: Fetched<BoxDetail>["state"] | "idle";
  box: BoxDetail | null;
  error: string | null;
  refresh: () => void;
}

/** Learn "decode any box": fetches one box by id (interactive lane, cached) and decodes everything about it. */
export function useBox(boxId: string | null | undefined): BoxResult {
  useLive();
  const key = (boxId || "").trim().toLowerCase();
  const sel = useCallback((s: ChainState) => (key ? s.boxes[key] : undefined), [key]);
  const fetched = useChainSelector(sel);
  useEffect(() => { if (key) void chain.fetchBox(key); }, [key]);
  const refresh = useCallback(() => { if (key) void chain.fetchBox(key, true); }, [key]);
  return useMemo(() => ({ state: fetched?.state ?? "idle", box: fetched?.data ?? null, error: fetched?.error ?? null, refresh }), [fetched, refresh]);
}
