// /network: ErgoScan's own tracker (src/chain/ours). The card on the overview and on /network/trackers, and its page
// at /network/tracker/<nft>. Every figure is the tracker API's answer or the chain's; "—" when it is not known yet.
// The tracker is judged like every other one, by the age of its box, plus whether its API answers.
import { useEffect, useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rich, useT, useTitle } from "@/app";
import { blockWord, CopyButton, CoverageTag, Dial, Honest, Icon, Key, Lamp, ratioPct, Table, Tag, useIsPhone, type Column, type LampState, type TagTone } from "@/ui";
import { copy, pick } from "@/content";
import {
  chain, p2pkAddress,
  EMERGENCY_BLOCKS, EMPTY_DIGEST, OUR_TRACKER, OurTestReserveTag, STALE_AFTER_BLOCKS, isOurTestReserve, totalsSource, useAgo, useNow, useOurTracker,
  type Observatory, type OurEvent, type RedemptionView, type OurStatus, type OurView, type TrackedReserve,
} from "@/chain";
import { amount, approx, blocks, ergs, height as fmtH, sid, type Lang } from "./fmt";
import { AsOf, Block, Capped, Ext, Facts, IdLink, KeyName, NftTile, UntrustedName } from "./parts";
import { FeedRow } from "./feed";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const DASH = "—";

const ST_LAMP: Record<OurStatus, LampState> = { connecting: "signed", live: "live", stale: "stale", unreachable: "off" };
const ST_TONE: Record<OurStatus, TagTone> = { connecting: "plain", live: "ok", stale: "watch", unreachable: "warn" };

/** Live · Stale · Unreachable · Connecting, with the reason in the tooltip. */
export function OurStatusTag({ status }: { status: OurStatus }) {
  const t = useT();
  return (
    <Tag tone={ST_TONE[status]} title={t(`chain.ours.st.${status}.help`)}>
      <Lamp state={ST_LAMP[status]} size={7} />{t(`chain.ours.st.${status}`)}
    </Tag>
  );
}

/** The failure in words ("no answer in 10 s", "HTTP 503"…). */
export function useOursError(): (e: OurView["error"]) => string {
  const t = useT();
  return (e) => {
    if (!e) return "";
    if (e.kind === "unavailable") return t("chain.ours.err.unavailable", { status: e.status ?? DASH });
    if (e.kind === "http") return t("chain.ours.err.http", { message: e.message });
    return t(`chain.ours.err.${e.kind}`);
  };
}

/** "Answered 12 s ago · asked every 30 s while this tab is open", or the saved answer's age, the failure and the wait. */
export function AnswerLine({ v, className }: { v: OurView; className?: string }) {
  const t = useT();
  const ago = useAgo();
  const now = useNow(5_000);
  const err = useOursError();
  const parts: string[] = [];
  if (v.answeredAt === null) parts.push(t("chain.ours.never"));
  else parts.push(t(v.cached ? "chain.ours.saved" : "chain.ours.answered", { ago: ago(v.answeredAt) }));
  if (v.error && (v.status === "unreachable" || v.limited)) parts.push(err(v.error));
  const wait = v.backoffUntil !== null ? Math.ceil((v.backoffUntil - now) / 1000) : 0;
  parts.push(wait > 0 ? t("chain.ours.retry", { s: wait }) : t("chain.ours.every"));
  return <p className={cx("nw-ours-ans", v.status === "unreachable" && "err", className)}>{parts.join(" · ")}</p>;
}

/** The committed digest, shortened, with "empty tree" when it is the empty AVL root. */
function DigestShort({ d, a = 8, b = 6 }: { d: string | null; a?: number; b?: number }) {
  const t = useT();
  if (!d) return <span className="dim">{DASH}</span>;
  return (
    <span className="nw-ours-dg">
      <span className="hex" title={d}>{sid(d, a, b)}</span>
      {d === EMPTY_DIGEST && <span className="nw-flag">{t("network.ours.empty")}</span>}
      <CopyButton value={d} small />
    </span>
  );
}

/** The five figures: last commit, emergency window, reserves, collateral, fee funds. */
function OurFigures({ v }: { v: OurView }) {
  const t = useT();
  const lang = t.lang as Lang;
  const em = v.emergency;
  const tok = v.totals?.tokens.reduce((n, x) => n + x.count, 0) ?? 0;
  return (
    <dl className="nw-ours-g">
      <div className="fig">
        <dt>{t("network.ours.last")}</dt>
        <dd><span className="v num">{v.height !== null ? fmtH(v.height) : DASH}</span></dd>
        <dd className="s">{v.age !== null ? `${t("network.ours.ago", { blocks: blocks(v.age, lang) })} · ${approx(v.age, lang)}` : DASH}</dd>
      </div>
      <div className={cx("fig", em?.open && "open")}>
        <dt>{t("network.ours.window")}</dt>
        {/* the count big, its word small like ERG beside an amount: «2 037 блоков» fits a phone column */}
        <dd><span className="v num">{em ? (em.open ? t("network.ours.windowOpen") : fmtH(em.blocksLeft)) : DASH}</span>{em && !em.open && <span className="u plain">{blockWord(em.blocksLeft, lang)}</span>}</dd>
        <dd className="s">{em ? t(em.open ? "network.ours.windowOpenAt" : "network.ours.windowAt", { h: fmtH(em.opensAt) }) : DASH}</dd>
      </div>
      <div className="fig">
        <dt>{t("network.ours.reserves")}</dt>
        <dd><span className="v num">{v.totals ? fmtH(v.totals.count) : DASH}</span></dd>
        <dd className="s">{v.totals ? t(v.totals.count ? "network.ours.reservesSub" : "network.ours.reservesNone") : DASH}</dd>
      </div>
      <div className="fig metal">
        <dt>{t("network.ours.collateral")}</dt>
        <dd><span className="v t-money">{v.totals ? ergs(v.totals.ergNano) : DASH}</span>{v.totals && <span className="u">ERG</span>}</dd>
        <dd className="s">{v.totals ? (tok ? t.p("network.ours.tokens", tok) : t("network.ours.collateralSub")) : DASH}</dd>
      </div>
      <div className="fig">
        <dt>{t("network.ours.fees")}</dt>
        <dd><span className="v num">{v.fees ? `${v.fees.partial ? "≥ " : ""}${ergs(v.fees.nano)}` : DASH}</span>{v.fees && <span className="u">ERG</span>}</dd>
        <dd className="s">{t("network.ours.feesSub")}</dd>
      </div>
    </dl>
  );
}

/** NFT · box · digest, each with the explorer link the app uses everywhere (ergoscan.me). */
function OurIds({ v }: { v: OurView }) {
  const t = useT();
  return (
    <div className="nw-ours-ids">
      <div><span className="label">{t("network.ours.nft")}</span><IdLink id={OUR_TRACKER.nft} kind="token" a={8} b={6} copy /></div>
      <div><span className="label">{t("network.ours.box")}</span>{v.box ? <IdLink id={v.box} kind="box" a={8} b={6} copy /> : <span className="dim">{DASH}</span>}</div>
      <div><span className="label">{t("network.ours.digest")}</span><DigestShort d={v.digest} /></div>
    </div>
  );
}

function OurNotes({ v }: { v: OurView }) {
  const t = useT();
  if (v.inSync !== false && !v.pending && !v.skipped) return null;
  return (
    <div className="nw-ours-notes">
      {v.inSync === false && <p className="t-small">{t("network.ours.ahead")}</p>}
      {v.pending && <p className="t-small nw-inl">{t("network.ours.pending")}: <IdLink id={v.pending.tx} kind="tx" a={8} b={6} /></p>}
      {v.skipped > 0 && <p className="t-small dim">{t.p("network.ours.skipped", v.skipped)}</p>}
    </div>
  );
}

/** The card: on the overview (between the strip and the columns) and on top of /network/trackers. */
export function OurTrackerCard({ v }: { v: OurView }) {
  const t = useT();
  const phone = useIsPhone();
  return (
    <section className="nw-ours" aria-label={t("network.ours.aria")}>
      <header className="nw-ours-h">
        <NftTile nft={OUR_TRACKER.nft} silent={v.status !== "live"} size={phone ? "md" : "lg"} />
        <div className="nw-ours-t">
          <div className="eyebrow label">{t("network.ours.eyebrow")}</div>
          <h2 className="t-h3"><Link to={`/network/tracker/${OUR_TRACKER.nft}`}>{rich(t("network.ours.title"))}</Link></h2>
          <p className="t-small">{t("network.ours.lede")}</p>
        </div>
        <div className="nw-ours-st">
          <OurStatusTag status={v.status} />
          <AnswerLine v={v} />
        </div>
      </header>
      <div className="nw-ours-b">
        <OurFigures v={v} />
        <div className="nw-ours-dial" aria-hidden={v.age === null}>
          {v.age !== null ? <Dial blocks={Math.min(v.age, EMERGENCY_BLOCKS)} size={phone ? 96 : 112} labels={false} quiet={STALE_AFTER_BLOCKS} /> : <span className="nw-ours-nodial" />}
        </div>
      </div>
      <OurIds v={v} />
      <OurNotes v={v} />
      <footer className="nw-ours-f">
        <Honest tracker={t("chain.ours.name")} />
        <div className="nw-ours-keys">
          <Key to="/tracker/mainnet" size="sm" icon="tracker">{t("network.ours.console")}</Key>
          <Key to={`/network/tracker/${OUR_TRACKER.nft}`} size="sm" variant="quiet">{t("network.ours.page")} <Icon name="right" size={14} /></Key>
        </div>
      </footer>
    </section>
  );
}

/** The overview card, mounted with its own poller; it shows the fee funds, so it asks for them. */
export function OurTrackerBlock() {
  const v = useOurTracker({ fees: true });
  return <OurTrackerCard v={v} />;
}


/* ---------------- /network/tracker/<our NFT> ---------------- */

function EventRow({ e }: { e: OurEvent }) {
  const t = useT();
  const ago = useAgo();
  if (e.kind === "commit") {
    return (
      <li className="nw-ours-ev">
        <Lamp state="committed" size={8} />
        <span>{t(e.heartbeat ? "network.ours.td.heartbeatAt" : "network.ours.td.commit", { h: e.height !== null ? fmtH(e.height) : DASH })}</span>
        <IdLink id={e.box} kind="box" a={6} b={4} />
        <span className="dim">{ago(e.at)}</span>
      </li>
    );
  }
  return (
    <li className="nw-ours-ev">
      <Lamp state="tracked" size={8} />
      <span>{t("network.ours.td.reserve", { box: sid(e.box, 6, 4) })}</span>
      <b className="num">{e.token ? amount(e.collateral, 0) : `${ergs(e.collateral)} ERG`}</b>
      <Ext kind="box" id={e.box} />
      {isOurTestReserve(e.owner) && <OurTestReserveTag />}
      <span className="dim">{t("network.ours.lastAt", { h: fmtH(e.height) })} · {ago(e.at)}</span>
    </li>
  );
}

export function OurEvents({ v }: { v: OurView }) {
  const t = useT();
  if (!v.events.length) return <p className="t-small">{t("network.ours.td.eventsNone")}</p>;
  return <ol className="nw-ours-evs">{v.events.map((e) => <EventRow key={e.id} e={e} />)}</ol>;
}

/** P2PK address of a reserve owner's key (the tracker sends the key; a bad key gives null, shown as "not a key"). */
function addrOf(pk: string): string | null {
  try { return p2pkAddress(pk); } catch { return null; }
}

export function OurReserves({ v }: { v: OurView }) {
  const t = useT();
  const ago = useAgo();
  const phone = useIsPhone();
  const cols: Column<TrackedReserve>[] = [
    { key: "id", label: t("network.ours.c.box"), lead: true, render: (r) => <IdLink id={r.box} kind="box" a={6} b={4} /> },
    { key: "o", label: t("network.ours.c.owner"), render: (r) => <span className="nw-inl"><KeyName pk={r.owner} addr={addrOf(r.owner)} size={20} />{isOurTestReserve(r.owner) && <OurTestReserveTag />}</span> },
    // a token reserve shows raw units next to the token id: the tracker does not send decimals, so none are guessed
    { key: "c", label: t("network.ours.c.collateral"), align: "right", render: (r) => <span className="num">{r.token ? <>{amount(r.collateral, 0)} <span className="hex">{sid(r.token)}</span></> : `${ergs(r.collateral)} ERG`}</span> },
    // debt = the owner's note totals minus what is redeemed, in the reserve's own units; coverage only while there is debt
    { key: "d", label: t("network.ours.c.debt"), align: "right", render: (r) => <span className="num">{r.token ? <>{amount(r.debt, 0)} <span className="hex">{sid(r.token)}</span></> : `${r.debt === 0n ? "0" : ergs(r.debt)} ERG`}</span> },
    { key: "cov", label: t("network.ours.c.cover"), render: (r) => r.ratio === null ? <span className="dim">{DASH}</span>
      : <span className="nw-inl"><span className="num">{ratioPct(r.ratio)}</span><CoverageTag pct={r.ratio * 100} small /></span> },
    { key: "u", label: t("network.ours.c.updated"), align: "right", render: (r) => <span className="num">{fmtH(r.updatedHeight)}</span> },
  ];
  const sub = v.reservesAt !== null ? `${t("network.ours.td.reservesSub")} ${t(v.reservesCached ? "chain.ours.saved" : "chain.ours.answered", { ago: ago(v.reservesAt) })}.` : t("network.ours.td.reservesSub");
  return (
    <Block label={t("network.ours.td.reserves")} aside={<span className="label num">{v.reserves ? v.reserves.length : DASH}</span>}>
      <p className="t-small">{sub}</p>
      {v.reserves === null ? <p className="t-small dim">{DASH}</p>
        : v.reserves.length === 0 ? <p className="nw-ours-empty">{t("network.ours.td.none")}</p>
          : <div className="nw-tablecard"><Table<TrackedReserve> columns={cols} rows={v.reserves} rowKey={(r) => r.box} stack={phone} caption={t("network.ours.td.reserves")} /></div>}
    </Block>
  );
}

/** Redemptions found on chain that this tracker served: the same merged list the redemptions page and the totals count
 *  (the snapshot's, the ones read live, the ones seen in reserve boxes only), filtered by the tracker NFT, so nothing is
 *  counted twice. The seed predates this NFT: every one of them is from the live layer. */
/** Rows of our tracker's redemptions whose transactions the page reads itself when they are not read yet: the rows shown
 *  first (Capped n) are what the user opened, so they are a first look (interactive lane, 1/s, once each per tab)
 *  instead of waiting behind the background backlog (one tx per block). */
export const OUR_REDEMPTION_READS = 8;
export const ourRedemptionReads = (list: readonly RedemptionView[] | null): string[] =>
  (list ?? []).slice(0, OUR_REDEMPTION_READS).filter((x) => x.fromBoxes).map((x) => x.tx);

export function OurRedemptions({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const list = useMemo(() => (obs ? obs.redemptions.filter((x) => x.trackerNft === OUR_TRACKER.nft) : null), [obs]);
  const unread = ourRedemptionReads(list).join(" ");
  useEffect(() => { if (unread) for (const tx of unread.split(" ")) void chain.fetchTx(tx); }, [unread]);
  // before this tab has listed the current templates, an empty list would only mean "not looked yet" (or, when the live
  // layer failed, that the snapshot predates this tracker)
  const src = obs ? totalsSource(obs) : "checking";
  const unknown = !list || (list.length === 0 && src !== "live");
  return (
    <Block label={t("network.td.redemptions")} aside={<span className="label num">{list && !unknown ? list.length : DASH}</span>}>
      <p className="t-small">{t("network.ours.td.redemptionsSub")}</p>
      {unknown ? <p className="t-small dim">{src === "snapshot" ? t("chain.live.seedOnly") : t("network.rd.unread")}</p>
        : list!.length ? <Capped rows={list!} n={OUR_REDEMPTION_READS}>{(rows) => <ol className="nw-feed">{rows.map((x) => <FeedRow key={x.tx} r={x} />)}</ol>}</Capped>
          : <p className="t-small">{t("network.td.none")}</p>}
    </Block>
  );
}

export function OurTrackerPage({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const v = useOurTracker({ fees: true });
  useTitle(`${t("network.td.title", { id: sid(OUR_TRACKER.nft) })} · ${t("network.title")}`);
  const em = v.emergency;
  const fees = v.fees ? `${v.fees.partial ? "≥ " : ""}${ergs(v.fees.nano)} ERG` : DASH;
  const facts: [ReactNode, ReactNode][] = [
    [t("network.td.f.nft"), <IdLink id={OUR_TRACKER.nft} kind="token" a={8} b={6} copy />],
    [t("network.ours.td.name"), <span className="nw-inl"><UntrustedName name="ErgoScan Basis Tracker" /></span>],
    [t("network.ours.td.mint"), <span className="nw-inl"><span className="num">{fmtH(OUR_TRACKER.mintHeight)}</span><Ext kind="tx" id={OUR_TRACKER.mintTx} /></span>],
    [t("network.ours.td.address"), <IdLink id={OUR_TRACKER.address} kind="address" copy />],
    [t("network.ours.box"), v.box ? <IdLink id={v.box} kind="box" a={6} b={4} copy /> : <span className="dim">{DASH}</span>],
    [t("network.ours.digest"), <DigestShort d={v.digest} a={6} b={4} />],
    [t("network.ours.fees"), <span className="num" title={t("network.ours.feesSub")}>{fees}</span>],
    [t("network.ours.td.api"), <AnswerLine v={v} className="in-facts" />],
  ];
  return (
    <>
      <nav className="nw-crumb" aria-label={t("network.bar.aria")}>
        <Link to="/network/trackers"><Icon name="left" size={14} />{t("network.td.back")}</Link>
      </nav>
      <header className="nw-td-head">
        <NftTile nft={OUR_TRACKER.nft} silent={v.status !== "live"} size="lg" />
        <div className="nw-td-t">
          <div className="eyebrow label">{t("network.ours.td.eyebrow")}</div>
          <h1 className="t-h2">{t("network.td.titleWord")} <span className="hex nw-td-hex">{sid(OUR_TRACKER.nft, 8, 6)}</span></h1>
          <div className="nw-rv-tags"><OurStatusTag status={v.status} /><Tag tone="agent">{t("chain.ours.beta")}</Tag></div>
        </div>
        {obs && <AsOf h={obs.height} live={obs.heightLive} />}
      </header>

      <div className="nw-detail">
        <div className="nw-main">
          <Block label={t("network.td.window")} className="nw-window">
            <div className="nw-window-g">
              <Dial blocks={Math.min(v.age ?? 0, EMERGENCY_BLOCKS)} size={phone ? 128 : 160} quiet={STALE_AFTER_BLOCKS} />
              <div className="nw-window-t">
                <span className="label">{t("network.td.ageOf")}</span>
                <span className="t-measure-l num">{v.age !== null ? fmtH(v.age) : DASH}</span>
                <span className="t-small">{v.age !== null && v.height !== null ? `${blocks(v.age, lang)} · ${approx(v.age, lang)} · ${t("network.ours.lastAt", { h: fmtH(v.height) })}` : DASH}</span>
                <p className={cx("nw-em-l", em?.open && "open")}>
                  {em ? (em.open ? t("chain.emergency.open") : t("chain.emergency.opensAt", { height: fmtH(em.opensAt), left: fmtH(em.blocksLeft) })) : DASH}
                </p>
              </div>
            </div>
            <p className="nw-em-idle">{t("network.ours.heartbeat")}</p>
            <p className="t-small">{pick(copy.emergencyIsAvailability, lang)}</p>
          </Block>

          <OurReserves v={v} />
          <OurRedemptions obs={obs} />

          <Block label={t("network.ours.td.events")} aside={<span className="label num">{v.events.length}</span>}>
            <OurEvents v={v} />
          </Block>
          <OurNotes v={v} />
        </div>

        <aside className="nw-side">
          <Block label={pick(copy.trackerLine, lang)}>
            <Honest tracker={t("chain.ours.name")} />
            <p className="t-small">{pick(copy.trackerLineLong, lang)}</p>
          </Block>
          <Block label={t("network.ours.td.facts")}>
            <Facts rows={facts} />
            <p className="t-small dim">{t("network.ours.readOnly")}</p>
            <Key to="/tracker/mainnet" size="sm" icon="tracker">{t("network.ours.console")}</Key>
          </Block>
        </aside>
      </div>
    </>
  );
}
