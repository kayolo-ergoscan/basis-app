// Keys (VISUAL §12.3, §10.6, §15). Variants: primary (one per view), default (key2), metal (only Redeem / Top up /
// Hold to redeem), quiet, danger. `hold` turns the key into hold-to-act: sign 700 ms (ink fill), on-chain 1200 ms
// (metal fill). Releasing early retracts the fill in 160 ms. Holding Enter or Space works. With the setting
// "Confirm with a second press" a hold key becomes press → "Press again to confirm" → press.
import { forwardRef, useCallback, useEffect, useRef, useState, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { money } from "../engine/money";
import { useUiSettings } from "../settings";
import { Icon, type IconName } from "./Icon";

export type KeyVariant = "primary" | "default" | "metal" | "quiet" | "danger";
export interface KeyProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: KeyVariant;
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  /** Trailing keyboard hint ("P"). */
  kbd?: string;
  /** Full width. */
  block?: boolean;
  /** Phone action key: icon over label, 62 px (wallet Pay / Request / Redeem / Scan). */
  tall?: boolean;
  /** Hold-to-act: true = 1200 ms (on-chain), "sign" = 700 ms, or a number of ms. */
  hold?: boolean | "sign" | number;
  /** Called on a completed hold (or on click for a normal key). */
  onAct?: () => void;
  /** Fill of the hold progress (CSS background); defaults by variant. */
  holdFill?: string;
  /** Show the duration after the label ("0.7 s"); default true for holds. */
  showSecs?: boolean;
  /** Internal route: renders a router Link with key styles. */
  to?: string;
  /** External link (opens in a new tab). */
  href?: string;
  children?: ReactNode;
}

const FILL: Partial<Record<KeyVariant, string>> = {
  primary: "linear-gradient(90deg,var(--ink-3),var(--ink-2))",
  metal: "linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.45))",
  default: "linear-gradient(90deg,var(--rule-2),var(--ink-3))",
  danger: "linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.28))",
};

const cls = (variant: KeyVariant, size: string, o: { block?: boolean; tall?: boolean; hold?: boolean; iconOnly?: boolean; extra?: string }) =>
  ["key", variant !== "default" && variant, size !== "md" && size, o.block && "block", o.tall && "tall", o.hold && "hold", o.iconOnly && "icon-only", o.extra].filter(Boolean).join(" ");

/** <Key variant="primary" icon="pay" onClick=…>Pay</Key> · <Key variant="metal" hold onAct=…>Hold to redeem 500.00</Key> */
export const Key = forwardRef<HTMLButtonElement, KeyProps>(function Key(
  { variant = "default", size = "md", icon, kbd, block, tall, hold, onAct, holdFill, showSecs, to, href, children, className, style, onClick, disabled, ...rest },
  fwd,
) {
  const t = useT();
  const settings = useUiSettings();
  const iconOnly = !!icon && children == null;
  const inner = (
    <>
      {icon && <Icon name={icon} size={tall ? 22 : 18} />}
      {children != null && <span className="lbl">{children}</span>}
      {kbd && <span className="kbd" aria-hidden="true">{kbd}</span>}
    </>
  );
  if (!hold && to) return <Link to={to} className={cls(variant, size, { block, tall, iconOnly, extra: className })} style={style}>{inner}</Link>;
  if (!hold && href) return <a href={href} target="_blank" rel="noreferrer" className={cls(variant, size, { block, tall, iconOnly, extra: className })} style={style}>{inner}</a>;
  if (!hold) {
    return (
      <button ref={fwd} type="button" className={cls(variant, size, { block, tall, iconOnly, extra: className })} style={style} disabled={disabled}
        onClick={(e) => { onClick?.(e); onAct?.(); }} {...rest}>
        {inner}
      </button>
    );
  }
  const ms = hold === true ? 1200 : hold === "sign" ? 700 : hold;
  return (
    <HoldKey ms={ms} confirmPress={settings.confirmPress} variant={variant} size={size} block={block} tall={tall} className={className} style={style}
      disabled={disabled} fill={holdFill ?? FILL[variant] ?? FILL.default!} onAct={onAct} secs={showSecs !== false} icon={icon} kbd={kbd} t={t} rest={rest} fwd={fwd}>
      {children}
    </HoldKey>
  );
});

/** In confirm-press mode, a second press sooner than this after the first is ignored (a double-click). */
export const CONFIRM_GAP_MS = 500;

interface HoldKeyProps {
  ms: number; confirmPress: boolean; variant: KeyVariant; size: string; block?: boolean; tall?: boolean; className?: string; style?: CSSProperties;
  disabled?: boolean; fill: string; onAct?: () => void; secs: boolean; icon?: IconName; kbd?: string; children?: ReactNode;
  t: ReturnType<typeof useT>; rest: Record<string, unknown>; fwd: React.ForwardedRef<HTMLButtonElement>;
}
function HoldKey({ ms, confirmPress, variant, size, block, tall, className, style, disabled, fill, onAct, secs, icon, kbd, children, t, rest, fwd }: HoldKeyProps) {
  const ref = useRef<HTMLButtonElement | null>(null);
  const raf = useRef(0);
  const t0 = useRef(0);
  const done = useRef(false);
  const [armed, setArmed] = useState(false);
  const armT = useRef<ReturnType<typeof setTimeout>>();
  const armedAt = useRef(0);
  const setRef = useCallback((el: HTMLButtonElement | null) => {
    ref.current = el;
    if (typeof fwd === "function") fwd(el); else if (fwd) fwd.current = el;
  }, [fwd]);

  const setP = (p: number) => ref.current?.style.setProperty("--p", String(p));
  const finish = () => {
    done.current = true;
    const el = ref.current;
    if (el) { el.classList.remove("is-down"); el.classList.add("is-down"); setTimeout(() => { el.classList.remove("is-down"); setP(0); }, 160); }
    onAct?.();
  };
  const start = () => {
    if (disabled) return;
    cancelAnimationFrame(raf.current);
    done.current = false;
    t0.current = performance.now();
    const el = ref.current;
    el?.classList.remove("retract");
    el?.classList.add("is-down");
    const step = (now: number) => {
      const p = Math.min(1, (now - t0.current) / ms);
      setP(p);
      if (p < 1) raf.current = requestAnimationFrame(step);
      else finish();
    };
    raf.current = requestAnimationFrame(step);
  };
  const stop = () => {
    if (done.current) return;
    cancelAnimationFrame(raf.current);
    const el = ref.current;
    if (!el) return;
    el.classList.remove("is-down");
    el.classList.add("retract");
    setP(0);
  };
  useEffect(() => () => { cancelAnimationFrame(raf.current); clearTimeout(armT.current); }, []);

  const secsText = t("ui.key.secs", { v: money(ms / 1000, 1, t.lang) }); // «1,2 с» / "1.2 s"
  const label = confirmPress && armed ? t("ui.key.again") : children;
  const handlers = confirmPress
    ? {
        onClick: () => {
          if (disabled) return;
          if (!armed) { setArmed(true); armedAt.current = performance.now(); clearTimeout(armT.current); armT.current = setTimeout(() => setArmed(false), 4000); return; }
          // a double-click is not a confirmation: the second press counts only after half a second (keys review P2-9)
          if (performance.now() - armedAt.current < CONFIRM_GAP_MS) return;
          clearTimeout(armT.current);
          setArmed(false);
          onAct?.();
        },
      }
    : {
        onPointerDown: (e: React.PointerEvent) => { if (e.button !== 0) return; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); start(); },
        onPointerUp: stop,
        onPointerCancel: stop,
        onLostPointerCapture: stop,
        onKeyDown: (e: React.KeyboardEvent) => { if ((e.key === "Enter" || e.key === " ") && !e.repeat) { e.preventDefault(); start(); } else if (e.key === "Enter" || e.key === " ") e.preventDefault(); },
        onKeyUp: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); stop(); } },
        onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
      };
  return (
    <button
      ref={setRef}
      type="button"
      className={cls(variant, size, { block, tall, hold: true, extra: [className, armed && "armed"].filter(Boolean).join(" ") })}
      style={{ ...style, "--hold-fill": fill } as CSSProperties}
      disabled={disabled}
      aria-describedby={undefined}
      {...handlers}
      {...rest}
    >
      {icon && <Icon name={icon} size={tall ? 22 : 18} />}
      <span className="lbl">{label}</span>
      {secs && !(confirmPress && armed) && <span className="secs" aria-hidden="true">{confirmPress ? t("ui.key.twice") : secsText}</span>}
      {kbd && <span className="kbd" aria-hidden="true">{kbd}</span>}
      <span className="sr-only">{confirmPress ? t("ui.key.confirmHint") : t("ui.key.holdHint", { s: secsText })}</span>
    </button>
  );
}
