// «How it works» as a lit street of three stops: pay with a signed note (on trust: unlit) → the tracker records it
// (moonlight) → redeem on Ergo (gold light). The note signed live in this page by the story economy stands at the first
// stop, smaller; the stops light up as the story goes (the second one when T-01 commits the note). The three lights are
// the legend, told as the story rather than as a separate box.
import { useEffect, useMemo, useRef, useState } from "react";
import { rich, useT } from "@/app/lang";
import { Checks, Lamp, NoteStack, int, money, prefersReducedMotion, short, type NoteProps } from "@/ui";
import { STORY, storyKeys, TRACKER_ID, TRACKER_NAME } from "./story";
import { phaseAtLeast, useStory, type Phase } from "./useStory";

const ZERO_SIG = "00".repeat(65);
const CHECK_STAGE: Record<Phase, 0 | 1 | 2 | 3> = { boot: 0, open: 0, signed: 1, witnessed: 2, committed: 3 };

export function Street() {
  const t = useT();
  const { phase, snap, store } = useStory();
  const keys = useMemo(() => storyKeys(), []);
  const issuer = t("home.name.alice");
  const receiver = t("home.name.bobOnNote");

  const notes = useMemo(() => {
    if (!snap?.v0 || !snap.v1 || !snap.genesis) return null;
    const base = {
      issuer, receiver, issuerPk: snap.alicePub, receiverPk: snap.bobPub, noteKey: snap.noteKey, limit: STORY.limit,
      tracker: TRACKER_NAME, trackerId: TRACKER_ID,
    } satisfies Partial<NoteProps>;
    const g = snap.genesis;
    const raised = phaseAtLeast(phase, "signed") && snap.v2;
    const v = raised ? snap.v2! : snap.v1;
    const front: NoteProps = {
      ...base,
      amount: v.total,
      prev: raised ? snap.v1.total : snap.v0.total,
      settled: snap.redeemed,
      state: phase === "committed" && snap.commit ? "committed" : phase === "signed" ? "signed" : "tracked",
      digest: phase === "committed" && snap.commit ? snap.commit.digest : g.digest,
      block: phase === "committed" && snap.commit ? snap.commit.height : g.height,
      sigA: v.sigA,
      sigT: phase === "signed" ? ZERO_SIG : v.sigT ?? ZERO_SIG,
      live: true, odometer: true,
    };
    const back: NoteProps[] = raised
      ? [{ ...base, amount: snap.v1.total, prev: snap.v0.total, state: "tracked" as const, digest: g.digest, block: g.height, sigA: snap.v1.sigA, sigT: snap.v1.sigT ?? ZERO_SIG }]
      : [];
    return { front, back };
  }, [snap, phase, issuer, receiver]);

  // the older version joins the stack one task after the front note (each note's art is its own main-thread task)
  const backSig = notes ? notes.back.map((b) => b.amount).join("|") + issuer + receiver : "";
  const latest = useRef(notes);
  latest.current = notes;
  const [back, setBack] = useState<NoteProps[]>([]);
  useEffect(() => {
    if (!backSig) { setBack((b) => (b.length ? [] : b)); return; }
    const id = setTimeout(() => setBack(latest.current?.back ?? []), 0);
    return () => clearTimeout(id);
  }, [backSig]);

  const status = !snap
    ? t("home.stage.boot")
    : phase === "committed" && snap.commit
      ? t("home.stage.committed", { n: int(snap.commit.height) })
      : phase === "witnessed"
        ? t("home.stage.witnessed")
        : phase === "signed"
          ? t("home.stage.signed", { v: money(STORY.first + STORY.raise) })
          : t("home.stage.open", { v: money(STORY.first) });

  // what the note shows: three short readings, folded under it (they were the callouts around the big note)
  const readings = [
    { n: 1, k: t("home.c1.k"), a: t("home.c1.a"), b: t("home.c1.b") },
    { n: 2, k: t("home.c2.k"), a: t("home.c2.a"), b: rich(t("home.c2.b"), { key: <span className="home-key mono">{short(snap?.noteKey ?? keys.noteKey, 4, 4)}</span> }) },
    { n: 3, k: t("home.c3.k"), a: t("home.c3.a"), b: t("home.c3.b") },
  ];

  // the stops light as the story goes: the first as soon as a note is signed, the second once T-01 committed it
  const lit = [!!snap, phase === "committed" && !!snap?.commit, !!snap];
  const stops = [
    { id: "pay", light: "line", title: t("home.how.s1.t"), line: t("home.how.s1.b") },
    { id: "record", light: "light", title: t("home.how.s2.t"), line: t("home.how.s2.b") },
    { id: "redeem", light: "metal", title: t("home.how.s3.t"), line: t("home.how.s3.b") },
  ] as const;

  return (
    <section id="how" className="home-how-sec" aria-labelledby="how-h">
      <div className="container">
        <header className="how-head">
          <p className="eyebrow label"><Lamp state="committed" size={8} />{t("home.how.eyebrow")}</p>
          <h2 id="how-h" className="t-h2">{t("home.how.title")}</h2>
        </header>
        <div className="how-grid">
          <figure className="how-note">
            <div className="how-notewrap">
              {notes ? <NoteStack className="home-notes" front={notes.front} back={back} /> : <div className="home-note-ph" aria-hidden="true" />}
            </div>
            <figcaption className="how-cap">
              <Checks stage={CHECK_STAGE[phase]} issuer={issuer} tracker={TRACKER_NAME} block={phase === "committed" ? snap?.commit?.height : undefined} />
              <span className="sr-only" role="status">{phase === "committed" && snap?.commit ? t("home.stage.sr", { v: money(snap.v2?.total ?? STORY.first + STORY.raise), n: int(snap.commit.height) }) : ""}</span>
              <span className="home-sbx">
                <Lamp state="live" size={8} />
                <b>{t("home.stage.sandbox")}</b>
                <span className="sep" aria-hidden="true">·</span>
                <span>{status}</span>
                <span className={snap ? "home-sbx-tail" : "home-sbx-tail wait"}>
                  <span className="avl">{!snap || snap.avl.simulated ? t("home.stage.avlSim") : t("home.stage.avlReal")}</span>
                  {snap && phase === "committed" && !prefersReducedMotion() && (
                    <button type="button" className="home-replay" onClick={() => store?.replay()}>{t("home.stage.replay")}</button>
                  )}
                </span>
              </span>
              <details className="how-read">
                <summary>{t("home.list.aria")}</summary>
                <ol aria-label={t("home.list.aria")}>
                  {readings.map((c) => (
                    <li key={c.n}><span className="k"><i>{c.n}</i>{c.k}</span><p>{c.a} <span>{c.b}</span></p></li>
                  ))}
                </ol>
              </details>
            </figcaption>
          </figure>
          <ol className="how-street" aria-label={t("home.mat.aria")}>
            {stops.map((s, i) => (
              <li key={s.id} className={`how-stop ${s.light}${lit[i] ? " on" : ""}`}>
                <span className="how-win" aria-hidden="true"><i /></span>
                <span className="how-n" aria-hidden="true">{i + 1}</span>
                <h3>{s.title}</h3>
                <p>{s.line}</p>
                <p className="how-light"><b>{t(`home.mat.${s.light}`)}</b> <span>{t(`home.mat.${s.light}.sub`)}</span></p>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
