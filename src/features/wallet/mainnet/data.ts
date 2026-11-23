// The mainnet wallet's data: the vault (one per page, auto-lock wired once), its journal, the answers it polls
// (design §6.4: every request through the one start queue, nothing while the tab is hidden, failed polls back off
// 30 s → 10 min), the watched issuers kept in this browser, and the journal watcher that follows signed transactions
// to depth 2 and sends the same bytes again when one was dropped.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getMainnetVault, attachAutoLock, blocksNewT1, isOpenState, type JournalEntry, type MainnetVault, type VaultState } from "@/mainnet/vault";
import { backoffMs, localProblem, walletNet, type NetOptions, type Problem, type Result, type UnspentBox, type WalletNet } from "@/mainnet/net";
import { FAILED_FOLLOW_BLOCKS, WATCH_STORAGE_KEY, depthAt, failedAtOf, followsFailed, followsFinal, nextTrackState, ownReserve, parseWatchStore, refundStartExpired, trackedGate, trustedNft, type OwnReserve, type TrackedGate, type TrackedRef, type WatchedIssuer } from "@/mainnet/flows";
import { boundToUs, type Priority, type TrackedReserve } from "@/chain/ours";
import { RESERVE_TREE_HEX, boxIdHolds, readReserve } from "@/mainnet/tx";

// ─── the vault ──────────────────────────────────────────────────────────────────────────────────

let vaultP: Promise<MainnetVault> | null = null;
let stopAutoLock: (() => void) | null = null;

function loadVault(): Promise<MainnetVault> {
  if (!vaultP) {
    vaultP = getMainnetVault().then((v) => {
      if (!stopAutoLock && typeof window !== "undefined") stopAutoLock = attachAutoLock(v);
      return v;
    });
    vaultP.catch(() => { vaultP = null; });
  }
  return vaultP;
}

/** The page's one vault (null while it opens). */
export function useVault(): { vault: MainnetVault | null; failed: boolean } {
  const [s, setS] = useState<{ vault: MainnetVault | null; failed: boolean }>({ vault: null, failed: false });
  useEffect(() => {
    let live = true;
    loadVault().then((vault) => { if (live) setS({ vault, failed: false }); }, () => { if (live) setS({ vault: null, failed: true }); });
    return () => { live = false; };
  }, []);
  return s;
}

const LOADING: VaultState = Object.freeze({ status: "loading", key: null, backedUp: false, lockReason: null, missing: [], persisted: null, v: 0 }) as VaultState;
const noSub = () => () => {};

export function useVaultState(vault: MainnetVault | null): VaultState {
  return useSyncExternalStore(vault ? vault.subscribe : noSub, vault ? vault.getState : () => LOADING, () => LOADING);
}

const NO_ENTRIES: readonly JournalEntry[] = Object.freeze([]);
export function useJournal(vault: MainnetVault | null): readonly JournalEntry[] {
  return useSyncExternalStore(vault ? vault.journal.subscribe : noSub, vault ? vault.journal.getSnapshot : () => NO_ENTRIES, () => NO_ENTRIES);
}

// ─── visibility and the wallet's network ────────────────────────────────────────────────────────

const isHidden = () => typeof document !== "undefined" && document.visibilityState === "hidden";
const subVisibility = (f: () => void) => {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", f);
  return () => document.removeEventListener("visibilitychange", f);
};
export const useVisible = (): boolean => useSyncExternalStore(subVisibility, () => !isHidden(), () => true);

export const net: () => WalletNet = walletNet;

// ─── polled answers ─────────────────────────────────────────────────────────────────────────────

export interface Snap<T> {
  value: T | null;
  problem: Problem | null;
  /** When the last good answer came. */
  at: number | null;
  /** The block height when it was read (per-block answers). */
  height: number | null;
  loading: boolean;
  failures: number;
  /** A failed answer: not before this. */
  retryAt: number | null;
}

const EMPTY: Snap<never> = Object.freeze({ value: null, problem: null, at: null, height: null, loading: false, failures: 0, retryAt: null });

/** One answer the wallet keeps asking for (shared by every screen that shows it). */
export class Resource<T> {
  #snap: Snap<T> = EMPTY;
  #subs = new Set<() => void>();
  #inflight: Promise<void> | null = null;
  constructor(private readonly fetcher: (o: NetOptions) => Promise<Result<T>>) {}
  readonly getSnapshot = (): Snap<T> => this.#snap;
  readonly subscribe = (f: () => void): (() => void) => {
    this.#subs.add(f);
    return () => { this.#subs.delete(f); };
  };
  #set(p: Partial<Snap<T>>) {
    this.#snap = { ...this.#snap, ...p };
    for (const f of [...this.#subs]) f();
  }
  /** Asks now (one at a time). */
  load(o: { priority?: Priority; height?: number | null } = {}): Promise<void> {
    if (this.#inflight) return this.#inflight;
    this.#set({ loading: true });
    this.#inflight = this.fetcher({ priority: o.priority ?? "poll" })
      .then((r) => {
        if (r.ok) this.#set({ value: r.value, problem: null, at: Date.now(), height: o.height ?? this.#snap.height, loading: false, failures: 0, retryAt: null });
        else {
          const failures = this.#snap.failures + 1;
          const wait = r.problem.kind === "aborted" ? 0 : r.problem.retryInMs ?? backoffMs(failures);
          this.#set({ problem: r.problem, loading: false, failures, retryAt: Date.now() + wait });
        }
      })
      .finally(() => { this.#inflight = null; });
    return this.#inflight;
  }
  /** Replaces the value (after the wallet's own action changed it). */
  put(value: T) { this.#set({ value, problem: null, at: Date.now(), failures: 0, retryAt: null }); }
}

const cache = new Map<string, Resource<unknown>>();
export function resource<T>(key: string, fetcher: (o: NetOptions) => Promise<Result<T>>): Resource<T> {
  let r = cache.get(key) as Resource<T> | undefined;
  if (!r) {
    r = new Resource<T>(fetcher);
    cache.set(key, r as Resource<unknown>);
  }
  return r;
}

export interface PollOptions {
  /** Ask again this long after the last answer. */
  everyMs?: number;
  /** Ask once per block: when `height` differs from the height of the last answer. */
  height?: number | null;
  enabled?: boolean;
}

export type View<T> = Snap<T> & { refresh: () => Promise<void> };

/** Keeps `res` fresh while this component shows it and the tab is visible. */
export function useResource<T>(res: Resource<T> | null, o: PollOptions = {}): View<T> {
  const snap = useSyncExternalStore(res ? res.subscribe : noSub, res ? res.getSnapshot : () => EMPTY as Snap<T>, () => EMPTY as Snap<T>);
  const visible = useVisible();
  const enabled = (o.enabled ?? true) && !!res;
  const perBlock = o.height !== undefined;
  const { everyMs, height } = o;
  useEffect(() => {
    if (!enabled || !res || !visible) return;
    const s = res.getSnapshot();
    const now = Date.now();
    if (s.loading) return;
    if (s.retryAt !== null && s.retryAt > now) {
      const id = setTimeout(() => void res.load({ height }), s.retryAt - now);
      return () => clearTimeout(id);
    }
    const blockDue = perBlock && height != null && s.height !== height;
    const neverRead = s.at === null && s.retryAt === null;
    const timeDue = everyMs != null && (s.at === null || now - s.at >= everyMs);
    if (neverRead || blockDue || timeDue) { void res.load({ height }); return; }
    if (everyMs != null && s.at !== null) {
      const id = setTimeout(() => void res.load({ height }), s.at + everyMs - now);
      return () => clearTimeout(id);
    }
    return;
  }, [enabled, res, visible, everyMs, height, perBlock, snap]);
  const refresh = useCallback(() => (res ? res.load({ priority: "user", height }) : Promise.resolve()), [res, height]);
  return useMemo(() => ({ ...snap, refresh }), [snap, refresh]);
}

// The wallet's shared answers.
export const R = {
  trackerState: () => resource("state", (o) => net().trackerState(o)),
  reservesOf: (pk: string) => resource(`reserves:${pk}`, (o) => net().reservesOf(pk, o)),
  /** The tracker's reserves of a key as reserve NFTs (trackedRefs): which reserve is whose, for top-up and refund. */
  trackedOf: (pk: string) => resource(`tracked-of:${pk}`, (o) => trackedOf(pk, o)),
  /** The tracker's side of a new T1 for a key (trackedGateOf): its own ERG reserve, one this wallet cannot prove, or none. */
  trackedGate: (pk: string) => resource(`tracked-gate:${pk}`, (o) => trackedGateOf(pk, o)),
  /** What stops a new T1 for a key (t1GateOf): the tracker's side, then the chain's. */
  t1Gate: (pk: string) => resource(`t1-gate:${pk}`, (o) => t1GateOf(pk, o)),
  /** The key's reserves as the chain shows them (/v1): what top-up and refund act on. */
  reservesOnChain: (pk: string) => resource(`chain-reserves:${pk}`, (o) => net().reservesOnChain(pk, o)),
  /** The box that holds a reserve NFT now (/v1). */
  reserveByNft: (nft: string) => resource(`reserve-nft:${nft}`, (o) => net().reserveByNft(nft, o)),
  keyStatus: (pk: string) => resource(`key:${pk}`, (o) => net().keyStatus(pk, o)),
  pair: (issuer: string, recipient: string) => resource(`pair:${issuer}:${recipient}`, (o) => net().pairNote(issuer, recipient, o)),
  unspent: (address: string, tree: string) => resource(`unspent:${address}`, (o) => net().unspent(address, tree, o)),
  mempool: (address: string) => resource(`mempool:${address}`, (o) => net().mempool(address, o)),
};

// ─── watched issuers (this browser, per key) ────────────────────────────────────────────────────

const watchSubs = new Set<() => void>();
let watchText: string | null = null;
const readWatch = (): string | null => {
  try { return localStorage.getItem(WATCH_STORAGE_KEY); } catch { return watchText; }
};
const subWatch = (f: () => void) => {
  watchSubs.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === WATCH_STORAGE_KEY) f(); };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => { watchSubs.delete(f); if (typeof window !== "undefined") window.removeEventListener("storage", onStorage); };
};

/** Drops this key's watched issuers from this browser (with the key, on wipe: keys review P2-8). */
export function forgetWatchList(pub: string): void {
  const all = parseWatchStore(readWatch());
  delete all[pub];
  const next = Object.keys(all).length ? JSON.stringify(all) : null;
  watchText = next;
  try {
    if (next === null) localStorage.removeItem(WATCH_STORAGE_KEY);
    else localStorage.setItem(WATCH_STORAGE_KEY, next);
  } catch { /* private mode: nothing kept */ }
  for (const f of [...watchSubs]) f();
}

export function useWatchList(me: string | null): [WatchedIssuer[], (fn: (l: WatchedIssuer[]) => WatchedIssuer[]) => void] {
  const text = useSyncExternalStore(subWatch, readWatch, () => null);
  const list = useMemo(() => (me ? parseWatchStore(text)[me] ?? [] : []), [text, me]);
  const update = useCallback((fn: (l: WatchedIssuer[]) => WatchedIssuer[]) => {
    if (!me) return;
    const all = parseWatchStore(readWatch());
    all[me] = fn(all[me] ?? []);
    const next = JSON.stringify(all);
    watchText = next;
    try { localStorage.setItem(WATCH_STORAGE_KEY, next); } catch { /* private mode: kept for this page only */ }
    for (const f of [...watchSubs]) f();
  }, [me]);
  return [list, update];
}

// ─── the journal watcher ────────────────────────────────────────────────────────────────────────

/** Tx kinds the watcher follows on chain; notes follow the pair route instead. */
const ON_CHAIN = new Set(["t1", "withdraw", "redeem", "topup", "refund-start", "refund-end"]);
/** Kinds the wallet broadcasts itself (D1): a dropped one is sent again with the same bytes. */
const REBROADCAST = new Set(["t1", "withdraw", "topup", "refund-start", "refund-end"]);
const RESEND_EVERY_MS = 10 * 60_000;
/** A stuck entry's inputs are looked up at most this many per block (in turns), for a foreign spend. */
const INPUT_CHECKS_PER_BLOCK = 10;

/**
 * True when one of the entry's inputs is spent by another transaction (money review P2-1: every input, not only the
 * first; for a redemption that is its reserve box, P2-2): then it can never confirm. Large entries are checked in turns.
 */
export async function spentElsewhere(e: Pick<JournalEntry, "inputs" | "txId">, height: number, box: WalletNet["box"] = (id) => net().box(id)): Promise<boolean> {
  const n = e.inputs.length;
  const take = Math.min(n, INPUT_CHECKS_PER_BLOCK);
  const from = n > take ? (height * take) % n : 0;
  for (let i = 0; i < take; i++) {
    const b = await box(e.inputs[(from + i) % n]);
    if (b.ok && b.value.spentBy !== null && b.value.spentBy !== e.txId) return true;
  }
  return false;
}

/** A failed entry from before failure heights were kept: followed only if it failed within about 30 blocks' time. */
const FAILED_FOLLOW_MS = FAILED_FOLLOW_BLOCKS * 2 * 60_000;
const MEMPOOL_EVERY_MS = 30_000;

/** Follows the open entries of this key (design §6.4 "Pending transaction"): each one once per new block, the key's
 *  mempool every 30 s while one waits there; a dropped T1 or Withdraw is sent again (the same bytes, at most every 10
 *  minutes). A failed entry that was sent is still looked for during 30 blocks (the chain has the last word: it moves
 *  to confirmed if it shows up); a final one is checked again until depth 10 (a deep reorg). Renders nothing. */
export function useJournalWatcher(vault: MainnetVault | null, me: { pub: string; address: string } | null, height: number | null, entries: readonly JournalEntry[]) {
  const visible = useVisible();
  const open = useMemo(() => entries.filter((e) => me && e.pub === me.pub && ON_CHAIN.has(e.kind) && e.txId && e.sendAttempts > 0 &&
    (isOpenState(e.state) ||
      (height !== null && followsFinal(e, height) && e.retiredAt === null) ||
      (height !== null && followsFailed(e, height) && (failedAtOf(e) !== null || Date.now() - e.updatedAt < FAILED_FOLLOW_MS)))), [entries, me, height]);
  const mem = useResource(me ? R.mempool(me.address) : null, { everyMs: MEMPOOL_EVERY_MS, enabled: open.length > 0 });
  const checked = useRef(new Map<string, number>());
  const busy = useRef(false);
  useEffect(() => {
    if (!vault || !me || !visible || height === null || busy.current || open.length === 0) return;
    const due = open.filter((e) => checked.current.get(e.id) !== height);
    if (!due.length) return;
    busy.current = true;
    void (async () => {
      try {
        const inMempool = new Set((mem.value ?? []).map((t) => t.id));
        for (const e of due) {
          // a failed entry gets its failure height once; it is looked for until 30 blocks after it
          if (e.state === "failed" && failedAtOf(e) === null) await vault.journal.update(e.id, { meta: { failedAt: height } });
          const st = await net().txStatus(e.txId!);
          if (!st.ok) break;
          checked.current.set(e.id, height);
          let conflict = false, trackerBoxSpent = false;
          if (e.state !== "failed" && !st.value && !inMempool.has(e.txId!) && e.lastSendAt !== null && Date.now() - e.lastSendAt > 3 * 60_000) {
            if (e.kind === "redeem" && typeof e.meta.trackerBox === "string") {
              const b = await net().box(e.meta.trackerBox);
              trackerBoxSpent = b.ok && b.value.spentBy !== null;
            }
            conflict = await spentElsewhere(e, height);
          }
          const step = nextTrackState(e, { status: st.value, inMempool: inMempool.has(e.txId!), conflict, trackerBoxSpent, expired: refundStartExpired(e, height) });
          if (step) await vault.journal.update(e.id, { ...step, lastHeight: height });
          else if (e.lastHeight !== height) await vault.journal.update(e.id, { lastHeight: height });
          // a T1 or Withdraw nobody sees: the same bytes again (idempotent), at most every 10 minutes
          if (e.state !== "failed" && !st.value && !inMempool.has(e.txId!) && !conflict && REBROADCAST.has(e.kind) && (step?.state ?? e.state) === "sent" &&
              e.lastSendAt !== null && Date.now() - e.lastSendAt > RESEND_EVERY_MS) {
            await resend(vault, e);
          }
        }
      } catch { /* the next block tries again */ } finally { busy.current = false; }
    })();
  }, [vault, me, visible, height, open, mem.value]);
  // a completed refund closed the reserve: once the completion is 10 deep, the key may create a new one (the journal's
  // one-reserve rule); checked once per block while it is due, so a tab that was closed at depth 10 catches up
  const retireDue = useMemo(() => {
    if (!me || height === null) return null;
    const t1 = entries.find((e) => e.pub === me.pub && blocksNewT1(e) && e.state === "final");
    return t1 ? entries.find((e) => e.pub === me.pub && e.kind === "refund-end" && e.state === "final" && e.meta.nft === t1.inputs[0] && depthAt(e.inclusionHeight, height) >= RETIRE_DEPTH) ?? null : null;
  }, [entries, me, height]);
  useEffect(() => {
    if (!vault || !me || !visible || height === null || !retireDue) return;
    void retireReserveOf(vault, me.pub, retireDue, height).catch(() => { /* the next block tries again */ });
  }, [vault, me, visible, height, retireDue]);
}

/** How deep the completion must be before the T1 is retired (a reorg that undoes it is then out of reach). */
export const RETIRE_DEPTH = 10;

/**
 * After a completed refund: the key's final T1 stops blocking a new reserve once the reserve with the T1's NFT is gone
 * from the reserve contract, spent by this completion of that NFT, at least 10 blocks deep (journal.retireT1's rule:
 * the reserve fully refunded, seen on chain). Other reserve boxes at the key (anyone can plant one) do not block it.
 */
export async function retireReserveOf(
  vault: Pick<MainnetVault, "journal">, pub: string, done: Pick<JournalEntry, "kind" | "state" | "inclusionHeight" | "meta">, height: number,
  byNft: WalletNet["reserveByNft"] = (nft) => net().reserveByNft(nft),
): Promise<boolean> {
  const t1 = await vault.journal.activeT1(pub);
  const nft = t1?.inputs[0];
  if (!t1 || t1.state !== "final" || !nft) return false;
  if (done.kind !== "refund-end" || done.state !== "final" || done.meta.nft !== nft || depthAt(done.inclusionHeight, height) < RETIRE_DEPTH) return false;
  const left = await byNft(nft);
  if (!left.ok || (left.value !== null && left.value.box.ergoTree === RESERVE_TREE_HEX)) return false;
  await vault.journal.retireT1(t1.id);
  return true;
}

/** The reserve NFT of this key's own T1 (the token id is the T1's first input), or null when this browser has none. */
export function t1NftOf(entries: readonly JournalEntry[], pub: string): string | null {
  return entries.find((e) => e.pub === pub && blocksNewT1(e))?.inputs[0] ?? null;
}

/** boxIdHolds, false for a box that cannot even be serialized (an answer missing a field). */
const hashesToId = (b: Parameters<typeof boxIdHolds>[0]): boolean => { try { return boxIdHolds(b); } catch { return false; } };

/** nft → the key whose P2PK held the box with that id (null: another tree). Per tab: a box never changes. */
const minters = new Map<string, string | null>();
const P2PK_TREE = /^0008cd(0[23][0-9a-f]{64})$/;

/**
 * Who minted a reserve NFT (re-review P1-1): a token id is the id of its minting transaction's first input, so the box
 * with that id (spent, still indexed by /v1) is the minter's. The key of its P2PK tree, null for any other tree or no
 * such box (not cached: the index may lag), or the read's problem. Its tree is believed only when the box hashes to
 * that id (wallet-t3): an answer that does not is a problem, not an answer.
 */
export async function minterOf(nft: string, box: WalletNet["box"] = (id, o) => net().box(id, o)): Promise<Result<string | null>> {
  if (minters.has(nft)) return { ok: true, value: minters.get(nft)! };
  const b = await box(nft, { priority: "user" });
  if (!b.ok) return b.problem.kind === "not-found" ? { ok: true, value: null } : b;
  if (!hashesToId(b.value.box)) return { ok: false, problem: localProblem("shape", "the box an NFT was minted from does not hash to its id") };
  const key = P2PK_TREE.exec(b.value.box.ergoTree)?.[1] ?? null;
  minters.set(nft, key);
  return { ok: true, value: key };
}

/** Tests only: forget what minterOf learnt. */
export function forgetMinters(): void { minters.clear(); }

/**
 * The reserves the tracker follows for a key, as reserve NFTs. The tracker names a reserve by its box id (its `nft` is
 * the tracker's own NFT, not the reserve's), so the reserve NFT is the token of that box, read from /v1: every box of
 * a reserve's chain holds the same NFT, so a box id the tracker has not updated yet still names it. Entries of
 * another tracker, and boxes that do not read as a reserve of that owner, are left out; each NFT is checked to be
 * minted by its owner (`genuine`, minterOf: the tracker can be made to name a planted box).
 */
export async function trackedRefs(list: readonly TrackedReserve[], box: WalletNet["box"] = (id, o) => net().box(id, o)): Promise<Result<TrackedRef[]>> {
  const out: TrackedRef[] = [];
  for (const r of list) {
    if (!boundToUs(r)) continue;
    const b = await box(r.box, { priority: "user" });
    if (!b.ok) return b;
    const rr = readReserve(b.value.box);
    if (!rr.ok || rr.info.owner !== r.owner) continue;
    const m = await minterOf(rr.info.nft, box);
    if (!m.ok) return m;
    out.push({ box: r.box, owner: r.owner, nft: rr.info.nft, token: r.token, genuine: m.value === rr.info.owner });
  }
  return { ok: true, value: out };
}

/** Reserve boxes of the listing a T1 must not duplicate: whether one of them (the first 10 distinct boxes, in the
 *  order the /v1 listing gives them; the wallet does not sort it) holds an NFT this key minted. The others are planted
 *  and do not count. */
export const MINTED_CHECK_MAX = 10;
export async function mintedAmong(boxes: readonly UnspentBox[], pub: string, box: WalletNet["box"] = (id, o) => net().box(id, o)): Promise<Result<boolean>> {
  const seen = new Set<string>();
  for (const u of boxes) {
    if (seen.has(u.box.boxId) || seen.size >= MINTED_CHECK_MAX) continue;
    seen.add(u.box.boxId);
    const rr = readReserve(u.box);
    if (!rr.ok || rr.info.owner !== pub) continue;
    const m = await minterOf(rr.info.nft, box);
    if (!m.ok) return m;
    if (m.value === pub) return { ok: true, value: true };
  }
  return { ok: true, value: false };
}

/** The tracker's reserves of a key as reserve NFTs (trackedRefs), read fresh. */
export async function trackedOf(pub: string, o?: NetOptions): Promise<Result<TrackedRef[]>> {
  const l = await net().reservesOf(pub, o ?? { priority: "user" });
  return l.ok ? trackedRefs(l.value, (id) => net().box(id, o ?? { priority: "user" })) : l;
}

/**
 * The tracker's side of a new T1 for a key, from one read (wallet-t3 P2, trackedGate): every ERG reserve it lists for
 * the key blocks; those boxes are read for their NFT and who minted it (only when there are any), so that the screen
 * shows the key's own reserve as its own and any other one as a reserve this wallet cannot prove.
 */
export async function trackedGateOf(pub: string, o?: NetOptions, n: Pick<WalletNet, "reservesOf" | "box"> = net()): Promise<Result<TrackedGate<TrackedReserve>>> {
  const opts = o ?? { priority: "user" };
  const l = await n.reservesOf(pub, opts);
  if (!l.ok) return l;
  const erg = l.value.filter((r) => r.owner === pub && r.token === null);
  if (erg.length === 0) return { ok: true, value: { k: "none" } };
  const refs = await trackedRefs(erg, (id) => n.box(id, opts));
  if (!refs.ok) return refs;
  return { ok: true, value: trackedGate(pub, erg, refs.value) };
}

/** What stops a new T1: the tracker's side (TrackedGate), or "chain", a reserve box at the key whose NFT this key
 *  minted that the tracker does not list yet (made on another device; money review P2-4). */
export type T1Gate = TrackedGate<TrackedReserve> | { k: "chain" };

/**
 * One rule for the reserve screen and its prepare() (wallet-t3 P2): any ERG reserve the tracker lists for the key,
 * proven or not (trackedGateOf); when it lists none, any reserve box at the key whose NFT this key minted (mintedAmong
 * over the best-effort listing: boxes it did not mint are planted and do not count, an incomplete listing does not
 * block).
 */
export async function t1GateOf(pub: string, o?: NetOptions, n: Pick<WalletNet, "reservesOf" | "box" | "reservesOnChain"> = net()): Promise<Result<T1Gate>> {
  const opts = o ?? { priority: "user" };
  const tracked = await trackedGateOf(pub, opts, n);
  if (!tracked.ok || tracked.value.k !== "none") return tracked;
  const onChain = await n.reservesOnChain(pub, opts);
  if (!onChain.ok) return onChain;
  const minted = await mintedAmong(onChain.value.boxes, pub, (id) => n.box(id, opts));
  if (!minted.ok) return minted;
  return { ok: true, value: minted.value ? { k: "chain" } : { k: "none" } };
}

/**
 * The key's own reserve now (review 2, P1; re-review P1-1/2): the tracker read fresh, the T1 from the journal
 * (trustedNft), the box that holds that NFT by an exact lookup, and the listing at the key only for the warning (a
 * failed or incomplete listing does not matter).
 */
export async function ownReserveNow(pub: string, entries: readonly JournalEntry[]): Promise<Result<OwnReserve>> {
  const tracked = await trackedOf(pub);
  const trusted = trustedNft({ owner: pub, t1Nft: t1NftOf(entries, pub), tracked: tracked.ok ? tracked.value : null });
  if (!trusted.ok) return { ok: true, value: trusted };
  const held = await net().reserveByNft(trusted.nft, { priority: "user" });
  if (!held.ok) return held;
  const listing = await net().reservesOnChain(pub, { priority: "user" });
  return { ok: true, value: ownReserve({ owner: pub, trusted, held: held.value, listing: listing.ok ? listing.value : null }) };
}

/** Sends a signed T1, Withdraw, top-up or refund again: the exact stored bytes (write-ahead: markSending first). */
export async function resend(vault: MainnetVault, e: JournalEntry): Promise<Problem | null> {
  if (!REBROADCAST.has(e.kind)) return null;
  return (await broadcastEntry(vault, e)).problem;
}

/**
 * Broadcasts an entry's exact stored bytes (write-ahead: markSending first). A node refusal is kept as meta.nodeRefused,
 * which offers "Cancel" while nobody has the transaction (money review P2-1); an accepted broadcast clears it.
 */
export async function broadcastEntry(vault: MainnetVault, e: JournalEntry): Promise<{ entry: JournalEntry; problem: Problem | null }> {
  await vault.journal.markSending(e.id);
  const r = await net().broadcast(e.signedRaw);
  const cur = (await vault.journal.get(e.id)) ?? e;
  if (r.ok) return { entry: await vault.journal.update(e.id, { state: cur.state === "signed" ? "sent" : cur.state, error: null, meta: { nodeRefused: false } }), problem: null };
  const refused = r.problem.kind === "refused";
  return { entry: await vault.journal.update(e.id, { error: r.problem.reason || r.problem.kind, ...(refused ? { meta: { nodeRefused: true } } : {}) }), problem: r.problem };
}

// ─── the key's coins ────────────────────────────────────────────────────────────────────────────

/** Box ids an open journal entry of this key spends (coin selection skips them). */
export function inFlightOf(entries: readonly JournalEntry[], pub: string): Set<string> {
  const s = new Set<string>();
  for (const e of entries) if (e.pub === pub && isOpenState(e.state)) for (const id of e.inputs) s.add(id);
  return s;
}

/** The key's confirmed boxes, read once per block while a screen shows them. */
export function useUnspent(me: { address: string; tree: string } | null, height: number | null, enabled = true) {
  return useResource(me ? R.unspent(me.address, me.tree) : null, { height, enabled });
}
