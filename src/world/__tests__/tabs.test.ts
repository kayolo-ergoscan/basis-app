// Multi-tab: one leader runs the clock and writes storage; followers mirror its log, send commands to it, take
// over when it closes; a reset reaches every tab. Tabs share storage (IndexedDB, localStorage) as in a browser.
import { describe, expect, it } from "vitest";
import { erg } from "@/protocol";
import { MemoryKV } from "../persist";
import { electLeader, LocalChannelHub, LocalLocks, localTabEnv, type TabRole } from "../tabs";
import { YOU } from "../town/genesis";
import type { Town } from "../town";
import { flushTimers, memWalletStorage, testTown } from "./helpers";

const KEY = "5a".repeat(32);

async function until(cond: () => boolean, ms = 3000, what = "condition"): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${what}`);
    await flushTimers(5);
  }
}

const hashOf = (t: Town) => t.economy?.stateHash() ?? null;

describe("multi-tab", () => {
  it("electLeader: one leader; the next tab is promoted when it stops", async () => {
    const locks = new LocalLocks();
    const hub = new LocalChannelHub();
    const roles: Record<string, TabRole[]> = { a: [], b: [], c: [] };
    const stopA = electLeader(localTabEnv(locks, hub, "a"), "x", (r) => roles.a.push(r));
    await flushTimers();
    const stopB = electLeader(localTabEnv(locks, hub, "b"), "x", (r) => roles.b.push(r));
    const stopC = electLeader(localTabEnv(locks, hub, "c"), "x", (r) => roles.c.push(r));
    await flushTimers();
    expect(roles).toEqual({ a: ["leader"], b: ["follower"], c: ["follower"] });
    stopA();
    await flushTimers();
    expect(roles.b).toEqual(["follower", "leader"]);
    expect(roles.c).toEqual(["follower"]);
    stopB();
    await flushTimers();
    expect(roles.c).toEqual(["follower", "leader"]);
    stopC();
    // no Web Locks: solo
    const solo: TabRole[] = [];
    electLeader({ locks: null, channel: () => null, tabId: "s" }, "x", (r) => solo.push(r));
    expect(solo).toEqual(["solo"]);
  });

  it("a follower mirrors the leader, commands go through the leader, the follower takes over, reset reaches all", async () => {
    const locks = new LocalLocks();
    const hub = new LocalChannelHub();
    const kv = new MemoryKV();
    const storage = memWalletStorage();
    const { town: a } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "tab-a") });
    expect(a.tabRole).toBe("leader");
    await a.importIdentity(KEY, { name: "Two tabs" });
    await a.join();
    await a.clock.tick(5);

    const { town: b } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "tab-b") });
    expect(b.tabRole).toBe("follower");
    b.flush();
    expect(b.store.getState().role).toBe("follower");
    expect(hashOf(b)).toBe(hashOf(a));
    expect(b.store.getState().joined).toBe(true);

    // live events stream to the follower
    await a.clock.tick(3);
    await until(() => hashOf(b) === hashOf(a), 3000, "follower catch-up");

    // a command in the follower runs in the leader and returns its outcome
    const p = await b.pay({ to: "cafe", amount: erg("0.25"), memo: "from tab b" });
    expect(p.ok, p.message).toBe(true);
    expect(p.totalAfter).toBe(erg("0.25"));
    expect(a.economy!.note(YOU, "cafe")?.totalDebt).toBe(erg("0.25"));
    await until(() => hashOf(b) === hashOf(a), 3000, "follower sees its own payment");
    // world data (contacts, requests, speed) follows too
    await b.contacts.add("bob", { label: "from b" });
    await until(() => b.store.getState().contacts.some((c) => c.label === "from b"), 3000, "contacts in follower");
    expect(a.store.getState().contacts.some((c) => c.label === "from b")).toBe(true);
    // the follower never runs a clock of its own
    expect(b.store.getState().clock.speed).toBe(a.store.getState().clock.speed);

    // the leader tab closes: the follower becomes the leader with the same history and keeps saving
    await a.saveNow();
    const before = hashOf(a);
    a.dispose();
    await until(() => b.tabRole === "leader", 3000, "promotion");
    await until(() => b.store.getState().status === "ready", 3000, "ready as leader");
    expect(hashOf(b)).toBe(before);
    const p2 = await b.pay({ to: "cafe", amount: erg("0.05") });
    expect(p2).toMatchObject({ ok: true, totalBefore: erg("0.25"), totalAfter: erg("0.3") });

    // a third tab joins the new leader; a reset in the leader reaches it
    const { town: c } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "tab-c") });
    expect(c.tabRole).toBe("follower");
    expect(hashOf(c)).toBe(hashOf(b));
    const epoch = b.store.getState().epoch;
    expect((await c.reset()).ok).toBe(true);
    await until(() => c.store.getState().epoch !== epoch && hashOf(c) === hashOf(b), 3000, "reset in follower");
    expect(b.store.getState().epoch).not.toBe(epoch);
    expect(c.economy!.participants.has(YOU)).toBe(true); // rejoined with the same key

    // a new tab after everything restores from storage written by the promoted leader
    b.dispose();
    await until(() => c.tabRole === "leader", 3000, "second promotion");
    await c.saveNow();
    const finalHash = hashOf(c);
    c.dispose();
    const { town: d } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "tab-d") });
    expect(d.tabRole).toBe("leader");
    expect(d.store.getState().load.restored).toBe(true);
    expect(hashOf(d)).toBe(finalHash);
    d.dispose();
  });

  it("a visible follower drives the clock of a hidden leader", async () => {
    const locks = new LocalLocks();
    const hub = new LocalChannelHub();
    const kv = new MemoryKV();
    const storage = memWalletStorage();
    const { town: a } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "a"), autoClock: true });
    await a.clock.setSpeed("turbo");
    const { town: b } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "b"), autoClock: true });
    a.setHidden(true);
    await flushTimers(50);
    const h0 = a.economy!.clock.height;
    await flushTimers(1000);
    a.flush();
    // without the drive the hidden leader would mine one block per 30 s
    expect(a.economy!.clock.height).toBeGreaterThanOrEqual(h0 + 3);
    expect(a.store.getState().clock.driven).toBe(true);
    await until(() => hashOf(b) === hashOf(a), 3000, "follower in sync");
    a.dispose();
    b.dispose();
  });

  it("a follower without a leader answering reports a timeout instead of hanging", async () => {
    const locks = new LocalLocks();
    const hub = new LocalChannelHub();
    const kv = new MemoryKV();
    const storage = memWalletStorage();
    const { town: a } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "a") });
    const { town: b } = await testTown({ kv, storage, tabs: localTabEnv(locks, hub, "b"), rpcTimeoutMs: 200 });
    // the leader hangs (a frozen tab): it stops answering but keeps the lock
    (a as unknown as { onMessage: () => void }).onMessage = () => {};
    const r = await b.clock.mine(1);
    expect(r).toMatchObject({ ok: false, code: "tab-timeout" });
    a.dispose();
    b.dispose();
  });
});
