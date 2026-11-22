// Wallet strings needed before the lazy page loads: the page title and the command palette. Everything else lives in
// ./strings.ts and is registered by Page.tsx (addI18n) with the house typography pass.
import type { I18nBundle } from "@/app/types";

export default {
  en: {
    "wallet.title": "Wallet",
    "wallet.eyebrow": "SANDBOX TOWN",
    "wallet.lede": "Your sandbox key, your notes and your reserve in the sandbox town: real signatures, play money.",
    "wallet.cmd.open": "Open the wallet",
    "wallet.cmd.pay": "Pay with a note",
    "wallet.cmd.request": "Request a payment",
    "wallet.cmd.redeem": "Redeem a note",
    "wallet.cmd.reserve": "Your reserve",
    "wallet.cmd.policy": "Your acceptance policy",
    "wallet.cmd.contacts": "Wallet contacts",
    "wallet.cmd.settings": "Wallet settings and backup",
  },
  ru: {
    "wallet.title": "Кошелёк",
    "wallet.eyebrow": "ГОРОД-ПЕСОЧНИЦА",
    "wallet.lede": "Ваш ключ песочницы, расписки и резерв в городе-песочнице: подписи настоящие, деньги игровые.",
    "wallet.cmd.open": "Открыть кошелёк",
    "wallet.cmd.pay": "Заплатить распиской",
    "wallet.cmd.request": "Запросить платёж",
    "wallet.cmd.redeem": "Погасить расписку",
    "wallet.cmd.reserve": "Ваш резерв",
    "wallet.cmd.policy": "Ваша политика приёма",
    "wallet.cmd.contacts": "Контакты кошелька",
    "wallet.cmd.settings": "Настройки кошелька и резервная копия",
  },
} satisfies I18nBundle;
