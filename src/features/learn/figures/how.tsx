// Figures for /learn/how, one per chapter (content's FigureId). Everything that looks like a number is either a
// constant of the protocol or comes out of the engine in this page (sandbox keys, play money), and says so.
import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/app";
import {
  Bytes, Coin, Key, KeySeal, Lamp, Ledger, Note, Num, OdoLedger, Seg, Tear, TrackerTile,
  blk, blocksAndTime, money, pct, short, useIsPhone, useUid, withUnit,
} from "@/ui";
import { DigestGlyph, ExitClocks, LAB_DEFAULT_TS, LAB_TRACKER_NFT, StatusLadder, labKey } from "@/viz";
import {
  EMPTY_AVL_DIGEST_HEX, EMERGENCY_BLOCKS, REFUND_PERIOD_BLOCKS, bytesToHex, debtKey, erg as toNano, noteMessage, sign,
  trackerTreeValue, type AuthenticatedMap, type NoteStatus,
} from "@/protocol";
import { noteStatuses, pick } from "@/content";
import { Fig, SandboxTag } from "../layout";
import { LAB_HEIGHT, useAvl, useNear } from "../lab";

type Name = "Alice" | "Bob" | "Carol" | "Dave";
const nameKey = (n: Name) => `learn.name.${n.toLowerCase()}`;

/* ------------------------------------------------------------ 1 · the note odometer */

const LIMIT = 2000;
const STEP = 240;

export function NoteOdometerFig({ n }: { n: string }) {
  const t = useT();
  const alice = labKey("Alice");
  const bob = labKey("Bob");
  const key = useMemo(() => debtKey(alice.pub, bob.pub), [alice, bob]);
  const sigFor = (total: number, i: number) => bytesToHex(sign(noteMessage(key, toNano(String(total)), LAB_DEFAULT_TS + BigInt(i) * 600_000n, LAB_TRACKER_NFT), alice));
  const [versions, setVersions] = useState<{ total: number; sig: string }[]>(() => [{ total: 1000, sig: sigFor(1000, 0) }]);
  const cur = versions[versions.length - 1];
  const prev = versions.length > 1 ? versions[versions.length - 2].total : null;
  const canRaise = cur.total + STEP <= LIMIT;
  const raise = () => setVersions((v) => {
    const last = v[v.length - 1];
    return last.total + STEP > LIMIT ? v : [...v, { total: last.total + STEP, sig: sigFor(last.total + STEP, v.length) }];
  });
  return (
    <Fig n={n} caption={t("learn.f.odo.cap")} tag={<SandboxTag />} wide>
      <div className="hw-note">
        <div className="note-wrap">
          <Note
            issuer={t("learn.name.alice")} receiver={t("learn.name.bob")} issuerPk={alice.pubHex} receiverPk={bob.pubHex} noteKey={key}
            amount={cur.total} prev={prev} limit={LIMIT} state="signed" tracker="T-01" digest={EMPTY_AVL_DIGEST_HEX} block={LAB_HEIGHT}
            sigA={cur.sig} odometer
          />
        </div>
        <div>
          <div className="label" style={{ marginBottom: 10 }}>{t("learn.f.odo.hist")}</div>
          <div className="hw-hist" aria-live="polite">
            {versions.map((v, i) => (
              <div key={i} className={i === versions.length - 1 ? "cur" : undefined}>
                <span className="v">{t("learn.f.odo.v", { n: i + 1 })}</span>
                <span className="w">{i === 0 ? t("learn.f.odo.first") : t("learn.f.odo.replaces", { n: i })} · <span className="mono">{short(v.sig, 4, 4)}</span></span>
                <span className="a">{money(v.total)}</span>
              </div>
            ))}
          </div>
          <div className="hw-ctl">
            <Key size="sm" variant="primary" icon="plus" onClick={raise} disabled={!canRaise}>{t("learn.f.odo.raise", { v: money(STEP) })}</Key>
            {versions.length > 1 && <Key size="sm" variant="quiet" onClick={() => setVersions((v) => [v[0]])}>{t("learn.reset")}</Key>}
          </div>
          <p className="t-small" style={{ marginTop: 12 }}>{t("learn.f.odo.limit", { v: money(LIMIT) })}</p>
        </div>
      </div>
    </Fig>
  );
}

/* ------------------------------------------------------------ 2 · the 80 bytes */

function utc(ms: bigint): string {
  const d = new Date(Number(ms));
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
}

export function MessageFig({ n }: { n: string }) {
  const t = useT();
  const phone = useIsPhone();
  const d = useMemo(() => {
    const alice = labKey("Alice");
    const bob = labKey("Bob");
    const key = debtKey(alice.pub, bob.pub);
    const msg = noteMessage(key, toNano("1240"), LAB_DEFAULT_TS, LAB_TRACKER_NFT);
    return { key, msg, sig: sign(msg, alice) };
  }, []);
  const cols = phone ? 8 : 16;
  return (
    <Fig n={n} caption={t("learn.f.msg.cap")} tag={<SandboxTag />} wide>
      <div className="label" style={{ marginBottom: 12 }}><b>{t("learn.f.msg.message")}</b></div>
      <Bytes
        cols={cols}
        segments={[
          { label: t("learn.f.msg.key"), bytes: d.msg.slice(0, 32), tone: "k", value: short(bytesToHex(d.key), 6, 4) },
          { label: t("learn.f.msg.total"), bytes: d.msg.slice(32, 40), tone: "t", value: withUnit(money(1240), "ERG") },
          { label: t("learn.f.msg.ts"), bytes: d.msg.slice(40, 48), tone: "ts", value: utc(LAB_DEFAULT_TS) },
          { label: t("learn.f.msg.nft"), bytes: d.msg.slice(48, 80), tone: "n", value: short(LAB_TRACKER_NFT, 6, 4) },
        ]}
      />
      <div className="label" style={{ margin: "26px 0 12px" }}><b>{t("learn.f.msg.signature")}</b></div>
      <Bytes cols={cols} segments={[{ label: t("learn.f.msg.a"), bytes: d.sig.slice(0, 33), tone: "g" }, { label: t("learn.f.msg.z"), bytes: d.sig.slice(33), tone: "plain" }]} />
      <div className="hw-ctl" style={{ marginTop: 22 }}>
        <Key size="sm" icon="right" to="/learn/signature#xray">{t("learn.f.msg.lab")}</Key>
      </div>
    </Fig>
  );
}

/* ------------------------------------------------------------ 3 · two stamps and the ladder */

export function StampsFig({ n }: { n: string }) {
  const t = useT();
  const [status, setStatus] = useState<NoteStatus>("pending");
  const sig = useMemo(() => {
    const alice = labKey("Alice");
    return bytesToHex(sign(noteMessage(debtKey(alice.pub, labKey("Bob").pub), toNano("1240"), LAB_DEFAULT_TS, LAB_TRACKER_NFT), alice));
  }, []);
  const H = LAB_HEIGHT + 40;
  const ladder =
    status === "local" ? { status, height: H, lastCommitHeight: H - 3 }
      : status === "pending" ? { status, height: H, lastCommitHeight: H }
        : { status, height: H + 2, lastCommitHeight: H, redeemable: toNano("1240") };
  const stage = status === "local" ? 2 : 3;
  return (
    <Fig n={n} caption={t("learn.f.st.cap")} wide bare>
      <div className="hw-stamps">
        <div className="hw-stamp">
          <div className="who"><KeySeal pk={labKey("Alice").pubHex} size="sm" /><b>{t("learn.f.st.s1")}</b></div>
          <p>{t("learn.f.st.s1d")}</p>
          <span className="mono">a‖z {short(sig, 6, 6)}</span>
        </div>
        <div className={stage >= 2 ? "hw-stamp" : "hw-stamp dim"}>
          <div className="who"><TrackerTile id="T-01" size="sm" /><b>{t("learn.f.st.s2")}</b></div>
          <p>{t("learn.f.st.s2d")}</p>
        </div>
        <div className={stage >= 3 ? "hw-stamp" : "hw-stamp dim"}>
          <div className="who"><Lamp state={status === "confirmed" ? "committed" : status === "pending" ? "tracked" : "off"} /><b>{t("learn.f.st.s3")}</b></div>
          <p>{t("learn.f.st.s3d")}</p>
        </div>
      </div>
      <div className="lab-bar start" style={{ margin: "20px 0 14px" }}>
        <span className="label">{t("learn.f.st.ladder")}</span>
        <Seg
          ariaLabel={t("learn.f.st.ladder")}
          value={status}
          onChange={setStatus}
          options={(["local", "pending", "confirmed"] as NoteStatus[]).map((s) => ({ value: s, label: pick(noteStatuses[s], t.lang) }))}
        />
      </div>
      <StatusLadder {...ladder} commitIntervalBlocks={5} minDepth={2} />
    </Fig>
  );
}

/* ------------------------------------------------------------ 4 · one commitment, one new digest */

const PLAN: [Name, Name, string][] = [
  ["Alice", "Bob", "1000"], ["Carol", "Alice", "300"], ["Alice", "Bob", "1240"], ["Bob", "Carol", "75.5"],
  ["Dave", "Alice", "42"], ["Alice", "Bob", "1480"], ["Carol", "Dave", "12.25"], ["Bob", "Carol", "90"],
];

export function DigestFig({ n }: { n: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref, "1200px");
  const [idle, setIdle] = useState(false);
  useEffect(() => { const id = window.setTimeout(() => setIdle(true), 2500); return () => window.clearTimeout(id); }, []);
  const avl = useAvl(near || idle);
  const mapRef = useRef<AuthenticatedMap | null>(null);
  const [hist, setHist] = useState<{ digest: string; wrote: [Name, Name, string] | null }[]>([{ digest: EMPTY_AVL_DIGEST_HEX, wrote: null }]);
  useEffect(() => { if (avl && !mapRef.current) mapRef.current = avl.backend.createMap(32); }, [avl]);
  const commit = () => {
    const map = mapRef.current;
    if (!map) return;
    const step = PLAN[(hist.length - 1) % PLAN.length];
    const [a, b, v] = step;
    map.insertOrUpdate(debtKey(labKey(a).pub, labKey(b).pub), trackerTreeValue(toNano(v)));
    setHist((h) => [...h.slice(-5), { digest: bytesToHex(map.digest()), wrote: step }]);
  };
  const reset = () => { if (avl) mapRef.current = avl.backend.createMap(32); setHist([{ digest: EMPTY_AVL_DIGEST_HEX, wrote: null }]); };
  const now = hist[hist.length - 1];
  const before = hist.length > 1 ? hist[hist.length - 2] : null;
  const size = mapRef.current?.size ?? 0;
  const pair = (w: [Name, Name, string]) => t("learn.f.dg.wrote", { pair: t("learn.pair", { a: t(nameKey(w[0])), b: t(nameKey(w[1])) }), v: money(Number(w[2])) });
  return (
    <Fig n={n} caption={t("learn.f.dg.cap")} tag={<SandboxTag />} wide>
      <div className="hw-digest" ref={ref}>
        <div className="glyphs" aria-hidden="true">
          {before && <><DigestGlyph digest={before.digest} size={64} stale /><span className="arrow">→</span></>}
          <DigestGlyph key={now.digest} digest={now.digest} size={104} holo ping={!!before} />
        </div>
        <div className="hw-dg-rows">
          {before && (
            <div className="hw-dg-row">
              <span className="label">{t("learn.f.dg.before")}</span>
              <span className="hex">{now.digest === EMPTY_AVL_DIGEST_HEX ? "" : before.digest}</span>
            </div>
          )}
          <div className="hw-dg-row now">
            <span className="label"><b>{before ? t("learn.f.dg.after") : "R5"}</b></span>
            <span className="hex">{now.digest}</span>
          </div>
          <div className="hw-dg-entries">
            {now.wrote ? <>{pair(now.wrote)} · {t.p("learn.f.dg.entries", size)}</> : t("learn.f.dg.empty")}
          </div>
          <div className="hw-ctl" style={{ marginTop: 6 }}>
            <Key size="sm" variant="primary" icon="stamp" onClick={commit} disabled={!avl}>{t("learn.f.dg.commit")}</Key>
            {hist.length > 1 && <Key size="sm" variant="quiet" onClick={reset}>{t("learn.reset")}</Key>}
            <span className="t-small">{avl ? t("learn.f.dg.backend", { b: t(avl.real ? "viz.backend.wasm" : "viz.backend.simulated") }) : t("learn.av.loading")}</span>
          </div>
        </div>
      </div>
    </Fig>
  );
}

/* ------------------------------------------------------------ 5 · the reserve box */

export function RegistersFig({ n }: { n: string }) {
  const t = useT();
  const alice = labKey("Alice");
  const rows: [string, string, string, string][] = [
    ["R4", t("learn.f.rg.r4"), "GroupElement", `${short(alice.pubHex, 8, 6)} · ${t("learn.f.rg.r4v")}`],
    ["R5", t("learn.f.rg.r5"), "AvlTree", `${short(EMPTY_AVL_DIGEST_HEX, 8, 6)} · ${t("learn.f.rg.r5v")}`],
    ["R6", t("learn.f.rg.r6"), "Coll[Byte]", `${short(LAB_TRACKER_NFT, 8, 6)} · ${t("learn.f.rg.r6v")}`],
    ["R7", t("learn.f.rg.r7"), "Long", t("learn.f.rg.r7v")],
  ];
  return (
    <Fig n={n} caption={t("learn.f.rg.cap")} tag={<SandboxTag />} wide>
      <div className="hw-regs">
        <div className="coin-col" style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center" }}>
          <Coin coverage={132} size={170} />
          <p className="t-small" style={{ maxWidth: 220 }}>{t("learn.f.rg.coin", { pct: pct(132), locked: money(1640), owed: money(1240) })}</p>
        </div>
        <div className="hw-reg-list">
          {rows.map(([r, w, ty, x]) => (
            <div className="hw-reg" key={r}>
              <span className="r">{r}</span>
              <span><span className="w">{w}</span><span className="ty">{ty}</span></span>
              <span className="x">{x}</span>
            </div>
          ))}
        </div>
      </div>
    </Fig>
  );
}

export { SpectrumFig } from "./spectrum";

/* ------------------------------------------------------------ 7 · the tear-off */

export function RedeemFig({ n }: { n: string }) {
  const t = useT();
  return (
    <Fig n={n} caption={t("learn.f.rd.cap")} tag={<SandboxTag />} wide>
      <div className="hw-redeem">
        <div>
          <OdoLedger debt={1240} redeemed={500} />
          <div className="hw-tear">
            <Tear keep={740} torn={500} keepLabel={t("learn.f.rd.keep")} tornLabel={t("learn.f.rd.torn")} />
          </div>
        </div>
        <Ledger
          rows={[
            { label: t("learn.f.rd.from"), value: <Num value={500} unit="ERG" /> },
            { label: t("learn.f.rd.fee"), sub: t("learn.f.rd.feeSub"), value: "0.00" },
            { label: t("learn.f.rd.miner"), sub: t("learn.f.rd.minerSub"), value: withUnit(money(0.001, 3), "ERG") },
          ]}
          sum={{ label: t("learn.f.rd.receive"), value: <Num value={500} unit="ERG" tone="metal" />, tone: "metal" }}
        />
      </div>
    </Fig>
  );
}

/* ------------------------------------------------------------ 8 · the dead-man switch */

export function EmergencyFig({ n }: { n: string }) {
  const t = useT();
  const id = useUid("em");
  // starts close to the 2 160-block line, so one short drag opens the path
  const [silent, setSilent] = useState(1850);
  return (
    <Fig n={n} caption={t("learn.f.em.cap")} bare>
      <div className="lab-run">
        <div className="hw-range">
          <label className="label" htmlFor={id}>{t("learn.f.em.silent")}</label>
          <input id={id} type="range" min={0} max={3000} step={10} value={silent} onChange={(e) => setSilent(Number(e.target.value))} />
          <output htmlFor={id}>{blk(silent, t.lang)}</output>
        </div>
        <SandboxTag />
      </div>
      <ExitClocks height={LAB_HEIGHT + silent} boxCreationHeight={LAB_HEIGHT} show="emergency" trackerName="T-01" />
    </Fig>
  );
}

/* ------------------------------------------------------------ 9 · both clocks to scale */

const SCALE = 46_000;
const at = (b: number) => `${(b / SCALE) * 100}%`;

export function TimelinesFig({ n }: { n: string }) {
  const t = useT();
  const days = [0, 10, 20, 30, 40, 50, 60];
  return (
    <Fig n={n} caption={t("learn.f.tl.cap")} wide minWidth={620}>
      <div className="hw-timeline">
        <div className="hw-tl-row">
          <div className="k"><b>{t("learn.f.tl.em")}</b>{blocksAndTime(EMERGENCY_BLOCKS, t.lang).split(" · ").map((x) => <span key={x}>{x}</span>)}</div>
          <div className="hw-tl-track">
            <span className="hw-tl-bar em" style={{ left: 0, width: at(EMERGENCY_BLOCKS) }} />
            <span className="hw-tl-tick" style={{ left: at(EMERGENCY_BLOCKS + 1) }}><span style={{ transform: "none" }}>{t("learn.f.tl.opens")} · {blk(EMERGENCY_BLOCKS + 1, t.lang)}</span></span>
          </div>
        </div>
        <div className="hw-tl-row">
          <div className="k"><b>{t("learn.f.tl.ex")}</b>{blocksAndTime(REFUND_PERIOD_BLOCKS, t.lang).split(" · ").map((x) => <span key={x}>{x}</span>)}</div>
          <div className="hw-tl-track">
            <span className="hw-tl-bar ex" style={{ left: 0, width: at(REFUND_PERIOD_BLOCKS) }} />
            <span className="hw-tl-tick" style={{ left: 0 }}><span style={{ transform: "none" }}>{t("learn.f.tl.r7")}</span></span>
            <span className="hw-tl-tick" style={{ left: at(REFUND_PERIOD_BLOCKS) }}><span style={{ transform: "translateX(-100%)" }}>{t("learn.f.tl.done")}</span></span>
          </div>
        </div>
        <div className="hw-tl-axis" aria-hidden="true">
          {days.map((d) => <span key={d} style={{ left: at(d * 720) }}>{d === 0 ? "0" : `${d} ${t("learn.f.tl.days")}`}</span>)}
        </div>
      </div>
    </Fig>
  );
}

/* ------------------------------------------------------------ 10 · a loop of debts */

const LOOP: { from: Name; to: Name; amount: number; key: "ab" | "bc" | "ca" }[] = [
  { from: "Alice", to: "Bob", amount: 0.5, key: "ab" },
  { from: "Bob", to: "Carol", amount: 0.6, key: "bc" },
  { from: "Carol", to: "Alice", amount: 0.4, key: "ca" },
];
const POS: Record<Exclude<Name, "Dave">, [number, number]> = { Alice: [170, 44], Bob: [292, 250], Carol: [48, 250] };

export function LoopFig({ n }: { n: string }) {
  const t = useT();
  const [cleared, setCleared] = useState(false);
  const min = Math.min(...LOOP.map((e) => e.amount));
  return (
    <Fig n={n} caption={t("learn.f.lp.cap")} tag={<SandboxTag />} wide>
      <div className="hw-loop">
        <div className="graph" style={{ position: "relative", width: "100%", maxWidth: 340, aspectRatio: "340 / 300" }}>
          <svg viewBox="0 0 340 300" aria-hidden="true" style={{ position: "absolute", inset: 0 }}>
            <defs>
              <marker id="lp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L10 5 L0 10 z" fill="var(--ink-2)" />
              </marker>
            </defs>
            {LOOP.map((e) => {
              const [x1, y1] = POS[e.from as "Alice"];
              const [x2, y2] = POS[e.to as "Alice"];
              const len = Math.hypot(x2 - x1, y2 - y1);
              const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
              const r = 36;
              const a = [x1 + ux * r, y1 + uy * r], b = [x2 - ux * (r + 4), y2 - uy * (r + 4)];
              const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
              const left = cleared ? e.amount - min : e.amount;
              return (
                <g key={e.key}>
                  <line className={left === 0 ? "edge cleared" : "edge"} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} markerEnd={left === 0 ? undefined : "url(#lp-arrow)"} />
                  <rect className="amt-bg" x={mx - 26} y={my - 12} width={52} height={24} rx={6} />
                  <text className="amt" x={mx} y={my + 4.5} textAnchor="middle">{money(left)}</text>
                </g>
              );
            })}
          </svg>
          {(Object.keys(POS) as (keyof typeof POS)[]).map((nm) => (
            <div key={nm} style={{ position: "absolute", left: `${(POS[nm][0] / 340) * 100}%`, top: `${(POS[nm][1] / 300) * 100}%`, transform: "translate(-50%, -50%)", display: "grid", justifyItems: "center", gap: 4 }}>
              <KeySeal pk={labKey(nm).pubHex} size={52} />
              <span className="label"><b>{t(nameKey(nm))}</b></span>
            </div>
          ))}
        </div>
        <div>
          <div className="hw-loop-rows">
            {LOOP.map((e) => (
              <div key={e.key}>
                <span>{t(`learn.f.lp.${e.key}`)}</span>
                {cleared ? <span className="was num">{money(e.amount)}</span> : <span />}
                <span className="num">{cleared && e.amount - min === 0 ? t("learn.f.lp.cleared") : withUnit(money(cleared ? e.amount - min : e.amount), "ERG")}</span>
              </div>
            ))}
          </div>
          <p className="t-small" style={{ marginTop: 14 }}>{t("learn.f.lp.net", { v: money(min) })}</p>
          <div className="hw-ctl">
            {!cleared
              ? <Key size="sm" variant="primary" icon="loop" onClick={() => setCleared(true)}>{t("learn.f.lp.clear", { v: money(min) })}</Key>
              : <Key size="sm" variant="quiet" onClick={() => setCleared(false)}>{t("learn.reset")}</Key>}
          </div>
        </div>
      </div>
    </Fig>
  );
}
