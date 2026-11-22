// Several tabs of one browser: one signer at a time (Web Locks), take-over, cross-tab state, fail-closed without locks.
import { describe, expect, it } from "vitest";
import { DB_NAME, KEY_RECORD_ID, STORE_VAULT } from "../constants";
import { openVault } from "../vault";
import { FakeBrowser, OTHER_PASS, PASS, TEST_ITERATIONS } from "./fakes";
import { backUp, code, openTab, settle, SIGN_LOCK_NAME, until } from "./helpers";

describe("mainnet vault: tabs", () => {
  it("only one tab holds the signer; another gets locked-elsewhere, can take over, and the first locks at once", async () => {
    const b = new FakeBrowser();
    const a = await openTab(b, "a");
    await a.create(PASS);
    await backUp(a);
    const t = await openTab(b, "b");
    expect(t.getState()).toMatchObject({ status: "locked", backedUp: true });
    expect(await t.signingElsewhere()).toBe(true);
    expect(await a.signingElsewhere()).toBe(false);
    expect(await code(t.unlock(PASS))).toBe("locked-elsewhere");
    expect(await code(t.wipe())).toBe("locked-elsewhere");
    expect(a.getState().status).toBe("unlocked");

    await t.unlock(PASS, { takeOver: true });
    await until(() => a.getState().status === "locked", "tab a to lock");
    expect(a.getState()).toMatchObject({ status: "locked", lockReason: "taken-over" });
    expect(t.getState().status).toBe("unlocked");
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBe("b");
    expect(await code(a.withSecret("t1", () => 1))).toBe("locked");
    expect(await t.withSecret("redeem", () => 2)).toBe(2);
    expect(await a.signingElsewhere()).toBe(true);

    t.lock();
    await settle();
    expect(await a.signingElsewhere()).toBe(false);
    await a.unlock(PASS);
    expect(a.getState().status).toBe("unlocked");
    a.close();
    t.close();
  });

  it("a wrong passphrase on take-over still frees the lock it took", async () => {
    const b = new FakeBrowser();
    const a = await openTab(b, "a");
    await a.create(PASS);
    const t = await openTab(b, "b");
    expect(await code(t.unlock(OTHER_PASS, { takeOver: true }))).toBe("wrong-passphrase");
    await until(() => a.getState().status === "locked", "tab a to lock");
    await settle();
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    a.close();
    t.close();
  });

  it("tabs follow each other: a key created, backed up or wiped in one tab shows in the others", async () => {
    const b = new FakeBrowser();
    const a = await openTab(b, "a");
    const t = await openTab(b, "b");
    expect(t.getState().status).toBe("none");
    await a.create(PASS);
    await until(() => t.getState().status === "locked", "tab b to see the key");
    expect(t.getState()).toMatchObject({ backedUp: false, key: { pub: a.getState().key!.pub } });
    await backUp(a);
    await until(() => t.getState().backedUp, "tab b to see the backup");
    a.lock();
    await settle();
    await t.wipe();
    await until(() => a.getState().status === "none", "tab a to see the wipe");
    a.close();
    t.close();
  });

  it("two tabs creating a key at once: exactly one key is made", async () => {
    const b = new FakeBrowser();
    const a = await openTab(b, "a");
    const t = await openTab(b, "b");
    const r = await Promise.allSettled([a.create(PASS), t.create(OTHER_PASS)]);
    const codes = r.map((x) => (x.status === "fulfilled" ? "ok" : (x.reason as { code: string }).code));
    expect(codes.filter((c) => c === "ok")).toHaveLength(1);
    expect(["exists", "locked-elsewhere"]).toContain(codes.find((c) => c !== "ok"));
    expect(b.idb.store(DB_NAME, STORE_VAULT).has(KEY_RECORD_ID)).toBe(true);
    a.close();
    t.close();
  });

  it("fails closed without Web Locks, IndexedDB or WebCrypto", async () => {
    const b = new FakeBrowser();
    const noLocks = await openVault({ env: b.env("a", { locks: null }), unsafeTestKdfIterations: TEST_ITERATIONS });
    expect(noLocks.getState()).toMatchObject({ status: "unsupported", missing: ["web-locks"] });
    expect(await code(noLocks.create(PASS))).toBe("unsupported");
    expect(await code(noLocks.unlock(PASS))).toBe("unsupported");
    noLocks.close();
    const bare = await openVault({ env: b.env("a", { indexedDB: null, crypto: null }), unsafeTestKdfIterations: TEST_ITERATIONS });
    expect(bare.getState()).toMatchObject({ status: "unsupported", missing: ["indexeddb", "webcrypto"] });
    expect(await code(bare.journal.list())).toBe("unsupported");
    expect(await code(bare.restoreFromBackup("{}", PASS))).toBe("unsupported");
    bare.close();
  });

  it("refuses malformed options", async () => {
    const b = new FakeBrowser();
    expect(await code(openVault({ env: b.env("a"), unsafeTestKdfIterations: 0 }))).toBe("bad-input");
    expect(await code(openVault({ env: b.env("a"), idleLockMs: 10 }))).toBe("bad-input");
  });
});
