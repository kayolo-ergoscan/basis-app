// Shell API for features: i18n, theme, height, pulse, commands, titles.
export { useT, useLang, T, rich, translate, translatePlural, getLang, setLang, addI18n, type TFn } from "./lang";
export { useTheme, getTheme, setTheme, toggleTheme, type Theme } from "./theme";
export { useHeight, getHeight, type HeightState } from "./height";
export { pulse, usePulse, type Pulse } from "./pulse";
export { useCommands, openCommandBar, openHelp, type Command } from "./commands";
export { useTitle } from "./frame";
export type { FeatureRoute, I18nBundle, Dict, Lang } from "./types";
