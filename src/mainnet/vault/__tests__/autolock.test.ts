// Auto-lock: 10 minutes idle, 2 minutes hidden, robust to late timers; and the DOM wiring.
import { describe, expect, it } from "vitest";
import { HIDDEN_LOCK_MS, IDLE_LOCK_MS } from "../constants";
import { attachAutoLock } from "../autolock";
import { FakeBrowser, PASS } from "./fakes";
import { backUp, code, openTab, settle, SIGN_LOCK_NAME } from "./helpers";

describe("mainnet vault: auto-lock", () => {
  it("locks after 10 minutes without activity; activity pushes the deadline", async () => {
    expect([IDLE_LOCK_MS, HIDDEN_LOCK_MS]).toEqual([600_000, 120_000]);
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    expect(v.expiresAt()).toBe(b.clock.t + IDLE_LOCK_MS);
    b.clock.advance(9 * 60_000);
    v.touch();
    expect(v.expiresAt()).toBe(b.clock.t + IDLE_LOCK_MS);
    b.clock.advance(9 * 60_000);
    expect(v.getState().status).toBe("unlocked");
    b.clock.advance(60_000);
    expect(v.getState()).toMatchObject({ status: "locked", lockReason: "idle" });
    expect(v.expiresAt()).toBeNull();
    expect(b.clock.pending).toBe(0);
    await settle();
    expect(b.locks.holder(SIGN_LOCK_NAME)).toBeNull();
    v.close();
  });

  it("locks after 2 minutes hidden; coming back sooner keeps it open", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    v.setHidden(true);
    expect(v.expiresAt()).toBe(b.clock.t + HIDDEN_LOCK_MS);
    b.clock.advance(119_000);
    v.setHidden(false);
    expect(v.getState().status).toBe("unlocked");
    v.setHidden(true);
    b.clock.advance(HIDDEN_LOCK_MS);
    expect(v.getState()).toMatchObject({ status: "locked", lockReason: "hidden" });
    v.close();
  });

  it("a late timer never leaves the key usable: every use checks the clock first", async () => {
    const b = new FakeBrowser();
    const v = await openTab(b);
    await v.create(PASS);
    await backUp(v);
    b.clock.jump(IDLE_LOCK_MS + 1); // no timer fired (a throttled tab, a sleeping laptop)
    v.touch(); // activity after the deadline does not revive the session
    expect(v.getState()).toMatchObject({ status: "locked", lockReason: "idle" });
    await v.unlock(PASS);
    b.clock.jump(IDLE_LOCK_MS + 1);
    expect(await code(v.withSecret("t1", () => 1))).toBe("locked");
    expect(v.getState().lockReason).toBe("idle");
    await v.unlock(PASS);
    v.setHidden(true);
    b.clock.jump(HIDDEN_LOCK_MS + 1);
    v.setHidden(false); // back to the tab: it locks before anything shows
    expect(v.getState()).toMatchObject({ status: "locked", lockReason: "hidden" });
    v.close();
  });

  it("attachAutoLock forwards visibility, throttled activity, pagehide and freeze; detaching stops it", () => {
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const win = new EventTarget();
    const calls: string[] = [];
    let now = 0;
    const stop = attachAutoLock(
      { touch: () => calls.push("touch"), setHidden: (h) => calls.push(`hidden:${h}`), lock: (r) => calls.push(`lock:${r}`) },
      { document: doc, window: win, now: () => now },
    );
    expect(calls).toEqual(["hidden:false"]);
    win.dispatchEvent(new Event("pointerdown"));
    win.dispatchEvent(new Event("keydown"));
    now = 1500;
    win.dispatchEvent(new Event("wheel"));
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pagehide"));
    doc.dispatchEvent(new Event("freeze"));
    expect(calls).toEqual(["hidden:false", "touch", "touch", "hidden:true", "lock:hidden", "lock:hidden"]);
    stop();
    now = 5000;
    win.dispatchEvent(new Event("keydown"));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(calls).toHaveLength(6);
  });
});
