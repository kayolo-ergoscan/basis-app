// Token amounts as people type them: raw units with the token's decimals, never a float.
import { describe, expect, it } from "vitest";
import { dpOfUnits, parseErg, parseUnits, unitsInput, unitsPlain } from "./amount";

describe("token amounts", () => {
  it("SigUSD (2 decimals) and rsADA (6 decimals) in raw units", () => {
    expect(parseUnits("5", 2, "en")).toBe(500n);
    expect(parseUnits("0.01", 2, "en")).toBe(1n);
    expect(parseUnits("0.001", 2, "en")).toBeNull();
    expect(parseUnits("12,5", 6, "ru")).toBe(12_500_000n);
    expect(parseUnits("1 000.5", 6, "en")).toBe(1_000_500_000n);
    expect(parseUnits("1,000", 2, "en")).toBeNull();
    expect(parseUnits("0", 2, "en")).toBeNull();
    expect(parseUnits("-1", 2, "en")).toBeNull();
    expect(parseUnits("1e3", 2, "en")).toBeNull();
    expect(parseUnits(".5", 2, "en")).toBe(50n);
    expect(parseUnits("1", 0, "en")).toBe(1n);
    expect(parseUnits("1.5", 0, "en")).toBeNull();
  });

  it("9 decimals is parseErg exactly", () => {
    for (const s of ["1.5", "0.000000001", "1,000", "1 000.000000001"]) expect(parseUnits(s, 9, "en")).toBe(parseErg(s, "en"));
  });

  it("back to text", () => {
    expect(unitsPlain(500n, 2)).toBe("5");
    expect(unitsPlain(501n, 2)).toBe("5.01");
    expect(unitsPlain(12_500_000n, 6)).toBe("12.5");
    expect(unitsInput(12_500_000n, 6, "ru")).toBe("12,5");
    expect(dpOfUnits(500n, 2)).toBe(2);
    expect(dpOfUnits(12_500_000n, 6)).toBe(2);
    expect(dpOfUnits(12_500_001n, 6)).toBe(6);
    for (const [raw, d] of [[1n, 2], [123_456_789n, 6], [10n ** 13n, 2]] as const) expect(parseUnits(unitsPlain(raw, d), d, "en")).toBe(raw);
  });
});
