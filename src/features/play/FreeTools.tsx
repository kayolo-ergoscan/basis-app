// Free mode (VISUAL §13 /play/free): every engine command as a small form, acting for everyone in the world.
// Each command runs through run.exec on the live economy; refusals come back as calm toasts in words, with the
// X-ray one click away when the contract was involved.
import { cloneElement, isValidElement, useId, useMemo, useState, type ReactElement, type ReactNode } from "react";
import type { Lang } from "@/app/types";
import type { TFn } from "@/app";
import { defaultCollateralPolicy, type DebtCycle, type DenomId, type Economy, type ParticipantKind, type ReserveEval, type SimTx } from "@/protocol";
import { Key, Seg, int, toast } from "@/ui";
import { POLICY_PRESETS, SUSE, policyFromPreset, redemptionPreview, worldLookup, type RunController } from "@/world";
import { denomInfoOf, displayName, fmtAmt, parseUnits } from "./model";

export interface XrayRequest {
  title: string;
  sub?: string;
  evaluation: { ok: boolean; stage?: "wallet" | "tracker" | "contract"; code?: string; message?: string; eval?: ReserveEval; tx?: SimTx } | ReserveEval | null;
  focus?: string[];
  tx?: SimTx | null;
  note: "copy" | "live" | "rebuilt";
}

interface Props {
  run: RunController;
  eco: Economy;
  t: TFn;
  lang: Lang;
  past: boolean;
  onLive: () => void;
  onFork: () => void;
  onXray: (x: XrayRequest) => void;
}

const TOKEN_TRACKER = "T-sUSE";

function Field({ label, children, help, error }: { label: string; children: ReactNode; help?: ReactNode; error?: string | null }) {
  const id = useId();
  return (
    <div className="pl-f">
      <label className="pl-f-l" htmlFor={id}>
        {label}
      </label>
      <div className="pl-f-c" id={`${id}-w`}>
        {wire(children, id, error ? `${id}-e` : help ? `${id}-h` : undefined)}
      </div>
      {error ? (
        <span className="pl-f-e" id={`${id}-e`} role="alert">
          {error}
        </span>
      ) : help ? (
        <span className="pl-f-h" id={`${id}-h`}>
          {help}
        </span>
      ) : null}
    </div>
  );
}
function wire(children: ReactNode, id: string, describedBy?: string): ReactNode {
  if (isValidElement(children)) return cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, { id, "aria-describedby": describedBy });
  return children;
}

function Sel<V extends string>({ value, onChange, options, id, ...rest }: { value: V; onChange: (v: V) => void; options: Array<{ value: V; label: string }>; id?: string; "aria-describedby"?: string }) {
  return (
    <select className="pl-sel" id={id} value={value} onChange={(e) => onChange(e.target.value as V)} aria-describedby={rest["aria-describedby"]}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Amount({ value, onChange, unit, id, max, ...rest }: { value: string; onChange: (v: string) => void; unit: string; id?: string; max?: { label: string; onMax: () => void }; "aria-describedby"?: string }) {
  return (
    <span className="pl-in">
      <input id={id} inputMode="decimal" autoComplete="off" spellCheck={false} value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.,\s]/g, ""))} aria-describedby={rest["aria-describedby"]} />
      <span className="u">{unit}</span>
      {max && (
        <button type="button" className="pl-in-max" onClick={max.onMax}>
          {max.label}
        </button>
      )}
    </span>
  );
}

function Section({ id, title, open, onToggle, children }: { id: string; title: string; open: boolean; onToggle: (id: string) => void; children: ReactNode }) {
  return (
    <section className={`pl-tool${open ? " open" : ""}`}>
      <h3 className="pl-tool-h">
        <button type="button" aria-expanded={open} aria-controls={`pl-tool-${id}`} onClick={() => onToggle(id)}>
          <span>{title}</span>
          <span className="pl-chev" aria-hidden="true" />
        </button>
      </h3>
      {open && (
        <div className="pl-tool-b" id={`pl-tool-${id}`}>
          {children}
        </div>
      )}
    </section>
  );
}

export function FreeTools({ run, eco, t, lang, past, onLive, onFork, onXray }: Props) {
  const v = eco.events.length;
  const [open, setOpen] = useState<Record<string, boolean>>({ pay: true });
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const [busy, setBusy] = useState(false);
  const nm = (id: string) => displayName(eco, id, lang);

  const people = useMemo(() => [...eco.participants.values()].filter((p) => p.kind !== "tracker-operator").map((p) => ({ value: p.id, label: nm(p.id) })), [eco, v, lang]);
  const everyone = useMemo(() => [...eco.participants.values()].map((p) => ({ value: p.id, label: nm(p.id) })), [eco, v, lang]);
  const trackers = useMemo(() => [...eco.trackers.values()].map((tr) => ({ value: tr.id, label: nm(tr.id) })), [eco, v, lang]);
  const denoms = useMemo(() => [...eco.denominations.values()].map((d) => ({ value: d.id as string, label: d.symbol })), [eco, v]);
  const reserves = useMemo(
    () => [...eco.reserves.values()].filter((r) => r.active).map((r) => ({ value: r.id, label: `${nm(eco.idOf(r.owner) ?? "")} · ${fmtAmt(r.collateral(), denomInfoOf(eco, r.denom).decimals)} ${denomInfoOf(eco, r.denom).symbol}` })),
    [eco, v, lang],
  );
  const first = people[0]?.value ?? "";
  const second = people[1]?.value ?? first;

  const why = (code?: string, message?: string) => (code ? worldLookup(`world.code.${code}`, lang) : undefined) ?? message ?? code ?? "";
  const refused = (o: { code?: string; message?: string; eval?: ReserveEval; tx?: SimTx; stage?: "wallet" | "tracker" | "contract" }, title?: string) => {
    const hasEval = !!o.eval;
    toast({
      kind: "info",
      title: t("play.free.refused", { why: why(o.code, o.message) }),
      detail: title,
      action: hasEval ? { label: t("play.cheat.open"), onClick: () => onXray({ title: t("play.xray.title"), evaluation: { ok: false, stage: o.stage ?? "contract", code: o.code, message: o.message, eval: o.eval, tx: o.tx }, tx: o.tx ?? null, note: "live" }) } : undefined,
    });
  };
  const act = <T,>(fn: (e: Economy) => T): T | null => {
    try {
      return run.exec(fn);
    } catch (e) {
      toast({ kind: "info", title: t("play.player.busy"), detail: (e as Error).message });
      return null;
    }
  };
  const unitOf = (d: DenomId) => denomInfoOf(eco, d);

  // ---- people
  const [pName, setPName] = useState("");
  const [pKind, setPKind] = useState<ParticipantKind>("human");
  const [pErg, setPErg] = useState("10");
  const addPerson = () => {
    const name = pName.trim() || t(`play.ins.kind.${pKind}`);
    const ergAmt = parseUnits(pErg || "0", 9) ?? 0n;
    let n = eco.participants.size + 1;
    while (eco.participants.has(`p${n}`)) n++;
    const out = act((e) => e.addParticipant({ id: `p${n}`, name, kind: pKind, erg: ergAmt }));
    if (out) {
      toast({ kind: "up", title: t("play.free.added", { name }) });
      setPName("");
    }
  };

  // ---- pay
  const [payFrom, setPayFrom] = useState(first);
  const [payTo, setPayTo] = useState(second);
  const [payAmt, setPayAmt] = useState("1");
  const [payDenom, setPayDenom] = useState<string>("erg");
  const [payTracker, setPayTracker] = useState<string>("");
  const [payErr, setPayErr] = useState<string | null>(null);
  const payU = unitOf(payDenom as DenomId);
  const trackerFor = (d: string, pick: string) => {
    if (pick && eco.trackers.get(pick)?.denoms.has(d as DenomId)) return pick;
    return [...eco.trackers.values()].find((tr) => tr.denoms.has(d as DenomId))?.id;
  };
  const doPay = (self: boolean) => {
    const amount = parseUnits(payAmt, payU.decimals);
    if (!amount) return setPayErr(t("play.free.badAmount"));
    if (!self && payFrom === payTo) return setPayErr(t("play.free.pickTwo"));
    setPayErr(null);
    const tracker = trackerFor(payDenom, payTracker);
    const out = act((e) => (self ? e.selfNote({ who: payFrom, amount, denom: payDenom as DenomId, tracker }) : e.pay({ from: payFrom, to: payTo, amount, denom: payDenom as DenomId, tracker })));
    if (!out) return;
    if (out.ok && out.record) toast({ kind: "proof", title: t("play.free.raised", { a: nm(payFrom), b: nm(self ? payFrom : payTo), v: `${fmtAmt(out.record.totalDebt, payU.decimals)} ${payU.symbol}` }), detail: t("play.free.raisedDetail") });
    else refused(out);
  };

  // ---- move a debt
  const [mvIssuer, setMvIssuer] = useState(first);
  const [mvFrom, setMvFrom] = useState(second);
  const [mvTo, setMvTo] = useState(people[2]?.value ?? first);
  const [mvAmt, setMvAmt] = useState("1");
  const [mvErr, setMvErr] = useState<string | null>(null);
  const doMove = () => {
    const amount = parseUnits(mvAmt, 9);
    if (!amount) return setMvErr(t("play.free.badAmount"));
    if (mvIssuer === mvFrom || mvFrom === mvTo || mvIssuer === mvTo) return setMvErr(t("play.free.pickTwo"));
    setMvErr(null);
    const out = act((e) => e.novate({ issuer: mvIssuer, from: mvFrom, to: mvTo, amount }));
    if (!out) return;
    if (out.ok) toast({ kind: "proof", title: t("play.free.moved", { v: `${fmtAmt(amount, 9)} ERG` }), detail: t("play.free.moveCaveatShort") });
    else refused(out);
  };

  // ---- exchange
  const hasToken = eco.denominations.size > 1;
  const [exIssuer, setExIssuer] = useState(first);
  const [exReceiver, setExReceiver] = useState(second);
  const [exGive, setExGive] = useState("1");
  const [exGet, setExGet] = useState("1");
  const [exErr, setExErr] = useState<string | null>(null);
  const tokenId = [...eco.denominations.keys()].find((d) => d !== "erg") ?? SUSE.id;
  const tokenU = unitOf(tokenId);
  const addToken = () => {
    const out = act((e) => {
      e.addDenomination(SUSE);
      if (![...e.trackers.values()].some((tr) => tr.denoms.has(SUSE.id))) {
        const op = [...e.participants.values()].find((p) => p.kind === "tracker-operator")?.id ?? [...e.participants.keys()][0];
        e.createTracker({ id: TOKEN_TRACKER, name: "Token tracker", operator: op, denoms: [SUSE.id], globalPolicy: defaultCollateralPolicy() });
      }
      for (const p of e.participants.values()) if (p.kind !== "tracker-operator") e.fund(p.id, SUSE.id, 100n * 10n ** BigInt(SUSE.decimals), "play sUSE");
      return true;
    });
    if (out) toast({ kind: "up", title: t("play.free.tokenAdded") });
  };
  const doExchange = () => {
    const give = parseUnits(exGive, 9);
    const get = parseUnits(exGet, tokenU.decimals);
    if (!give || !get) return setExErr(t("play.free.badAmount"));
    if (exIssuer === exReceiver) return setExErr(t("play.free.pickTwo"));
    setExErr(null);
    const tracker = [...eco.trackers.values()].find((tr) => tr.denoms.has(tokenId))?.id;
    const out = act((e) => e.exchange({ issuer: exIssuer, receiver: exReceiver, from: "erg", fromAmount: give, to: tokenId, toAmount: get, tracker }));
    if (!out) return;
    if (out.ok) toast({ kind: "proof", title: t("play.free.exStaged") });
    else refused(out);
  };

  // ---- reserves
  const [rsOwner, setRsOwner] = useState(first);
  const [rsAmt, setRsAmt] = useState("5");
  const [rsDenom, setRsDenom] = useState<string>("erg");
  const [rsErr, setRsErr] = useState<string | null>(null);
  const [rsPick, setRsPick] = useState("");
  const [rsTop, setRsTop] = useState("1");
  const [rsBy, setRsBy] = useState(first);
  const rsU = unitOf(rsDenom as DenomId);
  const reserveId = reserves.some((r) => r.value === rsPick) ? rsPick : reserves[0]?.value ?? "";
  const pickedReserve = reserveId ? eco.reserves.get(reserveId) : undefined;
  const pickedU = pickedReserve ? unitOf(pickedReserve.denom) : unitOf("erg");
  const doCreate = () => {
    const amount = parseUnits(rsAmt, rsU.decimals);
    if (!amount) return setRsErr(t("play.free.badAmount"));
    setRsErr(null);
    const tracker = trackerFor(rsDenom, "");
    const out = act((e) => e.createReserve({ owner: rsOwner, amount, denom: rsDenom as DenomId, tracker }));
    if (!out) return;
    if (out.ok) toast({ kind: "metal", title: t("play.free.created", { v: `${fmtAmt(amount, rsU.decimals)} ${rsU.symbol}` }) });
    else refused(out);
  };
  const doTopUp = () => {
    if (!pickedReserve) return;
    const amount = parseUnits(rsTop, pickedU.decimals);
    if (!amount) return setRsErr(t("play.free.badAmount"));
    setRsErr(null);
    const out = act((e) => e.topUp({ reserve: pickedReserve.id, amount, by: rsBy }));
    if (!out) return;
    if (out.ok) toast({ kind: "metal", title: t("play.free.toppedUp", { v: `${fmtAmt(amount, pickedU.decimals)} ${pickedU.symbol}` }) });
    else refused(out);
  };
  const doInit = () => {
    if (!pickedReserve) return;
    const out = act((e) => e.initiateRefund({ reserve: pickedReserve.id }));
    if (!out) return;
    if (out.ok) toast({ kind: "metal", title: t("play.free.refundStarted", { h: int(eco.clock.height) }) });
    else refused(out);
  };
  const doComplete = () => {
    if (!pickedReserve) return;
    const before = pickedReserve.collateral();
    const out = act((e) => e.completeRefund({ reserve: pickedReserve.id }));
    if (!out) return;
    if (out.ok) toast({ kind: "metal", title: t("play.free.refundDone", { v: `${fmtAmt(before, pickedU.decimals)} ${pickedU.symbol}` }) });
    else refused(out);
  };

  // ---- redeem
  const [rdR, setRdR] = useState(second);
  const [rdI, setRdI] = useState(first);
  const [rdDenom, setRdDenom] = useState<string>("erg");
  const [rdPath, setRdPath] = useState<"normal" | "emergency">("normal");
  const [rdAmt, setRdAmt] = useState("");
  const [rdErr, setRdErr] = useState<string | null>(null);
  const rdU = unitOf(rdDenom as DenomId);
  const rdTracker = trackerFor(rdDenom, "");
  const pv = useMemo(() => {
    try {
      return rdR !== rdI && eco.participants.has(rdR) && eco.participants.has(rdI) ? redemptionPreview(eco, rdR, rdI, rdDenom as DenomId, rdTracker) : null;
    } catch {
      return null;
    }
  }, [eco, v, rdR, rdI, rdDenom, rdTracker]);
  const doRedeem = () => {
    if (rdR === rdI) return setRdErr(t("play.free.pickTwo"));
    const amount = rdAmt.trim() ? parseUnits(rdAmt, rdU.decimals) : pv?.maxAmount ?? null;
    if (!amount) return setRdErr(t("play.free.badAmount"));
    setRdErr(null);
    const out = act((e) => e.redeem({ receiver: rdR, issuer: rdI, denom: rdDenom as DenomId, tracker: rdTracker, amount, emergency: rdPath === "emergency" }));
    if (!out) return;
    if (out.ok) toast({ kind: "metal", title: t("play.free.redeemed", { r: nm(rdR), i: nm(rdI), v: `${fmtAmt(out.amount ?? amount, rdU.decimals)} ${rdU.symbol}` }) });
    else {
      refused(out);
      if (out.stage === "contract" && out.eval) onXray({ title: t("play.xray.title"), evaluation: { ok: false, stage: out.stage, code: out.code, message: out.message, eval: out.eval, tx: out.tx }, tx: out.tx ?? null, note: "live" });
    }
  };

  // ---- policy and credit
  const [plWho, setPlWho] = useState(first);
  const [plPreset, setPlPreset] = useState<string>("backed-100");
  const [clC, setClC] = useState(second);
  const [clD, setClD] = useState(first);
  const [clLimit, setClLimit] = useState("2");
  const [clErr, setClErr] = useState<string | null>(null);
  const doPolicy = () => {
    const friends = people.map((p) => p.value).filter((x) => x !== plWho);
    const out = act((e) => {
      e.setPolicy(plWho, policyFromPreset(plPreset as (typeof POLICY_PRESETS)[number]["id"], { friends }, e));
      return true;
    });
    if (out) toast({ kind: "info", title: t("play.free.policySet", { name: nm(plWho) }), detail: worldLookup(`world.policy.${plPreset}.name`, lang) });
  };
  const doLine = () => {
    if (clC === clD) return setClErr(t("play.free.pickTwo"));
    const limit = clLimit.trim() ? parseUnits(clLimit, 9) : null;
    if (clLimit.trim() && !limit) return setClErr(t("play.free.badAmount"));
    setClErr(null);
    const out = act((e) => {
      e.setCreditLine(clC, clD, limit, "erg");
      return true;
    });
    if (out) toast({ kind: "info", title: limit ? t("play.free.lineSet", { a: nm(clC), b: nm(clD), v: `${fmtAmt(limit, 9)} ERG` }) : t("play.free.lineRemoved", { a: nm(clC), b: nm(clD) }) });
  };

  // ---- tracker
  const [trId, setTrId] = useState(trackers[0]?.value ?? "");
  const tr = eco.trackers.get(trId) ?? [...eco.trackers.values()][0];
  const [cnTarget, setCnTarget] = useState<string>("all");
  const doCommit = (force: boolean) => {
    if (!tr) return;
    const out = act((e) => e.commit(tr.id, { force }));
    if (out) toast({ kind: "proof", title: t("play.free.committed", { h: int(out.creationHeight) }), detail: out.digest.slice(0, 16) + "…", mono: true });
    else if (out === null) toast({ kind: "info", title: t("play.free.nothing") });
  };
  const doKill = () => {
    if (!tr) return;
    act((e) => e.disappear(tr.id));
    toast({ kind: "info", title: t("play.free.killed"), detail: t("play.free.killedDetail") });
  };
  const doBack = () => {
    if (!tr) return;
    act((e) => e.reappear(tr.id));
    toast({ kind: "info", title: t("play.free.back") });
  };
  const doCensor = (mode: "off" | "omit" | "refuse") => {
    if (!tr) return;
    act((e) => e.setCensorship(tr.id, mode, cnTarget === "all" ? "all" : [cnTarget]));
    toast({ kind: "info", title: t("play.free.censorSet", { mode: t(`play.free.censor.${mode}`) }) });
  };

  // ---- chain
  const mine = async (n: number) => {
    setBusy(true);
    try {
      let left = n;
      while (left > 0) {
        const k = Math.min(left, 120);
        run.mine(k);
        left -= k;
        if (left > 0) await new Promise((r) => setTimeout(r, 0));
      }
      toast({ kind: "info", title: t("play.free.mined", { n: int(n), h: int(run.eco.clock.height) }) });
    } catch (e) {
      toast({ kind: "info", title: t("play.player.busy"), detail: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // ---- clearing
  const [clDenom, setClDenom] = useState<string>("erg");
  const [loops, setLoops] = useState<DebtCycle[] | null>(null);
  const [loopIx, setLoopIx] = useState(0);
  const clU = unitOf(clDenom as DenomId);
  const findLoops = () => {
    try {
      const cs = eco.findCycles(clDenom as DenomId, 6).slice(0, 8);
      setLoops(cs);
      setLoopIx(0);
    } catch {
      setLoops([]);
    }
  };
  const loop = loops?.[loopIx] ?? null;
  const preview = useMemo(() => {
    if (!loop) return null;
    try {
      return eco.previewClearing(loop, loop.amount, clDenom as DenomId).stats;
    } catch {
      return null;
    }
  }, [loop, eco, v, clDenom]);
  const doClear = (mode: "onchain" | "waivers") => {
    if (!loop) return;
    const out = act((e) => e.clearCycle(loop.members, { mode, amount: loop.amount, denom: clDenom as DenomId }));
    if (!out) return;
    setLoops(null);
    if (out.ok) toast({ kind: mode === "onchain" ? "metal" : "proof", title: t("play.free.cleared", { v: `${fmtAmt(out.amount ?? loop.amount, clU.decimals)} ${clU.symbol}` }) });
    else {
      const evalFail = out.evals?.find((x) => !x.ok);
      refused({ code: out.code, message: out.message, eval: evalFail, tx: out.tx, stage: "contract" });
    }
  };

  const disabled = past || busy;
  const D = denoms.length > 1;
  return (
    <div className="pl-tools" aria-busy={busy}>
      {past && (
        <div className="pl-past" role="status">
          <p className="t-small">{t("play.free.pastNote")}</p>
          <div className="pl-past-k">
            <button type="button" className="key sm primary" onClick={onLive}>
              {t("play.tm.back")}
            </button>
            <button type="button" className="key sm" onClick={onFork}>
              {t("play.tm.fork")}
            </button>
          </div>
        </div>
      )}
      <fieldset disabled={disabled} className="pl-fs">
        <legend className="sr-only">{t("play.free.title")}</legend>

        <Section id="pay" title={t("play.free.sec.pay")} open={!!open.pay} onToggle={toggle}>
          <div className="pl-row2">
            <Field label={t("play.free.from")}>
              <Sel value={payFrom} onChange={setPayFrom} options={people} />
            </Field>
            <Field label={t("play.free.to")}>
              <Sel value={payTo} onChange={setPayTo} options={people} />
            </Field>
          </div>
          <div className={D ? "pl-row2" : undefined}>
            <Field label={t("play.free.amount")} error={payErr}>
              <Amount value={payAmt} onChange={setPayAmt} unit={payU.symbol} />
            </Field>
            {D && (
              <Field label={t("play.stage.denom")}>
                <Sel value={payDenom} onChange={setPayDenom} options={denoms} />
              </Field>
            )}
          </div>
          {trackers.length > 1 && (
            <Field label={t("play.free.tracker")}>
              <Sel value={payTracker || (trackerFor(payDenom, "") ?? "")} onChange={setPayTracker} options={trackers.filter((x) => eco.trackers.get(x.value)?.denoms.has(payDenom as DenomId))} />
            </Field>
          )}
          <div className="pl-acts">
            <Key size="sm" variant="primary" onClick={() => doPay(false)}>
              {t("play.free.raise")}
            </Key>
            <Key size="sm" variant="quiet" onClick={() => doPay(true)}>
              {t("play.free.selfNote")}
            </Key>
          </div>
        </Section>

        <Section id="move" title={t("play.free.sec.move")} open={!!open.move} onToggle={toggle}>
          <Field label={t("play.free.issuer")}>
            <Sel value={mvIssuer} onChange={setMvIssuer} options={people} />
          </Field>
          <div className="pl-row2">
            <Field label={t("play.free.oldCreditor")}>
              <Sel value={mvFrom} onChange={setMvFrom} options={people} />
            </Field>
            <Field label={t("play.free.newCreditor")}>
              <Sel value={mvTo} onChange={setMvTo} options={people} />
            </Field>
          </div>
          <Field label={t("play.free.amount")} error={mvErr}>
            <Amount value={mvAmt} onChange={setMvAmt} unit="ERG" />
          </Field>
          <p className="pl-caveat t-small">{t("play.free.moveCaveat")}</p>
          <div className="pl-acts">
            <Key size="sm" variant="primary" onClick={doMove}>
              {t("play.free.move")}
            </Key>
          </div>
        </Section>

        <Section id="exchange" title={t("play.free.sec.exchange")} open={!!open.exchange} onToggle={toggle}>
          {!hasToken ? (
            <>
              <p className="t-small">{t("play.free.exNeeds")}</p>
              <div className="pl-acts">
                <Key size="sm" onClick={addToken}>
                  {t("play.free.addToken")}
                </Key>
              </div>
            </>
          ) : (
            <>
              <div className="pl-row2">
                <Field label={t("play.free.issuer")}>
                  <Sel value={exIssuer} onChange={setExIssuer} options={people} />
                </Field>
                <Field label={t("play.free.receiver")}>
                  <Sel value={exReceiver} onChange={setExReceiver} options={people} />
                </Field>
              </div>
              <div className="pl-row2">
                <Field label={t("play.free.exGive")} error={exErr}>
                  <Amount value={exGive} onChange={setExGive} unit="ERG" />
                </Field>
                <Field label={t("play.free.exGet")}>
                  <Amount value={exGet} onChange={setExGet} unit={tokenU.symbol} />
                </Field>
              </div>
              <p className="t-small dim">{t("play.free.exHelp")}</p>
              <div className="pl-acts">
                <Key size="sm" variant="primary" onClick={doExchange}>
                  {t("play.free.exStage")}
                </Key>
              </div>
            </>
          )}
        </Section>

        <Section id="reserves" title={t("play.free.sec.reserves")} open={!!open.reserves} onToggle={toggle}>
          <div className="pl-row2">
            <Field label={t("play.free.owner")}>
              <Sel value={rsOwner} onChange={setRsOwner} options={people} />
            </Field>
            {D ? (
              <Field label={t("play.stage.denom")}>
                <Sel value={rsDenom} onChange={setRsDenom} options={denoms} />
              </Field>
            ) : (
              <span />
            )}
          </div>
          <Field label={t("play.free.amount")} error={rsErr}>
            <Amount value={rsAmt} onChange={setRsAmt} unit={rsU.symbol} />
          </Field>
          <div className="pl-acts">
            <Key size="sm" variant="metal" onClick={doCreate}>
              {t("play.free.create")}
            </Key>
          </div>
          {reserves.length > 0 && (
            <div className="pl-sub-tool">
              <Field label={t("play.free.reserve")}>
                <Sel value={reserveId} onChange={setRsPick} options={reserves} />
              </Field>
              <div className="pl-row2">
                <Field label={t("play.free.topUp")}>
                  <Amount value={rsTop} onChange={setRsTop} unit={pickedU.symbol} />
                </Field>
                <Field label={t("play.free.by")}>
                  <Sel value={rsBy} onChange={setRsBy} options={people} />
                </Field>
              </div>
              <div className="pl-acts">
                <Key size="sm" variant="metal" onClick={doTopUp}>
                  {t("play.free.topUp")}
                </Key>
                {pickedReserve && !pickedReserve.refundPending() ? (
                  <Key size="sm" variant="danger" hold onAct={doInit}>
                    {t("play.free.initRefund")}
                  </Key>
                ) : (
                  <Key size="sm" onClick={doComplete}>
                    {t("play.free.completeRefund")}
                  </Key>
                )}
              </div>
              <p className="t-small dim">{t("play.free.refundHelp")}</p>
            </div>
          )}
        </Section>

        <Section id="redeem" title={t("play.free.sec.redeem")} open={!!open.redeem} onToggle={toggle}>
          <div className="pl-row2">
            <Field label={t("play.free.receiver")}>
              <Sel value={rdR} onChange={setRdR} options={people} />
            </Field>
            <Field label={t("play.free.issuer")}>
              <Sel value={rdI} onChange={setRdI} options={people} />
            </Field>
          </div>
          {D && (
            <Field label={t("play.stage.denom")}>
              <Sel value={rdDenom} onChange={setRdDenom} options={denoms} />
            </Field>
          )}
          <Field label={t("play.free.path")}>
            <Seg<"normal" | "emergency">
              value={rdPath}
              onChange={setRdPath}
              ariaLabel={t("play.free.path")}
              options={[
                { value: "normal", label: t("play.free.normal") },
                { value: "emergency", label: t("play.free.emergency") },
              ]}
            />
          </Field>
          <Field
            label={t("play.free.amount")}
            error={rdErr}
            help={pv ? (pv.maxAmount > 0n ? t("play.free.canRedeem", { v: `${fmtAmt(pv.maxAmount, rdU.decimals)} ${rdU.symbol}` }) : pv.blockers.slice(0, 1).map((b) => worldLookup(`world.redeem.blocker.${b}`, lang) ?? b).join("")) : undefined}
          >
            <Amount value={rdAmt} onChange={setRdAmt} unit={rdU.symbol} max={pv && pv.maxAmount > 0n ? { label: t("play.free.max"), onMax: () => setRdAmt(fmtAmt(pv.maxAmount, rdU.decimals).replace(/[   ⁠]/g, "").replace(",", ".")) } : undefined} />
          </Field>
          <div className="pl-acts">
            <Key size="sm" variant="metal" hold onAct={doRedeem}>
              {t("play.free.redeem")}
            </Key>
          </div>
        </Section>

        <Section id="policy" title={t("play.free.sec.policy")} open={!!open.policy} onToggle={toggle}>
          <div className="pl-row2">
            <Field label={t("play.free.policyFor")}>
              <Sel value={plWho} onChange={setPlWho} options={people} />
            </Field>
            <Field label={t("play.free.preset")}>
              <Sel value={plPreset} onChange={setPlPreset} options={POLICY_PRESETS.map((p) => ({ value: p.id as string, label: worldLookup(p.nameKey, lang) ?? p.id }))} />
            </Field>
          </div>
          <p className="t-small dim">{worldLookup(`world.policy.${plPreset}.about`, lang)}</p>
          <div className="pl-acts">
            <Key size="sm" onClick={doPolicy}>
              {t("play.free.setPolicy")}
            </Key>
          </div>
          <div className="pl-sub-tool">
            <div className="pl-row2">
              <Field label={t("play.free.creditor")}>
                <Sel value={clC} onChange={setClC} options={people} />
              </Field>
              <Field label={t("play.free.debtor")}>
                <Sel value={clD} onChange={setClD} options={people} />
              </Field>
            </div>
            <Field label={t("play.free.limit")} error={clErr} help={t("play.free.lineHelp")}>
              <Amount value={clLimit} onChange={setClLimit} unit="ERG" />
            </Field>
            <div className="pl-acts">
              <Key size="sm" onClick={doLine}>
                {t("play.free.setLine")}
              </Key>
            </div>
          </div>
          <p className="t-small dim">{t("play.foot.policy")}</p>
        </Section>

        <Section id="tracker" title={t("play.free.sec.tracker")} open={!!open.tracker} onToggle={toggle}>
          {trackers.length > 1 && (
            <Field label={t("play.free.tracker")}>
              <Sel value={tr?.id ?? ""} onChange={setTrId} options={trackers} />
            </Field>
          )}
          <div className="pl-acts">
            <Key size="sm" onClick={() => doCommit(false)} disabled={!tr?.online}>
              {t("play.free.commit")}
            </Key>
            <Key size="sm" variant="quiet" onClick={() => doCommit(true)} disabled={!tr?.online} title={t("play.free.heartbeatHelp")}>
              {t("play.free.heartbeat")}
            </Key>
          </div>
          <div className="pl-acts">
            {tr?.online ? (
              <Key size="sm" variant="danger" hold onAct={doKill}>
                {t("play.free.kill")}
              </Key>
            ) : (
              <Key size="sm" variant="primary" onClick={doBack}>
                {t("play.free.reappear")}
              </Key>
            )}
          </div>
          <Field label={t("play.free.target")}>
            <Sel value={cnTarget} onChange={setCnTarget} options={[{ value: "all", label: t("play.free.everyone") }, ...everyone.filter((p) => eco.p(p.value).kind !== "tracker-operator")]} />
          </Field>
          <Field label={t("play.free.censor")}>
            <Seg<"off" | "omit" | "refuse">
              value={(tr?.censorship.mode ?? "off") as "off" | "omit" | "refuse"}
              onChange={doCensor}
              ariaLabel={t("play.free.censor")}
              options={[
                { value: "off", label: t("play.free.censor.off") },
                { value: "omit", label: t("play.free.censor.omit") },
                { value: "refuse", label: t("play.free.censor.refuse") },
              ]}
            />
          </Field>
          <p className="t-small dim">{tr ? t(`play.ins.t.censor.${tr.censorship.mode}`) : ""}</p>
        </Section>

        <Section id="chain" title={t("play.free.sec.chain")} open={!!open.chain} onToggle={toggle}>
          <div className="pl-acts pl-mine">
            {[1, 5, 720, 2160].map((n) => (
              <Key key={n} size="sm" onClick={() => void mine(n)}>
                {t("play.free.mineN", { n: int(n) })}
              </Key>
            ))}
          </div>
          <p className="t-small dim">{t("play.free.mineHelp")}</p>
        </Section>

        <Section id="clearing" title={t("play.free.sec.clearing")} open={!!open.clearing} onToggle={toggle}>
          {D && (
            <Field label={t("play.stage.denom")}>
              <Sel value={clDenom} onChange={setClDenom} options={denoms} />
            </Field>
          )}
          <div className="pl-acts">
            <Key size="sm" onClick={findLoops}>
              {t("play.free.findLoops")}
            </Key>
          </div>
          {loops && loops.length === 0 && <p className="t-small">{t("play.free.noLoops")}</p>}
          {loops && loops.length > 0 && (
            <>
              <ul className="pl-loops" role="listbox" aria-label={t("play.free.findLoops")}>
                {loops.map((c, i) => (
                  <li key={c.members.join(">") + i} role="option" aria-selected={i === loopIx}>
                    <button type="button" className={i === loopIx ? "on" : ""} onClick={() => setLoopIx(i)}>
                      {t("play.free.loop", { members: c.members.map(nm).join(" → "), v: `${fmtAmt(c.amount, clU.decimals)} ${clU.symbol}` })}
                    </button>
                  </li>
                ))}
              </ul>
              {preview && (
                <p className="t-small">
                  <b>{t("play.free.preview")}:</b> {t("play.free.previewLine", { a: fmtAmt(preview.grossBefore, clU.decimals), b: fmtAmt(preview.grossAfter, clU.decimals), gone: t.p("play.free.gone", preview.edgesBefore - preview.edgesAfter) })}
                </p>
              )}
              <div className="pl-acts">
                <Key size="sm" variant="metal" hold onAct={() => doClear("onchain")}>
                  {t("play.free.clearChain")}
                </Key>
                <Key size="sm" onClick={() => doClear("waivers")}>
                  {t("play.free.clearWaivers")}
                </Key>
              </div>
              <p className="t-small dim">{t("play.free.chainHelp")}</p>
              <p className="t-small dim">{t("play.free.waiverHelp")}</p>
            </>
          )}
        </Section>

        <Section id="people" title={t("play.free.sec.people")} open={!!open.people} onToggle={toggle}>
          <Field label={t("play.free.name")}>
            <input className="pl-txt" value={pName} onChange={(e) => setPName(e.target.value.slice(0, 32))} placeholder={t(`play.ins.kind.${pKind}`)} />
          </Field>
          <Field label={t("play.free.kind")}>
            <Seg<ParticipantKind>
              value={pKind}
              onChange={setPKind}
              ariaLabel={t("play.free.kind")}
              options={(["human", "agent", "business"] as ParticipantKind[]).map((k) => ({ value: k, label: t(`play.ins.kind.${k}`) }))}
            />
          </Field>
          <Field label={t("play.free.startErg")}>
            <Amount value={pErg} onChange={setPErg} unit="ERG" />
          </Field>
          <div className="pl-acts">
            <Key size="sm" variant="primary" onClick={addPerson}>
              {t("play.free.add")}
            </Key>
          </div>
        </Section>
      </fieldset>
    </div>
  );
}
