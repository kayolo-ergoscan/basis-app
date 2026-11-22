// Tracker feature: nav, title and command keys only (eager, in the main chunk). Everything the lazy pages say is in
// strings.ts, loaded with addI18n() by Page.tsx.
import type { I18nBundle } from "@/app/types";

export default {
  en: {
    "tracker.title": "Tracker",
    "tracker.eyebrow": "SANDBOX TRACKER T-01",
    "tracker.cmd.open": "ErgoScan's tracker on mainnet",
    "tracker.cmd.practice": "Practice tracker: the sandbox town's T-01",
    "tracker.cmd.run": "Run your own tracker",
    "tracker.cmd.api": "Tracker API mirror",
  },
  ru: {
    "tracker.title": "Трекер",
    "tracker.eyebrow": "ТРЕКЕР ПЕСОЧНИЦЫ T-01",
    "tracker.cmd.open": "Трекер ErgoScan в основной сети",
    "tracker.cmd.practice": "Учебный трекер: T-01 города-песочницы",
    "tracker.cmd.run": "Свой трекер: как запустить",
    "tracker.cmd.api": "Зеркало API трекера",
  },
} satisfies I18nBundle;
