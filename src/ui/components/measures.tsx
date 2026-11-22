// Measures (VISUAL §9, §12.5–12.7): CoverageMeter (linear, the primary form), Coin (reserve coin with its ring),
// CapBar, MiniCap, BackedTrustBar, BacksBar, Dial (dead-man switch), Heartbeat, Ledger, Wheels, OdoLedger, Tear,
// GrowthPreview. Ports of the tile's meterHTML, coinSVG, dialSVG, beats and wheels.
import { useMemo, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { useUid } from "../hooks";
import { int, money, pct as fmtPct } from "../engine/money";
import { useUiSettings } from "../settings";
import { coverageBand } from "./primitives";

const priv = (on: boolean, s: string) => (on ? "•••" : s);

/* ---------- CoverageMeter ---------- */
export interface CoverageMeterProps {
  /** Coverage in percent (132 = 132 %). */
  value: number;
  /** Dashed ghost needle for the before value (146 → 132). */
  ghost?: number;
  /** Show the Under / Warn / Watch / Fine scale (default true). */
  scale?: boolean;
  className?: string;
  style?: CSSProperties;
}
/** Linear coverage meter, 50 … 200 %, zones at the wallet-policy thresholds 100 / 120 / 150 %. */
export function CoverageMeter({ value, ghost, scale = true, className, style }: CoverageMeterProps) {
  const t = useT();
  const lo = 50, hi = 200;
  const x = (p: number) => (((Math.min(hi, Math.max(lo, p)) - lo) / (hi - lo)) * 100);
  const band = coverageBand(value);
  return (
    <div className={["meter", className].filter(Boolean).join(" ")} style={style} role="meter" aria-valuemin={0} aria-valuemax={200} aria-valuenow={Math.round(value)}
      aria-valuetext={t("ui.meter.aria", { pct: fmtPct(value), band: t(`ui.cov.${band}`) }) + (ghost != null ? ` · ${t("ui.meter.was", { pct: fmtPct(ghost) })}` : "")}>
      <div className="track">
        <i className="zone z-under" style={{ left: 0, width: `${x(100)}%` }} />
        <i className="zone z-warn" style={{ left: `${x(100)}%`, width: `${x(120) - x(100)}%` }} />
        <i className="zone z-watch" style={{ left: `${x(120)}%`, width: `${x(150) - x(120)}%` }} />
        <i className="fill" style={{ width: `${x(value)}%` }} />
        {[100, 120, 150].map((p) => <i key={p} className="tick" style={{ left: `${x(p)}%` }}><span>{p}</span></i>)}
        {ghost != null && <i className="ghost" style={{ left: `${x(ghost)}%` }} />}
        <i className="needle" style={{ left: `${x(value)}%` }} />
      </div>
      {scale && <div className="scale" aria-hidden="true"><span>{t("ui.cov.under")}</span><span>{t("ui.cov.warn")}</span><span>{t("ui.cov.watch")}</span><span>{t("ui.cov.fine")}</span></div>}
    </div>
  );
}

/* ---------- Coin ---------- */
export interface CoinProps { coverage: number; size?: number; label?: boolean; className?: string }
/** The reserve coin (metal) with its coverage ring 0–200 %, ticks at 100 / 120 / 150 and a needle dot. */
export function Coin({ coverage, size = 170, label = true, className }: CoinProps) {
  const t = useT();
  const gid = useUid("cg");
  const svg = useMemo(() => {
    const R = 54, cx = 85, cy = 85, a0 = -220, a1 = 40;
    const ang = (p: number) => ((a0 + ((a1 - a0) * Math.min(200, p)) / 200) * Math.PI) / 180;
    const P = (p: number) => [cx + 72 * Math.cos(ang(p)), cy + 72 * Math.sin(ang(p))];
    const arc = (p0: number, p1: number, r: number) => {
      const x0 = cx + r * Math.cos(ang(p0)), y0 = cy + r * Math.sin(ang(p0)), x1 = cx + r * Math.cos(ang(p1)), y1 = cy + r * Math.sin(ang(p1));
      const large = ang(p1) - ang(p0) > Math.PI ? 1 : 0;
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    const ticks = [100, 120, 150].map((p) => {
      const a = ang(p);
      return `<line x1="${(cx + 66 * Math.cos(a)).toFixed(1)}" y1="${(cy + 66 * Math.sin(a)).toFixed(1)}" x2="${(cx + 80 * Math.cos(a)).toFixed(1)}" y2="${(cy + 80 * Math.sin(a)).toFixed(1)}" stroke="var(--ink-2)" stroke-width="1.2"/><text x="${(cx + 92 * Math.cos(a)).toFixed(1)}" y="${(cy + 92 * Math.sin(a) + 3).toFixed(1)}" text-anchor="middle" font-family="var(--f-mono)" font-size="8.5" fill="var(--ink-3)">${p}</text>`;
    }).join("");
    const rings = Array.from({ length: 9 }, (_, i) => `<circle cx="${cx}" cy="${cy}" r="${10 + i * 5}" fill="none" stroke="rgba(60,40,5,.22)" stroke-width=".6"/>`).join("");
    const reeds = Array.from({ length: 90 }, (_, i) => {
      const a = (i / 90) * Math.PI * 2;
      return `<line x1="${(cx + (R - 4) * Math.cos(a)).toFixed(1)}" y1="${(cy + (R - 4) * Math.sin(a)).toFixed(1)}" x2="${(cx + R * Math.cos(a)).toFixed(1)}" y2="${(cy + R * Math.sin(a)).toFixed(1)}" stroke="rgba(60,40,5,.35)" stroke-width=".7"/>`;
    }).join("");
    const [nx, ny] = P(coverage);
    return `<defs><radialGradient id="${gid}" cx="38%" cy="32%" r="80%"><stop offset="0" stop-color="#FBEFC6"/><stop offset=".35" stop-color="#E2C273"/><stop offset=".75" stop-color="#A9822F"/><stop offset="1" stop-color="#7A5B19"/></radialGradient></defs>
      <path d="${arc(0, 200, 72)}" fill="none" stroke="var(--rule-2)" stroke-width="5" stroke-linecap="round"/>
      <path d="${arc(0, 100, 72)}" fill="none" stroke="var(--alarm)" stroke-opacity=".55" stroke-width="5" stroke-dasharray="2 2.4"/>
      <path d="${arc(0, Math.min(Math.max(coverage, 0.01), 200), 72)}" fill="none" stroke="var(--metal)" stroke-width="5" stroke-linecap="round"/>
      ${ticks}
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${gid})"/>${rings}${reeds}
      <circle cx="${cx}" cy="${cy}" r="${R - 6}" fill="none" stroke="rgba(255,245,210,.6)" stroke-width=".8"/>
      <text x="${cx}" y="${cy + 6}" text-anchor="middle" font-family="var(--f-display)" font-weight="600" font-size="19" fill="rgba(48,32,4,.85)" style="font-variation-settings:'wdth' 75">ERG</text>
      <circle cx="${nx.toFixed(1)}" cy="${ny.toFixed(1)}" r="6" fill="var(--bg)" stroke="var(--ink)" stroke-width="2"/>`;
  }, [coverage, gid]);
  return (
    <span className={["coin", className].filter(Boolean).join(" ")} role="img" aria-label={t("ui.coin.aria", { pct: fmtPct(coverage) })}>
      <svg viewBox="-12 -8 194 186" width={size} height={size} style={{ maxWidth: "100%", overflow: "visible" }} aria-hidden="true">
        <g dangerouslySetInnerHTML={{ __html: svg }} />
        {label && <text x={85} y={177} textAnchor="middle" fontFamily="var(--f-ui)" fontWeight={600} fontSize={15} fill="var(--ink)">{t("ui.coin.covered", { pct: fmtPct(coverage) })}</text>}
      </svg>
    </span>
  );
}

/* ---------- CapBar / MiniCap ---------- */
export interface CapBarProps {
  limit: number;
  /** Outstanding before this change. */
  amount: number;
  /** Already redeemed (metal). */
  settled?: number;
  /** The new part of a pay (highlighted in ink). */
  added?: number;
  height?: number;
  /** Ink of the bar (defaults to ink-2 outside a note). */
  ink?: string;
  className?: string;
}
/** Credit line bar: settled (metal) · outstanding (ink) · new part · headroom (hatch). */
export function CapBar({ limit, amount, settled = 0, added = 0, height = 12, ink = "var(--ink-2)", className }: CapBarProps) {
  const t = useT();
  const w = (v: number) => `${Math.max(0, Math.min(100, (v / Math.max(limit, 1e-9)) * 100)).toFixed(2)}%`;
  return (
    <div className={["cap", className].filter(Boolean).join(" ")} style={{ height, "--ink-a": ink } as CSSProperties} role="img"
      aria-label={t("ui.cap.aria", { used: money(amount + added), limit: money(limit, 0), left: money(Math.max(0, limit - amount - added)) })}>
      {settled > 0 && <i className="settled" style={{ width: w(settled) }} />}
      <i className="out" style={{ width: w(amount - settled), background: ink }} />
      {added > 0 && <i style={{ width: w(added), background: "var(--ink)" }} />}
      <i className="head" style={{ flex: 1, "--ink-a": "var(--ink-3)" } as CSSProperties} />
    </div>
  );
}
/** 4 px list bar: share used of a line; "near" (≥ 80 %) turns alarm. */
export function MiniCap({ used, kind = "out", width = 220 }: { used: number; kind?: "out" | "settled" | "near"; width?: number | string }) {
  return (
    <div className="mini-cap" style={{ width: typeof width === "number" ? `min(${width}px, 100%)` : width }} aria-hidden="true">
      <i className={kind} style={{ width: `${(Math.max(0, Math.min(1, used)) * 100).toFixed(1)}%` }} />
    </div>
  );
}

/* ---------- BackedTrustBar / BacksBar ---------- */
/** Share of what you're owed that is backed by reserves (metal) vs on trust (hatch). */
export function BackedTrustBar({ backed, legend = true }: { backed: number; legend?: boolean }) {
  const t = useT();
  const b = Math.max(0, Math.min(1, backed));
  return (
    <div>
      <div className="bt" role="img" aria-label={t("ui.bt.aria", { b: fmtPct(b * 100), t: fmtPct((1 - b) * 100) })}>
        {b > 0 && <i className="b" style={{ width: `${(b * 100).toFixed(1)}%` }} />}
        {b < 1 && <i className="t" style={{ flex: 1 }} />}
      </div>
      {legend && <div className="bt-legend"><span><b>{fmtPct(b * 100)}</b> {t("ui.bt.backed")}</span><span><b>{fmtPct((1 - b) * 100)}</b> {t("ui.bt.trust")}</span></div>}
    </div>
  );
}

export interface BacksItem { label: ReactNode; amount: number }
/** "Who this reserve backs": stacked metal segments by note holder plus the spare part of the reserve. */
export function BacksBar({ items, locked, dp = 2 }: { items: BacksItem[]; locked: number; dp?: number }) {
  const t = useT();
  const ui = useUiSettings();
  const used = items.reduce((s, x) => s + x.amount, 0);
  const spare = Math.max(0, locked - used);
  const w = (v: number) => `${((v / Math.max(locked, used, 1e-9)) * 100).toFixed(2)}%`;
  return (
    <div className="backs" role="list" aria-label={t("ui.backs.aria")}>
      {items.map((x, i) => (
        <i key={i} role="listitem" className={i === 0 ? "c1" : i === 1 ? "c2" : "c3"} style={{ width: w(x.amount) }} title={`${typeof x.label === "string" ? x.label : ""} ${money(x.amount, dp)}`}>
          {x.label} {priv(ui.privacy, money(x.amount, dp))}
        </i>
      ))}
      {spare > 0 && <i role="listitem" className="spare" style={{ flex: 1 }}>{t("ui.backs.spare")} {priv(ui.privacy, money(spare, dp))}</i>}
    </div>
  );
}

/* ---------- Dial ---------- */
export type TrackerBand = "ontime" | "late" | "silent" | "emergency";
/** On time < 120 · Late ≥ 120 · Silent ≥ 720 (product choices) · Emergency ≥ 2 160 (the contract). */
export const trackerBand = (blocks: number): TrackerBand => (blocks < 120 ? "ontime" : blocks < 720 ? "late" : blocks < 2160 ? "silent" : "emergency");
export interface DialProps { blocks: number; size?: number; labels?: boolean; max?: number }
/** Dead-man switch dial: 72 ticks over 2 160 blocks, late (dashed) and silent (alarm) arcs, the hand at `blocks`. */
export function Dial({ blocks, size = 150, labels = true, max = 2160 }: DialProps) {
  const t = useT();
  const body = useMemo(() => {
    const c = 75, r = 60, a = (p: number) => ((-90 + 360 * Math.min(1, p / max)) * Math.PI) / 180;
    const arcP = (p0: number, p1: number, rr: number) => {
      const x0 = c + rr * Math.cos(a(p0)), y0 = c + rr * Math.sin(a(p0)), x1 = c + rr * Math.cos(a(p1)), y1 = c + rr * Math.sin(a(p1));
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${rr} ${rr} 0 ${(p1 - p0) / max > 0.5 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
    };
    const ticks = Array.from({ length: 72 }, (_, i) => {
      const tt = (i / 72) * max, an = a(tt), big = i % 6 === 0;
      return `<line x1="${(c + (r + 4) * Math.cos(an)).toFixed(1)}" y1="${(c + (r + 4) * Math.sin(an)).toFixed(1)}" x2="${(c + (r + (big ? 11 : 7)) * Math.cos(an)).toFixed(1)}" y2="${(c + (r + (big ? 11 : 7)) * Math.sin(an)).toFixed(1)}" stroke="var(--ink-3)" stroke-width="${big ? 1.2 : 0.7}"/>`;
    }).join("");
    const em = blocks >= max;
    const hx = c + (r - 6) * Math.cos(a(blocks)), hy = c + (r - 6) * Math.sin(a(blocks));
    return `<circle cx="${c}" cy="${c}" r="${r}" fill="${em ? "color-mix(in srgb, var(--alarm) 16%, var(--surface-2))" : "var(--surface-2)"}" stroke="${em ? "var(--alarm)" : "var(--rule-2)"}"/>
      <path d="${arcP(max / 3, max - 0.1, r - 2)}" fill="none" stroke="var(--alarm)" stroke-opacity=".35" stroke-width="4"/>
      <path d="${arcP(max / 18, max / 3, r - 2)}" fill="none" stroke="var(--ink-3)" stroke-opacity=".5" stroke-width="4" stroke-dasharray="1.5 2"/>
      ${ticks}
      <line x1="${c}" y1="${c}" x2="${hx.toFixed(1)}" y2="${hy.toFixed(1)}" stroke="${em ? "var(--alarm)" : "var(--ink)"}" stroke-width="2" stroke-linecap="round"/><circle cx="${c}" cy="${c}" r="4" fill="${em ? "var(--alarm)" : "var(--ink)"}"/>`;
  }, [blocks, max]);
  const band = trackerBand(blocks);
  return (
    <span className="dial" style={{ width: size, height: size }} role="img" aria-label={t("ui.dial.aria", { state: t(`ui.tracker.${band}`), n: int(blocks), max: int(max) })}>
      <svg viewBox="0 0 150 150" width={size} height={size} aria-hidden="true">
        <g dangerouslySetInnerHTML={{ __html: body }} />
        {labels && <>
          <text x={75} y={97} textAnchor="middle" fontFamily="var(--f-mono)" fontSize={8.5} letterSpacing={1} fill="var(--ink-2)">{t(`ui.tracker.${band}`).toUpperCase()}</text>
          <text x={75} y={109} textAnchor="middle" fontFamily="var(--f-mono)" fontSize={8} fill="var(--ink-3)">{int(blocks)} / {int(max)}</text>
        </>}
      </svg>
    </span>
  );
}

/* ---------- Heartbeat ---------- */
export interface HeartbeatProps {
  /** Number of blocks shown (default 96). */
  n?: number;
  /** Indices (0 = oldest) of blocks with a commitment. Omit for the tile's sample rhythm. */
  commits?: number[];
  /** The newest block is "now" (verdigris). */
  now?: boolean;
  silent?: boolean;
  label?: string;
}
/** Commitments over the last n blocks: tall holo bars = commits, short bars = empty blocks. */
export function Heartbeat({ n = 96, commits, now = true, silent, label }: HeartbeatProps) {
  const t = useT();
  const set = useMemo(() => new Set(commits ?? Array.from({ length: n }, (_, i) => i).filter((i) => i % 7 === 3 || i === n - 38)), [commits, n]);
  const count = silent ? 0 : [...set].filter((i) => i < n).length;
  return (
    <div className={["beats", silent && "silent"].filter(Boolean).join(" ")} role="img" aria-label={label ?? t("ui.beats.aria", { n: int(n), c: int(count) })}>
      {Array.from({ length: n }, (_, i) => {
        const isNow = i === n - 1 && now && !silent, c = !silent && set.has(i);
        return <i key={i} className={isNow ? "now" : c ? "c" : undefined} style={isNow || c ? undefined : { height: `${18 + ((i * 37) % 11) * 2}%` }} />;
      })}
    </div>
  );
}

/* ---------- Ledger ---------- */
export interface LedgerRow { label: ReactNode; sub?: ReactNode; value: ReactNode; tone?: "metal" | "up" | "alarm" }
/** Receipt arithmetic: rows, then a 2 px ink sum line. */
export function Ledger({ rows, sum, caption }: { rows: LedgerRow[]; sum?: LedgerRow; caption?: ReactNode }) {
  const tone = (x?: LedgerRow["tone"]) => (x === "metal" ? "metal-t" : x === "up" ? "up" : x === "alarm" ? "alarm-t" : undefined);
  return (
    <table className="ledger">
      {caption && <caption className="sr-only">{caption}</caption>}
      <tbody>
        {rows.map((r, i) => <tr key={i}><td>{r.label}{r.sub && <> <span className="mono">· {r.sub}</span></>}</td><td className={tone(r.tone)}>{r.value}</td></tr>)}
        {sum && <tr className="sum"><td>{sum.label}</td><td className={tone(sum.tone)} style={sum.tone === "metal" ? { color: "var(--metal-ink)" } : undefined}>{sum.value}</td></tr>}
      </tbody>
    </table>
  );
}

/* ---------- Wheels / OdoLedger / Tear / GrowthPreview ---------- */
/** Static counter wheels: "1240.00"; the first `lead` wheels are dimmed (leading zeros). */
export function Wheels({ value, lead = 0 }: { value: string; lead?: number }) {
  return (
    <span className="wheels" aria-label={value.replace(/^0+(?=\d)/, "")} role="img">
      {Array.from(value).map((c, i) => (c === "." ? <span key={i} className="dot" aria-hidden="true">.</span> : <span key={i} className={i < lead ? "l" : undefined} aria-hidden="true">{c}</span>))}
    </span>
  );
}
/** Debt − Redeemed = Outstanding, on wheels. */
export function OdoLedger({ debt, redeemed, dp = 2 }: { debt: number; redeemed: number; dp?: number }) {
  const t = useT();
  const ui = useUiSettings();
  const d = debt.toFixed(dp), r = redeemed.toFixed(dp).padStart(d.length, "0");
  const lead = r.length - redeemed.toFixed(dp).length;
  return (
    <div className="odoledger">
      <div><div className="label" style={{ marginBottom: 6 }}>{t("ui.redeem.debt")}</div>{ui.privacy ? "•••" : <Wheels value={d} />}</div>
      <span className="op" aria-hidden="true">−</span>
      <div><div className="label" style={{ marginBottom: 6 }}>{t("ui.redeem.redeemed")}</div>{ui.privacy ? "•••" : <Wheels value={r} lead={lead} />}</div>
      <span className="op" aria-hidden="true">=</span>
      <div style={{ textAlign: "right" }}><div className="label" style={{ marginBottom: 6 }}>{t("ui.redeem.outstanding")}</div><span className="t-money" style={{ fontSize: 40, lineHeight: "34px" }}>{priv(ui.privacy, money(debt - redeemed, dp))}</span></div>
    </div>
  );
}
/** The tear-off: what stays (paper) and what is torn off (metal stub). */
export function Tear({ keep, torn, keepLabel, tornLabel, dp = 2, style }: { keep: number; torn: number; keepLabel?: ReactNode; tornLabel?: ReactNode; dp?: number; style?: CSSProperties }) {
  const t = useT();
  const ui = useUiSettings();
  return (
    <div className="tear" style={style}>
      <div className="keep"><div className="v">{priv(ui.privacy, money(keep, dp))}</div><div className="l">{keepLabel ?? t("ui.tear.keep")}</div></div>
      <div className="stub"><div className="v">{priv(ui.privacy, money(torn, dp))}</div><div className="l">{tornLabel ?? t("ui.tear.torn")}</div></div>
    </div>
  );
}
/** "1 000.00 → 1 240.00 ERG" — the same note, grown (serif; the old value in ink-3). */
export function GrowthPreview({ from, to, unit = "ERG", dp = 2, size = 56 }: { from: number; to: number; unit?: string; dp?: number; size?: number }) {
  const ui = useUiSettings();
  return (
    <div className="growth">
      <span className="t-money was" style={{ fontSize: Math.round(size * 0.72) }}>{priv(ui.privacy, money(from, dp))}</span>
      <span className="arr" aria-hidden="true">→</span>
      <span className="t-money" style={{ fontSize: size }}>{priv(ui.privacy, money(to, dp))}</span>
      <span className="unit" style={{ fontSize: 12, verticalAlign: 0 }}>{unit}</span>
    </div>
  );
}
