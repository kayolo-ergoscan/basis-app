import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "tracker",
  path: "/tracker/*",
  load: () => import("./Page"),
  nav: { order: 4, labelKey: "nav.tracker" },
  titleKey: "tracker.title",
  commands: [
    { id: "tracker.open", labelKey: "tracker.cmd.open", to: "/tracker", keywords: "digest heartbeat avl proof censor eclipse трекер дайджест пульс" },
    { id: "tracker.run", labelKey: "tracker.cmd.run", to: "/tracker/run", keywords: "run operator node nft config checklist свой запустить оператор" },
    { id: "tracker.api", labelKey: "tracker.cmd.api", to: "/tracker/api", keywords: "api http json endpoints server mirror эндпоинты сервер" },
  ],
};

export default route;
