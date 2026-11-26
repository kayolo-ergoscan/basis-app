// /wallet/mainnet — the key's home answers three questions in plain words: what you have (free ERG at the key), what
// others owe you (the payers you follow, whose notes you can redeem) and what you owe (your notes against your
// reserve). Above them, until it is done, the setup quest: your house lights one window per step (backup → fund →
// reserve → first note) with the one next action; once done it folds away. Reads within the §6.4 budget, only while
// visible.
// Token reserves: each one its own card in its own unit (shown once the tracker lists one or this browser made one),
// and the tokens at the key as their own lines. Nothing is ever added across denominations.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { Callout, Card, HouseLights, Key, Lamp, Tag, int } from "@/ui";
import { balanceOf, reserveLife, reserveTag, spendable, tokenBalanceOf } from "@/mainnet/flows";
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
    <Card title={t("mw.home.q.oweIn", { sym: token.symbol })} aside={reserve ? <ReserveTag r={reserve} small /> : undefined}>
      {reserve ? (
        <>
          <div className="mw-figure big"><b><Amt raw={reserve.debt} denom={denom} /></b><span className="t-small mw-dim">{t("mw.home.oweB")}</span></div>
          <Backing collateral={amtText(reserve.collateral, denom)} r={reserve} />
          {life?.kind === "refund" && (
            <p className="t-small"><Tag tone={life.clock.open ? "ok" : "metal"} glyph="◷">{life.clock.open ? t("mw.ref.tagOpen") : t("mw.ref.tagWaiting")}</Tag> {life.clock.open ? t("mw.home.refundOpen") : t("mw.home.refundRun", { h: int(Number(life.clock.unlockAt)) })}</p>
          )}
          <div className="mw-actions">
            {life?.kind === "refund" ? (
              <Key size="sm" icon="coin" to={`/wallet/mainnet/refund${q}`}>{t("mw.home.refundSee")}</Key>
            ) : (
              <>
                <Key size="sm" icon="pay" to={`/wallet/mainnet/pay${q}`}>{t("mw.nav.pay")}</Key>
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
      ) : gate.value === null && gate.problem ? (
        <p className="t-small"><ProblemText p={gate.problem} what="read" /></p>
      ) : (
        <p className="t-small mw-dim">{t("mw.home.unchecked")}</p>
      )}
    </Card>
  );
}

/** Under "what you owe": the reserve behind those notes, and how much of them it covers, in words (the band tag next
 *  to the card's title — «Fine», «Watch»… — is the wallet's reading of the same number). */
function Backing({ collateral, r }: { collateral: string; r: { collateral: bigint; debt: bigint; pendingRedemption: bigint } }) {
  const t = useT();
  const tag = reserveTag(r);
  return (
    <p className="t-small mw-backing">
      {t("mw.home.backedBy", { reserve: collateral })}
      {/* floor, not round: 149.6 % must not read «150 %» next to a «watch» band */}
      {tag.kind === "band" ? ` ${t("mw.home.cover", { pct: int(Math.floor(tag.pct)) })}` : ""}
    </p>
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
  const quest = [
    { id: "key", label: t("mw.home.c.key"), state: "done" as const },
    { id: "backup", label: t("mw.home.c.backup"), state: state.backedUp ? ("done" as const) : ("now" as const) },
    { id: "fund", label: t("mw.home.c.fund"), state: funded ? ("done" as const) : ("now" as const) },
    { id: "reserve", label: t("mw.home.c.reserve"), state: reserve ? ("done" as const) : t1 ? ("now" as const) : funded ? ("now" as const) : ("todo" as const) },
    { id: "note", label: t("mw.home.c.note"), state: notes.length ? ("done" as const) : reserve ? ("now" as const) : ("todo" as const) },
  ];
  const lit = quest.filter((s) => s.state === "done").length;
  // one primary action on the page: the quest's next step while there is one; then Pay (or the refund once it can be
  // completed); Redeem shines in gold only when nothing else leads
  const refundOpen = life?.kind === "refund" && life.clock.open;
  const lead: "quest" | "pay" | "refund" | "redeem" | null = step ? "quest" : refundOpen ? "refund" : reserve && life?.kind !== "refund" ? "pay" : watch.length ? "redeem" : null;
  return (
    <div className="mw-home">
      <header className="mw-screen-h">
        <h1 className="t-h2">{t("mw.home.h")}</h1>
        <p className="t-lede">{t("mw.home.lede")}</p>
      </header>
      {step && (
        <section className="card mw-quest" aria-labelledby="mw-quest-h">
          <div className="mw-quest-house" aria-hidden="true">
            <HouseLights steps={quest.map((s) => s.state === "done")} now={quest.findIndex((s) => s.state === "now")} size={112} />
          </div>
          <div className="mw-quest-b">
            <h2 className="t-h3" id="mw-quest-h">{t("mw.home.quest.t")}</h2>
            <p className="t-small mw-dim">{t("mw.home.quest.b", { n: lit, total: quest.length })}</p>
          </div>
          <div className="mw-quest-steps"><Steps label={t("mw.home.checkT")} items={quest} /></div>
          <div className="mw-quest-go">
            <Key variant="primary" size="lg" to={`/wallet/mainnet/${step === "note" ? "pay" : step}`}>{t(`mw.home.next.${step}`)}</Key>
          </div>
        </section>
      )}
      <div className="mw-answers">
        <Card title={<h2 className="mw-q"><span className="mw-q-n" aria-hidden="true">1</span>{t("mw.home.q.have")}</h2>} className="mw-ans have" aside={un.problem ? <Lamp state="stale" label={t("mw.home.stale")} /> : undefined}>
          <div className="mw-figure big"><b>{bal ? <Erg nano={bal.nano} /> : "—"}</b><span className="t-small mw-dim">{t("mw.home.freeB")}</span></div>
          {tokensHere.length > 0 && (
            <ul className="mw-facts mw-facts-tight">
              {tokensHere.map(({ tk, raw }) => <li key={tk.id}><Amt raw={raw} denom={denomOfToken(tk)} /> <span className="t-small mw-dim">{t("mw.dn.atKey")}</span> · <Link className="textlink t-small" to={`/wallet/mainnet/withdraw${denomQuery(denomOfToken(tk))}`}>{t("mw.dn.send")}</Link></li>)}
            </ul>
          )}
          <div className="mw-actions">
            <Key size="sm" icon="in" to="/wallet/mainnet/fund">{t("mw.home.fund")}</Key>
            <Key size="sm" icon="right" to={bal && bal.nano > 0n ? "/wallet/mainnet/withdraw" : undefined} disabled={!bal || bal.nano === 0n}>{t("mw.home.withdraw")}</Key>
          </div>
        </Card>
        <Card title={<h2 className="mw-q"><span className="mw-q-n" aria-hidden="true">2</span>{t("mw.home.q.owed")}</h2>} className="mw-ans owed">
          <div className="mw-figure big"><b>{int(watch.length)} <span className="mw-count-u">{t.p("mw.home.payers", watch.length)}</span></b><span className="t-small mw-dim">{t("mw.home.recvB")}</span></div>
          <div className="mw-actions">
            <Key size="sm" icon="request" to="/wallet/mainnet/receive">{t("mw.nav.receive")}</Key>
            <Key size="sm" icon="redeem" variant={lead === "redeem" ? "metal" : undefined} to={watch.length ? "/wallet/mainnet/redeem" : undefined} disabled={watch.length === 0}>{t("mw.home.redeem")}</Key>
          </div>
        </Card>
        <Card title={<h2 className="mw-q"><span className="mw-q-n" aria-hidden="true">3</span>{t("mw.home.q.owe")}</h2>} className="mw-ans owe" aside={reserve ? <ReserveTag r={reserve} small /> : undefined}>
          {reserve ? (
            <>
              <div className="mw-figure big"><b><Erg nano={reserve.debt} /></b><span className="t-small mw-dim">{t("mw.home.oweB")}</span></div>
              <Backing collateral={ergText(reserve.collateral)} r={reserve} />
              {life?.kind === "refund" && (
                <p className="t-small"><Tag tone={life.clock.open ? "ok" : "metal"} glyph="◷">{life.clock.open ? t("mw.ref.tagOpen") : t("mw.ref.tagWaiting")}</Tag> {life.clock.open ? t("mw.home.refundOpen") : t("mw.home.refundRun", { h: int(Number(life.clock.unlockAt)) })}</p>
              )}
              <div className="mw-actions">
                {life?.kind === "refund" ? (
                  <Key size="sm" icon="coin" variant={lead === "refund" ? "primary" : undefined} to="/wallet/mainnet/refund">{t("mw.home.refundSee")}</Key>
                ) : (
                  <>
                    <Key size="sm" icon="pay" variant={lead === "pay" ? "primary" : undefined} to="/wallet/mainnet/pay">{t("mw.nav.pay")}</Key>
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
          ) : gate.value?.k === "none" ? (
            <>
              <div className="mw-figure big"><b><Erg nano={0n} /></b><span className="t-small mw-dim">{t("mw.home.noReserve")}</span></div>
              {step !== "reserve" && <div className="mw-actions"><Key size="sm" icon="coin" to="/wallet/mainnet/reserve">{t("mw.home.next.reserve")}</Key></div>}
            </>
          ) : gate.problem ? (
            <>
              <div className="mw-figure big"><b>—</b><span className="t-small mw-dim">{t("mw.home.oweUnknown")}</span></div>
              <p className="t-small"><ProblemText p={gate.problem} what="read" /></p>
            </>
          ) : (
            <p className="t-small mw-dim">{t("mw.top.loading")}</p>
          )}
        </Card>
      </div>
      {tokenCards.length > 0 && <div className="mw-answers more">{tokenCards.map((tk) => <TokenReserveCard key={tk.id} token={tk} />)}</div>}
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
      {(un.problem || (gate.problem && gate.value)) && <p className="t-small"><ProblemText p={(un.problem ?? gate.problem)!} what="read" /></p>}
      <div className="mw-home-foot">
        {!step && (
          <details className="card mw-quest-done">
            <summary>
              <HouseLights steps={quest.map((s) => s.state === "done")} size={34} />
              <span>{t("mw.home.quest.sum", { n: lit, total: quest.length })}</span>
            </summary>
            <div className="mw-quest-done-b"><Steps label={t("mw.home.checkT")} items={quest} /></div>
          </details>
        )}
        <Callout tone="calm" title={t("mw.beta.t")}>
          <ul className="mw-facts">
            <li>{t("mw.warn.small")}</li>
            <li>{t("mw.warn.key")}</li>
            <li>{t("mw.warn.experimental")}</li>
          </ul>
        </Callout>
      </div>
    </div>
  );
}
