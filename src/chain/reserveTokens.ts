// The two tokens Basis reserves are made in by this site (operator 25.11): exact ids and decimals, pinned here and
// never read from a token's registers or the tracker. One place for both the observatory (decode.tokenKind, the
// Network pages) and the mainnet wallet (mainnet/tx/tokens.ts adds its caps). Data only: no imports.
export interface PinnedToken { id: string; symbol: string; decimals: number; kind: "sigusd" | "rsada" }

export const SIGUSD: PinnedToken = { id: "03faf2cb329f2e90d6d23b58d91bbb6c046aa143261cc21f52fbe2824bfcbf04", symbol: "SigUSD", decimals: 2, kind: "sigusd" };
export const RSADA: PinnedToken = { id: "e023c5f382b6e96fbd878f6811aac73345489032157ad5affb84aefd4956c297", symbol: "rsADA", decimals: 6, kind: "rsada" };

export const PINNED_TOKENS: readonly PinnedToken[] = [SIGUSD, RSADA];

/** A pinned token by its exact (lowercase) id, or null. */
export const pinnedToken = (id: string | null | undefined): PinnedToken | null => PINNED_TOKENS.find((t) => t.id === (id ?? "").toLowerCase()) ?? null;
