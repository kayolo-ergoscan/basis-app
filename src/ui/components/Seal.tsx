// Seals (VISUAL §8.2–8.4, §12): a key seal for a person (circle) or agent (octagon) from blake2b256(pk); the pair
// seal of a debt key; the brand seal from blake2b("basis"). Seals render as cached <img> (one DOM node each);
// `live` draws inline SVG (use it for at most a few hero-sized seals). Seals are aria-hidden: the name, fingerprint
// and three words are always in text next to them (a seal is never proof of identity).
import { useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import { usePulseClass } from "../hooks";
import { asBytes, blake2b256, utf8 } from "../engine/bytes";
import { BRAND_INKS } from "../engine/inks";
import { short } from "../engine/money";
import { keySeed, sealUrl } from "../engine/raster";
import { detailFor, pairSeal, sealSVG, type SealOptions } from "../engine/seal";
import { threeWords } from "../engine/words";
import { AgentTag } from "./primitives";

const SIZES = { sm: 28, md: 40, lg: 56, xl: 96 } as const;
export type SealSize = keyof typeof SIZES | number;
const px = (s: SealSize | undefined, d = 40) => (s == null ? d : typeof s === "number" ? s : SIZES[s]);

export interface KeySealProps {
  /** Public key hex (33-byte compressed) or bytes. */
  pk: string | Uint8Array;
  agent?: boolean;
  size?: SealSize;
  /** Gold rim = has a reserve (VISUAL §12). A number 0…1 draws a partial rim (coverage / 200 %). */
  rim?: boolean | number;
  /** Small lamp badge in the corner (wallet list). */
  badge?: ReactNode;
  title?: string;
  className?: string;
  style?: CSSProperties;
}
/** A person or agent seal (seed blake2b256(pk)). */
export function KeySeal({ pk, agent, size = "md", rim, badge, title, className, style }: KeySealProps) {
  const s = px(size);
  const src = sealUrl(keySeed(typeof pk === "string" ? pk : hexOf(pk)), { kind: agent ? "agent" : "person", detail: detailFor(s), px: s });
  const full = rim === true || (typeof rim === "number" && rim >= 1);
  const part = typeof rim === "number" && rim > 0 && rim < 1 ? rim : 0;
  return (
    <span className={["kseal", full && "rim", className].filter(Boolean).join(" ")} style={{ width: s, height: s, ...style }} title={title}>
      <img src={src} alt="" aria-hidden="true" width={s} height={s} draggable={false} decoding="async" />
      {part > 0 && <RimArc frac={part} />}
      {badge != null && <span className="badge">{badge}</span>}
    </span>
  );
}
const hexOf = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

function RimArc({ frac }: { frac: number }) {
  const a1 = -Math.PI / 2 + frac * Math.PI * 2, R = 48;
  return (
    <svg className="rim-arc" viewBox="-50 -50 100 100" aria-hidden="true">
      <circle r={R} fill="none" stroke="var(--rule-2)" strokeWidth={3} />
      <path d={`M0 ${-R} A${R} ${R} 0 ${frac > 0.5 ? 1 : 0} 1 ${(R * Math.cos(a1)).toFixed(2)} ${(R * Math.sin(a1)).toFixed(2)}`} fill="none" stroke="var(--metal)" strokeWidth={3} strokeLinecap="round" />
    </svg>
  );
}

export interface PairSealProps {
  /** The debt key: blake2b256(issuer ‖ receiver [‖ tokenId]) as bytes or hex. */
  pairKey: Uint8Array | string;
  size?: number;
  /** Override detail (default from size: ≥160 → 1, 60–160 → .6, ≤60 → .35). */
  detail?: number;
  /** false = no paper disc. */
  paper?: boolean;
  /** Inline SVG instead of an image (hero only). */
  live?: boolean;
  flat?: boolean;
  className?: string;
  style?: CSSProperties;
}
/** The face of a note: the pair seal of a debt key. */
export function PairSeal({ pairKey, size = 84, detail, paper, live, flat, className, style }: PairSealProps) {
  const key = typeof pairKey === "string" ? asBytes(pairKey) : pairKey;
  const o: SealOptions = { detail: detail ?? detailFor(size), px: size, ...(paper === false ? { paper: false } : null) };
  const svg = useMemo(() => (live ? pairSeal(key, o) : ""), [live, hexOf(key), o.detail, o.px, paper]); // eslint-disable-line react-hooks/exhaustive-deps
  const cls = ["pseal", flat && "flat", className].filter(Boolean).join(" ");
  if (live) return <span className={cls} style={{ width: size, height: size, ...style }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
  return (
    <span className={cls} style={{ width: size, height: size, ...style }} aria-hidden="true">
      <img src={sealUrl(key, { kind: "pair", ...o })} alt="" width={size} height={size} draggable={false} decoding="async" />
    </span>
  );
}

const BRAND_KEY = blake2b256(utf8("basis"));
const BRAND_SVG = sealSVG(BRAND_KEY, { kind: "pair", detail: 0.35, px: 30, inks: BRAND_INKS });
/** The brand seal (blake2b("basis"), graphite inks, 30 px). Part of the pulse. */
export function BrandSeal({ size = 30, pulse = true }: { size?: number; pulse?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  usePulseClass(ref, () => pulse);
  return <span ref={ref} className="brand-seal" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: BRAND_SVG }} />;
}
export const BRAND_SEAL_SVG = BRAND_SVG;

export interface SealIdProps {
  pk: string;
  name: ReactNode;
  agent?: boolean;
  rim?: boolean | number;
  size?: SealSize;
  /** Show the BIP-39 three words (default true) and the fingerprint (default true). */
  words?: boolean;
  fingerprint?: boolean;
  /** Extra line under the name. */
  sub?: ReactNode;
  badge?: ReactNode;
  className?: string;
}
/** Seal + name (+ AI tag) + three words + fingerprint: how a key is shown everywhere. */
export function SealId({ pk, name, agent, rim, size = "lg", words = true, fingerprint = true, sub, badge, className }: SealIdProps) {
  const w = useMemo(() => (words ? threeWords(pk).join(" · ") : ""), [pk, words]);
  return (
    <div className={["who-line", className].filter(Boolean).join(" ")}>
      <KeySeal pk={pk} agent={agent} rim={rim} size={size} badge={badge} />
      <div className="seal-id">
        <div className="nm">{name}{agent && <AgentTag small />}</div>
        {sub && <div className="t-small">{sub}</div>}
        {words && <div className="w3">{w}</div>}
        {fingerprint && <div className="fp">{short(pk, 4, 4)}</div>}
      </div>
    </div>
  );
}
