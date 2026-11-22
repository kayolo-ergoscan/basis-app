// The /play stage: a 2D debt graph in the VISUAL §9 encoding (tube = limit or all-time total, body = what is still
// owed, metal = backed by the debtor's reserve, hatch = on trust, arrow at the creditor, gold rim = coverage) around
// the tracker drawn as a lighthouse whose beam sweeps once per commitment. Pan and pinch on phone; zoom keys and
// Ctrl/⌘ + wheel on desktop. The table view is the screen-reader path.
import { memo, startTransition, useEffect, useMemo, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent } from "react";
import type { TFn } from "@/app";
import type { DenomId } from "@/protocol";
import { blk, Icon, int, pct, signed, Table, type Column } from "@/ui";
import { keySeed, sealUrl } from "@/ui/engine/raster";
import { coverPct, fmtAmt, labelShift, splitMid, trackerStateOf, type StageEdge, type StageModel, type StageNode, type StageTracker } from "./model";

export type Sel =
  | { kind: "participant"; id: string }
  | { kind: "note"; tracker: string; from: string; to: string; denom: DenomId }
  | { kind: "reserve"; id: string }
  | { kind: "tracker"; id: string };

export const selKey = (s: Sel | null): string =>
  !s ? "" : s.kind === "note" ? `note:${s.tracker}:${s.from}>${s.to}:${s.denom}` : `${s.kind}:${s.id}`;

interface Props {
  model: StageModel;
  selected: Sel | null;
  onSelect: (s: Sel | null) => void;
  /** Beam counters per tracker id: a change sweeps the beam once. */
  beams: Record<string, number>;
  t: TFn;
  phone: boolean;
  /** Bump to fit the whole circle again. */
  fitKey: number;
}

type VB = { x: number; y: number; w: number; h: number };

const NO_NODES: StageNode[] = [];
const sealCache = new Map<string, string>();
const sealKey = (pk: string, agent: boolean) => `${pk}|${agent ? 1 : 0}`;
const peekSeal = (pk: string, agent: boolean) => sealCache.get(sealKey(pk, agent)) ?? "";
/** A swarm's seals are drawn a few per frame (each costs ~3 ms), so the first paint never stalls the page. */
function useSealFill(nodes: StageNode[]): number {
  const [ver, setVer] = useState(0);
  useEffect(() => {
    const todo = nodes.filter((n) => !sealCache.has(sealKey(n.pub, n.agent)));
    if (todo.length === 0) return;
    let i = 0;
    let h = 0;
    const tick = () => {
      const t0 = performance.now();
      while (i < todo.length && performance.now() - t0 < 14) {
        seal(todo[i].pub, todo[i].agent);
        i++;
      }
      setVer((v) => v + 1);
      if (i < todo.length) h = window.setTimeout(tick, 0);
    };
    h = window.setTimeout(tick, 0);
    return () => clearTimeout(h);
  }, [nodes]);
  return ver;
}
function seal(pk: string, agent: boolean): string {
  const k = `${pk}|${agent ? 1 : 0}`;
  let u = sealCache.get(k);
  if (!u) {
    try {
      u = sealUrl(keySeed(pk), { kind: agent ? "agent" : "person", detail: 0.35, px: 56 });
    } catch {
      u = "";
    }
    if (sealCache.size > 400) sealCache.clear();
    sealCache.set(k, u);
  }
  return u;
}

const OCT = (r: number) => {
  const a = r * 0.414;
  return `M${-a} ${-r}L${a} ${-r}L${r} ${-a}L${r} ${a}L${a} ${r}L${-a} ${r}L${-r} ${a}L${-r} ${-a}Z`;
};

export function edgeSel(e: StageEdge): Sel {
  return { kind: "note", tracker: e.tracker, from: e.from, to: e.to, denom: e.denom };
}

export const StageGraph = memo(function StageGraph({ model, selected, onSelect, beams, t, phone, fitKey }: Props) {
  const { W, H } = model;
  const full: VB = useMemo(() => ({ x: 0, y: 0, w: W, h: H }), [W, H]);
  const [vb, setVb] = useState<VB>(full);
  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ vb: VB; x: number; y: number; d: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);

  useEffect(() => setVb(full), [full, fitKey]);
  const zoomed = vb.w < W - 0.5;
  // a small circle draws its seals at once; a larger one fills them in over a few frames
  const small = model.nodes.length <= 8;
  useSealFill(small ? NO_NODES : model.nodes);

  const toSvg = (cx: number, cy: number, box: VB = vb) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || !r.width) return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    // preserveAspectRatio meet: the viewBox is scaled uniformly and centred
    const s = Math.min(r.width / box.w, r.height / box.h);
    const ox = (r.width - box.w * s) / 2;
    const oy = (r.height - box.h * s) / 2;
    return { x: box.x + (cx - r.left - ox) / s, y: box.y + (cy - r.top - oy) / s };
  };
  const clampVb = (b: VB): VB => {
    const w = Math.max(W / 5, Math.min(W, b.w));
    const h = (w / W) * H;
    const x = Math.max(-W * 0.1, Math.min(W * 1.1 - w, b.x));
    const y = Math.max(-H * 0.1, Math.min(H * 1.1 - h, b.y));
    return { x, y, w, h };
  };
  const zoomAt = (f: number, px?: number, py?: number) =>
    setVb((b) => {
      const cx = px ?? b.x + b.w / 2;
      const cy = py ?? b.y + b.h / 2;
      const w = b.w / f;
      const h = b.h / f;
      if (w >= W) return full;
      return clampVb({ x: cx - (cx - b.x) / f, y: cy - (cy - b.y) / f, w, h });
    });

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    const touch = e.pointerType === "touch";
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!touch && !zoomed) return;
    if ((e.target as Element).closest(".pl-hit") && !touch) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const pts = [...ptrs.current.values()];
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const d = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    gesture.current = { vb, x: mx, y: my, d, moved: false };
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    if (!ptrs.current.has(e.pointerId)) return;
    ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    const r = svgRef.current?.getBoundingClientRect();
    if (!g || !r) return;
    const pts = [...ptrs.current.values()];
    const mx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const my = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    if (Math.hypot(mx - g.x, my - g.y) > 4) g.moved = true;
    const s = Math.min(r.width / g.vb.w, r.height / g.vb.h);
    let next: VB = { ...g.vb, x: g.vb.x - (mx - g.x) / s, y: g.vb.y - (my - g.y) / s };
    if (pts.length > 1 && g.d > 0) {
      const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const f = d / g.d;
      if (Math.abs(f - 1) > 0.02) g.moved = true;
      const c = toSvg(g.x, g.y, g.vb);
      const w = g.vb.w / f;
      const h = g.vb.h / f;
      next = { x: c.x - (c.x - g.vb.x) / f - (mx - g.x) / s, y: c.y - (c.y - g.vb.y) / f - (my - g.y) / s, w, h };
      if (w >= W) next = full;
    }
    if (g.moved) setVb(next.w >= W && pts.length > 1 ? full : clampVb(next));
  };
  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    ptrs.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.moved) suppressClick.current = true;
    if (ptrs.current.size === 0) gesture.current = null;
    else {
      const pts = [...ptrs.current.values()];
      gesture.current = { vb, x: pts[0].x, y: pts[0].y, d: 0, moved: g?.moved ?? false };
    }
  };

  const pick = (s: Sel | null) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onSelect(s);
  };

  const selEdge = selected?.kind === "note" ? `${selected.from}>${selected.to}` : null;
  const selNode = selected?.kind === "participant" ? selected.id : null;
  const selReserve = selected?.kind === "reserve" ? selected.id : null;
  const focusNode = hoverNode && model.nodes.find((n) => n.id === hoverNode && n.reserve > 0n) ? hoverNode : null;
  const showAllLabels = !model.dense && model.edges.length <= 24;
  const dimmed = (e: StageEdge) => (focusNode ? e.from !== focusNode : false);

  const key = (ev: RKeyboardEvent, s: Sel) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      onSelect(s);
    }
  };

  const hatch = "pl-h";
  const ordered = useMemo(() => [...model.edges].sort((a, b) => Number(a.major) - Number(b.major)), [model.edges]);

  return (
    <div className={`pl-graph${zoomed ? " zoomed" : ""}`}>
      <svg
        ref={svgRef}
        viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={t("play.stage.aria")}
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          const p = toSvg(e.clientX, e.clientY);
          zoomAt(e.deltaY < 0 ? 1.15 : 0.87, p.x, p.y);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={(e) => {
          if (!(e.target as Element).closest(".pl-hit")) pick(null);
        }}
      >
        <defs>
          <pattern id={hatch} width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4.6" height="4.6" fill="var(--surface)" />
            <rect width="1.7" height="4.6" fill="var(--ink-2)" />
          </pattern>
          <linearGradient id="pl-beam-g" className="pl-beam-g" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" className="b0" />
            <stop offset="1" className="b1" />
          </linearGradient>
        </defs>

        {model.loop &&
          model.edges
            .filter((e) => e.loop)
            .map((e) => <path key={"u" + e.id} d={e.d} stroke="var(--up)" strokeOpacity={0.16} strokeWidth={e.tw + 14} fill="none" strokeLinecap="round" />)}

        {ordered.map((e) => (
          <EdgeShape
            key={e.id}
            e={e}
            hatch={hatch}
            sel={selEdge === `${e.from}>${e.to}`}
            dim={dimmed(e)}
            onHover={setHoverEdge}
            onPick={() => pick(edgeSel(e))}
            onKey={(ev) => key(ev, edgeSel(e))}
            label={t("play.stage.edgeAria", { a: nameOf(model, e.from), b: nameOf(model, e.to), v: `${fmtAmt(e.claim, model.decimals)} ${model.symbol}`, status: t(`play.stage.status.${e.omitted ? "omitted" : e.status}`) })}
          />
        ))}

        {model.trackers.map((tr) => (
          <Lighthouse key={tr.id} scale={tr.s} tr={tr} plate={model.dense} beam={beams[tr.id] ?? 0} sel={selected?.kind === "tracker" && selected.id === tr.id} t={t} onPick={() => pick({ kind: "tracker", id: tr.id })} onKey={(ev) => key(ev, { kind: "tracker", id: tr.id })} />
        ))}

        {model.nodes.map((n) => (
          <NodeShape
            key={n.id}
            n={n}
            dense={model.dense}
            decimals={model.decimals}
            sel={selNode === n.id}
            selReserve={!!selReserve && n.reserveIds.includes(selReserve)}
            hover={hoverNode === n.id}
            onHover={setHoverNode}
            onPick={() => pick({ kind: "participant", id: n.id })}
            onPickReserve={n.reserveIds[0] ? () => pick({ kind: "reserve", id: n.reserveIds[0] }) : undefined}
            onKey={(ev) => key(ev, { kind: "participant", id: n.id })}
            t={t}
            symbol={model.symbol}
            img={small ? seal(n.pub, n.agent) : peekSeal(n.pub, n.agent)}
          />
        ))}

        {model.edges
          // a quiet pill (a phone's "0.00", or one with no clean spot) shows only while its arrow is touched
          .filter((e) => e.major && (showAllLabels || hoverEdge === e.id || selEdge === `${e.from}>${e.to}` || (focusNode && e.from === focusNode)) && (!e.quiet || hoverEdge === e.id || selEdge === `${e.from}>${e.to}`))
          .map((e) => (
            <EdgeLabel key={"l" + e.id} e={e} dim={dimmed(e)} />
          ))}

        {model.loop && (
          <g transform={`translate(${model.loop.x.toFixed(1)} ${model.loop.y.toFixed(1)})`} pointerEvents="none" className="pl-loop">
            <title>{t("play.stage.loop", { v: `${fmtAmt(model.loop.amount, model.decimals)} ${model.symbol}` })}</title>
            <g transform={model.loop.compact ? "scale(0.8)" : undefined}>
              <path d="M13 0a13 13 0 1 1-3.8-9.2" fill="none" stroke="var(--up)" strokeWidth={1.8} strokeLinecap="round" />
              <path d="M13 -13v5h-5" fill="none" stroke="var(--up)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
            </g>
            {model.loop.compact ? (
              <text className="pl-loop-label" x={17} y={4.5}>
                {`${fmtAmt(model.loop.amount, model.decimals)} ${model.symbol}`}
              </text>
            ) : (
              <text className="pl-loop-label" textAnchor="middle" y={34}>
                {t("play.stage.loop", { v: `${fmtAmt(model.loop.amount, model.decimals)} ${model.symbol}` })}
              </text>
            )}
          </g>
        )}
      </svg>
      {phone ? (
        // phone: pinch and drag; one key brings the whole circle back
        zoomed && (
          <div className="pl-zoom" role="group" aria-label={t("play.stage.pan")}>
            <button type="button" className="key sm icon-only" onClick={() => setVb(full)} aria-label={t("play.stage.reset")} title={t("play.stage.reset")}>
              <Icon name="fit" />
            </button>
          </div>
        )
      ) : (
        <div className="pl-zoom" aria-label={t("play.stage.pan")} role="group">
          <button type="button" className="key sm icon-only" onClick={() => zoomAt(1.25)} aria-label={t("ui.graph.zoomIn")} title={t("ui.graph.zoomIn")}>
            <Icon name="zoomIn" />
          </button>
          <button type="button" className="key sm icon-only" onClick={() => zoomAt(0.8)} aria-label={t("ui.graph.zoomOut")} title={t("ui.graph.zoomOut")} disabled={!zoomed}>
            <Icon name="zoomOut" />
          </button>
          <button type="button" className="key sm icon-only" onClick={() => setVb(full)} aria-label={t("play.stage.reset")} title={t("play.stage.reset")} disabled={!zoomed}>
            <Icon name="fit" />
          </button>
        </div>
      )}
    </div>
  );
});

function nameOf(m: StageModel, id: string): string {
  return m.nodes.find((n) => n.id === id)?.name ?? id;
}

const EdgeShape = memo(function EdgeShape({ e, hatch, sel, dim, onHover, onPick, onKey, label }: { e: StageEdge; hatch: string; sel: boolean; dim: boolean; onHover: (id: string | null) => void; onPick: () => void; onKey: (ev: RKeyboardEvent) => void; label: string }) {
  if (!e.major) {
    return (
      <g className={`pl-edge minor${dim ? " dim" : ""}`} data-from={e.from}>
        <path d={e.d} stroke="var(--ink-3)" strokeOpacity={0.32} strokeWidth={1} fill="none" />
      </g>
    );
  }
  const metal = e.frac * e.backed;
  const trust = e.frac - metal;
  return (
    <g
      className={`pl-edge pl-hit${sel ? " sel" : ""}${dim ? " dim" : ""}${e.omitted ? " omitted" : ""}`}
      data-from={e.from}
      tabIndex={0}
      role="button"
      aria-label={label}
      aria-pressed={sel}
      onMouseEnter={() => onHover(e.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(e.id)}
      onBlur={() => onHover(null)}
      onClick={(ev) => {
        ev.stopPropagation();
        onPick();
      }}
      onKeyDown={onKey}
    >
      <path d={e.d} className="pl-tube-o" strokeWidth={e.tw + 2} fill="none" strokeLinecap="round" />
      <path d={e.d} className="pl-tube" strokeWidth={e.tw} fill="none" strokeLinecap="round" />
      {metal > 0.001 && <path d={e.d} className="pl-body metal" pathLength={1} strokeWidth={e.bw} fill="none" strokeLinecap="butt" style={{ strokeDasharray: `${metal.toFixed(4)} 2` }} />}
      {trust > 0.001 && (
        <path d={e.d} className="pl-body trust" pathLength={1} stroke={`url(#${hatch})`} strokeWidth={e.bw} fill="none" strokeLinecap="butt" style={{ strokeDasharray: `0 ${metal.toFixed(4)} ${trust.toFixed(4)} 2` }} />
      )}
      {metal > 0.001 && <path d={e.d} className="pl-body shine" pathLength={1} strokeWidth={Math.max(1, e.bw * 0.22)} fill="none" style={{ strokeDasharray: `${metal.toFixed(4)} 2` }} />}
      <path d={e.head} className={`pl-head${e.backed > 0.5 && e.frac > 0 ? " metal" : ""}`} />
      <path d={e.d} stroke="transparent" strokeWidth={Math.max(16, e.tw + 8)} fill="none" />
    </g>
  );
});

function EdgeLabel({ e, dim }: { e: StageEdge; dim: boolean }) {
  const txt = e.pill;
  const w = txt.replace(/⁠/g, "").length * 7.3 + 34;
  return (
    <g transform={`translate(${e.mx.toFixed(1)} ${e.my.toFixed(1)})`} pointerEvents="none" className={`pl-pill${dim ? " dim" : ""}${e.near ? " near" : ""}`}>
      <rect x={-w / 2} y={-12} width={w} height={24} rx={12} />
      <StatusGlyph x={-w / 2 + 13} status={e.omitted ? "omitted" : e.status} />
      <text x={7} y={4.2} textAnchor="middle">
        {txt}
      </text>
    </g>
  );
}

/** Shape-first note status: ○ signed · ◐ committed, waiting · ● in the confirmed digest · ⊘ left out. */
function StatusGlyph({ x, status }: { x: number; status: string }) {
  const r = 4.2;
  if (status === "confirmed") return <circle cx={x} cy={0} r={r} className="pl-st full" />;
  if (status === "pending")
    return (
      <g>
        <circle cx={x} cy={0} r={r} className="pl-st ring" />
        <path d={`M${x} ${-r}A${r} ${r} 0 0 1 ${x} ${r}Z`} className="pl-st half" />
      </g>
    );
  if (status === "omitted")
    return (
      <g>
        <circle cx={x} cy={0} r={r} className="pl-st ring alarm" />
        <path d={`M${x - 3} ${3}L${x + 3} ${-3}`} className="pl-st slash" />
      </g>
    );
  return <circle cx={x} cy={0} r={r} className="pl-st ring" />;
}

const NodeShape = memo(function NodeShape({
  n,
  dense,
  decimals,
  sel,
  selReserve,
  hover,
  onHover,
  onPick,
  onPickReserve,
  onKey,
  t,
  symbol,
  img,
}: {
  n: StageNode;
  dense: boolean;
  decimals: number;
  sel: boolean;
  selReserve: boolean;
  hover: boolean;
  onHover: (id: string | null) => void;
  onPick: () => void;
  onPickReserve?: () => void;
  onKey: (ev: RKeyboardEvent) => void;
  t: TFn;
  symbol: string;
  img: string;
}) {
  const R = n.r;
  const full = !dense || sel || hover;
  const netNum = Number(n.net) / 10 ** decimals;
  const netTxt = n.net === 0n ? fmtAmt(0n, decimals) : signed(netNum, Math.abs(netNum) < 0.01 && decimals > 2 ? 4 : 2, n.net > 0n ? "favour" : "owe");
  // a bare seal in a dense swarm keeps its name for hover and selection (the aria-label always carries it)
  const lines: Array<[string, string]> = n.bare && !sel && !hover ? [] : [[n.name, "pl-name"]];
  if (full) lines.push([netTxt, `pl-net${n.net > 0n ? " pos" : ""}`]);
  if (full && n.reserveIds.length) lines.push([n.ratio === null ? t("play.stage.noLiab") : t("play.stage.reserve", { pct: coverPct(n.ratio) }), "pl-res"]);
  const gap = 15;
  const ax = n.align === "start" ? -(R - 2) : n.align === "end" ? R - 2 : 0;
  // words above or below a seal keep off its reserve coin when the coin sits on that side
  const shift = dense ? 0 : labelShift(R, n.th, n.side, n.reserveIds.length > 0);
  const at =
    n.side === "b" ? [ax, R + 22 + shift, n.align] : n.side === "a" ? [ax, -(R + 14) - gap * (lines.length - 1) + shift, n.align] : n.side === "l" ? [-(R + 14), -((lines.length - 1) * gap) / 2 + 4, "end"] : [R + 14, -((lines.length - 1) * gap) / 2 + 4, "start"];
  const rim = n.rim;
  const rr = R + 5;
  const a1 = -Math.PI / 2 + rim * Math.PI * 2;
  // the reserve coin sits beside the seal, away from the arrows (which leave towards the middle)
  const coinAngle = n.th + (n.left ? Math.PI / 2 : -Math.PI / 2);
  const cxn = Math.cos(coinAngle) * (rr + 2);
  const cyn = Math.sin(coinAngle) * (rr + 2);
  return (
    <g
      className={`pl-node pl-hit${sel ? " sel" : ""}${n.online ? "" : " off"}`}
      transform={`translate(${n.x.toFixed(1)} ${n.y.toFixed(1)})`}
      tabIndex={0}
      role="button"
      aria-pressed={sel}
      aria-label={t("play.stage.nodeAria", { name: n.name, v: `${netTxt} ${symbol}` })}
      onMouseEnter={() => onHover(n.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(n.id)}
      onBlur={() => onHover(null)}
      onClick={(ev) => {
        ev.stopPropagation();
        onPick();
      }}
      onKeyDown={onKey}
    >
      <circle className="pl-focus" r={rr + 7} />
      {n.reserveIds.length > 0 && (
        <g className={`pl-rim${selReserve ? " sel" : ""}`}>
          <circle r={rr} fill="none" className="pl-rim-bg" strokeWidth={dense ? 2.4 : 3.5} />
          {rim >= 0.999 ? (
            <circle r={rr} fill="none" className="pl-rim-fg" strokeWidth={dense ? 2.4 : 3.5} />
          ) : (
            <path d={`M0 ${-rr}A${rr} ${rr} 0 ${rim > 0.5 ? 1 : 0} 1 ${(rr * Math.cos(a1)).toFixed(2)} ${(rr * Math.sin(a1)).toFixed(2)}`} fill="none" className="pl-rim-fg" strokeWidth={dense ? 2.4 : 3.5} strokeLinecap="round" />
          )}
        </g>
      )}
      {n.agent ? <path d={OCT(R - 1)} className="pl-disc" /> : <circle r={R - 1} className="pl-disc" />}
      {img && (
        <g clipPath={n.agent ? undefined : undefined}>
          <image href={img} x={-(R - 3)} y={-(R - 3)} width={(R - 3) * 2} height={(R - 3) * 2} />
        </g>
      )}
      {!n.online && <circle r={R - 1} className="pl-offline" />}
      {lines.map(([tx, c], i) => (
        <text key={i} className={c} x={at[0] as number} y={(at[1] as number) + i * gap} textAnchor={at[2] as "start" | "middle" | "end"}>
          {tx}
        </text>
      ))}
      {onPickReserve && !dense && (
        <g
          className={`pl-coin pl-hit${selReserve ? " sel" : ""}`}
          transform={`translate(${cxn.toFixed(1)} ${cyn.toFixed(1)})`}
          role="button"
          tabIndex={0}
          aria-label={t("play.stage.reserveAria", { name: n.name, v: `${fmtAmt(n.reserve, decimals)} ${symbol}` })}
          onClick={(ev) => {
            ev.stopPropagation();
            onPickReserve();
          }}
          onKeyDown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") {
              ev.preventDefault();
              ev.stopPropagation();
              onPickReserve();
            }
          }}
        >
          <circle r={9.5} className="pl-coin-face" />
          <circle r={6.5} className="pl-coin-rim" />
          {n.refundPending && <path d="M-3.5 -3.5L3.5 3.5M3.5 -3.5L-3.5 3.5" className="pl-coin-x" />}
        </g>
      )}
    </g>
  );
});

function Lighthouse({ tr, beam, sel, t, onPick, onKey, scale, plate }: { tr: StageTracker; beam: number; sel: boolean; t: TFn; onPick: () => void; onKey: (ev: RKeyboardEvent) => void; scale: number; plate: boolean }) {
  const state = trackerStateOf(tr);
  const lit = tr.online && (tr.band === "ontime" || tr.band === "none");
  const ago = tr.age === null ? t("play.tracker.never") : t("play.tracker.ago", { n: blk(tr.age, t.lang) });
  const stateText = t(`play.tracker.${state}`);
  const line2 = tr.lab === "one" ? `${stateText} · ${ago}` : stateText;
  const split = tr.wrap && line2.length > 16 ? splitMid(line2) : null;
  // in a dense swarm the tubes cross the middle: the name and state sit on a plate of the stage's own ground
  const plateW = Math.max(tr.name.length * 7.8, line2.length * 6.7, tr.lab === "two" ? ago.length * 6.7 : 0) + 20;
  const plateY = Math.round(46 * scale + 2);
  const plateH = tr.lab === "two" ? 52 : 38;
  return (
    <g
      className={`pl-lh pl-hit${sel ? " sel" : ""}${lit ? " lit" : ""}${tr.online ? "" : " dark"}`}
      transform={`translate(${tr.x.toFixed(1)} ${tr.y.toFixed(1)})`}
      tabIndex={0}
      role="button"
      aria-pressed={sel}
      aria-label={t("play.tracker.aria", { name: tr.name, state: stateText, ago })}
      onClick={(ev) => {
        ev.stopPropagation();
        onPick();
      }}
      onKeyDown={onKey}
    >
      {beam > 0 && tr.online && (
        <g transform={`translate(0 ${(-34 * scale).toFixed(1)})`} key={beam} aria-hidden="true">
          <path className="pl-beam" d="M0 0L420 -52A420 420 0 0 1 420 52Z" fill="url(#pl-beam-g)" />
        </g>
      )}
      <circle className="pl-focus" cy={-8 * scale} r={52 * scale} />
      <g transform={`scale(${scale})`}>
        <ellipse cx={0} cy={36} rx={34} ry={8} className="pl-lh-base" />
        <path d="M-15 34L-9 -22L9 -22L15 34Z" className="pl-lh-tower" />
        <path d="M-13.6 20L13.6 20M-12.2 6L12.2 6M-10.8 -8L10.8 -8" className="pl-lh-band" />
        <rect x={-13} y={-27} width={26} height={5} rx={1} className="pl-lh-gallery" />
        <rect x={-8} y={-41} width={16} height={14} rx={1.5} className="pl-lh-room" />
        <path d="M-10 -41L0 -51L10 -41Z" className="pl-lh-roof" />
        <foreignObject x={-6} y={-40} width={12} height={12}>
          <div className={`pl-lamp ${lit ? "lit" : tr.online ? "stale" : "off"}${beam > 0 ? " flash" : ""}`} key={beam} />
        </foreignObject>
      </g>
      {plate && <rect className="pl-lh-plate" x={-plateW / 2} y={plateY} width={plateW} height={plateH} rx={8} />}
      <text className="pl-name" y={Math.round(46 * scale + 16)} textAnchor="middle">
        {tr.name}
      </text>
      <text className={`pl-lh-state${tr.censor !== "off" ? " alarm" : ""}`} y={Math.round(46 * scale + 32)} textAnchor="middle">
        {split ? split[0] : line2}
      </text>
      {split && (
        <text className={`pl-lh-state${tr.censor !== "off" ? " alarm" : ""}`} y={Math.round(46 * scale + 46)} textAnchor="middle">
          {split[1]}
        </text>
      )}
      {tr.lab === "two" && (
        <text className="pl-lh-state" y={Math.round(46 * scale + 47)} textAnchor="middle">
          {ago}
        </text>
      )}
    </g>
  );
}

// ------------------------------------------------------------------------------------------------
// table view (screen-reader path)
// ------------------------------------------------------------------------------------------------

const TABLE_FIRST = 60;

export function StageTable({ model, onSelect, selected, t }: { model: StageModel; onSelect: (s: Sel) => void; selected: Sel | null; t: TFn }) {
  const nm = (id: string) => nameOf(model, id);
  const u = model.symbol;
  const cols: Column<StageEdge>[] = [
    { key: "pair", label: t("ui.graph.col.debtor"), lead: true, render: (e) => <>{nm(e.from)} <span className="dim">→</span> {nm(e.to)}</> },
    { key: "out", label: t("play.ins.n.outstanding"), align: "right", render: (e) => <span className="num">{fmtAmt(e.claim, model.decimals)} {u}</span> },
    { key: "total", label: t("play.ins.n.total"), align: "right", render: (e) => <span className="num">{fmtAmt(e.total, model.decimals)}</span> },
    { key: "limit", label: t("play.ins.n.limit"), align: "right", render: (e) => (e.limit ? <span className={`num${e.near ? " alarm-t" : ""}`}>{fmtAmt(e.limit, model.decimals)}</span> : <span className="dim">—</span>) },
    { key: "status", label: t("ui.graph.col.backing"), render: (e) => <>{t(`play.stage.status.${e.omitted ? "omitted" : e.status}`)} · {e.backed >= 0.999 ? t("ui.graph.backed") : e.backed > 0 ? `${pct(Math.round(e.backed * 100))} ${t("ui.graph.backed")}` : t("ui.graph.trust")}</> },
  ];
  const people: Column<StageNode>[] = [
    { key: "name", label: t("ui.graph.col.name"), lead: true, render: (n) => <>{n.name}{n.agent ? " · AI" : ""}</> },
    { key: "net", label: t("ui.graph.col.net"), align: "right", render: (n) => <span className={`num${n.net > 0n ? " up" : ""}`}>{n.net > 0n ? "+" : ""}{fmtAmt(n.net, model.decimals)}</span> },
    { key: "res", label: t("ui.graph.col.reserve"), align: "right", render: (n) => (n.reserveIds.length ? <span className="num metal-t">{fmtAmt(n.reserve, model.decimals)}</span> : <span className="dim">—</span>) },
  ];
  const isSelEdge = (e: StageEdge) => selected?.kind === "note" && selected.from === e.from && selected.to === e.to;
  // a swarm has hundreds of rows: the biggest first, the rest one press away (a long table in one go stalls the page)
  const [all, setAll] = useState(false);
  const rows = all || model.edges.length <= TABLE_FIRST ? model.edges : model.edges.slice(0, TABLE_FIRST);
  return (
    <div className="pl-table">
      <Table<StageEdge> caption={t("ui.graph.tableDebts")} showCaption stack rowKey={(e) => e.id} rows={rows} columns={cols} onRowClick={(e) => onSelect(edgeSel(e))} selected={isSelEdge} empty={t("play.stage.empty")} />
      {rows.length < model.edges.length && (
        <button type="button" className="key sm quiet pl-table-more" onClick={() => startTransition(() => setAll(true))}>
          {t("play.stage.tableAll", { n: int(model.edges.length) })}
        </button>
      )}
      <Table<StageNode> caption={t("ui.graph.tablePeople")} showCaption stack rowKey={(n) => n.id} rows={model.nodes} columns={people} onRowClick={(n) => onSelect({ kind: "participant", id: n.id })} selected={(n) => selected?.kind === "participant" && selected.id === n.id} />
    </div>
  );
}

