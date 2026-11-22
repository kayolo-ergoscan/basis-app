// Signing and sending a P2PK transaction (T1, Withdraw, Combine): write-ahead, exactly as the vault README asks —
// sign into the journal, markSending, POST the stored bytes to the broadcast route (D1), then follow it. And the
// progress ladder of one journal entry, with "Send again" (the same bytes) when nobody has seen it.
import { useState } from "react";
import { useT } from "@/app/lang";
import { Callout, Key, blk } from "@/ui";
import { signP2pkTransaction, type ErgoBox, type UnsignedTx } from "@/mainnet/tx";
import { depthAt } from "@/mainnet/flows";
import type { JournalEntry, JournalMetaValue, MainnetVault } from "@/mainnet/vault";
import type { Problem } from "@/mainnet/net";
import { net, resend } from "./data";
import { ChainLink, ProblemText, Steps, TimeHint, type StepItem } from "./ui";

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
export async function send(vault: MainnetVault, entry: JournalEntry): Promise<SendResult> {
  await vault.journal.markSending(entry.id);
  const r = await net().broadcast(entry.signedRaw);
  if (r.ok) {
    const e = await vault.journal.update(entry.id, { state: entry.state === "signed" ? "sent" : entry.state, error: null });
    return { entry: e, problem: null };
  }
  const e = await vault.journal.update(entry.id, { error: r.problem.reason || r.problem.kind });
  return { entry: e, problem: r.problem };
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
    { id: "d1", label: t("mw.track.depth1"), sub: e.inclusionHeight ? t("mw.track.inBlock", { h: blk(e.inclusionHeight) }) : undefined, state: st(3) },
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
    </div>
  );
}
