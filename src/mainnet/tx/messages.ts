// The two messages a mainnet key signs with a Basis Schnorr signature (not ProveDlog), byte-exact with basis_core
// `signing_message` and `build_request_message` (worked examples in messages.test.ts):
//
//   note (80 bytes):           debtKey(32) ‖ totalDebt u64 BE ‖ timestamp ms u64 BE ‖ tracker NFT(32)
//                              debtKey = blake2b256(issuer ‖ recipient) for ERG (‖ tokenId for a token)
//   build request (131, ERG):  "basis-build-v1" ‖ tracker NFT(32) ‖ issuer(33) ‖ recipient(33) ‖ "erg" ‖ amount u64 BE
//                              ‖ request_timestamp ms u64 BE        ("token:<64 hex>" instead of "erg": 198 bytes)
//
//   inbox (87 bytes):          "basis-inbox-v1" ‖ tracker NFT(32) ‖ recipient(33) ‖ valid_until unix seconds u64 BE
//                              (basis_core `inbox_request_message`: GET /notes/recipient/{key} in one call, for the
//                              key's holder, on the tracker of that NFT only)
//
// The issuer signs the note; the tracker signs the same 80 bytes (context var #6); the recipient signs the build
// request and the inbox request. Signatures use the protocol engine's signer (deterministic nonces, retried until the
// contract can read them). The three never coincide: 80, 131/198 and 87 bytes, and the two tagged ones differ at byte 6.
import { bytesToBig, bytesToHex, concatBytes, hexToBytes, I64_MAX, u64be, utf8 } from "../../protocol/bytes";
import { debtKey } from "../../protocol/note";
import { sign, verify } from "../../protocol/schnorr";
import type { Hex } from "./model";

export const BUILD_REQUEST_DOMAIN = "basis-build-v1";
export const NOTE_MESSAGE_BYTES = 80;
export const BUILD_REQUEST_ERG_BYTES = 131;

export type Denomination = "erg" | `token:${string}`;

function key33(h: Hex, what: string): Uint8Array {
  if (!/^0[23][0-9a-f]{64}$/.test(h)) throw new Error(`${what} must be a 33-byte compressed key in lowercase hex`);
  return hexToBytes(h);
}

function id32(h: Hex, what: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(h)) throw new Error(`${what} must be 32 bytes of lowercase hex`);
  return hexToBytes(h);
}

function u64(v: bigint, what: string): Uint8Array {
  if (v < 0n || v > (1n << 64n) - 1n) throw new RangeError(`${what} is not a u64`);
  return u64be(v);
}

export interface NoteFields {
  issuer: Hex;
  recipient: Hex;
  /** Cumulative debt, nanoERG (or token units). */
  totalDebt: bigint;
  /** Milliseconds since the epoch. */
  timestamp: bigint;
  trackerNft: Hex;
  denomination?: Denomination;
}

/** The 80-byte note message. The contract reads both numbers as signed Longs, so each must be ≤ 2^63 − 1. */
export function noteMessage(n: NoteFields): Uint8Array {
  if (n.totalDebt < 0n || n.totalDebt > I64_MAX || n.timestamp < 0n || n.timestamp > I64_MAX) throw new RangeError("total and timestamp must be within 0 … 2^63 − 1");
  const denom = n.denomination ?? "erg";
  return concatBytes(debtKey(key33(n.issuer, "issuer"), key33(n.recipient, "recipient"), denom === "erg" ? null : denom), u64be(n.totalDebt), u64be(n.timestamp), id32(n.trackerNft, "tracker NFT"));
}

export interface BuildRequestFields {
  trackerNft: Hex;
  issuer: Hex;
  recipient: Hex;
  denomination?: Denomination;
  /** What the reserve gives (the payout is this minus the miner fee). */
  amount: bigint;
  requestTimestamp: bigint;
}

/** The build-request message: 131 bytes for ERG. */
export function buildRequestMessage(r: BuildRequestFields): Uint8Array {
  const denom = r.denomination ?? "erg";
  if (denom !== "erg" && !/^token:[0-9a-f]{64}$/.test(denom)) throw new Error("denomination must be \"erg\" or \"token:<64 hex>\"");
  return concatBytes(
    utf8(BUILD_REQUEST_DOMAIN),
    id32(r.trackerNft, "tracker NFT"),
    key33(r.issuer, "issuer"),
    key33(r.recipient, "recipient"),
    utf8(denom),
    u64(r.amount, "amount"),
    u64(r.requestTimestamp, "request_timestamp"),
  );
}

export const INBOX_DOMAIN = "basis-inbox-v1";
export const INBOX_MESSAGE_BYTES = 87;
/** The tracker refuses a valid_until more than this far ahead (crates/basis_server/src/inbox.rs). */
export const INBOX_MAX_AHEAD_S = 86_400;

/** The inbox request message: always 87 bytes. `validUntil` is unix seconds; `trackerNft` names the one tracker that
 *  takes it. */
export function inboxMessage(trackerNft: Hex, recipient: Hex, validUntil: bigint): Uint8Array {
  return concatBytes(utf8(INBOX_DOMAIN), id32(trackerNft, "tracker NFT"), key33(recipient, "recipient"), u64(validUntil, "valid_until"));
}

/** What the inbox headers carry: X-Basis-Inbox-Until (decimal seconds) and X-Basis-Inbox-Sig (130 hex). */
export interface InboxToken { until: string; sig: Hex }

/**
 * Signs the inbox request of `pub` (the key that owns `secret`) for the tracker of `trackerNft`, valid until
 * `validUntil` (unix seconds, later than 0). Call it inside the vault's withSecret("inbox") callback; it returns only
 * the token, never the secret.
 */
export function signInbox(secret: Uint8Array, pub: Hex, trackerNft: Hex, validUntil: bigint): InboxToken {
  if (validUntil <= 0n) throw new RangeError("valid_until must be later than 0");
  return { until: validUntil.toString(), sig: bytesToHex(signBasis(inboxMessage(trackerNft, pub, validUntil), secret, pub)) };
}

/** A Basis Schnorr signature a(33) ‖ z(32) with the 32-byte secret; verified before it is returned. */
export function signBasis(message: Uint8Array, secret: Uint8Array, pub: Hex): Uint8Array {
  if (secret.length !== 32) throw new Error("the secret key must be 32 bytes");
  const sig = sign(message, bytesToBig(secret));
  const v = verify(pub, message, sig);
  if (!v.ok) throw new Error(`the signature does not verify under ${pub}: ${v.message}`);
  return sig;
}

/** Verifies a Basis Schnorr signature exactly as the tracker does (65 bytes, top-bit rules, g^z = a·x^e). */
export function verifyBasis(pub: Hex, message: Uint8Array, signature: Hex | Uint8Array): boolean {
  return verify(pub, message, signature).ok;
}
