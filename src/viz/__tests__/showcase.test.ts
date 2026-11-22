// The /lab/viz showcase on the real Ergo AVL+ backend: the honest redemption passes, the cheat fails exactly at
// properlyRedeemed with the actual-vs-required finding, the proof viewer's data verifies, and the context variables
// of real redeem transactions come out in the Scala order content documents.
import { beforeAll, describe, expect, test } from "vitest";
import { loadErgoAvlBackend } from "@/protocol/avl-wasm";
import { hexToBytes, type AvlBackend } from "@/protocol";
import { contextVarOrder } from "@/content/contracts";
import { buildShowcase, newEconomy, STORY, type Showcase } from "@/features/vizlab/demo";
import { buildRows, findingFor, resolveEvaluation, verdictOf } from "../contract/model";
import { mapOf, sourceOf } from "../contract/model";
import { ladderModel } from "../clocks/model";
import { proofAnatomy, rootMatches } from "../avl/proof";
import { extensionRows } from "../tx/contextVars";
import { reserveInputIndex } from "../tx/TxLens";
import { ERG_UNIT } from "../core/format";

/** House typography → plain text: word joiners out, NBSP / thin spaces → spaces. */
const plain = (x: string) => x.replace(/\u2060/g, "").replace(/[\u00a0\u2009\u202f]/g, " ");

let backend: AvlBackend;
let s: Showcase;
beforeAll(async () => {
  backend = await loadErgoAvlBackend();
  s = buildShowcase(backend);
});

describe("showcase on live engine data", () => {
  test("the cheat fails at properlyRedeemed, and the finding says actual vs required", () => {
    expect(s.honest.ok).toBe(true);
    expect(s.cheat.ok).toBe(false);
    expect(s.cheat.stage).toBe("contract");
    const bad = s.cheat.eval!.checks.find((c) => c.outcome === "false" || c.outcome === "throws");
    expect(bad?.id).toBe("properlyRedeemed");
    expect(plain(findingFor(bad!, { lang: "en", unit: ERG_UNIT, tx: s.cheat.tx ?? null }))).toBe("redeemed 1.50 ERG > owed − already redeemed 1.20 ERG (= 2.00 ERG − 0.80 ERG)");
    expect(plain(findingFor(bad!, { lang: "ru", unit: ERG_UNIT, tx: s.cheat.tx ?? null }))).toMatch(/1\.50.*1\.20/);
  });

  test("the X-ray rows follow the engine's order and the verdict names the failing check", () => {
    const resolved = resolveEvaluation(s.cheat);
    const src = sourceOf("basis");
    const rows = buildRows({ contract: "basis", action: 0, map: mapOf("basis", src.lines), resolved, lang: "en", unit: ERG_UNIT });
    expect(rows.map((r) => r.id)).toEqual(s.cheat.eval!.checks.map((c) => c.id));
    const v = verdictOf(resolved);
    expect(v.kind).toBe("fail");
    expect(v.check).toBe("properlyRedeemed");
  });

  test("note status: local → pending → confirmed, and only then can Bob redeem", () => {
    const [l, p, c] = [ladderModel(s.ladder.local), ladderModel(s.ladder.pending), ladderModel(s.ladder.confirmed)];
    expect([l.status, p.status, c.status]).toEqual(["local", "pending", "confirmed"]);
    expect(l.canRedeemNow || p.canRedeemNow).toBe(false);
    expect(c.canRedeemNow).toBe(true);
    expect(l.etaBlocks).toBeLessThanOrEqual(5 + 5);
    expect(c.etaBlocks).toBe(0);
  });

  test("the proof Bob's redemption carried recomputes the committed digest (MATCH) and a flipped byte does not", () => {
    expect(s.backend.simulated).toBe(false);
    const p = hexToBytes(s.proof!.proof);
    const d = hexToBytes(s.proof!.digest);
    expect(rootMatches(proofAnatomy(p, backend), d)).toBe(true);
    expect(backend.verifier!.lookup(d, s.proof!.key, p)).toBeTruthy();
    const q = p.slice();
    q[2] ^= 1;
    expect(rootMatches(proofAnatomy(q, backend), d)).not.toBe(true);
  });

  test("context variables of real redemptions come out in the Scala order (first and later redemption)", () => {
    const first = extensionRows(s.honest.tx!.contextVars[reserveInputIndex(s.honest.tx!)]).map((r) => r.id);
    expect(first).toEqual([...contextVarOrder.firstRedemption]);
    const later = extensionRows(s.cheat.tx!.contextVars[reserveInputIndex(s.cheat.tx!)]).map((r) => r.id);
    expect(later).toEqual([...contextVarOrder.laterRedemption]);
  });

  test("every other transaction kind is there: top up, exit announcement, clearing", () => {
    expect(s.topUp.ok && !!s.topUp.tx).toBe(true);
    expect(s.refund.ok && !!s.refund.tx).toBe(true);
    expect(s.clearing?.ok && !!s.clearing.tx).toBe(true);
  });

  test("the interactive story runs every step", () => {
    const eco = newEconomy(backend);
    for (const st of STORY) st.run(eco);
    expect(eco.events.some((e) => e.type === "reserve.redeemed")).toBe(true);
    expect(eco.events.some((e) => e.type === "redemption.rejected")).toBe(true);
  });
});
