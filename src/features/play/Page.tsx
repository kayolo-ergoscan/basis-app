// /play — the sandbox (VISUAL §13). A scenario run (or free mode) on a stage: the debt graph around the tracker's
// lighthouse, the steps on the left, the inspector and "try to cheat" on the right, the time machine at the
// bottom. Everything runs in the browser on @/world runs; nothing here is real money.
import { startTransition, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { addI18n, pulse, useLang, useT, type TFn } from "@/app";
import type { Lang } from "@/app/types";
import { copy, pick } from "@/content";
import { TimeMachine, type DenomId, type Economy, type EconomyEvent, type ScenarioId, type StepResult } from "@/protocol";
import { Empty, ErrorState, GraphLegend, Icon, Loading, Odometer, Popover, Seg, Sheet, Skyline, Tabs, Tag, int, toast, useIsPhone, useMedia, useReducedMotion } from "@/ui";
import { ContractXray, EventFeed, TxLens, synthCreateTx } from "@/viz";
import { importRun, RunImportError, useRun, useRunState, type RunController, type RunSpec, type RunState } from "@/world";
import { Cheats } from "./Cheats";
import { FreeTools, type XrayRequest } from "./FreeTools";
import { Inspector, reasonWords, type ActApi } from "./Inspector";
import {
  buildStage,
  denomInfoOf,
  denomViews,
  displayName,
  fmtAmt,
  marksOf,
  namerFor,
  ONCHAIN_TYPES,
  REFUSAL_TYPES,
  rebuildRefusal,
  rebuildTx,
  refusalsIn,
  segmentsOf,
  type Box4,
  type CheatResult,
  type TxView,
} from "./model";
import { Rail, SCENARIOS, ScenarioList, StepCards, scTitle, stepTitle, type StepsState } from "./Rail";
import { StageGraph, StageTable, type Sel } from "./StageGraph";
import strings from "./strings";
import { SPEEDS, TimeBar, type Speed } from "./TimeBar";
import "./play.css";

addI18n(strings);

const DEFAULT_SCENARIO: ScenarioId = "cafe-on-credit";
const IDS = new Set<string>(SCENARIOS.map((s) => s.id));
const SPEED_KEY = "basis.play.speed";

export default function PlayPage() {
  return (
    <Routes>
      <Route index element={<PlayRoute id={DEFAULT_SCENARIO} />} />
      <Route path="free" element={<PlayRoute id={null} />} />
      <Route path=":scenario" element={<ScenarioParam />} />
      <Route path="*" element={<Navigate to="/play" replace />} />
    </Routes>
  );
}

function ScenarioParam() {
  const { scenario } = useParams();
  if (!scenario || !IDS.has(scenario)) return <Navigate to="/play" replace />;
  return <PlayRoute id={scenario as ScenarioId} />;
}

function PlayRoute({ id }: { id: ScenarioId | null }) {
  const [sp] = useSearchParams();
  const seed = sp.get("seed")?.slice(0, 80) || undefined;
  return <Play key={`${id ?? "free"}|${seed ?? ""}`} id={id} seed={seed} />;
}

const defaultSeed = (id: ScenarioId | null) => (id ? `scenario/${id}` : "free/small");

function readSpeed(): Speed {
  try {
    const v = localStorage.getItem(SPEED_KEY);
    if (v === "calm" || v === "brisk" || v === "fast") return v;
  } catch {
    /* storage blocked */
  }
  return "calm";
}

type View = "graph" | "table";
/** The stage's guilloche field answers only to sandbox commitments. */
const sandboxPulse = (p: { source: string }) => p.source === "sandbox";
/** Phone: the cartouche row above the graph (the bottom sheet's peek sits below it). */
const PHONE_TOP = 62;
type InsTab = "inspect" | "cheat";
type PhoneTab = "steps" | "inspect" | "cheat" | "log";

/** Height of the page under the shell's nav and banner (and above the phone tab bar). */
function useFillHeight(ref: React.RefObject<HTMLElement | null>, phone: boolean): number {
  const [h, setH] = useState(() => (typeof window === "undefined" ? 800 : window.innerHeight - 104));
  useEffect(() => {
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const next = Math.max(phone ? 520 : 560, Math.round(window.innerHeight - top - (phone ? 84 : 0)));
      setH((p) => (Math.abs(p - next) > 1 ? next : p));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(document.body);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, phone]);
  return h;
}

/** Size of an element that may mount later (the stage appears once the run is ready): a callback ref + its box. */
function useBox(): [(el: HTMLElement | null) => void, { w: number; h: number } | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const w = Math.round(el.clientWidth);
      const h = Math.round(el.clientHeight);
      setBox((b) => (b && Math.abs(b.w - w) <= 2 && Math.abs(b.h - h) <= 2 ? b : { w, h }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, box];
}

/**
 * The rows of an absolutely placed block (the cartouche), each as wide as its own words, as boxes in its parent's
 * coordinates, with a little air and rounded outwards (so one more digit in a row does not move the circle).
 */
function useRowBoxes(): [(el: HTMLElement | null) => void, Box4[] | null] {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [boxes, setBoxes] = useState<Box4[] | null>(null);
  useLayoutEffect(() => {
    if (!el) return;
    const measure = () => {
      const base = (el.offsetParent ?? el).getBoundingClientRect();
      const out: Box4[] = [];
      for (const c of Array.from(el.children)) {
        if (!(c instanceof HTMLElement) || c.classList.contains("sr-only") || c.offsetHeight === 0) continue;
        const r = c.getBoundingClientRect();
        out.push([0, Math.floor((r.top - base.top - 6) / 8) * 8, Math.ceil((r.right - base.left + 10) / 16) * 16, Math.ceil((r.bottom - base.top + 6) / 8) * 8]);
      }
      const key = out.map((b) => b.join(",")).join(";");
      setBoxes((b) => (b && b.map((x) => x.join(",")).join(";") === key ? b : out));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    for (const c of Array.from(el.children)) ro.observe(c);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, boxes];
}

interface ForkState {
  run: RunController;
  from: RunController;
  seq: number;
}

function Play({ id, seed }: { id: ScenarioId | null; seed?: string }) {
  const t = useT();
  const { lang } = useLang();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const compact = useMedia("(max-width: 1000px)");
  const tall = useMedia("(min-height: 1040px)");
  const [nonce, setNonce] = useState(0);
  const spec = useMemo(() => ({ ...(id ? { scenario: id } : { free: "small" as const }), seed, nonce }) as unknown as RunSpec, [id, seed, nonce]);
  const { run, error } = useRun(spec);
  const [imported, setImported] = useState<RunController | null>(null);
  const [fork, setFork] = useState<ForkState | null>(null);
  const base = imported ?? run;
  const active = fork?.run ?? base;

  useEffect(() => () => imported?.dispose(), [imported]);
  useEffect(() => () => fork?.run.dispose(), [fork]);
  useEffect(() => {
    setFork(null);
    setImported(null);
  }, [run]);

  const rootRef = useRef<HTMLDivElement>(null);
  const height = useFillHeight(rootRef, phone);

  const st = useRunState(active, (s) => ({
    v: s.v,
    mode: s.mode,
    scenario: s.scenario,
    seed: s.seed,
    index: s.index,
    steps: s.steps,
    results: s.results,
    animating: s.animating,
    busy: s.busy,
    viewSeq: s.viewSeq,
    view: s.view,
    eco: s.eco,
    ok: s.ok,
    continuable: s.continuable,
    tampered: s.tampered,
    avl: s.avl,
    error: s.error,
  }));

  // ---- ui state
  const [sel, setSel] = useState<Sel | null>(null);
  const [view, setView] = useState<View>("graph");
  const [insTab, setInsTab] = useState<InsTab>("inspect");
  // desktop: the inspector is a drawer at the right; the stage keeps the room until you pick something or open it
  const [insOpen, setInsOpen] = useState(false);
  const openIns = (tab: InsTab) => { setInsTab(tab); setInsOpen(true); };
  const [phoneTab, setPhoneTab] = useState<PhoneTab>(id ? "steps" : "steps");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [denomPick, setDenomPick] = useState<string | null>(null);
  const [feedOpen, setFeedOpen] = useState<boolean | null>(null);
  const [speed, setSpeedState] = useState<Speed>(readSpeed);
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const [auto, setAuto] = useState(false);
  const autoRef = useRef(false);
  autoRef.current = auto;
  const [xray, setXray] = useState<XrayRequest | null>(null);
  const [xrayTab, setXrayTab] = useState<"xray" | "tx">("xray");
  const [txv, setTxv] = useState<TxView | null>(null);
  const [selSeq, setSelSeq] = useState<number | null>(null);
  const [fitKey, setFitKey] = useState(0);
  const [beams, setBeams] = useState<Record<string, number>>({});
  const [shudder, setShudder] = useState(0);

  const setSpeed = (s: Speed) => {
    setSpeedState(s);
    try {
      localStorage.setItem(SPEED_KEY, s);
    } catch {
      /* storage blocked */
    }
  };

  const live = st?.eco ?? null;
  const shown = st?.view ?? live;
  const viewSeq = st?.viewSeq ?? null;

  // ---- denomination
  const dvs = useMemo(() => (shown ? denomViews(shown) : []), [shown, st?.v]);
  const withNotes = dvs.filter((d) => d.notes > 0);
  const denom: DenomId = (withNotes.find((d) => d.id === denomPick) ?? withNotes.find((d) => d.id === "erg") ?? withNotes[0] ?? dvs[0])?.id ?? "erg";

  // ---- stage size and model
  const [stageRef, box] = useBox();
  const [legendRef, legendBox] = useBox();
  const W = Math.max(compact ? 300 : 620, box?.w ?? (compact ? 390 : 1100));
  // the circle is laid out above the legend (desktop) or between the cartouche row and the sheet's 120 px peek (phone)
  // a short stage (laptop) keeps one legend line under the circle; the full key opens from the cartouche
  const shortStage = !compact && (box?.h ?? 640) < 560;
  const legendH = view === "graph" && !compact ? (legendBox?.h ?? (shortStage ? 20 : 64)) + 18 : 0;
  // the town stands where it stands in the graph view in the table view too (it rode down by the legend's height)
  const townB = !compact ? (legendBox?.h ?? (shortStage ? 20 : 64)) + 18 : 0;
  const H = Math.max(compact ? 280 : 360, (box?.h ?? 640) - (compact ? PHONE_TOP + 120 : legendH));
  // what the circle keeps clear: each row of the cartouche (measured) and the zoom keys; a phone has its own top row
  const [cartRef, cartRows] = useRowBoxes();
  const keepOut = useMemo<Box4[] | undefined>(() => (compact || !cartRows ? undefined : [...cartRows, [W - 66, 0, W, 196]]), [compact, cartRows, W]);
  const model = useMemo(() => (shown ? buildStage(shown, denom, W, H, lang, keepOut) : null), [shown, st?.v, denom, W, H, lang, keepOut]);

  // ---- time machine data (from the live log)
  const lastSeq = live ? live.events.length - 1 : 0;
  const story = st?.mode === "scenario" || (st?.mode === "replay" && !!st?.scenario);
  const tm = useMemo(() => (live ? marksOf(live) : { marks: [], ticks: [] }), [live, st?.v]);
  const segs = useMemo(() => segmentsOf(st?.results ?? [], lastSeq, st?.steps.length ?? 0, !!story && (st?.results.length ?? 0) + (st?.steps.length ?? 0) > 0), [st?.results, st?.results.length, lastSeq, st?.steps.length, story, st?.v]);

  // ---- commits: the lighthouse beam and the shell pulse (live only, at most one per 1.4 s per tracker)
  const scanned = useRef<{ eco: Economy | null; n: number }>({ eco: null, n: 0 });
  const lastBeam = useRef<Record<string, number>>({});
  const lastPulse = useRef(0);
  useEffect(() => {
    if (!live) return;
    if (scanned.current.eco !== live) {
      scanned.current = { eco: live, n: live.events.length };
      return;
    }
    const from = scanned.current.n;
    const to = live.events.length;
    scanned.current.n = to;
    if (viewSeq !== null || to <= from) return;
    const now = performance.now();
    const latest = new Map<string, Extract<EconomyEvent, { type: "tracker.committed" }>>();
    for (let i = Math.max(from, to - 2000); i < to; i++) {
      const e = live.events[i];
      if (e.type === "tracker.committed") latest.set(e.tracker, e);
    }
    const bump: string[] = [];
    for (const [tr, e] of latest) {
      if (now - (lastBeam.current[tr] ?? -1e9) < 1400) continue;
      lastBeam.current[tr] = now;
      bump.push(tr);
      if (now - lastPulse.current >= 1400) {
        lastPulse.current = now;
        pulse.commit({ source: "sandbox", trackerId: tr, digest: e.digest, height: e.creationHeight });
      }
    }
    if (bump.length) setBeams((b) => Object.fromEntries([...Object.entries(b), ...bump.map((k) => [k, (b[k] ?? 0) + 1])]));
  }, [live, st?.v, viewSeq]);

  // shudder when the stage goes back in time
  const prevShown = useRef<number>(Infinity);
  useEffect(() => {
    const cur = viewSeq ?? Infinity;
    if (cur < prevShown.current) setShudder((n) => n + 1);
    prevShown.current = cur;
  }, [viewSeq]);

  // ---- X-ray and transactions
  const openRefusal = useCallback(
    (r: RunController, e: EconomyEvent) => {
      const rv = rebuildRefusal(r, e);
      if (!rv) return;
      setAuto(false);
      setXrayTab("xray");
      const words = reasonWords(rv.code, rv.message, lang);
      setXray({
        title: t("play.xray.title"),
        sub: rv.stage !== "contract" ? t("play.xray.before", { why: words }) : words,
        evaluation: rv.outcome ?? { ok: false, stage: rv.stage as "wallet" | "tracker" | "contract", code: rv.code, message: rv.message },
        focus: rv.focus,
        tx: rv.outcome?.tx ?? null,
        note: "rebuilt",
      });
    },
    [lang, t],
  );
  const openCheat = useCallback(
    (c: CheatResult) => {
      setAuto(false);
      setXrayTab("xray");
      const words = reasonWords(c.stage === "contract" && c.failed[0] ? c.failed[0] : c.code, c.message, lang);
      setXray({
        title: `${t("play.xray.title")} · ${t(`play.cheat.${c.id}.t`)}`,
        sub: c.stage !== "contract" ? t("play.xray.before", { why: words }) : words,
        evaluation: c.eval ? { ok: c.passed, stage: c.stage, code: c.code, message: c.message, eval: c.eval, tx: c.tx ?? undefined } : { ok: c.passed, stage: c.stage, code: c.code, message: c.message },
        focus: c.failed.length ? c.failed : [c.code],
        tx: c.tx,
        note: "copy",
      });
    },
    [lang, t],
  );

  const afterStep = useCallback(
    (r: RunController, res: StepResult) => {
      const evs = r.eventsOf(res);
      const ref = refusalsIn(evs)[0];
      const contractLevel = ref && ((ref.type === "redemption.rejected" && ref.stage === "contract") || ref.type === "action.rejected");
      if (!res.outcome.ok) {
        setAuto(false);
        if (ref) openRefusal(r, ref);
        else {
          const info = r.store.getState().steps[res.index];
          setXrayTab("xray");
          setXray({ title: t("play.rail.fail"), sub: res.outcome.detail, evaluation: null, focus: info?.focus ?? [], tx: null, note: "live" });
        }
      } else if (contractLevel && ref) {
        // an expected refusal: shown at once when stepping by hand; during auto-play a calm toast offers it instead
        if (!autoRef.current) openRefusal(r, ref);
        else toast({ kind: "info", title: t("play.rail.refusedToast"), action: { label: t("play.cheat.open"), onClick: () => openRefusal(r, ref) } });
      }
    },
    [openRefusal, t],
  );

  // ---- the player (reduced motion: a step lands in one frame instead of walking its blocks)
  const still = useReducedMotion();
  const stillRef = useRef(still);
  stillRef.current = still;
  const next = useCallback(async () => {
    const r = active;
    if (!r) return;
    const s = r.store.getState();
    if (s.busy || s.mode !== "scenario" || !s.continuable || s.index >= s.steps.length) return;
    if (s.viewSeq !== null) r.view(null);
    try {
      const res = await r.animate(stillRef.current ? { blockMs: 0, maxFrames: 1 } : { blockMs: SPEEDS[speedRef.current].blockMs, maxFrames: 40 });
      afterStep(r, res);
    } catch (e) {
      setAuto(false);
      toast({ kind: "info", title: t("play.player.busy"), detail: (e as Error).message });
    }
  }, [active, afterStep, t]);

  useEffect(() => {
    if (!auto || !st || !active) return;
    if (st.index >= st.steps.length || st.mode !== "scenario" || !st.continuable) {
      setAuto(false);
      return;
    }
    if (st.busy || xray) return;
    const h = setTimeout(() => void next(), SPEEDS[speed].pause);
    return () => clearTimeout(h);
  }, [auto, st?.busy, st?.index, st?.steps.length, xray, speed, active, next]);

  const toggleAuto = () => {
    if (auto) return setAuto(false);
    setAuto(true);
    if (st && !st.busy) void next();
  };

  const reset = () => {
    setAuto(false);
    setSel(null);
    setXray(null);
    setTxv(null);
    setSelSeq(null);
    setFork(null);
    setImported(null);
    setNonce((n) => n + 1);
    setFitKey((k) => k + 1);
  };

  const bounds = useMemo(() => {
    const rs = st?.results ?? [];
    if (!rs.length) return [] as number[];
    return [rs[0].fromSeq - 1, ...rs.map((r) => r.toSeq)].filter((b) => b >= 0);
  }, [st?.results, st?.results.length, st?.v]);
  const cur = viewSeq ?? lastSeq;
  const backTarget = bounds.filter((b) => b < cur).reduce((m, b) => Math.max(m, b), -1);
  const back = () => {
    if (!active || backTarget < 0) return;
    setAuto(false);
    active.view(backTarget);
  };

  const scrub = useCallback(
    (seq: number | null) => {
      if (!active) return;
      if (seq !== null) setAuto(false);
      try {
        active.view(seq);
      } catch {
        /* busy */
      }
    },
    [active],
  );

  // ---- fork
  const doFork = () => {
    if (!active || fork) return;
    const s = active.store.getState();
    const seq = s.viewSeq ?? s.eco.events.length - 1;
    try {
      const f = active.fork(seq);
      setAuto(false);
      active.view(null);
      setFork({ run: f, from: active, seq });
      toast({ kind: "info", title: t("play.tm.forked", { seq: int(seq) }), detail: t("play.free.fork") });
    } catch (e) {
      toast({ kind: "info", title: t("play.player.busy"), detail: (e as Error).message });
    }
  };
  const leaveFork = () => {
    if (!fork) return;
    fork.from.view(null);
    setFork(null);
  };
  const diff = useMemo(() => {
    if (!fork) return null;
    try {
      return TimeMachine.diff(fork.from.eco, fork.run.eco);
    } catch {
      return null;
    }
  }, [fork, st?.v]);

  // ---- feed selection: scrub to the line, open its transaction or its X-ray
  const onFeedSelect = (e: EconomyEvent) => {
    if (!active || !live) return;
    setSelSeq(e.seq);
    if (e.type === "tracker.committed") setSel({ kind: "tracker", id: e.tracker });
    if (ONCHAIN_TYPES.has(e.type)) {
      const tv = rebuildTx(active, live, e, synthCreateTx);
      if (tv) setTxv(tv);
      else toast({ kind: "info", title: t("play.tx.none") });
    } else if (REFUSAL_TYPES.has(e.type)) openRefusal(active, e);
    if (e.seq < lastSeq) scrub(e.seq);
  };

  // ---- actions from the inspector (free mode)
  const actApi: ActApi = useMemo(() => {
    const runIt = <T,>(fn: (eco: Economy) => T): T | null => {
      try {
        return active ? active.exec(fn) : null;
      } catch (e) {
        toast({ kind: "info", title: t("play.player.busy"), detail: (e as Error).message });
        return null;
      }
    };
    const refuse = (o: { code?: string; message?: string }) => toast({ kind: "info", title: t("play.free.refused", { why: reasonWords(o.code, o.message, lang) }) });
    return {
      redeem: (o) => {
        const out = runIt((eco) => eco.redeem({ ...o }));
        if (!out || !live) return;
        const u = denomInfoOf(live, o.denom);
        if (out.ok) toast({ kind: "metal", title: t("play.free.redeemed", { r: displayName(live, o.receiver, lang), i: displayName(live, o.issuer, lang), v: `${fmtAmt(out.amount ?? 0n, u.decimals)} ${u.symbol}` }) });
        else {
          refuse(out);
          if (out.stage === "contract" && out.eval) setXray({ title: t("play.xray.title"), evaluation: { ok: false, stage: "contract", code: out.code, message: out.message, eval: out.eval, tx: out.tx }, tx: out.tx ?? null, note: "live" });
        }
      },
      topUp: (o) => {
        const out = runIt((eco) => eco.topUp({ ...o, by: o.by ?? (live ? live.idOf(live.r(o.reserve).owner) : undefined) }));
        if (!out || !live) return;
        const u = denomInfoOf(live, live.r(o.reserve).denom);
        if (out.ok) toast({ kind: "metal", title: t("play.free.toppedUp", { v: `${fmtAmt(o.amount, u.decimals)} ${u.symbol}` }) });
        else refuse(out);
      },
      startExit: (reserve) => {
        const out = runIt((eco) => eco.initiateRefund({ reserve }));
        if (!out || !live) return;
        if (out.ok) toast({ kind: "metal", title: t("play.free.refundStarted", { h: int(live.clock.height) }) });
        else refuse(out);
      },
      completeExit: (reserve) => {
        const r0 = live?.reserves.get(reserve);
        const before = r0 ? r0.collateral() : 0n;
        const u = live && r0 ? denomInfoOf(live, r0.denom) : { symbol: "ERG", decimals: 9 };
        const out = runIt((eco) => eco.completeRefund({ reserve }));
        if (!out) return;
        if (out.ok) toast({ kind: "metal", title: t("play.free.refundDone", { v: `${fmtAmt(before, u.decimals)} ${u.symbol}` }) });
        else {
          refuse(out);
          if (out.eval) setXray({ title: t("play.xray.title"), evaluation: { ok: false, stage: "contract", code: out.code, message: out.message, eval: out.eval, tx: out.tx }, tx: out.tx ?? null, note: "live" });
        }
      },
    };
  }, [active, live, lang, t]);

  // ---- top bar actions
  const runSeed = st?.seed ?? seed ?? defaultSeed(id);
  const urlFor = (s: string | null) => {
    const path = id ? `/play/${id}` : "/play/free";
    return s && s !== defaultSeed(id) ? `${path}?seed=${encodeURIComponent(s)}` : path;
  };
  const share = async () => {
    const url = location.origin + urlFor(seed ?? null);
    try {
      await navigator.clipboard.writeText(url);
      toast({ kind: "up", title: t("play.top.shared"), detail: t("play.top.sharedDetail") });
    } catch {
      toast({ kind: "info", title: t("play.top.share"), detail: url, mono: true, ttl: 8000 });
    }
  };
  const exportLog = () => {
    if (!active) return;
    try {
      const json = active.exportJson({ indent: 0 });
      const blob = new Blob([json], { type: "application/json" });
      const a = document.createElement("a");
      const href = URL.createObjectURL(blob);
      a.href = href;
      // "basis-sandbox-cafe-on-credit.json"; a seed or a fork adds its own part ("…-fork-13"), never the id twice
      const base = st?.scenario?.id ?? st?.mode ?? "run";
      const rest = runSeed
        .split("/")
        .filter((x) => x && x !== "scenario" && x !== base)
        .join("-")
        .replace(/[^a-z0-9-]+/gi, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
      a.download = `basis-sandbox-${base}${rest ? "-" + rest : ""}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 4000);
      toast({ kind: "up", title: t("play.top.exported") });
    } catch (e) {
      toast({ kind: "info", title: t("play.top.exportFail"), detail: (e as Error).message });
    }
  };
  const fileRef = useRef<HTMLInputElement>(null);
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      const text = await f.text();
      const r = await importRun(text);
      setAuto(false);
      setSel(null);
      setFork(null);
      setImported(r);
      toast({ kind: "up", title: t("play.top.imported"), detail: r.store.getState().continuable ? t("play.top.importedLive") : t("play.top.importedReplay") });
    } catch (e) {
      const code = e instanceof RunImportError ? e.code : "bad-format";
      toast({ kind: "info", title: t("play.top.importFail"), detail: t(`play.top.import.${code}`) });
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };
  const goSeed = (s: string | null) => navigate(urlFor(s));

  // ---- keyboard: N plays the next step (the focused scrubber takes the arrows; Esc belongs to the kit's sheets).
  // The shell maps N to the Network page on `document`; listening in the capture phase on `window` runs first, and
  // the prevented default tells the shell to leave the key alone, so N never navigates away from a run.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (e.key !== "n" && e.key !== "N") return;
      // keys typed into a field or a dialog are theirs (a key sent to the document has no element)
      const tg = e.target instanceof Element ? e.target : null;
      if (tg && tg.closest("input, textarea, select, [contenteditable], [role=dialog]")) return;
      if (document.querySelector(".cmdk-wrap, .sheet-panel[aria-modal='true']")) return;
      // free mode and alternate histories have no steps: there N stays the shell's
      if (active?.store.getState().mode !== "scenario") return;
      e.preventDefault();
      void next();
    };
    window.addEventListener("keydown", on, true);
    return () => window.removeEventListener("keydown", on, true);
  }, [next, active]);

  const nameOf = useMemo(() => (live ? namerFor(live, lang) : (x: string) => x), [live, lang, st?.v]);
  const unitOf = useCallback((d: DenomId) => (live ? denomInfoOf(live, d) : { symbol: "ERG", decimals: 9 }), [live]);

  // The log's step markers carry the engine's English titles: the feed gets the page's own titles (EN or RU) instead.
  // The log only grows, so the copy grows with it in place, like eco.events (the feed's `version` says when).
  const feedCopy = useRef<{ src: readonly EconomyEvent[] | null; lang: string; out: EconomyEvent[] }>({ src: null, lang: "", out: [] });
  const feedEvents = useMemo(() => {
    const src = live?.events;
    if (!src) return [];
    const c = feedCopy.current;
    if (c.src !== src || c.lang !== lang || c.out.length > src.length) feedCopy.current = { src, lang, out: [] };
    const out = feedCopy.current.out;
    const sc = st?.scenario;
    for (let i = out.length; i < src.length; i++) {
      const e = src[i];
      const info = e.type === "scenario.step" && sc && e.scenario === sc.id ? st?.steps[e.index] : undefined;
      out.push(info && e.type === "scenario.step" ? { ...e, title: stepTitle(t, sc!.id, info) } : e);
    }
    return out;
  }, [live, st?.v, st?.scenario, st?.steps, lang, t]);

  // ---------------------------------------------------------------------------------------------
  if (error || st?.error) {
    return (
      <div className="pl-root" ref={rootRef} style={{ minHeight: height }}>
        <div className="pl-fallback">
          <ErrorState title={t("play.player.failed")} text={error ?? st?.error ?? ""} onRetry={reset} retryLabel={t("play.player.reset")} />
        </div>
      </div>
    );
  }
  if (!active || !st || !live || !shown || !model) {
    return (
      <div className="pl-root" ref={rootRef} style={{ height }}>
        <div className="pl-fallback">
          <Loading label={t("play.player.loading")} seed="play" />
        </div>
      </div>
    );
  }

  const scenario = st.scenario;
  const scId = scenario?.id ?? null;
  const steps: StepsState = { steps: st.steps, results: st.results, index: st.index, animating: st.animating, busy: st.busy, ok: st.ok, tampered: st.tampered, continuable: st.continuable, mode: st.mode };
  const free = !scenario || st.mode === "fork" || (st.mode === "replay" && !scenario);
  const toolsMode = st.mode === "free" || st.mode === "fork" || st.mode === "replay";
  const past = viewSeq !== null;
  const done = !!scenario && st.index >= st.steps.length;
  const canNext = !!scenario && st.mode === "scenario" && st.continuable && !done;
  const feedShown = feedOpen ?? tall;
  const title = scenario ? scTitle(t, scenario.id, scenario.title) : st.mode === "fork" ? t("play.top.fork") : t("play.free.title");
  // an alternate history says where it branched off: the story (or free world) it was forked from
  const forkOrigin = fork ? fork.from.store.getState().scenario : null;
  const forkOf = fork ? (forkOrigin ? scTitle(t, forkOrigin.id, forkOrigin.title) : t("play.free.title")) : undefined;

  const player = {
    story: !!scenario && st.mode === "scenario",
    canNext,
    animating: !!st.animating,
    busy: st.busy,
    done,
    auto,
    canBack: backTarget >= 0,
    speed,
    onNext: () => void next(),
    onSkip: () => active.skip(),
    onAuto: toggleAuto,
    onBack: back,
    onReset: reset,
    onSpeed: setSpeed,
  };

  const inspector = <Inspector eco={shown} run={active} sel={sel} onSelect={setSel} free={toolsMode} past={past} lang={lang} t={t} act={actApi} scenarioId={scId ?? (fork ? id : null)} denom={denom} />;
  const cheats = <Cheats eco={shown} t={t} lang={lang} free={toolsMode} version={`${active.seed}|${viewSeq ?? "live"}|${shown.events.length}`} onOpen={openCheat} />;
  const tools = toolsMode ? <FreeTools run={active} eco={live} t={t} lang={lang} past={past} onLive={() => scrub(null)} onFork={doFork} onXray={(x) => { setXrayTab("xray"); setXray(x); }} /> : null;
  const feed = (h: number) => (
    <EventFeed events={feedEvents} version={st.v} nameOf={nameOf} unitOf={unitOf} height={h} follow={!past} selectedSeq={selSeq ?? viewSeq} onSelect={onFeedSelect} title={t("play.feed.title")} className="pl-feed-panel" />
  );

  const fieldDim = model.trackers.some((x) => !x.online) ? 0.4 : 1;
  const legendBody = (
    <>
      <GraphLegend hatchId="pl-lg-h" />
      <span className="pl-legend-st">
        <span>
          <i className="g-local" aria-hidden="true" />
          {t("play.stage.status.local")}
        </span>
        <span>
          <i className="g-pending" aria-hidden="true" />
          {t("play.stage.status.pending")}
        </span>
        <span>
          <i className="g-confirmed" aria-hidden="true" />
          {t("play.stage.status.confirmed")}
        </span>
      </span>
    </>
  );

  const stage = (
    <div className={`pl-stage${past ? " past" : ""}${shudder ? ` sh${shudder % 2}` : ""}`} ref={stageRef} style={legendH || townB ? ({ ...(legendH ? { "--pl-leg": `${legendH}px` } : {}), ...(townB ? { "--pl-town-b": `${townB}px` } : {}) } as React.CSSProperties) : undefined}>
      <Skyline className={fieldDim < 1 ? "pl-town dim" : "pl-town"} seed={31} height={120} span={1600} lit={0.18} tower={1180} towerFilter={sandboxPulse} />
      {view === "graph" ? (
        model.nodes.length === 0 ? (
          <div className="pl-empty">
            <Empty title={t(toolsMode ? "play.stage.emptyFree" : "play.stage.empty")} />
          </div>
        ) : (
          <StageGraph model={model} selected={sel} onSelect={(s) => { setSel(s); if (s && compact) { setPhoneTab("inspect"); } if (s) { setInsTab("inspect"); setInsOpen(true); } }} beams={past ? {} : beams} t={t} phone={phone} fitKey={fitKey} />
        )
      ) : (
        <div className="pl-tablewrap">
          <StageTable model={model} selected={sel} onSelect={(s) => { setSel(s); setInsTab("inspect"); setInsOpen(true); }} t={t} />
        </div>
      )}
      {view === "graph" && !compact && (
        // the stage keeps only the Σ line below; the key to its marks opens from «?» under the zoom keys
        <div className="pl-keyfloat">
          <Popover
            align="end"
            trigger={(tp) => (
              <button type="button" className="key sm icon-only pl-qmark" {...tp} aria-label={t("play.stage.key")} title={t("play.stage.key")}>
                <span aria-hidden="true">?</span>
              </button>
            )}
          >
            <div className="pl-pop pl-legend-pop">
              <span className="label">{t("play.stage.key")}</span>
              {legendBody}
            </div>
          </Popover>
        </div>
      )}
      <Cartouche boxRef={cartRef} t={t} compact={compact} sandLine={pick(copy.sandboxNothingReal, lang)} model={model} eco={shown} past={past} view={view} setView={(v) => startTransition(() => setView(v))} denoms={withNotes.length > 1 ? withNotes.map((d) => ({ value: d.id, label: d.symbol })) : null} denom={denom} setDenom={setDenomPick} />
      {view === "graph" && !compact && (
        <div className="pl-legend" ref={legendRef}>
          <span className="pl-legend-sum mono">
            {t("play.stage.sumNet", { v: fmtAmt(model.netSum, model.decimals) })}
            {model.netted ? ` · ${t("play.stage.netted")}` : ""}
            {model.hidden > 0 ? ` · ${t("play.stage.more", { n: int(model.hidden) })}` : ""}
          </span>
        </div>
      )}
    </div>
  );

  const topBar = (
    <TopBar
      t={t}
      lang={lang}
      id={scId}
      title={title}
      seed={runSeed}
      mode={st.mode}
      avl={st.avl}
      compact={compact}
      forkInfo={fork ? { seq: fork.seq, diff, of: forkOf ?? "" } : null}
      onLeaveFork={leaveFork}
      onSeed={goSeed}
      onShare={share}
      onExport={exportLog}
      onImport={() => fileRef.current?.click()}
      seedQuery={seed ? `?seed=${encodeURIComponent(seed)}` : ""}
    />
  );

  const timeBar = (
    <TimeBar
      t={t}
      segs={segs}
      marks={tm.marks}
      ticks={tm.ticks}
      lastSeq={lastSeq}
      viewSeq={viewSeq}
      viewHeight={shown.clock.height}
      liveHeight={live.clock.height}
      forked={!!fork}
      onScrub={scrub}
      onFork={doFork}
      onLive={() => scrub(null)}
      onLeaveFork={leaveFork}
      player={player}
      compact={compact}
    />
  );

  const xraySheet = (
    <Sheet open={!!xray} onClose={() => setXray(null)} title={xray?.title ?? ""} sub={xray?.sub} width={780} ariaLabel={t("play.xray.title")}>
      {xray && (
        <div className="pl-xray">
          <p className="t-small dim">{xray.note === "copy" ? t("play.xray.copy") : xray.note === "rebuilt" ? t("play.xray.rebuilt") : t("play.xray.live")}</p>
          {xray.tx && (
            <Tabs<"xray" | "tx">
              value={xrayTab}
              onChange={setXrayTab}
              ariaLabel={t("play.xray.title")}
              tabs={[
                { id: "xray", label: t("play.xray.showXray") },
                { id: "tx", label: t("play.xray.showTx") },
              ]}
            />
          )}
          {xrayTab === "tx" && xray.tx ? (
            <TxLens tx={xray.tx} evaluation={evalOf(xray.evaluation)} nameOf={(x) => nameOf(x)} unit={unitOf(denom)} />
          ) : (
            <ContractXray evaluation={xray.evaluation} focus={xray.focus} mode="full" animate />
          )}
          <p className="t-small dim">{pick(copy.fee, lang)}</p>
        </div>
      )}
    </Sheet>
  );

  const txSheet = (
    <Sheet open={!!txv} onClose={() => setTxv(null)} title={t("play.tx.title")} sub={txv ? (txv.synthesized ? t("play.tx.synth") : txv.matches ? t("play.tx.rebuilt") : t("play.tx.rebuiltDiffers")) : undefined} width={780}>
      {txv && <TxLens tx={txv.tx} evaluation={txv.evaluation} event={txv.event} nameOf={(x) => nameOf(x)} unit={unitOf("denom" in txv.event ? (txv.event.denom as DenomId) : "erg")} synthesized={txv.synthesized} />}
    </Sheet>
  );

  const hidden = (
    <input
      ref={fileRef}
      type="file"
      accept="application/json,.json"
      className="sr-only"
      tabIndex={-1}
      aria-hidden="true"
      onChange={(e) => void onFile(e.target.files?.[0])}
    />
  );

  if (compact) {
    const tabs: Array<{ id: PhoneTab; label: string }> = [
      { id: "steps", label: toolsMode ? t("play.ins.tab.tools") : t("play.ins.tab.steps") },
      { id: "inspect", label: t("play.ins.tab.inspect") },
      { id: "cheat", label: t("play.phone.tab.cheat") },
      { id: "log", label: t("play.ins.tab.log") },
    ];
    return (
      <div className="pl-root compact" ref={rootRef} style={{ height }}>
        <h1 className="sr-only">
          {t("play.title")}: {title}
        </h1>
        {topBar}
        <div className="pl-phone">
          {stage}
          <PhoneSheet open={sheetOpen} setOpen={setSheetOpen} t={t} label={tabs.find((x) => x.id === phoneTab)?.label ?? ""}>
            {sheetOpen ? (
              <>
                <Tabs<PhoneTab> value={phoneTab} onChange={setPhoneTab} tabs={tabs} block ariaLabel={t("play.ins.tabs")} idBase="pl-ph" />
                <div className="pl-sheet-body" role="tabpanel" id={`pl-ph-panel-${phoneTab}`} aria-labelledby={`pl-ph-tab-${phoneTab}`}>
                  {phoneTab === "steps" ? (
                    toolsMode ? (
                      tools
                    ) : (
                      <Rail run={active} scenario={scenario} forkOf={forkOf} st={steps} t={t} version={st.v} viewSeq={viewSeq} onViewStep={(r) => scrub(r.toSeq >= lastSeq ? null : r.toSeq)} onXray={(e) => openRefusal(active, e)} />
                    )
                  ) : phoneTab === "inspect" ? (
                    inspector
                  ) : phoneTab === "cheat" ? (
                    cheats
                  ) : (
                    feed(320)
                  )}
                </div>
              </>
            ) : sel ? (
              <button type="button" className="pl-peek-sel" onClick={() => { setPhoneTab("inspect"); setSheetOpen(true); }}>
                <span className="label">{t("play.ins.tab.inspect")}</span>
                <b>{selLabel(sel, shown, lang)}</b>
              </button>
            ) : scenario && !toolsMode ? (
              <StepCards run={active} scenario={scenario} st={steps} t={t} version={st.v} onViewStep={(r) => scrub(r.toSeq >= lastSeq ? null : r.toSeq)} onXray={(e) => openRefusal(active, e)} />
            ) : (
              <button type="button" className="pl-peek-sel" onClick={() => { setPhoneTab("steps"); setSheetOpen(true); }}>
                <span className="label">{t("play.free.title")}</span>
                <b>{t("play.free.lede")}</b>
              </button>
            )}
          </PhoneSheet>
        </div>
        {timeBar}
        {xraySheet}
        {txSheet}
        {hidden}
      </div>
    );
  }

  return (
    <div className="pl-root" ref={rootRef} style={{ height }}>
      <h1 className="sr-only">
        {t("play.title")}: {title}
      </h1>
      {topBar}
      <div className={`pl-main${insOpen ? "" : " ins-closed"}`}>
        <aside className="pl-rail" aria-label={toolsMode ? t("play.free.title") : t("play.rail.steps")}>
          <Rail run={active} scenario={scenario} forkOf={forkOf} st={steps} t={t} version={st.v} viewSeq={viewSeq} onViewStep={(r) => scrub(r.toSeq >= lastSeq ? null : r.toSeq)} onXray={(e) => openRefusal(active, e)}>
            {tools}
          </Rail>
        </aside>
        <div className="pl-center">
          {stage}
          <div className={`pl-dock${feedShown ? " open" : ""}`}>
            <button type="button" className="pl-dock-k" aria-expanded={feedShown} onClick={() => setFeedOpen(!feedShown)}>
              <Icon name={feedShown ? "down" : "right"} />
              <span>{feedShown ? t("play.feed.hide") : t("play.feed.show")}</span>
              <span className="dim mono">{int(live.events.length)}</span>
              <span className="pl-dock-hint t-small dim">{t("play.feed.hint")}</span>
            </button>
            {feedShown && feed(150)}
          </div>
        </div>
        {insOpen ? (
          <aside className="pl-ins" aria-label={t("play.ins.tabs")}>
            <div className="pl-ins-tabs">
              <Tabs<InsTab>
                value={insTab}
                onChange={setInsTab}
                block
                ariaLabel={t("play.ins.tabs")}
                idBase="pl-ins"
                tabs={[
                  { id: "inspect", label: t("play.ins.tab.inspect") },
                  { id: "cheat", label: t("play.ins.tab.cheat") },
                ]}
              />
              <button type="button" className="key sm icon-only quiet pl-ins-x" onClick={() => { setInsOpen(false); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".pl-ins-handle button")?.focus()); }} aria-label={t("play.ins.hide")} title={t("play.ins.hide")}>
                <Icon name="close" />
              </button>
            </div>
            <div className="pl-ins-scroll" role="tabpanel" id={`pl-ins-panel-${insTab}`} aria-labelledby={`pl-ins-tab-${insTab}`}>
              {insTab === "inspect" ? inspector : cheats}
            </div>
          </aside>
        ) : (
          // the closed drawer: two handles at the right edge open it on either tab
          <aside className="pl-ins-handle" aria-label={t("play.ins.tabs")}>
            <button type="button" onClick={() => openIns("inspect")} aria-expanded={false}>
              <Icon name="search" />
              <span>{t("play.ins.tab.inspect")}</span>
            </button>
            <button type="button" onClick={() => openIns("cheat")} aria-expanded={false}>
              <Icon name="warn" />
              <span>{t("play.ins.tab.cheat")}</span>
            </button>
          </aside>
        )}
      </div>
      {timeBar}
      {xraySheet}
      {txSheet}
      {hidden}
    </div>
  );
}

function evalOf(e: XrayRequest["evaluation"]) {
  if (!e) return null;
  if ("checks" in e) return e;
  return e.eval ?? null;
}

function selLabel(sel: Sel, eco: Economy, lang: Lang): string {
  try {
    if (sel.kind === "participant") return displayName(eco, sel.id, lang);
    if (sel.kind === "note") return `${displayName(eco, sel.from, lang)} → ${displayName(eco, sel.to, lang)}`;
    if (sel.kind === "reserve") return displayName(eco, eco.idOf(eco.r(sel.id).owner) ?? "", lang);
    return displayName(eco, sel.id, lang);
  } catch {
    return "";
  }
}

// ------------------------------------------------------------------------------------------------
// top bar
// ------------------------------------------------------------------------------------------------

function TopBar(p: {
  t: TFn;
  lang: Lang;
  id: ScenarioId | null;
  title: string;
  seed: string;
  mode: RunState["mode"];
  avl: RunState["avl"];
  compact: boolean;
  /** An alternate history: where it branched off (event and origin title) and how it differs from the original. */
  forkInfo: { seq: number; diff: ReturnType<typeof TimeMachine.diff> | null; of: string } | null;
  onLeaveFork: () => void;
  onSeed: (s: string | null) => void;
  onShare: () => void;
  onExport: () => void;
  onImport: () => void;
  seedQuery: string;
}) {
  const { t, lang } = p;
  const [draft, setDraft] = useState(p.seed);
  useEffect(() => setDraft(p.seed), [p.seed]);
  const randomSeed = () => {
    const a = new Uint8Array(4);
    crypto.getRandomValues(a);
    return `seed-${[...a].map((x) => x.toString(36).padStart(2, "0")).join("").slice(0, 7)}`;
  };
  const d = p.forkInfo?.diff;
  const diffParts = d
    ? [d.notes.length ? t.p("play.tm.dNotes", d.notes.length) : "", d.reserves.length ? t.p("play.tm.dReserves", d.reserves.length) : "", d.wallets.length ? t.p("play.tm.dWallets", d.wallets.length) : ""].filter(Boolean)
    : [];
  const diffText = d ? (diffParts.length === 0 ? t("play.tm.same") : t("play.tm.diff", { list: diffParts.join(" · ") })) : "";
  return (
    <div className="pl-top">
      <span className="pl-sandbox" title={pick(copy.sandboxNothingReal, lang)}>
        <span className="pl-sandbox-dot" aria-hidden="true" />
        {p.compact ? (
          <>
            <span aria-hidden="true">{pick(copy.sandbox, lang)}</span>
            <span className="sr-only">{pick(copy.sandboxNothingReal, lang)}</span>
          </>
        ) : (
          pick(copy.sandboxNothingReal, lang)
        )}
      </span>
      <Popover
        trigger={(tp) => (
          <button type="button" className="pl-pick" {...tp} aria-label={`${t("play.top.pick")}: ${p.title}`}>
            <span className="pl-pick-t">{p.title}</span>
            <Icon name="down" />
          </button>
        )}
      >
        <div className="pl-pop">
          <span className="label">{t("play.top.scenarios")}</span>
          <ScenarioList current={p.id} t={t} />
          <Link to="/play/free" className={`pl-sc free${p.id === null ? " on" : ""}`}>
            <span className="pl-sc-t">{t("play.top.free")}</span>
            <span className="pl-sc-tag">{t("play.sc.free.tag")}</span>
          </Link>
        </div>
      </Popover>
      {p.mode === "replay" && <Tag tone="watch">{t("play.top.replay")}</Tag>}
      {p.forkInfo && (
        <span className="pl-forkinfo">
          <Tag tone="agent">{t("play.tm.forkOf", { title: p.forkInfo.of, seq: int(p.forkInfo.seq) })}</Tag>
          {!p.compact && (
            <span className="t-small" title={diffText}>
              {diffText}
            </span>
          )}
        </span>
      )}
      <span className="pl-top-gap" />
      {/* a simulated tree is a caveat about the digests, so it stays in sight; the rest are tools for people who dig */}
      {!p.compact && !p.forkInfo && p.avl?.simulated && (
        <span className="pl-avl mono sim" title={t("play.top.avl.simHelp")}>
          {t("play.top.avl.sim")}
        </span>
      )}
      <Popover
        align="end"
        trigger={(tp) => (
          <button type="button" className="key sm icon-only quiet pl-more" {...tp} aria-label={t("play.top.more")} title={t("play.top.more")}>
            <Icon name="more" />
          </button>
        )}
      >
        <div className="pl-pop pl-menu pl-tools">
          <button type="button" className="pl-menu-i" onClick={p.onShare}>
            <Icon name="copy" />
            {t("play.top.share")}
          </button>
          <button type="button" className="pl-menu-i" onClick={p.onExport}>
            <Icon name="down" />
            {t("play.top.export")}
          </button>
          <button type="button" className="pl-menu-i" onClick={p.onImport}>
            <Icon name="in" />
            {t("play.top.import")}
          </button>
          <hr className="pl-menu-sep" />
          <label className="pl-f">
            <span className="pl-f-l">{t("play.top.seed")}</span>
            <input className="pl-txt mono" value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 80))} onKeyDown={(e) => e.key === "Enter" && p.onSeed(draft.trim() || null)} />
          </label>
          <p className="t-small dim">{t("play.top.seedHelp")}</p>
          <div className="pl-acts">
            <button type="button" className="key sm primary" onClick={() => p.onSeed(draft.trim() || null)}>
              {t("play.top.applySeed")}
            </button>
            <button type="button" className="key sm" onClick={() => p.onSeed(randomSeed())}>
              {t("play.top.newSeed")}
            </button>
          </div>
          {p.avl && (
            <p className="t-small dim">
              {p.avl.simulated ? `${t("play.top.avl.sim")}: ${t("play.top.avl.simHelp")}` : t("play.top.avl.wasm")}
            </p>
          )}
        </div>
      </Popover>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// stage cartouche (block, circle, denomination, graph / table)
// ------------------------------------------------------------------------------------------------

function Cartouche({
  boxRef,
  t,
  compact,
  sandLine,
  model,
  eco,
  past,
  view,
  setView,
  denoms,
  denom,
  setDenom,
}: {
  boxRef: (el: HTMLElement | null) => void;
  t: TFn;
  compact: boolean;
  sandLine: string;
  model: ReturnType<typeof buildStage>;
  eco: Economy;
  past: boolean;
  view: View;
  setView: (v: View) => void;
  denoms: Array<{ value: string; label: string }> | null;
  denom: string;
  setDenom: (d: string) => void;
}) {
  const people = model.nodes.length;
  const trackers = model.trackers.map((x) => x.name);
  return (
    <div className="pl-cart" ref={boxRef}>
      <div className="pl-cart-b">
        <span className="label">{past ? t("play.stage.pastL") : t("play.stage.block")}</span>
        <Odometer value={eco.clock.height} dp={0} allowBack reveal className="pl-odo" />
      </div>
      {compact && <p className="pl-cart-sand t-small">{sandLine}</p>}
      <p className="pl-cart-sub t-small">
        {t("play.stage.circleSub", {
          people: t.p("play.stage.people", people),
          notes: t.p("play.stage.notes", model.notes, { n: int(model.notes) }),
          // "tracker Sandbox tracker" says it twice: a name that already says what it is stands alone
          trackers: trackers.length === 1 && /tracker|трекер/i.test(trackers[0]) ? trackers[0] : t.p("play.stage.trackers", trackers.length, { names: trackers.join(", ") }),
        })}
      </p>
      <div className="pl-cart-k">
        <Seg<View>
          value={view}
          onChange={setView}
          ariaLabel={t("play.stage.view")}
          options={[
            { value: "graph", label: t("play.stage.graph") },
            { value: "table", label: t("play.stage.table") },
          ]}
        />
        {denoms && <Seg<string> value={denom} onChange={setDenom} ariaLabel={t("play.stage.denom")} mono options={denoms} />}
      </div>
      <span className="sr-only" aria-live="polite">
        {past ? t("play.stage.past", { h: int(eco.clock.height) }) : ""}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// phone bottom sheet (120 px peek; drag or tap the handle)
// ------------------------------------------------------------------------------------------------

function PhoneSheet({ open, setOpen, t, label, children }: { open: boolean; setOpen: (v: boolean) => void; t: TFn; label: string; children: ReactNode }) {
  const start = useRef<number | null>(null);
  const moved = useRef(false);
  return (
    <section className={`pl-sheet${open ? " open" : ""}`} aria-label={label}>
      <button
        type="button"
        className="pl-grab"
        aria-expanded={open}
        aria-label={open ? t("play.ins.collapse") : t("play.ins.expand")}
        onPointerDown={(e) => {
          start.current = e.clientY;
          moved.current = false;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current === null) return;
          const dy = e.clientY - start.current;
          if (Math.abs(dy) > 24) {
            moved.current = true;
            if (dy < 0 && !open) setOpen(true);
            if (dy > 0 && open) setOpen(false);
            start.current = e.clientY;
          }
        }}
        onPointerUp={() => {
          start.current = null;
        }}
        onClick={() => {
          if (moved.current) {
            moved.current = false;
            return;
          }
          setOpen(!open);
        }}
      >
        <span className="pl-grab-bar" aria-hidden="true" />
      </button>
      <div className="pl-sheet-in">{children}</div>
    </section>
  );
}
