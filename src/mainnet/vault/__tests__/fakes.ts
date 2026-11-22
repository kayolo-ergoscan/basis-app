// Test doubles for the browser parts the vault uses. The repo has no fake-indexeddb, jsdom or happy-dom, so this file
// carries a small IndexedDB with the semantics the vault relies on:
//   - requests complete in later tasks; a transaction stays active while a request's success handler and its
//     microtasks run, and becomes inactive at the next task, so an await on anything else ends it (then a new request
//     throws TransactionInactiveError, as in browsers);
//   - transactions of one database run one at a time, in creation order (a valid browser schedule);
//   - a transaction commits when no request is pending; abort() or a failed request rolls back everything it wrote;
//   - values are stored and read as structured clones.
// WebCrypto is Node's real one (globalThis.crypto).
import type { ChannelLike, VaultEnv } from "../env";
import type { LockManagerLike } from "../locks";

type Task = (fn: () => void) => void;
const setImmediateLike = (globalThis as { setImmediate?: (fn: () => void) => unknown }).setImmediate;
export const task: Task = setImmediateLike ? (fn) => void setImmediateLike(fn) : (fn) => void setTimeout(fn, 0);

/** Lets queued tasks (requests, channel messages, lock grants) run. */
export async function settle(rounds = 30): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise<void>((r) => task(r));
}

const dom = (name: string): DOMException => new DOMException(name, name);

type Records = Map<string, unknown>;
interface DbData {
  version: number;
  stores: Map<string, Records>;
  queue: FakeTransaction[];
  running: FakeTransaction | null;
}

class FakeRequest {
  result: unknown = undefined;
  error: DOMException | null = null;
  readyState: "pending" | "done" = "pending";
  onsuccess: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onupgradeneeded: ((ev: unknown) => void) | null = null;
  onblocked: ((ev: unknown) => void) | null = null;
}

interface Pending {
  req: FakeRequest;
  write: boolean;
  run: (stores: Map<string, Records>) => unknown;
}

class FakeTransaction {
  oncomplete: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onabort: ((ev: unknown) => void) | null = null;
  error: DOMException | null = null;
  active = true;
  state: "queued" | "running" | "done" | "aborted" = "queued";
  readonly pending: Pending[] = [];
  staged: Map<string, Records> | null = null;

  constructor(
    readonly db: FakeDatabase,
    readonly names: string[],
    readonly mode: "readonly" | "readwrite",
  ) {
    task(() => {
      this.active = false;
      pump(this.db.data);
    });
  }

  objectStore(name: string): FakeStore {
    if (!this.names.includes(name)) throw dom("NotFoundError");
    return new FakeStore(this, name);
  }

  request(write: boolean, run: Pending["run"]): FakeRequest {
    if (this.state === "done" || this.state === "aborted" || !this.active) throw dom("TransactionInactiveError");
    if (write && this.mode === "readonly") throw dom("ReadOnlyError");
    const req = new FakeRequest();
    this.pending.push({ req, write, run });
    return req;
  }

  abort(): void {
    if (this.state === "done" || this.state === "aborted") throw dom("InvalidStateError");
    this.fail(null);
  }

  fail(error: DOMException | null): void {
    this.state = "aborted";
    this.staged = null;
    this.error = error;
    const left = this.pending.splice(0);
    task(() => {
      for (const p of left) {
        p.req.readyState = "done";
        p.req.error = dom("AbortError");
        p.req.onerror?.({ target: p.req, preventDefault() {} });
      }
      this.onabort?.({ target: this });
      finish(this.db.data, this);
    });
  }
}

function pump(data: DbData): void {
  if (data.running) return;
  while (data.queue[0] && data.queue[0].state === "aborted") data.queue.shift();
  const tx = data.queue[0];
  if (!tx) return;
  data.running = tx;
  tx.state = "running";
  tx.staged = new Map([...data.stores].map(([n, r]) => [n, new Map(r)]));
  step(data, tx);
}

function finish(data: DbData, tx: FakeTransaction): void {
  const i = data.queue.indexOf(tx);
  if (i >= 0) data.queue.splice(i, 1);
  if (data.running === tx) data.running = null;
  pump(data);
}

function step(data: DbData, tx: FakeTransaction): void {
  task(() => {
    if (tx.state !== "running") return;
    const next = tx.pending.shift();
    if (!next) {
      if (tx.active) {
        step(data, tx);
        return;
      }
      for (const [n, r] of tx.staged!) data.stores.set(n, r);
      tx.state = "done";
      tx.staged = null;
      task(() => {
        tx.oncomplete?.({ target: tx });
        finish(data, tx);
      });
      return;
    }
    const failName = next.write ? tx.db.factory.takeFailure() : null;
    let ok = true;
    try {
      if (failName) throw dom(failName);
      next.req.result = next.run(tx.staged!);
    } catch (e) {
      ok = false;
      next.req.error = e instanceof DOMException ? e : dom("DataError");
    }
    next.req.readyState = "done";
    tx.active = true;
    if (ok) next.req.onsuccess?.({ target: next.req });
    else {
      let prevented = false;
      next.req.onerror?.({
        target: next.req,
        preventDefault() {
          prevented = true;
        },
      });
      tx.onerror?.({ target: next.req });
      if (!prevented) {
        tx.active = false;
        tx.fail(next.req.error);
        return;
      }
    }
    task(() => {
      tx.active = false;
      step(data, tx);
    });
  });
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));
const checkKey = (k: unknown): string => {
  if (typeof k !== "string") throw dom("DataError");
  return k;
};

class FakeStore {
  constructor(
    readonly tx: FakeTransaction,
    readonly name: string,
  ) {}
  #rec(s: Map<string, Records>): Records {
    return s.get(this.name)!;
  }
  get(key: string): FakeRequest {
    const k = checkKey(key);
    return this.tx.request(false, (s) => clone(this.#rec(s).get(k)));
  }
  getAll(): FakeRequest {
    return this.tx.request(false, (s) => [...this.#rec(s).entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => clone(v)));
  }
  getAllKeys(): FakeRequest {
    return this.tx.request(false, (s) => [...this.#rec(s).keys()].sort());
  }
  put(value: unknown, key: string): FakeRequest {
    const k = checkKey(key);
    const v = clone(value);
    return this.tx.request(true, (s) => {
      this.#rec(s).set(k, v);
      return k;
    });
  }
  delete(key: string): FakeRequest {
    const k = checkKey(key);
    return this.tx.request(true, (s) => {
      this.#rec(s).delete(k);
      return undefined;
    });
  }
}

class FakeDatabase {
  version: number;
  upgrading = false;
  closed = false;
  onversionchange: (() => void) | null = null;
  readonly objectStoreNames: { contains(name: string): boolean };

  constructor(
    readonly factory: FakeIDBFactory,
    readonly data: DbData,
  ) {
    this.version = data.version;
    this.objectStoreNames = { contains: (n) => data.stores.has(n) };
  }

  createObjectStore(name: string): object {
    if (!this.upgrading) throw dom("InvalidStateError");
    if (this.data.stores.has(name)) throw dom("ConstraintError");
    this.data.stores.set(name, new Map());
    return {};
  }

  transaction(names: string | string[], mode: "readonly" | "readwrite" = "readonly"): FakeTransaction {
    if (this.closed) throw dom("InvalidStateError");
    const list = typeof names === "string" ? [names] : [...names];
    for (const n of list) if (!this.data.stores.has(n)) throw dom("NotFoundError");
    const tx = new FakeTransaction(this, list, mode);
    this.data.queue.push(tx);
    return tx;
  }

  close(): void {
    this.closed = true;
  }
}

export class FakeIDBFactory {
  readonly dbs = new Map<string, DbData>();
  /** The next write request fails with this DOMException name (quota, disk), then the flag clears. */
  failNextWrite: string | null = null;

  takeFailure(): string | null {
    const f = this.failNextWrite;
    this.failNextWrite = null;
    return f;
  }

  open(name: string, version?: number): FakeRequest {
    const req = new FakeRequest();
    task(() => {
      let data = this.dbs.get(name);
      const want = version ?? data?.version ?? 1;
      if (data && want < data.version) {
        req.readyState = "done";
        req.error = dom("VersionError");
        req.onerror?.({ target: req });
        return;
      }
      if (!data) {
        data = { version: 0, stores: new Map(), queue: [], running: null };
        this.dbs.set(name, data);
      }
      const db = new FakeDatabase(this, data);
      req.result = db;
      if (want > data.version) {
        const oldVersion = data.version;
        data.version = want;
        db.version = want;
        db.upgrading = true;
        try {
          req.onupgradeneeded?.({ target: req, oldVersion, newVersion: want });
        } finally {
          db.upgrading = false;
        }
      }
      req.readyState = "done";
      req.onsuccess?.({ target: req });
    });
    return req;
  }

  /** A committed store, for direct inspection or tampering ("site data cleared", a damaged record). */
  store(db: string, store: string): Map<string, unknown> {
    const s = this.dbs.get(db)?.stores.get(store);
    if (!s) throw new Error(`no store ${db}/${store}`);
    return s;
  }

  /** Every committed value as JSON text (leak scans). */
  dump(): string {
    const out: Record<string, Record<string, Record<string, unknown>>> = {};
    for (const [dn, d] of this.dbs) {
      out[dn] = {};
      for (const [sn, s] of d.stores) out[dn][sn] = Object.fromEntries(s);
    }
    return JSON.stringify(out);
  }

  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}

// ─── Web Locks ───────────────────────────────────────────────────────────────────────────────────

interface Holder {
  client: string;
  stolen: boolean;
  reject: (e: unknown) => void;
}

/** Exclusive Web Locks shared by several fake tabs: ifAvailable, steal (the holder's request rejects with AbortError),
 *  queueing, release when the callback's promise settles, query(). */
export class FakeLockHub {
  readonly #held = new Map<string, Holder>();
  readonly #queue = new Map<string, Array<() => void>>();
  requests = 0;

  client(client: string): LockManagerLike {
    return {
      request: (name, options, cb) => this.#request(client, name, options, cb),
      query: async () => ({
        held: [...this.#held].map(([name, h]) => ({ name, mode: "exclusive" as const, clientId: h.client })),
        pending: [...this.#queue].flatMap(([name, q]) => q.map(() => ({ name, mode: "exclusive" as const }))),
      }),
    };
  }

  holder(name: string): string | null {
    return this.#held.get(name)?.client ?? null;
  }

  #request(client: string, name: string, options: LockOptions, cb: (lock: Lock | null) => unknown): Promise<unknown> {
    this.requests++;
    return new Promise((resolve, reject) => {
      const grant = () => {
        const h: Holder = { client, stolen: false, reject };
        this.#held.set(name, h);
        Promise.resolve()
          .then(() => cb({ name, mode: "exclusive" } as Lock))
          .then(
            (v) => {
              if (h.stolen) return;
              this.#release(name, h);
              resolve(v);
            },
            (e) => {
              if (h.stolen) return;
              this.#release(name, h);
              reject(e);
            },
          );
      };
      queueMicrotask(() => {
        const cur = this.#held.get(name);
        const waiting = (this.#queue.get(name) ?? []).length > 0;
        if (options.steal) {
          if (cur) {
            cur.stolen = true;
            this.#held.delete(name);
            cur.reject(new DOMException("the lock was stolen", "AbortError"));
          }
          grant();
          return;
        }
        if (!cur && !waiting) {
          grant();
          return;
        }
        if (options.ifAvailable) {
          Promise.resolve()
            .then(() => cb(null))
            .then(resolve, reject);
          return;
        }
        const q = this.#queue.get(name) ?? [];
        q.push(grant);
        this.#queue.set(name, q);
      });
    });
  }

  #release(name: string, h: Holder): void {
    if (this.#held.get(name) !== h) return;
    this.#held.delete(name);
    const next = this.#queue.get(name)?.shift();
    if (next) next();
  }
}

// ─── BroadcastChannel ────────────────────────────────────────────────────────────────────────────

export class FakeChannelHub {
  readonly #channels = new Set<FakeChannel>();
  sent: unknown[] = [];

  readonly factory = (name: string): ChannelLike => {
    const c = new FakeChannel(this, name);
    this.#channels.add(c);
    return c;
  };

  deliver(from: FakeChannel, msg: unknown): void {
    this.sent.push(msg);
    for (const c of this.#channels) {
      if (c === from || c.closed || c.name !== from.name) continue;
      const data = structuredClone(msg);
      task(() => {
        if (!c.closed) c.onmessage?.({ data });
      });
    }
  }
}

class FakeChannel implements ChannelLike {
  closed = false;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  constructor(
    readonly hub: FakeChannelHub,
    readonly name: string,
  ) {}
  postMessage(msg: unknown): void {
    if (this.closed) throw dom("InvalidStateError");
    this.hub.deliver(this, msg);
  }
  close(): void {
    this.closed = true;
  }
}

// ─── clock and storage ───────────────────────────────────────────────────────────────────────────

/** A manual clock for the auto-lock: advance() fires due timers in order; jump() moves time without firing any (a
 *  throttled background tab, a sleeping laptop). */
export class FakeClock {
  t = 1_795_000_000_000;
  readonly #timers = new Map<number, { at: number; fn: () => void }>();
  #id = 0;
  readonly now = (): number => this.t;
  readonly setTimer = (fn: () => void, ms: number): unknown => {
    const id = ++this.#id;
    this.#timers.set(id, { at: this.t + Math.max(0, ms), fn });
    return id;
  };
  readonly clearTimer = (h: unknown): void => {
    this.#timers.delete(h as number);
  };
  get pending(): number {
    return this.#timers.size;
  }
  advance(ms: number): void {
    const end = this.t + ms;
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | null = null;
      for (const e of this.#timers) if (e[1].at <= end && (!first || e[1].at < first[1].at)) first = e;
      if (!first) break;
      this.#timers.delete(first[0]);
      this.t = first[1].at;
      first[1].fn();
    }
    this.t = end;
  }
  jump(ms: number): void {
    this.t += ms;
  }
}

export interface FakeStorage {
  state: boolean;
  grant: boolean;
  asked: number;
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

export function fakeStorage(o: { persisted?: boolean; grant?: boolean } = {}): FakeStorage {
  const s: FakeStorage = {
    state: o.persisted ?? false,
    grant: o.grant ?? true,
    asked: 0,
    persisted: async () => s.state,
    persist: async () => {
      s.asked++;
      if (s.grant) s.state = true;
      return s.state;
    },
  };
  return s;
}

// ─── a browser with tabs ─────────────────────────────────────────────────────────────────────────

/** PBKDF2 iterations in tests (the 600 000 default has its own test). */
export const TEST_ITERATIONS = 1000;
export const PASS = "correct horse battery staple";
export const OTHER_PASS = "a different passphrase entirely";

/** One browser profile: storage, locks and channels shared by its tabs; one clock. */
export class FakeBrowser {
  readonly idb = new FakeIDBFactory();
  readonly locks = new FakeLockHub();
  readonly hub = new FakeChannelHub();
  readonly clock = new FakeClock();
  readonly storage = fakeStorage();

  env(tab: string, over: Partial<VaultEnv> = {}): VaultEnv {
    return {
      indexedDB: this.idb.asFactory(),
      crypto: globalThis.crypto,
      locks: this.locks.client(tab),
      storage: this.storage,
      channel: this.hub.factory,
      now: this.clock.now,
      setTimer: this.clock.setTimer,
      clearTimer: this.clock.clearTimer,
      ...over,
    };
  }
}
