// Who owes this key notes (D3 = receipts + watched issuers): the issuers the wallet asks the pair route about, with the
// last receipt each one handed over. Kept per key in this browser (localStorage `basis.mainnet.watch.v1`), and sealed
// into the backup file as its extras. Not secret, but private: it is never sent anywhere except as the pair route's
// two keys.
import type { NoteReceipt } from "./receipt";

export const WATCH_STORAGE_KEY = "basis.mainnet.watch.v1";
/** Issuers polled on the Receive and home screens (design §6.4: at most 10, 120 s each, staggered). */
export const WATCH_POLLED = 10;
/** Issuers kept (the backup's limit). */
export const WATCH_KEPT = 100;

export interface WatchedIssuer {
  pk: string;
  name: string | null;
  addedAt: number;
  /** The newest receipt from this issuer (verified when it was imported). */
  receipt: { total: string; timestamp: string; signature: string } | null;
}

type Store = Record<string, WatchedIssuer[]>;

const PK = /^0[23][0-9a-f]{64}$/;
const SIG = /^[0-9a-f]{130}$/;
const NUM = /^(0|[1-9]\d{0,18})$/;

function clean(list: unknown): WatchedIssuer[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: WatchedIssuer[] = [];
  for (const x of list) {
    if (typeof x !== "object" || x === null) continue;
    const o = x as Record<string, unknown>;
    const pk = typeof o.pk === "string" ? o.pk.toLowerCase() : "";
    if (!PK.test(pk) || seen.has(pk)) continue;
    seen.add(pk);
    const r = o.receipt as Record<string, unknown> | null | undefined;
    const receipt = r && typeof r === "object" && typeof r.total === "string" && NUM.test(r.total) && typeof r.timestamp === "string" && NUM.test(r.timestamp) && typeof r.signature === "string" && SIG.test(r.signature)
      ? { total: r.total, timestamp: r.timestamp, signature: r.signature } : null;
    out.push({ pk, name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 64) : null, addedAt: typeof o.addedAt === "number" && Number.isFinite(o.addedAt) ? o.addedAt : 0, receipt });
    if (out.length >= WATCH_KEPT) break;
  }
  return out;
}

export function parseWatchStore(text: string | null): Store {
  if (!text) return {};
  try {
    const j = JSON.parse(text);
    if (typeof j !== "object" || j === null || Array.isArray(j)) return {};
    const out: Store = {};
    for (const [k, v] of Object.entries(j)) if (PK.test(k)) out[k] = clean(v);
    return out;
  } catch { return {}; }
}

/** Adds an issuer (or updates its name / newer receipt); the newest first. Never watches the key itself. */
export function watchIssuer(list: readonly WatchedIssuer[], me: string, pk: string, o: { name?: string | null; receipt?: NoteReceipt; now?: number } = {}): WatchedIssuer[] {
  const k = pk.toLowerCase();
  if (!PK.test(k) || k === me) return [...list];
  const old = list.find((x) => x.pk === k) ?? null;
  const r = o.receipt && o.receipt.issuer === k && o.receipt.recipient === me ? o.receipt : null;
  const newer = r && (!old?.receipt || BigInt(old.receipt.timestamp) < r.timestamp);
  const next: WatchedIssuer = {
    pk: k,
    name: o.name !== undefined ? (o.name && o.name.trim() ? o.name.trim().slice(0, 64) : null) : old?.name ?? null,
    addedAt: old?.addedAt ?? o.now ?? Date.now(),
    receipt: newer && r ? { total: r.total.toString(), timestamp: r.timestamp.toString(), signature: r.signature } : old?.receipt ?? null,
  };
  return [next, ...list.filter((x) => x.pk !== k)].slice(0, WATCH_KEPT);
}

export const unwatchIssuer = (list: readonly WatchedIssuer[], pk: string): WatchedIssuer[] => list.filter((x) => x.pk !== pk);

/** The lists for the backup file's extras (the vault seals them). */
export const watchExtras = (list: readonly WatchedIssuer[]) => ({
  watchedIssuers: list.map((x) => x.pk),
  contacts: list.filter((x) => x.name).map((x) => ({ pub: x.pk, name: x.name ?? undefined })),
});
