// Scenario runs and free mode for /play (PRODUCT §4.1): each run is its own Economy (never the town), stepped
// exactly like the engine's ScenarioRun, with a time machine, forks, view scrubbing and export/import.
//
//   const run = await createRun("cafe-on-credit", { seed, params });
//   run.store              zustand store (RunState), at most one update per animation frame
//   await run.step()       next step + its waitBlocks (same events as ScenarioRun.step)
//   await run.animate()    the step, then its blocks one frame at a time (at most 40 frames), then settle()
//   await run.runAll()
//   run.view(seq)          time travel: the state right after event seq (null = live)
//   run.fork(seq)          a free-mode run on an alternate history
//   run.exportJson() / importRun(json)
//
// Heavy steps (the agent swarm's bursts and loop clearing) run in slices with the same commands in the same order
// as the engine, so the tab never freezes and the state hash still equals runScenario's (tested).
import { createStore, type StoreApi } from "zustand/vanilla";
import {
  collateralPolicy,
  contractSignatureHolds,
  cowPolicy,
  defaultCollateralPolicy,
  Economy,
  erg,
  eventsToJson,
  getScenario,
  listScenarios,
  Rng,
  TimeMachine,
  type AvlBackend,
  type EconomyEvent,
  type Scenario,
  type ScenarioContext,
  type ScenarioId,
  type ScenarioStep,
  type StateDiff,
  type StepOutcome,
  type StepResult,
  type TimelineMark,
} from "@/protocol";
import { ensureAvl, type AvlInfo } from "./avl";
import { FrameBatcher, now, yieldToLoop } from "./frame";
import { buildTown, SANDBOX_GENESIS_HEIGHT } from "./town/genesis";

export const RUN_FORMAT = "basis-sandbox-run";
/** Economy options a /play scenario run adds to the scenario's own: `runScenario(id, { economy: SCENARIO_ECONOMY })`
 *  builds the same economy. */
export const SCENARIO_ECONOMY = { genesisHeight: SANDBOX_GENESIS_HEIGHT } as const;
/** Time-machine checkpoint interval (events). */
const CHECKPOINT_EVERY = 256;

export type RunMode = "scenario" | "free" | "fork" | "replay";
export type RunStatus = "ready" | "running" | "animating" | "done" | "free";
export type FreeWorld = "small" | "empty" | "town";

export interface RunStepInfo {
  index: number;
  id: string;
  title: string;
  text: string;
  waitBlocks: number;
  focus: string[];
}

export interface RunScenarioInfo {
  id: ScenarioId;
  title: string;
  tagline: string;
  description: string;
  features: string[];
  cast: string[];
  params: Record<string, number>;
  steps: number;
}

export interface RunState {
  /** Bumps once per frame in which anything changed. */
  v: number;
  mode: RunMode;
  status: RunStatus;
  scenario: RunScenarioInfo | null;
  seed: string;
  params: Record<string, number>;
  /** The live economy of this run (read it; change it through the run's methods). */
  eco: Economy;
  height: number;
  events: number;
  /** Index of the next step. */
  index: number;
  steps: RunStepInfo[];
  current: RunStepInfo | null;
  /** Step results so far (outcome.ok: the protocol behaved as the story says). */
  results: StepResult[];
  /** A step ran with `mine: false` and waits for settle(). */
  pending: boolean;
  animating: { step: number; mined: number; total: number } | null;
  busy: boolean;
  error: string | null;
  /** Time travel: the seq the page looks at (null = live) and the economy right after it. */
  viewSeq: number | null;
  view: Economy | null;
  avl: AvlInfo | null;
  /** Every step ran and every outcome is ok (null while steps remain). */
  ok: boolean | null;
  /** Steps can continue (false for a replayed log whose steps cannot be re-run). */
  continuable: boolean;
  /** Commands ran outside the steps (exec): the run no longer follows the story alone. */
  tampered: boolean;
}

interface RunInit {
  mode: RunMode;
  scenario?: Scenario | null;
  seed: string;
  params?: Record<string, number>;
  eco?: Economy;
  avl: AvlBackend;
  avlInfo?: AvlInfo | null;
  results?: StepResult[];
  index?: number;
  continuable?: boolean;
}

/** Blocks mined after each step: one entry per mine() call (export/import re-runs them exactly). */
type Mining = number[][];

// ---------------------------------------------------------------------------------------------
// heavy steps: the swarm bursts in slices
// ---------------------------------------------------------------------------------------------

/** The engine's swarmBurst with yields between ~20 ms slices: same rng fork, same payments, same order. */
export async function swarmBurstChunked(eco: Economy, ctx: ScenarioContext, count: number, label: string, budgetMs = 20): Promise<{ ok: number; rejected: number; ms: number }> {
  const rng = ctx.rng.fork(label);
  const ids = [...eco.participants.values()].filter((p) => p.kind === "agent").map((p) => p.id);
  let ok = 0;
  let rejected = 0;
  let busy = 0;
  let i = 0;
  while (i < count) {
    const t0 = now();
    while (i < count && now() - t0 < budgetMs) {
      const a = rng.int(0, ids.length - 1);
      let b = rng.int(0, ids.length - 2);
      if (b >= a) b++;
      const amount = rng.bigint(100_000n, 10_000_000n);
      const r = eco.pay({ from: ids[a], to: ids[b], amount, memo: "api call" });
      if (r.ok) ok++;
      else rejected++;
      i++;
    }
    busy += now() - t0;
    if (i < count) await yieldToLoop();
  }
  return { ok, rejected, ms: busy };
}

type HeavyStep = (eco: Economy, ctx: ScenarioContext) => Promise<StepOutcome>;

/** The engine's ERG text in step details ("1.5 ERG"). */
function ergs(v: bigint): string {
  const neg = v < 0n;
  const a = neg ? -v : v;
  const base = 10n ** 9n;
  const frac = (a % base).toString().padStart(9, "0").replace(/0+$/, "");
  return `${neg ? "−" : ""}${a / base}${frac ? "." + frac : ""} ERG`;
}

/**
 * Steps that would block the tab for more than ~100 ms, replaced by sliced equivalents. Each replica makes the
 * engine's calls in the engine's order (runs.test.ts checks the state hash against runScenario): when the
 * protocol's scenario text changes, update the replica.
 */
const HEAVY_STEPS: Record<string, HeavyStep> = {
  "agent-swarm/burst-1": async (eco, ctx) => {
    const r = await swarmBurstChunked(eco, ctx, ctx.params.burst1, "burst-1");
    return { ok: r.ok > ctx.params.burst1 * 0.9, detail: `${r.ok} payments in ${r.ms.toFixed(0)} ms` };
  },
  "agent-swarm/burst-2": async (eco, ctx) => {
    const r = await swarmBurstChunked(eco, ctx, ctx.params.burst2, "burst-2");
    const s = eco.stats();
    return { ok: r.ok > ctx.params.burst2 * 0.9, detail: `${r.ok} payments in ${r.ms.toFixed(0)} ms; ${s.payments} total over ${s.notes} notes` };
  },
  // six rounds of cycle search + one atomic clearing each (≈ 20 ms a round): yield between rounds
  "agent-swarm/loops": async (eco, ctx) => {
    let cleared = 0n;
    let txs = 0;
    for (let round = 0; round < 6; round++) {
      await yieldToLoop();
      const cycles = eco.findCycles("erg", 4);
      const c = cycles.find((x) => x.amount > 0n);
      if (!c) break;
      const r = eco.clearCycle(c, { mode: "onchain" });
      if (!r.ok) break;
      cleared += r.amount! * BigInt(c.members.length);
      txs++;
    }
    ctx.memo.cleared = cleared;
    return { ok: txs > 0, detail: `${txs} atomic clearing transaction(s), ${ergs(cleared)} of debt gone` };
  },
  // 16 signature spot-checks (≈ 4 ms each): yield every few checks; the same rng picks in the same order
  "agent-swarm/audit": async (eco, ctx) => {
    const notes = [...eco.t().notes.values()];
    let good = 0;
    const sample = Math.min(16, notes.length);
    let t0 = now();
    for (let i = 0; i < sample; i++) {
      if (now() - t0 > 16) {
        await yieldToLoop();
        t0 = now();
      }
      const rec = ctx.rng.pick(notes);
      const sig = eco.signatures(rec);
      if (sig.issuerSigOk && contractSignatureHolds(rec.issuer, sig.message, sig.issuerSig)) good++;
    }
    return { ok: good === sample, detail: `${good}/${sample} signatures valid on-chain` };
  },
};

// ---------------------------------------------------------------------------------------------
// free-mode worlds
// ---------------------------------------------------------------------------------------------

/** A fresh small world: a tracker, three people/businesses and an agent, three reserves, a confirmed box. */
export function buildSmallWorld(seed: string, avl?: AvlBackend): Economy {
  const eco = new Economy({ seed, genesisHeight: SANDBOX_GENESIS_HEIGHT, avl });
  eco.addParticipant({ id: "op", name: "Tracker operator", kind: "tracker-operator", erg: erg(10) });
  eco.createTracker({ id: "T-01", name: "Sandbox tracker", operator: "op", globalPolicy: defaultCollateralPolicy() });
  eco.addParticipant({ id: "alice", name: "Alice", kind: "human", erg: erg(20) });
  eco.addParticipant({ id: "bob", name: "Bob", kind: "human", erg: erg(5) });
  eco.addParticipant({ id: "cafe", name: "Café", kind: "business", erg: erg(10) });
  eco.addParticipant({ id: "scout", name: "Scout", kind: "agent", erg: erg(3) });
  eco.createReserve({ owner: "alice", amount: erg(10) });
  eco.createReserve({ owner: "cafe", amount: erg(5) });
  eco.createReserve({ owner: "scout", amount: erg(1) });
  eco.setPolicy("alice", collateralPolicy(1.0, true));
  eco.setPolicy("bob", cowPolicy([eco.p("alice").pub], 1.0, null));
  eco.setPolicy("cafe", collateralPolicy(1.0, true));
  eco.setPolicy("scout", collateralPolicy(1.0, true));
  eco.mine(10);
  return eco;
}

/** Only a tracker and its operator. */
export function buildEmptyWorld(seed: string, avl?: AvlBackend): Economy {
  const eco = new Economy({ seed, genesisHeight: SANDBOX_GENESIS_HEIGHT, avl });
  eco.addParticipant({ id: "op", name: "Tracker operator", kind: "tracker-operator", erg: erg(10) });
  eco.createTracker({ id: "T-01", name: "Sandbox tracker", operator: "op", globalPolicy: defaultCollateralPolicy() });
  return eco;
}

// ---------------------------------------------------------------------------------------------
// the run
// ---------------------------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function stepInfo(s: ScenarioStep, index: number): RunStepInfo {
  return { index, id: s.id, title: s.title, text: s.text, waitBlocks: s.waitBlocks ?? 0, focus: s.focus ?? [] };
}

export class RunController {
  readonly store: StoreApi<RunState>;
  readonly mode: RunMode;
  readonly scenario: Scenario | null;
  readonly seed: string;
  readonly params: Record<string, number>;
  readonly avl: AvlBackend;
  readonly avlInfo: AvlInfo | null;
  readonly eco: Economy;
  readonly ctx: ScenarioContext | null;
  readonly results: StepResult[];
  index: number;

  private pending: { result: StepResult; step: ScenarioStep; h0: number } | null = null;
  private mining: Mining = [];
  private tm: TimeMachine | null = null;
  private warming = false;
  private warmSeq = 0;
  private readonly batch: FrameBatcher;
  private readonly unsub: () => void;
  private busy = false;
  private skipping = false;
  private anim: RunState["animating"] = null;
  private viewSeq: number | null = null;
  private viewEco: Economy | null = null;
  private viewCache = new Map<number, Economy>();
  private error: string | null = null;
  private continuable: boolean;
  private tampered = false;
  private disposed = false;

  constructor(init: RunInit) {
    this.mode = init.mode;
    this.scenario = init.scenario ?? null;
    this.seed = init.seed;
    this.avl = init.avl;
    this.avlInfo = init.avlInfo ?? null;
    this.params = { ...this.scenario?.params, ...init.params };
    this.results = init.results ?? [];
    this.index = init.index ?? 0;
    this.continuable = init.continuable ?? !!this.scenario;
    if (init.eco) {
      this.eco = init.eco;
      this.ctx = this.scenario ? { rng: new Rng(this.seed), memo: {}, params: this.params } : null;
    } else if (this.scenario) {
      // exactly ScenarioRun's constructor with SCENARIO_ECONOMY as its options, the backend made explicit
      this.eco = new Economy({ seed: this.seed, ...this.scenario.economy, ...SCENARIO_ECONOMY, avl: this.avl });
      this.ctx = { rng: new Rng(this.seed), memo: {}, params: this.params };
      this.eco.markStep(this.scenario.id, -1, this.scenario.title, this.scenario.tagline);
      this.scenario.setup(this.eco, this.ctx);
    } else {
      this.eco = buildSmallWorld(this.seed, this.avl);
      this.ctx = null;
    }
    this.batch = new FrameBatcher(() => this.publish());
    this.store = createStore<RunState>(() => this.snapshot(0, undefined));
    this.unsub = this.eco.subscribe(() => this.batch.mark());
  }

  get done(): boolean {
    return !this.scenario || this.index >= this.scenario.steps.length;
  }

  get current(): ScenarioStep | undefined {
    return this.scenario?.steps[this.index];
  }

  // --- steps (scenario mode) ---

  private assertSteps(): void {
    if (!this.scenario || !this.ctx) throw new Error("free-mode run: there are no steps");
    if (!this.continuable) throw new Error("this replayed run cannot continue its steps");
    if (this.busy) throw new Error("the run is busy");
  }

  /** Runs the next step and (unless `mine: false`) mines its waitBlocks, like ScenarioRun.step. */
  async step(o: { mine?: boolean } = {}): Promise<StepResult> {
    this.assertSteps();
    this.busy = true;
    this.batch.mark();
    try {
      return await this.stepInner(o.mine !== false);
    } finally {
      this.busy = false;
      this.afterChange();
    }
  }

  private async stepInner(mine: boolean): Promise<StepResult> {
    const scenario = this.scenario!;
    this.settleInner();
    const step = scenario.steps[this.index];
    if (!step) throw new Error("scenario finished");
    const fromSeq = this.eco.events.length;
    this.eco.markStep(scenario.id, this.index, step.title, step.text);
    let outcome: StepOutcome;
    try {
      const heavy = HEAVY_STEPS[`${scenario.id}/${step.id}`];
      outcome = heavy ? await heavy(this.eco, this.ctx!) : step.run(this.eco, this.ctx!);
    } catch (e) {
      outcome = { ok: false, detail: `threw: ${(e as Error).message}` };
    }
    const h0 = this.eco.clock.height;
    const res: StepResult = { index: this.index, id: step.id, title: step.title, outcome, fromSeq, toSeq: this.eco.events.length - 1, minedBlocks: 0 };
    this.results.push(res);
    this.mining[this.index] = [];
    this.index++;
    this.pending = { result: res, step, h0 };
    if (mine) {
      if (step.waitBlocks) this.mineFor(res.index, step.waitBlocks);
      this.settleInner();
    }
    return res;
  }

  private mineFor(stepIndex: number, n: number): void {
    if (n <= 0) return;
    this.eco.mine(n);
    (this.mining[stepIndex] ??= []).push(n);
  }

  private settleInner(): StepResult | null {
    const p = this.pending;
    if (!p) return null;
    this.pending = null;
    if (p.step.check && p.result.outcome.ok) {
      try {
        p.result.outcome = p.step.check(this.eco, this.ctx!);
      } catch (e) {
        p.result.outcome = { ok: false, detail: `check threw: ${(e as Error).message}` };
      }
    }
    p.result.toSeq = this.eco.events.length - 1;
    p.result.minedBlocks = this.eco.clock.height - p.h0;
    return p.result;
  }

  /** Evaluates the last step's after-mining check (no-op when none is pending). */
  settle(): StepResult | null {
    const r = this.settleInner();
    this.afterChange();
    return r;
  }

  /**
   * The next step, then its blocks one frame at a time (long waits in at most `maxFrames` strides), then
   * settle(). skip() mines the rest at once.
   */
  async animate(o: { blockMs?: number; maxFrames?: number } = {}): Promise<StepResult> {
    this.assertSteps();
    this.busy = true;
    this.skipping = false;
    this.batch.mark();
    try {
      const res = await this.stepInner(false);
      const total = this.scenario!.steps[res.index].waitBlocks ?? 0;
      const frames = Math.max(1, o.maxFrames ?? 40);
      const stride = Math.max(1, Math.ceil(total / frames));
      let mined = 0;
      while (mined < total && !this.disposed) {
        const n = this.skipping ? total - mined : Math.min(stride, total - mined);
        this.mineFor(res.index, n);
        mined += n;
        this.anim = { step: res.index, mined, total };
        this.batch.mark();
        if (mined < total) await sleep(o.blockMs ?? 250);
      }
      this.anim = null;
      this.settleInner();
      return res;
    } finally {
      this.anim = null;
      this.busy = false;
      this.skipping = false;
      this.afterChange();
    }
  }

  /** Finishes a running animation at once. */
  skip(): void {
    this.skipping = true;
  }

  /** Runs every remaining step (headless; yields between steps). */
  async runAll(o: { mine?: boolean } = {}): Promise<StepResult[]> {
    while (!this.done) {
      await this.step(o);
      await yieldToLoop();
    }
    this.settle();
    return this.results;
  }

  /** Events of one step (incl. its scenario.step marker and mined blocks), for the step's feed. */
  eventsOf(r: StepResult | number): EconomyEvent[] {
    const res = typeof r === "number" ? this.results[r] : r;
    if (!res) return [];
    const to = res === this.pending?.result ? this.eco.events.length - 1 : res.toSeq;
    return this.eco.events.slice(res.fromSeq, to + 1);
  }

  // --- free-mode commands ---

  /**
   * Runs engine commands on this run's economy (free mode, god-mode tools, "try to cheat"). In a scenario run
   * the run is then marked `tampered`: its later steps may not tell the story any more.
   */
  exec<T>(fn: (eco: Economy) => T): T {
    if (this.busy) throw new Error("the run is busy");
    if (this.viewSeq !== null) this.view(null);
    const before = this.eco.events.length;
    try {
      return fn(this.eco);
    } finally {
      if (this.eco.events.length !== before && this.scenario) this.tampered = true;
      this.afterChange();
    }
  }

  pay(o: Parameters<Economy["pay"]>[0]) {
    return this.exec((eco) => eco.pay(o));
  }
  redeem(o: Parameters<Economy["redeem"]>[0]) {
    return this.exec((eco) => eco.redeem(o));
  }
  /** Mines blocks. After `step({ mine: false })` this is the step's own wait (recorded for export, not tampering). */
  mine(blocks: number) {
    const p = this.pending;
    if (p && this.scenario && !this.busy) {
      if (this.viewSeq !== null) this.view(null);
      this.mineFor(p.result.index, blocks);
      this.afterChange();
      return;
    }
    return this.exec((eco) => eco.mine(blocks));
  }
  commit(trackerId?: string) {
    return this.exec((eco) => eco.commit(trackerId, { force: true }));
  }

  // --- time machine ---

  /** The run's time machine, synced with the live economy. */
  timeMachine(): TimeMachine {
    if (!this.tm) this.tm = new TimeMachine(this.eco, { checkpointEvery: CHECKPOINT_EVERY, avl: this.avl });
    else if (this.tm.length < this.eco.events.length) this.tm.sync(this.eco);
    return this.tm;
  }

  /** A fresh economy right after event `seq` (read it; it is not the live one). */
  stateAt(seq: number): Economy {
    return this.timeMachine().stateAt(seq);
  }

  stateAtHeight(height: number): Economy {
    return this.timeMachine().stateAtHeight(height);
  }

  /** Timeline marks (step, money, chain, tracker, alert, reject). */
  marks(filter?: (m: TimelineMark) => boolean): TimelineMark[] {
    return this.timeMachine().marks(filter, (id) => this.eco.participants.get(id)?.name ?? id);
  }

  /** What differs between two states (seqs, or economies; `b` defaults to the live state). */
  diff(a: number | Economy, b: number | Economy = this.eco): StateDiff {
    const ea = typeof a === "number" ? this.stateAt(a) : a;
    const eb = typeof b === "number" ? this.stateAt(b) : b;
    return TimeMachine.diff(ea, eb);
  }

  /** Full replay of the log gives the live state hash. */
  verify(): { ok: boolean; hash: string; expected: string } {
    return this.timeMachine().verify(this.eco);
  }

  /** Looks at the state right after `seq` (null or the last seq: back to live). Cached for recent seqs. */
  view(seq: number | null): Economy | null {
    if (seq === null || seq >= this.eco.events.length - 1) {
      this.viewSeq = null;
      this.viewEco = null;
      this.batch.mark();
      return null;
    }
    const s = Math.max(0, Math.floor(seq));
    let e = this.viewCache.get(s);
    if (!e) {
      e = this.stateAt(s);
      this.viewCache.set(s, e);
      if (this.viewCache.size > 12) this.viewCache.delete(this.viewCache.keys().next().value as number);
    } else {
      this.viewCache.delete(s);
      this.viewCache.set(s, e);
    }
    this.viewSeq = s;
    this.viewEco = e;
    this.batch.mark();
    this.warm();
    return e;
  }

  /** A free-mode run on an alternate history from `seq` (default: now). The original is untouched. */
  fork(seq: number = this.eco.events.length - 1): RunController {
    const eco = this.timeMachine().fork(seq);
    return new RunController({ mode: "fork", seed: `${this.seed}/fork@${seq}`, eco, avl: this.avl, avlInfo: this.avlInfo, continuable: false });
  }

  /**
   * Builds time-machine checkpoints in idle slices once the page uses time travel, so scrubbing a long log
   * stays instant. Pauses while a step runs (afterChange resumes it).
   */
  private warm(): void {
    if (this.warming || this.disposed || this.busy || !this.tm) return;
    this.warming = true;
    void (async () => {
      try {
        while (!this.disposed && !this.busy) {
          const tm = this.timeMachine();
          if (this.warmSeq >= tm.lastSeq) break;
          await yieldToLoop();
          if (this.disposed || this.busy) break;
          const t0 = now();
          while (this.warmSeq < tm.lastSeq && now() - t0 < 12) {
            // one stateAt per checkpoint interval: it advances the replay head and clones once
            this.warmSeq = Math.min(tm.lastSeq, this.warmSeq + CHECKPOINT_EVERY);
            tm.stateAt(this.warmSeq);
          }
        }
      } catch {
        /* the run changed under us; the next change warms again */
      } finally {
        this.warming = false;
      }
    })();
  }

  // --- export / import ---

  /** The run as JSON: header (scenario, seed, params, how each step was mined) + the bigint-safe event log. */
  exportJson(o: { indent?: number } = {}): string {
    for (const e of this.eco.events) {
      if (e.type === "participant.joined" && e.key.source === "secret") throw new Error("this run holds a key made from a secret; it is not exported");
    }
    const head = {
      format: RUN_FORMAT,
      v: 1,
      mode: this.mode,
      scenario: this.scenario?.id ?? null,
      seed: this.seed,
      params: this.params,
      index: this.index,
      mining: this.mining,
      tampered: this.tampered,
      backend: this.avl.id,
      results: this.results,
    };
    const headJson = JSON.stringify(head, (_k, v) => (typeof v === "bigint" ? { $n: v.toString() } : v), o.indent);
    return `{"head":${headJson},"events":${eventsToJson(this.eco.events, o.indent)}}`;
  }

  // --- store ---

  private afterChange(): void {
    this.batch.mark();
    this.warm();
  }

  private snapshot(v: number, prev: RunState | undefined): RunState {
    const sc = this.scenario;
    const steps = prev?.steps ?? (sc ? sc.steps.map(stepInfo) : []);
    const status: RunStatus = !sc ? "free" : this.anim ? "animating" : this.busy ? "running" : this.done ? "done" : "ready";
    return {
      v,
      mode: this.mode,
      status,
      scenario: prev?.scenario ?? (sc ? { id: sc.id, title: sc.title, tagline: sc.tagline, description: sc.description, features: [...sc.features], cast: [...sc.cast], params: { ...this.params }, steps: sc.steps.length } : null),
      seed: this.seed,
      params: prev?.params ?? { ...this.params },
      eco: this.eco,
      height: this.eco.clock.height,
      events: this.eco.events.length,
      index: this.index,
      steps,
      current: sc && this.index < steps.length ? steps[this.index] : null,
      results: this.results.map((r) => ({ ...r, outcome: { ...r.outcome } })),
      pending: this.pending !== null,
      animating: this.anim ? { ...this.anim } : null,
      busy: this.busy,
      error: this.error,
      viewSeq: this.viewSeq,
      view: this.viewEco,
      avl: this.avlInfo,
      ok: sc && this.done && !this.pending ? this.results.every((r) => r.outcome.ok) : null,
      continuable: this.continuable,
      tampered: this.tampered,
    };
  }

  private publish(): void {
    const prev = this.store?.getState();
    this.store.setState(this.snapshot((prev?.v ?? 0) + 1, prev), true);
  }

  /** Applies pending store updates now (tests). */
  flush(): void {
    this.batch.flushNow();
    this.publish();
  }

  dispose(): void {
    this.disposed = true;
    this.skipping = true;
    this.unsub();
    this.batch.dispose();
    this.viewCache.clear();
  }

  /** Internal: re-runs exported mining exactly (import). */
  async replaySteps(index: number, mining: Mining): Promise<void> {
    this.assertSteps();
    this.busy = true;
    try {
      while (this.index < index) {
        const i = this.index;
        const strides = mining[i];
        await this.stepInner(strides === undefined);
        if (strides !== undefined) {
          for (const n of strides) this.mineFor(i, n);
          this.settleInner();
        }
        await yieldToLoop();
      }
    } finally {
      this.busy = false;
      this.afterChange();
    }
  }
}

// ---------------------------------------------------------------------------------------------
// factories
// ---------------------------------------------------------------------------------------------

/** The scenario presets (id, title, tagline, description, features, steps, cast). */
export function scenarioList() {
  return listScenarios();
}

/** A scenario run on its own fresh economy (default seed `scenario/<id>`, like the engine). */
export async function createRun(id: ScenarioId, o: { seed?: string; params?: Record<string, number> } = {}): Promise<RunController> {
  const { backend, info } = await ensureAvl();
  const scenario = getScenario(id);
  return new RunController({ mode: "scenario", scenario, seed: o.seed ?? `scenario/${scenario.id}`, params: o.params, avl: backend, avlInfo: info });
}

/** A free-mode run on a fresh world: "small" (default), "empty" (a tracker only) or "town" (the town's genesis, without You). */
export async function createFreeRun(o: { seed?: string; world?: FreeWorld } = {}): Promise<RunController> {
  const { backend, info } = await ensureAvl();
  const seed = o.seed ?? `free/${o.world ?? "small"}`;
  const eco = o.world === "empty" ? buildEmptyWorld(seed, backend) : o.world === "town" ? buildTown({ seed, avl: backend }) : buildSmallWorld(seed, backend);
  return new RunController({ mode: "free", seed, eco, avl: backend, avlInfo: info, continuable: false });
}

export class RunImportError extends Error {
  constructor(
    readonly code: "bad-format" | "backend-mismatch" | "replay-failed",
    message: string,
  ) {
    super(message);
    this.name = "RunImportError";
  }
}

const revive = (_k: string, v: unknown) => (v && typeof v === "object" && typeof (v as { $n?: unknown }).$n === "string" && Object.keys(v).length === 1 ? BigInt((v as { $n: string }).$n) : v);

/**
 * Loads an exported run. A scenario run is re-run from its seed and params (deterministic) and kept live when
 * its state hash matches the log; otherwise the log is replayed as a read-only "replay" run (free commands and
 * forks still work).
 */
export async function importRun(json: string): Promise<RunController> {
  let doc: { head?: Record<string, unknown>; events?: EconomyEvent[] };
  try {
    doc = JSON.parse(json, revive) as typeof doc;
  } catch {
    throw new RunImportError("bad-format", "not JSON");
  }
  const head = doc.head as
    | { format: string; v: number; mode: RunMode; scenario: ScenarioId | null; seed: string; params: Record<string, number>; index: number; mining: Mining; tampered: boolean; backend: string; results: StepResult[] }
    | undefined;
  const events = doc.events;
  if (!head || head.format !== RUN_FORMAT || head.v !== 1 || !Array.isArray(events) || events[0]?.type !== "genesis") throw new RunImportError("bad-format", "not a saved sandbox run");
  for (const e of events) {
    if (e.type === "participant.joined" && e.key.source === "secret") throw new RunImportError("bad-format", "the run holds a key made from a secret");
  }
  const { backend, info } = await ensureAvl();
  const recorded = (events[0] as Extract<EconomyEvent, { type: "genesis" }>).avlBackend;
  if (recorded !== backend.id) throw new RunImportError("backend-mismatch", `the run was recorded with the ${recorded} tree; this browser runs ${backend.id}`);
  let eco: Economy;
  try {
    eco = Economy.replay([events[0]], { avl: backend });
    for (let i = 1; i < events.length; i++) {
      eco.ingest(events[i]);
      if (i % 512 === 0) await yieldToLoop();
    }
  } catch (e) {
    throw new RunImportError("replay-failed", (e as Error).message);
  }
  if (head.scenario && head.mode === "scenario" && !head.tampered) {
    try {
      const rerun = new RunController({ mode: "scenario", scenario: getScenario(head.scenario), seed: head.seed, params: head.params, avl: backend, avlInfo: info });
      await rerun.replaySteps(head.index, head.mining ?? []);
      if (rerun.eco.events.length === eco.events.length && rerun.eco.stateHash() === eco.stateHash()) return rerun;
      rerun.dispose();
    } catch {
      /* fall back to the replay */
    }
  }
  const scenario = head.scenario ? getScenario(head.scenario) : null;
  return new RunController({ mode: head.mode === "scenario" ? "replay" : head.mode, scenario, seed: head.seed, params: head.params, eco, avl: backend, avlInfo: info, results: head.results ?? [], index: head.index ?? 0, continuable: false });
}
