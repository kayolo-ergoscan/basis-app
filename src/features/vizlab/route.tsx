// /lab/viz — showcase of every protocol X-ray (src/viz) on live sandbox engine data. Developer page, not in the nav.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "vizlab",
  path: "/lab/viz",
  load: () => import("./Page"),
  nav: null,
  titleKey: "vizlab.title",
};
export default route;
