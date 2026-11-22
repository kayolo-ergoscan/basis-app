// Placeholder route (ui-shell, Wave A). Wave B replaces this folder.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "learn",
  path: "/learn/*",
  load: () => import("./Page"),
  nav: { order: 5, labelKey: "nav.learn" },
  titleKey: "learn.title",
  commands: [
    { id: "learn.open", labelKey: "learn.cmd.open", to: "/learn", keywords: "contract docs glossary faq учиться" },
  ],
};
export default route;
