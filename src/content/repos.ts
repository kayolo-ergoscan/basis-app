// Our open code and the reference software, in one place: the footer, the developer page and the API page link these.
// A plain module (no React, no other content), so the shell's footer can import it without the content index.

export interface Repo {
  /** Where the link goes. */
  url: string;
  /** owner/name, as the link shows it. */
  name: string;
}

export const REPOS = {
  /** This site: the wallet and the TypeScript protocol engine (CC0). */
  app: { url: "https://github.com/kayolo-ergoscan/basis-app", name: "kayolo-ergoscan/basis-app" },
  /** ErgoScan's tracker: a fork of the reference tracker, branch `ergoscan`. */
  tracker: { url: "https://github.com/kayolo-ergoscan/basis-tracker/tree/ergoscan", name: "kayolo-ergoscan/basis-tracker" },
  /** The reference software by Better Money Labs: tracker, contracts, CLI and MCP. */
  reference: { url: "https://github.com/BetterMoneyLabs/basis-tracker", name: "BetterMoneyLabs/basis-tracker" },
} as const satisfies Record<string, Repo>;
