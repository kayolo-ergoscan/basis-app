// /wallet/mainnet/reserve — the key's reserve (design §2): its state when the tracker tracks it, or T1, which creates
// it: precheck (the tracker, the journal, the mempool) → plan (coins, the final amount) → the tracker's template,
// checked byte for byte against the app's pinned constants → the transaction, checked → review → the passphrase again
// (a T1 moves the whole reserve: the vault asks every time) → hold to sign → journal → broadcast → depth 2 → tracked →
// active. One reserve per key: a second one would be quarantined and block
// every new note for 60 days. Once it exists: its state (active, refund running, refund available) and the actions
// that apply (Top up: TopUp.tsx; refund start and completion: Refund.tsx).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, Field, Key, Switch, Tag, TextInput, int } from "@/ui";
import {
  MINER_FEE_NANOERG, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, RESERVE_MIN_NANOERG, JsonSyntaxError, ShapeError, TrackerRefusal,
  buildReserveCreation, checkReserveCreation, checkReservePayload, checkWithdraw, computeTxId, outputBoxes, parseReservePayload,
  type ErgoBox, type ReservePlan, type UnsignedTx,
} from "@/mainnet/tx";
import { blocksToDays, ergInput, isBroadcastLimit, mempoolCreatesReserve, parseErg, planCombine, planT1, reserveCoverage, reserveLife, spendable, t1CreateBody, type WithdrawPlan } from "@/mainnet/flows";
import { RESERVE_ACTION_KINDS, blocksNewT1, isOpenState, isVaultError, type JournalEntry } from "@/mainnet/vault";
import { localProblem, type Problem } from "@/mainnet/net";
import type { TrackedReserve } from "@/chain/ours";
import { useMw } from "./ctx";
import { R, inFlightOf, net, useResource, useUnspent } from "./data";
import { EntryProgress, signAndSend } from "./send";
import { ChainLink, Erg, Gate, ProblemText, ReserveTag, TimeHint, TxReview, ergText, useVaultError } from "./ui";

type Phase =
  | { k: "idle" }
  | { k: "working"; step: "precheck" | "template" | "build" | "sign" | "send" }
  | { k: "review"; plan: ReservePlan; fee: bigint; tx: UnsignedTx; txId: string; tip: number }
  | { k: "combine"; plan: Extract<WithdrawPlan, { ok: true }>; tip: number; txId: string }
  | { k: "error"; problem?: Problem; text?: string; rule?: string };

/** The tracked reserve: what it holds, what its notes promise, its box on ergoscan.me. */
export function ReserveCard({ r }: { r: TrackedReserve }) {
  const t = useT();
  const { pct: cov, settled, settling } = reserveCoverage(r);
  // a low figure while redemptions wait for the chain is the tracker's short delay, not a shortfall (money P2-8)
  // the tag says "settling" then (ReserveTag): a red band next to the calm note would say the opposite
  const lowOnlyForNow = settling && cov !== null && cov < 100 && (settled === null || settled >= 100);
  return (
    <Card title={t("mw.res.cardT")} aside={<ReserveTag r={r} />}>
      <div className="mw-figs">
        <div className="mw-figure"><span className="label">{t("mw.res.collateral")}</span><b><Erg nano={r.collateral} /></b></div>
        <div className="mw-figure"><span className="label">{t("mw.res.debt")}</span><b><Erg nano={r.debt} /></b><span className="t-small mw-dim">{cov !== null ? t("mw.res.coverage", { pct: int(cov) }) : t("mw.res.noDebt")}</span>
          {r.pendingRedemption > 0n && <span className="t-small mw-dim">{t("mw.res.pendingRed", { amount: ergText(r.pendingRedemption) })}</span>}</div>
      </div>
      <p className="t-small">{t("mw.res.box")} <ChainLink kind="box" id={r.box} /> · {t("mw.res.updated", { h: int(r.updatedHeight) })}</p>
      {cov !== null && cov < 100 && (lowOnlyForNow ? <Callout tone="calm">{t("mw.res.settling")}</Callout> : <Callout tone="alarm">{t("mw.res.under")}</Callout>)}
      <ReserveLifeBlock refundHeight={r.refundHeight} />
    </Card>
  );
}

/** Where the reserve stands (active, refund running, refund available) and the actions that apply (design §9). R7 as
 *  the tracker reports it; the Top up and Refund screens read the chain again before anything is signed. */
export function ReserveLifeBlock({ refundHeight }: { refundHeight: number }) {
  const t = useT();
  const { height } = useMw();
  const life = reserveLife(refundHeight, height);
  if (life.kind === "active") {
    return (
      <div className="mw-form">
        <p className="t-small"><Tag tone="ok" glyph="●">{t("mw.ref.active")}</Tag> {t("mw.res.activeB")}</p>
        <div className="mw-actions">
          <Key size="sm" icon="coin" to="/wallet/mainnet/topup">{t("mw.res.topUp")}</Key>
          <Key size="sm" variant="quiet" to="/wallet/mainnet/refund">{t("mw.res.refundGo")}</Key>
        </div>
        <p className="t-small mw-dim">{t("mw.res.lock")}</p>
      </div>
    );
  }
  const unlock = int(Number(life.clock.unlockAt));
  return (
    <Callout tone={life.clock.open ? "info" : "alarm"} title={life.clock.open ? t("mw.res.refundOpenT") : t("mw.res.refundT", { h: int(Number(life.clock.startedAt)) })}>
      <p>{life.clock.open ? t("mw.res.refundOpenB", { h: unlock }) : height === null ? t("mw.res.refundB0", { h: unlock }) : t("mw.res.refundB", { h: unlock, blocks: int(life.clock.blocksLeft), days: blocksToDays(life.clock.blocksLeft) })}</p>
      <Key size="sm" variant={life.clock.open ? "primary" : undefined} to="/wallet/mainnet/refund">{life.clock.open ? t("mw.res.refundEnd") : t("mw.res.refundSee")}</Key>
    </Callout>
  );
}

function T1Progress({ entry }: { entry: JournalEntry }) {
  const t = useT();
  const { vault, me, height } = useMw();
  const waiting = entry.state === "final" || entry.state === "confirmed";
  const res = useResource(me ? R.reservesOf(me.pub) : null, { everyMs: waiting ? 30_000 : 120_000 });
  const reserveBox = typeof entry.meta.reserveBox === "string" ? entry.meta.reserveBox : null;
  const tracked = (res.value ?? []).find((r) => r.box === reserveBox) ?? (res.value ?? [])[0] ?? null;
  const active = tracked && tracked.refundHeight === 0;
  const late = entry.state === "final" && !tracked && entry.inclusionHeight !== null && height !== null && height - entry.inclusionHeight > 15;
  return (
    <Card title={t("mw.res.progressT")}>
      <EntryProgress vault={vault} entry={entry} tip={height} timeKey="t1" extra={[
        { id: "tracked", label: t("mw.res.tracked"), sub: entry.state === "final" && !tracked ? t("mw.res.trackedWait") : undefined, state: tracked ? "done" : entry.state === "final" ? "now" : "todo" },
        { id: "active", label: t("mw.res.active"), state: active ? "done" : "todo" },
      ]} />
      {late && <Callout tone="calm" title={t("mw.res.lateT")}>{t("mw.res.lateB")}</Callout>}
      {tracked && <ReserveCard r={tracked} />}
    </Card>
  );
}

export function ReserveScreen() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const verr = useVaultError();
  const res = useResource(me ? R.reservesOf(me.pub) : null, { everyMs: 120_000, enabled: state.backedUp });
  const un = useUnspent(me, height, state.backedUp);
  const [amountText, setAmountText] = useState(() => ergInput(RESERVE_DEFAULT_CAP_NANOERG / 2n));
  const [big, setBig] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [pass, setPass] = useState("");
  const [passWrong, setPassWrong] = useState(false);
  const t1 = useMemo(() => (me ? entries.find((e) => e.pub === me.pub && e.kind === "t1" && blocksNewT1(e)) ?? null : null), [entries, me]);
  const combineEntry = useMemo(() => (me ? entries.find((e) => e.pub === me.pub && e.kind === "withdraw" && e.meta.combine === true && e.state !== "final" && e.state !== "failed" && e.state !== "abandoned") ?? null : null), [entries, me]);
  const actions = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && RESERVE_ACTION_KINDS.includes(e.kind) && isOpenState(e.state)) : []), [entries, me]);
  const cap = big ? RESERVE_HARD_CAP_NANOERG : RESERVE_DEFAULT_CAP_NANOERG;
  const amount = parseErg(amountText);
  const reserve = (res.value ?? [])[0] ?? null;

  const fail = (p: Partial<Extract<Phase, { k: "error" }>>) => setPhase({ k: "error", ...p });

  /** Anything thrown on the way (a box that does not hash to its id, …) stops the flow in words, unsigned. */
  const guard = (f: () => Promise<void>) => f().catch((e: unknown) => fail({ text: t("mw.err.shape"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined }));

  /** Precheck → plan → the tracker's template → the transaction, checked. Nothing is signed here. */
  async function prepare() {
    if (!me || amount === null) return;
    if (height === null) return fail({ text: t("mw.res.noHeight") });
    setPhase({ k: "working", step: "precheck" });
    const mine = await net().reservesOf(me.pub, { priority: "user" });
    if (!mine.ok) return fail({ problem: mine.problem });
    res.refresh();
    if (mine.value.length > 0) return fail({ text: t("mw.res.hasReserve") });
    if (await vault.journal.activeT1(me.pub)) return fail({ text: t("mw.res.hasT1") });
    // the chain too (money review P2-4): a reserve made on another device, or one the tracker does not show yet
    const onChain = await net().reservesOnChain(me.pub, { priority: "user" });
    if (!onChain.ok) return fail({ problem: onChain.problem });
    if (onChain.value.boxes.length > 0) return fail({ text: t("mw.res.hasReserveChain") });
    if (!onChain.value.complete) return fail({ text: t("mw.res.chainIncomplete") });
    const mem = await net().mempool(me.address, { priority: "user" });
    if (!mem.ok) return fail({ problem: mem.problem });
    if (mempoolCreatesReserve(mem.value, me)) return fail({ text: t("mw.res.inMempool") });
    const fresh = await net().unspent(me.address, me.tree, { priority: "user" });
    if (!fresh.ok) return fail({ problem: fresh.problem });
    const usable = spendable(fresh.value.boxes, inFlightOf(entries, me.pub), mem.value);
    let fee = MINER_FEE_NANOERG;
    let p = planT1(usable, me.pub, amount, fee, cap);
    if (!p.ok) {
      if (p.why === "too-many-boxes") return offerCombine(usable);
      return fail({ text: p.why === "short" ? t("mw.res.short", { need: ergText(p.need), have: ergText(p.have) }) : t("mw.res.amountRange", { min: ergText(p.min), max: ergText(p.max) }) });
    }
    setPhase({ k: "working", step: "template" });
    for (let round = 0; round < 2; round++) {
      const a = await net().createReserve(t1CreateBody(p.plan, me.pub), { priority: "user" });
      if (!a.ok) return fail({ problem: a.problem });
      let payload;
      try { payload = parseReservePayload(a.value); } catch (e) {
        if (e instanceof TrackerRefusal) return fail({ problem: localProblem("refused", e.reason) });
        return fail({ text: t("mw.res.templateBad"), rule: e instanceof ShapeError || e instanceof JsonSyntaxError ? e.message : undefined });
      }
      const c = checkReservePayload(payload, { owner: me.pub, amount: p.plan.amount, nftId: p.plan.nftId });
      if (!c.ok) return fail({ text: t("mw.res.templateBad"), rule: `${c.rule}: ${c.message}` });
      if (payload.fee === fee) { fee = payload.fee; break; }
      // the tracker asks another miner fee: plan again with it; the same amount and NFT keep this template
      fee = payload.fee;
      const again = planT1(usable, me.pub, amount, fee, cap);
      if (!again.ok) return fail({ text: t("mw.res.short", { need: ergText(amount + fee), have: ergText(usable.reduce((s, b) => s + b.value, 0n)) }) });
      const same = again.plan.amount === p.plan.amount && again.plan.nftId === p.plan.nftId;
      p = again;
      if (same) break;
      if (round === 1) return fail({ text: t("mw.res.templateBad"), rule: "fee" });
    }
    setPhase({ k: "working", step: "build" });
    const tx = buildReserveCreation({ owner: me.pub, inputs: p.plan.inputs, amount: p.plan.amount, fee, height });
    const c = checkReserveCreation(tx, p.plan.inputs, { owner: me.pub, amount: p.plan.amount, fee, height, cap });
    if (!c.ok) return fail({ text: t("mw.res.checkFailed"), rule: `${c.rule}: ${c.message}` });
    setPhase({ k: "review", plan: p.plan, fee, tx, txId: computeTxId(tx), tip: height });
  }

  function offerCombine(usable: ErgoBox[]) {
    if (!me || height === null) return;
    const plan = planCombine(usable, me.pub, me.address, height);
    if (!plan.ok) return fail({ text: t("mw.res.combineNo") });
    const c = checkWithdraw(plan.tx, plan.inputs, { owner: me.pub, to: me.address, amount: plan.sent, fee: MINER_FEE_NANOERG, height });
    if (!c.ok) return fail({ text: t("mw.res.checkFailed"), rule: `${c.rule}: ${c.message}` });
    setPhase({ k: "combine", plan, tip: height, txId: computeTxId(plan.tx) });
  }

  async function sign() {
    if (phase.k !== "review" || !me || !pass) return;
    const review = phase;
    const { plan, fee, tx, tip } = phase;
    setPhase({ k: "working", step: "sign" });
    setPassWrong(false);
    try {
      const reserveBox = outputBoxes(tx)[0].boxId;
      const r = await signAndSend(vault, "t1", tx, plan.inputs, { amount: plan.amount.toString(), fee: fee.toString(), nftId: plan.nftId, reserveBox }, tip, pass);
      setPass("");
      setPhase(r.problem ? { k: "error", problem: r.problem } : { k: "idle" });
    } catch (e) {
      if (isVaultError(e, "wrong-passphrase")) { setPassWrong(true); return setPhase(review); }
      if (isBroadcastLimit(e)) {
        // the same filter as every selection: boxes an open entry or a mempool transaction spends stay out (P2-1)
        const m = await net().mempool(me.address, { priority: "user" });
        if (!m.ok) return fail({ problem: m.problem });
        return offerCombine(un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub), m.value) : plan.inputs);
      }
      fail({ text: isVaultError(e, "t1-exists") ? t("mw.res.hasT1") : verr(e) });
    }
  }

  async function signCombine() {
    if (phase.k !== "combine") return;
    const { plan, tip } = phase;
    setPhase({ k: "working", step: "sign" });
    try {
      const r = await signAndSend(vault, "withdraw", plan.tx, plan.inputs, { amount: plan.sent.toString(), to: me!.address, combine: true }, tip);
      setPhase(r.problem ? { k: "error", problem: r.problem } : { k: "idle" });
    } catch (e) { fail({ text: verr(e) }); }
  }

  const busy = phase.k === "working";
  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.res.h")}</h1>
            <p className="t-lede">{t("mw.res.lede")}</p>
          </header>
          {reserve && !t1 && <ReserveCard r={reserve} />}
          {t1 && <T1Progress entry={t1} />}
          {actions.map((e) => (
            <Card key={e.id} title={t(`mw.kind.${e.kind}`)}>
              <EntryProgress vault={vault} entry={e} tip={height} />
            </Card>
          ))}
          {combineEntry && (
            <Card title={t("mw.res.combineProgressT")}>
              <EntryProgress vault={vault} entry={combineEntry} tip={height} />
              <p className="t-small mw-dim">{t("mw.res.combineAfter")}</p>
            </Card>
          )}
          {!reserve && !t1 && !combineEntry && (
            <Gate vault={vault} state={state} unlocked why={t("mw.res.unlockWhy")}>
              <Card title={t("mw.res.createT")}>
                {phase.k === "review" ? (
                  <div className="mw-form">
                    <TxReview tx={phase.tx} inputs={phase.plan.inputs} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
                      rows={[
                        { label: t("mw.res.rowReserve"), value: <Erg nano={phase.plan.amount} /> },
                        ...(phase.plan.change > 0n ? [{ label: t("mw.res.rowChange"), value: <Erg nano={phase.plan.change} /> }] : []),
                        { label: t("mw.res.rowFee"), value: <Erg nano={phase.fee} /> },
                      ]}
                      sum={{ label: t("mw.res.rowSpent", { n: phase.plan.inputs.length }), value: <Erg nano={phase.plan.inputs.reduce((s, b) => s + b.value, 0n)} /> }}
                      extra={<p className="t-small">{t("mw.res.reviewChecks")}</p>} />
                    <Callout tone="policy">{t("mw.res.lock")}</Callout>
                    <Field label={t("mw.pay.passAgain")} help={t("mw.res.passWhy")} error={passWrong ? t("mw.pay.passWrong") : undefined}>
                      <TextInput type="password" autoComplete="current-password" value={pass} onChange={(v) => { setPass(v); setPassWrong(false); }} />
                    </Field>
                    <Key variant="primary" hold block disabled={!pass} onAct={() => void sign()}>{t("mw.res.hold")}</Key>
                    <Key variant="quiet" onClick={() => setPhase({ k: "idle" })}>{t("mw.cancel")}</Key>
                  </div>
                ) : phase.k === "combine" ? (
                  <div className="mw-form">
                    <Callout tone="info" title={t("mw.res.combineT")}>{t("mw.res.combineB", { n: phase.plan.inputs.length })}</Callout>
                    <TxReview tx={phase.plan.tx} inputs={phase.plan.inputs} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
                      rows={[{ label: t("mw.res.combineRow", { n: phase.plan.inputs.length }), value: <Erg nano={phase.plan.sent} /> }, { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> }]} />
                    <Key variant="primary" hold block onAct={() => void signCombine()}>{t("mw.res.combineHold")}</Key>
                    <Key variant="quiet" onClick={() => setPhase({ k: "idle" })}>{t("mw.cancel")}</Key>
                  </div>
                ) : (
                  <div className="mw-form">
                    <Field label={t("mw.res.amount")} help={t("mw.res.amountHelp", { min: ergText(RESERVE_MIN_NANOERG), max: ergText(cap) })}
                      error={amountText && (amount === null || amount > cap || amount < RESERVE_MIN_NANOERG) ? t("mw.res.amountRange", { min: ergText(RESERVE_MIN_NANOERG), max: ergText(cap) }) : undefined}>
                      <AmountInput value={amountText} onChange={setAmountText} disabled={busy} />
                    </Field>
                    <Switch checked={big} onChange={setBig} label={t("mw.res.bigT")} help={t("mw.res.bigB")} />
                    <p className="t-small">{t("mw.res.have")} <b>{un.value ? <Erg nano={spendable(un.value.boxes, inFlightOf(entries, me!.pub)).reduce((s, b) => s + b.value, 0n)} /> : "—"}</b> · <Link className="textlink" to="/wallet/mainnet/fund">{t("mw.res.fund")}</Link></p>
                    {phase.k === "error" && (
                      <Callout tone="alarm" title={t("mw.res.stopT")}>
                        {phase.problem ? <ProblemText p={phase.problem} what="create" /> : phase.text}
                        {phase.rule && <span className="mw-reason">{t("mw.rule")} <code>{phase.rule}</code></span>}
                        <span className="mw-reason">{t("mw.nothingSigned")}</span>
                      </Callout>
                    )}
                    <Key variant="primary" block disabled={busy || amount === null || amount > cap || amount < RESERVE_MIN_NANOERG} onClick={() => void guard(prepare)}>
                      {busy ? t(`mw.res.working.${(phase as { step: string }).step}`) : t("mw.res.prepare")}
                    </Key>
                    <p className="t-small mw-dim">{t("mw.res.prepareHint")}</p>
                  </div>
                )}
              </Card>
            </Gate>
          )}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.res.howT")}>
            <ul className="mw-facts">
              <li>{t("mw.res.how1")}</li>
              <li>{t("mw.res.how2")}</li>
              <li>{t("mw.res.how3")}</li>
              <li>{t("mw.res.how4")}</li>
            </ul>
            <TimeHint k="t1" />
          </Card>
          <Callout tone="calm" title={t("mw.honest.t")}>{t("mw.honest.b")}</Callout>
          {res.problem && <p className="t-small"><ProblemText p={res.problem} what="read" /></p>}
        </aside>
      </div>
    </Gate>
  );
}
