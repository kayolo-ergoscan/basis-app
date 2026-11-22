// The write-ahead journal: validation, the one-T1 rule (also across racing tabs), sending, states, timestamps.
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { DB_NAME, STORE_JOURNAL } from "../constants";
import { buildScope, noteScope, type JournalRecordInput } from "../journal";
import { FakeBrowser, PASS } from "./fakes";
import { backUp, code, openTab, randomPub, until } from "./helpers";

const hex = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
const signed = (id: string) => JSON.stringify({ id, inputs: [{ boxId: "11".repeat(32), spendingProof: { proofBytes: "ab", extension: {} } }] });
const tx = (pub: string, id: string, o: Partial<JournalRecordInput> = {}): JournalRecordInput => ({ kind: "withdraw", pub, txId: id, signedRaw: signed(id), inputs: [hex(0x11)], ...o });

describe("mainnet journal", () => {
  it("records before sending: fields, snapshot, subscribers, reload", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const pub = randomPub();
    let calls = 0;
    v.journal.subscribe(() => calls++);
    b.clock.advance(1000);
    const e = await v.journal.record(tx(pub, hex(1), { meta: { amount: "1000000", to: "9f" }, height: 1_922_400 }));
    expect(e).toEqual({ v: 1, id: e.id, kind: "withdraw", pub, state: "signed", txId: hex(1), signedRaw: signed(hex(1)), unsignedRaw: null, inputs: [hex(0x11)], sendAttempts: 0, firstSendAt: null, lastSendAt: null, lastHeight: 1_922_400, inclusionHeight: null, error: null, meta: { amount: "1000000", to: "9f" }, createdAt: b.clock.t, updatedAt: b.clock.t, retiredAt: null });
    expect(e.id).toMatch(/^[0-9a-f]{32}$/);
    expect(Object.isFrozen(e) && Object.isFrozen(e.inputs) && Object.isFrozen(e.meta)).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(v.journal.getSnapshot().map((x) => x.id)).toEqual([e.id]);
    expect(await v.journal.get(e.id)).toEqual(e);
    // the same transaction again returns the stored entry (a retry after a crash)
    expect((await v.journal.record(tx(pub, hex(1)))).id).toBe(e.id);
    expect(await code(v.journal.record(tx(pub, hex(1), { signedRaw: signed(hex(1)).replace("ab", "cd") })))).toBe("bad-input");
    v.close();
    const again = await openTab(b);
    expect(again.journal.getSnapshot()).toEqual([e]);
    again.close();
  });

  it("checks every field", async () => {
    const v = await openTab(new FakeBrowser());
    const pub = randomPub();
    const bad: Array<Partial<JournalRecordInput>> = [
      { kind: "other" as never },
      { pub: "02" + "00".repeat(32) },
      { pub: pub.toUpperCase() },
      { txId: null },
      { txId: "xyz" },
      { signedRaw: "" },
      { signedRaw: "{not json" },
      { signedRaw: JSON.stringify({ id: hex(9) }) },
      { signedRaw: JSON.stringify({ pad: "x".repeat(70_000) }) },
      { inputs: [] },
      { inputs: ["12"] },
      { inputs: [hex(1), hex(1)] },
      { meta: { "bad key": 1 } },
      { meta: { n: Number.NaN } },
      { meta: { o: {} as never } },
      { height: -1 },
      { kind: "redeem" },
      { kind: "note" },
      { kind: "note", txId: null, inputs: [hex(1)] },
    ];
    for (const o of bad) expect(await code(v.journal.record(tx(pub, hex(1), o))), JSON.stringify(o).slice(0, 80)).toBe("bad-input");
    const note = await v.journal.record({ kind: "note", pub, signedRaw: JSON.stringify({ issuer_pubkey: pub, signature: "ab" }), meta: { amount: "5" } });
    expect(note).toMatchObject({ kind: "note", txId: null, inputs: [] });
    const redeem = await v.journal.record(tx(pub, hex(2), { kind: "redeem", unsignedRaw: JSON.stringify({ inputs: [] }) }));
    expect(redeem.unsignedRaw).toBe('{"inputs":[]}');
    v.close();
  });

  it("one reserve creation per key: a second T1 is refused until the first failed, was abandoned or was retired", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const me = randomPub();
    const other = randomPub();
    const t1 = (id: string, pub = me) => tx(pub, id, { kind: "t1" });
    const first = await v.journal.record(t1(hex(1)));
    expect(await code(v.journal.record(t1(hex(2))))).toBe("t1-exists");
    await expect(v.journal.record(t1(hex(2)))).rejects.toMatchObject({ detail: { id: first.id, state: "signed" } });
    expect((await v.journal.record(t1(hex(3), other))).pub).toBe(other); // another key is not blocked
    expect((await v.journal.activeT1(me))!.id).toBe(first.id);
    // a never-sent T1 can be abandoned, and then a new one may be signed
    await v.journal.abandon(first.id);
    expect(await v.journal.activeT1(me)).toBeNull();
    const second = await v.journal.record(t1(hex(4)));
    await v.journal.markSending(second.id);
    expect(await code(v.journal.abandon(second.id))).toBe("bad-transition"); // it may be out there
    await v.journal.update(second.id, { state: "failed", error: "inputs spent by another transaction" });
    const third = await v.journal.record(t1(hex(5)));
    await v.journal.update(third.id, { state: "final", inclusionHeight: 1_922_500 });
    expect(await code(v.journal.record(t1(hex(6))))).toBe("t1-exists"); // the reserve exists now
    // after a full refund (seen on chain) the flow retires it, and a new reserve may be created
    expect(await code(v.journal.retireT1(first.id))).toBe("bad-transition"); // abandoned, not final
    expect(await code(v.journal.retireT1(second.id))).toBe("bad-transition"); // failed
    const retired = await v.journal.retireT1(third.id);
    expect(retired.retiredAt).toBe(b.clock.t);
    expect((await v.journal.retireT1(third.id)).retiredAt).toBe(retired.retiredAt);
    expect(await v.journal.activeT1(me)).toBeNull();
    expect((await v.journal.record(t1(hex(6)))).state).toBe("signed");
    expect(await code(v.journal.record(t1(hex(7))))).toBe("t1-exists");
    const w = await v.journal.record(tx(me, hex(8), { inputs: [hex(0x44)] }));
    expect(await code(v.journal.retireT1(w.id))).toBe("bad-transition"); // not a T1
    v.close();
  });

  it("two tabs racing to record a T1: exactly one wins", async () => {
    const b = new FakeBrowser();
    const a = await openTab(b, "a");
    const t = await openTab(b, "b");
    const me = randomPub();
    const r = await Promise.allSettled([a.journal.record(tx(me, hex(7), { kind: "t1" })), t.journal.record(tx(me, hex(8), { kind: "t1" })), a.journal.record(tx(me, hex(9), { kind: "t1" }))]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected").map((x) => (x as PromiseRejectedResult).reason.code)).toEqual(["t1-exists", "t1-exists"]);
    expect([...b.idb.store(DB_NAME, STORE_JOURNAL).values()]).toHaveLength(1);
    await until(() => t.journal.getSnapshot().length === 1, "tab b to see the entry");
    a.close();
    t.close();
  });

  it("sends, observes and closes: transitions, attempts, errors cut to 300 characters", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const pub = randomPub();
    const e = await v.journal.record(tx(pub, hex(1)));
    b.clock.advance(10);
    const s1 = await v.journal.markSending(e.id);
    b.clock.advance(10);
    const s2 = await v.journal.markSending(e.id);
    expect([s1.sendAttempts, s2.sendAttempts, s2.firstSendAt, s2.lastSendAt]).toEqual([1, 2, s1.lastSendAt, b.clock.t]);
    await v.journal.update(e.id, { state: "sent" });
    await v.journal.update(e.id, { state: "mempool", lastHeight: 100 });
    await v.journal.update(e.id, { state: "confirmed", inclusionHeight: 101, lastHeight: 101 });
    await v.journal.update(e.id, { state: "mempool" }); // a reorg
    await v.journal.update(e.id, { state: "confirmed", inclusionHeight: 103 });
    const done = await v.journal.update(e.id, { state: "final", lastHeight: 104, error: "x".repeat(400), meta: { note: "done" } });
    expect(done).toMatchObject({ state: "final", inclusionHeight: 103, lastHeight: 104, meta: { note: "done" } });
    expect(done.error).toHaveLength(300);
    expect(await code(v.journal.update(e.id, { state: "signed" }))).toBe("bad-transition"); // final goes back only after a reorg (below)
    expect(await code(v.journal.update(e.id, { state: "failed" }))).toBe("bad-transition");
    expect(await code(v.journal.markSending(e.id))).toBe("bad-transition");
    expect(await code(v.journal.update(e.id, { state: "abandoned" }))).toBe("bad-transition");
    expect(await code(v.journal.update("nope", { state: "sent" }))).toBe("not-found");
    expect(await code(v.journal.update(e.id, { state: "weird" as never }))).toBe("bad-input");
    // failed can still turn out confirmed: the chain has the last word
    const f = await v.journal.record(tx(pub, hex(2), { inputs: [hex(0x22)] }));
    await v.journal.markSending(f.id);
    await v.journal.update(f.id, { state: "failed" });
    expect((await v.journal.update(f.id, { state: "confirmed" })).state).toBe("confirmed");
    const g = await v.journal.record(tx(pub, hex(3), { inputs: [hex(0x23)] }));
    await v.journal.markSending(g.id);
    await v.journal.update(g.id, { state: "failed" });
    expect((await v.journal.update(g.id, { state: "mempool" })).state).toBe("mempool"); // seen after all
    expect(await code(v.journal.update(g.id, { state: "signed" }))).toBe("bad-transition");
    // a final entry goes back after a reorg deeper than its 2 blocks; abandoned stays closed
    await v.journal.update(g.id, { state: "final" });
    expect((await v.journal.update(g.id, { state: "sent" })).state).toBe("sent");
    expect((await v.journal.markSending(g.id)).sendAttempts).toBe(2);
    v.close();
  });

  it("lists, filters, and reports the boxes that open entries spend", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const me = randomPub();
    const other = randomPub();
    const a1 = await v.journal.record(tx(me, hex(1), { inputs: [hex(0x31), hex(0x32)] }));
    b.clock.advance(5);
    const a2 = await v.journal.record(tx(me, hex(2), { inputs: [hex(0x33)] }));
    b.clock.advance(5);
    await v.journal.record(tx(other, hex(3), { inputs: [hex(0x34)] }));
    await v.journal.update(a2.id, { state: "final" });
    expect((await v.journal.list({ pub: me })).map((e) => e.id)).toEqual([a2.id, a1.id]);
    expect((await v.journal.unresolved(me)).map((e) => e.id)).toEqual([a1.id]);
    expect((await v.journal.list({ open: false })).map((e) => e.id)).toEqual([a2.id]);
    expect([...(await v.journal.inFlightInputs(me))].sort()).toEqual([hex(0x31), hex(0x32)]);
    expect((await v.journal.inFlightInputs()).size).toBe(3);
    v.close();
  });

  it("claims strictly increasing timestamps per scope, kept across reloads and tabs", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    const me = randomPub();
    const to = randomPub();
    const s = buildScope(me);
    expect(s).toBe(`build|${me}`);
    expect(noteScope(me, to)).toBe(`note|${me}|${to}`);
    expect(await v.journal.claimTimestamp(s, 1000.7)).toBe(1000);
    expect(await v.journal.claimTimestamp(s, 900)).toBe(1001); // the clock went back: still after the last
    expect(await v.journal.claimTimestamp(s, 5000)).toBe(5000);
    expect(await v.journal.claimTimestamp(noteScope(me, to), 10)).toBe(10); // scopes are separate
    const t = await openTab(b, "b");
    const many = await Promise.all([...Array(6)].map((_, i) => (i % 2 ? v : t).journal.claimTimestamp(s, 5000)));
    expect(new Set(many).size).toBe(6);
    expect(Math.min(...many)).toBe(5001);
    expect(await t.journal.lastTimestamp(s)).toBe(5006);
    expect(await code(v.journal.claimTimestamp("", 1))).toBe("bad-input");
    expect(await code(v.journal.claimTimestamp(s, Number.NaN))).toBe("bad-input");
    // a claim the server refused for its clock window is taken back, only that one, only downwards
    const ahead = await v.journal.claimTimestamp(s, 900_000);
    expect(await v.journal.rewindTimestamp(s, ahead - 1, 6000)).toBe(false);
    expect(await v.journal.rewindTimestamp(s, ahead, ahead + 5)).toBe(false);
    expect(await v.journal.rewindTimestamp(s, ahead, 6000)).toBe(true);
    expect(await v.journal.claimTimestamp(s, 7000)).toBe(7000);
    expect(await v.journal.rewindTimestamp(s, ahead, 6000)).toBe(false);
    expect(await code(v.journal.rewindTimestamp(s, 1.5, 0))).toBe("bad-input");
    v.close();
    t.close();
  });

  it("keeps nothing when the browser refuses a write", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    b.idb.failNextWrite = "QuotaExceededError";
    await expect(v.journal.record(tx(randomPub(), hex(1)))).rejects.toMatchObject({ code: "storage-failed", detail: { reason: "QuotaExceededError" } });
    expect(await v.journal.list()).toEqual([]);
    v.close();
  });

  it("signToJournal: signs and records before anyone can send; a second T1 is refused before the key is touched", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    await backUp(v);
    const pub = v.getState().key!.pub;
    const id = hex(0xab);
    const msg = new Uint8Array(32).fill(7);
    const entry = await v.signToJournal("t1", (sk) => ({ txId: id, signedRaw: JSON.stringify({ id, proof: bytesToHex(secp256k1.sign(msg, sk).toCompactRawBytes()) }), inputs: [hex(0xcd)] }), { passphrase: PASS });
    expect(entry).toMatchObject({ kind: "t1", pub, state: "signed", sendAttempts: 0, txId: id });
    expect(secp256k1.verify(JSON.parse(entry.signedRaw).proof, msg, pub)).toBe(true);
    let touched = false;
    expect(
      await code(
        v.signToJournal("t1", () => {
          touched = true;
          return { txId: hex(0xef), signedRaw: JSON.stringify({ id: hex(0xef) }), inputs: [hex(1)] };
        }, { passphrase: PASS }),
      ),
    ).toBe("t1-exists");
    expect(touched).toBe(false);
    expect(await code(v.signToJournal("withdraw", () => "nope" as never))).toBe("bad-input");
    v.close();
  });
});
