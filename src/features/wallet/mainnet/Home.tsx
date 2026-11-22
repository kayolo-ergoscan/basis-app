// /wallet/mainnet — the key's balance sheet: free ERG at the key, the reserve (what it holds, what its notes promise),
// the notes received and redeemable now, what is in flight, and the next step of the checklist (backup → fund →
// reserve → first note). Reads within the §6.4 budget, only while visible.
import { useMemo } from "react";
import { useT } from "@/app/lang";
import { Callout, Card, CoverageTag, Key, Lamp } from "@/ui";
import { balanceOf, spendable } from "@/mainnet/flows";
import { isOpenState } from "@/mainnet/vault";
import { useMw } from "./ctx";
import { R, inFlightOf, useResource, useUnspent, useWatchList } from "./data";
import { ChainLink, Erg, ProblemText, Steps, ergText } from "./ui";

export function HomeScreen() {
  const t = useT();
  const { state, me, height, entries } = useMw();
  const un = useUnspent(me, height);
  const res = useResource(me ? R.reservesOf(me.pub) : null, { everyMs: 120_000 });
  const [watch] = useWatchList(me?.pub ?? null);
  const usable = useMemo(() => (me && un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub)) : []), [me, un.value, entries]);
  const bal = un.value ? balanceOf(un.value.boxes, usable) : null;
  const reserve = (res.value ?? [])[0] ?? null;
  const mine = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub) : []), [entries, me]);
  const open = mine.filter((e) => isOpenState(e.state));
  const notes = mine.filter((e) => e.kind === "note" && e.state !== "failed" && e.state !== "abandoned");
  const t1 = mine.find((e) => e.kind === "t1" && e.state !== "failed" && e.state !== "abandoned");
  const cov = reserve && reserve.debt > 0n ? Number((reserve.collateral * 10000n) / reserve.debt) / 100 : null;
  const funded = (bal?.nano ?? 0n) > 0n || !!reserve || !!t1;
  const step = !funded ? "fund" : !reserve && !t1 ? "reserve" : notes.length === 0 && reserve ? "note" : null;
  return (
    <div className="mw-grid">
      <div className="mw-main">
        <header className="mw-screen-h">
          <h1 className="t-h2">{t("mw.home.h")}</h1>
          <p className="t-lede">{t("mw.home.lede")}</p>
        </header>
        <div className="mw-sheet">
          <Card title={t("mw.home.freeT")} aside={un.problem ? <Lamp state="stale" label={t("mw.home.stale")} /> : undefined}>
            <div className="mw-figure big"><b>{bal ? <Erg nano={bal.nano} /> : "—"}</b><span className="t-small mw-dim">{t("mw.home.freeB")}</span></div>
            <div className="mw-actions">
              <Key size="sm" icon="in" to="/wallet/mainnet/fund">{t("mw.home.fund")}</Key>
              <Key size="sm" icon="right" to={bal && bal.nano > 0n ? "/wallet/mainnet/withdraw" : undefined} disabled={!bal || bal.nano === 0n}>{t("mw.home.withdraw")}</Key>
            </div>
          </Card>
          <Card title={t("mw.home.reserveT")} aside={cov !== null ? <CoverageTag pct={cov} small /> : undefined}>
            {reserve ? (
              <>
                <div className="mw-figure big"><b><Erg nano={reserve.collateral} /></b><span className="t-small mw-dim">{t("mw.home.promised", { debt: ergText(reserve.debt, t.lang) })}</span></div>
                <div className="mw-actions">
                  <Key size="sm" icon="pay" variant="primary" to="/wallet/mainnet/pay">{t("mw.nav.pay")}</Key>
                  <Key size="sm" icon="coin" to="/wallet/mainnet/reserve">{t("mw.home.reserveOpen")}</Key>
                </div>
              </>
            ) : t1 ? (
              <p className="t-small">{t("mw.home.t1Open", { state: t(`mw.state.${t1.state}`) })} <Key size="sm" to="/wallet/mainnet/reserve">{t("mw.home.reserveOpen")}</Key></p>
            ) : (
              <p className="t-small mw-dim">{t("mw.home.noReserve")}</p>
            )}
          </Card>
          <Card title={t("mw.home.recvT")}>
            <div className="mw-figure big"><b>{watch.length}</b><span className="t-small mw-dim">{t("mw.home.recvB")}</span></div>
            <div className="mw-actions">
              <Key size="sm" icon="request" to="/wallet/mainnet/receive">{t("mw.nav.receive")}</Key>
              <Key size="sm" icon="redeem" variant="metal" to={watch.length ? "/wallet/mainnet/redeem" : undefined} disabled={watch.length === 0}>{t("mw.home.redeem")}</Key>
            </div>
          </Card>
        </div>
        {open.length > 0 && (
          <Card title={t("mw.home.openT", { n: open.length })}>
            <ul className="mw-rows">
              {open.slice(0, 6).map((e) => (
                <li key={e.id} className="mw-row">
                  <Lamp state={e.state === "signed" ? "signed" : "tracked"} size={10} />
                  <span>{t(`mw.kind.${e.meta.combine === true ? "combine" : e.kind}`)}</span>
                  <span className="t-small mw-dim">{t(`mw.state.${e.state}`)}</span>
                  {e.txId && <ChainLink kind="tx" id={e.txId} />}
                </li>
              ))}
            </ul>
            <Key size="sm" variant="quiet" to="/wallet/mainnet/activity">{t("mw.nav.activity")}</Key>
          </Card>
        )}
        {(un.problem || res.problem) && <p className="t-small"><ProblemText p={(un.problem ?? res.problem)!} what="read" /></p>}
      </div>
      <aside className="mw-side">
        <Card title={t("mw.home.checkT")}>
          <Steps label={t("mw.home.checkT")} items={[
            { id: "key", label: t("mw.home.c.key"), state: "done" },
            { id: "backup", label: t("mw.home.c.backup"), state: state.backedUp ? "done" : "now" },
            { id: "fund", label: t("mw.home.c.fund"), state: funded ? "done" : "now" },
            { id: "reserve", label: t("mw.home.c.reserve"), state: reserve ? "done" : t1 ? "now" : funded ? "now" : "todo" },
            { id: "note", label: t("mw.home.c.note"), state: notes.length ? "done" : reserve ? "now" : "todo" },
          ]} />
          {step && <Key variant="primary" block to={`/wallet/mainnet/${step === "note" ? "pay" : step}`}>{t(`mw.home.next.${step}`)}</Key>}
        </Card>
        <Callout tone="calm" title={t("mw.beta.t")}>
          <ul className="mw-facts">
            <li>{t("mw.warn.small")}</li>
            <li>{t("mw.warn.key")}</li>
            <li>{t("mw.warn.experimental")}</li>
          </ul>
        </Callout>
      </aside>
    </div>
  );
}
