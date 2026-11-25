// SigUSD and rsADA are pinned once: the observatory's token kind and amounts read the same ids and decimals as the
// wallet's reserve tokens, never a token's own registers.
import { describe, expect, it } from "vitest";
import { tokenKind } from "./decode";
import { tokenAmount } from "./model";
import { PINNED_TOKENS, RSADA, SIGUSD, pinnedToken } from "./reserveTokens";
import { RESERVE_TOKENS } from "../mainnet/tx/tokens";

describe("pinned reserve tokens", () => {
  it("are the wallet's reserve tokens, id for id and decimal for decimal", () => {
    expect(RESERVE_TOKENS.map((t) => [t.id, t.symbol, t.decimals])).toEqual(PINNED_TOKENS.map((t) => [t.id, t.symbol, t.decimals]));
    expect(SIGUSD.id).toBe("03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04");
    expect(RSADA.id).toBe("e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297");
  });
  it("kind and decimals by exact id; a token's registers cannot rename or re-scale them", () => {
    expect(tokenKind(SIGUSD.id.toUpperCase())).toBe("sigusd");
    expect(tokenKind(RSADA.id)).toBe("rsada");
    expect(tokenKind("03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf05")).toBe("other");
    expect(tokenAmount(null, SIGUSD.id, 1234n, { name: "SigUSD (fake)", decimals: 9 })).toMatchObject({ decimals: 2, name: "SigUSD", kind: "sigusd", label: "SigUSD" });
    expect(pinnedToken(null)).toBeNull();
  });
});
