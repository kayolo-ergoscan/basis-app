// Placeholder route (ui-shell, Wave A). Wave B replaces this folder.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "play",
  path: "/play/*",
  load: () => import("./Page"),
  nav: { order: 1, labelKey: "nav.play" },
  titleKey: "play.title",
  commands: [
    { id: "play.open", labelKey: "play.cmd.open", to: "/play", keywords: "sandbox scenarios graph песочница" },
  ],
};
export default route;
