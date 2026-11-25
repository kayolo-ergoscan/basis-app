// The mainnet key vault (design §4): one random secp256k1 key per browser (K1, no seed words), encrypted at rest with
// PBKDF2-SHA256 (600 000 iterations) → AES-256-GCM in IndexedDB, unlocked once per session, auto-locked, used by one tab
// at a time (Web Locks), backed up to a self-describing file that must be verified before anything is signed.
//
// The secret is never kept in memory while unlocked: the session holds the non-extractable AES key and the ciphertext,
// and every use decrypts a fresh 32-byte copy, hands it to a synchronous callback and wipes it. That callback is the
// only way out of this module. Fully separate from the sandbox key (src/world/identity.ts): other database, formats,
// additional data, lock and channel names; nothing here imports src/world.
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { backupFilename, checkExtras, HOW_TO_DECRYPT, openExtras, parseBackup, sealExtras, type BackupExtras, type BackupFile, type OpenedExtras } from "./backup";
import { fromB64, holdsSecret, sameBytes, toB64, wipe } from "./bytes";
import {
  BACKUP_FORMAT, CHANNEL_NAME, CT_BYTES, DB_NAME, HIDDEN_LOCK_MS, IDLE_LOCK_MS, IV_BYTES, KDF_ITERATIONS, KEY_FORMAT,
  KEY_RECORD_ID, MIN_PASSPHRASE_LENGTH, NETWORK, SALT_BYTES, STORE_VAULT,
} from "./constants";
import { VaultDb } from "./db";
import { browserEnv, type ChannelLike, type CryptoLike, type VaultEnv } from "./env";
import { VaultError } from "./errors";
import { dropJournalOf, MainnetJournal, RESERVE_ACTION_KINDS, t1DenomOf, type JournalEntry, type JournalKind, type JournalRecordInput } from "./journal";
import { deriveKey, seal, unseal } from "./kdf";
import { publicKeyOf, randomSecret, refuseTrackerKey, secretFromHex, type Hex } from "./keys";
import { acquireSignerLock, signerLockHeld, type LockManagerLike, type SignerLease } from "./locks";
import { checkPassphrase } from "./passphrase";
import { isPersisted, requestPersist, type Persistence } from "./persist";
import type { ErgoBox } from "../tx/model";
import { checkNoteBody, nextPromise, notePolicy, promiseKey, paysOnlyOwnKey, redeemsReserveBox, redemptionPaysOwnKey, reserveActionPaysRight, spendsOnlyOwnBoxes, type NoteIntent, type NotePolicy, type PairPromise, type ReserveActionKind } from "./policy";
import { addressOf, backupAad, isObject, keyAad, parseKeyRecord, type KeyRecord, type KeySource } from "./record";

export type VaultStatus = "loading" | "unsupported" | "none" | "locked" | "unlocked" | "damaged";
export type LockReason = "manual" | "idle" | "hidden" | "taken-over" | "lost" | "storage-changed" | "wiped";
export type MissingFeature = "indexeddb" | "webcrypto" | "web-locks";
/** What the secret is used for. Journal kinds sign transactions or notes; "build-request" signs a redemption build
 *  request; "export-hex" reveals the key (D4). When the passphrase is asked again: policy.ts. */
export type SecretPurpose = JournalKind | "build-request" | "export-hex";

export interface VaultKey {
  readonly pub: Hex;
  readonly address: string;
  readonly createdAt: number;
  readonly backedUpAt: number | null;
  readonly source: KeySource;
}

export interface VaultState {
  /** loading → none | locked | unlocked; damaged: the stored record is unreadable; unsupported: see `missing`. */
  readonly status: VaultStatus;
  readonly key: VaultKey | null;
  /** A backup file was proven to decrypt to this key. Funding and every signature wait for it. */
  readonly backedUp: boolean;
  /** Why the vault locked itself last (null after an unlock). */
  readonly lockReason: LockReason | null;
  readonly missing: readonly MissingFeature[];
  /** navigator.storage.persist(): true granted, false refused, null unknown. */
  readonly persisted: Persistence;
  /** Bumps on every change. */
  readonly v: number;
}

export interface VaultOptions {
  env?: Partial<VaultEnv>;
  dbName?: string;
  idleLockMs?: number;
  hiddenLockMs?: number;
  /** TESTS ONLY: PBKDF2 iterations for new keys and the lowest accepted. Refused in a production build. */
  unsafeTestKdfIterations?: number;
}

export interface SecretOptions {
  /**
   * The passphrase typed again (re-derived, ~1 s). Always required for "export-hex", "t1", "topup", "refund-start" and
   * "refund-end"; for "withdraw" unless the transaction pays only this key (signToJournal checks); for "note" when the
   * notes since the last passphrase entry promise more than 25 % of the reserve (policy.ts); never for "redeem" (its
   * signed transaction must be a redemption paying this key). A direct withSecret() for t1, withdraw, note or a
   * reserve action always needs it.
   */
  passphrase?: string;
  /** signToJournal("note") only, and required there: what the note promises, checked before and after signing. */
  note?: NoteIntent;
  /** signToJournal("topup") only, and required there: the owner (R4) of the reserve the screen reviewed; the signed
   *  reserve output must keep it (a refund start must keep this key). */
  reserveOwner?: Hex;
  /** signToJournal("withdraw") and ("redeem") only, and required there: the boxes the inputs spend, in order (each
   *  checked against its id). A withdrawal spends only P2PK(this key) boxes, without context variables; a redemption
   *  spends one reserve-contract box. */
  inputBoxes?: readonly ErgoBox[];
  /** signToJournal("t1") only: the denomination of the reserve it creates ("erg" by default); it must be the entry's
   *  `meta.denom` (absent for ERG). One T1 per key and denomination. */
  denom?: string;
}

export interface TakeOverOptions {
  /** Take the signer from another tab (that tab locks at once). */
  takeOver?: boolean;
}

export interface WipeOptions extends TakeOverOptions {
  /** Required when the key has no verified backup: it is gone for good. */
  confirmUnbacked?: boolean;
  /** Also delete this key's journal entries and timestamp counters (refused while any entry is open). */
  journal?: boolean;
}

export interface CreateResult {
  state: VaultState;
  persisted: Persistence;
}

export interface RestoreResult {
  state: VaultState;
  /** The same key was already here: the file only counted as a verified backup. */
  alreadyPresent: boolean;
  /** Watched issuers and contacts, decrypted from the file, malformed entries dropped: untrusted input, show them before
   *  using them. Null when the file has none, or they are unreadable. */
  extras: BackupExtras | null;
  /** The file has extras that do not decrypt or parse; the key was restored without them. */
  extrasUnreadable: boolean;
  persisted: Persistence;
}

export interface BackupExport {
  filename: string;
  /** The file's text (JSON, pretty-printed). */
  json: string;
}

/** The secret callback: synchronous, gets a 32-byte copy that is wiped when it returns, must not return it. */
export type SecretCallback<T> = (secret: Uint8Array, pub: Uint8Array) => T;

interface Session {
  key: CryptoKey;
  iv: Uint8Array;
  ct: Uint8Array;
  ctB64: string;
  aad: string;
  pub: Hex;
  pubBytes: Uint8Array;
  /** Notes signed without the passphrase since it was last typed (the unlock counts), per recipient. */
  /** Per pair and denomination (policy.ts promiseKey). */
  promised: Map<string, PairPromise>;
}

/** signToJournal's rules around one use of the key (both run in the signer's turn, see #use). */
interface Guard<T> {
  /** Before the key is touched: throws to refuse. `typed` = the passphrase was given. */
  before?(s: Session, typed: boolean): void;
  /** Right after the callback, before its result leaves the vault: throws to drop the signed bytes. */
  after?(out: T, s: Session, typed: boolean): void;
}

/** Purposes a direct withSecret() serves only with the passphrase: the vault cannot see what such a callback signs. */
const PASS_DIRECT: ReadonlySet<SecretPurpose> = new Set(["t1", "withdraw", "note", "topup", "refund-start", "refund-end", "export-hex"]);
const needPass = (message: string, reason: string) => new VaultError("passphrase-required", message, { reason });

type Stored = { kind: "none" } | { kind: "ok"; rec: KeyRecord } | { kind: "damaged"; backedUp: boolean };

/** Internal: built by openVault(). */
export interface VaultInternals {
  env: VaultEnv;
  db: VaultDb | null;
  missing: MissingFeature[];
  iterations: number;
  idleMs: number;
  hiddenMs: number;
}

const PURPOSES: readonly SecretPurpose[] = ["t1", "note", "redeem", "withdraw", "topup", "refund-start", "refund-end", "build-request", "export-hex"];
const INSPECT: unique symbol = Symbol.for("nodejs.util.inspect.custom");

const INITIAL: VaultState = Object.freeze({ status: "loading", key: null, backedUp: false, lockReason: null, missing: Object.freeze([]), persisted: null, v: 0 });

const keyInfo = (r: KeyRecord): VaultKey => Object.freeze({ pub: r.pub, address: r.address, createdAt: r.createdAt, backedUpAt: r.backedUpAt, source: r.source });

function sameState(a: VaultState, b: Omit<VaultState, "v">): boolean {
  const ka = a.key;
  const kb = b.key;
  const sameKey = ka === kb || (!!ka && !!kb && ka.pub === kb.pub && ka.address === kb.address && ka.createdAt === kb.createdAt && ka.backedUpAt === kb.backedUpAt && ka.source === kb.source);
  return sameKey && a.status === b.status && a.backedUp === b.backedUp && a.lockReason === b.lockReason && a.persisted === b.persisted && a.missing.join() === b.missing.join();
}

const isThenable = (v: unknown): v is PromiseLike<unknown> => (typeof v === "object" || typeof v === "function") && v !== null && typeof (v as { then?: unknown }).then === "function";

const weak = () => new VaultError("weak-passphrase", `a passphrase has at least ${MIN_PASSPHRASE_LENGTH} characters`);
/** A new key cannot go where a record already is: "damaged" (wipe it first) or "exists". */
const occupied = (stored: Stored): VaultError =>
  stored.kind === "damaged" ? new VaultError("damaged", "the stored key record is damaged: wipe it first") : new VaultError("exists", "a mainnet key already exists in this browser");
const lockedError = () => new VaultError("locked", "the vault is locked");

export class MainnetVault {
  /** The write-ahead journal (same database). */
  readonly journal: MainnetJournal;
  readonly #env: VaultEnv;
  readonly #db: VaultDb | null;
  readonly #missing: readonly MissingFeature[];
  readonly #iterations: number;
  readonly #idleMs: number;
  readonly #hiddenMs: number;
  readonly #listeners = new Set<() => void>();
  #state: VaultState = INITIAL;
  #session: Session | null = null;
  #lease: SignerLease | null = null;
  #opLease: SignerLease | null = null;
  #epoch = 0;
  #queue: Promise<unknown> = Promise.resolve();
  #lastActivity = 0;
  #armedAt = 0;
  #hiddenSince: number | null = null;
  #timer: unknown = null;
  #channel: ChannelLike | null = null;
  #closed = false;

  constructor(i: VaultInternals) {
    this.#env = i.env;
    this.#db = i.db;
    this.#missing = Object.freeze([...i.missing]);
    this.#iterations = i.iterations;
    this.#idleMs = i.idleMs;
    this.#hiddenMs = i.hiddenMs;
    this.journal = new MainnetJournal({ db: i.db, now: i.env.now, random: (n) => this.#random(n), post: () => this.#post("journal") });
    if (this.#missing.length === 0) {
      this.#channel = i.env.channel(CHANNEL_NAME);
      if (this.#channel) this.#channel.onmessage = (ev) => this.#onMessage(ev?.data);
    }
  }

  // ─── state ───────────────────────────────────────────────────────────────────────────────────────

  /** For useSyncExternalStore. The object is frozen and stays the same until something changes. */
  readonly getState = (): VaultState => this.#state;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  #set(patch: Partial<Omit<VaultState, "v">>): void {
    const cur = this.#state;
    const next = { ...cur, ...patch };
    if (sameState(cur, next)) return;
    this.#state = Object.freeze({ ...next, v: cur.v + 1 });
    for (const l of [...this.#listeners]) {
      try {
        l();
      } catch (e) {
        queueMicrotask(() => {
          throw e; // a listener's bug is reported, and never stops the vault
        });
      }
    }
  }

  #publish(stored: Stored, extra: Partial<Omit<VaultState, "v">> = {}): void {
    if (stored.kind === "none") this.#set({ status: "none", key: null, backedUp: false, ...extra });
    else if (stored.kind === "damaged") this.#set({ status: "damaged", key: null, backedUp: stored.backedUp, ...extra });
    else this.#set({ status: this.#session ? "unlocked" : "locked", key: keyInfo(stored.rec), backedUp: stored.rec.backedUpAt !== null, ...extra });
  }

  /** Re-reads the stored record (another tab may have changed it) and the persistence flag. */
  refresh(): Promise<VaultState> {
    return this.#exclusive(async () => {
      if (this.#missing.length > 0 || !this.#db) {
        this.#set({ status: "unsupported", key: null, backedUp: false, missing: this.#missing });
        return this.#state;
      }
      const stored = await this.#load();
      const s = this.#session;
      if (s && (stored.kind !== "ok" || stored.rec.pub !== s.pub || stored.rec.ct !== s.ctB64)) this.#lockNow("storage-changed");
      this.#publish(stored, { persisted: await isPersisted(this.#env.storage) });
      return this.#state;
    });
  }

  // ─── key lifecycle ───────────────────────────────────────────────────────────────────────────────

  /**
   * A new random key, encrypted with the passphrase; the vault is unlocked afterwards (so the backup can be downloaded at
   * once) and not backed up. Asks navigator.storage.persist() first, while the click is fresh.
   */
  async create(passphrase: string): Promise<CreateResult> {
    const { db, crypto } = this.#need();
    if (!checkPassphrase(passphrase).ok) throw weak();
    const persistP = requestPersist(this.#env.storage);
    return this.#exclusive(async () => {
      const stored = await this.#load();
      if (stored.kind !== "none") {
        this.#publish(stored);
        throw occupied(stored);
      }
      const epoch = this.#epoch;
      const lease = await this.#acquire(false);
      let started = false;
      try {
        const salt = this.#random(SALT_BYTES);
        const iv = this.#random(IV_BYTES);
        const secret = randomSecret(crypto);
        const { pub, key, ct } = await this.#sealSecret(crypto, secret, passphrase, salt, this.#iterations, iv);
        const rec = this.#newRecord(pub, salt, this.#iterations, iv, ct, this.#env.now(), null, "created");
        await this.#insert(db, rec);
        started = this.#openSession(lease, key, rec, epoch);
        this.#publish({ kind: "ok", rec }, started ? { lockReason: null } : {});
        this.#post("vault");
      } finally {
        if (!started) lease.release();
      }
      const persisted = await persistP;
      this.#set({ persisted });
      return { state: this.#state, persisted };
    });
  }

  /** Opens the vault for this session. Throws "locked-elsewhere" when another tab has it, unless `takeOver`. */
  async unlock(passphrase: string, opts: TakeOverOptions = {}): Promise<VaultState> {
    const { crypto } = this.#need();
    return this.#exclusive(async () => {
      const stored = await this.#load();
      if (stored.kind !== "ok") {
        this.#publish(stored);
        throw stored.kind === "none" ? new VaultError("no-key", "there is no mainnet key in this browser") : new VaultError("damaged", "the stored key record is damaged");
      }
      const rec = stored.rec;
      refuseTrackerKey(rec.pub);
      if (this.#session) {
        try {
          this.#liveSession();
        } catch {
          /* it had expired and locked itself: open it again below */
        }
      }
      if (this.#session) {
        // already open: still prove the passphrase, so unlock() never says yes to a wrong one
        await this.#checkPassphrase(crypto, rec, passphrase);
        this.#activity();
        return this.#state;
      }
      const epoch = this.#epoch;
      const lease = await this.#acquire(opts.takeOver === true);
      let started = false;
      try {
        const key = await this.#checkPassphrase(crypto, rec, passphrase);
        started = this.#openSession(lease, key, rec, epoch);
        if (!started) throw new VaultError("locked", "the vault was locked while it opened");
        this.#publish(stored, { lockReason: null });
        return this.#state;
      } finally {
        if (!started) lease.release();
      }
    });
  }

  /** Locks now: the session key is dropped and the Web Lock released. It can be called at any time. */
  lock(reason: LockReason = "manual"): void {
    this.#lockNow(reason);
  }

  /** True when the passphrase opens the stored key. Changes nothing. */
  async confirmPassphrase(passphrase: string): Promise<boolean> {
    const { crypto } = this.#need();
    const stored = await this.#load();
    if (stored.kind !== "ok") throw stored.kind === "none" ? new VaultError("no-key", "there is no mainnet key in this browser") : new VaultError("damaged", "the stored key record is damaged");
    try {
      await this.#checkPassphrase(crypto, stored.rec, passphrase);
      return true;
    } catch (e) {
      if (e instanceof VaultError && e.code === "wrong-passphrase") return false;
      throw e;
    }
  }

  /**
   * The encrypted backup file for the unlocked key (same passphrase and salt as the stored record, a fresh IV, the backup
   * additional data). The extras are sealed under the same key with their own IV and additional data. The UI offers the
   * file as a download, then asks for it back through verifyBackup().
   */
  async exportBackup(opts: { extras?: BackupExtras } = {}): Promise<BackupExport> {
    const { crypto } = this.#need();
    const extras = checkExtras(opts.extras, "strict");
    this.#liveSession();
    return this.#exclusive(async () => {
      const s = this.#liveSession();
      const epoch = this.#epoch;
      const rec = await this.#sessionRecord(s, epoch);
      const secret = await this.#open(crypto, s);
      try {
        const iv = this.#random(IV_BYTES);
        const ct = await seal(crypto.subtle, s.key, iv, backupAad(rec.pub), secret);
        const file: BackupFile = {
          format: BACKUP_FORMAT,
          v: 1,
          network: NETWORK,
          pub: rec.pub,
          address: rec.address,
          kdf: rec.kdf,
          cipher: { name: "AES-GCM", iv: toB64(iv), tagLength: 128, aad: backupAad(rec.pub) },
          ct: toB64(ct),
          createdAt: new Date(rec.createdAt).toISOString(),
          howToDecrypt: HOW_TO_DECRYPT,
        };
        if (extras) file.extras = await sealExtras(crypto.subtle, s.key, this.#random(IV_BYTES), rec.pub, extras);
        this.#activity();
        return { filename: backupFilename(rec.pub, this.#env.now()), json: JSON.stringify(file, null, 2) };
      } finally {
        wipe(secret);
      }
    });
  }

  /**
   * The user loads the backup file again and types the passphrase: when it decrypts to this key, `backedUpAt` is set.
   * Works locked or unlocked. Throws "bad-backup", "backup-other-key" or "wrong-passphrase".
   */
  async verifyBackup(fileText: string, passphrase: string): Promise<VaultState> {
    const { db, crypto } = this.#need();
    const file = parseBackup(fileText, this.#iterations);
    return this.#exclusive(async () => {
      const stored = await this.#load();
      if (stored.kind !== "ok") {
        this.#publish(stored);
        throw stored.kind === "none" ? new VaultError("no-key", "there is no mainnet key in this browser") : new VaultError("damaged", "the stored key record is damaged");
      }
      if (file.pub !== stored.rec.pub) throw new VaultError("backup-other-key", "this backup file holds another key");
      await this.#proveFile(crypto, file, passphrase);
      return this.#markBackedUp(db, file.pub);
    });
  }

  /**
   * Restores a key from its backup file into a browser that has none (the vault is unlocked afterwards, backed up). The
   * same key already here: the file only counts as a verified backup. Another key here: "exists" (wipe it first).
   */
  async restoreFromBackup(fileText: string, passphrase: string, opts: TakeOverOptions = {}): Promise<RestoreResult> {
    const { db, crypto } = this.#need();
    const file = parseBackup(fileText, this.#iterations);
    refuseTrackerKey(file.pub);
    const persistP = requestPersist(this.#env.storage);
    return this.#exclusive(async () => {
      const stored = await this.#load();
      if (stored.kind === "ok" && stored.rec.pub === file.pub) {
        const key = await this.#proveFile(crypto, file, passphrase);
        const state = await this.#markBackedUp(db, file.pub);
        const x = await openExtras(crypto.subtle, key, file.extras);
        return { state, alreadyPresent: true, extras: x.extras, extrasUnreadable: x.unreadable, persisted: await persistP };
      }
      if (stored.kind !== "none") {
        this.#publish(stored);
        throw occupied(stored);
      }
      const epoch = this.#epoch;
      const lease = await this.#acquire(opts.takeOver === true);
      let started = false;
      let x: OpenedExtras = { extras: null, unreadable: false };
      try {
        const salt = fromB64(file.kdf.salt) as Uint8Array;
        const key = await deriveKey(crypto.subtle, passphrase, salt, file.kdf.iterations);
        const secret = await unseal(crypto.subtle, key, fromB64(file.cipher.iv) as Uint8Array, file.cipher.aad, fromB64(file.ct) as Uint8Array);
        const iv = this.#random(IV_BYTES);
        const ct = await this.#resealChecked(crypto, secret, file.pub, key, iv);
        x = await openExtras(crypto.subtle, key, file.extras);
        const now = this.#env.now();
        const made = Date.parse(file.createdAt);
        const rec = this.#newRecord(file.pub, salt, file.kdf.iterations, iv, ct, Number.isSafeInteger(made) && made >= 0 ? made : now, now, "backup");
        await this.#insert(db, rec);
        started = this.#openSession(lease, key, rec, epoch);
        this.#publish({ kind: "ok", rec }, started ? { lockReason: null } : {});
        this.#post("vault");
      } finally {
        if (!started) lease.release();
      }
      const persisted = await persistP;
      this.#set({ persisted });
      return { state: this.#state, alreadyPresent: false, extras: x.extras, extrasUnreadable: x.unreadable, persisted };
    });
  }

  /** Experts: a 64-hex key from another tool, under a new passphrase. Not backed up until a file is verified. */
  async importHex(hex: string, passphrase: string, opts: TakeOverOptions = {}): Promise<{ state: VaultState; alreadyPresent: boolean; persisted: Persistence }> {
    const { db, crypto } = this.#need();
    if (!checkPassphrase(passphrase).ok) throw weak();
    const secret = secretFromHex(hex);
    let pub: Hex;
    try {
      pub = bytesToHex(publicKeyOf(secret));
      refuseTrackerKey(pub);
      // the sandbox key lies in localStorage as plain hex: it is never a mainnet key (keys review P2-7)
      if (this.#env.sandboxPub?.() === pub) throw new VaultError("sandbox-key-refused", "this is the sandbox key of this browser: its secret is kept as plain text, so it is never used for real funds");
    } catch (e) {
      wipe(secret);
      throw e;
    }
    const persistP = requestPersist(this.#env.storage);
    return this.#exclusive(async () => {
      try {
        const stored = await this.#load();
        if (stored.kind === "ok" && stored.rec.pub === pub) return { state: this.#state, alreadyPresent: true, persisted: await persistP };
        if (stored.kind !== "none") {
          this.#publish(stored);
          throw occupied(stored);
        }
        const epoch = this.#epoch;
        const lease = await this.#acquire(opts.takeOver === true);
        let started = false;
        try {
          const salt = this.#random(SALT_BYTES);
          const iv = this.#random(IV_BYTES);
          const key = await deriveKey(crypto.subtle, passphrase, salt, this.#iterations);
          const ct = await seal(crypto.subtle, key, iv, keyAad(pub), secret);
          const rec = this.#newRecord(pub, salt, this.#iterations, iv, ct, this.#env.now(), null, "hex");
          await this.#insert(db, rec);
          started = this.#openSession(lease, key, rec, epoch);
          this.#publish({ kind: "ok", rec }, started ? { lockReason: null } : {});
          this.#post("vault");
        } finally {
          if (!started) lease.release();
        }
      } finally {
        wipe(secret);
      }
      const persisted = await persistP;
      this.#set({ persisted });
      return { state: this.#state, alreadyPresent: false, persisted };
    });
  }

  /**
   * Forgets the key in this browser. A key without a verified backup needs `confirmUnbacked`. The journal stays (it
   * holds no secret and still guards against a second reserve) unless `journal` is set and every entry is closed.
   */
  async wipe(opts: WipeOptions = {}): Promise<VaultState> {
    const { db } = this.#need();
    return this.#exclusive(async () => {
      const stored = await this.#load();
      if (stored.kind === "none") {
        this.#lockNow("wiped");
        this.#publish(stored);
        return this.#state;
      }
      const backedUp = stored.kind === "ok" ? stored.rec.backedUpAt !== null : stored.backedUp;
      if (!backedUp && opts.confirmUnbacked !== true) throw new VaultError("not-backed-up", "this key has no verified backup: deleting it loses it for good");
      const own = this.#lease?.held ? this.#lease : null;
      const lease = own ?? (await this.#acquire(opts.takeOver === true));
      const pub = stored.kind === "ok" ? stored.rec.pub : null;
      try {
        await db.write(async (t) => {
          if (opts.journal === true && pub) await dropJournalOf(t, pub);
          await t.delete(STORE_VAULT, KEY_RECORD_ID);
        });
      } finally {
        if (lease !== own) lease.release();
      }
      this.#lockNow("wiped");
      this.#set({ status: "none", key: null, backedUp: false, lockReason: "wiped" });
      this.#post("vault");
      if (opts.journal === true && pub) await this.journal.reload().catch(() => undefined);
      return this.#state;
    });
  }

  // ─── using the key ───────────────────────────────────────────────────────────────────────────────

  /**
   * The only way to the secret: decrypts a fresh 32-byte copy, calls `fn(secret, pub)` synchronously and wipes the copy.
   * Needs an unlocked vault (this tab holds the signer lock) and a verified backup ("export-hex" excepted). Refuses a
   * callback that returns a promise ("async-callback") or returns or throws the secret ("secret-in-output"). "t1",
   * "withdraw", "note" and "export-hex" need `passphrase` here; signToJournal() signs withdrawals to this key and small
   * notes without it.
   */
  async withSecret<T>(purpose: SecretPurpose, fn: SecretCallback<T>, opts: SecretOptions = {}): Promise<T> {
    if (purpose === "export-hex" && isObject(opts) && opts.passphrase === undefined) throw needPass("revealing the key needs the passphrase", "export-hex");
    return this.#use(purpose, fn, opts, null);
  }

  /**
   * The passphrase rule for a note this key would sign now (policy.ts): what it adds, what was promised since the
   * passphrase was last typed, and whether it must be typed again. For the review screen; signToJournal applies the same.
   */
  notePolicy(intent: NoteIntent): NotePolicy {
    const s = this.#liveSession();
    return notePolicy(s.pub, intent, s.promised);
  }

  async #use<T>(purpose: SecretPurpose, fn: SecretCallback<T>, opts: SecretOptions, guard: Guard<T> | null): Promise<T> {
    const { crypto } = this.#need();
    if (!PURPOSES.includes(purpose)) throw new VaultError("bad-input", "unknown purpose");
    if (typeof fn !== "function") throw new VaultError("bad-input", "withSecret() takes a callback");
    if (typeof opts !== "object" || opts === null) throw new VaultError("bad-input", "the options are an object");
    const passphrase: unknown = opts.passphrase;
    if (passphrase !== undefined && typeof passphrase !== "string") throw new VaultError("bad-input", "the passphrase must be a string");
    const typed = passphrase !== undefined;
    this.#liveSession();
    return this.#exclusive(async () => {
      const s = this.#liveSession();
      const epoch = this.#epoch;
      const rec = await this.#sessionRecord(s, epoch);
      if (purpose !== "export-hex" && rec.backedUpAt === null) throw new VaultError("not-backed-up", "verify a backup file before signing");
      if (!guard && !typed && PASS_DIRECT.has(purpose)) throw needPass("this use of the key needs the passphrase", purpose);
      guard?.before?.(s, typed);
      const key = typeof passphrase !== "string" ? s.key : await deriveKey(crypto.subtle, passphrase, fromB64(rec.kdf.salt) as Uint8Array, rec.kdf.iterations);
      const secret = typeof passphrase !== "string" ? await this.#open(crypto, s) : await unseal(crypto.subtle, key, s.iv, s.aad, s.ct);
      try {
        if (this.#epoch !== epoch || this.#session !== s) throw lockedError();
        // the passphrase opened the key: a new count of notes signed without it starts here
        if (typed) s.promised.clear();
        let out: T;
        try {
          out = fn(secret, s.pubBytes.slice());
        } catch (err) {
          throw holdsSecret(err, secret) ? new VaultError("secret-in-output", "the callback's error held the secret key, or could not be checked") : err;
        }
        if (isThenable(out)) {
          Promise.resolve(out).catch(() => undefined);
          throw new VaultError("async-callback", "the secret callback must return synchronously");
        }
        if (purpose !== "export-hex" && holdsSecret(out, secret)) throw new VaultError("secret-in-output", "the callback's result held the secret key, or could not be checked");
        guard?.after?.(out, s, typed);
        this.#activity();
        return out;
      } finally {
        wipe(secret);
      }
    });
  }

  /**
   * Write-ahead signing: signs with `fn` (which returns the journal fields: txId, signedRaw, inputs …) and records the
   * result before anyone can send it. When the journal refuses (a second T1, say), the signed bytes are dropped. A T1 is
   * also checked against the journal before the key is touched. The passphrase rules (policy.ts) are enforced here:
   * t1 always; a withdrawal that pays anything but this key and at most the wallet's miner fee; a note over the 25 %
   * budget. A note needs `opts.note`, and the signed body must be that note; a redemption must pay this key.
   */
  async signToJournal(kind: JournalKind, fn: SecretCallback<Omit<JournalRecordInput, "kind" | "pub">>, opts: SecretOptions = {}): Promise<JournalEntry> {
    const pub = this.#session?.pub;
    const denomGiven: unknown = typeof opts === "object" && opts !== null ? opts.denom : undefined;
    const t1Denom = typeof denomGiven === "string" ? denomGiven : "erg";
    if (kind === "t1" && pub) {
      const first = await this.journal.activeT1(pub, t1Denom);
      if (first) throw new VaultError("t1-exists", "this key already has a reserve creation in the journal", { id: first.id, state: first.state });
    }
    const given: unknown = typeof opts === "object" && opts !== null ? opts.note : undefined;
    if (kind === "note" && !isObject(given)) throw new VaultError("bad-input", "a note needs opts.note: what it promises");
    const intent = given as NoteIntent;
    const ownerGiven: unknown = typeof opts === "object" && opts !== null ? opts.reserveOwner : undefined;
    const reserveOwner = typeof ownerGiven === "string" && /^0[23][0-9a-f]{64}$/.test(ownerGiven) ? ownerGiven : null;
    const boxesGiven: unknown = typeof opts === "object" && opts !== null ? opts.inputBoxes : undefined;
    const inputBoxes = Array.isArray(boxesGiven) ? (boxesGiven as ErgoBox[]) : undefined;
    type Part = Omit<JournalRecordInput, "kind" | "pub">;
    const guard: Guard<Part> = {
      before(s, typed) {
        if (kind === "t1" && !typed) throw needPass("a reserve creation needs the passphrase", "t1");
        if (RESERVE_ACTION_KINDS.includes(kind) && !typed) throw needPass("a top-up or a refund moves the reserve: it needs the passphrase", kind);
        if (kind === "topup" && !reserveOwner) throw new VaultError("bad-input", "a top-up needs opts.reserveOwner: the reviewed reserve's owner");
        if (kind === "note") {
          const p = notePolicy(s.pub, intent, s.promised); // also refuses a previous note that is not this key's
          if (p.passphrase && !typed) throw needPass("the notes since the passphrase was typed promise more than 25 % of the reserve", p.reserveValue > 0n ? "note-over-quarter" : "note-no-reserve");
        }
      },
      after(part, s, typed) {
        if (!isObject(part) || typeof part.signedRaw !== "string") return; // refused below as "bad-input"
        if (kind === "t1" && t1DenomOf({ meta: isObject(part.meta) ? (part.meta as JournalEntry["meta"]) : {} }) !== t1Denom) throw new VaultError("bad-input", "the reserve creation's meta.denom is not the denomination it was checked for (opts.denom)");
        if (kind === "withdraw" && !spendsOnlyOwnBoxes(part.signedRaw, s.pub, inputBoxes)) throw new VaultError("bad-input", "a withdrawal spends only this key's own boxes (opts.inputBoxes), without context variables");
        if (kind === "withdraw" && !typed && !paysOnlyOwnKey(part.signedRaw, s.pub)) throw needPass("a withdrawal to another address, or a fee above the wallet's, needs the passphrase", "withdraw-foreign");
        if (kind === "redeem" && !redemptionPaysOwnKey(part.signedRaw, s.pub)) throw new VaultError("bad-input", "a redemption pays this key: one input (action 0, another key's reserve), outputs [the reserve, P2PK(this key), a miner fee of at most 0.001 ERG]");
        if (kind === "redeem" && !redeemsReserveBox(part.signedRaw, inputBoxes)) throw new VaultError("bad-input", "a redemption spends one reserve-contract box: the reviewed box (opts.inputBoxes)");
        if (RESERVE_ACTION_KINDS.includes(kind) && !reserveActionPaysRight(part.signedRaw, s.pub, kind as ReserveActionKind, reserveOwner)) {
          throw new VaultError("bad-input", "a top-up or a refund pays only [the reserve (our tracker, the reviewed owner) or this key, change to this key, a miner fee of at most 0.001 ERG]");
        }
        if (kind === "note") {
          checkNoteBody(part.signedRaw, s.pub, intent);
          const key = promiseKey(intent.recipient, intent.denomination ?? "erg");
          if (!typed) s.promised.set(key, nextPromise(s.promised, key, intent.prev?.total ?? 0n, intent.total));
        }
      },
    };
    let signer = null as Hex | null;
    const part = await this.#use(
      kind,
      (secret, p) => {
        signer = bytesToHex(p);
        return fn(secret, p);
      },
      opts,
      guard,
    );
    if (!isObject(part) || signer === null) throw new VaultError("bad-input", "the callback must return the journal fields");
    return this.journal.record({ ...part, kind, pub: signer });
  }

  // ─── tabs, storage, auto-lock ────────────────────────────────────────────────────────────────────

  /** True when another tab holds the signer (this tab would get "locked-elsewhere"). */
  async signingElsewhere(): Promise<boolean> {
    const locks = this.#env.locks;
    if (!locks || this.#missing.length > 0 || this.#lease?.held || this.#opLease?.held) return false;
    return signerLockHeld(locks);
  }

  /** Asks navigator.storage.persist() again (the answer lands in the state). */
  async requestPersistence(): Promise<Persistence> {
    const p = await requestPersist(this.#env.storage);
    this.#set({ persisted: p });
    return p;
  }

  /** User activity: pushes the idle deadline. attachAutoLock() calls it. */
  touch(): void {
    if (this.#session) this.#activity();
  }

  /** The tab became hidden or visible. attachAutoLock() calls it. */
  setHidden(hidden: boolean): void {
    const n = this.#env.now();
    if (hidden) {
      if (this.#hiddenSince === null) this.#hiddenSince = n;
    } else {
      const why = this.#expired(n);
      if (why) this.#lockNow(why);
      this.#hiddenSince = null;
    }
    if (this.#session) this.#arm();
  }

  /** When the unlocked session will lock itself (ms since 1970), or null when locked. */
  expiresAt(): number | null {
    return this.#session ? this.#deadline() : null;
  }

  /** Locks and lets go of the database and the channel (tests, page teardown). */
  close(): void {
    if (this.#closed) return;
    this.#lockNow("manual");
    this.#closed = true;
    if (this.#channel) {
      this.#channel.onmessage = null;
      try {
        this.#channel.close();
      } catch {
        /* already closed */
      }
      this.#channel = null;
    }
    this.#db?.close();
  }

  toJSON(): { type: "MainnetVault"; status: VaultStatus; pub: Hex | null } {
    return { type: "MainnetVault", status: this.#state.status, pub: this.#state.key?.pub ?? null };
  }

  toString(): string {
    return `MainnetVault <${this.#state.status}${this.#state.key ? ` ${this.#state.key.pub.slice(0, 10)}…` : ""}>`;
  }

  [INSPECT](): string {
    return this.toString();
  }

  // ─── internals ───────────────────────────────────────────────────────────────────────────────────

  #need(): { db: VaultDb; crypto: CryptoLike; locks: LockManagerLike } {
    if (this.#closed) throw new VaultError("unsupported", "this vault was closed", { missing: "closed" });
    const { crypto, locks } = this.#env;
    if (this.#missing.length > 0 || !this.#db || !crypto || !locks) throw new VaultError("unsupported", "this browser lacks what a mainnet key needs", { missing: this.#missing.join(",") });
    return { db: this.#db, crypto, locks };
  }

  #random(n: number): Uint8Array {
    const c = this.#env.crypto;
    if (!c) throw new VaultError("unsupported", "WebCrypto is missing", { missing: "webcrypto" });
    return c.getRandomValues(new Uint8Array(n));
  }

  /** One operation at a time in this tab (lock() is never queued: it bumps the epoch and wins). */
  #exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async #load(): Promise<Stored> {
    const db = this.#db;
    if (!db) throw new VaultError("unsupported", "the vault needs IndexedDB", { missing: "indexeddb" });
    const raw = await db.read((t) => t.get<unknown>(STORE_VAULT, KEY_RECORD_ID));
    if (raw === undefined) return { kind: "none" };
    const rec = parseKeyRecord(raw, this.#iterations);
    return rec ? { kind: "ok", rec } : { kind: "damaged", backedUp: isObject(raw) && typeof raw.backedUpAt === "number" };
  }

  async #insert(db: VaultDb, rec: KeyRecord): Promise<void> {
    await db.write(async (t) => {
      if ((await t.get<unknown>(STORE_VAULT, KEY_RECORD_ID)) !== undefined) throw new VaultError("exists", "a mainnet key already exists in this browser");
      await t.put(STORE_VAULT, KEY_RECORD_ID, rec);
    });
  }

  async #markBackedUp(db: VaultDb, pub: Hex): Promise<VaultState> {
    const now = this.#env.now();
    const rec = await db.write(async (t) => {
      const raw = await t.get<unknown>(STORE_VAULT, KEY_RECORD_ID);
      const r = parseKeyRecord(raw, this.#iterations);
      if (!r || r.pub !== pub) throw new VaultError("no-key", "the key changed while its backup was checked");
      if (r.backedUpAt !== null) return r;
      const next: KeyRecord = { ...r, backedUpAt: now };
      await t.put(STORE_VAULT, KEY_RECORD_ID, next);
      return next;
    });
    this.#publish({ kind: "ok", rec });
    this.#post("vault");
    return this.#state;
  }

  #newRecord(pub: Hex, salt: Uint8Array, iterations: number, iv: Uint8Array, ct: Uint8Array, createdAt: number, backedUpAt: number | null, source: KeySource): KeyRecord {
    return {
      format: KEY_FORMAT,
      v: 1,
      network: NETWORK,
      pub,
      address: addressOf(pub),
      kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: toB64(salt) },
      cipher: { name: "AES-GCM", iv: toB64(iv), tagLength: 128, aad: keyAad(pub) },
      ct: toB64(ct),
      createdAt,
      backedUpAt,
      source,
    };
  }

  /** Derives the key from the passphrase and seals a new secret (wiped here, whatever happens). */
  async #sealSecret(crypto: CryptoLike, secret: Uint8Array, passphrase: string, salt: Uint8Array, iterations: number, iv: Uint8Array): Promise<{ pub: Hex; key: CryptoKey; ct: Uint8Array }> {
    try {
      const pub = bytesToHex(publicKeyOf(secret));
      refuseTrackerKey(pub);
      const key = await deriveKey(crypto.subtle, passphrase, salt, iterations);
      return { pub, key, ct: await seal(crypto.subtle, key, iv, keyAad(pub), secret) };
    } finally {
      wipe(secret);
    }
  }

  /** Checks a decrypted backup secret (tracker key, then its public key) and seals it for the record. Wipes it. */
  async #resealChecked(crypto: CryptoLike, secret: Uint8Array, pub: Hex, key: CryptoKey, iv: Uint8Array): Promise<Uint8Array> {
    try {
      const derived = publicKeyOf(secret);
      refuseTrackerKey(derived);
      if (!sameBytes(derived, hexToBytes(pub))) throw new VaultError("bad-backup", "the backup's secret does not match its public key");
      return await seal(crypto.subtle, key, iv, keyAad(pub), secret);
    } finally {
      wipe(secret);
    }
  }

  /** Derives the key for a stored record and proves it opens it. Returns the AES key. */
  async #checkPassphrase(crypto: CryptoLike, rec: KeyRecord, passphrase: string): Promise<CryptoKey> {
    const key = await deriveKey(crypto.subtle, passphrase, fromB64(rec.kdf.salt) as Uint8Array, rec.kdf.iterations);
    const secret = await unseal(crypto.subtle, key, fromB64(rec.cipher.iv) as Uint8Array, rec.cipher.aad, fromB64(rec.ct) as Uint8Array);
    try {
      if (!sameBytes(publicKeyOf(secret), hexToBytes(rec.pub))) throw new VaultError("damaged", "the stored key does not match its public key");
    } finally {
      wipe(secret);
    }
    return key;
  }

  /** Proves a backup file decrypts, with this passphrase, to the key it names. Returns the derived AES key. */
  async #proveFile(crypto: CryptoLike, file: BackupFile, passphrase: string): Promise<CryptoKey> {
    const key = await deriveKey(crypto.subtle, passphrase, fromB64(file.kdf.salt) as Uint8Array, file.kdf.iterations);
    const secret = await unseal(crypto.subtle, key, fromB64(file.cipher.iv) as Uint8Array, file.cipher.aad, fromB64(file.ct) as Uint8Array);
    try {
      if (!sameBytes(publicKeyOf(secret), hexToBytes(file.pub))) throw new VaultError("bad-backup", "the backup's secret does not match its public key");
    } finally {
      wipe(secret);
    }
    return key;
  }

  /** The stored record behind a session; locks when it changed or vanished (another tab, cleared site data). */
  async #sessionRecord(s: Session, epoch: number): Promise<KeyRecord> {
    const stored = await this.#load();
    if (this.#epoch !== epoch || this.#session !== s) throw lockedError();
    if (stored.kind !== "ok" || stored.rec.pub !== s.pub || stored.rec.ct !== s.ctB64) {
      this.#lockNow("storage-changed");
      this.#publish(stored);
      throw new VaultError("locked", "the stored key changed: the vault locked itself");
    }
    return stored.rec;
  }

  async #open(crypto: CryptoLike, s: Session): Promise<Uint8Array> {
    try {
      return await unseal(crypto.subtle, s.key, s.iv, s.aad, s.ct);
    } catch {
      this.#lockNow("storage-changed");
      throw new VaultError("damaged", "the session could not open the stored key");
    }
  }

  async #acquire(takeOver: boolean): Promise<SignerLease> {
    const { locks } = this.#need();
    const lease = await acquireSignerLock(locks, takeOver, (l) => {
      if (this.#lease === l) this.#lockNow("taken-over");
    });
    if (!lease) throw new VaultError("locked-elsewhere", "another tab is using this key");
    this.#opLease = lease;
    return lease;
  }

  #openSession(lease: SignerLease, key: CryptoKey, rec: KeyRecord, epoch: number): boolean {
    if (this.#epoch !== epoch || !lease.held || this.#closed) return false;
    const iv = fromB64(rec.cipher.iv, IV_BYTES);
    const ct = fromB64(rec.ct, CT_BYTES);
    if (!iv || !ct) return false;
    this.#session = { key, iv, ct, ctB64: rec.ct, aad: rec.cipher.aad, pub: rec.pub, pubBytes: hexToBytes(rec.pub), promised: new Map() };
    this.#lease = lease;
    this.#opLease = null;
    const n = this.#env.now();
    this.#lastActivity = n;
    if (this.#hiddenSince !== null) this.#hiddenSince = n;
    this.#arm();
    return true;
  }

  #lockNow(reason: LockReason): void {
    this.#epoch++;
    const s = this.#session;
    this.#session = null;
    const lease = this.#lease;
    this.#lease = null;
    lease?.release();
    this.#disarm();
    if (s) {
      wipe(s.ct, s.iv);
      this.#set({ status: this.#state.status === "unlocked" ? "locked" : this.#state.status, lockReason: reason });
    }
  }

  #liveSession(): Session {
    const s = this.#session;
    if (!s) throw lockedError();
    if (!this.#lease?.held) {
      this.#lockNow("lost");
      throw lockedError();
    }
    const why = this.#expired(this.#env.now());
    if (why) {
      this.#lockNow(why);
      throw lockedError();
    }
    return s;
  }

  #activity(): void {
    const n = this.#env.now();
    const why = this.#expired(n);
    if (why) {
      this.#lockNow(why);
      return;
    }
    this.#lastActivity = n;
    if (n - this.#armedAt >= 1000) this.#arm();
  }

  #deadline(): number {
    const idle = this.#lastActivity + this.#idleMs;
    return this.#hiddenSince === null ? idle : Math.min(idle, this.#hiddenSince + this.#hiddenMs);
  }

  #expired(n: number): LockReason | null {
    if (!this.#session) return null;
    if (this.#hiddenSince !== null && n - this.#hiddenSince >= this.#hiddenMs) return "hidden";
    if (n - this.#lastActivity >= this.#idleMs) return "idle";
    return null;
  }

  /** One timer for the nearest deadline. Late timers (background tabs) are covered: every use checks the clock first. */
  #arm(): void {
    this.#disarm();
    if (!this.#session) return;
    const n = this.#env.now();
    this.#armedAt = n;
    const delay = Math.min(Math.max(0, this.#deadline() - n), 2 ** 31 - 1);
    this.#timer = this.#env.setTimer(() => {
      this.#timer = null;
      const why = this.#expired(this.#env.now());
      if (why) this.#lockNow(why);
      else this.#arm();
    }, delay);
  }

  #disarm(): void {
    if (this.#timer !== null) {
      this.#env.clearTimer(this.#timer);
      this.#timer = null;
    }
  }

  #onMessage(data: unknown): void {
    const t = isObject(data) ? data.t : undefined;
    if (t === "vault") void this.refresh().catch(() => undefined);
    else if (t === "journal") void this.journal.reload().catch(() => undefined);
  }

  #post(t: "vault" | "journal"): void {
    try {
      this.#channel?.postMessage({ t });
    } catch {
      /* closed */
    }
  }
}

/**
 * Opens the vault: IndexedDB, the stored record, the journal. Never throws for a missing browser feature: the state is
 * then "unsupported" with `missing`, and every key operation throws "unsupported".
 */
export async function openVault(o: VaultOptions = {}): Promise<MainnetVault> {
  const env: VaultEnv = { ...browserEnv(), ...o.env };
  const test = o.unsafeTestKdfIterations;
  if (test !== undefined) {
    if (import.meta.env.PROD) throw new VaultError("bad-input", "unsafeTestKdfIterations is for tests only");
    if (!Number.isSafeInteger(test) || test < 1) throw new VaultError("bad-input", "unsafeTestKdfIterations must be a positive integer");
  }
  for (const [name, v] of [["idleLockMs", o.idleLockMs], ["hiddenLockMs", o.hiddenLockMs]] as const) {
    if (v !== undefined && (!Number.isSafeInteger(v) || v < 1000)) throw new VaultError("bad-input", `${name} must be at least 1000 ms`);
  }
  const missing: MissingFeature[] = [];
  let db: VaultDb | null = null;
  if (env.indexedDB) {
    try {
      db = await VaultDb.open(env.indexedDB, o.dbName ?? DB_NAME);
    } catch {
      db = null;
    }
  }
  if (!db) missing.push("indexeddb");
  if (!env.crypto) missing.push("webcrypto");
  if (!env.locks) missing.push("web-locks");
  const vault = new MainnetVault({ env, db, missing, iterations: test ?? KDF_ITERATIONS, idleMs: o.idleLockMs ?? IDLE_LOCK_MS, hiddenMs: o.hiddenLockMs ?? HIDDEN_LOCK_MS });
  await vault.refresh();
  if (db) await vault.journal.reload().catch(() => undefined);
  return vault;
}

let shared: Promise<MainnetVault> | null = null;

/** The page's one vault (browser environment, opened once). */
export function getMainnetVault(): Promise<MainnetVault> {
  if (!shared) {
    shared = openVault();
    shared.catch(() => {
      shared = null;
    });
  }
  return shared;
}
