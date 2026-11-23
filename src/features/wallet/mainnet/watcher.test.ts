// The journal watcher's foreign-spend check (money review P2-1, P2-2): every input, not only the first; large
// entries in turns of 10 per block. And when "Cancel" is offered for a refused transaction.
import { beforeEach, describe, expect, it } from "vitest";
import type { ChainBox } from "@/mainnet/net";
import type { JournalEntry, MainnetVault } from "@/mainnet/vault";
import { OUR_TRACKER, type TrackedReserve } from "@/chain/ours";
import { reserveBox } from "@/mainnet/tx/testkit";
import { MINTED_CHECK_MAX, forgetMinters, mintedAmong, minterOf, retireReserveOf, spentElsewhere, trackedRefs } from "./data";
import { trackedAs, trustedNft } from "@/mainnet/flows";
import { ISSUER_A, R3_RESERVE_IN, T1 } from "@/mainnet/tx/fixtures/chain";
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

describe("retiring the T1 after a completed refund (review 2, coordinator's decision)", () => {
  const NFT = "9f".repeat(32);
  const t1 = { id: "t1", kind: "t1", state: "final", inputs: [NFT] } as unknown as JournalEntry;
  const done = { kind: "refund-end", state: "final", inclusionHeight: 1_000, meta: { nft: NFT } } as unknown as JournalEntry;
  const fake = (active: JournalEntry | null) => {
    const retired: string[] = [];
    const vault = { journal: { activeT1: async () => active, retireT1: async (id: string) => { retired.push(id); return active!; } } } as unknown as Pick<MainnetVault, "journal">;
    return { vault, retired };
  };
  const p2pk = reserveBox(`02${"4a".repeat(32)}`, 1n, { nft: NFT, tree: `0008cd02${"4a".repeat(32)}` });
  const inReserve = reserveBox(`02${"4a".repeat(32)}`, 1n, { nft: NFT });
  const holder = (box: ChainBox["box"] | null) => async () => ({ ok: true as const, value: box ? { box, height: 1_000 } : null });
  it("once the T1's reserve NFT left the reserve contract by a completion 10 deep; a planted box does not block it", async () => {
    const a = fake(t1);
    // the reserve contract still holds the NFT, or the completion is 9 deep: not yet
    expect(await retireReserveOf(a.vault, "02", done, 1_009, holder(inReserve))).toBe(false);
    expect(await retireReserveOf(a.vault, "02", done, 1_008, holder(p2pk))).toBe(false);
    expect(a.retired).toEqual([]);
    // the NFT is at the owner's address now (or nowhere): retired; other reserve boxes at the key are not looked at
    expect(await retireReserveOf(a.vault, "02", done, 1_009, holder(p2pk))).toBe(true);
    expect(a.retired).toEqual(["t1"]);
    const b = fake(t1);
    expect(await retireReserveOf(b.vault, "02", done, 2_000, holder(null))).toBe(true);
  });
  it("never for a completion of another reserve, a failed read, or a T1 that is not final", async () => {
    expect(await retireReserveOf(fake(t1).vault, "02", { ...done, meta: { nft: "8a".repeat(32) } } as JournalEntry, 2_000, holder(p2pk))).toBe(false);
    expect(await retireReserveOf(fake(t1).vault, "02", done, 2_000, async () => ({ ok: false as const, problem: { kind: "network" as const, status: null, reason: "", retryInMs: null, txId: null } }))).toBe(false);
    const c = fake({ ...t1, state: "confirmed" } as JournalEntry);
    expect(await retireReserveOf(c.vault, "02", done, 2_000, holder(p2pk))).toBe(false);
    expect(c.retired).toEqual([]);
  });
});

describe("the tracker's reserves as reserve NFTs (review 2: the tracker names boxes; re-review P1-1: minted by the owner)", () => {
  const OWNER = `02${"4a".repeat(32)}`;
  const ATTACKER = `03${"6c".repeat(32)}`;
  const real = reserveBox(OWNER, 1_000_000_000n, { nft: "9f".repeat(32) });
  const theirs = reserveBox(`03${"5b".repeat(32)}`, 1_000_000_000n, { nft: "8e".repeat(32) });
  // P: a box under the reserve contract with R4 = the victim, its NFT minted from the attacker's own box
  const planted = reserveBox(OWNER, 1_000_000_000n, { nft: "8a".repeat(32) });
  // the boxes whose ids are the NFTs: where each was minted from
  const mint = (key: string) => ({ ergoTree: `0008cd${key}` }) as ChainBox["box"];
  const minted = { ["9f".repeat(32)]: mint(OWNER), ["8e".repeat(32)]: mint(`03${"5b".repeat(32)}`), ["8a".repeat(32)]: mint(ATTACKER) };
  const entry = (box: string, o: Partial<TrackedReserve> = {}): TrackedReserve =>
    ({ box, owner: OWNER, collateral: 1n, debt: 0n, nft: OUR_TRACKER.nft, token: null, updatedHeight: 1, updatedAt: 1, ratio: null, refundHeight: 0, pendingRedemption: 0n, ...o }) as TrackedReserve;
  const reader = (boxes: Record<string, ChainBox["box"]>, asked: string[] = []) => async (id: string) => {
    asked.push(id);
    return id in boxes ? { ok: true as const, value: { text: "", box: boxes[id], spentBy: null } } : { ok: false as const, problem: { kind: "not-found" as const, status: 404, reason: "", retryInMs: null, txId: null } };
  };
  beforeEach(() => forgetMinters());

  it("reads the NFT of the box the tracker names and checks that its owner minted it", async () => {
    const r = await trackedRefs([entry(real.boxId)], reader({ [real.boxId]: real, ...minted }));
    expect(r).toEqual({ ok: true, value: [{ owner: OWNER, nft: "9f".repeat(32), token: null, genuine: true }] });
  });

  it("a P minted from the attacker's box with R4 = the victim: named, not genuine, so never the victim's reserve", async () => {
    const r = await trackedRefs([entry(planted.boxId)], reader({ [planted.boxId]: planted, ...minted }));
    expect(r).toEqual({ ok: true, value: [{ owner: OWNER, nft: "8a".repeat(32), token: null, genuine: false }] });
    if (!r.ok) throw new Error("read");
    expect(trustedNft({ owner: OWNER, t1Nft: null, tracked: r.value })).toEqual({ ok: false, why: "unproven" });
    expect(trackedAs(OWNER, "8a".repeat(32), r.value)).toBe(false);
    // next to the victim's own T1 it changes nothing
    expect(trustedNft({ owner: OWNER, t1Nft: "9f".repeat(32), tracked: r.value })).toEqual({ ok: true, nft: "9f".repeat(32) });
  });

  it("the live-shaped reserve passes: its NFT is the id of the T1's first input, a box at the owner's P2PK", async () => {
    const nft = R3_RESERVE_IN.tokens[0].tokenId;
    const first = T1.v1.inputs[0];
    expect(first.boxId).toBe(nft);
    const r = await trackedRefs([entry(R3_RESERVE_IN.boxId, { owner: ISSUER_A })], reader({ [R3_RESERVE_IN.boxId]: R3_RESERVE_IN, [nft]: first as unknown as ChainBox["box"] }));
    expect(r).toEqual({ ok: true, value: [{ owner: ISSUER_A, nft, token: null, genuine: true }] });
  });

  it("no minting box on /v1 is not genuine (and not remembered); a failed read is no answer; a known one is read once", async () => {
    expect(await trackedRefs([entry(real.boxId)], reader({ [real.boxId]: real }))).toMatchObject({ ok: true, value: [{ genuine: false }] });
    const asked: string[] = [];
    const boxes = reader({ [real.boxId]: real, ...minted }, asked);
    expect(await trackedRefs([entry(real.boxId)], boxes)).toMatchObject({ ok: true, value: [{ genuine: true }] });
    expect(await minterOf("9f".repeat(32), boxes)).toEqual({ ok: true, value: OWNER });
    expect(asked.filter((x) => x === "9f".repeat(32))).toHaveLength(1);
    const down = async () => ({ ok: false as const, problem: { kind: "network" as const, status: null, reason: "", retryInMs: null, txId: null } });
    expect((await minterOf("8e".repeat(32), down)).ok).toBe(false);
  });

  it("leaves out another tracker's entry and a box that is not that owner's reserve; a failed read is no answer", async () => {
    const boxes = reader({ [real.boxId]: real, [theirs.boxId]: theirs, ...minted });
    expect(await trackedRefs([entry(real.boxId, { nft: "11".repeat(32) })], boxes)).toEqual({ ok: true, value: [] });
    expect(await trackedRefs([entry(theirs.boxId)], boxes)).toEqual({ ok: true, value: [] });
    expect((await trackedRefs([entry("77".repeat(32))], boxes)).ok).toBe(false);
  });

  it("T1 creation: only a reserve this key minted counts; planted boxes, even many, do not block", async () => {
    const at = (b: typeof real) => ({ box: b, height: 1 });
    expect(await mintedAmong([at(planted), at(planted)], OWNER, reader(minted))).toEqual({ ok: true, value: false });
    expect(await mintedAmong([at(planted), at(real)], OWNER, reader(minted))).toEqual({ ok: true, value: true });
    expect(await mintedAmong([at(theirs)], OWNER, reader(minted))).toEqual({ ok: true, value: false });
    const flood = Array.from({ length: 40 }, (_, i) => at(reserveBox(OWNER, 1_000_000_000n, { nft: i.toString(16).padStart(64, "c") })));
    const asked: string[] = [];
    expect(await mintedAmong(flood, OWNER, reader(minted, asked))).toEqual({ ok: true, value: false });
    expect(asked.length).toBe(MINTED_CHECK_MAX);
  });
});
