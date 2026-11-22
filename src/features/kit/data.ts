// Sample data for the kit: the style tile's circle (VISUAL §13: one note Alice → Bob, one reserve Alice 132 %, one
// tracker T-01 at 37 blocks). Sample only, never real keys.
import { DEMO_PK, DEMO_TRACKER_NFT, demoNoteSigs, demoPair, hex, rng, utf8, blake2b256, type GraphEdge, type GraphLoop, type GraphNode, type NoteProps } from "./deps";

export const PK = DEMO_PK;
export const KEY_AB = demoPair("Alice", "Bob");
export const KEY_AB_HEX = hex(KEY_AB);
export const SIGS_AB = demoNoteSigs(KEY_AB);
export const DIGEST = "9f3c1a2d07be55c0" + "4be1a0c3d5f60718293a4b5c6d7e8f90a1b2c3d4" + "2d18f0c7e1";
export const TRACKER_NFT = DEMO_TRACKER_NFT;

export const NOTE_AB: NoteProps = { issuer: "Alice", receiver: "Bob", amount: 1240, prev: 1000, limit: 2000, settled: 0, digest: DIGEST, block: 1921400, tracker: "T-01", trackerId: "t1" };
export const NOTE_BC: NoteProps = { issuer: "Bob", receiver: "Carol", amount: 320, prev: 260, limit: 400, digest: DIGEST, block: 1921400 };
export const NOTE_EB: NoteProps = { issuer: "Eve", receiver: "Bob", amount: 410, prev: 300, limit: 800, digest: DIGEST, block: 1921400 };

export const GALLERY: [string, string][] = [["Alice", "Bob"], ["Bob", "Alice"], ["Bob", "Carol"], ["Eve", "Bob"], ["Alice", "render·ai"], ["Carol", "Dan"]];
export const NAMES = ["Alice", "Bob", "Carol", "Dan", "Eve", "render·ai", "search·ai"];
export const isAgent = (n: string) => n.endsWith("·ai");

/** The tile's graph, positions in a 1400 × 600 frame. */
export const GRAPH_NODES: GraphNode[] = [
  { id: "Bob", x: 700, y: 172, side: "a" },
  { id: "Alice", x: 372, y: 340, side: "b", reserve: 132 },
  { id: "Carol", x: 1028, y: 340, side: "r" },
  { id: "Dan", x: 700, y: 500, side: "b" },
  { id: "Eve", x: 1112, y: 120, side: "r", reserve: 450 },
  { id: "render·ai", x: 288, y: 120, side: "l", sub: "per call", agent: true },
  { id: "search·ai", x: 110, y: 466, side: "b", sub: "per query", agent: true },
];
export const GRAPH_EDGES: GraphEdge[] = [
  { from: "Alice", to: "Bob", amount: 1240, limit: 2000, bend: -0.16 },
  { from: "Bob", to: "Carol", amount: 320, limit: 400, bend: -0.16 },
  { from: "Carol", to: "Dan", amount: 75, limit: 300, bend: -0.16 },
  { from: "Dan", to: "Alice", amount: 40, limit: 100, bend: -0.16 },
  { from: "Dan", to: "Bob", amount: 300, limit: 400, bend: 0.5 },
  { from: "Eve", to: "Bob", amount: 410, limit: 800, bend: 0.1 },
  { from: "Bob", to: "render·ai", amount: 12.6, limit: 50, bend: 0.12 },
  { from: "Alice", to: "search·ai", amount: 3.2, limit: 20, bend: 0.12 },
];
export const GRAPH_LOOPS: GraphLoop[] = [{ edges: ["Alice>Bob", "Bob>Carol", "Carol>Dan", "Dan>Alice"], label: "loop · 40.00 could clear", at: [585, 338] }];

/** A larger town (36 participants, ~110 lines) laid out by d3-force, for the scale check. */
export function bigTown(): { nodes: GraphNode[]; edges: GraphEdge[]; loops: GraphLoop[] } {
  const R = rng(blake2b256(utf8("basis-kit:big-town")));
  const first = ["Ana", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hana", "Ivo", "Jun", "Kai", "Lea", "Max", "Nia", "Oto", "Pia", "Quin", "Rio", "Sol", "Tia", "Uma", "Vic", "Wen", "Xan", "Yara", "Zed", "Mira", "Noor", "Omar", "Pell"];
  const agents = ["render·ai", "search·ai", "maps·ai", "tts·ai", "ocr·ai", "llm·ai"];
  const nodes: GraphNode[] = [...first, ...agents].map((id) => ({ id, agent: id.endsWith("·ai"), ...(R.range(0, 1) < 0.22 && !id.endsWith("·ai") ? { reserve: Math.round(R.range(90, 260)) } : null) }));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 112; i++) {
    const a = nodes[R.int(0, first.length - 1)].id;
    const b = R.range(0, 1) < 0.2 ? agents[R.int(0, agents.length - 1)] : nodes[R.int(0, first.length - 1)].id;
    if (a === b || seen.has(`${a}>${b}`)) continue;
    seen.add(`${a}>${b}`);
    const limit = [50, 100, 200, 400, 800, 2000][R.int(0, 5)];
    edges.push({ from: a, to: b, amount: Math.round(R.range(0.05, 0.98) * limit * 100) / 100, limit });
  }
  return { nodes, edges, loops: [] };
}

/** Wallet list rows (tile phone): name, direction, amount, sentence, sub, used share, bar kind. */
export const WALLET_ROWS: { name: string; dir: "in" | "out"; amount: number; what: string; whatRu: string; sub: string; subRu: string; used: number; kind: "settled" | "out" | "near" }[] = [
  { name: "Alice", dir: "in", amount: 1240, what: "owes you · backed · **132 ⁠%**", whatRu: "должна вам · обеспечено · **132 ⁠%**", sub: "+240.00 today", subRu: "+240.00 сегодня", used: 1240 / 2000, kind: "settled" },
  { name: "Eve", dir: "in", amount: 410, what: "owes you · backed · **450 ⁠%**", whatRu: "должна вам · обеспечено · **450 ⁠%**", sub: "Tue", subRu: "вт", used: 410 / 800, kind: "settled" },
  { name: "Dan", dir: "in", amount: 300, what: "owes you · on trust · your line 400", whatRu: "должен вам · на доверии · ваш лимит 400", sub: "2 d", subRu: "2 д", used: 300 / 400, kind: "out" },
  { name: "Carol", dir: "out", amount: 320, what: "you owe · her line for you 400 · **80 ⁠%**", whatRu: "вы должны · её лимит для вас 400 · **80 ⁠%**", sub: "15:05", subRu: "15:05", used: 320 / 400, kind: "near" },
  { name: "render·ai", dir: "out", amount: 12.6, what: "you owe · per call · 12.60 of 50.00", whatRu: "вы должны · за вызов · 12.60 из 50.00", sub: "live · 0.0004/call", subRu: "онлайн · 0.0004/вызов", used: 12.6 / 50, kind: "out" },
];
