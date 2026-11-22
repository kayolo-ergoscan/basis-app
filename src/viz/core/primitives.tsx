// Small internal primitives for the X-rays. They follow VISUAL §7 and §12.2 (shape first, then colour) and use
// only the Intaglio tokens. When src/ui ships the same parts, the X-rays can switch to them one by one.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useVizT } from "./lang";
import { byteHex } from "./format";

export type CheckLampState = "pass" | "fail" | "throws" | "skip" | "idle" | "current";
export type ProtoLampState = "signed" | "tracked" | "committed" | "stale" | "live" | "alarm" | "off";

/** Contract/signature check lamp: ● pass (verdigris), ✕ ring fail, ◆ throws, dashed ○ skipped, ○ idle. */
export function CheckLamp({ state, size = 12, title }: { state: CheckLampState; size?: number; title?: string }) {
  const s = size;
  const c = s / 2;
  const r = s / 2 - 1.25;
  let body: ReactNode;
  switch (state) {
    case "pass":
      body = <circle cx={c} cy={c} r={r + 0.5} fill="var(--up)" />;
      break;
    case "fail":
      body = (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--alarm)" strokeWidth={1.6} />
          <path d={`M${c - r * 0.45} ${c - r * 0.45} L${c + r * 0.45} ${c + r * 0.45} M${c + r * 0.45} ${c - r * 0.45} L${c - r * 0.45} ${c + r * 0.45}`} stroke="var(--alarm)" strokeWidth={1.6} strokeLinecap="round" />
        </>
      );
      break;
    case "throws":
      body = <path d={`M${c} ${c - r - 0.5} L${c + r + 0.5} ${c} L${c} ${c + r + 0.5} L${c - r - 0.5} ${c} Z`} fill="var(--alarm)" />;
      break;
    case "skip":
      body = <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ink-3)" strokeWidth={1.2} strokeDasharray="1.6 1.8" />;
      break;
    case "current":
      body = (
        <>
          <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ink)" strokeWidth={1.6} />
          <circle cx={c} cy={c} r={r * 0.38} fill="var(--ink)" />
        </>
      );
      break;
    default:
      body = <circle cx={c} cy={c} r={r} fill="none" stroke="var(--rule-2)" strokeWidth={1.4} />;
  }
  return (
    <svg className={`vz-lamp vz-lamp-${state}`} width={s} height={s} viewBox={`0 0 ${s} ${s}`} aria-hidden={title ? undefined : true} role={title ? "img" : undefined} aria-label={title}>
      {body}
    </svg>
  );
}

/** Protocol lamps (VISUAL §7): ○ signed · ◐ tracked · ● committed (holo) · grey ● stale · verdigris ● live · alarm ●. */
export function ProtoLamp({ state, size = 10, ping }: { state: ProtoLampState; size?: number; ping?: boolean }) {
  return <span className={`vz-plamp vz-plamp-${state}${ping ? " ping" : ""}`} style={{ width: size, height: size }} aria-hidden="true" />;
}

export type TagTone = "ok" | "watch" | "warn" | "under" | "metal" | "up" | "agent" | "plain" | "proof";

export function Tag({ tone = "plain", glyph, children, title }: { tone?: TagTone; glyph?: string; children: ReactNode; title?: string }) {
  return (
    <span className={`vz-tag vz-tag-${tone}`} title={title}>
      {glyph ? <span className="vz-tag-glyph" aria-hidden="true">{glyph}</span> : null}
      {children}
    </span>
  );
}

/** Segmented control (VISUAL §12.4 tabs). */
export function Seg<T extends string | number>({ value, options, onChange, label, mono, size = "m" }: {
  value: T;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  onChange: (v: T) => void;
  label: string;
  mono?: boolean;
  size?: "s" | "m";
}) {
  return (
    <div className={`vz-seg${mono ? " mono" : ""}${size === "s" ? " s" : ""}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} className={o.value === value ? "on" : undefined} title={o.title} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type Face = "story" | "machine";

/** The two faces of every object (VISUAL §1.7): Story = sentences, Machine = bytes. */
export function FaceToggle({ face, onChange }: { face: Face; onChange: (f: Face) => void }) {
  const t = useVizT();
  return (
    <Seg
      size="s"
      mono
      label={t("viz.face.label")}
      value={face}
      onChange={onChange}
      options={[
        { value: "story", label: t("viz.face.story") },
        { value: "machine", label: t("viz.face.machine") },
      ]}
    />
  );
}

export function useFace(initial: Face = "story", controlled?: Face): [Face, (f: Face) => void] {
  const [f, setF] = useState<Face>(controlled ?? initial);
  useEffect(() => {
    if (controlled) setF(controlled);
  }, [controlled]);
  return [f, setF];
}

export function Btn({ children, onClick, kind = "default", disabled, title, pressed, type = "button" }: {
  children: ReactNode;
  onClick?: () => void;
  kind?: "default" | "quiet" | "primary";
  disabled?: boolean;
  title?: string;
  pressed?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button type={type} className={`vz-btn vz-btn-${kind}`} onClick={onClick} disabled={disabled} title={title} aria-pressed={pressed}>
      {children}
    </button>
  );
}

export function CopyBtn({ value, label }: { value: string; label?: string }) {
  const t = useVizT();
  const [done, setDone] = useState(false);
  const timer = useRef<number>();
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return (
    <button
      type="button"
      className="vz-copy"
      aria-label={label ?? t("viz.copy")}
      title={label ?? t("viz.copy")}
      onClick={() => {
        try {
          void navigator.clipboard?.writeText(value);
        } catch {
          /* clipboard blocked */
        }
        setDone(true);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setDone(false), 1200);
      }}
    >
      {done ? t("viz.copied") : t("viz.copy")}
    </button>
  );
}

/** A labelled run of bytes inside a byte grid. */
export interface ByteSeg {
  from: number;
  length: number;
  /** CSS class suffix for the material: key | debt | ts | nft | a | z | pk | e | dim | label | leaf | node | dir | end */
  tone: string;
  label: string;
}

/**
 * Byte grid (VISUAL §12.1 machine face): 16 columns (8 in a narrow container), each cell a byte, coloured by segment.
 * `onByte` turns every cell into a button (tamper); `changed` outlines bytes that differ from the original.
 */
export function ByteGrid({ bytes, segs, cols, onByte, changed, focus, label, dense }: {
  bytes: Uint8Array;
  segs: ByteSeg[];
  cols?: number;
  onByte?: (i: number) => void;
  changed?: ReadonlySet<number>;
  focus?: ReadonlySet<number>;
  label: string;
  dense?: boolean;
}) {
  const toneAt = new Array<string>(bytes.length).fill("dim");
  const segAt = new Array<number>(bytes.length).fill(-1);
  segs.forEach((s, si) => {
    for (let i = s.from; i < Math.min(bytes.length, s.from + s.length); i++) {
      toneAt[i] = s.tone;
      segAt[i] = si;
    }
  });
  const cells: ReactNode[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const cls = `vz-b vz-t-${toneAt[i]}${changed?.has(i) ? " changed" : ""}${focus?.has(i) ? " focus" : ""}`;
    const segLabel = segAt[i] >= 0 ? segs[segAt[i]].label : "";
    const title = `${segLabel ? segLabel + " · " : ""}byte ${i}: 0x${byteHex(bytes[i])}`;
    cells.push(
      onByte ? (
        <button key={i} type="button" className={cls} title={title} aria-label={title} onClick={() => onByte(i)}>
          {byteHex(bytes[i])}
        </button>
      ) : (
        <span key={i} className={cls} title={title}>
          {byteHex(bytes[i])}
        </span>
      ),
    );
  }
  return (
    <div className={`vz-bytes${dense ? " dense" : ""}${onByte ? " live" : ""}`} style={cols ? { ["--cols" as string]: cols } : undefined} role={onByte ? "group" : "img"} aria-label={label}>
      {cells}
    </div>
  );
}

export function ByteLegend({ segs, values }: { segs: ByteSeg[]; values?: Record<string, ReactNode> }) {
  return (
    <ul className="vz-legend">
      {segs.map((s) => (
        <li key={`${s.from}-${s.tone}`}>
          <i className={`vz-t-${s.tone}`} aria-hidden="true" />
          <span className="vz-legend-l">{s.label}</span>
          <span className="vz-legend-n">
            {s.from}–{s.from + s.length - 1} · {s.length}
          </span>
          {values?.[s.tone] !== undefined ? <span className="vz-legend-v">{values[s.tone]}</span> : null}
        </li>
      ))}
    </ul>
  );
}

/** Hex shown whole, wrapped by groups of 4 (never mid-group), selectable. */
export function HexBlock({ hex, group = 4, max, className }: { hex: string; group?: number; max?: number; className?: string }) {
  const shown = max && hex.length > max ? hex.slice(0, max) : hex;
  const groups: string[] = [];
  for (let i = 0; i < shown.length; i += group) groups.push(shown.slice(i, i + group));
  return (
    <code className={`vz-hexblock${className ? " " + className : ""}`}>
      {groups.map((g, i) => (
        <span key={i}>{g}</span>
      ))}
      {max && hex.length > max ? <span className="vz-more">…+{(hex.length - max) / 2} B</span> : null}
    </code>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <div className="vz-eyebrow">{children}</div>;
}

export function Verdict({ ok, title, children, tone }: { ok: boolean | null; title: ReactNode; children?: ReactNode; tone?: "neutral" }) {
  const cls = tone === "neutral" || ok === null ? "neutral" : ok ? "ok" : "bad";
  return (
    <div className={`vz-verdict ${cls}`} role="status">
      <CheckLamp state={ok === null ? "idle" : ok ? "pass" : "fail"} size={14} />
      <div>
        <div className="vz-verdict-t">{title}</div>
        {children ? <div className="vz-verdict-d">{children}</div> : null}
      </div>
    </div>
  );
}
