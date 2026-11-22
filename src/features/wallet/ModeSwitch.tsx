// The wallet's two modes (design §6.1), like the tracker page's switch: the sandbox town (play money) and mainnet (beta,
// real ERG). Switching never moves a key: each mode has its own key and storage. Shared by both lazy pages.
import { Link } from "react-router-dom";
import { addI18n, useT } from "@/app/lang";
import { typo } from "@/content";
import "./mode.css";

/** The switch's own strings (both lazy pages use it, so it registers them itself). */
export const MODE_STRINGS = {
  en: {
    "wallet.mode.aria": "Wallet mode",
    "wallet.mode.sandbox": "Sandbox",
    "wallet.mode.sandboxSub": "Town tracker · play money",
    "wallet.mode.mainnet": "Mainnet",
    "wallet.mode.mainnetSub": "Beta · real ERG",
  },
  ru: {
    "wallet.mode.aria": "Режим кошелька",
    "wallet.mode.sandbox": "Песочница",
    "wallet.mode.sandboxSub": "Трекер города · игровые деньги",
    "wallet.mode.mainnet": "Mainnet",
    "wallet.mode.mainnetSub": "Бета · настоящие ERG",
  },
};
addI18n({
  en: Object.fromEntries(Object.entries(MODE_STRINGS.en).map(([k, v]) => [k, typo(v, "en")])),
  ru: Object.fromEntries(Object.entries(MODE_STRINGS.ru).map(([k, v]) => [k, typo(v, "ru")])),
});

export function WalletModeSwitch({ mode }: { mode: "sandbox" | "mainnet" }) {
  const t = useT();
  const items = [
    { id: "sandbox", to: "/wallet", label: t("wallet.mode.sandbox"), sub: t("wallet.mode.sandboxSub"), glyph: "◌" },
    { id: "mainnet", to: "/wallet/mainnet", label: t("wallet.mode.mainnet"), sub: t("wallet.mode.mainnetSub"), glyph: "◆" },
  ] as const;
  return (
    <nav className="wl-mode" aria-label={t("wallet.mode.aria")}>
      {items.map((x) => (
        <Link key={x.id} to={x.to} className={x.id === mode ? "on" : undefined} aria-current={x.id === mode ? "page" : undefined}>
          <span className="wl-mode-l"><span className="g" aria-hidden="true">{x.glyph}</span>{x.label}</span>
          <span className="wl-mode-s">{x.sub}</span>
        </Link>
      ))}
    </nav>
  );
}
