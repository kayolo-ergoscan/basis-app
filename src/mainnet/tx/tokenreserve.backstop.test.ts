// The token T1 check's last line, per token id in = out (the NFT the only new token), on its own (review LOW-6), and
// the same line in the token Withdraw check. Every
// earlier rule compares the change with the same computed "rest" the builder uses, so a fault in that computation
// would pass them all: here the shared merge drops one token (as a bug would), the builder then burns it, the change
// matches the faulty rest, and only the totals backstop, which counts the boxes' own token lists, refuses it.
import { describe, expect, it, vi } from "vitest";
import { keyPairFromSecret } from "../../protocol/keys";
import { MINER_FEE_NANOERG } from "./constants";
import { p2pkBox } from "./testkit";
import { buildTokenReserveCreation, checkTokenReserveCreation } from "./tokenreserve";
import { SIGUSD_TOKEN_ID, TOKEN_RESERVE_BOX_NANOERG, reserveTokenById } from "./tokens";
import { TOKEN_WITHDRAW_BOX_NANOERG, buildTokenWithdraw, checkTokenWithdraw } from "./tokenwithdraw";
import { p2pkAddress } from "./address";

const DROPPED = "77".repeat(32);
vi.mock("./p2pk", async (importOriginal) => {
  const real = await importOriginal<typeof import("./p2pk")>();
  return { ...real, mergedTokens: (boxes: Parameters<typeof real.mergedTokens>[0]) => real.mergedTokens(boxes).filter((t) => t.tokenId !== DROPPED) };
});

const owner = keyPairFromSecret(3n).pubHex;
const SIG = reserveTokenById(SIGUSD_TOKEN_ID)!;
const TIP = 1_925_000;

describe("the token totals backstop", () => {
  it("refuses a T1 that burns a token the rest computation lost, which every other rule lets through", () => {
    const tokenBox = p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 800n }, { tokenId: DROPPED, amount: 3n }], index: 1 });
    const ergBox = p2pkBox(owner, 50_000_000n, { index: 2 });
    const inputs = [tokenBox, ergBox];
    const want = { owner, token: SIG, amount: 500n, ergValue: TOKEN_RESERVE_BOX_NANOERG, fee: MINER_FEE_NANOERG, height: TIP };
    const tx = buildTokenReserveCreation({ ...want, inputs });
    // the faulty change: the rest of SigUSD, without the other token
    expect(tx.outputs[1].tokens).toEqual([{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }]);
    expect(checkTokenReserveCreation(tx, inputs, want)).toMatchObject({ ok: false, rule: "totals", message: "a token would be minted, burned or changed" });
    // the same check on boxes without the other token passes: the backstop refuses only the burn
    const plain = p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 800n }], index: 1 });
    expect(checkTokenReserveCreation(buildTokenReserveCreation({ ...want, inputs: [plain, ergBox] }), [plain, ergBox], want)).toEqual({ ok: true });
  });
});

describe("the token Withdraw totals backstop", () => {
  it("refuses a withdrawal that burns a token the rest computation lost", () => {
    const tokenBox = p2pkBox(owner, 1_000_000n, { tokens: [{ tokenId: SIGUSD_TOKEN_ID, amount: 800n }, { tokenId: DROPPED, amount: 3n }], index: 1 });
    const ergBox = p2pkBox(owner, 50_000_000n, { index: 2 });
    const want = { owner, to: p2pkAddress(keyPairFromSecret(2n).pubHex), token: SIG, amount: 500n, ergValue: TOKEN_WITHDRAW_BOX_NANOERG, fee: MINER_FEE_NANOERG, height: TIP };
    const tx = buildTokenWithdraw({ ...want, inputs: [tokenBox, ergBox] });
    expect(tx.outputs[1].tokens).toEqual([{ tokenId: SIGUSD_TOKEN_ID, amount: 300n }]);
    expect(checkTokenWithdraw(tx, [tokenBox, ergBox], want)).toMatchObject({ ok: false, rule: "totals", message: "a token would be minted, burned or changed" });
  });
});
