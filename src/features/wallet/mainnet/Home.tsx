// /wallet/mainnet — the key's home reads like any wallet's (clear round 26.11, «снаружи — обычный кошелёк, Basis —
// внутри»): what is on the key, large; one line with what others owe you, what you owe and the reserve; three main
// actions (Pay · Receive · Redeem to Ergo); who owes you and whom you owe as rows, the reserve as the last row under
// «You owe»; the last three entries of the history; the setup quest as one thin strip until every window is lit; the
// beta note at the bottom. Until the key's backup is checked, a nudge leads to it first (the screens that would bring
// value to the key show the backup step anyway: gate.tsx). Reads within the §6.4 budget, only while visible: the pairs
// of the watched payers are the ones Receive polls (same keys, same 2-minute cycle, the first WATCH_POLLED only), and
// every figure the tracker gives is checked as on Receive (the issuer's signature) before it counts.
// Token reserves: each one its own card in its own unit (shown once the tracker lists one or this browser made one),
// and the tokens at the key as their own lines. Nothing is ever added across denominations.
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { Callout, Card, Icon, Key, KeySeal, Lamp, Tag, int, short, HouseLights } from "@/ui";
import {
  WATCH_POLLED, balanceOf, blocksToDays, checkPreviousNote, noteView, reserveLife, reserveTag, spendable, tokenBalanceOf, watchedDenoms,
  type NoteView, type WatchedIssuer,
} from "@/mainnet/flows";
import { blocksNewT1In, isOpenState, type JournalEntry } from "@/mainnet/vault";
import { REFUND_PERIOD_BLOCKS, RESERVE_TOKENS, denomOfToken, parseStoredNote, type Denomination, type ReserveToken } from "@/mainnet/tx";
import { useMw } from "./ctx";
import { R, inFlightOf, net, useResource, useUnspent, useWatchList } from "./data";
import { Erg, ProblemText, ReserveTag, ergText } from "./ui";
import { Amt, amtText, denomQuery, entryDenom } from "./denom";
import { amountOf, newestNotes } from "./Activity";

/** How long a refund runs once started: the contract's period, in days (43 200 blocks ≈ 60 days). */
const REFUND_DAYS = blocksToDays(REFUND_PERIOD_BLOCKS);

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

/** Under a token card's figure: the reserve behind those notes, and how much of them it covers, in words. */
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

/** One row of the home lists: a mark, who or what (one line), a second line, and the amount on the right. Every line
 *  is one line high whatever it holds, so a figure that arrives later never moves the rows below it. */
function HRow({ mark, title, sub, value, go, to }: { mark: ReactNode; title: ReactNode; sub: ReactNode; value?: ReactNode; go?: string; to?: string }) {
  const inner = (
    <>
      <span className="mw-hrow-m" aria-hidden="true">{mark}</span>
      <span className="mw-hrow-w"><b>{title}</b><span>{sub}</span></span>
      {value !== undefined && <span className="mw-hrow-v">{value}</span>}
      {/* where the row leads: its word on a wide screen, the arrow alone on a phone */}
      {go && <span className="mw-hrow-go"><span className="mw-hrow-go-t">{go}</span><Icon name="right" size={16} /></span>}
    </>
  );
  return <li className="mw-hrow-li">{to ? <Link className="mw-hrow" to={to}>{inner}</Link> : <div className="mw-hrow">{inner}</div>}</li>;
}

/** A note's signed total (what the receiver can be paid on it in all), as Pay lists it. */
function noteTotal(e: JournalEntry): bigint {
  try { return BigInt(String(e.meta.total ?? "0")); } catch { return 0n; }
}

const Dot = ({ icon }: { icon: string }) => <span className="mw-hrow-dot"><Icon name={icon} size={15} /></span>;

/** A watched payer: what they owe you on their newest note (total less what was redeemed), checked over their
 *  signature exactly as on Receive (money P2-5: never the tracker's figure on trust). `onFigure` gives the ERG figure
 *  to the summary line: the amount, 0n when there is none to count, null while it is still being read. */
function OwedRow({ w, me, polled, onFigure }: { w: WatchedIssuer; me: string; polled: boolean; onFigure: (pk: string, v: bigint | null) => void }) {
  const t = useT();
  const ds = watchedDenoms(w);
  const denom: Denomination = ds.includes("erg") ? "erg" : ds[0] ?? "erg";
  const pair = useResource(R.pair(w.pk, me, denom), { everyMs: 120_000, enabled: polled });
  let v: NoteView | null = null;
  let bad = false;
  if (pair.value) {
    try {
      const n = parseStoredNote(pair.value);
      if (checkPreviousNote(n, { issuer: w.pk, recipient: me, accepted: 0n, serverNowMs: net().clock.now(), ...(denom === "erg" ? {} : { denomination: denom }) }).ok) v = noteView(n);
      else bad = true;
    } catch { bad = true; }
  }
  const none = pair.at !== null && pair.value === null && !pair.problem;
  const reading = polled && !v && !none && !bad && !pair.problem;
  const fig = denom !== "erg" ? 0n : v ? v.outstanding : reading ? null : 0n;
  useEffect(() => { onFigure(w.pk, fig); }, [onFigure, w.pk, fig]);
  useEffect(() => () => onFigure(w.pk, 0n), [onFigure, w.pk]);
  const sub = v
    ? `${t(`mw.home.in.${v.stage}`)}${v.redeemableNow > 0n ? ` · ${t("mw.home.in.can", { amount: amtText(v.redeemableNow, denom) })}` : ""}`
    : none ? t("mw.home.in.none") : bad ? t("mw.home.in.bad") : !polled ? t("mw.home.in.notPolled") : pair.problem ? t("mw.home.stale") : t("mw.recv.reading");
  return (
    <HRow mark={<KeySeal pk={w.pk} size="sm" />} title={w.name ?? <span className="mono">{short(w.pk, 6, 4)}</span>} sub={sub}
      value={v ? <Amt raw={v.outstanding} denom={denom} tone={v.redeemableNow > 0n ? "up" : undefined} /> : "—"} />
  );
}

/** A journal entry as one row: what it was, its state and date, its amount in its own denomination. */
const KIND_ICON: Record<string, string> = { note: "pay", redeem: "redeem", withdraw: "right", t1: "coin", topup: "in", "refund-start": "clock", "refund-end": "coin", combine: "loop" };
function HistRow({ e }: { e: JournalEntry }) {
  const t = useT();
  const kind = e.meta.combine === true ? "combine" : e.kind;
  const to = typeof e.meta.to === "string" ? e.meta.to : "";
  const title = e.kind === "note" && to ? t("mw.home.noteTo", { who: short(to, 6, 4) }) : t(`mw.kind.${kind}`);
  const state = e.kind === "note" ? t(`mw.note.st.${e.state}`) : t(`mw.state.${e.state}`);
  const at = new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ");
  return (
    <HRow mark={<Dot icon={KIND_ICON[kind] ?? "note"} />} title={title} sub={`${state} · ${at}`}
      value={<Amt raw={amountOf(e)} denom={entryDenom(e)} sign={e.kind === "redeem" ? "favour" : "none"} tone={e.kind === "redeem" ? "up" : undefined} />} />
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
  // the ERG notes and T1 only (review LOW-2): a SigUSD note or T1 says nothing about the ERG reserve
  const notes = mine.filter((e) => e.kind === "note" && e.state !== "failed" && e.state !== "abandoned" && entryDenom(e) === "erg");
  // whom you owe: the newest note per receiver and denomination the tracker took (an older one is inside it)
  const owing = useMemo(() => { const n = newestNotes(mine); return mine.filter((e) => n.has(e.id)); }, [mine]);
  // a T1 retired after a completed refund no longer counts (the key may create a new reserve)
  const t1 = mine.find((e) => blocksNewT1In(e, "erg"));
  const funded = (bal?.nano ?? 0n) > 0n || !!reserve || !!t1;
  const tokenCards = RESERVE_TOKENS.filter((tk) => (listed.value ?? []).some((r) => r.owner === me?.pub && r.token === tk.id) || mine.some((e) => blocksNewT1In(e, denomOfToken(tk))));
  const tokensHere = RESERVE_TOKENS.map((tk) => ({ tk, raw: tokenBalanceOf(usable, tk.id) })).filter((x) => x.raw > 0n);
  const quest = [
    { id: "key", done: true },
    { id: "backup", done: state.backedUp },
    { id: "fund", done: funded },
    { id: "reserve", done: !!reserve },
    { id: "note", done: notes.length > 0 },
  ];
  const lit = quest.filter((s) => s.done).length;
  const step = !state.backedUp ? "backup" : !funded ? "fund" : !reserve && !t1 && gate.value?.k === "none" ? "reserve" : notes.length === 0 && reserve && life?.kind !== "refund" ? "note" : null;
  const stepTo = step === "backup" ? "/wallet/mainnet/setup" : step === "note" ? "/wallet/mainnet/pay" : step ? `/wallet/mainnet/${step}` : null;
  // the strip waits for the figures its windows depend on (the key's boxes, the tracker's word on the reserve), so it
  // never shows for a moment on a key whose windows are all lit
  const known = un.value !== null && (gate.value !== null || !!gate.problem);

  // what others owe you, in ERG: the sum of the checked figures of the polled payers (unknown while one is read)
  const [owedBy, setOwedBy] = useState<Record<string, bigint | null>>({});
  const onFigure = useCallback((pk: string, v: bigint | null) => setOwedBy((m) => (m[pk] === v ? m : { ...m, [pk]: v })), []);
  const polledPks = watch.slice(0, WATCH_POLLED).map((w) => w.pk);
  const owedSum = polledPks.some((pk) => owedBy[pk] === undefined || owedBy[pk] === null) ? null : polledPks.reduce((s, pk) => s + (owedBy[pk] ?? 0n), 0n);
  const canRedeem = Object.values(owedBy).some((v) => v !== null && v > 0n);
  const shownOwed = watch.slice(0, WATCH_POLLED);

  // one lit action: Pay once there is a reserve to pay from (and no refund running); else «Redeem to Ergo» in gold when
  // a payer's note can be redeemed now; else Receive
  const lead: "pay" | "redeem" | "receive" = reserve && life?.kind !== "refund" ? "pay" : canRedeem ? "redeem" : "receive";
  const tag = reserve ? reserveTag(reserve) : null;
  return (
    <div className="mw-home">
      {!state.backedUp && (
        <Callout tone="metal" icon="warn" className="mw-nudge" title={t("mw.home.nudgeT")}>
          <p>{t("mw.home.nudgeB")}</p>
          <Key variant="primary" to="/wallet/mainnet/setup">{t("mw.gate.backupGo")}</Key>
        </Callout>
      )}
      <section className="mw-bal" aria-labelledby="mw-bal-h">
        <div className="mw-bal-top">
          <h1 className="label" id="mw-bal-h"><b>{t("mw.home.freeT")}</b></h1>
          {un.problem && <Lamp state="stale" label={t("mw.home.stale")} />}
        </div>
        <div className="mw-bal-v">{bal ? <Erg nano={bal.nano} /> : <span className="num">—</span>}</div>
        {tokensHere.length > 0 && (
          <ul className="mw-facts mw-facts-tight">
            {tokensHere.map(({ tk, raw }) => <li key={tk.id}><Amt raw={raw} denom={denomOfToken(tk)} /> <span className="t-small mw-dim">{t("mw.dn.atKey")}</span> · <Key size="sm" variant="quiet" to={`/wallet/mainnet/withdraw${denomQuery(denomOfToken(tk))}`}>{t("mw.dn.send")}</Key></li>)}
          </ul>
        )}
        <p className="mw-bal-line">
          <span>{t("mw.home.q.owed")} <b>{owedSum !== null ? <Erg nano={owedSum} /> : "—"}</b></span>
          <span>{t("mw.home.q.owe")} <b>{reserve ? <Erg nano={reserve.debt} /> : gate.value?.k === "none" ? <Erg nano={0n} /> : "—"}</b></span>
          <span>{reserve ? <>{t("mw.home.sumReserve")} <b><Erg nano={reserve.collateral} /></b></> : gate.value?.k === "none" ? t("mw.home.sumNoReserve") : <>{t("mw.home.sumReserve")} <b>—</b></>}</span>
          {reserve && <ReserveTag r={reserve} small />}
        </p>
        <nav className="mw-home-keys" aria-label={t("mw.home.actsAria")}>
          <Key variant={lead === "pay" ? "primary" : "default"} tall icon="pay" to="/wallet/mainnet/pay">{t("mw.nav.pay")}</Key>
          <Key variant={lead === "receive" ? "primary" : "default"} tall icon="request" to="/wallet/mainnet/receive">{t("mw.nav.receive")}</Key>
          <Key variant={lead === "redeem" ? "metal" : "default"} tall icon="redeem" to="/wallet/mainnet/redeem">{t("mw.home.redeem")}</Key>
        </nav>
        <div className="mw-bal-more">
          <Key size="sm" variant="quiet" icon="in" to="/wallet/mainnet/fund">{t("mw.home.fund")}</Key>
          <Key size="sm" variant="quiet" icon="right" to={bal && bal.nano > 0n ? "/wallet/mainnet/withdraw" : undefined} disabled={!bal || bal.nano === 0n}>{t("mw.home.withdraw")}</Key>
        </div>
      </section>
      {state.backedUp && known && lit < quest.length && (
        <div className="mw-strip">
          <HouseLights steps={quest.map((s) => s.done)} now={quest.findIndex((s) => !s.done)} size={34} />
          <span>{t("mw.home.strip", { n: lit, total: quest.length })}</span>
          {step && stepTo && <Key size="sm" variant="quiet" className="mw-strip-go" to={stepTo}>{t(`mw.home.next.${step}`)} →</Key>}
        </div>
      )}
      <div className="mw-cols">
        <Card title={t("mw.home.q.owed")} className="mw-debts">
          {watch.length === 0 ? (
            <div className="mw-debts-empty">
              <p className="t-small mw-dim">{t("mw.home.owedEmpty")}</p>
              <Key size="sm" icon="request" to="/wallet/mainnet/receive">{t("mw.in.show")}</Key>
            </div>
          ) : (
            <>
              <ul className="mw-hrows">{shownOwed.map((w, i) => <OwedRow key={w.pk} w={w} me={me!.pub} polled={i < WATCH_POLLED} onFigure={onFigure} />)}</ul>
              <Key size="sm" variant="quiet" to="/wallet/mainnet/receive">{watch.length > shownOwed.length ? t("mw.home.owedMore", { n: watch.length - shownOwed.length }) : `${t("mw.recv.mineT")} →`}</Key>
            </>
          )}
        </Card>
        <Card title={t("mw.home.q.owe")} className="mw-debts">
          <ul className="mw-hrows">
            {owing.map((e) => (
              <HRow key={e.id} mark={<KeySeal pk={String(e.meta.to ?? "")} size="sm" />} title={<span className="mono">{short(String(e.meta.to ?? ""), 6, 4)}</span>}
                sub={`${t("mw.kind.note").toLowerCase()} · ${t(`mw.note.st.${e.state}`)}`} value={<Amt raw={noteTotal(e)} denom={entryDenom(e)} />} />
            ))}
            {reserve ? (
              <HRow mark={<Dot icon="coin" />} title={t("mw.home.resRow", { amount: ergText(reserve.collateral) })}
                sub={life?.kind === "refund"
                  ? (life.clock.open ? t("mw.home.refundOpen") : t("mw.home.refundRun", { h: int(Number(life.clock.unlockAt)) }))
                  : tag?.kind === "band" ? t("mw.home.resSub", { pct: int(Math.floor(tag.pct)), days: REFUND_DAYS }) : tag?.kind === "settling" ? t("mw.res.settlingTag") : t("mw.home.resSubNoDebt", { days: REFUND_DAYS })}
                go={life?.kind === "refund" ? t("mw.home.refundSee") : t("mw.home.reserveT")} to={life?.kind === "refund" ? "/wallet/mainnet/refund" : "/wallet/mainnet/reserve"} />
            ) : t1 ? (
              <HRow mark={<Dot icon="coin" />} title={t("mw.home.reserveT")} sub={t("mw.home.t1Open", { state: t(`mw.state.${t1.state}`) })} go={t("mw.home.reserveOpen")} to="/wallet/mainnet/reserve" />
            ) : gate.value?.k === "none" ? (
              <HRow mark={<Dot icon="coin" />} title={t("mw.home.resNone")} sub={t("mw.home.resNoneB")} go={t("mw.home.next.reserve")} to="/wallet/mainnet/reserve" />
            ) : unproven || unchecked ? (
              <HRow mark={<Dot icon="coin" />} title={t("mw.home.reserveT")} sub={unproven ? t("mw.home.unproven") : t("mw.home.unchecked")} go={t("mw.home.reserveOpen")} to="/wallet/mainnet/reserve" />
            ) : (
              <HRow mark={<Dot icon="coin" />} title={t("mw.home.reserveT")} sub={gate.problem ? t("mw.home.oweUnknown") : t("mw.top.loading")} />
            )}
          </ul>
          {owing.length === 0 && reserve && reserve.debt > 0n && <p className="t-small mw-dim">{t("mw.home.oweElsewhere")}</p>}
        </Card>
      </div>
      {tokenCards.length > 0 && <div className="mw-answers">{tokenCards.map((tk) => <TokenReserveCard key={tk.id} token={tk} />)}</div>}
      <Card title={t("mw.home.histT")} className="mw-hist">
        {mine.length === 0 ? (
          <p className="t-small mw-dim">{t("mw.home.histEmpty")}</p>
        ) : (
          <ul className="mw-hrows">{mine.slice(0, 3).map((e) => <HistRow key={e.id} e={e} />)}</ul>
        )}
        <div className="mw-actions">
          <Key size="sm" variant="quiet" to="/wallet/mainnet/activity">{t("mw.home.histAll")} →</Key>
          {open.length > 3 && <span className="t-small mw-dim">{t("mw.home.histOpen", { n: open.length })}</span>}
        </div>
      </Card>
      {(un.problem || (gate.problem && gate.value)) && <p className="t-small"><ProblemText p={(un.problem ?? gate.problem)!} what="read" /></p>}
      <Callout tone="calm" title={t("mw.beta.t")}>
        <ul className="mw-facts">
          <li>{t("mw.warn.small")}</li>
          <li>{t("mw.warn.key")}</li>
          <li>{t("mw.warn.experimentalHome")}</li>
        </ul>
      </Callout>
    </div>
  );
}
