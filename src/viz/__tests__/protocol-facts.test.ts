// Facts the X-rays draw: the spec's Schnorr vectors, the Scala map order of context variables, the 80-byte message
// layout, debt keys, the template hashes, and the clocks' block arithmetic.
import seedJson from "@/chain/seed.json";
import { describe, expect, test } from "vitest";
import { debtKey, EMERGENCY_BLOCKS, messageLayout, noteMessage, REFUND_PERIOD_BLOCKS, reserveKey, verify } from "@/protocol";
import { contextVarOrder } from "@/content/contracts";
import { p2sAddress, templateHashSync } from "@/chain/decode";
import { runSelfTest } from "../signature/SelfTest";
import { SCHNORR_VECTORS } from "../signature/vectors";
import { scalaMapOrder } from "../tx/contextVars";
import { buildMessage, MESSAGE_LAYOUT, parseAmountInput, u64BE } from "../tools/MessageBuilder";
import { debtKeyParts } from "../tools/DebtKeyTool";
import { noteMessageOf, parseNoteJson, sampleNoteJson, tv001Json } from "../tools/NoteVerifyTool";
import { analyzeTemplate, KNOWN_TEMPLATES, knownTemplates, SAMPLE_TREES, sha256Hex } from "../tools/template";
import { emergencyModel, exitModel, ladderModel } from "../clocks/model";
import { labKey, LAB_TRACKER_NFT } from "../core/lab";
import { toHexStr } from "../core/format";

describe("Schnorr test vectors (SCHNORR_SIGNATURE_SPEC.md)", () => {
  test("TV001 valid, TV002–TV004 invalid, each for the expected rule", () => {
    const r = runSelfTest();
    expect(r.map((x) => [x.v.id, x.ok])).toEqual([
      ["TV001", true],
      ["TV002", false],
      ["TV003", false],
      ["TV004", false],
    ]);
    expect(r.every((x) => x.pass)).toBe(true);
    expect(r.find((x) => x.v.id === "TV003")!.reason).toBe("e-top-bit");
  });
  test("TV001 as note JSON: the rebuilt message is the vector's message and the signature verifies", () => {
    const p = parseNoteJson(tv001Json());
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(toHexStr(noteMessageOf(p.note))).toBe(SCHNORR_VECTORS[0].message);
    expect(verify(p.note.issuer, noteMessageOf(p.note), p.note.signature).ok).toBe(true);
  });
  test("the sandbox sample note verifies; the tracker's field names parse too", () => {
    const p = parseNoteJson(sampleNoteJson());
    expect(p.ok && verify(p.note.issuer, noteMessageOf(p.note), p.note.signature).ok).toBe(true);
    const o = JSON.parse(sampleNoteJson());
    const server = JSON.stringify({ issuer_pubkey: o.issuer, recipient_pubkey: o.receiver, amount: Number(o.totalDebt), timestamp: Number(o.timestamp), tracker_nft_id: o.trackerNftId, signature: o.signature, denomination: "erg" });
    const q = parseNoteJson(server);
    expect(q.ok && verify(q.note.issuer, noteMessageOf(q.note), q.note.signature).ok).toBe(true);
    expect(parseNoteJson("{").ok).toBe(false);
    expect(parseNoteJson(JSON.stringify({ ...o, signature: undefined }))).toMatchObject({ ok: false, key: "viz.nv.errMissing" });
  });
});

describe("context variables in Scala 2.12 HashMap order", () => {
  test("0,5,1,6,2,7,3,8,4 with #7, and without it", () => {
    expect(scalaMapOrder([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([0, 5, 1, 6, 2, 7, 3, 8, 4]);
    expect(scalaMapOrder([0, 1, 2, 3, 4, 5, 6, 8])).toEqual([0, 5, 1, 6, 2, 3, 8, 4]);
    expect(scalaMapOrder([0, 1, 2, 3, 4, 5, 6, 7, 8])).toEqual([...contextVarOrder.laterRedemption]);
    expect(scalaMapOrder([0, 1, 2, 3, 4, 5, 6, 8])).toEqual([...contextVarOrder.firstRedemption]);
  });
  test("small maps (≤ 4 keys) keep their order", () => {
    expect(scalaMapOrder([0])).toEqual([0]);
    expect(scalaMapOrder([0, 1])).toEqual([0, 1]);
  });
});

describe("MessageBuilder = the engine's noteMessage", () => {
  const cases: Array<[bigint, bigint]> = [
    [1_500_000_000n, 1_767_225_600_000n],
    [0n, 0n],
    [(1n << 63n) - 1n, 1n],
    [123_456_789n, 1_743_379_200_000n],
  ];
  test.each(cases)("total %s, timestamp %s", (total, ts) => {
    const key = debtKey(labKey("Alice").pub, labKey("Bob").pub);
    const nft = hexBytes(LAB_TRACKER_NFT);
    const mine = buildMessage({ key, totalDebt: total, timestampMs: ts, trackerNftId: nft });
    expect(toHexStr(mine)).toBe(toHexStr(noteMessage(key, total, ts, nft)));
  });
  test("the builder's layout is the engine's messageLayout", () => {
    const msg = noteMessage(debtKey(labKey("Alice").pub, labKey("Bob").pub), 1n, 2n, LAB_TRACKER_NFT);
    expect(messageLayout(msg).map((s) => [s.offset, s.length])).toEqual(MESSAGE_LAYOUT.map((s) => [s.from, s.length]));
  });
  test("u64 big-endian and amount parsing", () => {
    expect(toHexStr(u64BE(1_500_000_000n))).toBe("0000000059682f00");
    expect(parseAmountInput("1.5", 9)).toBe(1_500_000_000n);
    expect(parseAmountInput("1 240,50", 9)).toBe(1_240_500_000_000n);
    expect(parseAmountInput("1.0000000001", 9)).toBeNull();
    expect(parseAmountInput("abc", 9)).toBeNull();
  });
});

describe("debt key", () => {
  test("the tool's preimage hashes to the engine's debt key and reserve key", () => {
    const a = labKey("Alice").pub;
    const b = labKey("Bob").pub;
    const erg = debtKeyParts(a, b, null);
    expect(erg.preimage.length).toBe(66);
    expect(toHexStr(erg.key)).toBe(toHexStr(debtKey(a, b)));
    expect(toHexStr(erg.reserveKey)).toBe(toHexStr(reserveKey(a, b)));
    const tok = new Uint8Array(32).fill(7);
    const t = debtKeyParts(a, b, tok);
    expect(t.preimage.length).toBe(98);
    expect(toHexStr(t.key)).toBe(toHexStr(debtKey(a, b, tok)));
    expect(toHexStr(t.reserveKey)).toBe(toHexStr(reserveKey(a, b)));
    expect(toHexStr(debtKeyParts(b, a, null).key)).not.toBe(toHexStr(erg.key));
  });
});

describe("template hash", () => {
  test("the sample trees hash (WebCrypto or noble) to their known templates, like the chain decoder says", async () => {
    for (const s of SAMPLE_TREES) {
      const a = analyzeTemplate(s.hex);
      const h = await sha256Hex(a.template);
      expect(h.hex).toBe(templateHashSync(s.hex));
      expect(knownTemplates(h.hex).map((k) => k.id)).toContain(s.id);
    }
  });
  test("a P2S address gives the same template as its tree; segments cover every byte", async () => {
    const s = SAMPLE_TREES[0];
    const a = analyzeTemplate(p2sAddress(s.hex));
    expect(a.input).toBe("address");
    expect(a.address?.checksumOk).toBe(true);
    expect((await sha256Hex(a.template)).hex).toBe(templateHashSync(s.hex));
    let at = 0;
    for (const seg of a.segments) {
      expect(seg.from).toBe(at);
      at += seg.length;
    }
    expect(at).toBe(a.bytes.length);
  });
  test("the known list equals the chain seed's contracts", () => {
    const seed = seedJson as unknown as { contracts: Array<{ id: string; templateHash: string }> };
    const mine = new Map(KNOWN_TEMPLATES.map((k) => [k.id, k.hash]));
    for (const c of seed.contracts) expect(mine.get(c.id)).toBe(c.templateHash);
  });
  test("bad input says why", () => {
    expect(() => analyzeTemplate("zz")).toThrow();
    expect(() => analyzeTemplate("")).toThrow("empty");
  });
});

describe("clocks", () => {
  test("emergency redeem opens when the box is more than 2 160 blocks old: at creation + 2 161", () => {
    expect(emergencyModel(1000 + EMERGENCY_BLOCKS, 1000)).toMatchObject({ open: false, left: 1, opensAt: 1000 + 2161 });
    expect(emergencyModel(1000 + EMERGENCY_BLOCKS + 1, 1000)).toMatchObject({ open: true, left: 0, zone: "emergency" });
    expect(emergencyModel(1119, 1000).zone).toBe("on-time");
    expect(emergencyModel(1120, 1000).zone).toBe("late");
    expect(emergencyModel(1720, 1000).zone).toBe("silent");
  });
  test("the owner's exit unlocks at R7 + 43 200", () => {
    expect(exitModel(5000, 5000)).toMatchObject({ unlockAt: 5000 + REFUND_PERIOD_BLOCKS, open: false, left: 43_200, progress: 0 });
    expect(exitModel(5000 + 43_200, 5000)).toMatchObject({ open: true, left: 0, progress: 1 });
  });
  test("ladder: ETA ≤ next commit + the updater cycle that sees depth 2; can redeem only when confirmed with something redeemable", () => {
    const local = ladderModel({ status: "local", height: 102, lastCommitHeight: 100, commitIntervalBlocks: 5, minDepth: 2 });
    expect(local.nextCommitIn).toBe(3);
    expect(local.etaBlocks).toBe(3 + 5);
    expect(ladderModel({ status: "pending", height: 100, lastCommitHeight: 100, redeemable: 5n }).canRedeemNow).toBe(false);
    expect(ladderModel({ status: "confirmed", height: 110, lastCommitHeight: 100, redeemable: 0n }).canRedeemNow).toBe(false);
    expect(ladderModel({ status: "confirmed", height: 110, lastCommitHeight: 100, redeemable: 5n }).canRedeemNow).toBe(true);
  });
});

function hexBytes(h: string): Uint8Array {
  return Uint8Array.from(h.match(/../g)!.map((b) => parseInt(b, 16)));
}
