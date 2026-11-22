// /wallet/mainnet/redeem — a redemption (design §3.2): the note (committed, covers the amount, the issuer's signature
// checked) → no commit pending at the tracker → the signed build request → the tracker's build, kept as raw text →
// both boxes re-read from /v1 → L1 (every byte the receiver depends on) → L2 (the reserve contract, run in this
// browser) → review → hold to sign → the proof spliced into the tracker's own text → journal → submit → the chain
// (depth 2) → the tracker counts it (C8). Payout = amount − miner fee. Nothing is signed before L1 and L2 pass.
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, Field, Key, KeySeal, Ledger, Seg, Tag, blk, short } from "@/ui";
import {
  JsonSyntaxError, ShapeError, TrackerRefusal, checkNoteForRedemption, checkRedemption, checkRedemptionContract, loadContractAvl,
  parseBuildResponse, parseStoredNote, parseSubmitResponse, redemptionSubmitBody, signRedemption, signedBuildRequest,
  type CheckedRedemption, type ChainBoxes, type L2Result, type RedemptionExpectation,
} from "@/mainnet/tx";
import { REDEEM_FEE, REDEEM_MIN, ergPlain, fragmentOf, noteView, parseErg, payoutOf, submitBodyOf, type NoteView } from "@/mainnet/flows";
import { buildScope, isVaultError, type JournalEntry, type MainnetVault } from "@/mainnet/vault";
import { localProblem, type Problem } from "@/mainnet/net";
import { ContractXray } from "@/viz";
import { useMw } from "./ctx";
import { R, net, useResource, useWatchList } from "./data";
import { EntryProgress } from "./send";
import { ChainLink, CopyReport, Erg, Gate, ProblemText, Steps, TimeHint, TxReview, ergText, useVaultError, type StepItem } from "./ui";

type Stage = "note" | "commit" | "request" | "build" | "chain" | "l1" | "l2";
const STAGES: Stage[] = ["note", "commit", "request", "build", "chain", "l1", "l2"];

type Phase =
  | { k: "idle" }
  | { k: "working"; at: Stage }
  | { k: "commit-pending"; tx: string | null }
  | { k: "waiting-chain"; txId: string | null }
  | { k: "stop"; at: Stage; problem?: Problem; text?: string; rule?: string; report?: string; l2?: L2Result }
  | { k: "review"; l1: CheckedRedemption; chain: ChainBoxes; l2: L2Result; tip: number; build: string }
  | { k: "sending" }
  | { k: "sent"; id: string; warn?: string };

/** The submit body of a recorded redemption: the exact stored texts and the four plain fields. */
export function submitOfEntry(e: JournalEntry): string | null {
  const m = e.meta;
  if (!e.unsignedRaw || typeof m.issuer !== "string" || typeof m.amount !== "string" || typeof m.newRedeemed !== "string") return null;
  return submitBodyOf({ signedRaw: e.signedRaw, unsignedRaw: e.unsignedRaw, issuer: m.issuer, recipient: e.pub, amount: BigInt(m.amount), newRedeemed: BigInt(m.newRedeemed) });
}

/** POST /redemption/submit with the recorded body (markSending first). */
export async function submitEntry(vault: MainnetVault, e: JournalEntry): Promise<{ problem: Problem | null; warn?: string }> {
  const body = submitOfEntry(e);
  if (!body) return { problem: localProblem("shape", "this journal entry cannot be submitted again") };
  await vault.journal.markSending(e.id);
  const r = await net().submit(body);
  if (r.ok) {
    let warn: string | undefined;
    try { if (parseSubmitResponse(r.value).txId !== e.txId) warn = "id"; } catch { warn = "shape"; }
    await vault.journal.update(e.id, { state: e.state === "signed" ? "sent" : e.state, error: null });
    return { problem: null, warn };
  }
  const p = r.problem;
  const definite = p.kind === "replaced" || p.kind === "refused" || p.kind === "conflict" || p.kind === "not-found" || p.kind === "too-large";
  await vault.journal.update(e.id, definite ? { state: "failed", error: p.reason || p.kind } : { error: p.reason || p.kind });
  return { problem: p };
}

function RedeemProgress({ e }: { e: JournalEntry }) {
  const t = useT();
  const { vault, height } = useMw();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const issuer = typeof e.meta.issuer === "string" ? e.meta.issuer : null;
  const want = typeof e.meta.newRedeemed === "string" ? BigInt(e.meta.newRedeemed) : null;
  const pair = useResource(issuer ? R.pair(issuer, e.pub) : null, { everyMs: 60_000, enabled: e.state === "final" });
  let synced = false;
  if (pair.value && want !== null) { try { synced = parseStoredNote(pair.value).amountRedeemed >= want; } catch { /* not yet */ } }
  const extra: StepItem[] = [{ id: "synced", label: t("mw.red.synced"), sub: e.state === "final" && !synced ? t("mw.red.syncedWait") : undefined, state: synced ? "done" : e.state === "final" ? "now" : "todo" }];
  const again = async () => {
    setBusy(true);
    try { setProblem((await submitEntry(vault, e)).problem); } finally { setBusy(false); }
  };
  return (
    <div className="mw-form">
      <EntryProgress vault={vault} entry={e} tip={height} extra={extra} timeKey="redeem" />
      {e.state === "signed" && (
        <div className="mw-actions">
          <Key onClick={() => void again()} disabled={busy}>{e.sendAttempts === 0 ? t("mw.red.submitNow") : t("mw.red.submitAgain")}</Key>
          {e.sendAttempts === 0 && <Key variant="quiet" onClick={() => void vault.journal.abandon(e.id)}>{t("mw.track.discard")}</Key>}
        </div>
      )}
      {problem && <Callout tone="alarm"><ProblemText p={problem} what="submit" /></Callout>}
    </div>
  );
}

export function RedeemScreen() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const verr = useVaultError();
  const loc = useLocation();
  const [list] = useWatchList(me?.pub ?? null);
  const fromHash = useMemo(() => (fragmentOf(loc.hash).issuer ?? "").toLowerCase(), [loc.hash]);
  const [issuer, setIssuer] = useState<string>(fromHash || list[0]?.pk || "");
  useEffect(() => { if (!issuer && list[0]) setIssuer(list[0].pk); }, [issuer, list]);
  const pair = useResource(me && issuer ? R.pair(issuer, me.pub) : null, { everyMs: 120_000, enabled: !!issuer });
  const [amountText, setAmountText] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const [showXray, setShowXray] = useState(false);

  let view: NoteView | null = null;
  if (pair.value && me) { try { const n = parseStoredNote(pair.value); if (n.recipient === me.pub && n.issuer === issuer) view = noteView(n); } catch { view = null; } }
  useEffect(() => { if (view && !amountText && view.redeemableNow >= REDEEM_MIN) setAmountText(ergPlain(view.redeemableNow)); }, [view?.redeemableNow]); // eslint-disable-line react-hooks/exhaustive-deps
  const amount = parseErg(amountText);
  const open = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && e.kind === "redeem" && (e.state !== "final" || Date.now() - e.updatedAt < 30 * 60_000) && e.state !== "abandoned") : []), [entries, me]);
  const pending = phase.k === "commit-pending";
  const pend = useResource(pending ? R.trackerState() : null, { everyMs: 60_000, enabled: pending });
  useEffect(() => { if (pending && pend.value && !pend.value.pending) setPhase({ k: "idle" }); }, [pending, pend.value]);

  const stop = (at: Stage, p: Omit<Extract<Phase, { k: "stop" }>, "k" | "at">) => setPhase({ k: "stop", at, ...p });

  const guard = (f: () => Promise<void>) => f().catch((e: unknown) => stop("build", { text: t("mw.err.shape"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined }));

  /** Everything up to the review; nothing here signs a transaction. */
  async function prepare(retry = 0) {
    if (!me || amount === null || !issuer) return;
    if (height === null) return stop("note", { text: t("mw.res.noHeight") });
    // 1. the note
    setPhase({ k: "working", at: "note" });
    const p = await net().pairNote(issuer, me.pub, { priority: "user" });
    if (!p.ok) return stop("note", { problem: p.problem });
    if (p.value === null) return stop("note", { text: t("mw.recv.noNote") });
    let expect: RedemptionExpectation;
    try {
      const c = checkNoteForRedemption(parseStoredNote(p.value), { issuer, recipient: me.pub, amount });
      if (!c.ok) return stop("note", { text: t(`mw.red.rule.${c.rule}`), rule: `${c.rule}: ${c.message}` });
      expect = c.expect;
    } catch { return stop("note", { problem: localProblem("shape") }); }
    // 2. no commit in flight (a build now would read a tracker box about to be spent)
    setPhase({ k: "working", at: "commit" });
    const st = await net().trackerState({ priority: "user" });
    if (!st.ok) return stop("commit", { problem: st.problem });
    if (st.value.pending) return setPhase({ k: "commit-pending", tx: st.value.pending.tx });
    const pt = await net().pendingTx({ priority: "user" });
    if (!pt.ok) return stop("commit", { problem: pt.problem });
    if (pt.value.txId) return setPhase({ k: "commit-pending", tx: pt.value.txId });
    // 3. the signed build request (the key signs a request, not a transaction)
    setPhase({ k: "working", at: "request" });
    let body: string;
    try {
      const ts = BigInt(await vault.journal.claimTimestamp(buildScope(me.pub), net().clock.now()));
      body = await vault.withSecret("build-request", (sk) => signedBuildRequest(sk, { issuer, recipient: me.pub, amount, issuerSignature: expect.issuerSignature, requestTimestamp: ts }).body);
    } catch (e) { return stop("request", { text: verr(e) }); }
    // 4. the build, kept as raw text
    setPhase({ k: "working", at: "build" });
    const b = await net().build(body, { priority: "user" });
    if (!b.ok) {
      if (b.problem.kind === "waiting-chain") return setPhase({ k: "waiting-chain", txId: b.problem.txId });
      if (b.problem.kind === "future-ts" && retry === 0) { net().clock.reset(); return prepare(1); }
      return stop("build", { problem: b.problem });
    }
    let build;
    try { build = parseBuildResponse(b.value); } catch (e) {
      if (e instanceof TrackerRefusal) return stop("build", { problem: localProblem("refused", e.reason), report: b.value });
      return stop("build", { text: t("mw.red.buildBad"), rule: e instanceof ShapeError || e instanceof JsonSyntaxError ? e.message : undefined, report: b.value });
    }
    // 5. both boxes from the chain
    setPhase({ k: "working", at: "chain" });
    const rb = await net().box(build.reserveBoxId, { priority: "user" });
    if (!rb.ok) return stop("chain", { problem: rb.problem });
    const tb = await net().box(build.trackerBoxId, { priority: "user" });
    if (!tb.ok) return stop("chain", { problem: tb.problem });
    if (rb.value.spentBy || tb.value.spentBy) return stop("chain", { text: t("mw.red.boxSpent"), report: b.value });
    const chain: ChainBoxes = { inputs: [rb.value.box], dataInputs: [tb.value.box] };
    // 6. L1
    setPhase({ k: "working", at: "l1" });
    const tip = height;
    const l1 = checkRedemption(build, chain, { ...expect, currentTrackerBoxId: st.value.trackerBox ?? undefined, tipHeight: tip });
    if (!l1.ok) return stop("l1", { text: t("mw.red.l1Failed"), rule: `${l1.rule}: ${l1.message}`, report: b.value });
    // 7. L2: the reserve contract itself, at the next block's height
    setPhase({ k: "working", at: "l2" });
    let l2: L2Result;
    try { l2 = checkRedemptionContract(l1, chain, tip + 1, await loadContractAvl()); } catch (e) {
      return stop("l2", { text: t("mw.red.l2Error"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined, report: b.value });
    }
    if (!l2.ok) return stop("l2", { text: t("mw.red.l2Failed"), rule: `${l2.rule ?? "?"}: ${l2.message ?? ""}`, report: b.value, l2 });
    setPhase({ k: "review", l1, chain, l2, tip, build: b.value });
  }

  async function sign() {
    if (phase.k !== "review" || !me) return;
    const { l1, tip } = phase;
    setPhase({ k: "sending" });
    let entry: JournalEntry;
    try {
      entry = await vault.signToJournal("redeem", (sk) => {
        const s = signRedemption(l1, sk);
        const body = redemptionSubmitBody(l1, s);
        const meta = { issuer: l1.expect.issuer, amount: l1.expect.amount.toString(), newRedeemed: l1.build.newAlreadyRedeemed.toString(), payout: l1.payout.toString(), fee: l1.fee.toString(), trackerBox: l1.build.trackerBoxId, reserveBox: l1.build.reserveBoxId };
        const rebuilt = submitBodyOf({ signedRaw: s.signedRaw, unsignedRaw: l1.build.unsignedRaw, issuer: meta.issuer, recipient: l1.expect.recipient, amount: l1.expect.amount, newRedeemed: l1.build.newAlreadyRedeemed });
        if (rebuilt !== body) throw new Error("the submit body cannot be rebuilt from the journal");
        return { txId: s.txId, signedRaw: s.signedRaw, unsignedRaw: l1.build.unsignedRaw, inputs: [l1.build.reserveBoxId], meta, height: tip };
      });
    } catch (e) { return stop("l2", { text: isVaultError(e) ? verr(e) : t("mw.red.signFailed") }); }
    const r = await submitEntry(vault, entry);
    if (r.problem) return stop("build", { problem: r.problem });
    setPhase({ k: "sent", id: entry.id, warn: r.warn });
  }

  const stageItems = (at: Stage, failed: boolean): StepItem[] => STAGES.map((s, i) => ({
    id: s, label: t(`mw.red.stage.${s}`), state: i < STAGES.indexOf(at) ? "done" : i === STAGES.indexOf(at) ? (failed ? "fail" : "now") : "todo",
  }));
  const sentEntry = phase.k === "sent" ? entries.find((e) => e.id === phase.id) ?? null : null;
  const ok = amount !== null && view !== null && amount >= REDEEM_MIN && amount <= view.redeemableNow;

  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.red.h")}</h1>
            <p className="t-lede">{t("mw.red.lede")}</p>
          </header>
          {open.filter((e) => e.id !== (phase.k === "sent" ? phase.id : "")).map((e) => (
            <Card key={e.id} title={t("mw.red.progressT", { amount: ergText(BigInt(String(e.meta.amount ?? "0")), t.lang) })}><RedeemProgress e={e} /></Card>
          ))}
          <Gate vault={vault} state={state} unlocked why={t("mw.red.unlockWhy")}>
            <Card title={t("mw.red.formT")}>
              {phase.k === "sent" && sentEntry ? (
                <div className="mw-form">
                  {phase.warn && <Callout tone="calm">{t("mw.red.idWarn")}</Callout>}
                  <RedeemProgress e={sentEntry} />
                  <Key onClick={() => setPhase({ k: "idle" })}>{t("mw.red.another")}</Key>
                </div>
              ) : phase.k === "review" ? (
                <div className="mw-form">
                  <TxReview tx={phase.l1.build.unsigned} inputs={phase.chain.inputs} dataInputs={phase.chain.dataInputs} signers={[me!.pub]} height={phase.tip + 1} txId={phase.l1.txId}
                    rows={[
                      { label: t("mw.red.rowAmount"), value: <Erg nano={phase.l1.expect.amount} /> },
                      { label: t("mw.red.rowFee"), sub: t("mw.red.rowFeeSub"), value: <Erg nano={phase.l1.fee} sign="owe" /> },
                    ]}
                    sum={{ label: t("mw.red.rowPayout"), value: <Erg nano={phase.l1.payout} tone="up" />, tone: "up" }}
                    extra={(
                      <>
                        <p className="t-small"><Tag tone="ok" glyph="✓">L1</Tag> <Tag tone="ok" glyph="✓">L2</Tag> {t("mw.red.checked", { n: phase.l2.eval?.checks.length ?? 0 })}</p>
                        <p className="t-small mw-dim">{t("mw.red.reserveAfter", { v: ergText(phase.l1.reserveAfter.value, t.lang) })}</p>
                        <button type="button" className="textlink t-small" aria-expanded={showXray} onClick={() => setShowXray(!showXray)}>{showXray ? t("mw.red.hideXray") : t("mw.red.showXray")}</button>
                        {showXray && phase.l2.eval && <ContractXray evaluation={phase.l2.eval} mode="compact" title={t("mw.red.xrayT")} />}
                      </>
                    )} />
                  <Key variant="metal" hold block onAct={() => void sign()}>{t("mw.red.hold", { amount: ergText(phase.l1.payout, t.lang) })}</Key>
                  <Key variant="quiet" onClick={() => setPhase({ k: "idle" })}>{t("mw.cancel")}</Key>
                </div>
              ) : (
                <div className="mw-form">
                  {list.length === 0 && !issuer ? (
                    <Callout tone="info" title={t("mw.red.noIssuersT")}>
                      <p>{t("mw.red.noIssuersB")}</p>
                      <Key to="/wallet/mainnet/receive" icon="request">{t("mw.nav.receive")}</Key>
                    </Callout>
                  ) : (
                    <>
                      {list.length > 1 && (
                        <Seg ariaLabel={t("mw.red.issuerAria")} value={issuer} onChange={(v) => { setIssuer(v); setAmountText(""); setPhase({ k: "idle" }); }}
                          options={list.slice(0, 6).map((w) => ({ value: w.pk, label: w.name ?? short(w.pk, 4, 4) }))} />
                      )}
                      {issuer && (
                        <div className="mw-filecard">
                          <KeySeal pk={issuer} size="sm" />
                          <div>
                            <div className="label">{t("mw.recv.issuer")}</div>
                            <div className="mono t-small mw-break">{issuer}</div>
                            {view && <div className="t-small">{t("mw.red.noteLine", { total: ergText(view.total, t.lang), redeemed: ergText(view.redeemed, t.lang), now: ergText(view.redeemableNow, t.lang) })}</div>}
                          </div>
                        </div>
                      )}
                      {view && view.redeemableNow < REDEEM_MIN && <Callout tone="calm">{view.stage === "committed" ? t("mw.red.nothing") : t(`mw.recv.wait.${view.stage}`)} <TimeHint k="note" /></Callout>}
                      <Field label={t("mw.red.amount")} help={t("mw.red.amountHelp", { min: ergText(REDEEM_MIN, t.lang), fee: ergText(REDEEM_FEE, t.lang) })}
                        error={amountText && (amount === null || (view && (amount > view.redeemableNow || amount < REDEEM_MIN))) ? t("mw.red.amountBad", { min: ergText(REDEEM_MIN, t.lang), max: ergText(view?.redeemableNow ?? 0n, t.lang) }) : undefined}>
                        <AmountInput value={amountText} onChange={setAmountText} max={view ? { label: t("mw.red.all"), onMax: () => setAmountText(ergPlain(view!.redeemableNow)) } : undefined} />
                      </Field>
                      {amount !== null && amount >= REDEEM_MIN && <p className="t-body">{t("mw.red.payout")} <b><Erg nano={payoutOf(amount)} tone="up" /></b> <span className="t-small mw-dim">{t("mw.red.payoutWhy", { fee: ergText(REDEEM_FEE, t.lang) })}</span></p>}
                      {phase.k === "working" && <Steps label={t("mw.red.stepsAria")} items={stageItems(phase.at, false)} />}
                      {phase.k === "commit-pending" && (
                        <Callout tone="calm" title={t("mw.red.commitT")}>
                          {t("mw.red.commitB")} {phase.tx && <ChainLink kind="tx" id={phase.tx} />}
                          <span className="mw-reason">{t("mw.red.commitAuto")}</span>
                        </Callout>
                      )}
                      {phase.k === "waiting-chain" && (
                        <Callout tone="calm" title={t("mw.red.waitT")}>
                          {t("mw.red.waitB")} {phase.txId && <ChainLink kind="tx" id={phase.txId} />}
                          <span className="mw-reason">{t("mw.time.redeem")}</span>
                        </Callout>
                      )}
                      {phase.k === "stop" && (
                        <>
                          <Steps label={t("mw.red.stepsAria")} items={stageItems(phase.at, true)} />
                          <Callout tone="alarm" title={t("mw.red.stopT")}>
                            {phase.problem ? <ProblemText p={phase.problem} what="build" /> : phase.text}
                            {phase.rule && <span className="mw-reason">{t("mw.rule")} <code>{phase.rule}</code></span>}
                            <span className="mw-reason">{t("mw.nothingSigned")}</span>
                            {phase.report && <span className="mw-actions"><CopyReport text={phase.report} label={t("mw.red.copyBuild")} /></span>}
                          </Callout>
                          {phase.l2?.eval && <ContractXray evaluation={phase.l2.eval} focus={phase.l2.rule ? [phase.l2.rule] : undefined} mode="compact" title={t("mw.red.xrayT")} />}
                        </>
                      )}
                      <Key variant="primary" block disabled={!ok || phase.k === "working" || phase.k === "sending" || pending} onClick={() => void guard(() => prepare())}>
                        {phase.k === "working" ? t(`mw.red.stage.${phase.at}`) : phase.k === "sending" ? t("mw.red.sending") : t("mw.red.prepare")}
                      </Key>
                      <p className="t-small mw-dim">{t("mw.red.prepareHint")}</p>
                    </>
                  )}
                </div>
              )}
            </Card>
          </Gate>
          {pair.problem && <p className="t-small"><ProblemText p={pair.problem} what="read" /></p>}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.red.howT")}>
            <ul className="mw-facts">
              <li>{t("mw.red.how1")}</li>
              <li>{t("mw.red.how2")}</li>
              <li>{t("mw.red.how3")}</li>
              <li>{t("mw.red.how4", { fee: ergText(REDEEM_FEE, t.lang) })}</li>
            </ul>
            <TimeHint k="redeem" />
          </Card>
          <Card title={t("mw.red.recentT")}>
            {entries.filter((e) => me && e.pub === me.pub && e.kind === "redeem").slice(0, 5).map((e) => (
              <p key={e.id} className="t-small mw-row-line">
                <span>{t(`mw.state.${e.state}`)}</span> <Erg nano={BigInt(String(e.meta.payout ?? "0"))} /> {e.txId && <ChainLink kind="tx" id={e.txId} />}
                {e.inclusionHeight !== null && <span className="mw-dim"> · {blk(e.inclusionHeight)}</span>}
              </p>
            ))}
            <p className="t-small mw-dim"><Link className="textlink" to="/wallet/mainnet/activity">{t("mw.nav.activity")}</Link></p>
          </Card>
          <Ledger rows={[{ label: t("mw.red.feeL"), value: <Erg nano={REDEEM_FEE} /> }, { label: t("mw.red.minL"), value: <Erg nano={REDEEM_MIN} /> }]} />
        </aside>
      </div>
    </Gate>
  );
}

