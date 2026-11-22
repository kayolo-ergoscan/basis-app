// The IndexedDB adapter on the test double: atomic writes, no lost updates, and the browser rule that a transaction
// ends when its callback awaits anything that is not one of its own requests.
import { describe, expect, it } from "vitest";
import { STORE_JOURNAL, STORE_META, STORE_VAULT } from "../constants";
import { VaultDb } from "../db";
import { VaultError } from "../errors";
import { FakeIDBFactory, task } from "./fakes";

describe("vault database", () => {
  it("creates its three stores once and keeps data across reopening", async () => {
    const idb = new FakeIDBFactory();
    const db = await VaultDb.open(idb.asFactory(), "t");
    await db.write(async (t) => {
      await t.put(STORE_VAULT, "k", { a: 1 });
      await t.put(STORE_JOURNAL, "j", { b: 2 });
      await t.put(STORE_META, "m", 3);
    });
    db.close();
    const again = await VaultDb.open(idb.asFactory(), "t");
    expect(await again.read((t) => t.get(STORE_VAULT, "k"))).toEqual({ a: 1 });
    expect(await again.read((t) => t.getAll(STORE_JOURNAL))).toEqual([{ b: 2 }]);
    expect(await again.read((t) => t.keys(STORE_META))).toEqual(["m"]);
    expect(idb.dbs.get("t")!.version).toBe(1);
  });

  it("rolls back a write that throws or whose request fails, and passes a VaultError through", async () => {
    const idb = new FakeIDBFactory();
    const db = await VaultDb.open(idb.asFactory(), "t");
    await expect(
      db.write(async (t) => {
        await t.put(STORE_META, "a", 1);
        throw new VaultError("bad-input", "stop");
      }),
    ).rejects.toMatchObject({ code: "bad-input" });
    expect(await db.read((t) => t.get(STORE_META, "a"))).toBeUndefined();
    await expect(
      db.write(async (t) => {
        await t.put(STORE_META, "c", 1);
        idb.failNextWrite = "QuotaExceededError";
        await t.put(STORE_META, "d", 2);
      }),
    ).rejects.toMatchObject({ code: "storage-failed", detail: { reason: "QuotaExceededError" } });
    expect(await db.read((t) => t.keys(STORE_META))).toEqual([]);
  });

  it("serialises read-modify-write transactions (no lost update)", async () => {
    const db = await VaultDb.open(new FakeIDBFactory().asFactory(), "t");
    await db.write((t) => t.put(STORE_META, "n", 0));
    await Promise.all(
      Array.from({ length: 12 }, () =>
        db.write(async (t) => {
          const n = (await t.get<number>(STORE_META, "n"))!;
          await t.put(STORE_META, "n", n + 1);
        }),
      ),
    );
    expect(await db.read((t) => t.get(STORE_META, "n"))).toBe(12);
  });

  it("ends a transaction whose callback awaits something else, as a browser does", async () => {
    const db = await VaultDb.open(new FakeIDBFactory().asFactory(), "t");
    await expect(
      db.write(async (t) => {
        await new Promise((r) => setTimeout(r, 5));
        await t.put(STORE_META, "x", 1);
      }),
    ).rejects.toMatchObject({ code: "storage-failed" });
    expect(await db.read((t) => t.get(STORE_META, "x"))).toBeUndefined();
    // a request placed in a later task is refused even while an earlier one is still pending
    await expect(
      db.write(async (t) => {
        const first = t.put(STORE_META, "a", 1);
        first.catch(() => undefined);
        await new Promise<void>((r) => task(r));
        await t.put(STORE_META, "b", 2);
      }),
    ).rejects.toMatchObject({ code: "storage-failed", detail: { reason: "TransactionInactiveError" } });
    expect(await db.read((t) => t.keys(STORE_META))).toEqual([]);
    // reads may not write
    await expect(db.read((t) => t.put(STORE_META, "y", 1))).rejects.toMatchObject({ code: "storage-failed", detail: { reason: "ReadOnlyError" } });
  });
});
