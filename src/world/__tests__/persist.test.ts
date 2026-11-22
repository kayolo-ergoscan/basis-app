import { describe, expect, it } from "vitest";
import { eventsToJson } from "@/protocol";
import { LocalStorageKV, MemoryKV, TownLog, type StorageLike } from "../persist";
import { YOU } from "../town/genesis";
import { memWalletStorage, testTown, wasmBackend } from "./helpers";

function fakeLocalStorage(): StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

describe("persistence", () => {
  it("TownLog: chunked incremental saves round-trip; a new epoch rewrites; corruption is detected", async () => {
    const { town } = await testTown();
    const eco = town.economy!;
    const kv = new MemoryKV();
    const log = new TownLog(kv, "town/test", 64);
    const meta = { epoch: "e1", backend: "x", seed: "s", genesisTimeMs: "0" };
    const half = Math.floor(eco.events.length / 2);
    expect(eco.events.length).toBeGreaterThan(64); // several chunks
    await log.save(eco.events.slice(0, half), meta);
    expect(log.savedEvents).toBe(half);
    await log.save(eco.events, meta);
    const fresh = new TownLog(kv, "town/test", 64);
    const back = await fresh.load();
    expect(back!.events.length).toBe(eco.events.length);
    expect(eventsToJson(back!.events)).toBe(eventsToJson(eco.events));
    // another epoch (a reset town or a new writer) writes every chunk again
    let writes = 0;
    const spy = new MemoryKV();
    const orig = spy.setMany.bind(spy);
    spy.setMany = async (entries) => {
      writes += entries.length;
      return orig(entries);
    };
    const l2 = new TownLog(spy, "k", 64);
    await l2.save(eco.events, meta);
    const full = writes;
    writes = 0;
    await l2.save(eco.events, meta);
    expect(writes).toBe(1); // nothing new: meta only
    writes = 0;
    await l2.save(eco.events, { ...meta, epoch: "e2" });
    expect(writes).toBe(full);
    // a log written with another chunk size is rewritten whole, never patched with mismatched chunks
    const kv3 = new MemoryKV();
    await new TownLog(kv3, "k3", 100).save(eco.events.slice(0, eco.events.length - 3), meta);
    const l3 = new TownLog(kv3, "k3", 64);
    expect((await l3.load())!.events.length).toBe(eco.events.length - 3);
    await l3.save(eco.events, meta);
    expect(eventsToJson((await new TownLog(kv3, "k3", 64).load())!.events)).toBe(eventsToJson(eco.events));
    // a missing chunk is reported, not silently skipped
    await kv.delMany(["town/test#000001"]);
    await expect(new TownLog(kv, "town/test", 64).load()).rejects.toThrow(/missing/);
    town.dispose();
  });

  it("LocalStorageKV keeps bigint-safe JSON", async () => {
    const ls = fakeLocalStorage();
    const kv = new LocalStorageKV(ls);
    await kv.setMany([["a", { json: "[1]" }], ["a#1", { n: 2 }]]);
    expect(await kv.get("a")).toEqual({ json: "[1]" });
    expect(await kv.keys("a")).toEqual(["a", "a#1"]);
    await kv.delMany(["a"]);
    expect(await kv.get("a")).toBeUndefined();
    expect([...ls.map.keys()].every((k) => k.startsWith("basis.world.kv."))).toBe(true);
  });

  it("a town survives a reload: same state hash, world data and wallet", async () => {
    const kv = new MemoryKV();
    const storage = memWalletStorage();
    const { town: a } = await testTown({ kv, storage });
    await a.createIdentity({ name: "Tester" });
    expect((await a.join()).ok).toBe(true);
    expect((await a.pay({ to: "cafe", amount: 300_000_000n })).ok).toBe(true);
    await a.request({ from: "alice", amount: 100_000_000n, memo: "lunch" });
    await a.contacts.add("bob", { label: "Bobby", favorite: true });
    await a.clock.tick(25);
    await a.clock.setSpeed("turbo");
    await a.saveNow();
    const hash = a.economy!.stateHash();
    const world = a.worldData();
    const events = a.economy!.events.length;
    a.dispose();

    const { town: b } = await testTown({ kv, storage });
    const s = b.store.getState();
    expect(s.load.restored).toBe(true);
    expect(s.load.events).toBe(events);
    expect(s.load.ms).toBeLessThan(300);
    expect(b.economy!.stateHash()).toBe(hash);
    expect(b.worldData()).toEqual(world);
    expect(s.clock.speed).toBe("turbo");
    expect(s.joined).toBe(true);
    expect(b.wallet.identity?.name).toBe("Tester");
    expect(s.contacts.find((c) => c.id === "bob")?.label).toBe("Bobby");
    // the restored town keeps working
    expect((await b.pay({ to: "cafe", amount: 1_000_000n })).ok).toBe(true);
    b.dispose();
  });

  it("takes the key back from the town's log when the browser lost the wallet record", async () => {
    const kv = new MemoryKV();
    const { town: a } = await testTown({ kv });
    await a.createIdentity();
    await a.join();
    const pub = a.wallet.identity!.pubHex;
    await a.saveNow();
    a.dispose();
    const { town: b } = await testTown({ kv, storage: memWalletStorage() });
    expect(b.wallet.identity?.pubHex).toBe(pub);
    expect(b.wallet.identity?.source).toBe("restored");
    expect(b.economy!.participants.get(YOU)?.pub).toBe(pub);
    b.dispose();
  });

  it("a new or wiped key starts a new town; reset() starts again and rejoins", async () => {
    const { town } = await testTown();
    await town.createIdentity();
    await town.join();
    await town.clock.tick(10);
    const epoch1 = town.store.getState().epoch;
    await town.createIdentity({ replace: true });
    await town.pay({ to: "cafe", amount: 1n }); // any command reconciles first
    town.flush();
    expect(town.store.getState().epoch).not.toBe(epoch1);
    expect(town.store.getState().joined).toBe(false);
    expect((await town.join()).ok).toBe(true);
    expect(town.economy!.p(YOU).pub).toBe(town.wallet.identity!.pubHex);

    const epoch2 = town.store.getState().epoch;
    const r = await town.reset();
    expect(r.ok).toBe(true);
    town.flush();
    expect(town.store.getState().epoch).not.toBe(epoch2);
    expect(town.store.getState().joined).toBe(true);

    await town.wipeWallet();
    town.flush();
    expect(town.wallet.identity).toBeNull();
    expect(town.store.getState().joined).toBe(false);
    town.dispose();
  });

  it("an unreadable stored town is replaced by a new one, with a note", async () => {
    const kv = new MemoryKV();
    const avl = await wasmBackend();
    const { town: a } = await testTown({ kv });
    await a.saveNow();
    a.dispose();
    const key = `town/sandbox-town/v1/${avl.id}`;
    await kv.delMany([`${key}#000000`]);
    const { town: b } = await testTown({ kv });
    expect(b.store.getState().load.restored).toBe(false);
    expect(b.store.getState().load.note).toMatch(/could not be read/);
    b.dispose();
  });
});
