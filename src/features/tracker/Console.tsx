// /tracker: the console of the sandbox town tracker T-01 (VISUAL §13 /tracker).
//   01  the XL card with the pending ladder under it, the operator's keys beside them
//   02  the digest timeline; the proof card beside it (sticky), the proof's x-ray under it
//   03  the events a tracker announces, what the reference server really records, trackers on mainnet
import { useCallback, useState } from "react";
import { useT } from "@/app/lang";
import { PageHead, prefersReducedMotion, Section, useIsPhone } from "@/ui";
import { TOWN_TRACKER, trackerTimeline, useClock, useTownReady, useTownView } from "@/world";
import { Controls } from "./Controls";
import { EventsBlock, MainnetLink, ServerTruth } from "./Events";
import { LadderCard } from "./Ladder";
import { beatsOf, commitCount, ladderOf, timelineRows, trackerView, type TimelineRow } from "./model";
import { HeadActions, md, ModeSwitch } from "./parts";
import { ProofCard, ProofXray, useProof, type ProofTarget } from "./ProofPanel";
import { Timeline } from "./Timeline";
import { TownGate } from "./townParts";
import { TrackerXL } from "./TrackerXL";

const PAGE = 12;

export default function Console() {
  const t = useT();
  return (
    <>
      <div className="container">
        <PageHead eyebrow={t("tracker.eyebrow")} title={md(t("tracker.h1"))} lede={t("tracker.lede")} actions={<HeadActions />} />
        <ModeSwitch mode="sim" />
      </div>
      <TownGate>
        <ConsoleBody />
      </TownGate>
    </>
  );
}

function ConsoleBody() {
  const t = useT();
  const phone = useIsPhone();
  const [limit, setLimit] = useState(() => (typeof window !== "undefined" && window.innerWidth <= 640 ? PAGE / 2 : PAGE));
  const [picked, setPicked] = useState<ProofTarget | null>(null);
  // on phone the x-ray (hundreds of byte keys) waits behind a disclosure; the verdict above already answers
  const [xray, setXray] = useState(false);
  const clock = useClock();
  const { avl } = useTownReady();
  const d = useTownView(
    (eco) => {
      const v = trackerView(eco, TOWN_TRACKER);
      return {
        v,
        beats: beatsOf(trackerTimeline(eco, TOWN_TRACKER, { limit: 400 }), v.height),
        rows: timelineRows(eco, TOWN_TRACKER, limit),
        ladder: ladderOf(eco, TOWN_TRACKER, v),
        total: commitCount(eco, TOWN_TRACKER),
        genesis: eco.clock.genesisHeight,
      };
    },
    [limit],
  );

  const current = d ? (d.rows.find((r) => r.current) ?? d.rows[0] ?? null) : null;
  const curTarget: ProofTarget | null = current ? { seq: current.seq, boxId: current.boxId, digest: current.digest, height: current.height } : null;
  const target = picked ?? curTarget;
  const isCurrent = !picked || picked.boxId === curTarget?.boxId;
  const proof = useProof(target);

  const select = useCallback(
    (r: TimelineRow) => {
      setPicked({ seq: r.seq, boxId: r.boxId, digest: r.digest, height: r.height });
      // on one column the proof card sits under the table: bring it into view
      if (phone || window.innerWidth <= 1000)
        requestAnimationFrame(() => document.getElementById("trk-proof")?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" }));
    },
    [phone],
  );
  if (!d) return null;

  return (
    <>
      <div className="container">
        <div className="trk-top">
          <div className="trk-top-xl">
            <TrackerXL v={d.v} beats={d.beats} genesis={d.genesis} blockMs={clock.blockMs} avl={avl} />
          </div>
          <div className="trk-top-ctl">
            <Controls v={d.v} />
          </div>
          <div className="trk-top-lad">
            <LadderCard ladder={d.ladder} v={d.v} />
          </div>
        </div>
      </div>

      <Section id="timeline" no={t("tracker.tl.no")} title={md(t("tracker.tl.title"))} lede={t("tracker.tl.lede")}>
        <div className="trk-s2">
          <div className="trk-s2-tl">
            <Timeline
              rows={d.rows}
              total={d.total}
              height={d.v.height}
              minDepth={d.v.minDepth}
              selected={target?.boxId ?? null}
              onSelect={select}
              onMore={() => setLimit((x) => x + PAGE * 2)}
              trackerId={d.v.id}
            />
          </div>
          <div className="trk-s2-pick" id="trk-proof">
            <ProofCard p={proof} target={target} isCurrent={isCurrent} onUseCurrent={() => setPicked(null)} />
          </div>
          <div className="trk-s2-x">
            {phone ? (
              <details className="trk-xray-d" onToggle={(e) => setXray((e.currentTarget as HTMLDetailsElement).open)}>
                <summary>
                  <span className="label">{t("tracker.pf.xray")}</span>
                  <span className="t-small">{t("tracker.pf.xray.d")}</span>
                </summary>
                {xray && <ProofXray p={proof} target={target} />}
              </details>
            ) : (
              <>
                {/* the x-ray makes every proof byte a key: let a keyboard walk step over them */}
                <a
                  className="trk-skipx"
                  href="#events"
                  onClick={(e) => {
                    e.preventDefault();
                    const s = document.getElementById("events");
                    if (!s) return;
                    s.setAttribute("tabindex", "-1");
                    s.focus({ preventScroll: true });
                    s.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
                  }}
                >
                  {t("tracker.pf.skipXray")}
                </a>
                <ProofXray p={proof} target={target} />
              </>
            )}
          </div>
        </div>
      </Section>

      <Section id="events" no={t("tracker.ev.no")} title={md(t("tracker.ev.title"))} lede={t("tracker.ev.lede")}>
        <div className="trk-s3">
          <EventsBlock />
          <div className="trk-end-side">
            <ServerTruth />
            <MainnetLink />
          </div>
        </div>
      </Section>
    </>
  );
}
