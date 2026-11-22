// Kit sections 03–06: the note (hero, anatomy, states, small forms), keys and small parts, inputs, pay and redeem,
// the wallet top and list rows.
import { useEffect, useRef, useState } from "react";
import { rich, useLang, useT } from "@/app/lang";
import {
  AgentTag, AmountInput, BackedTrustBar, Bytes, CapBar, Callout, Checks, Chip, CopyButton, CoverageMeter, CoverageTag, Countdown, Digest,
  Faces, FaceTabs, Field, GrowthPreview, Hex, Honest, Kbd, Key, KeyField, KeySeal, Lamp, Ledger, MiniCap, Note, NoteStack, NoteStub, NoteThumb,
  Num, Odometer, OdoLedger, Popover, Section, Seg, Sheet, Switch, Tabs, Tag, Tape, Tear, TextInput, TornNote, TrackerTile,
  be, blk, int, money, parseMoney, setUiSettings, short, signed, threeWords, toast, useLens, useUiSettings,
  type LampState, type NoteState,
} from "@/ui";
import { NOTE_BC, NOTE_AB, NOTE_EB, DIGEST, KEY_AB, KEY_AB_HEX, PK, SIGS_AB, TRACKER_NFT, WALLET_ROWS, isAgent } from "./data";
import { firePulse, nextHeight } from "./pulse";
import { Cap, Spec } from "./Spec";

const NAME_PK = (s: string) => {
  const k = Object.keys(PK).find((n) => n.toLowerCase() === s.trim().toLowerCase());
  return k ? { name: k, pk: PK[k], agent: isAgent(k) } : null;
};

/* ---------------- 03 · the note ---------------- */

function Hero() {
  const t = useT();
  const [amt, setAmt] = useState(1240);
  const [prev, setPrev] = useState<number | null>(1000);
  const [st, setSt] = useState<NoteState>("committed");
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(3);
  const [blk, setBlk] = useState(1921400);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const run = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const from = amt + 240 > 2000 ? 1000 : amt;
    const to = from + 240;
    setPrev(from); setAmt(to); setSt("signed"); setStage(1);
    toast.up(t("kit.seq.paid", { v: money(to) }), t("kit.seq.paid.d", { d: money(240) }));
    timers.current.push(setTimeout(() => { setSt("tracked"); setStage(2); }, 1100));
    timers.current.push(setTimeout(() => {
      const h = nextHeight();
      setBlk(h); setSt("committed"); setStage(3);
      // fire after the note has re-rendered as committed, so it takes part in the pulse
      timers.current.push(setTimeout(() => firePulse(h), 40));
    }, 2500));
  };
  const tape = [
    { type: "NOTE", lamp: "signed" as LampState, parties: "Alice → Bob", amount: <>{money(amt)} <span className="up">{signed(amt - (prev ?? amt), 2, "favour")}</span></> },
    { type: "COMMIT", lamp: "committed" as LampState, parties: <>T-01 digest <b className="mono">9f3c…e1</b> · {t.p("ui.tracker.notes", 2314, { n: int(2314) })}</> },
    { type: "REDEEM", lamp: "committed" as LampState, parties: t("kit.tape.redeem"), amount: <>{money(120)}{" "}ERG</> },
    { type: "CALL", lamp: "tracked" as LampState, parties: "render·ai → Bob", amount: <>12.6042 <span className="up">+0.0004</span></> },
    { type: "TOP UP", lamp: "committed" as LampState, parties: t("kit.tape.topup"), amount: <>+50.00{" "}ERG</> },
  ];
  return (
    <>
      <div className="grid-12 kit-hero" style={{ alignItems: "center" }}>
        <div style={{ gridColumn: "span 4" }}>
          <Spec tag="<NoteStack front back>" name={t("kit.note.hero")} note={t("kit.note.hero.n")}
            code={'<NoteStack front={{ ...note, live: true, odometer: true }} back={[n2, n3]} />'}>
            <p className="t-body" style={{ margin: "0 0 18px" }}>{rich(t("kit.note.hero.l"))}</p>
            <div className="kit-row">
              <Key variant="primary" icon="play" onClick={run}>{t("kit.run")}</Key>
            </div>
            <div style={{ marginTop: 22 }}><Checks stage={stage} block={stage === 3 ? blk : undefined} /></div>
            <Cap>{'<Checks stage={0|1|2|3} block={n} />'}</Cap>
          </Spec>
        </div>
        <div style={{ gridColumn: "span 8" }}>
          <NoteStack front={{ ...NOTE_AB, amount: amt, prev, state: st, block: blk, live: true, odometer: true, sigA: SIGS_AB.sigA, sigT: SIGS_AB.sigT }} back={[NOTE_BC, NOTE_EB]} />
        </div>
      </div>
      <div style={{ marginTop: 28 }}>
        <Spec tag="<Tape source events right>" name={t("kit.tape")} note={t("kit.tape.n")}>
          <Tape source="sandbox" events={tape} right={<span className="label">T-01 · {t("kit.tape.last")} <b className="num">37</b> blk</span>} />
        </Spec>
      </div>
    </>
  );
}

function History() {
  const t = useT();
  const [lens, setLens] = useLens();
  const json = JSON.stringify({ key: KEY_AB_HEX, total: "1240000000000", timestamp: 1763734800000, tracker: TRACKER_NFT, sig: SIGS_AB.sigA }, null, 2);
  return (
    <div className="card">
      <div className="card-h"><span className="label"><b>{t("kit.hist.title")}</b></span><FaceTabs value={lens} onChange={setLens} idBase="kit-hist" /></div>
      <Faces value={lens}
        human={
          <div className="card-b">
            <Ledger
              rows={[
                { label: <>{t("kit.hist.d1")} <span className="mono">· digest 41ac…07 · blk 1{" ⁠"}913{" ⁠"}958</span></>, value: money(600) },
                { label: <>{t("kit.hist.d2")} <span className="mono">· digest 7d02…9b · blk 1{" ⁠"}918{" ⁠"}977</span></>, value: signed(400, 2, "favour") },
                { label: <>{t("kit.hist.d3")} <span className="mono">· digest 9f3c…e1 · blk 1{" ⁠"}921{" ⁠"}400</span></>, value: signed(240, 2, "favour"), tone: "up" },
              ]}
              sum={{ label: t("kit.hist.sum"), value: money(1240) }}
            />
            <p className="t-small" style={{ marginTop: 14 }}>{rich(t("kit.hist.note"), { r: <b className="num" style={{ color: "var(--ink)" }}>{money(0)}</b>, o: <b className="num" style={{ color: "var(--ink)" }}>{money(1240)}</b> })}</p>
            <div style={{ display: "grid", gap: 8, marginTop: 16 }}>
              <span className="check"><Lamp state="committed" /><b>{t("ui.checks.signed")}</b> Alice <span className="mono">· sig {short(SIGS_AB.sigA, 4, 3)} · 65 B</span></span>
              <span className="check"><Lamp state="committed" /><b>{t("ui.checks.witnessed")}</b> T-01 <span className="mono">· {t("kit.hist.cosig")}</span></span>
              <span className="check"><Lamp state="committed" /><b>{t("kit.hist.inDigest")}</b> <span className="mono">· 9f3c…e1 · {blk(37, t.lang)}</span></span>
            </div>
          </div>
        }
        machine={
          <div className="card-b">
            <div className="label" style={{ marginBottom: 10 }}>{t("kit.hist.msg")}</div>
            <Bytes cols={16} segments={[
              { label: t("kit.bytes.key"), bytes: KEY_AB, tone: "k", value: "blake2b256(A‖B)" },
              { label: t("kit.bytes.total"), bytes: be(1240_000_000_000n), tone: "t", value: <>{money(1240)}{" "}ERG</> },
              { label: t("kit.bytes.time"), bytes: be(1763734800000n), tone: "ts", value: "2025-11-21 14:20 UTC" },
              { label: t("kit.bytes.nft"), bytes: TRACKER_NFT, tone: "n", value: short(TRACKER_NFT, 4, 4) },
            ]} />
            <div className="label" style={{ margin: "16px 0 8px" }}>{t("kit.hist.sig")}</div>
            <Bytes cols={16} legend segments={[
              { label: "a", bytes: SIGS_AB.sigA.slice(0, 66), tone: "a", value: "33 B" },
              { label: "z", bytes: SIGS_AB.sigA.slice(66), tone: "u", value: "32 B" },
            ]} />
            <div className="kit-row" style={{ marginTop: 14 }}>
              <CopyButton value={json} label={t("kit.copyJson")} small />
              <CopyButton value={SIGS_AB.sigA} label={t("kit.copySig")} small />
            </div>
          </div>
        }
      />
    </div>
  );
}

function Anatomy() {
  const t = useT();
  const states: [NoteState, string][] = [["signed", t("ui.note.help.signed")], ["tracked", t("ui.note.help.tracked")], ["committed", t("ui.note.help.committed")], ["stale", t("kit.note.staleHelp")]];
  return (
    <div className="grid-12" style={{ alignItems: "start" }}>
      <div style={{ gridColumn: "span 7" }}>
        <Spec tag="<Note loupe>" name={t("kit.note.full")} note={t("kit.note.full.n")} code={'<Note issuer="Alice" receiver="Bob" amount={1240} prev={1000} limit={2000} digest={d} block={1921400} loupe />'}>
          <Note {...NOTE_AB} loupe />
        </Spec>
        <div className="state-row" style={{ marginTop: 20 }}>
          {states.map(([s, help]) => (
            <div key={s}>
              <Note {...NOTE_AB} lite limit={0} state={s} decorative style={{ boxShadow: "0 10px 20px -12px rgba(var(--shade),.7)" }} />
              <div className="lbl"><Lamp state={s} />{t(`ui.note.state.${s}`)}</div>
              <div className="t-small" style={{ marginTop: 2 }}>{help}</div>
            </div>
          ))}
        </div>
        <Cap>{'<Note lite state="signed|tracked|committed|stale" />'}</Cap>
      </div>
      <div style={{ gridColumn: "span 5" }}>
        <Spec tag="<FaceTabs> <Faces human machine>" name={t("kit.hist.spec")} note={t("kit.hist.spec.n")}>
          <History />
        </Spec>
      </div>
    </div>
  );
}

function SmallForms() {
  const t = useT();
  return (
    <div className="grid-12" style={{ alignItems: "start" }}>
      <Spec tag="<NoteThumb width>" name={t("kit.note.thumb")} style={{ gridColumn: "span 5" }} code={'<NoteThumb {...note} width={200} />'}>
        <div style={{ display: "grid", gap: 16 }}>
          <NoteThumb {...NOTE_AB} />
          <NoteThumb {...NOTE_BC} state="tracked" width={160} />
        </div>
      </Spec>
      <Spec tag="<NoteStub amount label>" name={t("kit.note.stub")} style={{ gridColumn: "span 3" }} code={'<NoteStub amount={500} label="…" />'}>
        <NoteStub amount={500} label={t("kit.note.stub.l")} />
      </Spec>
      <Spec tag="<TornNote seed>" name={t("kit.note.torn")} note="404" style={{ gridColumn: "span 4" }} code={'<TornNote seed={pathname} />'}>
        <TornNote seed="/kit" style={{ maxWidth: 360 }} />
      </Spec>
    </div>
  );
}

export function NoteSection() {
  const t = useT();
  return (
    <Section id="note" no={`03 · ${t("kit.s.note")}`} title={rich(t("kit.s.note.t"))} lede={rich(t("kit.s.note.l"))}>
      <Hero />
      <div className="kit-gap" />
      <Anatomy />
      <div className="kit-gap" />
      <SmallForms />
    </Section>
  );
}

/* ---------------- 04 · keys and small parts ---------------- */

function OdometerDemo() {
  const t = useT();
  const [v, setV] = useState(1240);
  const [back, setBack] = useState(false);
  return (
    <Spec tag="<Odometer value dp allowBack>" name={t("kit.odo")} note={t("kit.odo.n")} code={'<Odometer value={1240} />  ·  <Odometer value={v} allowBack />  (time machine only)'}>
      <div className="card"><div className="card-b" style={{ display: "grid", gap: 16 }}>
        <div className="t-money" style={{ fontSize: 64, lineHeight: 1 }}><Odometer value={v} allowBack={back} live /> <span className="unit">ERG</span></div>
        <div className="kit-row">
          <Key size="sm" icon="plus" onClick={() => { setBack(false); setV((x) => x + 240); }}>{t("kit.raise")}</Key>
          <Key size="sm" variant="quiet" icon="left" onClick={() => { setBack(true); setV((x) => Math.max(1000, x - 240)); }}>{t("kit.back")}</Key>
        </div>
      </div></div>
    </Spec>
  );
}

function KeysCard() {
  const t = useT();
  const ui = useUiSettings();
  const done = (what: string) => () => toast({ kind: "info", title: t("kit.keys.done", { what }) });
  return (
    <Spec tag="<Key variant size icon kbd hold tall to>" name={t("kit.keys")} note={t("kit.keys.n")} code={'<Key variant="primary" icon="pay">Pay</Key>  ·  <Key variant="metal" hold onAct={redeem}>Hold to redeem 500.00</Key>  ·  <Key hold="sign">…</Key>'}>
      <div className="card"><div className="card-b" style={{ display: "grid", gap: 18 }}>
        <div className="kit-row">
          <Key variant="primary" icon="pay">{t("kit.k.pay")}</Key>
          <Key icon="req">{t("kit.k.request")}</Key>
          <Key variant="metal" icon="redeem">{t("kit.k.redeem")}</Key>
          <Key icon="scan">{t("kit.k.scan")}</Key>
          <Key variant="quiet">{t("kit.k.cancel")}</Key>
          <Key variant="danger" icon="exit">{t("kit.k.exit")}</Key>
          <Key disabled>{t("kit.k.disabled")}</Key>
        </div>
        <div className="kit-row">
          <Key variant="primary" size="lg" kbd="P" to="/play">{t("kit.k.play")}</Key>
          <Key size="sm" icon="copy">{t("ui.copy")}</Key>
          <Key size="sm" variant="quiet" icon="search" aria-label={t("app.cmd.aria")} />
          <span className="t-small">{t("kit.k.sizes")}</span>
        </div>
        <div className="kit-row" style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
          <Key variant="primary" hold="sign" onAct={done(t("kit.k.sign"))}>{t("kit.k.holdSign")}</Key>
          <Key variant="metal" hold onAct={done(t("kit.k.topup"))}>{t("kit.k.holdTop")}</Key>
        </div>
        <Switch checked={ui.confirmPress} onChange={(v) => setUiSettings({ confirmPress: v })} label={t("app.prefs.confirm")} help={t("app.prefs.confirm.help")} />
        <div className="kit-tall">
          <Key variant="primary" tall icon="pay">{t("kit.k.pay")}</Key>
          <Key tall icon="req">{t("kit.k.request")}</Key>
          <Key variant="metal" tall icon="redeem">{t("kit.k.redeem")}</Key>
          <Key tall icon="scan">{t("kit.k.scan")}</Key>
        </div>
        <Cap>{'<Key tall icon="pay">'} · 62 px · {t("kit.k.tall")}</Cap>
      </div></div>
    </Spec>
  );
}

function ChipsCard() {
  const t = useT();
  const lamps: LampState[] = ["signed", "tracked", "committed", "stale", "live", "alarm", "off"];
  return (
    <Spec tag="<Chip> <Lamp> <Tag> <CoverageTag>" name={t("kit.chips")} note={t("kit.chips.n")}>
      <div className="card"><div className="card-b" style={{ display: "grid", gap: 18 }}>
        <div className="kit-row">
          <Chip lamp="live" label="Ergo" value={int(1921860)} />
          <Chip lamp="committed" label="T-01" value={blk(37, t.lang)} />
          <Chip lamp="stale" label="T-02" value={blk(812, t.lang)} />
          <Chip lamp="signed" label={t("kit.sandbox")} />
        </div>
        <div className="kit-row">
          {lamps.map((s) => <span key={s} className="kit-lamp"><Lamp state={s} size={14} /><span className="mono">{s}</span></span>)}
        </div>
        <div className="kit-row">
          <CoverageTag pct={160} /><CoverageTag pct={132} long /><CoverageTag pct={112} long /><CoverageTag pct={92} long />
        </div>
        <div className="kit-row">
          <Tag tone="metal">{t("kit.tag.onErgo")}</Tag><AgentTag /><Tag tone="up">+240.00</Tag><Tag>any_of</Tag><TrackerTile /><TrackerTile stale /><TrackerTile size="sm" />
        </div>
      </div></div>
    </Spec>
  );
}

function TabsCard() {
  const t = useT();
  const [tab, setTab] = useState<"notes" | "reserves" | "policy">("notes");
  const [range, setRange] = useState<"1d" | "7d" | "30d" | "all">("7d");
  const [view, setView] = useState<"graph" | "table">("graph");
  const [a, setA] = useState(true);
  const [b, setB] = useState(false);
  return (
    <Spec tag="<Tabs> <Seg> <Switch>" name={t("kit.tabs")}>
      <div className="card"><div className="card-b" style={{ display: "grid", gap: 16 }}>
        <Tabs ariaLabel={t("kit.tabs")} value={tab} onChange={setTab} tabs={[{ id: "notes", label: t("kit.tab.notes"), count: 5 }, { id: "reserves", label: t("kit.tab.reserves") }, { id: "policy", label: t("kit.tab.policy") }]} />
        <Tabs mono ariaLabel={t("kit.tab.range")} value={range} onChange={setRange} tabs={[{ id: "1d", label: "1D" }, { id: "7d", label: "7D" }, { id: "30d", label: "30D" }, { id: "all", label: "ALL" }]} />
        <Seg ariaLabel={t("ui.graph.view")} value={view} onChange={setView} options={[{ value: "graph", label: t("ui.graph.graph") }, { value: "table", label: t("ui.graph.table") }]} />
        <Switch checked={a} onChange={setA} label={t("kit.sw.backed")} help={t("kit.sw.backed.h")} />
        <Switch checked={b} onChange={setB} label={t("kit.sw.trust")} help={t("kit.sw.trust.h")} />
      </div></div>
    </Spec>
  );
}

function NumbersCard() {
  const t = useT();
  return (
    <Spec tag="<Num value sign unit tone> <Hex> <Digest> <Kbd>" name={t("kit.nums")} note={t("kit.nums.n")} code={'<Num value={1240} sign="favour" unit="ERG" tone="up" />  ·  <Num value={3400000000000n} decimals={9} unit="ERG" tone="metal" />'}>
      <div className="card"><div className="card-b" style={{ display: "grid", gap: 12 }}>
        <div className="kit-nums">
          <span><Num value={1240} sign="favour" unit="ERG" tone="up" /><small>sign="favour"</small></span>
          <span><Num value={320} sign="owe" unit="ERG" /><small>sign="owe"</small></span>
          <span><Num value={-12.6} /><small>auto</small></span>
          <span><Num value={3_400_000_000_000n} decimals={9} unit="ERG" tone="metal" /><small>bigint · 9</small></span>
          <span><Num value={0.0004} dp={4} unit="ERG" /><small>dp=4</small></span>
          <span><Num value={2575.76} tone="dim" /><small>tone="dim"</small></span>
        </div>
        <div className="kit-row"><span className="t-small">{t("kit.nums.hex")}</span><Hex value={PK.Alice} copy /><Hex value={DIGEST} head={6} tail={4} grouped /></div>
        <Digest value={DIGEST} />
        <div className="kit-row"><span className="t-small">{t("kit.nums.kbd")}</span><Kbd>⌘</Kbd><Kbd>K</Kbd><Kbd>P</Kbd><Kbd>?</Kbd><CopyButton value={PK.Alice} small /></div>
      </div></div>
    </Spec>
  );
}

function CalloutsCard() {
  const t = useT();
  const tones = ["info", "policy", "sandbox", "metal", "proof", "alarm", "calm"] as const;
  return (
    <Spec tag="<Callout tone title>" name={t("kit.callouts")}>
      <div style={{ display: "grid", gap: 10 }}>
        {tones.map((k) => <Callout key={k} tone={k} title={t(`kit.co.${k}`)}>{t(`kit.co.${k}.b`)}</Callout>)}
      </div>
    </Spec>
  );
}

function TrustCard() {
  const t = useT();
  const [stage, setStage] = useState<"0" | "1" | "2" | "3">("2");
  return (
    <Spec tag="<Honest> <Checks> <Countdown>" name={t("kit.trust")} note={t("kit.trust.n")} code={'<Honest tracker="T-01" />  ·  <Countdown blocks={1348} label="Emergency redeem in" />'}>
      <div className="card"><div className="card-b" style={{ display: "grid", gap: 18 }}>
        <Honest tracker="T-01" />
        <div>
          <Seg mono ariaLabel={t("kit.trust.stage")} value={stage} onChange={setStage} options={(["0", "1", "2", "3"] as const).map((v) => ({ value: v, label: v }))} />
          <div style={{ marginTop: 12 }}><Checks stage={+stage as 0 | 1 | 2 | 3} block={1921400} /></div>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <Countdown blocks={1348} label={t("kit.cd.emergency")} />
          <Countdown blocks={43200} lead="time" label={t("kit.cd.exit")} />
          <Countdown blocks={0} label={t("kit.cd.emergency")} />
        </div>
      </div></div>
    </Spec>
  );
}

export function KeysSection() {
  const t = useT();
  return (
    <Section id="keys" no={`04 · ${t("kit.s.keys")}`} title={rich(t("kit.s.keys.t"))} lede={t("kit.s.keys.l")}>
      <div className="grid-12" style={{ alignItems: "start" }}>
        <div style={{ gridColumn: "span 7" }}><KeysCard /></div>
        <div style={{ gridColumn: "span 5" }}><ChipsCard /></div>
        <div style={{ gridColumn: "span 4" }}><TabsCard /></div>
        <div style={{ gridColumn: "span 4" }}><NumbersCard /></div>
        <div style={{ gridColumn: "span 4" }}><TrustCard /></div>
        <div style={{ gridColumn: "span 6" }}><OdometerDemo /></div>
        <div style={{ gridColumn: "span 6" }}><CalloutsCard /></div>
      </div>
    </Section>
  );
}

/* ---------------- 05 · inputs ---------------- */

export function InputsSection() {
  const t = useT();
  const [amt, setAmt] = useState("240.00");
  const [over, setOver] = useState("360.00");
  const [who, setWho] = useState("Carol");
  const [q, setQ] = useState("");
  const [lim, setLim] = useState("400.00");
  const overBy = Math.max(0, (parseMoney(over) ?? 0) + 80 - 400);
  return (
    <Section id="inputs" no={`05 · ${t("kit.s.inputs")}`} title={rich(t("kit.s.inputs.t"))} lede={t("kit.s.inputs.l")}>
      <div className="grid-12" style={{ alignItems: "start" }}>
        <div style={{ gridColumn: "span 6" }}>
          <Spec tag="<Field label help error> <AmountInput plus max>" name={t("kit.in.amount")} code={'<Field label="Amount" help={…}><AmountInput value={v} onChange={setV} max={{ label: "Max", onMax }} /></Field>'}>
            <div className="card"><div className="card-b" style={{ display: "grid", gap: 18 }}>
              <Field label={t("kit.in.amount")} help={rich(t("kit.in.help"), { l: <b>{money(2000, 0)}</b>, r: <b>{money(Math.max(0, 1000 - (parseMoney(amt) ?? 0)))}</b> })}>
                <AmountInput value={amt} onChange={setAmt} plus max={{ label: t("kit.in.max"), onMax: () => setAmt("1000.00") }} />
              </Field>
              <Field label={t("kit.in.over")} error={overBy > 0 ? rich(t("kit.in.err"), { v: <b>{money(overBy)}</b> }) : undefined} help={overBy > 0 ? undefined : t("kit.in.ok")}>
                <AmountInput value={over} onChange={setOver} />
              </Field>
            </div></div>
          </Spec>
        </div>
        <div style={{ gridColumn: "span 6" }}>
          <Spec tag="<KeyField resolve> <TextInput mono icon> <Popover>" name={t("kit.in.key")} code={'<KeyField value={v} onChange={setV} resolve={byName} />'}>
            <div className="card"><div className="card-b" style={{ display: "grid", gap: 18 }}>
              <Field label={t("kit.in.who")} help={t("kit.in.who.h")}>
                <KeyField value={who} onChange={setWho} resolve={NAME_PK} />
              </Field>
              <Field label={t("kit.in.search")}>
                <TextInput mono icon="search" value={q} onChange={setQ} placeholder={t("kit.in.search.p")} />
              </Field>
              <div className="kit-row">
                <Popover trigger={(p) => <Key size="sm" icon="settings" {...p}>{t("kit.in.limit", { name: "Carol" })}</Key>}>
                  <div style={{ display: "grid", gap: 12, width: 280 }}>
                    <Field label={t("kit.in.limit", { name: "Carol" })} help={t("kit.in.limit.h")}>
                      <AmountInput value={lim} onChange={setLim} />
                    </Field>
                  </div>
                </Popover>
                <span className="t-small">{t("kit.in.pop")}</span>
              </div>
            </div></div>
          </Spec>
        </div>
      </div>
    </Section>
  );
}

/* ---------------- 06 · pay and redeem, wallet ---------------- */

const LOCKED = 3400, OUT_BEFORE = 2335.76;

function PayBody({ add, setAdd }: { add: string; setAdd: (v: string) => void }) {
  const t = useT();
  const a = Math.max(0, parseMoney(add) ?? 0);
  const total = 1000 + a;
  const over = Math.max(0, total - 2000);
  const before = Math.round((LOCKED / OUT_BEFORE) * 100);
  const after = Math.round((LOCKED / (OUT_BEFORE + a)) * 100);
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <Field label={t("kit.pay.add")} error={over > 0 ? rich(t("kit.pay.over"), { v: <b>{money(over)}</b> }) : undefined}>
        <AmountInput value={add} onChange={setAdd} plus max={{ label: `${t("kit.in.max")} ${money(1000)}`, onMax: () => setAdd("1000.00") }} />
      </Field>
      <div>
        <div className="label" style={{ marginBottom: 10 }}>{t("kit.pay.grown")}</div>
        <GrowthPreview from={1000} to={total} />
        <div style={{ marginTop: 12 }}><CapBar limit={2000} amount={1000} added={Math.min(a, 1000)} /></div>
        <div className="help" style={{ display: "flex", justifyContent: "space-between", marginTop: 8, gap: 12, flexWrap: "wrap" }}>
          <span>{rich(t("kit.pay.limit"), { v: <b>{money(2000, 0)}</b> })}</span>
          <span>{rich(t("kit.pay.left"), { v: <b>{money(Math.max(0, 2000 - total))}</b> })}</span>
        </div>
      </div>
      <div>
        <div className="spread"><span className="label">{t("kit.pay.cov")}</span><span style={{ font: "600 15px var(--f-ui)", fontVariantNumeric: "tabular-nums" }}>{before}{" ⁠"}% <span style={{ color: "var(--ink-3)" }}>→</span> {after}{" ⁠"}%</span></div>
        <CoverageMeter value={after} ghost={before} />
      </div>
      <p className="t-small" style={{ color: "var(--ink-2)", margin: 0 }}>{rich(t("kit.pay.words"), { v: <b style={{ color: "var(--ink)" }}>{money(total)}</b> })}</p>
    </div>
  );
}

function PayCard() {
  const t = useT();
  const [add, setAdd] = useState("240.00");
  const [open, setOpen] = useState(false);
  const total = 1000 + Math.max(0, parseMoney(add) ?? 0);
  const ok = total <= 2000;
  const sign = () => toast.up(t("kit.pay.done", { v: money(total) }), t("kit.pay.done.d"));
  const head = (
    <div className="who-line">
      <KeySeal pk={PK.Bob} size="lg" />
      <div style={{ minWidth: 0 }}><div className="t-h4">{t("kit.pay.title")}</div><div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{threeWords(PK.Bob).join(" · ")} · {short(PK.Bob, 4, 4)}</div></div>
    </div>
  );
  const keys = (
    <>
      <Key variant="primary" size="lg" hold="sign" block disabled={!ok} onAct={sign}>{t("kit.pay.hold", { v: money(total) })}</Key>
      <Key size="lg" variant="quiet" onClick={() => setOpen(false)}>{t("kit.k.cancel")}</Key>
    </>
  );
  return (
    <Spec tag="<Sheet> · <GrowthPreview> <CapBar> <CoverageMeter ghost>" name={t("kit.pay")} note={t("kit.pay.n")}>
      <div className="card">
        <div className="card-h">{head}<Tag tone="ok"><Lamp state="live" size={7} />{t("kit.pay.accepts")}</Tag></div>
        <div className="card-b"><PayBody add={add} setAdd={setAdd} /></div>
        <div className="card-f">{keys}</div>
      </div>
      <div className="kit-row" style={{ marginTop: 12 }}><Key size="sm" icon="arrow" onClick={() => setOpen(true)}>{t("kit.openSheet")}</Key><span className="t-small">{t("kit.sheet.n")}</span></div>
      <Sheet open={open} onClose={() => setOpen(false)} title={t("kit.pay.title")} sub={`${threeWords(PK.Bob).join(" · ")} · ${short(PK.Bob, 4, 4)}`} lead={<KeySeal pk={PK.Bob} size="md" />}
        footer={keys}>
        <PayBody add={add} setAdd={setAdd} />
      </Sheet>
    </Spec>
  );
}

function RedeemCard() {
  const t = useT();
  return (
    <Spec tag="<Tear> <OdoLedger> <Ledger> <Key metal hold>" name={t("kit.redeem")} note={t("kit.redeem.n")}>
      <div className="card">
        <div className="card-h">
          <div className="who-line"><KeySeal pk={PK.Alice} size="lg" rim /><div><div className="t-h4">{t("kit.redeem.title")}</div><div className="t-small">{t("kit.redeem.sub", { v: money(1240), p: "132 ⁠%" })}</div></div></div>
          <Tag tone="metal">{t("kit.tag.onErgo")}</Tag>
        </div>
        <div className="card-b" style={{ display: "grid", gap: 22 }}>
          <Tear keep={740} torn={500} style={{ maxWidth: 440 }} />
          <OdoLedger debt={1240} redeemed={500} />
          <Ledger
            rows={[
              { label: t("kit.redeem.from"), value: <>{money(500)}{" "}ERG</> },
              { label: <>{t("kit.redeem.fee")} <span className="mono">· {t("kit.redeem.fee.s")}</span></>, value: money(0) },
              { label: <>{t("kit.redeem.net")} <span className="mono">· {t("kit.redeem.net.s")}</span></>, value: <>0.001{" "}ERG</> },
            ]}
            sum={{ label: t("kit.redeem.get"), value: <>{money(500)}{" "}ERG</>, tone: "metal" }}
          />
          <div className="check-grid">
            <span>✓ {t("kit.redeem.c1")}</span><span>✓ {t("kit.redeem.c2")}</span><span>✓ {t("kit.redeem.c3")}</span><span>✓ {t("kit.redeem.c4", { p: "140 ⁠%" })}</span>
          </div>
        </div>
        <div className="card-f"><Key variant="metal" size="lg" hold block onAct={() => toast.metal(t("kit.toast.metal"), t("kit.toast.metal.d"))}>{t("kit.redeem.hold", { v: money(500) })}</Key></div>
        <p className="t-small" style={{ padding: "0 20px 18px", margin: 0 }}>{t("kit.redeem.foot", { v: money(500) })}</p>
      </div>
    </Spec>
  );
}

function WalletTop() {
  const t = useT();
  return (
    <Spec tag="<BackedTrustBar backed>" name={t("kit.wallet.top")} note="390">
      <div className="card kit-phone-list"><div className="card-b">
        <div className="label spread"><span>{t("kit.wallet.net")}</span><span>{t("kit.wallet.more")}</span></div>
        <div className="t-money" style={{ fontSize: 72, lineHeight: 1, marginTop: 8, letterSpacing: "-.02em" }}>{signed(1617.4, 2, "favour")}</div>
        <div className="kit-sides">
          <div style={{ borderTopColor: "var(--up)" }}><div className="label">{t("kit.wallet.owed")}</div><div className="v">{money(1950)}</div><div className="t-small">{t("kit.wallet.n3")}</div></div>
          <div style={{ textAlign: "right" }}><div className="label">{t("kit.wallet.owe")}</div><div className="v">{money(332.6)}</div><div className="t-small">{t("kit.wallet.n2")}</div></div>
        </div>
        <div style={{ marginTop: 16 }}><BackedTrustBar backed={0.85} /></div>
      </div></div>
    </Spec>
  );
}

function WalletRows() {
  const t = useT();
  const { lang } = useLang();
  return (
    <Spec tag="<KeySeal badge> <MiniCap used kind>" name={t("kit.wallet.rows")} note={t("kit.wallet.rows.n")}>
      <div className="card kit-phone-list"><div className="card-b">
        <div className="spread"><span className="label"><b>{t("kit.tab.notes")}</b> · 5</span><span className="label">{t("kit.wallet.sorted")}</span></div>
        <div className="rows" style={{ marginTop: 4 }}>
          {WALLET_ROWS.map((r) => (
            <div className="row" key={r.name} style={{ padding: "12px 0", gap: 12 }}>
              <KeySeal pk={PK[r.name]} agent={isAgent(r.name)} badge={<Lamp state="committed" size={9} />} />
              <div style={{ minWidth: 0 }}>
                <div className="who" style={{ fontSize: 15.5 }}>{r.name}{isAgent(r.name) && <AgentTag small />}</div>
                <div className="what" style={{ fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{rich(lang === "ru" ? r.whatRu : r.what)}</div>
                <MiniCap used={r.used} kind={r.kind} width={150} />
              </div>
              <div className={`amt${r.dir === "in" ? " in" : ""}`} style={{ fontSize: 16 }}>
                <Num value={r.amount} sign={r.dir === "in" ? "favour" : "owe"} />
                <small style={r.dir === "in" && r.sub.startsWith("+") ? { color: "var(--up)" } : undefined}>{lang === "ru" ? r.subRu : r.sub}</small>
              </div>
            </div>
          ))}
        </div>
      </div></div>
    </Spec>
  );
}

export function FlowsSection() {
  const t = useT();
  return (
    <Section id="flows" no={`06 · ${t("kit.s.flows")}`} title={rich(t("kit.s.flows.t"))} lede={t("kit.s.flows.l")}>
      <div className="grid-2" style={{ alignItems: "start" }}>
        <PayCard />
        <RedeemCard />
      </div>
      <div className="kit-gap" />
      <div className="grid-2" style={{ alignItems: "start" }}>
        <WalletTop />
        <WalletRows />
      </div>
    </Section>
  );
}

