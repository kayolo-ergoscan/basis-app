// Placeholder route (ui-shell, Wave A). Wave B replaces this folder.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "network",
  path: "/network/*",
  load: () => import("./Page"),
  nav: { order: 3, labelKey: "nav.network" },
  titleKey: "network.title",
  commands: [
    { id: "network.open", labelKey: "network.cmd.open", to: "/network", keywords: "mainnet reserves trackers redemptions сеть" },
  ],
};
export default route;
