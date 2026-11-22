// Constants pinned in the app (design Appendix A). The tracker's answers are cross-checks; these are the truth.
// Every value here is checked against mainnet transactions in constants.test.ts.
import { OUR_TRACKER } from "../../chain/ours/types";
import { EMPTY_AVL_DIGEST_HEX, basisAvlRegister } from "../../protocol/registers";
import { p2pkKeyOf, p2sAddress } from "./address";
import type { Hex } from "./model";

/**
 * The ERG reserve contract (basis.es) as the live tracker serves it (GET /config/reserve-contract-p2s) and as every
 * reserve of our tracker sits on chain: 764 bytes, header 0x1b (ErgoTree v3, size, constant segregation).
 * First on chain in T1 5b88633e…f518 (block 1 922 314).
 */
export const RESERVE_TREE_HEX: Hex =
  "1bf90521041404140402050004000400041004200500040004420400040004000410050004420500040004420442010104e0210500040205" +
  "00058084af5f04040500040605000480a3050100d807d6017ee4e3000204d6029d72017300d603c2a7d604e4c6a70407d605b2a59e720173" +
  "0100d606edededed93b1b5a4d9010663eded93c272067203e6c67206040793e4c6720604077204730293c27205720393db63087205db6308" +
  "a793e4c672050407720493e4c67205060ee4c6a7060ed607e5c6a707057303959372027304d816d608b2db6501fe730500d609e4c6a7060e" +
  "d60adb07027204d60be4e30107d60ccbb3720adb0702720bd60de4e30305d60ee4e30405d60fe3070ed610e6720fd6117a720ed612957210" +
  "7cb4e4dc640ae4c6a7056402720ce4720f730673077308d61399c1a7c17205d6148602720cb372117a9a72127213d615e4e3050ed616db6a" +
  "01ddd617e4e3020ed618b472177309730ad619b3b3b3720c7a720d72117209d61ae4e3060ed61bb1721ad61c91721b730bd61de4c6720804" +
  "07ea02d1ededededededed7206938cb2db63087208730c00017209937ce4dc640ae4c67208056402720ce4e3080e720d92720e9572107cb4" +
  "e4dc640ae4c6a7056402720ce4720f730d730e730f93957210e4dc6410e4c6a705640283013c0e0e72147215e4dc640ce4c6a70564028301" +
  "3c0e0e72147215e4c672050564939f72167bb472177310b17217a0ee72189f72047bcbb3b372187219720aeded917213731190721399720d" +
  "721295721c95721cd801d61eb4721a73127313939f72167bb4721a7314721ba0ee721e9f721d7bcbb3b3721e7219db0702721d73159199a3" +
  "8cc7720801731693e5c67205070573177207cd720b959372027318d1ededed720693e4c672050564e4c6a7056493e5c67205070573197207" +
  "9299c17205c1a7731a95937202731bea02d1edededed720692c17205c1a793e4c672050564e4c6a7056492e4c6720507057ea30593720773" +
  "1ccd720495937202731dea02d1ed917207731e927ea3059a72077e731f05cd7204d17320";

/** The tree template hash of RESERVE_TREE_HEX (/v1 lists reserves under it: byErgoTreeTemplateHash). */
export const RESERVE_TEMPLATE_HASH = "6e7d9a0e012e556d78a84cb373eca1b279695e7b48731b9158fd0ddd3faeff01";

/** SHA-256 and blake2b256 of RESERVE_TREE_HEX (design Appendix A). */
export const RESERVE_TREE_SHA256 = "760b84d23538708f9997f5598f02bdc7e3b90d4d52f47d5ab3744aa71cdae4f6";
export const RESERVE_TREE_BLAKE2B256 = "fe185cf083caa6a1027369f117d5a2c74ebcaabafe514dac0093c62cc3b212f8";
export const RESERVE_TREE_BYTES = 764;

let reserveP2S: string | null = null;
/** The reserve contract's mainnet P2S address (base58 of 768 bytes, computed once). */
export function reserveAddress(): string {
  return (reserveP2S ??= p2sAddress(RESERVE_TREE_HEX));
}

/** The standard miner-fee contract (P2S 2iHkR7CW…). */
export const FEE_TREE_HEX: Hex =
  "1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701" +
  "730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304";

/** Our tracker's NFT: token 0 of the tracker box, R6 of every reserve bound to it, the last 32 bytes of every note. */
export const TRACKER_NFT: Hex = OUR_TRACKER.nft;

/** Our tracker's key, from its P2PK address. It must equal R4 of the tracker box (checked on every redemption). */
export const TRACKER_PK: Hex = p2pkKeyOf(OUR_TRACKER.address);

/** R5 of a new reserve: the empty AVL+ tree, insert and update allowed, 32-byte keys, values of any length. */
export const EMPTY_RESERVE_R5: Hex = basisAvlRegister(EMPTY_AVL_DIGEST_HEX);
/** R7 of a new reserve: Long 0, no refund started. */
export const R7_NO_REFUND: Hex = "0500";

/** The P2PK ErgoTree of a key: 0008cd ‖ pk. */
export function p2pkTree(pk: Hex): Hex {
  if (!/^0[23][0-9a-f]{64}$/.test(pk)) throw new Error("P2PK needs a 33-byte compressed key (lowercase hex)");
  return `0008cd${pk}`;
}

/** The key of a P2PK ErgoTree, or null for any other tree. */
export function p2pkKeyOfTree(tree: Hex): Hex | null {
  return /^0008cd0[23][0-9a-f]{64}$/.test(tree) ? tree.slice(6) : null;
}

// ─── amounts (nanoERG) ──────────────────────────────────────────────────────────────────────────

export const NANOERG_PER_ERG = 1_000_000_000n;
/** Our floor for every box we create or accept as a result (payout, change, reserve after a redemption): 0.001 ERG. */
export const MIN_BOX_NANOERG = 1_000_000n;
/** A redemption's miner fee comes out of the payout; we sign at most this fee (the canary's --max-fee-nano). */
export const REDEEM_MAX_FEE_NANOERG = 1_000_000n;
/** The miner fee range we accept from POST /reserves/create (openapi example 1 100 000). */
export const T1_FEE_MIN_NANOERG = 1_000_000n;
export const T1_FEE_MAX_NANOERG = 2_000_000n;
/** The miner fee of our own P2PK transactions (withdraw, and T1 when the tracker asks for the minimum). */
export const MINER_FEE_NANOERG = 1_000_000n;
/** Our floor against dust reserves (the contract sets none). */
export const RESERVE_MIN_NANOERG = 100_000_000n;
/** Beta caps (D5): 1 ERG by default; up to 10 ERG (the tracker's own cap) only after an explicit "I understand". */
export const RESERVE_DEFAULT_CAP_NANOERG = 1n * NANOERG_PER_ERG;
export const RESERVE_HARD_CAP_NANOERG = 10n * NANOERG_PER_ERG;

// ─── protocol ───────────────────────────────────────────────────────────────────────────────────

/** Context var #0 of the reserve: action × 10 + the index of the reserve's own output. */
export const ACTION_REDEEM = 0;
export const ACTION_TOP_UP = 10;
export const ACTION_REFUND_START = 20;
export const ACTION_REFUND_COMPLETE = 30;

/** `fee_paid_by` of an ERG redemption build (round 4): the miner fee comes out of the payout. */
export const FEE_PAID_BY_RECIPIENT = "recipient";
/** A build is single use and expires after 30 minutes (PENDING_REDEMPTION_TTL). */
export const BUILD_TTL_MS = 30 * 60_000;
/** request_timestamp must be within 120 s of the tracker's clock (BUILD_REQUEST_MAX_SKEW_MS). */
export const BUILD_REQUEST_MAX_SKEW_MS = 120_000;

/** Front body caps: POST /redemption/submit ≤ 64 KB; POST /node/transactions ≤ 16 KB (D1). */
export const SUBMIT_BODY_MAX_BYTES = 64 * 1024;
export const BROADCAST_BODY_MAX_BYTES = 16 * 1024;
