// Small primitives (VISUAL §12.2–12.4): Lamp, Tag, CoverageTag, Chip, Seg, Tabs, Switch, Callout, Num, Hex, CopyButton,
// Kbd, Digest, Honest, Checks, TrackerTile. Tokens only.
import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useT } from "@/app/lang";
import { groupHex, money, MINUS, NBSP, short, signed, units, type SignMode } from "../engine/money";
import { useUiSettings } from "../settings";
import { crossFade, useLight } from "../motion";
import { Icon, type IconName } from "./Icon";
import { toast } from "./Toast";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/* ---------- Lamp ---------- */
export type LampState = "signed" | "tracked" | "committed" | "stale" | "live" | "alarm" | "off";
const LAMP_CLS: Record<LampState, string> = { signed: "", tracked: "half", committed: "full", stale: "stale", live: "live", alarm: "alarm", off: "" };
export interface LampProps { state?: LampState; size?: number; label?: string; className?: string; style?: CSSProperties }
/** ○ signed · ◐ tracked · ● committed (holo) · grey ● stale · live (verdigris, pings once per block) · alarm. */
export function Lamp({ state = "signed", size, label, className, style }: LampProps) {
  return (
    <span
      className={cx("lamp", LAMP_CLS[state], className)}
      style={{ ...(size ? ({ "--sz": `${size}px` } as CSSProperties) : null), ...style }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}

/* ---------- Tag ---------- */
export type TagTone = "plain" | "ok" | "watch" | "warn" | "under" | "metal" | "up" | "agent";
export interface TagProps { tone?: TagTone; glyph?: ReactNode; children?: ReactNode; className?: string; style?: CSSProperties; title?: string }
/** 22 px mono caps tag. Escalates by shape, then weight, then colour. */
export function Tag({ tone = "plain", glyph, children, className, style, title }: TagProps) {
  return (
    <span className={cx("tag", tone !== "plain" && tone, className)} style={style} title={title}>
      {glyph != null && <span className="glyph" aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}

/** Coverage band of a reserve (wallet policy: 150 / 120 / 100 %). */
export type CoverageBand = "fine" | "watch" | "warn" | "under";
export const coverageBand = (pct: number): CoverageBand => (pct >= 150 ? "fine" : pct >= 120 ? "watch" : pct >= 100 ? "warn" : "under");
const BAND_TAG: Record<CoverageBand, [TagTone, string]> = { fine: ["ok", "○"], watch: ["watch", "◔"], warn: ["warn", "◑"], under: ["under", "●"] };
/** ○ Fine ≥ 150 % · ◔ Watch < 150 % · ◑ Warn < 120 % · ● Under < 100 %. `long` adds the threshold words. */
export function CoverageTag({ pct, long, small }: { pct: number; long?: boolean; small?: boolean }) {
  const t = useT();
  const b = coverageBand(pct);
  const [tone, glyph] = BAND_TAG[b];
  return (
    <Tag tone={tone} glyph={small ? undefined : glyph} style={small ? { height: 18 } : undefined}>
      {t(`ui.cov.tag.${b}`)}{long && b !== "fine" ? ` · ${t(`ui.cov.${b}.long`)}` : ""}
    </Tag>
  );
}

/** "AI" tag for agents. */
export function AgentTag({ small }: { small?: boolean }) {
  return <Tag tone="agent" style={small ? { height: 17, fontSize: 9, padding: "0 5px" } : undefined}>AI</Tag>;
}

/* ---------- Chip ---------- */
export interface ChipProps {
  lamp?: LampState;
  label?: ReactNode;
  value?: ReactNode;
  href?: string;
  onClick?: () => void;
  title?: string;
  className?: string;
  /** Element ref for the pulse (the nav block chip is part of the pulse). */
  chipRef?: React.Ref<HTMLElement>;
}
/** 32 px pill: lamp, mono label and a bold value ("Ergo 1 921 860"). */
export function Chip({ lamp, label, value, href, onClick, title, className, chipRef }: ChipProps) {
  const body = <>{lamp && <Lamp state={lamp} />}{label}{value != null && <b className="num">{value}</b>}</>;
  if (href) return <a ref={chipRef as React.Ref<HTMLAnchorElement>} className={cx("chip", className)} href={href} title={title} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer">{body}</a>;
  if (onClick) return <button ref={chipRef as React.Ref<HTMLButtonElement>} className={cx("chip", className)} onClick={onClick} title={title} style={{ cursor: "pointer" }}>{body}</button>;
  return <span ref={chipRef as React.Ref<HTMLSpanElement>} className={cx("chip", className)} title={title}>{body}</span>;
}

/* ---------- Seg / Tabs ---------- */
// Both switch without a jump: the light moves to the new option and the view cross-fades in place (src/ui/motion.ts;
// instant under reduced motion or without the View Transitions API). `fade={false}` keeps a switch instant (the theme
// and language controls change the whole page at once, chrome included).
export interface SegOption<V extends string> { value: V; label: ReactNode; title?: string }
export interface SegProps<V extends string> { options: SegOption<V>[]; value: V; onChange: (v: V) => void; mono?: boolean; ariaLabel: string; className?: string; fade?: boolean }
/** Small segmented control (Night/Cotton, EN/RU). Each option is a toggle button. */
export function Seg<V extends string>({ options, value, onChange, mono, ariaLabel, className, fade = true }: SegProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  useLight(ref);
  const pick = (v: V) => {
    if (v === value || !fade) { onChange(v); return; }
    crossFade(() => flushSync(() => onChange(v)), [ref.current]);
  };
  return (
    <div ref={ref} className={cx("seg", mono && "mono", className)} role="group" aria-label={ariaLabel}>
      <span className="light" aria-hidden="true" />
      {options.map((o) => (
        <button key={o.value} type="button" className={o.value === value ? "on" : undefined} aria-pressed={o.value === value} title={o.title} onClick={() => pick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface TabItem<V extends string> { id: V; label: ReactNode; count?: number; disabled?: boolean }
export interface TabsProps<V extends string> {
  tabs: TabItem<V>[];
  value: V;
  onChange: (v: V) => void;
  /** Mono caps (ranges: 1D / 7D / 30D / ALL). */
  mono?: boolean;
  /** Full width, equal segments. */
  block?: boolean;
  ariaLabel?: string;
  /** id prefix: tab i gets id `${idBase}-tab-${id}` and controls `${idBase}-panel-${id}`. */
  idBase?: string;
  className?: string;
  /** false: switch at once, without the cross-fade (the light still moves). */
  fade?: boolean;
}
/** Segmented tabs in a well (role tablist; arrows move, Home/End jump). */
export function Tabs<V extends string>({ tabs, value, onChange, mono, block, ariaLabel, idBase, className, fade = true }: TabsProps<V>) {
  const ref = useRef<HTMLDivElement>(null);
  useLight(ref);
  const focusLit = () => ref.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
  const pick = (id: V, focus: boolean) => {
    if (id === value || !fade) { onChange(id); if (focus) requestAnimationFrame(focusLit); return; }
    crossFade(() => { flushSync(() => onChange(id)); if (focus) focusLit(); }, [ref.current]);
  };
  const onKey = (e: KeyboardEvent) => {
    const en = tabs.filter((x) => !x.disabled);
    const i = en.findIndex((x) => x.id === value);
    let n = -1;
    if (e.key === "ArrowRight") n = (i + 1) % en.length;
    else if (e.key === "ArrowLeft") n = (i - 1 + en.length) % en.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = en.length - 1;
    if (n < 0) return;
    e.preventDefault();
    pick(en[n].id, true);
  };
  return (
    <div ref={ref} className={cx("tabs", mono && "mono", block && "block", className)} role="tablist" aria-label={ariaLabel} onKeyDown={onKey}>
      <span className="light" aria-hidden="true" />
      {tabs.map((x) => (
        <button
          key={x.id}
          type="button"
          role="tab"
          id={idBase ? `${idBase}-tab-${x.id}` : undefined}
          aria-controls={idBase ? `${idBase}-panel-${x.id}` : undefined}
          aria-selected={x.id === value}
          tabIndex={x.id === value ? 0 : -1}
          disabled={x.disabled}
          className={x.id === value ? "on" : undefined}
          onClick={() => pick(x.id, false)}
        >
          {x.label}{x.count != null && <span className="n">{x.count}</span>}
        </button>
      ))}
    </div>
  );
}

/* ---------- Switch ---------- */
export interface SwitchProps { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; help?: ReactNode; disabled?: boolean; ariaLabel?: string }
/** 44 × 26 switch; with a label it becomes a full-row control (Geist 600 14.5 label, 13 px help line). */
export function Switch({ checked, onChange, label, help, disabled, ariaLabel }: SwitchProps) {
  const sw = <span className={cx("switch", checked && "on")} aria-hidden="true" />;
  if (!label) {
    return <button type="button" role="switch" aria-checked={checked} aria-label={ariaLabel} disabled={disabled} className={cx("switch", checked && "on")} onClick={() => onChange(!checked)} />;
  }
  return (
    <button type="button" role="switch" aria-checked={checked} disabled={disabled} className="switch-row" onClick={() => onChange(!checked)}>
      {sw}
      <span><span className="t-h4" style={{ display: "block" }}>{label}</span>{help && <span className="t-small" style={{ display: "block" }}>{help}</span>}</span>
    </button>
  );
}

/* ---------- Callout ---------- */
export type CalloutTone = "info" | "policy" | "sandbox" | "metal" | "proof" | "alarm" | "calm";
const CALLOUT_ICON: Record<CalloutTone, IconName> = { info: "info", policy: "settings", sandbox: "play", metal: "coin", proof: "stamp", alarm: "warn", calm: "clock" };
export interface CalloutProps { tone?: CalloutTone; title?: ReactNode; icon?: IconName | false; children?: ReactNode; className?: string; style?: CSSProperties }
/** A boxed note with a material edge: info, policy (hatched edge: "wallet policy, not the contract"), sandbox, metal, proof, alarm, calm. */
export function Callout({ tone = "info", title, icon, children, className, style }: CalloutProps) {
  const cls = tone === "policy" ? "policy-note" : tone === "info" ? "" : tone;
  return (
    <div className={cx("callout-box", cls, className)} style={style} role={tone === "alarm" ? "alert" : undefined}>
      {icon !== false && <span className="ic"><Icon name={icon || CALLOUT_ICON[tone]} size={22} /></span>}
      {title && <div className="ttl">{title}</div>}
      <div style={icon === false ? { gridColumn: "1 / -1" } : undefined}>{children}</div>
    </div>
  );
}

/* ---------- Num / money ---------- */
export interface NumProps {
  /** A number, or integer units (bigint) with `decimals`. */
  value: number | bigint;
  /** Decimals of bigint units (9 for nanoERG). */
  decimals?: number;
  /** Shown decimal places (default 2). */
  dp?: number;
  /** "favour" → "+" (the only "+"), "owe" → "−", "auto" → "−" for negatives only, "none" → absolute. */
  sign?: SignMode;
  unit?: string;
  /** Colour: "up" for amounts in your favour, "alarm" only when something is wrong. */
  tone?: "up" | "alarm" | "metal" | "dim";
  className?: string;
  style?: CSSProperties;
  /** Ignore the privacy setting (machine faces, sandbox god mode). */
  reveal?: boolean;
}
/** Formats with money(): U+2009+U+2060 thousands, U+2212 minus, unit after U+00A0. Hidden as ••• in privacy mode. */
export function Num({ value, decimals, dp = 2, sign = "auto", unit, tone, className, style, reveal }: NumProps) {
  const s = useUiSettings();
  let text: string;
  if (typeof value === "bigint") {
    const abs = units(value < 0n ? -value : value, decimals ?? 9, dp);
    const neg = value < 0n, zero = value === 0n;
    text = sign === "favour" ? (zero ? "" : "+") + abs : sign === "owe" ? (zero ? "" : MINUS) + abs : sign === "none" ? abs : (neg ? MINUS : "") + abs;
  } else text = signed(value, dp, sign);
  if (s.privacy && !reveal) text = "•••";
  const toneCls = tone === "up" ? "up" : tone === "alarm" ? "alarm-t" : tone === "metal" ? "metal-t" : tone === "dim" ? "dim" : undefined;
  return <span className={cx("num nowrap", toneCls, className)} style={style}>{text}{unit ? <>{NBSP}<span className="u-unit">{unit}</span></> : null}</span>;
}

/* ---------- Hex / Copy ---------- */
export interface HexProps { value: string; head?: number; tail?: number; grouped?: boolean; copy?: boolean; className?: string; title?: string }
/** Shortened hex ("9f3c…e1") with the full value in the title; grouped → "9f3c 1a2d … e1"; copy adds a Copy key. */
export function Hex({ value, head = 4, tail = 4, grouped, copy, className, title }: HexProps) {
  const text = grouped ? groupHex(value, head, tail) : short(value, head, tail);
  return (
    <span className={cx("hex", className)} title={title ?? value} style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <span>{text}</span>
      {copy && <CopyButton value={value} small />}
    </span>
  );
}

/** Copies a value and confirms with a toast. */
export function CopyButton({ value, label, small, className }: { value: string; label?: ReactNode; small?: boolean; className?: string }) {
  const t = useT();
  const [done, setDone] = useState(false);
  const go = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1400);
      toast({ kind: "info", title: t("ui.copied"), detail: short(value, 8, 6), mono: true, icon: "copy", ttl: 2000 });
    } catch {
      toast({ kind: "info", title: t("ui.copyFailed"), ttl: 3000 });
    }
  };
  return (
    <button type="button" className={cx("key sm", small && "quiet", "copy", className)} onClick={go} aria-label={typeof label === "string" ? label : t("ui.copy")}>
      {done ? <Icon name="check" size={16} /> : small ? <Icon name="copy" size={16} /> : null}
      {!small && (label ?? t("ui.copy"))}
    </button>
  );
}

/** Keyboard hint. */
export const Kbd = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>;

/* ---------- Digest ---------- */
/** The AVL+ digest row with Copy: "AVL+ digest · 9f3c 1a2d 07be 55c0 … 2d18 f0c7 e1". */
export function Digest({ value, label, head = 16, tail = 10 }: { value: string; label?: ReactNode; head?: number; tail?: number }) {
  const t = useT();
  return (
    <div className="digest">
      <span className="label" style={{ flex: "none" }}>{label ?? t("ui.digest.label")}</span>
      <b className="hex" title={value}>{groupHex(value, head, tail)}</b>
      <CopyButton value={value} />
    </div>
  );
}

/* ---------- Honest box ---------- */
/** "✕ Cannot steal · ! Can censor" — next to every tracker (VISUAL §12.7). */
export function Honest({ tracker }: { tracker?: string }) {
  const t = useT();
  return (
    <div className="honest" aria-label={t("ui.honest.aria", { tracker: tracker ?? t("ui.honest.thisTracker") })} role="group">
      <div><span className="g no" aria-hidden="true">✕</span><b>{t("ui.honest.steal")}</b><span>{t("ui.honest.steal.why")}</span></div>
      <div><span className="g yes" aria-hidden="true">!</span><b>{t("ui.honest.censor")}</b><span>{t("ui.honest.censor.why")}</span></div>
    </div>
  );
}

/* ---------- Checks row ---------- */
export interface ChecksProps {
  /** 0 nothing · 1 signed · 2 witnessed · 3 on Ergo */
  stage: 0 | 1 | 2 | 3;
  issuer?: string;
  tracker?: string;
  block?: number;
}
/** Signed / Witnessed / On Ergo (hero stage foot). */
export function Checks({ stage, issuer = "Alice", tracker = "T-01", block }: ChecksProps) {
  const t = useT();
  const items: [ReactNode, ReactNode][] = [
    [t("ui.checks.signed"), issuer],
    [t("ui.checks.witnessed"), tracker],
    [t("ui.checks.onErgo"), block != null ? t("ui.checks.block", { n: money(block, 0) }) : "—"],
  ];
  return (
    <div className="checks">
      {items.map(([k, v], i) => (
        <span key={i} className={cx("check", stage < i + 1 && "dim")}>
          <Lamp state={i === 0 ? "signed" : i === 1 ? "tracked" : "committed"} />
          <b>{k}</b><span className="mono">{v}</span>
        </span>
      ))}
    </div>
  );
}

/* ---------- Tracker tile ---------- */
/** The holo tile "T-01" (grey when stale). */
export function TrackerTile({ id = "T-01", stale, size = "md", tileRef }: { id?: string; stale?: boolean; size?: "sm" | "md" | "lg"; tileRef?: React.Ref<HTMLSpanElement> }) {
  return <span ref={tileRef} className={cx("ttile", stale && "stale", size !== "md" && size)} aria-hidden="true">{id}</span>;
}

/* ---------- FlowTrail: where you are in a short flow (fill in → check and sign → done) ---------- */
/** One decision per screen: the trail names the steps of this action and marks the current one (aria-current="step").
 *  `fail`: the current step did not go through (its label should say so, e.g. «Not sent»); it is marked in the alarm
 *  colour with «!» in place of its number. */
export function FlowTrail({ steps, at, label, fail }: { steps: readonly string[]; at: number; label: string; fail?: boolean }) {
  return (
    <ol className="flow-trail" aria-label={label}>
      {steps.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? (fail ? "now fail" : "now") : undefined} aria-current={i === at ? "step" : undefined}>
          <span className="n" aria-hidden="true">{i === at && fail ? "!" : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}
