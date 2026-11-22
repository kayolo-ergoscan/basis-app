// Multi-tab coordination: exactly one tab (the leader) runs the town's clock, bots and persistence; other tabs
// follow by ingesting the leader's events over a BroadcastChannel and forward their commands to it (RPC).
//
// Leader election uses the Web Locks API: the leader holds an exclusive lock for as long as it lives; the
// others queue for it, so when the leader's tab closes the next tab is promoted automatically. Without Web
// Locks (very old browsers) every tab runs alone ("solo") and a tab that hears another solo tab stops its own
// clock and shows that the town is running elsewhere.

export type TabRole = "leader" | "follower" | "solo";

export interface ChannelLike {
  postMessage(msg: unknown): void;
  close(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

export interface LockManagerLike {
  request(name: string, options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean; signal?: AbortSignal }, cb: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown>;
}

export interface TabEnv {
  locks: LockManagerLike | null;
  channel(name: string): ChannelLike | null;
  tabId: string;
}

export function browserTabEnv(): TabEnv {
  const nav = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManagerLike }) : null;
  return {
    locks: nav?.locks && typeof nav.locks.request === "function" ? nav.locks : null,
    channel: (name) => (typeof BroadcastChannel !== "undefined" ? (new BroadcastChannel(name) as unknown as ChannelLike) : null),
    tabId: randomTabId(),
  };
}

export function randomTabId(): string {
  const c = globalThis.crypto;
  if (c?.getRandomValues) return Array.from(c.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
  return Math.random().toString(16).slice(2, 14);
}

/** Wire messages (structured clone: bigints and Uint8Arrays travel as they are). */
export type TabMessage =
  | { t: "hello"; from: string; epoch: string | null; have: number }
  | { t: "snapshot"; from: string; to: string; epoch: string; base: number; events: unknown[]; world: unknown; clock: unknown }
  | { t: "events"; from: string; epoch: string; base: number; events: unknown[] }
  | { t: "world"; from: string; epoch: string; world: unknown }
  | { t: "clock"; from: string; epoch: string; clock: unknown }
  | { t: "reset"; from: string; epoch: string }
  | { t: "rpc"; from: string; id: number; cmd: string; args: unknown }
  | { t: "rpc-result"; from: string; to: string; id: number; ok: boolean; result?: unknown; error?: string }
  | { t: "solo"; from: string }
  /** A visible follower ticks the clock of a hidden leader (hidden tabs get throttled timers). */
  | { t: "drive"; from: string; epoch: string };

/**
 * Elects a leader for `name`. `onRole` is called with "leader" (now or later, on promotion), "follower" or
 * "solo". Returns a stop function (releases the lock).
 */
export function electLeader(env: TabEnv, name: string, onRole: (role: TabRole) => void): () => void {
  if (!env.locks) {
    onRole("solo");
    return () => {};
  }
  const locks = env.locks;
  const abort = typeof AbortController !== "undefined" ? new AbortController() : null;
  let release: (() => void) | null = null;
  let stopped = false;
  const hold = () =>
    new Promise<void>((resolve) => {
      release = resolve;
    });
  void locks
    .request(name, { mode: "exclusive", ifAvailable: true }, async (lock) => {
      if (!lock || stopped) return false;
      onRole("leader");
      await hold();
      return true;
    })
    .then((got) => {
      if (got || stopped) return;
      onRole("follower");
      return locks.request(name, { mode: "exclusive", signal: abort?.signal }, async () => {
        if (stopped) return;
        onRole("leader");
        await hold();
      });
    })
    .catch(() => {
      /* aborted on stop */
    });
  return () => {
    stopped = true;
    abort?.abort();
    (release as (() => void) | null)?.();
  };
}

/** In-process lock manager with Web Locks semantics (tests; also documents the contract we rely on). */
export class LocalLocks implements LockManagerLike {
  private held = new Map<string, boolean>();
  private queues = new Map<string, Array<() => void>>();

  async request(name: string, options: { mode?: "exclusive" | "shared"; ifAvailable?: boolean; signal?: AbortSignal }, cb: (lock: unknown) => Promise<unknown> | unknown): Promise<unknown> {
    if (this.held.get(name)) {
      if (options.ifAvailable) return cb(null);
      await new Promise<void>((resolve, reject) => {
        const q = this.queues.get(name) ?? [];
        q.push(resolve);
        this.queues.set(name, q);
        options.signal?.addEventListener("abort", () => {
          const qq = this.queues.get(name) ?? [];
          const i = qq.indexOf(resolve);
          if (i >= 0) qq.splice(i, 1);
          reject(new Error("aborted"));
        });
      });
    }
    this.held.set(name, true);
    try {
      return await cb({ name });
    } finally {
      const next = this.queues.get(name)?.shift();
      if (next) next();
      else this.held.set(name, false);
    }
  }
}

/** In-process broadcast hub (tests): channels with the same name deliver to each other, never to themselves. */
export class LocalChannelHub {
  private members = new Map<string, Set<LocalChannel>>();
  open(name: string): ChannelLike {
    const ch = new LocalChannel(this, name);
    const set = this.members.get(name) ?? new Set();
    set.add(ch);
    this.members.set(name, set);
    return ch;
  }
  deliver(from: LocalChannel, name: string, msg: unknown): void {
    for (const m of this.members.get(name) ?? []) {
      if (m === from || m.closed) continue;
      const data = typeof structuredClone === "function" ? structuredClone(msg) : msg;
      queueMicrotask(() => m.onmessage?.({ data }));
    }
  }
  leave(ch: LocalChannel, name: string): void {
    this.members.get(name)?.delete(ch);
  }
}

class LocalChannel implements ChannelLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  closed = false;
  constructor(
    private readonly hub: LocalChannelHub,
    private readonly name: string,
  ) {}
  postMessage(msg: unknown): void {
    if (!this.closed) this.hub.deliver(this, this.name, msg);
  }
  close(): void {
    this.closed = true;
    this.hub.leave(this, this.name);
  }
}

/** A test environment: shared locks + hub, one tab id per call. */
export function localTabEnv(locks: LocalLocks, hub: LocalChannelHub, tabId: string): TabEnv {
  return { locks, channel: (name) => hub.open(name), tabId };
}
