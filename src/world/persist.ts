// Persistence of the town's event log: IndexedDB (fallback localStorage, last resort memory).
//
// Layout (key → value) in one key-value space:
//   "<town>"        → TownMeta (format, version, backend, epoch, counts, world state JSON)
//   "<town>#<i>"    → { json } : events [i·chunkSize, (i+1)·chunkSize) as bigint-safe JSON (eventsToJson)
// Appends rewrite only the last (partial) chunk and the new ones; meta is written in the same IndexedDB
// transaction, after the chunks, so it never points at missing data.
import { eventsFromJson, eventsToJson, type EconomyEvent } from "@/protocol";

export type StorageKind = "indexeddb" | "localstorage" | "memory";

export interface KV {
  readonly kind: StorageKind;
  get<T>(key: string): Promise<T | undefined>;
  /** Writes all entries; atomically where the backend allows (IndexedDB: one transaction). */
  setMany(entries: Array<[string, unknown]>): Promise<void>;
  delMany(keys: string[]): Promise<void>;
  keys(prefix: string): Promise<string[]>;
}

/** Bumped when the stored layout or the meaning of stored events changes; older towns are discarded. */
export const WORLD_STORAGE_VERSION = 1;

export interface TownMeta {
  format: "basis-world-town";
  version: number;
  /** Storage key of this town (one per AVL backend: logs are backend-specific). */
  key: string;
  /** Changes on every reset: tabs compare it to tell a new town from an old one. */
  epoch: string;
  backend: string;
  seed: string;
  genesisTimeMs: string;
  events: number;
  chunkSize: number;
  chunks: number;
  savedAt: number;
  stateHash?: string;
  /** World-level state (requests, contacts, settings) as bigint-safe JSON. */
  world?: string;
}

// ---------------------------------------------------------------------------------------------
// key-value backends
// ---------------------------------------------------------------------------------------------

export class MemoryKV implements KV {
  readonly kind: StorageKind = "memory";
  readonly map = new Map<string, unknown>();
  async get<T>(key: string): Promise<T | undefined> {
    return this.map.get(key) as T | undefined;
  }
  async setMany(entries: Array<[string, unknown]>): Promise<void> {
    for (const [k, v] of entries) this.map.set(k, structuredCloneSafe(v));
  }
  async delMany(keys: string[]): Promise<void> {
    for (const k of keys) this.map.delete(k);
  }
  async keys(prefix: string): Promise<string[]> {
    return [...this.map.keys()].filter((k) => k.startsWith(prefix)).sort();
  }
}

function structuredCloneSafe<T>(v: T): T {
  return typeof structuredClone === "function" ? structuredClone(v) : (JSON.parse(JSON.stringify(v)) as T);
}

/** Minimal Storage surface (window.localStorage or a test shim). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export class LocalStorageKV implements KV {
  readonly kind: StorageKind = "localstorage";
  constructor(
    private readonly ls: StorageLike,
    private readonly prefix = "basis.world.kv.",
  ) {}
  async get<T>(key: string): Promise<T | undefined> {
    const raw = this.ls.getItem(this.prefix + key);
    return raw === null ? undefined : (JSON.parse(raw) as T);
  }
  async setMany(entries: Array<[string, unknown]>): Promise<void> {
    for (const [k, v] of entries) this.ls.setItem(this.prefix + k, JSON.stringify(v));
  }
  async delMany(keys: string[]): Promise<void> {
    for (const k of keys) this.ls.removeItem(this.prefix + k);
  }
  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < this.ls.length; i++) {
      const k = this.ls.key(i);
      if (k && k.startsWith(this.prefix + prefix)) out.push(k.slice(this.prefix.length));
    }
    return out.sort();
  }
}

const DB_NAME = "basis-world";
const STORE = "kv";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class IndexedDbKV implements KV {
  readonly kind: StorageKind = "indexeddb";
  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB, timeoutMs = 4000): Promise<IndexedDbKV> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("IndexedDB open timed out")), timeoutMs);
      let r: IDBOpenDBRequest;
      try {
        r = factory.open(DB_NAME, 1);
      } catch (e) {
        clearTimeout(t);
        reject(e);
        return;
      }
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => {
        clearTimeout(t);
        resolve(r.result);
      };
      r.onerror = () => {
        clearTimeout(t);
        reject(r.error ?? new Error("IndexedDB open failed"));
      };
      r.onblocked = () => {
        /* another tab holds an older version open; onsuccess follows once it closes */
      };
    });
    db.onversionchange = () => db.close();
    return new IndexedDbKV(db);
  }

  async get<T>(key: string): Promise<T | undefined> {
    const tx = this.db.transaction(STORE, "readonly");
    return (await req(tx.objectStore(STORE).get(key))) as T | undefined;
  }

  private write(fn: (s: IDBObjectStore) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(STORE, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB write failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB write aborted"));
      fn(tx.objectStore(STORE));
    });
  }

  setMany(entries: Array<[string, unknown]>): Promise<void> {
    return this.write((s) => {
      for (const [k, v] of entries) s.put(v, k);
    });
  }

  delMany(keys: string[]): Promise<void> {
    return this.write((s) => {
      for (const k of keys) s.delete(k);
    });
  }

  async keys(prefix: string): Promise<string[]> {
    const tx = this.db.transaction(STORE, "readonly");
    const keys = await req(tx.objectStore(STORE).getAllKeys(IDBKeyRange.bound(prefix, prefix + "￿")));
    return (keys as IDBValidKey[]).map(String).sort();
  }
}

/** IndexedDB when it opens, else localStorage when it is writable, else memory (nothing survives a reload). */
export async function openBestKV(): Promise<KV> {
  if (typeof indexedDB !== "undefined") {
    try {
      return await IndexedDbKV.open(indexedDB);
    } catch {
      /* private mode, blocked storage: fall through */
    }
  }
  try {
    if (typeof localStorage !== "undefined") {
      const probe = "basis.world.kv.__probe";
      localStorage.setItem(probe, "1");
      localStorage.removeItem(probe);
      return new LocalStorageKV(localStorage);
    }
  } catch {
    /* blocked */
  }
  return new MemoryKV();
}

// ---------------------------------------------------------------------------------------------
// the town log
// ---------------------------------------------------------------------------------------------

export class TownLog {
  /** Number of events known to be stored (the next save starts from this seq's chunk). */
  savedEvents = 0;
  /** Epoch of the stored log; a save with another epoch (a reset town, a new writer) rewrites every chunk. */
  savedEpoch: string | null = null;

  constructor(
    readonly kv: KV,
    readonly key: string,
    readonly chunkSize = 1000,
  ) {}

  private chunkKey(i: number): string {
    return `${this.key}#${String(i).padStart(6, "0")}`;
  }

  async meta(): Promise<TownMeta | undefined> {
    const m = await this.kv.get<TownMeta>(this.key);
    return m && m.format === "basis-world-town" ? m : undefined;
  }

  /** Loads the whole log; null when nothing (valid) is stored. Throws on corrupt chunks. */
  async load(): Promise<{ meta: TownMeta; events: EconomyEvent[] } | null> {
    const meta = await this.meta();
    if (!meta) return null;
    // another storage version: the town reports it (load.note) and starts a new one
    if (meta.version !== WORLD_STORAGE_VERSION) throw new Error(`stored by storage version ${meta.version}, this build reads version ${WORLD_STORAGE_VERSION}`);
    const events: EconomyEvent[] = [];
    for (let i = 0; i < meta.chunks; i++) {
      const c = await this.kv.get<{ json: string }>(this.chunkKey(i));
      if (!c) throw new Error(`town log chunk ${i} is missing`);
      for (const e of eventsFromJson(c.json)) events.push(e);
    }
    if (events.length < meta.events) throw new Error(`town log has ${events.length} of ${meta.events} events`);
    events.length = meta.events;
    for (let i = 0; i < events.length; i++) if (events[i].seq !== i) throw new Error(`town log: event ${i} has seq ${events[i].seq}`);
    this.savedEvents = meta.events;
    // a log written with another chunk size (an older build) is rewritten whole by the next save
    this.savedEpoch = meta.chunkSize === this.chunkSize ? meta.epoch : null;
    return { meta, events };
  }

  /** Writes the events from `savedEvents` on (rewriting the partial chunk) plus meta. */
  async save(events: readonly EconomyEvent[], meta: Omit<TownMeta, "format" | "version" | "key" | "events" | "chunkSize" | "chunks" | "savedAt">): Promise<void> {
    const n = events.length;
    const sameEpoch = meta.epoch === this.savedEpoch;
    const from = sameEpoch ? Math.min(this.savedEvents, n) : 0;
    const chunks = Math.ceil(n / this.chunkSize);
    // nothing new since the last save: only meta (world data) is written
    const first = sameEpoch && from === n ? chunks : Math.floor(from / this.chunkSize);
    const entries: Array<[string, unknown]> = [];
    for (let i = first; i < chunks; i++) entries.push([this.chunkKey(i), { json: eventsToJson(events.slice(i * this.chunkSize, (i + 1) * this.chunkSize)) }]);
    const full: TownMeta = { ...meta, format: "basis-world-town", version: WORLD_STORAGE_VERSION, key: this.key, events: n, chunkSize: this.chunkSize, chunks, savedAt: Date.now() };
    entries.push([this.key, full]);
    await this.kv.setMany(entries);
    this.savedEvents = n;
    this.savedEpoch = meta.epoch;
  }

  /** Updates meta only (world state changed, no new events). */
  async saveMeta(meta: TownMeta): Promise<void> {
    await this.kv.setMany([[this.key, { ...meta, savedAt: Date.now() }]]);
  }

  async clear(): Promise<void> {
    const keys = await this.kv.keys(this.key);
    await this.kv.delMany(keys.filter((k) => k === this.key || k.startsWith(this.key + "#")));
    this.savedEvents = 0;
    this.savedEpoch = null;
  }
}
