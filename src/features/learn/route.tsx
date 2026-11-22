// /learn: the book (index, ten chapters and the reference pages), lazy; each chapter is its own chunk.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "learn",
  path: "/learn/*",
  load: () => import("./Page"),
  nav: { order: 5, labelKey: "nav.learn" },
  titleKey: "learn.title",
  commands: [
    { id: "learn.open", labelKey: "learn.cmd.open", to: "/learn", keywords: "learn book chapters docs учиться книга главы" },
    { id: "learn.how", labelKey: "learn.cmd.how", to: "/learn/how", keywords: "how it works note tracker reserve redeem emergency exit clearing как работает" },
    { id: "learn.signature", labelKey: "learn.cmd.signature", to: "/learn/signature", keywords: "schnorr signature 80 bytes message sign tv001 подпись шнорр" },
    { id: "learn.contract", labelKey: "learn.cmd.contract", to: "/learn/contract", keywords: "contract basis.es basis-token.es xray ergoscript redeem top up refund контракт" },
    { id: "learn.avl", labelKey: "learn.cmd.avl", to: "/learn/avl", keywords: "avl tree digest proof merkle дерево дайджест доказательство" },
    { id: "learn.trust", labelKey: "learn.cmd.trust", to: "/learn/trust", keywords: "trust censor steal issues review доверие цензура ревью" },
    { id: "learn.tools", labelKey: "learn.cmd.tools", to: "/learn/tools", keywords: "tools debt key message verify template decode box инструменты бокс" },
    { id: "learn.api", labelKey: "learn.cmd.api", to: "/learn/api", keywords: "api endpoints http tracker server эндпоинты" },
    { id: "learn.history", labelKey: "learn.cmd.history", to: "/learn/history", keywords: "history chaincash timeline история" },
    { id: "learn.faq", labelKey: "learn.cmd.faq", to: "/learn/faq", keywords: "faq questions answers вопросы ответы" },
    { id: "learn.glossary", labelKey: "learn.cmd.glossary", to: "/learn/glossary", keywords: "glossary terms words словарь термины" },
    { id: "learn.sources", labelKey: "learn.cmd.sources", to: "/learn/sources", keywords: "sources github forum telegram источники" },
  ],
};
export default route;
