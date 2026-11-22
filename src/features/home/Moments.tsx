// 01 Five moments (content `moments`): one column per moment with an interactive miniature driven by the same
// story economy as the hero note — raise (odometer), two stamps (the real signature bytes), the committed digest
// (a real lookup proof), the reserve coin (top up) and the tear-off (a redemption the contract evaluates).
import { createContext, memo, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { rich, useLang, useT } from "@/app/lang";
import { copy, moments, momentsLede, pick, type Moment } from "@/content";
import { Coin, CoverageMeter, inksFor, Key, KeySeal, Lamp, money, int, Note, prefersReducedMotion, Section, short, Tear, usePulseClass, type NoteProps } from "@/ui";
import { hexToBytes } from "@/protocol";
import { DigestGlyph } from "@/viz";
import { STORY, TRACKER_ID, TRACKER_NAME } from "./story";
import { useStory, type StoryView } from "./useStory";

/** The minis read the story one step behind the hero (useDeferredValue): the hero note renders first, and the
 *  five miniatures follow in a background render, so neither makes a long main-thread task. */
const MiniCtx = createContext<StoryView | null>(null);
const useMini = (): StoryView => useContext(MiniCtx) ?? { phase: "boot", snap: null, error: null, v: 0, store: null };

const ZERO_SIG = "00".repeat(65);

/** Renders content text, with backtick spans as <code>. */
export function CodeText({ text }: { text: string }) {
  const parts = text.split("`");
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <span key={i}>{p}</span>))}</>;
}

function useNames() {
  const t = useT();
  return { issuer: t("home.name.alice"), receiver: t("home.name.bobOnNote") };
}

/* ---------- i. Promise: raise the total; the odometer rolls and the old version slides behind ---------- */
function PromiseMini() {
  const t = useT();
  const { snap } = useMini();
  const names = useNames();
  const [raised, setRaised] = useState(false);
  const [round, setRound] = useState(0);
  if (!snap?.v1 || !snap.v2 || !snap.genesis) return <MiniWait />;
  const base: Partial<NoteProps> & Pick<NoteProps, "issuer" | "receiver"> = {
    ...names, issuerPk: snap.alicePub, receiverPk: snap.bobPub, noteKey: snap.noteKey, limit: STORY.limit, tracker: TRACKER_NAME, trackerId: TRACKER_ID,
    digest: snap.genesis.digest, block: snap.genesis.height, lite: true, decorative: true,
  };
  const from = snap.v1.total, to = snap.v2.total;
  return (
    <>
      <div className="vis mini-promise" data-raised={raised || undefined} role="img" aria-label={t("home.m.promise.alt", { from: money(from), to: money(to) })}>
        <div className="mp-stack" key={round}>
          <div className="mp-back"><Note {...base} amount={from} prev={snap.v0?.total ?? null} state="tracked" sigA={snap.v1.sigA} sigT={snap.v1.sigT ?? ZERO_SIG} /></div>
          <div className="mp-front">
            <Note {...base} amount={raised ? to : from} prev={raised ? from : snap.v0?.total ?? null} state={raised ? "signed" : "tracked"} odometer
              sigA={raised ? snap.v2.sigA : snap.v1.sigA} sigT={raised ? ZERO_SIG : snap.v1.sigT ?? ZERO_SIG} />
          </div>
          <span className="mp-tag mono" aria-hidden="true">{t("home.m.promise.tag", { v: "+" + money(STORY.raise) })}</span>
        </div>
      </div>
      <div className="mini-act">
        {raised
          ? <Key size="sm" variant="quiet" icon="loop" onClick={() => { setRaised(false); setRound((r) => r + 1); }}>{t("home.m.promise.again")}</Key>
          : <Key size="sm" icon="plus" onClick={() => setRaised(true)}>{t("home.m.promise.key", { v: money(STORY.raise) })}</Key>}
        {/* the thumbnail's text label (VISUAL §4.2): who, amount, state — in words, with the lamp's shape */}
        <span className="mini-out" aria-live="polite">
          <span className="st-line">
            <Lamp state={raised ? "signed" : "tracked"} size={8} />
            <span>{raised ? t("home.m.promise.done", { from: money(from), to: money(to) }) : t("home.m.promise.idle", { v: money(from) })}</span>
          </span>
        </span>
      </div>
    </>
  );
}

/* ---------- ii. Stamp: Alice's signature, then T-01's, over the same 80 bytes ---------- */
function StampDisc({ sig, pk, label, ink, cls }: { sig: string; pk: string; label: string; ink: string; cls: string }) {
  const a = sig.slice(0, 66).toUpperCase(), z = sig.slice(66).toUpperCase();
  const id = `${cls}-${sig.slice(2, 10)}`;
  return (
    <span className={`stamp ${cls}`} style={{ "--st": ink } as CSSProperties} aria-hidden="true">
      <svg viewBox="0 0 120 120" width="120" height="120">
        <defs>
          <path id={`${id}o`} d="M60 60 m-51 0 a51 51 0 1 1 102 0 a51 51 0 1 1 -102 0" />
          <path id={`${id}i`} d="M60 60 m-41.5 0 a41.5 41.5 0 1 1 83 0 a41.5 41.5 0 1 1 -83 0" />
        </defs>
        <circle cx="60" cy="60" r="57" className="st-ring" />
        <circle cx="60" cy="60" r="46.5" className="st-ring thin" />
        <circle cx="60" cy="60" r="36" className="st-ring thin" />
        <text className="st-micro"><textPath href={`#${id}o`} textLength="318" lengthAdjust="spacingAndGlyphs">A {a}</textPath></text>
        <text className="st-micro in"><textPath href={`#${id}i`} textLength="258" lengthAdjust="spacingAndGlyphs">Z {z}</textPath></text>
      </svg>
      <span className="st-seal"><KeySeal pk={pk} size={44} /></span>
      <span className="st-name">{label}</span>
    </span>
  );
}

function StampMini() {
  const t = useT();
  const { snap } = useMini();
  const [n, setN] = useState(0);
  const [round, setRound] = useState(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const v = snap?.v2 ?? snap?.v1;
  const ink = useMemo(() => (snap ? inksFor(hexToBytes(snap.noteKey)) : null), [snap?.noteKey]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!snap || !v || !v.sigT || !ink) return <MiniWait />;
  const go = () => {
    timers.current.forEach(clearTimeout);
    if (prefersReducedMotion()) { setN(2); return; }
    setN(1);
    timers.current = [setTimeout(() => setN(2), 650)];
  };
  const line = (who: string, sig: string, ok: boolean) => (
    <span className={`st-line${ok ? "" : " bad"}`}>
      <Lamp state={ok ? "committed" : "alarm"} size={8} />
      <span><span className="mono">{t("home.m.stamp.line", { who, a: sig.slice(0, 6), z: sig.slice(66, 72) })}</span> <b>{ok ? t("home.m.stamp.ok") : t("home.m.stamp.bad")}</b></span>
    </span>
  );
  return (
    <>
      <div className="vis mini-stamp" data-n={n} key={round} role="img" aria-label={t("home.m.stamp.alt")}>
        <MessageSlip hex={v.message} head={t("home.m.stamp.msg")} legend={[t("home.m.stamp.f.key"), t("home.m.stamp.f.total"), t("home.m.stamp.f.time"), t("home.m.stamp.f.tracker")]} />
        <StampDisc sig={v.sigA} pk={snap.alicePub} label={t("home.m.stamp.issuer")} ink={ink.a.c} cls="st-a" />
        <StampDisc sig={v.sigT} pk={snap.trackerPub} label={t("home.m.stamp.tracker")} ink={ink.b.c} cls="st-t" />
      </div>
      <div className="mini-act">
        {n === 2
          ? <Key size="sm" variant="quiet" icon="loop" onClick={() => { setN(0); setRound((r) => r + 1); }}>{t("home.m.stamp.again")}</Key>
          : <Key size="sm" icon="stamp" onClick={go} disabled={n === 1}>{t("home.m.stamp.key")}</Key>}
        <span className="mini-out" aria-live="polite">
          {n === 0 && <span>{t("home.m.stamp.idle", { v: money(v.total) })}</span>}
          {n >= 1 && line(t("home.m.stamp.issuer"), v.sigA, v.issuerOk)}
          {n >= 2 && line(t("home.m.stamp.tracker"), v.sigT, v.trackerOk)}
        </span>
      </div>
    </>
  );
}

/** The 80 signed bytes on a paper slip, by field (VISUAL §12.1 machine face: key ink · total metal · time up ·
 *  tracker ink-3): what both stamps sign. Decorative; the mini's label says it in words. */
const FIELDS: [string, number][] = [["k", 32], ["t", 8], ["ts", 8], ["n", 32]];
function MessageSlip({ hex, head, legend }: { hex: string; head: string; legend: string[] }) {
  const cells = useMemo(() => {
    const out: { b: string; f: string }[] = [];
    let at = 0;
    for (const [f, len] of FIELDS) for (let i = 0; i < len; i++, at++) out.push({ b: hex.slice(at * 2, at * 2 + 2), f });
    return out;
  }, [hex]);
  return (
    <div className="ms-slip" aria-hidden="true">
      <span className="ms-h">{head}</span>
      <span className="ms-hex">{cells.map((c, i) => <i key={i} className={c.f}>{c.b}</i>)}</span>
      <span className="ms-legend">{FIELDS.map(([f, len], i) => <span key={f} className={f}><i />{legend[i]} {len}</span>)}</span>
    </div>
  );
}

/* ---------- iii. Trust: the committed digest as a fingerprint; check the note with a lookup proof ---------- */
function TrustMini() {
  const t = useT();
  const { snap, phase, store } = useMini();
  const ref = useRef<HTMLDivElement>(null);
  usePulseClass(ref, (p) => p.trackerId === TRACKER_ID);
  if (!snap?.genesis) return <MiniWait />;
  const box = snap.commit;
  const committed = phase === "committed" && !!box;
  const digest = committed ? box!.digest : snap.genesis.digest;
  const p = snap.proof;
  return (
    <>
      <div className="vis mini-trust" ref={ref} role="img" aria-label={t("home.m.trust.alt")}>
        <div className="mt-note" aria-hidden="true"><span className="mono">{short(snap.noteKey, 4, 4)}</span><b className="num">{money(committed ? STORY.first + STORY.raise : STORY.first)}</b></div>
        <div className="mt-wire" aria-hidden="true"><i /></div>
        <div className="mt-box">
          <DigestGlyph digest={digest} size={112} holo={committed} stale={!committed} title={digest} />
          <span className="mono mt-dg">{short(digest, 6, 4)}</span>
        </div>
      </div>
      <div className="mini-act">
        <Key size="sm" icon="check" onClick={() => store?.check()} disabled={!committed}>{t("home.m.trust.key")}</Key>
        <span className="mini-out" aria-live="polite">
          {p ? (
            <span className={`st-line${p.match ? "" : " bad"}`}>
              <Lamp state={p.match ? "committed" : "alarm"} size={8} />
              <span className="st-stack">
                <b>{p.match && p.total != null ? t("home.m.trust.match", { v: money(p.total) }) : t("home.m.trust.mismatch")}</b>
                <span className="mono">{t("home.m.trust.proof", { n: int(p.bytes), how: p.verifier === "stateless" ? t("home.m.trust.stateless") : t("home.m.trust.replayed") })}</span>
              </span>
            </span>
          ) : (
            <span className="st-line">
              <Lamp state={committed ? "committed" : "tracked"} size={8} />
              <span>{committed ? t("home.m.trust.box", { n: int(box!.height), notes: t.p("home.tape.notes", box!.notes) }) : t("home.m.trust.wait")}</span>
            </span>
          )}
        </span>
      </div>
    </>
  );
}

/* ---------- iv. Back: the reserve coin and the coverage meter (150 / 120 / 100 % are wallet policy) ---------- */
function BackMini() {
  const t = useT();
  const { lang } = useLang();
  const { snap, store } = useMini();
  const [ghost, setGhost] = useState<number | undefined>(undefined);
  if (!snap?.reserve || snap.reserve.coverage == null) return <MiniWait />;
  const cov = snap.reserve.coverage;
  const owes = (snap.v2 ? snap.v2.total : snap.v1?.total ?? 0) - snap.redeemed;
  return (
    <>
      <div className="vis mini-back">
        <Coin coverage={cov} size={108} />
        <div className="mb-meter">
          <CoverageMeter value={cov} ghost={ghost} scale={false} />
          <span className="mb-policy">{pick(copy.thresholdsArePolicy, lang)}</span>
        </div>
      </div>
      <div className="mini-act">
        <Key size="sm" icon="plus" onClick={() => { setGhost(cov); store?.topUp(); }}>{t("home.m.back.key", { v: money(STORY.topUp) })}</Key>
        <span className="mini-out" aria-live="polite">{t("home.m.back.reserve", { r: money(snap.reserve.collateral), o: money(owes) })}</span>
      </div>
    </>
  );
}

/* ---------- v. Redeem: hold to tear part of the note off; the contract pays it from Alice's reserve ---------- */
function RedeemMini() {
  const t = useT();
  const { snap, phase, store } = useMini();
  if (!snap?.v1) return <MiniWait />;
  const total = snap.v2 ? snap.v2.total : snap.v1.total;
  const outstanding = Math.max(0, total - snap.redeemed);
  const amount = Math.min(STORY.redeem, outstanding);
  const ready = phase === "committed" && !!snap.commit;
  const last = snap.lastRedeem;
  return (
    <>
      <div className="vis mini-redeem" role="img" aria-label={t("home.m.redeem.alt", { v: money(STORY.redeem) })}>
        {last?.ok
          ? <Tear keep={outstanding} torn={last.amount} keepLabel={t("home.m.redeem.keep")} tornLabel={t("home.m.redeem.torn")} />
          : (
            <div className="mr-whole" aria-hidden="true">
              <div className="keep"><div className="v">{money(total)}</div><div className="l">{t("home.m.redeem.whole")}</div></div>
              <div className="stub"><div className="v">{money(amount || STORY.redeem)}</div><div className="l">{t("home.m.redeem.stub")}</div></div>
            </div>
          )}
      </div>
      <div className="mini-act">
        <Key size="sm" variant="metal" hold onAct={() => store?.redeem()} disabled={!ready || amount <= 0}>{t("home.m.redeem.key", { v: money(amount || STORY.redeem) })}</Key>
        <span className="mini-out" aria-live="polite">
          {!ready && <span>{t("home.m.redeem.wait")}</span>}
          {ready && !last && amount > 0 && <span>{t("home.m.redeem.idle", { o: money(outstanding) })}</span>}
          {last && (last.ok
            ? <span className="mr-done">
                <b>{t("home.m.redeem.done", { r: money(snap.redeemed), o: money(outstanding), t: money(total) })}</b>
                <span className="mono">{t("home.m.redeem.contract", { passed: last.passed, checks: last.checks, tx: short(last.txId ?? "", 4, 4) })}</span>
              </span>
            : <span className="st-line bad"><Lamp state="alarm" size={8} /><b>{t("home.m.redeem.refused", { code: last.code ?? "?" })}</b></span>)}
          {ready && amount <= 0 && <span>{t("home.m.redeem.empty")}</span>}
        </span>
      </div>
    </>
  );
}

function MiniWait() {
  const t = useT();
  return (
    <>
      <div className="vis mini-wait"><span className="skel" aria-hidden="true"><i /><i /><i /></span></div>
      <div className="mini-act"><span className="mini-out">{t("home.m.wait")}</span></div>
    </>
  );
}

// memo: the minis take no props and re-render only when the (deferred) story context changes
const MINIS: Record<Moment["id"], ComponentType> = {
  promise: memo(PromiseMini),
  stamp: memo(StampMini),
  trust: memo(TrustMini),
  back: memo(BackMini),
  redeem: memo(RedeemMini),
};

export function Moments() {
  const t = useT();
  const { lang } = useLang();
  const story = useDeferredValue(useStory());
  const ordered = useMemo(() => [...moments].sort((a, b) => a.n - b.n), []);
  return (
    <Section id="moments" className="home-moments" no={<>01 · {t("home.m.no")}</>} title={rich(t("home.m.title"))} lede={pick(momentsLede, lang)}>
      <p className="home-sandbox-note label"><Lamp state="live" size={8} /><b>{t("home.m.sandbox")}</b></p>
      <MiniCtx.Provider value={story}>
      <div className="home-mgrid">
        {ordered.map((m) => {
          const Mini = MINIS[m.id];
          return (
          <article key={m.id} className={`moment m-${m.id}`} aria-labelledby={`m-${m.id}-h`}>
            <Mini />
            <div className="ix" aria-hidden="true">{m.numeral.toLowerCase()}.</div>
            <h3 id={`m-${m.id}-h`}>{pick(m.title, lang)}</h3>
            <p><CodeText text={pick(m.text, lang)} /></p>
            {/* the protocol fact is for developers: folded, so the two sentences above are what a newcomer reads (М8) */}
            <details className="fact-d">
              <summary>{t("home.m.dev")}</summary>
              <div className="fact">{pick(m.fact, lang)}</div>
            </details>
            <Link className="textlink m-ch" to={`/learn/how#${m.chapter}`}>{t("home.m.chapter")} <span aria-hidden="true">→</span></Link>
          </article>
          );
        })}
      </div>
      </MiniCtx.Provider>
    </Section>
  );
}
