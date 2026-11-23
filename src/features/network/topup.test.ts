// The observatory's Top up key: open (a link into the mainnet wallet) only for what the wallet tops up, shut with the
// reason otherwise. The wallet reads the reserve again from the chain (tx/reserveaction.ts readReserve).
import { describe, expect, it } from "vitest";
import { OUR_TRACKER, type ReserveView } from "@/chain";
import { topUpShut } from "./Overview";

const view = (o: Partial<ReserveView> = {}): ReserveView => ({
  id: "ab".repeat(32), source: "seed", contract: { current: true } as ReserveView["contract"], kind: "erg", height: 1, at: null, tx: null,
  origin: "creation", unspent: true, spent: null, prev: null, next: null, value: 100_000_000n, owner: null,
  nft: { id: "9f".repeat(32), name: null }, collateral: null, r5: null, r6: OUR_TRACKER.nft, r7: 0, regs: {}, creator: null, issues: [],
  legacy: false, exit: null, snapshotExit: null as unknown as ReserveView["snapshotExit"], pending: 0, checked: null, ...o,
});

describe("topUpShut", () => {
  it("opens a current, unspent ERG reserve of our tracker with no refund (R7 absent too: the wallet reads it)", () => {
    expect(topUpShut(view())).toBeNull();
    expect(topUpShut(view({ r7: null }))).toBeNull();
  });
  it("says why it stays shut", () => {
    expect(topUpShut(view({ unspent: false }))).toBe("spent");
    expect(topUpShut(view({ legacy: true }))).toBe("legacy");
    expect(topUpShut(view({ contract: { current: false } as ReserveView["contract"] }))).toBe("legacy");
    expect(topUpShut(view({ contract: null }))).toBe("legacy");
    expect(topUpShut(view({ kind: "token" }))).toBe("token");
    expect(topUpShut(view({ r6: "11".repeat(32) }))).toBe("tracker");
    expect(topUpShut(view({ nft: null }))).toBe("tracker");
    expect(topUpShut(view({ r7: 1_923_000 }))).toBe("refund");
  });
});
