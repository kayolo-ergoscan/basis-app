// src/chain — mainnet observatory: seed (scripts/make-seed.mjs → seed.json, lazy) + live /v1 polling within a strict
// request budget, decoders, exit assessment, hooks. Read CHAIN_API.md first.
export * from "./types";
export {
  // constants
  EMERGENCY_BLOCKS, REFUND_BLOCKS, BLOCK_SECONDS, EMPTY_DIGEST, USE_TOKEN_ID, USE_LOOKALIKE_ID, CURRENT_TEMPLATES, FEE_TREE_PREFIX,
  // bytes, numbers
  hexToBytes, bytesToHex, isHex, shortHex, fmtInt, formatUnits, readVlq, unzigzag, blake2b256,
  // registers
  decodeConstant, typeName, regHex, decodeGroupElementRegister, decodeAvlTreeRegister, decodeNftRegister, decodeLongRegister,
  decodeBasisRegisters, avlInfo, toSeedAvl,
  // addresses
  base58Encode, base58Decode, p2pkAddress, p2sAddress, addressOfErgoTree, p2pkKeyOfTree, parseAddress,
  // trees
  parseErgoTree, templateHash, templateHashSync, avlOpsOfTemplate, basisParams,
  // meaning
  tokenKind, emergencyClock, refundClock, blocksToApprox, assessExit, describeExit, EXIT_LABEL,
} from "./decode";
export type { Network, ParsedAddress, ParsedErgoTree, SigmaPropValue, TrackerLookup, ExitInput } from "./decode";
export { createChainApi, chainApi, ChainApiError, paths, CHAIN_BUDGET } from "./api";
export type { ChainApi, ChainApiConfig, ChainApiErrorKind, GetOptions, Lane, RequestLogEntry } from "./api";
export { buildObservatory, interpretTx, boxDetail, liveBoxFromApi, contractIndex, contractOf, trackerLookup, liveTrackerLookup, emptyLive, decodeBeats, tokenAmount } from "./model";
export { chain, createChainStore, INTERVALS } from "./store";
export type { ChainState, ChainStore, ChainStoreOptions, Fetched } from "./store";
export { useHeight, getHeight, useObservatory, useChainStatus, useReserve, useTracker, useRedemption, useDetector, useBox } from "./hooks";
export type { HeightState, ReserveResult, TrackerResult, RedemptionResult, BoxResult } from "./hooks";
export { explorer, explorerLink, EXPLORER_ORIGIN } from "./links";
export type { ExplorerKind } from "./links";
// our tracker on mainnet (read-only, `/api/tracker/*`)
export * from "./ours";
