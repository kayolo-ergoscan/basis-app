// src/mainnet/vault — the mainnet key vault and its write-ahead journal. API: README.md in this folder.
export { getMainnetVault, openVault, MainnetVault } from "./vault";
export type {
  BackupExport, CreateResult, LockReason, MissingFeature, RestoreResult, SecretCallback, SecretOptions, SecretPurpose,
  TakeOverOptions, VaultKey, VaultOptions, VaultState, VaultStatus, WipeOptions,
} from "./vault";
export { attachAutoLock, type AutoLockDom, type AutoLockTarget } from "./autolock";
export { MainnetJournal, buildScope, noteScope, blocksNewT1, isOpenState, JOURNAL_KINDS, JOURNAL_STATES, OPEN_STATES, MAX_ERROR_CHARS, MAX_RAW_BYTES } from "./journal";
export type { JournalEntry, JournalFilter, JournalKind, JournalMeta, JournalMetaValue, JournalPatch, JournalRecordInput, JournalState } from "./journal";
export { VaultError, isVaultError, type VaultErrorCode, type ErrorDetail } from "./errors";
export { checkPassphrase, normalizePassphrase, type PassphraseCheck, type PassphraseIssue } from "./passphrase";
export { HOW_TO_DECRYPT, parseBackup, backupFilename, type BackupContact, type BackupExtras, type BackupFile, type SealedExtras } from "./backup";
export { TRACKER_PUBLIC_KEY, isPublicKeyHex, type Hex } from "./keys";
export type { KeyRecord, KeySource } from "./record";
export type { Persistence } from "./persist";
export type { VaultEnv, ChannelLike, CryptoLike } from "./env";
export * as VAULT from "./constants";
