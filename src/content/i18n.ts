// i18n bundle for the shell (PRODUCT §3): every shared phrase from copy.ts as a `content.*` key.
// Feature pages should prefer importing `copy` (typed, with helpers); this bundle exists for t("content.…") lookups.

import type { Dict, I18nBundle } from "@/app/types";
import { copy } from "./copy";
import type { Text } from "./types";

function isText(v: unknown): v is Text {
  return !!v && typeof v === "object" && typeof (v as Text).en === "string" && typeof (v as Text).ru === "string";
}

const en: Dict = {};
const ru: Dict = {};

function add(key: string, v: Text): void {
  en[key] = v.en;
  ru[key] = v.ru;
}

for (const [k, v] of Object.entries(copy)) {
  if (isText(v)) add(`content.${k}`, v);
  else if (v && typeof v === "object") {
    for (const [k2, v2] of Object.entries(v)) if (isText(v2)) add(`content.${k}.${k2}`, v2);
  }
}

// Templates for the shell's interpolation ({name} placeholders).
en["content.asOfBlockTpl"] = "as of block {height}";
ru["content.asOfBlockTpl"] = "на блоке {height}";

export default { en, ru } satisfies I18nBundle;
