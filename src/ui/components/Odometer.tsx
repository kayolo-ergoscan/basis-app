// Odometer (VISUAL §10.1, §10.5): wheels roll right → left over 900 ms with a 40 ms stagger and only forward.
// `allowBack` (the time machine) shudders 2 px three times (180 ms) and then rolls back. Reduced motion swaps digits.
// Screen readers get the final value only (aria-live on the total when `live`).
import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { money } from "../engine/money";
import { prefersReducedMotion, useUiSettings } from "../settings";

export interface OdometerProps {
  value: number;
  dp?: number;
  /** Allow wheels to roll backwards (time machine only). */
  allowBack?: boolean;
  /** Announce the final value politely (the note total). */
  live?: boolean;
  /** Text prefix shown before the wheels ("+" for amounts in your favour). */
  prefix?: string;
  className?: string;
  style?: CSSProperties;
  /** Ignore the privacy setting. */
  reveal?: boolean;
}

const STRIP = "01234567890123456789".split("");

export function Odometer({ value, dp = 2, allowBack, live, prefix, className, style, reveal }: OdometerProps) {
  const ui = useUiSettings();
  const s = money(value, dp);
  const glyphs = s.replace(/⁠/g, "");
  const box = useRef<HTMLSpanElement>(null);
  const prev = useRef<{ s: string; v: number } | null>(null);
  const hidden = ui.privacy && !reveal;

  useLayoutEffect(() => {
    const el = box.current;
    if (!el || hidden) return;
    const wheels = Array.from(el.querySelectorAll<HTMLSpanElement>(".w"));
    const old = prev.current;
    const digits = s.replace(/[^\d]/g, "").split("").map(Number);
    const reduced = prefersReducedMotion();
    // First paint, a change of length, or reduced motion: place the wheels without animation.
    if (!old || old.s.length !== s.length || reduced) {
      wheels.forEach((w, i) => {
        const strip = w.firstElementChild as HTMLElement;
        strip.style.transition = "none";
        strip.style.transform = `translateY(${-digits[i]}em)`;
        w.dataset.p = String(digits[i]);
      });
      prev.current = { s, v: value };
      return;
    }
    const back = allowBack && value < old.v;
    const roll = () => {
      const ws = [...wheels].reverse(), ds = [...digits].reverse();
      ws.forEach((w, i) => {
        const strip = w.firstElementChild as HTMLElement;
        const cur = Number(w.dataset.p) % 10, n = ds[i];
        if (n === cur) return;
        const target = back ? n : n > cur ? n : 10 + n;
        if (back && Number(w.dataset.p) >= 10) { strip.style.transition = "none"; strip.style.transform = `translateY(${-cur}em)`; void strip.offsetWidth; }
        strip.style.transition = `transform var(--t-roll) var(--ease-out) ${i * 40}ms`;
        strip.style.transform = `translateY(${-target}em)`;
        w.dataset.p = String(target);
        const onEnd = () => {
          strip.removeEventListener("transitionend", onEnd);
          if (Number(w.dataset.p) >= 10) {
            strip.style.transition = "none";
            w.dataset.p = String(Number(w.dataset.p) - 10);
            strip.style.transform = `translateY(${-Number(w.dataset.p)}em)`;
          }
        };
        strip.addEventListener("transitionend", onEnd);
      });
    };
    if (back) {
      el.classList.remove("shudder");
      void el.offsetWidth;
      el.classList.add("shudder");
      const tm = setTimeout(roll, 180);
      prev.current = { s, v: value };
      return () => clearTimeout(tm);
    }
    roll();
    prev.current = { s, v: value };
  }, [s, value, allowBack, hidden]);

  if (hidden) return <span className={className} style={style}>•••</span>;
  return (
    <span className={["odo-wrap", className].filter(Boolean).join(" ")} style={style}>
      <span className="sr-only" aria-live={live ? "polite" : undefined}>{(prefix ?? "") + glyphs}</span>
      <span ref={box} className="odo" key={s.length} aria-hidden="true">
        {prefix && <span className="sep">{prefix}</span>}
        {Array.from(s).map((c, i) => {
          if (/\d/.test(c)) return <span key={i} className="w"><span className="strip">{STRIP.map((d, j) => <span key={j}>{d}</span>)}</span></span>;
          if (c === "⁠") return null;
          if (c === " " || c === " ") return <span key={i} className="sp" />;
          return <span key={i} className="sep">{c}</span>;
        })}
      </span>
    </span>
  );
}
