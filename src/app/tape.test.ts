// The shell's live tape (src/app/chrome.tsx) stays off the mainnet wallet: a sandbox commit tape under a key that holds
// real ERG («ПЕСОЧНИЦА · ЛЕНТА — Ждём следующую фиксацию») reads as if that key were a play key.
import { describe, expect, it } from "vitest";
import { tapeHidden } from "./chrome";

describe("live tape", () => {
  it("is hidden on /wallet/mainnet and below it", () => {
    for (const p of ["/wallet/mainnet", "/wallet/mainnet/", "/wallet/mainnet/reserve", "/wallet/mainnet/pay/abc"]) expect(tapeHidden(p)).toBe(true);
  });
  it("stays everywhere else, the sandbox wallet included", () => {
    for (const p of ["/", "/wallet", "/wallet/sandbox", "/wallet/mainnetx", "/network", "/play", "/tracker"]) expect(tapeHidden(p)).toBe(false);
  });
});
