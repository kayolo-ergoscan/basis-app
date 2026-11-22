// Kit sections 07–14: reserve and tracker, the debt graph, policy and the command bar, toasts, states, the machine
// face, layout primitives, and VISUAL §16.
import { useMemo, useState } from "react";
import { openCommandBar } from "@/app/commands";
import { rich, useLang, useT } from "@/app/lang";
import {
  BacksBar, Bytes, CapBar, Card, Cluster, Coin, Col, Grid, CommandBar, CoverageMeter, CoverageTag, Dial, Empty, EclipseCard, Engraving, ErrorState,
  Faces, FaceTabs, Graph, Heartbeat, Key, Lamp, Loading, MiniCap, PolicySentence, ReserveCard, Section, Sheet, Spread, Stack, Tag, Toast,
  TrackerCard, be, money, short, toast, trackerBand, useLens, type GraphNode, type PolicyPill, type ToastKind,
} from "@/ui";
import { NEVER } from "./copy";
import { DIGEST, GRAPH_EDGES, GRAPH_LOOPS, GRAPH_NODES, KEY_AB, NOTE_AB, PK, SIGS_AB, TRACKER_NFT, bigTown } from "./data";
import { firePulse } from "./pulse";
import { Cap, Spec } from "./Spec";

/* ---------------- 07 · reserve and tracker ---------------- */

export function ReserveSection() {
  const t = useT();
  return (
    <Section id="reserve" no={`07 · ${t("kit.s.reserve")}`} title={rich(t("kit.s.reserve.t"))} lede={t("kit.s.reserve.l")}>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <Spec tag="<ReserveCard>" name={t("kit.rc")} note={t("kit.rc.n")} code={'<ReserveCard owner="Alice" pk={pk} boxes={3} coverage={132} locked={3400} outstanding={2575.76} backs={[…]} tokens={[…]} />'}>
          <ReserveCard owner="Alice" pk={PK.Alice} boxes={3} coverage={132} locked={3400} outstanding={2575.76} canIssue={257.57} topUp={463.64}
            backs={[{ label: "Bob", amount: 1240 }, { label: "Mira", amount: 860 }, { label: t("kit.rc.more", { n: 2 }), amount: 475.76 }]}
            tokens={[{ label: t("kit.rc.sigusd"), pct: 154 }, { label: t("kit.rc.gau"), pct: 124 }]}
            onTopUp={() => toast({ kind: "info", title: t("kit.rc.topup") })} inspectHref="/network" />
        </Spec>
        <div style={{ display: "grid", gap: 20 }}>
          <Spec tag="<TrackerCard>" name={t("kit.tc")} note={t("kit.tc.n")} code={'<TrackerCard id="T-01" nft={nft} blocksAgo={37} height={1921400} notes={2314} digest={d} trackerId="t1" />'}>
            <TrackerCard id="T-01" nft={TRACKER_NFT} blocksAgo={37} height={1921400} notes={2314} digest={DIGEST} trackerId="t1" />
          </Spec>
          <Spec tag="<EclipseCard silentBlocks note>" name={t("kit.ec")} note={t("kit.ec.n")}>
            <EclipseCard id="T-01" silentBlocks={812} note={{ ...NOTE_AB, lite: true, limit: 0, state: "stale" }} />
          </Spec>
        </div>
      </div>
      <div className="kit-gap" />
      <div className="grid-12" style={{ alignItems: "start" }}>
        <Spec tag="<Coin coverage size>" name={t("kit.coin")} style={{ gridColumn: "span 3" }}>
          <div className="kit-row"><Coin coverage={132} /><Coin coverage={92} size={96} /></div>
          <Cap>132 · 92 (size 96)</Cap>
        </Spec>
        <Spec tag="<CoverageMeter value ghost>" name={t("kit.meter")} note={t("ui.cov.policy")} style={{ gridColumn: "span 5" }}>
          <div style={{ display: "grid", gap: 18 }}>
            <CoverageMeter value={132} ghost={146} />
            <CoverageMeter value={163} scale={false} />
            <CoverageMeter value={112} scale={false} />
            <CoverageMeter value={86} scale={false} />
          </div>
        </Spec>
        <Spec tag="<CapBar> <MiniCap> <BacksBar>" name={t("kit.bars")} style={{ gridColumn: "span 4" }}>
          <div style={{ display: "grid", gap: 16 }}>
            <CapBar limit={2000} amount={1240} settled={300} />
            <CapBar limit={2000} amount={1000} added={240} />
            <div className="kit-row"><MiniCap used={0.62} kind="settled" width={120} /><MiniCap used={0.75} kind="out" width={120} /><MiniCap used={0.8} kind="near" width={120} /></div>
            <BacksBar locked={3400} items={[{ label: "Bob", amount: 1240 }, { label: "Mira", amount: 860 }, { label: t("kit.rc.more", { n: 2 }), amount: 475.76 }]} />
          </div>
        </Spec>
        <Spec tag="<Dial blocks> <Heartbeat commits silent>" name={t("kit.dial")} note={t("kit.dial.n")} style={{ gridColumn: "span 12" }}>
          <div className="kit-dials">
            {[37, 212, 812, 2160].map((b) => (
              <div key={b}><Dial blocks={b} size={120} /><span className="mono">{t(`ui.tracker.${trackerBand(b)}`)} · {money(b, 0)}</span></div>
            ))}
            <div className="kit-beats">
              <Heartbeat />
              <Heartbeat silent />
              <Cap>{'<Heartbeat />  ·  <Heartbeat silent />'}</Cap>
            </div>
          </div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------------- 08 · graph ---------------- */

export function GraphSection() {
  const t = useT();
  const nodes = useMemo<GraphNode[]>(() => GRAPH_NODES.map((n) => (n.sub ? { ...n, sub: n.id === "render·ai" ? t("kit.g.perCall") : t("kit.g.perQuery") } : n)), [t]);
  const loops = useMemo(() => GRAPH_LOOPS.map((l) => ({ ...l, label: t("kit.g.loop", { v: money(40) }) })), [t]);
  const big = useMemo(() => bigTown(), []);
  return (
    <Section id="graph" no={`08 · ${t("kit.s.graph")}`} title={rich(t("kit.s.graph.t"))} lede={t("kit.s.graph.lede")}>
      <Spec tag="<Graph nodes edges loops>" name={t("kit.g.small")} note={t("kit.g.small.n")} code={'<Graph nodes={[{ id: "Alice", x: 372, y: 340, reserve: 132 }, …]} edges={[{ from: "Alice", to: "Bob", amount: 1240, limit: 2000 }, …]} loops={[…]} />'}>
        <div className="card graph-card">
          <div className="card-h"><span className="label"><b>{t("kit.g.circle")}</b> · {t("kit.g.circle.s")}</span><span className="label"><b>Σ {t("ui.graph.net")} = {money(0)}</b> · {t("kit.g.zero")}</span></div>
          <div className="card-b"><Graph nodes={nodes} edges={GRAPH_EDGES} loops={loops} ariaLabel={t("kit.g.aria")} /></div>
        </div>
      </Spec>
      <div className="kit-gap sm" />
      <Spec tag='<Graph labels="auto">' name={t("kit.big")} note={t("kit.big.n", { n: big.edges.length })}>
        <div className="card graph-card"><div className="card-b"><Graph nodes={big.nodes} edges={big.edges} loops={big.loops} height={760} ariaLabel={t("kit.big")} /></div></div>
      </Spec>
    </Section>
  );
}

/* ---------------- 09 · policy and command bar ---------------- */

export function PolicySection() {
  const t = useT();
  const { lang } = useLang();
  const [toml, setToml] = useState(false);
  const pill = (id: string, label: string, extra: Partial<PolicyPill> = {}): PolicyPill => ({ id, label, ...extra });
  const editor = (what: string) => <div style={{ display: "grid", gap: 10, width: 240 }}><span className="label">{t("ui.policy.edit", { what })}</span><span className="t-small">{t("kit.pol.edit")}</span></div>;
  const carol = pill("carol", "Carol", { pk: PK.Carol, edit: editor("Carol") });
  const dan = pill("dan", "Dan", { pk: PK.Dan, edit: editor("Dan") });
  const max = pill("max", "2 ⁠000 ERG", { edit: editor(t("kit.pol.max")) });
  const cov = pill("cov", "≥ 100 ⁠%", { metal: true, edit: editor(t("kit.pol.cov")) });
  const exit = pill("exit", t("kit.pol.exit"), { edit: editor(t("kit.pol.exitW")) });
  const parts: (string | PolicyPill)[] = lang === "ru"
    ? ["Принимать расписки от ", carol, " и ", dan, " до ", max, " от каждого — или от любого, чей резерв покрывает ", cov, " и у кого ", exit, "."]
    : ["Accept notes from ", carol, " and ", dan, " up to ", max, " each, or from anyone whose reserve covers ", cov, " and who has ", exit, "."];
  return (
    <Section id="policy" no={`09 · ${t("kit.s.policy")}`} title={rich(t("kit.s.policy.t"))} lede={t("kit.s.policy.l")}>
      <div className="grid-12" style={{ alignItems: "start" }}>
        <Spec tag="<PolicySentence parts predicates>" name={t("kit.pol")} style={{ gridColumn: "span 7" }} code={'<PolicySentence parts={["Accept notes from ", { id: "carol", label: "Carol", pk, edit: <Editor/> }, …]} predicates={[{ label: "any_of" }, …]} />'}>
          <div className="card">
            <div className="card-h"><span className="label"><b>{t("kit.pol.h")}</b></span><Key size="sm" variant="quiet" onClick={() => setToml((v) => !v)} aria-pressed={toml}>{t("kit.pol.toml")}</Key></div>
            <div className="card-b">
              <PolicySentence parts={parts} predicates={[{ label: "any_of" }, { label: "whitelist · max_debt" }, { label: "all_of" }, { label: "collateralization ≥ 1.00", metal: true }, { label: "not · pending_refund" }]} />
              {toml && <pre className="spec-props" style={{ marginTop: 16 }}>{`[acceptance]\nany_of = [\n  { whitelist = ["Carol", "Dan"], max_debt = "2000 ERG" },\n  { all_of = [ { collateralization = ">= 1.00" }, { not = "pending_refund" } ] },\n]`}</pre>}
            </div>
          </div>
        </Spec>
        <Spec tag="<CommandBar query call actions>" name={t("kit.cmdbar")} note={t("kit.cmd.n")} style={{ gridColumn: "span 5" }}>
          <CommandBar query={t("kit.cmd.q")} label={t("kit.cmd.label")}
            call={{ fn: "note_create", args: [["recipient", "render·ai"], ["add", { num: "0.50" }], ["new_total", { num: "13.10" }], ["unit", "ERG"]], check: { key: "acceptance", value: "ok", rest: ` · ${t("kit.cmd.budget")}` } }}
            actions={<><Key size="sm" variant="primary" hold="sign" onAct={() => toast.up(t("kit.cmd.done"))}>{t("kit.cmd.hold", { v: "13.10" })}</Key><Key size="sm" variant="quiet" kbd="Esc">{t("kit.k.cancel")}</Key></>} />
          <div className="kit-row" style={{ marginTop: 12 }}><Key size="sm" icon="search" onClick={() => openCommandBar()}>{t("kit.openCmdk")}</Key><Key size="sm" variant="quiet" onClick={() => openCommandBar(DIGEST.slice(2, 66))}>{t("kit.cmd.paste")}</Key></div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------------- 10 · toasts ---------------- */

export function ToastsSection() {
  const t = useT();
  const samples: { kind: ToastKind; title: string; detail: string; time: string; mono?: boolean }[] = [
    { kind: "proof", title: t("kit.pulse.done"), detail: t("kit.toast.proof.d"), time: t("ui.time.now"), mono: true },
    { kind: "up", title: t("kit.seq.paid", { v: money(1240) }), detail: t("kit.seq.paid.d", { d: money(240) }), time: t("ui.time.s", { n: 2 }) },
    { kind: "metal", title: t("kit.toast.metal"), detail: t("kit.toast.metal.d"), time: t("ui.time.m", { n: 1 }) },
    { kind: "alarm", title: t("kit.toast.alarm"), detail: t("kit.toast.alarm.d"), time: t("ui.time.m", { n: 5 }) },
  ];
  const live = () => {
    firePulse();
    setTimeout(() => toast.up(samples[1].title, samples[1].detail), 500);
    setTimeout(() => toast.metal(samples[2].title, samples[2].detail), 1000);
    setTimeout(() => toast.alarm(samples[3].title, samples[3].detail), 1500);
  };
  return (
    <Section id="toasts" no={`10 · ${t("kit.s.toasts")}`} title={rich(t("kit.s.toasts.t"))} lede={t("kit.s.toasts.l")}>
      <div className="grid-12" style={{ alignItems: "start" }}>
        <Spec tag="<Toast kind title detail>" name={t("kit.toasts.static")} style={{ gridColumn: "span 6" }} code={'toast.proof(title, detail)  ·  toast.up(…)  ·  toast.metal(…)  ·  toast.alarm(…)  ·  toast({ kind, title, detail, ttl, action })'}>
          <div style={{ display: "grid", gap: 10 }}>
            {samples.map((s) => <Toast key={s.kind} kind={s.kind} title={s.title} detail={s.detail} mono={s.mono} time={s.time} />)}
          </div>
        </Spec>
        <Spec tag="toast()" name={t("kit.toasts.live")} note={t("kit.toasts.live.n")} style={{ gridColumn: "span 6" }}>
          <div className="card"><div className="card-b" style={{ display: "grid", gap: 14 }}>
            <div className="kit-row">
              <Key variant="primary" icon="play" onClick={live}>{t("kit.toast.fire")}</Key>
              <Key size="sm" onClick={() => toast({ kind: "info", title: t("kit.toast.info"), action: { label: t("kit.toast.undo"), onClick: () => toast(t("kit.toast.undone")) } })}>{t("kit.toast.infoKey")}</Key>
              <Key size="sm" variant="quiet" onClick={() => toast.proof(samples[0].title, samples[0].detail)}>{t("kit.toast.proofKey")}</Key>
            </div>
            <p className="t-small" style={{ margin: 0 }}>{t("kit.toasts.rules")}</p>
          </div></div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------------- 11 · states ---------------- */

export function StatesSection() {
  const t = useT();
  const [err, setErr] = useState(0);
  const lamps: ["signed" | "tracked" | "committed" | "stale", string][] = [["signed", t("ui.note.help.signed")], ["tracked", t("ui.note.help.tracked")], ["committed", t("ui.note.help.committed")], ["stale", t("kit.note.staleHelp")]];
  const cov: [number, string, string][] = [[160, "≥ 150 ⁠%", t("kit.st.fine")], [132, "< 150 ⁠%", t("kit.st.watch")], [112, "< 120 ⁠%", t("kit.st.warn")], [92, "< 100 ⁠%", t("kit.st.under")]];
  const trk: [number, string, string][] = [[37, "< 120", t("kit.st.ontime")], [212, "≥ 120", t("kit.st.late")], [812, "≥ 720", t("kit.st.silent")], [2160, "≥ 2 ⁠160", t("kit.st.emergency")]];
  return (
    <Section id="states" no={`12 · ${t("kit.s.states")}`} title={rich(t("kit.s.states.t"))} lede={t("kit.s.states.l")}>
      <div className="grid-3" style={{ alignItems: "start" }}>
        <Card title={t("kit.st.note")}><div className="rows">
          {lamps.map(([s, d]) => <div className="row" key={s} style={{ gridTemplateColumns: "auto 1fr" }}><Lamp state={s} size={14} /><div><div className="who" style={{ fontSize: 15 }}>{t(`ui.note.state.${s}`)}</div><div className="what">{d}</div></div></div>)}
        </div></Card>
        <Card title={t("kit.st.cov")}><div className="rows">
          {cov.map(([p, r, d]) => <div className="row" key={p} style={{ gridTemplateColumns: "96px 1fr" }}><CoverageTag pct={p} /><div><div className="who" style={{ fontSize: 15 }}>{r}</div><div className="what">{d}</div></div></div>)}
        </div></Card>
        <Card title={t("kit.st.tracker")}><div className="rows">
          {trk.map(([b, r, d]) => <div className="row" key={b} style={{ gridTemplateColumns: "52px 1fr" }}><Dial blocks={b} size={52} labels={false} /><div><div className="who" style={{ fontSize: 15 }}>{t(`ui.tracker.${trackerBand(b)}`)} <span className="mono dim" style={{ fontSize: 12, fontWeight: 400 }}>{r} blk</span></div><div className="what">{d}</div></div></div>)}
        </div></Card>
      </div>
      <div className="kit-gap sm" />
      <div className="grid-3" style={{ alignItems: "start" }}>
        <Spec tag="<Empty title text action>" name={t("kit.st.empty")}>
          <Card flush><Empty title={t("kit.st.empty.t")} text={t("kit.st.empty.b")} action={{ label: t("kit.st.empty.a"), to: "/play" }} /></Card>
        </Spec>
        <Spec tag="<Loading label seed> <Engraving>" name={t("kit.st.loading")} note={t("kit.st.loading.n")}>
          <Card><Loading label={t("ui.loading")} seed="Eve>Bob" /></Card>
          <div className="kit-row" style={{ marginTop: 12 }}><Engraving seed="a" size={48} /><Engraving seed="b" size={64} /></div>
        </Spec>
        <Spec tag="<ErrorState title text onRetry detail>" name={t("kit.st.error")}>
          <ErrorState key={err} title={t("kit.st.error.t")} text={t("kit.st.error.b")} onRetry={() => { setErr((n) => n + 1); toast(t("kit.st.error.retry")); }} retryLabel={t("ui.retry")} detail="GET /v1/info → 502 Bad Gateway" />
        </Spec>
      </div>
    </Section>
  );
}

/* ---------------- 12 · machine face ---------------- */

export function MachineSection() {
  const t = useT();
  const [lens, setLens] = useLens();
  const box = JSON.stringify({ boxId: short(DIGEST.slice(2), 6, 6), value: "3400000000000", R4: PK.Alice, R5: "AVL tree of redeemed amounts", R6: TRACKER_NFT.slice(0, 16) + "…", R7: null }, null, 2);
  return (
    <Section id="machine" no={`13 · ${t("kit.s.machine")}`} title={rich(t("kit.s.machine.t"))} lede={t("kit.s.machine.l")}>
      <div className="grid-12" style={{ alignItems: "start" }}>
        <Spec tag="<FaceTabs> <Faces>" name={t("kit.m.faces")} note={t("kit.m.faces.n")} style={{ gridColumn: "span 5" }} code={'const [lens, setLens] = useLens();  <Faces value={lens} human={…} machine={…} />'}>
          <div className="card">
            <div className="card-h"><span className="label"><b>{t("kit.rc")}</b></span><FaceTabs value={lens} onChange={setLens} idBase="kit-m" /></div>
            <Faces value={lens}
              human={<div className="card-b"><p className="t-body" style={{ margin: 0 }}>{rich(t("kit.m.human"))}</p></div>}
              machine={<div className="card-b"><pre className="spec-props" style={{ margin: 0 }}>{box}</pre></div>} />
          </div>
        </Spec>
        <Spec tag="<Bytes segments cols offsets legend>" name={t("kit.m.bytes")} note={t("kit.m.bytes.n")} style={{ gridColumn: "span 7" }} code={'<Bytes segments={[{ label: "key", bytes: key, tone: "k" }, { label: "total", bytes: be(1240_000_000_000n), tone: "t" }, …]} />'}>
          <div className="card"><div className="card-b">
            <Bytes segments={[
              { label: t("kit.bytes.key"), bytes: KEY_AB, tone: "k", value: "blake2b256(A‖B)" },
              { label: t("kit.bytes.total"), bytes: be(1240_000_000_000n), tone: "t", value: <>{money(1240)}{" "}ERG</> },
              { label: t("kit.bytes.time"), bytes: be(1763734800000n), tone: "ts", value: "2025-11-21 14:20 UTC" },
              { label: t("kit.bytes.nft"), bytes: TRACKER_NFT, tone: "n" },
              { label: "sig a ‖ z", bytes: SIGS_AB.sigA, tone: "a" },
            ]} />
          </div></div>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------------- 13 · layout ---------------- */

export function LayoutSection() {
  const t = useT();
  const [open, setOpen] = useState<null | "auto" | "bottom">(null);
  const box = (label: string) => <div className="kit-box">{label}</div>;
  return (
    <Section id="layout" no={`14 · ${t("kit.s.layout")}`} title={rich(t("kit.s.layout.t"))} lede={t("kit.s.layout.l")}>
      <Spec tag="<Grid> <Col span spanL>" name={t("kit.l.grid")} code={'<Grid><Col span={7} spanL={12}>…</Col><Col span={5} spanL={12}>…</Col></Grid>'}>
        <div style={{ display: "grid", gap: 12 }}>
          <Grid>{Array.from({ length: 12 }, (_, i) => <Col key={i} span={1}>{box(String(i + 1))}</Col>)}</Grid>
          <Grid><Col span={7} spanL={12}>{box("span 7 · spanL 12")}</Col><Col span={5} spanL={12}>{box("span 5 · spanL 12")}</Col></Grid>
          <Grid><Col span={4}>{box("span 4")}</Col><Col span={4}>{box("span 4")}</Col><Col span={4}>{box("span 4")}</Col></Grid>
        </div>
      </Spec>
      <div className="kit-gap sm" />
      <div className="grid-3" style={{ alignItems: "start" }}>
        <Spec tag="<Stack> <Cluster> <Spread>" name={t("kit.l.flow")}>
          <Stack gap={8}>{box("Stack · 1")}{box("Stack · 2")}</Stack>
          <Cluster gap={8} style={{ marginTop: 12 }}><Tag>Cluster</Tag><Tag>wraps</Tag><Tag>gap 8</Tag></Cluster>
          <Spread style={{ marginTop: 12 }}><span className="label">Spread</span><span className="label">{t("kit.l.right")}</span></Spread>
        </Spec>
        <Spec tag="<Card title aside footer>" name={t("kit.l.card")}>
          <Card title={t("kit.l.card.t")} aside={<Tag tone="ok">{t("ui.cov.fine")}</Tag>} footer={<><Key size="sm" variant="primary">{t("kit.k.pay")}</Key><Key size="sm" variant="quiet">{t("kit.k.cancel")}</Key></>}>
            <p className="t-small" style={{ margin: 0 }}>{t("kit.l.card.b")}</p>
          </Card>
        </Spec>
        <Spec tag='<Sheet placement="auto|bottom|side">' name={t("kit.l.sheet")} note={t("kit.sheet.n")}>
          <div className="kit-row">
            <Key size="sm" onClick={() => setOpen("auto")}>placement="auto"</Key>
            <Key size="sm" onClick={() => setOpen("bottom")}>placement="bottom"</Key>
          </div>
          <Sheet open={open != null} onClose={() => setOpen(null)} placement={open ?? "auto"} title={t("kit.l.sheet.t")} sub={t("kit.l.sheet.s")}
            footer={<Key variant="primary" block onClick={() => setOpen(null)}>{t("ui.close")}</Key>}>
            <p className="t-body" style={{ margin: 0 }}>{t("kit.l.sheet.b")}</p>
          </Sheet>
        </Spec>
      </div>
    </Section>
  );
}

/* ---------------- 14 · never / instead ---------------- */

export function NeverSection() {
  const t = useT();
  const { lang } = useLang();
  return (
    <Section id="never" no={`15 · ${t("kit.s.dd")}`} title={rich(t("kit.s.dd.t"))} lede={t("kit.s.dd.l")}>
      <div className="dd">
        {NEVER[lang].map(([x, ok]) => (
          <div key={x}><span className="x">✕ {t("kit.dd.never")}</span><p>{x}</p><span className="ok">✓ {t("kit.dd.instead")}</span><p><b>{ok}</b></p></div>
        ))}
      </div>
    </Section>
  );
}

