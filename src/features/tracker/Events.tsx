// Section 03: what a tracker announces. The town's NOSTR-style tracker events in the shared EventFeed, next to
// what the reference server really records today, and a link to the trackers seen on mainnet.
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { copy, pick } from "@/content";
import { useObservatory } from "@/chain";
import type { EconomyEvent } from "@/protocol";
import { Card, int, Key } from "@/ui";
import { EventFeed } from "@/viz";
import { denomInfo, TOWN_TRACKER, useTown } from "@/world";
import { md } from "./parts";
import { useNameOf } from "./townParts";

// The reference server at 43e2173 has no NOSTR code, and its reserve-event path (process_reserve_event, the
// background scanner) is not wired up, so no NOSTR-style event reaches a client today. The engine marks redemption
// and top-up events as server-emitted; this page shows every one of them as spec-only.
const specOnly = new WeakMap<readonly EconomyEvent[], { n: number; out: EconomyEvent[] }>();
function specOnlyEvents(ev: readonly EconomyEvent[]): EconomyEvent[] {
  let c = specOnly.get(ev);
  if (!c || c.n > ev.length) specOnly.set(ev, (c = { n: 0, out: [] }));
  for (let i = c.n; i < ev.length; i++) {
    const e = ev[i];
    c.out.push(e.type === "nostr" && e.inServer ? { ...e, inServer: false } : e);
  }
  c.n = ev.length;
  return c.out;
}

export function EventsBlock() {
  const t = useT();
  const nameOf = useNameOf();
  const { eco, n } = useTown((s) => ({ eco: s.eco, n: s.events }));
  const events = useMemo(() => (eco ? specOnlyEvents(eco.events) : []), [eco, n]);
  return (
    <div className="trk-feed">
      <EventFeed
        events={events}
        version={events.length}
        nameOf={nameOf}
        unitOf={(d) => denomInfo(eco, d)}
        groups={["tracker", "reserves", "alerts", "rejections"]}
        height={460}
        title={t("tracker.ev.feedTitle", { id: TOWN_TRACKER })}
      />
    </div>
  );
}

export function ServerTruth() {
  const t = useT();
  return (
    <Card className="trk-truth" title={t("tracker.ev.real")}>
      <ul className="trk-truth-list">
        <li><span className="g ok" aria-hidden="true">●</span><span>{md(t("tracker.ev.real.notes"))}</span></li>
        <li><span className="g" aria-hidden="true">◌</span><span>{t("tracker.ev.real.demo")}</span></li>
        <li><span className="g" aria-hidden="true">◌</span><span>{t("tracker.ev.real.nostr")}</span></li>
      </ul>
      <p className="t-small">{md(t("tracker.ev.real.advice"))}</p>
      <p className="t-small dim">{t("tracker.ev.badge")}</p>
      <Link className="textlink t-small" to="/tracker/api?e=events">{md(t("tracker.ev.mirror"))}</Link>
    </Card>
  );
}

export function MainnetLink() {
  const t = useT();
  const obs = useObservatory();
  const asOf = obs ? pick(copy.asOfBlock(obs.height), t.lang) : null;
  return (
    <Card
      className="trk-mainnet"
      title={t("tracker.mn.title")}
      aside={<span className="label">{t("tracker.mn.kind")}</span>}
      footer={<Key to="/network/trackers" icon="network">{t("tracker.mn.open")}</Key>}
    >
      <div className="trk-mainnet-b">
        {obs ? (
          <div className="trk-mainnet-n">
            <div>
              <span className="trk-mainnet-v num">{int(obs.totals.trackerNfts)}</span>
              <span className="t-small">{t.p("tracker.mn.nfts", obs.totals.trackerNfts)}</span>
            </div>
            <div>
              <span className="trk-mainnet-v num">{int(obs.totals.trackerBoxes)}</span>
              <span className="t-small">{t.p("tracker.mn.boxes", obs.totals.trackerBoxes)}</span>
            </div>
          </div>
        ) : (
          <div className="trk-mainnet-n" aria-busy="true"><span className="t-small dim">…</span></div>
        )}
        <p className="t-small">{t("tracker.mn.text")}</p>
        <p className="t-small dim">{pick(copy.mainnetHonest, t.lang)}</p>
        {asOf && <p className="label trk-mainnet-asof">{t("tracker.mn.height", { asOf })}</p>}
      </div>
    </Card>
  );
}
