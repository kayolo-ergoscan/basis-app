// /network — the mainnet overview (FEATURES O02, O03, O08, O09, O10, O11, C01, T04, H08): a strip of live figures,
// the current-contract detector, then trackers · reserves · redemptions side by side (a segmented switch on a phone).
import { startTransition, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { Dial, Icon, Key, KeySeal, Seg, Tag, useIsPhone } from "@/ui";
import { copy, pick } from "@/content";
import { EMERGENCY_BLOCKS, oursExtra, useOursInCounts, type ExitClass, type Observatory, type RedemptionView, type ReserveView, type TrackerView } from "@/chain";
import { amount, approx, blocks, date, ergs, height as fmtH, keyOfAddress, sAddr, sid, tokenStr, tokenUnit, type Lang } from "./fmt";
import { ContractTag, Ext, EXIT_ORDER, ExitTag, KeyName, NftTile, TrackerTag, trackerSilent, UntrustedName, useAfterPaint, useProgressive } from "./parts";
import { BeatStrip, Beacon, ExitBar, redemptionAmount, VaultCoin } from "./viz";
import { OurTrackerBlock } from "./Ours";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function Overview({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [col, setCol] = useState<"trackers" | "reserves" | "redemptions">("trackers");
  const later = useAfterPaint();
  return (
    <>
      <header className="nw-hero">
        <div className="nw-hero-t">
          <div className="eyebrow label">{t("network.ov.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.ov.h1"))}</h1>
          <p className="t-lede">{pick(copy.mainnetHonest, lang)}</p>
        </div>
        <Detector obs={obs} />
      </header>

      <MainnetStrip obs={obs} />
      <OurTrackerBlock />

      {phone && (
        <Seg<"trackers" | "reserves" | "redemptions"> className="nw-colseg" ariaLabel={t("network.col.aria")} value={col} onChange={setCol}
          options={[
            { value: "trackers", label: t("network.col.trackers") },
            { value: "reserves", label: t("network.col.reserves") },
            { value: "redemptions", label: t("network.col.redemptions") },
          ]} />
      )}
      {/* the three columns hold ~60 seals, dials and coins: they mount right after the first paint, time-sliced */}
      {later ? (
        <>
          <div className="nw-cols">
            {(!phone || col === "trackers") && <TrackersColumn obs={obs} />}
            {(!phone || col === "reserves") && <ReservesColumn obs={obs} />}
            {(!phone || col === "redemptions") && <RedemptionsColumn obs={obs} />}
          </div>
          <Records obs={obs} />
          <FootNotes obs={obs} />
        </>
      ) : <div className="nw-cols-wait" aria-busy="true" />}
    </>
  );
}

/* ---------------- detector (O08) ---------------- */
function Detector({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const det = obs.detector;
  // a reserve is its unspent box: spent boxes are earlier states of reserves (each redemption or top-up makes a new box)
  const live = det.found.filter((b) => b.unspent);
  const n = live.length;
  const spent = det.found.length - n;
  const current = obs.contracts.filter((c) => c.current);
  return (
    <section className={cx("nw-det", n > 0 && "found")} aria-label={t("network.det.aria", { n })}>
      <Beacon found={n} checked={det.checkedHeight} />
      <div className="nw-det-t">
        <span className="label">{t("network.det.label")}</span>
        <p className="nw-det-n"><b className="num">{n}</b><span>{t.p("network.det.count", n)}</span></p>
        <div className="nw-det-tpl">
          {current.map((c) => (
            <Link key={c.id} to={`/network/contracts#${c.id}`} className="nw-tpl" title={c.p2sFull}>
              <span className="hex">{c.p2s.head.slice(0, 6)}…</span>
              <span className="k">{t(`network.kind.${c.kind}`)}</span>
            </Link>
          ))}
        </div>
        {n === 0 ? (
          <p className="nw-det-p">{pick(copy.currentContractsEmpty, lang)} {t("network.det.willShow")}</p>
        ) : (
          <ul className="nw-det-found" aria-label={t("network.det.found")}>
            {live.map((b) => (
              <li key={b.boxId}><span className="hex">{sid(b.boxId, 6, 4)}</span> · {ergs(b.value)}&nbsp;ERG · {b.contract?.short ?? "?"}<Ext kind="box" id={b.boxId} /></li>
            ))}
          </ul>
        )}
        {spent > 0 && <p className="nw-det-p dim">{t.p("network.det.spent", spent)}</p>}
        <span className="nw-det-c">
          {det.checkedHeight != null ? t("chain.detector.checked", { height: fmtH(det.checkedHeight) }) : t("network.det.waiting")}
        </span>
      </div>
    </section>
  );
}

/* ---------------- the strip (O11, H08) ---------------- */
function MainnetStrip({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  // ErgoScan's tracker NFT was minted after the snapshot: the seed does not list it, so it is added here (its box
  // counts once the tracker's API has named it)
  const ours = useOursInCounts(obs);
  const live = obs.trackers.filter((x) => x.status === "live" || x.status === "stale").filter((x) => x.lastTrackerBox?.unspent).length + (ours?.withBox ?? 0);
  const gone = obs.trackers.filter((x) => x.status === "burned" || x.status === "locked").length;
  const recent = obs.redemptions.filter((r) => r.height > obs.height - 21_600).length;
  const tokens = obs.totals.unspentTokens;
  return (
    <section className="nw-strip" aria-label={t("network.strip.aria")}>
      <dl className="nw-strip-g">
        <div className="fig">
          <dt>{t("network.strip.block")}</dt>
          <dd><span className="v num">{fmtH(obs.height)}</span></dd>
          <dd className="s">{obs.heightLive ? t("network.strip.blockLive") : t("network.strip.blockSeed", { date: date(obs.asOf.at, lang) })}</dd>
        </div>
        <div className="fig" title={ours ? t("network.ours.strip", { h: fmtH(ours.mint) }) : undefined}>
          <dt>{t("network.strip.trackers")}</dt>
          <dd><span className="v num">{obs.trackers.length + (ours?.extra ?? 0)}</span></dd>
          <dd className="s">{t("network.strip.trackersSub", { live, gone })}</dd>
        </div>
        <div className="fig">
          <dt>{t("network.strip.reserves")}</dt>
          <dd><span className="v num">{obs.unspent.length}</span></dd>
          <dd className="s">{t("network.strip.reservesSub", { total: obs.reserves.length })}</dd>
        </div>
        <div className="fig metal">
          <dt>{t("network.strip.locked")}</dt>
          <dd><span className="v t-money">{ergs(obs.totals.unspentNano)}</span><span className="u">ERG</span></dd>
          <dd className="s">{tokens.length ? tokens.map((x) => `+ ${tokenStr(x, lang)}`).join(" · ") : t("network.strip.lockedSub")}</dd>
        </div>
        <div className="fig">
          <dt>{t("network.strip.redemptions")}</dt>
          <dd><span className="v num">{obs.redemptions.length}</span></dd>
          <dd className="s">{t("network.strip.redemptionsSub", { n: recent })}</dd>
        </div>
      </dl>
    </section>
  );
}

/* ---------------- trackers column (C01, T04) ---------------- */
const TRACKER_RANK: Record<TrackerView["status"], number> = { live: 0, stale: 1, locked: 2, burned: 3, unused: 4 };
function TrackersColumn({ obs }: { obs: Observatory }) {
  const t = useT();
  const withBox = obs.trackers.filter((x) => x.lastTrackerBox?.unspent && (x.status === "live" || x.status === "stale"))
    .sort((a, b) => TRACKER_RANK[a.status] - TRACKER_RANK[b.status] || (b.lastTrackerBox?.height ?? 0) - (a.lastTrackerBox?.height ?? 0));
  const gone = obs.trackers.filter((x) => !withBox.includes(x)).sort((a, b) => TRACKER_RANK[a.status] - TRACKER_RANK[b.status] || (b.evidence.height ?? 0) - (a.evidence.height ?? 0));
  return (
    <section className="nw-col" aria-labelledby="nw-col-trk">
      <ColHead id="nw-col-trk" title={t("network.col.trackers")} sub={t("network.col.trackersSub")} to="/network/trackers" n={obs.trackers.length + oursExtra(obs)} />
      <p className="nw-trustline">{pick(copy.trackerLine, t.lang as Lang)}</p>
      <div className="nw-stack">
        {withBox.map((tr) => <TrackerPanel key={tr.nft} tr={tr} tip={obs.height} />)}
      </div>
      <div className="nw-sub label">{t("network.trk.gone")}</div>
      <ul className="nw-gone">
        {gone.map((tr) => <GoneRow key={tr.nft} tr={tr} />)}
      </ul>
    </section>
  );
}

export function TrackerPanel({ tr, tip, compact }: { tr: TrackerView; tip: number; compact?: boolean }) {
  const t = useT();
  const lang = t.lang as Lang;
  const box = tr.lastTrackerBox;
  const hasBox = !!box?.unspent && (tr.status === "live" || tr.status === "stale");
  const em = hasBox ? tr.emergency : null;
  const age = em?.age ?? tr.silentBlocks ?? 0;
  const first = tr.beats.length ? tr.beats[0] : tr.mint.height;
  const end = hasBox ? tip : Math.max(first + 1, tr.evidence.height ?? box?.height ?? tip);
  return (
    <article className="nw-trk">
      <header className="nw-trk-h">
        <NftTile nft={tr.nft} silent={trackerSilent(tr)} />
        <Link to={`/network/tracker/${tr.nft}`} className="nw-trk-id" aria-label={t("network.trk.open", { id: tr.nft.slice(0, 8) })}>
          <span className="hex">{sid(tr.nft, 6, 4)}</span>
          <UntrustedName name={tr.name} />
        </Link>
        <TrackerTag tr={tr} />
      </header>
      {box && hasBox && (
        <div className="nw-trk-b">
          <div className="nw-trk-age">
            <span className="t-measure num">{blocks(age, lang)}</span>
            <span className="s">{approx(age, lang)} {t("network.trk.lastBox")}</span>
            <span className="s2">{t("network.trk.lastBoxAt", { h: fmtH(box.height), date: date(box.at, lang) })} · {box.zero ? t("network.trk.digestZero") : box.empty ? t("network.trk.digestEmpty") : t("network.trk.digestHas")}</span>
          </div>
          <Dial blocks={Math.min(age, EMERGENCY_BLOCKS)} size={compact ? 64 : 76} labels={false} />
        </div>
      )}
      {!hasBox && <p className="nw-trk-gone"><span className="g" aria-hidden="true">{tr.status === "burned" ? "✕" : tr.status === "locked" ? "⊘" : "○"}</span>{goneLine(tr, t)}</p>}
      {tr.beats.length > 0 && <BeatStrip tracker={tr} from={first - Math.max(200, Math.round((end - first) * 0.01))} to={end} n={compact ? 56 : 72} tip={hasBox} />}
      {em && (
        <div className="nw-em">
          <p className={cx("nw-em-l", em.open && "open")}>
            {em.open ? t("network.trk.emOpen", { h: fmtH(em.opensAt) }) : t("network.trk.emOpens", { h: fmtH(em.opensAt), left: blocks(em.blocksLeft, lang) })}
          </p>
          <p className="nw-em-idle">{t("network.em.idle")}</p>
        </div>
      )}
      <footer className="nw-trk-f">
        <span>{t("network.trk.reserves", { n: tr.reserves.length })}</span>
        <span>{t("network.trk.served", { n: tr.redemptions.length })}</span>
        <span>{t("network.trk.boxes", { n: fmtH(tr.counts.trackerBoxes), c: tr.counts.states })}</span>
      </footer>
    </article>
  );
}

export function goneLine(tr: TrackerView, t: ReturnType<typeof useT>): string {
  if (tr.status === "burned") return t("network.trk.burnedAt", { h: fmtH(tr.evidence.height ?? 0) });
  if (tr.status === "locked") return t("network.trk.lockedIn", { id: sid(tr.evidence.box ?? tr.currentBox ?? "") });
  if (tr.status === "unused") return t("network.trk.unusedIn");
  return t("network.trk.noBox");
}
function GoneRow({ tr }: { tr: TrackerView }) {
  const t = useT();
  return (
    <li>
      <Link to={`/network/tracker/${tr.nft}`} className="nw-gone-a" aria-label={t("network.trk.open", { id: tr.nft.slice(0, 8) })}>
        <NftTile nft={tr.nft} silent size="sm" />
        <span className="nw-gone-n"><span className="hex">{tr.nft.slice(0, 8)}</span><UntrustedName name={tr.name} /></span>
      </Link>
      <TrackerTag tr={tr} />
      <span className="nw-gone-w">{goneLine(tr, t)}</span>
    </li>
  );
}

/* ---------------- reserves column (O02, R16, R17) ---------------- */
export const reserveRank = (a: ReserveView, b: ReserveView) => {
  const ia = a.exit ? EXIT_ORDER.indexOf(a.exit.class) : 9, ib = b.exit ? EXIT_ORDER.indexOf(b.exit.class) : 9;
  return ia - ib || (b.collateral ? 1 : 0) - (a.collateral ? 1 : 0) || (b.value > a.value ? 1 : b.value < a.value ? -1 : 0) || b.height - a.height;
};
function ReservesColumn({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const [all, setAll] = useState(false);
  const list = useMemo(() => [...obs.unspent].sort(reserveRank), [obs.unspent]);
  const rows = EXIT_ORDER.map((cls) => ({ cls, boxes: obs.totals.exit[cls]?.boxes ?? 0, sub: exitSub(obs, cls, lang) }));
  const shown = all ? list : list.slice(0, 5);
  return (
    <section className="nw-col" aria-labelledby="nw-col-res">
      <ColHead id="nw-col-res" title={t("network.col.reserves")} sub={t("network.col.reservesSub", { n: list.length })} to="/network/reserves" n={obs.reserves.length} />
      <ExitBar rows={rows} total={list.length} />
      <div className="nw-stack">
        {shown.map((r) => <VaultCard key={r.id} r={r} obs={obs} />)}
      </div>
      {list.length > 5 && (
        <button type="button" className="key sm quiet nw-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t("network.col.showLess") : t("network.col.showAll", { n: list.length })}
        </button>
      )}
      <TopUpClosed />
    </section>
  );
}
export function exitSub(obs: Observatory, cls: ExitClass, lang: Lang): string {
  const x = obs.totals.exit[cls];
  if (!x) return "";
  const parts = [`${ergs(x.nano)} ERG`];
  for (const tk of x.tokens) parts.push(tokenStr(tk, lang));
  return parts.join(" · ");
}

/** The one metal key of the view, disabled: topping up a legacy test reserve would lock real money. */
export function TopUpClosed() {
  const t = useT();
  const lang = t.lang as Lang;
  return (
    <div className="nw-topup">
      <Key variant="metal" icon="coin" disabled aria-disabled="true" aria-describedby="nw-topup-why">{t("network.topup.key")}</Key>
      <p id="nw-topup-why"><b>{pick(copy.topUpClosed, lang)}</b> {t("network.topup.why")}</p>
    </div>
  );
}

export function unitKind(r: ReserveView): "erg" | "use" | "use-lookalike" | "other" {
  return r.collateral ? r.collateral.kind : "erg";
}

export function VaultCard({ r, obs }: { r: ReserveView; obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const tr = r.r6 ? obs.index.trackers.get(r.r6) ?? null : null;
  const tok = r.collateral;
  return (
    <article className={cx("nw-vault", !r.unspent && "spent")}>
      <Link to={`/network/reserve/${r.id}`} className="nw-vault-main" aria-label={t("network.res.open", { id: sid(r.id) })}>
        <VaultCoin unit={unitKind(r)} size={58} spent={!r.unspent} />
        <span className="nw-vault-v">
          {tok ? (
            <><span className="t-money v">{amount(tok.amount, tok.decimals)}</span><span className="u">{tokenUnit(tok.kind, lang)}</span></>
          ) : (
            <><span className="t-money v">{ergs(r.value)}</span><span className="u">ERG</span></>
          )}
          <span className="s">
            <span className="hex">{sid(r.id)}</span> · {t("network.res.made", { h: fmtH(r.height) })}{tok ? ` · ${ergs(r.value)} ERG` : ""}
          </span>
        </span>
      </Link>
      <div className="nw-vault-tags">
        {r.exit && <ExitTag cls={r.exit.class} />}
        <ContractTag c={r.contract} />
        {!r.unspent && <Tag>{t("network.res.spent")}</Tag>}
      </div>
      <dl className="nw-vault-f">
        <div>
          <dt>{t("network.res.tracker")}</dt>
          <dd>
            {r.r6 ? (
              <Link to={`/network/tracker/${r.r6}`} className="nw-inl">
                <NftTile nft={r.r6} silent={trackerSilent(tr)} size="sm" />
                <span className="hex">{r.r6.slice(0, 8)}</span>
              </Link>
            ) : <span className="dim">{t("network.res.noTracker")}</span>}
            {tr && <span className="nw-tr-st">{t(`chain.tracker.${tr.status}`)}</span>}
          </dd>
        </div>
        <div><dt>{t("network.res.tree")}</dt><dd>{treeWord(r, t)}</dd></div>
        <div><dt>{t("network.res.refund")}</dt><dd>{r7Word(r, obs.height, t)}</dd></div>
        <div>
          <dt>{t("network.res.owner")}</dt>
          <dd>
            {r.owner ? <span className="nw-inl"><KeySeal pk={r.owner.key} size={22} /><span className="hex">{sAddr(r.owner.addr)}</span>{r.owner.label && <span className="nw-label">{r.owner.label}</span>}</span>
              : <span className="dim">{t("network.owner.malformed")}</span>}
          </dd>
        </div>
      </dl>
    </article>
  );
}
export function treeWord(r: ReserveView, t: ReturnType<typeof useT>): string {
  if (!r.r5) return t("network.res.treeBad");
  if (r.r5.zero) return t("network.res.treeZero");
  return r.r5.empty ? t("network.res.treeEmpty") : t("network.res.treeHas");
}
export function r7Word(r: ReserveView, tip: number, t: ReturnType<typeof useT>): string {
  if (r.r7 == null || !r.contract?.ownerExit) return t("network.res.r7absent");
  if (r.r7 === 0) return t("network.res.r7none");
  const done = r.r7 + 43_200;
  return tip >= done ? t("network.res.r7ready") : t("network.res.r7running", { h: fmtH(done) });
}

/* ---------------- redemptions column (O03, X13) ---------------- */
function RedemptionsColumn({ obs }: { obs: Observatory }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const phone = useIsPhone();
  const list = obs.redemptions;
  // three columns side by side: 20 rows keep this column about as tall as the trackers and reserves next to it
  const cap = phone ? 10 : 20;
  const shown = useProgressive(all ? list : list.slice(0, cap), 6);
  return (
    <section className="nw-col" aria-labelledby="nw-col-rd">
      <ColHead id="nw-col-rd" title={t("network.col.redemptions")} sub={t("network.col.redemptionsSub", { n: list.length })} to="/network/redemptions"
        extra={<Link to="/network/redemptions?view=graph" className="nw-colk"><Icon name="graph" size={14} />{t("network.col.graph")}</Link>} />
      <ol className="nw-feed">
        {shown.map((r) => <FeedRow key={r.tx} r={r} />)}
      </ol>
      {list.length > cap && (
        <button type="button" className="key sm quiet nw-more" onClick={() => startTransition(() => setAll((v) => !v))} aria-expanded={all}>
          {all ? t("network.col.showLess") : t("network.col.showAll", { n: list.length })}
        </button>
      )}
    </section>
  );
}
export function FeedRow({ r }: { r: RedemptionView }) {
  const t = useT();
  const lang = t.lang as Lang;
  const rk = keyOfAddress(r.receiver);
  return (
    <li className={cx("nw-rd", r.emergencyWindow && "em")}>
      <Link to={`/network/tx/${r.tx}`} className="nw-rd-a" aria-label={t("network.rd.open", { id: sid(r.tx) })}>
        <span className="nw-rd-amt num">{redemptionAmount(r, lang)}</span>
        <span className="nw-rd-who" aria-hidden="true">
          {r.owner.key ? <KeySeal pk={r.owner.key} size={24} /> : <span className="nw-noseal" style={{ width: 24 }} />}
          <span className="arr">→</span>
          {rk ? <KeySeal pk={rk} size={24} /> : <span className="nw-noseal" style={{ width: 24 }} />}
        </span>
        <span className="nw-rd-pair">
          {t("network.rd.pair", { owner: r.ownerLabel ?? sAddr(r.owner.addr), receiver: r.receiverLabel ?? sAddr(r.receiver) })}
        </span>
        <span className="nw-rd-m">
          <span>{date(r.at, lang)}</span>
          <span>{t("network.rd.age", { age: blocks(r.tracker?.age ?? 0, lang) })}</span>
          {r.emergencyWindow && <span className="flag em" title={pick(copy.emergencyRule, lang)}>⚑ {t("network.rd.em")}</span>}
          {r.firstOfPair && <span className="flag" title={t("network.rd.firstTitle")}>◇ {t("network.rd.first")}</span>}
        </span>
      </Link>
    </li>
  );
}

/* ---------------- shared column head ---------------- */
export function ColHead({ id, title, sub, to, n, extra }: { id: string; title: string; sub?: string; to?: string; n?: number; extra?: ReactNode }) {
  const t = useT();
  return (
    <div className="nw-colh">
      <div>
        <h2 id={id} className="t-h3">{title}</h2>
        {sub && <p className="t-small">{sub}</p>}
      </div>
      <div className="nw-colh-a">
        {extra}
        {to && <Link to={to} className="nw-colk">{t("network.col.all")}{n != null && <span className="n num">{n}</span>}<Icon name="right" size={14} /></Link>}
      </div>
    </div>
  );
}

/* ---------------- records (O09) ---------------- */
function Records({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const R = obs.records;
  const cells: { k: string; v: ReactNode; s: ReactNode; to?: string }[] = [];
  const rec = (k: string) => R[k];
  if (rec("firstReserve")) cells.push({ k: "firstReserve", v: date(rec("firstReserve").at, lang), s: <>{fmtH(rec("firstReserve").height)} · <span className="hex">{sid(rec("firstReserve").box)}</span></>, to: rec("firstReserve").box ? `/network/reserve/${rec("firstReserve").box}` : undefined });
  if (rec("firstRedemption")) cells.push({ k: "firstRedemption", v: date(rec("firstRedemption").at, lang), s: <>{fmtH(rec("firstRedemption").height)} · <span className="hex">{sid(rec("firstRedemption").tx)}</span></>, to: `/network/tx/${rec("firstRedemption").tx}` });
  const lg = rec("largestRedemption");
  if (lg) cells.push({ k: "largestRedemption", v: <>{lg.unit === "erg" || !lg.unit ? `${ergs(BigInt(lg.amount ?? "0"))} ERG` : lg.amount}</>, s: date(lg.at, lang), to: `/network/tx/${lg.tx}` });
  if (rec("firstTokenReserve")) cells.push({ k: "firstTokenReserve", v: date(rec("firstTokenReserve").at, lang), s: <>{fmtH(rec("firstTokenReserve").height)} · <span className="hex">{sid(rec("firstTokenReserve").box)}</span></>, to: rec("firstTokenReserve").box ? `/network/reserve/${rec("firstTokenReserve").box}` : undefined });
  const la = rec("lastActivity");
  if (la) cells.push({ k: "lastActivity", v: date(la.at, lang), s: la.what?.includes("burned") ? t("network.rec.what.sweep") : fmtH(la.height), to: la.tx ? `/network/tx/${la.tx}` : undefined });
  return (
    <section className="nw-records" aria-labelledby="nw-rec-h">
      <h2 id="nw-rec-h" className="label">{t("network.rec.title")}</h2>
      <ol>
        {cells.map((c) => {
          const body = <><span className="k label">{t(`network.rec.${c.k}`)}</span><span className="v">{c.v}</span><span className="s">{c.s}</span></>;
          return <li key={c.k}>{c.to ? <Link to={c.to}>{body}</Link> : <div>{body}</div>}</li>;
        })}
      </ol>
    </section>
  );
}

/* ---------------- footnotes (O10, honesty) ---------------- */
function FootNotes({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const hi = obs.hostIndex;
  return (
    <aside className="nw-foot" aria-label={t("network.foot.aria")}>
      <p><Icon name="info" size={16} /><span>{pick(copy.mainnetFootnote({ boxes: obs.reserves.length, erg: ergs(obs.totals.unspentNano), height: obs.height }), lang)}</span></p>
      <p><Icon name="stamp" size={16} /><span>{t("chain.fee.protocol")}</span></p>
      <p><Icon name="search" size={16} /><span>{t("chain.hostIndex", { listed: hi.listedKnown, total: hi.unspentHere })} {t("network.foot.hostMore", { count: hi.reserveCount, erg: ergs(hi.ergLockedNano), trackers: hi.trackerCount })}</span></p>
      <p><Icon name="warn" size={16} /><span>{t("chain.basisNames", { count: obs.incidents.basisNamedNfts.count })} <Link to="/network/incidents" className="link">{t("network.tab.incidents")}</Link></span></p>
    </aside>
  );
}
