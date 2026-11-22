// EventFeed: the economy's log as one line per event (block, time, a shape per type, EN/RU text, actors), with
// filter chips, the "server emits today / spec only" badge for tracker publications, virtualised rows for logs of
// 10 000+ events, and a live tail that it follows until the reader scrolls up.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DenomId, EconomyEvent } from "@/protocol";
import { fmtClock, fmtInt, type UnitInfo } from "../core/format";
import { useVizLang, useVizT } from "../core/lang";
import { CheckLamp, ProtoLamp, Tag } from "../core/primitives";
import { defaultUnitOf, describeLine, FEED_GROUPS, groupOf, markOf, type FeedGroup, type FeedMark } from "./describe";
import "../core/core.css";
import "./feed.css";

/** useLayoutEffect in the browser, useEffect when rendered to a string (tests, prerender): no SSR warning. */
const useTailEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export interface EventFeedProps {
  events: readonly EconomyEvent[];
  /** Bump when the array grows in place (Economy pushes into eco.events). Default: events.length. */
  version?: number;
  nameOf?: (id: string) => string;
  unitOf?: (denom: DenomId) => UnitInfo;
  /** Groups shown at first (default: all). */
  groups?: readonly FeedGroup[];
  /** Height of the list in px (default 440). */
  height?: number;
  /** Follow the live tail (default true); scrolling up pauses it. */
  follow?: boolean;
  selectedSeq?: number | null;
  onSelect?: (e: EconomyEvent) => void;
  title?: ReactNode;
  className?: string;
}

export const FEED_ROW_HEIGHT = 54;
/** Rows in a narrow feed (phone) take two lines of text. */
export const FEED_ROW_HEIGHT_TALL = 72;
const NARROW_PX = 520;
const OVERSCAN = 8;

export function FeedMarkIcon({ mark }: { mark: FeedMark }) {
  switch (mark) {
    case "signed":
      return <ProtoLamp state="signed" />;
    case "committed":
      return <ProtoLamp state="committed" />;
    case "live":
      return <ProtoLamp state="live" />;
    case "refused":
      return <CheckLamp state="fail" size={12} />;
    default:
      return <span className={`vz-fd-glyph g-${mark}`} aria-hidden="true" />;
  }
}

export function EventFeed(p: EventFeedProps) {
  const t = useVizT();
  const lang = useVizLang();
  const version = p.version ?? p.events.length;
  const [active, setActive] = useState<Set<FeedGroup>>(() => new Set(p.groups ?? FEED_GROUPS));
  const groups = useMemo(() => p.events.map(groupOf), [p.events, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const counts = useMemo(() => {
    const c: Record<FeedGroup, number> = { notes: 0, chain: 0, reserves: 0, tracker: 0, alerts: 0, rejections: 0 };
    for (const g of groups) c[g]++;
    return c;
  }, [groups]);
  const shown = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) if (active.has(groups[i])) out.push(i);
    return out;
  }, [groups, active]);

  const height = p.height ?? 440;
  const boxRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [follow, setFollow] = useState(p.follow !== false);
  const [pausedAt, setPausedAt] = useState(0);
  const programmatic = useRef(false);
  const [narrow, setNarrow] = useState(false);
  const rowH = narrow ? FEED_ROW_HEIGHT_TALL : FEED_ROW_HEIGHT;
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const measure = () => setNarrow(box.clientWidth > 0 && box.clientWidth < NARROW_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useTailEffect(() => {
    const box = boxRef.current;
    if (!box || !follow) return;
    programmatic.current = true;
    box.scrollTop = box.scrollHeight;
    setScrollTop(box.scrollTop);
  }, [shown.length, follow, height, rowH]);
  useEffect(() => {
    if (!follow) return;
    setPausedAt(shown.length);
  }, [follow, shown.length]);

  const onScroll = () => {
    const box = boxRef.current;
    if (!box) return;
    setScrollTop(box.scrollTop);
    if (programmatic.current) {
      programmatic.current = false;
      return;
    }
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < rowH;
    if (atBottom !== follow) {
      setFollow(atBottom);
      if (!atBottom) setPausedAt(shown.length);
    }
  };

  const total = shown.length;
  const start = Math.max(0, Math.floor(scrollTop / rowH) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scrollTop + height) / rowH) + OVERSCAN);
  const ctx = useMemo(() => ({ lang, nameOf: p.nameOf ?? ((id: string) => id), unitOf: p.unitOf ?? defaultUnitOf }), [lang, p.nameOf, p.unitOf]);
  const rows: ReactNode[] = [];
  for (let k = start; k < end; k++) {
    const e = p.events[shown[k]];
    if (!e) continue;
    const line = describeLine(e, ctx);
    const meta = [t("viz.feed.block", { h: fmtInt(e.height) }), fmtClock(e.timeMs), ...line.actors].filter(Boolean).join(" · ");
    const cls = `vz-fd-row g-${line.group} m-${markOf(e)}${p.selectedSeq === e.seq ? " on" : ""}${p.onSelect ? " click" : ""}`;
    const body = (
      <>
        <span className="mk">
          <FeedMarkIcon mark={line.mark} />
        </span>
        <span className="tx" title={line.text}>
          {line.text}
        </span>
        {line.inServer !== undefined ? (
          <span className="badge" title={line.inServer ? t("viz.feed.inServerTitle") : t("viz.feed.specOnlyTitle")}>
            <Tag tone={line.inServer ? "plain" : "agent"} glyph={line.inServer ? "●" : "◌"}>
              {line.inServer ? t("viz.feed.inServer") : t("viz.feed.specOnly")}
            </Tag>
          </span>
        ) : null}
        <span className="meta">{meta}</span>
      </>
    );
    rows.push(
      p.onSelect ? (
        <button key={e.seq} type="button" className={cls} style={{ top: k * rowH, height: rowH }} onClick={() => p.onSelect?.(e)} aria-pressed={p.selectedSeq === e.seq}>
          {body}
        </button>
      ) : (
        <div key={e.seq} className={cls} style={{ top: k * rowH, height: rowH }} role="listitem">
          {body}
        </div>
      ),
    );
  }
  const newCount = Math.max(0, shown.length - pausedAt);

  return (
    <section className={`vz vz-panel vz-fd${p.className ? " " + p.className : ""}`} aria-label={t("viz.feed.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.feed.eyebrow")}</div>
          <h3 className="vz-title">{p.title ?? t("viz.feed.title")}</h3>
          <p className="vz-sub">{t("viz.feed.sub", { n: fmtInt(p.events.length), shown: fmtInt(total) })}</p>
        </div>
        <div className="vz-head-a">
          {follow ? (
            <span className="vz-fd-follow">
              <ProtoLamp state="live" size={8} /> {t("viz.feed.following")}
            </span>
          ) : (
            <button
              type="button"
              className="vz-btn vz-btn-default"
              onClick={() => {
                setFollow(true);
                const box = boxRef.current;
                if (box) {
                  programmatic.current = true;
                  box.scrollTop = box.scrollHeight;
                }
              }}
            >
              {newCount ? t("viz.feed.jumpN", { n: fmtInt(newCount) }) : t("viz.feed.jump")}
            </button>
          )}
        </div>
      </header>
      <div className="vz-fd-chips" role="group" aria-label={t("viz.feed.filters")}>
        {FEED_GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            className={`vz-chip${active.has(g) ? " on" : ""}`}
            aria-pressed={active.has(g)}
            onClick={() =>
              setActive((s) => {
                const n = new Set(s);
                if (n.has(g)) n.delete(g);
                else n.add(g);
                return n;
              })
            }
          >
            {t(`viz.feed.group.${g}`)} <span className="n">{fmtInt(counts[g])}</span>
          </button>
        ))}
      </div>
      <div ref={boxRef} className={`vz-fd-list${narrow ? " tall" : ""}`} style={{ height }} onScroll={onScroll} tabIndex={0} role="list" aria-label={t("viz.feed.list")}>
        {total === 0 ? <p className="vz-fd-empty">{t("viz.feed.empty")}</p> : null}
        <div className="vz-fd-inner" style={{ height: total * rowH }}>
          {rows}
        </div>
      </div>
    </section>
  );
}

export default EventFeed;
