// Placeholder route (ui-shell, Wave A). Wave B replaces this folder.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "tracker",
  path: "/tracker/*",
  load: () => import("./Page"),
  nav: { order: 4, labelKey: "nav.tracker" },
  titleKey: "tracker.title",
  commands: [
    { id: "tracker.open", labelKey: "tracker.cmd.open", to: "/tracker", keywords: "digest heartbeat avl трекер" },
  ],
};
export default route;
