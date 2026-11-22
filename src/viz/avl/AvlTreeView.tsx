// AvlTreeView: a tracker or reserve tree. The real AVL+ shape (wasm backend: internal nodes with their balance,
// leaves with key, value and the −∞ sentinel), the entries in key order with their value bytes, and the digest as a
// fingerprint glyph. New and updated entries and digest changes are marked as they happen.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toBytes, type AuthenticatedMap, type Hex } from "@/protocol";
import type { AvlTreeNode, ErgoAvlMap } from "@/protocol/avl-wasm";
import { ERG_UNIT, fmtInt, shortHex, toHexStr, type UnitInfo } from "../core/format";
import { useVizT } from "../core/lang";
import { useReducedMotion } from "../core/motion";
import { HexBlock, Tag } from "../core/primitives";
import { describeAvlValue, type AvlValueKind } from "./AvlProofViewer";
import { DigestGlyph } from "./DigestGlyph";
import "../core/core.css";
import "./avl.css";

export interface AvlTreeViewProps {
  map: AuthenticatedMap;
  /** Bump when the map changes (maps mutate in place): e.g. its digest hex or an event seq. */
  version?: string | number;
  title?: ReactNode;
  valueKind?: AvlValueKind;
  unit?: UnitInfo;
  /** Key hex → who it belongs to ("Alice → Bob"). */
  keyName?: (keyHex: string) => string | undefined;
  /** The digest is committed on chain (holo glyph). */
  committed?: boolean;
  highlight?: Uint8Array | Hex;
  /** Draw the tree up to this many entries (default 24); the list always has all. */
  maxDraw?: number;
  className?: string;
}

interface Laid {
  x: number;
  depth: number;
  node: AvlTreeNode;
  id: string;
}

function layoutTree(root: AvlTreeNode): { nodes: Laid[]; edges: Array<[Laid, Laid]>; leaves: number; depth: number } {
  const nodes: Laid[] = [];
  const edges: Array<[Laid, Laid]> = [];
  let leaf = 0;
  let maxDepth = 0;
  const rec = (n: AvlTreeNode, depth: number, path: string): Laid => {
    maxDepth = Math.max(maxDepth, depth);
    if (n.kind !== "internal") {
      const l: Laid = { x: leaf++, depth, node: n, id: path };
      nodes.push(l);
      return l;
    }
    const a = rec(n.left, depth + 1, path + "0");
    const b = rec(n.right, depth + 1, path + "1");
    const me: Laid = { x: (a.x + b.x) / 2, depth, node: n, id: path };
    nodes.push(me);
    edges.push([me, a], [me, b]);
    return me;
  };
  rec(root, 0, "r");
  return { nodes, edges, leaves: leaf, depth: maxDepth };
}

const isSentinel = (k: Uint8Array) => k.every((x) => x === 0);

function TreeDrawing({ root, fresh, highlight, keyName, t }: { root: AvlTreeNode; fresh: ReadonlySet<string>; highlight: string | null; keyName?: (k: string) => string | undefined; t: ReturnType<typeof useVizT> }) {
  const { nodes, edges, leaves, depth } = useMemo(() => layoutTree(root), [root]);
  const DX = 74;
  const DY = 58;
  const W = Math.max(1, leaves) * DX;
  const H = (depth + 1) * DY + 12;
  const pos = (l: Laid) => [l.x * DX + DX / 2, l.depth * DY + 22] as const;
  return (
    <div className="vz-avl-drawing">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("viz.avl.tree")}>
        {edges.map(([a, b], i) => {
          const [x1, y1] = pos(a);
          const [x2, y2] = pos(b);
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="edge" />;
        })}
        {nodes.map((l) => {
          const [x, y] = pos(l);
          const n = l.node;
          if (n.kind === "internal") {
            return (
              <g key={l.id} className="inode">
                <title>{`label ${toHexStr(n.label)}`}</title>
                <circle cx={x} cy={y} r={10} />
                <text x={x} y={y + 3.5} textAnchor="middle">
                  {n.balance === 0 ? "0" : n.balance > 0 ? "+1" : "−1"}
                </text>
              </g>
            );
          }
          if (n.kind === "pruned") {
            return (
              <g key={l.id} className="pnode">
                <title>{`label ${toHexStr(n.label)}`}</title>
                <rect x={x - 12} y={y - 9} width={24} height={18} rx={2} />
              </g>
            );
          }
          const kh = toHexStr(n.key);
          const sentinel = isSentinel(n.key);
          const name = sentinel ? t("viz.avl.sentinel") : keyName?.(kh) ?? shortHex(kh, 4, 0).replace("…", "");
          return (
            <g key={l.id} className={`leaf${fresh.has(kh) ? " fresh" : ""}${highlight === kh ? " hl" : ""}${sentinel ? " sentinel" : ""}`}>
              <title>{`key ${kh}\nvalue ${toHexStr(n.value) || "∅"}\nnext ${toHexStr(n.nextKey)}\nlabel ${toHexStr(n.label)}`}</title>
              <rect x={x - 33} y={y - 13} width={66} height={30} rx={3} />
              <text x={x} y={y} textAnchor="middle" className="k">
                {name.length > 11 ? name.slice(0, 10) + "…" : name}
              </text>
              <text x={x} y={y + 11} textAnchor="middle" className="v">
                {sentinel ? "" : shortHex(kh, 4, 4)}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function AvlTreeView(p: AvlTreeViewProps) {
  const t = useVizT();
  const reduced = useReducedMotion();
  const { map } = p;
  const digest = map.digest();
  const digestHex = toHexStr(digest);
  const entries = useMemo(() => map.entries().map(([k, v]) => ({ k: toHexStr(k), v, vh: toHexStr(v) })), [map, digestHex, p.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = useRef<Map<string, string> | null>(null);
  const prevDigest = useRef<string | null>(null);
  const [fresh, setFresh] = useState<Map<string, "new" | "updated">>(new Map());
  const [ping, setPing] = useState(false);
  useEffect(() => {
    const before = prev.current;
    const next = new Map(entries.map((e) => [e.k, e.vh]));
    if (before) {
      const f = new Map<string, "new" | "updated">();
      for (const [k, v] of next) {
        if (!before.has(k)) f.set(k, "new");
        else if (before.get(k) !== v) f.set(k, "updated");
      }
      setFresh(f);
    }
    prev.current = next;
    if (prevDigest.current !== null && prevDigest.current !== digestHex && !reduced) {
      setPing(true);
      const id = window.setTimeout(() => setPing(false), 1400);
      prevDigest.current = digestHex;
      return () => window.clearTimeout(id);
    }
    prevDigest.current = digestHex;
  }, [entries, digestHex, reduced]);

  const highlight = useMemo(() => {
    if (!p.highlight) return null;
    try {
      return typeof p.highlight === "string" ? p.highlight.toLowerCase() : toHexStr(p.highlight);
    } catch {
      return null;
    }
  }, [p.highlight]);
  void toBytes;
  const wasm = !map.simulated && typeof (map as ErgoAvlMap).prover?.dump === "function";
  const maxDraw = p.maxDraw ?? 24;
  const root = useMemo(() => (wasm && entries.length <= maxDraw ? (map as ErgoAvlMap).prover.dump() : null), [wasm, map, entries, maxDraw]);
  const height = wasm ? (map as ErgoAvlMap).prover.height : null;
  const unit = p.unit ?? ERG_UNIT;
  const kind = p.valueKind ?? "raw";
  const backendName = map.simulated ? t("viz.avl.backend.simulated") : t("viz.avl.backend.wasm");
  const freshKeys = useMemo(() => new Set(fresh.keys()), [fresh]);

  return (
    <section className={`vz vz-panel vz-avlt${p.className ? " " + p.className : ""}`} aria-label={t("viz.avl.treeEyebrow")}>
      <header className="vz-head">
        <DigestGlyph digest={digest} size={52} holo={p.committed} ping={ping} />
        <div className="vz-head-t">
          <div className="vz-eyebrow">
            {t("viz.avl.treeEyebrow")}
            {ping ? <> · <b>{t("viz.avl.digestChanged")}</b></> : null}
          </div>
          <h3 className="vz-title">{p.title ?? t("viz.avl.tree")}</h3>
          <p className="vz-sub">{height !== null ? t("viz.avl.treeSub", { n: fmtInt(entries.length), h: height, backend: backendName }) : t("viz.avl.treeSubSim", { n: fmtInt(entries.length), backend: backendName })}</p>
        </div>
        <div className="vz-head-a">
          <code className="vz-avl-dhex">{shortHex(digestHex, 8, 6)}</code>
        </div>
      </header>
      <div className="vz-body">
        {entries.length === 0 ? <p className="vz-p">{t("viz.avl.empty")}</p> : null}
        {root ? <TreeDrawing root={root} fresh={freshKeys} highlight={highlight} keyName={p.keyName} t={t} /> : wasm && entries.length > maxDraw ? <p className="vz-small">{t("viz.avl.treeTooBig", { n: maxDraw })}</p> : null}
        {entries.length ? (
          <div className="vz-field">
            <div className="vz-field-l">{t("viz.avl.entries")}</div>
            <table className="vz-avl-entries">
              <thead>
                <tr>
                  <th>{t("viz.avl.col.key")}</th>
                  <th>{t("viz.avl.col.value")}</th>
                  <th className="col-b">{t("viz.avl.col.bytes")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const f = fresh.get(e.k);
                  return (
                    <tr key={e.k} className={`${f ? "fresh" : ""}${highlight === e.k ? " hl" : ""}`}>
                      <td>
                        {p.keyName?.(e.k) ? <span className="nm">{p.keyName(e.k)}</span> : null} <code>{shortHex(e.k)}</code> {f ? <Tag tone="up">{t(f === "new" ? "viz.avl.newEntry" : "viz.avl.updated")}</Tag> : null}
                      </td>
                      <td>{describeAvlValue(e.v, kind, unit, t)}</td>
                      <td className="col-b">
                        <HexBlock hex={e.vh} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default AvlTreeView;
