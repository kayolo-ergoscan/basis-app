// IndexedDB "basis-mainnet": stores "vault" (the key record), "journal" (write-ahead transaction journal) and "meta"
// (monotonic timestamps). Every call runs in one IndexedDB transaction over all three stores, so a read-check-write is
// atomic across tabs (the browser serialises read-write transactions).
//
// Rule for callers: inside read()/write() await only the DbTx methods. Awaiting anything else (crypto, fetch, timers)
// lets the transaction commit early, and the next request fails with TransactionInactiveError.
import { DB_VERSION, STORE_JOURNAL, STORE_META, STORE_VAULT } from "./constants";
import { storageError, VaultError } from "./errors";

export type StoreName = typeof STORE_VAULT | typeof STORE_JOURNAL | typeof STORE_META;
const STORES: StoreName[] = [STORE_VAULT, STORE_JOURNAL, STORE_META];

export interface DbTx {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  /** Values in key order. */
  getAll<T>(store: StoreName): Promise<T[]>;
  keys(store: StoreName): Promise<string[]>;
  put(store: StoreName, key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    // no preventDefault: a failed request aborts its transaction, and the abort reports the error
    r.onerror = () => reject(storageError(r.error));
  });
}

export class VaultDb {
  #db: IDBDatabase;
  #closed = false;

  private constructor(db: IDBDatabase) {
    this.#db = db;
    // a newer build in another tab upgrades the database: step aside (this tab reports storage-failed until reload)
    db.onversionchange = () => {
      this.#closed = true;
      db.close();
    };
  }

  static open(factory: IDBFactory, name: string, timeoutMs = 10_000): Promise<VaultDb> {
    return new Promise((resolve, reject) => {
      let done = false;
      const fail = (e: unknown) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        reject(storageError(e));
      };
      const timer = setTimeout(() => fail({ name: "TimeoutError" }), timeoutMs);
      let r: IDBOpenDBRequest;
      try {
        r = factory.open(name, DB_VERSION);
      } catch (e) {
        fail(e);
        return;
      }
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      r.onsuccess = () => {
        if (done) {
          r.result.close();
          return;
        }
        done = true;
        clearTimeout(timer);
        resolve(new VaultDb(r.result));
      };
      r.onerror = () => fail(r.error);
      r.onblocked = () => {
        /* an older version is open in another tab; onsuccess follows once it closes */
      };
    });
  }

  get closed(): boolean {
    return this.#closed;
  }

  read<T>(fn: (t: DbTx) => Promise<T>): Promise<T> {
    return this.#run("readonly", fn);
  }

  /** Atomic: if `fn` throws (a VaultError passes through as it is), nothing it wrote is kept. */
  write<T>(fn: (t: DbTx) => Promise<T>): Promise<T> {
    return this.#run("readwrite", fn);
  }

  close(): void {
    this.#closed = true;
    this.#db.close();
  }

  #run<T>(mode: IDBTransactionMode, fn: (t: DbTx) => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (this.#closed) {
        reject(new VaultError("storage-failed", "the vault database is closed", { reason: "closed" }));
        return;
      }
      let tx: IDBTransaction;
      try {
        tx = this.#db.transaction(STORES, mode);
      } catch (e) {
        reject(storageError(e));
        return;
      }
      let settled = false;
      let result: T;
      let failure: unknown = undefined;
      tx.oncomplete = () => {
        if (failure !== undefined) reject(failure);
        else if (!settled) reject(new VaultError("storage-failed", "the transaction ended before its work did", { reason: "early-commit" }));
        else resolve(result);
      };
      tx.onabort = () => reject(failure ?? storageError(tx.error ?? { name: "AbortError" }));
      const t: DbTx = {
        get: <V>(s: StoreName, k: string) => req(tx.objectStore(s).get(k)) as Promise<V | undefined>,
        getAll: <V>(s: StoreName) => req(tx.objectStore(s).getAll()) as Promise<V[]>,
        keys: (s) => req(tx.objectStore(s).getAllKeys()).then((ks) => ks.map(String)),
        put: (s, k, v) => req(tx.objectStore(s).put(v, k)).then(() => undefined),
        delete: (s, k) => req(tx.objectStore(s).delete(k)).then(() => undefined),
      };
      let p: Promise<T>;
      try {
        p = fn(t);
      } catch (e) {
        p = Promise.reject(e);
      }
      p.then(
        (v) => {
          settled = true;
          result = v;
        },
        (e) => {
          settled = true;
          failure = e instanceof VaultError ? e : storageError(e);
          try {
            tx.abort();
          } catch {
            /* already finished: oncomplete or onabort reports `failure` */
          }
        },
      );
    });
  }
}
