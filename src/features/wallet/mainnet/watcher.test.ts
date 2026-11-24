// The journal watcher's foreign-spend check (money review P2-1, P2-2): every input, not only the first; large
// entries in turns of 10 per block. And when "Cancel" is offered for a refused transaction.
import { beforeEach, describe, expect, it } from "vitest";
import type { ChainBox } from "@/mainnet/net";
import type { JournalEntry, MainnetVault } from "@/mainnet/vault";
import { OUR_TRACKER, type TrackedReserve } from "@/chain/ours";
import { p2pkBox, reserveBox } from "@/mainnet/tx/testkit";
import { MINTED_CHECK_MAX, forgetMinters, mintedAmong, minterOf, retireReserveOf, spentElsewhere, t1GateOf, trackedGateOf, trackedRefs } from "./data";
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
  // the boxes whose ids are the NFTs: where each was minted from (real ids: minterOf believes only a box that hashes
  // to its id, wallet-t3)
  const mint = (key: string, tx: string) => p2pkBox(key, 1_000_000n, { transactionId: tx.repeat(32) });
  const M_OWNER = mint(OWNER, "c1"), M_THEIRS = mint(`03${"5b".repeat(32)}`, "c2"), M_ATTACKER = mint(ATTACKER, "c3");
  const NFT = M_OWNER.boxId, PLANT = M_ATTACKER.boxId;
  const real = reserveBox(OWNER, 1_000_000_000n, { nft: NFT });
  const theirs = reserveBox(`03${"5b".repeat(32)}`, 1_000_000_000n, { nft: M_THEIRS.boxId });
  // P: a box under the reserve contract with R4 = the victim, its NFT minted from the attacker's own box
  const planted = reserveBox(OWNER, 1_000_000_000n, { nft: PLANT });
  const minted: Record<string, ChainBox["box"]> = { [NFT]: M_OWNER, [M_THEIRS.boxId]: M_THEIRS, [PLANT]: M_ATTACKER };
  const entry = (box: string, o: Partial<TrackedReserve> = {}): TrackedReserve =>
    ({ box, owner: OWNER, collateral: 1n, debt: 0n, nft: OUR_TRACKER.nft, token: null, updatedHeight: 1, updatedAt: 1, ratio: null, refundHeight: 0, pendingRedemption: 0n, ...o }) as TrackedReserve;
  const reader = (boxes: Record<string, ChainBox["box"]>, asked: string[] = []) => async (id: string) => {
    asked.push(id);
    return id in boxes ? { ok: true as const, value: { text: "", box: boxes[id], spentBy: null } } : { ok: false as const, problem: { kind: "not-found" as const, status: 404, reason: "", retryInMs: null, txId: null } };
  };
  beforeEach(() => forgetMinters());

  it("reads the NFT of the box the tracker names and checks that its owner minted it", async () => {
    const r = await trackedRefs([entry(real.boxId)], reader({ [real.boxId]: real, ...minted }));
    expect(r).toEqual({ ok: true, value: [{ box: real.boxId, owner: OWNER, nft: NFT, token: null, genuine: true }] });
  });

  it("a P minted from the attacker's box with R4 = the victim: named, not genuine, so never the victim's reserve", async () => {
    const r = await trackedRefs([entry(planted.boxId)], reader({ [planted.boxId]: planted, ...minted }));
    expect(r).toEqual({ ok: true, value: [{ box: planted.boxId, owner: OWNER, nft: PLANT, token: null, genuine: false }] });
    if (!r.ok) throw new Error("read");
    expect(trustedNft({ owner: OWNER, t1Nft: null, tracked: r.value })).toEqual({ ok: false, why: "unproven" });
    expect(trackedAs(OWNER, PLANT, r.value)).toBe(false);
    // next to the victim's own T1 it changes nothing
    expect(trustedNft({ owner: OWNER, t1Nft: NFT, tracked: r.value })).toEqual({ ok: true, nft: NFT });
  });

  it("the live-shaped reserve passes: its NFT is the id of the T1's first input, a box at the owner's P2PK", async () => {
    const nft = R3_RESERVE_IN.tokens[0].tokenId;
    const first = T1.v1.inputs[0];
    expect(first.boxId).toBe(nft);
    const r = await trackedRefs([entry(R3_RESERVE_IN.boxId, { owner: ISSUER_A })], reader({ [R3_RESERVE_IN.boxId]: R3_RESERVE_IN, [nft]: first as unknown as ChainBox["box"] }));
    expect(r).toEqual({ ok: true, value: [{ box: R3_RESERVE_IN.boxId, owner: ISSUER_A, nft, token: null, genuine: true }] });
  });

  it("no minting box on /v1 yet proves nothing either way (and is not remembered); a failed read is no answer; a known one is read once", async () => {
    expect(await minterOf(NFT, reader({}))).toEqual({ ok: true, value: undefined });
    expect(await trackedRefs([entry(real.boxId)], reader({ [real.boxId]: real }))).toMatchObject({ ok: true, value: [{ genuine: null }] });
    const asked: string[] = [];
    const boxes = reader({ [real.boxId]: real, ...minted }, asked);
    expect(await trackedRefs([entry(real.boxId)], boxes)).toMatchObject({ ok: true, value: [{ genuine: true }] });
    expect(await minterOf(NFT, boxes)).toEqual({ ok: true, value: OWNER });
    expect(asked.filter((x) => x === NFT)).toHaveLength(1);
    const down = async () => ({ ok: false as const, problem: { kind: "network" as const, status: null, reason: "", retryInMs: null, txId: null } });
    expect((await minterOf(M_THEIRS.boxId, down)).ok).toBe(false);
  });

  it("a minting box that does not hash to its id is a problem, not an answer, and is not remembered (wallet-t3)", async () => {
    // /v1 answers for the NFT's id with the victim's P2PK tree on someone else's box: never believed
    const forged = { ...M_ATTACKER, boxId: PLANT, ergoTree: `0008cd${OWNER}` };
    expect(await minterOf(PLANT, reader({ [PLANT]: forged }))).toMatchObject({ ok: false, problem: { kind: "shape" } });
    expect(await trackedRefs([entry(planted.boxId)], reader({ [planted.boxId]: planted, [PLANT]: forged }))).toMatchObject({ ok: false, problem: { kind: "shape" } });
    // an answer missing fields cannot be hashed: the same
    expect(await minterOf(PLANT, reader({ [PLANT]: { ergoTree: `0008cd${OWNER}` } as ChainBox["box"] }))).toMatchObject({ ok: false, problem: { kind: "shape" } });
    // the true box afterwards is read and believed
    expect(await minterOf(PLANT, reader(minted))).toEqual({ ok: true, value: ATTACKER });
  });

  it("leaves out another tracker's entry and a box that is not that owner's reserve; a failed read is no answer", async () => {
    const boxes = reader({ [real.boxId]: real, [theirs.boxId]: theirs, ...minted });
    expect(await trackedRefs([entry(real.boxId, { nft: "11".repeat(32) })], boxes)).toEqual({ ok: true, value: [] });
    expect(await trackedRefs([entry(theirs.boxId)], boxes)).toEqual({ ok: true, value: [] });
    expect((await trackedRefs([entry("77".repeat(32))], boxes)).ok).toBe(false);
  });

  it("T1 creation (wallet-t3 P2): any ERG reserve the tracker lists for the key stops it, the own one told apart; then the chain", async () => {
    const ok = <T,>(value: T) => ({ ok: true as const, value });
    const at = (b: typeof real) => ({ box: b, height: 1 });
    const world = (list: TrackedReserve[], chain: (typeof real)[] = [], asked: string[] = []) => ({
      reservesOf: async () => ok(list),
      reservesOnChain: async () => ok({ boxes: chain.map(at), complete: true }),
      box: reader({ [real.boxId]: real, [planted.boxId]: planted, [theirs.boxId]: theirs, ...minted }, asked),
    });
    // nothing listed, or only a token reserve of the key: free, and no box is read
    const asked: string[] = [];
    expect(await t1GateOf(OWNER, undefined, world([], [], asked))).toEqual({ ok: true, value: { k: "none" } });
    expect(await t1GateOf(OWNER, undefined, world([entry(real.boxId, { token: "11".repeat(32) })], [], asked))).toEqual({ ok: true, value: { k: "none" } });
    expect(asked).toEqual([]);
    // the own one (this key minted its NFT), next to a planted one listed first
    expect(await t1GateOf(OWNER, undefined, world([entry(planted.boxId), entry(real.boxId)]))).toEqual({ ok: true, value: { k: "own", r: entry(real.boxId) } });
    // the planted one alone: stops the T1 all the same, as a reserve this wallet cannot prove
    expect(await t1GateOf(OWNER, undefined, world([entry(planted.boxId)]))).toEqual({ ok: true, value: { k: "unproven", rs: [entry(planted.boxId)] } });
    expect(await trackedGateOf(OWNER, undefined, world([entry(planted.boxId)]))).toEqual({ ok: true, value: { k: "unproven", rs: [entry(planted.boxId)] } });
    // a box that does not read as this key's reserve (another owner's box, another tracker's entry): stops it too
    expect(await t1GateOf(OWNER, undefined, world([entry(theirs.boxId)]))).toMatchObject({ ok: true, value: { k: "unproven" } });
    expect(await t1GateOf(OWNER, undefined, world([entry(real.boxId, { nft: "11".repeat(32) })]))).toMatchObject({ ok: true, value: { k: "unproven" } });
    // the tracker lists nothing: a reserve this key minted at the key on chain stops it; planted boxes there do not
    expect(await t1GateOf(OWNER, undefined, world([], [planted, real]))).toEqual({ ok: true, value: { k: "chain" } });
    expect(await t1GateOf(OWNER, undefined, world([], [planted, planted]))).toEqual({ ok: true, value: { k: "none" } });
    expect(await trackedGateOf(OWNER, undefined, world([], [real]))).toEqual({ ok: true, value: { k: "none" } });
    // /v1 has not got the minting box yet: not checked yet (calm), not planted; a T1 still stops
    forgetMinters();
    const lag = { ...world([entry(real.boxId)]), box: reader({ [real.boxId]: real }) };
    expect(await t1GateOf(OWNER, undefined, lag)).toEqual({ ok: true, value: { k: "unchecked", rs: [entry(real.boxId)] } });
    // a tracked box /v1 cannot find is one entry not checked yet; the others still show (wallet-t3 LOW-3)
    const gone = "77".repeat(32);
    expect(await t1GateOf(OWNER, undefined, world([entry(gone)]))).toEqual({ ok: true, value: { k: "unchecked", rs: [entry(gone)] } });
    expect(await t1GateOf(OWNER, undefined, world([entry(gone), entry(real.boxId)]))).toEqual({ ok: true, value: { k: "own", r: entry(real.boxId) } });
    expect(await t1GateOf(OWNER, undefined, world([entry(gone), entry(planted.boxId)]))).toEqual({ ok: true, value: { k: "unproven", rs: [entry(planted.boxId)] } });
    // the tracker or the chain unread: no answer (prepare() stops on it)
    const down = async () => ({ ok: false as const, problem: { kind: "network" as const, status: null, reason: "", retryInMs: null, txId: null } });
    expect((await t1GateOf(OWNER, undefined, { ...world([]), reservesOf: down })).ok).toBe(false);
    expect((await t1GateOf(OWNER, undefined, { ...world([]), reservesOnChain: down })).ok).toBe(false);
    // a box read that fails (not "not found") is the whole answer's
    expect((await t1GateOf(OWNER, undefined, { ...world([entry(real.boxId)]), box: down })).ok).toBe(false);
  });

  it("T1 creation: only a reserve this key minted counts; planted boxes, even many, do not block", async () => {
    const at = (b: typeof real) => ({ box: b, height: 1 });
    expect(await mintedAmong([at(planted), at(planted)], OWNER, reader(minted))).toEqual({ ok: true, value: { k: "none" } });
    expect(await mintedAmong([at(planted), at(real)], OWNER, reader(minted))).toEqual({ ok: true, value: { k: "mine" } });
    expect(await mintedAmong([at(theirs)], OWNER, reader(minted))).toEqual({ ok: true, value: { k: "none" } });
    // a flood of planted boxes, each minted from one of the attacker's boxes: 10 read, none counts
    const mints = Array.from({ length: 40 }, (_, i) => p2pkBox(ATTACKER, 1_000_000n, { transactionId: "c4".repeat(32), index: i }));
    const flood = mints.map((m) => at(reserveBox(OWNER, 1_000_000_000n, { nft: m.boxId })));
    const asked: string[] = [];
    expect(await mintedAmong(flood, OWNER, reader(Object.fromEntries(mints.map((m) => [m.boxId, m])), asked))).toEqual({ ok: true, value: { k: "none" } });
    expect(asked.length).toBe(MINTED_CHECK_MAX);
  });

  it("T1 creation (wallet-t3 LOW-4): a box at the key whose minting box /v1 does not have yet may be the key's own: unchecked, it stops a T1", async () => {
    const at = (b: typeof real) => ({ box: b, height: 1 });
    const lagging = { [PLANT]: M_ATTACKER }; // the real reserve's minting box is not indexed yet
    expect(await mintedAmong([at(planted), at(real)], OWNER, reader(lagging))).toEqual({ ok: true, value: { k: "unchecked", boxes: [real.boxId] } });
    // the own one wins once it is known; a known planted one is still not counted
    expect(await mintedAmong([at(real), at(real)], OWNER, reader(minted))).toEqual({ ok: true, value: { k: "mine" } });
    forgetMinters();
    const world = (box: (id: string) => Promise<unknown>) => ({
      reservesOf: async () => ({ ok: true as const, value: [] }),
      reservesOnChain: async () => ({ ok: true as const, value: { boxes: [at(planted), at(real)], complete: true } }),
      box,
    }) as unknown as Parameters<typeof t1GateOf>[2];
    expect(await t1GateOf(OWNER, undefined, world(reader(lagging)))).toEqual({ ok: true, value: { k: "unchecked-chain", boxes: [real.boxId] } });
    forgetMinters();
    expect(await t1GateOf(OWNER, undefined, world(reader(minted)))).toEqual({ ok: true, value: { k: "chain" } });
  });
});
