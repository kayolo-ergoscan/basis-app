// The note (VISUAL §12.1): paper 1000 : 440, inks from the pair key, the cumulative total in engraved serif, the cap
// bar (settled · outstanding · headroom), signatures, and the foil strip (holo only while in the latest committed
// digest). Art is a cached <img> except for `live` notes (the hero / detail note: inline SVG, crisp microprint).
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useT } from "@/app/lang";
import type { Pulse } from "@/app/pulse";
import { usePulseClass, useUid } from "../hooks";
import { asBytes, hex } from "../engine/bytes";
import { demoNoteSigs, demoPair, DEMO_PK } from "../engine/demo";
import { inksFor } from "../engine/inks";
import { glyphCount, int, money, short } from "../engine/money";
import { noteArt, serialOf } from "../engine/noteArt";
import { noteArtUrl } from "../engine/raster";
import { pairKey } from "../engine/seal";
import { prefersReducedMotion, useUiSettings } from "../settings";
import { Odometer } from "./Odometer";
import { Lamp, type LampState } from "./primitives";

export type NoteState = "signed" | "tracked" | "committed" | "stale";
export const NOTE_LAMP: Record<NoteState, LampState> = { signed: "signed", tracked: "tracked", committed: "committed", stale: "stale" };

export interface NoteProps {
  /** Display names (both are always printed: a note is never a bearer IOU). */
  issuer: string;
  receiver: string;
  /** Public keys (hex). Without them the demo keys of the sample names are used. */
  issuerPk?: string;
  receiverPk?: string;
  /** The debt key blake2b256(issuer ‖ receiver [‖ token]); computed from the keys when omitted. */
  noteKey?: Uint8Array | string;
  /** Cumulative total (it only grows). */
  amount: number;
  unit?: string;
  dp?: number;
  /** The previous total ("was 1 000.00"). */
  prev?: number | null;
  /** The receiver's limit for the issuer; 0 hides the cap bar. */
  limit?: number;
  /** Already redeemed against this note. */
  settled?: number;
  state?: NoteState;
  /** Tracker label printed on the foil ("T-01") and its id for pulse matching. */
  tracker?: string;
  trackerId?: string;
  digest?: string;
  block?: number;
  /** Issuer / tracker signatures (65-byte hex): the autograph and the machine mark are drawn from them. */
  sigA?: string;
  sigT?: string;
  /** Lite art: no fibres, microprint or grain (stacks, cards, thumbnails). */
  lite?: boolean;
  /** Inline SVG art (one per view: the hero or the detail note). */
  live?: boolean;
  /** Roll the total on change (forward only). */
  odometer?: boolean;
  /** Hover loupe ×4 (long-press on touch). */
  loupe?: boolean;
  /** Hide the face text (thumbnails below ~200 px). */
  bare?: boolean;
  className?: string;
  style?: CSSProperties;
  onClick?: () => void;
  /** Overrides the accessible name. */
  ariaLabel?: string;
  /** Hidden from assistive tech (decorative copies, back notes). */
  decorative?: boolean;
}

const keyOf = (p: Pick<NoteProps, "noteKey" | "issuerPk" | "receiverPk" | "issuer" | "receiver">): Uint8Array => {
  if (p.noteKey) return typeof p.noteKey === "string" ? asBytes(p.noteKey) : p.noteKey;
  if (p.issuerPk && p.receiverPk) return pairKey(p.issuerPk, p.receiverPk);
  return demoPair(p.issuer, p.receiver);
};

/** Size of the engraved total by visible glyphs (tile: 12.8 / 11.6 / 9.8 cqw). */
const amtSize = (s: string) => { const g = glyphCount(s); return g <= 8 ? 12.8 : g <= 9 ? 11.6 : g <= 11 ? 9.8 : 8.2; };

export function Note(props: NoteProps) {
  const { issuer, receiver, amount, unit = "ERG", dp = 2, prev, limit = 0, settled = 0, state = "committed", tracker = "T-01", trackerId, digest, block,
    lite, live, odometer, loupe, bare, className, style, onClick, ariaLabel, decorative } = props;
  const t = useT();
  const ui = useUiSettings();
  const key = useMemo(() => keyOf(props), [props.noteKey, props.issuerPk, props.receiverPk, issuer, receiver]); // eslint-disable-line react-hooks/exhaustive-deps
  const keyHex = useMemo(() => hex(key), [key]);
  const ink = useMemo(() => inksFor(key), [key]);
  const sigs = useMemo(() => (props.sigA && props.sigT ? { sigA: props.sigA, sigT: props.sigT } : demoNoteSigs(key)), [key, props.sigA, props.sigT]);
  const uid = useUid("n");
  const micro = lite ? "" : `${issuer.toUpperCase()} OWES ${receiver.toUpperCase()} ${amount.toFixed(2)} ${unit} · KEY ${keyHex} · SIG ${sigs.sigA} · `.repeat(2);
  const artOpts = { sigA: sigs.sigA, sigT: sigs.sigT, lite: !!lite, ...(micro ? { micro } : null) };
  const liveSvg = useMemo(() => (live ? noteArt(key, { ...artOpts, uid }) : ""), [live, keyHex, micro, sigs.sigA, sigs.sigT, lite, uid]); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLDivElement>(null);
  usePulseClass(ref, (p: Pulse) => state === "committed" && (p.noteKeys ? p.noteKeys.includes(keyHex) : !trackerId || p.trackerId === trackerId));

  const priv = ui.privacy;
  const out = amount - settled;
  const pctW = (v: number) => (limit ? Math.max(0, Math.min(100, (v / limit) * 100)).toFixed(2) : "0");
  const amtStr = money(amount, dp);
  const issuerPk = props.issuerPk ?? DEMO_PK[issuer];
  const dg = digest ? short(digest, 4, 2).toUpperCase() : "9F3C…E1";
  const blkStr = block != null ? int(block) : "1 921 400";
  const stateWords = t(`ui.note.state.${state}`);
  const label = ariaLabel ?? t("ui.note.aria", {
    issuer, receiver, amount: priv ? "•••" : amtStr.replace(/⁠/g, ""), unit,
    state: state === "committed" ? t("ui.note.aria.committed", { digest: digest ? short(digest, 4, 2) : "9f3c…e1", block: blkStr }) : stateWords,
  });

  const art = live
    ? <span className="note-art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: liveSvg }} />
    : <img className="note-art" src={noteArtUrl(key, artOpts)} alt="" aria-hidden="true" draggable={false} decoding="async" />;

  const note = (
    <div
      ref={ref}
      className={["note", onClick && "clickable", className].filter(Boolean).join(" ")}
      style={{ "--ink-a": ink.a.c, "--ink-b": ink.b.c, ...style } as CSSProperties}
      data-state={state}
      role={decorative ? undefined : onClick ? "button" : "img"}
      tabIndex={onClick ? 0 : undefined}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } } : undefined}
    >
      {art}
      {!bare && (
        <div className="note-face" aria-hidden="true">
          <div className="note-top">
            <span className="note-brand">BASIS<small>{t("ui.note.brandSub")}</small></span>
            <span className="note-serial">№ {serialOf(key)}</span>
          </div>
          <div className="note-parties"><span>{issuer}</span><span className="owes">{t("ui.note.owes")}</span><span>{receiver}</span></div>
          <div className="note-caption">{t("ui.note.caption")}{prev != null ? ` · ${t("ui.note.was", { v: priv ? "•••" : money(prev, dp) })}` : ""}</div>
          <div className="note-amount" style={{ fontSize: `${amtSize(amtStr)}cqw` }}>
            <span className="engr">{odometer ? <Odometer value={amount} dp={dp} /> : <span className="odo">{priv ? "•••" : amtStr}</span>}</span>
            <span className="unit">{unit}</span>
          </div>
          {limit > 0 && (
            <div className="note-rule">
              <div className="cap"><i className="settled" style={{ width: `${pctW(settled)}%` }} /><i className="out" style={{ width: `${pctW(out)}%` }} /><i className="head" style={{ flex: 1 }} /></div>
              <div className="legend">
                <span>{t("ui.note.outstanding")} <b>{priv ? "•••" : money(out, dp)}</b></span>
                <span>{t("ui.note.headroom")} <b>{priv ? "•••" : money(Math.max(0, limit - amount), dp)}</b></span>
                <span>{t("ui.note.limitOf", { name: receiver })} <b>{priv ? "•••" : money(limit, 0)}</b></span>
              </div>
            </div>
          )}
          <div className="note-sigs">
            <div>{t("ui.note.signed")} · {issuer}<span>{issuerPk ? short(issuerPk, 4, 4) : "02a1…7c9f"}</span></div>
            <div>{t("ui.note.witnessed")} · {tracker}<span>sig {sigs.sigT.slice(0, 4)}…{sigs.sigT.slice(-4)}</span></div>
          </div>
        </div>
      )}
      <div className="note-foil" aria-hidden="true">
        <div className="band" />
        {!bare && <span className="mark">{tracker.replace("T-", "T")}</span>}
        {!bare && <span className="txt">{state === "signed" ? `${t("ui.note.notWitnessed")} · ` : ""}{tracker} · DIGEST {dg} · BLK {blkStr}</span>}
      </div>
    </div>
  );
  return loupe ? <Loupe>{note}</Loupe> : note;
}

/** ×4 loupe over any child (desktop hover; long-press on touch). Clones the child and lays it out 4× wide. */
export function Loupe({ children, zoom = 4, size = 168 }: { children: ReactNode; zoom?: number; size?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const lp = useRef<HTMLDivElement>(null);
  const clone = useRef<HTMLElement | null>(null);
  const press = useRef<ReturnType<typeof setTimeout>>();
  const [on, setOn] = useState(false);
  const target = () => wrap.current?.firstElementChild as HTMLElement | null;
  const show = () => {
    const src = target(), box = lp.current;
    if (!src || !box) return;
    clone.current?.remove();
    const c = src.cloneNode(true) as HTMLElement;
    c.removeAttribute("id");
    c.setAttribute("aria-hidden", "true");
    c.classList.add("lz");
    c.classList.remove("pulse-on");
    box.appendChild(c);
    clone.current = c;
    setOn(true);
  };
  const hide = () => { setOn(false); clone.current?.remove(); clone.current = null; };
  const move = (x0: number, y0: number) => {
    const src = target(), box = lp.current, c = clone.current;
    if (!src || !box || !c) return;
    const r = src.getBoundingClientRect(), x = x0 - r.left, y = y0 - r.top, h = size / 2;
    box.style.left = `${x - h}px`;
    box.style.top = `${y - h}px`;
    c.style.width = `${r.width * zoom}px`;
    c.style.transform = `translate(${h - x * zoom}px, ${h - y * zoom}px)`;
  };
  useEffect(() => () => clearTimeout(press.current), []);
  return (
    <div
      ref={wrap}
      className="note-loupe"
      onPointerEnter={(e) => { if (e.pointerType === "mouse") { show(); move(e.clientX, e.clientY); } }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") hide(); }}
      onPointerMove={(e) => { if (clone.current) move(e.clientX, e.clientY); else clearTimeout(press.current); }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        const { clientX, clientY } = e;
        press.current = setTimeout(() => { show(); move(clientX, clientY); }, 380);
      }}
      onPointerUp={(e) => { clearTimeout(press.current); if (e.pointerType !== "mouse") hide(); }}
      onPointerCancel={() => { clearTimeout(press.current); hide(); }}
    >
      {children}
      <div ref={lp} className="loupe" hidden={!on} style={{ width: size, height: size }} aria-hidden="true" />
    </div>
  );
}

export interface NoteThumbProps extends NoteProps {
  /** Thumbnail width in px (default 200). */
  width?: number;
  /** Text next to the thumb (defaults to "Alice owes Bob · 1 240.00 ERG · Committed"). */
  children?: ReactNode;
}
/** A small lite note with a text label beside it (lists, pickers, the 404). */
export function NoteThumb({ width = 200, children, ...p }: NoteThumbProps) {
  const t = useT();
  const ui = useUiSettings();
  const st = p.state ?? "committed";
  return (
    <div className="note-thumb" style={{ "--thumb-w": `${width}px` } as CSSProperties}>
      <Note {...p} lite bare={width < 180} decorative style={{ boxShadow: "0 10px 20px -12px rgba(var(--shade),.7)", ...p.style }} />
      <div className="nt-label">
        {children ?? (
          <>
            <div className="nt-who">{t("ui.note.sentence", { issuer: p.issuer, receiver: p.receiver })}</div>
            <div className="nt-amt num">{ui.privacy ? "•••" : money(p.amount, p.dp ?? 2)} <span className="dim" style={{ fontWeight: 400, fontSize: 13 }}>{p.unit ?? "ERG"}</span></div>
            <div className="nt-state"><Lamp state={NOTE_LAMP[st]} />{t(`ui.note.state.${st}`)}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** The metal stub of a redemption: "500.00 · from Alice's reserve → you". */
export function NoteStub({ amount, unit = "ERG", label, dp = 2 }: { amount: number; unit?: string; label?: ReactNode; dp?: number }) {
  const ui = useUiSettings();
  return (
    <div className="tear" style={{ display: "inline-grid", gridTemplateColumns: "auto" }}>
      <div className="stub" style={{ transform: "rotate(-2deg)", borderRadius: 4 }}>
        <div className="v num">{ui.privacy ? "•••" : money(amount, dp)} <span style={{ font: "600 11px var(--f-mono)", letterSpacing: ".1em" }}>{unit}</span></div>
        {label && <div className="l">{label}</div>}
      </div>
    </div>
  );
}

export interface NoteStackProps {
  front: NoteProps;
  back?: NoteProps[];
  /** Pointer parallax on desktop (±2° X, ±3° Y; foil highlight follows). */
  parallax?: boolean;
  /** Overlays inside the stage (callouts, leaders). */
  children?: ReactNode;
  className?: string;
}
/** The hero stack: up to two lite notes behind the front note, at rotateX(7°) rotateY(−12°) rotateZ(−1.2°). */
export function NoteStack({ front, back = [], parallax = true, children, className }: NoteStackProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const st = stage.current, w = wrap.current;
    if (!parallax || !st || !w || prefersReducedMotion() || !matchMedia("(pointer: fine)").matches) return;
    const host = st.closest(".hero") as HTMLElement | null ?? st;
    const on = (e: PointerEvent) => {
      const r = host.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      w.style.transform = `rotateX(${7 - y * 4}deg) rotateY(${-12 + x * 6}deg) rotateZ(-1.2deg)`;
      w.querySelector<HTMLElement>(".note")?.style.setProperty("--fy", `${40 + x * 40}%`);
    };
    host.addEventListener("pointermove", on);
    return () => host.removeEventListener("pointermove", on);
  }, [parallax]);
  return (
    <div className={["note-stage", className].filter(Boolean).join(" ")}>
      <div className="note-stage-inner" ref={stage}>
        {back.slice(0, 2).reverse().map((b, i, arr) => (
          <div key={i} className={`back-note${arr.length - i === 2 ? " b2" : ""}`}><Note {...b} lite decorative /></div>
        ))}
        <div className="hero-note-wrap" ref={wrap}><Note {...front} /></div>
        {children}
      </div>
    </div>
  );
}

/** A torn note (the 404 and "lost" states): paper with a ripped right edge and a faint pair seal. */
export function TornNote({ seed = "404", children, style }: { seed?: string; children?: ReactNode; style?: CSSProperties }) {
  const key = useMemo(() => demoPair(`torn:${seed}`, "nobody"), [seed]);
  const ink = inksFor(key);
  return (
    <div className="torn" style={{ "--ink-a": ink.a.c, "--ink-b": ink.b.c, ...style } as CSSProperties} aria-hidden="true">
      <img className="note-art" src={noteArtUrl(key, { lite: true })} alt="" draggable={false} />
      {children}
    </div>
  );
}
