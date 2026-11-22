// src/chain/ours — our Basis tracker on Ergo mainnet (ErgoScan, beta since 2026-11-22), read-only.
// Shapes of its public API (`/api/tracker/*`, same origin: Caddy in production, the Vite proxy in dev, both in front of
// the nginx front that adds the key, opens only the routes it lists and limits each IP; since phase 2 that includes the
// note and redemption routes, which this client does not call) and the parsed models the pages use. Amounts are exact
// bigints; the API sends them as JSON numbers, so the client quotes them before parsing.
import type { Hex } from "../types";

/** Facts about the tracker we run, all checkable on the chain (mint and first box are in TRACKER.md and on Ergo). */
export const OUR_TRACKER = {
  nft: "f5178dc4063042bdf77cd0f4a55d0893d6dbcf0b3d14eb4de25282b2c4e3f29f",
  /** P2PK address of the tracker key: holds the tracker box and the commit-fee funds. */
  address: "9gMR2WENikwx6iwdLY6VYxPjff2gLZGScweKg53gXp31cR8hW3W",
  mintTx: "0841b4425b8b54fb33faf31983e1ade474774a000b96faf4302b0b26db697969",
  mintHeight: 1_922_275,
  firstBox: "2af09409e39799eb39e90f3c126d7a0dd2cfa98743d25cc2076fcbabe87ca345",
  /** Owner key (R4) of ErgoScan's own test reserve from the closed test of 22 Nov 2026 (P2PK 9euZX3…4e5U). Pages tag a
   *  reserve "ErgoScan test reserve" only on this exact key. */
  testReserveOwner: "023316d27ad52bd767e5e97e2ecba3f0dbc2f92095875f918fcaa95ae6711b1207",
} as const;

/** Polling and budget. ≤ 1 request per second per visitor; nothing while the tab is hidden. */
export const OURS_POLL = {
  stateMs: 30_000,          // GET /tracker/state
  reservesMs: 120_000,      // GET /reserves
  feesMs: 30 * 60_000,      // /v1 fee funds at the tracker address (through the chain budget), plus once after each commit
  minGapMs: 1_000,          // request starts at least 1 s apart (key lookups share the gap)
  timeoutMs: 10_000,
  backoffBaseMs: 30_000,    // first wait after a failed poll; doubles per failure
  backoffMaxMs: 10 * 60_000,
} as const;

/** Fee money at the tracker address: its confirmed, unspent, token-free boxes. The box that holds the tracker NFT is not
 *  fee money. `partial`: the address held more boxes than one page, so `nano` is a lower bound. */
export interface FeeFunds { nano: bigint; boxes: number; partial: boolean }

/** The tracker re-commits every 720 blocks when nothing changes (heartbeat). Older than that plus some slack = stale. */
export const HEARTBEAT_BLOCKS = 720;
/** Slack for the 600 s updater cycle and the confirmation depth (≈ 1 hour). A product choice, not a contract rule. */
export const STALE_SLACK_BLOCKS = 30;
export const STALE_AFTER_BLOCKS = HEARTBEAT_BLOCKS + STALE_SLACK_BLOCKS;

/** key-status answers 999999.0 when an issuer has no debt in a denomination: there is no ratio to show. */
export const NO_DEBT_RATIO = 999_999;

// ─── raw API shapes (after the client quoted the u64 amounts) ─────────────────────────────────────

export interface ApiEnvelope<T> { success: boolean; data: T | null; error: string | null }

export interface ApiTrackerState {
  local_digest: string;
  confirmed_digest: string | null;
  confirmed_box_id: string | null;
  /** creationHeight of the confirmed tracker box: the contract's emergency clock counts from it. */
  confirmed_height: number | null;
  pending_digest: string | null;
  pending_tx_id: string | null;
  pending_submitted_height: number | null;
  tracker_box_id: string | null;
}

export interface ApiReserve {
  box_id: string;
  owner_pubkey: string;
  collateral_amount: string;
  total_debt: string;
  tracker_nft_id: string;
  reserve_token_id?: string;
  last_updated_height: number;
  last_updated_timestamp: number;
  collateralization_ratio: number;
  refund_initiation_height: number;
}

export interface ApiKeyDenomination {
  denomination: string;
  symbol: string;
  decimals: number;
  total_debt: string;
  collateral: string;
  collateralization_ratio: number;
  note_count: number;
  reserve_box_id?: string;
  has_pending_refund: boolean;
}

export interface ApiKeyStatus {
  issuer_pubkey: string;
  note_count: number;
  last_updated: number;
  has_pending_refund: boolean;
  denominations: ApiKeyDenomination[];
}

export interface ApiCollateralConfig {
  erg_contract_p2s: string;
  token_contract_p2s: string;
  tokens: unknown[];
  denominations: { id: string; symbol: string; decimals: number }[];
}

// ─── parsed models ────────────────────────────────────────────────────────────────────────────────

export interface TrackerState {
  /** Digest of the tracker's live tree (may run ahead of the committed one). */
  localDigest: Hex;
  confirmedDigest: Hex | null;
  confirmedBox: Hex | null;
  /** creationHeight of the confirmed tracker box. */
  confirmedHeight: number | null;
  /** A commit transaction in flight, or null. */
  pending: { tx: Hex; digest: Hex | null; height: number | null } | null;
  trackerBox: Hex | null;
}

export interface TrackedReserve {
  box: Hex;
  owner: Hex;
  collateral: bigint;
  debt: bigint;
  nft: Hex;
  /** Token id of a token reserve; null for an ERG reserve. */
  token: Hex | null;
  updatedHeight: number;
  /** The tracker's own timestamp for the last update (as it sends it). */
  updatedAt: number;
  /** collateral ÷ debt as the tracker computes it; null when there is no debt. */
  ratio: number | null;
  /** R7: 0 = no refund started. */
  refundHeight: number;
}

export interface ReservesAnswer {
  list: TrackedReserve[];
  /** Entries the app could not read (skipped, never guessed). */
  invalid: number;
}

export interface KeyDenomination {
  id: string;
  symbol: string;
  decimals: number;
  debt: bigint;
  collateral: bigint;
  /** null when there is no debt (the API's 999999 sentinel). */
  ratio: number | null;
  notes: number;
  reserve: Hex | null;
  pendingRefund: boolean;
}

export interface KeyStatus {
  key: Hex;
  notes: number;
  lastUpdated: number;
  pendingRefund: boolean;
  denominations: KeyDenomination[];
}

export interface CollateralConfig {
  ergP2s: string;
  tokenP2s: string;
  denominations: { id: string; symbol: string; decimals: number }[];
}

/** A change seen between two answers in this session. Nothing else becomes an event. */
export type OurEvent =
  | { id: string; kind: "commit"; at: number; box: Hex; digest: Hex | null; height: number | null; heartbeat: boolean }
  | { id: string; kind: "reserve"; at: number; box: Hex; owner: Hex; collateral: bigint; token: Hex | null; height: number };
