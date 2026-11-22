// R3's `POST /redemption/build` answer, rebuilt from the chain (not imported by the app). A recorded answer would
// need a write route, which this part must not call; the rebuild uses the tracker's exact shape (testkit.ts), the
// chain's boxes and outputs and the extension the canary submitted (extensions.json), so it is the answer the
// tracker gave up to whitespace and `headers` (left empty: L1 does not read them).
import { p2pkAddress } from "../address";
import { checkNoteForRedemption, parseStoredNote, type ChainBoxes, type RedemptionExpectation } from "../redemption";
import { trackerBuildResponse, type BuildParts } from "../testkit";
import { candidateOf, EXT, ISSUER_A, R3, R3_RESERVE_IN, R3_TRACKER, RECEIVER_B, TEXT } from "./chain";

export const R3_AMOUNT = 100_000_000n;

/** The parts of R3's build; each call returns fresh copies, so a test can mutate them. */
export function r3Parts(): BuildParts {
  return {
    unsigned: {
      inputs: [{ boxId: R3_RESERVE_IN.boxId, extension: EXT.R3.entries.map((e) => ({ ...e })) }],
      dataInputs: [R3_TRACKER.boxId],
      outputs: R3.v1.outputs.map(candidateOf),
    },
    inputs: [{ ...R3_RESERVE_IN }],
    dataInputs: [{ ...R3_TRACKER }],
    summary: {
      reserveBoxId: R3_RESERVE_IN.boxId,
      trackerBoxId: R3_TRACKER.boxId,
      reserveOutputValue: 550_000_000n,
      recipientOutputValue: 99_000_000n,
      totalDebt: 600_000_000n,
      changeAmount: 0n,
      changeAddress: "",
      recipientAddress: p2pkAddress(RECEIVER_B),
      isFirstRedemption: false,
      fee: 1_000_000n,
      newAlreadyRedeemed: 450_000_000n,
      feePaidBy: "recipient",
    },
  };
}

export function r3BuildText(parts: BuildParts = r3Parts()): string {
  return trackerBuildResponse(parts);
}

export function r3Chain(): ChainBoxes {
  return { inputs: [{ ...R3_RESERVE_IN }], dataInputs: [{ ...R3_TRACKER }] };
}

/** The expectation the UI derives from the stored note (front.note-r3-pair.json), plus the tip and tracker box. */
export function r3Expect(): RedemptionExpectation {
  const note = checkNoteForRedemption(parseStoredNote(TEXT.frontNote), { issuer: ISSUER_A, recipient: RECEIVER_B, amount: R3_AMOUNT });
  if (!note.ok) throw new Error(`the R3 note fixture does not pass: ${note.message}`);
  return { ...note.expect, tipHeight: R3.v1.inclusionHeight! - 1, currentTrackerBoxId: R3_TRACKER.boxId };
}
