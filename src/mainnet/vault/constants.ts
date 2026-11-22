// Mainnet vault: names, formats and limits (design §4.2–4.4). Every name here differs from the sandbox key's
// (src/world/identity.ts: localStorage "basis.world.wallet.v1", "basis-sandbox-key-backup", 210 000 iterations), so the
// two can never read each other's data.

export const NETWORK = "mainnet";

/** IndexedDB: one database, three stores. Never localStorage, never the town log. */
export const DB_NAME = "basis-mainnet";
export const DB_VERSION = 1;
export const STORE_VAULT = "vault";
export const STORE_JOURNAL = "journal";
export const STORE_META = "meta";
export const KEY_RECORD_ID = "key-v1";

export const KEY_FORMAT = "basis-mainnet-key";
export const BACKUP_FORMAT = "basis-mainnet-key-backup";
/** AES-GCM additional data: the prefix plus the 33-byte public key in hex. */
export const KEY_AAD_PREFIX = "basis-mainnet-key/v1|";
export const BACKUP_AAD_PREFIX = "basis-mainnet-key-backup/v1|";
/** The backup's extras are sealed under the same key with their own additional data: the backup's, plus this. */
export const BACKUP_EXTRAS_AAD_SUFFIX = "|extras";

/** PBKDF2-HMAC-SHA256 work factor for new keys, and the lowest a record or a backup file may carry. */
export const KDF_ITERATIONS = 600_000;
export const KDF_MAX_ITERATIONS = 10_000_000;
export const SALT_BYTES = 16;
export const IV_BYTES = 12;
export const SECRET_BYTES = 32;
/** AES-256-GCM output for a 32-byte secret: ciphertext plus the 16-byte tag. */
export const CT_BYTES = SECRET_BYTES + 16;

/** Unicode code points after NFKC normalisation. */
export const MIN_PASSPHRASE_LENGTH = 12;

/** Auto-lock: 10 minutes without activity, or 2 minutes with the tab hidden. */
export const IDLE_LOCK_MS = 10 * 60_000;
export const HIDDEN_LOCK_MS = 2 * 60_000;

/** Web Locks name: the tab that holds it is the only one that can use the key. */
export const SIGN_LOCK_NAME = "basis-mainnet-sign";
/** BroadcastChannel name: tabs tell each other that the key record or the journal changed. */
export const CHANNEL_NAME = "basis-mainnet-vault";

/** Largest backup file the parser reads. */
export const MAX_BACKUP_TEXT = 256 * 1024;
/** Largest plaintext of a backup's sealed extras (100 issuers and 200 named contacts fit with room to spare). */
export const MAX_EXTRAS_BYTES = 128 * 1024;
