// /lab/viz — every src/viz component on live sandbox data (VIZ_API.md): the contract X-ray with an honest and a
// cheating redemption, signatures, transactions, AVL+ proofs and trees, a live story with the feed and the clocks, the
// feed at 10 000 events, and the tools.

import { useEffect, useMemo, useRef, useState } from "react";
import { LangSeg, ThemeSeg } from "@/app/chrome";
import { rich, useT } from "@/app/lang";
import { Page, PageHead, Section } from "@/ui";
import { getAvlBackend, REFUND_PERIOD_BLOCKS, type AvlBackend, type EconomyEvent, type ReserveEval, type SimTx } from "@/protocol";
import {
  AvlProofViewer,
  AvlTreeView,
  ContractXray,
  DebtKeyTool,
  EventFeed,
  ExitClocks,
  ladderFromEconomy,
  MessageBuilder,
  NoteVerifyTool,
  SelfTest,
  SignatureXray,
  SignLab,
  StatusLadder,
  synthCreateTx,
  TemplateHashTool,
  TxLens,
} from "@/viz";
import { Btn, Seg, Tag } from "@/viz/core/primitives";
import { buildShowcase, namer, newEconomy, STORY, type Showcase } from "./demo";
import "./vizlab.css";

type Loaded = { backend: AvlBackend; show: Showcase } | { error: string };

function useShowcase(): Loaded | null {
  const [state, setState] = useState<Loaded | null>(null);
  useEffect(() => {
    let live = true;
    (async () => {
      let backend: AvlBackend;
      try {
        backend = await (await import("@/protocol/avl-wasm")).loadErgoAvlBackend();
      } catch {
        backend = getAvlBackend();
      }
      try {
        const show = buildShowcase(backend);
        if (live) setState({ backend, show });
      } catch (e) {
        if (live) setState({ error: (e as Error).message });
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  return state;
}

/** Tracker / reserve tree keys → "Alice → Bob". */
function pairNamer(show: Showcase["eco"]): (keyHex: string) => string | undefined {
  const name = namer(show);
  const m = new Map<string, string>();
  for (const t of show.trackers.values())
    for (const rec of t.notes.values()) {
      const label = `${name(rec.issuer)} → ${name(rec.receiver)}`;
      m.set(rec.key, label);
      m.set(rec.reserveKey, label);
    }
  return (k) => m.get(k);
}

function XraySection({ show }: { show: Showcase }) {
  const t = useT();
  const [pick, setPick] = useState<"cheat" | "honest" | "topup" | "refund">("cheat");
  const ev = pick === "cheat" ? show.cheat : pick === "honest" ? show.honest : pick === "topup" ? show.topUp : show.refund;
  return (
    <div className="vl-stack">
      <div className="vl-bar">
        <Seg
          label={t("vizlab.s1.pick")}
          value={pick}
          onChange={setPick}
          options={[
            { value: "cheat", label: t("vizlab.s1.cheat") },
            { value: "honest", label: t("vizlab.s1.honest") },
            { value: "topup", label: t("vizlab.s1.topup") },
            { value: "refund", label: t("vizlab.s1.refund") },
          ]}
        />
      </div>
      <ContractXray key={pick} evaluation={ev} mode="compact" />
    </div>
  );
}

function TxSection({ show }: { show: Showcase }) {
  const t = useT();
  const nameOf = useMemo(() => namer(show.eco), [show]);
  const createTx = useMemo(() => synthCreateTx(show.eco.r("alice-res")), [show]);
  type K = { value: string; tx?: SimTx; ev?: ReserveEval | null; event?: EconomyEvent | null; synth?: boolean };
  const all: K[] = [
    { value: "redeem", tx: show.honest.tx, ev: show.honest.eval, event: show.honest.event },
    { value: "cheat", tx: show.cheat.tx, ev: show.cheat.eval, event: show.cheat.event },
    { value: "create", tx: createTx, ev: null, event: show.create.event, synth: true },
    { value: "topup", tx: show.topUp.tx, ev: show.topUp.eval, event: show.topUp.event },
    { value: "refund", tx: show.refund.tx, ev: show.refund.eval, event: show.refund.event },
    { value: "clearing", tx: show.clearing?.tx, ev: show.clearing?.evals?.[0] ?? null, event: show.clearing?.events.find((e) => e.type === "clearing.settled") ?? null },
  ];
  const kinds = all.filter((k): k is K & { tx: SimTx } => !!k.tx);
  const [kind, setKind] = useState(kinds[0]?.value ?? "redeem");
  const cur = kinds.find((k) => k.value === kind) ?? kinds[0];
  if (!cur) return null;
  return (
    <div className="vl-stack">
      <div className="vl-bar">
        <Seg label={t("vizlab.s1.pick")} value={kind} onChange={setKind} options={kinds.map((k) => ({ value: k.value, label: t(`vizlab.s3.kind.${k.value}`) }))} />
      </div>
      <TxLens key={kind} tx={cur.tx} evaluation={cur.ev ?? null} event={cur.event ?? null} nameOf={nameOf} synthesized={!!cur.synth} />
    </div>
  );
}

function AvlSection({ show }: { show: Showcase }) {
  const t = useT();
  const keyName = useMemo(() => pairNamer(show.eco), [show]);
  return (
    <div className="vl-stack">
      {show.proof ? <AvlProofViewer digest={show.proof.digest} proof={show.proof.proof} lookupKey={show.proof.key} keyLabel={t("vizlab.s4.pair", { a: "Alice", b: "Bob" })} backend={show.backend} valueKind="tracker" /> : null}
      <div className="vl-two">
        <AvlTreeView map={show.eco.t("t1").map} title={t("vizlab.s4.trackerTree")} valueKind="tracker" keyName={keyName} committed />
        <AvlTreeView map={show.eco.r("alice-res").tree} title={t("vizlab.s4.reserveTree")} valueKind="reserve" keyName={keyName} committed />
      </div>
    </div>
  );
}

function StorySection({ backend }: { backend: AvlBackend }) {
  const t = useT();
  const ecoRef = useRef<ReturnType<typeof newEconomy> | null>(null);
  if (!ecoRef.current) ecoRef.current = newEconomy(backend);
  const [step, setStep] = useState(0);
  const [run, setRun] = useState(0);
  const [, setVer] = useState(0);
  const eco = ecoRef.current;
  const nameOf = useMemo(() => namer(eco), [eco]);
  const keyName = pairNamer(eco);
  const rec = eco.note("alice", "bob");
  const tracker = eco.t("t1");
  const res = eco.reserves.get("alice-res");
  const unlock = res?.refundUnlockHeight() ?? null;
  const next = () => {
    if (step >= STORY.length) return;
    STORY[step].run(eco);
    setStep(step + 1);
    setVer((v) => v + 1);
  };
  const reset = () => {
    ecoRef.current = newEconomy(backend);
    setStep(0);
    setRun((r) => r + 1);
  };
  return (
    <div className="vl-stack">
      <div className="vl-bar">
        {step < STORY.length ? (
          <Btn kind="primary" onClick={next}>
            {t("vizlab.s5.next", { step: t(`vizlab.step.${STORY[step].id}`) })}
          </Btn>
        ) : (
          <span className="vl-note">{t("vizlab.s5.done")}</span>
        )}
        <Btn kind="quiet" onClick={reset} disabled={step === 0}>
          {t("vizlab.s5.reset")}
        </Btn>
        <span className="vl-note">{t("vizlab.s5.stepOf", { n: step, total: STORY.length })}</span>
      </div>
      <div className="vl-two">
        <EventFeed key={`story-${run}`} events={eco.events} version={eco.events.length} nameOf={nameOf} height={420} />
        <div className="vl-stack">
          {rec ? <StatusLadder {...ladderFromEconomy(eco, rec)} /> : <p className="vl-note">{t("vizlab.s5.noNote")}</p>}
          <ExitClocks height={eco.clock.height} boxCreationHeight={tracker.currentBox()?.creationHeight ?? null} r7={unlock !== null ? unlock - REFUND_PERIOD_BLOCKS : null} />
        </div>
      </div>
      <AvlTreeView key={`tree-${run}`} map={tracker.map} version={eco.events.length} title={t("vizlab.s4.trackerTree")} valueKind="tracker" keyName={keyName} committed={!!tracker.currentBox()} />
    </div>
  );
}

function bigLog(events: readonly EconomyEvent[], n: number): EconomyEvent[] {
  const out: EconomyEvent[] = [];
  if (!events.length) return out;
  const span = Math.max(1, events[events.length - 1].height - events[0].height + 1);
  for (let i = 0; i < n; i++) {
    const e = events[i % events.length];
    const lap = Math.floor(i / events.length);
    out.push({ ...e, seq: i, height: e.height + lap * span, timeMs: e.timeMs + BigInt(lap * span * 120_000) } as EconomyEvent);
  }
  return out;
}

function ScaleSection({ show }: { show: Showcase }) {
  const t = useT();
  const [big, setBig] = useState(false);
  const nameOf = useMemo(() => namer(show.eco), [show]);
  const events = useMemo(() => (big ? bigLog(show.events, 10_000) : show.events), [big, show]);
  return (
    <div className="vl-stack">
      <div className="vl-bar">
        <Btn onClick={() => setBig(!big)} pressed={big}>
          {big ? t("vizlab.s6.hide") : t("vizlab.s6.load")}
        </Btn>
      </div>
      <EventFeed key={big ? "big" : "small"} events={events} nameOf={nameOf} height={480} />
    </div>
  );
}

export default function VizLabPage() {
  const t = useT();
  const loaded = useShowcase();
  const ready = loaded && "show" in loaded ? loaded : null;
  return (
    <Page className="vizlab">
      <PageHead
        eyebrow={t("vizlab.eyebrow")}
        title={rich(t("vizlab.h1"))}
        lede={t("vizlab.lede")}
        actions={
          <div className="vl-actions">
            <ThemeSeg />
            <LangSeg />
          </div>
        }
      />
      <div className="vl-meta">
        <Tag tone="agent">{t("viz.sandbox")}</Tag>
        {ready ? <Tag tone={ready.backend.simulated ? "agent" : "plain"}>{t("vizlab.backend", { b: ready.backend.simulated ? t("viz.backend.simulated") : t("viz.backend.wasm") })}</Tag> : null}
        <span className="vl-note">{t("vizlab.sandbox")}</span>
      </div>
      {!loaded ? <p className="vl-note">{t("vizlab.loading")}</p> : null}
      {loaded && "error" in loaded ? <p className="vl-note err">{loaded.error}</p> : null}
      {ready ? (
        <>
          <Section no="01" title={t("vizlab.s1.title")} lede={t("vizlab.s1.lede")} id="xray">
            <XraySection show={ready.show} />
          </Section>
          <Section no="02" title={t("vizlab.s2.title")} lede={t("vizlab.s2.lede")} id="signature">
            <div className="vl-stack">
              <SignatureXray xray={ready.show.eco.xray(ready.show.record)} signer="issuer" />
              <SignLab />
              <SelfTest />
            </div>
          </Section>
          <Section no="03" title={t("vizlab.s3.title")} lede={t("vizlab.s3.lede")} id="tx">
            <TxSection show={ready.show} />
          </Section>
          <Section no="04" title={t("vizlab.s4.title")} lede={t("vizlab.s4.lede")} id="avl">
            <AvlSection show={ready.show} />
          </Section>
          <Section no="05" title={t("vizlab.s5.title")} lede={t("vizlab.s5.lede")} id="story">
            <StorySection backend={ready.backend} />
          </Section>
          <Section no="06" title={t("vizlab.s6.title")} lede={t("vizlab.s6.lede")} id="scale">
            <ScaleSection show={ready.show} />
          </Section>
          <Section no="07" title={t("vizlab.s7.title")} lede={t("vizlab.s7.lede")} id="tools">
            <div className="vl-stack">
              <div className="vl-two">
                <DebtKeyTool />
                <MessageBuilder />
              </div>
              <NoteVerifyTool />
              <TemplateHashTool />
            </div>
          </Section>
        </>
      ) : null}
    </Page>
  );
}
