// DigestGlyph: the digest's fingerprint (see glyph.ts). `holo` only for a digest the chain holds (VISUAL §7:
// light = proof); `stale` greys it out; `ping` marks a change.

import { useMemo } from "react";
import { toBytes, type Hex } from "@/protocol";
import { groupHex } from "../core/format";
import { digestGlyph } from "./glyph";
import "./avl.css";

export interface DigestGlyphProps {
  digest: Uint8Array | Hex;
  size?: number;
  holo?: boolean;
  stale?: boolean;
  ping?: boolean;
  title?: string;
  className?: string;
}

export function DigestGlyph({ digest, size = 56, holo, stale, ping, title, className }: DigestGlyphProps) {
  const bytes = useMemo(() => {
    try {
      return digest instanceof Uint8Array ? digest : toBytes(digest);
    } catch {
      return new Uint8Array(33);
    }
  }, [digest]);
  const g = useMemo(() => digestGlyph(bytes, 64), [bytes]);
  const hex = useMemo(() => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""), [bytes]);
  return (
    <span className={`vz-glyph-wrap${holo ? " holo" : ""}${stale ? " stale" : ""}${ping ? " ping" : ""}${className ? " " + className : ""}`} style={{ width: size, height: size }}>
    <svg
      className="vz-glyph"
      width={size - 6}
      height={size - 6}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title ?? groupHex(hex)}
    >
      <title>{title ?? groupHex(hex)}</title>
      <circle cx="32" cy="32" r="30.5" className="frame" />
      {g.rings.map((r, i) => (
        <circle key={i} cx="32" cy="32" r={r} className="ring" />
      ))}
      {g.spokes.map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="spoke" />
      ))}
      <path d={g.outline} className="outline" />
    </svg>
    </span>
  );
}

export default DigestGlyph;
