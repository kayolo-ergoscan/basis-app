// The journal watcher's foreign-spend check (money review P2-1, P2-2): every input, not only the first; large
// entries in turns of 10 per block. And when "Cancel" is offered for a refused transaction.
import { describe, expect, it } from "vitest";
import type { ChainBox } from "@/mainnet/net";
import type { JournalEntry } from "@/mainnet/vault";
import { spentElsewhere } from "./data";
import { canCancel } from "./send";

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
