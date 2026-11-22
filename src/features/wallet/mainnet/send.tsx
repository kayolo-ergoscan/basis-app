// Signing and sending a P2PK transaction (T1, Withdraw, Combine): write-ahead, exactly as the vault README asks —
// sign into the journal, markSending, POST the stored bytes to the broadcast route (D1), then follow it. And the
// progress ladder of one journal entry, with "Send again" (the same bytes) when nobody has seen it, and "Cancel" when
// the node refused it and nobody has it (money review P2-1).
import { useState } from "react";
import { useT } from "@/app/lang";
import { Callout, Key, int } from "@/ui";
import { MINER_FEE_NANOERG, checkWithdraw, computeTxId, signP2pkTransaction, type ErgoBox, type UnsignedTx } from "@/mainnet/tx";
import { depthAt, planCancel, spendable, type WithdrawPlan } from "@/mainnet/flows";
import type { JournalEntry, JournalMetaValue, MainnetVault } from "@/mainnet/vault";
import type { Problem } from "@/mainnet/net";
import { useMw } from "./ctx";
import { broadcastEntry, net, resend } from "./data";
import { ChainLink, Erg, ProblemText, Steps, TimeHint, TxReview, useVaultError, type StepItem } from "./ui";

export interface SendResult { entry: JournalEntry; problem: Problem | null }

/** Signs (the key never leaves the vault's callback), records, then broadcasts the recorded bytes. Throws VaultError
 *  (locked, t1-exists, …) or the signer's "broadcast limit" Error before anything is recorded or sent. */
export async function signAndSend(vault: MainnetVault, kind: "t1" | "withdraw", tx: UnsignedTx, inputs: readonly ErgoBox[], meta: Record<string, JournalMetaValue>, height: number, passphrase?: string): Promise<SendResult> {
  const entry = await vault.signToJournal(kind, (sk) => {
    const s = signP2pkTransaction(tx, inputs, sk);
    return { txId: s.txId, signedRaw: s.nodeJson, inputs: inputs.map((b) => b.boxId), meta, height };
  }, passphrase ? { passphrase } : {});
  return send(vault, entry);
}

/** Sends a recorded entry (first time or again): markSending, then the exact stored text. */
export const send = (vault: MainnetVault, entry: JournalEntry): Promise<SendResult> => broadcastEntry(vault, entry);

/** True when "Cancel" is offered: a T1 or Withdraw the node refused, seen in no mempool or block (still "signed" when
 *  the first broadcast was refused, "sent" after an earlier one went through), not cancelled yet (or its cancel failed). */
export function canCancel(e: JournalEntry, entries: readonly JournalEntry[]): boolean {
  if ((e.kind !== "t1" && e.kind !== "withdraw") || (e.state !== "sent" && e.state !== "signed") || e.sendAttempts === 0 || e.meta.nodeRefused !== true) return false;
  const c = typeof e.meta.cancelledBy === "string" ? entries.find((x) => x.id === e.meta.cancelledBy) : undefined;
  return !c || c.state === "failed" || c.state === "abandoned";
}

type CancelPhase =
  | { k: "idle" }
  | { k: "working" }
  | { k: "review"; plan: Extract<WithdrawPlan, { ok: true }>; tip: number; txId: string }
  | { k: "error"; text?: string; problem?: Problem };

/** Spends one input of a refused transaction back to the key's own address: once mined, the stuck one closes. */
function CancelStuck({ vault, entry }: { vault: MainnetVault; entry: JournalEntry }) {
  const t = useT();
  const verr = useVaultError();
  const { me, height } = useMw();
  const [phase, setPhase] = useState<CancelPhase>({ k: "idle" });
  async function prepare() {
    if (!me || height === null) return;
    setPhase({ k: "working" });
    const fresh = await net().unspent(me.address, me.tree, { priority: "user" });
    if (!fresh.ok) return setPhase({ k: "error", problem: fresh.problem });
    const m = await net().mempool(me.address, { priority: "user" });
    if (!m.ok) return setPhase({ k: "error", problem: m.problem });
    if (m.value.some((x) => x.id === entry.txId)) return setPhase({ k: "error", text: t("mw.track.cancelSeen") });
    const p = planCancel(entry.inputs, spendable(fresh.value.boxes, new Set(), m.value), me.pub, me.address, height);
    if (!p.ok) return setPhase({ k: "error", text: t("mw.track.cancelNo") });
    const c = checkWithdraw(p.tx, p.inputs, { owner: me.pub, to: me.address, amount: p.sent, fee: MINER_FEE_NANOERG, height });
    if (!c.ok) return setPhase({ k: "error", text: t("mw.res.checkFailed") });
    setPhase({ k: "review", plan: p, tip: height, txId: computeTxId(p.tx) });
  }
  async function sign() {
    if (phase.k !== "review" || !me) return;
    const { plan, tip } = phase;
    setPhase({ k: "working" });
    try {
      // to the key's own address only: the vault signs it without the passphrase
      const r = await signAndSend(vault, "withdraw", plan.tx, plan.inputs, { amount: plan.sent.toString(), to: me.address, cancel: entry.id }, tip);
      await vault.journal.update(entry.id, { meta: { cancelledBy: r.entry.id } });
      setPhase(r.problem ? { k: "error", problem: r.problem } : { k: "idle" });
    } catch (e) { setPhase({ k: "error", text: verr(e) }); }
  }
  if (phase.k === "review") {
    const { plan, tip, txId } = phase;
    return (
      <div className="mw-form">
        <p className="t-small">{t("mw.track.cancelWhy")}</p>
        <TxReview tx={plan.tx} inputs={plan.inputs} signers={[me!.pub]} height={tip + 1} txId={txId}
          rows={[{ label: t("mw.track.cancelRow"), value: <Erg nano={plan.sent} /> }, ...(plan.change > 0n ? [{ label: t("mw.res.rowChange"), value: <Erg nano={plan.change} /> }] : []), { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> }]} />
        <div className="mw-actions">
          <Key variant="primary" hold onAct={() => void sign()}>{t("mw.track.cancelHold")}</Key>
          <Key variant="quiet" onClick={() => setPhase({ k: "idle" })}>{t("mw.cancel")}</Key>
        </div>
      </div>
    );
  }
  return (
    <div className="mw-form">
      <p className="t-small mw-dim">{t("mw.track.cancelOffer")}</p>
      {phase.k === "error" && <Callout tone="alarm">{phase.problem ? <ProblemText p={phase.problem} what="broadcast" /> : phase.text}</Callout>}
      <div className="mw-actions">
        <Key variant="quiet" disabled={phase.k === "working" || !me || height === null} onClick={() => void prepare()}>{t("mw.track.cancel")}</Key>
      </div>
    </div>
  );
}

/** signed → sent → mempool → depth 1 → depth 2 (→ tracked → active for a T1, given by the caller). */
export function entrySteps(e: JournalEntry, tip: number | null, t: (k: string, v?: Record<string, string | number>) => string, extra: StepItem[] = []): StepItem[] {
  const order = ["signed", "sent", "mempool", "confirmed", "final"] as const;
  const at = e.state === "failed" || e.state === "abandoned" ? -1 : order.indexOf(e.state as (typeof order)[number]);
  const depth = depthAt(e.inclusionHeight, tip);
  const st = (i: number): StepItem["state"] => (at < 0 ? (i === 0 ? "done" : "todo") : at > i ? "done" : at === i ? (i === 4 ? "done" : "now") : "todo");
  const items: StepItem[] = [
    { id: "signed", label: t("mw.track.signed"), state: st(0) },
    { id: "sent", label: t("mw.track.sent"), sub: e.sendAttempts > 1 ? t("mw.track.attempts", { n: e.sendAttempts }) : undefined, state: st(1) },
    { id: "mempool", label: t("mw.track.mempool"), state: st(2) },
    { id: "d1", label: t("mw.track.depth1"), sub: e.inclusionHeight ? t("mw.track.inBlock", { h: int(e.inclusionHeight) }) : undefined, state: st(3) },
    { id: "d2", label: t("mw.track.depth2"), sub: e.state === "confirmed" ? t("mw.track.depthNow", { n: depth }) : undefined, state: e.state === "final" ? "done" : st(4) },
    ...extra,
  ];
  if (e.state === "failed") items.push({ id: "failed", label: t("mw.track.failed"), sub: e.error ?? undefined, state: "fail" });
  if (e.state === "abandoned") items.push({ id: "abandoned", label: t("mw.track.abandoned"), state: "fail" });
  return items;
}

/** One entry's progress, its id on ergoscan.me, and the actions an open entry offers. */
export function EntryProgress({ vault, entry, tip, extra, timeKey }: { vault: MainnetVault; entry: JournalEntry; tip: number | null; extra?: StepItem[]; timeKey?: "t1" | "redeem" }) {
  const t = useT();
  const { entries } = useMw();
  const cancelEntry = typeof entry.meta.cancelledBy === "string" ? entries.find((x) => x.id === entry.meta.cancelledBy) ?? null : null;
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const canResend = (entry.kind === "t1" || entry.kind === "withdraw") && (entry.state === "sent" || entry.state === "signed");
  const again = async () => {
    setBusy(true);
    try {
      setProblem(entry.state === "signed" ? (await send(vault, entry)).problem : await resend(vault, entry));
    } finally { setBusy(false); }
  };
  return (
    <div className="mw-form">
      <Steps label={t("mw.track.aria")} items={entrySteps(entry, tip, t, extra)} />
      {entry.txId && <p className="t-small">{t("mw.track.tx")} <ChainLink kind="tx" id={entry.txId} /></p>}
      {timeKey && entry.state !== "final" && entry.state !== "failed" && <TimeHint k={timeKey} />}
      {entry.error && entry.state !== "failed" && <p className="t-small mw-dim">{t("mw.track.lastError")} <q>{entry.error}</q></p>}
      {problem && <Callout tone="alarm"><ProblemText p={problem} what="broadcast" /></Callout>}
      {canResend && (
        <div className="mw-actions">
          <Key onClick={() => void again()} disabled={busy}>{entry.sendAttempts === 0 ? t("mw.track.sendNow") : t("mw.track.sendAgain")}</Key>
          {entry.state === "signed" && entry.sendAttempts === 0 && <Key variant="quiet" onClick={() => void vault.journal.abandon(entry.id)}>{t("mw.track.discard")}</Key>}
        </div>
      )}
      {canResend && <p className="t-small mw-dim">{t("mw.track.sameBytes")}</p>}
      {cancelEntry && cancelEntry.txId && (entry.state === "sent" || entry.state === "signed") && !canCancel(entry, entries) && (
        <p className="t-small">{t("mw.track.cancelSent")} <ChainLink kind="tx" id={cancelEntry.txId} /></p>
      )}
      {canCancel(entry, entries) && <CancelStuck vault={vault} entry={entry} />}
    </div>
  );
}
