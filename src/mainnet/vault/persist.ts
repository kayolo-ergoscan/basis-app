// navigator.storage.persist(): asks the browser not to evict this site's storage (design §4.2, §4.5). The vault asks
// when a key is created, restored or imported, and shows the answer: true granted, false refused, null unknown (no
// StorageManager, or it failed). Some browsers decide by heuristics and never prompt.

export interface StorageManagerLike {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

export type Persistence = boolean | null;

export async function isPersisted(storage: StorageManagerLike | null): Promise<Persistence> {
  if (!storage || typeof storage.persisted !== "function") return null;
  try {
    return (await storage.persisted()) === true;
  } catch {
    return null;
  }
}

export async function requestPersist(storage: StorageManagerLike | null): Promise<Persistence> {
  if (!storage || typeof storage.persist !== "function") return null;
  try {
    if ((await isPersisted(storage)) === true) return true;
    return (await storage.persist()) === true;
  } catch {
    return null;
  }
}
