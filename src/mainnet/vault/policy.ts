// When the vault asks for the passphrase again (design §4.2; keys review P1-2; operator decision 2, 22 Nov 2026). The
// vault enforces it itself, so no screen can sign around it:
//   • t1 (a reserve creation moves the whole reserve) and export-hex: always;
//   • withdraw: whenever the transaction pays anything but this key's own address and at most the wallet's miner fee
//     (combining small boxes, or cancelling a stuck transaction, back to the key itself needs none);
//   • note: when the notes signed since the last passphrase entry, this one included, promise more than 25 % of the
//     reserve's value read on chain (/v1, never the tracker's figure). A note promises its increment: the new total
//     minus the pair's previous total, which must be a note of this key (its signature is checked here);
//   • redeem and build-request: never (a redemption pays only this key: its signed outputs are checked, below).
// "Since the last passphrase entry" = since the session opened (an unlock is a passphrase entry) or since the last use
// of the key with the passphrase typed again. The count lives in the session only.
import { FEE_TREE_HEX, MINER_FEE_NANOERG, REDEEM_MAX_FEE_NANOERG, RESERVE_TREE_HEX, TRACKER_NFT } from "../tx/constants";
import { asArray, asObject, asString, asU64, member, parseJson, type JsonObject } from "../tx/json";
import { noteMessage, verifyBasis } from "../tx/messages";
import { VaultError } from "./errors";
import { isObject } from "./record";
import type { Hex } from "./keys";

/** More than 1/4 of the reserve needs the passphrase. */
export const NOTE_PASSPHRASE_DIVISOR = 4n;

/** What a note to sign promises, declared before the key is touched (checked against the signed body afterwards). */
export interface NoteIntent {
  recipient: Hex;
  /** The new cumulative total, nanoERG. */
  total: bigint;
  /** The issuer's reserve value read on chain (/v1), nanoERG; 0 when none is known (then the passphrase is asked). */
  reserveValue: bigint;
  /** The pair's previous note as the tracker stores it, signed by this key; null for the pair's first note. */
  prev: { total: bigint; timestamp: bigint; signature: Hex } | null;
}

/** One pair's notes since the last passphrase entry: its total before the first of them, and the highest signed. */
export interface PairPromise { base: bigint; top: bigint }

export interface NotePolicy {
  /** What this note adds: total − previous total. */
  added: bigint;
  /** Promised since the last passphrase entry, before this note. */
  since: bigint;
  /** … and with this note (a note signed again at the same total adds nothing). */
  after: bigint;
  reserveValue: bigint;
  /** The passphrase must be typed again for this note. */
  passphrase: boolean;
}

const PK = /^0[23][0-9a-f]{64}$/;
const SIG = /^[0-9a-f]{130}$/;
const I64_MAX = (1n << 63n) - 1n;

const bad = (message: string) => new VaultError("bad-input", message);

function sumPromised(m: ReadonlyMap<Hex, PairPromise>, skip?: Hex): bigint {
  let s = 0n;
  for (const [k, p] of m) if (k !== skip) s += p.top - p.base;
  return s;
}

/** The pair's promise once this note is signed. */
export function nextPromise(m: ReadonlyMap<Hex, PairPromise>, recipient: Hex, prevTotal: bigint, total: bigint): PairPromise {
  const old = m.get(recipient);
  return { base: old ? (prevTotal < old.base ? prevTotal : old.base) : prevTotal, top: old && old.top > total ? old.top : total };
}

/** True when promising `after` since the last passphrase entry needs it again (> 25 % of the reserve, or no reserve). */
export const notePassphraseNeeded = (after: bigint, reserveValue: bigint): boolean => reserveValue <= 0n || after * NOTE_PASSPHRASE_DIVISOR > reserveValue;

/**
 * The rule for one note of `issuer`, given what the session promised so far. Throws "bad-input" for an intent that is not
 * a note this key can sign: a malformed key or amount, a previous note that is not this key's own, a total not above it.
 */
export function notePolicy(issuer: Hex, intent: NoteIntent, promised: ReadonlyMap<Hex, PairPromise>): NotePolicy {
  if (!isObject(intent)) throw bad("a note needs its intent (recipient, total, reserve value, previous note)");
  const { recipient, total, reserveValue, prev } = intent;
  if (typeof recipient !== "string" || !PK.test(recipient) || recipient === issuer) throw bad("the note's recipient is not another public key");
  if (typeof total !== "bigint" || total <= 0n || total > I64_MAX) throw bad("the note's total is out of range");
  if (typeof reserveValue !== "bigint" || reserveValue < 0n) throw bad("the reserve value is out of range");
  let prevTotal = 0n;
  if (prev !== null) {
    if (!isObject(prev) || typeof prev.total !== "bigint" || typeof prev.timestamp !== "bigint" || typeof prev.signature !== "string" || !SIG.test(prev.signature)) {
      throw bad("the previous note is malformed");
    }
    let ok = false;
    try {
      ok = verifyBasis(issuer, noteMessage({ issuer, recipient, totalDebt: prev.total, timestamp: prev.timestamp, trackerNft: TRACKER_NFT }), prev.signature);
    } catch {
      ok = false;
    }
    if (!ok) throw bad("the previous note is not signed by this key");
    prevTotal = prev.total;
  }
  if (total <= prevTotal) throw bad("the new total is not above the previous note's");
  const since = sumPromised(promised);
  const p = nextPromise(promised, recipient, prevTotal, total);
  const after = sumPromised(promised, recipient) + (p.top - p.base);
  return { added: total - prevTotal, since, after, reserveValue, passphrase: notePassphraseNeeded(after, reserveValue) };
}

/** The top-level object of a signed text, read with the strict parser (exact u64s, duplicate keys refused), or null. */
function strictObject(text: string): JsonObject | null {
  try {
    return asObject(parseJson(text), "signed");
  } catch {
    return null;
  }
}

/** The signed `POST /notes` body must be the declared note of this key: its top-level fields, the amount exact. */
export function checkNoteBody(signedRaw: string, issuer: Hex, intent: NoteIntent): void {
  const o = strictObject(signedRaw);
  if (!o) throw bad("the signed note is not JSON");
  let ok = false;
  try {
    ok =
      asString(member(o, "issuer_pubkey"), "issuer_pubkey") === issuer &&
      asString(member(o, "recipient_pubkey"), "recipient_pubkey") === intent.recipient &&
      asString(member(o, "denomination"), "denomination") === "erg" &&
      asString(member(o, "tracker_nft_id"), "tracker_nft_id") === TRACKER_NFT &&
      asU64(member(o, "amount"), "amount") === intent.total;
  } catch {
    ok = false;
  }
  if (!ok) throw bad("the signed note is not the declared one");
}

/** The outputs of a signed transaction (node JSON): tree and exact value, or null when it cannot be read. */
function outputsOf(signedRaw: string): { tree: string; value: bigint }[] | null {
  const o = strictObject(signedRaw);
  if (!o) return null;
  try {
    return asArray(member(o, "outputs"), "outputs").items.map((x, i) => {
      const b = asObject(x, `outputs[${i}]`);
      return { tree: asString(member(b, "ergoTree"), `outputs[${i}].ergoTree`), value: asU64(member(b, "value"), `outputs[${i}].value`) };
    });
  } catch {
    return null;
  }
}

/**
 * True when a signed P2PK transaction (node JSON) pays only this key's own address, plus at most the wallet's miner
 * fee (MINER_FEE_NANOERG, what Withdraw, Combine and Cancel pay): a "withdraw" that does not needs the passphrase.
 */
export function paysOnlyOwnKey(signedRaw: string, pub: Hex): boolean {
  const outs = outputsOf(signedRaw);
  if (!outs || outs.length === 0) return false;
  const own = `0008cd${pub}`;
  let fee = 0n;
  for (const o of outs) {
    if (o.tree === FEE_TREE_HEX) fee += o.value;
    else if (o.tree !== own) return false;
  }
  return fee <= MINER_FEE_NANOERG;
}

/**
 * True when a signed redemption pays this key: exactly [the reserve's continuation, P2PK(this key), the miner fee of at
 * most REDEEM_MAX_FEE_NANOERG], as the wallet's own checks require before it signs (tx/redemption.ts L1).
 */
export function redemptionPaysOwnKey(signedRaw: string, pub: Hex): boolean {
  const outs = outputsOf(signedRaw);
  return !!outs && outs.length === 3 && outs[0].tree === RESERVE_TREE_HEX && outs[1].tree === `0008cd${pub}` &&
    outs[2].tree === FEE_TREE_HEX && outs[2].value <= REDEEM_MAX_FEE_NANOERG;
}
