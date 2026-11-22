// API mirror: what the reference tracker server would answer for the sandbox town's current state, with the
// server's own field names (basis_server models.rs at 43e2173). Pure functions of the economy; nothing here
// changes it. Values are sandbox values (play keys, play money, a simulated chain), never mainnet data.

import { p2sAddress } from "@/chain";
import {
  bytesToHex,
  hexToBytes,
  noteMessage,
  sign,
  trackerTreeValue,
  type DenomId,
  type Economy,
  type Hex,
  type NoteRecord,
  type ReserveSim,
  type TrackerSim,
} from "@/protocol";
import { SAMPLE_TREES } from "@/viz";

// ---------------------------------------------------------------------------------------------
// JSON with u64 integers and f64 floats, pretty-printed the way a reader expects
// ---------------------------------------------------------------------------------------------

/** An f64 field (serde prints 2.0, not 2; a non-finite value becomes null). */
export class F64 {
  constructor(readonly v: number) {}
}
export type Json = null | boolean | number | bigint | string | F64 | Json[] | { [k: string]: Json | undefined };

const esc = (s: string) => JSON.stringify(s);

function scalar(v: Exclude<Json, Json[] | { [k: string]: Json | undefined }>): string {
  if (v === null) return "null";
  if (v instanceof F64) return Number.isFinite(v.v) ? (Number.isInteger(v.v) ? v.v.toFixed(1) : String(v.v)) : "null";
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "string") return esc(v);
  return String(v);
}

/** Pretty JSON (2-space indent). Fields whose value is `undefined` are skipped (serde skip_serializing_if). */
export function printJson(v: Json, indent = 0): string {
  const pad = "  ".repeat(indent);
  const inner = "  ".repeat(indent + 1);
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[\n${v.map((x) => inner + printJson(x, indent + 1)).join(",\n")}\n${pad}]`;
  }
  if (v !== null && typeof v === "object" && !(v instanceof F64)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined) as [string, Json][];
    if (entries.length === 0) return "{}";
    return `{\n${entries.map(([k, x]) => `${inner}${esc(k)}: ${printJson(x, indent + 1)}`).join(",\n")}\n${pad}}`;
  }
  return scalar(v as Exclude<Json, Json[] | { [k: string]: Json | undefined }>);
}

export type JsonTok = { t: string; k: "key" | "str" | "num" | "lit" | "p" };

/** Splits printed JSON into tokens for colouring. */
export function tokenizeJson(s: string): JsonTok[] {
  const out: JsonTok[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), k: "p" });
    if (m[1] !== undefined) {
      out.push({ t: m[1], k: m[2] !== undefined ? "key" : "str" });
      if (m[2] !== undefined) out.push({ t: m[2], k: "p" });
    } else if (m[3] !== undefined) out.push({ t: m[3], k: "lit" });
    else out.push({ t: m[0], k: "num" });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: s.slice(last), k: "p" });
  return out;
}

export type JsonLine = { ind: number; toks: JsonTok[] };

/** Groups tokens into printed lines; a line's leading spaces become `ind`, so a wrapped line can hang under itself. */
export function jsonLines(toks: JsonTok[]): JsonLine[] {
  const lines: JsonLine[] = [];
  let cur: JsonTok[] = [];
  const flush = () => {
    let ind = 0;
    if (cur[0]?.k === "p") {
      ind = /^ */.exec(cur[0].t)![0].length;
      const rest = cur[0].t.slice(ind);
      if (rest) cur[0] = { t: rest, k: "p" };
      else cur.shift();
    }
    lines.push({ ind, toks: cur });
    cur = [];
  };
  for (const tk of toks) {
    if (tk.k !== "p" || !tk.t.includes("\n")) {
      cur.push(tk);
      continue;
    }
    tk.t.split("\n").forEach((part, i) => {
      if (i > 0) flush();
      if (part) cur.push({ t: part, k: "p" });
    });
  }
  flush();
  return lines;
}

// ---------------------------------------------------------------------------------------------
// endpoints
// ---------------------------------------------------------------------------------------------

export type MirrorId =
  | "root"
  | "notes-all"
  | "notes-by-issuer"
  | "notes-by-recipient"
  | "note-pair"
  | "note-state"
  | "key-status"
  | "reserves"
  | "reserves-quarantined"
  | "config-collateral"
  | "tracker-state"
  | "tracker-pending"
  | "tracker-latest-box"
  | "tracker-proof"
  | "exchanges-pending"
  | "events";

export type MirrorParam = "issuer" | "recipient" | "denom";

export interface MirrorSpec {
  id: MirrorId;
  method: "GET" | "POST";
  /** Path template, as the server's router writes it. */
  path: string;
  params: MirrorParam[];
  /** Shown list items (the answer is cut for reading; the caption says so). */
  list?: boolean;
}

/** The read endpoints a client polls, in reading order (content `apiEndpoints` holds the full catalogue). */
export const MIRROR: MirrorSpec[] = [
  { id: "root", method: "GET", path: "/", params: [] },
  { id: "tracker-state", method: "GET", path: "/tracker/state", params: [] },
  { id: "tracker-pending", method: "GET", path: "/tracker/pending-tx", params: [] },
  { id: "tracker-latest-box", method: "GET", path: "/tracker/latest-box-id", params: [] },
  { id: "notes-all", method: "GET", path: "/notes", params: [], list: true },
  { id: "notes-by-issuer", method: "GET", path: "/notes/issuer/{pk}", params: ["issuer"], list: true },
  { id: "notes-by-recipient", method: "GET", path: "/notes/recipient/{pk}", params: ["recipient"], list: true },
  { id: "note-pair", method: "GET", path: "/notes/issuer/{issuer}/recipient/{recipient}", params: ["issuer", "recipient", "denom"] },
  { id: "note-state", method: "POST", path: "/notes/state", params: ["issuer", "recipient", "denom"] },
  { id: "tracker-proof", method: "GET", path: "/tracker/proof", params: ["issuer", "recipient", "denom"] },
  { id: "key-status", method: "GET", path: "/key-status/{pk}", params: ["issuer"] },
  { id: "reserves", method: "GET", path: "/reserves", params: [], list: true },
  { id: "reserves-quarantined", method: "GET", path: "/reserves/quarantined", params: [], list: true },
  { id: "config-collateral", method: "GET", path: "/config/reserve-collateral", params: [] },
  { id: "exchanges-pending", method: "GET", path: "/exchanges/pending", params: [], list: true },
  { id: "events", method: "GET", path: "/events", params: [], list: true },
];

export interface MirrorArgs {
  issuer?: string;
  recipient?: string;
  denom?: DenomId;
  /** Most list items to print. */
  limit: number;
}

export interface MirrorAnswer {
  status: number;
  /** The request line (method, concrete path and query). */
  request: string;
  /** POST body, when the endpoint takes one. */
  requestBody?: string;
  /** Printed body: JSON, or plain text for GET /. */
  body: string;
  json: boolean;
  /** Items in the full answer and how many are printed (list endpoints). */
  total?: number;
  shown?: number;
  /** /events: events the in-memory store holds in all. */
  stored?: number;
}

const envelope = (data: Json, error: string | null = null, success = true): Json => ({ success, data, error });

// ---------- note helpers ----------

const sigCache = new Map<string, Hex>();

/** The issuer's note signature: the record's own when already produced, else the same deterministic bytes. */
export function issuerSignature(eco: Economy, t: TrackerSim, rec: NoteRecord): Hex {
  if (rec.issuerSig) return rec.issuerSig;
  const id = `${rec.key}|${rec.totalDebt}|${rec.timestamp}`;
  const hit = sigCache.get(id);
  if (hit) return hit;
  const issuer = eco.byPub.get(rec.issuer);
  if (!issuer) return "";
  const sig = bytesToHex(sign(noteMessage(hexToBytes(rec.key), rec.totalDebt, rec.timestamp, t.nftId), issuer.key));
  if (sigCache.size > 400) sigCache.clear();
  sigCache.set(id, sig);
  return sig;
}

function confirmation(eco: Economy, t: TrackerSim, rec: NoteRecord): { status: string; json: Json; confirmed: bigint | null; pending: bigint | null } {
  const h = eco.clock.height;
  const st = rec.omitted ? "local" : t.status(rec, h);
  const confirmed = t.confirmedTotal(rec.key);
  const cbox = t.confirmedBox();
  const cur = t.currentBox();
  const pending = st === "pending" ? rec.totalDebt : null;
  const status = st === "local" ? "local_only" : st;
  const redeemableAmount = confirmed !== null && confirmed > rec.amountRedeemed ? confirmed - rec.amountRedeemed : 0n;
  return {
    status,
    confirmed,
    pending,
    json: {
      status,
      confirmed_total_debt: confirmed,
      pending_total_debt: pending,
      confirmed_box_id: confirmed !== null && cbox ? cbox.boxId : null,
      confirmed_height: confirmed !== null && cbox ? cbox.creationHeight : null,
      pending_tx_id: pending !== null && cur ? cur.txId : null,
      redeemable: redeemableAmount > 0n,
      redeemable_amount: redeemableAmount,
    },
  };
}

function noteJson(eco: Economy, t: TrackerSim, rec: NoteRecord, withAge: boolean): Json {
  const ageMs = eco.clock.nowMs() - rec.timestamp;
  return {
    issuer_pubkey: rec.issuer,
    recipient_pubkey: rec.receiver,
    amount_collected: rec.totalDebt,
    amount_redeemed: rec.amountRedeemed,
    timestamp: rec.timestamp,
    signature: issuerSignature(eco, t, rec),
    tracker_nft_id: t.nftId,
    age_seconds: withAge ? (ageMs > 0n ? ageMs / 1000n : 0n) : undefined,
    denomination: rec.denom,
    confirmation: confirmation(eco, t, rec).json,
  };
}

const byTime = (a: NoteRecord, b: NoteRecord) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0);

// ---------- reserves ----------

function trackedReserves(eco: Economy, t: TrackerSim): ReserveSim[] {
  return [...eco.reserves.values()].filter((r) => r.active && r.trackerNftId === t.nftId);
}

const timeAt = (eco: Economy, h: number) => eco.clock.timeOfHeight(h);

function reserveJson(eco: Economy, r: ReserveSim): Json {
  const box = r.box!;
  return {
    box_id: box.boxId,
    owner_pubkey: r.owner,
    collateral_amount: r.collateral(),
    total_debt: 0,
    tracker_nft_id: r.trackerNftId,
    reserve_token_id: r.tokenId ?? undefined,
    last_updated_height: box.creationHeight,
    last_updated_timestamp: timeAt(eco, box.creationHeight),
    collateralization_ratio: new F64(Infinity),
    refund_initiation_height: r.refundHeight(),
  };
}

// ---------- contracts ----------

let p2sCache: { erg: string; token: string } | null = null;
/** The two current reserve contracts' P2S addresses, computed from their ErgoTrees. */
export function currentP2s(): { erg: string; token: string } {
  if (p2sCache) return p2sCache;
  const erg = SAMPLE_TREES.find((s) => s.id === "erg-v2026-10-c3")?.hex;
  const token = SAMPLE_TREES.find((s) => s.id.startsWith("multitoken"))?.hex;
  p2sCache = { erg: erg ? p2sAddress(erg) : "", token: token ? p2sAddress(token) : "" };
  return p2sCache;
}

// ---------- events ----------

/** The seven demo events basis_server seeds at start-up (main.rs), ids 1–7 in the in-memory store. */
function demoEvents(): Json[] {
  const k1 = "01".repeat(33);
  const box = "box1234567890abcdef";
  const ev = (id: number, type: Json, ts: number, f: Partial<Record<string, Json>>): Json => ({
    id,
    event_type: type,
    timestamp: ts,
    issuer_pubkey: f.issuer_pubkey ?? null,
    recipient_pubkey: f.recipient_pubkey ?? null,
    amount: f.amount ?? null,
    reserve_box_id: f.reserve_box_id ?? null,
    collateral_amount: f.collateral_amount ?? null,
    redeemed_amount: f.redeemed_amount ?? null,
    height: f.height ?? null,
  });
  return [
    ev(1, { type: "NoteUpdated" }, 1234567890, { issuer_pubkey: k1, recipient_pubkey: "02".repeat(33), amount: 1000 }),
    ev(2, { type: "NoteUpdated" }, 1234567891, { issuer_pubkey: k1, recipient_pubkey: "03".repeat(33), amount: 2000 }),
    ev(3, { type: "ReserveCreated" }, 1234567892, { issuer_pubkey: k1, reserve_box_id: box, collateral_amount: 1000000000, height: 1000 }),
    ev(4, { type: "ReserveToppedUp" }, 1234567893, { issuer_pubkey: k1, reserve_box_id: box, collateral_amount: 500000000, height: 1001 }),
    ev(5, { type: "ReserveRedeemed" }, 1234567894, { issuer_pubkey: k1, reserve_box_id: box, redeemed_amount: 250000000, height: 1002 }),
    ev(6, { type: "Commitment" }, 1234567895, { height: 1003 }),
    ev(7, { type: "CollateralAlert", ratio: new F64(0.8) }, 1234567896, { issuer_pubkey: k1 }),
  ];
}

export const EVENTS_PAGE = 50;

// ---------- the answer ----------

function pkOf(eco: Economy, id: string | undefined): Hex | null {
  if (!id) return null;
  return eco.participants.get(id)?.pub ?? null;
}

export function mirrorAnswer(eco: Economy, trackerId: string, spec: MirrorSpec, a: MirrorArgs): MirrorAnswer {
  const t = eco.t(trackerId);
  const denom = a.denom ?? "erg";
  const issuer = pkOf(eco, a.issuer);
  const recipient = pkOf(eco, a.recipient);
  const out = (status: number, body: Json, extra: Partial<MirrorAnswer> = {}, request?: string): MirrorAnswer => ({
    status,
    request: request ?? `${spec.method} ${spec.path}`,
    body: printJson(body),
    json: true,
    ...extra,
  });

  switch (spec.id) {
    case "root":
      return { status: 200, request: "GET /", body: "Hello, Basis Tracker API!", json: false };

    case "notes-all": {
      const all = t.allNotes().sort(byTime);
      const shown = Math.min(all.length, a.limit);
      const data = all.slice(0, shown).map((r) => noteJson(eco, t, r, true));
      return out(200, envelope(data), { total: all.length, shown });
    }

    case "notes-by-issuer":
    case "notes-by-recipient": {
      const pk = spec.id === "notes-by-issuer" ? issuer : recipient;
      const path = `/notes/${spec.id === "notes-by-issuer" ? "issuer" : "recipient"}/${pk ?? "{pk}"}`;
      if (!pk) return out(400, envelope(null, "Invalid hex encoding", false), {}, `GET ${path}`);
      const recs = (spec.id === "notes-by-issuer" ? t.notesOfIssuer(pk) : t.notesOfReceiver(pk)).sort(byTime);
      const shown = Math.min(recs.length, a.limit);
      return out(200, envelope(recs.slice(0, shown).map((r) => noteJson(eco, t, r, false))), { total: recs.length, shown }, `GET ${path}`);
    }

    case "note-pair": {
      const path = `GET /notes/issuer/${issuer ?? "{issuer}"}/recipient/${recipient ?? "{recipient}"}?denomination=${denom}`;
      const rec = issuer && recipient ? t.note(issuer, recipient, denom) : undefined;
      if (!rec) return out(404, envelope(null), {}, path);
      return out(200, envelope(noteJson(eco, t, rec, false)), {}, path);
    }

    case "note-state": {
      const body = printJson({ issuer_pubkey: issuer ?? "", recipient_pubkey: recipient ?? "", denomination: denom });
      const rec = issuer && recipient ? t.note(issuer, recipient, denom) : undefined;
      if (!rec) return out(404, envelope(null, "Note not found", false), { requestBody: body });
      const c = confirmation(eco, t, rec);
      const redeemableAmount = c.confirmed !== null && c.confirmed > rec.amountRedeemed ? c.confirmed - rec.amountRedeemed : 0n;
      return out(
        200,
        envelope({
          issuer_pubkey: rec.issuer,
          recipient_pubkey: rec.receiver,
          local: rec.totalDebt,
          confirmed: c.confirmed,
          pending: c.pending,
          already_redeemed: rec.amountRedeemed,
          redeemable: redeemableAmount > 0n,
          redeemable_amount: redeemableAmount,
          status: c.status,
        }),
        { requestBody: body },
      );
    }

    case "tracker-proof": {
      const path = `GET /tracker/proof?issuer_pubkey=${issuer ?? ""}&recipient_pubkey=${recipient ?? ""}&denomination=${denom}`;
      const rec = issuer && recipient ? t.note(issuer, recipient, denom) : undefined;
      if (!rec || rec.omitted) return out(404, envelope(null, "Debt record not found: key not in the tracker tree", false), {}, path);
      const key = hexToBytes(rec.key);
      let proof = "";
      try {
        proof = bytesToHex(t.map.proofFor(key));
      } catch {
        proof = "";
      }
      return out(
        200,
        envelope({ key: rec.key, value: bytesToHex(trackerTreeValue(rec.totalDebt)), proof, total_debt: rec.totalDebt, tracker_state_digest: bytesToHex(t.digest()) }),
        {},
        path,
      );
    }

    case "key-status": {
      const path = `GET /key-status/${issuer ?? "{pk}"}`;
      if (!issuer) return out(400, envelope(null, "Invalid hex encoding", false), {}, path);
      const notes = t.notesOfIssuer(issuer);
      const reserves = trackedReserves(eco, t).filter((r) => r.owner === issuer);
      const denoms: DenomId[] = [];
      for (const d of t.denoms) if (notes.some((n) => n.denom === d) || reserves.some((r) => r.denom === d)) denoms.push(d);
      const rows: Json[] = denoms.map((d) => {
        const ns = notes.filter((n) => n.denom === d);
        const r = reserves.find((x) => x.denom === d);
        const debt = ns.reduce((s, n) => s + (n.totalDebt - n.amountRedeemed), 0n);
        const coll = r ? r.collateral() : 0n;
        const info = eco.denominations.get(d);
        const ratio = debt === 0n ? 999999 : r ? Number(coll) / Number(debt) : 0;
        return {
          denomination: d,
          symbol: info?.symbol ?? d,
          decimals: info?.decimals ?? 0,
          total_debt: debt,
          collateral: coll,
          collateralization_ratio: new F64(ratio),
          note_count: ns.length,
          reserve_box_id: r?.box?.boxId ?? undefined,
          has_pending_refund: r ? r.refundPending() : false,
        };
      });
      const lastUpdated = reserves.reduce((m, r) => {
        const ts = r.box ? timeAt(eco, r.box.creationHeight) : 0n;
        return ts > m ? ts : m;
      }, 0n);
      return out(
        200,
        envelope({ issuer_pubkey: issuer, note_count: notes.length, last_updated: lastUpdated, has_pending_refund: reserves.some((r) => r.refundPending()), denominations: rows }),
        {},
        path,
      );
    }

    case "reserves": {
      const rs = trackedReserves(eco, t);
      const shown = Math.min(rs.length, a.limit);
      return out(200, envelope(rs.slice(0, shown).map((r) => reserveJson(eco, r))), { total: rs.length, shown });
    }

    case "reserves-quarantined":
      return out(200, envelope([]), { total: 0, shown: 0 });

    case "config-collateral": {
      const p2s = currentP2s();
      const tokens: Json[] = [];
      const denominations: Json[] = [];
      for (const d of t.denoms) {
        const info = eco.denominations.get(d);
        if (!info) continue;
        denominations.push({ id: d, symbol: info.symbol, decimals: info.decimals });
        if (d !== "erg") tokens.push({ token_id: d.slice(6), symbol: info.symbol, decimals: info.decimals });
      }
      return out(200, envelope({ erg_contract_p2s: p2s.erg, token_contract_p2s: p2s.token, tokens, denominations }));
    }

    case "tracker-state": {
      const cur = t.currentBox();
      const cb = t.confirmedBox();
      const pending = cur && cur.confirmedHeight === null ? cur : null;
      return out(
        200,
        envelope({
          local_digest: bytesToHex(t.digest()),
          confirmed_digest: cb?.digest ?? null,
          confirmed_box_id: cb?.boxId ?? null,
          confirmed_height: cb?.creationHeight ?? null,
          pending_digest: pending?.digest ?? null,
          pending_tx_id: pending?.txId ?? null,
          pending_submitted_height: pending?.creationHeight ?? null,
          tracker_box_id: cur?.boxId ?? null,
        }),
      );
    }

    case "tracker-pending": {
      const cur = t.currentBox();
      const pending = cur && cur.confirmedHeight === null ? cur : null;
      return out(200, envelope({ pending_tx_id: pending?.txId ?? null, pending_digest: pending?.digest ?? null, submitted_height: pending?.creationHeight ?? null }));
    }

    case "tracker-latest-box": {
      const cur = t.currentBox();
      if (!cur) return out(404, envelope(null, "No tracker boxes found", false));
      const h = eco.clock.height;
      return out(200, envelope({ tracker_box_id: cur.boxId, timestamp: h, height: h, tracker_nft_id: t.nftId }));
    }

    case "exchanges-pending": {
      const xs = [...t.exchanges.values()].filter((x) => x.status !== "applied");
      const shown = Math.min(xs.length, a.limit);
      const data = xs.slice(0, shown).map(
        (x): Json => ({
          issuer_pubkey: x.issuer,
          recipient_pubkey: x.receiver,
          from_denomination: x.fromDenom,
          from_old_total: x.fromOld,
          from_new_total: x.fromNew,
          to_denomination: x.toDenom,
          to_amount: x.toNew - (x.toBase ?? 0n),
          to_new_total: x.toNew,
          status: x.status,
          cancel_reason: x.reason ?? undefined,
          created_at: timeAt(eco, x.stagedHeight),
        }),
      );
      return out(200, envelope(data), { total: xs.length, shown });
    }

    case "events": {
      const items: Json[] = demoEvents();
      let stored = items.length;
      for (const e of eco.events) {
        if (e.type !== "note.issued" || e.tracker !== t.id) continue;
        stored++;
        if (items.length >= EVENTS_PAGE) continue;
        const iss = eco.participants.get(e.issuer)?.pub ?? null;
        const rec = eco.participants.get(e.receiver)?.pub ?? null;
        items.push({
          id: stored,
          event_type: { type: "NoteUpdated" },
          timestamp: e.timestamp,
          issuer_pubkey: iss,
          recipient_pubkey: rec,
          amount: e.totalDebt,
          reserve_box_id: null,
          collateral_amount: null,
          redeemed_amount: null,
          height: null,
        });
      }
      const shown = Math.min(items.length, a.limit);
      return out(200, envelope(items.slice(0, shown)), { total: items.length, shown, stored });
    }
  }
}
