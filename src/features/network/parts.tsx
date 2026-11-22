// Shared pieces of the Network pages: explorer links, freshness labels, exit / tracker / contract tags, key names,
// the network bar (sub-navigation + live status), loading and error frames. Tokens only (network.css).
import { startTransition, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useT } from "@/app";
import { CopyButton, Icon, KeySeal, Lamp, Loading, Tag, TrackerTile, usePulseClass, type LampState, type TagTone } from "@/ui";
import { copy, pick } from "@/content";
import { explorer, oursExtra, useChainStatus, type ContractView, type ExitClass, type Hex, type Observatory, type TrackerView } from "@/chain";
import { blocks, height as fmtH, keyOfAddress, sAddr, sid, type Lang } from "./fmt";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ---------- long lists without long tasks ---------- */
/** Renders a long list in two steps: the first `first` items in this frame, the rest in a transition that React
 *  time-slices. A page of key seals (each one is drawn on first use) never blocks the main thread for 100 ms. */
export function useProgressive<T>(list: readonly T[], first: number): readonly T[] {
  const [full, setFull] = useState(list.length <= first);
  useEffect(() => {
    if (full) return;
    const id = requestAnimationFrame(() => startTransition(() => setFull(true)));
    return () => cancelAnimationFrame(id);
  }, [full]);
  return full ? list : list.slice(0, first);
}

/** False for the first frame, then true through a transition: heavy parts of a page mount after the first paint,
 *  time-sliced, instead of inside one long task. */
export function useAfterPaint(): boolean {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => startTransition(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  return ready;
}

/* ---------- explorer links (ergoscan.me only, PRODUCT §1) ---------- */
export type ExtKind = "tx" | "box" | "token" | "address";
/** External link to the explorer, with ↗. */
export function Ext({ kind, id, children, className, title }: { kind: ExtKind; id: string; children?: ReactNode; className?: string; title?: string }) {
  const t = useT();
  return (
    <a className={cx("nw-ext", className)} href={explorer[kind](id)} target="_blank" rel="noreferrer" title={title ?? t("network.ext.title")}
      aria-label={children ? undefined : `${t(`network.ext.${kind}`)} ${sid(id, 6, 6)} ${t("network.ext.title")}`}>
      {children ?? <Icon name="ext" size={13} />}
      {children ? <Icon name="ext" size={12} /> : null}
    </a>
  );
}

/** Mono id: an internal link when `to` is set, plus the explorer ↗ and an optional Copy. */
export function IdLink({ id, kind, to, a = 4, b = 4, copy, className }: { id: string; kind: ExtKind; to?: string; a?: number; b?: number; copy?: boolean; className?: string }) {
  const text = kind === "address" ? sAddr(id) : sid(id, a, b);
  return (
    <span className={cx("nw-id", className)} title={id}>
      {to ? <Link to={to} className="hex">{text}</Link> : <span className="hex">{text}</span>}
      <Ext kind={kind} id={id} />
      {copy && <CopyButton value={id} small />}
    </span>
  );
}

/* ---------- freshness: "as of block N" ---------- */
/** "as of block N": live (verdigris lamp) once the live layer has confirmed it, else the snapshot (hollow lamp). */
export function AsOf({ h, live, className, prefix }: { h: number | null | undefined; live?: boolean; className?: string; prefix?: ReactNode }) {
  const t = useT();
  if (h == null) return null;
  return (
    <span className={cx("nw-asof", className)} title={live ? t("network.asof.liveTitle") : t("network.asof.seedTitle")}>
      <Lamp state={live ? "live" : "signed"} size={7} />
      {prefix}{live ? t("chain.live.checked", { height: fmtH(h) }) : t("chain.asOf", { height: fmtH(h) })}
    </span>
  );
}

/* ---------- exit classes (R16) ---------- */
const EXIT_TONE: Record<ExitClass, [TagTone, string]> = {
  locked: ["warn", "✕"],
  refund: ["watch", "↩"],
  "refund+redeem": ["up", "⇅"],
  "redeem-if-tracker": ["plain", "◌"],
  redeem: ["up", "↓"],
  "refund+redeem-if-tracker": ["watch", "↩"],
};
export const EXIT_ORDER: ExitClass[] = ["refund+redeem", "redeem", "redeem-if-tracker", "refund+redeem-if-tracker", "refund", "locked"];
/** Exit class tag: shape first (✕ ↩ ⇅ ◌), then words. */
export function ExitTag({ cls, long }: { cls: ExitClass; long?: boolean }) {
  const t = useT();
  const [tone, glyph] = EXIT_TONE[cls];
  return <Tag tone={tone} glyph={glyph} title={t(`chain.exit.${cls}.help`)}>{long ? t(`chain.exit.${cls}`) : t(`chain.exit.${cls}.short`)}</Tag>;
}

/* ---------- trackers (C01, T04) ---------- */
/** Lamp for a mainnet tracker: judged by the age of its box, never by "online". */
/** Grey tile (VISUAL §12.7 eclipse) once the tracker box is 720+ blocks old, or the NFT has no tracker box at all. */
export function trackerSilent(tr: Pick<TrackerView, "status" | "silentBlocks"> | null | undefined): boolean {
  return !tr || tr.status !== "live" || (tr.silentBlocks ?? Infinity) >= 720;
}
export function trackerLamp(tr: Pick<TrackerView, "status" | "silentBlocks">): LampState {
  if (tr.status === "live") {
    const s = tr.silentBlocks ?? 0;
    return s < 120 ? "live" : s < 720 ? "tracked" : "stale";
  }
  if (tr.status === "stale") return "stale";
  return "off";
}
const TRACKER_TONE: Record<TrackerView["status"], TagTone> = { live: "ok", stale: "plain", burned: "warn", locked: "plain", unused: "plain" };
const TRACKER_GLYPH: Record<TrackerView["status"], string | null> = { live: null, stale: null, burned: "✕", locked: "⊘", unused: "○" };
export function TrackerTag({ tr }: { tr: Pick<TrackerView, "status" | "silentBlocks"> }) {
  const t = useT();
  const g = TRACKER_GLYPH[tr.status];
  return (
    <Tag tone={TRACKER_TONE[tr.status]} glyph={g ?? undefined} title={t(`chain.tracker.${tr.status}.help`)}>
      {!g && <Lamp state={trackerLamp(tr)} size={7} />}{t(`chain.tracker.${tr.status}`)}
    </Tag>
  );
}

/** Tracker tile: first four hex of the NFT, grey once silent (VISUAL §12.7 eclipse). Pulses on a mainnet commit. */
export function NftTile({ nft, silent, size }: { nft: Hex; silent: boolean; size?: "sm" | "md" | "lg" }) {
  const ref = useRef<HTMLSpanElement>(null);
  usePulseClass(ref, (p) => p.source === "mainnet" && p.trackerId === nft);
  return <TrackerTile id={nft.slice(0, 4).toUpperCase()} stale={silent} size={size} tileRef={ref} />;
}

/** Name minted with the NFT: untrusted, always marked. */
export function UntrustedName({ name }: { name: string | null }) {
  const t = useT();
  if (!name) return <span className="nw-untrusted none">{t("network.tracker.noName")}</span>;
  return <span className="nw-untrusted" title={t("chain.tracker.untrustedName")}>“{name}”<sup aria-label={t("network.tracker.untrustedShort")}>?</sup></span>;
}

/* ---------- contracts (R17) ---------- */
export function ContractTag({ c, withRole = true }: { c: ContractView | null; withRole?: boolean }) {
  const t = useT();
  if (!c) return <Tag>?</Tag>;
  if (c.current) return <Tag tone="up" title={t("chain.contract.current")}>{withRole ? `${t("network.contract.currentShort")} · ` : ""}<span className="nw-case">{c.short}</span></Tag>;
  return (
    <Tag tone="plain" glyph="◇" title={c.ownerExit ? t("chain.contract.legacy.refundable") : t("chain.contract.legacy.noExit")}>
      {withRole ? `${t(`network.contract.role.${c.role}`)} · ` : ""}<span className="nw-case">{c.short}</span>
    </Tag>
  );
}

/* ---------- people (key seals: art identifies, it never proves) ---------- */
export function KeyName({ pk, addr, label, size = "sm", to, sub }: { pk?: Hex | null; addr?: string | null; label?: string | null; size?: "sm" | "md" | "lg" | number; to?: string; sub?: ReactNode }) {
  const t = useT();
  const key = pk ?? keyOfAddress(addr);
  return (
    <span className="nw-who">
      {key ? <KeySeal pk={key} size={size} /> : <span className="nw-noseal" aria-hidden="true" style={{ width: typeof size === "number" ? size : size === "sm" ? 28 : size === "md" ? 40 : 56 }} />}
      <span className="nw-who-t">
        <span className="nw-who-n">
          {addr ? (to ? <Link to={to} className="hex">{sAddr(addr)}</Link> : <span className="hex">{sAddr(addr)}</span>) : <span className="dim">{t("network.owner.malformed")}</span>}
          {label && <span className="nw-label" title={t("network.label.title")}>{label}</span>}
          {addr && <Ext kind="address" id={addr} />}
        </span>
        {sub && <span className="nw-who-s">{sub}</span>}
      </span>
    </span>
  );
}

/* ---------- the network bar: sub-navigation + live status ---------- */
const TABS = ["", "reserves", "trackers", "redemptions", "contracts", "incidents"] as const;
type TabId = (typeof TABS)[number];
function activeTab(path: string): TabId {
  const p = path.replace(/^\/network\/?/, "");
  if (!p) return "";
  if (p.startsWith("reserve")) return "reserves";
  if (p.startsWith("tracker")) return "trackers";
  if (p.startsWith("redemption") || p.startsWith("tx")) return "redemptions";
  if (p.startsWith("contract")) return "contracts";
  if (p.startsWith("incident")) return "incidents";
  return "";
}
export function NetBar({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const loc = useLocation();
  const on = activeTab(loc.pathname);
  const counts: Partial<Record<TabId, number>> = obs ? {
    reserves: obs.unspent.length,
    // ErgoScan's tracker was minted after the snapshot: counted here until the seed lists it (as on the list page)
    trackers: obs.trackers.length + oursExtra(obs),
    redemptions: obs.redemptions.length,
    contracts: obs.contracts.filter((c) => c.role === "legacy" || c.role === "current").length,
    incidents: obs.incidents.burns.length + obs.incidents.locks.length,
  } : {};
  return (
    <div className="nw-bar">
      <div className="nw-bar-l">
        <span className="label nw-bar-tag"><Lamp state="live" size={7} /><b>{t("network.bar.mainnet")}</b> · {pick(copy.testUse, t.lang as Lang)}</span>
        <nav className="nw-tabs" aria-label={t("network.bar.aria")}>
          {TABS.map((id) => (
            <Link key={id || "overview"} to={id ? `/network/${id}` : "/network"} className={cx("nw-tab", on === id && "on")} aria-current={on === id ? "page" : undefined}>
              {t(`network.tab.${id || "overview"}`)}{counts[id] != null && <span className="n">{counts[id]}</span>}
            </Link>
          ))}
        </nav>
      </div>
      <LiveStatus obs={obs} />
    </div>
  );
}

/** Live layer status, in words: watching (requests this block), paused while hidden, or offline. */
export function LiveStatus({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const st = useChainStatus();
  const h = obs?.height ?? null;
  const [ping, setPing] = useState(false);
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (h == null) return;
    if (last.current != null && h !== last.current) { setPing(true); const id = setTimeout(() => setPing(false), 1300); last.current = h; return () => clearTimeout(id); }
    last.current = h;
  }, [h]);
  let text: string, lamp: LampState = "live";
  if (st.hidden) { text = t("chain.live.paused"); lamp = "off"; }
  else if (!st.online && st.lastError) { text = t("chain.live.offline", { height: h != null ? fmtH(h) : "—" }); lamp = "alarm"; }
  else if (!st.enabled || st.budget.requests === 0) { text = t("network.live.starting"); lamp = "signed"; }
  else text = t("network.live.on");
  // the request budget and the block live in the tooltip: the bar stays calm, the page itself says "as of block N"
  const title = [st.enabled && st.budget.requests > 0 ? t("chain.live.watching", { used: st.budget.usedThisBlock, max: st.budget.perBlock }) : null,
    h != null ? `${t("network.live.block")} ${fmtH(h)}` : null].filter(Boolean).join(" · ");
  return (
    <span className="nw-live" title={title || undefined}>
      <Lamp state={lamp} size={8} className={ping && lamp === "live" ? "ping" : undefined} />
      <span>{text}</span>
      {/* the request count changes every few seconds; a screen reader hears only a pause or a lost connection */}
      <span className="sr-only" role="status" aria-live="polite">{lamp === "alarm" || lamp === "off" ? text : ""}</span>
    </span>
  );
}

/* ---------- frames ---------- */
/** Page-level skeleton while the snapshot chunk loads (VISUAL §12.11: the seal engraves itself). */
export function NetLoading({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="nw-loading">
      <Loading label={label ?? t("network.loading")} seed="network" lines={4} />
      <div className="nw-skel-grid" aria-hidden="true">{[0, 1, 2].map((i) => <div key={i} className="nw-skel-card"><i /><i /><i /><i /></div>)}</div>
    </div>
  );
}

/** A small labelled block: mono caps label row + content. */
export function Block({ label, aside, children, className, id }: { label: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string; id?: string }) {
  return (
    <section className={cx("nw-block", className)} id={id}>
      <div className="nw-block-h"><span className="label">{label}</span>{aside}</div>
      {children}
    </section>
  );
}

/** "Seen live" / "snapshot" source tag. */
export function SourceTag({ live }: { live: boolean }) {
  const t = useT();
  return <span className={cx("nw-src", live && "live")}>{t(`chain.live.source.${live ? "live" : "seed"}`)}</span>;
}

/** Plain row of label → value pairs (definition list). */
export function Facts({ rows, className }: { rows: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cx("nw-facts", className)}>
      {rows.map(([k, v], i) => <div key={i}><dt>{k}</dt><dd>{v}</dd></div>)}
    </dl>
  );
}

/** Blocks since a height, with ≈ time. */
export function Age({ blocks: n, lang }: { blocks: number; lang: Lang }) {
  return <span className="num nowrap">{blocks(n, lang)}</span>;
}

/** Renders a content string with `code` parts (CONTENT_API §1: split on backticks). */
export function Codey({ s }: { s: string }) {
  const parts = s.split("`");
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : <span key={i}>{p}</span>))}</>;
}

/** A long list shows its first n rows and a "show all" toggle (state lives here, so callers may return early). */
export function Capped<T>({ rows, n = 12, children }: { rows: T[]; n?: number; children: (rows: T[]) => ReactNode }) {
  const t = useT();
  const [all, setAll] = useState(false);
  const shown = all || rows.length <= n + 2 ? rows : rows.slice(0, n);
  return (
    <>
      {children(shown)}
      {rows.length > n + 2 && (
        <button type="button" className="key sm quiet nw-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t("network.col.showLess") : t("network.col.showAll", { n: rows.length })}
        </button>
      )}
    </>
  );
}
