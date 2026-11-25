// The wallet home in two compositions (VISUAL §13): desktop three columns [identity + the three answers + keys |
// notes and the start quest | the selected note or the open flow], and the phone column of the reference render. Section pages (notes,
// reserve, policy, contacts, settings) share one frame with the wallet bar.
import { useState } from "react";
import { Outlet, useLocation, useMatch, useParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { Callout, Key, Lamp, Loading } from "@/ui";
import { useClock, useWallet } from "@/world";
import { useFmt, usePrefs, useWalletModel } from "./lib/hooks";
import { filterRows, sortRows, type TabId } from "./lib/model";
import { WalletBar } from "./parts/bits";
import { ActionKeys, ChainPurse, Eclipse, FirstSteps, Identity, NetBlock, PolicySummary, ReserveSummary, Tour } from "./parts/home";
import { NotesPanel } from "./parts/notes";
import { NoteDetail } from "./parts/noteDetail";
import { Frame } from "./parts/bits";
import { useNow } from "./parts/now";

function BackupNudge() {
  const t = useT();
  const { identity } = useWallet();
  if (!identity || identity.backedUp) return null;
  return (
    <Callout tone="calm" title={t("wallet.nudge.t")} className="wl-nudge">
      {t("wallet.nudge.b")}{" "}
      <Key size="sm" variant="quiet" to="/wallet/settings">
        {t("wallet.nudge.key")}
      </Key>
    </Callout>
  );
}

/** Desktop: three columns; the right column holds the selected note or the open flow (an <Outlet/>). */
export function HomeWide() {
  const t = useT();
  const p = usePrefs();
  const m = useWalletModel(p.denom);
  const [tab, setTab] = useState<TabId>("all");
  const loc = useLocation();
  const noteMatch = useMatch("/wallet/note/:key");
  const nowMs = useNow();
  if (!m) return <Loading />;
  const first = sortRows(filterRows(m.rows, "all"), p.sort)[0]?.key ?? null;
  const selected = noteMatch?.params.key ?? (loc.pathname.replace(/\/$/, "") === "/wallet" ? first : null);
  const hasIn = m.rows.some((r) => r.dir === "in" && r.claim > 0n);
  return (
    <div className="wl-wide">
      <WalletBar />
      <div className="wl-grid">
        <aside className="wl-col-l" aria-label={t("wallet.col.you")}>
          <Identity m={m} phone={false} />
          <Eclipse m={m} />
          {/* three answers: 1 what you have (the play coins), 2 owed to you and 3 you owe (the balance sheet) */}
          <ChainPurse m={m} />
          <NetBlock m={m} denom={p.denom} />
          <ActionKeys hasIn={hasIn} />
          <BackupNudge />
        </aside>
        <div className="wl-col-c" data-tour="notes">
          <NotesPanel rows={m.rows} nowMs={nowMs} hrefOf={(r) => `/wallet/note/${r.key}`} tab={tab} onTab={setTab} selected={selected} />
          <FirstSteps m={m} />
          {/* reserve and policy sit under the notes, so the three columns stay balanced on a tall screen */}
          <div className="wl-below">
            <ReserveSummary m={m} />
            <PolicySummary m={m} />
          </div>
        </div>
        <div className="wl-col-r">
          <Outlet context={{ first }} />
        </div>
      </div>
      <Tour />
    </div>
  );
}

/** The index of the right column: the first note of the list, or what to do first. */
export function DefaultFocus() {
  const p = usePrefs();
  const m = useWalletModel(p.denom);
  if (!m) return null;
  const first = sortRows(filterRows(m.rows, "all"), p.sort)[0];
  if (!first)
    return (
      <div className="wl-panel">
        <FirstSteps m={m} />
      </div>
    );
  return <NoteDetail noteKey={first.key} />;
}

/** Phone and narrow screens: the reference render's column. */
export function HomeNarrow() {
  const t = useT();
  const p = usePrefs();
  const m = useWalletModel(p.denom);
  const nowMs = useNow();
  const [tab, setTab] = useState<TabId>("all");
  if (!m) return <Loading />;
  const hasIn = m.rows.some((r) => r.dir === "in" && r.claim > 0n);
  return (
    <div className="wl-narrow">
      <WalletBar />
      <div className="wl-narrow-grid">
        <div className="wl-narrow-top">
          <Identity m={m} phone />
          <Eclipse m={m} />
          <ChainPurse m={m} />
          <NetBlock m={m} denom={p.denom} />
          <ActionKeys hasIn={hasIn} />
          <BackupNudge />
        </div>
        <div className="wl-narrow-notes" data-tour="notes">
          <NotesPanel rows={m.rows} nowMs={nowMs} hrefOf={(r) => `/wallet/note/${r.key}`} tab={tab} onTab={setTab} tabs={false} limit={6} more="/wallet/notes" />
          <FirstSteps m={m} />
        </div>
      </div>
      <div className="wl-below">
        <ReserveSummary m={m} />
        <PolicySummary m={m} />
      </div>
      <Tour />
    </div>
  );
}

/** Section pages and narrow-screen flows: the wallet bar (desktop) and one column. */
export function Sub({ wide }: { wide?: boolean }) {
  return (
    <div className={`wl-sub${wide ? " wide" : ""}`}>
      <WalletBar />
      <div className="wl-sub-in">
        <Outlet />
      </div>
    </div>
  );
}

export function NoteRoute({ page }: { page: boolean }) {
  const { key } = useParams();
  return <NoteDetail noteKey={key ?? ""} page={page} />;
}

/** What the lamp on a note says (the four states of a note on its way to Ergo). */
function LampLegend() {
  const t = useT();
  const states = ["tracked", "committed", "stale", "alarm"] as const;
  return (
    <section className="card wl-legend" aria-labelledby="wl-legend-h">
      <div className="card-b">
        <h2 className="label" id="wl-legend-h">
          <b>{t("wallet.legend.title")}</b>
        </h2>
        <ul>
          {states.map((s) => (
            <li key={s}>
              <Lamp state={s} size={10} />
              <span>
                <b>{t(`wallet.legend.${s}`)}</b>
                <span className="t-small">{t(`wallet.legend.${s}.b`)}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** /wallet/notes: every note with the tabs. */
export function NotesPage({ page }: { page: boolean }) {
  const t = useT();
  const p = usePrefs();
  const m = useWalletModel(p.denom);
  const [tab, setTab] = useState<TabId>("all");
  const nowMs = useNow();
  const f = useFmt();
  const { height } = useClock();
  if (!m) return <Loading />;
  return (
    <Frame page={page} title={t("wallet.notes.page")} sub={t("wallet.notes.pageSub", { h: f.height(height) })} labelId="wl-notes-page" className="wl-flow wl-sec">
      <div className="wl-split">
        <div className="wl-main">
          <NotesPanel rows={m.rows} nowMs={nowMs} hrefOf={(r) => `/wallet/note/${r.key}`} tab={tab} onTab={setTab} title={false} />
        </div>
        <aside className="wl-aside">
          <LampLegend />
        </aside>
      </div>
    </Frame>
  );
}
