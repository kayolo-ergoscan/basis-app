// src/chain — mainnet observatory data model. Two layers:
//   Seed*   = the JSON written by scripts/make-seed.mjs (strings for every amount, as /v1 returns them);
//   *View   = what the hooks return: seed merged with live /v1 updates, amounts as bigint, decoded fields.
// Everything here is read-only mainnet data "as of block N". Nothing in src/chain signs or sends anything.

export type Hex = string;
export type Address = string;

// ─── Seed (src/chain/seed.json) ─────────────────────────────────────────────────────────────────

export type ContractRole = "legacy" | "current" | "superseded" | "repo-only";
export type ContractKind = "erg" | "token" | "multitoken";
export type ContractAction = "redeem" | "topUp" | "refundInit" | "refundComplete";
// "…-checking": where the R6 tracker NFT is has not been looked up yet in this tab (only for NFTs outside the seed)
export type ExitClass = "locked" | "refund" | "refund+redeem" | "redeem-if-tracker" | "redeem" | "refund+redeem-if-tracker" | "redeem-checking" | "refund+redeem-checking";
export type TrackerStatus = "live" | "stale" | "burned" | "locked" | "unused";
export type TokenKind = "use" | "use-lookalike" | "other";

export interface SeedContract {
  id: string;                    // e.g. "erg-v2026-07-pb9o"
  short: string;                 // P2S prefix label: W52, RtQx, 4ZhB, 3PQn, pB9o, 96Hr, 2XoR (current ERG), 8LeD (current multi-token)…
  name: string;
  kind: ContractKind;
  role: ContractRole;
  current: boolean;
  templateHash: Hex;             // SHA-256 of the ErgoTree template bytes (explorer convention)
  p2s: { head: string; tail: string; length: number };   // full P2S: p2sAddress(ergoTree)
  ergoTree: Hex;
  header: string;                // "10", "19", "1b"
  version: number;               // header & 0x07
  hasSize: boolean;
  segregated: boolean;
  treeBytes: number;
  constantsCount: number;
  params: {
    emergency: { unit: "blocks" | "ms"; value: number } | null;   // 2160 blocks; W52-era: 604800000 ms ("7 days", stale)
    refundBlocks: number | null;                                   // 43 200 when the template has the owner refund
    topUpMinNano: string | null;                                   // ERG templates: 1 ERG (W52) or 0.1 ERG
    topUpMinTokenUnits: number | null;                             // token templates: 1 unit
  };
  avlOps: ("insert" | "insertOrUpdate")[];                        // AVL+ method calls in the template
  actions: ContractAction[];
  ownerExit: boolean;            // has refundInit + refundComplete
  repo: { first: string | null; last: string | null; source: string };
  chain:
    | { boxes: number; creations: number; unspent: number; unspentNano: string; redemptions: number; redeemedNano: string; redeemedTokens: Record<Hex, string>; owners: number; firstHeight: number; firstAt: string; lastHeight: number; lastAt: string }
    | { boxes: number; note: string | null };
}

export interface SeedAvl {
  digest: Hex;                   // 33 bytes: root(32) ‖ height(1)
  height: number;
  flags: number;                 // bit0 insert, bit1 update, bit2 remove
  keyLength: number;
  valueLength: number | null;
  empty: boolean;                // = the canonical empty digest 4ec61f48…160900
  zero: boolean;                 // all-zero digest: nothing can ever be proven against it
}

export interface SeedReserve {
  id: Hex;                       // box id
  contract: string;              // SeedContract.id
  kind: "erg" | "token";
  height: number;                // creationHeight
  at: string;                    // block time at creationHeight (ISO)
  tx: Hex;                       // creating tx
  outputIndex: number | null;
  origin: "creation" | "redemption";
  spent: { tx: Hex; height: number; at: string } | null;
  prev: Hex | null;              // lineage (same reserve NFT, same script)
  next: Hex | null;
  value: string;                 // nanoERG
  owner: { key: Hex; addr: Address } | null;   // R4; null = malformed R4 (not a GroupElement)
  nft: { id: Hex; name: string | null } | null;  // the reserve's own NFT (assets[0]); name is untrusted
  collateral: { id: Hex; amount: string } | null; // token reserves: tokens(1), raw units
  r5: SeedAvl | null;            // null = R5 is not an AvlTree
  r6: Hex | null;                // tracker NFT id named by R6; null = missing / not 32 bytes
  r7: number | null;             // refund start height; 0 = none ("0500"); null = register absent (no refund in the script)
  regs: Partial<Record<"R4" | "R5" | "R6" | "R7", Hex>>;
  creator: Address | null;       // funding address of the creation tx; null for a box made by a redemption (model.ts takes the redemption's fee payer)
  issues: string[];              // malformed-register flags from the snapshot
  exit: Exclude<ExitClass, "redeem" | "refund+redeem-if-tracker" | "redeem-checking" | "refund+redeem-checking"> | null; // snapshot verdict (unspent only)
}

export interface SeedTrackerKey { key: Hex; addr: Address; from: number; to: number; boxes: number }

export interface SeedTracker {
  nft: Hex;
  name: string | null;           // EIP-4 name: UNTRUSTED (69 Basis-named NFTs exist; names prove nothing)
  description: string | null;
  mint: { box: Hex; height: number; at: string; addr: Address };
  status: TrackerStatus;
  evidence: { kind: "box" | "burn" | "reserve" | "script"; box?: Hex; tx?: Hex; height: number | null; at: string | null; contract?: string; note: string; source?: string };
  holder: Address | null;        // address of the unspent tracker box (live/stale)
  lastTrackerBox: {
    box: Hex; height: number; at: string; addr: Address; key: Hex; digest: Hex; flags: number; zero: boolean; empty: boolean;
    value: string; regs: Partial<Record<"R4" | "R5" | "R6", Hex>>; unspent: boolean; spentTx: Hex | null;
  } | null;
  currentBox: Hex | null;        // the unspent box holding the NFT now (tracker box, reserve box or plain wallet box)
  keys: SeedTrackerKey[];        // R4 key history (it may change between boxes; the holder may differ)
  commits: [height: number, digest: Hex, boxes: number, keyIndex: number][];  // one row per R5 state (re-posts folded)
  beats: number[];               // creation heights of every readable tracker box, delta-encoded: [h0, h1-h0, …]
  counts: { trackerBoxes: number; readable: number; zeroDigest: number; states: number; reservesReferencing: number; redemptionsServed: number };
  firstHeight: number | null;
  lastHeight: number | null;
}

export interface SeedRedemption {
  tx: Hex;
  height: number;
  at: string;
  ts: number;                    // tx timestamp (ms)
  contract: string;
  reserveIn: Hex;
  reserveOut: Hex;
  reserveNft: Hex;
  owner: { key: Hex; addr: Address };
  receiver: Address;
  amount: string;                // raw units of `unit`
  unit: "erg" | Hex;             // "erg" or the token id
  tracker: { box: Hex; nft: Hex; height: number; addr: Address; key: Hex; age: number; nftCheck: boolean };
  emergencyWindow: boolean;      // tracker box age > 2160 when the tx was mined
  firstOfPair: boolean;
  treeWasEmpty: boolean;
  fee: string;
  size: number;
  inputs: number;
  outputs: number;
  feePayers: Address[];
}

export interface SeedToken { name: string; label: string; decimals: number; kind: TokenKind; emission: string; mintBox: Hex; firstHeight: number; holders: number }

export interface SeedAffected { reserves: number; unspent: number; locked: number; refundOnly: number; nano: string }

export interface SeedIncidents {
  burns: { nft: Hex; name: string | null; tx: Hex; height: number; at: string; box: Hex; note: string; affected: SeedAffected }[];
  locks: { nft: Hex; name: string | null; reserve: Hex; contract: string; height: number; at: string; releasable: boolean; everTracker: boolean; affected: SeedAffected }[];
  basisNamedNfts: { count: number; names: number; from: string; to: string; source: string };
  lookalike: { token: Hex; real: Hex; reserves: number; unspentReserves: number; depositedRaw: string; unspentRaw: string; redeemedRaw: string; redemptions: number; realStats: { reserves: number; unspentReserves: number; depositedRaw: string; unspentRaw: string; redeemedRaw: string; redemptions: number } };
}

export interface SeedTotals {
  reserveBoxes: number; creations: number; unspent: number; unspentNano: string; unspentTokens: Record<Hex, string>;
  depositedNano: string; redemptions: number; redeemedNano: string; redeemedTokens: Record<Hex, string>;
  topUps: number; refundsInitiated: number; refundsCompleted: number; emergencyProven: number;
  ownerKeys: number; malformedOwners: number; receivers: number;
  trackerNfts: number; trackerBoxes: number; trackerBoxesReadable: number;
  exit: Record<"locked" | "refund" | "refund+redeem" | "redeem-if-tracker", { boxes: number; nano: string; tokens: Record<Hex, string> }>;
}

export interface Seed {
  v: 1;
  asOf: { height: number; at: string; generatedAt: string; source: string };
  constants: { emergencyBlocks: number; refundBlocks: number; emptyDigest: Hex; minerFeeNano: string; useTokenId: Hex; lookalikeTokenId: Hex };
  tokens: Record<Hex, SeedToken>;
  contracts: SeedContract[];
  reserves: SeedReserve[];
  trackers: SeedTracker[];
  redemptions: SeedRedemption[];
  incidents: SeedIncidents;
  labels: Record<Address, string>;   // demo names the protocol repo gives to some keys (Alice, Bob, Dave, Tracker)
  records: Record<string, { height: number; at?: string; tx?: Hex; box?: Hex; nft?: Hex; amount?: string; unit?: string; what?: string }>;
  totals: SeedTotals;
  hostIndex: { reserveCount: number; ergLockedNano: string; trackerCount: number; byContract: Record<string, number>; source: string };
  warnings: string[];                // seed-vs-KNOWLEDGE disagreements (the snapshot wins)
}

// ─── /v1 shapes (measured on :4401, see CHAIN_API.md) ───────────────────────────────────────────

/** A register as /v1 returns it: raw hex (site shape) or {serializedValue,…} (explorer shape). */
export type ApiRegister = Hex | { serializedValue: Hex; sigmaType?: string; renderedValue?: string } | null;

export interface ApiAsset { tokenId: Hex; amount: string | number; index?: number | null; name?: string | null; decimals?: number | null; type?: string | null }

export interface ApiBox {
  boxId: Hex;
  transactionId: Hex;
  blockId?: Hex;
  value: string | number;
  index?: number;
  globalIndex?: number;
  creationHeight: number;
  settlementHeight?: number;
  inclusionHeight?: number;
  spentHeight?: number | null;
  ergoTree: Hex;
  ergoTreeConstants?: string;
  ergoTreeScript?: string;
  address: Address;
  assets: ApiAsset[];
  additionalRegisters: Partial<Record<"R4" | "R5" | "R6" | "R7" | "R8" | "R9", ApiRegister>>;
  registers?: Partial<Record<"R4" | "R5" | "R6" | "R7" | "R8" | "R9", Hex | null>>;
  spentTransactionId: Hex | null;
  mainChain?: boolean;
}

export interface ApiList<T> { items: T[]; total?: number; offset?: number; limit?: number; hasMore?: boolean; nextCursor?: string | null; source?: string }

export interface ApiInfo { height: number; fullHeight?: number; headersHeight?: number; lastBlockId?: Hex; network?: string; appVersion?: string }

export interface ApiTxInput extends ApiBox { spendingProof?: Hex | null; outputTransactionId?: Hex; outputIndex?: number }

export interface ApiTx {
  id: Hex;
  blockId?: Hex;
  inclusionHeight: number;
  numConfirmations?: number;
  timestamp: number;
  inputs: ApiTxInput[];
  dataInputs: ApiBox[];
  outputs: ApiBox[];
  size?: number;
}

// ─── Decoded registers (decode.ts) ──────────────────────────────────────────────────────────────

export interface AvlTreeInfo extends SeedAvl {
  rootHash: Hex;                 // first 32 bytes of the digest
  insert: boolean;
  update: boolean;
  remove: boolean;
}

/** KNOWLEDGE Appendix B `decodeBasisBox`, with the verifier's fix (ownNft from assets[0], trackerValid). */
export interface BasisRegisters {
  key: Hex | null;               // R4 GroupElement → owner (reserve) or tracker (tracker box) pubkey, 33 bytes
  tree: AvlTreeInfo | null;      // R5 AvlTree
  nft: Hex | null;               // R6 Coll[Byte] of 32 bytes → tracker NFT (reserve) / own NFT (tracker box, optional)
  ownNft: Hex | null;            // assets[0].tokenId (a reserve's own NFT; a tracker box's NFT)
  refundHeight: bigint;          // R7 Long; 0n = none (also when R7 is absent)
  hasR7: boolean;
  valid: boolean;                // reserve shape: key && tree && !tree.zero && nft
  trackerValid: boolean;         // tracker shape: key && tree && !tree.zero && ownNft (R6 optional)
  issues: string[];              // human-readable codes: "R4-not-GroupElement", "R5-zero-digest", "R6-missing", …
}

/** A generic Sigma constant as decoded for display (Learn "decode any box"). */
export interface DecodedConstant { type: string; value: unknown; display: string; error?: string }

// ─── Views (hooks) ──────────────────────────────────────────────────────────────────────────────

export interface TokenAmount { id: Hex; amount: bigint; decimals: number; name: string | null; kind: TokenKind; label: string }

export interface ExitAssessment {
  class: ExitClass;
  redeem: "now" | "if-tracker-posts" | "checking" | "no";
  refund: "yes" | "pending" | "ready" | "no";
  reason: ExitReason;            // structured; text via describeExit(reason, lang)
  line: { en: string; ru: string };   // one-line reason
  emergency: EmergencyClock | null;    // of the tracker box the reserve would use (when one exists)
  refundClock: RefundClock | null;     // when R7 > 0
}

export type ExitReason =
  | { code: "tracker-live"; nft: Hex; trackerBox: Hex | null; emptyTree: boolean }
  | { code: "tracker-burned"; nft: Hex; tx: Hex | null }
  | { code: "tracker-locked"; nft: Hex; reserve: Hex | null; releasable: boolean }
  | { code: "tracker-stale"; nft: Hex }
  | { code: "tracker-unused"; nft: Hex; holder: Address | null }
  | { code: "tracker-own-nft"; nft: Hex }
  | { code: "tracker-unknown"; nft: Hex }
  | { code: "r6-missing" }
  | { code: "r5-invalid" }
  | { code: "r4-invalid" };

export interface EmergencyClock {
  boxHeight: number;             // creationHeight of the tracker box
  age: number;                   // tip − boxHeight
  open: boolean;                 // age > 2160: an empty #6 (no tracker signature) is accepted
  opensAt: number;               // boxHeight + 2161
  blocksLeft: number;            // 0 when open
}

export interface RefundClock {
  started: boolean;              // R7 > 0
  startedAt: number;             // R7
  completesAt: number;           // R7 + 43 200
  blocksLeft: number;
  ready: boolean;                // tip ≥ R7 + 43 200 (owner may complete)
}

export type Source = "seed" | "live";

export interface ContractView extends SeedContract { p2sFull: Address }

export interface ReserveView {
  id: Hex;
  source: Source;                // "live" = found by polling after the snapshot
  contract: ContractView | null;
  kind: "erg" | "token";
  height: number;
  at: string | null;
  tx: Hex | null;
  origin: "creation" | "redemption" | "unknown";
  unspent: boolean;
  spent: { tx: Hex | null; height: number | null; at: string | null; seenLive: boolean } | null;
  prev: Hex | null;
  next: Hex | null;
  value: bigint;
  owner: { key: Hex; addr: Address; label: string | null } | null;
  nft: { id: Hex; name: string | null } | null;
  collateral: TokenAmount | null;
  r5: SeedAvl | null;
  r6: Hex | null;
  r7: number | null;
  regs: Partial<Record<"R4" | "R5" | "R6" | "R7", Hex>>;
  /** "Paid by": who paid for the tx that made this box — the address with the most ERG among its inputs other than the
   *  reserve box it spent (the depositor of a creation, the fee payer of a redemption or a top-up; the snapshot's rule). */
  creator: Address | null;
  /** `known`: `creator` is set; `checking`: a box found live whose creating tx is not read yet; `redeemed`: made by a
   *  redemption with no other input (the network fee came out of the redeemed ERG); `none`: nothing to name. */
  creatorState: "known" | "checking" | "redeemed" | "none";
  issues: string[];
  legacy: boolean;              // template is not a current one ("exploitable, refund or migrate", R17)
  exit: ExitAssessment | null;   // unspent only; recomputed with live tracker states
  snapshotExit: SeedReserve["exit"];
  pending: number;               // mempool txs touching this reserve's address (focus polling), -1 = unknown
  checked: { height: number | null; at: number } | null;   // last live confirmation (own check or an unchanged template check)
}

/** The last box that had the tracker shape (R4 key, R5 tree) — the one the emergency clock counts from. */
export type TrackerBoxRef = Omit<NonNullable<SeedTracker["lastTrackerBox"]>, "at"> & { at: string | null };

export interface TrackerCommit { height: number; digest: Hex; boxes: number; key: Hex | null; zero: boolean; empty: boolean; source: Source; box?: Hex }

export interface TrackerView {
  nft: Hex;
  name: string | null;           // untrusted
  description: string | null;
  mint: SeedTracker["mint"];
  status: TrackerStatus;
  evidence: SeedTracker["evidence"];
  holder: Address | null;
  currentBox: Hex | null;
  lastTrackerBox: TrackerBoxRef | null;
  keys: (SeedTrackerKey & { label: string | null })[];
  commits: TrackerCommit[];
  beats: number[];               // decoded heights (not deltas)
  counts: SeedTracker["counts"];
  emergency: EmergencyClock | null;    // for live/stale boxes
  silentBlocks: number | null;   // tip − last tracker box height
  reserves: Hex[];               // reserve box ids whose R6 names this NFT (unspent first)
  redemptions: Hex[];            // tx ids served
  source: Source;                // "live" when a live poll changed it after the snapshot
  checkedAt: number | null;      // local ms of the last live check of this NFT
}

export interface RedemptionView extends Omit<SeedRedemption, "amount" | "fee" | "receiver" | "owner" | "tracker" | "size" | "ts"> {
  amount: bigint;
  fee: bigint | null;
  ts: number | null;
  size: number | null;
  owner: { key: Hex | null; addr: Address | null };
  receiver: Address | null;
  tracker: SeedRedemption["tracker"] | null;
  token: TokenAmount | null;     // null for ERG
  ownerLabel: string | null;
  receiverLabel: string | null;
  source: Source;
  /** Known from the two reserve boxes only (the box it spent and the box it made, same NFT and script): the transaction
   *  itself is not read yet, so the receiver, the time, the tracker box and its age, the fee and the size are unknown
   *  (null / 0) until it is. Amount, owner, block and the reserve's R6 tracker NFT are exact. */
  fromBoxes: boolean;
  /** The tracker NFT this redemption was checked against: the tracker data input's NFT, or (fromBoxes) the reserve's R6,
   *  which the contract requires the data input to hold. */
  trackerNft: Hex | null;
}

export interface DetectedBox {
  boxId: Hex;
  templateHash: Hex;
  contract: ContractView | null;
  creationHeight: number;
  value: bigint;
  address: Address;
  unspent: boolean;
  registers: BasisRegisters;
  owner: { key: Hex; addr: Address } | null;
  tokens: TokenAmount[];
  firstSeenAt: number;           // local ms
}

export interface DetectorState {
  watching: true;
  templates: { hash: Hex; contractId: string; short: string; role: ContractRole; total: number | null; checkedHeight: number | null; checkedAt: number | null }[];
  found: DetectedBox[];          // boxes at the current (and superseded) templates; [] until the first deployment
  checkedHeight: number | null;
  checkedAt: number | null;
}

export interface LiveStatus {
  enabled: boolean;              // live polling running (some hook mounted, tab visible)
  online: boolean;               // last request succeeded
  hidden: boolean;
  lastOkAt: number | null;
  lastError: string | null;
  changes: number;               // live changes merged since the snapshot
  budget: BudgetStats;
}

export interface BudgetStats {
  perBlock: number;              // 6
  usedThisBlock: number;
  requests: number;              // since load
  byLane: Record<"height" | "background" | "interactive", number>;
  lastLatencyMs: number | null;
  avgLatencyMs: number | null;
}

export interface Totals {
  reserveBoxes: number;
  unspent: number;
  unspentNano: bigint;
  unspentTokens: TokenAmount[];
  redemptions: number;
  redeemedNano: bigint;
  redeemedTokens: TokenAmount[];
  depositedNano: bigint;
  ownerKeys: number;
  malformedOwners: number;
  receivers: number;
  trackerNfts: number;
  trackerBoxes: number;
  trackerBoxesReadable: number;
  topUps: number;
  refundsInitiated: number;
  refundsCompleted: number;
  emergencyProven: number;
  exit: Record<ExitClass, { boxes: number; nano: bigint; tokens: TokenAmount[] }>;
  byContract: Record<string, { boxes: number; unspent: number; unspentNano: bigint; redemptions: number }>;
}

export interface HostIndexView {
  source: Source;                // "seed" = the KNOWLEDGE figure until the live layer re-reads it
  reserveCount: number;          // 17 on 2026-11-21
  ergLockedNano: bigint;
  trackerCount: number;
  listedKnown: number;           // of its reserves, how many are unspent reserves here (by box id; seed source: by contract count)
  unspentHere: number;           // 58
  notListed: number;             // unspent here that it does not list
  checkedHeight: number | null;
  checkedAt: number | null;
}

export interface OwnerRow { key: Hex | null; addr: Address | null; label: string | null; boxes: number; unspent: number; unspentNano: bigint; contracts: string[]; firstHeight: number }
export interface ReceiverRow { addr: Address; label: string | null; redemptions: number; nano: bigint; tokens: TokenAmount[] }

export interface Observatory {
  asOf: Seed["asOf"];
  height: number;                // live tip when known, else the snapshot height
  heightLive: boolean;
  contracts: ContractView[];
  reserves: ReserveView[];       // seed (99) + live additions, newest first
  unspent: ReserveView[];
  trackers: TrackerView[];
  redemptions: RedemptionView[]; // newest first
  incidents: SeedIncidents;
  tokens: Record<Hex, SeedToken>;
  labels: Record<Address, string>;
  records: Seed["records"];
  totals: Totals;                // recomputed from the merged reserves (equals the snapshot until something changes)
  snapshotTotals: SeedTotals;
  owners: OwnerRow[];
  receivers: ReceiverRow[];
  detector: DetectorState;
  /** FEATURES O10: what the host API's own Basis page (/v1/defi/basis) lists, against the reserves here. */
  hostIndex: HostIndexView;
  live: LiveStatus;
  warnings: string[];
  index: {
    reserves: Map<Hex, ReserveView>;
    trackers: Map<Hex, TrackerView>;
    redemptions: Map<Hex, RedemptionView>;
    contracts: Map<string, ContractView>;
    byTemplate: Map<Hex, ContractView>;
  };
}

// ─── Live layer facts (store.ts) and on-demand details (useBox, useRedemption) ──────────────────

/** One unspent box as the live layer keeps it (decoded once). */
export interface LiveBox {
  id: Hex;
  tx: Hex;
  height: number;                // creationHeight
  value: bigint;
  address: Address;
  ergoTree: Hex;
  templateHash: Hex;
  assets: { tokenId: Hex; amount: bigint }[];
  regs: Partial<Record<"R4" | "R5" | "R6" | "R7" | "R8" | "R9", Hex>>;
  basis: BasisRegisters;
  spentTx: Hex | null;
  settled?: number | null;       // height of the block that holds the creating tx (API `settlementHeight`); null = not sent
}

export interface TrackerLive {
  checkedAt: number;
  checkedHeight: number | null;
  box: LiveBox | null;           // null = no unspent box holds the NFT (burned)
  newCommits: TrackerCommit[];   // tracker boxes first seen live (after the snapshot)
}

export interface LiveData {
  trackers: Record<Hex, TrackerLive>;
  templates: Record<Hex, { total: number; newest: Hex | null; checkedAt: number; checkedHeight: number | null; changed: boolean }>;
  spent: Record<Hex, { tx: Hex | null; height: number | null; seenAt: number }>;   // seed-unspent reserves seen spent
  extraReserves: Record<Hex, LiveBox>;   // reserve boxes made after the snapshot (found at known templates or in a tx), spent ones too
  txs: Record<Hex, TxDetail>;            // reserve txs seen live (redemptions, top-ups, refunds), interpreted
  checks: Record<string, { height: number | null; at: number }>;   // "box:<id>" focus checks that found the box unspent
  detector: { found: Record<Hex, DetectedBox>; templates: Record<Hex, { total: number; checkedAt: number; checkedHeight: number | null }>; checkedAt: number | null; checkedHeight: number | null };
  mempool: Record<Address, { total: number; checkedAt: number }>;
  hostIndex: { reserveCount: number; ergLockedNano: string; trackerCount: number; boxIds: Hex[]; tipHeight: number | null; checkedAt: number } | null;
  changes: number;
}

export interface HeightInfo {
  height: number | null;         // live tip; null until the first /v1/info answer
  seedHeight: number | null;     // snapshot height (once the seed is loaded)
  observedAt: number | null;     // local ms when `height` was first seen
  checkedAt: number | null;      // local ms of the last successful poll
  online: boolean;
}

export type TxBoxRole = "reserve-in" | "reserve-out" | "tracker" | "payout" | "fee" | "change" | "funding" | "other";

export interface TxBoxView {
  boxId: Hex;
  value: bigint;
  address: Address;
  creationHeight: number;
  templateHash: Hex;
  contract: ContractView | null;
  role: TxBoxRole;
  registers: BasisRegisters;
  tokens: TokenAmount[];
  spentTx: Hex | null;
}

export interface TxDetail {
  id: Hex;
  height: number;
  timestamp: number;
  size: number | null;
  confirmations: number | null;
  kind: "redemption" | "top-up" | "refund-init" | "refund-complete" | "creation" | "other";
  inputs: TxBoxView[];
  dataInputs: TxBoxView[];
  outputs: TxBoxView[];
  reserveIn: TxBoxView | null;
  reserveOut: TxBoxView | null;
  tracker: TxBoxView | null;
  amount: { unit: "erg" | Hex; raw: bigint } | null;
  receiver: Address | null;
  fee: bigint | null;
  trackerAge: number | null;
  emergencyWindow: boolean | null;
}

export interface BoxDetail {
  boxId: Hex;
  tx: Hex;
  value: bigint;
  creationHeight: number;
  address: Address;
  addressMatches: boolean;       // address derived from the ErgoTree equals the API's address
  ergoTree: Hex;
  tree: { header: string; version: number; hasSize: boolean; segregated: boolean; bytes: number; constants: { type: string; display: string }[]; templateBytes: number } | null;
  treeError: string | null;
  templateHash: Hex | null;      // SHA-256 of the template bytes (WebCrypto)
  contract: ContractView | null; // registry match by template hash
  p2pkKey: Hex | null;           // when the box is a plain P2PK box
  registers: { name: "R4" | "R5" | "R6" | "R7" | "R8" | "R9"; hex: Hex; decoded: DecodedConstant }[];
  basis: BasisRegisters;
  role: "reserve" | "tracker" | "other";
  owner: { key: Hex; addr: Address } | null;   // P2PK of R4 when R4 is a key
  tokens: TokenAmount[];
  spentTx: Hex | null;
}
