import { describe, expect, it } from "vitest";
import { erg } from "@/protocol";
import { HIDDEN_BLOCK_MS, SPEED_BLOCK_MS } from "../town/worlddata";
import { TOWN_TRACKER, YOU } from "../town/genesis";
import { worldText } from "../i18n";
import { feed } from "../feed";
import { flushTimers, testTown } from "./helpers";

const KEY = "3c".repeat(32); // a fixed test key (play money only)

describe("town commands through the store", () => {
  it("join, pay (cumulative totals), refusals with codes and toasts", async () => {
    const { town } = await testTown();
    const noKey = await town.join();
    expect(noKey).toMatchObject({ ok: false, code: "no-identity" });
    expect((await town.pay({ to: "cafe", amount: 1n })).code).toBe("not-joined");

    await town.importIdentity(KEY, { name: "Tester" });
    const j = await town.join();
    expect(j.ok).toBe(true);
    expect(j.toast.titleKey).toBe("world.toast.join.ok");
    town.flush();
    const s = town.store.getState();
    expect(s.joined).toBe(true);
    expect(s.contacts.map((c) => c.id)).toEqual(["alice", "cafe", "dan"]);
    const eco = town.economy!;
    expect(eco.balance(YOU, "erg")).toBe(erg(50));
    expect(eco.note("alice", YOU, "erg", TOWN_TRACKER)?.totalDebt).toBe(erg("0.5")); // welcome note

    const p1 = await town.pay({ to: "cafe", amount: erg("0.3"), memo: "coffee" });
    expect(p1).toMatchObject({ ok: true, kind: "pay", totalBefore: 0n, totalAfter: erg("0.3") });
    expect(p1.events!.to).toBeGreaterThanOrEqual(p1.events!.from);
    expect(p1.note?.outstanding).toBe(erg("0.3"));
    const p2 = await town.pay({ to: "cafe", amount: erg("0.1") });
    expect(p2).toMatchObject({ ok: true, totalBefore: erg("0.3"), totalAfter: erg("0.4") });
    expect(worldText(p2.toast.titleKey, p2.toast.params, "en")).not.toMatch(/\{|world\./);
    expect(worldText(p2.toast.titleKey, p2.toast.params, "ru")).not.toMatch(/\{|world\./);

    // the café gives newcomers a 2 ERG tab: more is refused by its policy
    const big = await town.pay({ to: "cafe", amount: erg(5) });
    expect(big.ok).toBe(false);
    expect(big.code).toBe("policy-rejected");
    expect(big.toast).toMatchObject({ kind: "alarm", titleKey: "world.toast.refused", detailKey: "world.code.policy-rejected" });
    expect(big.totalAfter).toBe(erg("0.4"));
    expect((await town.pay({ to: YOU, amount: 1n })).code).toBe("self-payment");
    expect((await town.pay({ to: "nobody", amount: 1n })).code).toBe("unknown-participant");

    // outcomes are plain data (structured-clone safe, no class instances)
    expect(() => structuredClone(p1)).not.toThrow();
    town.dispose();
  });

  it("redeem a committed note; previews; reserve lifecycle; policy and credit line", async () => {
    const { town } = await testTown();
    await town.importIdentity(KEY);
    await town.join();
    const pre = town.previewRedeem({ issuer: "alice" })!;
    expect(pre.canRedeemNow).toBe(false);
    expect(pre.blockers.length).toBeGreaterThan(0);
    await town.clock.mine(12); // the tracker commits every 5 blocks; 2 confirmations
    const ready = town.previewRedeem({ issuer: "alice" })!;
    expect(ready.canRedeemNow).toBe(true);
    const r = await town.redeem({ issuer: "alice" });
    expect(r.ok, `${r.code}: ${r.message}`).toBe(true);
    expect(r.amount).toBe(erg("0.5"));
    expect(r.emergency).toBe(false);
    expect(r.txId).toMatch(/^[0-9a-f]{64}$/);
    expect(r.toast.kind).toBe("metal");
    const again = await town.redeem({ issuer: "alice" });
    expect(again.ok).toBe(false);
    expect(again.code).toBeTruthy();

    const pp = town.previewPay({ to: "cafe", amount: erg(1) })!;
    expect(pp.ok).toBe(true);
    expect(pp.trackerOnline).toBe(true);

    const c = await town.createReserve({ amount: erg(10) });
    expect(c.ok, c.message).toBe(true);
    expect((await town.createReserve({ amount: erg(1) })).code).toBe("reserve-exists");
    const top = await town.topUp({ reserve: c.reserve!, amount: erg(2) });
    expect(top.ok, top.message).toBe(true);
    await town.clock.mine(1);
    const ref = await town.initiateRefund({ reserve: c.reserve! });
    expect(ref.ok, ref.message).toBe(true);
    expect(ref.unlockHeight).toBeGreaterThan(town.economy!.clock.height + 40_000);
    const early = await town.completeRefund({ reserve: c.reserve! });
    expect(early.ok).toBe(false);
    expect(early.toast.detailKey).toMatch(/^world\.code\./);

    expect((await town.setPolicy({ preset: "accept-all" })).ok).toBe(true);
    expect((await town.setPolicy({ preset: "nope" as never })).code).toBe("invalid-policy");
    expect((await town.setCreditLine({ debtor: "bob", limit: erg(1) })).ok).toBe(true);
    expect(town.economy!.creditLine(YOU, "bob", "erg")).toBe(erg(1));
    expect((await town.setCreditLine({ debtor: "bob", limit: null })).ok).toBe(true);
    expect(town.economy!.creditLine(YOU, "bob", "erg")).toBeNull();
    const self = await town.selfNote({ amount: erg(1), memo: "reminder" });
    expect(self).toMatchObject({ ok: true, kind: "self-note" });
    town.dispose();
  });

  it("requests: residents answer after a delay, per their policy and limits", async () => {
    const { town } = await testTown();
    await town.importIdentity(KEY);
    await town.join();
    const ok = await town.request({ from: "alice", amount: erg(1), memo: "lunch" });
    const tooMuch = await town.request({ from: "scout", amount: erg(1) });
    expect(ok.ok && tooMuch.ok).toBe(true);
    town.flush();
    expect(town.store.getState().requests.filter((r) => r.status === "pending")).toHaveLength(2);
    await town.clock.tick(6);
    town.flush();
    const by = Object.fromEntries(town.store.getState().requests.map((r) => [r.from, r]));
    expect(by.alice.status).toBe("paid");
    expect(by.scout.status).toBe("declined");
    expect(by.scout.code).toBe("over-limit");
    expect(town.economy!.note("alice", YOU, "erg", TOWN_TRACKER)?.totalDebt).toBe(erg("1.5"));
    const c = await town.request({ from: "bob", amount: erg("0.1") });
    expect((await town.cancelRequest(c.requestId!)).ok).toBe(true);
    town.dispose();
  });

  it("notices: a payment to You and a committed note of yours raise notices", async () => {
    const { town } = await testTown();
    const seen: string[] = [];
    town.onNotice((n) => seen.push(n.titleKey));
    await town.importIdentity(KEY);
    await town.join();
    await town.clock.mine(8);
    await flushTimers();
    expect(seen.some((k) => k.startsWith("world.notice."))).toBe(true);
    town.flush();
    expect(town.store.getState().lastCommit?.trackerId).toBe(TOWN_TRACKER);
    town.dispose();
  });
});

describe("clock and bots", () => {
  it("bots are deterministic for a seed; a jump (mine) lets nobody act", async () => {
    const hashes: string[] = [];
    for (let i = 0; i < 2; i++) {
      const { town } = await testTown();
      await town.importIdentity(KEY);
      await town.join();
      await town.clock.tick(120);
      hashes.push(town.economy!.stateHash());
      town.dispose();
    }
    expect(hashes[0]).toBe(hashes[1]);

    const { town } = await testTown();
    const eco = town.economy!;
    const from = eco.events.length;
    await town.clock.mine(40);
    expect(eco.events.slice(from).some((e) => e.type === "note.issued")).toBe(false);
    const from2 = eco.events.length;
    await town.clock.tick(40);
    expect(eco.events.slice(from2).filter((e) => e.type === "note.issued").length).toBeGreaterThan(0);
    // a different seed lives a different life
    const { town: other } = await testTown({ seed: "sandbox-town/other" });
    await other.clock.tick(40);
    expect(other.economy!.stateHash()).not.toBe(eco.stateHash());
    town.dispose();
    other.dispose();
  });

  it("speeds, pause, and slowing down in a hidden tab", async () => {
    const { town } = await testTown({ autoClock: true });
    await town.clock.setSpeed("turbo");
    town.flush();
    expect(town.store.getState().clock).toMatchObject({ speed: "turbo", blockMs: SPEED_BLOCK_MS.turbo, running: true });
    const h0 = town.economy!.clock.height;
    await flushTimers(SPEED_BLOCK_MS.turbo! * 3 + 120);
    expect(town.economy!.clock.height).toBeGreaterThanOrEqual(h0 + 2);
    town.setHidden(true);
    town.flush();
    expect(town.store.getState().clock.blockMs).toBe(HIDDEN_BLOCK_MS);
    const h1 = town.economy!.clock.height;
    await flushTimers(SPEED_BLOCK_MS.turbo! * 3);
    expect(town.economy!.clock.height).toBe(h1);
    town.setHidden(false);
    await town.clock.pause();
    town.flush();
    expect(town.store.getState().clock).toMatchObject({ speed: "paused", blockMs: null, running: false });
    const h2 = town.economy!.clock.height;
    await flushTimers(SPEED_BLOCK_MS.turbo! * 3);
    expect(town.economy!.clock.height).toBe(h2);
    expect((await town.clock.setSpeed("warp" as never)).code).toBe("invalid-speed");
    town.dispose();
  });

  it("the feed describes the town in both languages", async () => {
    const { town } = await testTown();
    await town.importIdentity(KEY);
    await town.join();
    await town.pay({ to: "cafe", amount: erg("0.2"), memo: "tea" });
    await town.clock.tick(10);
    for (const lang of ["en", "ru"] as const) {
      const items = feed(town.economy!, { limit: 30 }, lang, { cast: true });
      expect(items.length).toBeGreaterThan(5);
      for (const it of items) expect(it.text, it.type).not.toMatch(/\{[a-z]+\}|world\.|undefined|NaN/);
      expect(items[0].seq).toBeGreaterThan(items[items.length - 1].seq);
    }
    town.dispose();
  });
});
