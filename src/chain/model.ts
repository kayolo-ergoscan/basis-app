// src/chain/model.ts — pure functions: seed + live facts → the Observatory model, plus the interpreters for /v1 boxes
// and transactions. No network, no React, no timers: store.ts feeds them, tests call them directly.
import type {
  Address, ApiAsset, ApiBox, ApiTx, BoxDetail, ContractView, DetectedBox, DetectorState, ExitClass, Hex, HostIndexView, LiveBox, LiveData,
  LiveStatus, Observatory, OwnerRow, ReceiverRow, RedemptionView, ReserveView, Seed, SeedReserve, SeedTracker, TokenAmount,
  Totals, TrackerBoxRef, TrackerCommit, TrackerStatus, TrackerView, TxBoxRole, TxBoxView, TxDetail,
} from "./types";
import {
  CURRENT_TEMPLATES, EMERGENCY_BLOCKS, EMPTY_DIGEST, FEE_TREE_PREFIX, addressOfErgoTree, assessExit, decodeBasisRegisters,
  decodeConstant, emergencyClock, p2pkAddress, p2pkKeyOfTree, p2sAddress, parseErgoTree, regHex, templateHashSync, tokenKind,
  type TrackerLookup,
} from "./decode";

// ─── small helpers ──────────────────────────────────────────────────────────────────────────────

const big = (v: string | number | bigint | null | undefined): bigint => {
  if (v === null || v === undefined || v === "") return 0n;
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(v);
};
const isZeroHex = (h: string) => /^0+$/.test(h);
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z") : null);

export const emptyLive = (): LiveData => ({
  trackers: {}, templates: {}, spent: {}, extraReserves: {}, txs: {}, checks: {},
  detector: { found: {}, templates: {}, checkedAt: null, checkedHeight: null }, mempool: {}, hostIndex: null, changes: 0,
});

export const idleStatus = (): LiveStatus => ({
  enabled: false, online: true, hidden: false, lastOkAt: null, lastError: null, changes: 0,
  budget: { perBlock: 6, usedThisBlock: 0, requests: 0, byLane: { height: 0, background: 0, interactive: 0 }, lastLatencyMs: null, avgLatencyMs: null },
});

/** Delta-encoded beats → absolute heights. */
export const decodeBeats = (beats: number[]): number[] => {
  const out: number[] = [];
  let h = 0;
  for (let i = 0; i < beats.length; i++) { h = i === 0 ? beats[0] : h + beats[i]; out.push(h); }
  return out;
};

export function tokenAmount(seed: Pick<Seed, "tokens"> | null, id: Hex, amount: bigint | string | number, api?: Pick<ApiAsset, "name" | "decimals">): TokenAmount {
  const t = seed?.tokens[id];
  const kind = tokenKind(id);
  return {
    id,
    amount: big(amount),
    decimals: t?.decimals ?? api?.decimals ?? 0,
    name: t?.name ?? api?.name ?? null,
    kind,
    label: t?.label ?? (api?.name ? `${api.name} (unverified name)` : `token ${id.slice(0, 4)}…${id.slice(-4)}`),
  };
}

function addTokens(into: Map<Hex, bigint>, id: Hex, amount: bigint) {
  into.set(id, (into.get(id) ?? 0n) + amount);
}
const KIND_RANK: Record<TokenAmount["kind"], number> = { use: 0, "use-lookalike": 1, other: 2 };
/** Real USE first, then the look-alike, then anything else by label. */
const tokenList = (seed: Seed, m: Map<Hex, bigint>): TokenAmount[] =>
  [...m.entries()].filter(([, v]) => v !== 0n).map(([id, v]) => tokenAmount(seed, id, v))
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.label.localeCompare(b.label));

// ─── contracts ──────────────────────────────────────────────────────────────────────────────────

interface ContractIndex { list: ContractView[]; byId: Map<string, ContractView>; byTemplate: Map<Hex, ContractView>; byTree: Map<Hex, ContractView> }
const contractCache = new WeakMap<Seed, ContractIndex>();
const ROLE_RANK: Record<ContractView["role"], number> = { current: 3, legacy: 2, superseded: 1, "repo-only": 0 };

/** Registry with the full P2S of every tree (computed once per seed; about 1 ms per 3 KB tree). AtC4 and W52 share a
 *  template, so byTemplate keeps the contract with on-chain boxes; byTree matches the exact ErgoTree first. */
export function contractIndex(seed: Seed): ContractIndex {
  let c = contractCache.get(seed);
  if (!c) {
    const list = seed.contracts.map((x) => ({ ...x, p2sFull: p2sAddress(x.ergoTree) }));
    const byTemplate = new Map<Hex, ContractView>();
    for (const x of list) {
      const had = byTemplate.get(x.templateHash);
      if (!had || ROLE_RANK[x.role] > ROLE_RANK[had.role]) byTemplate.set(x.templateHash, x);
    }
    c = { list, byId: new Map(list.map((x) => [x.id, x])), byTemplate, byTree: new Map(list.map((x) => [x.ergoTree, x])) };
    contractCache.set(seed, c);
  }
  return c;
}

/** The registry contract of a box: exact ErgoTree first, then the template hash. */
export function contractOf(seed: Seed | null, ergoTree: Hex, templateHash: Hex | null): ContractView | null {
  if (!seed) return null;
  const i = contractIndex(seed);
  return i.byTree.get(ergoTree) ?? (templateHash ? i.byTemplate.get(templateHash) ?? null : null);
}

// ─── live boxes ─────────────────────────────────────────────────────────────────────────────────

const REG_NAMES = ["R4", "R5", "R6", "R7", "R8", "R9"] as const;

/** Either /v1 box shape → LiveBox (registers decoded once, template hash via noble SHA-256). */
export function liveBoxFromApi(b: ApiBox): LiveBox {
  const regs: LiveBox["regs"] = {};
  for (const k of REG_NAMES) {
    const h = regHex(b.additionalRegisters?.[k] ?? undefined) ?? (b.registers?.[k] || null);
    if (h) regs[k] = h;
  }
  let th = "";
  try { th = templateHashSync(b.ergoTree); } catch { /* unparsable tree: no template */ }
  const assets = (b.assets || []).map((a) => ({ tokenId: a.tokenId.toLowerCase(), amount: big(a.amount) }));
  return {
    id: b.boxId,
    tx: b.transactionId,
    height: b.creationHeight,
    value: big(b.value),
    address: b.address || safeAddress(b.ergoTree),
    ergoTree: b.ergoTree,
    templateHash: th,
    assets,
    regs,
    basis: decodeBasisRegisters(regs, assets),
    spentTx: b.spentTransactionId ?? null,
  };
}

function safeAddress(tree: Hex): Address {
  try { return addressOfErgoTree(tree); } catch { return ""; }
}

/** A box has the tracker shape when R4 is a key, R5 an AvlTree and its first token is the NFT. */
export const isTrackerShaped = (b: Pick<LiveBox, "basis" | "assets">, nft?: Hex) =>
  !!(b.basis.key && b.basis.tree && b.assets[0] && (!nft || b.assets[0].tokenId === nft));

/** What the unspent box holding a tracker NFT makes of it (null: no unspent box holds it, after two empty answers). */
export function liveTrackerStatus(b: LiveBox | null, nft: Hex): TrackerStatus {
  if (b === null) return "burned";
  const key = p2pkKeyOfTree(b.ergoTree);
  if (key && isTrackerShaped(b, nft)) return b.basis.tree!.zero ? "stale" : "live";
  return key ? "unused" : "locked";
}

// ─── trackers ───────────────────────────────────────────────────────────────────────────────────

function seedCommits(t: SeedTracker): TrackerCommit[] {
  return t.commits.map(([height, digest, boxes, ki]) => ({
    height, digest, boxes, key: t.keys[ki]?.key ?? null, zero: isZeroHex(digest), empty: digest === EMPTY_DIGEST, source: "seed" as const,
  }));
}

function trackerView(seed: Seed, t: SeedTracker, live: LiveData, tip: number, reserves: SeedReserve[], extra: LiveBox[]): TrackerView {
  const L = live.trackers[t.nft];
  let status = t.status;
  let evidence: TrackerView["evidence"] = t.evidence;
  let holder = t.holder;
  let currentBox = t.currentBox;
  let lastTrackerBox: TrackerBoxRef | null = t.lastTrackerBox;
  let source: TrackerView["source"] = "seed";
  const commits = seedCommits(t);
  const beats = decodeBeats(t.beats);
  if (L) {
    for (const c of L.newCommits) {
      const last = commits[commits.length - 1];
      if (last && last.digest === c.digest) last.boxes += c.boxes;
      else commits.push(c);
      beats.push(c.height);
    }
    const b = L.box;
    if (b === null) {
      if (status !== "burned") {
        status = "burned"; holder = null; currentBox = null; source = "live";
        evidence = { kind: "burn", height: null, at: null, note: "live check: no unspent box holds the NFT now" };
      }
    } else if (b.id !== t.currentBox) {
      source = "live";
      currentBox = b.id;
      const key = p2pkKeyOfTree(b.ergoTree);
      if (key && isTrackerShaped(b, t.nft)) {
        status = b.basis.tree!.zero ? "stale" : "live";
        holder = b.address;
        lastTrackerBox = {
          box: b.id, height: b.height, at: null, addr: b.address, key: b.basis.key!, digest: b.basis.tree!.digest, flags: b.basis.tree!.flags,
          zero: b.basis.tree!.zero, empty: b.basis.tree!.empty, value: b.value.toString(), regs: { R4: b.regs.R4, R5: b.regs.R5, R6: b.regs.R6 }, unspent: true, spentTx: null,
        };
        evidence = { kind: "box", box: b.id, height: b.height, at: null, note: "tracker box seen live after the snapshot" };
      } else if (key) {
        status = "unused"; holder = b.address;
        evidence = { kind: "box", box: b.id, height: b.height, at: null, note: "held in a plain wallet box (live check)" };
      } else {
        const c = contractOf(seed, b.ergoTree, b.templateHash);
        status = "locked"; holder = null;
        evidence = c
          ? { kind: "reserve", box: b.id, height: b.height, at: null, contract: c.id, note: `inside a ${c.short} reserve (live check)` }
          : { kind: "script", box: b.id, height: b.height, at: null, note: "held by a script, not by a key (live check)" };
      }
    }
  }
  const trackerHeight = status === "live" || status === "stale" ? lastTrackerBox?.height ?? null : null;
  const refs = [
    ...reserves.filter((r) => r.r6 === t.nft).map((r) => ({ id: r.id, unspent: !r.spent && !live.spent[r.id], h: r.height })),
    ...extra.filter((b) => b.basis.nft === t.nft).map((b) => ({ id: b.id, unspent: !b.spentTx && !live.spent[b.id], h: b.height })),
  ].sort((a, b) => Number(b.unspent) - Number(a.unspent) || b.h - a.h);
  const served = [
    ...seed.redemptions.filter((x) => x.tracker.nft === t.nft).map((x) => x.tx),
    ...Object.values(live.txs).filter((x) => x.kind === "redemption" && x.tracker?.tokens[0]?.id === t.nft && !seed.redemptions.some((s) => s.tx === x.id)).map((x) => x.id),
  ];
  return {
    nft: t.nft,
    name: t.name,
    description: t.description,
    mint: t.mint,
    status,
    evidence,
    holder,
    currentBox,
    lastTrackerBox,
    keys: t.keys.map((k) => ({ ...k, label: seed.labels[k.addr] ?? null })),
    commits,
    beats,
    counts: L?.newCommits.length ? { ...t.counts, trackerBoxes: t.counts.trackerBoxes + L.newCommits.length, readable: t.counts.readable + L.newCommits.length } : t.counts,
    emergency: trackerHeight !== null ? emergencyClock(trackerHeight, tip) : null,
    silentBlocks: lastTrackerBox ? Math.max(0, tip - lastTrackerBox.height) : null,
    reserves: refs.map((r) => r.id),
    redemptions: served,
    source,
    checkedAt: L?.checkedAt ?? null,
  };
}

/** Where the R6 NFT is now, in the shape assessExit() needs. */
export function trackerLookup(seed: Seed, t: TrackerView | undefined): TrackerLookup | null {
  if (!t) return null;
  const lock = seed.incidents.locks.find((l) => l.nft === t.nft && l.reserve === t.currentBox);
  let releasable = lock ? lock.releasable : false;
  if (!lock && t.status === "locked" && t.evidence.contract) {
    const c = contractIndex(seed).byId.get(t.evidence.contract);
    releasable = !!c?.ownerExit;
  }
  return {
    status: t.status,
    currentBox: t.status === "live" || t.status === "stale" ? t.lastTrackerBox?.box ?? t.currentBox : t.currentBox,
    trackerBoxHeight: t.status === "live" || t.status === "stale" ? t.lastTrackerBox?.height ?? null : null,
    holder: t.holder,
    burnTx: t.status === "burned" ? t.evidence.tx ?? null : null,
    releasable,
    emptyTree: t.status === "live" ? !!t.lastTrackerBox?.empty : false,
  };
}

/** Where a tracker NFT outside the seed is now (one that a reserve found live names in R6), from the live layer's
 *  lookup. null until the first answer, so the reserve's exit reads "checking", never "needs a tracker box". */
export function liveTrackerLookup(seed: Seed, nft: Hex, L: LiveData["trackers"][Hex] | undefined): TrackerLookup | null {
  if (!L) return null;
  const b = L.box;
  const status = liveTrackerStatus(b, nft);
  if (b === null) return { status, currentBox: null, trackerBoxHeight: null, holder: null, burnTx: null, releasable: false, emptyTree: false };
  const boxed = status === "live" || status === "stale";
  return {
    status,
    currentBox: b.id,
    trackerBoxHeight: boxed ? b.height : null,
    holder: status === "locked" ? null : b.address,
    burnTx: null,
    releasable: status === "locked" ? !!contractOf(seed, b.ergoTree, b.templateHash)?.ownerExit : false,
    emptyTree: status === "live" ? !!b.basis.tree?.empty : false,
  };
}

type Lookup = (nft: Hex) => TrackerLookup | null;

// ─── reserves ───────────────────────────────────────────────────────────────────────────────────

function reserveFromSeed(seed: Seed, r: SeedReserve, live: LiveData, tip: number, lookup: Lookup, next: Map<Hex, Hex>): ReserveView {
  const { byId } = contractIndex(seed);
  const c = byId.get(r.contract) ?? null;
  const seen = live.spent[r.id];
  const unspent = !r.spent && !seen;
  const exit = unspent && c
    ? assessExit({ ownerExit: c.ownerExit, ownerKey: r.owner?.key ?? null, tree: r.r5, r6: r.r6, ownNft: r.nft?.id ?? null, r7: r.r7, tracker: r.r6 ? lookup(r.r6) : null, tip })
    : null;
  return {
    id: r.id,
    source: "seed",
    contract: c,
    kind: r.kind,
    height: r.height,
    at: r.at,
    tx: r.tx,
    origin: r.origin,
    unspent,
    spent: r.spent ? { ...r.spent, seenLive: false } : seen ? { tx: seen.tx, height: seen.height, at: null, seenLive: true } : null,
    prev: r.prev,
    next: r.next ?? next.get(r.id) ?? null,
    value: big(r.value),
    owner: r.owner ? { ...r.owner, label: seed.labels[r.owner.addr] ?? null } : null,
    nft: r.nft,
    collateral: r.collateral ? tokenAmount(seed, r.collateral.id, r.collateral.amount) : null,
    r5: r.r5,
    r6: r.r6,
    r7: r.r7,
    regs: r.regs,
    creator: r.creator,
    issues: r.issues,
    legacy: !c?.current,
    exit,
    snapshotExit: r.exit,
    pending: c ? live.mempool[c.p2sFull]?.total ?? -1 : -1,
    checked: unspent ? lastCheck(live, r.id, c?.templateHash ?? null) : null,
  };
}

/** Latest live confirmation that a reserve is still unspent: its own focus check or an unchanged template check. */
function lastCheck(live: LiveData, id: Hex, templateHash: Hex | null): ReserveView["checked"] {
  const own = live.checks[`box:${id}`] ?? null;
  const t = templateHash ? live.templates[templateHash] : undefined;
  const tpl = t && !t.changed ? { height: t.checkedHeight, at: t.checkedAt } : null;
  if (!own) return tpl;
  if (!tpl) return own;
  return tpl.at > own.at ? tpl : own;
}

function reserveFromLive(seed: Seed, b: LiveBox, live: LiveData, tip: number, lookup: Lookup, prev: Map<Hex, Hex>, next: Map<Hex, Hex>): ReserveView | null {
  const c = contractOf(seed, b.ergoTree, b.templateHash);
  if (!c) return null;
  const seen = live.spent[b.id];
  const unspent = !b.spentTx && !seen;
  const key = b.basis.key;
  const r7 = b.regs.R7 ? Number(b.basis.refundHeight) : null;
  const exit = unspent
    ? assessExit({ ownerExit: c.ownerExit, ownerKey: key, tree: b.basis.tree, r6: b.basis.nft, ownNft: b.basis.ownNft, r7, tracker: b.basis.nft ? lookup(b.basis.nft) : null, tip })
    : null;
  const coll = c.kind === "erg" ? null : b.assets[1] ?? null;
  const madeBy = Object.values(live.txs).find((x) => x.reserveOut?.boxId === b.id);
  return {
    id: b.id,
    source: "live",
    contract: c,
    kind: c.kind === "erg" ? "erg" : "token",
    height: b.height,
    at: madeBy ? iso(madeBy.timestamp) : null,
    tx: b.tx,
    origin: madeBy ? (madeBy.kind === "redemption" ? "redemption" : "unknown") : "unknown",
    unspent,
    spent: b.spentTx ? { tx: b.spentTx, height: null, at: null, seenLive: true } : seen ? { tx: seen.tx, height: seen.height, at: null, seenLive: true } : null,
    prev: prev.get(b.id) ?? null,
    next: next.get(b.id) ?? null,
    value: b.value,
    owner: key ? { key, addr: p2pkAddress(key), label: seed.labels[p2pkAddress(key)] ?? null } : null,
    nft: b.assets[0] ? { id: b.assets[0].tokenId, name: null } : null,
    collateral: coll ? tokenAmount(seed, coll.tokenId, coll.amount) : null,
    r5: b.basis.tree ? { digest: b.basis.tree.digest, height: b.basis.tree.height, flags: b.basis.tree.flags, keyLength: b.basis.tree.keyLength, valueLength: b.basis.tree.valueLength, empty: b.basis.tree.empty, zero: b.basis.tree.zero } : null,
    r6: b.basis.nft,
    r7,
    regs: { R4: b.regs.R4, R5: b.regs.R5, R6: b.regs.R6, R7: b.regs.R7 },
    creator: null,
    issues: b.basis.issues,
    legacy: !c.current,
    exit,
    snapshotExit: null,
    pending: live.mempool[c.p2sFull]?.total ?? -1,
    checked: unspent ? lastCheck(live, b.id, c.templateHash) : null,
  };
}

// ─── redemptions ────────────────────────────────────────────────────────────────────────────────

function redemptionFromSeed(seed: Seed, x: Seed["redemptions"][number]): RedemptionView {
  return {
    ...x,
    amount: big(x.amount),
    fee: big(x.fee),
    token: x.unit === "erg" ? null : tokenAmount(seed, x.unit, x.amount),
    ownerLabel: seed.labels[x.owner.addr] ?? null,
    receiverLabel: seed.labels[x.receiver] ?? null,
    source: "seed",
  };
}

function redemptionFromLive(seed: Seed, d: TxDetail): RedemptionView | null {
  if (d.kind !== "redemption" || !d.reserveIn || !d.reserveOut || !d.amount) return null;
  const ownerKey = d.reserveIn.registers.key;
  const ownerAddr = ownerKey ? p2pkAddress(ownerKey) : null;
  const t = d.tracker;
  return {
    tx: d.id,
    height: d.height,
    at: iso(d.timestamp) ?? "",
    ts: d.timestamp || null,
    contract: d.reserveIn.contract?.id ?? "",
    reserveIn: d.reserveIn.boxId,
    reserveOut: d.reserveOut.boxId,
    reserveNft: d.reserveIn.tokens[0]?.id ?? "",
    owner: { key: ownerKey, addr: ownerAddr },
    receiver: d.receiver,
    amount: d.amount.raw,
    unit: d.amount.unit,
    tracker: t && t.registers.key
      ? { box: t.boxId, nft: t.tokens[0]?.id ?? "", height: t.creationHeight, addr: t.address, key: t.registers.key, age: d.trackerAge ?? 0, nftCheck: t.tokens[0]?.id === d.reserveIn.registers.nft }
      : null,
    emergencyWindow: d.emergencyWindow ?? false,
    firstOfPair: false,
    treeWasEmpty: !!d.reserveIn.registers.tree?.empty,
    fee: d.fee,
    size: d.size,
    inputs: d.inputs.length,
    outputs: d.outputs.length,
    feePayers: d.inputs.filter((i) => i.role === "funding").map((i) => i.address),
    token: d.amount.unit === "erg" ? null : tokenAmount(seed, d.amount.unit, d.amount.raw),
    ownerLabel: ownerAddr ? seed.labels[ownerAddr] ?? null : null,
    receiverLabel: d.receiver ? seed.labels[d.receiver] ?? null : null,
    source: "live",
  };
}

// ─── totals ─────────────────────────────────────────────────────────────────────────────────────

const EXIT_CLASSES: ExitClass[] = ["locked", "refund", "refund+redeem", "redeem-if-tracker", "redeem", "refund+redeem-if-tracker", "redeem-checking", "refund+redeem-checking"];

export function computeTotals(seed: Seed, reserves: ReserveView[], redemptions: RedemptionView[], trackers: TrackerView[], live: LiveData): Totals {
  const unspent = reserves.filter((r) => r.unspent);
  const unspentTok = new Map<Hex, bigint>();
  for (const r of unspent) if (r.collateral) addTokens(unspentTok, r.collateral.id, r.collateral.amount);
  const redeemedTok = new Map<Hex, bigint>();
  for (const x of redemptions) if (x.unit !== "erg") addTokens(redeemedTok, x.unit, x.amount);
  const exit = Object.fromEntries(EXIT_CLASSES.map((c) => [c, { boxes: 0, nano: 0n, tokens: [] as TokenAmount[] }])) as Totals["exit"];
  const exitTok: Partial<Record<ExitClass, Map<Hex, bigint>>> = {};
  for (const r of unspent) {
    if (!r.exit) continue;
    const e = exit[r.exit.class];
    e.boxes++;
    e.nano += r.value;
    if (r.collateral) addTokens((exitTok[r.exit.class] ??= new Map()), r.collateral.id, r.collateral.amount);
  }
  for (const c of EXIT_CLASSES) exit[c].tokens = exitTok[c] ? tokenList(seed, exitTok[c]!) : [];
  const byContract: Totals["byContract"] = {};
  for (const r of reserves) {
    const id = r.contract?.id ?? "?";
    const b = (byContract[id] ??= { boxes: 0, unspent: 0, unspentNano: 0n, redemptions: 0 });
    b.boxes++;
    if (r.unspent) { b.unspent++; b.unspentNano += r.value; }
  }
  for (const x of redemptions) { const b = (byContract[x.contract] ??= { boxes: 0, unspent: 0, unspentNano: 0n, redemptions: 0 }); b.redemptions++; }
  const keys = new Set(reserves.filter((r) => r.owner).map((r) => r.owner!.key));
  const liveTx = Object.values(live.txs).filter((d) => !seed.redemptions.some((s) => s.tx === d.id));
  const newCommits = Object.values(live.trackers).reduce((s, t) => s + t.newCommits.length, 0);
  const liveCreations = reserves.filter((r) => r.source === "live" && r.origin === "unknown" && !r.prev);
  const S = seed.totals;
  return {
    reserveBoxes: reserves.length,
    unspent: unspent.length,
    unspentNano: unspent.reduce((s, r) => s + r.value, 0n),
    unspentTokens: tokenList(seed, unspentTok),
    redemptions: redemptions.length,
    redeemedNano: redemptions.filter((x) => x.unit === "erg").reduce((s, x) => s + x.amount, 0n),
    redeemedTokens: tokenList(seed, redeemedTok),
    depositedNano: big(S.depositedNano) + liveCreations.reduce((s, r) => s + r.value, 0n),
    ownerKeys: keys.size,
    malformedOwners: reserves.filter((r) => !r.owner && r.origin === "creation").length,
    receivers: new Set(redemptions.map((x) => x.receiver).filter(Boolean)).size,
    trackerNfts: trackers.length,
    trackerBoxes: S.trackerBoxes + newCommits,
    trackerBoxesReadable: S.trackerBoxesReadable + newCommits,
    topUps: S.topUps + liveTx.filter((d) => d.kind === "top-up").length,
    refundsInitiated: S.refundsInitiated + liveTx.filter((d) => d.kind === "refund-init").length,
    refundsCompleted: S.refundsCompleted + liveTx.filter((d) => d.kind === "refund-complete").length,
    emergencyProven: S.emergencyProven + liveTx.filter((d) => d.kind === "redemption" && d.emergencyWindow).length,
    exit,
    byContract,
  };
}

// ─── the whole model ────────────────────────────────────────────────────────────────────────────

export interface BuildInput { seed: Seed; live: LiveData; tip: number | null; status?: LiveStatus }

/** Seed + live facts → Observatory. Pure; store.ts memoizes it on (seed, live, tip). */
export function buildObservatory({ seed, live, tip, status }: BuildInput): Observatory {
  const height = tip ?? seed.asOf.height;
  const { list: contracts, byId, byTemplate } = contractIndex(seed);
  const extra = Object.values(live.extraReserves).filter((b) => !seed.reserves.some((r) => r.id === b.id));
  const trackers = seed.trackers.map((t) => trackerView(seed, t, live, height, seed.reserves, extra));
  const trackerMap = new Map(trackers.map((t) => [t.nft, t]));
  // where each R6 NFT is: a seed tracker's view, or the live lookup of an NFT outside the seed (null until it answers)
  const lookups = new Map<Hex, TrackerLookup | null>();
  const lookup: Lookup = (nft) => {
    if (!lookups.has(nft)) lookups.set(nft, trackerMap.has(nft) ? trackerLookup(seed, trackerMap.get(nft)) : liveTrackerLookup(seed, nft, live.trackers[nft]));
    return lookups.get(nft)!;
  };

  // lineage of live boxes: a live redemption links reserveIn → reserveOut
  const prev = new Map<Hex, Hex>();
  const next = new Map<Hex, Hex>();
  for (const d of Object.values(live.txs)) {
    if (d.reserveIn && d.reserveOut) { prev.set(d.reserveOut.boxId, d.reserveIn.boxId); next.set(d.reserveIn.boxId, d.reserveOut.boxId); }
  }
  const reserves: ReserveView[] = [
    ...extra.map((b) => reserveFromLive(seed, b, live, height, lookup, prev, next)).filter((r): r is ReserveView => !!r),
    ...seed.reserves.map((r) => reserveFromSeed(seed, r, live, height, lookup, next)),
  ].sort((a, b) => b.height - a.height);
  const reserveMap = new Map(reserves.map((r) => [r.id, r]));

  const redemptions: RedemptionView[] = [
    ...Object.values(live.txs).filter((d) => !seed.redemptions.some((s) => s.tx === d.id)).map((d) => redemptionFromLive(seed, d)).filter((x): x is RedemptionView => !!x),
    ...seed.redemptions.map((x) => redemptionFromSeed(seed, x)),
  ].sort((a, b) => b.height - a.height || (b.ts ?? 0) - (a.ts ?? 0));
  const redemptionMap = new Map(redemptions.map((x) => [x.tx, x]));

  const owners = ownerRows(seed, reserves);
  const receivers = receiverRows(seed, redemptions);
  const detector = detectorState(seed, live);
  const unspentList = reserves.filter((r) => r.unspent);
  return {
    asOf: seed.asOf,
    height,
    heightLive: tip !== null,
    contracts,
    reserves,
    unspent: unspentList,
    trackers,
    redemptions,
    incidents: seed.incidents,
    tokens: seed.tokens,
    labels: seed.labels,
    records: seed.records,
    totals: computeTotals(seed, reserves, redemptions, trackers, live),
    snapshotTotals: seed.totals,
    owners,
    receivers,
    detector,
    hostIndex: hostIndexView(seed, live, unspentList),
    live: status ?? { ...idleStatus(), changes: live.changes },
    warnings: seed.warnings,
    index: { reserves: reserveMap, trackers: trackerMap, redemptions: redemptionMap, contracts: byId, byTemplate },
  };
}

function ownerRows(seed: Seed, reserves: ReserveView[]): OwnerRow[] {
  const m = new Map<string, OwnerRow>();
  for (const r of reserves) {
    const k = r.owner?.key ?? `malformed:${r.regs.R4 ?? r.id}`;
    let row = m.get(k);
    if (!row) {
      row = { key: r.owner?.key ?? null, addr: r.owner?.addr ?? null, label: r.owner?.label ?? null, boxes: 0, unspent: 0, unspentNano: 0n, contracts: [], firstHeight: r.height };
      m.set(k, row);
    }
    row.boxes++;
    if (r.unspent) { row.unspent++; row.unspentNano += r.value; }
    const short = r.contract?.short ?? "?";
    if (!row.contracts.includes(short)) row.contracts.push(short);
    row.firstHeight = Math.min(row.firstHeight, r.height);
  }
  return [...m.values()].sort((a, b) => (b.unspentNano > a.unspentNano ? 1 : b.unspentNano < a.unspentNano ? -1 : 0) || b.boxes - a.boxes);
}

function receiverRows(seed: Seed, redemptions: RedemptionView[]): ReceiverRow[] {
  const m = new Map<Address, ReceiverRow & { tok: Map<Hex, bigint> }>();
  for (const x of redemptions) {
    if (!x.receiver) continue;
    let row = m.get(x.receiver);
    if (!row) { row = { addr: x.receiver, label: seed.labels[x.receiver] ?? null, redemptions: 0, nano: 0n, tokens: [], tok: new Map() }; m.set(x.receiver, row); }
    row.redemptions++;
    if (x.unit === "erg") row.nano += x.amount; else addTokens(row.tok, x.unit, x.amount);
  }
  return [...m.values()].map(({ tok, ...r }) => ({ ...r, tokens: tokenList(seed, tok) })).sort((a, b) => b.redemptions - a.redemptions);
}

export function hostIndexView(seed: Seed, live: LiveData, unspent: ReserveView[]): HostIndexView {
  const L = live.hostIndex;
  if (L) {
    const here = new Set(unspent.map((r) => r.id));
    const listedKnown = L.boxIds.filter((id) => here.has(id)).length;
    return {
      source: "live", reserveCount: L.reserveCount, ergLockedNano: big(L.ergLockedNano), trackerCount: L.trackerCount, listedKnown,
      unspentHere: unspent.length, notListed: unspent.length - listedKnown, checkedHeight: L.tipHeight, checkedAt: L.checkedAt,
    };
  }
  const S = seed.hostIndex;
  const listedKnown = Object.entries(S.byContract).reduce((s, [cid, n]) => s + Math.min(n, unspent.filter((r) => r.contract?.id === cid).length), 0);
  return {
    source: "seed", reserveCount: S.reserveCount, ergLockedNano: big(S.ergLockedNano), trackerCount: S.trackerCount, listedKnown,
    unspentHere: unspent.length, notListed: unspent.length - listedKnown, checkedHeight: seed.asOf.height, checkedAt: null,
  };
}

export function detectorState(seed: Seed, live: LiveData): DetectorState {
  const { byTemplate } = contractIndex(seed);
  const templates = [CURRENT_TEMPLATES.erg, CURRENT_TEMPLATES.multiToken].map((hash) => {
    const c = byTemplate.get(hash);
    const L = live.detector.templates[hash];
    const seedBoxes = c?.chain.boxes ?? 0;
    return {
      hash,
      contractId: c?.id ?? "",
      short: c?.short ?? hash.slice(0, 4),
      role: c?.role ?? "current",
      total: L ? L.total : seedBoxes,
      checkedHeight: L ? L.checkedHeight : seed.asOf.height,
      checkedAt: L ? L.checkedAt : null,
    };
  });
  return {
    watching: true,
    templates,
    found: Object.values(live.detector.found).sort((a, b) => b.creationHeight - a.creationHeight),
    checkedHeight: live.detector.checkedHeight ?? seed.asOf.height,
    checkedAt: live.detector.checkedAt,
  };
}

export function detectedBox(seed: Seed | null, b: LiveBox, contract: ContractView | null, at: number): DetectedBox {
  const key = b.basis.key;
  return {
    boxId: b.id,
    templateHash: b.templateHash,
    contract,
    creationHeight: b.height,
    value: b.value,
    address: b.address,
    unspent: !b.spentTx,
    registers: b.basis,
    owner: key ? { key, addr: p2pkAddress(key) } : null,
    tokens: b.assets.map((a) => tokenAmount(seed, a.tokenId, a.amount)),
    firstSeenAt: at,
  };
}

// ─── transactions ───────────────────────────────────────────────────────────────────────────────

/** Interprets a /v1 transaction: which input is the reserve, which data input the tracker, what moved. */
export function interpretTx(seed: Seed | null, tx: ApiTx): TxDetail {
  const view = (b: ApiBox, role: TxBoxRole): TxBoxView => {
    const lb = liveBoxFromApi(b);
    return {
      boxId: lb.id, value: lb.value, address: lb.address, creationHeight: lb.height, templateHash: lb.templateHash,
      contract: contractOf(seed, lb.ergoTree, lb.templateHash), role, registers: lb.basis,
      tokens: (b.assets || []).map((a) => tokenAmount(seed, a.tokenId.toLowerCase(), a.amount, a)), spentTx: lb.spentTx,
    };
  };
  const inputs = (tx.inputs || []).map((b) => view(b, "other"));
  const dataInputs = (tx.dataInputs || []).map((b) => view(b, "other"));
  const outputs = (tx.outputs || []).map((b) => view(b, "other"));
  const isFee = (v: TxBoxView) => (tx.outputs.find((o) => o.boxId === v.boxId)?.ergoTree ?? "").startsWith(FEE_TREE_PREFIX);

  const reserveIn = inputs.find((i) => i.contract) ?? null;
  const reserveOut = reserveIn
    ? outputs.find((o) => o.contract?.id === reserveIn.contract!.id && o.tokens[0]?.id === reserveIn.tokens[0]?.id) ?? null
    : null;
  const createdReserve = !reserveIn ? outputs.find((o) => o.contract) ?? null : null;
  const trackerNft = reserveIn?.registers.nft ?? null;
  const tracker = dataInputs.find((d) => d.registers.key && d.registers.tree && (!trackerNft || d.tokens[0]?.id === trackerNft)) ?? null;

  let kind: TxDetail["kind"] = "other";
  let amount: TxDetail["amount"] = null;
  if (reserveIn && reserveOut) {
    const tokenReserve = reserveIn.contract!.kind !== "erg";
    const inColl = tokenReserve ? reserveIn.tokens[1] : null;
    const outColl = tokenReserve ? reserveOut.tokens.find((t) => t.id === inColl?.id) : null;
    const delta = tokenReserve && inColl ? (outColl?.amount ?? 0n) - inColl.amount : reserveOut.value - reserveIn.value;
    const r7In = reserveIn.registers.refundHeight, r7Out = reserveOut.registers.refundHeight;
    if (r7In === 0n && r7Out > 0n && delta === 0n) kind = "refund-init";
    else if (delta < 0n) { kind = "redemption"; amount = { unit: tokenReserve && inColl ? inColl.id : "erg", raw: -delta }; }
    else if (delta > 0n) { kind = "top-up"; amount = { unit: tokenReserve && inColl ? inColl.id : "erg", raw: delta }; }
  } else if (reserveIn && !reserveOut) {
    kind = reserveIn.registers.refundHeight > 0n ? "refund-complete" : "other";
  } else if (createdReserve) kind = "creation";

  // roles
  if (reserveIn) reserveIn.role = "reserve-in";
  if (reserveOut) reserveOut.role = "reserve-out";
  if (createdReserve) createdReserve.role = "reserve-out";
  if (tracker) tracker.role = "tracker";
  for (const i of inputs) if (i.role === "other" && p2pkKeyOfTree(tx.inputs.find((x) => x.boxId === i.boxId)?.ergoTree ?? "")) i.role = "funding";
  for (const o of outputs) if (o.role === "other" && isFee(o)) o.role = "fee";
  let receiver: Address | null = null;
  if (kind === "redemption" && amount) {
    const payout = outputs.find((o) => o.role === "other" && (amount!.unit === "erg" ? o.value >= amount!.raw : o.tokens.some((t) => t.id === amount!.unit && t.amount >= amount!.raw)));
    if (payout) { payout.role = "payout"; receiver = payout.address; }
  }
  const funders = new Set(inputs.filter((i) => i.role === "funding").map((i) => i.address));
  for (const o of outputs) if (o.role === "other" && funders.has(o.address)) o.role = "change";

  const fee = outputs.filter((o) => o.role === "fee").reduce((s, o) => s + o.value, 0n);
  const trackerAge = tracker ? tx.inclusionHeight - tracker.creationHeight : null;
  return {
    id: tx.id,
    height: tx.inclusionHeight,
    timestamp: tx.timestamp,
    size: tx.size ?? null,
    confirmations: tx.numConfirmations ?? null,
    kind,
    inputs,
    dataInputs,
    outputs,
    reserveIn,
    reserveOut: reserveOut ?? createdReserve,
    tracker,
    amount,
    receiver,
    fee: outputs.some((o) => o.role === "fee") ? fee : null,
    trackerAge,
    emergencyWindow: trackerAge === null ? null : trackerAge > EMERGENCY_BLOCKS,
  };
}

// ─── any box (Learn "decode any box") ───────────────────────────────────────────────────────────

/** Everything a page can say about one /v1 box. `templateHash` comes from the async WebCrypto path (decode.templateHash). */
export function boxDetail(seed: Seed | null, b: ApiBox, templateHash: Hex | null): BoxDetail {
  let tree: BoxDetail["tree"] = null;
  let treeError: string | null = null;
  try {
    const t = parseErgoTree(b.ergoTree);
    tree = {
      header: t.headerHex, version: t.version, hasSize: t.hasSize, segregated: t.segregated, bytes: t.bytes,
      constants: t.constants.map((c) => ({ type: c.type, display: c.display })), templateBytes: t.template.length,
    };
  } catch (e) { treeError = e instanceof Error ? e.message : String(e); }
  const lb = liveBoxFromApi(b);
  const derived = safeAddress(b.ergoTree);
  const contract = contractOf(seed, b.ergoTree, templateHash);
  const registers: BoxDetail["registers"] = [];
  for (const k of REG_NAMES) { const h = lb.regs[k]; if (h) registers.push({ name: k, hex: h, decoded: decodeConstant(h) }); }
  const p2pkKey = p2pkKeyOfTree(b.ergoTree);
  const knownNft = seed && lb.assets[0] ? seed.trackers.some((t) => t.nft === lb.assets[0].tokenId) : false;
  const role: BoxDetail["role"] = contract ? "reserve" : p2pkKey && isTrackerShaped(lb) && (knownNft || lb.basis.tree) ? "tracker" : "other";
  return {
    boxId: b.boxId,
    tx: b.transactionId,
    value: lb.value,
    creationHeight: b.creationHeight,
    address: b.address || derived,
    addressMatches: !!derived && derived === b.address,
    ergoTree: b.ergoTree,
    tree,
    treeError,
    templateHash,
    contract,
    p2pkKey,
    registers,
    basis: lb.basis,
    role,
    owner: role === "reserve" && lb.basis.key ? { key: lb.basis.key, addr: p2pkAddress(lb.basis.key) } : null,
    tokens: (b.assets || []).map((a) => tokenAmount(seed, a.tokenId.toLowerCase(), a.amount, a)),
    spentTx: b.spentTransactionId ?? null,
  };
}
