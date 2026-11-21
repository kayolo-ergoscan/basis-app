// Scenario presets: scripted, deterministic stories that exercise the whole protocol.
//
// A scenario = setup (participants, trackers, reserves, policies) + steps. Each step has a title, a one-line
// text for the UI, an action that issues real commands (so every effect is an event in the log), an outcome
// check (did the protocol behave as the story says?), and `waitBlocks` — blocks to mine after the step
// (instant in tests; a UI can animate them with `step({ mine: false })` + its own eco.mine calls).

import { contractSignatureHolds } from "./schnorr";
import { Economy, type EconomyOptions } from "./economy";
import type { EconomyEvent } from "./events";
import { erg, NANOERG_PER_ERG, tokenDenomination, type DenomId, type DenominationInfo } from "./note";
import { acceptAllPolicy, collateralPolicy, cowPolicy, defaultCollateralPolicy } from "./policy";
import { Rng } from "./rng";

export type ScenarioId =
  | "cafe-on-credit"
  | "agent-swarm"
  | "village-lets"
  | "free-bank"
  | "tracker-vanishes"
  | "refund-race"
  | "triangle-novation"
  | "clearing-circle"
  | "censoring-tracker"
  | "idle-tracker"
  | "currency-exchange";

export type Feature =
  | "pay"
  | "cumulative-notes"
  | "acceptance-policy"
  | "credit-lines"
  | "commit"
  | "redeem"
  | "partial-redemption"
  | "self-note"
  | "top-up"
  | "novation"
  | "waivers"
  | "clearing"
  | "atomic-tx"
  | "emergency"
  | "refund"
  | "token-reserve"
  | "exchange"
  | "censorship"
  | "mesh"
  | "fifo"
  | "alerts"
  | "lazy-signatures"
  | "multi-tracker";

export interface StepOutcome {
  /** The protocol behaved as the story says (tests assert this for every step). */
  ok: boolean;
  /** One line for the UI ("Bob got 3 ERG", "refused: failed_not_oldest_note"). */
  detail: string;
}

export interface ScenarioStep {
  id: string;
  title: string;
  text: string;
  /** Blocks to mine after the action. */
  waitBlocks?: number;
  /** Participant / reserve ids the UI should spotlight. */
  focus?: string[];
  /** The step's action (real commands → events). */
  run(eco: Economy, ctx: ScenarioContext): StepOutcome;
  /** Optional outcome check evaluated after `waitBlocks` have been mined (replaces run's outcome). */
  check?(eco: Economy, ctx: ScenarioContext): StepOutcome;
}

export interface ScenarioContext {
  rng: Rng;
  /** Free-form memory shared between steps of one run. */
  memo: Record<string, unknown>;
  params: Record<string, number>;
}

export interface Scenario {
  id: ScenarioId;
  title: string;
  tagline: string;
  description: string;
  features: Feature[];
  /** Participant ids in display order. */
  cast: string[];
  /** Tunable numbers (e.g. agent count); defaults. */
  params?: Record<string, number>;
  economy?: EconomyOptions;
  setup(eco: Economy, ctx: ScenarioContext): void;
  steps: ScenarioStep[];
}

export interface StepResult {
  index: number;
  id: string;
  title: string;
  outcome: StepOutcome;
  /** Events this step produced (incl. the scenario.step marker and the mined blocks). */
  fromSeq: number;
  toSeq: number;
  minedBlocks: number;
}

// ---------- helpers ----------

const E = (x: number | string) => erg(x);
const done = (ok: boolean, detail: string): StepOutcome => ({ ok, detail });
const fmt = (v: bigint, decimals = 9) => {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** BigInt(decimals);
  const frac = (a % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "−" : ""}${a / base}${frac ? "." + frac : ""}`;
};
const ergs = (v: bigint) => `${fmt(v)} ERG`;

/** USE stablecoin token id (from the tracker's TV012 test vector); 3 decimals. */
export const USE_TOKEN: DenominationInfo = tokenDenomination("a55b8735ed1a99e46c2c89f8994aacdf4b1109bdcf682f1e5b34479c6e392669", "USE", 3, "USE stablecoin");
/** A village time currency (sandbox token id). */
export const HOUR_TOKEN: DenominationInfo = tokenDenomination("686f75727300000000000000000000000000000000000000000000000000beef", "HOUR", 2, "Village hours");

const hours = (h: number) => BigInt(Math.round(h * 100));

function payAll(eco: Economy, list: Array<[string, string, bigint, string?]>, denom?: DenomId): { ok: number; failed: string[] } {
  let ok = 0;
  const failed: string[] = [];
  for (const [from, to, amount, memo] of list) {
    const r = eco.pay({ from, to, amount, denom, memo });
    if (r.ok) ok++;
    else failed.push(`${from}→${to}: ${r.code}`);
  }
  return { ok, failed };
}

// ---------- 1. café on credit ----------

const cafeOnCredit: Scenario = {
  id: "cafe-on-credit",
  title: "Café on credit",
  tagline: "Coffee all week, one IOU, one redemption.",
  description:
    "Alice locks ERG in a reserve once, then pays for every coffee with a signed IOU — no transaction, no fee. The café posts its acceptance rule, extends a small trust line to a regular without a reserve, and cashes in whenever it likes.",
  features: ["pay", "cumulative-notes", "acceptance-policy", "commit", "redeem", "partial-redemption"],
  cast: ["alice", "cafe", "dmitri", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Riverside tracker", kind: "tracker-operator", erg: E(5) });
    eco.addParticipant({ id: "alice", name: "Alice", kind: "human", erg: E(30) });
    eco.addParticipant({ id: "cafe", name: "Café Lumen", kind: "business", erg: E("0.5") });
    eco.addParticipant({ id: "dmitri", name: "Dmitri", kind: "human", erg: E(2) });
    eco.createTracker({ id: "riverside", name: "Riverside", operator: "op", globalPolicy: defaultCollateralPolicy() });
  },
  steps: [
    {
      id: "reserve",
      title: "Alice opens a reserve",
      text: "One on-chain box under basis.es holds 20 ERG. R6 binds it to the Riverside tracker; its redemption tree (R5) starts empty.",
      focus: ["alice"],
      run(eco) {
        const r = eco.createReserve({ owner: "alice", amount: E(20), id: "alice-vault" });
        return done(r.ok, r.ok ? "reserve alice-vault: 20 ERG" : `failed: ${r.code}`);
      },
    },
    {
      id: "policy",
      title: "The café posts its rule",
      text: "Café Lumen accepts IOUs that are fully backed by a reserve — or, from Dmitri, up to 1 ERG on trust. Same format as the tracker's acceptance policies.",
      focus: ["cafe"],
      run(eco) {
        eco.setPolicy("cafe", cowPolicy(eco.pubsOf("dmitri"), 1.0, E(1)));
        return done(true, "policy: any_of(trusted Dmitri ≤ 1 ERG, collateral ≥ 100 %)");
      },
    },
    {
      id: "first-coffee",
      title: "Morning flat white",
      text: "No transaction. Alice signs 80 bytes — note key, new cumulative total, time, tracker NFT — and the tracker witnesses it.",
      focus: ["alice", "cafe"],
      run(eco) {
        const r = eco.pay({ from: "alice", to: "cafe", amount: E("0.12"), memo: "flat white" });
        return done(r.ok, r.ok ? "IOU total 0.12 ERG" : `refused: ${r.code}`);
      },
    },
    {
      id: "week",
      title: "A week of coffee",
      text: "Still one note: every payment raises the same cumulative total and replaces the previous signature. Zero fees.",
      focus: ["alice", "cafe"],
      run(eco) {
        const r = payAll(eco, [
          ["alice", "cafe", E("0.15"), "cappuccino"],
          ["alice", "cafe", E("0.12"), "flat white"],
          ["alice", "cafe", E("0.22"), "croissant + espresso"],
          ["alice", "cafe", E("0.12"), "flat white"],
          ["alice", "cafe", E("0.18"), "oat latte"],
          ["alice", "cafe", E("0.09"), "espresso"],
        ]);
        const total = eco.note("alice", "cafe")!.totalDebt;
        return done(r.ok === 6 && total === E("1.00"), `7 payments, one note, total ${ergs(total)}`);
      },
    },
    {
      id: "trust",
      title: "Dmitri pays on trust",
      text: "Dmitri has no reserve. The café's whitelist lets him run up 1 ERG; the next IOU would cross the cap and the café's wallet declines it.",
      focus: ["dmitri", "cafe"],
      run(eco) {
        const a = eco.pay({ from: "dmitri", to: "cafe", amount: E("0.6"), memo: "lunch" });
        const b = eco.pay({ from: "dmitri", to: "cafe", amount: E("0.6"), memo: "lunch again" });
        return done(a.ok && !b.ok && b.code === "policy-rejected", `0.6 accepted; second 0.6 → ${b.code}`);
      },
    },
    {
      id: "commit",
      title: "The tracker commits",
      text: "Every 600 s the tracker writes its tree digest into its own box (R5). One cycle later the box is deep enough and the notes become Confirmed.",
      waitBlocks: 10,
      focus: ["op"],
      run() {
        return done(true, "waiting for the box updater");
      },
      check(eco) {
        const rec = eco.note("alice", "cafe")!;
        return done(eco.noteStatus(rec) === "confirmed", `tracker box ${eco.t().currentBox()!.digest.slice(0, 12)}…, Alice's IOU ${eco.noteStatus(rec)}`);
      },
    },
    {
      id: "redeem",
      title: "The café cashes in",
      text: "The café redeems straight from Alice's reserve. The tracker co-signs, builds the transaction and pays the 0.001 ERG miner fee; the reserve tree records what was paid.",
      focus: ["cafe", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "cafe", issuer: "alice" });
        return done(r.ok && r.amount === E(1), r.ok ? `café +${ergs(r.amount!)} from alice-vault` : `refused: ${r.code} ${r.message}`);
      },
    },
    {
      id: "more",
      title: "The tab keeps running",
      text: "Alice keeps paying. The note keeps counting from 1 ERG; the reserve remembers 1 ERG paid, so the café can never be paid twice.",
      waitBlocks: 10,
      focus: ["alice", "cafe"],
      run(eco) {
        const r = eco.pay({ from: "alice", to: "cafe", amount: E("0.3"), memo: "cake for the office" });
        return done(r.ok && eco.note("alice", "cafe")!.totalDebt === E("1.3"), "total 1.3 ERG, 1 ERG already redeemed");
      },
    },
    {
      id: "partial",
      title: "Second redemption",
      text: "The café redeems again: only the 0.3 ERG not yet paid. Partial redemptions add up in the reserve's tree.",
      focus: ["cafe", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "cafe", issuer: "alice" });
        return done(r.ok && r.amount === E("0.3"), r.ok ? `café +${ergs(r.amount!)}; redeemed total ${ergs(eco.r("alice-vault").redeemedFor(eco.p("cafe").pub)!.redeemed)}` : `refused: ${r.code}`);
      },
    },
    {
      id: "no-reserve",
      title: "Trust has no vault",
      text: "Dmitri's IOU is valid and committed — but there is no reserve behind it. Credit without collateral is redeemable only in trust.",
      focus: ["dmitri", "cafe"],
      run(eco) {
        const r = eco.redeem({ receiver: "cafe", issuer: "dmitri" });
        return done(!r.ok && r.code === "no-reserve", `refused: ${r.code}`);
      },
    },
  ],
};

// ---------- 2. agent swarm ----------

const agentSwarm: Scenario = {
  id: "agent-swarm",
  title: "Agent swarm",
  tagline: "Thousands of machine payments, zero transactions.",
  description:
    "AI agents buy API calls, data and compute from each other, paying per call with IOUs backed by small reserves. The tracker witnesses thousands of notes; loops of mutual debt are cleared in single atomic transactions.",
  features: ["pay", "cumulative-notes", "acceptance-policy", "lazy-signatures", "commit", "clearing", "atomic-tx", "redeem"],
  cast: [],
  params: { agents: 24, burst1: 1000, burst2: 4000 },
  setup(eco, ctx) {
    const n = ctx.params.agents;
    eco.addParticipant({ id: "op", name: "Swarm tracker", kind: "tracker-operator", erg: E(10) });
    eco.createTracker({ id: "swarm", name: "Swarm", operator: "op", globalPolicy: collateralPolicy(1.0, true) });
    const skills = ["search", "vision", "code", "speech", "maps", "math", "translate", "summarise"];
    for (let i = 0; i < n; i++) {
      const id = `agent-${String(i).padStart(2, "0")}`;
      eco.addParticipant({ id, name: `${skills[i % skills.length]}-${String(i).padStart(2, "0")}`, kind: "agent", erg: E(3), meta: { skill: skills[i % skills.length] } });
    }
  },
  steps: [
    {
      id: "spin-up",
      title: "Agents spin up",
      text: "Each agent locks 2 ERG in its own reserve and publishes a policy: accept IOUs only while the payer is 100 % collateralised and not leaving.",
      waitBlocks: 0,
      run(eco, ctx) {
        let ok = 0;
        for (let i = 0; i < ctx.params.agents; i++) {
          const id = `agent-${String(i).padStart(2, "0")}`;
          if (eco.createReserve({ owner: id, amount: E(2), id: `${id}-res` }).ok) ok++;
          eco.setPolicy(id, collateralPolicy(1.0, true));
        }
        return done(ok === ctx.params.agents, `${ok} reserves × 2 ERG`);
      },
    },
    {
      id: "burst-1",
      title: "Pay per call",
      text: "A burst of micro-payments (0.0001–0.01 ERG each). Signatures are deterministic and produced lazily, so the swarm runs at full speed and every signature is still real.",
      waitBlocks: 10,
      run(eco, ctx) {
        const r = swarmBurst(eco, ctx, ctx.params.burst1, "burst-1");
        return done(r.ok > ctx.params.burst1 * 0.9, `${r.ok} payments in ${r.ms.toFixed(0)} ms`);
      },
    },
    {
      id: "burst-2",
      title: "Rush hour",
      text: "More traffic. One note per (payer, payee) pair, however many calls — the tracker tree stays small.",
      waitBlocks: 10,
      run(eco, ctx) {
        const r = swarmBurst(eco, ctx, ctx.params.burst2, "burst-2");
        const s = eco.stats();
        return done(r.ok > ctx.params.burst2 * 0.9, `${r.ok} payments in ${r.ms.toFixed(0)} ms; ${s.payments} total over ${s.notes} notes`);
      },
    },
    {
      id: "loops",
      title: "Clear the loops",
      text: "Agents owe each other in circles. Each loop clears in ONE transaction: every reserve on it pays the next agent the same amount, wallets end where they started, debt disappears.",
      waitBlocks: 10,
      run(eco, ctx) {
        let cleared = 0n;
        let txs = 0;
        for (let round = 0; round < 6; round++) {
          const cycles = eco.findCycles("erg", 4);
          const c = cycles.find((x) => x.amount > 0n);
          if (!c) break;
          const r = eco.clearCycle(c, { mode: "onchain" });
          if (!r.ok) break;
          cleared += r.amount! * BigInt(c.members.length);
          txs++;
        }
        ctx.memo.cleared = cleared;
        return done(txs > 0, `${txs} atomic clearing transaction(s), ${ergs(cleared)} of debt gone`);
      },
    },
    {
      id: "netting",
      title: "What netting would leave",
      text: "The remaining web of IOUs nets down to a handful of transfers — the floor no clearing can go below.",
      run(eco) {
        const edges = eco.debtEdges();
        const plan = eco.settlementPlan();
        const gross = edges.reduce((s, e) => s + e.amount, 0n);
        const net = plan.reduce((s, e) => s + e.amount, 0n);
        return done(net <= gross, `${edges.length} IOUs (${ergs(gross)}) → ${plan.length} transfers (${ergs(net)})`);
      },
    },
    {
      id: "audit",
      title: "Spot-check the signatures",
      text: "Pick notes at random and materialise their signatures: each verifies under the reserve contract's exact rules.",
      run(eco, ctx) {
        const notes = [...eco.t().notes.values()];
        let good = 0;
        const sample = Math.min(16, notes.length);
        for (let i = 0; i < sample; i++) {
          const rec = ctx.rng.pick(notes);
          const s = eco.signatures(rec);
          if (s.issuerSigOk && contractSignatureHolds(rec.issuer, s.message, s.issuerSig)) good++;
        }
        return done(good === sample, `${good}/${sample} signatures valid on-chain`);
      },
    },
  ],
};

/** Random micro-payments between agents (exported for the perf test). */
export function swarmBurst(eco: Economy, ctx: ScenarioContext, count: number, label: string): { ok: number; rejected: number; ms: number } {
  const rng = ctx.rng.fork(label);
  const ids = [...eco.participants.values()].filter((p) => p.kind === "agent").map((p) => p.id);
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  let ok = 0;
  let rejected = 0;
  for (let i = 0; i < count; i++) {
    const a = rng.int(0, ids.length - 1);
    let b = rng.int(0, ids.length - 2);
    if (b >= a) b++;
    const amount = rng.bigint(100_000n, 10_000_000n);
    const r = eco.pay({ from: ids[a], to: ids[b], amount, memo: "api call" });
    if (r.ok) ok++;
    else rejected++;
  }
  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return { ok, rejected, ms: t1 - t0 };
}

// ---------- 3. village LETS ----------

const villageLets: Scenario = {
  id: "village-lets",
  title: "Village LETS",
  tagline: "Mutual credit in hours. No reserves, no internet needed.",
  description:
    "Six villagers trade in hours on a shared ledger. Nobody locks collateral: credit lines are the trust. On market day the valley has no signal — IOUs are signed phone-to-phone and synced later. Loops of debt are cleared by mutual waivers.",
  features: ["pay", "credit-lines", "mesh", "clearing", "waivers", "commit"],
  cast: ["baker", "farmer", "carpenter", "tailor", "potter", "teacher", "council"],
  setup(eco) {
    eco.addDenomination(HOUR_TOKEN);
    eco.addParticipant({ id: "council", name: "Village council", kind: "tracker-operator", erg: E(2) });
    eco.createTracker({ id: "ledger", name: "Village ledger", operator: "council", denoms: [HOUR_TOKEN.id], globalPolicy: acceptAllPolicy() });
    const people: Array<[string, string]> = [
      ["baker", "Baker Ines"],
      ["farmer", "Farmer Tom"],
      ["carpenter", "Carpenter Ana"],
      ["tailor", "Tailor Kofi"],
      ["potter", "Potter Mei"],
      ["teacher", "Teacher Lars"],
    ];
    for (const [id, name] of people) eco.addParticipant({ id, name, kind: "human", erg: E("0.1") });
    for (const [a] of people) for (const [b] of people) if (a !== b) eco.setCreditLine(a, b, hours(30), HOUR_TOKEN.id);
  },
  steps: [
    {
      id: "market",
      title: "Market day",
      text: "Flour, a fence, a coat, bread, pots, lessons. Each purchase is an IOU in hours. Every villager lets every neighbour owe them up to 30 hours.",
      run(eco) {
        const r = payAll(
          eco,
          [
            ["baker", "farmer", hours(6), "flour"],
            ["farmer", "carpenter", hours(8), "fence"],
            ["carpenter", "tailor", hours(5), "work coat"],
            ["tailor", "baker", hours(4), "bread for a month"],
            ["potter", "teacher", hours(3), "lessons for the kids"],
            ["teacher", "potter", hours(2), "vases"],
            ["baker", "potter", hours(1.5), "bowls"],
          ],
          HOUR_TOKEN.id,
        );
        return done(r.ok === 7, `${r.ok} trades`);
      },
    },
    {
      id: "offline",
      title: "No signal in the valley",
      text: "Farmer Tom and Carpenter Ana are out of range. Tom signs IOUs on his phone and hands them over by Bluetooth; Ana keeps them. Nothing reaches the tracker yet.",
      focus: ["farmer", "carpenter"],
      run(eco) {
        eco.setOnline("farmer", false);
        const a = eco.payOffline({ from: "farmer", to: "carpenter", amount: hours(2), denom: HOUR_TOKEN.id, memo: "gate hinge" });
        const b = eco.payOffline({ from: "farmer", to: "carpenter", amount: hours(1), denom: HOUR_TOKEN.id, memo: "shelf" });
        const online = eco.pay({ from: "farmer", to: "carpenter", amount: hours(1), denom: HOUR_TOKEN.id });
        return done(a.ok && b.ok && !online.ok && eco.offline.length === 2, `2 IOUs signed offline; direct submission → ${online.code}`);
      },
    },
    {
      id: "sync",
      title: "Back in range",
      text: "Tom's phone syncs. The tracker checks each IOU in signing order: valid signature, newer timestamp, total never lower — and witnesses both.",
      waitBlocks: 10,
      focus: ["farmer", "carpenter"],
      run(eco) {
        eco.setOnline("farmer", true);
        const r = eco.syncOffline();
        const total = eco.note("farmer", "carpenter", HOUR_TOKEN.id)!.totalDebt;
        return done(r.every((x) => x.ok) && total === hours(11), `${r.length} synced; Tom → Ana total ${fmt(total, 2)} h`);
      },
    },
    {
      id: "limit",
      title: "A credit line holds",
      text: "Tom wants a barn on credit. Ana's wallet refuses: his debt to her would pass the 30-hour line.",
      focus: ["farmer", "carpenter"],
      run(eco) {
        const r = eco.pay({ from: "farmer", to: "carpenter", amount: hours(25), denom: HOUR_TOKEN.id, memo: "barn" });
        return done(!r.ok && r.code === "credit-limit", `refused: ${r.code}`);
      },
    },
    {
      id: "loops",
      title: "Find the loops",
      text: "Baker → Farmer → Carpenter → Tailor → Baker: everyone on the circle owes the next. So do Potter and Teacher, both ways.",
      run(eco, ctx) {
        const cycles = eco.findCycles(HOUR_TOKEN.id);
        ctx.memo.cycles = cycles.length;
        const big = cycles.find((c) => c.members.length === 4);
        return done(cycles.length >= 2 && !!big && big.amount === hours(4), cycles.map((c) => `${c.members.join("→")} (${fmt(c.amount, 2)} h)`).join("; "));
      },
    },
    {
      id: "clear",
      title: "Clear by waivers",
      text: "No reserves, nothing to redeem on-chain: each member waives the same amount of the IOU it holds. Totals can't go down, so a waiver is a recorded promise — the way LETS ledgers always worked.",
      run(eco) {
        const before = eco.debtEdges(HOUR_TOKEN.id).reduce((s, e) => s + e.amount, 0n);
        const netBefore = eco.netPositions(HOUR_TOKEN.id);
        let n = 0;
        for (;;) {
          const c = eco.findCycles(HOUR_TOKEN.id)[0];
          if (!c) break;
          if (!eco.clearCycle(c, { mode: "waivers", denom: HOUR_TOKEN.id }).ok) break;
          n++;
        }
        const after = eco.debtEdges(HOUR_TOKEN.id).reduce((s, e) => s + e.amount, 0n);
        const netAfter = eco.netPositions(HOUR_TOKEN.id);
        const same = [...netBefore].every(([k, v]) => (netAfter.get(k) ?? 0n) === v);
        return done(n >= 2 && after < before && same, `${n} loops cleared: ${fmt(before, 2)} h → ${fmt(after, 2)} h of IOUs, every balance unchanged`);
      },
    },
    {
      id: "zero-sum",
      title: "Balances sum to zero",
      text: "Money here is created by trade and destroyed by clearing. Add every villager's balance: exactly zero.",
      run(eco) {
        let sum = 0n;
        for (const v of eco.netPositions(HOUR_TOKEN.id).values()) sum += v;
        return done(sum === 0n, `Σ balances = ${fmt(sum, 2)} h`);
      },
    },
  ],
};

// ---------- 4. free bank ----------

const freeBank: Scenario = {
  id: "free-bank",
  title: "Free bank",
  tagline: "Banknotes, fractional reserve, a run — and FIFO.",
  description:
    "A private bank takes deposits by letting customers top up its reserve, issues IOUs that circulate as banknotes, lends beyond its vault, and faces a bank run. The tracker's redemption gate turns the run into a first-come-first-served queue.",
  features: ["pay", "top-up", "novation", "alerts", "fifo", "redeem", "self-note", "acceptance-policy"],
  cast: ["bank", "alice", "bob", "cafe", "dmitri", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Harbour tracker", kind: "tracker-operator", erg: E(5) });
    eco.addParticipant({ id: "bank", name: "Free Bank of Ergo", kind: "business", erg: E(40) });
    eco.addParticipant({ id: "alice", name: "Alice", kind: "human", erg: E(15) });
    eco.addParticipant({ id: "bob", name: "Bob", kind: "human", erg: E(12) });
    eco.addParticipant({ id: "cafe", name: "Café Lumen", kind: "business", erg: E("0.5") });
    eco.addParticipant({ id: "dmitri", name: "Dmitri", kind: "human", erg: E(1) });
    eco.createTracker({ id: "harbour", name: "Harbour", operator: "op", globalPolicy: defaultCollateralPolicy() });
  },
  steps: [
    {
      id: "vault",
      title: "The bank opens its vault",
      text: "20 ERG of the bank's own capital go into a reserve.",
      run(eco) {
        const r = eco.createReserve({ owner: "bank", amount: E(20), id: "bank-vault" });
        return done(r.ok, "bank-vault: 20 ERG");
      },
    },
    {
      id: "deposits",
      title: "Deposits",
      text: "Alice and Bob top up the bank's reserve themselves — anyone may (action 1 needs no signature). The bank hands each an IOU: a deposit receipt, i.e. a banknote.",
      focus: ["alice", "bob", "bank-vault"],
      run(eco) {
        const a = eco.topUp({ reserve: "bank-vault", amount: E(10), by: "alice" });
        const na = eco.pay({ from: "bank", to: "alice", amount: E(10), memo: "deposit receipt" });
        const b = eco.topUp({ reserve: "bank-vault", amount: E(8), by: "bob" });
        const nb = eco.pay({ from: "bank", to: "bob", amount: E(8), memo: "deposit receipt" });
        const c = eco.coverage("bank");
        return done(a.ok && na.ok && b.ok && nb.ok, `vault ${ergs(c.collateral)}, notes ${ergs(c.liabilities)}, coverage ${(c.ratio! * 100).toFixed(0)} %`);
      },
    },
    {
      id: "spend",
      title: "Spending a banknote",
      text: "Alice pays the café with 4 ERG of the bank's debt: the bank signs a new bank→café IOU, Alice waives 4 of hers (novation — a promise, not enforced on-chain).",
      focus: ["alice", "cafe", "bank"],
      run(eco) {
        const r = eco.novate({ issuer: "bank", from: "alice", to: "cafe", amount: E(4) });
        return done(r.ok, r.ok ? "bank → café: 4 ERG; Alice waives 4" : `refused: ${r.code}`);
      },
    },
    {
      id: "loans",
      title: "The bank lends",
      text: "Loans are IOUs with no deposit behind them. Coverage falls; the sandbox raises the spec's collateral alerts at 80 % and 100 % (the real server does not emit them yet).",
      waitBlocks: 10,
      focus: ["bank", "dmitri"],
      run(eco) {
        const a = eco.pay({ from: "bank", to: "dmitri", amount: E(10), memo: "loan" });
        const mid = eco.coverage("bank");
        const b = eco.pay({ from: "bank", to: "dmitri", amount: E(8), memo: "another loan" });
        const c = eco.coverage("bank");
        const alerts = eco.events.filter((e) => e.type === "nostr" && (e.kind === "alert-80" || e.kind === "alert-100")).length;
        return done(a.ok && b.ok && alerts === 2 && c.level === "critical", `coverage ${(mid.ratio! * 100).toFixed(0)} % (${mid.level}) → ${(c.ratio! * 100).toFixed(0)} % (${c.level}); ${alerts} alerts`);
      },
    },
    {
      id: "run",
      title: "Bob runs to the bank",
      text: "The vault holds less than the notes. The tracker will co-sign only the OLDEST outstanding note first (FIFO): Bob's is younger than Alice's.",
      focus: ["bob", "bank-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "bank" });
        return done(!r.ok && r.code === "failed_not_oldest_note", `refused: ${r.code}`);
      },
    },
    {
      id: "alice-first",
      title: "Alice is first in line",
      text: "Alice redeems what she still claims (6 ERG — she waived 4).",
      focus: ["alice", "bank-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "alice", issuer: "bank" });
        return done(r.ok && r.amount === E(6) && r.compliance?.ok === true && r.compliance.mode === "fifo-oldest", r.ok ? `Alice +${ergs(r.amount!)} (${r.compliance?.ok ? r.compliance.mode : ""})` : `refused: ${r.code}`);
      },
    },
    {
      id: "stuck",
      title: "The queue is stuck",
      text: "The tracker knows nothing about Alice's waiver: her note still shows 4 ERG outstanding, so it is still the oldest — and Bob still waits.",
      focus: ["bob", "alice"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "bank" });
        return done(!r.ok && r.code === "failed_not_oldest_note", `refused again: ${r.code}`);
      },
    },
    {
      id: "recapitalise",
      title: "The bank recapitalises",
      text: "The bank tops up 12 ERG. Back above 100 %, the reserve is no longer distressed and any holder may redeem.",
      focus: ["bank-vault", "bob"],
      run(eco) {
        const t = eco.topUp({ reserve: "bank-vault", amount: E(12), by: "bank" });
        const r = eco.redeem({ receiver: "bob", issuer: "bank" });
        return done(t.ok && r.ok && r.amount === E(8), r.ok ? `Bob +${ergs(r.amount!)}; coverage ${(eco.coverage("bank").ratio! * 100).toFixed(0)} %` : `refused: ${r.code}`);
      },
    },
    {
      id: "profit",
      title: "The banker takes profit",
      text: "A self-note (bank → bank) is how an owner withdraws part of a live reserve. The tracker co-signs only if no other holder's policy is newly broken.",
      waitBlocks: 10,
      focus: ["bank", "bank-vault"],
      run(eco) {
        const n = eco.selfNote({ who: "bank", amount: E(3) });
        return done(n.ok, "self-note 3 ERG signed; redeemable after the next commit");
      },
    },
    {
      id: "withdraw",
      title: "Withdraw, then get greedy",
      text: "3 ERG come out. Then the banker signs a 30 ERG self-note: that pushes the books under water, so FIFO applies again and his young note must wait.",
      waitBlocks: 10,
      focus: ["bank", "bank-vault"],
      run(eco, ctx) {
        const a = eco.redeem({ receiver: "bank", issuer: "bank" });
        eco.selfNote({ who: "bank", amount: E(30) });
        ctx.memo.withdrawn = a.amount;
        return done(a.ok && a.amount === E(3), a.ok ? `bank +${ergs(a.amount!)} from its own vault` : `refused: ${a.code}`);
      },
    },
    {
      id: "greedy",
      title: "The gate holds",
      text: "Redeeming the big self-note is refused: the reserve is distressed and older notes (the café's, Dmitri's) come first.",
      focus: ["bank", "bank-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "bank", issuer: "bank" });
        return done(!r.ok && r.code === "failed_not_oldest_note", `refused: ${r.code}`);
      },
    },
  ],
};

// ---------- 5. the tracker vanishes ----------

const trackerVanishes: Scenario = {
  id: "tracker-vanishes",
  title: "The tracker vanishes",
  tagline: "Three days of silence, then everyone gets paid.",
  description:
    "The tracker's server goes dark mid-week. Without its co-signature nothing can be redeemed — for exactly 2,160 blocks. After that the reserve contract accepts redemptions with no tracker signature at all, against the last committed state.",
  features: ["pay", "commit", "emergency", "redeem"],
  cast: ["alice", "bob", "carol", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Night Owl tracker", kind: "tracker-operator", erg: E(2) });
    eco.addParticipant({ id: "alice", name: "Alice", erg: E(15) });
    eco.addParticipant({ id: "bob", name: "Bob", erg: E(1) });
    eco.addParticipant({ id: "carol", name: "Carol", erg: E(1) });
    eco.createTracker({ id: "nightowl", name: "Night Owl", operator: "op", globalPolicy: defaultCollateralPolicy() });
    eco.createReserve({ owner: "alice", amount: E(10), id: "alice-vault" });
  },
  steps: [
    {
      id: "notes",
      title: "Notes as usual",
      text: "Alice owes Bob 3 ERG and Carol 2 ERG. The tracker commits them on-chain.",
      waitBlocks: 10,
      run(eco) {
        const r = payAll(eco, [
          ["alice", "bob", E(3)],
          ["alice", "carol", E(2)],
        ]);
        return done(r.ok === 2, "Alice → Bob 3, Alice → Carol 2");
      },
    },
    {
      id: "late",
      title: "One more IOU",
      text: "Alice pays Bob 1 more. The tracker witnesses it… and then never commits again.",
      run(eco) {
        const r = eco.pay({ from: "alice", to: "bob", amount: E(1) });
        return done(r.ok, "Alice → Bob total 4 (committed: 3)");
      },
    },
    {
      id: "vanish",
      title: "The tracker vanishes",
      text: "Server gone, keys gone. No new notes, no co-signatures, no box updates.",
      focus: ["op"],
      run(eco, ctx) {
        eco.disappear("nightowl", "server and keys lost");
        ctx.memo.boxHeight = eco.t().currentBox()!.creationHeight;
        return done(!eco.t().online, `last tracker box at height ${ctx.memo.boxHeight}`);
      },
    },
    {
      id: "blocked",
      title: "Bob is stuck — for now",
      text: "Normal redemption needs the tracker's signature. Bob's wallet tells him when the emergency path opens.",
      focus: ["bob"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice" });
        return done(!r.ok && r.code === "tracker-offline", r.message ?? "");
      },
    },
    {
      id: "almost",
      title: "2,160 blocks later",
      text: "Three days. The contract wants the tracker box to be MORE than 2,160 blocks old — exactly 2,160 is still too early.",
      focus: ["bob", "alice-vault"],
      run(eco, ctx) {
        eco.mineTo((ctx.memo.boxHeight as number) + 2160);
        const r = eco.redeem({ receiver: "bob", issuer: "alice", emergency: true });
        return done(!r.ok && r.stage === "contract" && !!r.eval?.failed.includes("trackerSigValid"), `contract: ${r.eval?.failed.join(", ")}`);
      },
    },
    {
      id: "emergency",
      title: "One block more",
      text: "Box age 2,161 > 2,160: the contract accepts an empty tracker signature. Bob redeems what the last committed tree proves — 3 ERG — and pays the fee himself. (He needs that tree's data to build proof #8: someone must have kept a copy.)",
      waitBlocks: 0,
      focus: ["bob", "alice-vault"],
      run(eco) {
        eco.mine(1);
        const r = eco.redeem({ receiver: "bob", issuer: "alice" });
        return done(r.ok && r.emergency === true && r.amount === E(3), r.ok ? `Bob +${ergs(r.amount!)} with no tracker signature` : `refused: ${r.code}`);
      },
    },
    {
      id: "carol",
      title: "Carol too",
      text: "Nobody needs permission: Carol takes her 2 ERG the same way.",
      focus: ["carol", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "carol", issuer: "alice" });
        return done(r.ok && r.amount === E(2), r.ok ? `Carol +${ergs(r.amount!)}` : `refused: ${r.code}`);
      },
    },
    {
      id: "lost",
      title: "What was lost",
      text: "Alice's last IOU (+1 ERG) was never committed. Without a tracker tree that contains it, the contract cannot pay it: a vanished tracker loses at most the uncommitted tail.",
      focus: ["bob"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice" });
        return done(!r.ok && r.code === "nothing-to-redeem", `refused: ${r.code}`);
      },
    },
  ],
};

// ---------- 6. refund race ----------

const refundRace: Scenario = {
  id: "refund-race",
  title: "Refund race",
  tagline: "The owner wants out. Holders have 60 days.",
  description:
    "Alice announces she is closing her reserve. Holders' policies stop accepting her IOUs at once; the contract gives them 43,200 blocks (~60 days) to redeem before she can take the rest. Bob is quick. Carol sleeps through it.",
  features: ["refund", "redeem", "acceptance-policy", "fifo"],
  cast: ["alice", "bob", "carol", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Meadow tracker", kind: "tracker-operator", erg: E(2) });
    eco.addParticipant({ id: "alice", name: "Alice", erg: E(12) });
    eco.addParticipant({ id: "bob", name: "Bob", erg: E(1) });
    eco.addParticipant({ id: "carol", name: "Carol", erg: E(1) });
    eco.createTracker({ id: "meadow", name: "Meadow", operator: "op", globalPolicy: collateralPolicy(1.0, true) });
    eco.createReserve({ owner: "alice", amount: E(10), id: "alice-vault" });
    eco.setPolicy("bob", collateralPolicy(1.0, true));
  },
  steps: [
    {
      id: "notes",
      title: "Alice's IOUs",
      text: "Alice owes Bob 3 ERG and Carol 2 ERG, committed and confirmed.",
      waitBlocks: 10,
      run(eco) {
        const r = payAll(eco, [
          ["alice", "bob", E(3)],
          ["alice", "carol", E(2)],
        ]);
        return done(r.ok === 2, "Alice → Bob 3, Alice → Carol 2");
      },
    },
    {
      id: "announce",
      title: "Alice announces her exit",
      text: "Action 2 writes R7 := HEIGHT into the reserve box. From now on the clock runs: 43,200 blocks until she may empty it.",
      focus: ["alice-vault"],
      run(eco, ctx) {
        const r = eco.initiateRefund({ reserve: "alice-vault" });
        ctx.memo.r7 = Number(eco.r("alice-vault").refundHeight());
        return done(r.ok, `R7 = ${ctx.memo.r7}; unlocks at ${eco.r("alice-vault").refundUnlockHeight()}`);
      },
    },
    {
      id: "no-credit",
      title: "No new credit",
      text: "Bob's policy includes 'no pending refund': his wallet now declines Alice's IOUs.",
      focus: ["bob", "alice"],
      run(eco) {
        const r = eco.pay({ from: "alice", to: "bob", amount: E(1) });
        return done(!r.ok && r.code === "policy-rejected", `refused: ${r.code}`);
      },
    },
    {
      id: "bob-redeems",
      title: "Bob redeems right away",
      text: "A pending refund makes the reserve 'distressed' for policies like Bob's, so the tracker serves notes oldest-first. Bob's is the oldest.",
      focus: ["bob", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice" });
        return done(r.ok && r.amount === E(3), r.ok ? `Bob +${ergs(r.amount!)} (${r.compliance?.ok ? r.compliance.mode : "?"})` : `refused: ${r.code}`);
      },
    },
    {
      id: "early",
      title: "Alice tries to leave early",
      text: "Action 3 before the deadline: the contract says no.",
      focus: ["alice-vault"],
      run(eco) {
        const r = eco.completeRefund({ reserve: "alice-vault" });
        return done(!r.ok && !!r.eval?.failed.includes("refundPeriodOver"), r.message ?? "");
      },
    },
    {
      id: "wait",
      title: "Sixty days pass",
      text: "43,200 blocks. Carol never checks her wallet.",
      run(eco, ctx) {
        eco.mineTo((ctx.memo.r7 as number) + 43200);
        return done(eco.clock.height >= (ctx.memo.r7 as number) + 43200, `height ${eco.clock.height}`);
      },
    },
    {
      id: "complete",
      title: "Alice takes the rest",
      text: "The notice period is over: Alice spends the reserve box back to herself.",
      focus: ["alice", "alice-vault"],
      run(eco) {
        const before = eco.balance("alice");
        const r = eco.completeRefund({ reserve: "alice-vault" });
        return done(r.ok, r.ok ? `Alice +${ergs(eco.balance("alice") - before)}` : `refused: ${r.code}`);
      },
    },
    {
      id: "carol-late",
      title: "Carol wakes up",
      text: "Her IOU is still validly signed and committed — but the box is gone. The 60-day window was the protocol's notice period.",
      focus: ["carol"],
      run(eco) {
        const r = eco.redeem({ receiver: "carol", issuer: "alice" });
        return done(!r.ok && r.code === "no-reserve", `refused: ${r.code}`);
      },
    },
  ],
};

// ---------- 7. triangle novation ----------

const triangleNovation: Scenario = {
  id: "triangle-novation",
  title: "Triangle novation",
  tagline: "Pay with someone else's debt — and see what it costs.",
  description:
    "Bob holds Alice's IOU and owes Carol. He passes part of Alice's debt on: Alice signs a new IOU to Carol, Bob promises not to redeem that part. The tracker refuses the 'just lower Alice→Bob' shortcut — and the contract cannot enforce Bob's promise.",
  features: ["novation", "waivers", "redeem", "cumulative-notes"],
  cast: ["alice", "bob", "carol", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Delta tracker", kind: "tracker-operator", erg: E(2) });
    eco.addParticipant({ id: "alice", name: "Alice", erg: E(15) });
    eco.addParticipant({ id: "bob", name: "Bob", erg: E(1) });
    eco.addParticipant({ id: "carol", name: "Carol", erg: E(1) });
    eco.createTracker({ id: "delta", name: "Delta", operator: "op", globalPolicy: defaultCollateralPolicy() });
    eco.createReserve({ owner: "alice", amount: E(10), id: "alice-vault" });
  },
  steps: [
    {
      id: "owe",
      title: "Alice owes Bob",
      text: "Bob delivered goods: Alice's IOU to Bob, 5 ERG.",
      run(eco) {
        const r = eco.pay({ from: "alice", to: "bob", amount: E(5), memo: "timber" });
        return done(r.ok, "Alice → Bob 5");
      },
    },
    {
      id: "novate",
      title: "Bob pays Carol with Alice's debt",
      text: "Alice signs a NEW IOU to Carol (+3). Bob records a waiver of 3 on his note. The Alice→Bob total stays 5 — totals never go down.",
      focus: ["alice", "bob", "carol"],
      run(eco) {
        const r = eco.novate({ issuer: "alice", from: "bob", to: "carol", amount: E(3) });
        return done(r.ok && eco.note("alice", "bob")!.totalDebt === E(5), "Alice → Carol 3; Bob waives 3 of 5");
      },
    },
    {
      id: "no-decrease",
      title: "The shortcut is refused",
      text: "Why not just lower Alice→Bob to 2? The tracker refuses any lower total: Bob could still redeem the old 5 on-chain and Alice would pay 8.",
      focus: ["alice", "bob"],
      run(eco) {
        const r = eco.pay({ from: "alice", to: "bob", amount: 0n, totalDebt: E(2) });
        return done(!r.ok && r.code === "debt-decrease-not-permitted", `refused: ${r.code}`);
      },
    },
    {
      id: "commit",
      title: "Committed",
      text: "Both IOUs are in the tracker's tree.",
      waitBlocks: 10,
      run() {
        return done(true, "waiting for the box updater");
      },
      check(eco) {
        return done(eco.noteStatus(eco.note("alice", "carol")!) === "confirmed", "Alice → Bob 5, Alice → Carol 3 confirmed");
      },
    },
    {
      id: "carol",
      title: "Carol redeems",
      text: "Carol takes her 3 ERG from Alice's reserve.",
      focus: ["carol", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "carol", issuer: "alice" });
        return done(r.ok && r.amount === E(3), r.ok ? `Carol +${ergs(r.amount!)}` : `refused: ${r.code}`);
      },
    },
    {
      id: "betray",
      title: "Bob breaks his promise",
      text: "Bob redeems the full 5. The contract only sees Alice's signed total of 5 — the waiver is not on-chain. Alice paid 8 for 5 ERG of goods.",
      focus: ["bob", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice", amount: E(5) });
        const paid = E(10) - eco.r("alice-vault").collateral();
        return done(r.ok && paid === E(8), r.ok ? `Bob +${ergs(r.amount!)}; Alice's reserve paid ${ergs(paid)} in total` : `refused: ${r.code}`);
      },
    },
  ],
};

// ---------- 8. clearing circle ----------

const clearingCircle: Scenario = {
  id: "clearing-circle",
  title: "Clearing circle",
  tagline: "Five businesses, one loop, one transaction.",
  description:
    "A supply chain where everyone owes the next. The loop is found automatically and cleared in a single atomic transaction: five reserves pay five creditors the same amount at once, so every wallet ends where it started and the loop's debt is gone. The contract allows this today (one reserve per owner, up to 10 per transaction); the tracker server has no clearing endpoint yet, so the sandbox composes the legs itself.",
  features: ["clearing", "atomic-tx", "redeem", "commit"],
  cast: ["farm", "mill", "bakery", "cafe", "brewery", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Valley tracker", kind: "tracker-operator", erg: E(2) });
    const biz: Array<[string, string]> = [
      ["farm", "Green Farm"],
      ["mill", "Old Mill"],
      ["bakery", "Bakery"],
      ["cafe", "Café"],
      ["brewery", "Brewery"],
    ];
    eco.createTracker({ id: "valley", name: "Valley", operator: "op", globalPolicy: defaultCollateralPolicy() });
    for (const [id, name] of biz) {
      eco.addParticipant({ id, name, kind: "business", erg: E(6) });
      eco.createReserve({ owner: id, amount: E(5), id: `${id}-res` });
    }
  },
  steps: [
    {
      id: "trade",
      title: "A month of trade",
      text: "Grain, flour, bread, catering, beer for the harvest party — all on IOUs.",
      waitBlocks: 10,
      run(eco) {
        const r = payAll(eco, [
          ["mill", "farm", E(4), "grain"],
          ["bakery", "mill", E(3), "flour"],
          ["cafe", "bakery", E("2.5"), "bread"],
          ["brewery", "cafe", E(3), "catering"],
          ["farm", "brewery", E(2), "harvest beer"],
          ["cafe", "farm", E(1), "vegetables"],
        ]);
        return done(r.ok === 6, `${r.ok} IOUs, ${ergs(eco.debtEdges().reduce((s, e) => s + e.amount, 0n))} gross`);
      },
    },
    {
      id: "find",
      title: "Find the circle",
      text: "Mill → Farm → Brewery → Café → Bakery → Mill. Everyone on it owes the next at least 2 ERG.",
      run(eco, ctx) {
        const c = eco.findCycles().find((x) => x.members.length === 5);
        ctx.memo.cycle = c;
        return done(!!c && c.amount === E(2), c ? `${c.members.join(" → ")}: ${ergs(c.amount)}` : "no cycle");
      },
    },
    {
      id: "clear",
      title: "Clear it in one transaction",
      text: "Five reserve inputs, five payouts, one tracker co-signature per leg, one miner fee. If any leg failed, none would happen.",
      focus: ["farm", "mill", "bakery", "cafe", "brewery"],
      run(eco, ctx) {
        const before = new Map([...eco.netPositions()]);
        const r = eco.clearCycle(ctx.memo.cycle as Parameters<Economy["clearCycle"]>[0], { mode: "onchain" });
        const after = eco.netPositions();
        const same = [...before].every(([k, v]) => (after.get(k) ?? 0n) === v);
        return done(r.ok && r.tx!.inputs.length === 5 && same, r.ok ? `tx ${r.tx!.id.slice(0, 10)}…: ${r.tx!.inputs.length} inputs, gross ${ergs(r.stats!.grossBefore)} → ${ergs(r.stats!.grossAfter)}` : `refused: ${r.code} ${r.message}`);
      },
    },
    {
      id: "rest",
      title: "Settle the rest",
      text: "What remains is not a loop. Netting shows the fewest transfers that would settle it.",
      run(eco) {
        const plan = eco.settlementPlan();
        return done(plan.length > 0, plan.map((p) => `${p.from} → ${p.to} ${ergs(p.amount)}`).join("; "));
      },
    },
  ],
};

// ---------- 9. censoring tracker ----------

const censoringTracker: Scenario = {
  id: "censoring-tracker",
  title: "Censoring tracker",
  tagline: "It can't steal. It can stall — and you can see it.",
  description:
    "The tracker starts treating Alice differently: first it quietly leaves her new IOUs out of its tree, then it refuses them. Bob's wallet detects the omission. Because the tracker keeps committing for everyone else, the emergency path never opens. The exit is another tracker.",
  features: ["censorship", "commit", "redeem", "emergency", "multi-tracker", "refund"],
  cast: ["alice", "bob", "carol", "op", "op2"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Gatekeeper tracker", kind: "tracker-operator", erg: E(2) });
    eco.addParticipant({ id: "op2", name: "Open tracker", kind: "tracker-operator", erg: E(2) });
    eco.addParticipant({ id: "alice", name: "Alice", erg: E(25) });
    eco.addParticipant({ id: "bob", name: "Bob", kind: "business", erg: E(1) });
    eco.addParticipant({ id: "carol", name: "Carol", erg: E(10) });
    eco.createTracker({ id: "gate", name: "Gatekeeper", operator: "op", globalPolicy: defaultCollateralPolicy() });
    eco.createTracker({ id: "open", name: "Open", operator: "op2", globalPolicy: defaultCollateralPolicy() });
    eco.createReserve({ owner: "alice", amount: E(10), id: "alice-gate", tracker: "gate" });
    eco.createReserve({ owner: "carol", amount: E(5), id: "carol-gate", tracker: "gate" });
  },
  steps: [
    {
      id: "usual",
      title: "Business as usual",
      text: "Alice and Carol pay Bob through the Gatekeeper tracker.",
      waitBlocks: 10,
      run(eco) {
        const r = payAll(eco, [
          ["alice", "bob", E(2)],
          ["carol", "bob", E(1)],
        ]);
        return done(r.ok === 2, "Alice → Bob 2, Carol → Bob 1");
      },
    },
    {
      id: "omit",
      title: "Quiet omission",
      text: "Alice pays Bob 1 more. The tracker answers 'OK'… and leaves it out of its tree. Carol's payment goes in as normal, and the tracker commits.",
      waitBlocks: 10,
      focus: ["alice", "op"],
      run(eco) {
        eco.setCensorship("gate", "omit", ["alice"]);
        const a = eco.pay({ from: "alice", to: "bob", amount: E(1), tracker: "gate" });
        const c = eco.pay({ from: "carol", to: "bob", amount: E(1), tracker: "gate" });
        return done(a.ok && c.ok, "both accepted (one silently omitted)");
      },
    },
    {
      id: "detect",
      title: "Bob's wallet notices",
      text: "The tracker committed after accepting Alice's IOU, yet the committed tree still proves the old total. Bob holds Alice's signature for the new one: omission, provably.",
      focus: ["bob"],
      run(eco) {
        const t = eco.t("gate");
        const rec = eco.note("alice", "bob", "erg", "gate")!;
        const box = t.currentBox()!;
        const committed = t.committedTotal(rec.key);
        const detected = box.creationHeight > rec.updatedHeight && committed !== rec.totalDebt;
        return done(detected, `signed total ${ergs(rec.totalDebt)}, committed ${committed === null ? "none" : ergs(committed)}`);
      },
    },
    {
      id: "frozen",
      title: "Frozen, not stolen",
      text: "The tracker won't co-sign, and since it keeps committing for others its box never gets 2,160 blocks old: the emergency path stays shut.",
      focus: ["bob", "alice-gate"],
      run(eco) {
        const a = eco.redeem({ receiver: "bob", issuer: "alice", tracker: "gate" });
        const b = eco.redeem({ receiver: "bob", issuer: "alice", tracker: "gate", emergency: true });
        return done(!a.ok && !b.ok && !!b.eval?.failed.includes("trackerSigValid"), `tracker: ${a.code}; emergency: ${b.eval?.failed.join(", ") ?? b.code}`);
      },
    },
    {
      id: "refuse",
      title: "Open refusal",
      text: "Now it simply refuses Alice's IOUs. Nobody can force a tracker to witness a note.",
      focus: ["alice", "op"],
      run(eco) {
        eco.setCensorship("gate", "refuse", ["alice"]);
        const r = eco.pay({ from: "alice", to: "bob", amount: E(1), tracker: "gate" });
        return done(!r.ok && r.code === "censored", `refused: ${r.code}`);
      },
    },
    {
      id: "exit",
      title: "Exit to an honest tracker",
      text: "A reserve is bound to one tracker NFT (R6), so Alice opens a new one with the Open tracker and pays Bob there.",
      waitBlocks: 10,
      focus: ["alice", "bob", "op2"],
      run(eco) {
        const r = eco.createReserve({ owner: "alice", amount: E(5), id: "alice-open", tracker: "open" });
        const p = eco.pay({ from: "alice", to: "bob", amount: E(3), tracker: "open", memo: "re-issued off the censor" });
        return done(r.ok && p.ok, "alice-open: 5 ERG; Alice → Bob 3 via Open");
      },
    },
    {
      id: "redeem-open",
      title: "Bob gets paid",
      text: "Through the honest tracker it is a normal redemption.",
      focus: ["bob", "alice-open"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice", tracker: "open" });
        return done(r.ok && r.amount === E(3), r.ok ? `Bob +${ergs(r.amount!)}` : `refused: ${r.code}`);
      },
    },
  ],
};

// ---------- 10. idle tracker ----------

const idleTracker: Scenario = {
  id: "idle-tracker",
  title: "Idle tracker",
  tagline: "A quiet weekend opens the back door.",
  description:
    "The real tracker never re-commits an unchanged tree. If nobody pays for three days, its box ages past 2,160 blocks and the contract accepts redemptions without its signature — even though it is alive. A heartbeat commit keeps the door shut.",
  features: ["emergency", "commit", "redeem"],
  cast: ["alice", "bob", "carol", "op"],
  setup(eco) {
    eco.addParticipant({ id: "op", name: "Weekday tracker", kind: "tracker-operator", erg: E(2) });
    eco.addParticipant({ id: "alice", name: "Alice", erg: E(15) });
    eco.addParticipant({ id: "bob", name: "Bob", erg: E(1) });
    eco.addParticipant({ id: "carol", name: "Carol", erg: E(1) });
    eco.createTracker({ id: "weekday", name: "Weekday", operator: "op", globalPolicy: defaultCollateralPolicy() });
    eco.createReserve({ owner: "alice", amount: E(10), id: "alice-vault" });
  },
  steps: [
    {
      id: "friday",
      title: "Friday",
      text: "Alice owes Bob 4 ERG; the tracker commits.",
      waitBlocks: 10,
      run(eco) {
        return done(eco.pay({ from: "alice", to: "bob", amount: E(4) }).ok, "Alice → Bob 4");
      },
    },
    {
      id: "weekend",
      title: "A quiet weekend",
      text: "No payments for 2,161 blocks. The updater runs every 10 minutes and skips each time: the digest has not changed.",
      run(eco) {
        eco.mine(2161);
        const t = eco.t();
        return done(t.online && t.emergencyOpen(eco.clock.height), `tracker online, box age ${t.boxAge(eco.clock.height)} blocks`);
      },
    },
    {
      id: "backdoor",
      title: "No signature needed",
      text: "Bob redeems with an EMPTY tracker signature. The contract allows it — the tracker's policy and FIFO checks are bypassed.",
      focus: ["bob", "alice-vault"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice", emergency: true });
        return done(r.ok && r.emergency === true, r.ok ? `Bob +${ergs(r.amount!)} without the tracker` : `refused: ${r.code}`);
      },
    },
    {
      id: "heartbeat",
      title: "Heartbeat on",
      text: "Switch the tracker to re-commit even when nothing changed. Alice pays Carol; another quiet weekend passes.",
      waitBlocks: 0,
      run(eco) {
        eco.setTrackerOptions("weekday", { skipIfUnchanged: false });
        eco.pay({ from: "alice", to: "carol", amount: E(2) });
        eco.mine(2170);
        return done(eco.t().boxAge(eco.clock.height) < 2160, `box age ${eco.t().boxAge(eco.clock.height)} blocks`);
      },
    },
    {
      id: "shut",
      title: "Door shut",
      text: "An emergency redemption now fails in the contract: the box is fresh.",
      focus: ["carol"],
      run(eco) {
        const r = eco.redeem({ receiver: "carol", issuer: "alice", emergency: true });
        return done(!r.ok && !!r.eval?.failed.includes("trackerSigValid"), `contract: ${r.eval?.failed.join(", ") ?? r.code}`);
      },
    },
  ],
};

// ---------- 11. currency exchange ----------

const currencyExchange: Scenario = {
  id: "currency-exchange",
  title: "Currency exchange",
  tagline: "Turn an ERG claim into a USE claim — in two phases.",
  description:
    "Alice and Bob agree to convert part of Bob's ERG claim into a USE stablecoin claim. Both sign both new totals; the tracker lowers the ERG edge at once and raises the USE edge only after the decrease is committed and the ERG reserve is seen untouched. A stranger's top-up during staging cancels a second swap — and nothing is restored.",
  features: ["exchange", "token-reserve", "top-up", "redeem", "commit"],
  cast: ["alice", "bob", "carol", "op"],
  setup(eco) {
    eco.addDenomination(USE_TOKEN);
    eco.addParticipant({ id: "op", name: "Bridge tracker", kind: "tracker-operator", erg: E(3) });
    eco.addParticipant({ id: "alice", name: "Alice", erg: E(25), tokens: [[USE_TOKEN.id, 200_000n]] });
    eco.addParticipant({ id: "bob", name: "Bob", erg: E(1) });
    eco.addParticipant({ id: "carol", name: "Carol", erg: E(2) });
    eco.createTracker({ id: "bridge", name: "Bridge", operator: "op", denoms: [USE_TOKEN.id], globalPolicy: acceptAllPolicy() });
    eco.createReserve({ owner: "alice", amount: E(20), id: "alice-erg" });
    eco.createReserve({ owner: "alice", amount: 150_000n, denom: USE_TOKEN.id, id: "alice-use" });
  },
  steps: [
    {
      id: "owe",
      title: "Alice owes Bob 10 ERG",
      text: "A committed ERG IOU.",
      waitBlocks: 10,
      run(eco) {
        return done(eco.pay({ from: "alice", to: "bob", amount: E(10) }).ok, "Alice → Bob 10 ERG");
      },
    },
    {
      id: "swap",
      title: "Swap 4 ERG of claim for 9 USE",
      text: "Four signatures: Alice and Bob both sign the lowered ERG total (6) and the raised USE total (9). Phase 1 lowers the ERG edge immediately.",
      focus: ["alice", "bob"],
      run(eco, ctx) {
        const r = eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: E(4), to: USE_TOKEN.id, toAmount: 9_000n });
        ctx.memo.ex1 = r.exchange?.id;
        return done(r.ok && eco.note("alice", "bob")!.totalDebt === E(6), r.ok ? "staged; ERG edge 10 → 6" : `refused: ${r.code} ${r.message}`);
      },
    },
    {
      id: "phase2",
      title: "Phase 2",
      text: "Next cycle: the decrease is committed. The cycle after: it is confirmed, the ERG reserve box is unchanged, so the USE edge is written — and committed.",
      waitBlocks: 15,
      run(eco, ctx) {
        const x = eco.t().exchanges.get(ctx.memo.ex1 as string)!;
        return done(x.status === "staged", `exchange ${x.status}`);
      },
      check(eco, ctx) {
        const x = eco.t().exchanges.get(ctx.memo.ex1 as string)!;
        const use = eco.note("alice", "bob", USE_TOKEN.id);
        return done(x.status === "applied" && use?.totalDebt === 9_000n && eco.noteStatus(use) === "confirmed", `exchange ${x.status}; USE edge ${use ? fmt(use.totalDebt, 3) : "—"} USE (${use ? eco.noteStatus(use) : "—"})`);
      },
    },
    {
      id: "redeem-use",
      title: "Bob redeems USE",
      text: "From Alice's USE reserve (basis-token.es). The tracker adds the 0.001 ERG the token output needs.",
      focus: ["bob", "alice-use"],
      run(eco) {
        const r = eco.redeem({ receiver: "bob", issuer: "alice", denom: USE_TOKEN.id });
        return done(r.ok && eco.balance("bob", USE_TOKEN.id) === 9_000n, r.ok ? `Bob +${fmt(r.amount!, 3)} USE` : `refused: ${r.code} ${r.message}`);
      },
    },
    {
      id: "swap-2",
      title: "A second swap… and a top-up",
      text: "They stage another swap (2 ERG → 4.5 USE). Meanwhile Carol tops up Alice's ERG reserve by 0.1 ERG — anyone may — which spends the box the exchange is watching.",
      waitBlocks: 15,
      focus: ["carol", "alice-erg"],
      run(eco, ctx) {
        const r = eco.exchange({ issuer: "alice", receiver: "bob", from: "erg", fromAmount: E(2), to: USE_TOKEN.id, toAmount: 4_500n });
        ctx.memo.ex2 = r.exchange?.id;
        const t = eco.topUp({ reserve: "alice-erg", amount: E("0.1"), by: "carol" });
        return done(r.ok && t.ok, "staged; reserve box replaced by Carol's top-up");
      },
    },
    {
      id: "cancelled",
      title: "Cancelled — nothing restored",
      text: "Phase 2 sees a different reserve box and cancels. Bob's ERG claim stays lowered (4) and the USE increase never happens.",
      focus: ["bob"],
      run(eco, ctx) {
        const x = eco.t().exchanges.get(ctx.memo.ex2 as string)!;
        const ergEdge = eco.note("alice", "bob")!.totalDebt;
        const useEdge = eco.note("alice", "bob", USE_TOKEN.id)!.totalDebt;
        return done(x.status === "cancelled" && ergEdge === E(4) && useEdge === 9_000n, `exchange ${x.status}: ERG edge ${ergs(ergEdge)}, USE edge ${fmt(useEdge, 3)} USE`);
      },
    },
  ],
};

// ---------- registry & runner ----------

export const SCENARIOS: readonly Scenario[] = [
  cafeOnCredit,
  agentSwarm,
  villageLets,
  freeBank,
  trackerVanishes,
  refundRace,
  triangleNovation,
  clearingCircle,
  censoringTracker,
  idleTracker,
  currencyExchange,
];

export function getScenario(id: ScenarioId): Scenario {
  const s = SCENARIOS.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scenario ${id}`);
  return s;
}

export function listScenarios(): Array<{ id: ScenarioId; title: string; tagline: string; description: string; features: Feature[]; steps: number; cast: string[] }> {
  return SCENARIOS.map((s) => ({ id: s.id, title: s.title, tagline: s.tagline, description: s.description, features: s.features, steps: s.steps.length, cast: s.cast }));
}

export interface ScenarioRunOptions {
  seed?: string;
  params?: Record<string, number>;
  economy?: EconomyOptions;
}

/** Plays a scenario step by step on a fresh economy. */
export class ScenarioRun {
  readonly scenario: Scenario;
  readonly eco: Economy;
  readonly ctx: ScenarioContext;
  readonly results: StepResult[] = [];
  index = 0;

  constructor(scenario: Scenario | ScenarioId, opts: ScenarioRunOptions = {}) {
    this.scenario = typeof scenario === "string" ? getScenario(scenario) : scenario;
    const seed = opts.seed ?? `scenario/${this.scenario.id}`;
    this.eco = new Economy({ seed, ...this.scenario.economy, ...opts.economy });
    this.ctx = { rng: new Rng(seed), memo: {}, params: { ...this.scenario.params, ...opts.params } };
    this.eco.markStep(this.scenario.id, -1, this.scenario.title, this.scenario.tagline);
    this.scenario.setup(this.eco, this.ctx);
  }

  get done(): boolean {
    return this.index >= this.scenario.steps.length;
  }

  get current(): ScenarioStep | undefined {
    return this.scenario.steps[this.index];
  }

  private pending: { result: StepResult; step: ScenarioStep; h0: number } | null = null;

  /**
   * Runs the next step; mines its waitBlocks unless `mine: false` (then the caller animates them with
   * eco.mine and calls settle(), or simply the next step(), to evaluate the step's after-mining check).
   */
  step(o: { mine?: boolean } = {}): StepResult {
    this.settle();
    const step = this.scenario.steps[this.index];
    if (!step) throw new Error("scenario finished");
    const fromSeq = this.eco.events.length;
    this.eco.markStep(this.scenario.id, this.index, step.title, step.text);
    let outcome: StepOutcome;
    try {
      outcome = step.run(this.eco, this.ctx);
    } catch (e) {
      outcome = { ok: false, detail: `threw: ${(e as Error).message}` };
    }
    const h0 = this.eco.clock.height;
    const res: StepResult = { index: this.index, id: step.id, title: step.title, outcome, fromSeq, toSeq: this.eco.events.length - 1, minedBlocks: 0 };
    this.results.push(res);
    this.index++;
    this.pending = { result: res, step, h0 };
    if (o.mine !== false) {
      if (step.waitBlocks) this.eco.mine(step.waitBlocks);
      this.settle();
    }
    return res;
  }

  /** Evaluates the last step's after-mining check (no-op when none is pending). */
  settle(): StepResult | null {
    const p = this.pending;
    if (!p) return null;
    this.pending = null;
    if (p.step.check && p.result.outcome.ok) {
      try {
        p.result.outcome = p.step.check(this.eco, this.ctx);
      } catch (e) {
        p.result.outcome = { ok: false, detail: `check threw: ${(e as Error).message}` };
      }
    }
    p.result.toSeq = this.eco.events.length - 1;
    p.result.minedBlocks = this.eco.clock.height - p.h0;
    return p.result;
  }

  runAll(o: { mine?: boolean } = {}): StepResult[] {
    while (!this.done) this.step(o);
    this.settle();
    return this.results;
  }

  /** Events of one step (for a step-by-step event feed). */
  eventsOf(result: StepResult): EconomyEvent[] {
    return this.eco.events.slice(result.fromSeq, result.toSeq + 1);
  }
}

/** Runs a whole scenario and returns the economy and every step's outcome. */
export function runScenario(id: ScenarioId, opts: ScenarioRunOptions = {}): { eco: Economy; results: StepResult[]; ok: boolean } {
  const run = new ScenarioRun(id, opts);
  const results = run.runAll();
  return { eco: run.eco, results, ok: results.every((r) => r.outcome.ok) };
}
