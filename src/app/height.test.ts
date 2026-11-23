// A reserve action is planned and signed only on a fresh tip (review 2): the poller's last answer, a minute at most.
import { describe, expect, it } from "vitest";
import { FRESH_HEIGHT_MS, freshHeight } from "./height";

describe("freshHeight", () => {
  const NOW = 1_800_000_000_000;
  const s = { height: 1_923_300, lastBlockId: null, updatedAt: NOW - 1_000, error: false };
  it("gives the height of an answer under a minute old", () => {
    expect(freshHeight(s, NOW)).toBe(1_923_300);
    expect(freshHeight({ ...s, updatedAt: NOW - FRESH_HEIGHT_MS }, NOW)).toBe(1_923_300);
  });
  it("refuses a failed last read, an old answer, no answer, and a clock that went back", () => {
    expect(freshHeight({ ...s, error: true }, NOW)).toBeNull();
    expect(freshHeight({ ...s, updatedAt: NOW - FRESH_HEIGHT_MS - 1 }, NOW)).toBeNull();
    expect(freshHeight({ ...s, height: null, updatedAt: null }, NOW)).toBeNull();
    expect(freshHeight({ ...s, updatedAt: NOW + 60_000 }, NOW)).toBeNull();
  });
});
