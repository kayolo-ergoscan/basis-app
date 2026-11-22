// The debt graph (VISUAL §9, §12, §13 Play): 2D, arrows point to who is owed, tube width = the credit line (limit),
// fill = what is owed, metal fill = backed by the debtor's reserve, hatch = on trust, gold rim = reserve coverage,
// octagon = agent, a soft verdigris band = a clearable loop. Port of the tile's graph plus: automatic layout with
// d3-force when nodes have no positions (loops pinned to a ring, then frozen), label sides chosen away from the
// neighbours, the gravity check on hover, zoom and pan, and a table view (the accessible form).
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY, type SimulationLinkDatum, type SimulationNodeDatum } from "d3-force";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { useUid } from "../hooks";
import { demoKey } from "../engine/demo";
import { money, pct } from "../engine/money";
import { keySeed, sealUrl } from "../engine/raster";
import { useUiSettings } from "../settings";
import { Icon } from "./Icon";
import { Tabs } from "./primitives";
import { Table, type Column } from "./Table";

export interface GraphNode {
  id: string;
  label?: string;
  /** Public key (hex) for the seal; defaults to the demo key of the label. */
  pk?: string;
  agent?: boolean;
  /** Reserve coverage in % (adds the gold rim). */
  reserve?: number;
  /** Small line under the net position ("per call"). */
  sub?: string;
  x?: number;
  y?: number;
  /** Label side: a(bove) · b(elow) · l(eft) · r(ight); automatic when omitted. */
  side?: "a" | "b" | "l" | "r";
}
export interface GraphEdge {
  /** Debtor (the issuer of the note). */
  from: string;
  /** Creditor (holds the note): the arrow points here. */
  to: string;
  amount: number;
  limit: number;
  /** Curve: ± share of the length (− bulges to the left of travel). Automatic when omitted. */
  bend?: number;
  /** Backed by the debtor's reserve (default: the debtor has a reserve). */
  backed?: boolean;
}
export interface GraphLoop { edges: string[]; label: string; /** Where to draw the loop mark (default: the loop centroid). */ at?: [number, number] }
export type GraphSel = { kind: "node" | "edge"; id: string } | null;

export interface GraphProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  loops?: GraphLoop[];
  width?: number;
  height?: number;
  view?: "graph" | "table";
  onViewChange?: (v: "graph" | "table") => void;
  selected?: GraphSel;
  onSelect?: (s: GraphSel) => void;
  /** Edge labels: "auto" (all when ≤ 24 edges, else hover/selected), "all", "hover". */
  labels?: "auto" | "all" | "hover";
  /** Toolbar with Graph / Table and zoom (default true). */
  tools?: boolean;
  /** Legend under the graph (default true). */
  legend?: boolean;
  /** Extra content at the right of the toolbar. */
  toolbar?: ReactNode;
  ariaLabel?: string;
  unit?: string;
}

interface Laid { id: string; n: GraphNode; x: number; y: number; r: number; side: "a" | "b" | "l" | "r"; net: number }
interface EdgeGeo { key: string; e: GraphEdge; d: string; tw: number; dw: number; near: boolean; backed: boolean; loop: boolean; head: string; mx: number; my: number; txt: string }

const ek = (e: { from: string; to: string }) => `${e.from}>${e.to}`;

function layout(nodes: GraphNode[], edges: GraphEdge[], loops: GraphLoop[], W: number, H: number): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  if (nodes.every((n) => n.x != null && n.y != null)) { nodes.forEach((n) => pos.set(n.id, { x: n.x!, y: n.y! })); return pos; }
  type SN = SimulationNodeDatum & { id: string };
  const sn: SN[] = nodes.map((n, i) => {
    // deterministic start: a phyllotaxis spiral (d3 would otherwise jitter with Math.random)
    const a = i * 2.399963, r = 40 * Math.sqrt(i + 0.5);
    return { id: n.id, x: n.x ?? W / 2 + r * Math.cos(a), y: n.y ?? H / 2 + r * Math.sin(a), ...(n.x != null && n.y != null ? { fx: n.x, fy: n.y } : null) };
  });
  const byId = new Map(sn.map((n) => [n.id, n]));
  // loops: pin their nodes on a ring first
  const ring = loops[0];
  if (ring) {
    const ids: string[] = [];
    for (const k of ring.edges) { const [a] = k.split(">"); if (!ids.includes(a)) ids.push(a); }
    const R = Math.min(H * 0.32, 60 + ids.length * 38);
    ids.forEach((id, i) => {
      const n = byId.get(id);
      if (!n || n.fx != null) return;
      const a = -Math.PI / 2 - (i / ids.length) * Math.PI * 2;
      n.fx = W / 2 + R * 1.6 * Math.cos(a); n.fy = H / 2 + R * Math.sin(a);
    });
  }
  const links: SimulationLinkDatum<SN>[] = edges.filter((e) => byId.has(e.from) && byId.has(e.to)).map((e) => ({ source: e.from, target: e.to }));
  const sim = forceSimulation(sn)
    .force("charge", forceManyBody().strength(-900))
    .force("link", forceLink<SN, SimulationLinkDatum<SN>>(links).id((d) => d.id).distance(260).strength(0.4))
    .force("collide", forceCollide(70))
    .force("center", forceCenter(W / 2, H / 2))
    .force("x", forceX(W / 2).strength(0.04))
    .force("y", forceY(H / 2).strength(0.09))
    .stop();
  const ticks = Math.min(400, 120 + nodes.length * 6);
  for (let i = 0; i < ticks; i++) sim.tick();
  // fit into the frame (90 px margin for labels). Each axis scales on its own, up to 1.8× apart, so a round
  // force layout fills a wide frame instead of bunching in the middle.
  const xs = sn.map((n) => n.x!), ys = sn.map((n) => n.y!);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const m = 90;
  let sx = Math.min(1.6, (W - 2 * m) / Math.max(1, x1 - x0)), sy = Math.min(1.6, (H - 2 * m) / Math.max(1, y1 - y0));
  if (sx > sy * 1.8) sx = sy * 1.8;
  if (sy > sx * 1.8) sy = sx * 1.8;
  const ox = (W - (x1 - x0) * sx) / 2, oy = (H - (y1 - y0) * sy) / 2;
  sn.forEach((n) => pos.set(n.id, { x: ox + (n.x! - x0) * sx, y: oy + (n.y! - y0) * sy }));
  return pos;
}

export function Graph({ nodes, edges, loops = [], width: W = 1400, height: H = 600, view: viewP, onViewChange, selected, onSelect, labels = "auto", tools = true, legend = true, toolbar, ariaLabel, unit = "ERG" }: GraphProps) {
  const t = useT();
  const ui = useUiSettings();
  const uid = useUid("g");
  const [viewS, setViewS] = useState<"graph" | "table">("graph");
  const view = viewP ?? viewS;
  const setView = (v: "graph" | "table") => { setViewS(v); onViewChange?.(v); };
  const [hover, setHover] = useState<string | null>(null);
  const [hoverEdge, setHoverEdge] = useState<string | null>(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: W, h: H });
  useEffect(() => setVb({ x: 0, y: 0, w: W, h: H }), [W, H]);

  const geo = useMemo(() => {
    const pos = layout(nodes, edges, loops, W, H);
    const net = new Map<string, number>();
    nodes.forEach((n) => net.set(n.id, 0));
    edges.forEach((e) => { net.set(e.from, (net.get(e.from) ?? 0) - e.amount); net.set(e.to, (net.get(e.to) ?? 0) + e.amount); });
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const rad = (n?: GraphNode) => (n?.reserve != null ? 41 : 31);
    const loopKeys = new Set(loops.flatMap((l) => l.edges));
    const maxLimit = Math.max(2000, ...edges.map((e) => e.limit));
    const tube = (l: number) => 6 + 16 * Math.sqrt(l / maxLimit);
    // loop centroid (for automatic bends and the loop mark)
    const loopC = loops.map((l) => {
      const ids = [...new Set(l.edges.map((k) => k.split(">")[0]))].filter((id) => pos.has(id));
      const c = ids.reduce((s, id) => ({ x: s.x + pos.get(id)!.x / ids.length, y: s.y + pos.get(id)!.y / ids.length }), { x: 0, y: 0 });
      return { x: l.at ? l.at[0] : c.x, y: l.at ? l.at[1] : c.y - 10, cx: c.x, cy: c.y, label: l.label, n: ids.length };
    });
    const pairs = new Set(edges.map(ek));
    const eg: EdgeGeo[] = [];
    for (const e of edges) {
      const A = pos.get(e.from), B = pos.get(e.to);
      if (!A || !B) continue;
      const nA = byId.get(e.from), loop = loopKeys.has(ek(e));
      const backed = e.backed ?? nA?.reserve != null;
      const dx = B.x - A.x, dy = B.y - A.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
      const ctl = (b: number) => ({ x: (A.x + B.x) / 2 - uy * b * len, y: (A.y + B.y) / 2 + ux * b * len });
      let bend = e.bend;
      if (bend == null) {
        if (loop && loopC[0]) {
          const p1 = ctl(0.16), p2 = ctl(-0.16), c = { x: loopC[0].cx, y: loopC[0].cy };
          bend = Math.hypot(p1.x - c.x, p1.y - c.y) > Math.hypot(p2.x - c.x, p2.y - c.y) ? 0.16 : -0.16;
        } else bend = pairs.has(`${e.to}>${e.from}`) ? 0.16 : 0.12;
      }
      const { x: cx, y: cy } = ctl(bend);
      const aim = (P: { x: number; y: number }, r: number) => { const vx = cx - P.x, vy = cy - P.y, vl = Math.hypot(vx, vy) || 1; return [P.x + (vx / vl) * r, P.y + (vy / vl) * r]; };
      const [sx, sy] = aim(A, rad(nA) + 4), [ex, ey] = aim(B, rad(byId.get(e.to)) + 6);
      const d = `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
      const tw = tube(e.limit), used = e.limit > 0 ? Math.min(1, e.amount / e.limit) : 1, dw = Math.max(2.2, (tw - 4) * used), near = used >= 0.8;
      const tx = ex - cx, ty = ey - cy, tl = Math.hypot(tx, ty) || 1, nx = tx / tl, ny = ty / tl, sz = 7 + tw * 0.32;
      const head = `M${(ex - nx * sz * 1.5 - ny * sz).toFixed(1)} ${(ey - ny * sz * 1.5 + nx * sz).toFixed(1)} L${(ex + nx * 2).toFixed(1)} ${(ey + ny * 2).toFixed(1)} L${(ex - nx * sz * 1.5 + ny * sz).toFixed(1)} ${(ey - ny * sz * 1.5 - nx * sz).toFixed(1)} Z`;
      const mx = 0.25 * sx + 0.5 * cx + 0.25 * ex, my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
      const txt = `${money(e.amount, e.amount < 100 ? 2 : 0)} / ${money(e.limit, 0)}`;
      eg.push({ key: ek(e), e, d, tw, dw, near, backed, loop, head, mx, my, txt });
    }
    // node label sides: away from the neighbours
    const nb = new Map<string, { x: number; y: number }>();
    for (const e of edges) {
      const A = pos.get(e.from), B = pos.get(e.to);
      if (!A || !B) continue;
      const add = (id: string, P: { x: number; y: number }, Q: { x: number; y: number }) => {
        const l = Math.hypot(Q.x - P.x, Q.y - P.y) || 1, v = nb.get(id) ?? { x: 0, y: 0 };
        nb.set(id, { x: v.x + (Q.x - P.x) / l, y: v.y + (Q.y - P.y) / l });
      };
      add(e.from, A, B); add(e.to, B, A);
    }
    const laid: Laid[] = nodes.filter((n) => pos.has(n.id)).map((n) => {
      const p = pos.get(n.id)!, v = nb.get(n.id);
      let side = n.side;
      if (!side) side = !v || (Math.abs(v.x) < 0.2 && Math.abs(v.y) < 0.2) ? "b" : Math.abs(v.y) >= Math.abs(v.x) ? (v.y > 0 ? "a" : "b") : v.x > 0 ? "l" : "r";
      return { id: n.id, n, x: p.x, y: p.y, r: rad(n), side, net: net.get(n.id) ?? 0 };
    });
    return { laid, eg, loopC };
  }, [nodes, edges, loops, W, H]);

  const showAll = labels === "all" || (labels === "auto" && edges.length <= 24);
  // dense graphs (a town, not a circle): nodes show their name only; net and reserve appear on hover or selection
  const dense = labels !== "all" && nodes.length > 16;
  const selKey = selected?.id ?? null;
  const focusNode = hover && geo.laid.find((l) => l.id === hover)?.n.reserve != null ? hover : null;

  // zoom / pan
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: typeof vb; moved: boolean } | null>(null);
  const zoom = useCallback((f: number, cx?: number, cy?: number) => {
    setVb((v) => {
      const w = Math.min(W, Math.max(W / 6, v.w / f)), h = (w / W) * H;
      const px = cx ?? v.x + v.w / 2, py = cy ?? v.y + v.h / 2;
      const x = px - ((px - v.x) * w) / v.w, y = py - ((py - v.y) * h) / v.h;
      return { x: Math.max(-W * 0.2, Math.min(W * 1.2 - w, x)), y: Math.max(-H * 0.2, Math.min(H * 1.2 - h, y)), w, h };
    });
  }, [W, H]);
  const toSvg = (clientX: number, clientY: number) => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: vb.x + ((clientX - r.left) / r.width) * vb.w, y: vb.y + ((clientY - r.top) / r.height) * vb.h };
  };
  const zoomed = vb.w < W - 1;
  // phone: the graph is wider than its card (min width 860) and scrolls; start in the middle, not at the left edge
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && el.scrollWidth > el.clientWidth + 1) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [view, W, H]);

  const nodeLabel = (l: Laid) => [
    l.n.label ?? l.id,
    `${t("ui.graph.net")} ${l.net > 0 ? "+" : ""}${money(l.net)}`,
    l.n.reserve != null ? t("ui.graph.reserve", { pct: pct(l.n.reserve) }) : t("ui.graph.noReserve"),
    l.n.agent ? t("ui.graph.agent") : "",
  ].filter(Boolean).join(" · ");

  const dimCss = focusNode ? `.${uid} .edge:not([data-from="${CSS.escape(focusNode)}"]){opacity:.14}` : "";

  const table = (
    <div className="stack" style={{ "--gap": "24px" } as React.CSSProperties}>
      <Table<EdgeGeo>
        caption={t("ui.graph.tableDebts")}
        stack
        rowKey={(r) => r.key}
        rows={geo.eg}
        selected={(r) => selected?.kind === "edge" && selected.id === r.key}
        onRowClick={onSelect ? (r) => onSelect({ kind: "edge", id: r.key }) : undefined}
        columns={[
          { key: "from", label: t("ui.graph.col.debtor"), lead: true, render: (r) => <>{nodeName(nodes, r.e.from)} <span className="dim">→</span> {nodeName(nodes, r.e.to)}</> },
          { key: "amount", label: t("ui.graph.col.owed"), align: "right", render: (r) => <span className="num">{ui.privacy ? "•••" : money(r.e.amount)} {unit}</span> },
          { key: "limit", label: t("ui.graph.col.limit"), align: "right", render: (r) => <span className="num">{money(r.e.limit, 0)}</span> },
          { key: "used", label: t("ui.graph.col.used"), align: "right", render: (r) => <span className={`num${r.near ? " alarm-t" : ""}`}>{pct(r.e.limit ? (r.e.amount / r.e.limit) * 100 : 100)}</span> },
          { key: "backing", label: t("ui.graph.col.backing"), render: (r) => <>{r.backed ? t("ui.graph.backed") : t("ui.graph.trust")}{r.loop ? ` · ${t("ui.graph.inLoop")}` : ""}</> },
        ] as Column<EdgeGeo>[]}
      />
      <Table<Laid>
        caption={t("ui.graph.tablePeople")}
        stack
        rowKey={(r) => r.id}
        rows={geo.laid}
        selected={(r) => selected?.kind === "node" && selected.id === r.id}
        onRowClick={onSelect ? (r) => onSelect({ kind: "node", id: r.id }) : undefined}
        columns={[
          { key: "name", label: t("ui.graph.col.name"), lead: true, render: (r) => <>{r.n.label ?? r.id}{r.n.agent ? " · AI" : ""}</> },
          { key: "net", label: t("ui.graph.col.net"), align: "right", render: (r) => <span className={`num${r.net > 0 ? " up" : ""}`}>{ui.privacy ? "•••" : `${r.net > 0 ? "+" : ""}${money(r.net)}`}</span> },
          { key: "res", label: t("ui.graph.col.reserve"), align: "right", render: (r) => (r.n.reserve != null ? <span className="num metal-t">{pct(r.n.reserve)}</span> : <span className="dim">—</span>) },
        ] as Column<Laid>[]}
      />
    </div>
  );

  return (
    <div className="graph-card stack" style={{ "--gap": "14px" } as React.CSSProperties}>
      {tools && (
        <div className="spread graph-tools">
          <Tabs ariaLabel={t("ui.graph.view")} value={view} onChange={setView} tabs={[{ id: "graph", label: t("ui.graph.graph") }, { id: "table", label: t("ui.graph.table") }]} />
          <div className="cluster">
            {toolbar}
            {view === "graph" && <>
              <button type="button" className="key sm icon-only" onClick={() => zoom(1.25)} aria-label={t("ui.graph.zoomIn")}><Icon name="zoomIn" /></button>
              <button type="button" className="key sm icon-only" onClick={() => zoom(0.8)} aria-label={t("ui.graph.zoomOut")} disabled={!zoomed}><Icon name="zoomOut" /></button>
              <button type="button" className="key sm icon-only" onClick={() => setVb({ x: 0, y: 0, w: W, h: H })} aria-label={t("ui.graph.fit")} disabled={!zoomed}><Icon name="fit" /></button>
            </>}
          </div>
        </div>
      )}
      {view === "table" ? table : (
        <div className="graph-view scroll" ref={scrollRef}>
          <div className={`graph ${uid}${zoomed ? " zoomed" : ""}`}>
            {dimCss && <style>{dimCss}</style>}
            <svg
              ref={svgRef}
              viewBox={`${vb.x.toFixed(1)} ${vb.y.toFixed(1)} ${vb.w.toFixed(1)} ${vb.h.toFixed(1)}`}
              role="group"
              aria-label={ariaLabel ?? t("ui.graph.aria")}
              style={{ cursor: zoomed ? (drag.current ? "grabbing" : "grab") : undefined }}
              onWheel={(e) => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const p = toSvg(e.clientX, e.clientY); zoom(e.deltaY < 0 ? 1.15 : 0.87, p.x, p.y); }}
              onPointerDown={(e) => { if (!zoomed || (e.target as Element).closest(".node,.edge")) return; drag.current = { x: e.clientX, y: e.clientY, vb, moved: false }; (e.currentTarget as Element).setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                const r = svgRef.current!.getBoundingClientRect();
                const dx = ((e.clientX - d.x) / r.width) * d.vb.w, dy = ((e.clientY - d.y) / r.height) * d.vb.h;
                d.moved = true;
                setVb({ ...d.vb, x: d.vb.x - dx, y: d.vb.y - dy });
              }}
              onPointerUp={() => { drag.current = null; }}
              onClick={(e) => { if (!(e.target as Element).closest(".node,.edge")) onSelect?.(null); }}
            >
              <defs>
                <pattern id={`${uid}-h`} width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="4.6" height="4.6" fill="var(--surface)" /><rect width="1.7" height="4.6" fill="var(--ink-2)" />
                </pattern>
              </defs>
              {geo.eg.filter((g) => g.loop).map((g) => <path key={"u" + g.key} d={g.d} stroke="var(--up)" strokeOpacity={0.16} strokeWidth={(g.tw + 12).toFixed(1)} fill="none" strokeLinecap="round" />)}
              {geo.eg.map((g) => (
                <g key={g.key} className={`edge${selKey === g.key ? " sel" : ""}`} data-from={g.e.from}
                  onClick={(ev) => { ev.stopPropagation(); onSelect?.({ kind: "edge", id: g.key }); }}
                  onMouseEnter={() => setHoverEdge(g.key)} onMouseLeave={() => setHoverEdge(null)}>
                  <path d={g.d} stroke="var(--rule-2)" strokeWidth={(g.tw + 2).toFixed(1)} fill="none" strokeLinecap="round" />
                  <path d={g.d} stroke="var(--surface)" strokeWidth={g.tw.toFixed(1)} fill="none" strokeLinecap="round" />
                  <path className="body" d={g.d} stroke={g.backed ? "var(--metal)" : `url(#${uid}-h)`} strokeWidth={g.dw.toFixed(1)} fill="none" strokeLinecap="round" />
                  {g.backed && <path d={g.d} stroke="var(--paper-hi)" strokeOpacity={0.5} strokeWidth={(g.dw * 0.22).toFixed(1)} fill="none" strokeLinecap="round" />}
                  <path d={g.head} fill={g.backed ? "var(--metal)" : "var(--ink-2)"} />
                </g>
              ))}
              {geo.eg.filter((g) => showAll || g.key === hoverEdge || g.key === selKey || (focusNode && g.e.from === focusNode)).map((g) => {
                const w = g.txt.length * 7.25 + 18;
                return (
                  <g key={"l" + g.key} transform={`translate(${g.mx.toFixed(1)} ${g.my.toFixed(1)})`} pointerEvents="none">
                    <rect x={(-w / 2).toFixed(1)} y={-12} width={w.toFixed(1)} height={24} rx={12} fill="var(--surface)" stroke={g.near ? "var(--alarm)" : "var(--rule-2)"} />
                    <text className="edge-label" textAnchor="middle" y={4.2} style={g.near ? { fill: "var(--alarm)" } : undefined}>{ui.privacy ? "••• / " + money(g.e.limit, 0) : g.txt}</text>
                  </g>
                );
              })}
              {geo.loopC.map((c, i) => (
                <g key={"lp" + i} transform={`translate(${c.x.toFixed(1)} ${c.y.toFixed(1)})`} pointerEvents="none">
                  <path d="M13 0a13 13 0 1 1-3.8-9.2" fill="none" stroke="var(--up)" strokeWidth={1.8} strokeLinecap="round" />
                  <path d="M13 -13v5h-5" fill="none" stroke="var(--up)" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
                  <text className="loop-label" textAnchor="middle" y={36}>{c.label}</text>
                </g>
              ))}
              {geo.laid.map((l) => {
                const R = l.r, nv = l.net, o = l.n;
                const full = !dense || hover === l.id || (selected?.kind === "node" && selected.id === l.id);
                const lines: [string, string][] = [[o.label ?? l.id, "node-name"]];
                if (full) lines.push([`${nv > 0 ? "+" : nv < 0 ? "−" : ""}${ui.privacy ? "•••" : money(Math.abs(nv))}${o.sub ? " · " + o.sub : ""}`, "node-sub" + (nv > 0 ? " pos" : "")]);
                if (full && o.reserve != null) lines.push([t("ui.graph.reserve", { pct: pct(o.reserve) }), "node-res"]);
                const at = { b: [0, R + 20, "middle"], a: [0, -(R + 14) - 17 * (lines.length - 1), "middle"], l: [-(R + 14), -6, "end"], r: [R + 14, -6, "start"] }[l.side] as [number, number, "middle" | "end" | "start"];
                const e = o.reserve != null ? Math.min(1, o.reserve / 200) : 0, a1 = -Math.PI / 2 + e * Math.PI * 2;
                const seal = sealUrl(keySeed(o.pk ?? demoKey(o.label ?? l.id)), { kind: o.agent ? "agent" : "person", detail: 0.35, px: 56 });
                return (
                  <g key={l.id} className={`node${selected?.kind === "node" && selected.id === l.id ? " sel" : ""}`} transform={`translate(${l.x.toFixed(1)} ${l.y.toFixed(1)})`}
                    tabIndex={0} role="button" aria-label={nodeLabel(l)} aria-pressed={selected?.kind === "node" && selected.id === l.id}
                    onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(l.id)} onBlur={() => setHover(null)}
                    onClick={(ev) => { ev.stopPropagation(); onSelect?.({ kind: "node", id: l.id }); }}
                    onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onSelect?.({ kind: "node", id: l.id }); } }}>
                    <circle className="focus-ring" r={R + 6} />
                    {o.reserve != null && <>
                      <circle r={37} fill="none" stroke="var(--rule-2)" strokeWidth={3.5} />
                      {e >= 1 ? <circle r={37} fill="none" stroke="var(--metal)" strokeWidth={3.5} />
                        : <path d={`M0 -37 A37 37 0 ${e > 0.5 ? 1 : 0} 1 ${(37 * Math.cos(a1)).toFixed(1)} ${(37 * Math.sin(a1)).toFixed(1)}`} fill="none" stroke="var(--metal)" strokeWidth={3.5} strokeLinecap="round" />}
                    </>}
                    <circle r={29} fill="var(--surface)" />
                    <image href={seal} x={-28} y={-28} width={56} height={56} />
                    {lines.map(([tx, c], i) => <text key={i} className={c} x={at[0]} y={at[1] + i * 17} textAnchor={at[2]}>{tx}</text>)}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
      {legend && view === "graph" && <GraphLegend hatchId={`${uid}-lh`} />}
    </div>
  );
}

const nodeName = (nodes: GraphNode[], id: string) => nodes.find((n) => n.id === id)?.label ?? id;

/** The tile's legend: tube = limit · fill = owed, backed, on trust, gold rim, AI agent, clearable loop. */
export function GraphLegend({ hatchId = "glh" }: { hatchId?: string }) {
  const t = useT();
  return (
    <div className="graph-legend">
      <span><svg width="40" height="16" aria-hidden="true"><path d="M8 8H32" stroke="var(--rule-2)" strokeWidth="14" strokeLinecap="round" /><path d="M8 8H32" stroke="var(--surface)" strokeWidth="12" strokeLinecap="round" /><path d="M8 8H20" stroke="var(--ink-2)" strokeWidth="6" strokeLinecap="round" /></svg>{t("ui.graph.lg.tube")}</span>
      <span><svg width="28" height="10" aria-hidden="true"><path d="M3 5H25" stroke="var(--metal)" strokeWidth="5" strokeLinecap="round" /></svg>{t("ui.graph.lg.backed")}</span>
      <span><svg width="28" height="10" aria-hidden="true"><defs><pattern id={hatchId} width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4.6" height="4.6" fill="var(--surface)" /><rect width="1.7" height="4.6" fill="var(--ink-2)" /></pattern></defs><path d="M3 5H25" stroke={`url(#${hatchId})`} strokeWidth="5" strokeLinecap="round" /></svg>{t("ui.graph.lg.trust")}</span>
      <span><span style={{ width: 14, height: 14, borderRadius: "50%", boxShadow: "0 0 0 2.5px var(--metal)" }} />{t("ui.graph.lg.rim")}</span>
      <span><span style={{ width: 14, height: 14, clipPath: "polygon(30% 0,70% 0,100% 30%,100% 70%,70% 100%,30% 100%,0 70%,0 30%)", background: "var(--ink-3)" }} />{t("ui.graph.lg.agent")}</span>
      <span style={{ color: "var(--up)" }}><span style={{ width: 22, height: 10, borderRadius: 5, background: "color-mix(in srgb,var(--up) 22%,transparent)" }} />{t("ui.graph.lg.loop")}</span>
    </div>
  );
}
