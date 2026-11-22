// /network/trackers (FEATURES C01, T03, T04, T09) and /network/tracker/:nft. A tracker is judged by the age of its
// last box, never by "online": the server skips a box update when nothing changed, so an idle tracker ages too.
import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { rich, useT, useTitle } from "@/app";
import { Dial, Empty, Honest, Icon, KeySeal, Table, useIsPhone, type Column } from "@/ui";
import { copy, pick } from "@/content";
import { EMERGENCY_BLOCKS, useTracker, type Observatory, type ReserveView, type TrackerCommit, type TrackerView } from "@/chain";
import { makeClock } from "./clock";
import { approx, blocks, date, ergs, height as fmtH, sid, tokenStr, type Lang } from "./fmt";
import { AsOf, Block, Capped, ContractTag, ExitTag, Ext, Facts, IdLink, KeyName, NetLoading, NftTile, TrackerTag, trackerSilent, UntrustedName, useProgressive } from "./parts";
import { FeedRow, goneLine, TrackerPanel } from "./Overview";
import { BeatStrip, TrackerLanes } from "./viz";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const RANK: Record<TrackerView["status"], number> = { live: 0, stale: 1, locked: 2, burned: 3, unused: 4 };
export const trackerOrder = (a: TrackerView, b: TrackerView) =>
  RANK[a.status] - RANK[b.status] || (b.lastTrackerBox?.height ?? b.evidence.height ?? 0) - (a.lastTrackerBox?.height ?? a.evidence.height ?? 0);

/* =========================== list =========================== */
export function TrackersList({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const clock = useMemo(() => makeClock(obs), [obs]);
  const list = useMemo(() => [...obs.trackers].sort(trackerOrder), [obs.trackers]);
  const panels = useProgressive(list, 4);
  return (
    <>
      <header className="nw-head">
        <div>
          <div className="eyebrow label">{t("network.tl.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.tl.h1"))}</h1>
          <p className="t-lede">{t("network.tl.lede", { n: list.length })}</p>
        </div>
        <AsOf h={obs.height} live={obs.heightLive} />
      </header>
      <div className="nw-honest">
        <Honest />
        <p className="t-small">{pick(copy.trackerLineLong, lang)}</p>
      </div>
      <Block label={t("network.tl.lanes")} className="nw-lanes-b">
        <p className="t-small">{t("network.tl.lanesSub")}</p>
        <TrackerLanes obs={obs} trackers={list} clock={clock} />
      </Block>
      <Block label={t("network.tl.cards")} aside={<span className="label num">{list.length}</span>}>
        <div className="nw-tgrid">{panels.map((tr) => <TrackerPanel key={tr.nft} tr={tr} tip={obs.height} />)}</div>
      </Block>
    </>
  );
}

/* =========================== detail =========================== */
export function TrackerDetail({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const { nft = "" } = useParams();
  const { loading, tracker: tr, reserves, redemptions } = useTracker(nft);
  useTitle(tr ? `${t("network.td.title", { id: sid(tr.nft) })} · ${t("network.title")}` : t("network.title"));
  const clock = useMemo(() => (obs ? makeClock(obs) : null), [obs]);
  if (loading || !obs || !clock) return <NetLoading />;
  if (!tr) {
    return (
      <div className="nw-missing">
        <Empty title={t("network.td.notFound.title")} text={t("network.td.notFound.text", { n: obs.trackers.length })} ghost={sid(nft, 6, 4)}
          action={{ label: t("network.td.back"), to: "/network/trackers" }} />
        {/^[0-9a-f]{64}$/i.test(nft) && <Ext kind="token" id={nft} className="nw-missing-ext">{t("network.nf.explorer", { id: sid(nft, 6, 6) })}</Ext>}
      </div>
    );
  }
  const box = tr.lastTrackerBox;
  const em = tr.emergency;
  const hasBox = !!box?.unspent && (tr.status === "live" || tr.status === "stale");
  const age = em?.age ?? 0;
  const first = tr.beats.length ? tr.beats[0] : null;
  const last = tr.beats.length ? tr.beats[tr.beats.length - 1] : null;
  const end = tr.status === "burned" || tr.status === "locked" ? tr.evidence.height ?? obs.height : obs.height;
  const commits = [...tr.commits].sort((a, b) => b.height - a.height);
  const addrOfKey = new Map(tr.keys.map((k) => [k.key, k.addr] as const));
  const commitCols: Column<TrackerCommit>[] = [
    { key: "h", label: t("network.c.height"), lead: true, render: (c) => <span className="num">{fmtH(c.height)}</span> },
    { key: "d", label: t("network.c.date"), render: (c) => <span className="dim">≈ {date(new Date(clock.toTime(c.height)).toISOString(), lang)}</span> },
    { key: "g", label: t("network.td.c.digest"), render: (c) => <span className="nw-inl"><span className="hex">{sid(c.digest, 8, 6)}</span>{c.zero ? <span className="nw-flag">{t("network.trk.digestZero")}</span> : c.empty ? <span className="nw-flag">{t("network.trk.digestEmpty")}</span> : null}</span> },
    { key: "b", label: t("network.td.c.boxes"), align: "right", render: (c) => <span className="num">{fmtH(c.boxes)}</span> },
    // the same key reads the same way in both tables: seal + address (the pubkey only when no address is known)
    { key: "k", label: t("network.td.c.key"), render: (c) => c.key ? <span className="nw-keycell">{addrOfKey.get(c.key)
      ? <KeyName pk={c.key} addr={addrOfKey.get(c.key)} size={20} />
      : <span className="nw-inl"><KeySeal pk={c.key} size={20} /><span className="hex">{sid(c.key, 6, 4)}</span></span>}</span> : <span className="dim">—</span> },
  ];
  type KeyRow = TrackerView["keys"][number];
  const keyCols: Column<KeyRow>[] = [
    { key: "k", label: t("network.td.k.key"), lead: true, render: (k) => <KeyName pk={k.key} addr={k.addr} label={k.label} size={28} /> },
    { key: "f", label: t("network.td.k.from"), render: (k) => <span className="num">{fmtH(k.from)} – {fmtH(k.to)}</span> },
    { key: "b", label: t("network.td.k.boxes"), align: "right", render: (k) => <span className="num">{fmtH(k.boxes)}</span> },
  ];
  const resCols: Column<ReserveView>[] = [
    { key: "id", label: t("network.c.box"), lead: true, render: (r) => <Link to={`/network/reserve/${r.id}`} className="hex">{sid(r.id, 6, 4)}</Link> },
    { key: "v", label: t("network.c.version"), render: (r) => <ContractTag c={r.contract} withRole={false} /> },
    { key: "val", label: t("network.c.value"), align: "right", render: (r) => <span className="num">{r.collateral ? tokenStr(r.collateral, lang) : `${ergs(r.value)} ERG`}</span> },
    { key: "x", label: t("network.c.exit"), render: (r) => (r.exit ? <ExitTag cls={r.exit.class} /> : <span className="dim">{t("network.res.spent")}</span>) },
  ];
  return (
    <>
      <nav className="nw-crumb" aria-label={t("network.bar.aria")}>
        <Link to="/network/trackers"><Icon name="left" size={14} />{t("network.td.back")}</Link>
      </nav>
      <header className="nw-td-head">
        <NftTile nft={tr.nft} silent={!hasBox || trackerSilent(tr)} size="lg" />
        <div className="nw-td-t">
          <div className="eyebrow label">{t("network.td.eyebrow")}</div>
          {/* the word stays in the display face; the NFT id is a key, so it is set in mono (VISUAL §4) */}
          <h1 className="t-h2">{t("network.td.titleWord")} <span className="hex nw-td-hex">{sid(tr.nft, 8, 6)}</span></h1>
          <div className="nw-rv-tags"><UntrustedName name={tr.name} /><TrackerTag tr={tr} /></div>
        </div>
        <AsOf h={tr.checkedAt ? obs.height : obs.height} live={!!tr.checkedAt || obs.heightLive} />
      </header>

      <div className="nw-detail">
        <div className="nw-main">
          {hasBox && em && (
            <Block label={t("network.td.window")} className="nw-window">
              <div className="nw-window-g">
                <Dial blocks={Math.min(age, EMERGENCY_BLOCKS)} size={phone ? 128 : 160} />
                <div className="nw-window-t">
                  <span className="label">{t("network.td.ageOf")}</span>
                  <span className="t-measure-l num">{fmtH(age)}</span>
                  <span className="t-small">{blocks(age, lang)} · {approx(age, lang)} · {t("network.trk.lastBoxAt", { h: fmtH(em.boxHeight), date: date(box?.at, lang) })}</span>
                  <p className={cx("nw-em-l", em.open && "open")}>{em.open ? t("chain.emergency.open") : t("chain.emergency.opensAt", { height: fmtH(em.opensAt), left: fmtH(em.blocksLeft) })}</p>
                </div>
              </div>
              <p className="nw-em-idle">{t("network.em.idle")}</p>
              <p className="t-small">{pick(copy.emergencyIsAvailability, lang)}</p>
              <p className="nw-facts-mono"><code>{pick(copy.facts.emergency, lang)}</code></p>
            </Block>
          )}
          {!hasBox && (
            <Block label={t("network.td.incident")} className="nw-incident">
              <IncidentText tr={tr} obs={obs} />
            </Block>
          )}

          <Block label={t("network.td.heartbeat")} aside={<span className="label num">{t("network.trk.boxes", { n: fmtH(tr.counts.trackerBoxes), c: tr.counts.states })}</span>}>
            <Strip title={t("network.td.life")} tr={tr} from={tr.mint.height} to={end} n={phone ? 72 : 160} clockTo={(h) => date(new Date(clock.toTime(h)).toISOString(), lang)} tip={hasBox} />
            {first != null && last != null && last > first && (
              <Strip title={t("network.td.active")} tr={tr} from={first} to={last + 1} n={phone ? 60 : 120} clockTo={(h) => date(new Date(clock.toTime(h)).toISOString(), lang)} />
            )}
            <div className="nw-legend" aria-hidden="true">
              <span><i className="lg-com" />{t("network.tl.lg.commit")}</span>
              <span><i className="lg-box" />{t("network.tl.lg.box")}</span>
              <span><i className="lg-zero" />{t("network.tl.lg.zero")}</span>
            </div>
          </Block>

          <Block label={t("network.td.commits")} aside={<span className="label num">{commits.length}</span>}>
            <p className="t-small">{t("network.td.commitsSub")}</p>
            {commits.length ? <Capped rows={commits}>{(rows) => <div className="nw-tablecard"><Table<TrackerCommit> columns={commitCols} rows={rows} rowKey={(c, i) => `${c.height}-${i}`} stack={phone} caption={t("network.td.commits")} /></div>}</Capped>
              : <p className="t-small">{t("network.td.none")}</p>}
          </Block>

          <Block label={t("network.td.keys")} aside={<span className="label num">{tr.keys.length}</span>}>
            <p className="t-small">{t("chain.tracker.keyNotHolder")}</p>
            {tr.keys.length ? <div className="nw-tablecard"><Table<KeyRow> columns={keyCols} rows={tr.keys} rowKey={(k) => k.key + k.from} stack={phone} caption={t("network.td.keys")} /></div>
              : <p className="t-small">{t("network.td.none")}</p>}
          </Block>

          <Block label={t("network.td.reserves")} aside={<span className="label num">{reserves.length}</span>}>
            {reserves.length ? <Capped rows={reserves}>{(rows) => <div className="nw-tablecard"><Table<ReserveView> columns={resCols} rows={rows} rowKey={(r) => r.id} stack={phone} caption={t("network.td.reserves")} /></div>}</Capped>
              : <p className="t-small">{t("network.td.none")}</p>}
          </Block>

          <Block label={t("network.td.redemptions")} aside={<span className="label num">{redemptions.length}</span>}>
            {redemptions.length ? <Capped rows={redemptions} n={8}>{(rows) => <ol className="nw-feed">{rows.map((x) => <FeedRow key={x.tx} r={x} />)}</ol>}</Capped> : <p className="t-small">{t("network.td.none")}</p>}
          </Block>
        </div>

        <aside className="nw-side">
          <Block label={pick(copy.trackerLine, lang)}>
            <Honest tracker={sid(tr.nft)} />
            <p className="t-small">{pick(copy.trackerLineLong, lang)}</p>
          </Block>
          <Block label={t("network.td.facts")}>
            <Facts rows={[
              [t("network.td.f.nft"), <IdLink id={tr.nft} kind="token" a={8} b={6} copy />],
              [t("network.td.f.name"), <span className="nw-inl"><UntrustedName name={tr.name} /></span>],
              ...(tr.description ? [[t("network.td.f.desc"), <span className="dim">“{tr.description}”</span>] as [ReactNode, ReactNode]] : []),
              [t("network.td.f.mint"), <span className="nw-inl"><span className="num">{fmtH(tr.mint.height)} · {date(tr.mint.at, lang)}</span><Ext kind="box" id={tr.mint.box} /></span>],
              [t("network.td.f.holder"), tr.holder ? <IdLink id={tr.holder} kind="address" /> : <span className="dim">—</span>],
              [t("network.td.f.current"), tr.currentBox ? <IdLink id={tr.currentBox} kind="box" a={6} b={4} to={obs.index.reserves.has(tr.currentBox) ? `/network/reserve/${tr.currentBox}` : undefined} /> : <span className="dim">—</span>],
              [t("network.td.f.boxes"), t("network.td.f.boxesVal", { n: fmtH(tr.counts.trackerBoxes), r: fmtH(tr.counts.readable), z: fmtH(tr.counts.zeroDigest) })],
              ...(box ? [[t("network.td.f.lastBox"), <span className="nw-inl"><IdLink id={box.box} kind="box" a={6} b={4} /><span className="dim num">{fmtH(box.height)}</span></span>] as [ReactNode, ReactNode]] : []),
            ]} />
          </Block>
        </aside>
      </div>
    </>
  );
}

function Strip({ title, tr, from, to, n, clockTo, tip }: { title: string; tr: TrackerView; from: number; to: number; n: number; clockTo: (h: number) => string; tip?: boolean }) {
  return (
    <figure className="nw-strip2">
      <figcaption className="label">{title}</figcaption>
      <BeatStrip tracker={tr} from={from} to={to} n={n} tip={tip} tall />
      <div className="nw-strip2-ax" aria-hidden="true">
        <span>{fmtH(from)} · {clockTo(from)}</span>
        <span>{fmtH(to)} · {clockTo(to)}</span>
      </div>
    </figure>
  );
}

function IncidentText({ tr, obs }: { tr: TrackerView; obs: Observatory }) {
  const t = useT();
  const ev = tr.evidence;
  if (tr.status === "burned") {
    return (
      <div className="nw-inc">
        <p>{t("network.td.burnText", { h: fmtH(ev.height ?? 0), tx: sid(ev.tx ?? "") })}</p>
        {ev.tx && <div className="cluster"><IdLink id={ev.tx} kind="tx" a={8} b={6} /></div>}
      </div>
    );
  }
  if (tr.status === "locked") {
    const lock = obs.incidents.locks.find((l) => l.nft === tr.nft);
    return (
      <div className="nw-inc">
        <p>{t("network.td.lockText", { id: sid(ev.box ?? tr.currentBox ?? ""), h: fmtH(ev.height ?? 0) })}{lock?.releasable ? ` ${t("network.td.lockFree")}` : ""}</p>
        {ev.box && <div className="cluster"><IdLink id={ev.box} kind="box" a={8} b={6} to={`/network/reserve/${ev.box}`} /></div>}
      </div>
    );
  }
  if (tr.status === "unused") return <p className="nw-inc">{t("network.td.unusedText")}</p>;
  return <p className="nw-inc">{goneLine(tr, t)}</p>;
}

