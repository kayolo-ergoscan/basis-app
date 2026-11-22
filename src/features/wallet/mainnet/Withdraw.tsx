// /wallet/mainnet/withdraw — free ERG at the key to any P2PK address (design §6.2 "Withdraw"): the address checked
// (format, checksum, mainnet, P2PK, not the key's own; never the reserve contract or the fee tree), the amount, the plan
// (dust goes to the destination, never to the miner; token boxes stay), review, the passphrase again, hold to sign,
// journal, broadcast, depth 2. The reserve itself is not withdrawn here: that is the refund, later.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, Field, Key, TextInput, short } from "@/ui";
import { MINER_FEE_NANOERG, checkWithdraw, computeTxId, type UnsignedTx, type ErgoBox } from "@/mainnet/tx";
import { checkDestination, ergPlain, isBroadcastLimit, maxWithdraw, parseErg, planWithdraw, spendable } from "@/mainnet/flows";
import { isVaultError } from "@/mainnet/vault";
import type { Problem } from "@/mainnet/net";
import { useMw } from "./ctx";
import { R, inFlightOf, net, useResource, useUnspent } from "./data";
import { EntryProgress, signAndSend } from "./send";
import { Erg, Gate, ProblemText, TxReview, ergText, useVaultError } from "./ui";

type Phase =
  | { k: "edit" }
  | { k: "review"; tx: UnsignedTx; inputs: ErgoBox[]; to: string; sent: bigint; change: bigint; txId: string; tip: number }
  | { k: "working" }
  | { k: "done"; id: string }
  | { k: "error"; text?: string; problem?: Problem; rule?: string };

export function WithdrawScreen() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const verr = useVaultError();
  const un = useUnspent(me, height, state.backedUp);
  const mem = useResource(me ? R.mempool(me.address) : null, { everyMs: 30_000, enabled: state.backedUp && !!me });
  const [toText, setToText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [pass, setPass] = useState("");
  const [phase, setPhase] = useState<Phase>({ k: "edit" });
  const usable = useMemo(() => (me && un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub), mem.value ?? []) : []), [me, un.value, mem.value, entries]);
  const max = maxWithdraw(usable);
  const dest = toText.trim() ? checkDestination(toText.trim(), me?.address) : null;
  // the brief: any P2PK address (a script address is refused here, whatever it is)
  const destErr = dest && !dest.ok ? dest.reason : dest && dest.ok && !dest.p2pk ? "type" : null;
  const amount = parseErg(amountText);
  const recent = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && e.kind === "withdraw" && e.meta.combine !== true && e.state !== "abandoned").slice(0, 3) : []), [entries, me]);
  const current = phase.k === "done" ? entries.find((e) => e.id === phase.id) ?? null : null;

  const guard = (f: () => Promise<void>) => f().catch((e: unknown) => setPhase({ k: "error", text: t("mw.err.shape"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined }));

  async function review() {
    if (!me || !dest || !dest.ok || destErr || amount === null) return;
    if (height === null) return setPhase({ k: "error", text: t("mw.res.noHeight") });
    setPhase({ k: "working" });
    const fresh = await net().unspent(me.address, me.tree, { priority: "user" });
    if (!fresh.ok) return setPhase({ k: "error", problem: fresh.problem });
    const m = await net().mempool(me.address, { priority: "user" });
    if (!m.ok) return setPhase({ k: "error", problem: m.problem });
    const boxes = spendable(fresh.value.boxes, inFlightOf(entries, me.pub), m.value);
    const p = planWithdraw(boxes, me.pub, toText.trim(), amount, MINER_FEE_NANOERG, height);
    if (!p.ok) return setPhase({ k: "error", text: p.why === "too-many-boxes" ? t("mw.wd.tooMany") : p.why === "dust" ? t("mw.wd.dust") : p.why === "short" ? t("mw.wd.short", { max: ergText(maxWithdraw(boxes)) }) : t("mw.wd.build"), rule: p.message });
    const c = checkWithdraw(p.tx, p.inputs, { owner: me.pub, to: toText.trim(), amount: p.sent, fee: MINER_FEE_NANOERG, height });
    if (!c.ok) return setPhase({ k: "error", text: t("mw.res.checkFailed"), rule: `${c.rule}: ${c.message}` });
    setPhase({ k: "review", tx: p.tx, inputs: p.inputs, to: toText.trim(), sent: p.sent, change: p.change, txId: computeTxId(p.tx), tip: height });
  }

  async function sign() {
    if (phase.k !== "review" || !me) return;
    const { tx, inputs, to, sent, tip } = phase;
    setPhase({ k: "working" });
    try {
      const r = await signAndSend(vault, "withdraw", tx, inputs, { amount: sent.toString(), to }, tip, pass);
      setPass("");
      setPhase(r.problem ? { k: "error", problem: r.problem } : { k: "done", id: r.entry.id });
    } catch (e) {
      setPhase({ k: "error", text: isBroadcastLimit(e) ? t("mw.wd.tooMany") : isVaultError(e, "wrong-passphrase") ? t("mw.pay.passWrong") : verr(e) });
    }
  }

  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.wd.h")}</h1>
            <p className="t-lede">{t("mw.wd.lede")}</p>
          </header>
          <Gate vault={vault} state={state} unlocked why={t("mw.wd.unlockWhy")}>
            <Card title={t("mw.wd.formT")}>
              {phase.k === "done" && current ? (
                <div className="mw-form">
                  <EntryProgress vault={vault} entry={current} tip={height} />
                  <Key onClick={() => { setPhase({ k: "edit" }); setAmountText(""); }}>{t("mw.wd.another")}</Key>
                </div>
              ) : phase.k === "review" ? (
                <div className="mw-form">
                  <TxReview tx={phase.tx} inputs={phase.inputs} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
                    rows={[
                      { label: t("mw.wd.rowTo"), sub: short(phase.to, 6, 6), value: <Erg nano={phase.sent} /> },
                      ...(phase.change > 0n ? [{ label: t("mw.res.rowChange"), value: <Erg nano={phase.change} /> }] : []),
                      { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> },
                    ]}
                    sum={{ label: t("mw.res.rowSpent", { n: phase.inputs.length }), value: <Erg nano={phase.inputs.reduce((s, b) => s + b.value, 0n)} /> }} />
                  <div className="mw-dest">
                    <span className="label">{t("mw.wd.destFull")}</span>
                    <code className="mono mw-break">{phase.to}</code>
                    <span className="t-small mw-dim">{t("mw.wd.destCheck")}</span>
                  </div>
                  <Field label={t("mw.pay.passAgain")} help={t("mw.wd.passWhy")}>
                    <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
                  </Field>
                  <Key variant="primary" hold block disabled={!pass} onAct={() => void sign()}>{t("mw.wd.hold", { amount: ergText(phase.sent) })}</Key>
                  <Key variant="quiet" onClick={() => setPhase({ k: "edit" })}>{t("mw.cancel")}</Key>
                </div>
              ) : (
                <div className="mw-form">
                  <Field label={t("mw.wd.to")} help={t("mw.wd.toHelp")} error={destErr ? t(`mw.wd.to.${destErr}`) : undefined}>
                    <TextInput mono value={toText} onChange={setToText} autoComplete="off" placeholder="9…" />
                  </Field>
                  <Field label={t("mw.wd.amount")} help={t("mw.wd.amountHelp", { max: ergText(max), fee: ergText(MINER_FEE_NANOERG) })} error={amountText && amount === null ? t("mw.amount.bad") : undefined}>
                    <AmountInput value={amountText} onChange={setAmountText} max={max > 0n ? { label: t("mw.wd.max"), onMax: () => setAmountText(ergPlain(max)) } : undefined} />
                  </Field>
                  {phase.k === "error" && (
                    <Callout tone="alarm" title={t("mw.wd.stopT")}>
                      {phase.problem ? <ProblemText p={phase.problem} what="broadcast" /> : phase.text}
                      {phase.rule && <span className="mw-reason">{t("mw.rule")} <code>{phase.rule}</code></span>}
                    </Callout>
                  )}
                  <Key variant="primary" block disabled={phase.k === "working" || !dest?.ok || !!destErr || amount === null || amount <= 0n} onClick={() => void guard(review)}>
                    {phase.k === "working" ? t("mw.wd.working") : t("mw.wd.review")}
                  </Key>
                </div>
              )}
            </Card>
          </Gate>
          {recent.filter((e) => e.id !== (phase.k === "done" ? phase.id : "")).map((e) => (
            <Card key={e.id} title={t("mw.wd.progressT", { amount: ergText(BigInt(String(e.meta.amount ?? "0"))) })}>
              <EntryProgress vault={vault} entry={e} tip={height} />
            </Card>
          ))}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.wd.freeT")}>
            <div className="mw-figure"><span className="label">{t("mw.wd.free")}</span><b><Erg nano={max} /></b></div>
            <p className="t-small mw-dim">{t("mw.wd.freeB")}</p>
            {un.problem && <p className="t-small"><ProblemText p={un.problem} what="read" /></p>}
          </Card>
          <Callout tone="calm">{t("mw.wd.reserveNote")}</Callout>
        </aside>
      </div>
    </Gate>
  );
}
