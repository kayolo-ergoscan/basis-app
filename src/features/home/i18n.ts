// home: the title and command labels (eager). The page's own strings are in strings.ts (lazy, see Page.tsx).
import type { I18nBundle } from "@/app/types";

export default {
  en: {
    "home.title": "Offchain cash on Ergo",
    "home.cmd.story": "Home: offchain cash on Ergo",
    "home.cmd.moments": "Five moments of one note",
    "home.cmd.mainnet": "Mainnet now: Basis on Ergo today",
  },
  ru: {
    "home.title": "Деньги вне блокчейна, расчёт на Ergo",
    "home.cmd.story": "Главная: деньги вне блокчейна, расчёт на Ergo",
    "home.cmd.moments": "Пять моментов одной расписки",
    "home.cmd.mainnet": "Основная сеть сейчас: Basis в Ergo сегодня",
  },
} satisfies I18nBundle;
