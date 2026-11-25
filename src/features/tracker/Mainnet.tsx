// /tracker/mainnet: the console for ErgoScan's real tracker on Ergo mainnet, read-only (src/chain/ours).
//   01  the XL card (last commit, next heartbeat, emergency dial, digests) beside reserves and funds; the MAINNET tape
//   02  the reserves bound to this tracker (R6 = its NFT), or the honest empty state
//   03  a key lookup (/key-status/{pk}), one at a time
// Every figure is the tracker API's answer or the chain's; "—" when it is not known yet. Nothing here signs or sends.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { useTitle } from "@/app";
import { copy, pick } from "@/content";
import {
  EMERGENCY_BLOCKS, EMPTY_DIGEST, OUR_TRACKER, OurTestReserveTag, STALE_AFTER_BLOCKS, explorer, isOurTestReserve, p2pkAddress, parseKeyInput, useAgo, useKeyLookup, useNow, useOurTracker,
  type KeyDenomination, type KeyStatus, type OurEvent, type OurStatus, type OurView, type TrackedReserve,
} from "@/chain";
import {
  blk, Card, CopyButton, CoverageTag, Dial, Digest, Empty, Field, Honest, Icon, int, Key, KeySeal, Lamp, PageHead, ratioPct, Section,
  short, Table, Tape, TextInput, TrackerTile, units, useIsPhone, usePulseClass, type Column, type LampState, type TapeEvent,
} from "@/ui";
import { HeadActions, htime, md, ModeSwitch } from "./parts";

const DASH = "—";
const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
const HEARTBEAT = 720;

/** Smallest dp ≥ 2 that shows `raw` exactly: mainnet amounts are tiny, a fixed 2 dp would print 0.001 ERG as "0.00". */
function dpFor(raw: bigint, decimals: number, min = 2): number {
  if (decimals <= min) return decimals;
  let r = raw < 0n ? -raw : raw;
  let dp = decimals;
  while (dp > min && r % 10n === 0n) { r /= 10n; dp--; }
  return dp;
}
const amountOf = (raw: bigint, decimals: number): string => units(raw, decimals, dpFor(raw, decimals));
const ergStr = (nano: bigint): string => amountOf(nano, 9);
/** Debt and collateral cells: no debt reads "0 ERG", not "0.00 ERG". */
const sumOf = (raw: bigint, decimals: number): string => (raw === 0n ? "0" : amountOf(raw, decimals));

const STATE: Record<OurStatus, { lamp: LampState; cls: string }> = {
  connecting: { lamp: "signed", cls: "s-off" },
  live: { lamp: "live", cls: "s-live" },
  stale: { lamp: "stale", cls: "s-off" },
  unreachable: { lamp: "off", cls: "s-alarm" },
};

function useErr() {
  const t = useT();
  return (e: OurView["error"]) => {
    if (!e) return "";
    if (e.kind === "unavailable") return t("chain.ours.err.unavailable", { status: e.status ?? DASH });
    if (e.kind === "http") return t("chain.ours.err.http", { message: e.message });
    return t(`chain.ours.err.${e.kind}`);
  };
}

/** "Answered 12 s ago · asked every 30 s while this tab is open" (or the saved answer's age, the failure, the wait). */
function Answer({ v }: { v: OurView }) {
  const t = useT();
  const ago = useAgo();
  const now = useNow(5_000);
  const err = useErr();
  const parts: string[] = [];
  parts.push(v.answeredAt === null ? t("chain.ours.never") : t(v.cached ? "chain.ours.saved" : "chain.ours.answered", { ago: ago(v.answeredAt) }));
  if (v.error && (v.status === "unreachable" || v.limited)) parts.push(err(v.error));
  const wait = v.backoffUntil !== null ? Math.ceil((v.backoffUntil - now) / 1000) : 0;
  parts.push(wait > 0 ? t("chain.ours.retry", { s: wait }) : t("chain.ours.every"));
  return <span className={cx("trk-m-ans", v.status === "unreachable" && "err")}>{parts.join(" · ")}</span>;
}

export default function MainnetConsole() {
  const t = useT();
  const v = useOurTracker({ fees: true });
  useTitle(`${t("tracker.m.title")} · ${t("tracker.title")}`);
  return (
    <>
      <div className="container">
        <PageHead eyebrow={t("tracker.m.eyebrow")} title={md(t("tracker.m.h1"))} actions={<HeadActions sandbox={false} mainnet />} />
        <TrackerLead v={v} />
        <ModeSwitch mode="main" />
        <div className="trk-m-top">
          <div className="trk-m-xl"><MainnetXL v={v} /></div>
          <div className="trk-m-side"><SideCard v={v} /></div>
        </div>
        <LiveTape v={v} />
      </div>

      <Section id="reserves" no={t("tracker.m.res.no")} title={md(t("tracker.m.res.title"))} lede={t("tracker.m.res.lede")}>
        <Reserves v={v} />
      </Section>

      <Section id="lookup" no={t("tracker.m.key.no")} title={md(t("tracker.m.key.title"))} lede={t("tracker.m.key.lede")}>
        {/* a lookup asked by a link waits for the reserves answer, so the page above it no longer grows */}
        <KeyLookup ready={v.reserves !== null || v.reservesError !== null || v.status === "unreachable"} />
      </Section>
    </>
  );
}

/* ---------------- the lead: one status line and four figures in plain words ---------------- */

function TrackerLead({ v }: { v: OurView }) {
  const t = useT();
  const lang = t.lang;
  const st = STATE[v.status];
  const em = v.emergency;
  return (
    <section className="trk-lead" aria-label={t("tracker.m.lead.aria")}>
      <p className="trk-lead-status">
        <Lamp state={st.lamp} size={9} />
        <b>{t(`chain.ours.st.${v.status}`)}</b>
        <span className="sep" aria-hidden="true">·</span>
        <span>{t("tracker.m.lead.since")}</span>
      </p>
      <dl className="trk-lead-g">
        <div>
          <dt>{t("tracker.m.lead.last")}</dt>
          <dd className="v">{v.age !== null ? <>{int(v.age)}<span className="u">{t.p("tracker.agoUnit", v.age)}</span></> : DASH}</dd>
          <dd className="s">{v.age !== null ? htime(v.age, lang) : v.answeredAt === null ? t("tracker.m.lastNone") : ""}</dd>
        </div>
        <div>
          <dt>{t("tracker.m.lead.reserves")}</dt>
          <dd className="v">{v.totals ? int(v.totals.count) : DASH}</dd>
          <dd className="s">{t("tracker.m.lead.reservesSub")}</dd>
        </div>
        <div className="metal">
          <dt>{t("tracker.m.lead.erg")}</dt>
          <dd className="v">{v.totals ? <>{ergStr(v.totals.ergNano)}<span className="u">ERG</span></> : DASH}</dd>
          <dd className="s">{t("tracker.m.collateralSub")}</dd>
        </div>
        <div>
          <dt>{t("tracker.m.lead.exit")}</dt>
          <dd className="v">{em ? (em.open ? t("tracker.m.lead.exitOpen") : blk(em.blocksLeft, lang)) : DASH}</dd>
          <dd className="s">{t("tracker.m.dialLeft")}</dd>
        </div>
      </dl>
      <p className="t-small trk-lead-note">{t("tracker.m.lede")}</p>
    </section>
  );
}

/* ---------------- 01 the XL card ---------------- */

function MainnetXL({ v }: { v: OurView }) {
  const t = useT();
  const lang = t.lang;
  const phone = useIsPhone();
  const tile = useRef<HTMLSpanElement>(null);
  usePulseClass(tile, (p) => p.source === "mainnet" && p.trackerId === OUR_TRACKER.nft);
  const st = STATE[v.status];
  const em = v.emergency;
  const key = useKeyOfTracker();
  const nextAt = v.height !== null ? v.height + HEARTBEAT : null;
  const nextIn = v.age !== null ? HEARTBEAT - v.age : null;
  return (
    <article className="card trk-xl trk-m-card" aria-labelledby="trk-m-title">
      <header className="trk-xl-h">
        <div className="trk-xl-id">
          <TrackerTile id={OUR_TRACKER.nft.slice(0, 4).toUpperCase()} size={phone ? "md" : "lg"} stale={v.status !== "live"} tileRef={tile} />
          <div className="trk-xl-who">
            <div className="label">{t("tracker.m.card.eyebrow")}</div>
            <h2 className="trk-xl-name" id="trk-m-title">{t("tracker.m.card.name")}</h2>
            <div className="trk-xl-sub">
              <span>NFT {short(OUR_TRACKER.nft, 4, 4)}</span>
              {key && <span>{t("tracker.m.card.key")} {short(key, 4, 4)}</span>}
              <span>{t("tracker.m.card.by")}</span>
              <span>{t("ui.tracker.anyone")}</span>
            </div>
          </div>
        </div>
        <div className="trk-xl-tags trk-m-tags">
          <span className={`trk-state ${st.cls}`} role="status" title={t(`chain.ours.st.${v.status}.help`)}>
            <Lamp state={st.lamp} size={9} />
            {t(`chain.ours.st.${v.status}`)}
          </span>
          <Answer v={v} />
        </div>
      </header>

      <div className="trk-xl-b">
        <div className="trk-xl-top">
          <div className="trk-last">
            <div className="label">{t("tracker.m.last")}</div>
            {v.age !== null && v.height !== null ? (
              <>
                <div className="big-measure">
                  <span className="v">{int(v.age)}</span>
                  <span className="u">{t.p("tracker.agoUnit", v.age)}</span>
                </div>
                <div className="t-small trk-last-sub">
                  <span className="trk-seps">
                    <span>{htime(v.age, lang)}</span>
                    <span>{t("ui.tracker.block", { n: int(v.height) })}</span>
                  </span>
                </div>
              </>
            ) : v.height !== null ? (
              <div className="big-measure"><span className="v">{int(v.height)}</span></div>
            ) : (
              <p className="t-small">{v.answeredAt === null ? t("tracker.m.lastNone") : DASH}</p>
            )}
          </div>

          <div className="trk-next">
            <div className="label">{t("tracker.m.next")}</div>
            <div className="trk-next-v">
              {nextAt !== null ? t("tracker.m.nextAt", { h: int(nextAt) }) : DASH}
              {nextIn !== null && (
                <span className="trk-next-time"> {nextIn >= 0 ? t("tracker.m.nextIn", { blk: blk(nextIn, lang) }) : t("tracker.m.nextOver", { blk: blk(-nextIn, lang) })}</span>
              )}
            </div>
            <p className="t-small trk-next-why">{t("tracker.m.nextWhy")}</p>
          </div>

          <div className="dial-side trk-dial">
            <Dial blocks={Math.min(v.age ?? 0, EMERGENCY_BLOCKS + 1)} size={phone ? 118 : 150} quiet={STALE_AFTER_BLOCKS} />
            <div className="trk-dial-t">
              <div className="label">{t("tracker.m.dial")}</div>
              <div className="t-measure trk-spare">{em ? (em.open ? DASH : blk(em.blocksLeft, lang)) : DASH}</div>
              <div className="t-small">{t("tracker.m.dialLeft")}</div>
              {em && <div className="t-small dim trk-opens">{t(em.open ? "tracker.m.dialOpen" : "tracker.m.dialAt", { h: int(em.opensAt) })}</div>}
            </div>
          </div>
        </div>

        <div className="trk-digests">
          {v.digest ? <Digest value={v.digest} label={t("tracker.m.digest")} /> : (
            <div className="digest"><span className="label" style={{ flex: "none" }}>{t("tracker.m.digest")}</span><b className="hex">{DASH}</b></div>
          )}
          <div className={v.inSync === false ? "trk-live-digest" : "trk-live-digest same"}>
            <span className="label">{t("tracker.m.live")}</span>
            <span className="t-small">{v.inSync === null ? DASH : v.inSync ? t("tracker.m.liveSame") : t("tracker.m.liveAhead")}</span>
          </div>
          {v.digest === EMPTY_DIGEST && <p className="t-small dim trk-m-emptytree">{t("tracker.m.emptyTree")}</p>}
          {v.pending && (
            <div className="trk-live-digest">
              <span className="label">{t("tracker.m.pending")}</span>
              <a className="textlink t-small" href={explorer.tx(v.pending.tx)} target="_blank" rel="noreferrer">{short(v.pending.tx, 8, 6)} <Icon name="ext" size={12} /></a>
            </div>
          )}
        </div>

        <Honest tracker={t("chain.ours.name")} />
        <p className="t-small dim">{pick(copy.emergencyIsAvailability, lang)}</p>
      </div>
    </article>
  );
}

/** The tracker's key: R4 of its box, which is also the key of its address (checked on chain, 22 Nov 2026); the API does not send it. */
function useKeyOfTracker(): string | null {
  return useMemo(() => {
    const r = parseKeyInput(OUR_TRACKER.address);
    return r.ok ? r.key : null;
  }, []);
}

/* ---------------- 01 side: reserves and funds ---------------- */

function SideCard({ v }: { v: OurView }) {
  const t = useT();
  const ago = useAgo();
  const tok = v.totals?.tokens.reduce((n, x) => n + x.count, 0) ?? 0;
  const resSub = !v.totals ? DASH : v.totals.count === 0 ? t("tracker.m.noneShort") : tok ? t.p("tracker.m.tokens", tok) : "";
  return (
    <Card className="trk-m-sidecard" title={t("tracker.m.side")} aside={<span className="label">{t("tracker.mode.main")}</span>}>
      <div className="trk-m-figs">
        <div>
          <div className="label">{t("tracker.m.reserves")}</div>
          <div className="trk-m-v num">{v.totals ? int(v.totals.count) : DASH}</div>
          <div className="t-small">{resSub}</div>
        </div>
        <div className="metal">
          <div className="label">{t("tracker.m.collateral")}</div>
          <div className="trk-m-v t-money">{v.totals ? ergStr(v.totals.ergNano) : DASH}{v.totals && <span className="u">ERG</span>}</div>
          <div className="t-small">{t("tracker.m.collateralSub")}</div>
        </div>
      </div>
      <div className="trk-m-fees">
        <div className="label">{t("tracker.m.fees")}</div>
        <div className="trk-m-v num">{v.fees ? `${v.fees.partial ? "≥ " : ""}${ergStr(v.fees.nano)}` : DASH}{v.fees && <span className="u">ERG</span>}</div>
        <p className="t-small">{t("tracker.m.feesSub")}{v.feesAt !== null ? ` ${t(v.feesCached ? "chain.ours.saved" : "chain.ours.answered", { ago: ago(v.feesAt) })}.` : ""}</p>
      </div>
      <dl className="trk-kv trk-m-kv">
        <div><dt>{t("tracker.m.f.nft")}</dt><dd><ExtId kind="token" id={OUR_TRACKER.nft} /></dd></div>
        <div><dt>{t("tracker.m.f.box")}</dt><dd>{v.box ? <ExtId kind="box" id={v.box} /> : DASH}</dd></div>
        <div><dt>{t("tracker.m.f.mint")}</dt><dd><a className="textlink" href={explorer.tx(OUR_TRACKER.mintTx)} target="_blank" rel="noreferrer">{t("ui.tracker.block", { n: int(OUR_TRACKER.mintHeight) })} <Icon name="ext" size={12} /></a></dd></div>
        <div><dt>{t("tracker.m.f.address")}</dt><dd><ExtId kind="address" id={OUR_TRACKER.address} /></dd></div>
      </dl>
      <Link className="textlink t-small" to={`/network/tracker/${OUR_TRACKER.nft}`}>{t("tracker.m.network")} →</Link>
    </Card>
  );
}

/** Coverage = collateral / debt as the tracker reports it (2.0 = 200 %); "—" when there is no debt or no ratio. */
function Cover({ ratio }: { ratio: number | null }) {
  if (ratio === null) return <span className="dim">{DASH}</span>;
  return <span className="trk-m-cov"><span className="num">{ratioPct(ratio)}</span><CoverageTag pct={ratio * 100} small /></span>;
}

/** A reserve owner: its seal and P2PK address (the tracker sends the key; the key is in the tooltip), and the quiet
 *  tag on ErgoScan's own test reserve. */
function Owner({ pk }: { pk: string }) {
  const addr = useMemo(() => { try { return p2pkAddress(pk); } catch { return null; } }, [pk]);
  return (
    <span className="trk-m-owner" title={pk}>
      <KeySeal pk={pk} size="sm" />
      {addr ? <ExtId kind="address" id={addr} /> : <code className="trk-code">{short(pk, 6, 4)}</code>}
      {isOurTestReserve(pk) && <OurTestReserveTag />}
    </span>
  );
}

function ExtId({ kind, id }: { kind: "token" | "box" | "address" | "tx"; id: string }) {
  const text = short(id, 6, 4);
  return (
    <span className="trk-m-id">
      <a className="trk-code" href={explorer[kind](id)} target="_blank" rel="noreferrer" title={id}>{text}</a>
      <Icon name="ext" size={12} />
      <CopyButton value={id} small />
    </span>
  );
}

/* ---------------- the MAINNET tape ---------------- */

function LiveTape({ v }: { v: OurView }) {
  const t = useT();
  const ago = useAgo();
  const events: TapeEvent[] = v.events.length
    ? v.events.map((e) => tapeEvent(e, t, ago))
    : [{ type: "", lamp: "signed", parties: <span>{t("tracker.m.tape.none")}{v.height !== null ? ` · ${t("tracker.m.tape.last", { h: int(v.height) })}` : ""}</span> }];
  return (
    <section className="trk-m-tape" aria-label={t("tracker.m.tape.aria")}>
      <Tape source="mainnet" events={events} right={<Answer v={v} />} />
    </section>
  );
}

function tapeEvent(e: OurEvent, t: ReturnType<typeof useT>, ago: (at: number) => string): TapeEvent {
  if (e.kind === "commit") {
    return {
      type: "COMMIT",
      lamp: "committed",
      parties: <span>{t(e.heartbeat ? "tracker.m.tape.heartbeat" : "tracker.m.tape.commit", { h: e.height !== null ? int(e.height) : DASH })} · {ago(e.at)}</span>,
    };
  }
  return {
    type: "RESERVE",
    lamp: "tracked",
    parties: <span>{t("tracker.m.tape.reserve", { box: short(e.box, 6, 4) })}{isOurTestReserve(e.owner) ? ` · ${t("chain.ours.testReserve")}` : ""} · {ago(e.at)}</span>,
    amount: e.token ? `${units(e.collateral, 0, 0)} ${short(e.token, 4, 4)}` : `${ergStr(e.collateral)} ERG`,
  };
}

/* ---------------- 02 reserves ---------------- */

export function Reserves({ v }: { v: OurView }) {
  const t = useT();
  const ago = useAgo();
  const phone = useIsPhone();
  const cols: Column<TrackedReserve>[] = [
    { key: "box", label: t("tracker.m.res.c.box"), lead: true, render: (r) => <ExtId kind="box" id={r.box} /> },
    { key: "o", label: t("tracker.m.res.c.owner"), render: (r) => <Owner pk={r.owner} /> },
    { key: "c", label: t("tracker.m.res.c.collateral"), align: "right", render: (r) => r.token
      ? <span className="num" title={t("tracker.m.res.tokenRaw", { id: short(r.token, 4, 4) })}>{units(r.collateral, 0, 0)} <span className="dim">{short(r.token, 4, 4)}</span></span>
      : <span className="num">{ergStr(r.collateral)} ERG</span> },
    // debt = the owner's note totals minus what is redeemed, in the reserve's own units (raw units for a token)
    { key: "d", label: t("tracker.m.res.c.debt"), align: "right", render: (r) => r.token
      ? <span className="num" title={t("tracker.m.res.tokenRaw", { id: short(r.token, 4, 4) })}>{units(r.debt, 0, 0)} <span className="dim">{short(r.token, 4, 4)}</span></span>
      : <span className="num">{sumOf(r.debt, 9)} ERG</span> },
    { key: "cov", label: t("tracker.m.res.c.cover"), render: (r) => <Cover ratio={r.ratio} /> },
    { key: "u", label: t("tracker.m.res.c.updated"), align: "right", render: (r) => (
      <span className="num">{int(r.updatedHeight)}{r.refundHeight > 0 && <span className="dim"> · {t("tracker.m.res.refund", { h: int(r.refundHeight) })}</span>}</span>
    ) },
  ];
  const when = v.reservesAt !== null ? t(v.reservesCached ? "chain.ours.saved" : "chain.ours.answered", { ago: ago(v.reservesAt) }) : null;
  return (
    <div className="trk-m-res">
      {v.reserves === null ? (
        <p className="t-small">{v.answeredAt === null && v.status !== "unreachable" ? t("tracker.m.key.loading") : DASH}</p>
      ) : v.reserves.length === 0 ? (
        <Empty title={t("tracker.m.res.emptyTitle")} text={t("tracker.m.res.emptyText")} ghost={t("tracker.m.res.ghost")} className="trk-m-empty" />
      ) : (
        <div className="trk-m-table"><Table<TrackedReserve> columns={cols} rows={v.reserves} rowKey={(r) => r.box} stack={phone} caption={t("tracker.m.res.title").replace(/\*/g, "")} /></div>
      )}
      {when && <p className="t-small dim trk-m-when">{when}{v.reservesError ? ` · ${t("chain.ours.err." + v.reservesError.kind, { status: v.reservesError.status ?? DASH, message: v.reservesError.message })}` : ""}</p>}
      {v.skipped > 0 && <p className="t-small dim">{t.p("tracker.m.res.skipped", v.skipped)}</p>}
    </div>
  );
}

/* ---------------- 03 key lookup ---------------- */

function KeyLookup({ ready }: { ready: boolean }) {
  const t = useT();
  const { lookup, run } = useKeyLookup();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [params] = useSearchParams();
  const asked = params.get("key");
  const nav = useLocation().key;
  const fromLink = useRef(false);
  const result = useRef<HTMLDivElement>(null);
  const [queued, setQueued] = useState<string | null>(null);
  // ?key= (a link to a lookup): fill the field now, ask once the page is ready; once per link click
  useEffect(() => {
    if (!asked) return;
    const r = parseKeyInput(asked);
    setText(asked);
    if (!r.ok) { setError(t(`tracker.m.key.err.${r.reason}`)); return; }
    setError(null);
    setFrom(r.from === "address" ? asked.trim() : null);
    setQueued(r.key);
  }, [asked, nav]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!queued || !ready) return;
    setQueued(null);
    fromLink.current = true;
    run(queued);
    document.getElementById("lookup")?.scrollIntoView({ block: "start" });
  }, [queued, ready, run]);
  // a lookup asked by a link: bring its answer into view once it is there (the page above may have grown meanwhile)
  useEffect(() => {
    if (lookup.phase !== "done" || !fromLink.current) return;
    fromLink.current = false;
    result.current?.scrollIntoView({ block: "nearest" });
  }, [lookup.phase]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const r = parseKeyInput(text);
    if (!r.ok) { setError(t(`tracker.m.key.err.${r.reason}`)); return; }
    setError(null);
    setFrom(r.from === "address" ? text.trim() : null);
    run(r.key);
  };
  return (
    <div className="trk-m-lookup">
      <form className="trk-m-form" onSubmit={submit} noValidate>
        <Field label={t("tracker.m.key.label")} help={t("tracker.m.key.help")} error={error ?? undefined}>
          <TextInput mono value={text} onChange={(s) => { setText(s); if (error) setError(null); }} placeholder={t("tracker.m.key.placeholder")} autoComplete="off" spellCheck={false} />
        </Field>
        <Key type="submit" variant="primary" icon="search" disabled={lookup.phase === "loading"}>{t("tracker.m.key.go")}</Key>
      </form>
      <div className="trk-m-result" aria-live="polite" ref={result}>
        {lookup.phase === "loading" && <p className="t-small">{t("tracker.m.key.loading")}</p>}
        {lookup.phase === "done" && (lookup.answer.ok
          ? <KeyResult data={lookup.answer.data} at={lookup.answer.at} from={from} />
          : <LookupFailed a={lookup.answer} />)}
      </div>
    </div>
  );
}

function LookupFailed({ a }: { a: Extract<ReturnType<typeof useKeyLookup>["lookup"], { phase: "done" }>["answer"] }) {
  const t = useT();
  if (a.ok) return null;
  const why = a.kind === "unavailable" ? t("chain.ours.err.unavailable", { status: a.status ?? DASH })
    : a.kind === "http" ? t("chain.ours.err.http", { message: a.message })
      : a.kind === "rate" && a.retryAfterMs ? `${t("chain.ours.err.rate")} · ${t("chain.ours.retry", { s: Math.ceil(a.retryAfterMs / 1000) })}`
        : t(`chain.ours.err.${a.kind}`);
  return <p className="trk-m-fail" role="alert">{t("tracker.m.key.failed", { why })}</p>;
}

export function KeyResult({ data, at, from }: { data: KeyStatus; at: number; from: string | null }) {
  const t = useT();
  const ago = useAgo();
  const phone = useIsPhone();
  const addr = useMemo(() => { try { return p2pkAddress(data.key); } catch { return null; } }, [data.key]);
  const empty = data.notes === 0 && data.denominations.every((d) => d.debt === 0n && d.collateral === 0n && d.notes === 0 && !d.reserve);
  const cols: Column<KeyDenomination>[] = [
    { key: "n", label: t("tracker.m.key.d.denom"), lead: true, render: (d) => <b>{d.symbol || short(d.id, 4, 4)}</b> },
    { key: "debt", label: t("tracker.m.key.d.debt"), align: "right", render: (d) => <span className="num">{sumOf(d.debt, d.decimals)}{d.symbol && ` ${d.symbol}`}</span> },
    { key: "col", label: t("tracker.m.key.d.collateral"), align: "right", render: (d) => <span className="num">{sumOf(d.collateral, d.decimals)}{d.symbol && ` ${d.symbol}`}</span> },
    { key: "cov", label: t("tracker.m.key.d.cover"), render: (d) => <Cover ratio={d.ratio} /> },
    { key: "notes", label: t("tracker.m.key.d.notes"), align: "right", render: (d) => <span className="num">{int(d.notes)}</span> },
    { key: "res", label: t("tracker.m.key.d.reserve"), render: (d) => d.reserve ? <ExtId kind="box" id={d.reserve} /> : <span className="dim">{DASH}</span> },
  ];
  return (
    <div className="trk-m-keyres">
      <div className="trk-m-keyhead">
        <KeySeal pk={data.key} size="md" />
        <div className="trk-m-keyt">
          <code className="trk-code">{short(data.key, 10, 8)}</code>
          <span className="t-small dim">
            {from ? t("tracker.m.key.fromAddr", { addr: short(from, 6, 4) }) : addr ? short(addr, 6, 4) : ""}
            {" · "}{t("chain.ours.answered", { ago: ago(at) })}
          </span>
        </div>
        <div className="trk-m-keytags">
          {isOurTestReserve(data.key) && <OurTestReserveTag />}
          <span className="label num">{t.p("tracker.m.key.notes", data.notes, { n: int(data.notes) })}</span>
          {data.pendingRefund && <span className="label">{t("tracker.m.key.refund")}</span>}
        </div>
      </div>
      {empty ? (
        <Empty title={t("tracker.m.key.noneTitle")} text={t("tracker.m.key.noneText")} ghost={short(data.key, 4, 4)} className="trk-m-empty" />
      ) : (
        <div className="trk-m-table"><Table<KeyDenomination> columns={cols} rows={data.denominations} rowKey={(d) => d.id} stack={phone} caption={t("tracker.m.key.d.denom")} /></div>
      )}
    </div>
  );
}
