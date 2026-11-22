// Errors of the mainnet vault and its journal. A message is a fixed developer sentence: it never holds a secret, a
// passphrase or the contents of a file. The UI maps `code` to its own text; `detail` carries only ids, state names and
// DOMException names.

export type VaultErrorCode =
  /** IndexedDB, WebCrypto or Web Locks is missing (detail.missing). */
  | "unsupported"
  /** An IndexedDB request failed (detail.reason is the DOMException name, e.g. QuotaExceededError). */
  | "storage-failed"
  | "no-key"
  | "exists"
  /** The stored key record is malformed or does not match itself. */
  | "damaged"
  | "weak-passphrase"
  | "wrong-passphrase"
  /** This use of the key needs the passphrase typed again. */
  | "passphrase-required"
  | "bad-backup"
  /** The backup file holds another key than the one in this browser. */
  | "backup-other-key"
  | "invalid-hex"
  | "out-of-range"
  /** The key is ErgoScan's tracker key: it lives only on the server and is never accepted here. */
  | "tracker-key-refused"
  | "locked"
  /** Another tab holds the signer (Web Lock). */
  | "locked-elsewhere"
  /** No verified backup yet: nothing is signed before one exists. */
  | "not-backed-up"
  /** A secret callback returned a promise; it must be synchronous. */
  | "async-callback"
  /** A secret callback returned or threw the secret key. */
  | "secret-in-output"
  | "bad-input"
  /** A reserve creation (T1) of this key is already in the journal and not failed or abandoned (detail.id). */
  | "t1-exists"
  | "not-found"
  | "bad-transition"
  /** Wiping the journal was asked while some of its entries are still open. */
  | "journal-unresolved";

export type ErrorDetail = Readonly<Record<string, string | number | boolean | null>>;

export class VaultError extends Error {
  readonly code: VaultErrorCode;
  readonly detail: ErrorDetail | undefined;

  constructor(code: VaultErrorCode, message: string, detail?: ErrorDetail) {
    super(message);
    this.name = "VaultError";
    this.code = code;
    this.detail = detail ? Object.freeze({ ...detail }) : undefined;
  }

  toJSON(): { name: string; code: VaultErrorCode; message: string; detail: ErrorDetail | null } {
    return { name: this.name, code: this.code, message: this.message, detail: this.detail ?? null };
  }
}

export function isVaultError(e: unknown, code?: VaultErrorCode): e is VaultError {
  return e instanceof VaultError && (code === undefined || e.code === code);
}

/** A storage failure, reduced to the DOMException name (never a message that could echo stored data). */
export function storageError(e: unknown): VaultError {
  if (e instanceof VaultError) return e;
  const name = (e as { name?: unknown } | null)?.name;
  return new VaultError("storage-failed", "the browser storage (IndexedDB) failed", { reason: typeof name === "string" ? name.slice(0, 40) : "error" });
}
