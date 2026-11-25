// /wallet/mainnet/reserve — the key's reserve (design §2): its state when the tracker tracks it, or T1, which creates
// it: precheck (the tracker, the journal, the mempool) → plan (coins, the final amount) → the tracker's template,
// checked byte for byte against the app's pinned constants → the transaction, checked → review → the passphrase again
// (a T1 moves the whole reserve: the vault asks every time) → hold to sign → journal → broadcast → depth 2 → tracked →
// active. One reserve per key: a second one would be quarantined and block every new note for 60 days, so one rule
// stops a T1 on the screen and in prepare() (wallet-t3 P2, t1GateOf): any ERG reserve the tracker lists for the key
// (one whose NFT this key did not mint is said to be so, never shown as the key's reserve), or a reserve box at the
// key whose NFT this key minted. Once it exists: its state (active, refund running, refund available) and the actions
// that apply (Top up: TopUp.tsx; refund start and completion: Refund.tsx).
// Token reserves (?d=sigusd|rsada, denom.tsx): the same flow and the same rules per denomination (one reserve per key
// and denomination): the box holds the tokens and 0.002 ERG, the T1 is checked by checkTokenReserveCreation, the
// screen says what the key needs (tokens + ERG) before anything is prepared, and only while the tracker serves the token.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, Field, Key, Switch, Tag, TextInput, int } from "@/ui";
import {
  MINER_FEE_NANOERG, MIN_BOX_NANOERG, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, RESERVE_MIN_NANOERG, TOKEN_RESERVE_BOX_NANOERG, JsonSyntaxError, ShapeError, TrackerRefusal,
  buildReserveCreation, buildTokenReserveCreation, checkReserveCreation, checkReservePayload, checkTokenReserveCreation, checkTokenReservePayload, checkWithdraw, computeTxId,
  denomDecimals, denomSymbol, mergedTokens, outputBoxes, parseReservePayload, tokenIdOf, type Denomination, type ErgoBox, type ReservePlan, type ReserveToken, type TokenReservePlan, type UnsignedTx,
} from "@/mainnet/tx";
import {
  blocksToDays, isBroadcastLimit, mempoolCreatesReserve, parseUnits, planCombine, planT1, planTokenT1, reserveCoverage, reserveLife, spendable, t1CreateBody, tokenBalanceOf,
  tokenT1CreateBody, unitsInput, type WithdrawPlan,
} from "@/mainnet/flows";
import { RESERVE_ACTION_KINDS, blocksNewT1In, isOpenState, isVaultError, t1DenomOf, type JournalEntry, type JournalMetaValue } from "@/mainnet/vault";
import { localProblem, type Problem } from "@/mainnet/net";
import type { TrackedReserve } from "@/chain/ours";
import { useMw } from "./ctx";
import { R, inFlightOf, net, t1GateOf, useResource, useUnspent } from "./data";
import { EntryProgress, signAndSend } from "./send";
import { ChainLink, Erg, Gate, ProblemText, ReserveTag, TimeHint, TxReview, ergText, useVaultError } from "./ui";
import { Amt, DenomSwitch, NotServed, TokensAfter, amtText, backToKey, denomQuery, tokenOf, useDenom, useDenomPhase, useServed } from "./denom";

type Phase =
  | { k: "idle" }
  | { k: "working"; step: "precheck" | "template" | "build" | "sign" | "send" }
  | { k: "review"; plan: ReservePlan; fee: bigint; tx: UnsignedTx; txId: string; tip: number }
  | { k: "treview"; plan: TokenReservePlan; fee: bigint; tx: UnsignedTx; txId: string; tip: number }
  | { k: "combine"; plan: Extract<WithdrawPlan, { ok: true }>; tip: number; txId: string }
  | { k: "error"; problem?: Problem; text?: string; rule?: string };

/** The tracked reserve: what it holds, what its notes promise, its box on ergoscan.me. */
export function ReserveCard({ r }: { r: TrackedReserve }) {
  const t = useT();
  // the tracker reports a token reserve's collateral and debt in that token's raw units (ergo_scanner: tokens(1))
  const d: Denomination = r.token === null ? "erg" : `token:${r.token}`;
  const { pct: cov, settled, settling } = reserveCoverage(r);
  // a low figure while redemptions wait for the chain is the tracker's short delay, not a shortfall (money P2-8)
  // the tag says "settling" then (ReserveTag): a red band next to the calm note would say the opposite
  const lowOnlyForNow = settling && cov !== null && cov < 100 && (settled === null || settled >= 100);
  return (
    <Card title={d === "erg" ? t("mw.res.cardT") : t("mw.dn.cardT", { sym: denomSymbol(d) })} aside={<ReserveTag r={r} />}>
      <div className="mw-figs">
        <div className="mw-figure"><span className="label">{t("mw.res.collateral")}</span><b><Amt raw={r.collateral} denom={d} /></b></div>
        <div className="mw-figure"><span className="label">{t("mw.res.debt")}</span><b><Amt raw={r.debt} denom={d} /></b><span className="t-small mw-dim">{cov !== null ? t("mw.res.coverage", { pct: int(cov) }) : t("mw.res.noDebt")}</span>
          {r.pendingRedemption > 0n && <span className="t-small mw-dim">{t("mw.res.pendingRed", { amount: amtText(r.pendingRedemption, d) })}</span>}</div>
      </div>
      <p className="t-small">{t("mw.res.box")} <ChainLink kind="box" id={r.box} /> · {t("mw.res.updated", { h: int(r.updatedHeight) })}</p>
      {cov !== null && cov < 100 && (lowOnlyForNow ? <Callout tone="calm">{t("mw.res.settling")}</Callout> : <Callout tone="alarm">{t("mw.res.under")}</Callout>)}
      <ReserveLifeBlock refundHeight={r.refundHeight} denom={d} />
    </Card>
  );
}

/** Where the reserve stands (active, refund running, refund available) and the actions that apply (design §9). R7 as
 *  the tracker reports it; the Top up and Refund screens read the chain again before anything is signed. */
export function ReserveLifeBlock({ refundHeight, denom = "erg" }: { refundHeight: number; denom?: Denomination }) {
  const t = useT();
  const { height } = useMw();
  const life = reserveLife(refundHeight, height);
  if (life.kind === "active") {
    return (
      <div className="mw-form mw-life">
        <p className="t-small"><Tag tone="ok" glyph="●">{t("mw.ref.active")}</Tag> {t("mw.res.activeB")}</p>
        <div className="mw-actions">
          <Key size="sm" icon="coin" to={`/wallet/mainnet/topup${denomQuery(denom)}`}>{t("mw.res.topUp")}</Key>
          <Key size="sm" variant="quiet" to={`/wallet/mainnet/refund${denomQuery(denom)}`}>{t("mw.res.refundGo")}</Key>
        </div>
        <p className="t-small mw-dim">{t("mw.res.lock")}</p>
      </div>
    );
  }
  const unlock = int(Number(life.clock.unlockAt));
  return (
    <Callout className="mw-life" tone={life.clock.open ? "info" : "alarm"} title={life.clock.open ? t("mw.res.refundOpenT") : t("mw.res.refundT", { h: int(Number(life.clock.startedAt)) })}>
      <p>{life.clock.open ? t("mw.res.refundOpenB", { h: unlock }) : height === null ? t("mw.res.refundB0", { h: unlock }) : t("mw.res.refundB", { h: unlock, blocks: int(life.clock.blocksLeft), days: blocksToDays(life.clock.blocksLeft) })}</p>
      <Key size="sm" variant={life.clock.open ? "primary" : undefined} to={`/wallet/mainnet/refund${denomQuery(denom)}`}>{life.clock.open ? t("mw.res.refundEnd") : t("mw.res.refundSee")}</Key>
    </Callout>
  );
}

/** Why prepare() refuses a T1, by the gate's answer (t1GateOf): one rule with what the screen shows. */
const T1_REFUSED = { own: "mw.res.hasReserve", unproven: "mw.res.hasUnproven", unchecked: "mw.res.hasUnchecked", "unchecked-chain": "mw.res.hasUnchecked", chain: "mw.res.hasReserveChain" } as const;

/** Reserves the tracker lists under this key whose NFT this key did not mint (wallet-t3 P2): said plainly, never shown
 *  as the key's reserve; no T1 is offered either, since the tracker would quarantine a second reserve of the key. */
function UnprovenReserve({ rs, denom }: { rs: TrackedReserve[]; denom: Denomination }) {
  const t = useT();
  return (
    <Callout tone="alarm" title={t("mw.res.unprovenT")}>
      <p>{t("mw.res.unprovenB")}</p>
      <ul className="mw-facts">
        {rs.map((r) => <li key={r.box}>{t("mw.res.box")} <ChainLink kind="box" id={r.box} /> · <Amt raw={r.collateral} denom={denom} /></li>)}
      </ul>
    </Callout>
  );
}

function T1Progress({ entry, denom }: { entry: JournalEntry; denom: Denomination }) {
  const t = useT();
  const { vault, me, height } = useMw();
  const waiting = entry.state === "final" || entry.state === "confirmed";
  const gate = useResource(me ? R.trackedGate(me.pub, denom) : null, { everyMs: waiting ? 30_000 : 120_000 });
  // the tracker's entry whose NFT this key minted (trackedGateOf): never one planted under the key (wallet-t3 P2)
  const tracked = gate.value?.k === "own" ? gate.value.r : null;
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
  const [denom, setDenom] = useDenom();
  const token = tokenOf(denom);
  const served = useServed(denom);
  const t1 = useMemo(() => (me ? entries.find((e) => e.pub === me.pub && e.kind === "t1" && blocksNewT1In(e, denom)) ?? null : null), [entries, me, denom]);
  // what stops a T1 (t1GateOf), read while no T1 of this browser is open (T1Progress follows that one)
  const gate = useResource(me ? R.t1Gate(me.pub, denom) : null, { everyMs: 120_000, enabled: state.backedUp && !t1 });
  const un = useUnspent(me, height, state.backedUp);
  // one amount per denomination: switching keeps what was typed in each
  const [texts, setTexts] = useState<Partial<Record<Denomination, string>>>({});
  const amountText = texts[denom] ?? unitsInput((token ? token.defaultCap : RESERVE_DEFAULT_CAP_NANOERG) / 2n, denomDecimals(denom));
  const setAmountText = (v: string) => setTexts((m) => ({ ...m, [denom]: v }));
  const [big, setBig] = useState(false);
  const [phase, setPhase] = useDenomPhase<Phase>(denom, { k: "idle" }, () => { setPass(""); setBig(false); });
  const [pass, setPass] = useState("");
  const [passWrong, setPassWrong] = useState(false);
  const combineEntry = useMemo(() => (me ? entries.find((e) => e.pub === me.pub && e.kind === "withdraw" && e.meta.combine === true && e.state !== "final" && e.state !== "failed" && e.state !== "abandoned") ?? null : null), [entries, me]);
  const actions = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && RESERVE_ACTION_KINDS.includes(e.kind) && isOpenState(e.state) && t1DenomOf(e) === denom) : []), [entries, me, denom]);
  const cap = token ? (big ? token.hardCap : token.defaultCap) : big ? RESERVE_HARD_CAP_NANOERG : RESERVE_DEFAULT_CAP_NANOERG;
  const min = token ? token.min : RESERVE_MIN_NANOERG;
  const amount = parseUnits(amountText, denomDecimals(denom));
  const amountBad = amount === null || amount > cap || amount < min;
  // the key's own reserve, the ones the tracker lists under it that this wallet cannot prove, or one this key minted
  // that the tracker does not list yet: each stops a T1, and the form is not shown
  const reserve = gate.value?.k === "own" ? gate.value.r : null;
  const unproven = gate.value?.k === "unproven" ? gate.value.rs : null;
  const unchecked = gate.value?.k === "unchecked" ? gate.value.rs.map((r) => r.box) : gate.value?.k === "unchecked-chain" ? gate.value.boxes : null;
  const onChainOnly = gate.value?.k === "chain";
  // the form waits for the gate's first answer (a problem shows the form too: prepare() reads it again and says why)
  const gateKnown = gate.value !== null || gate.problem !== null;

  const fail = (p: Partial<Extract<Phase, { k: "error" }>>) => setPhase({ k: "error", ...p });

  /** Anything thrown on the way (a box that does not hash to its id, …) stops the flow in words, unsigned. */
  const guard = (f: () => Promise<void>) => f().catch((e: unknown) => fail({ text: t("mw.err.shape"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined }));

  /** Precheck → plan → the tracker's template → the transaction, checked. Nothing is signed here. */
  async function prepare() {
    if (!me || amount === null) return;
    if (height === null) return fail({ text: t("mw.res.noHeight") });
    if (token) return prepareToken(token, amount, height);
    setPhase({ k: "working", step: "precheck" });
    // the screen's rule, read fresh (wallet-t3 P2, t1GateOf): any ERG reserve the tracker lists for this key, proven or
    // not, since the tracker would quarantine a second one (the words say whether this key minted it); then a reserve
    // this key minted that the tracker does not list yet (money review P2-4)
    const g = await t1GateOf(me.pub, { priority: "user" });
    if (!g.ok) return fail({ problem: g.problem });
    // the screen shows this answer: no second read through the queue (wallet-t3 LOW-2)
    R.t1Gate(me.pub).put(g.value);
    if (g.value.k !== "none") return fail({ text: t(T1_REFUSED[g.value.k]) });
    if (await vault.journal.activeT1(me.pub)) return fail({ text: t("mw.res.hasT1") });
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

  /**
   * The token T1: the same steps and rules as the ERG one (the gate for this denomination, the journal, the mempool,
   * fresh coins), the plan in the token's raw units, the tracker's template checked against it (the token contract,
   * the NFT, the token id and amount exact, the box's ERG), then the transaction, checked in full.
   */
  async function prepareToken(tok: ReserveToken, want: bigint, tip: number) {
    if (!me) return;
    if (served.k !== "yes") return fail({ text: served.k === "contract" ? t("mw.dn.contractB") : t("mw.dn.notServedB", { sym: tok.symbol }) });
    setPhase({ k: "working", step: "precheck" });
    const g = await t1GateOf(me.pub, { priority: "user" }, net(), tok.id);
    if (!g.ok) return fail({ problem: g.problem });
    R.t1Gate(me.pub, denom).put(g.value);
    if (g.value.k !== "none") return fail({ text: t(T1_REFUSED[g.value.k]) });
    if (await vault.journal.activeT1(me.pub, denom)) return fail({ text: t("mw.res.hasT1") });
    const mem = await net().mempool(me.address, { priority: "user" });
    if (!mem.ok) return fail({ problem: mem.problem });
    if (mempoolCreatesReserve(mem.value, me, denom)) return fail({ text: t("mw.res.inMempool") });
    const fresh = await net().unspent(me.address, me.tree, { priority: "user" });
    if (!fresh.ok) return fail({ problem: fresh.problem });
    const usable = spendable(fresh.value.boxes, inFlightOf(entries, me.pub), mem.value);
    let fee = MINER_FEE_NANOERG;
    const shortText = (p: { why: string; need: bigint; have: bigint }) => p.why === "short-tokens"
      ? t("mw.dn.shortTokens", { need: amtText(p.need, denom), have: amtText(p.have, denom) })
      : t("mw.dn.shortErg", { need: ergText(p.need), have: ergText(p.have) });
    let p = planTokenT1(usable, me.pub, tok, want, fee, cap);
    if (!p.ok) {
      if (p.why === "too-many-boxes") return offerCombine(usable);
      if (p.why === "amount") return fail({ text: t("mw.res.amountRange", { min: amtText(p.min, denom), max: amtText(p.max, denom) }) });
      return fail({ text: shortText(p) });
    }
    setPhase({ k: "working", step: "template" });
    for (let round = 0; round < 2; round++) {
      const a = await net().createReserve(tokenT1CreateBody(p.plan, me.pub), { priority: "user" });
      if (!a.ok) return fail({ problem: a.problem });
      let payload;
      try { payload = parseReservePayload(a.value); } catch (e) {
        if (e instanceof TrackerRefusal) return fail({ problem: localProblem("refused", e.reason) });
        return fail({ text: t("mw.res.templateBad"), rule: e instanceof ShapeError || e instanceof JsonSyntaxError ? e.message : undefined });
      }
      const c = checkTokenReservePayload(payload, { owner: me.pub, token: tok, amount: p.plan.amount, ergValue: p.plan.ergValue, nftId: p.plan.nftId });
      if (!c.ok) return fail({ text: t("mw.res.templateBad"), rule: `${c.rule}: ${c.message}` });
      if (payload.fee === fee) break;
      fee = payload.fee;
      const again = planTokenT1(usable, me.pub, tok, want, fee, cap);
      if (!again.ok) return fail({ text: again.why === "short-tokens" || again.why === "short-erg" ? shortText(again) : t("mw.res.templateBad"), rule: again.ok ? undefined : again.why });
      const same = again.plan.amount === p.plan.amount && again.plan.nftId === p.plan.nftId && again.plan.ergValue === p.plan.ergValue;
      p = again;
      if (same) break;
      if (round === 1) return fail({ text: t("mw.res.templateBad"), rule: "fee" });
    }
    setPhase({ k: "working", step: "build" });
    const tx = buildTokenReserveCreation({ owner: me.pub, inputs: p.plan.inputs, token: tok, amount: p.plan.amount, ergValue: p.plan.ergValue, fee, height: tip });
    const c = checkTokenReserveCreation(tx, p.plan.inputs, { owner: me.pub, token: tok, amount: p.plan.amount, ergValue: p.plan.ergValue, fee, height: tip, cap });
    if (!c.ok) return fail({ text: t("mw.res.checkFailed"), rule: `${c.rule}: ${c.message}` });
    setPhase({ k: "treview", plan: p.plan, fee, tx, txId: computeTxId(tx), tip });
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
    if ((phase.k !== "review" && phase.k !== "treview") || !me || !pass) return;
    const review = phase;
    const { plan, fee, tx, tip } = phase;
    setPhase({ k: "working", step: "sign" });
    setPassWrong(false);
    try {
      const reserveBox = outputBoxes(tx)[0].boxId;
      // a token T1's meta names its denomination and the box's ERG (absent for ERG: those entries are what they were)
      const meta: Record<string, JournalMetaValue> = review.k === "treview"
        ? { amount: plan.amount.toString(), fee: fee.toString(), nftId: plan.nftId, reserveBox, denom, erg: review.plan.ergValue.toString() }
        : { amount: plan.amount.toString(), fee: fee.toString(), nftId: plan.nftId, reserveBox };
      const r = await signAndSend(vault, "t1", tx, plan.inputs, meta, tip, pass, review.k === "treview" ? denom : undefined);
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
  // what the token T1 gives back to the key, read from the transaction as built (every token, not only the reserve's)
  const back = phase.k === "treview" && me ? backToKey(phase.tx, me.pub) : { erg: 0n, tokens: [] };
  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.res.h")}</h1>
            <p className="t-lede">{token ? t("mw.dn.lede", { sym: token.symbol }) : t("mw.res.lede")}</p>
            <DenomSwitch value={denom} onChange={(d) => { setDenom(d); setPhase({ k: "idle" }); setPass(""); setBig(false); }} disabled={busy || phase.k === "review" || phase.k === "treview"} />
          </header>
          {reserve && !t1 && <ReserveCard r={reserve} />}
          {unproven && !t1 && <UnprovenReserve rs={unproven} denom={denom} />}
          {unchecked && !t1 && (
            <Callout tone="calm" title={t("mw.res.uncheckedT")}>
              <p>{t("mw.res.uncheckedB")}</p>
              <ul className="mw-facts">{unchecked.map((id) => <li key={id}>{t("mw.res.box")} <ChainLink kind="box" id={id} /></li>)}</ul>
            </Callout>
          )}
          {onChainOnly && !t1 && <Callout tone="calm" title={t("mw.res.chainT")}>{t("mw.res.hasReserveChain")}</Callout>}
          {t1 && <T1Progress entry={t1} denom={denom} />}
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
          {!gateKnown && !t1 && !combineEntry && <p className="t-small mw-dim">{t("mw.top.loading")}</p>}
          {gateKnown && !reserve && !unproven && !unchecked && !onChainOnly && !t1 && !combineEntry && (
            <Gate vault={vault} state={state} unlocked why={t("mw.res.unlockWhy")}>
              <Card title={token ? t("mw.dn.createT", { sym: token.symbol }) : t("mw.res.createT")}>
                {phase.k === "treview" ? (
                  <div className="mw-form">
                    <TxReview tx={phase.tx} inputs={phase.plan.inputs} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
                      rows={[
                        { label: t("mw.res.rowReserve"), value: <Amt raw={phase.plan.amount} denom={denom} /> },
                        { label: t("mw.dn.rowBoxErg"), value: <Erg nano={phase.plan.ergValue} /> },
                        ...(back.erg > 0n || back.tokens.length > 0 ? [{ label: t("mw.res.rowChange"), value: <span><Erg nano={back.erg} /><TokensAfter tokens={back.tokens} /></span> }] : []),
                        { label: t("mw.res.rowFee"), value: <Erg nano={phase.fee} /> },
                      ]}
                      sum={{ label: t("mw.res.rowSpent", { n: phase.plan.inputs.length }), value: <span><Erg nano={phase.plan.inputs.reduce((s, b) => s + b.value, 0n)} /><TokensAfter tokens={mergedTokens(phase.plan.inputs)} /></span> }}
                      extra={<p className="t-small">{t("mw.dn.reviewChecks", { sym: phase.plan.token.symbol })}</p>} />
                    <Callout tone="policy">{t("mw.dn.boxErg", { erg: ergText(phase.plan.ergValue), sym: phase.plan.token.symbol })}</Callout>
                    <Callout tone="policy">{t("mw.res.lock")}</Callout>
                    <Field label={t("mw.pay.passAgain")} help={t("mw.res.passWhy")} error={passWrong ? t("mw.pay.passWrong") : undefined}>
                      <TextInput type="password" autoComplete="current-password" value={pass} onChange={(v) => { setPass(v); setPassWrong(false); }} />
                    </Field>
                    <Key variant="primary" hold block disabled={!pass} onAct={() => void sign()}>{t("mw.res.hold")}</Key>
                    <Key variant="quiet" onClick={() => setPhase({ k: "idle" })}>{t("mw.cancel")}</Key>
                  </div>
                ) : phase.k === "review" ? (
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
                    {token && <NotServed served={served} denom={denom} />}
                    <Field label={token ? t("mw.dn.amount", { sym: token.symbol }) : t("mw.res.amount")} help={t("mw.res.amountHelp", { min: amtText(min, denom), max: amtText(cap, denom) })}
                      error={amountText && amountBad ? t("mw.res.amountRange", { min: amtText(min, denom), max: amtText(cap, denom) }) : undefined}>
                      <AmountInput value={amountText} onChange={setAmountText} disabled={busy} unit={denomSymbol(denom)} />
                    </Field>
                    <Switch checked={big} onChange={setBig} label={token ? t("mw.dn.bigT", { max: amtText(token.hardCap, denom) }) : t("mw.res.bigT")} help={token ? t("mw.dn.bigB") : t("mw.res.bigB")} />
                    {token ? (
                      <>
                        <Callout tone="info" title={t("mw.dn.needT")}>
                          <p>{t("mw.dn.needT1", { tokens: amount !== null && !amountBad ? amtText(amount, denom) : amtText(min, denom), erg: ergText(TOKEN_RESERVE_BOX_NANOERG + MINER_FEE_NANOERG), more: ergText(MIN_BOX_NANOERG) })}</p>
                          <p className="t-small mw-dim">{t("mw.dn.needWhy", { erg: ergText(TOKEN_RESERVE_BOX_NANOERG) })}</p>
                        </Callout>
                        <p className="t-small">{t("mw.res.have")} <b>{un.value ? <Amt raw={tokenBalanceOf(spendable(un.value.boxes, inFlightOf(entries, me!.pub)), token.id)} denom={denom} /> : "—"}</b> · <b>{un.value ? <Erg nano={spendable(un.value.boxes, inFlightOf(entries, me!.pub)).reduce((s, b) => s + b.value, 0n)} /> : "—"}</b> · <Link className="textlink" to="/wallet/mainnet/fund">{t("mw.res.fund")}</Link></p>
                      </>
                    ) : (
                      <p className="t-small">{t("mw.res.have")} <b>{un.value ? <Erg nano={spendable(un.value.boxes, inFlightOf(entries, me!.pub)).reduce((s, b) => s + b.value, 0n)} /> : "—"}</b> · <Link className="textlink" to="/wallet/mainnet/fund">{t("mw.res.fund")}</Link></p>
                    )}
                    {phase.k === "error" && (
                      <Callout tone="alarm" title={t("mw.res.stopT")}>
                        {phase.problem ? <ProblemText p={phase.problem} what="create" /> : phase.text}
                        {phase.rule && <span className="mw-reason">{t("mw.rule")} <code>{phase.rule}</code></span>}
                        <span className="mw-reason">{t("mw.nothingSigned")}</span>
                      </Callout>
                    )}
                    <Key variant="primary" block disabled={busy || amountBad || (token !== null && served.k !== "yes")} onClick={() => void guard(prepare)}>
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
              {token && <li>{t("mw.dn.how5", { sym: token.symbol })}</li>}
            </ul>
            <TimeHint k="t1" />
          </Card>
          <Callout tone="calm" title={t("mw.honest.t")}>{t("mw.honest.b")}</Callout>
          {gate.problem && <p className="t-small"><ProblemText p={gate.problem} what="read" /></p>}
        </aside>
      </div>
    </Gate>
  );
}
