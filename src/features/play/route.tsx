// /play (VISUAL §13): the sandbox, a lazy chunk. Inner routes: /play (picker + café on credit), /play/:scenario (the
// 11 engine scenarios), /play/free (free mode); ?seed= keeps a non-default seed in a shared link.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "play",
  path: "/play/*",
  load: () => import("./Page"),
  nav: { order: 1, labelKey: "nav.play" },
  titleKey: "play.title",
  commands: [
    { id: "play.open", labelKey: "play.cmd.open", to: "/play", keywords: "sandbox scenarios graph песочница" },
    { id: "play.free", labelKey: "play.cmd.free", to: "/play/free", keywords: "free mode tools свободный режим" },
    { id: "play.dark", labelKey: "play.cmd.dark", to: "/play/tracker-vanishes", keywords: "tracker dark emergency redeem трекер аварийное погашение" },
    { id: "play.swarm", labelKey: "play.cmd.swarm", to: "/play/agent-swarm", keywords: "agents ai micropayments агенты" },
    { id: "play.clearing", labelKey: "play.cmd.clearing", to: "/play/clearing-circle", keywords: "clearing loop cycle клиринг кольцо" },
  ],
};
export default route;
