// The token reserve constants: the pinned tree against its template hash and P2S, and the token table.
import { sha256 } from "@noble/hashes/sha256";
import { describe, expect, it } from "vitest";
import { CURRENT_TEMPLATES, templateHashSync } from "../../chain/decode";
import { bytesToHex, hexToBytes } from "../../protocol/bytes";
import { parseAddress } from "./address";
import { RESERVE_TREE_HEX } from "./constants";
import {
  RESERVE_TOKENS, RSADA_TOKEN_ID, SIGUSD_TOKEN_ID, TOKEN_RESERVE_BOX_NANOERG, TOKEN_RESERVE_TEMPLATE_HASH, TOKEN_RESERVE_TREE_BYTES, TOKEN_RESERVE_TREE_HEX, TOKEN_RESERVE_TREE_SHA256,
  WALLET_DENOMS, denomDecimals, denomOfSlug, denomSlug, denomSymbol, isWalletDenom, reserveDenomOfBox, reserveTokenById, reserveTokenOf, reserveTreeOf, tokenReserveAddress,
} from "./tokens";

describe("the token reserve contract", () => {
  it("910 bytes, header 0x1b, the multi-token template the observatory watches", () => {
    const t = hexToBytes(TOKEN_RESERVE_TREE_HEX);
    expect(t.length).toBe(TOKEN_RESERVE_TREE_BYTES);
    expect(t[0]).toBe(0x1b);
    expect(bytesToHex(sha256(t))).toBe(TOKEN_RESERVE_TREE_SHA256);
    expect(templateHashSync(TOKEN_RESERVE_TREE_HEX)).toBe(TOKEN_RESERVE_TEMPLATE_HASH);
    expect(CURRENT_TEMPLATES.multiToken).toBe(TOKEN_RESERVE_TEMPLATE_HASH);
  });

  it("its P2S is the 8LeDK9… address the live front serves as token_contract_p2s", () => {
    const a = tokenReserveAddress();
    expect(a.startsWith("8LeDK9LdaWwuYnQYQNkBJEucHSWd7bMR7uFyPyfo")).toBe(true);
    expect(a.length).toBe(1249);
    const back = parseAddress(a);
    expect(back.network).toBe("mainnet");
    expect(back.type).toBe("P2S");
    expect(back.type === "P2S" && back.ergoTree).toBe(TOKEN_RESERVE_TREE_HEX);
  });
});

describe("the tokens", () => {
  it("SigUSD 2 decimals, default 5, max 25; rsADA 6 decimals, default 10, max 50 (raw units)", () => {
    const s = reserveTokenById(SIGUSD_TOKEN_ID)!;
    expect([s.symbol, s.decimals, s.one, s.min, s.defaultCap, s.hardCap]).toEqual(["SigUSD", 2, 100n, 100n, 500n, 2500n]);
    const r = reserveTokenById(RSADA_TOKEN_ID)!;
    expect([r.symbol, r.decimals, r.one, r.min, r.defaultCap, r.hardCap]).toEqual(["rsADA", 6, 1_000_000n, 1_000_000n, 10_000_000n, 50_000_000n]);
    expect(RESERVE_TOKENS.map((t) => t.id)).toEqual([SIGUSD_TOKEN_ID, RSADA_TOKEN_ID]);
    for (const t of RESERVE_TOKENS) expect(t.id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("denominations: exact ids only, never a look-alike", () => {
    expect(WALLET_DENOMS).toEqual(["erg", `token:${SIGUSD_TOKEN_ID}`, `token:${RSADA_TOKEN_ID}`]);
    expect(reserveTokenOf("erg")).toBeNull();
    expect(reserveTokenOf(`token:${SIGUSD_TOKEN_ID}`)?.symbol).toBe("SigUSD");
    expect(reserveTokenOf(`token:${SIGUSD_TOKEN_ID.toUpperCase()}`)).toBeUndefined();
    expect(reserveTokenOf(`token:${"03".repeat(32)}`)).toBeUndefined();
    expect(isWalletDenom(`token:${RSADA_TOKEN_ID}`)).toBe(true);
    expect(isWalletDenom("token:")).toBe(false);
    expect(denomSymbol(`token:${RSADA_TOKEN_ID}`)).toBe("rsADA");
    expect(denomDecimals("erg")).toBe(9);
    expect(denomDecimals(`token:${SIGUSD_TOKEN_ID}`)).toBe(2);
    for (const d of WALLET_DENOMS) expect(denomOfSlug(denomSlug(d))).toBe(d);
    expect(denomOfSlug("SIGUSD")).toBe(`token:${SIGUSD_TOKEN_ID}`);
    expect(denomOfSlug("usd")).toBeNull();
    expect(reserveTreeOf("erg")).toBe(RESERVE_TREE_HEX);
    expect(reserveTreeOf(`token:${SIGUSD_TOKEN_ID}`)).toBe(TOKEN_RESERVE_TREE_HEX);
  });

  it("a box's reserve denomination from its tree and tokens", () => {
    const nft = { tokenId: "a7".repeat(32), amount: 1n };
    expect(reserveDenomOfBox({ ergoTree: RESERVE_TREE_HEX, tokens: [nft] })).toBe("erg");
    expect(reserveDenomOfBox({ ergoTree: RESERVE_TREE_HEX, tokens: [nft, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }] })).toBeNull();
    expect(reserveDenomOfBox({ ergoTree: TOKEN_RESERVE_TREE_HEX, tokens: [nft, { tokenId: SIGUSD_TOKEN_ID, amount: 5n }] })).toBe(`token:${SIGUSD_TOKEN_ID}`);
    expect(reserveDenomOfBox({ ergoTree: TOKEN_RESERVE_TREE_HEX, tokens: [nft, { tokenId: "03".repeat(32), amount: 5n }] })).toBeNull();
    expect(reserveDenomOfBox({ ergoTree: TOKEN_RESERVE_TREE_HEX, tokens: [nft] })).toBeNull();
  });

  it("a token reserve box carries 0.002 ERG", () => {
    expect(TOKEN_RESERVE_BOX_NANOERG).toBe(2_000_000n);
    expect(4096n * 360n).toBeLessThan(TOKEN_RESERVE_BOX_NANOERG);
  });
});
