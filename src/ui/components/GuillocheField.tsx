// The guilloche field (VISUAL §8.5): a canvas of interference lines behind heroes and balance sheets. It drifts
// slowly (hero only), freezes under reduced motion or `still`, and a commitment sends one wave across it (the pulse).
import { useEffect, useRef, type CSSProperties } from "react";
import { pulse, type Pulse } from "@/app/pulse";
import { blake2b256, utf8 } from "../engine/bytes";
import { field, type FieldHandle } from "../engine/field";
import { useTheme } from "@/app/theme";
import { useReducedMotion } from "../settings";

export interface GuillocheFieldProps {
  /** Seed text or bytes (e.g. the digest). */
  seed: string | Uint8Array;
  /** Focus point as fractions of width and height. */
  focus?: [number, number];
  /** Freeze the drift (balance sheets); the commit wave still crosses. */
  still?: boolean;
  /** Alpha multiplier (0.4 when the tracker is silent). */
  dim?: number;
  lines?: number;
  rings?: number;
  /** React to pulses (default true); a filter can narrow them. */
  pulseFilter?: (p: Pulse) => boolean;
  className?: string;
  style?: CSSProperties;
}

export function GuillocheField({ seed, focus = [0.69, 0.47], still, dim = 1, lines, rings, pulseFilter, className, style }: GuillocheFieldProps) {
  const cv = useRef<HTMLCanvasElement>(null);
  const h = useRef<FieldHandle | null>(null);
  const { theme } = useTheme();
  const rm = useReducedMotion();
  // Colours: the theme's token values first (no style read while mounting: getComputedStyle there forced a full style
  // recalc, ≈ 55 ms on a cold load), then the real computed tokens one frame later (scoped .theme-light blocks).
  const fallback = () => (theme === "cotton" ? { color: "19,19,21", alpha: 0.07 * dim } : { color: "217,182,95", alpha: 0.085 * dim });
  const colors = () => {
    const cs = getComputedStyle(cv.current ?? document.documentElement);
    return { color: cs.getPropertyValue("--field-rgb").trim() || "216,180,94", alpha: (parseFloat(cs.getPropertyValue("--field-a")) || 0.08) * dim };
  };
  useEffect(() => {
    if (!cv.current) return;
    const bytes = typeof seed === "string" ? blake2b256(utf8(seed)) : seed;
    h.current = field(cv.current, bytes, { ...fallback(), focus, still: still || rm, reduced: rm, ...(lines ? { lines } : null), ...(rings ? { rings } : null) });
    return () => { h.current?.destroy(); h.current = null; };
  }, [typeof seed === "string" ? seed : seed.join(","), focus[0], focus[1], still, lines, rings, rm]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const r = requestAnimationFrame(() => h.current?.set(colors())); return () => cancelAnimationFrame(r); }, [theme, dim, rm]); // eslint-disable-line react-hooks/exhaustive-deps
  const fRef = useRef(pulseFilter);
  fRef.current = pulseFilter;
  useEffect(() => pulse.subscribe((p) => { if (!fRef.current || fRef.current(p)) h.current?.pulse(); }), []);
  return <canvas ref={cv} className={["field", className].filter(Boolean).join(" ")} style={style} aria-hidden="true" />;
}
