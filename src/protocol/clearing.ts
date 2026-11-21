// Debt-graph analysis for clearing: cycles (A owes B owes C owes A), net positions and a settlement plan.
//
// In Basis cumulative totals never decrease, so a cycle is not "netted" by rewriting notes. It is cleared
//   • on-chain: ONE transaction redeems `amount` along every edge (each debtor's reserve pays its creditor);
//     every edge's outstanding debt drops by `amount` and every member's net worth is unchanged: its wallet
//     gains `amount`, its own reserve pays `amount` (collateral that backed the loop is released).
//     At most 10 reserves per transaction (#0 % 10 = output index).
//   • off-chain: each creditor waives `amount` of its incoming edge. Cheap, but a waiver is only a promise:
//     the contract would still let the creditor redeem the full note.

export interface DebtEdge {
  /** Debtor (note issuer). */
  from: string;
  /** Creditor (note holder). */
  to: string;
  amount: bigint;
}

export interface DebtCycle {
  /** members[i] owes members[i + 1]; the last owes the first. Starts at the smallest id. */
  members: string[];
  edges: DebtEdge[];
  /** Largest amount clearable around the cycle (the smallest edge). */
  amount: bigint;
}

function adjacency(edges: DebtEdge[]): Map<string, Map<string, bigint>> {
  const adj = new Map<string, Map<string, bigint>>();
  for (const e of edges) {
    if (e.amount <= 0n || e.from === e.to) continue;
    if (!adj.has(e.from)) adj.set(e.from, new Map());
    const m = adj.get(e.from)!;
    m.set(e.to, (m.get(e.to) ?? 0n) + e.amount);
  }
  return adj;
}

/** Elementary cycles up to `maxLen` members, each reported once (rotation starting at its smallest member). */
export function findCycles(edges: DebtEdge[], maxLen = 8, limit = 64): DebtCycle[] {
  const adj = adjacency(edges);
  const nodes = [...adj.keys()].sort();
  const out: DebtCycle[] = [];
  for (const start of nodes) {
    const path: string[] = [start];
    const onPath = new Set(path);
    const dfs = (node: string) => {
      if (out.length >= limit) return;
      const next = adj.get(node);
      if (!next) return;
      for (const [to, amt] of [...next.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        void amt;
        if (to === start && path.length >= 2) {
          const members = [...path];
          const cyc: DebtEdge[] = members.map((m, i) => ({ from: m, to: members[(i + 1) % members.length], amount: adj.get(m)!.get(members[(i + 1) % members.length])! }));
          const amount = cyc.reduce((min, e) => (e.amount < min ? e.amount : min), cyc[0].amount);
          out.push({ members, edges: cyc, amount });
          if (out.length >= limit) return;
          continue;
        }
        if (to <= start || onPath.has(to) || path.length >= maxLen) continue;
        path.push(to);
        onPath.add(to);
        dfs(to);
        path.pop();
        onPath.delete(to);
      }
    };
    dfs(start);
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => (b.amount > a.amount ? 1 : b.amount < a.amount ? -1 : a.members.length - b.members.length));
}

/** Receivable minus payable for every member. */
export function netPositions(edges: DebtEdge[]): Map<string, bigint> {
  const net = new Map<string, bigint>();
  for (const e of edges) {
    if (e.from === e.to || e.amount <= 0n) continue;
    net.set(e.to, (net.get(e.to) ?? 0n) + e.amount);
    net.set(e.from, (net.get(e.from) ?? 0n) - e.amount);
  }
  return net;
}

/** Greedy minimal-transfer settlement of the net positions (what an ideal clearing house would pay out). */
export function settlementPlan(edges: DebtEdge[]): DebtEdge[] {
  const net = netPositions(edges);
  const debtors = [...net.entries()].filter(([, v]) => v < 0n).map(([k, v]) => ({ id: k, left: -v }));
  const creditors = [...net.entries()].filter(([, v]) => v > 0n).map(([k, v]) => ({ id: k, left: v }));
  const byLeft = (a: { id: string; left: bigint }, b: { id: string; left: bigint }) => (b.left > a.left ? 1 : b.left < a.left ? -1 : a.id < b.id ? -1 : 1);
  debtors.sort(byLeft);
  creditors.sort(byLeft);
  const plan: DebtEdge[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const pay = debtors[i].left < creditors[j].left ? debtors[i].left : creditors[j].left;
    if (pay > 0n) plan.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
    debtors[i].left -= pay;
    creditors[j].left -= pay;
    if (debtors[i].left === 0n) i++;
    if (creditors[j].left === 0n) j++;
  }
  return plan;
}

/** Edges after clearing `amount` around `cycle`. */
export function applyCycle(edges: DebtEdge[], cycle: DebtCycle, amount: bigint = cycle.amount): DebtEdge[] {
  const hit = new Set(cycle.edges.map((e) => `${e.from}>${e.to}`));
  return edges.map((e) => (hit.has(`${e.from}>${e.to}`) ? { ...e, amount: e.amount - amount } : e)).filter((e) => e.amount > 0n);
}

export interface ClearingStats {
  grossBefore: bigint;
  grossAfter: bigint;
  /** Σ |net| / 2: the least that has to move if everything is netted. */
  netFloor: bigint;
  edgesBefore: number;
  edgesAfter: number;
}

export function clearingStats(before: DebtEdge[], after: DebtEdge[]): ClearingStats {
  const gross = (es: DebtEdge[]) => es.reduce((s, e) => s + (e.from === e.to ? 0n : e.amount), 0n);
  let floor = 0n;
  for (const v of netPositions(before).values()) floor += v > 0n ? v : 0n;
  return { grossBefore: gross(before), grossAfter: gross(after), netFloor: floor, edgesBefore: before.filter((e) => e.amount > 0n).length, edgesAfter: after.filter((e) => e.amount > 0n).length };
}
