// /wallet/mainnet/* — the Basis wallet on Ergo mainnet (beta, real ERG), against ErgoScan's tracker. Its own lazy chunk:
// the vault (src/mainnet/vault), the transaction core (src/mainnet/tx), the network (src/mainnet/net) and these screens.
// Every screen carries the mode switch with mainnet lit («Real ERG · beta»); the sandbox wallet and its key are never
// touched from here.
import { useEffect, useMemo, useRef } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { addI18n, getLang, useT } from "@/app/lang";
import { useTitle } from "@/app/frame";
import { useHeight } from "@/app/height";
import { typo } from "@/content";
import { Callout, ErrorState, Icon, Key, KeySeal, Loading, Page, short, useLight } from "@/ui";
import { p2pkTree } from "@/mainnet/tx";
import { setMainnetPubMarker } from "@/mainnet/key-markers";
import { WalletModeSwitch } from "../ModeSwitch";
import strings from "./strings";
import { MwCtx, type MwContext } from "./ctx";
import { useJournal, useJournalWatcher, useVault, useVaultState } from "./data";

export { warmVault as warm } from "./data";
import { dropTokensExcept } from "./inbox";
import { HomeScreen } from "./Home";
import { DenomGuard } from "./denom";
import { StartScreen } from "./Start";
import { FundScreen } from "./Fund";
import { ReserveScreen } from "./Reserve";
import { TopUpScreen } from "./TopUp";
import { RefundScreen } from "./Refund";
import { PayScreen } from "./Pay";
import { ReceiveScreen } from "./Receive";
import { RedeemScreen } from "./Redeem";
import { WithdrawScreen } from "./Withdraw";
import { ActivityScreen } from "./Activity";
import { SettingsScreen } from "./Settings";
import { PendingRequestBar, useReturnToRequest } from "./request";
import "./mainnet.css";

const typeset = (d: Partial<Record<string, string>>, lang: "en" | "ru"): Record<string, string> =>
  Object.fromEntries(Object.entries(d).flatMap(([k, v]) => (typeof v === "string" ? [[k, typo(v, lang)]] : [])));
// As in the sandbox wallet: the reader's language is typeset now, the other one goes in raw and is typeset when idle.
{
  const now = getLang();
  const later = now === "en" ? "ru" : "en";
  addI18n(now === "en" ? { en: typeset(strings.en, "en"), ru: { ...strings.ru } as Record<string, string> } : { en: { ...strings.en }, ru: typeset(strings.ru, "ru") });
  const idle = (cb: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 3000 }) : window.setTimeout(cb, 120));
  if (typeof window !== "undefined") idle(() => { const done = typeset(strings[later], later); addI18n(later === "en" ? { en: done, ru: {} } : { en: {}, ru: done }); });
}

const NAV: [string, string, string][] = [
  ["/wallet/mainnet", "mw.nav.home", "home"],
  ["/wallet/mainnet/pay", "mw.nav.pay", "pay"],
  ["/wallet/mainnet/receive", "mw.nav.receive", "request"],
  ["/wallet/mainnet/reserve", "mw.nav.reserve", "coin"],
  ["/wallet/mainnet/activity", "mw.nav.activity", "table"],
  ["/wallet/mainnet/settings", "mw.nav.settings", "settings"],
];

function TopBar({ ctx }: { ctx: MwContext | null }) {
  const t = useT();
  const key = ctx?.state.key ?? null;
  return (
    <div className="mw-top">
      <div className="mw-top-l">
        <WalletModeSwitch mode="mainnet" />
      </div>
      {ctx && key && (
        <div className="mw-top-r">
          <span className="mw-keychip" title={key.address}>
            <KeySeal pk={key.pub} size="sm" />
            <span className="mono">{short(key.address, 6, 4)}</span>
          </span>
          {ctx.state.status === "unlocked" ? (
            <Key size="sm" icon="lock" onClick={() => ctx.vault.lock("manual")}>{t("mw.top.lock")}</Key>
          ) : (
            <span className="mw-locked"><Icon name="lock" size={14} />{t("mw.top.locked")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function MwNav() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  useLight(ref, undefined, "mw-nav");
  return (
    <nav className="mw-nav" aria-label={t("mw.nav.aria")} ref={ref}>
      <span className="light" aria-hidden="true" />
      {NAV.map(([to, k, icon]) => (
        <NavLink key={to} to={to} end={to === "/wallet/mainnet"} className={({ isActive }) => (isActive ? "on" : undefined)}>
          <Icon name={icon} size={15} />
          {t(k)}
        </NavLink>
      ))}
    </nav>
  );
}

export default function MainnetWallet() {
  const t = useT();
  useTitle(`${t("mw.title")} · ${t("wallet.title")}`);
  const { vault, failed } = useVault();
  const state = useVaultState(vault);
  const entries = useJournal(vault);
  const { height } = useHeight();
  const key = state.key;
  const me = useMemo(() => (key ? { pub: key.pub, address: key.address, tree: p2pkTree(key.pub) } : null), [key]);
  useJournalWatcher(vault, me, height, entries);
  // the sandbox refuses to import this key while it is here (keys review P2-7)
  const pubNow = key?.pub ?? null;
  useEffect(() => {
    if (pubNow) setMainnetPubMarker(pubNow);
    else if (state.status === "none") setMainnetPubMarker(null);
  }, [pubNow, state.status]);
  // the inbox signatures kept in this tab belong to the key here: none is left once it is wiped or replaced
  useEffect(() => {
    if (pubNow) dropTokensExcept(pubNow);
    else if (state.status === "none") dropTokensExcept(null);
  }, [pubNow, state.status]);
  const ctx: MwContext | null = vault && state.status !== "loading" ? { vault, state, entries, me, height } : null;
  // a payment request waiting in this tab: back to it once the key set up in this visit is backed up
  useReturnToRequest((state.status === "locked" || state.status === "unlocked") && state.backedUp, !ctx);

  let body;
  if (failed) body = <ErrorState title={t("mw.boot.errT")} text={t("mw.boot.errB")} onRetry={() => window.location.reload()} retryLabel={t("mw.boot.retry")} />;
  else if (!ctx) body = <Loading label={t("mw.boot.loading")} seed="mainnet-wallet" />;
  else if (state.status === "unsupported") {
    body = (
      <Callout tone="alarm" title={t("mw.unsupported.t")}>
        <p>{t("mw.unsupported.b", { what: state.missing.map((m) => t(`mw.unsupported.${m}`)).join(", ") })}</p>
      </Callout>
    );
  } else {
    const hasKey = state.status === "locked" || state.status === "unlocked";
    body = (
      <MwCtx.Provider value={ctx}>
        {hasKey && state.backedUp && <MwNav />}
        <PendingRequestBar />
        {/* rendered under the feature's "/wallet/*": these paths are relative to /wallet */}
        <DenomGuard>
        <Routes>
          <Route path="mainnet">
            <Route index element={hasKey && state.backedUp ? <HomeScreen /> : <StartScreen />} />
            <Route path="setup" element={<StartScreen />} />
            <Route path="fund" element={<FundScreen />} />
            <Route path="reserve" element={<ReserveScreen />} />
            <Route path="topup" element={<TopUpScreen />} />
            <Route path="refund" element={<RefundScreen />} />
            <Route path="pay" element={<PayScreen />} />
            <Route path="receive" element={<ReceiveScreen />} />
            <Route path="redeem" element={<RedeemScreen />} />
            <Route path="withdraw" element={<WithdrawScreen />} />
            <Route path="activity" element={<ActivityScreen />} />
            <Route path="settings" element={<SettingsScreen />} />
            <Route path="*" element={<Navigate to="/wallet/mainnet" replace />} />
          </Route>
        </Routes>
        </DenomGuard>
      </MwCtx.Provider>
    );
  }
  return (
    <Page className="mw-page">
      <TopBar ctx={ctx} />
      {body}
    </Page>
  );
}
