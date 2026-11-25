// Write-ahead transaction journal (design §4.2 "Journal", §4.5, §8.3): IndexedDB "basis-mainnet" / "journal".
//
//   1. sign, then record() the signed bytes          — before anything is sent anywhere;
//   2. markSending() right before every (re)broadcast — so "never sent" stays provable;
//   3. send entry.signedRaw exactly as stored          — the same bytes every time (idempotent);
//   4. update() with what the chain or the tracker shows (sent → mempool → confirmed → final), or failed.
//
// One rule is enforced here, atomically across tabs: a key has at most one reserve creation (T1) that is not failed or
// abandoned. A second reserve of the same key would make the tracker refuse every new note of that key until one reserve
// is refunded (about 60 days). Signed transactions hold no secrets; the journal never holds the key.
import { bytesToHex } from "@noble/hashes/utils";
import { utf8Length } from "./bytes";
import { STORE_JOURNAL, STORE_META } from "./constants";
import type { DbTx, VaultDb } from "./db";
import { VaultError } from "./errors";
import { isPublicKeyHex, type Hex } from "./keys";
import { isObject } from "./record";

/** t1 creates the reserve; topup, refund-start and refund-end are the reserve's own actions (basis.es #1–#3). */
export type JournalKind = "t1" | "note" | "redeem" | "withdraw" | "topup" | "refund-start" | "refund-end";
export type JournalState = "signed" | "sent" | "mempool" | "confirmed" | "final" | "failed" | "abandoned";
export type JournalMetaValue = string | number | boolean | null;
export type JournalMeta = Readonly<Record<string, JournalMetaValue>>;

export interface JournalEntry {
  readonly v: 1;
  readonly id: string;
  readonly kind: JournalKind;
  /** The key that signed it. */
  readonly pub: Hex;
  readonly state: JournalState;
  /** Transaction id (every kind but a note); null for a note. */
  readonly txId: Hex | null;
  /** The exact text to (re)send: the signed transaction JSON, or the note's POST body. */
  readonly signedRaw: string;
  /** Redeem: the build's raw `unsigned_tx` (the submit echoes it byte for byte). Optional for other kinds. */
  readonly unsignedRaw: string | null;
  /** Box ids the transaction spends (conflict checks, coin selection). Empty for a note. */
  readonly inputs: readonly Hex[];
  readonly createdAt: number;
  readonly updatedAt: number;
  /** How many times markSending() ran. 0 = provably never sent. */
  readonly sendAttempts: number;
  readonly firstSendAt: number | null;
  readonly lastSendAt: number | null;
  /** Chain height at the last check. */
  readonly lastHeight: number | null;
  readonly inclusionHeight: number | null;
  /** Last error, plain text, at most 300 characters (render as text, never as HTML). */
  readonly error: string | null;
  /** Flow data: amounts as decimal strings, ids, flags. */
  readonly meta: JournalMeta;
  /** T1 only: when retireT1() recorded that its reserve was fully refunded (a new T1 is allowed again), or null. */
  readonly retiredAt: number | null;
}

export interface JournalRecordInput {
  kind: JournalKind;
  pub: Hex;
  txId?: Hex | null;
  signedRaw: string;
  unsignedRaw?: string | null;
  inputs?: readonly Hex[];
  meta?: Record<string, JournalMetaValue>;
  /** Chain height when it was signed. */
  height?: number | null;
}

export interface JournalPatch {
  state?: JournalState;
  lastHeight?: number | null;
  inclusionHeight?: number | null;
  error?: string | null;
  /** Merged into the entry's meta. */
  meta?: Record<string, JournalMetaValue>;
}

export interface JournalFilter {
  pub?: Hex;
  kind?: JournalKind;
  /** true: only open entries (signed, sent, mempool, confirmed); false: only closed ones. */
  open?: boolean;
}

export const JOURNAL_KINDS: readonly JournalKind[] = ["t1", "note", "redeem", "withdraw", "topup", "refund-start", "refund-end"];
/** The reserve's own actions after T1: they spend the reserve box itself. */
export const RESERVE_ACTION_KINDS: readonly JournalKind[] = ["topup", "refund-start", "refund-end"];
export const JOURNAL_STATES: readonly JournalState[] = ["signed", "sent", "mempool", "confirmed", "final", "failed", "abandoned"];
/** Still in flight: shown as pending, polled, rebroadcast. */
export const OPEN_STATES: readonly JournalState[] = ["signed", "sent", "mempool", "confirmed"];
export const MAX_RAW_BYTES = 64 * 1024;
export const MAX_ERROR_CHARS = 300;
export const MAX_INPUTS = 256;

const TX_KINDS: ReadonlySet<JournalKind> = new Set(["t1", "redeem", "withdraw", "topup", "refund-start", "refund-end"]);
const HEX64 = /^[0-9a-f]{64}$/;
const META_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/**
 * Allowed state changes. sent, mempool and confirmed may move among themselves (a drop from the mempool, a reorg);
 * final can still go back to sent, mempool or confirmed (a reorg deeper than its 2 blocks); abandoned is terminal;
 * failed can still be seen in the mempool or become confirmed or final, because the chain has the last word.
 * "abandoned" is reached only through abandon(), and only before the first send.
 */
const NEXT: Readonly<Record<JournalState, readonly JournalState[]>> = {
  signed: ["sent", "mempool", "confirmed", "final", "failed"],
  sent: ["mempool", "confirmed", "final", "failed"],
  mempool: ["sent", "confirmed", "final", "failed"],
  confirmed: ["sent", "mempool", "final", "failed"],
  final: ["sent", "mempool", "confirmed"],
  failed: ["mempool", "confirmed", "final"],
  abandoned: [],
};

export const isOpenState = (s: JournalState): boolean => OPEN_STATES.includes(s);
/**
 * A T1 blocks a new T1 of the same key unless it failed, was abandoned, or was retired: once confirmed, the reserve
 * exists, and a second one would be quarantined (design §8.3). Stricter than "while unresolved", on purpose; after a
 * full refund the flow calls retireT1().
 */
export const blocksNewT1 = (e: JournalEntry): boolean => e.kind === "t1" && e.state !== "failed" && e.state !== "abandoned" && (e.retiredAt ?? null) === null;

/** The denomination of a T1 entry: its `meta.denom` ("token:<id>"), or "erg" (every ERG T1, old and new, has none). */
export const t1DenomOf = (e: Pick<JournalEntry, "meta">): string => (typeof e.meta.denom === "string" ? e.meta.denom : "erg");
/** blocksNewT1 for one denomination: the tracker keeps one reserve per key and denomination, so an ERG T1 never blocks
 *  a SigUSD T1 and the other way round. */
export const blocksNewT1In = (e: JournalEntry, denom: string): boolean => blocksNewT1(e) && t1DenomOf(e) === denom;

/** Scope of the receiver's build-request timestamps (design §6.6). */
export const buildScope = (receiver: Hex): string => `build|${receiver}`;
/** Scope of an issuer's note timestamps toward one recipient. */
export const noteScope = (issuer: Hex, recipient: Hex): string => `note|${issuer}|${recipient}`;

const bad = (message: string, detail?: Record<string, string | number | boolean | null>) => new VaultError("bad-input", message, detail);

function isEntry(e: unknown): e is JournalEntry {
  return isObject(e) && e.v === 1 && typeof e.id === "string" && JOURNAL_KINDS.includes(e.kind as JournalKind) && JOURNAL_STATES.includes(e.state as JournalState) && Array.isArray(e.inputs);
}

function freezeEntry(e: JournalEntry): JournalEntry {
  return Object.freeze({ ...e, inputs: Object.freeze([...e.inputs]), meta: Object.freeze({ ...e.meta }) });
}

const byNewest = (a: JournalEntry, b: JournalEntry): number => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function checkRaw(v: unknown, field: string): string {
  if (typeof v !== "string" || v.length === 0) throw bad(`${field} must be the exact JSON text`);
  if (utf8Length(v) > MAX_RAW_BYTES) throw bad(`${field} is larger than ${MAX_RAW_BYTES} bytes`);
  try {
    JSON.parse(v);
  } catch {
    throw bad(`${field} is not JSON`);
  }
  return v;
}

function checkMeta(v: unknown): JournalMeta {
  if (v === undefined) return {};
  if (!isObject(v)) throw bad("meta must be a flat object");
  const keys = Object.keys(v);
  if (keys.length > 32) throw bad("meta holds more than 32 fields");
  const out: Record<string, JournalMetaValue> = {};
  for (const k of keys) {
    const x = v[k];
    if (!META_KEY.test(k)) throw bad("a meta field name is not allowed");
    const ok = x === null || typeof x === "boolean" || (typeof x === "number" && Number.isFinite(x)) || (typeof x === "string" && x.length <= 2048);
    if (!ok) throw bad("meta values are strings (≤ 2048 characters), finite numbers, booleans or null", { field: k });
    out[k] = x;
  }
  return out;
}

function checkHeight(v: unknown, field: string): number | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw bad(`${field} must be a block height`);
  return v;
}

function checkInputs(v: unknown, isTx: boolean): Hex[] {
  if (v === undefined && !isTx) return [];
  if (!Array.isArray(v)) throw bad("inputs must be a list of box ids");
  if (!isTx && v.length > 0) throw bad("a note spends no boxes");
  if (isTx && v.length === 0) throw bad("a transaction spends at least one box");
  if (v.length > MAX_INPUTS) throw bad(`more than ${MAX_INPUTS} inputs`);
  const out: Hex[] = [];
  for (const x of v) {
    if (typeof x !== "string" || !HEX64.test(x)) throw bad("a box id is 64 lowercase hex characters");
    if (out.includes(x)) throw bad("a box is listed twice");
    out.push(x);
  }
  return out;
}

const cutError = (s: string): string => [...String(s)].slice(0, MAX_ERROR_CHARS).join("");

export interface JournalDeps {
  db: VaultDb | null;
  now: () => number;
  random: (n: number) => Uint8Array;
  /** Tells the other tabs that the journal changed. */
  post: () => void;
}

/** Deletes a key's closed journal entries and timestamp counters inside a vault write. Refuses while any is open. */
export async function dropJournalOf(t: DbTx, pub: Hex): Promise<number> {
  const mine = (await t.getAll<unknown>(STORE_JOURNAL)).filter(isEntry).filter((e) => e.pub === pub);
  const open = mine.find((e) => isOpenState(e.state));
  if (open) throw new VaultError("journal-unresolved", "some journal entries of this key are still open", { id: open.id, state: open.state });
  for (const e of mine) await t.delete(STORE_JOURNAL, e.id);
  for (const k of await t.keys(STORE_META)) if (k.startsWith(`ts|build|${pub}`) || k.startsWith(`ts|note|${pub}|`)) await t.delete(STORE_META, k);
  return mine.length;
}

export class MainnetJournal {
  readonly #deps: JournalDeps;
  #entries: readonly JournalEntry[] = Object.freeze([]);
  readonly #listeners = new Set<() => void>();

  constructor(deps: JournalDeps) {
    this.#deps = deps;
  }

  /** For useSyncExternalStore: all entries (every key), newest first. Stable until a change. */
  readonly getSnapshot = (): readonly JournalEntry[] => this.#entries;

  readonly subscribe = (fn: () => void): (() => void) => {
    this.#listeners.add(fn);
    return () => {
      this.#listeners.delete(fn);
    };
  };

  #db(): VaultDb {
    const db = this.#deps.db;
    if (!db || db.closed) throw new VaultError("unsupported", "the journal needs IndexedDB", { missing: "indexeddb" });
    return db;
  }

  /** Re-reads every entry (after a change in another tab) and notifies subscribers. */
  async reload(): Promise<readonly JournalEntry[]> {
    const all = await this.#db().read((t) => t.getAll<unknown>(STORE_JOURNAL));
    this.#entries = Object.freeze(all.filter(isEntry).map(freezeEntry).sort(byNewest));
    for (const l of [...this.#listeners]) l();
    return this.#entries;
  }

  async #changed(): Promise<void> {
    await this.reload().catch(() => undefined);
    this.#deps.post();
  }

  /**
   * Write-ahead: stores a signed transaction (or note) before it is sent. Recording the same transaction again returns
   * the stored entry. Throws "t1-exists" for a second reserve creation of the same key (detail.id names the first).
   */
  async record(input: JournalRecordInput): Promise<JournalEntry> {
    if (typeof input !== "object" || input === null) throw bad("record() takes an entry");
    const kind = input.kind;
    if (!JOURNAL_KINDS.includes(kind)) throw bad("unknown journal kind");
    if (!isPublicKeyHex(input.pub)) throw bad("pub must be a compressed public key in lowercase hex");
    const isTx = TX_KINDS.has(kind);
    const txId = input.txId ?? null;
    if (isTx && (typeof txId !== "string" || !HEX64.test(txId))) throw bad("a transaction entry needs its 64-hex transaction id");
    if (!isTx && txId !== null) throw bad("a note entry has no transaction id");
    const signedRaw = checkRaw(input.signedRaw, "signedRaw");
    const unsignedRaw = input.unsignedRaw === undefined || input.unsignedRaw === null ? null : checkRaw(input.unsignedRaw, "unsignedRaw");
    if (kind === "redeem" && unsignedRaw === null) throw bad("a redemption keeps the build's raw unsigned_tx (the submit echoes it)");
    if (isTx) {
      const parsed: unknown = JSON.parse(signedRaw);
      if (isObject(parsed) && "id" in parsed && parsed.id !== txId) throw bad("the signed transaction's id differs from txId");
    }
    const now = this.#deps.now();
    const entry: JournalEntry = {
      v: 1,
      id: bytesToHex(this.#deps.random(16)),
      kind,
      pub: input.pub,
      state: "signed",
      txId,
      signedRaw,
      unsignedRaw,
      inputs: checkInputs(input.inputs, isTx),
      createdAt: now,
      updatedAt: now,
      sendAttempts: 0,
      firstSendAt: null,
      lastSendAt: null,
      lastHeight: checkHeight(input.height, "height"),
      inclusionHeight: null,
      error: null,
      meta: checkMeta(input.meta),
      retiredAt: null,
    };
    const out = await this.#db().write(async (t) => {
      const all = (await t.getAll<unknown>(STORE_JOURNAL)).filter(isEntry);
      if (entry.txId !== null) {
        const same = all.find((e) => e.txId === entry.txId);
        if (same) {
          if (same.kind === entry.kind && same.pub === entry.pub && same.signedRaw === entry.signedRaw) return same;
          throw bad("another journal entry has this transaction id", { id: same.id });
        }
      }
      if (entry.kind === "t1") {
        const first = all.find((e) => e.pub === entry.pub && blocksNewT1In(e, t1DenomOf(entry)));
        if (first) throw new VaultError("t1-exists", "this key already has a reserve creation in the journal", { id: first.id, state: first.state });
      }
      await t.put(STORE_JOURNAL, entry.id, entry);
      return entry;
    });
    await this.#changed();
    return freezeEntry(out);
  }

  /** Call right before every broadcast or submit of `signedRaw`; refuses closed entries. */
  async markSending(id: string): Promise<JournalEntry> {
    return this.#mutate(id, (e, now) => {
      if (!isOpenState(e.state)) throw new VaultError("bad-transition", "this entry is closed and is never sent again", { id, state: e.state });
      return { ...e, sendAttempts: e.sendAttempts + 1, firstSendAt: e.firstSendAt ?? now, lastSendAt: now, updatedAt: now };
    });
  }

  /** Records what was observed: a new state (see the transition rules), heights, an error, meta fields. */
  async update(id: string, patch: JournalPatch): Promise<JournalEntry> {
    if (typeof patch !== "object" || patch === null) throw bad("update() takes a patch");
    if (patch.state !== undefined && !JOURNAL_STATES.includes(patch.state)) throw bad("unknown journal state");
    const lastHeight = patch.lastHeight === undefined ? undefined : checkHeight(patch.lastHeight, "lastHeight");
    const inclusionHeight = patch.inclusionHeight === undefined ? undefined : checkHeight(patch.inclusionHeight, "inclusionHeight");
    if (patch.error !== undefined && patch.error !== null && typeof patch.error !== "string") throw bad("error must be text or null");
    const meta = patch.meta === undefined ? undefined : checkMeta(patch.meta);
    return this.#mutate(id, (e, now) => {
      let state = e.state;
      if (patch.state !== undefined && patch.state !== e.state) {
        if (!NEXT[e.state].includes(patch.state)) throw new VaultError("bad-transition", "this state change is not allowed", { id, from: e.state, to: patch.state });
        state = patch.state;
      }
      return {
        ...e,
        state,
        updatedAt: now,
        lastHeight: lastHeight === undefined ? e.lastHeight : lastHeight,
        inclusionHeight: inclusionHeight === undefined ? e.inclusionHeight : inclusionHeight,
        error: patch.error === undefined ? e.error : patch.error === null ? null : cutError(patch.error),
        meta: meta === undefined ? e.meta : checkMeta({ ...e.meta, ...meta }),
      };
    });
  }

  /** Drops an entry that was never sent (sendAttempts 0). Anything that may have reached the network can only fail. */
  async abandon(id: string): Promise<JournalEntry> {
    return this.#mutate(id, (e, now) => {
      if (e.state !== "signed" || e.sendAttempts > 0) throw new VaultError("bad-transition", "only an entry that was never sent can be abandoned", { id, state: e.state, sendAttempts: e.sendAttempts });
      return { ...e, state: "abandoned", updatedAt: now };
    });
  }

  /**
   * Records that the reserve of a final T1 no longer exists (fully refunded): that T1 stops blocking a new one. Call it
   * only after the chain shows the refund final and no reserve of this key left.
   */
  async retireT1(id: string): Promise<JournalEntry> {
    return this.#mutate(id, (e, now) => {
      if (e.kind !== "t1" || e.state !== "final") throw new VaultError("bad-transition", "only a final reserve creation can be retired", { id, kind: e.kind, state: e.state });
      if ((e.retiredAt ?? null) !== null) return e;
      return { ...e, retiredAt: now, updatedAt: now };
    });
  }

  async #mutate(id: string, fn: (e: JournalEntry, now: number) => JournalEntry): Promise<JournalEntry> {
    if (typeof id !== "string" || id.length === 0) throw bad("a journal id is a string");
    const now = this.#deps.now();
    const out = await this.#db().write(async (t) => {
      const e = await t.get<unknown>(STORE_JOURNAL, id);
      if (!isEntry(e)) throw new VaultError("not-found", "no journal entry has this id", { id });
      const next = fn(e, now);
      await t.put(STORE_JOURNAL, id, next);
      return next;
    });
    await this.#changed();
    return freezeEntry(out);
  }

  async get(id: string): Promise<JournalEntry | null> {
    const e = await this.#db().read((t) => t.get<unknown>(STORE_JOURNAL, id));
    return isEntry(e) ? freezeEntry(e) : null;
  }

  /** Fresh from storage, newest first. */
  async list(f: JournalFilter = {}): Promise<JournalEntry[]> {
    const all = await this.#db().read((t) => t.getAll<unknown>(STORE_JOURNAL));
    return all
      .filter(isEntry)
      .filter((e) => (f.pub === undefined || e.pub === f.pub) && (f.kind === undefined || e.kind === f.kind) && (f.open === undefined || isOpenState(e.state) === f.open))
      .map(freezeEntry)
      .sort(byNewest);
  }

  /** Open entries (signed, sent, mempool, confirmed): poll them, and rebroadcast the same bytes after a reload. */
  async unresolved(pub?: Hex): Promise<JournalEntry[]> {
    return this.list({ pub, open: true });
  }

  /** The T1 of this key that blocks a new one in `denom` (ERG by default), or null. */
  async activeT1(pub: Hex, denom: string = "erg"): Promise<JournalEntry | null> {
    return (await this.list({ pub, kind: "t1" })).find((e) => blocksNewT1In(e, denom)) ?? null;
  }

  /** Box ids spent by open entries: coin selection must skip them. */
  async inFlightInputs(pub?: Hex): Promise<Set<Hex>> {
    const out = new Set<Hex>();
    for (const e of await this.unresolved(pub)) for (const b of e.inputs) out.add(b);
    return out;
  }

  /**
   * A strictly increasing timestamp per scope, kept across reloads and tabs: max(last + 1, candidate). Build requests:
   * claimTimestamp(buildScope(me), serverNow). Notes: claimTimestamp(noteScope(me, to), max(pairTs + 1, serverNow − 2000)).
   * The claim is stored before it is used, so a request that fails never lets a later one go back in time.
   */
  async claimTimestamp(scope: string, candidateMs: number): Promise<number> {
    if (typeof scope !== "string" || scope.length === 0 || scope.length > 200) throw bad("a timestamp scope is 1–200 characters");
    if (typeof candidateMs !== "number" || !Number.isFinite(candidateMs) || candidateMs < 0) throw bad("the candidate is a time in ms");
    const want = Math.floor(candidateMs);
    const now = this.#deps.now();
    return this.#db().write(async (t) => {
      const cur = await t.get<unknown>(STORE_META, `ts|${scope}`);
      const last = isObject(cur) && typeof cur.last === "number" && Number.isSafeInteger(cur.last) ? cur.last : -1;
      const next = Math.max(last + 1, want);
      if (!Number.isSafeInteger(next)) throw bad("the timestamp is out of range");
      await t.put(STORE_META, `ts|${scope}`, { last: next, at: now });
      return next;
    });
  }

  /**
   * Takes back the scope's last claim after the server refused that very timestamp for being too far from its clock
   * (a build request's 120 s window): the last claim becomes `toMs`, so the next claim can follow the server's clock
   * again. Does nothing (false) when a later claim was made meanwhile, or when `toMs` is not below the refused claim.
   */
  async rewindTimestamp(scope: string, refusedMs: number, toMs: number): Promise<boolean> {
    if (typeof scope !== "string" || scope.length === 0 || scope.length > 200) throw bad("a timestamp scope is 1–200 characters");
    if (!Number.isSafeInteger(refusedMs) || !Number.isSafeInteger(toMs) || toMs < 0) throw bad("the timestamps are times in ms");
    const now = this.#deps.now();
    return this.#db().write(async (t) => {
      const cur = await t.get<unknown>(STORE_META, `ts|${scope}`);
      const last = isObject(cur) && typeof cur.last === "number" && Number.isSafeInteger(cur.last) ? cur.last : null;
      if (last !== refusedMs || toMs >= refusedMs) return false;
      await t.put(STORE_META, `ts|${scope}`, { last: toMs, at: now });
      return true;
    });
  }

  /** The last claimed timestamp of a scope, or null. */
  async lastTimestamp(scope: string): Promise<number | null> {
    const cur = await this.#db().read((t) => t.get<unknown>(STORE_META, `ts|${scope}`));
    return isObject(cur) && typeof cur.last === "number" ? cur.last : null;
  }
}
