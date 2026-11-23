// /wallet/mainnet/refund — taking the key's own reserve back, in the contract's two steps (basis.es actions 2 and 3,
// design §9). Start: an explicit warning first (holders keep redeeming for 43 200 blocks; the tracker refuses new notes;
// a started refund cannot be undone: the contract allows the start once and every other action keeps R7), then R7 = tip
// + 10, the value unchanged, the fee from a box at the key, the passphrase and a hold. Completion: shut until HEIGHT ≥
// R7 + 43 200 (a countdown in blocks and days), then everything less the fee to the key's own address. Both through
// the same pipeline as T1: the reserve fresh from /v1, the mempool, L1, L2, review, journal, broadcast, depth 2.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { Callout, Card, Countdown, Field, Key, Switch, Tag, TextInput, int } from "@/ui";
import { ContractXray } from "@/viz";
import {
  MINER_FEE_NANOERG, REFUND_PERIOD_BLOCKS, checkReserveAction, checkReserveActionContract, computeTxId, loadContractAvl, readReserve, refundClock, reserveAddress,
  type ErgoBox, type L2Result, type ReserveActionKind, type ReserveInfo, type UnsignedTx,
} from "@/mainnet/tx";
import { isBroadcastLimit, mempoolSpending, ownReserve, planRefundComplete, planRefundStart, spendable } from "@/mainnet/flows";
import { RESERVE_ACTION_KINDS, isOpenState, isVaultError, type JournalEntry } from "@/mainnet/vault";
import type { Problem } from "@/mainnet/net";
import { freshHeight, refreshHeight } from "@/app/height";
import { useMw } from "./ctx";
import { R, inFlightOf, net, ownReserveNow, t1NftOf, useResource } from "./data";
import { EntryProgress, send, signReserve, stuckCompletion } from "./send";
import { BackLink, ChainLink, Erg, Gate, OtherBoxesNote, OwnReserveRefusal, ProblemText, TimeHint, TxReview, trustText, useVaultError } from "./ui";

/** A refund start is signed only while its R7 (tip + 10 at the review) is ahead: at most 5 blocks after the review,
 *  and the next block at least 2 below R7 (review 1 item 2, review 2 stale tip). */
const START_LATE_BLOCKS = 5;
const START_R7_MARGIN = 2;

type Kind = Extract<ReserveActionKind, "refund-start" | "refund-end">;
type Phase =
  | { k: "idle"; notice?: string }
  | { k: "working"; step: "reserve" | "mempool" | "plan" | "l2" | "sign" | "send" }
  | { k: "sent"; id: string; problem: Problem | null }
  | { k: "review"; kind: Kind; tx: UnsignedTx; inputs: ErgoBox[]; info: ReserveInfo; txId: string; tip: number; l2: L2Result; r7?: bigint; payout?: bigint; change: bigint; add: bigint }
  | { k: "error"; text?: string; problem?: Problem; rule?: string; tx?: string; l2?: L2Result };

/** The refund's state in words: started at, redeemable until, available from (shared with the Reserve card). */
export function RefundFacts({ r7, tip }: { r7: bigint; tip: number | null }) {
  const t = useT();
  const clock = tip !== null ? refundClock(r7, tip) : null;
  const unlock = r7 + BigInt(REFUND_PERIOD_BLOCKS);
  return (
    <div className="mw-form">
      <div className="mw-figs">
        <div className="mw-figure"><span className="label">{t("mw.ref.startedAt")}</span><b className="num">{int(Number(r7))}</b></div>
        <div className="mw-figure"><span className="label">{t("mw.ref.unlockAt")}</span><b className="num">{int(Number(unlock))}</b></div>
      </div>
      {clock && (clock.open ? (
        <Callout tone="info" title={t("mw.ref.openT")}>{t("mw.ref.openB")}</Callout>
      ) : (
        <div className="mw-countdown">
          <span className="label">{t("mw.ref.left")}</span>
          <Countdown blocks={clock.blocksLeft} toggle={false} />
        </div>
      ))}
      <p className="t-small">{t("mw.ref.holders", { h: int(Number(unlock)) })}</p>
    </div>
  );
}

export function RefundScreen() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const verr = useVaultError();
  const chain = useResource(me ? R.reservesOnChain(me.pub) : null, { height, enabled: state.backedUp });
  const tracked = useResource(me ? R.trackedOf(me.pub) : null, { height, enabled: state.backedUp });
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [understood, setUnderstood] = useState(false);
  const [pass, setPass] = useState("");
  const [passWrong, setPassWrong] = useState(false);
  const [xray, setXray] = useState(false);

  // the key's own reserve by the NFT this wallet trusts (its T1, the tracker), never the chain's newest box (review 2)
  const t1Nft = useMemo(() => (me ? t1NftOf(entries, me.pub) : null), [entries, me]);
  const own = me && chain.value && (tracked.value !== null || !!tracked.problem)
    ? ownReserve({ owner: me.pub, chain: chain.value, t1Nft, tracked: tracked.value ?? null }) : null;
  const box = own?.ok ? own.box.box : null;
  const read = box ? readReserve(box) : null;
  const info = read && read.ok ? read.info : null;
  const clock = info && height !== null ? refundClock(info.refundHeight, height) : null;
  const mine = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && (e.kind === "refund-start" || e.kind === "refund-end")) : []), [entries, me]);
  const open = mine.filter((e) => isOpenState(e.state));
  const done = mine.find((e) => e.kind === "refund-end" && e.state === "final") ?? null;
  // a refused or long-unseen completion does not block a new one: any completion of the box pays this key (review 1, item 3)
  const stuck = open.some((e) => stuckCompletion(e));
  const otherOpen = useMemo(() => (me ? entries.find((e) => e.pub === me.pub && RESERVE_ACTION_KINDS.includes(e.kind) && isOpenState(e.state) && !stuckCompletion(e)) ?? null : null), [entries, me]);
  // while the chain still shows no refund, an open start is shown in the start card itself (not "Active" and a toggle)
  const openStart = info && info.refundHeight === 0n ? open.find((e) => e.kind === "refund-start") ?? null : null;

  const fail = (p: Omit<Extract<Phase, { k: "error" }>, "k">) => setPhase({ k: "error", ...p });
  const guard = (f: () => Promise<void>) => f().catch((e: unknown) => fail({ text: t("mw.err.shape"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined }));

  /** A fresh tip and the reserve fresh from /v1: the trusted one, nobody else spending it. Shared by both steps. */
  async function freshReserve(kind: Kind): Promise<{ ri: ReserveInfo; tip: number } | null> {
    if (!me || !info) return null;
    setPhase({ k: "working", step: "reserve" });
    const tip = freshHeight(await refreshHeight());
    if (tip === null) { fail({ text: t("mw.res.staleTip") }); return null; }
    const o = await ownReserveNow(me.pub, entries);
    if (!o.ok) { fail({ problem: o.problem }); return null; }
    if (!o.value.ok) {
      const w = o.value;
      fail({ text: w.why === "none" ? t("mw.ref.gone") : trustText(t, w) });
      return null;
    }
    if (o.value.nft !== info.nft) { fail({ text: t("mw.res.changed") }); return null; }
    const fresh = await net().reserveByNft(o.value.nft, { priority: "user" });
    if (!fresh.ok) { fail({ problem: fresh.problem }); return null; }
    if (!fresh.value) { fail({ text: t("mw.ref.gone") }); return null; }
    if (fresh.value.height === null) { fail({ text: t("mw.top.unconfirmed") }); return null; }
    const r = readReserve(fresh.value.box);
    if (!r.ok) { fail({ text: t("mw.top.no.shape"), rule: `${r.rule}: ${r.message}` }); return null; }
    if (r.info.owner !== me.pub) { fail({ text: t("mw.ref.notOwner") }); return null; }
    if (r.info.box.creationHeight > tip) { fail({ text: t("mw.res.aheadOfTip") }); return null; }
    if (kind === "refund-start" && r.info.refundHeight !== 0n) { fail({ text: t("mw.ref.already") }); return null; }
    if (kind === "refund-end" && r.info.refundHeight === 0n) { fail({ text: t("mw.ref.notStarted") }); return null; }
    // a stuck completion's box may be spent again (only one completion can be mined, both pay this key)
    if (inFlightOf(entries.filter((e) => !stuckCompletion(e)), me.pub).has(r.info.box.boxId)) { fail({ text: t("mw.top.openEntry") }); return null; }
    setPhase({ k: "working", step: "mempool" });
    const rm = await net().mempool(reserveAddress(), { priority: "user" });
    if (!rm.ok) { fail({ problem: rm.problem }); return null; }
    const pending = mempoolSpending(rm.value, r.info.box.boxId);
    if (pending) { fail({ text: t("mw.top.pending"), tx: pending.id }); return null; }
    return { ri: r.info, tip };
  }

  async function l2Of(kind: Kind, tx: UnsignedTx, inputs: ErgoBox[], tip: number): Promise<L2Result | null> {
    setPhase({ k: "working", step: "l2" });
    let l2: L2Result;
    try { l2 = checkReserveActionContract(tx, inputs, kind, [me!.pub], tip + 1, await loadContractAvl()); } catch (e) {
      fail({ text: t("mw.top.l2Error"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined });
      return null;
    }
    if (!l2.ok) { fail({ text: t("mw.top.l2Failed"), rule: `${l2.rule ?? "?"}: ${l2.message ?? ""}`, l2 }); return null; }
    return l2;
  }

  async function prepareStart() {
    if (!me) return;
    const f = await freshReserve("refund-start");
    if (!f) return;
    const { ri, tip } = f;
    setPhase({ k: "working", step: "plan" });
    const coins = await net().unspent(me.address, me.tree, { priority: "user" });
    if (!coins.ok) return fail({ problem: coins.problem });
    const mm = await net().mempool(me.address, { priority: "user" });
    if (!mm.ok) return fail({ problem: mm.problem });
    const usable = spendable(coins.value.boxes, inFlightOf(entries, me.pub), mm.value);
    const p = planRefundStart(usable, me.pub, ri.box, MINER_FEE_NANOERG, tip);
    if (!p.ok) return fail({ text: p.why === "short" ? t("mw.ref.noFee") : p.why === "too-many-boxes" ? t("mw.top.tooMany") : t("mw.wd.build"), rule: p.why === "build" ? p.message : undefined });
    const inputs = [ri.box, ...p.inputs];
    if (inputs.some((b) => b.creationHeight > tip)) return fail({ text: t("mw.res.aheadOfTip") });
    const l1 = checkReserveAction(p.tx, inputs, { kind: "refund-start", signer: me.pub, height: tip, fee: MINER_FEE_NANOERG, refundHeight: p.refundHeight });
    if (!l1.ok) return fail({ text: t("mw.res.checkFailed"), rule: `${l1.rule}: ${l1.message}` });
    const l2 = await l2Of("refund-start", p.tx, inputs, tip);
    if (!l2) return;
    setPhase({ k: "review", kind: "refund-start", tx: p.tx, inputs: p.inputs, info: ri, txId: computeTxId(p.tx), tip, l2, r7: p.refundHeight, change: p.change, add: p.add });
  }

  async function prepareEnd() {
    if (!me) return;
    const f = await freshReserve("refund-end");
    if (!f) return;
    const { ri, tip } = f;
    setPhase({ k: "working", step: "plan" });
    const p = planRefundComplete(me.pub, ri.box, ri.refundHeight, MINER_FEE_NANOERG, tip);
    if (!p.ok) return fail({ text: p.why === "waiting" ? t("mw.ref.notYet", { blocks: int(p.clock.blocksLeft) }) : p.why === "small" ? t("mw.ref.small") : t("mw.ref.notStarted") });
    const l1 = checkReserveAction(p.tx, [ri.box], { kind: "refund-end", signer: me.pub, height: tip, fee: MINER_FEE_NANOERG });
    if (!l1.ok) return fail({ text: t("mw.res.checkFailed"), rule: `${l1.rule}: ${l1.message}` });
    const l2 = await l2Of("refund-end", p.tx, [ri.box], tip);
    if (!l2) return;
    setPhase({ k: "review", kind: "refund-end", tx: p.tx, inputs: [], info: ri, txId: computeTxId(p.tx), tip, l2, payout: p.payout, change: 0n, add: 0n });
  }

  async function sign() {
    if (phase.k !== "review" || !me || !pass) return;
    const review = phase;
    const { kind, tx, inputs, info: ri, tip } = phase;
    setPhase({ k: "working", step: "sign" });
    setPassWrong(false);
    const back = (notice: string) => { setPass(""); setUnderstood(false); setPhase({ k: "idle", notice }); };
    let entry: JournalEntry;
    try {
      // the review is still the chain's (review 1 item 2, review 2): a fresh tip, the same reserve box, R7 still ahead
      const now = freshHeight(await refreshHeight());
      if (now === null) return fail({ text: t("mw.res.staleTip") });
      if (kind === "refund-start" && (now > tip + START_LATE_BLOCKS || BigInt(now + 1) > review.r7! - BigInt(START_R7_MARGIN))) return back(t("mw.ref.late", { h: int(Number(review.r7!)) }));
      const fresh = await net().reserveByNft(ri.nft, { priority: "user" });
      if (!fresh.ok) return fail({ problem: fresh.problem });
      if (!fresh.value || fresh.value.box.boxId !== ri.box.boxId) return back(t("mw.res.changed"));
      const meta: Record<string, string> = kind === "refund-start"
        ? { amount: "0", reserveBox: ri.box.boxId, nft: ri.nft, r7: review.r7!.toString(), reserveValue: ri.box.value.toString() }
        : { amount: review.payout!.toString(), reserveBox: ri.box.boxId, nft: ri.nft, r7: ri.refundHeight.toString() };
      entry = await signReserve(vault, kind, tx, [ri.box, ...inputs], meta, tip, pass);
    } catch (e) {
      if (isVaultError(e, "wrong-passphrase")) { setPassWrong(true); return setPhase(review); }
      return fail({ text: isBroadcastLimit(e) ? t("mw.top.tooMany") : verr(e) });
    }
    // signed and recorded: the screen follows the entry from here, whatever the send says (review 1, item 1)
    setPass("");
    setUnderstood(false);
    setPhase({ k: "working", step: "send" });
    const r = await send(vault, entry);
    setPhase({ k: "sent", id: entry.id, problem: r.problem });
    chain.refresh();
  }

  const busy = phase.k === "working";
  const errorBox = phase.k === "error" ? (
    <Callout tone="alarm" title={t("mw.res.stopT")}>
      {phase.problem ? <ProblemText p={phase.problem} what="read" /> : phase.text}
      {phase.tx && <> <ChainLink kind="tx" id={phase.tx} /></>}
      {phase.rule && <span className="mw-reason">{t("mw.rule")} <code>{phase.rule}</code></span>}
      <span className="mw-reason">{t("mw.nothingSigned")}</span>
      {phase.l2?.eval && <ContractXray evaluation={phase.l2.eval} focus={phase.l2.rule ? [phase.l2.rule] : undefined} mode="compact" title={t("mw.top.xrayT")} />}
    </Callout>
  ) : phase.k === "sent" && phase.problem ? (
    <Callout tone="alarm" title={t("mw.sent.problemT")}>
      <ProblemText p={phase.problem} what="broadcast" />
      <span className="mw-reason">{t("mw.sent.problemB")}</span>
    </Callout>
  ) : phase.k === "idle" && phase.notice ? <Callout tone="policy">{phase.notice}</Callout> : null;

  const review = phase.k === "review" && (
    <div className="mw-form">
      <TxReview tx={phase.tx} inputs={[phase.info.box, ...phase.inputs]} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
        rows={phase.kind === "refund-start" ? [
          { label: t("mw.ref.rowStays"), sub: t("mw.ref.rowR7", { h: int(Number(phase.r7!)) }), value: <Erg nano={phase.info.box.value + phase.add} /> },
          { label: t("mw.top.nft"), value: <span className="mono t-small mw-break">{phase.info.nft}</span> },
          { label: t("mw.top.rowBox"), value: <ChainLink kind="box" id={phase.info.box.boxId} /> },
          ...(phase.change > 0n ? [{ label: t("mw.res.rowChange"), value: <Erg nano={phase.change} /> }] : []),
          { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> },
        ] : [
          { label: t("mw.ref.rowBack"), sub: t("mw.ref.rowNft"), value: <Erg nano={phase.payout!} /> },
          { label: t("mw.top.nft"), value: <span className="mono t-small mw-break">{phase.info.nft}</span> },
          { label: t("mw.ref.rowFromBox"), value: <ChainLink kind="box" id={phase.info.box.boxId} /> },
          { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> },
        ]}
        sum={{ label: phase.kind === "refund-start" ? t("mw.res.rowSpent", { n: phase.inputs.length }) : t("mw.ref.rowFrom"), value: <Erg nano={phase.kind === "refund-start" ? phase.inputs.reduce((s, b) => s + b.value, 0n) : phase.info.box.value} /> }}
        extra={<>
          <p className="t-small"><Tag tone="ok" glyph="✓">L1</Tag> <Tag tone="ok" glyph="✓">L2</Tag> {t(phase.kind === "refund-end" ? "mw.ref.checkedEnd" : "mw.top.checked", { n: phase.l2.eval?.checks.length ?? 0 })}</p>
          <button type="button" className="textlink t-small" aria-expanded={xray} onClick={() => setXray(!xray)}>{xray ? t("mw.red.hideXray") : t("mw.red.showXray")}</button>
          {xray && phase.l2.eval && <ContractXray evaluation={phase.l2.eval} mode="compact" title={t("mw.top.xrayT")} />}
        </>} />
      {phase.kind === "refund-start" && <Callout tone="alarm" title={t("mw.ref.finalT")}>{t("mw.ref.finalB")}</Callout>}
      <Field label={t("mw.pay.passAgain")} help={t("mw.ref.passWhy")} error={passWrong ? t("mw.pay.passWrong") : undefined}>
        <TextInput type="password" autoComplete="current-password" value={pass} onChange={(v) => { setPass(v); setPassWrong(false); }} />
      </Field>
      <Key variant={phase.kind === "refund-start" ? "danger" : "primary"} hold block disabled={!pass} onAct={() => void sign()}>{phase.kind === "refund-start" ? t("mw.ref.holdStart") : t("mw.ref.holdEnd")}</Key>
      <Key variant="quiet" onClick={() => setPhase({ k: "idle" })}>{t("mw.cancel")}</Key>
    </div>
  );

  let body;
  if (chain.problem && !chain.value) body = <Card title={t("mw.ref.h")}><p className="t-small"><ProblemText p={chain.problem} what="read" /></p></Card>;
  else if (!chain.value || !own) body = <Card title={t("mw.ref.h")}><p className="t-small mw-dim">{t("mw.top.loading")}</p></Card>;
  else if (!own.ok && (own.why === "none" || own.why === "incomplete")) {
    body = (
      <Card title={t("mw.ref.noneT")}>
        <div className="mw-form">
          <p className="t-small">{own.why === "incomplete" ? t("mw.res.chainIncomplete") : done ? t("mw.ref.doneB") : t("mw.ref.noneB")}</p>
          <Key size="sm" to="/wallet/mainnet/reserve">{t("mw.top.toReserve")}</Key>
        </div>
      </Card>
    );
  } else if (!own.ok) {
    body = <OwnReserveRefusal own={own} />;
  } else if (!info) {
    body = <Callout tone="alarm" title={t("mw.top.noT")}>{t("mw.top.no.shape")}{read && !read.ok && <span className="mw-reason">{t("mw.rule")} <code>{read.rule}: {read.message}</code></span>}</Callout>;
  } else if (info.refundHeight === 0n) {
    body = (
      <Gate vault={vault} state={state} unlocked why={t("mw.ref.unlockWhy")}>
        {openStart ? (
          <Card title={t("mw.ref.progStart")}>
            <div className="mw-form">
              <EntryProgress vault={vault} entry={openStart} tip={height} />
              {errorBox}
              <p className="t-small mw-dim">{t("mw.ref.startOpen")}</p>
            </div>
          </Card>
        ) : (
        <Card title={t("mw.ref.startT")} aside={<Tag tone="ok">{t("mw.ref.active")}</Tag>}>
          {phase.k === "review" && phase.kind === "refund-start" ? review : (
            <div className="mw-form">
              <div className="mw-figure"><span className="label">{t("mw.res.collateral")}</span><b><Erg nano={info.box.value} /></b></div>
              <Callout tone="alarm" title={t("mw.ref.warnT")}>
                <ul className="mw-facts mw-facts-tight">
                  <li>{t("mw.ref.warn1")}</li>
                  <li>{t("mw.ref.warn2")}</li>
                  <li>{t("mw.ref.warn3")}</li>
                  <li>{t("mw.ref.warn4")}</li>
                  <li>{t("mw.ref.warn5")}</li>
                </ul>
              </Callout>
              <Switch checked={understood} onChange={setUnderstood} label={t("mw.ref.understoodT")} help={t("mw.ref.understoodB")} disabled={busy} />
              {errorBox}
              {otherOpen && <p className="t-small mw-dim">{t("mw.top.openEntry")}</p>}
              <Key variant="primary" block disabled={busy || !understood || !!otherOpen} onClick={() => void guard(prepareStart)}>
                {busy ? t(`mw.top.working.${(phase as { step: string }).step}`) : t("mw.ref.prepareStart")}
              </Key>
              <p className="t-small mw-dim">{t("mw.ref.prepareHint")}</p>
            </div>
          )}
        </Card>
        )}
      </Gate>
    );
  } else {
    const run = (
      <Card title={t("mw.ref.runT")} aside={<Tag tone={clock?.open ? "ok" : "metal"}>{clock?.open ? t("mw.ref.tagOpen") : t("mw.ref.tagWaiting")}</Tag>}>
        {phase.k === "review" && phase.kind === "refund-end" ? review : (
          <div className="mw-form">
            <div className="mw-figure"><span className="label">{t("mw.ref.leftIn")}</span><b><Erg nano={info.box.value} /></b></div>
            <RefundFacts r7={info.refundHeight} tip={height} />
            {errorBox}
            {otherOpen && <p className="t-small mw-dim">{t("mw.top.openEntry")}</p>}
            {!otherOpen && stuck && <Callout tone="policy">{t("mw.ref.stuck")}</Callout>}
            <Key variant="primary" block disabled={busy || !clock?.open || !!otherOpen} onClick={() => void guard(prepareEnd)}>
              {busy ? t(`mw.top.working.${(phase as { step: string }).step}`) : t("mw.ref.prepareEnd")}
            </Key>
            <p className="t-small mw-dim">{clock?.open ? t("mw.ref.endHint") : t("mw.ref.endShut", { h: int(Number(info.refundHeight + BigInt(REFUND_PERIOD_BLOCKS))) })}</p>
          </div>
        )}
      </Card>
    );
    // the countdown is for everyone; the key is needed only once the completion can be signed
    body = clock?.open ? <Gate vault={vault} state={state} unlocked why={t("mw.ref.unlockWhy")}>{run}</Gate> : run;
  }

  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <BackLink to="/wallet/mainnet/reserve">{t("mw.nav.reserve")}</BackLink>
            <h1 className="t-h2">{t("mw.ref.h")}</h1>
            <p className="t-lede">{t("mw.ref.lede")}</p>
          </header>
          {open.filter((e) => e.id !== openStart?.id).map((e) => <RefundProgress key={e.id} entry={e} />)}
          {own?.ok && <OtherBoxesNote own={own} />}
          {body}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.res.howT")}>
            <ul className="mw-facts">
              <li>{t("mw.ref.how1")}</li>
              <li>{t("mw.ref.how2")}</li>
              <li>{t("mw.ref.how3")}</li>
              <li>{t("mw.ref.how4")}</li>
            </ul>
            <TimeHint k="refund" />
          </Card>
          <Callout tone="calm" title={t("mw.honest.t")}>{t("mw.honest.b")}</Callout>
        </aside>
      </div>
    </Gate>
  );
}

function RefundProgress({ entry }: { entry: JournalEntry }) {
  const t = useT();
  const { vault, height } = useMw();
  return (
    <Card title={t(entry.kind === "refund-start" ? "mw.ref.progStart" : "mw.ref.progEnd")}>
      <EntryProgress vault={vault} entry={entry} tip={height} />
    </Card>
  );
}
