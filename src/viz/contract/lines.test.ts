import { describe, expect, it } from "vitest";
import { basisEs, basisTokenEs } from "@/content/contractSource";
const BASIS_ES_LINES = basisEs.lines;
const BASIS_TOKEN_ES_LINES = basisTokenEs.lines;
import { ALL_CHECK_IDS, checkLinesFor, checksOf, deriveContractMap, expectedChecks, type ActionId } from "./lines";

describe("contract line map", () => {
  for (const [contract, lines] of [["basis", BASIS_ES_LINES], ["basis-token", BASIS_TOKEN_ES_LINES]] as const) {
    const map = deriveContractMap(lines, contract);
    it(`${contract}: every check of the contract has lines`, () => {
      for (const id of checksOf(contract)) {
        const c = map.checks[id];
        expect(c, id).toBeTruthy();
        expect(c!.ranges.length, id).toBeGreaterThan(0);
        for (const [a, b] of c!.ranges) {
          expect(a).toBeGreaterThanOrEqual(1);
          expect(b).toBeLessThanOrEqual(lines.length);
          expect(b).toBeGreaterThanOrEqual(a);
        }
        expect(lines[c!.anchor - 1].trim().length, id).toBeGreaterThan(0);
      }
    });
    it(`${contract}: every expected check of every action resolves inside the prologue or its branch`, () => {
      for (const action of [0, 1, 2, 3] as ActionId[]) {
        for (const id of expectedChecks(contract, action)) {
          const c = checkLinesFor(map, id, action);
          expect(c, `${contract} #${action} ${id}`).toBeTruthy();
          const [b, e] = map.actions[action];
          const inBranch = c!.anchor >= b && c!.anchor <= e;
          const inPrologue = c!.anchor >= map.prologue[0] && c!.anchor <= map.prologue[1];
          expect(inBranch || inPrologue, `${contract} #${action} ${id} @${c!.anchor}`).toBe(true);
        }
      }
    });
  }
  it("knows every engine check id", () => {
    expect(ALL_CHECK_IDS.length).toBe(30);
  });
  it("anchors the redeem conditions on their val lines (basis.es)", () => {
    const map = deriveContractMap(BASIS_ES_LINES, "basis");
    expect(BASIS_ES_LINES[map.checks.properlyRedeemed!.anchor - 1]).toContain("val properlyRedeemed");
    expect(BASIS_ES_LINES[map.checks.trackerIdCorrect!.anchor - 1]).toContain("val trackerIdCorrect");
    expect(BASIS_ES_LINES[checkLinesFor(map, "ownerSignature", 3)!.anchor - 1]).toContain("proveDlog(ownerKey)");
    expect(map.actions[0][0]).toBe(255);
  });
});
