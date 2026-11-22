// Guilloche security field (VISUAL §8.5, field@1), ported from design/final/intaglio.js.
// Horizontal guilloche lines y_i(x) = y0 + A1·sin(f1·x + i·d1 + φ) + A2·sin(f2·x − i·d2 − 1.7φ) + ripple, plus elliptical
// lathe rings around a focus. One commitment = one light wave crossing the field (1400 ms). DPR capped at 2.
// Differences from the tile (behaviour only, the drawing is identical): ResizeObserver instead of window resize,
// the animation stops while off-screen or while the tab is hidden, drift is drawn at 30 fps, and destroy() cleans up.
import { rng } from "./rng";

export const FIELD_ALGO = "field@1";
const TAU = Math.PI * 2;

export interface FieldOptions {
  lines?: number;
  rings?: number;
  /** "r,g,b" of the lines (theme token --field-rgb). */
  color?: string;
  /** Line alpha (theme token --field-a, times the place multiplier). */
  alpha?: number;
  /** Focus as fractions of width and height. */
  focus?: [number, number];
  /** Still: no drift (the wallet, reduced motion, ?still). The commit wave still crosses unless `reduced`. */
  still?: boolean;
  /** Reduced motion: no drift and no commit wave (VISUAL §10: the field shows a static frame). */
  reduced?: boolean;
  waveColor?: string;
}

export interface FieldHandle {
  pulse(): void;
  set(o: Partial<FieldOptions>): void;
  stop(): void;
  destroy(): void;
}

export function field(canvas: HTMLCanvasElement, seedBytes: Uint8Array, opts: FieldOptions = {}): FieldHandle {
  const R = rng(seedBytes);
  const ctx = canvas.getContext("2d");
  const P = {
    lines: opts.lines || 64, rings: opts.rings || 26,
    f1: R.range(0.004, 0.007), f2: R.range(0.011, 0.016), d1: R.range(0.10, 0.18), d2: R.range(0.05, 0.11),
    A1: R.range(10, 16), A2: R.range(3, 6), ringN: R.int(18, 30), ringA: R.range(4, 7),
  };
  let W = 0, H = 0, dpr = 1, raf = 0, visible = true, last = 0, dead = false, wasWaving = false;
  const t0 = performance.now();
  let wave = -1;
  const st = { color: opts.color || "216,180,94", alpha: opts.alpha || 0.08, focus: opts.focus || [0.7, 0.45] as [number, number], still: !!opts.still || !!opts.reduced, reduced: !!opts.reduced, waveColor: opts.waveColor || "rgba(190,232,255,0.10)" };

  function draw(now: number) {
    if (!ctx || !W || !H) return;
    const t = (now - t0) / 1000;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const fx = W * st.focus[0], fy = H * st.focus[1];
    const wx = wave >= 0 ? (now - wave) / 1400 : -1; // 0..1 progress of the commit wave
    const waveX = wx >= 0 && wx <= 1 ? -0.2 * W + wx * 1.4 * W : -1e9;
    const phase = st.still ? 0 : t * 0.12;
    const step = 6;
    ctx.lineWidth = 0.7;
    for (let i = 0; i < P.lines; i++) {
      const y0 = (i + 0.5) / P.lines * H;
      ctx.beginPath();
      for (let x = -10; x <= W + 10; x += step) {
        const dx = x - fx, dy = y0 - fy, dist = Math.sqrt(dx * dx + dy * dy);
        const ripple = 9 * Math.exp(-dist / 260) * Math.sin(dist * 0.045 - phase * 3);
        const y = y0 + P.A1 * Math.sin(P.f1 * x + i * P.d1 + phase) + P.A2 * Math.sin(P.f2 * x - i * P.d2 - phase * 1.7) + ripple;
        if (x === -10) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      const edge = Math.min(1, Math.min(i, P.lines - i) / 8);
      ctx.strokeStyle = `rgba(${st.color},${(st.alpha * edge).toFixed(3)})`;
      ctx.stroke();
    }
    for (let k = 0; k < P.rings; k++) {
      const r0 = 60 + k * 15;
      ctx.beginPath();
      for (let j = 0; j <= 240; j++) {
        const th = j / 240 * TAU;
        const r = r0 + P.ringA * Math.sin(P.ringN * th + k * 0.35 + phase * 2);
        const x = fx + r * Math.cos(th), y = fy + r * Math.sin(th) * 0.72;
        if (!j) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = `rgba(${st.color},${(st.alpha * 0.9 * (1 - k / P.rings)).toFixed(3)})`;
      ctx.stroke();
    }
    // the commit wave: a soft band of light that brightens the lines it crosses
    if (waveX > -1e8) {
      const g = ctx.createLinearGradient(waveX - 180, 0, waveX + 180, 0);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.5, st.waveColor);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.globalCompositeOperation = "lighter";
      ctx.fillRect(waveX - 180, 0, 360, H); ctx.globalCompositeOperation = "source-over";
    }
  }

  const waving = (now: number) => wave >= 0 && now - wave <= 1400;
  function loop(now: number) {
    raf = 0;
    if (dead || !visible || document.hidden) return;
    // drift at ~30 fps; the commit wave at full rate; one last frame after the wave clears the band
    const w = waving(now);
    if (w || wasWaving || now - last >= 33) { draw(now); last = now; }
    wasWaving = w;
    if (!st.still || w) raf = requestAnimationFrame(loop);
  }
  const kick = () => {
    if (!raf && !dead && visible && !document.hidden && (!st.still || waving(performance.now()))) raf = requestAnimationFrame(loop);
  };

  function resize() {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1); W = r.width; H = r.height;
    canvas.width = Math.max(1, Math.round(W * dpr)); canvas.height = Math.max(1, Math.round(H * dpr));
    draw(performance.now());
  }

  resize();
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => resize()) : null;
  ro?.observe(canvas);
  const io = typeof IntersectionObserver !== "undefined"
    ? new IntersectionObserver((es) => { visible = es[es.length - 1].isIntersecting; if (visible) kick(); })
    : null;
  io?.observe(canvas);
  const onVis = () => { if (!document.hidden) kick(); };
  document.addEventListener("visibilitychange", onVis);
  kick();

  return {
    pulse() {
      if (st.reduced || dead) return;
      wave = performance.now();
      kick();
    },
    set(o) {
      Object.assign(st, o);
      if (o.reduced) st.still = true;
      draw(performance.now());
      kick();
    },
    stop() { if (raf) cancelAnimationFrame(raf); raf = 0; },
    destroy() {
      dead = true;
      if (raf) cancelAnimationFrame(raf);
      ro?.disconnect(); io?.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}
