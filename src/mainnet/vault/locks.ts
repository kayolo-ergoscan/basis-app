// Web Locks: the tab that holds "basis-mainnet-sign" is the only one that can use the key (design §4.2, "Tabs and
// storage"). The vault takes the lock when it unlocks and keeps it until it locks; the browser frees it when the tab
// closes. A second tab gets "locked-elsewhere" at once (ifAvailable), or takes over with `steal`, which locks the first.
import { SIGN_LOCK_NAME } from "./constants";
import { VaultError } from "./errors";

export interface SignerLease {
  readonly held: boolean;
  release(): void;
}

/** The subset of LockManager the vault uses (navigator.locks, or a test double). */
export interface LockManagerLike {
  request(name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown>;
  query(): Promise<LockManagerSnapshot>;
}

/**
 * Takes the signer lock. Null when another tab holds it (and `steal` is false). `onLost` runs once if the lock is taken
 * from this tab (another tab stole it, or the browser dropped it) while it was still held.
 */
export function acquireSignerLock(locks: LockManagerLike, steal: boolean, onLost: (lease: SignerLease) => void): Promise<SignerLease | null> {
  return new Promise((resolve, reject) => {
    let free: () => void = () => {};
    const hold = new Promise<void>((r) => (free = r));
    let granted = false;
    let held = false;
    const lease: SignerLease = {
      get held() {
        return held;
      },
      release() {
        if (!held) return;
        held = false;
        free();
      },
    };
    const options: LockOptions = steal ? { mode: "exclusive", steal: true } : { mode: "exclusive", ifAvailable: true };
    let p: Promise<unknown>;
    try {
      p = locks.request(SIGN_LOCK_NAME, options, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        granted = true;
        held = true;
        resolve(lease);
        return hold;
      });
    } catch {
      reject(new VaultError("unsupported", "Web Locks refused the request", { missing: "web-locks" }));
      return;
    }
    p.then(
      () => {
        held = false;
      },
      () => {
        if (!granted) {
          reject(new VaultError("unsupported", "Web Locks refused the request", { missing: "web-locks" }));
          return;
        }
        if (!held) return;
        held = false;
        free();
        onLost(lease);
      },
    );
  });
}

/** True when some tab holds the signer lock (the caller knows whether it is itself). */
export async function signerLockHeld(locks: LockManagerLike): Promise<boolean> {
  try {
    const snap = await locks.query();
    return (snap.held ?? []).some((l) => l.name === SIGN_LOCK_NAME);
  } catch {
    return false;
  }
}
