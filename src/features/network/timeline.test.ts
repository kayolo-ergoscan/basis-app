// The redemptions timeline keeps every stem inside its plot: a burst of redemptions at the newest end (23 Nov 2026: six
// for ErgoScan's tracker within a day) used to be pushed past the right edge, so /network/redemptions scrolled sideways
// on a 390 px phone (408 > 390).
import { describe, expect, it } from "vitest";
import { spreadStems } from "./viz";

describe("spreadStems", () => {
  it("leaves spaced stems where the time axis puts them", () => {
    expect(spreadStems([0, 50, 100], 7, 300)).toEqual([0, 50, 100]);
  });

  it("spaces a crowd at least one gap apart, oldest first", () => {
    expect(spreadStems([10, 10, 11], 7, 300)).toEqual([10, 17, 24]);
  });

  it("pulls a burst at the newest end back inside the plot instead of past it", () => {
    const plotW = 290;
    const xs = spreadStems([100, 288, 289, 289.5, 290, 290, 290], 7, plotW);
    expect(Math.max(...xs)).toBeLessThanOrEqual(plotW);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(7 - 1e-9);
    expect(xs[0]).toBe(100);
    expect(xs[xs.length - 1]).toBe(plotW);
  });

  it("never goes below zero, even when the lane holds more stems than fit", () => {
    const xs = spreadStems(Array.from({ length: 60 }, () => 5), 7, 100);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...xs)).toBeLessThanOrEqual(100);
  });
});
