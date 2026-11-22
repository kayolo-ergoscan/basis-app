// /network route keys (eager: nav, title, command bar). The page strings live in strings.ts and load with the page.
import type { I18nBundle } from "@/app/types";

export default {
  en: {
    "network.title": "Network",
    "network.cmd.open": "Mainnet overview",
    "network.cmd.reserves": "Mainnet reserves",
    "network.cmd.trackers": "Mainnet trackers",
    "network.cmd.redemptions": "Mainnet redemptions",
    "network.cmd.contracts": "Contract versions",
    "network.cmd.incidents": "Mainnet incidents",
  },
  ru: {
    "network.title": "Сеть",
    "network.cmd.open": "Обзор основной сети",
    "network.cmd.reserves": "Резервы в основной сети",
    "network.cmd.trackers": "Трекеры в основной сети",
    "network.cmd.redemptions": "Погашения в основной сети",
    "network.cmd.contracts": "Версии контракта",
    "network.cmd.incidents": "Инциденты в основной сети",
  },
} satisfies I18nBundle;
