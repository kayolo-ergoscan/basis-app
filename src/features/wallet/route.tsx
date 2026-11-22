// /wallet/* — a complete Basis wallet on the sandbox town: your sandbox key, real signatures, play money.
import type { FeatureRoute } from "@/app/types";

const route: FeatureRoute = {
  id: "wallet",
  path: "/wallet/*",
  load: () => import("./Page"),
  nav: { order: 2, labelKey: "nav.wallet" },
  titleKey: "wallet.title",
  commands: [
    { id: "wallet.open", labelKey: "wallet.cmd.open", to: "/wallet", keywords: "wallet notes balance кошелёк расписки баланс" },
    { id: "wallet.pay", labelKey: "wallet.cmd.pay", to: "/wallet/pay", keywords: "pay raise note send оплатить заплатить" },
    { id: "wallet.request", labelKey: "wallet.cmd.request", to: "/wallet/request", keywords: "request qr link invoice запросить ссылка" },
    { id: "wallet.redeem", labelKey: "wallet.cmd.redeem", to: "/wallet/redeem", keywords: "redeem reserve erg погасить погашение" },
    { id: "wallet.reserve", labelKey: "wallet.cmd.reserve", to: "/wallet/reserve", keywords: "reserve top up exit refund резерв пополнить выход" },
    { id: "wallet.policy", labelKey: "wallet.cmd.policy", to: "/wallet/policy", keywords: "policy accept whitelist credit line политика лимит" },
    { id: "wallet.contacts", labelKey: "wallet.cmd.contacts", to: "/wallet/contacts", keywords: "contacts people контакты" },
    { id: "wallet.settings", labelKey: "wallet.cmd.settings", to: "/wallet/settings", keywords: "settings backup export key настройки копия ключ" },
  ],
};
export default route;
