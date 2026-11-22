// The home story runs end to end on the engine: real keys, signatures, a committed digest, a lookup proof that
// matches, a top-up and a redemption the contract accepts. Run with: scripts/check.sh test src/features/home
import { describe, expect, it } from "vitest";
import { SIMULATED_AVL } from "@/protocol";
import { loadErgoAvlBackend } from "@/protocol/avl-wasm";
import { SANDBOX_GENESIS_HEIGHT } from "@/world";
import { Story, STORY, storyKeys } from "./story";

async function backends() {
  const out = [SIMULATED_AVL];
  try {
    out.push(await loadErgoAvlBackend());
  } catch {
    /* wasm unavailable in this environment: the simulated run still covers the flow */
  }
  return out;
}

describe("home story", () => {
  it("knows the pair key before the economy exists", () => {
    const s = new Story(SIMULATED_AVL);
    expect(storyKeys().noteKey).toBe(s.open().noteKey);
    expect(storyKeys().alicePub).toBe(s.snap().alicePub);
  });

  it("runs the whole story on every backend", async () => {
    const bs = await backends();
    expect(bs.map((b) => b.simulated)).toEqual([true, false]); // the real Ergo AVL+ (wasm) runs under node too
    for (const b of bs) {
      const s = new Story(b);
      const a = s.open();
      expect(a.v0?.total).toBe(STORY.start);
      expect(a.v1?.total).toBe(STORY.first);
      expect(a.v1?.sigT).toMatch(/^[0-9a-f]{130}$/);
      expect(a.v1?.issuerOk).toBe(true);
      expect(a.commit).toBeNull();
      expect(a.v1?.sigA).toMatch(/^[0-9a-f]{130}$/);

      const r = s.raise();
      expect(r.v2?.total).toBe(STORY.first + STORY.raise);
      expect(r.v2?.sigT).toMatch(/^[0-9a-f]{130}$/);
      expect(r.v2?.trackerOk).toBe(true);
      expect(r.v2?.issuerOk).toBe(true);
      expect(r.commit).toBeNull();

      const c = s.commit();
      expect(c.commit).not.toBeNull();
      expect(c.commit?.digest).toMatch(/^[0-9a-f]{66}$/);
      expect(c.commit?.digest).not.toBe(c.genesis?.digest);
      expect(c.commit!.height).toBeGreaterThan(c.genesis!.height);
      // sandbox blocks are counted from 1, so they never look like real Ergo blocks (≈ 1.9 M)
      expect(c.genesis!.height).toBeGreaterThanOrEqual(SANDBOX_GENESIS_HEIGHT);
      expect(c.commit!.height).toBeLessThan(1_000);
      expect(Math.round(c.reserve.coverage ?? 0)).toBe(132);

      const p = s.check();
      expect(p.proof?.match).toBe(true);
      expect(p.proof?.total).toBe(STORY.first + STORY.raise);
      expect(p.proof?.bytes).toBeGreaterThan(0);

      const t = s.topUp();
      expect(t.reserve.collateral).toBeCloseTo(STORY.reserve + STORY.topUp, 6);

      const d = s.redeem();
      expect(d.lastRedeem?.ok).toBe(true);
      expect(d.lastRedeem?.amount).toBe(STORY.redeem);
      expect(d.lastRedeem?.passed).toBe(d.lastRedeem?.checks);
      expect(d.redeemed).toBe(STORY.redeem);
      expect(d.v2?.total).toBe(STORY.first + STORY.raise);
      expect(d.tape.map((x) => x.kind)).toEqual(["REDEEM", "TOP UP", "CHECK", "COMMIT", "WITNESS", "NOTE", "NOTE", "NOTE", "RESERVE"]);
    }
  });
});
