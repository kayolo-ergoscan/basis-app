// /wallet/* — a complete Basis wallet on the sandbox town (src/world): your sandbox key, real signatures, play
// money. The lazy chunk registers its strings, toasts the town's notices about You and routes the sub-pages.
import { Navigate, Route, Routes } from "react-router-dom";
import { addI18n, getLang, useT } from "@/app/lang";
import { useTitle } from "@/app/frame";
import { ErrorState, Loading, Page, toast, useMedia } from "@/ui";
import { useNotices, useTown, useTownReady, useWallet } from "@/world";
import { typo } from "@/content";
import strings from "./strings";
import { useWT } from "./lib/hooks";
import { DefaultFocus, HomeNarrow, HomeWide, NoteRoute, NotesPage, Sub } from "./Home";
import { Onboarding } from "./flows/Onboarding";
import { PayFlow } from "./flows/Pay";
import { RequestFlow, ScanFlow } from "./flows/Request";
import { RedeemFlow } from "./flows/Redeem";
import { ReservePage } from "./flows/Reserve";
import { PolicyPage } from "./flows/Policy";
import { ContactsPage } from "./flows/Contacts";
import { SettingsPage } from "./flows/Settings";
import { WalletModeSwitch } from "./ModeSwitch";
import "./wallet.css";

const typeset = (d: Partial<Record<string, string>>, lang: "en" | "ru"): Record<string, string> =>
  Object.fromEntries(Object.entries(d).flatMap(([k, v]) => (typeof v === "string" ? [[k, typo(v, lang)]] : [])));
// The reader's language is typeset now; the other one goes in raw (so no key is ever missing) and is typeset in idle
// slices, so the first paint of the wallet does not pay for both languages.
{
  const now = getLang();
  const later = now === "en" ? "ru" : "en";
  addI18n(now === "en" ? { en: typeset(strings.en, "en"), ru: { ...strings.ru } as Record<string, string> } : { en: { ...strings.en } as Record<string, string>, ru: typeset(strings.ru, "ru") });
  const keys = Object.keys(strings[later]);
  const idle = (cb: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 3000 }) : window.setTimeout(cb, 120));
  let at = 0;
  const slice = () => {
    const part: Partial<Record<string, string>> = {};
    for (const k of keys.slice(at, at + 200)) part[k] = strings[later][k];
    at += 200;
    const done = typeset(part, later);
    addI18n(later === "en" ? { en: done, ru: {} } : { en: {}, ru: done });
    if (at < keys.length) idle(slice);
  };
  if (typeof window !== "undefined") idle(slice);
}

/** The town's notices about You (a note in, a redemption from your reserve, a request answered) as toasts. */
function NoticeToasts() {
  const wt = useWT();
  const t = useT();
  useNotices((n) => {
    const ru = (s: string) => (t.lang === "ru" ? s.replace(/(\d)\.(\d)/g, "$1,$2") : s);
    toast({ kind: n.kind, title: ru(wt(n.titleKey, n.params)), detail: n.detailKey ? ru(wt(n.detailKey, n.params)) : undefined, ttl: n.sticky ? 0 : undefined });
  });
  return null;
}

function WalletRoutes() {
  const wide = useMedia("(min-width: 1180px)");
  const page = !wide;
  return (
    <Routes>
      {wide ? (
        <Route element={<HomeWide />}>
          <Route index element={<DefaultFocus />} />
          <Route path="note/:key" element={<NoteRoute page={false} />} />
          <Route path="pay" element={<PayFlow page={false} />} />
          <Route path="request" element={<RequestFlow page={false} />} />
          <Route path="scan" element={<ScanFlow page={false} />} />
          <Route path="redeem" element={<RedeemFlow page={false} />} />
        </Route>
      ) : (
        <>
          <Route index element={<HomeNarrow />} />
          <Route element={<Sub />}>
            <Route path="note/:key" element={<NoteRoute page />} />
            <Route path="pay" element={<PayFlow page />} />
            <Route path="request" element={<RequestFlow page />} />
            <Route path="scan" element={<ScanFlow page />} />
            <Route path="redeem" element={<RedeemFlow page />} />
          </Route>
        </>
      )}
      <Route element={<Sub wide />}>
        <Route path="notes" element={<NotesPage page />} />
        <Route path="reserve" element={<ReservePage page />} />
        <Route path="policy" element={<PolicyPage page />} />
        <Route path="contacts" element={<ContactsPage page />} />
        <Route path="settings" element={<SettingsPage page />} />
      </Route>
      <Route path="*" element={<Navigate to="/wallet" replace />} />
    </Routes>
  );
}

export default function WalletPage() {
  const t = useT();
  useTitle(t("wallet.title"));
  const ready = useTownReady();
  const { identity } = useWallet();
  const joined = useTown((s) => s.joined);
  let body;
  if (ready.status === "error")
    body = (
      <ErrorState title={t("wallet.boot.errT")} text={t("wallet.boot.errB")} onRetry={() => window.location.reload()} retryLabel={t("wallet.boot.retry")} detail={ready.error ?? undefined} />
    );
  else if (!ready.ready) body = <Loading label={t("wallet.boot.loading")} seed="wallet" />;
  else if (!identity || !joined) body = <Onboarding />;
  else body = <WalletRoutes />;
  return (
    <Page className="wl-page">
      <div className="wl-mode-row"><WalletModeSwitch mode="sandbox" /></div>
      <NoticeToasts />
      {body}
    </Page>
  );
}
