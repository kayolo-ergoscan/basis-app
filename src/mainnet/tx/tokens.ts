// Token reserves (tracker contract/basis-token.es): the pinned token contract, the two tokens this wallet takes as a
// reserve, and their beta caps. One place for every token constant (task brief, "Decide and document" 3).
//
// A token reserve box (the tracker's multi-collateral layout, ergo_scanner.rs parse_reserve_box):
//   value   TOKEN_RESERVE_BOX_NANOERG (0.002 ERG: the box's own minimum, and the completion's miner fee comes from it)
//   tokens  [reserve NFT (= the T1's first input id) × 1, the reserve token × amount]  (exactly two)
//   R4–R7   as an ERG reserve: owner, AvlTree, our tracker NFT, refund height
// The denomination of a reserve is its tokens(1) id; of a note, "token:<id>" (messages.ts).
import { RSADA, SIGUSD } from "../../chain/reserveTokens";
import { p2sAddress } from "./address";
import { RESERVE_TREE_HEX } from "./constants";
import type { Denomination } from "./messages";
import type { ErgoBox, Hex } from "./model";

/**
 * basis-token.es as the tracker compiles it (contract_compiler.rs get_basis_token_reserve_ergo_tree_hex, branch
 * ergoscan 86bcdc8): 910 bytes, header 0x1b. The live tracker refuses to start unless its configured
 * `basis_token_reserve_contract_p2s` is this tree (validate_startup); GET /config/reserve-collateral serves its P2S.
 */
export const TOKEN_RESERVE_TREE_HEX: Hex =
  "1b8b072a04140414040004020404040004000402040205000400040004100420050004020400044204000400040004100500044205000400" +
  "04420442010104e02105000402050004020502040404020500040605000480a3050100d80fd6017ee4e3000204d6029d72017300d603b2a5" +
  "9e7201730100d604db63087203d605db6308a7d606b27205730200d607b27205730300d6088c720701d609ededed93b172047304938cb272" +
  "04730500018c720601938cb27204730600028c720602938cb27204730700017208d60ac2a7d60be4c6a70407d60cededed93b1b5a4d9010c" +
  "63eded93c2720c720ae6c6720c040793e4c6720c0407720b730893c27203720a93e4c672030407720b93e4c67203060ee4c6a7060ed60d92" +
  "c17203c1a7d60e8c720702d60fe5c6a70705730995937202730ad818d610b2db6501fe730b00d611e4c6a7060ed612db0702720bd613e4e3" +
  "0107d614b37212db07027213d615cbb372147208d616e4e30305d617e4e30405d618e3070ed619e67218d61acb7214d61b7a7217d61c9572" +
  "197cb4e4dc640ae4c6a7056402721ae47218730c730d730ed61d99720e8cb27204730f0002d61e8602721ab3721b7a9a721c721dd61fe4e3" +
  "050ed620db6a01ddd621e4e3020ed622b4722173107311d623b3b3b372157a7216721b7211d624e4e3060ed625b17224d6269172257312d6" +
  "27e4c672100407ea02d1ededededededededed720c7209720d938cb2db63087210731300017211937ce4dc640ae4c672100564027215e4e3" +
  "080e72169272179572197cb4e4dc640ae4c6a7056402721ae4721873147315731693957219e4dc6410e4c6a705640283013c0e0e721e721f" +
  "e4dc640ce4c6a705640283013c0e0e721e721fe4c672030564939f72207bb472217317b17221a0ee72229f720b7bcbb3b3722272237212ed" +
  "ed91721d731890721d997216721c957226957226d801d628b472247319731a939f72207bb47224731b7225a0ee72289f72277bcbb3b37228" +
  "7223db07027227731c9199a38cc7721001731d93e5c672030705731e720fcd721395937202731fd1ededededed720c7209720d93e4c67203" +
  "0564e4c6a7056493e5c6720307057320720f92998cb2720473210002720e7322959372027323ea02d1edededededed720c7209928cb27204" +
  "73240002720e720d93e4c672030564e4c6a7056492e4c6720307057ea30593720f7325cd720b959372027326ea02d1ed91720f7327927ea3" +
  "059a720f7e732805cd720bd17329";

/** The tree template hash of TOKEN_RESERVE_TREE_HEX (/v1 lists token reserves under it; chain/decode CURRENT_TEMPLATES.multiToken). */
export const TOKEN_RESERVE_TEMPLATE_HASH = "8699a5572dd93d3fc1d6b33157d26bb1451c4cdd4e969e6e08e50b18e32f4feb";
export const TOKEN_RESERVE_TREE_SHA256 = "f542a96a7958d333ac593ce434ff4c81306caffaba14860eafd7795a4d78cfd2";
export const TOKEN_RESERVE_TREE_BYTES = 910;

let tokenP2S: string | null = null;
/** The token reserve contract's mainnet P2S address (8LeDK9…, 1249 characters). */
export function tokenReserveAddress(): string {
  return (tokenP2S ??= p2sAddress(TOKEN_RESERVE_TREE_HEX));
}

// ─── ERG a token reserve needs ──────────────────────────────────────────────────────────────────

/**
 * The ERG a new token reserve box carries (decision 2): 0.002 ERG. It is above the tracker's floor for a token reserve
 * box (MIN_RESERVE_REMAINDER, 0.001 ERG) and above the node's minimum for any box up to 4096 bytes (360 nanoERG per
 * byte: 0.00147 ERG); the refund completion pays its 0.001 ERG miner fee from it and still hands the owner a 0.001 ERG
 * box with the tokens. It comes back with the refund. basis-token.es never lets a redemption take ERG out.
 */
export const TOKEN_RESERVE_BOX_NANOERG = 2_000_000n;
/** A token redemption's miner fee is paid by the tracker's own fee boxes (fee_paid_by "tracker"): never by the
 *  recipient. The wallet still refuses a build whose fee is above this (the tracker's 0.001 ERG plus any dust change it
 *  folds into the fee). */
export const TOKEN_REDEEM_MAX_FEE_NANOERG = 2_000_000n;
/** The ERG of the recipient's box in a token redemption: 0.001 ERG, from the tracker's fee boxes
 *  (TOKEN_RECIPIENT_MIN_VALUE_NANOERG). It carries the redeemed tokens. */
export const TOKEN_RECIPIENT_BOX_NANOERG = 1_000_000n;
/** `fee_paid_by` of a token redemption build. */
export const FEE_PAID_BY_TRACKER = "tracker";

// ─── the tokens ─────────────────────────────────────────────────────────────────────────────────

export interface ReserveToken {
  /** The token id (lowercase hex). */
  id: Hex;
  /** As people say it. */
  symbol: string;
  /** Pinned here, never read from the tracker or a token's registers. */
  decimals: number;
  /** Raw units in one whole token (10^decimals). */
  one: bigint;
  /** Our floor for a new reserve and for one top-up, raw units (1 whole token: no dust reserves). */
  min: bigint;
  /** Beta caps (decision 3), raw units: the reserve's default cap, and the most after an explicit "I understand". */
  defaultCap: bigint;
  hardCap: bigint;
}

const token = (id: Hex, symbol: string, decimals: number, defaultCap: bigint, hardCap: bigint): ReserveToken => {
  const one = 10n ** BigInt(decimals);
  return { id, symbol, decimals, one, min: one, defaultCap: defaultCap * one, hardCap: hardCap * one };
};

/** The ids, symbols and decimals are pinned once in chain/reserveTokens.ts (the Network pages read the same table). */
export const SIGUSD_TOKEN_ID: Hex = SIGUSD.id;
export const RSADA_TOKEN_ID: Hex = RSADA.id;

/** SigUSD (2 decimals): default 5, at most 25. rsADA (6 decimals): default 10, at most 50. Whole tokens. */
export const RESERVE_TOKENS: readonly ReserveToken[] = [
  token(SIGUSD.id, SIGUSD.symbol, SIGUSD.decimals, 5n, 25n),
  token(RSADA.id, RSADA.symbol, RSADA.decimals, 10n, 50n),
];

/** One of our two tokens by id (exact, lowercase), or null. */
export const reserveTokenById = (id: string): ReserveToken | null => RESERVE_TOKENS.find((t) => t.id === id) ?? null;

/** Every denomination this wallet makes reserves in, ERG first. */
export const WALLET_DENOMS: readonly Denomination[] = ["erg", ...RESERVE_TOKENS.map((t) => `token:${t.id}` as const)];

export const denomOfToken = (t: ReserveToken): Denomination => `token:${t.id}`;

/** The token of a denomination: null for ERG; undefined for a token this wallet does not know (refuse it). */
export function reserveTokenOf(d: Denomination | string): ReserveToken | null | undefined {
  if (d === "erg") return null;
  const m = /^token:([0-9a-f]{64})$/.exec(d);
  return m ? reserveTokenById(m[1]) ?? undefined : undefined;
}

/** A denomination this wallet knows: "erg" or one of RESERVE_TOKENS. */
export const isWalletDenom = (d: string): d is Denomination => reserveTokenOf(d) !== undefined;

/** The token id of a denomination (null for ERG). */
export const tokenIdOf = (d: Denomination): Hex | null => (d === "erg" ? null : d.slice(6));

/** The short name in links (`?d=sigusd`): "erg", "sigusd", "rsada". */
export const denomSlug = (d: Denomination): string => (d === "erg" ? "erg" : (reserveTokenOf(d)?.symbol ?? "token").toLowerCase());
export function denomOfSlug(s: string | null | undefined): Denomination | null {
  const v = (s ?? "").trim().toLowerCase();
  if (v === "" || v === "erg") return v === "erg" ? "erg" : null;
  const t = RESERVE_TOKENS.find((x) => x.symbol.toLowerCase() === v);
  return t ? denomOfToken(t) : null;
}

/** The unit of a denomination as people read it: "ERG", "SigUSD", "rsADA". */
export const denomSymbol = (d: Denomination): string => (d === "erg" ? "ERG" : reserveTokenOf(d)?.symbol ?? "?");
/** Its decimals: 9 for ERG. */
export const denomDecimals = (d: Denomination): number => (d === "erg" ? 9 : reserveTokenOf(d)?.decimals ?? 0);

/**
 * The denomination a box holds as a reserve, from its tree and tokens alone (nothing else is checked here: readReserve
 * does that): the ERG tree with one token → "erg"; the token tree with exactly two tokens, the second one of ours →
 * that token; anything else → null.
 */
export function reserveDenomOfBox(box: Pick<ErgoBox, "ergoTree" | "tokens">): Denomination | null {
  if (box.ergoTree === RESERVE_TREE_HEX) return box.tokens.length === 1 ? "erg" : null;
  if (box.ergoTree !== TOKEN_RESERVE_TREE_HEX || box.tokens.length !== 2) return null;
  const t = reserveTokenById(box.tokens[1].tokenId);
  return t ? denomOfToken(t) : null;
}

/** The reserve contract of a denomination: basis.es for ERG, basis-token.es for a token. */
export const reserveTreeOf = (d: Denomination): Hex => (d === "erg" ? RESERVE_TREE_HEX : TOKEN_RESERVE_TREE_HEX);
