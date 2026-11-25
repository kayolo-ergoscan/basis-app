// What a token T1 or top-up gives back to the key, as the review shows it: read from the transaction's own outputs at
// P2PK(owner), every token (SigUSD, rsADA and any other the spent boxes held), never only the reserve's.
import { describe, expect, it } from "vitest";
import { FEE_TREE_HEX, TOKEN_RESERVE_TREE_HEX, p2pkTree, type UnsignedTx } from "@/mainnet/tx";
import { backToKey } from "./denom";

const OWNER = `02${"4a".repeat(32)}`;
const SIG = "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04";
const RSA = "e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297";
const out = (ergoTree: string, value: bigint, tokens: { tokenId: string; amount: bigint }[] = []) => ({ value, ergoTree, creationHeight: 1, tokens, registers: [] });

describe("backToKey", () => {
  it("sums the key's outputs, ERG and each token apart; the reserve, the fee and other keys are not change", () => {
    const tx: UnsignedTx = { inputs: [], dataInputs: [], outputs: [
      out(TOKEN_RESERVE_TREE_HEX, 2_000_000n, [{ tokenId: "ab".repeat(32), amount: 1n }, { tokenId: SIG, amount: 250n }]),
      out(p2pkTree(OWNER), 2_000_000n, [{ tokenId: SIG, amount: 4_750n }, { tokenId: RSA, amount: 150_000_000n }]),
      out(p2pkTree(OWNER), 1_000_000n, [{ tokenId: "ee".repeat(32), amount: 7n }, { tokenId: SIG, amount: 1n }]),
      out(FEE_TREE_HEX, 1_000_000n),
      out(p2pkTree(`03${"5b".repeat(32)}`), 9_000_000n, [{ tokenId: SIG, amount: 9n }]),
    ] };
    expect(backToKey(tx, OWNER)).toEqual({ erg: 3_000_000n, tokens: [{ tokenId: SIG, amount: 4_751n }, { tokenId: RSA, amount: 150_000_000n }, { tokenId: "ee".repeat(32), amount: 7n }] });
    expect(backToKey({ ...tx, outputs: tx.outputs.slice(0, 1) }, OWNER)).toEqual({ erg: 0n, tokens: [] });
  });
});
