// Which lazy page a /tracker address needs (a switch loads it first, src/app/motion.ts), and the same for /learn and
// the wallet's two modes.
import { describe, expect, it } from "vitest";
import { apiPage, consolePage, mainnetPage, trackerChunkOf } from "./chunks";
import { learnChunkOf, LEARN_CHUNKS } from "@/features/learn/chunks";
import { isMainnetPath } from "@/features/wallet/chunks";

describe("tracker chunks", () => {
  it("maps each sub-page to its chunk; /run is in the frame's own chunk", () => {
    expect(trackerChunkOf("/tracker/practice")).toBe(consolePage);
    expect(trackerChunkOf("/tracker/api")).toBe(apiPage);
    expect(trackerChunkOf("/tracker/mainnet")).toBe(mainnetPage);
    expect(trackerChunkOf("/tracker")).toBe(mainnetPage);
    expect(trackerChunkOf("/tracker/unknown")).toBe(mainnetPage);
    expect(trackerChunkOf("/tracker/run")).toBeNull();
  });
});

describe("learn chunks", () => {
  it("maps the index and every chapter, and nothing for an unknown page", () => {
    expect(learnChunkOf("/learn")).toBe(LEARN_CHUNKS[""]);
    expect(learnChunkOf("/learn/")).toBe(LEARN_CHUNKS[""]);
    expect(learnChunkOf("/learn/how")).toBe(LEARN_CHUNKS.how);
    expect(learnChunkOf("/learn/signature")).toBe(LEARN_CHUNKS.signature);
    expect(learnChunkOf("/learn/nope")).toBeUndefined();
  });
});

describe("wallet chunks", () => {
  it("tells the mainnet wallet from the sandbox wallet", () => {
    expect(isMainnetPath("/wallet/mainnet")).toBe(true);
    expect(isMainnetPath("/wallet/mainnet/pay")).toBe(true);
    expect(isMainnetPath("/wallet")).toBe(false);
    expect(isMainnetPath("/wallet/mainnetx")).toBe(false);
  });
});
