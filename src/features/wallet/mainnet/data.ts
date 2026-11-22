// The mainnet wallet's data: the vault (one per page, auto-lock wired once), its journal, the answers it polls
// (design §6.4: every request through the one start queue, nothing while the tab is hidden, failed polls back off
// 30 s → 10 min), the watched issuers kept in this browser, and the journal watcher that follows signed transactions
// to depth 2 and sends the same bytes again when one was dropped.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { getMainnetVault, attachAutoLock, isOpenState, type JournalEntry, type MainnetVault, type VaultState } from "@/mainnet/vault";
import { backoffMs, walletNet, type NetOptions, type Problem, type Result, type WalletNet } from "@/mainnet/net";
import { FAILED_FOLLOW_BLOCKS, WATCH_STORAGE_KEY, failedAtOf, followsFailed, followsFinal, nextTrackState, parseWatchStore, type WatchedIssuer } from "@/mainnet/flows";
import type { Priority } from "@/chain/ours";

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
const ON_CHAIN = new Set(["t1", "withdraw", "redeem"]);
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
          const step = nextTrackState(e, { status: st.value, inMempool: inMempool.has(e.txId!), conflict, trackerBoxSpent });
          if (step) await vault.journal.update(e.id, { ...step, lastHeight: height });
          else if (e.lastHeight !== height) await vault.journal.update(e.id, { lastHeight: height });
          // a T1 or Withdraw nobody sees: the same bytes again (idempotent), at most every 10 minutes
          if (e.state !== "failed" && !st.value && !inMempool.has(e.txId!) && !conflict && e.kind !== "redeem" && (step?.state ?? e.state) === "sent" &&
              e.lastSendAt !== null && Date.now() - e.lastSendAt > RESEND_EVERY_MS) {
            await resend(vault, e);
          }
        }
      } catch { /* the next block tries again */ } finally { busy.current = false; }
    })();
  }, [vault, me, visible, height, open, mem.value]);
}

/** Sends a signed T1 or Withdraw again: the exact stored bytes (write-ahead: markSending first). */
export async function resend(vault: MainnetVault, e: JournalEntry): Promise<Problem | null> {
  if (e.kind !== "t1" && e.kind !== "withdraw") return null;
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
