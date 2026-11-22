// Sheet (VISUAL §12.5, §10.7): a side sheet on desktop, a bottom sheet on phone (radius 22, 36 × 5 grabber, rises
// over 420 ms). Modal: scrim, Escape, focus moves in and returns, Tab stays inside. Popover: the small anchored
// panel the policy pills open.
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/app/lang";
import { useEscape } from "../hooks";
import { Icon } from "./Icon";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** A line under the title. */
  sub?: ReactNode;
  /** Header start (a seal), header end (a tag). */
  lead?: ReactNode;
  aside?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** "auto": side on desktop, bottom on phone; "bottom": always bottom; "side": side on desktop. */
  placement?: "auto" | "bottom" | "side";
  /** Desktop width (px), default 480. */
  width?: number;
  /** Accessible name when the title is not plain text. */
  ariaLabel?: string;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, sub, lead, aside, children, footer, placement = "auto", width, ariaLabel }: SheetProps) {
  const t = useT();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const dragY = useRef<{ y0: number; dy: number } | null>(null);
  useEscape(open, onClose);
  useEffect(() => {
    if (!open) return;
    back.current = document.activeElement as HTMLElement | null;
    const p = panel.current;
    // the first VISIBLE control (the drag grip is display:none on side sheets, and focusing it silently failed)
    const first = p?.querySelector<HTMLElement>("[data-autofocus]") ?? Array.from(p?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).find((x) => x.offsetParent !== null);
    (first ?? p)?.focus({ preventScroll: true });
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prevOverflow; back.current?.focus?.({ preventScroll: true }); };
  }, [open]);
  if (!open) return null;
  const trap = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const list = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter((x) => x.offsetParent !== null);
    if (!list.length) return;
    const a = list[0], z = list[list.length - 1];
    if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
  };
  const style = width ? ({ "--sheet-w": `${width}px` } as CSSProperties) : undefined;
  return createPortal(
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        className={`sheet-panel${placement === "bottom" ? " bottom" : placement === "side" ? " side" : ""}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : `${id}-t`}
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={trap}
      >
        <button
          type="button"
          className="grab"
          aria-label={t("ui.close")}
          onClick={onClose}
          onPointerDown={(e) => { dragY.current = { y0: e.clientY, dy: 0 }; (e.target as Element).setPointerCapture(e.pointerId); }}
          onPointerMove={(e) => {
            const d = dragY.current;
            if (!d || !panel.current) return;
            d.dy = Math.max(0, e.clientY - d.y0);
            panel.current.style.transform = `translateY(${d.dy}px)`;
          }}
          onPointerUp={() => {
            const d = dragY.current;
            dragY.current = null;
            if (!panel.current) return;
            if (d && d.dy > 90) onClose(); else panel.current.style.transform = "";
          }}
        />
        <div className="sheet-h">
          <div className="who-line" style={{ minWidth: 0 }}>
            {lead}
            <div style={{ minWidth: 0 }}>
              <div className="t-h4" id={`${id}-t`}>{title}</div>
              {sub && <div className="t-small">{sub}</div>}
            </div>
          </div>
          <div className="cluster" style={{ "--gap": "8px", flexWrap: "nowrap" } as CSSProperties}>
            {aside}
            <button type="button" className="key sm quiet icon-only" onClick={onClose} aria-label={t("ui.close")}><Icon name="close" /></button>
          </div>
        </div>
        <div className="sheet-b">{children}</div>
        {footer && <div className="sheet-f">{footer}</div>}
      </div>
    </>,
    document.body,
  );
}

export interface PopoverProps {
  /** The trigger; receives aria props. */
  trigger: (p: { onClick: () => void; "aria-expanded": boolean; "aria-controls": string }) => ReactNode;
  children: ReactNode;
  align?: "start" | "end";
}
/** Anchored panel under its trigger; closes on outside click and Escape. */
export function Popover({ trigger, children, align = "start" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const box = useRef<HTMLSpanElement>(null);
  useEscape(open, () => setOpen(false));
  useEffect(() => {
    if (!open) return;
    const on = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", on);
    return () => document.removeEventListener("pointerdown", on);
  }, [open]);
  return (
    <span className="pop-anchor" ref={box}>
      {trigger({ onClick: () => setOpen((v) => !v), "aria-expanded": open, "aria-controls": id })}
      {open && <div id={id} className="pop" role="dialog" style={{ top: "calc(100% + 6px)", [align === "end" ? "right" : "left"]: 0 }}>{children}</div>}
    </span>
  );
}
