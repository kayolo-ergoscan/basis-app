// /network — the mainnet overview (FEATURES O02, O03, O08, O09, O10, O11, C01, T04, H08): the title with a one-line
// status, four key figures in plain words, then the details: what mainnet is today next to the current-contract
// detector, ErgoScan's tracker, and trackers · reserves · redemptions side by side (a segmented switch on a phone).
import { startTransition, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rich, useT } from "@/app";
import { Dial, Icon, Key, KeySeal, Lamp, Seg, Tag, useIsPhone } from "@/ui";
import { copy, pick } from "@/content";
import { EMERGENCY_BLOCKS, OurTestReserveTag, isOurTestReserve, oursExtra, totalsSource, useOurTracker, useOursInCounts, type ExitClass, type Observatory, type RedemptionView, type ReserveView, type TrackerView } from "@/chain";
import { amount, approx, blocks, date, ergs, height as fmtH, keyOfAddress, sAddr, sid, tokenStr, tokenUnit, type Lang } from "./fmt";
import { ContractTag, Ext, EXIT_ORDER, ExitTag, KeyName, NftTile, TrackerTag, trackerSilent, UntrustedName, useAfterPaint, useProgressive } from "./parts";
import { BeatStrip, Beacon, ExitBar, redemptionAmount, VaultCoin } from "./viz";
import { OurTrackerBlock } from "./Ours";
// FeedRow lives in feed.tsx (Ours.tsx uses it too); re-exported for the pages that import it from here
import { FeedRow } from "./feed";
import { Capped } from "./parts";
// ErgoScan's tracker: its heartbeat sets the dial's bands
import { CURRENT_TEMPLATES, OUR_TRACKER, STALE_AFTER_BLOCKS, useFirstReads, type TokenKind } from "@/chain";
import { pinnedToken } from "@/chain/reserveTokens";

export { FeedRow };

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export default function Overview({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [col, setCol] = useState<"trackers" | "reserves" | "redemptions">("trackers");
  const later = useAfterPaint();
  return (
    <>
      <header className="nw-hero nw-lead">
        <div className="nw-hero-t">
          <div className="eyebrow label">{t("network.ov.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.ov.h1"))}</h1>
          <StatusLine obs={obs} />
        </div>
      </header>

      <MainnetStrip obs={obs} />
      <div className="nw-hero nw-about">
        <p className="t-lede">{pick(copy.mainnetHonest, lang)}</p>
        <Detector obs={obs} />
      </div>
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

/* ---------------- the one-line status under the title ---------------- */
function StatusLine({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const src = totalsSource(obs);
  const n = obs.detector.found.filter((b) => b.unspent).length;
  return (
    <p className="nw-status">
      <span><Lamp state={obs.heightLive ? "live" : "stale"} size={8} /> {t("network.ov.statusBlock", { h: fmtH(obs.height) })} <span className="dim">({obs.heightLive ? t("network.strip.blockLive") : t("network.strip.blockSeed", { date: date(obs.asOf.at, lang) })})</span></span>
      <span className="sep" aria-hidden="true">·</span>
      {/* a count only once it is read live; the snapshot's count is not today's (as the Detector says) */}
      <span>{src === "live" ? `${n} ${t.p("network.det.count", n)}` : src === "checking" ? t("chain.checking") : t("chain.live.seedOnly")}</span>
      <span className="sep" aria-hidden="true">·</span>
      <span>{t("network.ov.statusRead")}</span>
    </p>
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
  // until this tab has listed both current templates live there is no count to show: no "0", no empty-state sentence
  // that the first answer would contradict a second later
  const src = totalsSource(obs);
  if (src !== "live") {
    const note = src === "checking" ? t("chain.checking") : t("chain.live.seedOnly");
    return (
      <section className="nw-det" aria-label={`${t("network.det.label")} · ${note}`}>
        <Beacon found={0} checked={null} />
        <div className="nw-det-t">
          <span className="label">{t("network.det.label")}</span>
          <p className="nw-det-n"><span>{note}</span></p>
          <div className="nw-det-tpl">
            {current.map((c) => (
              <Link key={c.id} to={`/network/contracts#${c.id}`} className="nw-tpl" title={c.p2sFull}>
                <span className="hex">{c.p2s.head.slice(0, 6)}…</span>
                <span className="k">{t(`network.kind.${c.kind}`)}</span>
              </Link>
            ))}
          </div>
          {src === "checking" && <span className="nw-det-c">{t("network.det.waiting")}</span>}
        </div>
      </section>
    );
  }
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
          // a test group can make dozens of reserves: the newest few, the rest behind "show all"
          <Capped rows={live} n={6}>{(rows) => (
            <ul className="nw-det-found" aria-label={t("network.det.found")}>
              {rows.map((b) => (
                <li key={b.boxId}><span className="hex">{sid(b.boxId, 6, 4)}</span> · {ergs(b.value)}&nbsp;ERG · {b.contract?.short ?? "?"}<Ext kind="box" id={b.boxId} />{isOurTestReserve(b.owner?.key) && <OurTestReserveTag />}</li>
              ))}
            </ul>
          )}</Capped>
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
  // reserve figures: live once this tab has looked at the chain; "checking" until then (no number that jumps a second
  // later); the snapshot's own figures, labelled with its block, if the live layer failed first
  const src = totalsSource(obs);
  const S = obs.snapshotTotals;
  const asOfSnap = t("chain.asOf", { height: fmtH(obs.asOf.height) });
  return (
    <section className="nw-strip" aria-label={t("network.strip.aria")}>
      <dl className="nw-strip-g">
        <div className="fig metal">
          <dt>{t("network.strip.locked")}</dt>
          {src === "live" ? (<>
            <dd><span className="v t-money">{ergs(obs.totals.unspentNano)}</span><span className="u">ERG</span></dd>
            <dd className="s">{tokens.length ? tokens.map((x) => `+ ${tokenStr(x, lang)}`).join(" · ") : t("network.strip.lockedSub")}</dd>
          </>) : src === "snapshot" ? (<>
            <dd><span className="v t-money">{ergs(BigInt(S.unspentNano))}</span><span className="u">ERG</span></dd>
            <dd className="s">{asOfSnap}</dd>
          </>) : (<>
            <dd><span className="v num">—</span></dd>
            <dd className="s">{t("chain.checking")}</dd>
          </>)}
        </div>
        <div className="fig" title={ours ? t("network.ours.strip", { h: fmtH(ours.mint) }) : undefined}>
          <dt>{t("network.strip.trackers")}</dt>
          <dd><span className="v num">{obs.trackers.length + (ours?.extra ?? 0)}</span></dd>
          <dd className="s">{t("network.strip.trackersSub", { live, gone })}</dd>
        </div>
        <div className="fig">
          <dt>{t("network.strip.reserves")}</dt>
          {src === "live" ? (<>
            <dd><span className="v num">{obs.unspent.length}</span></dd>
            <dd className="s">{t("network.strip.reservesSub", { total: obs.reserves.length })}</dd>
          </>) : src === "snapshot" ? (<>
            <dd><span className="v num">{S.unspent}</span></dd>
            <dd className="s">{t("network.strip.reservesSub", { total: S.reserveBoxes })} · {asOfSnap}</dd>
          </>) : (<>
            <dd><span className="v num">—</span></dd>
            <dd className="s">{t("chain.checking")}</dd>
          </>)}
        </div>
        <div className="fig">
          <dt>{t("network.strip.redemptions")}</dt>
          {/* the live layer counts redemptions after the snapshot from the same first look as the reserves (the detector's
              boxes): no figure that jumps a second later, the snapshot's own count at its block if it failed */}
          {src === "live" ? (<>
            <dd><span className="v num">{obs.redemptions.length}</span></dd>
            <dd className="s">{t("network.strip.redemptionsSub", { n: recent })}</dd>
          </>) : src === "snapshot" ? (<>
            <dd><span className="v num">{S.redemptions}</span></dd>
            <dd className="s">{t("network.strip.redemptionsSub", { n: recent })} · {asOfSnap}</dd>
          </>) : (<>
            <dd><span className="v num">—</span></dd>
            <dd className="s">{t("chain.checking")}</dd>
          </>)}
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
        {withBox.map((tr) => <TrackerPanel key={tr.nft} tr={tr} tip={obs.height} idle={false} />)}
      </div>
      {/* the emergency window's one explanation, once under the cards instead of in each (§5 #12) */}
      {withBox.length > 0 && <p className="nw-em-idle nw-em-idle-once">{t("network.em.idle")}</p>}
      <div className="nw-sub label">{t("network.trk.gone")}</div>
      <ul className="nw-gone">
        {gone.map((tr) => <GoneRow key={tr.nft} tr={tr} />)}
      </ul>
    </section>
  );
}

/** `idle={false}`: the card leaves out the emergency window's explanation, which its page says once under the cards. */
export function TrackerPanel({ tr, tip, compact, idle = true }: { tr: TrackerView; tip: number; compact?: boolean; idle?: boolean }) {
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
          <Dial blocks={Math.min(age, EMERGENCY_BLOCKS)} size={compact ? 64 : 76} labels={false} quiet={tr.nft === OUR_TRACKER.nft ? STALE_AFTER_BLOCKS : undefined} />
        </div>
      )}
      {!hasBox && <p className="nw-trk-gone"><span className="g" aria-hidden="true">{tr.status === "burned" ? "✕" : tr.status === "locked" ? "⊘" : "○"}</span>{goneLine(tr, t)}</p>}
      {tr.beats.length > 0 && <BeatStrip tracker={tr} from={first - Math.max(200, Math.round((end - first) * 0.01))} to={end} n={compact ? 56 : 72} tip={hasBox} />}
      {em && (
        <div className="nw-em">
          <p className={cx("nw-em-l", em.open && "open")}>
            {em.open ? t("network.trk.emOpen", { h: fmtH(em.opensAt) }) : t("network.trk.emOpens", { h: fmtH(em.opensAt), left: blocks(em.blocksLeft, lang) })}
          </p>
          {idle && <p className="nw-em-idle">{t("network.em.idle")}</p>}
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
  // before this tab's first live look the list is the snapshot's: no count that changes a second later (checking), or
  // the count labelled with the snapshot's block (the live layer failed); the breakdown then says it is the snapshot
  const src = totalsSource(obs);
  const sub = t("network.col.reservesSub", { n: list.length });
  return (
    <section className="nw-col" aria-labelledby="nw-col-res">
      <ColHead id="nw-col-res" title={t("network.col.reserves")} to="/network/reserves" n={src === "checking" ? undefined : obs.reserves.length}
        sub={src === "live" ? sub : src === "checking" ? t("chain.checking") : `${sub} · ${t("chain.asOf", { height: fmtH(obs.asOf.height) })}`} />
      <ExitBar rows={rows} total={list.length} note={src === "live" ? undefined : <p className="t-small">{t("chain.live.seedOnly")}</p>} />
      <div className="nw-stack">
        {shown.map((r) => <VaultCard key={r.id} r={r} obs={obs} />)}
      </div>
      {list.length > 5 && (
        <button type="button" className="key sm quiet nw-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t("network.col.showLess") : t("network.col.showAll", { n: list.length })}
        </button>
      )}
      <TopUpKey />
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

/** The view's one metal key, Top up (basis.es action #1: anyone, ≥ 0.1 ERG, no signature). On a reserve page it opens
 *  the mainnet wallet's top-up with that reserve chosen, when the wallet tops it up (unspent, current contract, ERG,
 *  ErgoScan's tracker, the registers the wallet reads, no refund, and tracked by our tracker as its owner's reserve:
 *  anyone can create a box that looks like a reserve); otherwise it stays shut and says why. On the lists it opens the
 *  wallet's own reserve. The wallet reads the reserve and the tracker again before anything is signed. */
export function TopUpKey({ r, nftOf }: { r?: ReserveView; nftOf?: (box: string) => string | null }) {
  const t = useT();
  const ours = useOurTracker();
  const why = r ? topUpShut(r, ours.reserves, nftOf) : null;
  const to = !r ? "/wallet/mainnet/topup" : why || !r.nft ? null : `/wallet/mainnet/topup?nft=${r.nft.id}`;
  return (
    <div className="nw-topup">
      {to ? <Key variant="metal" icon="coin" to={to}>{t("network.topup.key")}</Key>
        : <Key variant="metal" icon="coin" disabled aria-disabled="true" aria-describedby="nw-topup-why">{t("network.topup.key")}</Key>}
      <p id="nw-topup-why">{!r ? t("network.topup.list") : why ? <><b>{t("network.topup.shut")}</b> {t(`network.topup.why.${why}`)}</> : r.collateral && pinnedToken(r.collateral.id) ? t("network.topup.openToken", { sym: pinnedToken(r.collateral.id)!.symbol }) : t("network.topup.open")}</p>
    </div>
  );
}

/** The registers as the wallet reads them (tx/reserveaction.ts readReserve): R4 the owner's key, R5 a tree, R6 our
 *  tracker, R7 a Long ≥ 0 or absent (the contract's 0, wallet-t3). R8, R9 are not in the view: the wallet ignores them
 *  too (the contract never reads them, anyone's top-up can add them). */
function walletReadsRegisters(r: ReserveView): boolean {
  const g = r.regs;
  const r4 = g.R4?.toLowerCase() ?? "";
  const r7 = g.R7 === undefined ? r.r7 === null : /^05[0-9a-f]{2,20}$/.test(g.R7.toLowerCase()) && r.r7 !== null && r.r7 >= 0;
  return /^07(02|03)[0-9a-f]{64}$/.test(r4) && !!r.owner && r.owner.key.toLowerCase() === r4.slice(2) &&
    /^64[0-9a-f]+$/.test(g.R5?.toLowerCase() ?? "") && g.R6?.toLowerCase() === `0e20${OUR_TRACKER.nft}` && r7;
}

/** What our tracker says about one reserve: the fields of its /reserves entry the key needs. It names the reserve by
 *  its box id; `nft` is the tracker's own NFT, not the reserve's. */
type Tracked = { box: string; owner: string; nft: string; token: string | null };

/** Why the wallet does not top up this reserve (null: it does). The wallet's own rules, tx/reserveaction.ts readReserve
 *  and flows/reserveops.ts trackedAs; `tracked` is our tracker's list of reserves (null: not read yet); `nftOf` gives
 *  the reserve NFT of a box the observatory knows (the tracker may name an older box of the same reserve). */
export function topUpShut(r: ReserveView, tracked: readonly Tracked[] | null, nftOf: (box: string) => string | null = () => null): "spent" | "legacy" | "token" | "tracker" | "shape" | "refund" | "unknown" | "untracked" | null {
  if (!r.unspent) return "spent";
  if (!r.contract?.current || r.legacy) return "legacy";
  // a token reserve only in SigUSD or rsADA (the wallet's pinned tokens) under the current multi-token contract
  const token = r.collateral ? pinnedToken(r.collateral.id) : null;
  if (r.kind !== "erg" || r.collateral) {
    if (r.kind !== "token" || !token || r.contract?.templateHash !== CURRENT_TEMPLATES.multiToken) return "token";
  }
  if (!r.nft || r.r6 !== OUR_TRACKER.nft) return "tracker";
  if (!walletReadsRegisters(r)) return "shape";
  if ((r.r7 ?? 0) !== 0) return "refund";
  if (tracked === null) return "unknown";
  const nft = r.nft.id, owner = r.owner!.key.toLowerCase();
  // tracked as its owner's only reserve in this denomination (as the wallet's trackedAs): a second one of that owner
  // is not picked between
  const theirs = tracked.filter((x) => x.nft === OUR_TRACKER.nft && x.owner.toLowerCase() === owner && x.token === (token ? token.id : null));
  if (theirs.length !== 1 || (theirs[0].box !== r.id && nftOf(theirs[0].box) !== nft)) return "untracked";
  return null;
}

export function unitKind(r: ReserveView): "erg" | TokenKind {
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
            {r.owner ? <span className="nw-inl"><KeySeal pk={r.owner.key} size={22} /><span className="hex">{sAddr(r.owner.addr)}</span>{r.owner.label && <span className="nw-label">{r.owner.label}</span>}{isOurTestReserve(r.owner.key) && <OurTestReserveTag />}</span>
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
  // the newest rows are what the user sees first: their txs are read at once, through the tab's one queue
  useFirstReads(list);
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
  // the newest redemption (the list is newest first): when someone last took money out of a reserve, and how much
  const lr = obs.redemptions[0];
  // (a redemption known from its two reserve boxes has no time yet: then the block stands alone)
  if (lr) cells.push({ k: "lastRedemption", v: redemptionAmount(lr, lang), s: lr.at ? <>{date(lr.at, lang)} · {fmtH(lr.height)}</> : fmtH(lr.height), to: `/network/tx/${lr.tx}` });
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
  // the same block rule as the strip: live figures at the live height, the snapshot's own figures at its block
  const src = totalsSource(obs);
  const S = obs.snapshotTotals;
  const line = src === "live" ? pick(copy.mainnetFootnote({ boxes: obs.reserves.length, erg: ergs(obs.totals.unspentNano), height: obs.height }), lang)
    : src === "snapshot" ? pick(copy.mainnetFootnote({ boxes: S.reserveBoxes, erg: ergs(BigInt(S.unspentNano)), height: obs.asOf.height }), lang)
    : t("chain.checking");
  return (
    <aside className="nw-foot" aria-label={t("network.foot.aria")}>
      <p><Icon name="info" size={16} /><span>{line}</span></p>
      <p><Icon name="stamp" size={16} /><span>{t("chain.fee.protocol")}</span></p>
      <p><Icon name="search" size={16} /><span>{t("chain.hostIndex", { listed: hi.listedKnown, total: hi.unspentHere })} {t("network.foot.hostMore", { count: hi.reserveCount, erg: ergs(hi.ergLockedNano), trackers: hi.trackerCount })}</span></p>
      <p><Icon name="warn" size={16} /><span>{t("chain.basisNames", { count: obs.incidents.basisNamedNfts.count })} <Link to="/network/incidents" className="link">{t("network.tab.incidents")}</Link></span></p>
    </aside>
  );
}
