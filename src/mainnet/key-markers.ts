// Which key each wallet keeps in this browser, so that neither takes the other's (keys review P2-7): the sandbox key
// lies in localStorage as plain hex (play money), so a mainnet key must never go there, and a sandbox key must never
// become a mainnet key. Each side reads only the other's public key: the sandbox record's `pubHex`, and the marker the
// mainnet wallet keeps up to date while it shows its key. Tiny on purpose: the sandbox imports this file directly.

/** The sandbox wallet's record (world/identity.ts WALLET_STORAGE_KEY). */
export const SANDBOX_WALLET_STORAGE_KEY = "basis.world.wallet.v1";
/** The mainnet key's public key, written by the mainnet wallet while its vault holds a key. */
export const MAINNET_PUB_STORAGE_KEY = "basis.mainnet.pub.v1";

const PK = /^0[23][0-9a-f]{64}$/;

function read(key: string): string | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

/** The sandbox key's public key in this browser, or null. */
export function sandboxPubInBrowser(): string | null {
  const raw = read(SANDBOX_WALLET_STORAGE_KEY);
  if (!raw) return null;
  try {
    const j: unknown = JSON.parse(raw);
    const pub = typeof j === "object" && j !== null ? (j as { pubHex?: unknown }).pubHex : null;
    return typeof pub === "string" && PK.test(pub.toLowerCase()) ? pub.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** The mainnet key's public key in this browser (as last shown by the mainnet wallet), or null. */
export function mainnetPubInBrowser(): string | null {
  const v = read(MAINNET_PUB_STORAGE_KEY)?.toLowerCase() ?? null;
  return v && PK.test(v) ? v : null;
}

/** Keeps the marker: the key's public key, or null once the vault holds none. */
export function setMainnetPubMarker(pub: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (pub === null) localStorage.removeItem(MAINNET_PUB_STORAGE_KEY);
    else if (localStorage.getItem(MAINNET_PUB_STORAGE_KEY) !== pub) localStorage.setItem(MAINNET_PUB_STORAGE_KEY, pub);
  } catch {
    /* site data blocked: nothing to keep */
  }
}
