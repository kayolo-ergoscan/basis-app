// The journal watcher's foreign-spend check (money review P2-1, P2-2): every input, not only the first; large
// entries in turns of 10 per block. And when "Cancel" is offered for a refused transaction.
import { describe, expect, it } from "vitest";
import type { ChainBox } from "@/mainnet/net";
import type { JournalEntry, MainnetVault } from "@/mainnet/vault";
import { OUR_TRACKER, type TrackedReserve } from "@/chain/ours";
import { reserveBox } from "@/mainnet/tx/testkit";
import { retireReserveOf, spentElsewhere, trackedRefs } from "./data";
import { STUCK_COMPLETION_MS, canCancel, stuckCompletion } from "./send";

const id = (i: number) => i.toString(16).padStart(64, "0");
const TX = "ab".repeat(32);

function boxes(spent: Record<string, string | null>) {
  const asked: string[] = [];
  const box = async (boxId: string) => {
    asked.push(boxId);
    if (!(boxId in spent)) return { ok: false as const, problem: { kind: "not-found" as const, status: 404, reason: "", retryInMs: null, txId: null } };
    return { ok: true as const, value: { text: "", box: {} as ChainBox["box"], spentBy: spent[boxId] } };
  };
  return { box, asked };
}

describe("a stuck entry's inputs", () => {
  it("finds a foreign spend on any input; its own spend or an unspent box is no conflict", async () => {
    const e = { inputs: [id(1), id(2), id(3)], txId: TX };
    expect(await spentElsewhere(e, 100, boxes({ [id(1)]: null, [id(2)]: null, [id(3)]: "cd".repeat(32) }).box)).toBe(true);
    expect(await spentElsewhere(e, 100, boxes({ [id(1)]: TX, [id(2)]: null, [id(3)]: null }).box)).toBe(false);
    expect(await spentElsewhere(e, 100, boxes({}).box)).toBe(false); // unknown boxes prove nothing
  });

  it("checks at most 10 per block, a different 10 each block", async () => {
    const e = { inputs: Array.from({ length: 25 }, (_, i) => id(i)), txId: TX };
    const a = boxes({});
    await spentElsewhere(e, 1, a.box);
    const b = boxes({});
    await spentElsewhere(e, 2, b.box);
    expect(a.asked).toHaveLength(10);
    expect(b.asked).toHaveLength(10);
    expect(a.asked[0]).not.toBe(b.asked[0]);
    const seen = new Set<string>();
    for (let h = 0; h < 5; h++) { const c = boxes({}); await spentElsewhere(e, h, c.box); c.asked.forEach((x) => seen.add(x)); }
    expect(seen.size).toBe(25);
  });
});

describe("Cancel is offered", () => {
  const base = { id: "e1", kind: "withdraw", state: "signed", sendAttempts: 1, meta: { nodeRefused: true } } as unknown as JournalEntry;
  it("after the node refused the first broadcast (still signed) or a later one (sent), never before a send", () => {
    expect(canCancel(base, [])).toBe(true);
    expect(canCancel({ ...base, state: "sent" }, [])).toBe(true);
    expect(canCancel({ ...base, sendAttempts: 0 }, [])).toBe(false);
    expect(canCancel({ ...base, state: "mempool" }, [])).toBe(false);
    expect(canCancel({ ...base, meta: {} }, [])).toBe(false);
    expect(canCancel({ ...base, kind: "redeem" }, [])).toBe(false);
  });
  it("again only when its cancel failed or was abandoned", () => {
    const e = { ...base, meta: { nodeRefused: true, cancelledBy: "c1" } } as JournalEntry;
    const c = (state: string) => ({ id: "c1", state }) as unknown as JournalEntry;
    expect(canCancel(e, [c("sent")])).toBe(false);
    expect(canCancel(e, [c("failed")])).toBe(true);
    expect(canCancel(e, [c("abandoned")])).toBe(true);
  });
});

describe("a refused or unseen completion (review 1, item 3)", () => {
  const NOW = 1_800_000_000_000;
  const base = { id: "r1", kind: "refund-end", state: "sent", sendAttempts: 1, firstSendAt: NOW - 60_000, meta: {} } as unknown as JournalEntry;
  it("is stuck when the node refused it, or nobody saw it 10 blocks after the first send", () => {
    expect(stuckCompletion(base, NOW)).toBe(false);
    expect(stuckCompletion({ ...base, meta: { nodeRefused: true } }, NOW)).toBe(true);
    expect(stuckCompletion({ ...base, state: "signed", meta: { nodeRefused: true } }, NOW)).toBe(true);
    expect(stuckCompletion({ ...base, firstSendAt: NOW - STUCK_COMPLETION_MS - 1 }, NOW)).toBe(true);
  });
  it("never when it is in a mempool or a block, was never sent, or is another kind", () => {
    const old = { ...base, firstSendAt: NOW - 2 * STUCK_COMPLETION_MS, meta: { nodeRefused: true } };
    expect(stuckCompletion({ ...old, state: "mempool" }, NOW)).toBe(false);
    expect(stuckCompletion({ ...old, state: "confirmed" }, NOW)).toBe(false);
    expect(stuckCompletion({ ...old, sendAttempts: 0 }, NOW)).toBe(false);
    expect(stuckCompletion({ ...old, kind: "refund-start" }, NOW)).toBe(false);
  });
});

describe("retiring the T1 after a completed refund (review 2)", () => {
  const t1 = { id: "t1", kind: "t1", state: "final" } as unknown as JournalEntry;
  const fake = (active: JournalEntry | null) => {
    const retired: string[] = [];
    const vault = { journal: { activeT1: async () => active, retireT1: async (id: string) => { retired.push(id); return active!; } } } as unknown as Pick<MainnetVault, "journal">;
    return { vault, retired };
  };
  const chain = (boxes: number, complete = true) => async () => ({ ok: true as const, value: { boxes: Array.from({ length: boxes }, () => ({}) as never), complete } });
  it("only when the chain shows no reserve of the key, in a complete listing", async () => {
    const a = fake(t1);
    expect(await retireReserveOf(a.vault, "02".repeat(33), chain(1))).toBe(false);
    expect(await retireReserveOf(a.vault, "02".repeat(33), chain(0, false))).toBe(false);
    expect(await retireReserveOf(a.vault, "02".repeat(33), async () => ({ ok: false as const, problem: { kind: "network" as const, status: null, reason: "", retryInMs: null, txId: null } }))).toBe(false);
    expect(a.retired).toEqual([]);
    expect(await retireReserveOf(a.vault, "02".repeat(33), chain(0))).toBe(true);
    expect(a.retired).toEqual(["t1"]);
  });
  it("never a T1 that is not final", async () => {
    const b = fake({ ...t1, state: "confirmed" } as JournalEntry);
    expect(await retireReserveOf(b.vault, "02".repeat(33), chain(0))).toBe(false);
    expect(b.retired).toEqual([]);
  });
});

describe("the tracker's reserves as reserve NFTs (review 2: the tracker names boxes, its nft is its own)", () => {
  const OWNER = `02${"4a".repeat(32)}`;
  const real = reserveBox(OWNER, 1_000_000_000n, { nft: "9f".repeat(32) });
  const theirs = reserveBox(`03${"5b".repeat(32)}`, 1_000_000_000n, { nft: "8e".repeat(32) });
  const entry = (box: string, o: Partial<TrackedReserve> = {}): TrackedReserve =>
    ({ box, owner: OWNER, collateral: 1n, debt: 0n, nft: OUR_TRACKER.nft, token: null, updatedHeight: 1, updatedAt: 1, ratio: null, refundHeight: 0, pendingRedemption: 0n, ...o }) as TrackedReserve;
  const reader = (boxes: Record<string, ChainBox["box"]>) => async (id: string) =>
    id in boxes ? { ok: true as const, value: { text: "", box: boxes[id], spentBy: null } } : { ok: false as const, problem: { kind: "not-found" as const, status: 404, reason: "", retryInMs: null, txId: null } };
  it("reads the NFT of the box the tracker names (an older box of the reserve names it too)", async () => {
    const r = await trackedRefs([entry(real.boxId)], reader({ [real.boxId]: real }));
    expect(r).toEqual({ ok: true, value: [{ owner: OWNER, nft: "9f".repeat(32), token: null }] });
  });
  it("leaves out another tracker's entry and a box that is not that owner's reserve; a failed read is no answer", async () => {
    const boxes = reader({ [real.boxId]: real, [theirs.boxId]: theirs });
    expect(await trackedRefs([entry(real.boxId, { nft: "11".repeat(32) })], boxes)).toEqual({ ok: true, value: [] });
    expect(await trackedRefs([entry(theirs.boxId)], boxes)).toEqual({ ok: true, value: [] });
    expect((await trackedRefs([entry("77".repeat(32))], boxes)).ok).toBe(false);
  });
});
