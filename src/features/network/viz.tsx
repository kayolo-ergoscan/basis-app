// Local pictures for mainnet data. The kit's Coin, Heartbeat and Graph are built for the sandbox (a coverage ring,
// a 96-block rhythm, a debt graph with limits); mainnet has no coverage, months of history and no public debt graph,
// so these are small local versions (listed as gaps in the report). Tokens only; marks are aria-hidden or labelled.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app";
import { KeySeal, useUid } from "@/ui";
import type { ExitClass, Observatory, RedemptionView, TokenKind, TrackerView } from "@/chain";
import { monthStarts, type ChainClock } from "./clock";
import { amount, AXIS_CH_PX, axisEdge, blocks, date, height as fmtH, keyOfAddress, monthLabel, sAddr, tokenUnit, type Lang } from "./fmt";
import { ExitTag, NftTile, UntrustedName, TrackerTag, trackerSilent } from "./parts";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** Width of an element, live (ResizeObserver). 0 until measured. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.round(el.getBoundingClientRect().width));
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((es) => {
      const cw = Math.round(es[0].contentRect.width);
      setW((p) => (p === cw ? p : cw));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/* ============ Vault coin: metal = ERG or tokens locked on Ergo; no coverage ring (unknowable on mainnet) ============ */
export type CoinUnit = "erg" | TokenKind;
const REEDS = (() => {
  let d = "";
  for (let i = 0; i < 80; i++) {
    const a = (i / 80) * Math.PI * 2;
    d += `M${(50 + 44.5 * Math.cos(a)).toFixed(2)} ${(50 + 44.5 * Math.sin(a)).toFixed(2)}L${(50 + 48 * Math.cos(a)).toFixed(2)} ${(50 + 48 * Math.sin(a)).toFixed(2)}`;
  }
  return d;
})();
const GUILLOCHE = (() => {
  // a quiet rosette: 3 offset circles × 12 turns, engraved into the field
  let d = "";
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2, ox = 50 + 7 * Math.cos(a), oy = 50 + 7 * Math.sin(a);
    d += `M${(ox + 22).toFixed(2)} ${oy.toFixed(2)}A22 22 0 1 0 ${(ox - 22).toFixed(2)} ${oy.toFixed(2)}A22 22 0 1 0 ${(ox + 22).toFixed(2)} ${oy.toFixed(2)}`;
  }
  return d;
})();
export function VaultCoin({ unit, size = 64, spent, plain, className, style }: { unit: CoinUnit; size?: number; spent?: boolean; plain?: boolean; className?: string; style?: CSSProperties }) {
  const gid = useUid("vc");
  const label = unit === "erg" ? "ERG" : unit === "other" ? "TOK" : unit === "sigusd" ? "SIG" : unit === "rsada" ? "ADA" : "USE";
  const small = size < 44;
  return (
    <svg className={cx("nw-coin", spent && "spent", unit === "use-lookalike" && "test", unit !== "erg" && "tok", className)} viewBox="0 0 100 100" width={size} height={size} aria-hidden="true" style={style}>
      <defs>
        <radialGradient id={gid} cx="34%" cy="28%" r="82%">
          <stop offset="0" className="s0" />
          <stop offset=".42" className="s1" />
          <stop offset="1" className="s2" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="48" className="face" fill={spent ? "none" : `url(#${gid})`} />
      {!small && <path d={REEDS} className="reeds" />}
      {!small && !spent && <path d={GUILLOCHE} className="rose" />}
      <circle cx="50" cy="50" r={small ? 36 : 39} className="ring" />
      {!plain && !small && <text x="50" y={unit === "use-lookalike" ? 54 : 57} textAnchor="middle" className="lbl">{label}</text>}
      {!plain && !small && unit === "use-lookalike" && <text x="50" y="70" textAnchor="middle" className="sub">TEST</text>}
    </svg>
  );
}

/* ============ Beat strip: a tracker's boxes bucketed over a block range ============ */
export interface BeatStripProps {
  tracker: TrackerView;
  from: number;
  to: number;
  n?: number;
  /** Mark the last bucket as the chain tip ("now"). */
  tip?: boolean;
  className?: string;
  label?: string;
  tall?: boolean;
}
/** 0 quiet · 1 a box re-posting the same digest · 2 a new all-zero digest · 3 a new digest. */
export function bucketBeats(tracker: TrackerView, from: number, to: number, n: number): Uint8Array {
  const out = new Uint8Array(n);
  const span = Math.max(1, to - from);
  const idx = (h: number) => Math.min(n - 1, Math.max(0, Math.floor(((h - from) / span) * n)));
  for (const h of tracker.beats) if (h >= from && h <= to) { const i = idx(h); if (out[i] < 1) out[i] = 1; }
  for (const c of tracker.commits) if (c.height >= from && c.height <= to) { const i = idx(c.height); const v = c.zero ? 2 : 3; if (out[i] < v) out[i] = v; }
  return out;
}
const BEAT_CLS = [undefined, "b", "z", "c"] as const;
export function BeatStrip({ tracker, from, to, n = 96, tip, className, label, tall }: BeatStripProps) {
  const t = useT();
  const bars = useMemo(() => bucketBeats(tracker, from, to, n), [tracker, from, to, n]);
  const silent = trackerSilent(tracker);
  const commits = tracker.commits.filter((c) => c.height >= from && c.height <= to).length;
  const boxes = tracker.beats.filter((h) => h >= from && h <= to).length;
  return (
    <div className={cx("nw-beats", silent && "silent", tall && "tall", className)} role="img"
      aria-label={label ?? t("network.td.beatsAria", { boxes: fmtH(boxes), commits: fmtH(commits), from: fmtH(from), to: fmtH(to) })}>
      {Array.from(bars, (v, i) => <i key={i} className={i === n - 1 && tip && !silent ? "now" : BEAT_CLS[v]} />)}
    </div>
  );
}

/* ============ Lanes: every tracker NFT on one block axis ============ */
interface LaneEnd { kind: "burn" | "lock" | "box" | "none"; height: number }
function laneEnd(tr: TrackerView, tip: number): LaneEnd {
  if (tr.status === "burned") return { kind: "burn", height: tr.evidence.height ?? tr.lastTrackerBox?.height ?? tip };
  if (tr.status === "locked") return { kind: "lock", height: tr.evidence.height ?? tr.lastTrackerBox?.height ?? tip };
  if (tr.lastTrackerBox?.unspent) return { kind: "box", height: tr.lastTrackerBox.height };
  return { kind: "none", height: tip };
}
export function TrackerLanes({ obs, trackers, clock }: { obs: Observatory; trackers: TrackerView[]; clock: ChainClock }) {
  const t = useT();
  const lang = t.lang as Lang;
  const tip = obs.height;
  const from = useMemo(() => Math.min(...trackers.map((x) => x.mint.height)) - 2000, [trackers]);
  const span = tip - from;
  const pct = (h: number) => `${(((h - from) / span) * 100).toFixed(3)}%`;
  const months = useMemo(() => monthStarts(clock.toTime(from), clock.toTime(tip)).map((ms) => ({ ms, h: clock.toHeight(ms) })), [clock, from, tip]);
  const [axRef, axW] = useWidth<HTMLDivElement>();
  const tipGap = axW ? 96 / axW : 0.08; // keep month labels clear of the tip label
  const paths = useMemo(() => trackers.map((tr) => {
    const x = (h: number) => (((h - from) / span) * 1000).toFixed(2);
    const commitH = new Set(tr.commits.map((c) => c.height));
    const zeroH = new Set(tr.commits.filter((c) => c.zero).map((c) => c.height));
    let box = "", com = "", zero = "";
    for (const h of tr.beats) { if (!commitH.has(h)) box += `M${x(h)} 13V23`; }
    for (const c of tr.commits) { if (zeroH.has(c.height)) zero += `M${x(c.height)} 4V23`; else com += `M${x(c.height)} 2V23`; }
    const end = laneEnd(tr, tip);
    const last = tr.lastTrackerBox?.height ?? null;
    const life = `M${x(tr.mint.height)} 23H${x(end.kind === "box" || end.kind === "none" ? tip : end.height)}`;
    const quiet = last != null && (end.kind === "box" || end.kind === "none") ? `M${x(last)} 18H${x(tip)}` : "";
    return { box, com, zero, life, quiet, end, last };
  }), [trackers, from, span, tip]);
  return (
    <div className="nw-lanes" role="group" aria-label={t("network.tl.lanesAria", { n: trackers.length, from: fmtH(from), to: fmtH(tip) })}>
      {trackers.map((tr, i) => {
        const p = paths[i];
        return (
          <div className="nw-lane" key={tr.nft}>
            <Link className="nw-lane-l" to={`/network/tracker/${tr.nft}`} aria-label={t("network.trk.open", { id: tr.nft.slice(0, 8) })}>
              <NftTile nft={tr.nft} silent={trackerSilent(tr)} size="sm" />
              <span className="nw-lane-n"><span className="hex">{tr.nft.slice(0, 8)}</span><UntrustedName name={tr.name} /></span>
              <TrackerTag tr={tr} />
            </Link>
            <div className="nw-lane-r" aria-hidden="true">
              <svg viewBox="0 0 1000 24" preserveAspectRatio="none">
                <path d={p.life} className="life" vectorEffect="non-scaling-stroke" />
                {p.quiet && <path d={p.quiet} className="quiet" vectorEffect="non-scaling-stroke" />}
                <path d={p.box} className="box" vectorEffect="non-scaling-stroke" />
                <path d={p.zero} className="zero" vectorEffect="non-scaling-stroke" />
                <path d={p.com} className="com" vectorEffect="non-scaling-stroke" />
              </svg>
              <span className="mint" style={{ left: pct(tr.mint.height) }} />
              {p.end.kind === "burn" && <span className="end burn" style={{ left: pct(p.end.height) }}>✕</span>}
              {p.end.kind === "lock" && <span className="end lock" style={{ left: pct(p.end.height) }}>⊘</span>}
              {p.end.kind === "box" && <span className="end box" style={{ left: pct(p.end.height) }} />}
            </div>
          </div>
        );
      })}
      <div className="nw-lane nw-lane-axis" aria-hidden="true">
        <div className="nw-lane-l" />
        <div className="nw-lane-r" ref={axRef}>
          {months.filter((m) => m.h > from && (tip - m.h) / span > tipGap).map((m, i) => (
            <span key={m.ms} className="tick" style={{ left: pct(m.h) }}>{monthLabel(m.ms, lang, i === 0 && axW >= 640)}</span>
          ))}
          <span className="tick tip" style={{ left: "100%" }}>{fmtH(tip)}</span>
        </div>
      </div>
      <div className="nw-legend" aria-hidden="true">
        <span><i className="lg-com" />{t("network.tl.lg.commit")}</span>
        <span><i className="lg-box" />{t("network.tl.lg.box")}</span>
        <span><i className="lg-zero" />{t("network.tl.lg.zero")}</span>
        <span><i className="lg-end box" />{t("network.tl.lg.now")}</span>
        <span><b className="lg-burn">✕</b>{t("network.tl.lg.burn")}</span>
        <span><b>⊘</b>{t("network.tl.lg.lock")}</span>
      </div>
    </div>
  );
}

/* ============ Redemption timeline: one stem per redemption, a lane per unit ============ */
type UnitKey = "erg" | TokenKind;
const UNIT_ORDER: UnitKey[] = ["erg", "use", "use-lookalike", "sigusd", "rsada", "other"];
export const unitOf = (r: RedemptionView): UnitKey => (r.unit === "erg" ? "erg" : (r.token?.kind ?? "other"));
const decOf = (r: RedemptionView) => (r.unit === "erg" ? 9 : r.token?.decimals ?? 0);
/** "date · tracker box age N" of a redemption; block and "checking…" while its transaction is not read (fromBoxes). */
const whenLine = (r: RedemptionView, lang: Lang, t: ReturnType<typeof useT>) => r.fromBoxes
  ? `${t("network.rd.block", { h: fmtH(r.height) })} · ${t("network.rd.unread")}`
  : `${date(r.at, lang)} · ${t("network.rd.age", { age: blocks(r.tracker?.age ?? 0, lang) })}`;
export const redemptionAmount = (r: RedemptionView, lang: Lang) => `${amount(r.amount, decOf(r))} ${tokenUnit(unitOf(r), lang)}`;


/** Stem positions on one lane, oldest first: at least `gap` apart and inside [0, plotW]. A burst at the newest end (six
 *  redemptions in a day) is pushed back from the right edge instead of past it, which made a phone page scroll sideways. */
export function spreadStems(xs: number[], gap: number, plotW: number): number[] {
  const out = [...xs];
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i], out[i - 1] + gap);
  let next = plotW;
  for (let i = out.length - 1; i >= 0; i--) { out[i] = Math.min(out[i], next); next = out[i] - gap; }
  return out.map((x) => Math.max(0, x));
}
export function RedemptionTimeline({ list, clock, tip }: { list: RedemptionView[]; clock: ChainClock; tip: number }) {
  const t = useT();
  const lang = t.lang as Lang;
  const [ref, w] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<string | null>(null);
  const lanes = useMemo(() => UNIT_ORDER.map((u) => ({ u, items: list.filter((r) => unitOf(r) === u) })).filter((l) => l.items.length), [list]);
  const t0 = useMemo(() => {
    const first = Math.min(...list.map((r) => clock.toTime(r.height)));
    const d = new Date(first);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  }, [list, clock]);
  const t1 = clock.toTime(tip);
  const labelW = w < 640 ? 0 : 132;
  const plotW = Math.max(10, w - labelW - 12);
  const LANE = w < 640 ? 92 : 112;
  const placed = useMemo(() => {
    const out = new Map<string, { x: number; hPx: number; lane: number }>();
    lanes.forEach((l, li) => {
      const vals = l.items.map((r) => Number(r.amount) / 10 ** decOf(r));
      const max = Math.max(...vals);
      const sorted = [...l.items].sort((a, b) => a.height - b.height || (a.ts ?? 0) - (b.ts ?? 0));
      const xs = spreadStems(sorted.map((r) => ((clock.toTime(r.height) - t0) / (t1 - t0)) * plotW), w < 640 ? 7 : 9, plotW);
      sorted.forEach((r, i) => {
        const v = Number(r.amount) / 10 ** decOf(r);
        out.set(r.tx, { x: xs[i], hPx: Math.max(6, (v / max) * (LANE - 34)), lane: li });
      });
    });
    return out;
  }, [lanes, clock, t0, t1, plotW, w, LANE]);
  const months = useMemo(() => monthStarts(t0 - 1, t1), [t0, t1]);
  const act = active ? list.find((r) => r.tx === active) ?? null : null;
  const actPos = act ? placed.get(act.tx) : null;
  const H = lanes.length * LANE;
  const PH = H + 30; // plot height: lanes + the month axis below them
  return (
    <div className="nw-tl" ref={ref} role="group"
      aria-label={t("network.rp.tlAria", { n: list.length, from: date(new Date(t0).toISOString(), lang), to: date(new Date(t1).toISOString(), lang) })}>
      {w > 0 && (
        <div className="nw-tl-plot" style={{ height: PH }}>
          {lanes.map((l, li) => (
            <div key={l.u} className="nw-tl-lane" style={{ top: li * LANE, height: LANE }}>
              <span className="nw-tl-lbl" style={labelW ? { width: labelW } : undefined}>
                <b>{tokenUnit(l.u, lang)}</b>
                <span>{t("network.rp.count", { n: l.items.length })}</span>
              </span>
              <span className="nw-tl-base" style={{ left: labelW, right: 0 }} />
            </div>
          ))}
          {months.map((ms, i) => {
            const x = labelW + ((ms - t0) / (t1 - t0)) * plotW;
            // the first tick names the year where there is room for it (as on the trackers' axis), so "Mar … Nov" is
            // never ambiguous; a label that would cross the plot's edge (the first tick sits on it on a phone) is set
            // inside the plot instead of being cut
            const label = monthLabel(ms, lang, i === 0 && w >= 640);
            const edge = axisEdge(x, label.length * AXIS_CH_PX, w);
            return <span key={ms} className="nw-tl-month" style={{ left: x, height: H }}><i className={edge ?? undefined}>{label}</i></span>;
          })}
          {list.map((r) => {
            const p = placed.get(r.tx);
            if (!p) return null;
            const bottom = PH - (p.lane + 1) * LANE + 14;
            return (
              <Link key={r.tx} to={`/network/tx/${r.tx}`}
                className={cx("nw-stem", r.emergencyWindow && "em", r.firstOfPair && "first", active === r.tx && "on")}
                style={{ left: labelW + p.x, bottom, height: p.hPx }}
                aria-label={`${redemptionAmount(r, lang)} · ${whenLine(r, lang, t)}${r.emergencyWindow ? ` · ${t("network.rd.em")}` : ""}`}
                onMouseEnter={() => setActive(r.tx)} onMouseLeave={() => setActive((a) => (a === r.tx ? null : a))}
                onFocus={() => setActive(r.tx)} onBlur={() => setActive((a) => (a === r.tx ? null : a))}>
                <i />
              </Link>
            );
          })}
          {act && actPos && (
            <div className="nw-tip" role="presentation"
              style={{ left: Math.min(Math.max(labelW + actPos.x, 110), w - 110), bottom: PH - (actPos.lane + 1) * LANE + 14 + actPos.hPx + 14 }}>
              <b>{redemptionAmount(act, lang)}</b>
              <span>{whenLine(act, lang, t)}</span>
              {act.emergencyWindow && <span className="em">⚑ {t("network.rd.em")}</span>}
            </div>
          )}
        </div>
      )}
      <div className="nw-legend" aria-hidden="true">
        <span><i className="lg-stem" />{t("network.rp.count", { n: list.length })}</span>
        <span><i className="lg-stem em" />{t("network.rp.emLegend")}</span>
        <span><i className="lg-stem first" />{t("network.rp.firstLegend")}</span>
      </div>
    </div>
  );
}

/* ============ Redemption graph: reserve owners → receivers ============ */
export interface FlowEdge { owner: string; receiver: string; n: number; sums: Map<UnitKey, bigint>; dec: Map<UnitKey, number> }
export interface FlowNode { id: string; key: string | null; label: string | null; n: number }
export function flowModel(list: RedemptionView[]) {
  const edges = new Map<string, FlowEdge>();
  const owners = new Map<string, FlowNode>(), receivers = new Map<string, FlowNode>();
  for (const r of list) {
    // "?": the transaction is not read yet (seen in the reserve's boxes); "—": read, and no output pays the amount
    const o = r.owner.addr ?? r.owner.key ?? "?", rc = r.receiver ?? (r.fromBoxes ? "?" : "—");
    const k = `${o}|${rc}`;
    const e = edges.get(k) ?? { owner: o, receiver: rc, n: 0, sums: new Map(), dec: new Map() };
    e.n++;
    const u = unitOf(r);
    e.sums.set(u, (e.sums.get(u) ?? 0n) + r.amount);
    e.dec.set(u, decOf(r));
    edges.set(k, e);
    const on = owners.get(o) ?? { id: o, key: r.owner.key, label: r.ownerLabel, n: 0 };
    on.n++; owners.set(o, on);
    const rn = receivers.get(rc) ?? { id: rc, key: keyOfAddress(r.receiver), label: r.receiverLabel, n: 0 };
    rn.n++; receivers.set(rc, rn);
  }
  const rs = [...receivers.values()].sort((a, b) => b.n - a.n);
  const rIdx = new Map(rs.map((r, i) => [r.id, i]));
  const bary = (o: FlowNode) => {
    let s = 0, n = 0;
    for (const e of edges.values()) if (e.owner === o.id) { s += (rIdx.get(e.receiver) ?? 0) * e.n; n += e.n; }
    return n ? s / n : 0;
  };
  const os = [...owners.values()].sort((a, b) => bary(a) - bary(b) || b.n - a.n);
  return { owners: os, receivers: rs, edges: [...edges.values()] };
}
export const sumsText = (e: Pick<FlowEdge, "sums" | "dec">, lang: Lang) =>
  UNIT_ORDER.filter((u) => e.sums.has(u)).map((u) => `${amount(e.sums.get(u)!, e.dec.get(u) ?? 0)} ${tokenUnit(u, lang)}`).join(" + ");

export function FlowGraph({ list }: { list: RedemptionView[] }) {
  const t = useT();
  const lang = t.lang as Lang;
  const [ref, w] = useWidth<HTMLDivElement>();
  const [hot, setHot] = useState<string | null>(null);
  const m = useMemo(() => flowModel(list), [list]);
  // "?" gathers redemptions whose transaction is not read yet (seen in the reserve's boxes): no receiver to show yet
  const unread = t("network.rd.unread");
  const nodeName = (id: string) => (id === "?" ? unread : sAddr(id));
  const phone = w < 640;
  const ROW = phone ? 46 : 58;
  const NODE = phone ? 118 : 236;
  const H = Math.max(m.owners.length, m.receivers.length) * ROW;
  const oy = (i: number) => (H - m.owners.length * ROW) / 2 + i * ROW + ROW / 2;
  const ry = (i: number) => (H - m.receivers.length * ROW) / 2 + i * ROW + ROW / 2;
  const oI = new Map(m.owners.map((o, i) => [o.id, i]));
  const rI = new Map(m.receivers.map((r, i) => [r.id, i]));
  const maxN = Math.max(...m.edges.map((e) => e.n));
  const x0 = NODE, x1 = Math.max(NODE + 40, w - NODE);
  const lit = (e: FlowEdge) => !hot || hot === e.owner || hot === e.receiver || hot === `${e.owner}|${e.receiver}`;
  const node = (n: FlowNode, side: "o" | "r", y: number) => (
    <button key={side + n.id} type="button" className={cx("nw-fnode", side, hot === n.id && "on")} style={{ left: side === "o" ? 0 : x1, top: y - ROW / 2, height: ROW, width: side === "o" ? NODE : Math.max(80, w - x1) }}
      onMouseEnter={() => setHot(n.id)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(n.id)} onBlur={() => setHot(null)}
      aria-label={`${n.label ?? nodeName(n.id)}: ${t("network.rp.count", { n: n.n })}`}>
      {n.key ? <KeySeal pk={n.key} size={phone ? 28 : 36} /> : <span className="nw-noseal" style={{ width: phone ? 28 : 36 }} />}
      <span className="t">
        {n.id === "?" ? <span className="dim">{unread}</span> : <span className="hex">{phone ? n.id.slice(0, 6) + "…" : sAddr(n.id)}</span>}
        {n.label && <span className="nw-label">{n.label}</span>}
        <span className="c">{n.n}×</span>
      </span>
    </button>
  );
  return (
    <div className="nw-flow" ref={ref} role="group" aria-label={t("network.gr.aria", { owners: m.owners.length, receivers: m.receivers.length, n: list.length })}>
      <div className="nw-flow-h" aria-hidden="true"><span className="label">{t("network.gr.owners")}</span><span className="label">{t("network.gr.receivers")}</span></div>
      {w > 0 && (
        <div className="nw-flow-plot" style={{ height: H }}>
          <svg width={w} height={H} aria-hidden="true">
            {m.edges.map((e) => {
              const ya = oy(oI.get(e.owner) ?? 0), yb = ry(rI.get(e.receiver) ?? 0);
              const mx = (x0 + x1) / 2;
              const sw = 1.5 + 6 * Math.sqrt(e.n / maxN);
              return (
                <g key={e.owner + e.receiver} className={cx("edge", !lit(e) && "dim")}>
                  <path d={`M${x0} ${ya}C${mx} ${ya} ${mx} ${yb} ${x1 - 7} ${yb}`} strokeWidth={sw} />
                  <path d={`M${x1 - 8} ${yb - 4.5}L${x1} ${yb}L${x1 - 8} ${yb + 4.5}Z`} className="head" />
                </g>
              );
            })}
          </svg>
          {m.owners.map((o, i) => node(o, "o", oy(i)))}
          {m.receivers.map((r, i) => node(r, "r", ry(i)))}
          {hot && m.edges.filter((e) => e.owner === hot || e.receiver === hot).map((e) => {
            const ya = oy(oI.get(e.owner) ?? 0), yb = ry(rI.get(e.receiver) ?? 0);
            return (
              <span key={"p" + e.owner + e.receiver} className="nw-fpill" style={{ left: (x0 + x1) / 2, top: (ya + yb) / 2 }}>
                {e.n}× · {sumsText(e, lang)}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============ Detector beacon: calm and static; one ping per new check (one event = one pulse) ============ */
export function Beacon({ found, checked, size = 132 }: { found: number; checked: number | null; size?: number }) {
  const [ping, setPing] = useState(false);
  const last = useRef<number | null>(checked);
  useEffect(() => {
    if (checked == null || checked === last.current) return;
    last.current = checked;
    setPing(true);
    const id = setTimeout(() => setPing(false), 1600);
    return () => clearTimeout(id);
  }, [checked]);
  const ticks = useMemo(() => {
    let d = "";
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * Math.PI * 2, big = i % 6 === 0, r1 = 58, r2 = big ? 52 : 55;
      d += `M${(66 + r1 * Math.cos(a)).toFixed(2)} ${(66 + r1 * Math.sin(a)).toFixed(2)}L${(66 + r2 * Math.cos(a)).toFixed(2)} ${(66 + r2 * Math.sin(a)).toFixed(2)}`;
    }
    return d;
  }, []);
  return (
    <svg className={cx("nw-beacon", found > 0 && "found", ping && "ping")} viewBox="0 0 132 132" width={size} height={size} aria-hidden="true">
      <path d={ticks} className="ticks" />
      <circle cx="66" cy="66" r="44" className="r1" />
      <circle cx="66" cy="66" r="28" className="r2" />
      <path d="M66 14V118M14 66H118" className="cross" />
      <circle cx="66" cy="66" r="12" className="ping-ring" />
      <circle cx="66" cy="66" r="7" className="core" />
      {/* the two current templates, as marks on the ring */}
      <path d="M100.2 28.6l4.4-4.6M31.8 103.4l-4.4 4.6" className="tpl" />
    </svg>
  );
}

/* ============ Exit bar: unspent boxes by exit class ============ */
export function ExitBar({ rows, total, note }: { rows: { cls: ExitClass; boxes: number; sub?: ReactNode }[]; total: number; note?: ReactNode }) {
  const t = useT();
  return (
    <div className="nw-exitbar">
      <div className="bar" role="img" aria-label={rows.map((r) => `${t(`chain.exit.${r.cls}.short`)}: ${r.boxes}`).join(", ")}>
        {rows.filter((r) => r.boxes > 0).map((r) => <span key={r.cls} className={`x-${r.cls.replace(/\+/g, "-")}`} style={{ flexGrow: r.boxes }} title={`${t(`chain.exit.${r.cls}.short`)} · ${r.boxes}`} />)}
      </div>
      <div className="legend">
        {rows.filter((r) => r.boxes > 0).map((r) => (
          <div key={r.cls} className="row">
            <i className={`sw x-${r.cls.replace(/\+/g, "-")}`} aria-hidden="true" />
            <ExitTag cls={r.cls} />
            <b className="num">{r.boxes}</b>
            {r.sub && <span className="sub">{r.sub}</span>}
          </div>
        ))}
        {note}
      </div>
      <span className="sr-only">{total}</span>
    </div>
  );
}
