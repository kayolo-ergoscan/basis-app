// Right inspector (VISUAL §13 /play): whatever is selected on the stage. Participant: balance sheet per
// denomination and the coverage meter. Note: the note, its version ladder, signatures and status ladder.
// Reserve: the reserve card, its redemption tree and the exit clocks. Tracker: status, last commit, digest and a
// lookup proof. Nothing selected: the circle at a glance.
import { useMemo, useState, type ReactNode } from "react";
import type { Lang } from "@/app/types";
import type { TFn } from "@/app";
import { copy, pick, reserveCheckReasons } from "@/content";
import { hexToBytes, REFUND_PERIOD_BLOCKS, type DenomId, type Economy, type NoteRecord, type ReserveSim, type TrackerSim } from "@/protocol";
import {
  BacksBar,
  CoverageMeter,
  EclipseCard,
  Honest,
  Key,
  KeySeal,
  Ledger,
  Note,
  SealId,
  Tag,
  TrackerCard,
  TrackerTile,
  blk,
  int,
  pct,
  short,
  type LedgerRow,
} from "@/ui";
import { AvlProofViewer, ExitClocks, SignatureXray, StatusLadder, ladderFromEconomy } from "@/viz";
import { balanceSheet, noteHistory, presetOf, redemptionPreview, trackerTimeline, worldLookup, type RunController } from "@/world";
import { denomInfoOf, denomViews, displayName, fmtAmt, type CheatId } from "./model";
import type { Sel } from "./StageGraph";

export interface ActApi {
  redeem: (o: { receiver: string; issuer: string; denom: DenomId; tracker: string; amount?: bigint; emergency?: boolean }) => void;
  topUp: (o: { reserve: string; amount: bigint; by?: string }) => void;
  startExit: (reserve: string) => void;
  completeExit: (reserve: string) => void;
}

interface Props {
  eco: Economy;
  run: RunController;
  sel: Sel | null;
  onSelect: (s: Sel | null) => void;
  free: boolean;
  past: boolean;
  lang: Lang;
  t: TFn;
  act: ActApi;
  scenarioId: string | null;
  /** The denomination on stage (the overview counts its notes and reserves). */
  denom: DenomId;
  onCheat?: (id: CheatId) => void;
}

const num = (v: bigint, decimals: number) => Number(v) / 10 ** decimals;
const unitOf = (eco: Economy, denom: DenomId) => {
  const d = denomInfoOf(eco, denom);
  return { symbol: d.symbol, decimals: d.decimals };
};

export function Inspector(p: Props) {
  const { eco, sel, t } = p;
  let body: ReactNode = null;
  try {
    if (sel?.kind === "participant" && eco.participants.has(sel.id)) body = <ParticipantPanel {...p} id={sel.id} />;
    else if (sel?.kind === "note" && eco.participants.has(sel.from) && eco.participants.has(sel.to) && eco.trackers.has(sel.tracker)) body = <NotePanel {...p} s={sel} />;
    else if (sel?.kind === "reserve" && eco.reserves.has(sel.id)) body = <ReservePanel {...p} id={sel.id} />;
    else if (sel?.kind === "tracker" && eco.trackers.has(sel.id)) body = <TrackerPanel {...p} id={sel.id} />;
  } catch {
    body = null;
  }
  if (!body) body = <Overview {...p} />;
  return (
    <div className="pl-ins-body">
      {sel && (
        <button type="button" className="pl-back" onClick={() => p.onSelect(null)}>
          <span aria-hidden="true">←</span> {t("play.ins.close")}
        </button>
      )}
      {body}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// nothing selected: the circle
// ------------------------------------------------------------------------------------------------

/** How many notes and reserves the overview lists before it says how many more there are. */
const OVERVIEW_LIST = 6;

function Overview({ eco, t, lang, onSelect, scenarioId, denom }: Props) {
  const u = denomInfoOf(eco, denom);
  const stats = useMemo(() => {
    let notes = 0;
    let out = 0n;
    const owed: Array<{ tracker: string; from: string; to: string; claim: bigint }> = [];
    for (const tr of eco.trackers.values())
      for (const rec of tr.notes.values()) {
        if (rec.denom !== denom || rec.issuer === rec.receiver) continue;
        notes++;
        const left = rec.totalDebt > rec.amountRedeemed ? rec.totalDebt - rec.amountRedeemed : 0n;
        const claim = left > rec.waived ? left - rec.waived : 0n;
        out += claim;
        const from = eco.idOf(rec.issuer);
        const to = eco.idOf(rec.receiver);
        if (from && to && claim > 0n) owed.push({ tracker: tr.id, from, to, claim });
      }
    let locked = 0n;
    const vaults: Array<{ id: string; owner: string; v: bigint }> = [];
    for (const r of eco.reserves.values())
      if (r.active && r.denom === denom) {
        const v = r.collateral();
        locked += v;
        vaults.push({ id: r.id, owner: eco.idOf(r.owner) ?? "", v });
      }
    const desc = <X extends { claim?: bigint; v?: bigint }>(a: X, b: X) => {
      const x = a.claim ?? a.v ?? 0n;
      const y = b.claim ?? b.v ?? 0n;
      return y > x ? 1 : y < x ? -1 : 0;
    };
    owed.sort(desc);
    vaults.sort(desc);
    const people = [...eco.participants.values()].filter((x) => x.kind !== "tracker-operator").length;
    return { notes, out, locked, people, owed, vaults };
  }, [eco, eco.events.length, denom]);
  const rows: LedgerRow[] = [
    { label: t("play.ins.stats.people"), value: <span className="num">{int(stats.people)}</span> },
    { label: t("play.ins.stats.notes"), value: <span className="num">{int(stats.notes)}</span> },
    { label: t("play.ins.stats.out"), value: <span className="num">{fmtAmt(stats.out, u.decimals)} {u.symbol}</span> },
    {
      label: t("play.ins.stats.locked"),
      // no reserve at all (mutual credit, a fresh world) is a word, not a metal zero
      value: stats.vaults.length ? <span className="num metal-t">{fmtAmt(stats.locked, u.decimals)} {u.symbol}</span> : <span className="dim">{t("play.ins.stats.noReserves")}</span>,
    },
    { label: t("play.ins.stats.height"), value: <span className="num">{int(eco.clock.height)}</span> },
    { label: t("play.ins.stats.events"), value: <span className="num">{int(eco.events.length)}</span> },
  ];
  const sc = scenarioId ?? "free";
  const nm = (id: string) => displayName(eco, id, lang);
  const more = (n: number) => (n > OVERVIEW_LIST ? <p className="t-small dim pl-more">{t("play.ins.more", { n: int(n - OVERVIEW_LIST) })}</p> : null);
  return (
    <div className="pl-panel">
      <div className="pl-panel-h">
        <span className="label">{t("play.ins.circle")}</span>
        <h2 className="pl-panel-t">{t(`play.sc.${sc}.title`)}</h2>
        <p className="t-small">{t(`play.sc.${sc}.tag`)}</p>
      </div>
      <Ledger rows={rows} />
      <div className="pl-sub">
        <span className="label">{t("play.ins.trackers")}</span>
        {[...eco.trackers.values()].map((tr) => (
          <button key={tr.id} type="button" className="pl-row" onClick={() => onSelect({ kind: "tracker", id: tr.id })}>
            <span className="pl-row-main stack">
              <b>{nm(tr.id)}</b>
              <span className="t-small">{pick(copy.trackerLine, lang)}</span>
            </span>
            <span className="pl-row-end mono">{tr.online ? t("play.ins.t.online") : t("play.ins.t.offline")}</span>
          </button>
        ))}
      </div>
      {stats.owed.length > 0 && (
        <div className="pl-sub">
          <span className="label">{t("play.ins.owedList")}</span>
          {stats.owed.slice(0, OVERVIEW_LIST).map((o) => (
            <button key={`${o.tracker}:${o.from}>${o.to}`} type="button" className="pl-row" onClick={() => onSelect({ kind: "note", tracker: o.tracker, from: o.from, to: o.to, denom })}>
              <span className="pl-row-main">
                <span>{t("play.ins.p.owes", { a: nm(o.from), b: nm(o.to) })}</span>
              </span>
              <span className="pl-row-end num">
                {fmtAmt(o.claim, u.decimals)} {u.symbol}
              </span>
            </button>
          ))}
          {more(stats.owed.length)}
        </div>
      )}
      {stats.vaults.length > 0 && (
        <div className="pl-sub">
          <span className="label">{t("play.ins.p.reserves")}</span>
          {stats.vaults.slice(0, OVERVIEW_LIST).map((r) => (
            <button key={r.id} type="button" className="pl-row" onClick={() => onSelect({ kind: "reserve", id: r.id })}>
              <span className="pl-row-main">
                <span className="pl-coin-dot" aria-hidden="true" />
                <span>{nm(r.owner)}</span>
              </span>
              <span className="pl-row-end num metal-t">
                {fmtAmt(r.v, u.decimals)} {u.symbol}
              </span>
            </button>
          ))}
          {more(stats.vaults.length)}
        </div>
      )}
      <p className="t-small pl-hint">{t("play.ins.hint")}</p>
      <p className="t-small dim">{pick(copy.fee, lang)}</p>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// participant
// ------------------------------------------------------------------------------------------------

function ParticipantPanel({ eco, id, t, lang, onSelect }: Props & { id: string }) {
  const part = eco.participants.get(id)!;
  const sheets = useMemo(() => {
    return denomViews(eco)
      .map((d) => balanceSheet(eco, id, d.id))
      .filter((b) => b.assets > 0n || b.liabilities > 0n || b.reserve > 0n || b.wallet > 0n || b.selfNote > 0n || b.denom === "erg");
  }, [eco, eco.events.length, id]);
  const policy = part.policy;
  const preset = presetOf(policy);
  const lines = useMemo(() => {
    const out: Array<{ debtor: string; denom: DenomId; limit: bigint }> = [];
    for (const [k, v] of eco.creditLines) {
      const [creditor, debtor, denom] = k.split("|");
      if (creditor === id) out.push({ debtor, denom: denom as DenomId, limit: v });
    }
    return out;
  }, [eco, eco.events.length, id]);
  return (
    <div className="pl-panel">
      <div className="pl-panel-h">
        <SealId pk={part.pub} name={displayName(eco, id, lang)} agent={part.kind === "agent"} rim={sheets.some((s) => s.reserve > 0n)} size="lg" />
        <div className="pl-tags">
          <Tag tone={part.kind === "agent" ? "agent" : "plain"}>{t(`play.ins.kind.${part.kind}`)}</Tag>
          <Tag tone="plain">{t("play.ins.sandboxKey")}</Tag>
          {!part.online && <Tag tone="watch">{t("play.ins.offline")}</Tag>}
        </div>
      </div>
      {sheets.map((b) => {
        const u = b.symbol;
        const d = b.decimals;
        const rows: LedgerRow[] = [
          { label: t("play.ins.p.assets"), sub: b.assets > 0n ? t("play.ins.p.backedSplit", { b: fmtAmt(b.assetsBacked, d), t: fmtAmt(b.assetsTrust, d) }) : undefined, value: <span className="num">{fmtAmt(b.assets, d)}</span> },
          { label: t("play.ins.p.liabilities"), value: <span className="num">{b.liabilities > 0n ? "−" : ""}{fmtAmt(b.liabilities, d)}</span> },
        ];
        if (b.selfNote > 0n) rows.push({ label: t("play.ins.p.self"), value: <span className="num">{fmtAmt(b.selfNote, d)}</span> });
        rows.push({ label: t("play.ins.p.reserve"), value: <span className="num metal-t">{fmtAmt(b.reserve, d)}</span> });
        rows.push({ label: t("play.ins.p.wallet"), value: <span className="num">{fmtAmt(b.wallet, d)}</span> });
        const cov = b.coverage;
        return (
          <section key={b.denom} className="pl-sub">
            <span className="label">{t("play.ins.p.sheet", { unit: u })}</span>
            <Ledger rows={rows} sum={{ label: t("play.ins.p.net"), value: <span className={`num${b.net > 0n ? " up" : ""}`}>{b.net > 0n ? "+" : ""}{fmtAmt(b.net, d)} {u}</span> }} />
            <div className="pl-cov">
              <span className="label">{t("play.ins.p.coverage")}</span>
              {cov.ratio === null ? (
                <p className="t-small">{t("play.ins.p.noLiab", { unit: u })}</p>
              ) : cov.collateral === 0n ? (
                <p className="t-small">{t("play.ins.p.noReserveLiab", { v: `${fmtAmt(cov.liabilities, d)} ${u}` })}</p>
              ) : (
                <>
                  <div className="pl-cov-v num">{pct(Math.round(cov.ratio * 100))}</div>
                  <CoverageMeter value={Math.round(cov.ratio * 100)} />
                  <p className="t-small dim">{pick(copy.thresholdsArePolicy, lang)}</p>
                </>
              )}
            </div>
            {b.counterparties.length > 0 && (
              <div className="pl-list">
                <span className="label">{t("play.ins.p.counterparties")}</span>
                {b.counterparties.slice(0, 12).map((c) => {
                  const owesMe = c.owesMe > 0n;
                  const issuer = owesMe ? c.id : id;
                  const receiver = owesMe ? id : c.id;
                  const rec = findNote(eco, issuer, receiver, b.denom);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="pl-row"
                      onClick={() => rec && onSelect({ kind: "note", tracker: rec.tracker, from: issuer, to: receiver, denom: b.denom })}
                      disabled={!rec}
                    >
                      <span className="pl-row-main">
                        <KeySeal pk={eco.p(c.id).pub} agent={eco.p(c.id).kind === "agent"} size={22} />
                        <span>{t("play.ins.p.owes", { a: displayName(eco, issuer, lang), b: displayName(eco, receiver, lang) })}</span>
                      </span>
                      <span className={`pl-row-end num${c.net > 0n ? " up" : ""}`}>{c.net > 0n ? "+" : ""}{fmtAmt(c.net, d)}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {b.reserves.length > 0 && (
              <div className="pl-list">
                <span className="label">{t("play.ins.p.reserves")}</span>
                {b.reserves.map((r) => (
                  <button key={r.id} type="button" className="pl-row" onClick={() => onSelect({ kind: "reserve", id: r.id })}>
                    <span className="pl-row-main">
                      <span className="pl-coin-dot" aria-hidden="true" />
                      <span className="mono">{r.id}</span>
                    </span>
                    <span className="pl-row-end num metal-t">{fmtAmt(r.collateral, d)} {u}</span>
                  </button>
                ))}
              </div>
            )}
          </section>
        );
      })}
      <section className="pl-sub">
        <span className="label">{t("play.ins.p.policy")}</span>
        <p className="t-small">
          {preset === "none" ? t("play.ins.p.noPolicy") : preset === "custom" ? t("play.ins.p.custom") : worldLookup(`world.policy.${preset}.name`, lang) ?? preset}
        </p>
        {preset !== "none" && preset !== "custom" && <p className="t-small dim">{worldLookup(`world.policy.${preset}.about`, lang)}</p>}
        {lines.length > 0 && (
          <div className="pl-list">
            <span className="label">{t("play.ins.p.lines")}</span>
            {lines.map((l) => {
              const u = unitOf(eco, l.denom);
              return (
                <div key={`${l.debtor}|${l.denom}`} className="pl-row static">
                  <span className="pl-row-main">{t("play.ins.p.lineFor", { name: displayName(eco, l.debtor, lang) })}</span>
                  <span className="pl-row-end num">{fmtAmt(l.limit, u.decimals)} {u.symbol}</span>
                </div>
              );
            })}
          </div>
        )}
        <p className="t-small dim">{t("play.foot.policy")}</p>
      </section>
    </div>
  );
}

function findNote(eco: Economy, issuer: string, receiver: string, denom: DenomId): NoteRecord | undefined {
  const I = eco.participants.get(issuer);
  const R = eco.participants.get(receiver);
  if (!I || !R) return undefined;
  for (const tr of eco.trackers.values()) {
    const rec = tr.note(I.pub, R.pub, denom);
    if (rec) return rec;
  }
  return undefined;
}

// ------------------------------------------------------------------------------------------------
// note
// ------------------------------------------------------------------------------------------------

function NotePanel({ eco, s, t, lang, free, past, act }: Props & { s: Extract<Sel, { kind: "note" }> }) {
  const tr = eco.t(s.tracker);
  const I = eco.p(s.from);
  const R = eco.p(s.to);
  const rec = tr.note(I.pub, R.pub, s.denom);
  const [sigOpen, setSigOpen] = useState(false);
  const u = unitOf(eco, s.denom);
  const v = eco.events.length;
  const hist = useMemo(() => (rec ? noteHistory(eco, s.from, s.to, s.denom, s.tracker) : []), [eco, v, rec, s.from, s.to, s.denom, s.tracker]);
  const pv = useMemo(() => (rec ? redemptionPreview(eco, s.to, s.from, s.denom, s.tracker) : null), [eco, v, rec, s.to, s.from, s.denom, s.tracker]);
  const ladder = useMemo(() => (rec ? ladderFromEconomy(eco, rec) : null), [eco, v, rec]);
  const xr = useMemo(() => (rec && sigOpen ? eco.xray(rec) : null), [eco, v, rec, sigOpen]);
  if (!rec) return null;
  const an = displayName(eco, s.from, lang);
  const bn = displayName(eco, s.to, lang);
  const status = tr.status(rec, eco.clock.height);
  const prev = rec.history.length > 1 ? rec.history[rec.history.length - 2].totalDebt : null;
  const limit = eco.creditLine(s.to, s.from, s.denom);
  const box = tr.currentBox();
  const state = rec.omitted ? "stale" : status === "local" ? "tracked" : "committed";
  const out = rec.totalDebt > rec.amountRedeemed ? rec.totalDebt - rec.amountRedeemed : 0n;
  const reserveBehind = eco.reservesOf(s.from, s.denom).some((r) => r.active && r.trackerNftId === tr.nftId);
  const last = hist.length ? hist[hist.length - 1] : null;
  let sigA: string | undefined;
  try {
    sigA = last?.signed ? rec.history[rec.history.length - 1].issuerSig ?? undefined : undefined;
  } catch {
    sigA = undefined;
  }
  return (
    <div className="pl-panel">
      <div className="pl-panel-h">
        <span className="label">{t("play.ins.n.title", { a: an, b: bn })}</span>
      </div>
      <div className="pl-note">
        <Note
          issuer={an}
          receiver={bn}
          issuerPk={I.pub}
          receiverPk={R.pub}
          noteKey={rec.key}
          amount={num(rec.totalDebt, u.decimals)}
          prev={prev !== null ? num(prev, u.decimals) : null}
          limit={limit ? num(limit, u.decimals) : 0}
          settled={num(rec.amountRedeemed, u.decimals)}
          unit={u.symbol}
          state={state}
          tracker={displayName(eco, tr.id, lang)}
          trackerId={tr.id}
          digest={box?.digest}
          block={last?.committed?.height}
          sigA={sigA}
          lite
          ariaLabel={t("play.ins.n.title", { a: an, b: bn })}
        />
      </div>
      <Ledger
        rows={[
          { label: t("play.ins.n.total"), value: <span className="num">{fmtAmt(rec.totalDebt, u.decimals)}</span> },
          { label: t("play.ins.n.redeemed"), value: <span className="num">{fmtAmt(rec.amountRedeemed, u.decimals)}</span> },
          ...(rec.waived > 0n ? [{ label: t("play.ins.n.waived"), value: <span className="num">{fmtAmt(rec.waived, u.decimals)}</span> }] : []),
          ...(limit ? [{ label: t("play.ins.n.limit"), value: <span className="num">{fmtAmt(limit, u.decimals)}</span> }] : []),
        ]}
        sum={{ label: t("play.ins.n.outstanding"), value: <span className="num">{fmtAmt(out > rec.waived ? out - rec.waived : 0n, u.decimals)} {u.symbol}</span> }}
      />
      {ladder && <StatusLadder {...ladder} unit={u} compact />}
      {pv && (
        <section className="pl-sub">
          {!reserveBehind ? (
            <p className="t-small">{t("play.ins.n.noReserve")}</p>
          ) : pv.canRedeemNow ? (
            <p className="t-small">
              <b>{t("play.ins.n.redeemNow", { v: `${fmtAmt(pv.maxAmount, u.decimals)} ${u.symbol}` })}</b>
            </p>
          ) : (
            <p className="t-small">
              {t("play.ins.n.cannot")}: {pv.blockers.map((b) => worldLookup(`world.redeem.blocker.${b}`, lang) ?? b).join(" · ")}
            </p>
          )}
          {free && !past && reserveBehind && pv.maxAmount > 0n && (pv.canRedeemNow || pv.path === "emergency") && (
            <Key variant="metal" hold onAct={() => act.redeem({ receiver: s.to, issuer: s.from, denom: s.denom, tracker: s.tracker, amount: pv.maxAmount, emergency: pv.path === "emergency" })}>
              {pv.path === "emergency" ? t("play.ins.n.emergency", { v: fmtAmt(pv.maxAmount, u.decimals) }) : t("play.ins.n.holdRedeem", { v: fmtAmt(pv.maxAmount, u.decimals) })}
            </Key>
          )}
          <p className="t-small dim">{pick(copy.fee, lang)}</p>
        </section>
      )}
      <section className="pl-sub">
        <span className="label">{t("play.ins.n.versions")}</span>
        <ol className="pl-ladder">
          {hist
            .slice(-8)
            .reverse()
            .map((h) => (
              <li key={h.index} className={`st-${h.state}${h.latest ? " latest" : ""}`}>
                <span className="pl-ver mono">v{h.index + 1}</span>
                <span className="num pl-ver-total">{fmtAmt(h.totalDebt, u.decimals)}</span>
                <span className="pl-ver-d num dim">+{fmtAmt(h.amount, u.decimals)}</span>
                <span className={`pl-ver-state ${h.state}`}>
                  <i aria-hidden="true" />
                  {t(`play.ins.n.state.${h.state}`)}
                  {h.committed ? ` · ${t("play.ins.n.atBlock", { h: int(h.committed.height) })}` : ""}
                </span>
              </li>
            ))}
        </ol>
        {hist.length > 8 && <p className="t-small dim">+{hist.length - 8}</p>}
        <p className="t-small dim">{t("play.ins.n.versionsHelp")}</p>
      </section>
      <section className="pl-sub">
        <span className="label">{t("play.ins.n.sig")}</span>
        <Key size="sm" variant="quiet" onClick={() => setSigOpen((x) => !x)} aria-expanded={sigOpen}>
          {sigOpen ? t("play.ins.n.hideSig") : t("play.ins.n.checkSig", { name: an })}
        </Key>
        {xr && <SignatureXray xray={xr} signer="issuer" unit={u} />}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// reserve
// ------------------------------------------------------------------------------------------------

function ReservePanel({ eco, id, t, lang, free, past, act, onSelect }: Props & { id: string }) {
  const r = eco.r(id);
  const ownerId = eco.idOf(r.owner) ?? "";
  const owner = displayName(eco, ownerId, lang);
  const tr = [...eco.trackers.values()].find((x) => x.nftId === r.trackerNftId) as TrackerSim | undefined;
  const u = unitOf(eco, r.denom);
  const v = eco.events.length;
  const data = useMemo(() => {
    const cov = eco.coverage(ownerId, r.denom, tr?.id);
    const backs: Array<{ label: string; amount: number; id: string }> = [];
    if (tr) {
      for (const rec of tr.notesOfIssuer(r.owner, r.denom)) {
        if (rec.receiver === r.owner) continue;
        const out = rec.totalDebt > rec.amountRedeemed ? rec.totalDebt - rec.amountRedeemed : 0n;
        if (out <= 0n) continue;
        const rid = eco.idOf(rec.receiver) ?? "";
        backs.push({ id: rid, label: displayName(eco, rid, lang), amount: num(out, u.decimals) });
      }
    }
    const paid: Array<{ id: string; redeemed: bigint; timestamp: bigint }> = [];
    for (const p of eco.participants.values()) {
      const x = r.redeemedFor(p.pub);
      if (x) paid.push({ id: p.id, redeemed: x.redeemed, timestamp: x.timestamp });
    }
    return { cov, backs, paid };
  }, [eco, v, r, ownerId, tr, lang, u.decimals]);
  const unlock = r.refundUnlockHeight();
  const r7 = unlock !== null ? unlock - REFUND_PERIOD_BLOCKS : null;
  const locked = r.active ? r.collateral() : 0n;
  const h = eco.clock.height;
  return (
    <div className="pl-panel">
      <div className="pl-panel-h">
        <div className="who-line">
          <KeySeal pk={r.owner} size="lg" rim />
          <div>
            <div className="t-h4">{t("play.ins.r.title", { name: owner })}</div>
            <div className="mono dim pl-mini">
              {/* the contract, the box and the tracker R6 binds it to: the details the scenario steps leave out */}
              {r.contract === "basis-token" ? "basis-token.es" : "basis.es"} · {short(r.box?.boxId ?? r.history[0]?.boxId ?? "", 6, 4)} · R6 → {tr ? displayName(eco, tr.id, lang) : "—"}
            </div>
          </div>
        </div>
      </div>
      {!r.active ? (
        <p className="t-body">{t("play.ins.r.closed")}</p>
      ) : (
        <>
          <div className="pl-locked">
            <span className="label">{t("ui.reserve.locked")}</span>
            <div className="t-money metal-t pl-locked-v">
              {fmtAmt(locked, u.decimals)}
              <span className="unit">{u.symbol}</span>
            </div>
          </div>
          {data.cov.ratio !== null && (
            <div className="pl-cov">
              <span className="label">{t("play.ins.p.coverage")}</span>
              <div className="pl-cov-v num">{pct(Math.round(data.cov.ratio * 100))}</div>
              <CoverageMeter value={Math.round(data.cov.ratio * 100)} />
              <p className="t-small dim">{pick(copy.coverageAdvisory, lang)}</p>
            </div>
          )}
          {data.backs.length > 0 && (
            <div className="pl-sub">
              <span className="label">{t("play.ins.r.backs")}</span>
              <BacksBar items={data.backs.map((b) => ({ label: b.label, amount: b.amount }))} locked={num(locked, u.decimals)} />
            </div>
          )}
        </>
      )}
      <section className="pl-sub">
        <span className="label">{t("play.ins.r.tree")}</span>
        {data.paid.length === 0 ? (
          <p className="t-small">{t("play.ins.r.treeEmpty")}</p>
        ) : (
          data.paid.map((x) => (
            <button key={x.id} type="button" className="pl-row" onClick={() => tr && onSelect({ kind: "note", tracker: tr.id, from: ownerId, to: x.id, denom: r.denom })}>
              <span className="pl-row-main">{displayName(eco, x.id, lang)}</span>
              <span className="pl-row-end num">{t("play.ins.r.paid", { v: `${fmtAmt(x.redeemed, u.decimals)} ${u.symbol}` })}</span>
            </button>
          ))
        )}
      </section>
      <ExitClocks height={h} boxCreationHeight={tr?.currentBox()?.creationHeight ?? null} r7={r7} trackerName={tr ? displayName(eco, tr.id, lang) : undefined} />
      <p className="t-small dim">{pick(copy.refundRule, lang)} {pick(copy.emergencyRule, lang)}</p>
      {free && !past && r.active && (
        <div className="pl-acts">
          <TopUpKey t={t} onTopUp={(amt) => act.topUp({ reserve: r.id, amount: amt })} decimals={u.decimals} symbol={u.symbol} />
          {!r.refundPending() ? (
            <Key variant="danger" hold size="sm" onAct={() => act.startExit(r.id)}>
              {t("play.ins.r.startExit")}
            </Key>
          ) : (
            <Key size="sm" onClick={() => act.completeExit(r.id)} disabled={unlock !== null && h < unlock}>
              {t("play.ins.r.completeExit")}
              {unlock !== null && h < unlock ? ` · ${blk(unlock - h, lang)}` : ""}
            </Key>
          )}
          <p className="t-small dim">{pick(r.contract === "basis-token" ? copy.topUpRuleToken : copy.topUpRule, lang)} {pick(copy.boundForever, lang)}</p>
        </div>
      )}
      <section className="pl-sub">
        <span className="label">{t("play.ins.r.history")}</span>
        <ol className="pl-hist">
          {r.history
            .slice(-6)
            .reverse()
            .map((e) => (
              <li key={e.boxId + e.action}>
                <span className="mono dim">{int(e.height)}</span>
                <span>{t(`play.ins.r.act.${e.action}`)}</span>
                <span className="num">{fmtAmt(r.contract === "basis-token" ? e.tokenAmount : e.value, u.decimals)}</span>
              </li>
            ))}
        </ol>
      </section>
    </div>
  );
}

function TopUpKey({ t, onTopUp, decimals, symbol }: { t: TFn; onTopUp: (amt: bigint) => void; decimals: number; symbol: string }) {
  const step = decimals >= 9 ? 1_000_000_000n : 10n ** BigInt(decimals);
  return (
    <Key variant="metal" size="sm" onClick={() => onTopUp(step)}>
      {t("play.ins.r.topUp")} +1 {symbol}
    </Key>
  );
}

// ------------------------------------------------------------------------------------------------
// tracker
// ------------------------------------------------------------------------------------------------

function TrackerPanel({ eco, id, t, lang, sel }: Props & { id: string }) {
  const tr = eco.t(id);
  const v = eco.events.length;
  const h = eco.clock.height;
  const box = tr.currentBox();
  const age = box ? h - box.creationHeight : null;
  const rows = useMemo(() => trackerTimeline(eco, id, { limit: 48 }), [eco, v, id]);
  const notes = useMemo(() => [...tr.notes.values()].filter((r) => r.issuer !== r.receiver), [tr, v]);
  const [pickKey, setPickKey] = useState<string>("");
  const chosen = notes.find((r) => r.key === pickKey) ?? notes.find((r) => tr.committedTotal(r.key) !== null) ?? notes[0];
  const proof = useMemo(() => {
    if (!box?.tree || !chosen) return null;
    try {
      return { digest: box.digest, proof: box.tree.proofFor(hexToBytes(chosen.key)), key: chosen.key, inTree: box.tree.get(hexToBytes(chosen.key)) !== undefined };
    } catch {
      return null;
    }
  }, [box, chosen, v]);
  const commits = rows.filter((r) => r.height >= h - 95).map((r) => r.height - (h - 95));
  const pairName = (r: NoteRecord) => `${displayName(eco, eco.idOf(r.issuer) ?? "", lang)} → ${displayName(eco, eco.idOf(r.receiver) ?? "", lang)}`;
  const u = chosen ? unitOf(eco, chosen.denom) : { symbol: "ERG", decimals: 9 };
  void sel;
  // the kit's tracker tile and card are made for a short code ("T-01"); the name stays in the heading
  const code = `T-${String([...eco.trackers.keys()].indexOf(id) + 1).padStart(2, "0")}`;
  return (
    <div className="pl-panel">
      <div className="pl-panel-h">
        <div className="who-line">
          {/* same rule as the kit card below: the tile greys once the box is 720 blocks old */}
          <TrackerTile id={code} stale={age !== null && age >= 720} />
          <div>
            <div className="t-h4">{displayName(eco, id, lang)}</div>
            <div className="mono dim pl-mini">
              {t("play.ins.t.title", { name: code })} · {short(tr.nftId, 4, 4)}
            </div>
          </div>
        </div>
        <div className="pl-tags">
          <Tag tone={tr.online ? "ok" : "watch"}>{tr.online ? t("play.ins.t.online") : t("play.ins.t.offline")}</Tag>
          {tr.censorship.mode !== "off" && <Tag tone="warn">{t(`play.tracker.${tr.censorship.mode}`)}</Tag>}
        </div>
        <p className="t-small">{tr.online ? t(`play.ins.t.censor.${tr.censorship.mode}`) : t("play.ins.t.darkNow")}</p>
        <Honest tracker={displayName(eco, id, lang)} />
      </div>
      {box ? (
        <TrackerCard id={code} nft={tr.nftId} blocksAgo={age ?? 0} height={h} notes={tr.notes.size} digest={box.digest} commits={commits} trackerId={tr.id} footnote={tr.online ? pick(copy.sandboxLabel, lang) : t("play.ins.t.cardDark")} />
      ) : (
        <p className="t-small">{t("play.ins.t.noBox")}</p>
      )}
      {age !== null && (age >= 720 || !tr.online) && (
        // the card above already shows the box-age badge; a second one here would read "on time" for a dark server
        <div className="pl-eclipse">
          <EclipseCard id={displayName(eco, id, lang)} silentBlocks={age} />
        </div>
      )}
      {rows.length > 0 && (
        <section className="pl-sub">
          <span className="label">{t("play.ins.t.timeline")}</span>
          <ol className="pl-hist">
            {rows.slice(0, 6).map((r) => (
              <li key={r.boxId}>
                <span className="mono dim">{int(r.height)}</span>
                <span>
                  {t("play.ins.t.row", { notes: t.p("play.stage.notes", r.notes, { n: int(r.notes) }), d: String(r.depth) })}
                  {r.heartbeat ? ` · ${t("play.ins.t.heartbeat")}` : ""}
                </span>
                <span className="mono dim">{short(r.digest, 4, 4)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
      <section className="pl-sub">
        <span className="label">{t("play.ins.t.proof")}</span>
        {notes.length === 0 ? (
          <p className="t-small">{t("play.ins.t.noNotes")}</p>
        ) : (
          <>
            <label className="pl-field">
              <span className="pl-field-l">{t("play.ins.t.proofPick")}</span>
              <select className="pl-sel" value={chosen?.key ?? ""} onChange={(e) => setPickKey(e.target.value)}>
                {notes.slice(0, 60).map((r) => (
                  <option key={r.key} value={r.key}>
                    {pairName(r)} · {fmtAmt(r.totalDebt, unitOf(eco, r.denom).decimals)} {unitOf(eco, r.denom).symbol}
                  </option>
                ))}
              </select>
            </label>
            {proof && !proof.inTree && <p className="t-small">{t("play.ins.t.notInTree")}</p>}
            {proof && <AvlProofViewer digest={proof.digest} proof={proof.proof} lookupKey={proof.key} keyLabel={chosen ? pairName(chosen) : undefined} backend={eco.avl} valueKind="tracker" unit={u} />}
            {!box && <p className="t-small">{t("play.ins.t.noBox")}</p>}
          </>
        )}
      </section>
    </div>
  );
}

/** Words for a refusal code: world code text, else the contract check's title, else the engine message. */
export function reasonWords(code: string | undefined, message: string | undefined, lang: Lang): string {
  if (code) {
    const w = worldLookup(`world.code.${code}`, lang);
    if (w) return w;
    const r = (reserveCheckReasons as Record<string, { title: { en: string; ru: string } } | undefined>)[code];
    if (r) return pick(r.title, lang);
  }
  return message ?? code ?? "";
}

export type { ReserveSim };
