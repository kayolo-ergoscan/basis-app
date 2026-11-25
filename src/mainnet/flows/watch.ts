// Who owes this key notes (D3 = receipts + watched issuers): the issuers the wallet asks the pair route about, with the
// last receipt each one handed over. Kept per key in this browser (localStorage `basis.mainnet.watch.v1`), and sealed
// into the backup file as its extras. Not secret, but private: it is never sent anywhere except as the pair route's
// two keys.
// An issuer's token notes are watched too once a receipt in that token is imported, or in every denomination of the
// wallet when the payer is added by key without a receipt (`tokens`, absent for ERG only: an ERG-only list is stored
// exactly as before). Each denomination keeps its own newest receipt; nothing is summed.
import { isWalletDenom, type Denomination } from "../tx";
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
  /** Token denominations this issuer's notes are watched in, each with its newest receipt (raw units). */
  tokens?: WatchedToken[];
}

type StoredReceipt = { total: string; timestamp: string; signature: string };
export interface WatchedToken { denom: Denomination; receipt: StoredReceipt | null }

/** The denominations an issuer is watched in: ERG first, then its tokens. */
export const watchedDenoms = (w: WatchedIssuer): Denomination[] => ["erg", ...(w.tokens ?? []).map((x) => x.denom)];

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
    const receipt = cleanReceipt(o.receipt);
    const tokens: WatchedToken[] = [];
    if (Array.isArray(o.tokens)) {
      for (const x of o.tokens) {
        const tk = x as Record<string, unknown> | null;
        const d = tk && typeof tk === "object" && typeof tk.denom === "string" ? tk.denom : "";
        if (d === "erg" || !isWalletDenom(d) || tokens.some((y) => y.denom === d)) continue;
        tokens.push({ denom: d, receipt: cleanReceipt(tk!.receipt) });
      }
    }
    const w: WatchedIssuer = { pk, name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 64) : null, addedAt: typeof o.addedAt === "number" && Number.isFinite(o.addedAt) ? o.addedAt : 0, receipt };
    out.push(tokens.length ? { ...w, tokens } : w);
    if (out.length >= WATCH_KEPT) break;
  }
  return out;
}

function cleanReceipt(v: unknown): StoredReceipt | null {
  const r = v as Record<string, unknown> | null | undefined;
  return r && typeof r === "object" && typeof r.total === "string" && NUM.test(r.total) && typeof r.timestamp === "string" && NUM.test(r.timestamp) && typeof r.signature === "string" && SIG.test(r.signature)
    ? { total: r.total, timestamp: r.timestamp, signature: r.signature } : null;
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

/** Adds an issuer (or updates its name / newer receipt); the newest first. Never watches the key itself. `denoms`:
 *  also watch these denominations, without a receipt (a payer added by key: every denomination of the wallet). */
export function watchIssuer(list: readonly WatchedIssuer[], me: string, pk: string, o: { name?: string | null; receipt?: NoteReceipt; denoms?: readonly Denomination[]; now?: number } = {}): WatchedIssuer[] {
  const k = pk.toLowerCase();
  if (!PK.test(k) || k === me) return [...list];
  const old = list.find((x) => x.pk === k) ?? null;
  const r = o.receipt && o.receipt.issuer === k && o.receipt.recipient === me ? o.receipt : null;
  const rd: Denomination = r?.denom ?? "erg";
  const ergR = rd === "erg" ? r : null;
  const newer = ergR && (!old?.receipt || BigInt(old.receipt.timestamp) < ergR.timestamp);
  const stored = (x: NoteReceipt): StoredReceipt => ({ total: x.total.toString(), timestamp: x.timestamp.toString(), signature: x.signature });
  let tokens = old?.tokens ? [...old.tokens] : [];
  if (r && rd !== "erg") {
    const prev = tokens.find((x) => x.denom === rd) ?? null;
    const keep = prev?.receipt && BigInt(prev.receipt.timestamp) >= r.timestamp ? prev.receipt : stored(r);
    tokens = [...tokens.filter((x) => x.denom !== rd), { denom: rd, receipt: keep }];
  }
  for (const d of o.denoms ?? []) if (d !== "erg" && isWalletDenom(d) && !tokens.some((x) => x.denom === d)) tokens.push({ denom: d, receipt: null });
  const next: WatchedIssuer = {
    pk: k,
    name: o.name !== undefined ? (o.name && o.name.trim() ? o.name.trim().slice(0, 64) : null) : old?.name ?? null,
    addedAt: old?.addedAt ?? o.now ?? Date.now(),
    receipt: newer && ergR ? stored(ergR) : old?.receipt ?? null,
    ...(tokens.length ? { tokens } : {}),
  };
  return [next, ...list.filter((x) => x.pk !== k)].slice(0, WATCH_KEPT);
}

export const unwatchIssuer = (list: readonly WatchedIssuer[], pk: string): WatchedIssuer[] => list.filter((x) => x.pk !== pk);

/** The lists for the backup file's extras (the vault seals them). */
export const watchExtras = (list: readonly WatchedIssuer[]) => ({
  watchedIssuers: list.map((x) => x.pk),
  contacts: list.filter((x) => x.name).map((x) => ({ pub: x.pk, name: x.name ?? undefined })),
});
