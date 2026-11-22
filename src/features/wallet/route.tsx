// Placeholder route (ui-shell, Wave A). Wave B replaces this folder.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "wallet",
  path: "/wallet/*",
  load: () => import("./Page"),
  nav: { order: 2, labelKey: "nav.wallet" },
  titleKey: "wallet.title",
  commands: [
    { id: "wallet.open", labelKey: "wallet.cmd.open", to: "/wallet", keywords: "notes pay redeem кошелёк" },
  ],
};
export default route;
