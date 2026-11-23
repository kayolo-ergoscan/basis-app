// Pure numbers behind StatusLadder and ExitClocks (tested): block ETAs for a note's confirmation, the tracker's
// emergency window (box age > 2 160 blocks, so it opens at creationHeight + 2 161) and the owner's exit
// (R7 + 43 200 blocks).

import { EMERGENCY_BLOCKS, MIN_CONFIRMATION_DEPTH, REFUND_PERIOD_BLOCKS, type Economy, type NoteRecord, type NoteStatus } from "@/protocol";

export interface LadderModel {
  status: NoteStatus;
  /** Blocks until the next tracker commit (≤ interval). */
  nextCommitIn: number;
  /** Blocks of depth still needed after the box is on chain. */
  depthLeft: number;
  /** Upper bound in blocks until "confirmed" (0 when confirmed): the tracker's updater checks once per cycle. */
  etaBlocks: number;
  canRedeemNow: boolean;
  redeemable: bigint;
}

export interface LadderInput {
  status: NoteStatus;
  height: number;
  /** Height of the tracker's newest box (null: none yet). */
  lastCommitHeight: number | null;
  commitIntervalBlocks?: number;
  minDepth?: number;
  /** What the holder could redeem now (0 when nothing). */
  redeemable?: bigint;
}

export function ladderModel(i: LadderInput): LadderModel {
  const interval = Math.max(1, i.commitIntervalBlocks ?? 5);
  const minDepth = i.minDepth ?? MIN_CONFIRMATION_DEPTH;
  const since = i.lastCommitHeight === null ? 0 : Math.max(0, i.height - i.lastCommitHeight);
  const nextCommitIn = i.lastCommitHeight === null ? interval : Math.max(1, interval - (since % interval));
  const depth = i.lastCommitHeight === null ? 0 : i.height - i.lastCommitHeight + 1;
  const depthLeft = Math.max(0, minDepth - depth);
  // the updater promotes notes on its next cycle at which the box is deep enough (depth counts the inclusion block)
  const cyclesFor = (blocks: number) => interval * Math.ceil(Math.max(0, blocks) / interval);
  const etaBlocks =
    i.status === "confirmed" ? 0 : i.status === "pending" ? nextCommitIn + (depthLeft > nextCommitIn ? cyclesFor(depthLeft - nextCommitIn) : 0) : nextCommitIn + cyclesFor(Math.max(1, minDepth - 1));
  const redeemable = i.redeemable ?? 0n;
  return { status: i.status, nextCommitIn, depthLeft, etaBlocks, canRedeemNow: i.status === "confirmed" && redeemable > 0n, redeemable };
}

/** The ladder for one note of an Economy (status, tracker cadence, what the holder could redeem now). */
export function ladderFromEconomy(eco: Economy, rec: NoteRecord): LadderInput {
  const tracker = eco.t(rec.tracker);
  const issuer = eco.byPub.get(rec.issuer);
  const receiver = eco.byPub.get(rec.receiver);
  let redeemable = 0n;
  if (issuer && receiver) {
    const pv = eco.redemptionPreview({ receiver: receiver.id, issuer: issuer.id, denom: rec.denom, tracker: tracker.id });
    const committed = pv.committed ?? 0n;
    for (const r of pv.reserves) {
      const room = committed - r.alreadyRedeemed;
      const can = room < r.payable ? room : r.payable;
      if (can > redeemable) redeemable = can;
    }
  }
  return {
    status: eco.noteStatus(rec),
    height: eco.clock.height,
    lastCommitHeight: tracker.currentBox()?.creationHeight ?? null,
    commitIntervalBlocks: tracker.options.commitIntervalBlocks,
    minDepth: tracker.options.minDepth,
    redeemable,
  };
}

export interface EmergencyModel {
  age: number;
  /** First block at which a redemption without the tracker's signature is valid. */
  opensAt: number;
  open: boolean;
  /** Blocks until it opens (0 when open). */
  left: number;
  zone: "on-time" | "late" | "silent" | "emergency";
}

/** `quiet`: the age a tracker's box reaches by design while nothing changes (its heartbeat plus slack, e.g. ErgoScan's
 *  720 + 30). With it the zones are on time up to it, silent after it (never "late"); without it 120 / 720 blocks. */
export function emergencyModel(height: number, boxCreationHeight: number, quiet?: number): EmergencyModel {
  const age = Math.max(0, height - boxCreationHeight);
  const opensAt = boxCreationHeight + EMERGENCY_BLOCKS + 1;
  const open = age > EMERGENCY_BLOCKS;
  const zone = open ? "emergency" : quiet !== undefined ? (age <= quiet ? "on-time" : "silent") : age >= 720 ? "silent" : age >= 120 ? "late" : "on-time";
  return { age, opensAt, open, left: open ? 0 : opensAt - height, zone };
}

export interface ExitModel {
  r7: number;
  unlockAt: number;
  /** Blocks since R7 (clamped at 0 when R7 is in the future). */
  elapsed: number;
  left: number;
  open: boolean;
  progress: number;
}

export function exitModel(height: number, r7: number): ExitModel {
  const unlockAt = r7 + REFUND_PERIOD_BLOCKS;
  const elapsed = Math.max(0, height - r7);
  const open = height >= unlockAt;
  return { r7, unlockAt, elapsed, left: open ? 0 : unlockAt - height, open, progress: Math.min(1, elapsed / REFUND_PERIOD_BLOCKS) };
}
