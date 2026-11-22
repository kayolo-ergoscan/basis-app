// The mainnet wallet's network: the tracker front (`/api/tracker/*`, reads and the four write routes plus the broadcast
// route, D1) and the /v1 reads it needs, all through the one start queue (≥ 1 s between starts, user actions ahead of
// polls; src/chain/ours/queue.ts). Answers that are echoed back or checked byte for byte stay text: nothing here
// re-stringifies a tracker answer. Bodies the front would refuse are refused here, before any request.
import {
  parseKeyStatus, parseReserves, parseState, quoteBigInts, readEnvelope, requestQueue,
  type KeyStatus, type Priority, type TrackedReserve, type TrackerState,
} from "../../chain/ours";
import type { ServerClock } from "../../chain/ours/clock";
import { createRawClient, type RawAnswer, type RawClient } from "../../chain/ours/raw";
import { boxFromV1, parseJson, saveDevFixture, utf8Length, type ErgoBox, type JsonNode } from "../tx";
import { localProblem, problemOf, type Problem, type WalletRoute } from "./problems";

export type Result<T> = { ok: true; value: T } | { ok: false; problem: Problem };

export interface NetOptions { signal?: AbortSignal; priority?: Priority }

/** Body limits of the front (nginx `client_max_body_size`, tracker-ops/front/nginx.conf.tmpl). */
export const FRONT_BODY_MAX = { notes: 4096, "reserves-create": 4096, build: 4096, submit: 65536, broadcast: 16384 } as const;

export interface PendingCommit { txId: string | null; digest: string | null; height: number | null }

/** One unspent box at the wallet's address, with the block that holds it. */
export interface UnspentBox { box: ErgoBox; height: number | null }
export interface UnspentList {
  boxes: UnspentBox[];
  /** False when the address holds more boxes than the pages read (then sums are lower bounds). */
  complete: boolean;
  /** Boxes the answer listed that are not at this address, or could not be read (never used). */
  skipped: number;
}

export interface MempoolOutput { ergoTree: string | null; address: string | null; value: bigint }
export interface MempoolTx { id: string; spends: string[]; outputs: MempoolOutput[] }

export interface TxStatus { inclusionHeight: number; confirmations: number }

export interface ChainBox { text: string; box: ErgoBox; spentBy: string | null }

export interface WalletNet {
  readonly clock: ServerClock;
  trackerState(o?: NetOptions): Promise<Result<TrackerState>>;
  pendingTx(o?: NetOptions): Promise<Result<PendingCommit>>;
  reservesOf(pk: string, o?: NetOptions): Promise<Result<TrackedReserve[]>>;
  keyStatus(pk: string, o?: NetOptions): Promise<Result<KeyStatus>>;
  /** The pair's stored note as text (tx.parseStoredNote reads it); null when the pair has none. */
  pairNote(issuer: string, recipient: string, o?: NetOptions): Promise<Result<string | null>>;
  postNote(body: string, o?: NetOptions): Promise<Result<null>>;
  createReserve(body: string, o?: NetOptions): Promise<Result<string>>;
  build(body: string, o?: NetOptions): Promise<Result<string>>;
  submit(body: string, o?: NetOptions): Promise<Result<string>>;
  /** POST /api/tracker/node/transactions: the node's answer is the transaction id. */
  broadcast(nodeJson: string, o?: NetOptions): Promise<Result<string>>;
  unspent(address: string, ergoTree: string, o?: NetOptions): Promise<Result<UnspentList>>;
  mempool(address: string, o?: NetOptions): Promise<Result<MempoolTx[]>>;
  box(boxId: string, o?: NetOptions): Promise<Result<ChainBox>>;
  /** null: not in a block (yet). */
  txStatus(txId: string, o?: NetOptions): Promise<Result<TxStatus | null>>;
}

const HEX64 = /^[0-9a-f]{64}$/;
const PK = /^0[23][0-9a-f]{64}$/;
const UNSPENT_PAGE = 50;
const UNSPENT_PAGES = 4;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const bigOf = (v: unknown): bigint | null =>
  typeof v === "string" && /^\d{1,19}$/.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null;
const intOf = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : null);

/** `/v1/mempool/transactions/byAddress/{a}` items: ids, spent boxes and outputs (values exact). */
export function parseMempool(text: string): MempoolTx[] | null {
  let j: unknown;
  try { j = JSON.parse(quoteBigInts(text, ["value"])); } catch { return null; }
  if (!isObj(j) || !Array.isArray(j.items)) return null;
  const out: MempoolTx[] = [];
  for (const it of j.items) {
    if (!isObj(it) || typeof it.id !== "string" || !HEX64.test(it.id.toLowerCase())) return null;
    const spends = Array.isArray(it.inputs) ? it.inputs.filter(isObj).map((i) => (typeof i.boxId === "string" ? i.boxId.toLowerCase() : "")).filter((x) => HEX64.test(x)) : [];
    const outputs = Array.isArray(it.outputs)
      ? it.outputs.filter(isObj).map((o) => ({
        ergoTree: typeof o.ergoTree === "string" ? o.ergoTree.toLowerCase() : null,
        address: typeof o.address === "string" ? o.address : null,
        value: bigOf(o.value) ?? 0n,
      }))
      : [];
    out.push({ id: it.id.toLowerCase(), spends, outputs });
  }
  return out;
}

/** nanoERG a mempool transaction sends to this tree or address. */
export function mempoolInflow(tx: MempoolTx, ergoTree: string, address: string): bigint {
  return tx.outputs.reduce((a, o) => (o.ergoTree === ergoTree || o.address === address ? a + o.value : a), 0n);
}

/** The node's answer to a broadcast: the id as a JSON string. */
export function parseBroadcast(text: string): string | null {
  try {
    const v = JSON.parse(text);
    return typeof v === "string" && HEX64.test(v.toLowerCase()) ? v.toLowerCase() : null;
  } catch { return null; }
}

function member(node: JsonNode, key: string): JsonNode | undefined {
  return node.kind === "object" ? node.entries.find((e) => e.key === key)?.value : undefined;
}

/** One page of `/v1/boxes/unspent/byAddress`: boxes at `ergoTree` (each read strictly; a box that hashes wrong is the
 *  coin selection's to refuse), and whether more pages follow. */
export function parseUnspentPage(text: string, ergoTree: string): { boxes: UnspentBox[]; skipped: number; hasMore: boolean } | null {
  let root: JsonNode;
  try { root = parseJson(text); } catch { return null; }
  const items = member(root, "items");
  if (!items || items.kind !== "array") return null;
  const boxes: UnspentBox[] = [];
  let skipped = 0;
  for (const it of items.items) {
    try {
      const spent = member(it, "spentTransactionId");
      if (spent && spent.kind !== "null") { skipped++; continue; }
      const main = member(it, "mainChain");
      if (main && main.kind === "bool" && !main.value) { skipped++; continue; }
      const box = boxFromV1(it, "box");
      if (box.ergoTree !== ergoTree) { skipped++; continue; }
      const h = member(it, "settlementHeight");
      boxes.push({ box, height: h && h.kind === "number" && /^\d+$/.test(h.raw) ? Number(h.raw) : null });
    } catch { skipped++; }
  }
  const more = member(root, "hasMore");
  return { boxes, skipped, hasMore: !!more && more.kind === "bool" && more.value };
}

export interface WalletNetDeps {
  tracker: Pick<RawClient, "raw" | "clock">;
  v1: Pick<RawClient, "raw">;
  /** Saves raw tracker answers during the closed canary (dev server only; a no-op in builds). */
  saveFixture?: (name: string, text: string) => void;
}

export function createWalletNet(deps: WalletNetDeps): WalletNet {
  const { tracker, v1 } = deps;
  const save = deps.saveFixture ?? (() => {});

  const ask = (client: Pick<RawClient, "raw">, route: string, o: NetOptions = {}, post?: string): Promise<RawAnswer> =>
    client.raw(route, { method: post === undefined ? "GET" : "POST", body: post, priority: o.priority ?? (post === undefined ? "poll" : "user"), signal: o.signal });

  async function getJson<T>(name: WalletRoute, route: string, parse: (d: unknown) => T | null, bigKeys: readonly string[], o?: NetOptions): Promise<Result<T>> {
    const a = await ask(tracker, route, o);
    const p = problemOf(name, a);
    if (p || !a.ok) return { ok: false, problem: p ?? localProblem("network") };
    const env = readEnvelope(a.text, bigKeys);
    if (!env.ok) return { ok: false, problem: env.shape ? localProblem("shape", env.message) : localProblem("refused", env.message) };
    const v = parse(env.data);
    return v === null ? { ok: false, problem: localProblem("shape", "unexpected answer shape") } : { ok: true, value: v };
  }

  async function post(name: "notes" | "reserves-create" | "build" | "submit" | "broadcast", route: string, body: string, o?: NetOptions): Promise<Result<string>> {
    if (utf8Length(body) > FRONT_BODY_MAX[name]) return { ok: false, problem: localProblem("too-large", `${utf8Length(body)} bytes; the front takes at most ${FRONT_BODY_MAX[name]}`) };
    const a = await ask(tracker, route, o, body);
    const p = problemOf(name, a);
    if (a.ok && name !== "notes" && name !== "broadcast") save(`wallet-canary-${name}-${a.status}-${Date.now()}.json`, a.text);
    if (p || !a.ok) return { ok: false, problem: p ?? localProblem("network") };
    return { ok: true, value: a.text };
  }

  async function v1Get(route: string, o?: NetOptions): Promise<Result<RawAnswer & { ok: true }>> {
    const a = await ask(v1, route, o);
    if (a.ok && a.status === 404) return { ok: true, value: a };
    const p = problemOf("v1", a);
    if (p || !a.ok) return { ok: false, problem: p ?? localProblem("network") };
    return { ok: true, value: a };
  }

  return {
    clock: tracker.clock,
    trackerState: (o) => getJson("state", "/tracker/state", parseState, [], o),
    pendingTx: (o) => getJson("pending-tx", "/tracker/pending-tx", (d) => {
      if (!isObj(d)) return null;
      const tx = typeof d.pending_tx_id === "string" && HEX64.test(d.pending_tx_id.toLowerCase()) ? d.pending_tx_id.toLowerCase() : null;
      if (d.pending_tx_id !== null && d.pending_tx_id !== undefined && tx === null) return null;
      return { txId: tx, digest: typeof d.pending_digest === "string" ? d.pending_digest : null, height: intOf(d.submitted_height) };
    }, [], o),
    reservesOf: (pk, o) => {
      if (!PK.test(pk)) return Promise.resolve({ ok: false, problem: localProblem("refused", "not a public key") });
      return getJson("reserves-of", `/reserves/issuer/${pk}`, (d) => {
        const r = parseReserves(d);
        return r && r.invalid === 0 ? r.list : null;
      }, ["collateral_amount", "total_debt"], o);
    },
    keyStatus: (pk, o) => {
      if (!PK.test(pk)) return Promise.resolve({ ok: false, problem: localProblem("refused", "not a public key") });
      return getJson("key-status", `/key-status/${pk}`, parseKeyStatus, ["total_debt", "collateral"], o);
    },
    async pairNote(issuer, recipient, o) {
      if (!PK.test(issuer) || !PK.test(recipient)) return { ok: false, problem: localProblem("refused", "not a public key") };
      const a = await ask(tracker, `/notes/issuer/${issuer}/recipient/${recipient}`, o);
      if (a.ok && a.status === 404) return { ok: true, value: null };
      const p = problemOf("pair-note", a);
      if (p || !a.ok) return { ok: false, problem: p ?? localProblem("network") };
      return { ok: true, value: a.text };
    },
    async postNote(body, o) {
      const r = await post("notes", "/notes", body, o);
      return r.ok ? { ok: true, value: null } : r;
    },
    createReserve: (body, o) => post("reserves-create", "/reserves/create", body, o),
    build: (body, o) => post("build", "/redemption/build", body, o),
    submit: (body, o) => post("submit", "/redemption/submit", body, o),
    async broadcast(nodeJson, o) {
      const r = await post("broadcast", "/node/transactions", nodeJson, o);
      if (!r.ok) return r;
      const id = parseBroadcast(r.value);
      return id ? { ok: true, value: id } : { ok: false, problem: localProblem("shape", "the node did not answer with a transaction id") };
    },
    async unspent(address, ergoTree, o) {
      const boxes: UnspentBox[] = [];
      let skipped = 0;
      for (let page = 0; page < UNSPENT_PAGES; page++) {
        const r = await v1Get(`/boxes/unspent/byAddress/${encodeURIComponent(address)}?limit=${UNSPENT_PAGE}${page ? `&offset=${page * UNSPENT_PAGE}` : ""}`, o);
        if (!r.ok) return r;
        if (r.value.status === 404) return { ok: true, value: { boxes, complete: true, skipped } };
        const pg = parseUnspentPage(r.value.text, ergoTree);
        if (!pg) return { ok: false, problem: localProblem("shape", "the unspent boxes could not be read") };
        boxes.push(...pg.boxes);
        skipped += pg.skipped;
        if (!pg.hasMore) return { ok: true, value: { boxes, complete: true, skipped } };
      }
      return { ok: true, value: { boxes, complete: false, skipped } };
    },
    async mempool(address, o) {
      const r = await v1Get(`/mempool/transactions/byAddress/${encodeURIComponent(address)}`, o);
      if (!r.ok) return r;
      if (r.value.status === 404) return { ok: true, value: [] };
      const list = parseMempool(r.value.text);
      return list ? { ok: true, value: list } : { ok: false, problem: localProblem("shape", "the mempool answer could not be read") };
    },
    async box(boxId, o) {
      if (!HEX64.test(boxId)) return { ok: false, problem: localProblem("refused", "not a box id") };
      const r = await v1Get(`/boxes/${boxId}`, o);
      if (!r.ok) return r;
      if (r.value.status === 404) return { ok: false, problem: localProblem("not-found") };
      try {
        const node = parseJson(r.value.text);
        const box = boxFromV1(node, "box");
        if (box.boxId !== boxId) return { ok: false, problem: localProblem("shape", "the chain answered for another box") };
        const s = member(node, "spentTransactionId");
        const spentBy = s && s.kind === "string" && HEX64.test(s.value.toLowerCase()) ? s.value.toLowerCase() : null;
        return { ok: true, value: { text: r.value.text, box, spentBy } };
      } catch (e) {
        return { ok: false, problem: localProblem("shape", e instanceof Error ? e.message : String(e)) };
      }
    },
    async txStatus(txId, o) {
      if (!HEX64.test(txId)) return { ok: false, problem: localProblem("refused", "not a transaction id") };
      const r = await v1Get(`/transactions/${txId}`, o);
      if (!r.ok) return r;
      if (r.value.status === 404) return { ok: true, value: null };
      let j: unknown;
      try { j = JSON.parse(r.value.text); } catch { return { ok: false, problem: localProblem("shape") }; }
      if (!isObj(j) || typeof j.id !== "string" || j.id.toLowerCase() !== txId) return { ok: false, problem: localProblem("shape", "the chain answered for another transaction") };
      const h = intOf(j.inclusionHeight), n = intOf(j.numConfirmations);
      return h === null ? { ok: true, value: null } : { ok: true, value: { inclusionHeight: h, confirmations: n ?? 1 } };
    },
  };
}

/** The app's wallet network: a raw client for the tracker front (its clock) and one for /v1, both on the app's one
 *  start queue, shared with the app-wide tracker client's polls. */
let shared: WalletNet | null = null;
export function walletNet(): WalletNet {
  if (!shared) {
    const tracker = createRawClient({ base: "/api/tracker", queue: requestQueue });
    const v1 = createRawClient({ base: "/v1", queue: requestQueue });
    shared = createWalletNet({ tracker, v1, saveFixture: (n, t) => { void saveDevFixture(n, t); } });
  }
  return shared;
}
