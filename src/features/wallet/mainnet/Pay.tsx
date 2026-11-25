// /wallet/mainnet/pay — issue or raise a note (design §6.2 "Note (pay)"): the receiver (public key or P2PK address),
// the amount to add, the pair's current note from the tracker, checked (this key's signature, our tracker, not older than
// what the tracker took from this browser, not dated ahead) → the new cumulative total, the coverage after it
// (wallet policy: warn when notes exceed the reserve), hold to sign (0.7 s; the passphrase again once the notes signed
// since it was typed promise more than 25 % of the reserve on chain: the vault decides, vault/policy.ts), journal,
// POST /notes, and the receipt (link and QR, data in the URL fragment). Then the tracker commits it: about 5–15
// minutes until the receiver can redeem.
// Token notes (?d=sigusd|rsada, or a request link's d=): the same flow per denomination. The note promises raw units of
// the token, is signed over the token's message, and needs this key's active reserve in that token (the tracker's rule);
// the pair's note is read for that denomination only, and nothing is ever added across denominations.
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, CopyButton, Field, Key, KeySeal, Ledger, Switch, TextInput, int, short } from "@/ui";
import { parseKeyInput, type TrackedReserve } from "@/chain/ours";
import { TRACKER_NFT, denomDecimals, denomSymbol, parseStoredNote, p2pkAddress, tokenIdOf, type Denomination, type StoredNote } from "@/mainnet/tx";
import {
  checkPreviousNote, coverage, laterNoteCovers, noteDenomOf, noteEntryFields, noteTimestamp, pairJournalOf, parseRequest, parseUnits, receiptLink, signNote, storedIsEntry,
  unitsInput, type CheckedPrev, type NoteReceipt, type PrevNoteRule,
} from "@/mainnet/flows";
import { isVaultError, noteScope, type JournalEntry, type JournalMetaValue, type MainnetVault, type NoteIntent } from "@/mainnet/vault";
import { localProblem, type Problem } from "@/mainnet/net";
import { QrCode } from "../lib/qr";
import { useMw } from "./ctx";
import { R, net, ownReserveNow, useResource } from "./data";
import { FlowSteps, Gate, ProblemText, Steps, TimeHint, useVaultError } from "./ui";
import { Amt, DenomSwitch, UNKNOWN_DENOM, amtText, denomQuery, entryDenom, useDenom, useDenomPhase } from "./denom";

/** The receipt of a recorded note, rebuilt from its journal entry. */
export function receiptOf(e: JournalEntry): NoteReceipt | null {
  const m = e.meta;
  if (typeof m.to !== "string" || typeof m.total !== "string" || typeof m.ts !== "string" || typeof m.sig !== "string") return null;
  const denom = entryDenom(e);
  if (denom === UNKNOWN_DENOM) return null; // no receipt for a denomination the wallet does not know
  return { nft: TRACKER_NFT, issuer: e.pub, recipient: m.to, total: BigInt(m.total), timestamp: BigInt(m.ts), signature: m.sig, ...(denom === "erg" ? {} : { denom }) };
}

/** Follows a recorded note at the tracker: pending (a commit carries it) → committed. A note sent without an answer
 *  (still "signed") is followed too: once the pair shows exactly it, it was recorded. */
export function useNoteTracking(vault: MainnetVault, e: JournalEntry | null) {
  const uncertain = !!e && e.state === "signed" && e.sendAttempts > 0;
  const open = !!e && (e.state === "sent" || e.state === "mempool" || e.state === "confirmed" || uncertain);
  const to = e && typeof e.meta.to === "string" ? e.meta.to : null;
  const ed = e ? entryDenom(e) : UNKNOWN_DENOM;
  const pair = useResource(e && to && ed !== UNKNOWN_DENOM ? R.pair(e.pub, to, ed) : null, { everyMs: 120_000, enabled: open });
  useEffect(() => {
    if (!e || !open || !pair.value) return;
    let n;
    try { n = parseStoredNote(pair.value); } catch { return; }
    if (uncertain) {
      if (storedIsEntry(n, e)) void vault.journal.update(e.id, { state: "sent", error: null, meta: { status: "local_only" } });
      return;
    }
    const total = typeof e.meta.total === "string" ? BigInt(e.meta.total) : null;
    if (total === null) return;
    const committed = n.confirmation?.confirmedTotalDebt ?? null;
    if (committed !== null && committed >= total) {
      void vault.journal.update(e.id, { state: "final", meta: { status: "confirmed", height: n.confirmation?.confirmedHeight ?? null } });
    } else if (n.confirmation?.status === "pending" && e.state === "sent") {
      void vault.journal.update(e.id, { state: "mempool", meta: { status: "pending" } });
    }
  }, [vault, e, open, uncertain, pair.value]);
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

/** reserve: the tracker's view; onChain: the value of the key's own reserve read from /v1 (ownReserveNow; the
 *  passphrase rule counts this one). */
type Draft = { to: string; add: bigint; prev: CheckedPrev | null; reserve: TrackedReserve | null; onChain: bigint; debt: bigint; needPass?: boolean; denom: Denomination };

/** What the note promises, as the vault checks it (vault/policy.ts): a token note names its denomination, and its
 *  total and reserve value are that token's raw units. */
const intentOf = (d: Draft): NoteIntent => ({
  recipient: d.to,
  total: (d.prev?.total ?? 0n) + d.add,
  reserveValue: d.onChain,
  prev: d.prev ? { total: d.prev.total, timestamp: d.prev.timestamp, signature: d.prev.signature } : null,
  ...(d.denom === "erg" ? {} : { denomination: d.denom }),
});

/** The journal error of a note a later one replaced (stored as plain text, like the tracker's reasons). */
const SUPERSEDED = "A later note to this receiver replaced it; this one can no longer be recorded.";
/** … when that later note (this key, maybe on another device) promises at least this total: this one is inside it. */
const INCLUDED = "A later note to this receiver already promises this total or more; this payment is included in it.";

/** The pair's stored note: parsed, or null when the pair has none; "bad" when the answer cannot be read. */
function readPair(text: string | null): StoredNote | null | "bad" {
  if (text === null) return null;
  try { return parseStoredNote(text); } catch { return "bad"; }
}
type Phase = { k: "edit" } | { k: "working" } | { k: "review"; d: Draft } | { k: "done"; id: string } | { k: "error"; problem?: Problem; text?: string; id?: string };

export function PayScreen() {
  const t = useT();
  const { vault, state, me, entries } = useMw();
  const verr = useVaultError();
  const loc = useLocation();
  const req = useMemo(() => parseRequest(loc.hash), [loc.hash]);
  // a request link names its denomination (absent: ERG); otherwise the switch
  const [denomParam, setDenom] = useDenom();
  const denom: Denomination = req ? req.denom ?? "erg" : denomParam;
  const token = tokenIdOf(denom);
  const [toText, setToText] = useState(req?.to ?? "");
  const [amountText, setAmountText] = useState(req?.amount ? unitsInput(req.amount, denomDecimals(req.denom ?? "erg")) : "");
  const [pass, setPass] = useState("");
  const [phase, setPhase] = useDenomPhase<Phase>(denom, { k: "edit" }, () => setAmountText(""));
  const res = useResource(me ? R.reservesOf(me.pub) : null, { everyMs: 120_000, enabled: state.backedUp });
  const ks = useResource(me ? R.keyStatus(me.pub) : null, { everyMs: 120_000, enabled: state.backedUp });
  const key = parseKeyInput(toText);
  const add = parseUnits(amountText, denomDecimals(denom));
  const toErr = toText.trim() && !key.ok ? t(`mw.pay.to.${key.reason}`) : key.ok && me && key.key === me.pub ? t("mw.pay.to.self") : null;
  // the key's reserves in this denomination only (an ERG reserve never backs a SigUSD note)
  const inDenom = res.value === null ? null : res.value.filter((r) => r.token === token);
  const reserve = (inDenom ?? [])[0] ?? null;
  // 25.11 (operator): a note can be redeemed only from a Basis wallet holding the receiver's key. A Nautilus or other
  // seed-phrase address looks the same, so unless the receiver came from a Basis payment request or already uses
  // Basis (a reserve or notes of its own at the tracker), the payer confirms it before signing. Per key, not per
  // denomination: a key that uses Basis in ERG can redeem a SigUSD note with the same wallet.
  const toPk = phase.k === "review" ? phase.d.to : key.ok ? key.key : null;
  const fromRequest = !!req && toPk === req.to;
  const toStatus = useResource(toPk && !fromRequest ? R.keyStatus(toPk) : null, { everyMs: 300_000, enabled: state.backedUp });
  const toUsesBasis = fromRequest || (toStatus.value !== null && (toStatus.value.notes > 0 || toStatus.value.denominations.some((x) => x.reserve !== null || x.collateral > 0n)));
  const [basisAck, setBasisAck] = useState(false);
  useEffect(() => setBasisAck(false), [toPk]);
  // notes_require_reserve: the tracker takes notes only from a key with exactly one active reserve under it, in the
  // note's denomination
  const noReserve = inDenom !== null && (inDenom.length !== 1 || inDenom[0].refundHeight > 0);
  const notes = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && e.kind === "note" && noteDenomOf(e) === denom).slice(0, 8) : []), [entries, me, denom]);
  const current = phase.k === "done" ? entries.find((e) => e.id === phase.id) ?? null : null;

  const prevText = (rule: PrevNoteRule) => t(`mw.pay.prev.${rule}`);

  /**
   * The pair's previous note, checked against this key and this browser's journal (keys review P0-1): a note sent
   * earlier without an answer that the tracker now shows is marked recorded; one a later note replaced is closed. Null
   * prev = the pair's first note. Returns a phase to stop at instead when the answer cannot be trusted.
   */
  async function checkedPrev(to: string, stored: StoredNote | null): Promise<{ prev: CheckedPrev | null } | { stop: Phase }> {
    if (!me) return { stop: { k: "edit" } };
    let list = await vault.journal.list({ pub: me.pub, kind: "note" });
    for (const u of pairJournalOf(list, me.pub, to, denom).uncertain) {
      if (stored && storedIsEntry(stored, u)) await vault.journal.update(u.id, { state: "sent", error: null, meta: { status: "local_only" } });
    }
    list = await vault.journal.list({ pub: me.pub, kind: "note" });
    const pj = pairJournalOf(list, me.pub, to, denom);
    const c = checkPreviousNote(stored, { issuer: me.pub, recipient: to, accepted: pj.accepted, serverNowMs: net().clock.now(), denomination: denom });
    if (!c.ok) return { stop: { k: "error", text: prevText(c.rule) } };
    for (const u of pj.uncertain) {
      const f = noteEntryFields(u);
      // the tracker keeps a note only with a later timestamp than the pair's: this one can never be recorded now
      if (f && c.prev && c.prev.timestamp >= f.timestamp) await vault.journal.update(u.id, { state: "failed", error: laterNoteCovers(c.prev, f) ? INCLUDED : SUPERSEDED });
      else return { stop: { k: "error", text: t("mw.pay.uncertain"), id: u.id } };
    }
    return { prev: c.prev };
  }

  async function review() {
    if (!me || !key.ok || add === null || key.key === me.pub) return;
    setPhase({ k: "working" });
    const p = await net().pairNote(me.pub, key.key, { priority: "user", denom });
    if (!p.ok) return setPhase({ k: "error", problem: p.problem });
    const stored = readPair(p.value);
    if (stored === "bad") return setPhase({ k: "error", problem: localProblem("shape") });
    const cp = await checkedPrev(key.key, stored);
    if ("stop" in cp) return setPhase(cp.stop);
    const prev = cp.prev;
    const rs = await net().reservesOf(me.pub, { priority: "user" });
    if (!rs.ok) return setPhase({ k: "error", problem: rs.problem });
    const r = rs.value.filter((x) => x.token === token)[0] ?? null;
    // the passphrase rule counts the value of this key's own reserve on chain (wallet-t3): the box that holds the NFT
    // the wallet trusts (ownReserveNow, an exact lookup), never the tracker's figure nor the listing at the key, which
    // anyone can flood or plant into. No reserve it can prove counts as 0: the passphrase every time. A token
    // reserve counts its tokens (tokens(1) of that box, which ownReserve read as a reserve of exactly this token).
    const own = await ownReserveNow(me.pub, entries, denom);
    if (!own.ok) return setPhase({ k: "error", problem: own.problem });
    const onChain = !own.value.ok ? 0n : token === null ? own.value.box.box.value : own.value.box.box.tokens[1]?.tokenId === token ? own.value.box.box.tokens[1].amount : 0n;
    const ksDebt = ks.value?.denominations.find((x) => x.id === denom)?.debt ?? 0n;
    const debt = r && r.debt > ksDebt ? r.debt : ksDebt;
    setPhase({ k: "review", d: { to: key.key, add, prev, reserve: r, onChain, debt, denom } });
  }

  async function signAndPost(d: Draft, retry = 0): Promise<void> {
    if (!me) return;
    setPhase({ k: "working" });
    const total = (d.prev?.total ?? 0n) + d.add;
    const intent = intentOf(d);
    let entry: JournalEntry;
    let ts: bigint;
    try {
      const cand = Number(noteTimestamp(d.prev?.timestamp ?? null, net().clock.now()));
      ts = BigInt(await vault.journal.claimTimestamp(noteScope(me.pub, d.to), cand));
      entry = await vault.signToJournal("note", (sk): { txId: null; signedRaw: string; inputs: string[]; meta: Record<string, JournalMetaValue> } => {
        if (d.denom !== "erg") {
          const s = signNote(sk, { issuer: me.pub, recipient: d.to, total, timestamp: ts, denomination: d.denom });
          return { txId: null, signedRaw: s.body, inputs: [], meta: { to: d.to, total: total.toString(), added: d.add.toString(), ts: ts.toString(), sig: s.signature, status: "draft", denom: d.denom } };
        }
        const s = signNote(sk, { issuer: me.pub, recipient: d.to, total, timestamp: ts });
        return { txId: null, signedRaw: s.body, inputs: [], meta: { to: d.to, total: total.toString(), added: d.add.toString(), ts: ts.toString(), sig: s.signature, status: "draft" } };
      }, pass ? { note: intent, passphrase: pass } : { note: intent });
    } catch (e) {
      // the vault counts every note since the passphrase was typed: back to the review, with the field
      if (isVaultError(e, "passphrase-required")) return setPhase({ k: "review", d: { ...d, needPass: true } });
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
    // a POST that may have arrived: the pair route tells (the same total, timestamp and signature = it is ours)
    if (pr.kind === "timeout" || pr.kind === "network" || pr.kind === "past-ts") {
      const chk = await net().pairNote(me.pub, d.to, { priority: "user", denom: d.denom });
      const n = chk.ok ? readPair(chk.value) : "bad";
      if (n !== "bad" && n !== null && storedIsEntry(n, entry)) {
        await vault.journal.update(entry.id, { state: "sent", error: null, meta: { status: "local_only" } });
        return setPhase({ k: "done", id: entry.id });
      }
      if (n !== "bad" && pr.kind === "past-ts" && retry === 0) {
        // the pair moved on: sign again on top of its newest note, checked exactly as on review
        await vault.journal.update(entry.id, { state: "failed", error: pr.reason || "Past timestamp" });
        const cp = await checkedPrev(d.to, n);
        if ("stop" in cp) return setPhase(cp.stop);
        if ((cp.prev?.total ?? 0n) !== (d.prev?.total ?? 0n)) return setPhase({ k: "error", text: t("mw.pay.changedMeanwhile") });
        return signAndPost({ ...d, prev: cp.prev }, 1);
      }
    }
    if (pr.kind === "future-ts" && retry === 0) {
      await vault.journal.update(entry.id, { state: "failed", error: pr.reason || "Future timestamp" });
      // take the refused claim back (as builds do), down to the pair's newest known note, so the next one follows the
      // tracker's clock again instead of staying ahead of it
      const known = (await vault.journal.list({ pub: me.pub, kind: "note" })).filter((x) => x.id !== entry.id).map(noteEntryFields)
        .filter((f): f is NonNullable<typeof f> => f !== null && f.to === d.to && f.denom === d.denom).map((f) => Number(f.timestamp));
      await vault.journal.rewindTimestamp(noteScope(me.pub, d.to), Number(ts), Math.max(Number(d.prev?.timestamp ?? 0n), ...known));
      net().clock.reset();
      await net().trackerState({ priority: "user" });
      await net().pendingTx({ priority: "user" });
      return signAndPost(d, 1);
    }
    const definite = pr.kind === "cap" || pr.kind === "conflict" || pr.kind === "refused" || pr.kind === "future-ts" || pr.kind === "past-ts" || pr.kind === "too-large";
    await vault.journal.update(entry.id, definite ? { state: "failed", error: pr.reason || pr.kind } : { error: pr.reason || pr.kind });
    setPhase({ k: "error", problem: pr, id: entry.id });
  }

  /** The same recorded note again: first the pair route (it may be there already, or replaced by a later one). */
  async function postAgain(id: string) {
    const e = await vault.journal.get(id);
    const f = e ? noteEntryFields(e) : null;
    if (!me || !e || !f || e.state !== "signed") return;
    setPhase({ k: "working" });
    const fd = entryDenom(e);
    if (fd === UNKNOWN_DENOM) return setPhase({ k: "error", text: t("mw.dn.unknownAmt"), id: e.id });
    const chk = await net().pairNote(me.pub, f.to, { priority: "user", denom: fd });
    if (!chk.ok) return setPhase({ k: "error", problem: chk.problem, id: e.id });
    const n = readPair(chk.value);
    if (n === "bad") return setPhase({ k: "error", problem: localProblem("shape"), id: e.id });
    if (n !== null && storedIsEntry(n, e)) {
      await vault.journal.update(e.id, { state: "sent", error: null, meta: { status: "local_only" } });
      return setPhase({ k: "done", id: e.id });
    }
    const list = (await vault.journal.list({ pub: me.pub, kind: "note" })).filter((x) => x.id !== e.id);
    const c = checkPreviousNote(n, { issuer: me.pub, recipient: f.to, accepted: pairJournalOf(list, me.pub, f.to, fd).accepted, serverNowMs: net().clock.now(), denomination: fd });
    if (!c.ok) return setPhase({ k: "error", text: prevText(c.rule) });
    if (c.prev && c.prev.timestamp >= f.timestamp) {
      const included = laterNoteCovers(c.prev, f);
      await vault.journal.update(e.id, { state: "failed", error: included ? INCLUDED : SUPERSEDED });
      return setPhase({ k: "error", text: t(included ? "mw.pay.included" : "mw.pay.superseded") });
    }
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
  const cov = d && debtAfter !== null ? coverage(d.onChain, debtAfter) : null;
  let askPass = false;
  if (d) {
    try { askPass = d.needPass === true || vault.notePolicy(intentOf(d)).passphrase; } catch { askPass = true; }
  }
  const failedEntry = phase.k === "error" && phase.id ? entries.find((e) => e.id === phase.id) ?? null : null;

  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.pay.h")}</h1>
            <p className="t-lede">{t("mw.pay.lede")}</p>
            {!req && <DenomSwitch value={denom} onChange={(x) => { setDenom(x); setPhase({ k: "edit" }); setAmountText(""); }} disabled={phase.k === "working" || phase.k === "review"} />}
            <FlowSteps at={phase.k === "done" ? 2 : phase.k === "review" ? 1 : 0} />
          </header>
          {noReserve && (
            <Callout tone="alarm" title={denom === "erg" ? t("mw.pay.noReserveT") : t("mw.dn.payNoReserveT", { sym: denomSymbol(denom) })}>
              <p>{denom === "erg" ? t("mw.pay.noReserveB") : t("mw.dn.payNoReserveB", { sym: denomSymbol(denom) })}</p>
              <Key to={`/wallet/mainnet/reserve${denomQuery(denom)}`} icon="coin">{t("mw.pay.toReserve")}</Key>
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
                    { label: t("mw.pay.rowPrev"), sub: d.prev ? t("mw.pay.prevChecked") : t("mw.pay.prevNone"), value: <Amt raw={d.prev?.total ?? 0n} denom={d.denom} /> },
                    { label: t("mw.pay.rowAdd"), value: <Amt raw={d.add} denom={d.denom} sign="favour" /> },
                  ]} sum={{ label: t("mw.pay.rowTotal"), value: <Amt raw={total!} denom={d.denom} /> }} />
                  {d.denom !== "erg" && <Callout tone="info">{t("mw.dn.payNote", { sym: denomSymbol(d.denom) })}</Callout>}
                  <p className="t-small">{t("mw.pay.cumulative")}</p>
                  {d.onChain > 0n ? (
                    <p className="t-small">{t("mw.pay.cov", { reserve: amtText(d.onChain, d.denom), debt: amtText(debtAfter!, d.denom), pct: cov !== null ? int(cov) : "—" })}</p>
                  ) : null}
                  {debtAfter! > d.onChain && <Callout tone="alarm" title={t("mw.pay.overT")}>{t("mw.pay.overB")}</Callout>}
                  <Callout tone="policy">{t("mw.warn.notes")}</Callout>
                  {!toUsesBasis && (
                    <Callout tone="alarm" title={t("mw.pay.basisT")}>
                      <p>{t("mw.pay.basisB")}</p>
                      <Switch checked={basisAck} onChange={setBasisAck} label={t("mw.pay.basisAck")} />
                    </Callout>
                  )}
                  {askPass && (
                    <Field label={t("mw.pay.passAgain")} help={t("mw.pay.passWhy")}>
                      <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
                    </Field>
                  )}
                  <Key variant="primary" hold="sign" block disabled={(askPass && !pass) || (!toUsesBasis && !basisAck)} onAct={() => void signAndPost(d)}>{t("mw.pay.hold", { amount: amtText(d.add, d.denom) })}</Key>
                  <Key variant="quiet" onClick={() => setPhase({ k: "edit" })}>{t("mw.cancel")}</Key>
                </div>
              ) : (
                <div className="mw-form">
                  {req && <Callout tone="info">{req.denom ? t("mw.dn.fromRequest", { sym: denomSymbol(req.denom) }) : t("mw.pay.fromRequest")}</Callout>}
                  <Field label={t("mw.pay.to")} help={t("mw.pay.toHelp")} error={toErr ?? undefined}>
                    <TextInput mono value={toText} onChange={setToText} placeholder={t("mw.pay.toPh")} autoComplete="off" />
                  </Field>
                  <Field label={denom === "erg" ? t("mw.pay.amount") : t("mw.dn.payAmount", { sym: denomSymbol(denom) })} help={denom === "erg" ? t("mw.pay.amountHelp") : t("mw.dn.payAmountHelp", { sym: denomSymbol(denom) })}
                    error={amountText && add === null ? (denom === "erg" ? t("mw.amount.bad") : t("mw.dn.amountBad", { sym: denomSymbol(denom) })) : undefined}>
                    <AmountInput plus value={amountText} onChange={setAmountText} unit={denomSymbol(denom)} />
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
                    <span className="mw-row-v"><Amt raw={BigInt(String(e.meta.total ?? "0"))} denom={entryDenom(e)} /></span>
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
              <li>{token ? t("mw.dn.payHow4", { sym: denomSymbol(denom) }) : t("mw.pay.how4")}</li>
            </ul>
            <TimeHint k="note" />
          </Card>
          {reserve && (
            <Card title={t("mw.pay.reserveT")}>
              <div className="mw-figs">
                <div className="mw-figure"><span className="label">{t("mw.res.collateral")}</span><b><Amt raw={reserve.collateral} denom={denom} /></b></div>
                <div className="mw-figure"><span className="label">{t("mw.res.debt")}</span><b><Amt raw={reserve.debt} denom={denom} /></b></div>
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
