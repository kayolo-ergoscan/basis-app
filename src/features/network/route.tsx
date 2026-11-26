import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "network",
  path: "/network/*",
  load: () => import("./Page"),
  nav: { order: 3, labelKey: "nav.network" },
  titleKey: "network.title",
  commands: [
    { id: "network.open", labelKey: "network.cmd.open", to: "/network", keywords: "mainnet network observatory сеть основная" },
    { id: "network.reserves", labelKey: "network.cmd.reserves", to: "/network/reserves", keywords: "reserves boxes exit refund резервы боксы возврат" },
    { id: "network.trackers", labelKey: "network.cmd.trackers", to: "/network/trackers", keywords: "trackers nft emergency heartbeat трекеры" },
    { id: "network.redemptions", labelKey: "network.cmd.redemptions", to: "/network/redemptions", keywords: "redemptions timeline graph погашения" },
    { id: "network.contracts", labelKey: "network.cmd.contracts", to: "/network/contracts", keywords: "contracts templates hash verify контракты шаблоны" },
    { id: "network.incidents", labelKey: "network.cmd.incidents", to: "/network/incidents", keywords: "incidents burned locked lookalike USE инциденты" },
  ],
};

export default route;
