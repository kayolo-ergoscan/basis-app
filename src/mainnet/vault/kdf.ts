// WebCrypto parts: PBKDF2-HMAC-SHA256 → a non-extractable AES-256-GCM key, and sealing / opening the 32-byte secret
// with additional data that names the format and the public key.
import { normalizePassphrase } from "./passphrase";
import { VaultError } from "./errors";

export async function deriveKey(subtle: SubtleCrypto, passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  if (typeof passphrase !== "string") throw new VaultError("bad-input", "the passphrase must be a string");
  const pw = new TextEncoder().encode(normalizePassphrase(passphrase));
  try {
    const base = await subtle.importKey("raw", pw, "PBKDF2", false, ["deriveKey"]);
    return await subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  } catch {
    throw new VaultError("unsupported", "WebCrypto could not derive a key from the passphrase");
  } finally {
    pw.fill(0);
  }
}

export async function seal(subtle: SubtleCrypto, key: CryptoKey, iv: Uint8Array, aad: string, plain: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 }, key, plain));
  } catch {
    throw new VaultError("unsupported", "WebCrypto could not encrypt");
  }
}

/** Opens a sealed secret. A wrong passphrase, another key or a changed byte all fail the GCM tag: "wrong-passphrase". */
export async function unseal(subtle: SubtleCrypto, key: CryptoKey, iv: Uint8Array, aad: string, ct: Uint8Array): Promise<Uint8Array> {
  try {
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv, additionalData: new TextEncoder().encode(aad), tagLength: 128 }, key, ct));
  } catch {
    throw new VaultError("wrong-passphrase", "wrong passphrase, or the encrypted data was changed");
  }
}
