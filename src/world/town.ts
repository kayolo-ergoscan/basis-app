// The persistent Sandbox town (PRODUCT §4.1): one per browser, shared by every page.
//
//   await town.ready()          loads the AVL backend (real Ergo AVL+ wasm, fallback simulated), restores the
//                               log from IndexedDB (or creates the genesis town) and joins the tab election
//   town.store                  zustand vanilla store (TownState), updated at most once per animation frame
//   town.pay(...), redeem(...)  typed outcomes (ok, code, eval, tx, toast); a follower tab forwards to the leader
//   town.clock.setSpeed(...)    paused | realistic | fast | turbo; mine(n), tick(n)
//
// Only the leader tab runs the clock, the bots and persistence. Follower tabs ingest the leader's events
// (BroadcastChannel) and stay in sync; their commands run in the leader and the outcome comes back. While the
// leader tab is hidden, a visible follower ticks its clock ("drive"), because hidden tabs get throttled timers.
import { createStore, type StoreApi } from "zustand/vanilla";
import { pulse, type Pulse } from "@/app/pulse";
import { Economy, type AvlBackend, type DenomId, type EconomyEvent, type Hex } from "@/protocol";
import { ensureAvl, type AvlInfo } from "./avl";
import { fmtDenom } from "./format";
import { chunked, FrameBatcher, now } from "./frame";
import { SandboxWallet, type WalletIdentity } from "./identity";
import { toPlain, type AnyOutcome, type OutcomeBase, type Toast } from "./outcome";
import { openBestKV, TownLog, type KV, type StorageKind } from "./persist";
import { browserTabEnv, electLeader, type ChannelLike, type TabEnv, type TabMessage, type TabRole } from "./tabs";
import { answerRequests, runBots, type PaymentRequest } from "./town/bots";
import {
  cmdCancelRequest,
  cmdCompleteRefund,
  cmdContact,
  cmdCreateReserve,
  cmdExchange,
  cmdFaucet,
  cmdInitiateRefund,
  cmdJoin,
  cmdNovate,
  cmdPay,
  cmdRedeem,
  cmdRequest,
  cmdSetCreditLine,
  cmdSetPolicy,
  cmdTopUp,
  cmdTracker,
  faucetReadyIn,
  previewPay,
  previewRedeem,
  type CommandArgs,
  type CommandContext,
  type CommandName,
  type CommandResults,
} from "./town/commands";
import { buildTown, GENESIS_HISTORY_BLOCKS, TOWN_SEED, TOWN_TRACKER, YOU } from "./town/genesis";
import { cloneWorld, emptyWorld, HIDDEN_BLOCK_MS, SPEED_BLOCK_MS, worldFromJson, worldToJson, type Contact, type Speed, type WorldData } from "./town/worlddata";
import { commitChangedKeys } from "./views";

export { ensureAvl, type AvlInfo } from "./avl";

// ---------------------------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------------------------

export type TownStatus = "idle" | "booting" | "restoring" | "waiting-leader" | "ready" | "error";

export interface TownClock {
  speed: Speed;
  /** Real milliseconds per block right now (null = paused). */
  blockMs: number | null;
  /** The tab that runs the town is hidden. */
  hidden: boolean;
  /** A visible tab is ticking the clock of the hidden one. */
  driven: boolean;
  running: boolean;
}

export interface TownNotice extends Toast {
  id: number;
  height: number;
  at: number;
}

export interface TownState {
  /** Bumps once per frame in which anything changed. Select it to re-render on every change. */
  v: number;
  status: TownStatus;
  error: string | null;
  /** The live economy. Read it; never mutate it from a page (use the commands). */
  eco: Economy | null;
  height: number;
  events: number;
  avl: AvlInfo | null;
  /** leader: this tab runs the town; follower: another tab does (commands are forwarded); solo: no Web Locks. */
  role: TabRole | null;
  clock: TownClock;
  persistence: { kind: StorageKind | null; savedEvents: number; saving: boolean; error: string | null };
  /** How the town was loaded: replay time, number of events, restored or new, a note on recovery. */
  load: { ms: number; events: number; restored: boolean; note: string | null; progress: number };
  joined: boolean;
  /** Blocks until the faucet can refill (0 = now). */
  faucetIn: number;
  requests: PaymentRequest[];
  contacts: Contact[];
  /** The latest tracker commitment in the town (live ones also go to the pulse bus). */
  lastCommit: Pulse | null;
  /** The latest notices about You, newest first (at most 20). */
  notices: TownNotice[];
  epoch: string | null;
}

export interface TownOptions {
  kv?: KV | (() => Promise<KV>);
  /** null = a single tab (no election). Default: Web Locks + BroadcastChannel. */
  tabs?: TabEnv | null;
  wallet?: SandboxWallet;
  /** "auto" (default) = real Ergo AVL+ with fallback; or a backend. */
  avl?: AvlBackend | "auto";
  seed?: string;
  /** Genesis time of a new town (default: now minus the history span, so the history ends "now"). */
  genesisTimeMs?: bigint | (() => bigint);
  /** Run the block clock when leading (default true). Tests turn it off and call tick/mine. */
  autoClock?: boolean;
  saveDebounceMs?: number;
  /** Send tracker commitments to the pulse bus (default true). */
  pulses?: boolean;
  /** How long a follower waits for the leader to answer a command (default 8 s). */
  rpcTimeoutMs?: number;
  /** Watch document visibility (default true). */
  watchVisibility?: boolean;
}

/** An outcome before the router fills in its event range. */
type Draft<T> = T extends unknown ? Omit<T, "events"> & { events?: OutcomeBase["events"] } : never;
type DraftOutcome = Draft<AnyOutcome>;
type RpcName = CommandName | "reconcile";

const newEpoch = () => `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;

function defaultGenesisTime(): bigint {
  return BigInt(Math.floor(Date.now() / 60_000) * 60_000 - GENESIS_HISTORY_BLOCKS * 120_000);
}

const COMMAND_KIND: Record<CommandName, AnyOutcome["kind"]> = {
  join: "join",
  faucet: "faucet",
  pay: "pay",
  selfNote: "self-note",
  request: "request",
  cancelRequest: "request.cancel",
  redeem: "redeem",
  createReserve: "reserve.create",
  topUp: "reserve.top-up",
  initiateRefund: "reserve.initiate-refund",
  completeRefund: "reserve.complete-refund",
  novate: "novate",
  exchange: "exchange",
  setPolicy: "policy",
  setCreditLine: "credit-line",
  contact: "contact",
  tracker: "tracker",
  setSpeed: "clock",
  mine: "clock",
  tick: "clock",
  reset: "reset",
};

/** Commands that change world data (requests, contacts, settings) besides the event log. */
const WORLD_COMMANDS = new Set<CommandName>(["join", "request", "cancelRequest", "contact", "setSpeed", "reset"]);

function failure(kind: AnyOutcome["kind"], code: string, message: string): DraftOutcome {
  return { ok: false, kind, code, message, toast: { kind: "alarm", titleKey: "world.toast.refused", detailKey: `world.code.${code}`, params: { code }, sticky: true } } as DraftOutcome;
}

function lastCommitPulse(eco: Economy): Pulse | null {
  for (let i = eco.events.length - 1; i >= 0; i--) {
    const e = eco.events[i];
    if (e.type === "tracker.committed") return { source: "sandbox", trackerId: e.tracker, digest: e.digest, height: e.creationHeight, noteKeys: commitChangedKeys(eco, e.seq) };
  }
  return null;
}

function diffRequests(before: PaymentRequest[], after: PaymentRequest[]): PaymentRequest[] {
  const m = new Map(before.map((r) => [r.id, r.status]));
  return after.filter((r) => m.get(r.id) === "pending" && r.status !== "pending");
}

export class Town {
  readonly store: StoreApi<TownState>;
  readonly wallet: SandboxWallet;
  readonly seed: string;

  private readonly opts: TownOptions;
  private eco: Economy | null = null;
  private unsubEco: (() => void) | null = null;
  private world: WorldData = emptyWorld();
  private worldRev = 0;
  private publishedWorldRev = -1;
  private avl: AvlBackend | null = null;
  private avlInfo: AvlInfo | null = null;
  private kv: KV | null = null;
  private log: TownLog | null = null;
  private epoch: string | null = null;
  private role: TabRole | null = null;
  private tabEnv: TabEnv | null = null;
  private channel: ChannelLike | null = null;
  private stopElection: (() => void) | null = null;
  private bootPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readonly readyPromise: Promise<void>;
  private leaderReady = false;
  private queue: Promise<unknown> = Promise.resolve();
  private resetting = false;
  private disposed = false;
  // tabs
  private pendingHellos: Array<Extract<TabMessage, { t: "hello" }>> = [];
  private pendingRpcs: Array<Extract<TabMessage, { t: "rpc" }>> = [];
  private outbox: EconomyEvent[] = [];
  private outboxScheduled = false;
  private rpcSeq = 0;
  private rpcPending = new Map<number, { resolve: (v: unknown) => void; timer: ReturnType<typeof setTimeout>; cmd: RpcName }>();
  private helloTimer: ReturnType<typeof setInterval> | null = null;
  private helloAt = -Infinity;
  private leaderSeenAt = 0;
  private syncing: { epoch: string; buffered: EconomyEvent[] } | null = null;
  private syncGen = 0;
  private remoteClock: TownClock | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  // clock
  private clockTimer: ReturnType<typeof setTimeout> | null = null;
  private driveTimer: ReturnType<typeof setInterval> | null = null;
  private driveMs: number | null = null;
  private driveAt = -Infinity;
  private lastTickAt = -Infinity;
  private hidden = false;
  // persistence
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;
  private saveAgain = false;
  /** A save asked for while one was running must not wait for the debounce (a person's action, page hide). */
  private saveUrgent = false;
  private persistError: string | null = null;
  // live effects
  private live = false;
  private noticeSeq = 0;
  private notices: TownNotice[] = [];
  private noticeListeners = new Set<(n: TownNotice) => void>();
  private eventListeners = new Set<(events: readonly EconomyEvent[]) => void>();
  private lastCommit: Pulse | null = null;
  private loadInfo: TownState["load"] = { ms: 0, events: 0, restored: false, note: null, progress: 0 };
  private readonly batch: FrameBatcher;
  private idleTimer: ReturnType<typeof setInterval> | null = null;
  private status: TownStatus = "idle";
  private error: string | null = null;
  private cleanup: Array<() => void> = [];

  constructor(opts: TownOptions = {}) {
    this.opts = opts;
    this.seed = opts.seed ?? TOWN_SEED;
    this.wallet = opts.wallet ?? new SandboxWallet();
    this.readyPromise = new Promise((r) => (this.readyResolve = r));
    this.batch = new FrameBatcher(() => this.publish());
    this.store = createStore<TownState>(() => this.snapshot(0, undefined));
    this.cleanup.push(this.wallet.onChange(() => this.onWalletChange()));
  }

  // ===========================================================================================
  // boot and roles
  // ===========================================================================================

  /**
   * Boots once (idempotent). Resolves when the town can be read and commanded from this tab: at once in the
   * leader tab, after the first sync in a follower tab (status "waiting-leader" until then).
   */
  ready(): Promise<void> {
    this.bootPromise ??= this.boot().catch((e) => {
      this.status = "error";
      this.error = (e as Error)?.message ?? String(e);
      this.publish();
      throw e;
    });
    return this.bootPromise.then(() => this.readyPromise);
  }

  /** The live economy once ready (null before). Read-only for pages. */
  get economy(): Economy | null {
    return this.eco;
  }

  get tabRole(): TabRole | null {
    return this.role;
  }

  private async boot(): Promise<void> {
    this.status = "booting";
    this.publish();
    if (this.opts.avl && this.opts.avl !== "auto") {
      this.avl = this.opts.avl;
      this.avlInfo = { id: this.avl.id, simulated: this.avl.simulated, fallback: false, label: this.avl.label, error: null, loadMs: 0 };
    } else {
      const { backend, info } = await ensureAvl();
      this.avl = backend;
      this.avlInfo = info;
    }
    const kvOpt = this.opts.kv;
    this.kv = kvOpt ? (typeof kvOpt === "function" ? await kvOpt() : kvOpt) : await openBestKV();
    const key = `town/${this.seed}/${this.avl.id}`;
    this.log = new TownLog(this.kv, key, 256); // ~256 events per chunk: a save rewrites at most ~100 KB
    if (this.opts.watchVisibility !== false) this.watchVisibility();
    this.tabEnv = this.opts.tabs === undefined ? browserTabEnv() : this.opts.tabs;
    const lockName = `basis-world:${key}`;
    if (this.tabEnv) {
      this.channel = this.tabEnv.channel(lockName);
      if (this.channel) this.channel.onmessage = (ev) => this.onMessage(ev.data as TabMessage);
      this.stopElection = electLeader(this.tabEnv, lockName, (role) => void this.onRole(role));
    } else void this.onRole("solo");
  }

  private get tabId(): string {
    return this.tabEnv?.tabId ?? "solo";
  }

  /** A follower holds the leader's current history. */
  private get synced(): boolean {
    return !!this.eco && this.epoch !== null && !this.syncing;
  }

  private async onRole(role: TabRole): Promise<void> {
    if (this.disposed) return;
    const was = this.role;
    this.role = role;
    if (role === "follower") {
      this.becomeFollower(was === "leader" || was === "solo");
      return;
    }
    if (this.helloTimer) clearInterval(this.helloTimer);
    this.helloTimer = null;
    this.stopDrive();
    this.syncing = null;
    if (role === "solo") this.post({ t: "solo", from: this.tabId });
    if (!this.eco) await this.restoreOrCreate();
    else {
      // promoted follower: it holds the history the leader broadcast and becomes the writer
      this.epoch ??= newEpoch();
      this.attachEco(this.eco);
      void this.saveNow();
    }
    if (this.role !== role || this.disposed) return; // demoted meanwhile (two tabs without Web Locks)
    this.reconcileWallet();
    this.leaderReady = true;
    this.status = "ready";
    this.startClock();
    this.heartbeatTimer ??= setInterval(() => this.postClock(), 5000);
    this.startIdleWork();
    this.publish();
    this.readyResolve?.();
    this.postClock();
    for (const h of this.pendingHellos.splice(0)) this.answerHello(h);
    for (const m of this.pendingRpcs.splice(0)) void this.answerRpc(m);
  }

  private becomeFollower(demoted: boolean): void {
    this.stopClock();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (demoted) {
      // this tab ran the town until now and its history may differ from the leader's: take the leader's log
      this.unsubEco?.();
      this.unsubEco = null;
      this.leaderReady = false;
      this.epoch = null;
    }
    this.status = this.eco ? "ready" : "waiting-leader";
    this.leaderSeenAt = now();
    this.publish();
    this.sendHello(true);
    this.helloTimer ??= setInterval(() => {
      if (this.role !== "follower") return;
      if (!this.synced) this.sendHello();
      // without Web Locks nobody promotes us: take over when the other tab has gone quiet
      else if (!this.tabEnv?.locks && now() - this.leaderSeenAt > 15_000) void this.onRole("solo");
    }, 2000);
    this.updateDrive();
  }

  private async restoreOrCreate(): Promise<void> {
    const t0 = now();
    this.status = "restoring";
    this.publish();
    let note: string | null = null;
    let loaded: Awaited<ReturnType<TownLog["load"]>> = null;
    try {
      loaded = await this.log!.load();
    } catch (e) {
      note = `the stored town could not be read (${(e as Error).message}); a new town was created`;
      await this.log!.clear().catch(() => {});
    }
    let eco: Economy | null = null;
    if (loaded && loaded.meta.seed === this.seed && loaded.meta.backend === this.avl!.id && loaded.events.length > 0) {
      try {
        eco = await this.replayChunked(loaded.events);
        this.world = worldFromJson(loaded.meta.world);
        this.epoch = loaded.meta.epoch;
      } catch (e) {
        note = `the stored town did not replay (${(e as Error).message}); a new town was created`;
        eco = null;
        await this.log!.clear().catch(() => {});
      }
    }
    const restored = !!eco;
    if (!eco) {
      eco = this.genesis();
      this.world = emptyWorld();
      this.epoch = newEpoch();
    }
    this.attachEco(eco);
    this.lastCommit = lastCommitPulse(eco);
    this.loadInfo = { ms: now() - t0, events: eco.events.length, restored, note, progress: 1 };
    this.worldRev++;
    if (!restored) await this.saveNow();
  }

  private genesis(): Economy {
    const g = this.opts.genesisTimeMs;
    const genesisTimeMs = typeof g === "function" ? g() : (g ?? defaultGenesisTime());
    return buildTown({ seed: this.seed, genesisTimeMs, avl: this.avl! });
  }

  /** Replays a log in ~12 ms slices, so a long log never freezes the page. */
  private async replayChunked(events: EconomyEvent[]): Promise<Economy> {
    const eco = Economy.replay([events[0]], { avl: this.avl! });
    await chunked(events.length - 1, (i) => eco.ingest(events[i + 1]), {
      budgetMs: 12,
      onProgress: (n) => {
        this.loadInfo = { ...this.loadInfo, progress: n / Math.max(1, events.length - 1) };
      },
    });
    return eco;
  }

  private attachEco(eco: Economy): void {
    this.unsubEco?.();
    this.eco = eco;
    this.live = true;
    this.unsubEco = this.role === "follower" ? null : eco.subscribe((e) => this.onLocalEvent(e));
  }

  // ===========================================================================================
  // wallet and town
  // ===========================================================================================

  /** Boot: the town has You but this browser lost the key record: take it back from the town's log. */
  private reconcileWallet(): void {
    const you = this.eco?.participants.get(YOU);
    if (you && !this.wallet.identity && you.keySource.source === "secret") {
      this.wallet.importHex(you.keySource.secretHex, { source: "restored", replace: true, name: you.name === "You" ? undefined : you.name });
    }
  }

  /** Runtime: a different or wiped key starts a new town (the old one is tied to the old key). Leader only. */
  private async reconcileNow(): Promise<void> {
    const eco = this.eco;
    if (!eco || !this.leaderReady || this.role === "follower") return;
    const you = eco.participants.get(YOU);
    const id = this.wallet.identity;
    if (you && (!id || id.pubHex !== you.pub)) await this.doReset({ rejoin: false, reason: id ? "new-key" : "wiped" });
  }

  private onWalletChange(): void {
    this.batch.mark();
    if (this.role === "follower") {
      if (this.synced) void this.rpc("reconcile", {} as never);
      return;
    }
    if (this.leaderReady) void this.enqueue(() => this.reconcileNow());
  }

  // ===========================================================================================
  // events
  // ===========================================================================================

  private onLocalEvent(e: EconomyEvent): void {
    this.outbox.push(e);
    if (!this.outboxScheduled) {
      this.outboxScheduled = true;
      queueMicrotask(() => this.flushOutbox());
    }
    this.handleLive([e]);
    this.scheduleSave();
  }

  private flushOutbox(): void {
    this.outboxScheduled = false;
    if (!this.outbox.length) return;
    const events = this.outbox.splice(0);
    if (this.channel && this.epoch && this.role !== "follower") this.post({ t: "events", from: this.tabId, epoch: this.epoch, base: events[0].seq, events });
  }

  /** Pulses, notices and listeners for events applied live (never during a restore). */
  private handleLive(events: readonly EconomyEvent[]): void {
    const eco = this.eco;
    if (!eco || !this.live) return;
    for (const e of events) {
      let keys: Hex[] | null = null;
      if (e.type === "tracker.committed") {
        keys = commitChangedKeys(eco, e.seq);
        const p: Pulse = { source: "sandbox", trackerId: e.tracker, digest: e.digest, height: e.creationHeight, noteKeys: keys };
        this.lastCommit = p;
        if (this.opts.pulses !== false) pulse.commit(p);
      }
      const n = this.noticeFor(eco, e, keys);
      if (n) this.pushNotice(n, e.height);
    }
    for (const l of [...this.eventListeners]) {
      try {
        l(events);
      } catch {
        /* a page's listener must not stop the town */
      }
    }
    this.batch.mark();
  }

  private noticeFor(eco: Economy, e: EconomyEvent, keys: Hex[] | null): Toast | null {
    if (!eco.participants.has(YOU)) return null;
    const at = (id: string) => `@${id}`;
    const amount = (v: bigint, d: DenomId) => fmtDenom(eco, v, d);
    switch (e.type) {
      case "note.issued":
        if (e.receiver === YOU && e.issuer !== YOU) return { kind: "up", titleKey: "world.notice.noteIn", detailKey: "world.notice.noteInDetail", params: { from: at(e.issuer), total: amount(e.totalDebt, e.denom), delta: amount(e.amount, e.denom) }, refs: { participant: e.issuer, noteKey: e.key } };
        return null;
      case "reserve.redeemed":
        if (e.issuer === YOU && e.receiver !== YOU) return { kind: "metal", titleKey: "world.notice.redeemedFromYou", params: { by: at(e.receiver), amount: amount(e.amount, e.denom) }, refs: { participant: e.receiver, reserve: e.reserve, txId: e.txId } };
        return null;
      case "tracker.committed": {
        const mine = this.myKeys(eco);
        const n = (keys ?? []).filter((k) => mine.has(k)).length;
        if (!n) return null;
        return { kind: "proof", titleKey: "world.notice.committed", params: { tracker: e.tracker, n: String(n), digest: e.digest.slice(0, 8) } };
      }
      case "nostr":
        if ((e.kind === "alert-80" || e.kind === "alert-100") && e.issuer === YOU) return { kind: "alarm", titleKey: e.kind === "alert-100" ? "world.notice.alert100" : "world.notice.alert80", params: { ratio: e.ratio !== undefined ? String(Math.round(e.ratio * 100)) : "" }, sticky: true };
        return null;
      case "reserve.refundInitiated": {
        const r = eco.reserves.get(e.reserve);
        const owner = r ? eco.idOf(r.owner) : undefined;
        if (!r || !owner || owner === YOU) return null;
        const holds = eco.t(TOWN_TRACKER).notesOfReceiver(eco.p(YOU).pub, r.denom).some((n) => n.issuer === r.owner && n.totalDebt > n.amountRedeemed);
        return holds ? { kind: "alarm", titleKey: "world.notice.refundStarted", params: { owner: at(owner), unlock: String(r.refundUnlockHeight() ?? "") }, sticky: true, refs: { participant: owner, reserve: e.reserve } } : null;
      }
      case "tracker.status":
        return e.online ? { kind: "info", titleKey: "world.notice.trackerOnline", params: { tracker: e.tracker } } : { kind: "alarm", titleKey: "world.notice.trackerOffline", params: { tracker: e.tracker }, sticky: true };
      default:
        return null;
    }
  }

  private myKeys(eco: Economy): Set<Hex> {
    const pub = eco.p(YOU).pub;
    const out = new Set<Hex>();
    for (const t of eco.trackers.values()) {
      for (const r of t.notesOfIssuer(pub)) out.add(r.key);
      for (const r of t.notesOfReceiver(pub)) out.add(r.key);
    }
    return out;
  }

  private pushNotice(t: Toast, height: number): void {
    const n: TownNotice = { ...t, id: ++this.noticeSeq, height, at: Date.now() };
    this.notices = [n, ...this.notices].slice(0, 20);
    for (const l of [...this.noticeListeners]) {
      try {
        l(n);
      } catch {
        /* ignore */
      }
    }
  }

  private requestNotices(changed: PaymentRequest[]): void {
    const eco = this.eco;
    if (!eco) return;
    for (const r of changed) {
      const params = { from: `@${r.from}`, amount: fmtDenom(eco, r.amount, r.denom), code: r.code ?? "" };
      if (r.status === "paid") this.pushNotice({ kind: "up", titleKey: "world.notice.requestPaid", params, refs: { participant: r.from, requestId: r.id } }, r.resolvedHeight ?? eco.clock.height);
      else if (r.status === "declined" || r.status === "refused") this.pushNotice({ kind: "info", titleKey: "world.notice.requestDeclined", detailKey: r.code ? `world.code.${r.code}` : undefined, params, refs: { participant: r.from, requestId: r.id } }, r.resolvedHeight ?? eco.clock.height);
    }
  }

  // ===========================================================================================
  // tabs
  // ===========================================================================================

  private post(msg: TabMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      /* channel closed */
    }
  }

  private sendHello(force = false): void {
    if (!force && now() - this.helloAt < 1500) return;
    this.helloAt = now();
    this.post({ t: "hello", from: this.tabId, epoch: this.epoch, have: this.synced ? this.eco!.events.length : 0 });
  }

  private postClock(): void {
    if (this.epoch && this.role !== "follower") this.post({ t: "clock", from: this.tabId, epoch: this.epoch, clock: this.clockState() });
  }

  private postWorld(): void {
    if (this.epoch && this.role !== "follower") this.post({ t: "world", from: this.tabId, epoch: this.epoch, world: worldToJson(this.world) });
  }

  private answerHello(h: Extract<TabMessage, { t: "hello" }>): void {
    const eco = this.eco;
    if (!eco || !this.epoch) return;
    this.flushOutbox();
    const base = h.epoch === this.epoch && h.have > 0 && h.have <= eco.events.length ? h.have : 0;
    this.post({ t: "snapshot", from: this.tabId, to: h.from, epoch: this.epoch, base, events: eco.events.slice(base), world: worldToJson(this.world), clock: this.clockState() });
  }

  private onMessage(m: TabMessage): void {
    if (this.disposed || !m || typeof m !== "object" || (m as { from?: string }).from === this.tabId) return;
    if (this.role === "leader" || this.role === "solo") {
      switch (m.t) {
        case "hello":
          if (this.leaderReady) this.answerHello(m);
          else this.pendingHellos.push(m);
          return;
        case "rpc":
          if (this.leaderReady) void this.answerRpc(m);
          else this.pendingRpcs.push(m);
          return;
        case "drive":
          this.onDrive(m);
          return;
        case "solo":
          // two tabs without Web Locks: the larger tab id gives way
          if (this.role === "solo") {
            if (this.tabId > m.from) void this.onRole("follower");
            else this.post({ t: "solo", from: this.tabId });
          }
          return;
        default:
          return;
      }
    }
    switch (m.t) {
      case "snapshot":
        this.leaderSeenAt = now();
        if (m.to === this.tabId) void this.applySnapshot(m);
        return;
      case "events":
        this.leaderSeenAt = now();
        this.applyRemoteEvents(m.epoch, m.base, m.events as EconomyEvent[]);
        return;
      case "world":
        this.leaderSeenAt = now();
        if (m.epoch === this.epoch && !this.syncing) {
          const before = this.world;
          this.world = worldFromJson(m.world as string);
          this.worldRev++;
          this.requestNotices(diffRequests(before.requests, this.world.requests));
          this.batch.mark();
        }
        return;
      case "clock":
        this.leaderSeenAt = now();
        if (!this.synced) this.sendHello();
        else if (m.epoch !== this.epoch) {
          this.epoch = null;
          this.sendHello(true);
        } else {
          this.remoteClock = m.clock as TownClock;
          this.updateDrive();
          this.batch.mark();
        }
        return;
      case "reset":
        this.leaderSeenAt = now();
        this.epoch = null;
        this.syncing = null;
        this.sendHello(true);
        return;
      case "rpc-result": {
        this.leaderSeenAt = now();
        if (m.to !== this.tabId) return;
        const p = this.rpcPending.get(m.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.rpcPending.delete(m.id);
        this.batch.flushNow();
        p.resolve(m.ok ? m.result : { ...failure(p.cmd === "reconcile" ? "reset" : COMMAND_KIND[p.cmd], "tab-error", m.error ?? "the tab running the town failed"), events: null });
        return;
      }
      default:
        return;
    }
  }

  private async applySnapshot(m: Extract<TabMessage, { t: "snapshot" }>): Promise<void> {
    const events = m.events as EconomyEvent[];
    if (m.base === 0) {
      if (!events.length) return;
      const gen = ++this.syncGen;
      this.syncing = { epoch: m.epoch, buffered: [] };
      const t0 = now();
      let eco: Economy;
      try {
        eco = await this.replayChunked(events);
      } catch (e) {
        if (gen === this.syncGen) this.syncing = null;
        this.error = `sync failed: ${(e as Error).message}`;
        this.batch.mark();
        return;
      }
      if (gen !== this.syncGen || this.role !== "follower" || this.disposed) return; // superseded or promoted meanwhile
      const buffered = this.syncing?.epoch === m.epoch ? this.syncing.buffered : [];
      this.syncing = null;
      this.unsubEco?.();
      this.unsubEco = null;
      this.eco = eco;
      this.live = true;
      this.notices = [];
      this.lastCommit = lastCommitPulse(eco);
      this.loadInfo = { ms: now() - t0, events: events.length, restored: true, note: null, progress: 1 };
      this.epoch = m.epoch;
      if (buffered.length) this.ingest(buffered);
    } else if (this.eco && !this.syncing && m.epoch === this.epoch && m.base <= this.eco.events.length) {
      this.ingest(events); // an answer to an older hello may overlap: ingest skips what we already have
    } else {
      this.epoch = null;
      this.sendHello(true);
      return;
    }
    this.world = worldFromJson(m.world as string);
    this.worldRev++;
    this.remoteClock = m.clock as TownClock;
    this.status = "ready";
    this.error = null;
    this.readyResolve?.();
    this.startIdleWork();
    this.updateDrive();
    this.batch.mark();
  }

  private applyRemoteEvents(epoch: string, base: number, events: EconomyEvent[]): void {
    if (this.syncing) {
      if (epoch === this.syncing.epoch) this.syncing.buffered.push(...events);
      return;
    }
    const eco = this.eco;
    if (!eco || epoch !== this.epoch) {
      if (eco && this.epoch) this.epoch = null; // the leader started a new town: take it whole
      this.sendHello();
      return;
    }
    if (base > eco.events.length) {
      this.sendHello(); // we missed some: the answer carries the tail from our length
      return;
    }
    this.ingest(events);
  }

  private ingest(events: EconomyEvent[]): void {
    const eco = this.eco!;
    const applied: EconomyEvent[] = [];
    for (const e of events) {
      if (e.seq < eco.events.length) continue;
      if (e.seq > eco.events.length) {
        this.sendHello();
        break;
      }
      try {
        eco.ingest(e);
      } catch {
        this.epoch = null; // our copy no longer matches the leader's history: resync from scratch
        this.sendHello(true);
        break;
      }
      applied.push(e);
    }
    if (applied.length) this.handleLive(applied);
  }

  private async answerRpc(m: Extract<TabMessage, { t: "rpc" }>): Promise<void> {
    let reply: TabMessage;
    try {
      const result =
        m.cmd === "reconcile"
          ? await this.enqueue(async () => {
              this.wallet.reloadFromStorage();
              await this.reconcileNow();
              return { ok: true };
            })
          : await this.execLocal(m.cmd as CommandName, m.args as never);
      this.flushOutbox(); // the follower must hold the command's events before it sees the outcome
      reply = { t: "rpc-result", from: this.tabId, to: m.from, id: m.id, ok: true, result };
    } catch (e) {
      reply = { t: "rpc-result", from: this.tabId, to: m.from, id: m.id, ok: false, error: (e as Error)?.message ?? String(e) };
    }
    this.post(reply);
  }

  private rpc(cmd: RpcName, args: unknown): Promise<unknown> {
    const id = ++this.rpcSeq;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.rpcPending.delete(id);
        resolve({ ...failure(cmd === "reconcile" ? "reset" : COMMAND_KIND[cmd], "tab-timeout", "the tab running the town did not answer"), events: null });
      }, this.opts.rpcTimeoutMs ?? 8000);
      this.rpcPending.set(id, { resolve, timer, cmd });
      this.post({ t: "rpc", from: this.tabId, id, cmd, args });
    });
  }

  // ===========================================================================================
  // commands
  // ===========================================================================================

  private enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const p = this.queue.then(fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Runs a command: here when this tab leads, otherwise in the leader tab. */
  async run<K extends CommandName>(cmd: K, args: CommandArgs[K]): Promise<CommandResults[K]> {
    await this.ready();
    if (this.role === "follower") return (await this.rpc(cmd, args)) as CommandResults[K];
    return this.execLocal(cmd, args);
  }

  private ctx(): CommandContext {
    const id = this.wallet.identity;
    return { eco: this.eco!, world: this.world, wallet: { secretHex: this.wallet.secretHex(), pubHex: id?.pubHex ?? null, name: id?.name ?? null } };
  }

  private execLocal<K extends CommandName>(cmd: K, args: CommandArgs[K]): Promise<CommandResults[K]> {
    return this.enqueue(async () => {
      // another tab may have changed the key a moment ago; its storage event can arrive after this command
      this.wallet.reloadFromStorage();
      await this.reconcileNow();
      const eco0 = this.eco!;
      const from = eco0.events.length;
      const requestsBefore = this.world.requests.map((r) => r.status).join();
      let out: DraftOutcome;
      try {
        out = await this.dispatch(cmd, args);
      } catch (e) {
        out = failure(COMMAND_KIND[cmd], "error", (e as Error)?.message ?? String(e));
      }
      const to = (this.eco?.events.length ?? 0) - 1;
      const events = out.events !== undefined ? out.events : this.eco === eco0 && to >= from ? { from, to } : null;
      if (WORLD_COMMANDS.has(cmd) || this.world.requests.map((r) => r.status).join() !== requestsBefore) this.worldChanged();
      this.flushOutbox();
      this.batch.mark();
      this.batch.flushNow();
      // a person's action is stored at once (a reload right after joining or paying must not lose it)
      if (out.ok && (events !== null || WORLD_COMMANDS.has(cmd))) void this.saveNow(true);
      return toPlain({ ...out, events }) as unknown as CommandResults[K];
    });
  }

  private async dispatch(cmd: CommandName, a: unknown): Promise<DraftOutcome> {
    const ctx = this.ctx();
    switch (cmd) {
      case "join":
        return cmdJoin(ctx, a as CommandArgs["join"]);
      case "faucet":
        return cmdFaucet(ctx);
      case "pay":
        return cmdPay(ctx, a as CommandArgs["pay"]);
      case "selfNote": {
        const s = a as CommandArgs["selfNote"];
        return cmdPay(ctx, { to: YOU, amount: s.amount, denom: s.denom, memo: s.memo }, "self-note");
      }
      case "request":
        return cmdRequest(ctx, a as CommandArgs["request"]);
      case "cancelRequest":
        return cmdCancelRequest(ctx, a as CommandArgs["cancelRequest"]);
      case "redeem":
        return cmdRedeem(ctx, a as CommandArgs["redeem"]);
      case "createReserve":
        return cmdCreateReserve(ctx, a as CommandArgs["createReserve"]);
      case "topUp":
        return cmdTopUp(ctx, a as CommandArgs["topUp"]);
      case "initiateRefund":
        return cmdInitiateRefund(ctx, a as CommandArgs["initiateRefund"]);
      case "completeRefund":
        return cmdCompleteRefund(ctx, a as CommandArgs["completeRefund"]);
      case "novate":
        return cmdNovate(ctx, a as CommandArgs["novate"]);
      case "exchange":
        return cmdExchange(ctx, a as CommandArgs["exchange"]);
      case "setPolicy":
        return cmdSetPolicy(ctx, a as CommandArgs["setPolicy"]);
      case "setCreditLine":
        return cmdSetCreditLine(ctx, a as CommandArgs["setCreditLine"]);
      case "contact":
        return cmdContact(ctx, a as CommandArgs["contact"]);
      case "tracker":
        return cmdTracker(ctx, a as CommandArgs["tracker"]);
      case "setSpeed": {
        const { speed } = a as CommandArgs["setSpeed"];
        if (!(speed in SPEED_BLOCK_MS)) return failure("clock", "invalid-speed", `unknown speed ${String(speed)}`);
        this.world.settings.speed = speed;
        this.startClock();
        this.postClock();
        return { ok: true, kind: "clock", detail: { speed }, toast: { kind: "info", titleKey: `world.toast.speed.${speed}`, params: {} } };
      }
      case "mine": {
        const n = Math.max(0, Math.min(1_000_000, Math.floor(Number((a as CommandArgs["mine"]).blocks) || 0)));
        this.eco!.mine(n);
        const changed = this.answerDue();
        return { ok: true, kind: "clock", detail: { blocks: n, height: this.eco!.clock.height, requests: changed.length }, toast: { kind: "info", titleKey: "world.toast.mined", params: { n: String(n), height: String(this.eco!.clock.height) } } };
      }
      case "tick": {
        const n = Math.max(0, Math.min(10_000, Math.floor(Number((a as CommandArgs["tick"]).blocks) || 0)));
        this.tickBlocks(n);
        return { ok: true, kind: "clock", detail: { blocks: n, height: this.eco!.clock.height }, toast: { kind: "info", titleKey: "world.toast.mined", params: { n: String(n), height: String(this.eco!.clock.height) } } };
      }
      case "reset":
        await this.doReset({ rejoin: true, reason: "reset" });
        return { ok: true, kind: "reset", events: null, toast: { kind: "info", titleKey: "world.toast.reset", params: {} } };
    }
  }

  /** Answers payment requests that are due (after a jump with `mine`, where the residents do not act). */
  private answerDue(): PaymentRequest[] {
    const changed = answerRequests(this.eco!, this.world.requests, this.eco!.clock.height);
    if (changed.length) {
      this.worldChanged();
      this.requestNotices(changed);
    }
    return changed;
  }

  /** Mines `n` blocks one by one with the residents acting after each (what the running clock does). */
  private tickBlocks(n: number): void {
    const eco = this.eco;
    if (!eco || this.resetting) return;
    for (let i = 0; i < n; i++) {
      eco.mine(1);
      const rep = runBots(eco, this.seed, this.world.requests);
      if (rep.requests.length) {
        this.worldChanged();
        this.requestNotices(rep.requests);
      }
    }
  }

  /** Starts the town again from genesis; with `rejoin`, You join again with the same key. Leader, in the queue. */
  private async doReset(o: { rejoin: boolean; reason: string }): Promise<void> {
    if (this.role === "follower" || !this.log) return;
    this.resetting = true;
    try {
      this.stopClock();
      if (this.saveTimer) clearTimeout(this.saveTimer);
      this.saveTimer = null;
      if (this.saving) await this.saving.catch(() => {});
      await this.log.clear().catch(() => {});
      const speed = this.world.settings.speed;
      this.live = false;
      const eco = this.genesis();
      this.world = emptyWorld();
      this.world.settings.speed = speed;
      this.epoch = newEpoch();
      this.attachEco(eco);
      this.notices = [];
      this.lastCommit = lastCommitPulse(eco);
      this.loadInfo = { ms: 0, events: eco.events.length, restored: false, note: o.reason === "reset" ? null : `the town was reset (${o.reason})`, progress: 1 };
      if (o.rejoin && this.wallet.hasKey) cmdJoin(this.ctx(), {});
      this.outbox = [];
      this.worldRev++;
      this.post({ t: "reset", from: this.tabId, epoch: this.epoch });
    } finally {
      this.resetting = false;
    }
    await this.saveNow();
    this.startClock();
    this.postClock();
    this.batch.mark();
  }

  private worldChanged(): void {
    this.worldRev++;
    if (this.role !== "follower") {
      this.postWorld();
      this.scheduleSave();
    }
    this.batch.mark();
  }

  // ===========================================================================================
  // clock
  // ===========================================================================================

  private clockState(): TownClock {
    if (this.role === "follower" && this.remoteClock) return this.remoteClock;
    const speed = this.world.settings.speed;
    const base = SPEED_BLOCK_MS[speed];
    const driven = this.hidden && base !== null && now() - this.driveAt < Math.max(3 * base, 3000);
    const blockMs = base === null ? null : this.hidden && !driven ? Math.max(base, HIDDEN_BLOCK_MS) : base;
    const running = base !== null && this.opts.autoClock !== false && (this.clockTimer !== null || driven);
    return { speed, blockMs, hidden: this.hidden, driven, running };
  }

  private startClock(): void {
    this.stopClock();
    if (this.role === "follower" || !this.eco || this.opts.autoClock === false || this.resetting || this.disposed) return;
    const base = SPEED_BLOCK_MS[this.world.settings.speed];
    if (base === null) return;
    const ms = this.hidden ? Math.max(base, HIDDEN_BLOCK_MS) : base;
    const due = Math.min(ms, Math.max(0, this.lastTickAt + ms - now()));
    this.clockTimer = setTimeout(() => {
      this.clockTimer = null;
      try {
        this.tick();
      } finally {
        this.startClock();
      }
    }, due);
  }

  private stopClock(): void {
    if (this.clockTimer) clearTimeout(this.clockTimer);
    this.clockTimer = null;
  }

  private tick(): void {
    if (this.resetting || !this.eco) return;
    this.lastTickAt = now();
    this.tickBlocks(1);
  }

  /** Leader: a visible follower ticks the clock while this tab is hidden. */
  private onDrive(m: Extract<TabMessage, { t: "drive" }>): void {
    if (!this.leaderReady || m.epoch !== this.epoch || !this.hidden || this.opts.autoClock === false) return;
    const base = SPEED_BLOCK_MS[this.world.settings.speed];
    if (base === null) return;
    const wasDriven = now() - this.driveAt < Math.max(3 * base, 3000);
    this.driveAt = now();
    if (now() - this.lastTickAt >= base * 0.75) this.tick(); // several visible tabs: still one block per period
    this.startClock(); // pushes this hidden tab's own slow timer back
    if (!wasDriven) {
      this.postClock();
      this.batch.mark();
    }
  }

  /** Follower: drive the leader's clock while the leader is hidden and this tab is visible. */
  private updateDrive(): void {
    const c = this.remoteClock;
    const base = c ? SPEED_BLOCK_MS[c.speed] : null;
    const want = this.role === "follower" && !this.hidden && !this.disposed && !!c && c.hidden && base !== null && this.synced;
    if (!want || base === null) {
      this.stopDrive();
      return;
    }
    if (this.driveTimer && this.driveMs === base) return;
    this.stopDrive();
    this.driveMs = base;
    const send = () => {
      if (this.epoch && this.role === "follower") this.post({ t: "drive", from: this.tabId, epoch: this.epoch });
    };
    send();
    this.driveTimer = setInterval(send, base);
  }

  private stopDrive(): void {
    if (this.driveTimer) clearInterval(this.driveTimer);
    this.driveTimer = null;
    this.driveMs = null;
  }

  private watchVisibility(): void {
    if (typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    this.hidden = document.visibilityState === "hidden";
    const onVis = () => this.setHidden(document.visibilityState === "hidden");
    const onHide = () => void this.saveNow(true);
    document.addEventListener("visibilitychange", onVis);
    if (typeof window !== "undefined") window.addEventListener("pagehide", onHide);
    this.cleanup.push(() => {
      document.removeEventListener("visibilitychange", onVis);
      if (typeof window !== "undefined") window.removeEventListener("pagehide", onHide);
    });
  }

  /** The tab became hidden or visible (the town watches document visibility itself; tests call this). */
  setHidden(hidden: boolean): void {
    if (hidden === this.hidden) return;
    this.hidden = hidden;
    if (this.role !== "follower") {
      this.startClock();
      this.postClock();
      if (hidden) void this.saveNow();
    } else this.updateDrive();
    this.batch.mark();
  }

  /** Signs lazily produced notes in idle time, so note cards open with their signatures ready. */
  private startIdleWork(): void {
    if (this.idleTimer || typeof window === "undefined") return;
    this.idleTimer = setInterval(() => {
      const eco = this.eco;
      if (this.hidden || !eco) return;
      const ric = (window as Window & { requestIdleCallback?: (cb: (d: { timeRemaining(): number }) => void) => number }).requestIdleCallback;
      if (ric) ric((d) => this.eco?.materialize(Math.min(6, d.timeRemaining())));
      else eco.materialize(4);
    }, 3000);
  }

  // ===========================================================================================
  // persistence
  // ===========================================================================================

  private scheduleSave(): void {
    if (this.role === "follower" || !this.log || this.saveTimer || this.disposed) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveNow();
    }, this.opts.saveDebounceMs ?? 1500);
  }

  /** Writes the log now (leader). Resolves when it is stored. */
  async saveNow(urgent = false): Promise<void> {
    if (this.role === "follower" || this.role === null || !this.log || !this.eco || !this.epoch || this.resetting) return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.saving) {
      this.saveAgain = true;
      if (urgent) this.saveUrgent = true;
      return this.saving;
    }
    const eco = this.eco;
    const epoch = this.epoch;
    this.saving = (async () => {
      try {
        await this.log!.save(eco.events, { epoch, backend: this.avl!.id, seed: this.seed, genesisTimeMs: String(eco.clock.genesisTimeMs), world: worldToJson(this.world) });
        this.persistError = null;
      } catch (e) {
        this.persistError = (e as Error)?.name === "QuotaExceededError" ? "storage is full: reset the town to keep saving" : ((e as Error)?.message ?? String(e));
      } finally {
        this.saving = null;
        this.batch.mark();
        if (this.saveAgain && this.saveUrgent) {
          this.saveAgain = false;
          this.saveUrgent = false;
          void this.saveNow();
        } else if (this.saveAgain) {
          this.saveAgain = false;
          this.scheduleSave();
        }
      }
    })();
    return this.saving;
  }

  // ===========================================================================================
  // store
  // ===========================================================================================

  private snapshot(v: number, prev: TownState | undefined): TownState {
    const eco = this.eco;
    const worldFresh = this.publishedWorldRev !== this.worldRev || !prev;
    const clock = this.clockState();
    const pc = prev?.clock;
    const sameClock = !!pc && pc.speed === clock.speed && pc.blockMs === clock.blockMs && pc.hidden === clock.hidden && pc.driven === clock.driven && pc.running === clock.running;
    const persistence = { kind: this.kv?.kind ?? null, savedEvents: this.log?.savedEvents ?? 0, saving: this.saving !== null, error: this.persistError };
    const pp = prev?.persistence;
    const samePersist = !!pp && pp.kind === persistence.kind && pp.savedEvents === persistence.savedEvents && pp.saving === persistence.saving && pp.error === persistence.error;
    const pl = prev?.load;
    const sameLoad = !!pl && pl.ms === this.loadInfo.ms && pl.progress === this.loadInfo.progress && pl.note === this.loadInfo.note && pl.events === this.loadInfo.events;
    return {
      v,
      status: this.status,
      error: this.error,
      eco,
      height: eco?.clock.height ?? 0,
      events: eco?.events.length ?? 0,
      avl: this.avlInfo,
      role: this.role,
      clock: sameClock ? pc! : clock,
      persistence: samePersist ? pp! : persistence,
      load: sameLoad ? pl! : { ...this.loadInfo },
      joined: !!eco?.participants.has(YOU),
      faucetIn: eco ? faucetReadyIn(eco) : 0,
      requests: worldFresh ? this.world.requests.map((r) => ({ ...r })) : prev!.requests,
      contacts: worldFresh ? this.world.contacts.map((c) => ({ ...c })) : prev!.contacts,
      lastCommit: this.lastCommit,
      notices: prev && prev.notices.length === this.notices.length && prev.notices[0] === this.notices[0] ? prev.notices : this.notices.slice(),
      epoch: this.epoch,
    };
  }

  private publish(): void {
    const prev = this.store?.getState();
    const next = this.snapshot((prev?.v ?? 0) + 1, prev);
    this.publishedWorldRev = this.worldRev;
    this.store.setState(next, true);
  }

  /** Applies pending store updates now (tests; pages never need it). */
  flush(): void {
    this.flushOutbox();
    this.batch.flushNow();
    this.publish();
  }

  // ===========================================================================================
  // public API
  // ===========================================================================================

  /** Notices about You (incoming notes, commitments of your notes, alerts, answered requests…). */
  onNotice(fn: (n: TownNotice) => void): () => void {
    this.noticeListeners.add(fn);
    return () => this.noticeListeners.delete(fn);
  }

  /** Engine events as they are applied live in this tab (leader or follower). */
  onEvents(fn: (events: readonly EconomyEvent[]) => void): () => void {
    this.eventListeners.add(fn);
    return () => this.eventListeners.delete(fn);
  }

  /** A copy of the world data (requests, contacts, settings). */
  worldData(): WorldData {
    return cloneWorld(this.world);
  }

  // --- wallet ---

  /** A new sandbox key. With `replace`, an existing key and the town it joined are discarded. */
  async createIdentity(o: { name?: string; replace?: boolean } = {}): Promise<WalletIdentity> {
    await this.ready();
    return this.wallet.create(o);
  }

  async importIdentity(hex: string, o: { name?: string; replace?: boolean } = {}): Promise<WalletIdentity> {
    await this.ready();
    return this.wallet.importHex(hex, o);
  }

  async importBackup(json: string, passphrase: string, o: { replace?: boolean } = {}): Promise<WalletIdentity> {
    await this.ready();
    return this.wallet.importBackup(json, passphrase, o);
  }

  /** Forgets the sandbox key in this browser and resets the town (its log holds the key too). */
  async wipeWallet(): Promise<void> {
    await this.ready();
    this.wallet.wipe();
    if (this.role === "follower") await this.rpc("reconcile", {});
    else await this.enqueue(() => this.reconcileNow());
  }

  join(a: CommandArgs["join"] = {}) {
    return this.run("join", a);
  }
  faucet() {
    return this.run("faucet", {});
  }
  pay(a: CommandArgs["pay"]) {
    return this.run("pay", a);
  }
  selfNote(a: CommandArgs["selfNote"]) {
    return this.run("selfNote", a);
  }
  request(a: CommandArgs["request"]) {
    return this.run("request", a);
  }
  cancelRequest(id: string) {
    return this.run("cancelRequest", { id });
  }
  redeem(a: CommandArgs["redeem"]) {
    return this.run("redeem", a);
  }
  createReserve(a: CommandArgs["createReserve"]) {
    return this.run("createReserve", a);
  }
  topUp(a: CommandArgs["topUp"]) {
    return this.run("topUp", a);
  }
  initiateRefund(a: CommandArgs["initiateRefund"]) {
    return this.run("initiateRefund", a);
  }
  completeRefund(a: CommandArgs["completeRefund"]) {
    return this.run("completeRefund", a);
  }
  novate(a: CommandArgs["novate"]) {
    return this.run("novate", a);
  }
  exchange(a: CommandArgs["exchange"]) {
    return this.run("exchange", a);
  }
  setPolicy(a: CommandArgs["setPolicy"]) {
    return this.run("setPolicy", a);
  }
  setCreditLine(a: CommandArgs["setCreditLine"]) {
    return this.run("setCreditLine", a);
  }
  readonly contacts = {
    add: (id: string, o: { label?: string; note?: string; favorite?: boolean } = {}) => this.run("contact", { op: "add", id, ...o }),
    update: (id: string, o: { label?: string; note?: string; favorite?: boolean }) => this.run("contact", { op: "update", id, ...o }),
    remove: (id: string) => this.run("contact", { op: "remove", id }),
  };
  readonly tracker = {
    /** Commit the current digest now (outside the 5-block cycle). */
    commit: () => this.run("tracker", { op: "commit" }),
    setOnline: (online: boolean) => this.run("tracker", { op: online ? "online" : "offline" }),
    setHeartbeat: (on: boolean) => this.run("tracker", { op: "heartbeat", on }),
    setCensorship: (mode: "off" | "refuse" | "omit", targets: string[] | "all" = "all") => this.run("tracker", { op: "censor", mode, targets }),
  };
  readonly clock = {
    setSpeed: (speed: Speed) => this.run("setSpeed", { speed }),
    pause: () => this.run("setSpeed", { speed: "paused" }),
    /** Jumps n blocks: no resident acts, due requests are answered. */
    mine: (blocks: number) => this.run("mine", { blocks }),
    /** Mines n blocks one by one with the residents acting (what the running clock does). */
    tick: (blocks: number) => this.run("tick", { blocks }),
  };
  /** Starts the town again from genesis; You join again with the same key. */
  reset() {
    return this.run("reset", {});
  }

  /** Payment preview from You (a pure read; works in any tab). */
  previewPay(a: { to: string; amount: bigint; denom?: DenomId }) {
    return this.eco ? previewPay(this.eco, a) : null;
  }

  /** Redemption preview for a note You hold (a pure read). */
  previewRedeem(a: { issuer: string; denom?: DenomId }) {
    return this.eco ? previewRedeem(this.eco, a) : null;
  }

  /** Stops timers, the election and the channel (tests and hot reload; pages never call it). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopClock();
    this.stopDrive();
    for (const t of [this.helloTimer, this.idleTimer, this.heartbeatTimer]) if (t) clearInterval(t);
    this.helloTimer = this.idleTimer = this.heartbeatTimer = null;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    for (const p of this.rpcPending.values()) clearTimeout(p.timer);
    this.rpcPending.clear();
    this.stopElection?.();
    this.channel?.close();
    this.unsubEco?.();
    for (const c of this.cleanup.splice(0)) c();
    this.batch.dispose();
  }
}

/** The town of this browser (one per page). Boot it with `await town.ready()` or the hooks. */
export const town = new Town();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    void town.saveNow();
    town.dispose();
  });
}
