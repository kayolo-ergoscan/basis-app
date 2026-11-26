// The wallet's two modes (design §6.1), like the tracker page's switch: the sandbox town (play money) and mainnet (beta,
// real ERG). Switching never moves a key: each mode has its own key and storage. Shared by both lazy pages. On the
// mainnet wallet the lit mainnet tab is the one sign that the screen moves real ERG: its «Real ERG · beta» line is
// in gold (value on Ergo), on every mainnet screen.
import { useRef } from "react";
import { Link } from "react-router-dom";
import { addI18n, useT } from "@/app/lang";
import { typo } from "@/content";
import { useGlide } from "@/ui";
import "./mode.css";

/** The switch's own strings (both lazy pages use it, so it registers them itself). */
export const MODE_STRINGS = {
  en: {
    "wallet.mode.aria": "Wallet mode",
    "wallet.mode.sandbox": "Sandbox",
    "wallet.mode.sandboxSub": "Town tracker · play money",
    "wallet.mode.mainnet": "Mainnet",
    "wallet.mode.mainnetSub": "Real ERG · beta",
  },
  ru: {
    "wallet.mode.aria": "Режим кошелька",
    "wallet.mode.sandbox": "Песочница",
    "wallet.mode.sandboxSub": "Трекер города · игровые деньги",
    "wallet.mode.mainnet": "Основная сеть",
    "wallet.mode.mainnetSub": "Настоящие ERG · бета",
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
  const ref = useRef<HTMLElement>(null);
  useGlide(ref, undefined, "wl-mode");
  return (
    <nav className="wl-mode" aria-label={t("wallet.mode.aria")} ref={ref}>
      <span className="glide" aria-hidden="true" />
      {items.map((x) => (
        <Link key={x.id} to={x.to} data-mode={x.id} className={x.id === mode ? "on" : undefined} aria-current={x.id === mode ? "page" : undefined}>
          <span className="wl-mode-l"><span className="g" aria-hidden="true">{x.glyph}</span>{x.label}</span>
          <span className="wl-mode-s">{x.sub}</span>
        </Link>
      ))}
    </nav>
  );
}
