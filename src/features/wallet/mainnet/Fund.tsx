// /wallet/mainnet/fund — the key's own address, its QR and the deposit watcher (design §5, B): /v1 mempool by address
// every 20 s and the unspent boxes once per new block, only while this screen is visible. Money here is the key's,
// not a reserve yet: creating the reserve is the next step.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, CopyButton, Field, Key, Lamp, int } from "@/ui";
import { MINER_FEE_NANOERG, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_MIN_NANOERG } from "@/mainnet/tx";
import { balanceOf, ergInput, parseErg, spendable } from "@/mainnet/flows";
import { mempoolInflow } from "@/mainnet/net";
import { QrCode } from "../lib/qr";
import { useMw } from "./ctx";
import { R, inFlightOf, useResource, useUnspent } from "./data";
import { ChainLink, Erg, Gate, ProblemText, Steps, TimeHint, ergText } from "./ui";

/** The fee allowance the Fund screen asks for on top of the reserve (design §6.7: "T1: 0.0011 ERG"). */
export const T1_FEE_ALLOWANCE = 1_100_000n;

export function FundScreen() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const [amountText, setAmountText] = useState(() => ergInput(RESERVE_DEFAULT_CAP_NANOERG / 2n));
  const un = useUnspent(me, height, state.backedUp);
  const mem = useResource(me ? R.mempool(me.address) : null, { everyMs: 20_000, enabled: state.backedUp && !!me });
  const usable = useMemo(() => (me && un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub), mem.value ?? []) : []), [me, un.value, mem.value, entries]);
  const bal = un.value ? balanceOf(un.value.boxes, usable) : null;
  const incoming = useMemo(() => (me && mem.value ? mem.value.filter((tx) => mempoolInflow(tx, me.tree, me.address) > 0n && !tx.spends.some((id) => un.value?.boxes.some((u) => u.box.boxId === id))) : []), [me, mem.value, un.value]);
  const amount = parseErg(amountText);
  const need = amount !== null ? amount + T1_FEE_ALLOWANCE : null;
  const have = bal?.free ?? 0n;
  const missing = need !== null && need > have ? need - have : 0n;
  const ready = need !== null && have >= need;
  const lastHeight = un.value?.boxes.reduce((m, u) => Math.max(m, u.height ?? 0), 0) ?? 0;

  return (
    <Gate vault={vault} state={state}>
      {me && (
        <div className="mw-grid">
          <div className="mw-main">
            <header className="mw-screen-h">
              <h1 className="t-h2">{t("mw.fund.h")}</h1>
              <p className="t-lede">{t("mw.fund.lede")}</p>
            </header>
            <Card title={t("mw.fund.addrT")}>
              <div className="mw-qr-wrap">
                <div className="mw-qr"><QrCode text={me.address} size={204} label={t("mw.fund.qr")} /></div>
                <div className="mw-form">
                  <div className="label">{t("mw.fund.addr")}</div>
                  <div className="mono mw-break mw-addr">{me.address}</div>
                  <div className="mw-actions"><CopyButton value={me.address} label={t("mw.fund.copy")} /></div>
                  <p className="t-small">{t("mw.fund.own")}</p>
                </div>
              </div>
            </Card>
            <Card title={t("mw.fund.planT")}>
              <div className="mw-form">
                <Field label={t("mw.fund.amount")} help={t("mw.fund.amountHelp", { min: ergText(RESERVE_MIN_NANOERG), max: ergText(RESERVE_DEFAULT_CAP_NANOERG) })}
                  error={amountText && amount === null ? t("mw.amount.bad") : undefined}>
                  <AmountInput value={amountText} onChange={setAmountText} />
                </Field>
                {need !== null && missing === 0n && <p className="t-body mw-send">{t("mw.fund.enough")}</p>}
                {need !== null && missing > 0n && (
                  <p className="t-body mw-send">
                    {t("mw.fund.send")} <b><Erg nano={missing} /></b>
                    <span className="t-small mw-dim"> · {t("mw.fund.sendWhy", { fee: ergText(T1_FEE_ALLOWANCE), miner: ergText(MINER_FEE_NANOERG) })}</span>
                  </p>
                )}
                <Callout tone="policy" title={t("mw.fund.notReserveT")}>{t("mw.fund.notReserveB")}</Callout>
              </div>
            </Card>
          </div>
          <aside className="mw-side">
            <Card title={t("mw.fund.watchT")} aside={<Lamp state={mem.problem || un.problem ? "stale" : "live"} label={t("mw.fund.watching")} />}>
              <div className="mw-form">
                <Steps label={t("mw.fund.watchT")} items={[
                  { id: "wait", label: t("mw.fund.s.wait"), sub: <TimeHint k="deposit" />, state: incoming.length || have > 0n ? "done" : "now" },
                  { id: "seen", label: t("mw.fund.s.seen"), sub: incoming[0] ? <ChainLink kind="tx" id={incoming[0].id} /> : undefined, state: incoming.length ? "now" : have > 0n ? "done" : "todo" },
                  { id: "conf", label: t("mw.fund.s.confirmed"), sub: lastHeight ? t("mw.fund.atBlock", { h: int(lastHeight) }) : undefined, state: have > 0n ? "done" : "todo" },
                  { id: "ready", label: t("mw.fund.s.ready"), sub: ready ? undefined : need !== null ? t("mw.fund.s.readyNeed", { need: ergText(need) }) : undefined, state: ready ? "done" : "todo" },
                ]} />
                <div className="mw-figure">
                  <span className="label">{t("mw.fund.balance")}</span>
                  <b>{bal ? <Erg nano={bal.nano} /> : "—"}</b>
                  {bal && bal.tokenBoxes > 0 && <span className="t-small mw-dim">{t("mw.fund.tokens", { n: bal.tokenBoxes })}</span>}
                  {bal && bal.inFlight > 0 && <span className="t-small mw-dim">{t("mw.fund.inFlight", { n: bal.inFlight })}</span>}
                  {un.value && !un.value.complete && <span className="t-small mw-dim">{t("mw.fund.partial")}</span>}
                </div>
                {(un.problem || mem.problem) && <p className="t-small"><ProblemText p={(un.problem ?? mem.problem)!} what="read" /></p>}
                <p className="t-small mw-dim">{t("mw.fund.cadence")}</p>
                {ready && <Key variant="primary" to="/wallet/mainnet/reserve" block icon="coin">{t("mw.fund.toReserve")}</Key>}
              </div>
            </Card>
            <Callout tone="calm">{t("mw.warn.small")}</Callout>
          </aside>
        </div>
      )}
    </Gate>
  );
}
