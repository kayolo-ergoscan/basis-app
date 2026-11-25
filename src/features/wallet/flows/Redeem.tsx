// Redeem wizard (X01, X02, X04–X07, X10, X11, X13–X15, H03–H05, H07, H10, R12): pick a note owed to you, tear
// off an amount (25 % / 50 % / max), see the pre-flight (FIFO queue, the tracker's compliance gate, coverage
// after, fees), hold the metal key, then watch the transaction: built, input 0 signed, every contract check, a
// receipt. Emergency path when the tracker has been silent > 2 160 blocks; an honest frozen state when it censors.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { isDenomId, type DenomId } from "@/protocol";
import { AmountInput, Callout, CoverageMeter, Empty, Field, FlowTrail, Honest, Key, Lamp, Ledger, prefersReducedMotion, Tag, Tear } from "@/ui";
import { parseAmount, previewRedeem, town, TOWN_TRACKER, useClock, useTownView, type RedeemOutcome } from "@/world";
import { ContractXray, ExitClocks, TxLens } from "@/viz";
import { copy, pick } from "@/content";
import { useFmt, useNameOf, useNameOfPub, useOutcomeToast, useRevealOnMount, useTg, useWT } from "../lib/hooks";
import { coverageAfter, fifoQueue, GENDER, plainAmount, toNum, trackerInfo, unitOf, walletModel, type Unit } from "../lib/model";
import { Frame, PartySeal } from "../parts/bits";

const ERG_UNIT: Unit = { id: "erg", symbol: "ERG", decimals: 9 };

export function RedeemFlow({ page }: { page: boolean }) {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const nameOf = useNameOf();
  const from = sp.get("from");
  const denomQ = sp.get("denom") ?? "erg";
  const denom: DenomId = isDenomId(denomQ) ? denomQ : "erg";
  const owed = useTownView((eco) => walletModel(eco, "erg").rows.filter((r) => r.dir === "in" && r.claim > 0n), []);
  const valid = !!from && !!owed?.some((r) => r.issuer === from && r.denom === denom);
  return (
    <Frame page={page} title={valid ? t("wallet.rd.titleFrom", { name: nameOf(from!) }) : t("wallet.rd.title")} sub={t("wallet.rd.sub")} labelId="wl-rd-h" className="wl-flow">
      {valid ? (
        <RedeemForm key={`${from}|${denom}`} issuer={from!} denom={denom} />
      ) : (
        <RedeemPick
          rows={owed ?? []}
          onPick={(issuer, d) => {
            const n = new URLSearchParams();
            n.set("from", issuer);
            if (d !== "erg") n.set("denom", d);
            setSp(n, { replace: true });
          }}
        />
      )}
      <Rehearse />
    </Frame>
  );
}

function RedeemPick({ rows, onPick }: { rows: NonNullable<ReturnType<typeof walletModel>["rows"]>; onPick: (issuer: string, denom: DenomId) => void }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const nameOf = useNameOf();
  const previews = useTownView((eco) => rows.map((r) => previewRedeem(eco, { issuer: r.issuer, denom: r.denom })), [rows.map((r) => r.key).join()]);
  if (!rows.length) return <Empty title={t("wallet.rd.none.t")} text={t("wallet.rd.none.b")} action={{ label: t("wallet.keys.request"), to: "/wallet/request" }} />;
  return (
    <div className="wl-form">
      <RedeemTrail at={0} />
      <h3 className="label">
        <b>{t("wallet.rd.pick")}</b>
      </h3>
      <ul className="rows">
        {rows.map((r, i) => {
          const p = previews?.[i];
          return (
            <li key={r.key}>
              <button type="button" className="row wl-pick" onClick={() => onPick(r.issuer, r.denom)}>
                <PartySeal id={r.issuer} badge={<Lamp state={p?.canRedeemNow ? "live" : "tracked"} size={8} />} />
                <span className="wl-row-mid">
                  <span className="who">{nameOf(r.issuer)}</span>
                  <span className="what">{p?.canRedeemNow ? f.prose(t("wallet.rd.now", { v: f.amt(p.maxAmount, r.unit, { unit: true }) })) : p?.blockers[0] ? f.prose(wt(`world.redeem.blocker.${p.blockers[0]}`)) : t("wallet.rd.notNow")}</span>
                </span>
                <span className="amt in">
                  <span className="num up">{f.amt(r.claim, r.unit, { sign: "favour" })}</span>
                  {r.unit.id !== "erg" && <small>{r.unit.symbol}</small>}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Stage = 0 | 1 | 2 | 3 | 4;

function RedeemTrail({ at }: { at: number }) {
  const t = useT();
  return <FlowTrail steps={[t("wallet.flow.whose"), t("wallet.flow.sign"), t("wallet.flow.redeemed")]} at={at} label={t("wallet.flow.aria")} />;
}

function RedeemForm({ issuer, denom }: { issuer: string; denom: DenomId }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const tg = useTg();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const uid = useId();
  const { height } = useClock();
  const name = nameOf(issuer);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<RedeemOutcome | null>(null);
  const [stage, setStage] = useState<Stage>(0);
  const v = useTownView(
    (eco) => {
      const p = previewRedeem(eco, { issuer, denom });
      if (!p) return null;
      const tr = trackerInfo(eco);
      const res = p.reserve ? eco.r(p.reserve) : null;
      return { p, unit: unitOf(eco, denom), tr, queue: fifoQueue(eco, issuer, denom), cov: eco.coverage(issuer, denom), r7: res ? Number(res.refundHeight()) : 0, collateral: res?.collateral() ?? 0n };
    },
    [issuer, denom],
  );
  const unit = v?.unit ?? ERG_UNIT;
  const value = amount.trim() ? parseAmount(amount, { id: denom, symbol: unit.symbol, decimals: unit.decimals }) : null;
  const after = useTownView((eco) => (value && value > 0n ? coverageAfter(eco, issuer, denom, value) : null), [issuer, denom, value?.toString()]);
  // receipt stages advance one by one (all at once under reduced motion)
  useEffect(() => {
    if (!out?.ok || stage >= 4) return;
    if (prefersReducedMotion()) return setStage(4);
    const id = window.setTimeout(() => setStage((s) => (s + 1) as Stage), stage === 3 ? 2200 : 900);
    return () => window.clearTimeout(id);
  }, [out, stage]);
  const preset = useMemo(() => (v ? [25, 50, 100].map((pc) => ({ pc, v: pc === 100 ? v.p.maxAmount : (v.p.maxAmount * BigInt(pc)) / 100n })) : []), [v]);
  if (!v) return null;
  const { p, tr } = v;
  const max = p.maxAmount;
  const invalid = amount.trim() !== "" && (value === null || value <= 0n || value > max);
  const g = GENDER[issuer];
  const censored = tr.censorMode !== "off" && tr.censorsYou;
  const frozen = p.path === "none" && !p.canRedeemNow;
  const emergency = p.path === "emergency";
  const minerPayer = p.fee.payer === "tracker" ? t("wallet.rd.fee.tracker", { id: TOWN_TRACKER }) : t("wallet.rd.fee.you");
  const keep = value && value <= p.claim ? p.claim - value : p.claim;

  const redeem = async () => {
    if (!value || invalid) return;
    setBusy(true);
    try {
      const o = await town.redeem({ issuer, amount: value, denom, emergency: "auto" });
      setOut(o);
      setStage(o.ok ? 1 : 0);
      show(o);
    } finally {
      setBusy(false);
    }
  };

  if (out?.ok) return <RedeemReceipt out={out} unit={unit} issuer={issuer} stage={stage} onSkip={() => setStage(4)} />;

  const covAfter = after?.after ?? null;
  const covBefore = after?.before ?? v.cov.ratio;
  const compliance = p.preflight?.compliance ?? null;
  return (
    <div className="wl-form">
      <RedeemTrail at={out?.ok ? 2 : 1} />
      <div className="who-line wl-to">
        <PartySeal id={issuer} size="lg" rim />
        <div className="wl-to-t">
          <div className="t-h4">{t("wallet.rd.fromRes", { name })}</div>
          <div className="t-small">{f.prose(tg("wallet.rd.owes", g, { name, v: f.amt(p.claim, unit, { unit: true }), c: f.pct(v.cov.ratio) }))}</div>
        </div>
        <Tag tone="metal">{t("wallet.rd.onErgo")}</Tag>
      </div>

      {censored && (
        <Callout tone="alarm" title={t("wallet.rd.censor.t", { id: TOWN_TRACKER })}>
          {f.prose(t("wallet.rd.censor.b", { id: TOWN_TRACKER, h: f.height(tr.emergencyOpensAt ?? 0) }))}
        </Callout>
      )}
      {emergency && (
        <Callout tone="metal" title={t("wallet.rd.em.t")}>
          {f.prose(t("wallet.rd.em.b", { id: TOWN_TRACKER, n: f.blocks(p.boxAge) }))}
        </Callout>
      )}
      {(emergency || !tr.online || censored) && <ExitClocks height={height} boxCreationHeight={tr.boxHeight} r7={v.r7 || null} show="emergency" trackerName={TOWN_TRACKER} />}
      {frozen && !censored && p.blockers.length > 0 && (
        <Callout tone={p.blockers.includes("tracker-offline") ? "calm" : "info"} title={t("wallet.rd.notYet")}>
          <ul className="wl-why">
            {p.blockers.map((b) => (
              <li key={b}>{f.prose(wt(`world.redeem.blocker.${b}`, { n: p.etaBlocks ?? 0, h: p.emergencyOpensAt ?? 0 }))}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="wl-chips" role="group" aria-label={t("wallet.rd.presets")}>
        {preset.map((x) => (
          <button key={x.pc} type="button" className={`wl-chip${value === x.v && x.v > 0n ? " on" : ""}`} disabled={max <= 0n} onClick={() => setAmount(plainAmount(x.v, unit.decimals))}>
            {x.pc === 100 ? t("wallet.rd.max") : `${x.pc} ⁠%`} <span className="num dim">{f.amt(x.v, unit)}</span>
          </button>
        ))}
      </div>
      <Field label={t("wallet.rd.amount")} error={invalid ? (value && value > max ? f.prose(t("wallet.rd.overMax", { v: f.amt(max, unit, { unit: true }) })) : t("wallet.amount.invalid")) : undefined} help={f.prose(t("wallet.rd.maxHelp", { v: f.amt(max, unit, { unit: true }) }))}>
        <AmountInput value={amount} onChange={setAmount} unit={unit.symbol} invalid={invalid} max={max > 0n ? { label: t("wallet.rd.max"), onMax: () => setAmount(plainAmount(max, unit.decimals)) } : undefined} aria-label={t("wallet.rd.amount")} />
      </Field>
      <Tear keep={toNum(keep, unit.decimals)} torn={toNum(value && !invalid ? value : 0n, unit.decimals)} keepLabel={t("wallet.rd.keep")} tornLabel={t("wallet.rd.torn")} dp={f.dpOf(unit)} />

      <section className="wl-pre" aria-labelledby={`${uid}-pre`}>
        <h3 className="label" id={`${uid}-pre`}>
          <b>{t("wallet.rd.pre")}</b>
        </h3>
        <ul className="wl-checks">
          <li className={v.queue.pos === 1 || v.queue.of <= 1 ? "ok" : "info"}>
            <span aria-hidden="true">{v.queue.pos === 1 || v.queue.of <= 1 ? "✓" : "·"}</span>
            {v.queue.of <= 1 ? t("wallet.rd.q.only", { name }) : f.prose(t("wallet.rd.q.pos", { pos: v.queue.pos, of: v.queue.of, name }))}
          </li>
          <li className={p.preflight?.ok ? "ok" : p.preflight ? "no" : "info"}>
            <span aria-hidden="true">{p.preflight?.ok ? "✓" : p.preflight ? "✕" : "·"}</span>
            {p.preflight === null
              ? t("wallet.rd.c.later")
              : compliance?.ok
                ? t(`wallet.rd.c.${compliance.mode}`, { id: TOWN_TRACKER })
                : compliance && !compliance.ok
                  ? t(`wallet.rd.c.${compliance.failureId}`, { holder: compliance.holder ? nameOf(town.economy?.idOf(compliance.holder) ?? compliance.holder) : "—", id: TOWN_TRACKER })
                  : f.prose(wt(`world.code.${p.preflight.code ?? "unknown"}`))}
          </li>
          <li className={covAfter === null || covAfter >= 1 ? "ok" : "info"}>
            <span aria-hidden="true">{covAfter === null || covAfter >= 1 ? "✓" : "·"}</span>
            {value && !invalid ? f.prose(t("wallet.rd.cov", { name, a: f.pct(covBefore), b: covAfter === null ? t("wallet.rd.covClear") : f.pct(covAfter) })) : t("wallet.rd.covPick")}
          </li>
        </ul>
        {!!value && !invalid && covAfter !== null && <CoverageMeter value={Math.round(covAfter * 100)} ghost={covBefore === null ? undefined : Math.round(covBefore * 100)} />}
      </section>

      <Ledger
        rows={[
          { label: t("wallet.rd.l.from", { name }), value: `${f.amt(value && !invalid ? value : 0n, unit)} ${unit.symbol}` },
          { label: pick(copy.feeProtocol, t.lang), value: "0.00" },
          { label: t("wallet.rd.l.miner"), sub: minerPayer, value: `${f.amt(p.fee.miner, ERG_UNIT, { dp: 3 })} ERG` },
          ...(p.fee.tokenBox > 0n ? [{ label: t("wallet.rd.l.tokenBox"), value: `${f.amt(p.fee.tokenBox, ERG_UNIT, { dp: 3 })} ERG` }] : []),
        ]}
        sum={{ label: t("wallet.rd.l.receive"), value: `${f.amt(value && !invalid ? value : 0n, unit)} ${unit.symbol}`, tone: "metal" }}
        caption={t("wallet.rd.l.caption")}
      />

      {out && !out.ok && (
        <Callout tone="alarm" title={wt(out.toast.titleKey, out.toast.params)}>
          {f.prose(wt(`world.code.${out.code ?? "unknown"}`, out.toast.params))}
        </Callout>
      )}
      {out && !out.ok && out.eval && <ContractXray evaluation={out.eval} mode="compact" focus={out.code ? [out.code] : undefined} />}

      <div className="wl-act">
        <Key variant="metal" size="lg" block hold onAct={() => void redeem()} disabled={!value || invalid || busy || (!p.canRedeemNow && !emergency)}>
          {busy ? t("wallet.rd.working") : value && !invalid ? t("wallet.rd.hold", { v: f.amt(value, unit) }) : t("wallet.rd.enter")}
        </Key>
      </div>
      <p className="t-small wl-act-note">{value && !invalid ? f.prose(t("wallet.rd.once", { v: f.amt(value, unit, { unit: true }) })) : t("wallet.rd.once0")}</p>
      <Honest tracker={TOWN_TRACKER} />
    </div>
  );
}

function RedeemReceipt({ out, unit, issuer, stage, onSkip }: { out: RedeemOutcome; unit: Unit; issuer: string; stage: Stage; onSkip: () => void }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const v = useTownView(
    (eco) => {
      const r = out.reserve ? eco.r(out.reserve) : null;
      const h = r?.history.find((x) => x.txId === out.txId) ?? r?.history[r.history.length - 1];
      return { left: r?.collateral() ?? 0n, height: h?.height ?? eco.clock.height, now: eco.clock.height };
    },
    [out.reserve, out.txId],
  );
  const name = nameOf(issuer);
  const nameOfPub = useNameOfPub();
  const root = useRef<HTMLDivElement>(null);
  useRevealOnMount(root, true);
  const steps = [t("wallet.rd.s.build"), t("wallet.rd.s.sign"), t("wallet.rd.s.eval"), t("wallet.rd.s.receipt")];
  return (
    <div className="wl-form wl-done" ref={root}>
      <ol className="wl-stages" aria-label={t("wallet.rd.s.aria")}>
        {steps.map((s, i) => (
          <li key={i} className={stage > i + 1 ? "done" : stage === i + 1 ? "on" : undefined}>
            <Lamp state={stage > i + 1 ? "live" : stage === i + 1 ? "committed" : "tracked"} size={9} />
            <b>{s}</b>
          </li>
        ))}
      </ol>
      {stage < 4 && (
        <button type="button" className="textlink t-small" onClick={onSkip}>
          {t("wallet.rd.s.skip")}
        </button>
      )}
      {stage >= 1 && out.tx && <TxLens tx={out.tx} evaluation={out.eval ?? null} nameOf={nameOfPub} unit={{ symbol: unit.symbol, decimals: unit.decimals }} />}
      {stage >= 2 && (
        <Callout tone="proof" title={t("wallet.rd.s.signT")}>
          {t(out.emergency ? "wallet.rd.s.signEm" : "wallet.rd.s.signB", { id: TOWN_TRACKER })}
        </Callout>
      )}
      {stage >= 3 && out.eval && <ContractXray evaluation={out.eval} mode="compact" animate={stage === 3} />}
      {stage >= 4 && v && (
        <section className="card wl-receipt" aria-labelledby="wl-rcpt-h">
          <div className="card-b">
            <div className="spread">
              <h3 className="label" id="wl-rcpt-h">
                <b>{t("wallet.rd.r.title")}</b>
              </h3>
              <Tag tone="metal">{out.emergency ? t("wallet.rd.r.emergency") : t("wallet.rd.r.normal")}</Tag>
            </div>
            <div className="t-money metal-t wl-rcpt-amt">
              {f.amt(out.amount ?? 0n, unit)}
              <span className="unit">{unit.symbol}</span>
            </div>
            <dl className="wl-dl">
              <dt>{t("wallet.rd.r.from")}</dt>
              <dd>{t("wallet.rd.r.fromV", { name })}</dd>
              <dt>{t("wallet.rd.r.left")}</dt>
              <dd className="num">{f.amt(v.left, unit, { unit: true })}</dd>
              <dt>{t("wallet.rd.r.block")}</dt>
              <dd className="mono">
                {f.height(v.height)} · {t("wallet.rd.r.depth", { n: Math.max(0, v.now - v.height + 1) })}
              </dd>
              {out.txId && (
                <>
                  <dt>{t("wallet.rd.r.tx")}</dt>
                  <dd className="mono">
                    {out.txId.slice(0, 8)}…{out.txId.slice(-6)} · {t("wallet.rd.r.sandboxTx")}
                  </dd>
                </>
              )}
            </dl>
            <p className="t-small">{t("wallet.rd.r.note", { name })}</p>
            <div className="wl-act">
              <Key variant="default" to="/wallet">
                {t("wallet.done")}
              </Key>
              <Key variant="quiet" to="/wallet/redeem">
                {t("wallet.rd.r.again")}
              </Key>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

/** Sandbox god mode: silence the tracker and mine past the emergency window, to rehearse an exit. */
function Rehearse() {
  const t = useT();
  const f = useFmt();
  const show = useOutcomeToast();
  const tr = useTownView((eco) => trackerInfo(eco), []);
  if (!tr) return null;
  const toOpen = tr.emergencyOpensAt !== null ? Math.max(0, tr.emergencyOpensAt - (town.economy?.clock.height ?? 0)) : 0;
  return (
    <details className="wl-rehearse">
      <summary>
        <span className="label">
          <b>{t("wallet.rh.title")}</b> · {t("wallet.rh.god")}
        </span>
      </summary>
      <p className="t-small">{t("wallet.rh.body", { id: TOWN_TRACKER })}</p>
      <div className="wl-act">
        {tr.online ? (
          <Key size="sm" variant="danger" onClick={() => void town.tracker.setOnline(false).then(show)}>
            {t("wallet.rh.off", { id: TOWN_TRACKER })}
          </Key>
        ) : (
          <Key size="sm" onClick={() => void town.tracker.setOnline(true).then(show)}>
            {t("wallet.rh.on", { id: TOWN_TRACKER })}
          </Key>
        )}
        <Key size="sm" disabled={tr.online || toOpen === 0} onClick={() => void town.clock.mine(toOpen).then(show)}>
          {f.prose(t("wallet.rh.mine", { n: f.blocks(toOpen) }))}
        </Key>
      </div>
    </details>
  );
}
