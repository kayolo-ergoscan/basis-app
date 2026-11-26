// The lit place of the top bar and the phone tab bar (src/app/chrome.tsx) follows where the reader is: the sandbox's
// play-money wallet lights Sandbox; «Wallet (beta)» opens the mainnet key and lights only there.
import { describe, expect, it } from "vitest";
import { heightShown, placeOf } from "./chrome";

describe("lit place", () => {
  it("the mainnet wallet lights the wallet", () => {
    for (const p of ["/wallet/mainnet", "/wallet/mainnet/", "/wallet/mainnet/pay", "/wallet/mainnet/receive"]) expect([p, placeOf(p)]).toEqual([p, "wallet"]);
  });
  it("the sandbox wallet lights Sandbox, with the sandbox itself", () => {
    for (const p of ["/wallet", "/wallet/", "/wallet/pay", "/wallet/notes", "/wallet/mainnetx", "/play", "/play/free"]) expect([p, placeOf(p)]).toEqual([p, "play"]);
  });
  it("the other places stay as they were", () => {
    expect(placeOf("/network/reserves")).toBe("network");
    expect(placeOf("/tracker/mainnet")).toBe("network");
    expect(placeOf("/learn/how")).toBe("learn");
    expect(placeOf("/")).toBeNull();
    expect(placeOf("/kit")).toBeNull();
  });
});

describe("the Ergo block pill", () => {
  it("is hidden in the sandbox, where the town counts its own blocks", () => {
    for (const p of ["/play", "/play/free", "/wallet", "/wallet/", "/wallet/pay", "/wallet/notes", "/wallet/mainnetx"]) expect([p, heightShown(p)]).toEqual([p, false]);
  });
  it("stays everywhere else, the mainnet wallet included", () => {
    for (const p of ["/", "/wallet/mainnet", "/wallet/mainnet/receive", "/network", "/tracker/mainnet", "/learn/how", "/kit"]) expect([p, heightShown(p)]).toEqual([p, true]);
  });
});
