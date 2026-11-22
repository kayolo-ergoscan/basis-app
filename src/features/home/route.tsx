// / — Home (VISUAL §13): the story in one scroll. The page and its string table load lazily (Page.tsx).
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "home",
  path: "/",
  load: () => import("./Page"),
  nav: { order: 0, labelKey: "nav.story" },
  titleKey: "home.title",
  commands: [
    { id: "home.open", labelKey: "home.cmd.story", to: "/", keywords: "home story landing hero note главная история расписка" },
    { id: "home.moments", labelKey: "home.cmd.moments", to: "/#moments", keywords: "promise stamp trust back redeem moments обещание печать доверие обеспечение погашение" },
    { id: "home.mainnet", labelKey: "home.cmd.mainnet", to: "/#mainnet", keywords: "mainnet reserves trackers today test use сеть резервы трекеры" },
  ],
};
export default route;
