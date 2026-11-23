// The observatory's Top up key: open (a link into the mainnet wallet) only for what the wallet tops up, shut with the
// reason otherwise: the registers as readReserve takes them (no R7 reads as 0, R8/R9 are ignored), and only a reserve
// our tracker tracks as its owner's (review 2: anyone can plant a box that looks like a reserve). The wallet reads the
// reserve and the tracker again before anything is signed.
import { describe, expect, it } from "vitest";
import { OUR_TRACKER, type ReserveView } from "@/chain";
import { topUpShut } from "./Overview";

const OWNER = `02${"4a".repeat(32)}`;
const BOX = "ab".repeat(32);
const tr = (o: Partial<{ box: string; owner: string; nft: string; token: string | null }> = {}) => ({ box: BOX, owner: OWNER, nft: OUR_TRACKER.nft, token: null, ...o });
const TRACKED = [tr()];
const view = (o: Partial<ReserveView> = {}): ReserveView => ({
  id: BOX, source: "seed", contract: { current: true } as ReserveView["contract"], kind: "erg", height: 1, at: null, tx: null,
  origin: "creation", unspent: true, spent: null, prev: null, next: null, value: 100_000_000n,
  nft: { id: "9f".repeat(32), name: null }, collateral: null, r5: null, r6: OUR_TRACKER.nft, r7: 0, creator: null, creatorState: "known", issues: [],
  owner: { key: OWNER, addr: "9f-owner" as NonNullable<ReserveView["owner"]>["addr"], label: null },
  regs: { R4: `07${OWNER}`, R5: `64${"00".repeat(33)}0a2000`, R6: `0e20${OUR_TRACKER.nft}`, R7: "0500" },
  legacy: false, exit: null, snapshotExit: null as unknown as ReserveView["snapshotExit"], pending: 0, checked: null, ...o,
});

describe("topUpShut", () => {
  it("opens a current, unspent ERG reserve of our tracker, tracked as its owner's, with no refund", () => {
    expect(topUpShut(view(), TRACKED)).toBeNull();
  });
  it("says why it stays shut", () => {
    expect(topUpShut(view({ unspent: false }), TRACKED)).toBe("spent");
    expect(topUpShut(view({ legacy: true }), TRACKED)).toBe("legacy");
    expect(topUpShut(view({ contract: { current: false } as ReserveView["contract"] }), TRACKED)).toBe("legacy");
    expect(topUpShut(view({ contract: null }), TRACKED)).toBe("legacy");
    expect(topUpShut(view({ kind: "token" }), TRACKED)).toBe("token");
    expect(topUpShut(view({ r6: "11".repeat(32) }), TRACKED)).toBe("tracker");
    expect(topUpShut(view({ nft: null }), TRACKED)).toBe("tracker");
    expect(topUpShut(view({ r7: 1_923_000, regs: { ...view().regs, R7: "05f0e4ea01" } }), TRACKED)).toBe("refund");
  });
  it("the registers as the wallet reads them: no R7 (the contract's 0) is taken; an odd type stays shut", () => {
    const { R7: _, ...noR7 } = view().regs;
    expect(topUpShut(view({ r7: null, regs: noR7 }), TRACKED)).toBeNull();
    expect(topUpShut(view({ regs: { ...view().regs, R7: "0400" } }), TRACKED)).toBe("shape"); // an Int
    expect(topUpShut(view({ regs: { ...view().regs, R4: "0e0102" } }), TRACKED)).toBe("shape");
    expect(topUpShut(view({ regs: { ...view().regs, R5: "0e00" } }), TRACKED)).toBe("shape");
    expect(topUpShut(view({ owner: null }), TRACKED)).toBe("shape");
  });
  it("only a reserve our tracker tracks as its owner's: a planted box with R4 = someone stays shut", () => {
    expect(topUpShut(view(), null)).toBe("unknown");
    expect(topUpShut(view(), [])).toBe("untracked");
    expect(topUpShut(view(), [tr({ owner: `03${"11".repeat(32)}` })])).toBe("untracked");
    expect(topUpShut(view(), [tr({ box: "cd".repeat(32) })])).toBe("untracked"); // another box of that owner
    expect(topUpShut(view(), [tr({ token: "11".repeat(32) })])).toBe("untracked");
    expect(topUpShut(view(), [tr({ nft: "11".repeat(32) })])).toBe("untracked"); // another tracker's entry
    expect(topUpShut(view(), [tr(), tr({ box: "cd".repeat(32) })])).toBe("untracked"); // two of that owner: not picked
  });
  it("the tracker may name an older box of the same reserve: the observatory gives its NFT", () => {
    const older = [tr({ box: "cd".repeat(32) })];
    expect(topUpShut(view(), older, (b) => (b === "cd".repeat(32) ? "9f".repeat(32) : null))).toBeNull();
    expect(topUpShut(view(), older, (b) => (b === "cd".repeat(32) ? "8e".repeat(32) : null))).toBe("untracked");
  });
});
