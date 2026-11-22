// Live engine data for /lab/viz: one sandbox economy (real Ergo AVL+ when the wasm backend is loaded) where Alice
// opens a reserve and pays Bob, the tracker commits, Bob redeems part of it and then tries to take more than the
// tracker committed. The same steps drive the interactive story; snapshots feed the static X-rays.

import { debtKey, Economy, erg, type ActionOutcome, type AvlBackend, type ClearingOutcome, type EconomyEvent, type NoteRecord, type PayResult, type RedemptionOutcome } from "@/protocol";
import type { LadderInput } from "@/viz/clocks/model";
import { ladderFromEconomy } from "@/viz/clocks/model";

export const DEMO_SEED = "basis-viz-showcase";

export interface StoryStep {
  id: string;
  run: (eco: Economy) => void;
}

/** The cast and the tracker; nothing has happened yet. */
export function newEconomy(avl?: AvlBackend): Economy {
  const eco = new Economy({ seed: DEMO_SEED, ...(avl ? { avl } : {}) });
  eco.addParticipant({ id: "op", name: "Lab tracker operator", kind: "tracker-operator", erg: erg(5) });
  eco.addParticipant({ id: "alice", name: "Alice", kind: "human", erg: erg(12) });
  eco.addParticipant({ id: "bob", name: "Bob", kind: "human", erg: erg(4) });
  eco.addParticipant({ id: "carol", name: "Carol", kind: "human", erg: erg(6) });
  eco.createTracker({ id: "t1", name: "T-01", operator: "op" });
  return eco;
}

/** The interactive story, one click per step. */
export const STORY: readonly StoryStep[] = [
  { id: "reserve", run: (eco) => void eco.createReserve({ owner: "alice", amount: erg(5), id: "alice-res" }) },
  { id: "pay", run: (eco) => void eco.pay({ from: "alice", to: "bob", amount: erg(2) }) },
  { id: "commit", run: (eco) => eco.mine(5) },
  { id: "confirm", run: (eco) => eco.mine(5) },
  { id: "redeem", run: (eco) => void eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("0.8") }) },
  { id: "cheat", run: (eco) => void eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("1.5"), force: true }) },
  { id: "more", run: (eco) => void eco.pay({ from: "alice", to: "carol", amount: erg("0.5") }) },
  { id: "later", run: (eco) => eco.mine(10) },
];

export interface Showcase {
  eco: Economy;
  backend: AvlBackend;
  create: ActionOutcome;
  pay: PayResult;
  record: NoteRecord;
  ladder: { local: LadderInput; pending: LadderInput; confirmed: LadderInput };
  honest: RedemptionOutcome;
  cheat: RedemptionOutcome;
  topUp: ActionOutcome;
  carolCreate: ActionOutcome;
  refund: ActionOutcome;
  clearing: ClearingOutcome | null;
  /** Data for the proof viewer: the tracker box read by the honest redemption, its lookup proof (#8), the key. */
  proof: { digest: string; proof: string; key: Uint8Array } | null;
  events: readonly EconomyEvent[];
}

function fail(what: string, o: { ok: boolean; code?: string; message?: string }): never {
  throw new Error(`showcase: ${what} failed (${o.code ?? "?"}: ${o.message ?? ""})`);
}

/** The whole showcase, run once. Throws if the engine refuses a step that should pass (tests catch drift). */
export function buildShowcase(backend: AvlBackend): Showcase {
  const eco = newEconomy(backend);
  const create = eco.createReserve({ owner: "alice", amount: erg(5), id: "alice-res" });
  if (!create.ok) fail("create", create);
  const pay = eco.pay({ from: "alice", to: "bob", amount: erg(2) });
  if (!pay.ok || !pay.record) fail("pay", pay);
  const record = pay.record!;
  const local = ladderFromEconomy(eco, record);
  eco.mine(5);
  const pending = ladderFromEconomy(eco, record);
  eco.mine(5);
  const confirmed = ladderFromEconomy(eco, record);
  const honest = eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("0.8") });
  if (!honest.ok) fail("redeem", honest);
  const cheat = eco.redeem({ receiver: "bob", issuer: "alice", amount: erg("1.5"), force: true });
  if (cheat.ok) throw new Error("showcase: the cheat went through");
  const topUp = eco.topUp({ reserve: "alice-res", amount: erg(1), by: "carol" });
  if (!topUp.ok) fail("top up", topUp);
  const carolCreate = eco.createReserve({ owner: "carol", amount: erg(2), id: "carol-res" });
  if (!carolCreate.ok) fail("carol reserve", carolCreate);
  const refund = eco.initiateRefund({ reserve: "carol-res" });
  if (!refund.ok) fail("refund", refund);

  // a debt loop Alice → Bob → Carol → Alice, cleared in one transaction where each debtor's reserve pays its creditor
  let clearing: ClearingOutcome | null = null;
  try {
    const bobRes = eco.createReserve({ owner: "bob", amount: erg(2), id: "bob-res" });
    if (bobRes.ok) {
      const p1 = eco.pay({ from: "bob", to: "carol", amount: erg("0.6") });
      const p2 = eco.pay({ from: "carol", to: "alice", amount: erg("0.4") });
      if (p1.ok && p2.ok) {
        eco.mine(10);
        const c = eco.clearCycle(["alice", "bob", "carol"], { mode: "onchain", amount: erg("0.3") });
        clearing = c.ok ? c : null;
      }
    }
  } catch {
    clearing = null;
  }

  const idx = honest.tx ? honest.tx.inputs.findIndex((b) => b.registers.R6 !== undefined && b.registers.R4?.type === "GroupElement") : -1;
  const v8 = honest.tx && idx >= 0 ? honest.tx.contextVars[idx]?.[8] : undefined;
  const r5 = honest.tx?.dataInputs[0]?.registers.R5;
  const proof =
    v8 && v8.type === "Coll[Byte]" && r5 && r5.type === "AvlTree"
      ? { digest: r5.digest, proof: v8.value, key: debtKey(eco.p("alice").pub, eco.p("bob").pub) }
      : null;
  return { eco, backend, create, pay, record, ladder: { local, pending, confirmed }, honest, cheat, topUp, carolCreate, refund, clearing, proof, events: eco.events };
}

/** Participant id or public key (or tracker id) → its display name. */
export function namer(eco: Economy): (idOrPub: string) => string {
  return (x: string) => {
    const p = eco.participants.get(x) ?? eco.byPub.get(x);
    if (p) return p.name;
    const t = eco.trackers.get(x);
    if (t) return t.name;
    return x;
  };
}
