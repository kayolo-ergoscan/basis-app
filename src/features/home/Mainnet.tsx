// 03 Mainnet now (src/chain): what Basis-shaped boxes exist on Ergo today, read from the snapshot plus the live
// layer — reserve boxes, ERG locked, redemptions, trackers by status, the last activity and the current-contract
// detector. Every number carries "experimental" and "as of block N".
import { useMemo, type CSSProperties } from "react";
import { rich, useLang, useT } from "@/app/lang";
import { totalsSource, useObservatory, useOursInCounts } from "@/chain";
import type { TrackerStatus } from "@/chain/types";
import { chainUrl, copy, pick } from "@/content";
import { Icon, int, Key, Lamp, Section, units, type LampState } from "@/ui";

const STATUS_ORDER: TrackerStatus[] = ["live", "locked", "burned", "stale", "unused"];
const STATUS_LAMP: Record<TrackerStatus, LampState> = { live: "live", locked: "tracked", burned: "off", stale: "stale", unused: "signed" };

function fmtDate(iso: string | undefined, lang: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(lang === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

export function Mainnet() {
  const t = useT();
  const { lang } = useLang();
  const obs = useObservatory();
  // ErgoScan's tracker was minted after the snapshot: counted here as on the Network pages (+1, and with the "box
  // unspent" trackers once its API has named its box)
  const ours = useOursInCounts(obs);

  const byStatus = useMemo(() => {
    const m = new Map<TrackerStatus, number>();
    for (const tr of obs?.trackers ?? []) m.set(tr.status, (m.get(tr.status) ?? 0) + 1);
    if (ours?.withBox) m.set("live", (m.get("live") ?? 0) + 1);
    return STATUS_ORDER.filter((s) => m.get(s)).map((s) => ({ s, n: m.get(s)! }));
  }, [obs?.trackers, ours?.withBox]);

  if (!obs) {
    return (
      <Section id="mainnet" className="home-mainnet" no={<>03 · {t("home.n.no")}</>} title={rich(t("home.n.title"))} lede={pick(copy.mainnetHonest, lang)}>
        <div className="mn-wait"><span className="skel" aria-hidden="true"><i /><i /><i /></span><span>{t("home.n.loading")}</span></div>
      </Section>
    );
  }

  const T = obs.totals;
  // the reserve figures and their footnote stand for one block: the block of this tab's last live check (the same one
  // the detector line beside them names), the snapshot's block when the live layer failed before that, and no figures
  // while the first look is on its way
  const src = totalsSource(obs);
  const S = obs.snapshotTotals;
  const R = src === "snapshot"
    ? { boxes: S.reserveBoxes, unspent: S.unspent, nano: BigInt(S.unspentNano), tokens: Object.keys(S.unspentTokens).length > 0, height: obs.asOf.height }
    : { boxes: T.reserveBoxes, unspent: T.unspent, nano: T.unspentNano, tokens: T.unspentTokens.length > 0, height: obs.detector.checkedHeight ?? obs.height };
  const checking = src === "checking";
  const last = obs.records.lastActivity;
  // reserves = unspent boxes at the current contracts (a spent box is an earlier state of a reserve)
  const found = obs.detector.found.filter((b) => b.unspent).length;
  const totalTrackers = obs.trackers.length + (ours?.extra ?? 0);
  const ergStr = units(R.nano, 9, 3);
  const stats = [
    { k: t("home.n.boxes"), v: checking ? "—" : int(R.boxes), sub: checking ? "" : t("home.n.unspent", { n: int(R.unspent) }) },
    { k: t("home.n.locked"), v: checking ? "—" : ergStr, sub: !checking && R.tokens ? t("home.n.tokens") : "", metal: true },
    { k: t("home.n.redemptions"), v: int(T.redemptions), sub: t("home.n.redeemed", { v: units(T.redeemedNano, 9, 2) }) },
    { k: t("home.n.trackers"), v: int(totalTrackers), sub: pick(copy.trackerLine, lang), title: ours ? t("home.n.trackersOurs", { h: int(ours.mint) }) : undefined },
  ];
  const what = last?.what === "tracker NFT burned in a sweep" ? t("home.n.what.burned") : last?.what ?? "";

  return (
    <Section id="mainnet" className="home-mainnet" no={<>03 · {t("home.n.no")}</>} title={rich(t("home.n.title"))} lede={pick(copy.mainnetHonest, lang)}>
      <div className="mn-grid">
        <div className="mn-main">
          <dl className="mn-stats">
            {stats.map((s) => (
              <div key={s.k} className={s.metal ? "metal" : undefined} title={"title" in s ? s.title : undefined}>
                <dt className="label">{s.k}</dt>
                <dd className="v num">{s.v}{s.metal && !checking && <span className="unit">ERG</span>}</dd>
                {s.sub && <dd className="sub">{s.sub}</dd>}
              </div>
            ))}
          </dl>
          <div className="mn-trackers">
            <span className="label">{t("home.n.trackersBy")}</span>
            <div className="mn-bar" role="img" aria-label={byStatus.map((x) => `${t(`chain.tracker.${x.s}`)} ${x.n}`).join(", ")}>
              {byStatus.map((x) => <i key={x.s} className={`st-${x.s}`} style={{ "--w": x.n } as CSSProperties} />)}
            </div>
            <ul className="mn-legend">
              {byStatus.map((x) => (
                <li key={x.s} title={t(`chain.tracker.${x.s}.help`)}><Lamp state={STATUS_LAMP[x.s]} size={9} /><span>{t(`chain.tracker.${x.s}`)}</span><b className="num">{x.n}</b></li>
              ))}
            </ul>
          </div>
        </div>
        <aside className="mn-side">
          <div className={`mn-detector${found ? " on" : ""}`}>
            <span className="label"><Lamp state={found ? "committed" : "off"} size={9} />{t("home.n.current")}</span>
            <p>{checking ? t("chain.checking") : src === "snapshot" ? t("chain.live.seedOnly") : found ? t.p("home.n.detector.found", found) : t("home.n.detector.none")}</p>
            {src === "live" && obs.detector.checkedHeight != null && <span className="mono">{t("chain.detector.checked", { height: int(obs.detector.checkedHeight) })}</span>}
          </div>
          {last && (
            <div className="mn-last">
              <span className="label">{t("home.n.last")}</span>
              <p><b>{what}</b></p>
              <span className="mono">
                {t("home.n.lastAt", { n: int(last.height), date: fmtDate(last.at, lang) })}
                {last.tx && <> · <a className="link" href={chainUrl({ kind: "tx", id: last.tx })} target="_blank" rel="noreferrer">{t("home.n.ergoscan")} <Icon name="ext" size={12} /></a></>}
              </span>
            </div>
          )}
        </aside>
        <div className="mn-footrow">
          <p className="mn-foot mono">{checking ? t("chain.checking") : pick(copy.mainnetFootnote({ boxes: R.boxes, erg: ergStr, height: R.height }), lang)}</p>
          <Key to="/network" kbd="N" icon="network">{t("home.n.go")}</Key>
        </div>
      </div>
    </Section>
  );
}
