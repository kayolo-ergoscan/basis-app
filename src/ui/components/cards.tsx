// Composite cards from the tile (VISUAL §12.6, §12.7): ReserveCard, TrackerCard, EclipseCard, and the live Tape.
// Data-driven: features pass sandbox or mainnet numbers; every number goes through money().
import { useRef, type ReactNode } from "react";
import { useLang, useT } from "@/app/lang";
import { usePulseClass } from "../hooks";
import { blk, humanTime, int, money, pct, short } from "../engine/money";
import { useUiSettings } from "../settings";
import { Key } from "./Key";
import { BacksBar, CoverageMeter, Dial, Heartbeat, trackerBand, type BacksItem } from "./measures";
import { Note, type NoteProps } from "./Note";
import { CoverageTag, Digest, Honest, Lamp, Tag, TrackerTile, type LampState } from "./primitives";
import { KeySeal } from "./Seal";

const P = (on: boolean, s: string) => (on ? "•••" : s);

export interface ReserveCardProps {
  owner: string;
  pk: string;
  boxes?: number;
  tracker?: string;
  /** Coverage of the ERG notes in %. */
  coverage: number;
  locked: number;
  outstanding: number;
  canIssue?: number;
  topUp?: number;
  backs?: BacksItem[];
  tokens?: { label: ReactNode; pct: number }[];
  /** Exit notice: null = none; a height = exit started at that block. */
  exitAt?: number | null;
  onTopUp?: () => void;
  inspectHref?: string;
  /** "as of block N" for mainnet, or a sandbox label. */
  footnote?: ReactNode;
  unit?: string;
}
export function ReserveCard({ owner, pk, boxes, tracker = "T-01", coverage, locked, outstanding, canIssue, topUp, backs, tokens, exitAt = null, onTopUp, inspectHref, footnote, unit = "ERG" }: ReserveCardProps) {
  const t = useT();
  const { lang } = useLang();
  const ui = useUiSettings();
  return (
    <div className="card">
      <div className="card-h">
        <div className="who-line">
          <KeySeal pk={pk} size="lg" rim />
          <div>
            <div className="t-h4">{t("ui.reserve.title", { name: owner })}</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>{t.p("ui.reserve.sub", boxes ?? 1, { pk: short(pk, 4, 4), tracker })}</div>
          </div>
        </div>
        <CoverageTag pct={coverage} long />
      </div>
      <div className="card-b" style={{ display: "grid", gap: 22 }}>
        <div className="rsv-top">
          <div><div className="label">{t("ui.reserve.coverage", { unit })}</div><div className="big-measure"><span className="v">{Math.round(coverage)}<span className="pc">%</span></span></div></div>
          <div className="rsv-locked">
            <div className="label">{t("ui.reserve.locked")}</div>
            <div className="t-money metal-t" style={{ fontSize: 44, marginTop: 6, color: "var(--metal-ink)" }}>{P(ui.privacy, money(locked))}<span className="unit">{unit}</span></div>
            <div className="t-small">{t("ui.reserve.backs", { v: P(ui.privacy, money(outstanding)) })}</div>
          </div>
        </div>
        <CoverageMeter value={coverage} />
        <div className="figs">
          <div><div className="label">{t("ui.reserve.outstanding")}</div><div className="v">{P(ui.privacy, money(outstanding))}</div></div>
          {canIssue != null && <div><div className="label">{t("ui.reserve.canIssue")}</div><div className="v">{P(ui.privacy, money(canIssue))} <span className="t-small">{t("ui.reserve.before120")}</span></div></div>}
          {topUp != null && <div><div className="label">{t("ui.reserve.topUp")}</div><div className="v">{P(ui.privacy, money(topUp))} <span className="t-small">{t("ui.reserve.to150")}</span></div></div>}
        </div>
        {backs && backs.length > 0 && <div><div className="label" style={{ marginBottom: 8 }}>{t("ui.reserve.whoBacks")}</div><BacksBar items={backs} locked={locked} /></div>}
        {tokens && tokens.length > 0 && (
          <div className="token-rows">
            {tokens.map((x, i) => <TokenRow key={i} label={x.label} pct={x.pct} />)}
          </div>
        )}
        <p className="t-small" style={{ margin: 0 }}>
          {exitAt == null
            ? <>{t("ui.reserve.exitNone.a")} <b style={{ color: "var(--ink-2)", fontWeight: 500 }}>{t("ui.reserve.exitNone.b")}</b>. {t("ui.reserve.exitNone.c", { name: owner, blk: blk(43200, lang), time: humanTime(43200, lang) })}</>
            : <>{t("ui.reserve.exitAt", { h: int(exitAt), until: int(exitAt + 43200), time: humanTime(43200, lang) })}</>}
        </p>
        {footnote && <div className="t-small">{footnote}</div>}
      </div>
      <div className="card-f">
        <Key variant="metal" onClick={onTopUp}>{t("ui.reserve.topUpKey")}</Key>
        <span className="t-small">{t("ui.reserve.anyone")}</span>
        <span style={{ flex: 1 }} />
        {inspectHref && <Key size="sm" variant="quiet" href={inspectHref}>{t("ui.reserve.inspect")} ↗</Key>}
      </div>
    </div>
  );
}
function TokenRow({ label, pct: p }: { label: ReactNode; pct: number }) {
  return <><span>{label}</span><span className="num">{pct(p)} <CoverageTag pct={p} small /></span></>;
}

export interface TrackerCardProps {
  id?: string;
  nft: string;
  blocksAgo: number;
  height?: number;
  notes?: number;
  digest: string;
  /** Heartbeat commits (indices over the last 96 blocks); omit for the sample rhythm. */
  commits?: number[];
  /** Pulse filter id (sandbox "t1" or the NFT id). */
  trackerId?: string;
  footnote?: ReactNode;
}
export function TrackerCard({ id = "T-01", nft, blocksAgo, height, notes, digest, commits, trackerId, footnote }: TrackerCardProps) {
  const t = useT();
  const { lang } = useLang();
  const band = trackerBand(blocksAgo);
  const tile = useRef<HTMLSpanElement>(null);
  usePulseClass(tile, (p) => !trackerId || p.trackerId === trackerId);
  const lamp: LampState = band === "ontime" ? "live" : band === "late" ? "tracked" : band === "silent" ? "stale" : "alarm";
  return (
    <div className="card">
      <div className="card-h">
        <div className="who-line">
          <TrackerTile id={id} stale={band === "silent" || band === "emergency"} tileRef={tile} />
          <div>
            <div className="t-h4">{t("ui.tracker.title", { id })}</div>
            <div className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)" }}>NFT {short(nft, 4, 4)} · {t("ui.tracker.anyone")}</div>
          </div>
        </div>
        <Tag tone={band === "emergency" ? "warn" : "ok"}><Lamp state={lamp} size={7} />{t(`ui.tracker.${band}`)}</Tag>
      </div>
      <div className="card-b" style={{ display: "grid", gap: 20 }}>
        <div className="spread" style={{ "--gap": "20px", alignItems: "center" } as React.CSSProperties}>
          <div>
            <div className="label">{t("ui.tracker.last")}</div>
            <div className="big-measure"><span className="v">{int(blocksAgo)}</span><span className="u">{t("ui.tracker.blocksAgo")}</span></div>
            <div className="t-small" style={{ marginTop: 4 }}>
              {humanTime(blocksAgo, lang)}{height != null ? ` · ${t("ui.tracker.block", { n: int(height) })}` : ""}{notes != null ? ` · ${t.p("ui.tracker.notes", notes, { n: int(notes) })}` : ""}
            </div>
          </div>
          <div className="dial-side">
            <Dial blocks={blocksAgo} size={140} />
            <div style={{ maxWidth: 160 }}>
              <div className="label">{t("ui.tracker.deadman")}</div>
              <div className="t-measure" style={{ marginTop: 4 }}>{blk(Math.max(0, 2160 - blocksAgo), lang)}</div>
              <div className="t-small">{t("ui.tracker.spare")}</div>
            </div>
          </div>
        </div>
        <div>
          <div className="spread" style={{ marginBottom: 8 }}><span className="label">{t("ui.tracker.beats", { n: 96 })}</span><span className="label">{t("ui.tracker.now")} ▸</span></div>
          <Heartbeat commits={commits} silent={band === "silent" || band === "emergency"} />
        </div>
        <Digest value={digest} />
        <Honest tracker={id} />
        {footnote && <div className="t-small">{footnote}</div>}
      </div>
    </div>
  );
}

export interface EclipseCardProps {
  id?: string;
  silentBlocks: number;
  note?: NoteProps;
}
/** The same tracker after a long silence: calm, not an alarm (VISUAL §12.7). */
export function EclipseCard({ id = "T-01", silentBlocks, note }: EclipseCardProps) {
  const t = useT();
  const { lang } = useLang();
  const left = Math.max(0, 2160 - silentBlocks);
  return (
    <div className="card">
      <div className="card-h">
        <span className="label"><b>{t("ui.eclipse.title")}</b> · {t("ui.eclipse.sub", { id, n: int(silentBlocks) })}</span>
        <Tag><Lamp state="stale" size={8} />{t(`ui.tracker.${trackerBand(silentBlocks)}`)}</Tag>
      </div>
      <div className="card-b eclipse-b">
        <Dial blocks={silentBlocks} size={92} labels={false} />
        <div>
          <div style={{ font: "600 16px/1.3 var(--f-ui)" }}>
            {left > 0 ? <>{t("ui.eclipse.in", { blk: blk(left, lang) })} <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>{humanTime(left, lang)}</span></> : t("ui.eclipse.open")}
          </div>
          <p className="t-small" style={{ marginTop: 4 }}>{t("ui.eclipse.calm", { id, blk: blk(2160, lang) })}</p>
        </div>
        {note && <Note {...note} lite state="stale" limit={0} decorative style={{ boxShadow: "0 10px 22px -12px rgba(var(--shade),.7)" }} />}
      </div>
    </div>
  );
}

export interface TapeEvent { type: "NOTE" | "COMMIT" | "REDEEM" | "CALL" | string; lamp?: LampState; parties: ReactNode; amount?: ReactNode }
/** The departure board (VISUAL §12.12): "SANDBOX · LIVE TAPE" for demo data, "MAINNET" for real data. */
export function Tape({ source, events, right, framed = true }: { source: "sandbox" | "mainnet"; events: TapeEvent[]; right?: ReactNode; framed?: boolean }) {
  const t = useT();
  const body = (
    <>
      <span className="label"><b>{source === "sandbox" ? t("ui.tape.sandbox") : t("ui.tape.mainnet")}</b></span>
      <div className="board-rows" aria-live="off">
        {events.map((e, i) => (
          <span key={i} className="board-row"><span className="ev">{e.type}</span>{e.lamp && <Lamp state={e.lamp} size={8} />}{e.parties}{e.amount != null && <b>{e.amount}</b>}</span>
        ))}
      </div>
      <span>{right}</span>
    </>
  );
  if (framed) return <div className="tape"><div className="board-in">{body}</div></div>;
  return <div className="board"><div className="container">{body}</div></div>;
}
