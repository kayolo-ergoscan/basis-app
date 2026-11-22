// /wallet/mainnet/pay — issue or raise a note (design §6.2 "Note (pay)"): the receiver (public key or P2PK address),
// the amount to add, the pair's current note from the tracker → the new cumulative total, the coverage after it
// (wallet policy: warn when notes exceed the reserve), hold to sign (0.7 s; the passphrase again above 25 % of the
// reserve), journal, POST /notes, and the receipt (link and QR, data in the URL fragment). Then the tracker commits
// it: about 10–25 minutes until the receiver can redeem.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, CopyButton, Field, Key, KeySeal, Ledger, TextInput, short } from "@/ui";
import { parseKeyInput, type TrackedReserve } from "@/chain/ours";
import { TRACKER_NFT, parseStoredNote, p2pkAddress } from "@/mainnet/tx";
import { coverage, ergPlain, needsPassphrase, noteTimestamp, parseErg, parseRequest, receiptLink, signNote, type NoteReceipt } from "@/mainnet/flows";
import { isVaultError, noteScope, type JournalEntry, type MainnetVault } from "@/mainnet/vault";
import { localProblem, type Problem } from "@/mainnet/net";
import { QrCode } from "../lib/qr";
import { useMw } from "./ctx";
import { R, net, useResource } from "./data";
import { Erg, Gate, ProblemText, Steps, TimeHint, ergText, useVaultError } from "./ui";

/** The receipt of a recorded note, rebuilt from its journal entry. */
export function receiptOf(e: JournalEntry): NoteReceipt | null {
  const m = e.meta;
  if (typeof m.to !== "string" || typeof m.total !== "string" || typeof m.ts !== "string" || typeof m.sig !== "string") return null;
  return { nft: TRACKER_NFT, issuer: e.pub, recipient: m.to, total: BigInt(m.total), timestamp: BigInt(m.ts), signature: m.sig };
}

/** Follows a recorded note at the tracker: pending (a commit carries it) → committed. */
export function useNoteTracking(vault: MainnetVault, e: JournalEntry | null) {
  const open = !!e && (e.state === "sent" || e.state === "mempool" || e.state === "confirmed");
  const to = e && typeof e.meta.to === "string" ? e.meta.to : null;
  const pair = useResource(e && to ? R.pair(e.pub, to) : null, { everyMs: 120_000, enabled: open });
  useEffect(() => {
    if (!e || !open || !pair.value) return;
    let n;
    try { n = parseStoredNote(pair.value); } catch { return; }
    const total = typeof e.meta.total === "string" ? BigInt(e.meta.total) : null;
    if (total === null) return;
    const committed = n.confirmation?.confirmedTotalDebt ?? null;
    if (committed !== null && committed >= total) {
      void vault.journal.update(e.id, { state: "final", meta: { status: "confirmed", height: n.confirmation?.confirmedHeight ?? null } });
    } else if (n.confirmation?.status === "pending" && e.state === "sent") {
      void vault.journal.update(e.id, { state: "mempool", meta: { status: "pending" } });
    }
  }, [vault, e, open, pair.value]);
  return pair;
}

/** The receipt: link, QR and copy. */
export function ReceiptCard({ r }: { r: NoteReceipt }) {
  const t = useT();
  const link = receiptLink(location.origin, r);
  return (
    <div className="mw-qr-wrap">
      <div className="mw-qr"><QrCode text={link} size={180} label={t("mw.pay.receiptQr")} /></div>
      <div className="mw-form">
        <div className="label">{t("mw.pay.receiptL")}</div>
        <p className="t-small">{t("mw.pay.receiptB")}</p>
        <div className="mw-actions"><CopyButton value={link} label={t("mw.pay.copyReceipt")} /></div>
        <p className="t-small mw-dim">{t("mw.pay.receiptPrivate")}</p>
      </div>
    </div>
  );
}

function NoteStatus({ e }: { e: JournalEntry }) {
  const t = useT();
  const { vault } = useMw();
  useNoteTracking(vault, e);
  const r = receiptOf(e);
  const steps = [
    { id: "signed", label: t("mw.pay.s.signed"), state: "done" as const },
    { id: "recorded", label: t("mw.pay.s.recorded"), sub: t("mw.pay.s.recordedB"), state: e.state === "signed" ? ("now" as const) : ("done" as const) },
    { id: "pending", label: t("mw.pay.s.pending"), state: e.state === "mempool" ? ("now" as const) : e.state === "final" ? ("done" as const) : ("todo" as const) },
    { id: "committed", label: t("mw.pay.s.committed"), sub: e.state === "final" ? t("mw.pay.s.committedB") : undefined, state: e.state === "final" ? ("done" as const) : e.state === "sent" ? ("now" as const) : ("todo" as const) },
  ];
  if (e.state === "failed") steps.push({ id: "failed", label: t("mw.pay.s.failed"), sub: e.error ?? undefined, state: "fail" as never });
  return (
    <div className="mw-form">
      <Steps label={t("mw.pay.statusAria")} items={steps} />
      {e.state !== "final" && e.state !== "failed" && <TimeHint k="note" />}
      {r && e.state !== "failed" && e.state !== "signed" && <ReceiptCard r={r} />}
    </div>
  );
}

type Draft = { to: string; add: bigint; prev: { total: bigint; redeemed: bigint; timestamp: bigint } | null; reserve: TrackedReserve | null; debt: bigint };
type Phase = { k: "edit" } | { k: "working" } | { k: "review"; d: Draft } | { k: "done"; id: string } | { k: "error"; problem?: Problem; text?: string; id?: string };

export function PayScreen() {
  const t = useT();
  const { vault, state, me, entries } = useMw();
  const verr = useVaultError();
  const loc = useLocation();
  const req = useMemo(() => parseRequest(loc.hash), [loc.hash]);
  const [toText, setToText] = useState(req?.to ?? "");
  const [amountText, setAmountText] = useState(req?.amount ? ergPlain(req.amount) : "");
  const [pass, setPass] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "edit" });
  const res = useResource(me ? R.reservesOf(me.pub) : null, { everyMs: 120_000, enabled: state.backedUp });
  const ks = useResource(me ? R.keyStatus(me.pub) : null, { everyMs: 120_000, enabled: state.backedUp });
  const key = parseKeyInput(toText);
  const add = parseErg(amountText);
  const toErr = toText.trim() && !key.ok ? t(`mw.pay.to.${key.reason}`) : key.ok && me && key.key === me.pub ? t("mw.pay.to.self") : null;
  const reserve = (res.value ?? [])[0] ?? null;
  // notes_require_reserve: the tracker takes notes only from a key with exactly one active reserve under it
  const noReserve = res.value !== null && (res.value.length !== 1 || res.value[0].refundHeight > 0);
  const notes = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && e.kind === "note").slice(0, 8) : []), [entries, me]);
  const current = phase.k === "done" ? entries.find((e) => e.id === phase.id) ?? null : null;

  async function review() {
    if (!me || !key.ok || add === null || key.key === me.pub) return;
    setPhase({ k: "working" });
    const p = await net().pairNote(me.pub, key.key, { priority: "user" });
    if (!p.ok) return setPhase({ k: "error", problem: p.problem });
    let prev: Draft["prev"] = null;
    if (p.value !== null) {
      try {
        const n = parseStoredNote(p.value);
        if (n.issuer !== me.pub || n.recipient !== key.key || n.denomination !== "erg") return setPhase({ k: "error", text: t("mw.pay.pairOther") });
        prev = { total: n.amountCollected, redeemed: n.amountRedeemed, timestamp: n.timestamp };
      } catch { return setPhase({ k: "error", problem: localProblem("shape") }); }
    }
    const rs = await net().reservesOf(me.pub, { priority: "user" });
    if (!rs.ok) return setPhase({ k: "error", problem: rs.problem });
    const r = rs.value[0] ?? null;
    const ksDebt = ks.value?.denominations.find((d) => d.id === "erg")?.debt ?? 0n;
    const debt = r && r.debt > ksDebt ? r.debt : ksDebt;
    setPhase({ k: "review", d: { to: key.key, add, prev, reserve: r, debt } });
  }

  async function signAndPost(d: Draft, retry = 0): Promise<void> {
    if (!me) return;
    setPhase({ k: "working" });
    const total = (d.prev?.total ?? 0n) + d.add;
    const big = needsPassphrase(d.add, d.reserve?.collateral ?? 0n);
    let entry: JournalEntry;
    try {
      const cand = Number(noteTimestamp(d.prev?.timestamp ?? null, net().clock.now()));
      const ts = BigInt(await vault.journal.claimTimestamp(noteScope(me.pub, d.to), cand));
      entry = await vault.signToJournal("note", (sk) => {
        const s = signNote(sk, { issuer: me.pub, recipient: d.to, total, timestamp: ts });
        return { txId: null, signedRaw: s.body, inputs: [], meta: { to: d.to, total: total.toString(), added: d.add.toString(), ts: ts.toString(), sig: s.signature, status: "draft" } };
      }, big ? { passphrase: pass } : {});
    } catch (e) {
      return setPhase({ k: "error", text: isVaultError(e, "wrong-passphrase") ? t("mw.pay.passWrong") : verr(e) });
    }
    await vault.journal.markSending(entry.id);
    const r = await net().postNote(entry.signedRaw, { priority: "user" });
    if (r.ok) {
      await vault.journal.update(entry.id, { state: "sent", meta: { status: "local_only" } });
      setPass("");
      return setPhase({ k: "done", id: entry.id });
    }
    const pr = r.problem;
    // a POST that may have arrived: the pair route tells (the same total and timestamp = it is ours)
    if (pr.kind === "timeout" || pr.kind === "network" || pr.kind === "past-ts") {
      const chk = await net().pairNote(me.pub, d.to, { priority: "user" });
      if (chk.ok && chk.value) {
        try {
          const n = parseStoredNote(chk.value);
          if (n.amountCollected === total && String(n.timestamp) === entry.meta.ts) {
            await vault.journal.update(entry.id, { state: "sent", meta: { status: "local_only" } });
            return setPhase({ k: "done", id: entry.id });
          }
          if (pr.kind === "past-ts" && retry === 0) {
            await vault.journal.update(entry.id, { state: "failed", error: pr.reason || "Past timestamp" });
            if (n.amountCollected !== (d.prev?.total ?? 0n)) return setPhase({ k: "error", text: t("mw.pay.changedMeanwhile") });
            return signAndPost({ ...d, prev: { total: n.amountCollected, redeemed: n.amountRedeemed, timestamp: n.timestamp } }, 1);
          }
        } catch { /* fall through */ }
      }
    }
    if (pr.kind === "future-ts" && retry === 0) {
      await vault.journal.update(entry.id, { state: "failed", error: pr.reason || "Future timestamp" });
      net().clock.reset();
      await net().trackerState({ priority: "user" });
      await net().pendingTx({ priority: "user" });
      return signAndPost(d, 1);
    }
    const definite = pr.kind === "cap" || pr.kind === "conflict" || pr.kind === "refused" || pr.kind === "future-ts" || pr.kind === "past-ts" || pr.kind === "too-large";
    await vault.journal.update(entry.id, definite ? { state: "failed", error: pr.reason || pr.kind } : { error: pr.reason || pr.kind });
    setPhase({ k: "error", problem: pr, id: entry.id });
  }

  async function postAgain(id: string) {
    const e = entries.find((x) => x.id === id);
    if (!e) return;
    setPhase({ k: "working" });
    await vault.journal.markSending(e.id);
    const r = await net().postNote(e.signedRaw, { priority: "user" });
    if (r.ok) {
      await vault.journal.update(e.id, { state: "sent", error: null, meta: { status: "local_only" } });
      return setPhase({ k: "done", id: e.id });
    }
    setPhase({ k: "error", problem: r.problem, id: e.id });
  }

  const d = phase.k === "review" ? phase.d : null;
  const total = d ? (d.prev?.total ?? 0n) + d.add : null;
  const debtAfter = d ? d.debt + d.add : null;
  const cov = d && debtAfter !== null ? coverage(d.reserve?.collateral ?? 0n, debtAfter) : null;
  const askPass = d ? needsPassphrase(d.add, d.reserve?.collateral ?? 0n) : false;
  const failedEntry = phase.k === "error" && phase.id ? entries.find((e) => e.id === phase.id) ?? null : null;

  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.pay.h")}</h1>
            <p className="t-lede">{t("mw.pay.lede")}</p>
          </header>
          {noReserve && (
            <Callout tone="alarm" title={t("mw.pay.noReserveT")}>
              <p>{t("mw.pay.noReserveB")}</p>
              <Key to="/wallet/mainnet/reserve" icon="coin">{t("mw.pay.toReserve")}</Key>
            </Callout>
          )}
          <Gate vault={vault} state={state} unlocked why={t("mw.pay.unlockWhy")}>
            <Card title={phase.k === "done" ? t("mw.pay.doneT") : t("mw.pay.formT")}>
              {phase.k === "done" && current ? (
                <div className="mw-form">
                  <NoteStatus e={current} />
                  <Key onClick={() => { setPhase({ k: "edit" }); setAmountText(""); }}>{t("mw.pay.another")}</Key>
                </div>
              ) : d ? (
                <div className="mw-form">
                  <div className="mw-filecard">
                    <KeySeal pk={d.to} size="sm" />
                    <div><div className="label">{t("mw.pay.toL")}</div><div className="mono t-small mw-break">{p2pkAddress(d.to)}</div></div>
                  </div>
                  <Ledger rows={[
                    { label: t("mw.pay.rowPrev"), value: <Erg nano={d.prev?.total ?? 0n} /> },
                    { label: t("mw.pay.rowAdd"), value: <Erg nano={d.add} sign="favour" /> },
                  ]} sum={{ label: t("mw.pay.rowTotal"), value: <Erg nano={total!} /> }} />
                  <p className="t-small">{t("mw.pay.cumulative")}</p>
                  {d.reserve ? (
                    <p className="t-small">{t("mw.pay.cov", { reserve: ergText(d.reserve.collateral, t.lang), debt: ergText(debtAfter!, t.lang), pct: cov !== null ? cov.toFixed(0) : "—" })}</p>
                  ) : null}
                  {d.reserve && debtAfter! > d.reserve.collateral && <Callout tone="alarm" title={t("mw.pay.overT")}>{t("mw.pay.overB")}</Callout>}
                  <Callout tone="policy">{t("mw.warn.notes")}</Callout>
                  {askPass && (
                    <Field label={t("mw.pay.passAgain")} help={t("mw.pay.passWhy")}>
                      <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
                    </Field>
                  )}
                  <Key variant="primary" hold="sign" block disabled={askPass && !pass} onAct={() => void signAndPost(d)}>{t("mw.pay.hold", { amount: ergText(d.add, t.lang) })}</Key>
                  <Key variant="quiet" onClick={() => setPhase({ k: "edit" })}>{t("mw.cancel")}</Key>
                </div>
              ) : (
                <div className="mw-form">
                  {req && <Callout tone="info">{t("mw.pay.fromRequest")}</Callout>}
                  <Field label={t("mw.pay.to")} help={t("mw.pay.toHelp")} error={toErr ?? undefined}>
                    <TextInput mono value={toText} onChange={setToText} placeholder={t("mw.pay.toPh")} autoComplete="off" />
                  </Field>
                  <Field label={t("mw.pay.amount")} help={t("mw.pay.amountHelp")} error={amountText && add === null ? t("mw.amount.bad") : undefined}>
                    <AmountInput plus value={amountText} onChange={setAmountText} />
                  </Field>
                  {phase.k === "error" && (
                    <Callout tone="alarm" title={t("mw.pay.stopT")}>
                      {phase.problem ? <ProblemText p={phase.problem} what="note" /> : phase.text}
                      {failedEntry && failedEntry.state === "signed" && (
                        <div className="mw-actions"><Key size="sm" onClick={() => void postAgain(failedEntry.id)}>{t("mw.pay.sendAgain")}</Key></div>
                      )}
                    </Callout>
                  )}
                  <Key variant="primary" block disabled={phase.k === "working" || !key.ok || add === null || !!toErr || noReserve} onClick={() => void review()}>
                    {phase.k === "working" ? t("mw.pay.working") : t("mw.pay.review")}
                  </Key>
                </div>
              )}
            </Card>
          </Gate>
          {notes.length > 0 && (
            <Card title={t("mw.pay.yoursT")}>
              <ul className="mw-rows">
                {notes.map((e) => (
                  <li key={e.id} className="mw-row">
                    <KeySeal pk={String(e.meta.to ?? "")} size="sm" />
                    <span className="mono t-small">{short(String(e.meta.to ?? ""), 6, 6)}</span>
                    <span className="mw-row-v"><Erg nano={BigInt(String(e.meta.total ?? "0"))} /></span>
                    <span className="t-small mw-dim">{t(`mw.state.${e.state}`)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.pay.howT")}>
            <ul className="mw-facts">
              <li>{t("mw.warn.notes")}</li>
              <li>{t("mw.pay.how2")}</li>
              <li>{t("mw.pay.how3")}</li>
              <li>{t("mw.pay.how4")}</li>
            </ul>
            <TimeHint k="note" />
          </Card>
          {reserve && (
            <Card title={t("mw.pay.reserveT")}>
              <div className="mw-figs">
                <div className="mw-figure"><span className="label">{t("mw.res.collateral")}</span><b><Erg nano={reserve.collateral} /></b></div>
                <div className="mw-figure"><span className="label">{t("mw.res.debt")}</span><b><Erg nano={reserve.debt} /></b></div>
              </div>
            </Card>
          )}
          <Callout tone="calm" title={t("mw.honest.t")}>{t("mw.honest.b")}</Callout>
        </aside>
      </div>
    </Gate>
  );
}

export { short };
