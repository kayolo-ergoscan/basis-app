// The wallet identity "You": a SANDBOX key (play money only). Created with the WebCrypto RNG or imported as
// hex / from an encrypted backup; stored in localStorage, labelled as a sandbox key; exported as an encrypted
// JSON file (PBKDF2-SHA256, 210 000 iterations → AES-256-GCM). The secret never enters a store, an event
// feed or a log line: pages get the public part (pub, three words, fingerprint) only.
//
// Note: when "You" joins the town, the engine's event log stores the secret (KeySource "secret"), which
// is how a replay re-derives the key. That log stays in this browser; exports redact it (see town.ts).
import { createStore, type StoreApi } from "zustand/vanilla";
import { bytesToBig, bytesToHex, CURVE_N, hexToBytes, keyPairFromSecret, secretToHex, utf8, type Hex, type KeyPair } from "@/protocol";
import { fingerprint, threeWords } from "./words";

export const SANDBOX_KEY_LABEL = "SANDBOX KEY · play money only · never use for real funds";
export const WALLET_STORAGE_KEY = "basis.world.wallet.v1";
/** The mainnet key's public key, kept by the mainnet wallet while its vault holds a key (src/mainnet/key-markers.ts;
 *  read here directly, so the sandbox loads none of the mainnet code). Never imported as a sandbox key (keys P2-7). */
export const MAINNET_PUB_STORAGE_KEY = "basis.mainnet.pub.v1";

function mainnetPubInBrowser(): string | null {
  try {
    const v = typeof localStorage !== "undefined" ? localStorage.getItem(MAINNET_PUB_STORAGE_KEY) : null;
    return v && /^0[23][0-9a-f]{64}$/.test(v) ? v : null;
  } catch {
    return null;
  }
}
export const BACKUP_FORMAT = "basis-sandbox-key-backup";
export const PBKDF2_ITERATIONS = 210_000;

export interface SandboxKeyRecord {
  format: "basis-sandbox-key";
  v: 1;
  label: string;
  secretHex: Hex;
  pubHex: Hex;
  createdAt: number;
  source: "created" | "imported" | "backup" | "restored";
  backedUp: boolean;
  name?: string;
}

/** What pages see: never the secret. */
export interface WalletIdentity {
  pubHex: Hex;
  fingerprint: string;
  words: [string, string, string];
  createdAt: number;
  source: SandboxKeyRecord["source"];
  backedUp: boolean;
  name: string;
  /** Always true: this is a sandbox key. */
  sandbox: true;
  label: string;
}

export interface WalletState {
  status: "none" | "ready";
  identity: WalletIdentity | null;
  /** Bumps on every change (create, import, wipe, backup). */
  v: number;
}

export interface EncryptedBackup {
  format: typeof BACKUP_FORMAT;
  version: 1;
  warning: string;
  pub: Hex;
  words: string;
  createdAt: string;
  name?: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string; tagLength: 128 };
  ciphertext: string;
}

export class WalletError extends Error {
  constructor(
    readonly code: "exists" | "invalid-hex" | "out-of-range" | "bad-backup" | "wrong-passphrase" | "no-identity" | "no-crypto" | "weak-passphrase" | "mainnet-key",
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

// ---------------------------------------------------------------------------------------------
// storage (localStorage, or memory where it is unavailable)
// ---------------------------------------------------------------------------------------------

export interface WalletStorage {
  read(): string | null;
  write(v: string): void;
  clear(): void;
}

function defaultStorage(): WalletStorage {
  let mem: string | null = null;
  const ls = (() => {
    try {
      return typeof localStorage !== "undefined" ? localStorage : null;
    } catch {
      return null;
    }
  })();
  return {
    read: () => {
      try {
        return ls ? ls.getItem(WALLET_STORAGE_KEY) : mem;
      } catch {
        return mem;
      }
    },
    write: (v) => {
      mem = v;
      try {
        ls?.setItem(WALLET_STORAGE_KEY, v);
      } catch {
        /* quota or blocked: memory only */
      }
    },
    clear: () => {
      mem = null;
      try {
        ls?.removeItem(WALLET_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    },
  };
}

// ---------------------------------------------------------------------------------------------
// the wallet
// ---------------------------------------------------------------------------------------------

function toIdentity(r: SandboxKeyRecord): WalletIdentity {
  return { pubHex: r.pubHex, fingerprint: fingerprint(r.pubHex), words: threeWords(r.pubHex), createdAt: r.createdAt, source: r.source, backedUp: r.backedUp, name: r.name ?? "You", sandbox: true, label: r.label };
}

function parseRecord(raw: string | null): SandboxKeyRecord | null {
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as SandboxKeyRecord;
    if (r.format !== "basis-sandbox-key" || r.v !== 1 || !/^[0-9a-f]{64}$/.test(r.secretHex)) return null;
    const kp = keyPairFromSecret(r.secretHex);
    if (kp.pubHex !== r.pubHex) return null;
    return r;
  } catch {
    return null;
  }
}

/** Random secret in [1, n-1] from the WebCrypto RNG (rejection sampling, no modulo bias). */
export function randomSecret(): Hex {
  const c = globalThis.crypto;
  if (!c?.getRandomValues) throw new WalletError("no-crypto", "this browser has no WebCrypto random generator");
  for (let i = 0; i < 64; i++) {
    const b = c.getRandomValues(new Uint8Array(32));
    const s = bytesToBig(b);
    if (s > 0n && s < CURVE_N) return bytesToHex(b);
  }
  throw new WalletError("no-crypto", "random generator failed");
}

/** Validates a hex secret ("0x" prefix and whitespace allowed). */
export function normalizeSecretHex(input: string): Hex {
  const h = input.trim().replace(/^0x/i, "").replace(/\s+/g, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(h)) throw new WalletError("invalid-hex", "a sandbox key is 64 hex characters (32 bytes)");
  const s = bytesToBig(hexToBytes(h));
  if (s <= 0n || s >= CURVE_N) throw new WalletError("out-of-range", "this number is not a valid secp256k1 secret (it must be between 1 and n − 1)");
  return h;
}

export class SandboxWallet {
  readonly store: StoreApi<WalletState>;
  private record: SandboxKeyRecord | null;
  /** The stored text the record came from (cheap change check for reloadFromStorage). */
  private raw: string | null;
  private kp: KeyPair | null = null;
  private listeners = new Set<(r: SandboxKeyRecord | null) => void>();

  constructor(private readonly storage: WalletStorage = defaultStorage()) {
    this.raw = storage.read();
    this.record = parseRecord(this.raw);
    this.store = createStore<WalletState>(() => ({ status: this.record ? "ready" : "none", identity: this.record ? toIdentity(this.record) : null, v: 0 }));
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("storage", (ev) => {
        if (ev.key === WALLET_STORAGE_KEY) this.reloadFromStorage();
      });
    }
  }

  /** Another tab changed the key (or it was wiped): re-read. */
  reloadFromStorage(): void {
    const raw = this.storage.read();
    if (raw === this.raw) return;
    this.raw = raw;
    const next = parseRecord(raw);
    if (next?.secretHex === this.record?.secretHex && next?.backedUp === this.record?.backedUp && next?.name === this.record?.name) return;
    this.record = next;
    this.kp = null;
    this.publish();
  }

  private publish(): void {
    const s = this.store.getState();
    this.store.setState({ status: this.record ? "ready" : "none", identity: this.record ? toIdentity(this.record) : null, v: s.v + 1 });
    for (const l of [...this.listeners]) l(this.record);
  }

  /** Internal: notified with the raw record (the town uses it to join / restore). */
  onChange(fn: (r: SandboxKeyRecord | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get identity(): WalletIdentity | null {
    return this.store.getState().identity;
  }

  get hasKey(): boolean {
    return this.record !== null;
  }

  /** Internal (town join and replay only). Never render or log this. */
  secretHex(): Hex | null {
    return this.record?.secretHex ?? null;
  }

  keyPair(): KeyPair | null {
    if (!this.record) return null;
    this.kp ??= keyPairFromSecret(this.record.secretHex);
    return this.kp;
  }

  private save(r: SandboxKeyRecord): WalletIdentity {
    this.record = r;
    this.kp = null;
    this.raw = JSON.stringify(r);
    this.storage.write(this.raw);
    this.publish();
    return toIdentity(r);
  }

  /** New random sandbox key (WebCrypto RNG). Throws "exists" unless `replace`. */
  create(o: { name?: string; replace?: boolean } = {}): WalletIdentity {
    if (this.record && !o.replace) throw new WalletError("exists", "a sandbox key already exists in this browser");
    const secretHex = randomSecret();
    return this.save({ format: "basis-sandbox-key", v: 1, label: SANDBOX_KEY_LABEL, secretHex, pubHex: keyPairFromSecret(secretHex).pubHex, createdAt: Date.now(), source: "created", backedUp: false, name: o.name });
  }

  /** Imports a 64-hex secret. Throws "exists" unless `replace`. */
  importHex(hex: string, o: { name?: string; replace?: boolean; source?: SandboxKeyRecord["source"] } = {}): WalletIdentity {
    const secretHex = normalizeSecretHex(hex);
    // the mainnet key never goes into localStorage as plain hex (keys review P2-7)
    const mainnet = mainnetPubInBrowser();
    if (mainnet !== null && keyPairFromSecret(secretHex).pubHex === mainnet) throw new WalletError("mainnet-key", "this is the mainnet key of this browser: a sandbox key is kept as plain text, so it is never imported here");
    if (this.record && !o.replace && this.record.secretHex !== secretHex) throw new WalletError("exists", "a different sandbox key already exists in this browser");
    if (this.record?.secretHex === secretHex) {
      // the same key again: keep its history; only a new name or a verified backup changes the record
      const name = o.name ?? this.record.name;
      const backedUp = this.record.backedUp || o.source === "backup";
      if (name === this.record.name && backedUp === this.record.backedUp) return toIdentity(this.record);
      return this.save({ ...this.record, name, backedUp });
    }
    return this.save({ format: "basis-sandbox-key", v: 1, label: SANDBOX_KEY_LABEL, secretHex, pubHex: keyPairFromSecret(secretHex).pubHex, createdAt: Date.now(), source: o.source ?? "imported", backedUp: o.source === "backup", name: o.name ?? this.record?.name });
  }

  /** The secret as hex, for an explicit "reveal key" action (the page must show the sandbox label). */
  revealSecretHex(): Hex {
    if (!this.record) throw new WalletError("no-identity", "no sandbox key yet");
    return this.record.secretHex;
  }

  rename(name: string): void {
    if (!this.record) return;
    this.save({ ...this.record, name: name.trim() || undefined });
  }

  markBackedUp(): void {
    if (this.record && !this.record.backedUp) this.save({ ...this.record, backedUp: true });
  }

  /** Forgets the key in this browser (the town is reset by the caller: its log holds the key too). */
  wipe(): void {
    this.record = null;
    this.raw = null;
    this.kp = null;
    this.storage.clear();
    this.publish();
  }

  /** Encrypted backup file (JSON). Marks the identity as backed up once `verify` passes. */
  async exportBackup(passphrase: string, o: { iterations?: number } = {}): Promise<{ filename: string; json: string; backup: EncryptedBackup }> {
    if (!this.record) throw new WalletError("no-identity", "no sandbox key yet");
    const backup = await encryptSecret(this.record.secretHex, passphrase, { iterations: o.iterations, name: this.record.name, createdAt: this.record.createdAt });
    const json = JSON.stringify(backup, null, 2);
    const day = new Date().toISOString().slice(0, 10);
    return { filename: `basis-sandbox-key-${fingerprint(this.record.pubHex).replace("…", "-")}-${day}.json`, json, backup };
  }

  /** Imports an encrypted backup file. */
  async importBackup(json: string, passphrase: string, o: { replace?: boolean } = {}): Promise<WalletIdentity> {
    const { secretHex, name } = await decryptBackup(json, passphrase);
    return this.importHex(secretHex, { replace: o.replace, name, source: "backup" });
  }

  /** Checks that a backup decrypts to this identity (K06 "check that the backup works"). */
  async verifyBackup(json: string, passphrase: string): Promise<boolean> {
    if (!this.record) return false;
    try {
      const { secretHex } = await decryptBackup(json, passphrase);
      const ok = secretHex === this.record.secretHex;
      if (ok) this.markBackedUp();
      return ok;
    } catch {
      return false;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// encryption (WebCrypto)
// ---------------------------------------------------------------------------------------------

function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new WalletError("no-crypto", "WebCrypto is not available (the page must be served over https or localhost)");
  return s;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const base = await subtle().importKey("raw", utf8(passphrase.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

const aad = (pub: Hex) => utf8(`${BACKUP_FORMAT}/v1|${pub}`);

export async function encryptSecret(secretHex: Hex, passphrase: string, o: { iterations?: number; name?: string; createdAt?: number } = {}): Promise<EncryptedBackup> {
  if (passphrase.length < 8) throw new WalletError("weak-passphrase", "use a passphrase of at least 8 characters");
  const secret = normalizeSecretHex(secretHex);
  const pub = keyPairFromSecret(secret).pubHex;
  const iterations = o.iterations ?? PBKDF2_ITERATIONS;
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt, iterations);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aad(pub), tagLength: 128 }, key, hexToBytes(secret)));
  return {
    format: BACKUP_FORMAT,
    version: 1,
    warning: "Sandbox key for the Basis sandbox (play money). Never use it for real funds.",
    pub,
    words: threeWords(pub).join(" · "),
    createdAt: new Date(o.createdAt ?? Date.now()).toISOString(),
    name: o.name,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations, salt: b64(salt) },
    cipher: { name: "AES-GCM", iv: b64(iv), tagLength: 128 },
    ciphertext: b64(ct),
  };
}

export async function decryptBackup(json: string | EncryptedBackup, passphrase: string): Promise<{ secretHex: Hex; pub: Hex; name?: string }> {
  let b: EncryptedBackup;
  try {
    b = typeof json === "string" ? (JSON.parse(json) as EncryptedBackup) : json;
  } catch {
    throw new WalletError("bad-backup", "this file is not a Basis sandbox key backup (not JSON)");
  }
  if (b?.format !== BACKUP_FORMAT || b.version !== 1 || b.kdf?.name !== "PBKDF2" || b.cipher?.name !== "AES-GCM" || typeof b.ciphertext !== "string" || !/^0[23][0-9a-f]{64}$/.test(b.pub ?? "")) {
    throw new WalletError("bad-backup", "this file is not a Basis sandbox key backup");
  }
  if (!Number.isInteger(b.kdf.iterations) || b.kdf.iterations < 10_000 || b.kdf.iterations > 10_000_000) throw new WalletError("bad-backup", "unsupported key-derivation settings");
  const key = await deriveAesKey(passphrase, unb64(b.kdf.salt), b.kdf.iterations);
  let plain: Uint8Array;
  try {
    plain = new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: unb64(b.cipher.iv), additionalData: aad(b.pub), tagLength: 128 }, key, unb64(b.ciphertext)));
  } catch {
    throw new WalletError("wrong-passphrase", "wrong passphrase, or the file was changed");
  }
  const secretHex = normalizeSecretHex(bytesToHex(plain));
  if (keyPairFromSecret(secretHex).pubHex !== b.pub) throw new WalletError("bad-backup", "the backup's public key does not match its secret");
  return { secretHex, pub: b.pub, name: b.name };
}

export { secretToHex };
