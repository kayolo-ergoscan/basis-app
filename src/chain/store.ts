// src/chain/store.ts — the live layer: one zustand store holding the seed, the live facts and on-demand details, plus a
// scheduler that spends the per-block request budget (api.ts) on the checks that matter most right now.
//
// What is polled (background lane, only while some chain hook is mounted and the tab is visible):
//   1. follow-ups of a change (full template list → box → spending tx), at once;
//   2. focus: the reserve or tracker a mounted useReserve()/useTracker() shows, and the mempool of that reserve's P2S;
//   3. the detector: all boxes at the two current templates (ERG 6e7d9a0e…, multi-token 8699a557…);
//   4. tracker NFTs that can still change (live, stale, unused): the unspent box that holds each NFT;
//   5. one cheap "signature" per legacy template with unspent reserves (total + newest box, limit=1).
// A change found by 4 becomes a pulse (`pulse.commit({ source: "mainnet", … })`) and a new commit on the tracker; a
// change found by 5 triggers one full list of that template, and the diff is merged in one update.
import { createStore, type StoreApi } from "zustand/vanilla";
import { pulse as appPulse, type Pulse } from "@/app/pulse";
import { chainApi, ChainApiError, paths, type ChainApi } from "./api";
import { CURRENT_TEMPLATES, isHex, p2pkKeyOfTree, templateHash } from "./decode";
import { boxDetail, buildObservatory, contractIndex, contractOf, detectedBox, emptyLive, idleStatus, interpretTx, isTrackerShaped, liveBoxFromApi } from "./model";
import type { ApiBox, ApiList, ApiTx, BoxDetail, DetectedBox, Hex, LiveData, LiveStatus, Observatory, Seed, TrackerCommit, TxDetail } from "./types";

export interface Fetched<T> { state: "loading" | "ok" | "missing" | "error"; data: T | null; error: string | null; at: number }

export interface ChainState {
  seed: Seed | null;
  seedError: string | null;
  live: LiveData;
  tip: number | null;            // live height from the shell's poller; null until known
  status: LiveStatus;
  boxes: Record<Hex, Fetched<BoxDetail>>;   // useBox()
  txs: Record<Hex, Fetched<TxDetail>>;      // useRedemption(…, { detail: true })
}

export interface ChainStoreOptions {
  api?: ChainApi;
  loadSeed?: () => Promise<Seed>;
  pulse?: { commit(p: Pulse): void };
  now?: () => number;
  isHidden?: () => boolean;
}

/** Check intervals in blocks (CHAIN_API.md "Request budget" has the arithmetic). */
export const INTERVALS = { followUp: 0, focusTracker: 2, focusReserve: 10, mempool: 3, detector: 6, tracker: 6, trackerQuiet: 20, template: 12, hostIndex: 360 } as const;

type TaskKind = "tracker" | "template" | "templateFull" | "box" | "tx" | "detector" | "mempool" | "hostIndex";
interface Task { key: string; kind: TaskKind; arg: string; prio: number; every: number }

const defaultLoadSeed = async (): Promise<Seed> => (await import("./seed.json")).default as unknown as Seed;

export type ChainStore = ReturnType<typeof createChainStore>;

export function createChainStore(opts: ChainStoreOptions = {}) {
  const api = opts.api ?? chainApi;
  const now = opts.now ?? (() => Date.now());
  const bus = opts.pulse ?? appPulse;
  const hidden = opts.isHidden ?? (() => typeof document !== "undefined" && document.visibilityState === "hidden");
  const store: StoreApi<ChainState> = createStore<ChainState>(() => ({
    seed: null, seedError: null, live: emptyLive(), tip: null, status: idleStatus(), boxes: {}, txs: {},
  }));
  const get = store.getState;
  const set = store.setState;

  // ── status mirrors the api's budget and errors ──
  let lastOkAt: number | null = null;
  let lastError: string | null = null;
  let online = true;
  let users = 0;
  const refreshStatus = () => {
    const s = get();
    set({
      status: {
        enabled: users > 0 && !!s.seed && !hidden(),
        online, hidden: hidden(), lastOkAt, lastError: lastError ?? (s.seedError ? `seed: ${s.seedError}` : null), changes: s.live.changes,
        budget: api.stats(),
      },
    });
  };
  let statusQueued = false;
  const queueStatus = () => {
    if (statusQueued) return;
    statusQueued = true;
    queueMicrotask(() => { statusQueued = false; refreshStatus(); });
  };
  const unsubApi = api.subscribe(queueStatus);

  const ok = () => { online = true; lastOkAt = now(); lastError = null; };
  const fail = (e: unknown) => {
    if (e instanceof ChainApiError && (e.kind === "budget" || e.kind === "hidden" || e.kind === "aborted")) return;
    online = !(e instanceof ChainApiError && (e.kind === "network" || e.kind === "timeout"));
    lastError = e instanceof Error ? e.message : String(e);
    queueStatus();
  };

  // ── seed ──
  let seedPromise: Promise<Seed | null> | null = null;
  function ensureSeed(): Promise<Seed | null> {
    if (!seedPromise) {
      seedPromise = (opts.loadSeed ?? defaultLoadSeed)()
        .then((seed) => { set({ seed }); refreshStatus(); return seed; })
        .catch((e) => { set({ seedError: e instanceof Error ? e.message : String(e) }); seedPromise = null; refreshStatus(); return null; });
    }
    return seedPromise;
  }

  // ── live updates (each task applies its result in one set()) ──
  const tipOrSeed = () => get().tip ?? get().seed?.asOf.height ?? null;
  function patchLive(fn: (l: LiveData) => LiveData | null) {
    const next = fn(get().live);
    if (next) set({ live: next });
  }

  // ── focus and schedule ──
  const focusReserves = new Map<Hex, number>();
  const focusTrackers = new Map<Hex, number>();
  const last = new Map<string, number>();       // task key → height when last run
  const followUps: Task[] = [];
  const emptyStreak = new Map<Hex, number>();
  const recheck = new Set<string>();           // task keys to run again on the next block, whatever their interval
  let running = false;

  function isUnspentNow(id: Hex): boolean {
    const { seed, live } = get();
    if (live.spent[id]) return false;
    const r = seed?.reserves.find((x) => x.id === id);
    if (r) return !r.spent;
    const b = live.extraReserves[id];
    return !!b && !b.spentTx;
  }

  /** Unspent reserve ids we expect at a template right now (seed − seen spent + live additions). */
  function expectedAt(hash: Hex): Set<Hex> {
    const { seed, live } = get();
    const out = new Set<Hex>();
    if (!seed) return out;
    const byId = contractIndex(seed).byId;
    for (const r of seed.reserves) if (!r.spent && !live.spent[r.id] && byId.get(r.contract)?.templateHash === hash) out.add(r.id);
    for (const b of Object.values(live.extraReserves)) if (b.templateHash === hash && !b.spentTx && !live.spent[b.id]) out.add(b.id);
    return out;
  }

  function trackerStatusNow(nft: Hex): string | null {
    const { seed, live } = get();
    const t = seed?.trackers.find((x) => x.nft === nft);
    if (!t) return null;
    const L = live.trackers[nft];
    if (!L) return t.status;
    if (L.box === null) return "burned";
    if (L.box.id === t.currentBox) return t.status;
    return isTrackerShaped(L.box, nft) && p2pkKeyOfTree(L.box.ergoTree) ? (L.box.basis.tree!.zero ? "stale" : "live") : p2pkKeyOfTree(L.box.ergoTree) ? "unused" : "locked";
  }

  function targets(): Task[] {
    const { seed } = get();
    if (!seed) return [];
    const out = new Map<string, Task>();
    const add = (t: Task) => {
      const had = out.get(t.key);
      if (!had || t.prio < had.prio) out.set(t.key, had ? { ...t, every: Math.min(t.every, had.every) } : t);
    };
    for (const nft of focusTrackers.keys()) {
      if (seed.trackers.some((t) => t.nft === nft)) add({ key: `tracker:${nft}`, kind: "tracker", arg: nft, prio: 1, every: INTERVALS.focusTracker });
    }
    for (const id of focusReserves.keys()) {
      if (isUnspentNow(id)) add({ key: `box:${id}`, kind: "box", arg: id, prio: 1, every: INTERVALS.focusReserve });
      const r = seed.reserves.find((x) => x.id === id);
      const lb = get().live.extraReserves[id];
      const c = r ? contractIndex(seed).byId.get(r.contract) : lb ? contractOf(seed, lb.ergoTree, lb.templateHash) : null;
      if (c) add({ key: `mempool:${c.p2sFull}`, kind: "mempool", arg: c.p2sFull, prio: 2, every: INTERVALS.mempool });
    }
    for (const h of [CURRENT_TEMPLATES.erg, CURRENT_TEMPLATES.multiToken]) add({ key: `detector:${h}`, kind: "detector", arg: h, prio: 3, every: INTERVALS.detector });
    for (const t of seed.trackers) {
      const st = trackerStatusNow(t.nft);
      if (st === "live") add({ key: `tracker:${t.nft}`, kind: "tracker", arg: t.nft, prio: 4, every: INTERVALS.tracker });
      else if (st === "stale" || st === "unused") add({ key: `tracker:${t.nft}`, kind: "tracker", arg: t.nft, prio: 6, every: INTERVALS.trackerQuiet });
    }
    const hashes = new Set<Hex>();
    const byId = contractIndex(seed).byId;
    for (const r of seed.reserves) if (isUnspentNow(r.id)) { const c = byId.get(r.contract); if (c && !c.current) hashes.add(c.templateHash); }
    for (const h of hashes) add({ key: `template:${h}`, kind: "template", arg: h, prio: 5, every: INTERVALS.template });
    add({ key: "hostIndex", kind: "hostIndex", arg: "", prio: 7, every: INTERVALS.hostIndex });
    return [...out.values()];
  }

  function pick(): Task | null {
    if (followUps.length) return followUps.shift()!;
    const tip = tipOrSeed();
    if (tip === null) return null;
    let best: Task | null = null;
    let bestOver = -1;
    for (const t of targets()) {
      const l = last.get(t.key);
      const over = l === undefined ? Number.MAX_SAFE_INTEGER : tip - l;
      if (recheck.has(t.key) ? over < 1 : over < t.every) continue;
      if (!best || t.prio < best.prio || (t.prio === best.prio && over > bestOver)) { best = t; bestOver = over; }
    }
    return best;
  }

  function followUp(kind: TaskKind, arg: string) {
    const key = `${kind}:${arg}`;
    if (followUps.some((t) => t.key === key)) return;
    followUps.push({ key, kind, arg, prio: 0, every: INTERVALS.followUp });
  }

  /** Runs due checks while the block budget lasts. Safe to call often. */
  async function tick() {
    if (running || users === 0 || hidden()) return;
    if (!get().seed) return;
    running = true;
    try {
      while (users > 0 && api.canSpend("background")) {
        const task = pick();
        if (!task) break;
        const prev = last.get(task.key);
        last.set(task.key, tipOrSeed() ?? 0);
        try {
          await run(task);
          ok();
        } catch (e) {
          if (e instanceof ChainApiError && (e.kind === "budget" || e.kind === "hidden")) {
            if (prev === undefined) last.delete(task.key); else last.set(task.key, prev);
            if (task.prio === 0) followUps.unshift(task);
            break;
          }
          fail(e);
        }
        queueStatus();
      }
    } finally {
      running = false;
    }
  }

  const bg = { lane: "background" as const };

  async function run(t: Task) {
    switch (t.kind) {
      case "tracker": return checkTracker(t.arg);
      case "template": return checkTemplate(t.arg);
      case "templateFull": return fullTemplate(t.arg);
      case "box": return checkBox(t.arg);
      case "tx": return loadTx(t.arg);
      case "detector": return detect(t.arg);
      case "mempool": return checkMempool(t.arg);
      case "hostIndex": return checkHostIndex();
    }
  }

  async function checkTracker(nft: Hex) {
    const res = await api.get<ApiList<ApiBox>>(paths.unspentByToken(nft), bg);
    const seed = get().seed!;
    const t = seed.trackers.find((x) => x.nft === nft);
    const items = res.items || [];
    const at = now();
    const h = tipOrSeed();
    if (!items.length) {
      const n = (emptyStreak.get(nft) ?? 0) + 1;
      emptyStreak.set(nft, n);
      // An empty answer in two different blocks before calling it burned: re-check on the next block.
      if (n < 2) { recheck.add(`tracker:${nft}`); return; }
      recheck.delete(`tracker:${nft}`);
      patchLive((l) => {
        const prev = l.trackers[nft];
        if (prev && prev.box === null) return { ...l, trackers: { ...l.trackers, [nft]: { ...prev, checkedAt: at, checkedHeight: h } } };
        const changed = t?.status !== "burned";
        return { ...l, changes: l.changes + (changed ? 1 : 0), trackers: { ...l.trackers, [nft]: { checkedAt: at, checkedHeight: h, box: null, newCommits: prev?.newCommits ?? [] } } };
      });
      return;
    }
    emptyStreak.delete(nft);
    recheck.delete(`tracker:${nft}`);
    const box = liveBoxFromApi(items[0]);
    const l = get().live;
    const prev = l.trackers[nft];
    const known = prev?.box?.id ?? t?.currentBox ?? null;
    const newCommits = prev?.newCommits ?? [];
    const isNew = box.id !== known && box.id !== t?.lastTrackerBox?.box && !newCommits.some((c) => c.box === box.id);
    let commit: TrackerCommit | null = null;
    if (isNew && isTrackerShaped(box, nft) && p2pkKeyOfTree(box.ergoTree)) {
      const tree = box.basis.tree!;
      commit = { height: box.height, digest: tree.digest, boxes: 1, key: box.basis.key, zero: tree.zero, empty: tree.empty, source: "live", box: box.id };
    }
    set({
      live: {
        ...l,
        changes: l.changes + (box.id !== known ? 1 : 0),
        trackers: { ...l.trackers, [nft]: { checkedAt: at, checkedHeight: h, box, newCommits: commit ? [...newCommits, commit] : newCommits } },
      },
    });
    if (commit) {
      try { bus.commit({ source: "mainnet", trackerId: nft, digest: commit.digest, height: commit.height }); } catch { /* bus errors are the shell's */ }
    }
  }

  async function checkTemplate(hash: Hex) {
    const res = await api.get<ApiList<ApiBox>>(paths.unspentByTemplate(hash, 1), bg);
    const expected = expectedAt(hash);
    const total = res.total ?? res.items.length;
    const newest = res.items[0]?.boxId ?? null;
    const changed = total !== expected.size || (newest !== null && !expected.has(newest));
    const at = now();
    patchLive((l) => ({ ...l, templates: { ...l.templates, [hash]: { total, newest, checkedAt: at, checkedHeight: tipOrSeed(), changed } } }));
    if (changed) followUp("templateFull", hash);
  }

  async function fullTemplate(hash: Hex) {
    const res = await api.get<ApiList<ApiBox>>(paths.unspentByTemplate(hash, 50), bg);
    const items = res.items || [];
    const complete = !res.hasMore && (res.total === undefined || res.total <= items.length);
    const expected = expectedAt(hash);
    const nowIds = new Set(items.map((b) => b.boxId));
    const gone = complete ? [...expected].filter((id) => !nowIds.has(id)) : [];
    const seed = get().seed!;
    const known = new Set([...seed.reserves.map((r) => r.id), ...Object.keys(get().live.extraReserves)]);
    const fresh = items.filter((b) => !known.has(b.boxId)).map(liveBoxFromApi);
    const at = now();
    const h = tipOrSeed();
    patchLive((l) => {
      const spent = { ...l.spent };
      for (const id of gone) if (!spent[id]) spent[id] = { tx: null, height: null, seenAt: at };
      const extra = { ...l.extraReserves };
      for (const b of fresh) extra[b.id] = b;
      return {
        ...l,
        spent,
        extraReserves: extra,
        changes: l.changes + gone.length + fresh.length,
        templates: { ...l.templates, [hash]: { total: res.total ?? items.length, newest: items[0]?.boxId ?? null, checkedAt: at, checkedHeight: h, changed: false } },
      };
    });
    for (const id of gone.slice(0, 3)) followUp("box", id);
  }

  async function checkBox(id: Hex) {
    let b: ApiBox;
    try {
      b = await api.get<ApiBox>(paths.box(id), bg);
    } catch (e) {
      if (e instanceof ChainApiError && e.status === 404) return;
      throw e;
    }
    const at = now();
    const h = tipOrSeed();
    if (b.spentTransactionId) {
      const tx = b.spentTransactionId;
      patchLive((l) => (l.spent[id]?.tx === tx ? null : { ...l, changes: l.changes + (l.spent[id] ? 0 : 1), spent: { ...l.spent, [id]: { tx, height: b.spentHeight ?? null, seenAt: at } } }));
      if (!get().live.txs[tx] && !get().seed?.redemptions.some((x) => x.tx === tx)) followUp("tx", tx);
    } else {
      patchLive((l) => ({ ...l, checks: { ...l.checks, [`box:${id}`]: { height: h, at } } }));
    }
  }

  function applyTx(d: TxDetail, tx: ApiTx) {
    const at = now();
    patchLive((l) => {
      const spent = { ...l.spent };
      if (d.reserveIn && !spent[d.reserveIn.boxId]?.tx) spent[d.reserveIn.boxId] = { tx: d.id, height: d.height, seenAt: at };
      const extra = { ...l.extraReserves };
      const out = d.reserveOut ? tx.outputs.find((o) => o.boxId === d.reserveOut!.boxId) : null;
      if (out && !get().seed?.reserves.some((r) => r.id === out.boxId)) extra[out.boxId] = liveBoxFromApi({ ...out, transactionId: out.transactionId || tx.id });
      return { ...l, spent, extraReserves: extra, txs: { ...l.txs, [d.id]: d }, changes: l.changes + 1 };
    });
  }

  async function loadTx(id: Hex) {
    const tx = await api.get<ApiTx>(paths.tx(id), bg);
    const d = interpretTx(get().seed, tx);
    applyTx(d, tx);
    set({ txs: { ...get().txs, [id]: { state: "ok", data: d, error: null, at: now() } } });
  }

  async function detect(hash: Hex) {
    const res = await api.get<ApiList<ApiBox>>(paths.boxesByTemplate(hash, 20), bg);
    const seed = get().seed!;
    const at = now();
    const h = tipOrSeed();
    const boxes = (res.items || []).map(liveBoxFromApi);
    patchLive((l) => {
      const found: Record<Hex, DetectedBox> = { ...l.detector.found };
      let fresh = 0;
      for (const b of boxes) {
        const prev = found[b.id];
        if (!prev) fresh++;
        found[b.id] = detectedBox(seed, b, contractOf(seed, b.ergoTree, b.templateHash), prev?.firstSeenAt ?? at);
      }
      const extra = { ...l.extraReserves };
      for (const b of boxes) if (!b.spentTx && !extra[b.id]) extra[b.id] = b;
      return {
        ...l,
        changes: l.changes + fresh,
        extraReserves: extra,
        detector: {
          found,
          templates: { ...l.detector.templates, [hash]: { total: res.total ?? boxes.length, checkedAt: at, checkedHeight: h } },
          checkedAt: at,
          checkedHeight: h,
        },
      };
    });
  }

  async function checkMempool(address: string) {
    const res = await api.get<ApiList<unknown>>(paths.mempoolByAddress(address), bg);
    const at = now();
    patchLive((l) => ({ ...l, mempool: { ...l.mempool, [address]: { total: res.total ?? (res.items || []).length, checkedAt: at } } }));
  }

  async function checkHostIndex() {
    const res = await api.get<{ reserveCount?: number; ergLockedNano?: string; trackerCount?: number; tipHeight?: number; reserves?: { boxId: Hex }[] }>(paths.hostIndex(), bg);
    const at = now();
    patchLive((l) => ({
      ...l,
      hostIndex: {
        reserveCount: Number(res.reserveCount ?? res.reserves?.length ?? 0),
        ergLockedNano: String(res.ergLockedNano ?? "0"),
        trackerCount: Number(res.trackerCount ?? 0),
        boxIds: (res.reserves ?? []).map((r) => r.boxId),
        tipHeight: typeof res.tipHeight === "number" ? res.tipHeight : null,
        checkedAt: at,
      },
    }));
  }

  // ── on-demand details (interactive lane, cached for the session) ──
  const inflight = new Map<string, Promise<void>>();

  function fetchBox(id: Hex, force = false): Promise<void> {
    const key = id.toLowerCase();
    if (!isHex(key, 32)) {
      set({ boxes: { ...get().boxes, [key]: { state: "error", data: null, error: "a box id is 64 hex characters", at: now() } } });
      return Promise.resolve();
    }
    const had = get().boxes[key];
    if (!force && had && had.state !== "error") return inflight.get(`box:${key}`) ?? Promise.resolve();
    if (inflight.has(`box:${key}`)) return inflight.get(`box:${key}`)!;
    set({ boxes: { ...get().boxes, [key]: { state: "loading", data: had?.data ?? null, error: null, at: now() } } });
    const p = (async () => {
      try {
        await ensureSeed();
        const b = await api.get<ApiBox>(paths.box(key), { lane: "interactive" });
        let th: Hex | null = null;
        try { th = await templateHash(b.ergoTree); } catch { th = null; }
        const d = boxDetail(get().seed, b, th);
        ok();
        set({ boxes: { ...get().boxes, [key]: { state: "ok", data: d, error: null, at: now() } } });
        // a reserve we track turned out spent: let the live layer know
        if (d.spentTx && (get().seed?.reserves.some((r) => r.id === key && !r.spent) || get().live.extraReserves[key])) {
          const tx = d.spentTx;
          patchLive((l) => (l.spent[key] ? null : { ...l, changes: l.changes + 1, spent: { ...l.spent, [key]: { tx, height: null, seenAt: now() } } }));
        }
      } catch (e) {
        const missing = e instanceof ChainApiError && e.status === 404;
        if (!missing) fail(e);
        set({ boxes: { ...get().boxes, [key]: { state: missing ? "missing" : "error", data: null, error: missing ? "no box with this id" : e instanceof Error ? e.message : String(e), at: now() } } });
      } finally {
        inflight.delete(`box:${key}`);
        void tick();
      }
    })();
    inflight.set(`box:${key}`, p);
    return p;
  }

  function fetchTx(id: Hex, force = false): Promise<void> {
    const key = id.toLowerCase();
    if (!isHex(key, 32)) {
      set({ txs: { ...get().txs, [key]: { state: "error", data: null, error: "a transaction id is 64 hex characters", at: now() } } });
      return Promise.resolve();
    }
    const had = get().txs[key];
    if (!force && had && had.state !== "error") return inflight.get(`tx:${key}`) ?? Promise.resolve();
    if (inflight.has(`tx:${key}`)) return inflight.get(`tx:${key}`)!;
    set({ txs: { ...get().txs, [key]: { state: "loading", data: had?.data ?? null, error: null, at: now() } } });
    const p = (async () => {
      try {
        await ensureSeed();
        const tx = await api.get<ApiTx>(paths.tx(key), { lane: "interactive" });
        const d = interpretTx(get().seed, tx);
        ok();
        const rin = d.reserveIn?.boxId;
        const tracked = !!rin && (!!get().seed?.reserves.some((r) => r.id === rin) || !!get().live.extraReserves[rin]);
        if (tracked && !get().seed?.redemptions.some((x) => x.tx === key)) applyTx(d, tx);
        set({ txs: { ...get().txs, [key]: { state: "ok", data: d, error: null, at: now() } } });
      } catch (e) {
        const missing = e instanceof ChainApiError && e.status === 404;
        if (!missing) fail(e);
        set({ txs: { ...get().txs, [key]: { state: missing ? "missing" : "error", data: null, error: missing ? "no transaction with this id" : e instanceof Error ? e.message : String(e), at: now() } } });
      } finally {
        inflight.delete(`tx:${key}`);
        void tick();
      }
    })();
    inflight.set(`tx:${key}`, p);
    return p;
  }

  // ── lifecycle ──
  const onVisibility = () => { refreshStatus(); if (!hidden()) void tick(); };

  /** A hook mounted: load the seed, start scheduling. Returns release(). */
  function acquire(): () => void {
    users++;
    if (users === 1) {
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);
      void ensureSeed().then(() => { refreshStatus(); void tick(); });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      users = Math.max(0, users - 1);
      if (users === 0 && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
      queueStatus();
    };
  }

  /** Ref-counted focus on one reserve or tracker; the first focus checks it at once when the budget allows. */
  function focus(kind: "reserve" | "tracker", id: Hex): () => void {
    const m = kind === "reserve" ? focusReserves : focusTrackers;
    const key = id.toLowerCase();
    m.set(key, (m.get(key) ?? 0) + 1);
    void tick();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (m.get(key) ?? 1) - 1;
      if (n <= 0) m.delete(key); else m.set(key, n);
    };
  }

  let lastPollAt: number | null = null;
  /** The shell's height poller answered (height.ts): count the request, open a new block budget, run due checks. */
  function onHeight(height: number | null, updatedAt: number | null) {
    if (updatedAt !== null && updatedAt !== lastPollAt) { lastPollAt = updatedAt; api.noteHeightPoll(); }
    if (height === null || !Number.isFinite(height)) return;
    if (get().tip === null || height > get().tip!) {
      api.newBlock(height);
      set({ tip: height });
      void tick();
    }
  }

  // ── selectors (memoized: stable references for useSyncExternalStore) ──
  let memo: { seed: Seed; live: LiveData; tip: number | null; status: LiveStatus; base: Observatory; obs: Observatory } | null = null;
  function getObservatory(s: ChainState = get()): Observatory | null {
    if (!s.seed) return null;
    if (memo && memo.seed === s.seed && memo.live === s.live && memo.tip === s.tip) {
      if (memo.status !== s.status) { memo.status = s.status; memo.obs = { ...memo.base, live: s.status }; }
      return memo.obs;
    }
    const base = buildObservatory({ seed: s.seed, live: s.live, tip: s.tip, status: s.status });
    memo = { seed: s.seed, live: s.live, tip: s.tip, status: s.status, base, obs: base };
    return base;
  }

  return {
    store,
    api,
    ensureSeed,
    acquire,
    focus,
    onHeight,
    tick,
    fetchBox,
    fetchTx,
    getObservatory,
    /** Test/dev: what the scheduler would run next, without running it. */
    peek: () => {
      const saved = followUps.slice();
      const t = pick();
      followUps.splice(0, followUps.length, ...saved);
      return t;
    },
    /** Test/dev: forget everything (seed stays). */
    resetLive: () => { last.clear(); followUps.length = 0; emptyStreak.clear(); recheck.clear(); set({ live: emptyLive(), boxes: {}, txs: {} }); },
    dispose: () => { unsubApi(); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility); },
  };
}

/** The app-wide store and scheduler. */
export const chain = createChainStore();

