// /wallet/mainnet — the key's balance sheet: free ERG at the key, the reserve (what it holds, what its notes promise),
// the notes received and redeemable now, what is in flight, and the next step of the checklist (backup → fund →
// reserve → first note). Reads within the §6.4 budget, only while visible.
// Token reserves: each one its own card in its own unit (shown once the tracker lists one or this browser made one),
// and the tokens at the key as their own lines. Nothing is ever added across denominations.
import { useMemo } from "react";
import { useT } from "@/app/lang";
import { Callout, Card, Key, Lamp, Tag, int } from "@/ui";
import { balanceOf, reserveLife, spendable, tokenBalanceOf } from "@/mainnet/flows";
import { blocksNewT1In, isOpenState } from "@/mainnet/vault";
import { RESERVE_TOKENS, denomOfToken, type ReserveToken } from "@/mainnet/tx";
import { useMw } from "./ctx";
import { R, inFlightOf, useResource, useUnspent, useWatchList } from "./data";
import { ChainLink, Erg, ProblemText, ReserveTag, Steps, ergText } from "./ui";
import { Amt, amtText, denomQuery, entryDenom } from "./denom";

/** A token reserve of this key: its own figures in its own unit (the tracker's entry this key minted, as on Reserve). */
function TokenReserveCard({ token }: { token: ReserveToken }) {
  const t = useT();
  const { me, height, entries } = useMw();
  const denom = denomOfToken(token);
  const gate = useResource(me ? R.trackedGate(me.pub, denom) : null, { everyMs: 120_000 });
  const reserve = gate.value?.k === "own" ? gate.value.r : null;
  const t1 = me ? entries.find((e) => e.pub === me.pub && blocksNewT1In(e, denom)) ?? null : null;
  const life = reserve ? reserveLife(reserve.refundHeight, height) : null;
  const q = denomQuery(denom);
  return (
    <Card title={t("mw.dn.cardT", { sym: token.symbol })} aside={reserve ? <ReserveTag r={reserve} small /> : undefined}>
      {reserve ? (
        <>
          <div className="mw-figure big"><b><Amt raw={reserve.collateral} denom={denom} /></b><span className="t-small mw-dim">{t("mw.home.promised", { debt: amtText(reserve.debt, denom) })}</span></div>
          {life?.kind === "refund" && (
            <p className="t-small"><Tag tone={life.clock.open ? "ok" : "metal"} glyph="◷">{life.clock.open ? t("mw.ref.tagOpen") : t("mw.ref.tagWaiting")}</Tag> {life.clock.open ? t("mw.home.refundOpen") : t("mw.home.refundRun", { h: int(Number(life.clock.unlockAt)) })}</p>
          )}
          <div className="mw-actions">
            {life?.kind === "refund" ? (
              <Key size="sm" icon="coin" variant={life.clock.open ? "primary" : undefined} to={`/wallet/mainnet/refund${q}`}>{t("mw.home.refundSee")}</Key>
            ) : (
              <>
                <Key size="sm" icon="pay" variant="primary" to={`/wallet/mainnet/pay${q}`}>{t("mw.nav.pay")}</Key>
                <Key size="sm" icon="in" to={`/wallet/mainnet/topup${q}`}>{t("mw.res.topUp")}</Key>
              </>
            )}
            <Key size="sm" icon="coin" variant="quiet" to={`/wallet/mainnet/reserve${q}`}>{t("mw.home.reserveOpen")}</Key>
          </div>
        </>
      ) : t1 ? (
        <p className="t-small">{t("mw.home.t1Open", { state: t(`mw.state.${t1.state}`) })} <Key size="sm" to={`/wallet/mainnet/reserve${q}`}>{t("mw.home.reserveOpen")}</Key></p>
      ) : gate.value?.k === "unproven" ? (
        <p className="t-small">{t("mw.home.unproven")} <Key size="sm" to={`/wallet/mainnet/reserve${q}`}>{t("mw.home.reserveOpen")}</Key></p>
      ) : gate.value === null && !gate.problem ? (
        <p className="t-small mw-dim">{t("mw.top.loading")}</p>
      ) : (
        <p className="t-small mw-dim">{t("mw.home.unchecked")}</p>
      )}
    </Card>
  );
}

export function HomeScreen() {
  const t = useT();
  const { state, me, height, entries } = useMw();
  const un = useUnspent(me, height);
  // the key's own reserve, never one planted under it (wallet-t3 P2: the reserve screen's rule, trackedGateOf)
  const gate = useResource(me ? R.trackedGate(me.pub) : null, { everyMs: 120_000 });
  // token reserves get their card only when the tracker lists one for this key or this browser made one (no reads
  // for a key that has none: the listing is the one the ERG card's gate reads anyway)
  const listed = useResource(me ? R.reservesOf(me.pub) : null, { everyMs: 120_000 });
  const [watch] = useWatchList(me?.pub ?? null);
  const usable = useMemo(() => (me && un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub)) : []), [me, un.value, entries]);
  const bal = un.value ? balanceOf(un.value.boxes, usable) : null;
  const reserve = gate.value?.k === "own" ? gate.value.r : null;
  const unproven = gate.value?.k === "unproven";
  const unchecked = gate.value?.k === "unchecked";
  const life = reserve ? reserveLife(reserve.refundHeight, height) : null;
  const mine = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub) : []), [entries, me]);
  const open = mine.filter((e) => isOpenState(e.state));
  // the ERG card's notes and T1 only (review LOW-2): a SigUSD note or T1 says nothing about the ERG reserve
  const notes = mine.filter((e) => e.kind === "note" && e.state !== "failed" && e.state !== "abandoned" && entryDenom(e) === "erg");
  // a T1 retired after a completed refund no longer counts (the key may create a new reserve)
  const t1 = mine.find((e) => blocksNewT1In(e, "erg"));
  const funded = (bal?.nano ?? 0n) > 0n || !!reserve || !!t1;
  const tokenCards = RESERVE_TOKENS.filter((tk) => (listed.value ?? []).some((r) => r.owner === me?.pub && r.token === tk.id) || mine.some((e) => blocksNewT1In(e, denomOfToken(tk))));
  const tokensHere = RESERVE_TOKENS.map((tk) => ({ tk, raw: tokenBalanceOf(usable, tk.id) })).filter((x) => x.raw > 0n);
  const step = !funded ? "fund" : !reserve && !t1 && gate.value?.k === "none" ? "reserve" : notes.length === 0 && reserve && life?.kind !== "refund" ? "note" : null;
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
            {tokensHere.length > 0 && (
              <ul className="mw-facts mw-facts-tight">
                {tokensHere.map(({ tk, raw }) => <li key={tk.id}><Amt raw={raw} denom={denomOfToken(tk)} /> <span className="t-small mw-dim">{t("mw.dn.atKey")}</span></li>)}
              </ul>
            )}
            <div className="mw-actions">
              <Key size="sm" icon="in" to="/wallet/mainnet/fund">{t("mw.home.fund")}</Key>
              <Key size="sm" icon="right" to={bal && bal.nano > 0n ? "/wallet/mainnet/withdraw" : undefined} disabled={!bal || bal.nano === 0n}>{t("mw.home.withdraw")}</Key>
            </div>
          </Card>
          <Card title={t("mw.home.reserveT")} aside={reserve ? <ReserveTag r={reserve} small /> : undefined}>
            {reserve ? (
              <>
                <div className="mw-figure big"><b><Erg nano={reserve.collateral} /></b><span className="t-small mw-dim">{t("mw.home.promised", { debt: ergText(reserve.debt) })}</span></div>
                {life?.kind === "refund" && (
                  <p className="t-small"><Tag tone={life.clock.open ? "ok" : "metal"} glyph="◷">{life.clock.open ? t("mw.ref.tagOpen") : t("mw.ref.tagWaiting")}</Tag> {life.clock.open ? t("mw.home.refundOpen") : t("mw.home.refundRun", { h: int(Number(life.clock.unlockAt)) })}</p>
                )}
                <div className="mw-actions">
                  {life?.kind === "refund" ? (
                    <Key size="sm" icon="coin" variant={life.clock.open ? "primary" : undefined} to="/wallet/mainnet/refund">{t("mw.home.refundSee")}</Key>
                  ) : (
                    <>
                      <Key size="sm" icon="pay" variant="primary" to="/wallet/mainnet/pay">{t("mw.nav.pay")}</Key>
                      <Key size="sm" icon="in" to="/wallet/mainnet/topup">{t("mw.res.topUp")}</Key>
                    </>
                  )}
                  <Key size="sm" icon="coin" variant="quiet" to="/wallet/mainnet/reserve">{t("mw.home.reserveOpen")}</Key>
                </div>
              </>
            ) : t1 ? (
              <p className="t-small">{t("mw.home.t1Open", { state: t(`mw.state.${t1.state}`) })} <Key size="sm" to="/wallet/mainnet/reserve">{t("mw.home.reserveOpen")}</Key></p>
            ) : unproven ? (
              <p className="t-small">{t("mw.home.unproven")} <Key size="sm" to="/wallet/mainnet/reserve">{t("mw.home.reserveOpen")}</Key></p>
            ) : unchecked ? (
              <p className="t-small mw-dim">{t("mw.home.unchecked")}</p>
            ) : gate.value === null && !gate.problem ? (
              <p className="t-small mw-dim">{t("mw.top.loading")}</p>
            ) : (
              <p className="t-small mw-dim">{t("mw.home.noReserve")}</p>
            )}
          </Card>
          {tokenCards.map((tk) => <TokenReserveCard key={tk.id} token={tk} />)}
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
        {(un.problem || gate.problem) && <p className="t-small"><ProblemText p={(un.problem ?? gate.problem)!} what="read" /></p>}
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
