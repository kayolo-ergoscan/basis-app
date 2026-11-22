// /learn/how — ten short chapters from content (howItWorks.ts), each with one working figure, the protocol fact
// with its contract lines, "try it" scenarios, words and sources.
import type { ReactNode } from "react";
import { useT } from "@/app";
import { Key } from "@/ui";
import { chapters, howItWorksLede, moments, pick, type Chapter } from "@/content";
import { BookHead, Fact, Pager, Pull, Sec, Side, SourceLinks, Terms, TryIt, inline, useBookSections } from "../layout";
import { pageMinutes } from "../minutes";
import { pageOf, type LearnPageId, type ScenarioRef } from "../pages";
import {
  DigestFig, EmergencyFig, LoopFig, MessageFig, NoteOdometerFig, RedeemFig, RegistersFig, SpectrumFig, StampsFig, TimelinesFig,
} from "../figures/how";

const TRY: Record<string, ScenarioRef[]> = {
  "running-total": ["cafe-on-credit"],
  signatures: ["agent-swarm"],
  tracker: ["censoring-tracker", "idle-tracker"],
  digest: ["idle-tracker"],
  reserve: ["free-bank"],
  acceptance: ["village-lets", "currency-exchange"],
  redemption: ["cafe-on-credit", "free-bank"],
  emergency: ["tracker-vanishes"],
  exit: ["refund-race"],
  clearing: ["clearing-circle", "triangle-novation"],
};

const LAB: Record<string, LearnPageId> = {
  signatures: "signature",
  digest: "avl",
  redemption: "contract",
  acceptance: "trust",
};

/** Pull quotes: the five moments, on the chapter each one opens. */
const PULL = new Map(moments.map((m) => [m.chapter, m]));

function figureFor(c: Chapter, n: string): ReactNode {
  switch (c.figure) {
    case "note-odometer": return <NoteOdometerFig n={n} />;
    case "signature-grid": return <MessageFig n={n} />;
    case "tracker-ladder": case "two-stamps": return <StampsFig n={n} />;
    case "digest-pulse": return <DigestFig n={n} />;
    case "reserve-registers": case "reserve-coin": return <RegistersFig n={n} />;
    case "money-spectrum": return <SpectrumFig n={n} />;
    case "contract-xray": case "tear-off": return <RedeemFig n={n} />;
    case "emergency-dial": return <EmergencyFig n={n} />;
    case "exit-timeline": return <TimelinesFig n={n} />;
    case "clearing-loop": return <LoopFig n={n} />;
    default: return null;
  }
}

export default function HowPage() {
  const t = useT();
  const L = t.lang;
  useBookSections(chapters.map((c) => ({ id: c.id, label: pick(c.title, L) })));
  return (
    <article>
      <BookHead id="how" lede={inline(pick(howItWorksLede, L))} minutes={pageMinutes("how", L) ?? undefined} meta={<span className="label">{t("learn.how.meta", { n: chapters.length })}</span>} />
      {chapters.map((c, i) => {
        const split = c.body.length > 3 ? 2 : 1;
        const pull = PULL.get(c.id);
        const lab = LAB[c.id];
        const labPage = lab ? pageOf(lab) : null;
        const labName = lab ? t(`learn.page.${lab}.toc`) : "";
        return (
          <Sec key={c.id} id={c.id} first={i === 0} no={String(c.n).padStart(2, "0")} title={pick(c.title, L)} lede={inline(pick(c.lede, L))}>
            <Side label={t("learn.words")}>
              <Terms ids={c.terms} />
              {c.sources.length > 0 && <div style={{ marginTop: 14 }}><SourceLinks ids={c.sources.slice(0, 3)} /></div>}
            </Side>
            {c.body.slice(0, split).map((p, k) => <p className="lrn-p" key={k}>{inline(pick(p, L))}</p>)}
            {figureFor(c, `${c.n}`)}
            {c.body.slice(split).map((p, k) => <p className="lrn-p" key={k}>{inline(pick(p, L))}</p>)}
            {pull && i % 2 === 0 && <Pull cite={`${pull.numeral} · ${pick(pull.title, L)}`}>{pick(pull.text, L)}</Pull>}
            <Fact text={c.fact} lines={c.lines} />
            <TryIt
              scenarios={TRY[c.id] ?? []}
              extra={labPage ? (
                <Key size="sm" variant="quiet" icon="right" to={labPage.path}>
                  {labPage.kind === "lab" ? `${t("learn.openLab")} · ${labName}` : t("learn.toChapter", { n: labPage.numeral, name: labName })}
                </Key>
              ) : undefined}
            />
          </Sec>
        );
      })}
      <Pager id="how" />
    </article>
  );
}
