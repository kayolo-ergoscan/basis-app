// /kit route keys (title, ⌘K label), eager like every i18n.ts. The page strings are in strings.ts (lazy).
import type { I18nBundle } from "@/app/types";

export default {
  en: {
    "kit.title": "UI kit",
    "kit.cmd": "UI kit: every component",
  },
  ru: {
    "kit.title": "UI-кит",
    "kit.cmd": "UI-кит: все компоненты",
  },
} satisfies I18nBundle;
