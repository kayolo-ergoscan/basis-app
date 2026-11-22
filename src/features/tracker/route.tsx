import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "tracker",
  path: "/tracker/*",
  load: () => import("./Page"),
  nav: { order: 4, labelKey: "nav.tracker" },
  titleKey: "tracker.title",
  commands: [
    { id: "tracker.open", labelKey: "tracker.cmd.open", to: "/tracker/mainnet", keywords: "ergoscan mainnet beta live console tracker трекер основная сеть бета консоль" },
    { id: "tracker.practice", labelKey: "tracker.cmd.practice", to: "/tracker/practice", keywords: "practice simulation sandbox town digest heartbeat avl proof censor eclipse учебный симуляция песочница город трекер дайджест пульс" },
    { id: "tracker.run", labelKey: "tracker.cmd.run", to: "/tracker/run", keywords: "run operator node nft config checklist свой запустить оператор" },
    { id: "tracker.api", labelKey: "tracker.cmd.api", to: "/tracker/api", keywords: "api http json endpoints server mirror эндпоинты сервер" },
  ],
};

export default route;
