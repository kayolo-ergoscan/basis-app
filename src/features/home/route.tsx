// Placeholder route (ui-shell, Wave A). Wave B replaces this folder.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "home",
  path: "/",
  load: () => import("./Page"),
  nav: { order: 0, labelKey: "nav.story" },
  titleKey: "home.title",
};
export default route;
