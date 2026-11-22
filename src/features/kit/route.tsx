// /kit — the kitchen sink of the UI kit (developer page, not in the nav).
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "kit",
  path: "/kit",
  load: () => import("./Page"),
  nav: null,
  titleKey: "kit.title",
  commands: [{ id: "kit.open", labelKey: "kit.cmd", to: "/kit", keywords: "ui components design tokens kitchen sink" }],
};
export default route;
