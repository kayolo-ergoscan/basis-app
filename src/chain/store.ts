// src/chain/store.ts — the live layer: one zustand store holding the seed, the live facts and on-demand details, plus a
// scheduler that spends the per-block request budget (api.ts) on the checks that matter most right now.
//
// What is polled (background lane, only while some chain hook is mounted and the tab is visible):
//   1. follow-ups of a change (full template list → box → spending tx), at once;
//   2. focus: the reserve or tracker a mounted useReserve()/useTracker() shows, the mempool of that reserve's P2S and
//      the tracker NFT its R6 names;
//   3. the detector: all boxes at the two current templates (ERG 6e7d9a0e…, multi-token 8699a557…);
//   4. tracker NFTs that can still change (live, stale, unused): the unspent box that holds each NFT, including NFTs
//      outside the seed that a reserve found live names in R6 (its exit depends on where that NFT is);
//   5. one cheap "signature" per legacy template with unspent reserves (total + newest box, limit=1);
//   6. each reserve transaction the boxes above reveal but that is not read yet (the tx that made a reserve box found
//      live, the tx that spent one): read once per tab, newest first, so a redemption gets its receiver, time and
//      tracker box. The boxes alone already count it (model.ts, redemptions "from boxes").
// The first look at what the user opened (the focused reserve or tracker, and the tracker NFT of a reserve found live)
// is a user-started load: it goes out at once on the interactive lane, outside the background budget; every later
// re-check is background work. A change found by 4 becomes a pulse (`pulse.commit({ source: "mainnet", … })`) and a new
// commit on the tracker; a change found by 5 triggers one full list of that template, and the diff is merged in one
// update.
import { createStore, type StoreApi } from "zustand/vanilla";
import { pulse as appPulse, type Pulse } from "@/app/pulse";
import { chainApi, ChainApiError, finalBox, finalTx, paths, type ChainApi, type Lane } from "./api";
import { CURRENT_TEMPLATES, isHex, p2pkKeyOfTree, templateHash } from "./decode";
import { boxDetail, buildObservatory, contractIndex, contractOf, detectedBox, emptyLive, idleStatus, interpretTx, isTrackerShaped, liveBoxFromApi, liveTrackerStatus } from "./model";
import type { ApiBox, ApiList, ApiTx, BoxDetail, DetectedBox, Hex, LiveBox, LiveData, LiveStatus, Observatory, Seed, TrackerCommit, TxDetail } from "./types";

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
export const INTERVALS = { followUp: 0, focusTracker: 2, focusReserve: 10, mempool: 3, detector: 6, tracker: 6, trackerQuiet: 20, template: 12, hostIndex: 360, txRead: 1 } as const;

type TaskKind = "tracker" | "template" | "templateFull" | "box" | "tx" | "detector" | "mempool" | "hostIndex";
/** `user`: the first run of this task in the tab is a user-started load (interactive lane), see firstLooks(). */
interface Task { key: string; kind: TaskKind; arg: string; prio: number; every: number; user?: boolean }

/** First looks at tracker NFTs named by reserves found live (not focused) per tab on the interactive lane; more of them
 *  wait for the background budget, so many fresh reserves cannot turn one page view into a burst. */
export const FIRST_LOOK_NFTS = 3;

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
  const readTxs = new Set<Hex>();              // reserve txs read in this tab (merged, or older than the snapshot)
  const missingTxs = new Map<Hex, number>();   // tx id → height of a 404: asked again only after INTERVALS.detector blocks
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
    const L = live.trackers[nft];
    if (!t) return L ? liveTrackerStatus(L.box, nft) : null;
    if (!L) return t.status;
    if (L.box !== null && L.box.id === t.currentBox) return t.status;
    return liveTrackerStatus(L.box, nft);
  }

  /** Tracker NFTs outside the seed that unspent reserves name in R6 (reserves found live), each with "named by a
   *  focused reserve". Where such an NFT is decides those reserves' exits, so it is looked up like a tracker. */
  function namedOutsideSeed(seed: Seed): Map<Hex, boolean> {
    const { live } = get();
    const known = new Set(seed.trackers.map((t) => t.nft));
    const out = new Map<Hex, boolean>();
    const note = (nft: Hex | null | undefined, id: Hex) => {
      if (!nft || known.has(nft) || !isHex(nft, 32)) return;
      out.set(nft, (out.get(nft) ?? false) || focusReserves.has(id));
    };
    for (const r of seed.reserves) if (!r.spent && !live.spent[r.id]) note(r.r6, r.id);
    for (const b of Object.values(live.extraReserves)) if (!b.spentTx && !live.spent[b.id]) note(b.basis.nft, b.id);
    return out;
  }

  /** Reserve txs known only by id: the tx that made each reserve box found live, the tx that spent one (a box found live
   *  or a seed reserve seen spent). Newest first; `focused` when the box is the reserve the user opened. Bounded by the
   *  boxes the live layer holds (≤ 20 per current template from the detector, ≤ 50 per legacy template), and each is
   *  read once per tab (a final answer, kept by api.ts). */
  function unreadTxs(seed: Seed): { id: Hex; h: number; focused: boolean }[] {
    const { live } = get();
    const tip = tipOrSeed() ?? 0;
    const seedTxs = new Set(seed.redemptions.map((x) => x.tx));
    const out = new Map<Hex, { id: Hex; h: number; focused: boolean }>();
    const note = (id: Hex | null | undefined, h: number, focused: boolean) => {
      if (!id || !isHex(id, 32) || live.txs[id] || readTxs.has(id) || seedTxs.has(id) || inflight.has(`tx:${id}`)) return;
      const miss = missingTxs.get(id);
      if (miss !== undefined && tip - miss < INTERVALS.detector) return;
      const had = out.get(id);
      out.set(id, { id, h: Math.max(h, had?.h ?? 0), focused: focused || !!had?.focused });
    };
    for (const b of Object.values(live.extraReserves)) {
      const focused = focusReserves.has(b.id);
      const h = b.settled ?? b.height;
      note(b.tx, h, focused);
      note(b.spentTx ?? live.spent[b.id]?.tx, h + 1, focused);
    }
    for (const [id, x] of Object.entries(live.spent)) if (!live.extraReserves[id]) note(x.tx, x.height ?? 0, focusReserves.has(id));
    return [...out.values()].sort((a, b) => b.h - a.h);
  }

  function targets(): Task[] {
    const { seed } = get();
    if (!seed) return [];
    const out = new Map<string, Task>();
    const add = (t: Task) => {
      const had = out.get(t.key);
      if (!had) { out.set(t.key, t); return; }
      const best = t.prio < had.prio ? t : had;
      out.set(t.key, { ...best, every: Math.min(t.every, had.every), user: !!(t.user || had.user) });
    };
    const named = namedOutsideSeed(seed);
    for (const nft of focusTrackers.keys()) {
      if (seed.trackers.some((t) => t.nft === nft) || named.has(nft)) add({ key: `tracker:${nft}`, kind: "tracker", arg: nft, prio: 1, every: INTERVALS.focusTracker, user: true });
    }
    for (const id of focusReserves.keys()) {
      if (isUnspentNow(id)) add({ key: `box:${id}`, kind: "box", arg: id, prio: 1, every: INTERVALS.focusReserve, user: true });
      const r = seed.reserves.find((x) => x.id === id);
      const lb = get().live.extraReserves[id];
      const c = r ? contractIndex(seed).byId.get(r.contract) : lb ? contractOf(seed, lb.ergoTree, lb.templateHash) : null;
      if (c) add({ key: `mempool:${c.p2sFull}`, kind: "mempool", arg: c.p2sFull, prio: 2, every: INTERVALS.mempool, user: true });
    }
    for (const h of [CURRENT_TEMPLATES.erg, CURRENT_TEMPLATES.multiToken]) add({ key: `detector:${h}`, kind: "detector", arg: h, prio: 3, every: INTERVALS.detector });
    for (const t of seed.trackers) {
      const st = trackerStatusNow(t.nft);
      if (st === "live") add({ key: `tracker:${t.nft}`, kind: "tracker", arg: t.nft, prio: 4, every: INTERVALS.tracker });
      else if (st === "stale" || st === "unused") add({ key: `tracker:${t.nft}`, kind: "tracker", arg: t.nft, prio: 6, every: INTERVALS.trackerQuiet });
    }
    for (const [nft, focused] of named) {
      const key = `tracker:${nft}`;
      if (focused) add({ key, kind: "tracker", arg: nft, prio: 1, every: INTERVALS.tracker, user: true });
      const st = trackerStatusNow(nft);
      if (st === null) add({ key, kind: "tracker", arg: nft, prio: 3, every: INTERVALS.tracker, user: true });   // not looked up yet
      else if (st === "live") add({ key, kind: "tracker", arg: nft, prio: 4, every: INTERVALS.tracker });
      else if (st === "stale" || st === "unused") add({ key, kind: "tracker", arg: nft, prio: 6, every: INTERVALS.trackerQuiet });
    }
    const hashes = new Set<Hex>();
    const byId = contractIndex(seed).byId;
    for (const r of seed.reserves) if (isUnspentNow(r.id)) { const c = byId.get(r.contract); if (c && !c.current) hashes.add(c.templateHash); }
    for (const h of hashes) add({ key: `template:${h}`, kind: "template", arg: h, prio: 5, every: INTERVALS.template });
    // a reserve tx not read yet: once each, newest first; the focused reserve's own txs are part of its first look
    for (const x of unreadTxs(seed)) {
      add({ key: `tx:${x.id}`, kind: "tx", arg: x.id, prio: x.focused ? 1 : 4, every: INTERVALS.txRead, user: x.focused });
    }
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
    if (kind === "tx" && (readTxs.has(arg) || looking.has(key))) return;   // read already, or its first look is on its way
    followUps.push({ key, kind, arg, prio: 0, every: INTERVALS.followUp });
  }

  // ── first looks: what the user just opened goes out at once on the interactive lane ──
  const looking = new Set<string>();           // task keys of first looks in flight
  const lookedNfts = new Set<Hex>();           // NFTs outside the seed given a first look without focus (≤ FIRST_LOOK_NFTS)

  /** Starts every due first look: a `user` task that has never run in this tab (a focused reserve's box, its contract's
   *  mempool and its R6 tracker NFT, a focused tracker, an NFT outside the seed that a live reserve names). They do not
   *  wait for the background budget; a failed one is tried again on the next block, in the background. */
  function firstLooks() {
    const { seed } = get();
    if (!seed || users === 0 || hidden()) return;
    const known = new Set(seed.trackers.map((t) => t.nft));
    for (const task of targets()) {
      if (!task.user || last.has(task.key) || looking.has(task.key)) continue;
      if (task.kind === "tracker" && !known.has(task.arg) && task.prio > 1) {
        if (!lookedNfts.has(task.arg) && lookedNfts.size >= FIRST_LOOK_NFTS) continue;
        lookedNfts.add(task.arg);
      }
      looking.add(task.key);
      last.set(task.key, tipOrSeed() ?? 0);
      void run(task, "interactive")
        .then(() => { ok(); if (task.kind !== "tracker") recheck.delete(task.key); },
          (e) => {
            if (e instanceof ChainApiError && (e.kind === "aborted" || e.kind === "hidden")) { last.delete(task.key); return; }
            fail(e);
            recheck.add(task.key);
          })
        .finally(() => { looking.delete(task.key); queueStatus(); void tick(); });
    }
  }

  /** Runs due checks while the block budget lasts. Safe to call often. */
  async function tick() {
    if (users === 0 || hidden()) return;
    if (!get().seed) return;
    firstLooks();
    if (running) return;
    running = true;
    try {
      while (users > 0 && api.canSpend("background")) {
        const task = pick();
        if (!task) break;
        const prev = last.get(task.key);
        last.set(task.key, tipOrSeed() ?? 0);
        try {
          await run(task, "background");
          ok();
          if (task.kind !== "tracker") recheck.delete(task.key);
        } catch (e) {
          if (e instanceof ChainApiError && (e.kind === "budget" || e.kind === "hidden")) {
            if (prev === undefined) last.delete(task.key); else last.set(task.key, prev);
            if (task.prio === 0) followUps.unshift(task);
            break;
          }
          fail(e);
          recheck.add(task.key);                // a failed check is tried again on the next block, not after its interval
        }
        queueStatus();
        firstLooks();                           // what this answer revealed (a reserve found live, its tracker NFT)
      }
    } finally {
      running = false;
    }
  }

  async function run(t: Task, lane: Lane) {
    const o = { lane };
    switch (t.kind) {
      case "tracker": return checkTracker(t.arg, o);
      case "template": return checkTemplate(t.arg, o);
      case "templateFull": return fullTemplate(t.arg, o);
      case "box": return checkBox(t.arg, o);
      case "tx": return loadTx(t.arg, o);
      case "detector": return detect(t.arg, o);
      case "mempool": return checkMempool(t.arg, o);
      case "hostIndex": return checkHostIndex(o);
    }
  }

  async function checkTracker(nft: Hex, o: { lane: Lane }) {
    const res = await api.get<ApiList<ApiBox>>(paths.unspentByToken(nft), o);
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
        // a change since the snapshot only for an NFT the snapshot knows
        const changed = !!t && t.status !== "burned";
        return { ...l, changes: l.changes + (changed ? 1 : 0), trackers: { ...l.trackers, [nft]: { checkedAt: at, checkedHeight: h, box: null, newCommits: prev?.newCommits ?? [] } } };
      });
      return;
    }
    emptyStreak.delete(nft);
    recheck.delete(`tracker:${nft}`);
    const box = liveBoxFromApi(items[0]);
    const l = get().live;
    const prev = l.trackers[nft];
    if (!t) {
      // an NFT outside the seed (named by a reserve found live): only where it is; no commits, no pulse, no "change"
      set({ live: { ...l, trackers: { ...l.trackers, [nft]: { checkedAt: at, checkedHeight: h, box, newCommits: [] } } } });
      return;
    }
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

  async function checkTemplate(hash: Hex, o: { lane: Lane }) {
    const res = await api.get<ApiList<ApiBox>>(paths.unspentByTemplate(hash, 1), o);
    const expected = expectedAt(hash);
    const total = res.total ?? res.items.length;
    const newest = res.items[0]?.boxId ?? null;
    const changed = total !== expected.size || (newest !== null && !expected.has(newest));
    const at = now();
    patchLive((l) => ({ ...l, templates: { ...l.templates, [hash]: { total, newest, checkedAt: at, checkedHeight: tipOrSeed(), changed } } }));
    if (changed) followUp("templateFull", hash);
  }

  async function fullTemplate(hash: Hex, o: { lane: Lane }) {
    const res = await api.get<ApiList<ApiBox>>(paths.unspentByTemplate(hash, 50), o);
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

  async function checkBox(id: Hex, o: { lane: Lane }) {
    let b: ApiBox;
    try {
      b = await api.get<ApiBox>(paths.box(id), { ...o, final: finalBox });
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

  /** A box as a tx answer shows it, without losing a spend already known: a kept (final) answer may be older than it. */
  const keepSpend = (had: LiveBox | undefined, b: LiveBox): LiveBox => (had?.spentTx && !b.spentTx ? { ...b, spentTx: had.spentTx } : b);

  /** A reserve tx after the snapshot (the seed has everything up to its block, so an older one would count twice). */
  const isLiveReserveTx = (d: TxDetail) => {
    const seed = get().seed;
    return !!seed && d.height > seed.asOf.height && !!(d.reserveIn || d.reserveOut) && !seed.redemptions.some((x) => x.tx === d.id);
  };

  function applyTx(d: TxDetail, tx: ApiTx) {
    const at = now();
    const seedIds = new Set(get().seed?.reserves.map((r) => r.id) ?? []);
    patchLive((l) => {
      const spent = { ...l.spent };
      if (d.reserveIn && !spent[d.reserveIn.boxId]?.tx) spent[d.reserveIn.boxId] = { tx: d.id, height: d.height, seenAt: at };
      const extra = { ...l.extraReserves };
      const out = d.reserveOut ? tx.outputs.find((o) => o.boxId === d.reserveOut!.boxId) : null;
      if (out && !seedIds.has(out.boxId)) extra[out.boxId] = keepSpend(extra[out.boxId], liveBoxFromApi({ ...out, transactionId: out.transactionId || tx.id, settlementHeight: out.settlementHeight ?? d.height }));
      // the reserve box it spent, when that box is not in the seed: made and spent after the snapshot
      const inp = d.reserveIn ? tx.inputs.find((i) => i.boxId === d.reserveIn!.boxId) : null;
      if (inp && !seedIds.has(inp.boxId) && !extra[inp.boxId]?.spentTx) extra[inp.boxId] = liveBoxFromApi({ ...inp, spentTransactionId: d.id });
      return { ...l, spent, extraReserves: extra, txs: { ...l.txs, [d.id]: d }, changes: l.changes + 1 };
    });
  }

  async function loadTx(id: Hex, o: { lane: Lane }) {
    let tx: ApiTx;
    try {
      tx = await api.get<ApiTx>(paths.tx(id), { ...o, final: finalTx });
    } catch (e) {
      // not (yet) in the index: an answer, not a failure; asked again a few blocks later
      if (e instanceof ChainApiError && e.status === 404) { missingTxs.set(id, tipOrSeed() ?? 0); return; }
      throw e;
    }
    if (!tx || tx.id !== id) throw new ChainApiError("parse", paths.tx(id), "the answer is not this transaction");
    missingTxs.delete(id);
    readTxs.add(id);
    const d = interpretTx(get().seed, tx);
    if (isLiveReserveTx(d)) applyTx(d, tx);
    set({ txs: { ...get().txs, [id]: { state: "ok", data: d, error: null, at: now() } } });
  }

  async function detect(hash: Hex, o: { lane: Lane }) {
    const res = await api.get<ApiList<ApiBox>>(paths.boxesByTemplate(hash, 20), o);
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
      // every box at the template, spent ones too (an earlier state of a reserve: its redemption counts, its page and
      // lineage know it); a box seen unspent before and spent now is replaced, a spend already known is kept
      const extra = { ...l.extraReserves };
      let spends = 0;
      for (const b of boxes) {
        const had = extra[b.id];
        if (!had) extra[b.id] = b;
        else if (!had.spentTx && b.spentTx) { extra[b.id] = b; spends++; }
      }
      return {
        ...l,
        changes: l.changes + fresh + spends,
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

  async function checkMempool(address: string, o: { lane: Lane }) {
    const res = await api.get<ApiList<unknown>>(paths.mempoolByAddress(address), o);
    const at = now();
    patchLive((l) => ({ ...l, mempool: { ...l.mempool, [address]: { total: res.total ?? (res.items || []).length, checkedAt: at } } }));
  }

  async function checkHostIndex(o: { lane: Lane }) {
    const res = await api.get<{ reserveCount?: number; ergLockedNano?: string; trackerCount?: number; tipHeight?: number; reserves?: { boxId: Hex }[] }>(paths.hostIndex(), o);
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
        const b = await api.get<ApiBox>(paths.box(key), { lane: "interactive", final: finalBox });
        let th: Hex | null = null;
        try { th = await templateHash(b.ergoTree); } catch { th = null; }
        const d = boxDetail(get().seed, b, th);
        ok();
        // the live layer first, then the answer: a page waiting on this box finds the reserve as soon as it sees "ok"
        // a reserve we track turned out spent: let the live layer know
        if (d.spentTx && (get().seed?.reserves.some((r) => r.id === key && !r.spent) || get().live.extraReserves[key])) {
          const tx = d.spentTx;
          patchLive((l) => (l.spent[key] ? null : { ...l, changes: l.changes + 1, spent: { ...l.spent, [key]: { tx, height: null, seenAt: now() } } }));
        }
        // a reserve box the live layer has not met (made after the snapshot, perhaps spent since): it joins it, so its
        // page, its lineage and the transactions around it know it
        const seed = get().seed;
        if (d.role === "reserve" && seed && !seed.reserves.some((r) => r.id === key) && !get().live.extraReserves[key]) {
          const lb = liveBoxFromApi(b);
          patchLive((l) => (l.extraReserves[key] ? null : { ...l, changes: l.changes + 1, extraReserves: { ...l.extraReserves, [key]: lb } }));
        }
        set({ boxes: { ...get().boxes, [key]: { state: "ok", data: d, error: null, at: now() } } });
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
        const tx = await api.get<ApiTx>(paths.tx(key), { lane: "interactive", final: finalTx });
        const d = interpretTx(get().seed, tx);
        ok();
        // any reserve tx after the snapshot joins the live layer: a box made and spent since then is recognised too
        readTxs.add(key);
        if (isLiveReserveTx(d)) applyTx(d, tx);
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

  /** Ref-counted focus on one reserve or tracker; the first focus checks it at once, on the interactive lane. */
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
    resetLive: () => { last.clear(); followUps.length = 0; emptyStreak.clear(); recheck.clear(); lookedNfts.clear(); readTxs.clear(); missingTxs.clear(); set({ live: emptyLive(), boxes: {}, txs: {} }); },
    dispose: () => { unsubApi(); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility); },
  };
}

/** The app-wide store and scheduler. */
export const chain = createChainStore();

