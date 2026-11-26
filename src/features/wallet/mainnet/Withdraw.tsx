// /wallet/mainnet/withdraw — free ERG at the key to any P2PK address (design §6.2 "Withdraw"): the address checked
// (format, checksum, mainnet, P2PK, not the key's own; never the reserve contract or the fee tree), the amount, the plan
// (dust goes to the destination, never to the miner; token boxes stay), review, the passphrase again, hold to sign,
// journal, broadcast, depth 2. The reserve itself is not withdrawn here: that is the refund, later.
// SigUSD and rsADA too (?d=): the token in a 0.001 ERG box to the P2PK address, every other token and the rest of this
// one back in the change, checked by checkTokenWithdraw (tx/tokenwithdraw) the same way before the hold.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, Field, Key, TextInput, short } from "@/ui";
import { MINER_FEE_NANOERG, checkTokenWithdraw, checkWithdraw, computeTxId, denomDecimals, denomSymbol, mergedTokens, reserveTokenById, tokenIdOf, type Denomination, type ErgoBox, type Token, type UnsignedTx } from "@/mainnet/tx";
import { checkDestination, ergInput, isBroadcastLimit, maxTokenWithdraw, maxWithdraw, parseErg, parseUnits, planTokenWithdraw, planWithdraw, spendable, tokenWithdrawErgNeed, unitsInput } from "@/mainnet/flows";
import { isVaultError } from "@/mainnet/vault";
import type { Problem } from "@/mainnet/net";
import { useMw } from "./ctx";
import { R, inFlightOf, net, useResource, useUnspent } from "./data";
import { EntryProgress, signAndSend } from "./send";
import { Erg, FlowSteps, Gate, ProblemText, TxReview, ergText, useVaultError } from "./ui";
import { Amt, DenomSwitch, TokensAfter, amtText, entryAmtText, entryDenom, useDenom, useDenomPhase } from "./denom";

type Phase =
  | { k: "edit" }
  | { k: "review"; tx: UnsignedTx; inputs: ErgoBox[]; to: string; sent: bigint; change: bigint; txId: string; tip: number;
      /** a token withdrawal: the ERG in the destination box and the tokens back in the change */ denom: Denomination; ergValue: bigint; changeTokens: Token[] }
  | { k: "working" }
  | { k: "done"; id: string }
  | { k: "error"; text?: string; problem?: Problem; rule?: string; /** signed, sending failed (the trail says «Not sent») */ signed?: true };

export function WithdrawScreen() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const verr = useVaultError();
  const un = useUnspent(me, height, state.backedUp);
  const mem = useResource(me ? R.mempool(me.address) : null, { everyMs: 30_000, enabled: state.backedUp && !!me });
  const [toText, setToText] = useState("");
  const [amountText, setAmountText] = useState("");
  const [pass, setPass] = useState("");
  const [denom, setDenom] = useDenom();
  // ?d= changed under the screen (a link): back to the form, the amount cleared (second review LOW-5)
  const [phase, setPhase] = useDenomPhase<Phase>(denom, { k: "edit" }, () => setAmountText(""));
  const token = denom === "erg" ? null : reserveTokenById(tokenIdOf(denom) ?? "");
  const usable = useMemo(() => (me && un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub), mem.value ?? []) : []), [me, un.value, mem.value, entries]);
  const max = token ? maxTokenWithdraw(usable, token.id) : maxWithdraw(usable);
  const ergAtKey = usable.reduce((s, b) => s + b.value, 0n);
  const dest = toText.trim() ? checkDestination(toText.trim(), me?.address) : null;
  // the brief: any P2PK address (a script address is refused here, whatever it is)
  const destErr = dest && !dest.ok ? dest.reason : dest && dest.ok && !dest.p2pk ? "type" : null;
  const amount = token ? parseUnits(amountText, token.decimals) : parseErg(amountText);
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
    if (token) {
      const q = planTokenWithdraw(boxes, me.pub, toText.trim(), token, amount, MINER_FEE_NANOERG, height);
      if (!q.ok) {
        return setPhase({ k: "error", rule: q.message, text: q.why === "too-many-boxes" ? t("mw.wd.tooMany") : q.why === "amount" ? t("mw.dn.wdMin", { min: amtText(1n, denom) })
          : q.why === "short-tokens" ? t("mw.dn.shortTokens", { need: amtText(q.need, denom), have: amtText(q.have, denom) })
          : q.why === "short-erg" ? t("mw.dn.wdShortErg", { need: ergText(q.need), have: ergText(q.have) }) : t("mw.wd.build") });
      }
      const ct = checkTokenWithdraw(q.tx, q.inputs, { owner: me.pub, to: toText.trim(), token, amount: q.sent, ergValue: q.ergValue, fee: MINER_FEE_NANOERG, height });
      if (!ct.ok) return setPhase({ k: "error", text: t("mw.res.checkFailed"), rule: `${ct.rule}: ${ct.message}` });
      return setPhase({ k: "review", tx: q.tx, inputs: q.inputs, to: toText.trim(), sent: q.sent, change: q.change, txId: computeTxId(q.tx), tip: height, denom, ergValue: q.ergValue, changeTokens: q.changeTokens });
    }
    const p = planWithdraw(boxes, me.pub, toText.trim(), amount, MINER_FEE_NANOERG, height);
    if (!p.ok) return setPhase({ k: "error", text: p.why === "too-many-boxes" ? t("mw.wd.tooMany") : p.why === "dust" ? t("mw.wd.dust") : p.why === "short" ? t("mw.wd.short", { max: ergText(maxWithdraw(boxes)) }) : t("mw.wd.build"), rule: p.message });
    const c = checkWithdraw(p.tx, p.inputs, { owner: me.pub, to: toText.trim(), amount: p.sent, fee: MINER_FEE_NANOERG, height });
    if (!c.ok) return setPhase({ k: "error", text: t("mw.res.checkFailed"), rule: `${c.rule}: ${c.message}` });
    setPhase({ k: "review", tx: p.tx, inputs: p.inputs, to: toText.trim(), sent: p.sent, change: p.change, txId: computeTxId(p.tx), tip: height, denom: "erg", ergValue: p.sent, changeTokens: mergedTokens(p.inputs) });
  }

  async function sign() {
    if (phase.k !== "review" || !me) return;
    const { tx, inputs, to, sent, tip } = phase;
    setPhase({ k: "working" });
    try {
      // ERG: the meta it always had; a token withdrawal names its denomination (Activity and the progress cards read it)
      const r = await signAndSend(vault, "withdraw", tx, inputs, { amount: sent.toString(), to, ...(phase.denom === "erg" ? {} : { denom: phase.denom }) }, tip, pass);
      setPass("");
      setPhase(r.problem ? { k: "error", problem: r.problem, signed: true } : { k: "done", id: r.entry.id });
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
            <p className="t-lede">{token ? t("mw.dn.wdLede", { sym: token.symbol }) : t("mw.wd.lede")}</p>
            <DenomSwitch send value={denom} onChange={(d) => { setDenom(d); setAmountText(""); setPhase({ k: "edit" }); }} disabled={phase.k === "working" || phase.k === "review"} />
            <FlowSteps at={phase.k === "done" || (phase.k === "error" && phase.signed) ? 2 : phase.k === "review" ? 1 : 0} notSent={phase.k === "error" && phase.signed} />
          </header>
          <Gate vault={vault} state={state} unlocked why={t("mw.wd.unlockWhy")}>
            <Card title={token ? t("mw.dn.wdFormT", { sym: token.symbol }) : t("mw.wd.formT")}>
              {phase.k === "done" && current ? (
                <div className="mw-form">
                  <EntryProgress vault={vault} entry={current} tip={height} />
                  <Key onClick={() => { setPhase({ k: "edit" }); setAmountText(""); }}>{t("mw.wd.another")}</Key>
                </div>
              ) : phase.k === "review" ? (
                <div className="mw-form">
                  <TxReview tx={phase.tx} inputs={phase.inputs} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
                    rows={phase.denom === "erg" ? [
                      { label: t("mw.wd.rowTo"), sub: short(phase.to, 6, 6), value: <Erg nano={phase.sent} /> },
                      ...(phase.change > 0n ? [{ label: t("mw.res.rowChange"), value: <Erg nano={phase.change} /> }] : []),
                      { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> },
                    ] : [
                      { label: t("mw.wd.rowTo"), sub: short(phase.to, 6, 6), value: <Amt raw={phase.sent} denom={phase.denom} /> },
                      { label: t("mw.dn.wdRowBox"), sub: t("mw.dn.wdRowBoxSub"), value: <Erg nano={phase.ergValue} /> },
                      ...(phase.change > 0n ? [{ label: t("mw.res.rowChange"), value: <span><Erg nano={phase.change} /><TokensAfter tokens={phase.changeTokens} /></span> }] : []),
                      { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> },
                    ]}
                    sum={{ label: t("mw.res.rowSpent", { n: phase.inputs.length }), value: phase.denom === "erg"
                      ? <Erg nano={phase.inputs.reduce((s, b) => s + b.value, 0n)} />
                      : <span><Erg nano={phase.inputs.reduce((s, b) => s + b.value, 0n)} /><TokensAfter tokens={mergedTokens(phase.inputs)} /></span> }} />
                  {phase.denom !== "erg" && <p className="t-small mw-dim">{t("mw.dn.wdLeaves", { tokens: amtText(phase.sent, phase.denom), erg: ergText(phase.ergValue + MINER_FEE_NANOERG) })}</p>}
                  <div className="mw-dest">
                    <span className="label">{t("mw.wd.destFull")}</span>
                    <code className="mono mw-break">{phase.to}</code>
                    <span className="t-small mw-dim">{t("mw.wd.destCheck")}</span>
                  </div>
                  <Field label={t("mw.pay.passAgain")} help={t("mw.wd.passWhy")}>
                    <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
                  </Field>
                  <Key variant="primary" hold block disabled={!pass} onAct={() => void sign()}>{t("mw.wd.hold", { amount: amtText(phase.sent, phase.denom) })}</Key>
                  <Key variant="quiet" onClick={() => setPhase({ k: "edit" })}>{t("mw.cancel")}</Key>
                </div>
              ) : (
                <div className="mw-form">
                  <Field label={t("mw.wd.to")} help={t("mw.wd.toHelp")} error={destErr ? t(`mw.wd.to.${destErr}`) : undefined}>
                    <TextInput mono value={toText} onChange={setToText} autoComplete="off" placeholder="9…" />
                  </Field>
                  {token ? (
                    <Field label={t("mw.dn.amount", { sym: token.symbol })} help={t("mw.dn.wdAmountHelp", { max: amtText(max, denom), erg: ergText(tokenWithdrawErgNeed()) })} error={amountText && amount === null ? t("mw.dn.amountBad", { sym: token.symbol }) : undefined}>
                      <AmountInput value={amountText} onChange={setAmountText} unit={denomSymbol(denom)} max={max > 0n ? { label: t("mw.wd.max"), onMax: () => setAmountText(unitsInput(max, denomDecimals(denom))) } : undefined} />
                    </Field>
                  ) : (
                    <Field label={t("mw.wd.amount")} help={t("mw.wd.amountHelp", { max: ergText(max), fee: ergText(MINER_FEE_NANOERG) })} error={amountText && amount === null ? t("mw.amount.bad") : undefined}>
                      <AmountInput value={amountText} onChange={setAmountText} max={max > 0n ? { label: t("mw.wd.max"), onMax: () => setAmountText(ergInput(max)) } : undefined} />
                    </Field>
                  )}
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
            <Card key={e.id} title={t("mw.wd.progressT", { amount: entryAmtText(t, amountOfMeta(e.meta.amount), entryDenom(e)) })}>
              <EntryProgress vault={vault} entry={e} tip={height} />
            </Card>
          ))}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.wd.freeT")}>
            <div className="mw-figure"><span className="label">{t("mw.wd.free")}</span><b>{token ? <Amt raw={max} denom={denom} /> : <Erg nano={max} />}</b></div>
            <p className="t-small mw-dim">{token ? t("mw.dn.wdFreeB", { sym: token.symbol, erg: ergText(ergAtKey), need: ergText(tokenWithdrawErgNeed()) }) : t("mw.wd.freeB")}</p>
            {un.problem && <p className="t-small"><ProblemText p={un.problem} what="read" /></p>}
          </Card>
          <Callout tone="calm">{t("mw.wd.reserveNote")}</Callout>
        </aside>
      </div>
    </Gate>
  );
}

const amountOfMeta = (v: unknown): bigint => { try { return BigInt(String(v ?? "0")); } catch { return 0n; } };
