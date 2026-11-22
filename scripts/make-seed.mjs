#!/usr/bin/env node
// make-seed.mjs — turns the research snapshot /root/basis/research/data/onchain.json into the compact
// mainnet seed src/chain/seed.json that the Network observatory loads lazily (owner: src/chain).
//
//   node scripts/make-seed.mjs [--in <onchain.json>] [--out <seed.json>] [--quiet]
//
// Pure Node (no dependencies): node:crypto for SHA-256, a small ErgoTree constant parser for the
// contract parameters (2160 blocks vs 604800000 ms, 43 200, top-up minimum) and an opcode scan for
// the AVL+ method (insert vs insertOrUpdate). The script checks the snapshot against the numbers in
// research/KNOWLEDGE.md (99 / 58 / 41 / 12, 8.995 ERG + 3.4 USE + 2.7 look-alike) and prints every
// disagreement; when they disagree, the snapshot wins (it is what the chain said) and the seed keeps it.
//
// History is immutable, so the seed only changes when the snapshot is refreshed. Live changes come
// from src/chain/store.ts polling /v1.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const arg = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
const IN = resolve(arg("in", "/root/basis/research/data/onchain.json"));
const OUT = resolve(arg("out", resolve(here, "../src/chain/seed.json")));
const QUIET = argv.includes("--quiet");

const oj = JSON.parse(readFileSync(IN, "utf8"));
const warnings = [];
const warn = (m) => warnings.push(m);

// ─── constants (KNOWLEDGE §d.5, §g, §i) ─────────────────────────────────────────────────────────
const EMPTY_DIGEST = "4ec61f485b98eb87153f7c57db4f5ecd75556fddbc403b41acf8441fde8e160900";
const USE_ID = "a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669";
const LOOKALIKE_ID = "548a6819b987023f413beb3320deafe16f8d81ca4836aebed94bae9098a69201";
const EMERGENCY_BLOCKS = 2160;

/** Short labels and roles of the 14 known templates (KNOWLEDGE §d.5, N07 §2). */
const CONTRACT_META = {
  "erg-v2025-09": { short: "2WbQ", role: "repo-only" },
  "erg-v2025-10-atc4": { short: "AtC4", role: "repo-only" },
  "erg-v2025-10-w52": { short: "W52", role: "legacy" },
  "erg-v2026-02-rtqx": { short: "RtQx", role: "legacy" },
  "erg-v2026-07-4zhb": { short: "4ZhB", role: "legacy" },
  "erg-v2026-07-3pqn": { short: "3PQn", role: "legacy" },
  "erg-v2026-07-pb9o": { short: "pB9o", role: "legacy" },
  "token-v2026-08-qk8q": { short: "Qk8Q", role: "repo-only" },
  "token-v2026-08-96hr": { short: "96Hr", role: "legacy" },
  "token-v2026-08-fjrq": { short: "Fjrq", role: "repo-only" },
  "erg-v2026-10-c3": { short: "2XoR", role: "current" },
  "token-v2026-10-c3": { short: "EUNi", role: "superseded" },
  "token-v2026-10-c3-raw": { short: "EUNi raw", role: "superseded" },
  "multitoken-v2026-10": { short: "8LeD", role: "current" },
};

/** Demo names that the protocol repo itself gives to these keys (BT specs/interactive_demo.md:43-47,
 *  specs/celaut_use_demo_run6_report.md:23). Labels only; nothing about who owns them is claimed. */
const LABELS = {
  "9hNQcqi72NB5u5Tw6tbfCGbEKByguR7njvcyZXnXPLvV3Do1DiJ": "Alice",
  "9hnupHc2udAoa7SV2UrWAba3N7pu9tR4RX662wv2iFa9gMn1E73": "Bob",
  "9hV5vHf89XdsLZC7cuGUzuP9P3j6HZsZvc6u2LQHuoz2i5n9XqR": "Dave",
  "9f7ZXamnfaDZL7EWLKLuBZgWMuHCusQYK6yow2d7p2eES9oRRRe": "Tracker",
};

// ─── tiny byte helpers ──────────────────────────────────────────────────────────────────────────
const hexToBytes = (h) => Uint8Array.from(Buffer.from(h, "hex"));
const sha256 = (b) => createHash("sha256").update(b).digest("hex");
function readVlq(b, i) {
  let n = 0n, s = 0n;
  for (;;) {
    if (i >= b.length) throw new Error("truncated VLQ");
    const x = b[i++];
    n |= BigInt(x & 0x7f) << s;
    if (!(x & 0x80)) return [n, i];
    s += 7n;
  }
}
const unzig = (n) => (n >> 1n) ^ -(n & 1n);

// ─── ErgoTree: header, constants, template (same rule as src/chain/decode.ts parseErgoTree) ─────
const PRIM = { 1: "Boolean", 2: "Byte", 3: "Short", 4: "Int", 5: "Long", 6: "BigInt", 7: "GroupElement", 8: "SigmaProp" };
function readType(b, i) {
  const t = b[i++];
  if (t >= 1 && t <= 8) return [{ k: "prim", p: t }, i];
  if (t > 12 && t <= 20) return [{ k: "coll", e: { k: "prim", p: t - 12 } }, i];
  if (t === 12) { const [e, j] = readType(b, i); return [{ k: "coll", e }, j]; }
  if (t > 24 && t <= 32) return [{ k: "coll", e: { k: "coll", e: { k: "prim", p: t - 24 } } }, i];
  if (t === 100) return [{ k: "avl" }, i];
  throw new Error(`unsupported constant type 0x${t.toString(16)}`);
}
function readValue(b, i, ty) {
  if (ty.k === "prim") {
    if (ty.p === 1 || ty.p === 2) return [b[i], i + 1];
    if (ty.p >= 3 && ty.p <= 5) { const [n, j] = readVlq(b, i); return [unzig(n), j]; }
    if (ty.p === 7) return [Buffer.from(b.subarray(i, i + 33)).toString("hex"), i + 33];
    throw new Error(`unsupported primitive ${ty.p}`);
  }
  if (ty.k === "coll") {
    const [nBig, j0] = readVlq(b, i); const n = Number(nBig); let j = j0;
    if (ty.e.k === "prim" && ty.e.p === 2) return [Buffer.from(b.subarray(j, j + n)).toString("hex"), j + n];
    if (ty.e.k === "prim" && ty.e.p === 1) { const nb = (n + 7) >> 3; return [`bits:${n}`, j + nb]; }
    const out = [];
    for (let k = 0; k < n; k++) { const [v, jj] = readValue(b, j, ty.e); out.push(v); j = jj; }
    return [out, j];
  }
  throw new Error("unsupported constant value");
}
const typeName = (ty) => (ty.k === "prim" ? PRIM[ty.p] : ty.k === "coll" ? `Coll[${typeName(ty.e)}]` : "AvlTree");
function parseTree(hex) {
  const b = hexToBytes(hex);
  const header = b[0];
  let i = 1;
  const hasSize = (header & 0x08) !== 0;
  const segregated = (header & 0x10) !== 0;
  if (hasSize) { const [, j] = readVlq(b, i); i = j; }
  const constants = [];
  if (segregated) {
    const [nBig, j0] = readVlq(b, i); i = j0;
    for (let k = 0; k < Number(nBig); k++) {
      const [ty, j1] = readType(b, i); const [v, j2] = readValue(b, j1, ty); i = j2;
      constants.push({ type: typeName(ty), value: v });
    }
  }
  const template = b.subarray(i);
  return { header, version: header & 0x07, hasSize, segregated, bytes: b.length, constants, template };
}
/** AVL+ method calls in the template: MethodCall 0xdc, type AvlTree 0x64, method 0x0a get, 0x0c insert, 0x10 insertOrUpdate. */
function avlOps(template) {
  const found = new Set();
  for (let i = 0; i + 2 < template.length; i++) {
    if (template[i] !== 0xdc || template[i + 1] !== 0x64) continue;
    if (template[i + 2] === 0x0c) found.add("insert");
    if (template[i + 2] === 0x10) found.add("insertOrUpdate");
  }
  return ["insert", "insertOrUpdate"].filter((x) => found.has(x));
}
function namedParams(constants, kind) {
  const ints = constants.filter((c) => c.type === "Int" || c.type === "Long");
  const has = (type, v) => ints.some((c) => c.type === type && c.value === BigInt(v));
  const emergency = has("Int", 2160) ? { unit: "blocks", value: 2160 } : has("Int", 604800000) ? { unit: "ms", value: 604800000 } : null;
  const refundBlocks = has("Int", 43200) ? 43200 : null;
  const topUpMinNano = kind === "erg" ? (has("Long", 1000000000) ? "1000000000" : has("Long", 100000000) ? "100000000" : null) : null;
  return { emergency, refundBlocks, topUpMinNano, topUpMinTokenUnits: kind === "erg" ? null : 1 };
}
const short = (addr) => ({ head: addr.slice(0, 12), tail: addr.slice(-6), length: addr.length });

// ─── contracts ──────────────────────────────────────────────────────────────────────────────────
const perContract = oj.totals.perContract;
const contracts = oj.contracts.map((c) => {
  const meta = CONTRACT_META[c.id];
  if (!meta) throw new Error(`unknown contract id ${c.id}`);
  const t = parseTree(c.ergoTree);
  const tpl = sha256(t.template);
  if (tpl !== c.templateHash) throw new Error(`template hash mismatch for ${c.id}: ${tpl} vs ${c.templateHash}`);
  const hdr = t.header.toString(16).padStart(2, "0");
  if (hdr !== c.ergoTreeHeader) warn(`${c.id}: header ${hdr} vs snapshot ${c.ergoTreeHeader}`);
  if (t.constants.length !== c.constants) warn(`${c.id}: ${t.constants.length} constants vs snapshot ${c.constants}`);
  const ops = avlOps(t.template);
  if (c.onchainAvlOp && (ops.length !== 1 || ops[0] !== c.onchainAvlOp)) warn(`${c.id}: AVL scan ${ops} vs snapshot ${c.onchainAvlOp}`);
  const params = namedParams(t.constants, c.kind);
  // Actions: what the decompiled on-chain trees show (snapshot); for templates without boxes, what the
  // source of that era has: a 43 200 refund constant means refundInit + refundComplete (basis.es:446-465).
  const actions = c.onchainActions ?? (params.refundBlocks ? ["redeem", "topUp", "refundInit", "refundComplete"] : ["redeem", "topUp"]);
  const pc = perContract[c.id];
  return {
    id: c.id,
    short: meta.short,
    name: c.name,
    kind: c.kind,
    role: meta.role,
    current: !!c.current,
    templateHash: c.templateHash,
    p2s: short(c.address),
    ergoTree: c.ergoTree,
    header: hdr,
    version: t.version,
    hasSize: t.hasSize,
    segregated: t.segregated,
    treeBytes: t.bytes,
    constantsCount: t.constants.length,
    params,
    avlOps: ops,
    actions,
    ownerExit: actions.includes("refundComplete"),
    repo: { first: c.repoFirstCommit, last: c.repoLastCommit, source: c.source },
    chain: pc
      ? {
          boxes: pc.boxes, creations: pc.creations, unspent: pc.unspent, unspentNano: String(pc.unspentNano),
          redemptions: pc.redemptions, redeemedNano: String(pc.redeemedNano),
          redeemedTokens: Object.fromEntries(Object.entries(pc.redeemedTokens).map(([k, v]) => [k, String(v)])),
          owners: pc.owners, firstHeight: pc.firstHeight, firstAt: pc.firstAt, lastHeight: pc.lastActivityHeight, lastAt: pc.lastActivityAt,
        }
      : { boxes: c.onchain?.boxes ?? 0, note: c.onchain?.note ?? null },
  };
});
const contractById = Object.fromEntries(contracts.map((c) => [c.id, c]));

// ─── tokens (collateral only; reserve NFT names travel with the reserves) ───────────────────────
const tokenRow = (id) => oj.tokens.find((t) => t.tokenId === id);
const tokens = {};
for (const [id, kind, label] of [[USE_ID, "use", "USE (DexyUSD)"], [LOOKALIKE_ID, "use-lookalike", "test token also named USE"]]) {
  const t = tokenRow(id);
  if (!t) { warn(`token ${id} missing from the snapshot`); continue; }
  tokens[id] = { name: t.name, label, decimals: t.decimals, kind, emission: String(t.emission), mintBox: t.mintBoxId, firstHeight: t.firstHeight, holders: t.holders };
}

// ─── trackers ───────────────────────────────────────────────────────────────────────────────────
// Facts the snapshot lacks, read once from /v1 (GET, same API the app uses). Applied only while the box id still matches.
const PROBED = {
  "5a79a4b3e66e378ad74a4a88a290c647dc1a1b6693a74ace3bdf38966562276d": {
    box: "50bae76531d93a2a5e82ef47ad8c6987f0668da859dec881f95e6e4b791db89c",
    holder: "9gZLYYtsC6EUhj4SK2XySR9duVorTcQxHK8oE4ZTdUEpReTXcAK",
    height: 1896024,
    source: "GET /v1/boxes/unspent/byTokenId/5a79a4b3… on 2026-11-21",
  },
};
const reserveIds = new Set(oj.reserves.map((r) => r.boxId));
const reservesByBox = Object.fromEntries(oj.reserves.map((r) => [r.boxId, r]));
const ZERO = /^0+$/;
const trackers = oj.trackers.map((t) => {
  const roleTracker = t.history.filter((e) => e.role === "tracker").sort((a, b) => a.creationHeight - b.creationHeight);
  const readable = roleTracker.filter((e) => e.r4?.kind === "GroupElement" && e.r5);
  // R4 key history, in box order (the key may change between boxes of one NFT; KNOWLEDGE Verification #23).
  const keys = [];
  for (const e of readable) {
    const last = keys[keys.length - 1];
    if (last && last.key === e.r4.pubKey) { last.to = e.creationHeight; last.boxes++; }
    else keys.push({ key: e.r4.pubKey, addr: e.r4.address, from: e.creationHeight, to: e.creationHeight, boxes: 1 });
  }
  const keyIdx = (pk) => keys.findIndex((k) => k.key === pk);
  const commits = [...t.states].sort((a, b) => a.firstHeight - b.firstHeight).map((s) => [s.firstHeight, s.digest, s.reposts + 1, keyIdx(s.trackerPubKey)]);
  const heights = readable.map((e) => e.creationHeight);
  const beats = heights.map((h, i) => (i === 0 ? h : h - heights[i - 1]));
  const lastT = readable[readable.length - 1] || null;
  const unspentNow = t.history.filter((e) => e.spentTxId == null);
  const holderBox = unspentNow.length ? unspentNow.sort((a, b) => b.creationHeight - a.creationHeight)[0] : null;
  // Status = where the NFT is now (KNOWLEDGE §d.5 table, N07 §7.1).
  let status, evidence;
  if (t.status === "burned") {
    status = "burned";
    evidence = { kind: "burn", tx: t.burnTxId, height: t.burnHeight, at: t.burnAt, box: t.lastBoxId, note: t.statusNote };
  } else if (reserveIds.has(t.lastBoxId)) {
    const r = reservesByBox[t.lastBoxId];
    status = "locked";
    evidence = { kind: "reserve", box: t.lastBoxId, height: r.creationHeight, at: r.createdAt, contract: r.contract, note: t.statusNote };
  } else if (holderBox && holderBox.role === "tracker" && holderBox.r4?.kind === "GroupElement" && holderBox.r5) {
    status = holderBox.r5.zeroDigest ? "stale" : "live";
    evidence = { kind: "box", box: holderBox.boxId, height: holderBox.creationHeight, at: holderBox.createdAt, note: t.statusNote };
  } else {
    // Never posted a tracker box; the NFT sits in a plain wallet box (testTrackerNFT 5a79a4b3: 9gZLYYts…).
    status = "unused";
    const hb = t.history.find((e) => e.boxId === t.lastBoxId) || holderBox;
    evidence = { kind: "box", box: t.lastBoxId, height: hb?.creationHeight ?? null, at: hb?.createdAt ?? null, note: t.statusNote };
  }
  // holder = address of the unspent box that holds the NFT (tracker box, or the plain wallet box of an unused NFT).
  // The snapshot keeps no row for the wallet box of an unused NFT; PROBED fills it only when the box id matches.
  const probed = status === "unused" && PROBED[t.nftId]?.box === t.lastBoxId ? PROBED[t.nftId] : null;
  if (probed) { evidence.height = probed.height; evidence.at = null; evidence.source = probed.source; }
  const holder = status === "live" || status === "stale" ? holderBox.address : probed ? probed.holder : null;
  return {
    nft: t.nftId,
    name: t.name,
    description: t.description,
    mint: { box: t.mintBoxId, height: t.mintHeight, at: t.mintAt, addr: t.mintAddress },
    status,
    evidence,
    holder,
    lastTrackerBox: lastT
      ? { box: lastT.boxId, height: lastT.creationHeight, at: lastT.createdAt, addr: lastT.address, key: lastT.r4.pubKey, digest: lastT.r5.digest, flags: lastT.r5.flags, zero: !!lastT.r5.zeroDigest, empty: !!lastT.r5.empty, value: String(lastT.valueNano), regs: lastT.registersRaw, unspent: lastT.spentTxId == null, spentTx: lastT.spentTxId ?? null }
      : null,
    currentBox: status === "burned" ? null : t.lastBoxId,
    keys,
    commits,
    beats,
    counts: {
      trackerBoxes: t.trackerBoxes,
      readable: readable.length,
      zeroDigest: readable.filter((e) => e.r5.zeroDigest).length,
      states: t.distinctStates,
      reservesReferencing: t.reservesReferencing,
      redemptionsServed: t.redemptionsServed,
    },
    firstHeight: t.firstTrackerHeight,
    lastHeight: t.lastTrackerHeight,
  };
});
const trackerByNft = Object.fromEntries(trackers.map((t) => [t.nft, t]));

// ─── reserves ───────────────────────────────────────────────────────────────────────────────────
const EXIT_MAP = {
  "locked-no-exit": "locked",
  "owner-can-refund": "refund",
  "owner-can-refund+redeemable": "refund+redeem",
  "redeemable-only (needs a new tracker box from the NFT holder)": "redeem-if-tracker",
};
const reserves = oj.reserves.map((r) => {
  const exit = r.unspent ? EXIT_MAP[r.assessment] : null;
  if (r.unspent && !exit) warn(`reserve ${r.boxId}: unknown assessment ${r.assessment}`);
  const r5 = r.r5
    ? { digest: r.r5.digest, height: r.r5.treeHeight, flags: r.r5.flags, keyLength: r.r5.keyLength, valueLength: r.r5.valueLength, empty: !!r.r5.empty, zero: !!r.r5.zeroDigest }
    : null;
  return {
    id: r.boxId,
    contract: r.contract,
    kind: r.kind,
    height: r.creationHeight,
    at: r.createdAt,
    tx: r.creationTxId,
    outputIndex: r.outputIndex,
    origin: r.createdBy,
    spent: r.unspent ? null : { tx: r.spentTxId, height: r.spentHeight, at: r.spentAt },
    prev: r.prevBoxId,
    next: r.nextBoxId,
    value: String(r.valueNano),
    owner: r.ownerPubKey ? { key: r.ownerPubKey, addr: r.ownerAddress } : null,
    nft: r.reserveNft ? { id: r.reserveNft.tokenId, name: r.reserveNft.name } : null,
    collateral: r.collateralToken ? { id: r.collateralToken.tokenId, amount: String(r.collateralToken.amount) } : null,
    r5,
    r6: r.trackerNftId,
    r7: r.refundHeight,
    regs: r.registersRaw,
    creator: r.creator,
    issues: r.flags,
    exit,
  };
});

// ─── redemptions ────────────────────────────────────────────────────────────────────────────────
const redemptions = oj.txs
  .filter((x) => x.kind === "redemption")
  .sort((a, b) => a.height - b.height || a.timestamp - b.timestamp)
  .map((x) => ({
    tx: x.id,
    height: x.height,
    at: x.at,
    ts: x.timestamp,
    contract: x.contract,
    reserveIn: x.reserveIn,
    reserveOut: x.reserveOut,
    reserveNft: x.reserveNftId,
    owner: { key: x.ownerPubKey, addr: x.owner },
    receiver: x.receiver,
    amount: String(x.amount),
    unit: x.unit === "ERG" ? "erg" : x.unit,
    tracker: { box: x.trackerBoxId, nft: x.trackerNftId, height: x.trackerBoxCreationHeight, addr: x.trackerBoxAddress, key: x.trackerPubKey, age: x.trackerAgeBlocks, nftCheck: x.trackerNftCheck },
    emergencyWindow: x.trackerAgeBlocks > EMERGENCY_BLOCKS,
    firstOfPair: x.firstRedemptionOfPair,
    treeWasEmpty: x.reserveTreeWasEmpty,
    fee: String(x.feeNano),
    size: x.size,
    inputs: x.nInputs,
    outputs: x.nOutputs,
    feePayers: x.feePayers,
  }));
for (const x of redemptions) {
  if (x.emergencyWindow !== oj.txs.find((t) => t.id === x.tx).emergencyWindowOpen) warn(`redemption ${x.tx}: emergency flag differs from the snapshot`);
}

// ─── incidents ──────────────────────────────────────────────────────────────────────────────────
const unspentReserves = reserves.filter((r) => !r.spent);
function affected(nft) {
  const all = reserves.filter((r) => r.r6 === nft);
  const un = unspentReserves.filter((r) => r.r6 === nft);
  const by = (c) => un.filter((r) => r.exit === c).length;
  return { reserves: all.length, unspent: un.length, locked: by("locked"), refundOnly: by("refund"), nano: String(un.reduce((s, r) => s + BigInt(r.value), 0n)) };
}
const burns = oj.txs
  .filter((x) => x.kind === "tracker-nft-burn")
  .sort((a, b) => a.height - b.height)
  .map((x) => ({ nft: x.trackerNftId, name: trackerByNft[x.trackerNftId]?.name ?? null, tx: x.id, height: x.height, at: x.at, box: x.spentBoxId, note: x.note, affected: affected(x.trackerNftId) }));
const locks = trackers
  .filter((t) => t.status === "locked")
  .map((t) => {
    const r = reserves.find((x) => x.id === t.evidence.box);
    const c = contractById[r.contract];
    // releasable: the holding reserve's script has the owner refund (its owner could free the NFT by completing one)
    return { nft: t.nft, name: t.name, reserve: r.id, contract: r.contract, height: r.height, at: r.at, releasable: c.ownerExit && !!r.owner, everTracker: t.counts.readable > 0, affected: affected(t.nft) };
  });
const tokenTotals = (id) => {
  const ever = reserves.filter((r) => r.collateral?.id === id);
  const creations = ever.filter((r) => r.origin === "creation");
  const unspentRaw = unspentReserves.filter((r) => r.collateral?.id === id).reduce((s, r) => s + BigInt(r.collateral.amount), 0n);
  const redeemedRaw = redemptions.filter((x) => x.unit === id).reduce((s, x) => s + BigInt(x.amount), 0n);
  return { reserves: creations.length, unspentReserves: unspentReserves.filter((r) => r.collateral?.id === id).length, depositedRaw: String(creations.reduce((s, r) => s + BigInt(r.collateral.amount), 0n)), unspentRaw: String(unspentRaw), redeemedRaw: String(redeemedRaw), redemptions: redemptions.filter((x) => x.unit === id).length };
};
const incidents = {
  burns,
  locks,
  // SQL 2026-11-21 (KNOWLEDGE §i.1, N06 §5.2): names prove nothing; identify by template + NFT id.
  basisNamedNfts: { count: 69, names: 30, from: "2025-10-13", to: "2026-11-10", source: "read-only SQL 2026-11-21 (KNOWLEDGE §i.1)" },
  lookalike: { token: LOOKALIKE_ID, real: USE_ID, ...tokenTotals(LOOKALIKE_ID), realStats: tokenTotals(USE_ID) },
};

// ─── totals and records ─────────────────────────────────────────────────────────────────────────
const sum = (xs) => xs.reduce((s, v) => s + BigInt(v), 0n);
const exitTotals = {};
for (const c of ["locked", "refund", "refund+redeem", "redeem-if-tracker"]) {
  const rs = unspentReserves.filter((r) => r.exit === c);
  const toks = {};
  for (const r of rs) if (r.collateral) toks[r.collateral.id] = String(BigInt(toks[r.collateral.id] ?? 0) + BigInt(r.collateral.amount));
  exitTotals[c] = { boxes: rs.length, nano: String(sum(rs.map((r) => r.value))), tokens: toks };
}
const ownerKeys = new Set(reserves.filter((r) => r.owner).map((r) => r.owner.key));
const unspentTokens = {};
for (const r of unspentReserves) if (r.collateral) unspentTokens[r.collateral.id] = String(BigInt(unspentTokens[r.collateral.id] ?? 0) + BigInt(r.collateral.amount));
const redeemedTokens = {};
for (const x of redemptions) if (x.unit !== "erg") redeemedTokens[x.unit] = String(BigInt(redeemedTokens[x.unit] ?? 0) + BigInt(x.amount));
const totals = {
  reserveBoxes: reserves.length,
  creations: reserves.filter((r) => r.origin === "creation").length,
  unspent: unspentReserves.length,
  unspentNano: String(sum(unspentReserves.map((r) => r.value))),
  unspentTokens,
  depositedNano: String(sum(reserves.filter((r) => r.origin === "creation").map((r) => r.value))),
  redemptions: redemptions.length,
  redeemedNano: String(sum(redemptions.filter((x) => x.unit === "erg").map((x) => x.amount))),
  redeemedTokens,
  topUps: oj.totals.topUps,
  refundsInitiated: oj.totals.refundsInitiated,
  refundsCompleted: oj.totals.refundsCompleted,
  emergencyProven: oj.totals.emergencyRedemptionsProven,
  ownerKeys: ownerKeys.size,
  malformedOwners: reserves.filter((r) => !r.owner).length,
  receivers: new Set(redemptions.map((x) => x.receiver)).size,
  trackerNfts: trackers.length,
  trackerBoxes: trackers.reduce((s, t) => s + t.counts.trackerBoxes, 0),
  trackerBoxesReadable: trackers.reduce((s, t) => s + t.counts.readable, 0),
  exit: exitTotals,
};
const ergRed = redemptions.filter((x) => x.unit === "erg");
const largest = ergRed.reduce((a, b) => (BigInt(b.amount) > BigInt(a.amount) ? b : a));
const firstToken = reserves.filter((r) => r.kind === "token").sort((a, b) => a.height - b.height)[0];
const lastBurn = burns[burns.length - 1];
const records = {
  firstArtifact: { nft: trackers.slice().sort((a, b) => a.mint.height - b.mint.height)[0].nft, height: Math.min(...trackers.map((t) => t.mint.height)) },
  firstReserve: (({ id, height, at, tx }) => ({ box: id, height, at, tx }))(reserves.slice().sort((a, b) => a.height - b.height)[0]),
  firstRedemption: (({ tx, height, at }) => ({ tx, height, at }))(redemptions[0]),
  largestRedemption: { tx: largest.tx, height: largest.height, at: largest.at, amount: largest.amount, unit: "erg" },
  firstTokenReserve: { box: firstToken.id, height: firstToken.height, at: firstToken.at },
  firstRepeatRedemption: (({ tx, height, at }) => ({ tx, height, at }))(redemptions.find((x) => !x.firstOfPair)),
  lastActivity: { tx: lastBurn.tx, height: lastBurn.height, at: lastBurn.at, what: "tracker NFT burned in a sweep" },
};

// ─── consistency with KNOWLEDGE (99 / 58 / 41 / 12; 8.995 ERG + 3.4 USE + 2.7 look-alike) ─────
const expect = (name, got, want) => { if (String(got) !== String(want)) warn(`KNOWLEDGE says ${name} = ${want}, snapshot gives ${got} (seed keeps the snapshot)`); };
expect("reserve boxes", totals.reserveBoxes, 99);
expect("unspent reserves", totals.unspent, 58);
expect("redemptions", totals.redemptions, 41);
expect("tracker NFTs", totals.trackerNfts, 12);
expect("unspent nanoERG", totals.unspentNano, "8995000000");
expect("unspent USE raw", unspentTokens[USE_ID], "3400");
expect("unspent look-alike raw", unspentTokens[LOOKALIKE_ID], "2700000");
expect("redeemed nanoERG", totals.redeemedNano, "3210000000");
expect("redeemed USE raw", redeemedTokens[USE_ID], "1100");
expect("redeemed look-alike raw", redeemedTokens[LOOKALIKE_ID], "300000");
expect("deposited nanoERG", totals.depositedNano, "12205000000");
expect("owner keys", totals.ownerKeys, 26);
expect("malformed owners", totals.malformedOwners, 2);
expect("receivers", totals.receivers, 5);
expect("tracker boxes", totals.trackerBoxes, 1570);
expect("readable tracker boxes (D14)", totals.trackerBoxesReadable, 1493);
expect("exit locked", `${exitTotals.locked.boxes}/${exitTotals.locked.nano}`, "21/4140000000");
expect("exit refund", `${exitTotals.refund.boxes}/${exitTotals.refund.nano}`, "33/4748000000");
expect("exit refund+redeem", `${exitTotals["refund+redeem"].boxes}/${exitTotals["refund+redeem"].nano}`, "3/7000000");
expect("exit redeem-if-tracker", `${exitTotals["redeem-if-tracker"].boxes}/${exitTotals["redeem-if-tracker"].nano}`, "1/100000000");
for (const [k, v] of Object.entries(oj.totals.assessment)) expect(`snapshot class ${k}`, exitTotals[EXIT_MAP[k]].boxes, v);
const knowStatus = { dbfbbaf9: "locked", "160aca8a": "locked", "69c5d7a4": "stale", "5a79a4b3": "unused", "8b1ab583": "locked", "000b0695": "burned", b159ad5c: "locked", f7f55159: "burned", "4e2eef33": "live", "34dd2a13": "live", "1b8bf82d": "live", "3391ccf0": "burned" };
for (const t of trackers) expect(`tracker ${t.nft.slice(0, 8)} status`, t.status, knowStatus[t.nft.slice(0, 8)]);

const seed = {
  v: 1,
  asOf: { height: oj.snapshot.tipHeight, at: oj.snapshot.tipAt, generatedAt: oj.generatedAt, source: "research/data/onchain.json" },
  constants: { emergencyBlocks: EMERGENCY_BLOCKS, refundBlocks: 43200, emptyDigest: EMPTY_DIGEST, minerFeeNano: "1000000", useTokenId: USE_ID, lookalikeTokenId: LOOKALIKE_ID },
  tokens,
  contracts,
  reserves,
  trackers,
  redemptions,
  incidents,
  labels: LABELS,
  records,
  totals,
  // What the host API's own Basis page (/v1/defi/basis) lists: hard-wired to two addresses (KNOWLEDGE §i.1, N07 §11).
  // The live layer re-reads it once per session; FEATURES O10.
  hostIndex: {
    reserveCount: 17, ergLockedNano: "202000000", trackerCount: 4,
    byContract: { "erg-v2026-07-3pqn": 2, "token-v2026-08-96hr": 15 },
    source: "KNOWLEDGE §i.1 (N07 §11), 2026-11-21",
  },
  warnings,
};
{
  // the host index can only list reserves we know as unspent
  const listed = Object.entries(seed.hostIndex.byContract);
  for (const [cid, n] of listed) {
    const have = unspentReserves.filter((r) => r.contract === cid).length;
    if (have !== n) warn(`host index lists ${n} ${cid} reserves, the snapshot has ${have} unspent`);
  }
}
const text = JSON.stringify(seed);
writeFileSync(OUT, text + "\n");
if (!QUIET) {
  console.log(`seed → ${OUT}: ${(text.length / 1024).toFixed(1)} KB; asOf h${seed.asOf.height} ${seed.asOf.at}`);
  console.log(`contracts ${contracts.length}, reserves ${reserves.length} (unspent ${unspentReserves.length}), trackers ${trackers.length}, redemptions ${redemptions.length}`);
  console.log(`exit: ${Object.entries(exitTotals).map(([k, v]) => `${k} ${v.boxes}`).join(", ")}`);
  for (const w of warnings) console.log(`WARN ${w}`);
}
