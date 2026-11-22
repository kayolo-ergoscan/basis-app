// Reserves (R02, R05, R07, R09–R11, S06): create one per denomination (bound to T-01 forever), top up (≥ 0.1 ERG),
// start the exit (hold, creditor impact, 43 200 blocks) and complete it after the window; coverage with the
// 150 / 120 / 100 % marks labelled as wallet policy. Every action runs the sandbox contract and shows its result.
import { useId, useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { MIN_TOP_UP_NANOERG, REFUND_PERIOD_BLOCKS, type DenomId } from "@/protocol";
import { AmountInput, BacksBar, Callout, Countdown, CoverageMeter, Field, int, Key, Sheet, Tabs, Tag } from "@/ui";
import { parseAmount, town, TOWN_TRACKER, useClock, useTownView, YOU, type ReserveOutcome } from "@/world";
import { ContractXray, ExitClocks, TxLens, synthCreateTx } from "@/viz";
import { copy, pick } from "@/content";
import { useFmt, useNameOf, useNameOfPub, useOutcomeToast, usePrefs, setPrefs, useWT } from "../lib/hooks";
import { plainAmount, reservesOfYou, toNum, trackerInfo, unitOf, type ReserveInfo, type Unit } from "../lib/model";
import { Amt, Fact, Frame } from "../parts/bits";

export function ReservePage({ page }: { page: boolean }) {
  const t = useT();
  const p = usePrefs();
  const v = useTownView((eco) => ({ denoms: [...eco.denominations.keys()].map((d) => unitOf(eco, d)), reserves: reservesOfYou(eco), wallet: Object.fromEntries([...eco.denominations.keys()].map((d) => [d, eco.balance(YOU, d)])) as Record<string, bigint> }), []);
  const [denom, setDenom] = useState<DenomId>(p.denom);
  // the completed exit outlives the reserve view it came from: shown as a receipt above the create form
  const [closed, setClosed] = useState<{ denom: DenomId; o: ReserveOutcome } | null>(null);
  if (!v) return null;
  const unit = v.denoms.find((d) => d.id === denom) ?? v.denoms[0];
  const res = v.reserves.find((r) => r.denom === denom) ?? null;
  return (
    <Frame page={page} title={t("wallet.res.title")} sub={t("wallet.res.sub")} labelId="wl-res-h" className="wl-flow wl-res">
      {v.denoms.length > 1 && (
        <Tabs
          ariaLabel={t("wallet.denom")}
          idBase="wl-res-tabs"
          value={denom}
          onChange={(d) => {
            setDenom(d);
            setPrefs({ denom: d });
          }}
          tabs={v.denoms.map((d) => ({ id: d.id, label: d.symbol, count: v.reserves.some((r) => r.denom === d.id) ? 1 : 0 }))}
        />
      )}
      {res ? (
        <ReserveView r={res} unit={unit} wallet={v.wallet[denom] ?? 0n} ergWallet={v.wallet.erg ?? 0n} onClosed={(o) => setClosed({ denom, o })} />
      ) : (
        <ReserveCreate unit={unit} wallet={v.wallet[denom] ?? 0n} closed={closed?.denom === denom ? closed.o : null} />
      )}
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------------------------

function ReserveCreate({ unit, wallet, closed }: { unit: Unit; wallet: bigint; closed: ReserveOutcome | null }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const nameOfPub = useNameOfPub();
  const show = useOutcomeToast();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<ReserveOutcome | null>(null);
  const value = amount.trim() ? parseAmount(amount, { id: unit.id, symbol: unit.symbol, decimals: unit.decimals }) : null;
  const invalid = amount.trim() !== "" && (value === null || value <= 0n || value > wallet);
  const liab = useTownView((eco) => eco.coverage(YOU, unit.id).liabilities, [unit.id]) ?? 0n;
  const create = async () => {
    if (!value || invalid) return;
    setBusy(true);
    try {
      const o = await town.createReserve({ amount: value, denom: unit.id });
      setOut(o);
      show(o);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wl-split">
      <aside className="wl-aside">
        {closed && !out && (
          <section className="wl-last" aria-label={t("wallet.res.lastTx")}>
            <Callout tone="proof" title={f.prose(wt(closed.toast.titleKey, closed.toast.params))}>
              {t("wallet.res.closedB")}
            </Callout>
            {closed.tx && <TxLens tx={closed.tx} evaluation={closed.eval ?? null} nameOf={nameOfPub} unit={{ symbol: unit.symbol, decimals: unit.decimals }} />}
          </section>
        )}
        <div className="wl-res-empty">
          <div className="label">
            <b>{t("wallet.res.none.label", { d: unit.symbol })}</b>
          </div>
          <p className="t-body">{f.prose(t(liab > 0n ? "wallet.res.none.owe" : "wallet.res.none.b", { v: f.amt(liab, unit, { unit: true }) }))}</p>
        </div>
        <ul className="wl-facts">
          <li>{pick(copy.boundForever, t.lang)}</li>
          <li>{t("wallet.res.onePer", { id: TOWN_TRACKER })}</li>
          <li>{pick(unit.id === "erg" ? copy.topUpRule : copy.topUpRuleToken, t.lang)}</li>
          <li>{pick(copy.refundRule, t.lang)}</li>
        </ul>
      </aside>
      <div className="wl-form wl-main">
      <Field label={t("wallet.res.lock")} error={invalid ? (value && value > wallet ? t("wallet.res.tooMuch") : t("wallet.amount.invalid")) : undefined} help={f.prose(t("wallet.res.wallet", { v: f.amt(wallet, unit, { unit: true }) }))}>
        <AmountInput value={amount} onChange={setAmount} unit={unit.symbol} invalid={invalid} max={wallet > 0n ? { label: t("wallet.rd.max"), onMax: () => setAmount(plainAmount(wallet > 10_000_000n && unit.id === "erg" ? wallet - 10_000_000n : wallet, unit.decimals)) } : undefined} aria-label={t("wallet.res.lock")} />
      </Field>
      {!!value && !invalid && liab > 0n && <CoverageMeter value={Math.round((Number(value) / Number(liab)) * 100)} />}
      {out && !out.ok && (
        <Callout tone="alarm" title={wt(out.toast.titleKey, out.toast.params)}>
          {f.prose(wt(`world.code.${out.code ?? "unknown"}`, out.toast.params))}
        </Callout>
      )}
      <div className="wl-act">
        <Key variant="metal" size="lg" block hold onAct={() => void create()} disabled={!value || invalid || busy}>
          {value && !invalid ? t("wallet.res.holdCreate", { v: f.amt(value, unit, { unit: true }) }) : t("wallet.res.enter")}
        </Key>
      </div>
      <p className="t-small wl-act-note">{t("wallet.res.createNote", { id: TOWN_TRACKER })}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// an existing reserve
// ---------------------------------------------------------------------------------------------

function ReserveView({ r, unit, wallet, ergWallet, onClosed }: { r: ReserveInfo; unit: Unit; wallet: bigint; ergWallet: bigint; onClosed: (o: ReserveOutcome) => void }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const nameOf = useNameOf();
  const nameOfPub = useNameOfPub();
  const show = useOutcomeToast();
  const uid = useId();
  const { height } = useClock();
  const [topUp, setTopUp] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [last, setLast] = useState<ReserveOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const tr = useTownView((eco) => trackerInfo(eco), []);
  const createTx = useTownView((eco) => {
    try {
      return synthCreateTx(eco.r(r.id));
    } catch {
      return null;
    }
  }, [r.id, r.boxes]);
  const cov = r.coverage;
  const canIssue = r.collateral > 0n ? (r.collateral * 100n) / 120n - r.liabilities : 0n;
  const toTop = (r.liabilities * 150n) / 100n - r.collateral;
  const unlocked = r.unlock !== null && height >= r.unlock;
  const run = async (fn: () => Promise<ReserveOutcome>) => {
    setBusy(true);
    try {
      const o = await fn();
      setLast(o);
      show(o);
      return o;
    } finally {
      setBusy(false);
    }
  };
  const level = cov === null ? "ok" : cov < 1 ? "under" : cov < 1.2 ? "warn" : cov < 1.5 ? "watch" : "ok";
  const backs = r.backs.slice(0, 3).map((b) => ({ label: `${nameOf(b.id)} ${f.amt(b.amount, unit)}`, amount: toNum(b.amount, unit.decimals) }));
  if (r.backs.length > 3) {
    const rest = r.backs.slice(3).reduce((s, b) => s + b.amount, 0n);
    backs.push({ label: t("wallet.res.more", { n: r.backs.length - 3, v: f.amt(rest, unit) }), amount: toNum(rest, unit.decimals) });
  }
  return (
    <div className="wl-split">
      <div className="wl-form wl-main">
      <section className="card wl-rsv" aria-labelledby={`${uid}-h`}>
        <div className="card-h">
          <h3 className="label" id={`${uid}-h`}>
            <b>{t("wallet.res.card", { d: unit.symbol })}</b> · {t("wallet.res.boxes", { n: r.boxes })} · {TOWN_TRACKER}
          </h3>
          {r.refundPending ? <Tag tone="warn">{t("wallet.rs.exiting")}</Tag> : <Tag tone={level === "ok" ? "ok" : level === "watch" ? "watch" : level === "warn" ? "warn" : "under"}>{t(`wallet.res.level.${level}`)}</Tag>}
        </div>
        <div className="card-b wl-rsv-b">
          <div className="rsv-top">
            <div>
              <div className="label">{t("wallet.res.coverage")}</div>
              <div className="big-measure">
                <span className="v">
                  {cov === null ? "—" : int(cov * 100)}
                  {cov !== null && <span className="pc">%</span>}
                </span>
              </div>
            </div>
            <div className="rsv-locked">
              <div className="label">{t("wallet.rs.locked")}</div>
              <div className="t-money metal-t wl-rsv-locked">
                <Amt v={r.collateral} u={unit} />
                <span className="unit">{unit.symbol}</span>
              </div>
              <div className="t-small">{f.prose(t("wallet.rs.backs", { v: f.amt(r.liabilities, unit) }))}</div>
            </div>
          </div>
          {cov !== null ? <CoverageMeter value={Math.round(cov * 100)} /> : <p className="t-small">{t("wallet.res.noDebt")}</p>}
          <p className="t-small wl-policy-cap">
            <Tag>{t("wallet.res.walletPolicy")}</Tag> {pick(copy.thresholdsArePolicy, t.lang)}
          </p>
          <div className="figs">
            <Fact k={t("wallet.res.outstanding")}>
              <Amt v={r.liabilities} u={unit} />
            </Fact>
            <Fact k={t("wallet.res.canIssue")}>
              <Amt v={canIssue > 0n ? canIssue : 0n} u={unit} /> <span className="t-small">{t("wallet.res.before120")}</span>
            </Fact>
            <Fact k={t("wallet.res.topUpTo")}>
              <Amt v={toTop > 0n ? toTop : 0n} u={unit} /> <span className="t-small">{t("wallet.res.to150")}</span>
            </Fact>
          </div>
          {r.liabilities > 0n && (
            <div>
              <div className="label wl-lbl">{t("wallet.res.whoBacks")}</div>
              <BacksBar items={backs} locked={toNum(r.collateral, unit.decimals)} dp={f.dpOf(unit)} />
            </div>
          )}
          <p className="t-small">{r.refundPending ? f.prose(t("wallet.res.r7.on", { h: f.height(r.r7 ?? 0), u: f.height(r.unlock ?? 0) })) : t("wallet.res.r7.none")}</p>
        </div>
        <div className="card-f">
          <Key variant="metal" icon="coin" onClick={() => setTopUp(true)} disabled={r.refundPending && unlocked}>
            {t("wallet.res.topUp")}
          </Key>
          <span className="t-small">{pick(unit.id === "erg" ? copy.topUpRule : copy.topUpRuleToken, t.lang)}</span>
        </div>
      </section>

      {/* the exit */}
      <section className="wl-exit" aria-labelledby={`${uid}-x`}>
        <h3 className="label" id={`${uid}-x`}>
          <b>{t("wallet.res.exit")}</b>
        </h3>
        {!r.refundPending ? (
          <>
            <p className="t-small">{pick(copy.refundRule, t.lang)} {pick(copy.refundCreditors, t.lang)}</p>
            <Key variant="quiet" icon="exit" className="wl-dq" onClick={() => setExitOpen(true)}>
              {t("wallet.res.startExit")}
            </Key>
          </>
        ) : (
          <>
            {tr && <ExitClocks height={height} boxCreationHeight={tr.boxHeight} r7={r.r7} show="exit" trackerName={TOWN_TRACKER} />}
            <div className="wl-exit-row">
              {r.unlock !== null && !unlocked && <Countdown target={r.unlock} height={height} label={t("wallet.res.unlockIn")} />}
              <Key variant="default" disabled={!unlocked || busy} onClick={() => void run(() => town.completeRefund({ reserve: r.id })).then((o) => o.ok && onClosed(o))}>
                {t("wallet.res.complete")}
              </Key>
              {!unlocked && r.unlock !== null && (
                <Key size="sm" variant="quiet" onClick={() => void town.clock.mine(r.unlock! - height).then(show)}>
                  {f.prose(t("wallet.res.skip", { n: f.blocks(r.unlock - height) }))}
                </Key>
              )}
            </div>
            <p className="t-small">{f.prose(t("wallet.res.exitOn", { v: f.amt(r.liabilities, unit, { unit: true }) }))}</p>
          </>
        )}
      </section>

      </div>
      <aside className="wl-aside">
      {last && (
        <section className="wl-last" aria-label={t("wallet.res.lastTx")}>
          {!last.ok && (
            <Callout tone="alarm" title={wt(last.toast.titleKey, last.toast.params)}>
              {f.prose(wt(`world.code.${last.code ?? "unknown"}`, last.toast.params))}
            </Callout>
          )}
          {last.tx && <TxLens tx={last.tx} evaluation={last.eval ?? null} nameOf={nameOfPub} unit={{ symbol: unit.symbol, decimals: unit.decimals }} />}
          {last.eval && <ContractXray evaluation={last.eval} mode="compact" animate />}
        </section>
      )}

      <History r={r} unit={unit} createTx={createTx} />
      </aside>

      <TopUpSheet open={topUp} onClose={() => setTopUp(false)} r={r} unit={unit} wallet={wallet} ergWallet={ergWallet} onDone={(o) => setLast(o)} />
      <ExitSheet open={exitOpen} onClose={() => setExitOpen(false)} r={r} unit={unit} onDone={(o) => setLast(o)} />
    </div>
  );
}

function History({ r, unit, createTx }: { r: ReserveInfo; unit: Unit; createTx: ReturnType<typeof synthCreateTx> | null }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const nameOfPub = useNameOfPub();
  const [open, setOpen] = useState(false);
  const rows = useTownView((eco) => eco.r(r.id).history.slice().reverse(), [r.id, r.boxes]) ?? [];
  return (
    <section className="wl-hist" aria-labelledby="wl-hist-h">
      <div className="spread">
        <h3 className="label" id="wl-hist-h">
          <b>{t("wallet.res.history")}</b> · {rows.length}
        </h3>
        {createTx && (
          <button type="button" className="textlink t-small" onClick={() => setOpen(!open)} aria-expanded={open}>
            {t(open ? "wallet.res.hideCreate" : "wallet.res.showCreate")}
          </button>
        )}
      </div>
      {open && createTx && <TxLens tx={createTx} synthesized nameOf={nameOfPub} unit={{ symbol: unit.symbol, decimals: unit.decimals }} />}
      <ol className="wl-vers">
        {rows.map((h) => (
          <li key={h.boxId}>
            <span className="wl-v-main">
              <span className="wl-v-total">{t(`wallet.res.act.${h.action}`)}</span>
              {h.amount !== undefined && <span className="num wl-v-add">{f.amt(h.amount, unit)}</span>}
            </span>
            <span className="wl-v-meta mono">
              {t("wallet.nd.blk", { h: f.height(h.height) })} · box {h.boxId.slice(0, 6)}…{h.receiver ? ` · ${nameOf(town.economy?.idOf(h.receiver) ?? "—")}` : ""}
            </span>
            <span className="num wl-v-state">{f.amt(unit.id === "erg" ? h.value : h.tokenAmount, unit, { unit: true })}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function TopUpSheet({ open, onClose, r, unit, wallet, ergWallet, onDone }: { open: boolean; onClose: () => void; r: ReserveInfo; unit: Unit; wallet: bigint; ergWallet: bigint; onDone: (o: ReserveOutcome) => void }) {
  const t = useT();
  const f = useFmt();
  const show = useOutcomeToast();
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const min = unit.id === "erg" ? MIN_TOP_UP_NANOERG : 1n;
  const value = amount.trim() ? parseAmount(amount, { id: unit.id, symbol: unit.symbol, decimals: unit.decimals }) : null;
  const tooSmall = value !== null && value > 0n && value < min;
  const invalid = amount.trim() !== "" && (value === null || value <= 0n || value > wallet || tooSmall);
  const after = value && !invalid && r.liabilities > 0n ? Number(r.collateral + value) / Number(r.liabilities) : null;
  const go = async () => {
    if (!value || invalid) return;
    setBusy(true);
    try {
      const o = await town.topUp({ reserve: r.id, amount: value });
      show(o);
      onDone(o);
      if (o.ok) {
        setAmount("");
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("wallet.res.topUpT", { d: unit.symbol })} sub={pick(unit.id === "erg" ? copy.topUpRule : copy.topUpRuleToken, t.lang)} width={520}>
      <div className="wl-form">
        <Field label={t("wallet.res.add")} error={invalid ? (tooSmall ? f.prose(t("wallet.res.min", { v: f.amt(min, unit, { unit: true, dp: 1 }) })) : value && value > wallet ? t("wallet.res.tooMuch") : t("wallet.amount.invalid")) : undefined} help={f.prose(t("wallet.res.wallet", { v: f.amt(wallet, unit, { unit: true }) }))}>
          <AmountInput value={amount} onChange={setAmount} unit={unit.symbol} plus invalid={invalid} aria-label={t("wallet.res.add")} />
        </Field>
        {r.coverage !== null && <CoverageMeter value={Math.round((after ?? r.coverage) * 100)} ghost={after !== null ? Math.round(r.coverage * 100) : undefined} />}
        {unit.id !== "erg" && <p className="t-small">{f.prose(t("wallet.res.ergFee", { v: f.amt(ergWallet, { id: "erg", symbol: "ERG", decimals: 9 }, { unit: true }) }))}</p>}
        <Key variant="metal" size="lg" block hold onAct={() => void go()} disabled={!value || invalid || busy}>
          {value && !invalid ? t("wallet.res.holdTop", { v: f.amt(value, unit, { unit: true }) }) : t("wallet.res.enter")}
        </Key>
      </div>
    </Sheet>
  );
}

function ExitSheet({ open, onClose, r, unit, onDone }: { open: boolean; onClose: () => void; r: ReserveInfo; unit: Unit; onDone: (o: ReserveOutcome) => void }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const { height } = useClock();
  const [busy, setBusy] = useState(false);
  const holders = useMemo(() => r.backs, [r.backs]);
  const go = async () => {
    setBusy(true);
    try {
      const o = await town.initiateRefund({ reserve: r.id });
      show(o);
      onDone(o);
      if (o.ok) onClose();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t("wallet.res.exitT")} sub={pick(copy.refundRule, t.lang)} width={560}>
      <div className="wl-form">
        <Callout tone="alarm" title={t("wallet.res.exitWarnT")}>
          {f.prose(t("wallet.res.exitWarnB", { n: f.dur(REFUND_PERIOD_BLOCKS), h: f.height(height + REFUND_PERIOD_BLOCKS) }))}
        </Callout>
        {holders.length > 0 ? (
          <div>
            <div className="label wl-lbl">{t("wallet.res.creditors", { n: holders.length })}</div>
            <ul className="wl-facts">
              {holders.map((h) => (
                <li key={h.id}>{f.prose(t("wallet.res.creditor", { name: nameOf(h.id), v: f.amt(h.amount, unit, { unit: true }) }))}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="t-small">{t("wallet.res.noCreditors")}</p>
        )}
        <p className="t-small">{pick(copy.refundCreditors, t.lang)}</p>
        <Key variant="danger" size="lg" block hold onAct={() => void go()} disabled={busy}>
          {t("wallet.res.holdExit")}
        </Key>
      </div>
    </Sheet>
  );
}
