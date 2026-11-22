// src/chain/links.ts — explorer deep links (FEATURES O12, PRODUCT §1: "links to transactions/boxes go to ergoscan.me").
// One table, so a route change is a one-line fix. The site is a single-page app that answers 200 for any path, so the
// /box/ and /block/ routes below could not be confirmed with a request; see CHAIN_API.md "Known gaps".
export const EXPLORER_ORIGIN = "https://ergoscan.me";

export const explorer = {
  tx: (txId: string) => `${EXPLORER_ORIGIN}/tx/${txId}`,
  box: (boxId: string) => `${EXPLORER_ORIGIN}/box/${boxId}`,
  address: (address: string) => `${EXPLORER_ORIGIN}/address/${address}`,
  token: (tokenId: string) => `${EXPLORER_ORIGIN}/token/${tokenId}`,
  block: (height: number) => `${EXPLORER_ORIGIN}/block/${height}`,
};

export type ExplorerKind = keyof typeof explorer;

/** Link for any on-chain id by kind; null when the id is empty. */
export function explorerLink(kind: ExplorerKind, id: string | number | null | undefined): string | null {
  if (id === null || id === undefined || id === "") return null;
  return kind === "block" ? explorer.block(Number(id)) : explorer[kind](String(id));
}
