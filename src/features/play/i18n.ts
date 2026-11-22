// play strings loaded with the shell (nav label, title, command bar). The page's own strings live in ./strings.ts
// and load with the lazy route chunk.
import type { I18nBundle } from "@/app/types";

export default {
  en: {
    "play.title": "Sandbox",
    "play.eyebrow": "SANDBOX · PLAY MONEY",
    "play.lede": "A whole Basis economy in your browser: eleven stories, every engine command, real cryptography, play money.",
    "play.cmd.open": "Play the sandbox",
    "play.cmd.free": "Sandbox: free mode",
    "play.cmd.dark": "Sandbox: the tracker goes dark",
    "play.cmd.swarm": "Sandbox: agents paying per call",
    "play.cmd.clearing": "Sandbox: clearing a loop",
  },
  ru: {
    "play.title": "Песочница",
    "play.eyebrow": "ПЕСОЧНИЦА · ИГРОВЫЕ ДЕНЬГИ",
    "play.lede": "Целая экономика Basis в вашем браузере: одиннадцать историй, все команды движка, настоящая криптография, игровые деньги.",
    "play.cmd.open": "Открыть песочницу",
    "play.cmd.free": "Песочница: свободный режим",
    "play.cmd.dark": "Песочница: трекер пропадает",
    "play.cmd.swarm": "Песочница: агенты платят за вызов",
    "play.cmd.clearing": "Песочница: закрыть кольцо долгов",
  },
} satisfies I18nBundle;
