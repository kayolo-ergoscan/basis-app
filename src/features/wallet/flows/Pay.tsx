// Pay = raise your note (P01–P03, P06, P07, A06, H01, C08): pick who, add an increment, see the new total, the
// recipient's answer in one line (an advisory pre-check; the policy and its check open under it), your coverage, the
// consent sentence, then hold to sign: the hold key stays at the bottom of the window while the form scrolls. The town
// signs with your sandbox key, T-01 witnesses, and the status ladder follows the note to Ergo.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { bytesToHex, evaluateAcceptance, type DenomId } from "@/protocol";
import { AmountInput, Callout, CapBar, CoverageMeter, Field, FlowTrail, GrowthPreview, Icon, Key, KeyField, KeySeal, Lamp, Note, PolicySentence, Seg, Tag, TextInput } from "@/ui";
import { parseAmount, previewPay, RESIDENTS, town, TOWN_TRACKER, useTown, useTownView, YOU, type PayOutcome } from "@/world";
import { StatusLadder, ladderFromEconomy } from "@/viz";
import { useFmt, useNameOf, useOutcomeToast, useRevealOnMount, useWT } from "../lib/hooks";
import { acceptanceCtx, plainAmount, policyCapFor, resolveParty, toNum, unitOf, type Unit } from "../lib/model";
import { passingPath, policyText, traceLines } from "../lib/policyText";
import { Frame, PartySeal } from "../parts/bits";
import { copy, pick } from "@/content";

// ---------------------------------------------------------------------------------------------
// who: contacts first, then the residents, or a pasted key
// ---------------------------------------------------------------------------------------------

export function usePeople() {
  const contacts = useTown((s) => s.contacts);
  const nameOf = useNameOf();
  return useMemo(() => {
    const fav = contacts.filter((c) => c.id !== YOU).sort((a, b) => Number(!!b.favorite) - Number(!!a.favorite));
    const seen = new Set(fav.map((c) => c.id));
    const rest = RESIDENTS.filter((r) => r.id !== "op" && !seen.has(r.id)).map((r) => r.id);
    return { contacts: fav.map((c) => ({ id: c.id, label: c.label || nameOf(c.id), note: c.note, favorite: !!c.favorite })), residents: rest };
  }, [contacts, nameOf]);
}

export function PartyPicker({ onPick, hint }: { onPick: (id: string) => void; hint?: (id: string) => string | null }) {
  const t = useT();
  const wt = useWT();
  const nameOf = useNameOf();
  const people = usePeople();
  const [key, setKey] = useState("");
  const resolveKey = (s: string) => {
    const eco = town.economy;
    const id = eco ? resolveParty(eco, s) : null;
    if (!id || !eco) return null;
    return { name: nameOf(id), pk: eco.p(id).pub, agent: eco.p(id).kind === "agent" };
  };
  const pasted = town.economy ? resolveParty(town.economy, key) : null;
  const item = (id: string, label: string, sub: string | null) => (
    <li key={id}>
      <button type="button" className="row wl-pick" onClick={() => onPick(id)}>
        <PartySeal id={id} />
        <span className="wl-row-mid">
          <span className="who">{label}</span>
          <span className="what">{sub ?? wt(`world.cast.${id}.about`)}</span>
        </span>
        <Icon name="right" size={16} />
      </button>
    </li>
  );
  return (
    <div className="wl-picker">
      {people.contacts.length > 0 && (
        <>
          <h3 className="label">
            <b>{t("wallet.pick.contacts")}</b>
          </h3>
          <ul className="rows wl-pick-l">{people.contacts.map((c) => item(c.id, c.label, hint?.(c.id) ?? c.note ?? null))}</ul>
        </>
      )}
      <h3 className="label">
        <b>{t("wallet.pick.residents")}</b>
      </h3>
      <ul className="rows wl-pick-l">{people.residents.map((id) => item(id, nameOf(id), hint?.(id) ?? null))}</ul>
      <Field label={t("wallet.pick.paste")} help={key && !pasted ? t("wallet.pick.unknown") : t("wallet.pick.pasteHelp")}>
        <KeyField value={key} onChange={setKey} resolve={resolveKey} placeholder="02… / 03…" />
      </Field>
      {pasted && (
        <Key variant="primary" size="sm" onClick={() => onPick(pasted)}>
          {t("wallet.pick.use", { name: nameOf(pasted) })}
        </Key>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// the flow
// ---------------------------------------------------------------------------------------------

interface Done {
  out: PayOutcome;
  to: string;
  denom: DenomId;
}

export function PayFlow({ page }: { page: boolean }) {
  const t = useT();
  const [sp, setSp] = useSearchParams();
  const eco = useTown((s) => s.eco);
  const nameOf = useNameOf();
  const to = eco ? resolveParty(eco, sp.get("to")) : null;
  const badTo = !!sp.get("to") && !to;
  const [done, setDone] = useState<Done | null>(null);
  const pick = (id: string) => {
    const n = new URLSearchParams(sp);
    n.set("to", id);
    setSp(n, { replace: true });
  };
  const title = to ? t("wallet.pay.titleTo", { name: nameOf(to) }) : t("wallet.pay.title");
  return (
    <Frame page={page} title={title} sub={t("wallet.pay.sub")} labelId="wl-pay-h" className="wl-flow">
      <FlowTrail steps={[t("wallet.flow.who"), t("wallet.flow.sign"), t("wallet.flow.signed")]} at={done ? 2 : to && to !== YOU ? 1 : 0} label={t("wallet.flow.aria")} />
      {badTo && (
        <Callout tone="alarm" title={t("wallet.pay.badTo.t")}>
          {t("wallet.pay.badTo.b")}
        </Callout>
      )}
      {done ? (
        <PayDone d={done} onAgain={() => setDone(null)} />
      ) : to && to !== YOU ? (
        <PayForm key={to} to={to} initial={{ amount: sp.get("amount") ?? "", denom: sp.get("denom") ?? "erg", memo: sp.get("memo") ?? "" }} onDone={setDone} />
      ) : (
        <PartyPicker onPick={pick} />
      )}
    </Frame>
  );
}

function PayForm({ to, initial, onDone }: { to: string; initial: { amount: string; denom: string; memo: string }; onDone: (d: Done) => void }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const nav = useNavigate();
  const [, setSp] = useSearchParams();
  const uid = useId();
  const name = nameOf(to);
  const denoms = useTownView((eco) => [...eco.denominations.keys()].map((d) => unitOf(eco, d)), []) ?? [];
  const [denom, setDenom] = useState<DenomId>(denoms.find((d) => d.id === initial.denom)?.id ?? "erg");
  const [amount, setAmount] = useState(initial.amount);
  const [memo, setMemo] = useState(initial.memo.slice(0, 80));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<PayOutcome | null>(null);
  const unit: Unit = denoms.find((d) => d.id === denom) ?? { id: "erg", symbol: "ERG", decimals: 9 };
  const value = amount.trim() ? parseAmount(amount, { id: denom, symbol: unit.symbol, decimals: unit.decimals }) : null;
  const invalid = amount.trim() !== "" && (value === null || value <= 0n);

  const v = useTownView(
    (eco) => {
      const p = previewPay(eco, { to, amount: value ?? 0n, denom });
      if (!p) return null;
      const you = eco.p(YOU);
      const them = eco.p(to);
      const cap = policyCapFor(p.recipientPolicy, you.pub);
      const rec = eco.note(YOU, to, denom, TOWN_TRACKER);
      const settled = rec ? rec.amountRedeemed + rec.waived : 0n;
      const ctx = acceptanceCtx(eco, YOU, to, denom, p.totalAfter);
      const cov = eco.coverage(YOU, denom);
      const res = eco.reservesOf(YOU, denom).find((r) => r.active);
      const covAfter = res && cov.liabilities + (value ?? 0n) > 0n ? Number(res.collateral()) / Number(cov.liabilities + (value ?? 0n)) : null;
      // the pre-check evaluated by the same evaluator the tracker uses, with a real trace (advisory)
      const acc = p.recipientPolicy ? evaluateAcceptance(p.recipientPolicy, ctx, "per-recipient") : null;
      return {
        p,
        theirPub: them.pub,
        theirAgent: them.kind === "agent",
        cap,
        settled,
        ctxCoverage: ctx.reserve && ctx.issuerGrossDebt > 0n ? Number(ctx.reserve.collateral) / Number(ctx.issuerGrossDebt) : null,
        covBefore: res ? cov.ratio : null,
        covAfter,
        hasReserve: !!res,
        acc,
        sig: rec ? rec.history.length : 0,
      };
    },
    [to, denom, value?.toString()],
  );
  useEffect(() => setRefusal(null), [value, denom]);
  if (!v) return null;
  const { p } = v;
  const pol = policyText(p.recipientPolicy, {
    t,
    uid: `pp${uid}`,
    who: (pub) => {
      const id = town.economy?.idOf(pub);
      return id ? { name: nameOf(id), agent: town.economy?.p(id).kind === "agent" } : null;
    },
    cap: (x) => `${f.amt(x, unit)} ${unit.symbol}`,
  });
  const ratioOf = (pred: string) => {
    const x = p.recipientPolicy?.predicates.find((q) => q.name === pred);
    return x && x.type === "collateralization" ? f.pct(x.min_ratio) : null;
  };
  const capOf = (pred: string) => {
    const x = p.recipientPolicy?.predicates.find((q) => q.name === pred);
    return x && x.type === "whitelist" && x.max_debt != null ? f.amt(x.max_debt, unit, { unit: true }) : null;
  };
  // a passing «one of» shows the alternative that passed, not the ones it did not need (a false «✕ You: not listed»)
  const lines = v.acc ? traceLines(passingPath(v.acc.trace), { total: f.amt(p.totalAfter, unit, { unit: true }), capOf, coverage: v.ctxCoverage === null ? null : f.pct(v.ctxCoverage), ratioOf, issuer: nameOf(YOU) }, t) : [];
  const policyOk = !v.acc || v.acc.acceptable;
  const line = p.creditLine;
  const outstandingAfter = p.outstanding + (value ?? 0n);
  const lineOk = line === null || outstandingAfter <= line;
  const blocked = !p.trackerOnline || p.censored;
  const canSign = !!value && value > 0n && !blocked && !busy;
  const headroom = line !== null ? (line > p.outstanding ? line - p.outstanding : 0n) : v.cap !== null ? (v.cap > p.totalBefore ? v.cap - p.totalBefore : 0n) : null;

  const sign = async () => {
    if (!value || value <= 0n) return;
    setBusy(true);
    try {
      const out = await town.pay({ to, amount: value, denom, memo: memo.trim() || undefined });
      if (out.ok) {
        show(out);
        onDone({ out, to, denom });
      } else {
        setRefusal(out);
        show(out);
      }
    } finally {
      setBusy(false);
    }
  };

  // one line: what the recipient's wallet would say. Before an amount it says the most it takes, when it would take
  // your current total; with an amount, yes (and up to what) or why not.
  const accepts = policyOk && lineOk;
  const verdict = blocked ? (
    <div className="wl-verdict no">
      <Lamp state="alarm" size={8} />
      {!p.trackerOnline ? t("wallet.pay.v.offline", { id: TOWN_TRACKER }) : t("wallet.pay.v.censored", { id: TOWN_TRACKER })}
    </div>
  ) : accepts && headroom !== null && headroom > 0n ? (
    <div className="wl-verdict ok">
      <Lamp state="live" size={8} />
      {f.prose(t("wallet.pay.v.upTo", { name, v: f.amt(headroom, unit, { unit: true }) }))}
    </div>
  ) : !value ? null : accepts ? (
    <div className="wl-verdict ok">
      <Lamp state="live" size={8} />
      {t("wallet.pay.v.ok", { name })}
    </div>
  ) : (
    <div className="wl-verdict no">
      <Lamp state="alarm" size={8} />
      {!policyOk ? t("wallet.pay.v.policy", { name }) : f.prose(t("wallet.pay.v.line", { name, v: f.amt(outstandingAfter, unit, { unit: true }), l: f.amt(line ?? 0n, unit, { unit: true }) }))}
    </div>
  );

  return (
    <div className="wl-form">
      <div className="who-line wl-to">
        <KeySeal pk={v.theirPub} agent={v.theirAgent} size="lg" />
        <div className="wl-to-t">
          <div className="t-h4">{name}</div>
          <div className="mono t-small">{wt(`world.cast.${to}.about`)}</div>
        </div>
        <button type="button" className="textlink t-small" onClick={() => setSp(new URLSearchParams(), { replace: true })}>
          {t("wallet.pay.change")}
        </button>
      </div>

      {denoms.length > 1 && <Seg ariaLabel={t("wallet.denom")} value={denom} onChange={(d) => setDenom(d)} options={denoms.map((d) => ({ value: d.id, label: d.symbol }))} />}

      <Field
        label={t("wallet.pay.add")}
        error={invalid ? t("wallet.amount.invalid") : undefined}
        help={headroom !== null ? f.prose(t(line !== null ? "wallet.pay.help.line" : "wallet.pay.help.cap", { name, v: f.amt(headroom, unit, { unit: true }) })) : t("wallet.pay.help.none", { name })}
      >
        <AmountInput value={amount} onChange={setAmount} unit={unit.symbol} plus invalid={invalid} max={headroom !== null && headroom > 0n ? { label: t("wallet.pay.max", { v: f.amt(headroom, unit) }), onMax: () => setAmount(plainAmount(headroom, unit.decimals)) } : undefined} aria-label={t("wallet.pay.add")} />
      </Field>

      <div className="wl-grow">
        <div className="label">{t("wallet.pay.grown", { name })}</div>
        <GrowthPreview from={toNum(p.totalBefore, unit.decimals)} to={toNum(p.totalAfter, unit.decimals)} unit={unit.symbol} dp={f.dpOf(unit)} />
        {(line !== null || v.cap !== null) && (
          <>
            <CapBar limit={toNum(line ?? v.cap ?? 0n, unit.decimals)} amount={toNum(p.totalBefore, unit.decimals)} settled={line !== null ? toNum(v.settled, unit.decimals) : 0} added={toNum(value ?? 0n, unit.decimals)} />
            <div className="spread t-small wl-cap-legend">
              <span>{f.prose(t(line !== null ? "wallet.pay.cap.line" : "wallet.pay.cap.cap", { name, v: f.amt(line ?? v.cap ?? 0n, unit) }))}</span>
              <span>
                <b>{f.prose(f.amt(headroom !== null && value ? (headroom > value ? headroom - value : 0n) : headroom ?? 0n, unit))}</b> {t("wallet.pay.cap.left")}
              </span>
            </div>
          </>
        )}
        {value ? <p className="t-body wl-becomes">{f.prose(t("wallet.pay.becomes", { name, v: f.amt(p.totalAfter, unit, { unit: true }), d: f.amt(value, unit, { sign: "favour" }) }))}</p> : null}
      </div>

      <section className="wl-pol" aria-labelledby={`${uid}-pol`}>
        <div className="spread wl-pol-h">
          <h3 className={verdict ? "sr-only" : "label"} id={`${uid}-pol`}>
            <b>{t("wallet.pay.policy", { name })}</b>
          </h3>
          {verdict}
          <Tag>{t("wallet.pay.advisory")}</Tag>
        </div>
        {/* a refusal opens it: the reasons are in the check */}
        <details className="wl-pol-d" open={!!value && !accepts && !blocked}>
          <summary>{t("wallet.pay.polMore")}</summary>
          <div className="wl-pol-b">
            <span className="label">{t("wallet.pay.policy", { name })}</span>
            <PolicySentence parts={pol.parts} />
            {!!value && lines.length > 0 && (
              <ul className="wl-trace">
                {lines.map((l, i) => (
                  <li key={i} className={l.ok ? "ok" : "no"} style={{ paddingLeft: `${l.depth * 14}px` }}>
                    <span aria-hidden="true">{l.ok ? "✓" : "✕"}</span> {f.prose(l.text)}
                  </li>
                ))}
              </ul>
            )}
            <p className="t-small">{t("wallet.pay.advisoryNote", { id: TOWN_TRACKER })}</p>
          </div>
        </details>
      </section>

      <section className="wl-cov" aria-label={t("wallet.pay.coverage")}>
        {v.hasReserve ? (
          <>
            <div className="spread">
              <span className="label">{t("wallet.pay.coverage")}</span>
              <span className="num wl-cov-v">
                {f.pct(v.covBefore)} <span className="dim">→</span> {f.pct(v.covAfter)}
              </span>
            </div>
            <CoverageMeter value={v.covAfter === null ? 200 : Math.round(v.covAfter * 100)} ghost={v.covBefore === null ? undefined : Math.round(v.covBefore * 100)} />
            <p className="t-small">{pick(copy.coverageAdvisory, t.lang)}</p>
          </>
        ) : (
          <p className="t-small">
            {t("wallet.pay.noReserve")} <Link to="/wallet/reserve">{t("wallet.pay.noReserveLink")}</Link>
          </p>
        )}
      </section>

      <Field label={t("wallet.pay.memo")} help={t("wallet.pay.memoHelp")}>
        <TextInput value={memo} onChange={(x) => setMemo(x.slice(0, 80))} placeholder={t("wallet.pay.memoPh")} />
      </Field>

      <Callout tone="sandbox" title={t("wallet.pay.consent.t")}>
        {f.prose(t(v.hasReserve ? "wallet.pay.consent.b" : "wallet.pay.consent.trust", { name }))}
      </Callout>

      {refusal && (
        <Callout tone="alarm" title={wt(refusal.toast.titleKey, refusal.toast.params)}>
          {f.prose(wt(`world.code.${refusal.code ?? "unknown"}`, refusal.toast.params))}
        </Callout>
      )}

      <div className="wl-act wl-act-pin">
        <Key variant="primary" size="lg" block hold="sign" onAct={() => void sign()} disabled={!canSign} aria-label={value ? t("wallet.pay.holdAria", { v: f.amt(p.totalAfter, unit, { unit: true }) }) : t("wallet.pay.enter")}>
          {busy ? t("wallet.pay.signing") : value ? t("wallet.pay.hold", { v: f.amt(p.totalAfter, unit) }) : t("wallet.pay.enter")}
        </Key>
        <Key variant="quiet" size="lg" onClick={() => nav("/wallet")}>
          {t("wallet.cancel")}
        </Key>
      </div>
      <p className="t-small wl-act-note">{f.prose(t("wallet.pay.signNote", { v: f.amt(p.totalAfter, unit, { unit: true }), id: TOWN_TRACKER, n: f.blocks(p.etaBlocks ?? 10) }))}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// after signing: signature, witness, the ladder to Ergo
// ---------------------------------------------------------------------------------------------

function PayDone({ d, onAgain }: { d: Done; onAgain: () => void }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const name = nameOf(d.to);
  const root = useRef<HTMLDivElement>(null);
  const v = useTownView(
    (eco) => {
      const rec = eco.note(YOU, d.to, d.denom, TOWN_TRACKER);
      if (!rec) return null;
      const s = eco.signatures(rec, { includeTracker: true });
      const box = eco.t(TOWN_TRACKER).currentBox();
      return {
        rec,
        unit: unitOf(eco, d.denom),
        ladder: ladderFromEconomy(eco, rec),
        sigA: bytesToHex(s.issuerSig),
        ok: s.issuerSigOk,
        sigT: s.trackerSig ? bytesToHex(s.trackerSig) : null,
        youPub: eco.p(YOU).pub,
        toPub: eco.p(d.to).pub,
        digest: box?.digest,
        block: box?.creationHeight,
        status: eco.t(TOWN_TRACKER).status(rec, eco.clock.height),
      };
    },
    [d.to, d.denom],
  );
  // the hold key sat at the bottom of the form: bring the signed stages into view
  useRevealOnMount(root, v !== null);
  if (!v) return null;
  const u = v.unit;
  return (
    <div className="wl-form wl-done" ref={root}>
      <ol className="wl-stages" aria-label={t("wallet.pay.stages")}>
        <li className="done">
          <Lamp state="live" size={9} />
          <span>
            <b>{t("wallet.pay.st.signed")}</b>
            <span className="mono t-small">
              {" "}
              · sig {v.sigA.slice(0, 6)}…{v.sigA.slice(-4)} · {v.ok ? t("wallet.nd.verified") : t("wallet.nd.bad")}
            </span>
          </span>
        </li>
        <li className="done">
          <Lamp state="live" size={9} />
          <span>
            <b>{t("wallet.pay.st.witnessed", { id: TOWN_TRACKER })}</b>
            <span className="t-small"> · {t("wallet.pay.st.witnessedB", { name })}</span>
          </span>
        </li>
        <li className={v.status === "local" ? "on" : "done"}>
          <Lamp state={v.status === "local" ? "tracked" : "live"} size={9} />
          <span>
            <b>{t("wallet.pay.st.ergo")}</b>
            <span className="t-small"> · {t(`wallet.pay.st.${v.status}`)}</span>
          </span>
        </li>
      </ol>
      <Note
        issuer={nameOf(YOU)}
        receiver={name}
        issuerPk={v.youPub}
        receiverPk={v.toPub}
        noteKey={v.rec.key}
        amount={toNum(d.out.totalAfter, u.decimals)}
        prev={toNum(d.out.totalBefore, u.decimals)}
        unit={u.symbol}
        dp={f.dpOf(u)}
        state={v.status === "local" ? "tracked" : "committed"}
        tracker={TOWN_TRACKER}
        trackerId={TOWN_TRACKER}
        digest={v.digest}
        block={v.block}
        sigA={v.sigA}
        sigT={v.sigT ?? undefined}
        odometer
        live
      />
      <StatusLadder {...v.ladder} unit={{ symbol: u.symbol, decimals: u.decimals }} />
      <div className="wl-act">
        <Key variant="default" to={`/wallet/note/${v.rec.key}`}>
          {t("wallet.pay.openNote")}
        </Key>
        <Key variant="quiet" onClick={onAgain}>
          {t("wallet.pay.again")}
        </Key>
        <Key variant="quiet" to="/wallet">
          {t("wallet.done")}
        </Key>
      </div>
    </div>
  );
}
