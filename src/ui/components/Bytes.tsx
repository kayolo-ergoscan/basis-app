// Bytes (VISUAL §12.1 machine face): segmented hex with offsets and a legend — the 80-byte note message, registers,
// context variables, signatures. Hovering or focusing a legend item highlights its bytes.
import { useMemo, useState, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { fromHex, hex } from "../engine/bytes";

/** Byte colours: k ink-blue (keys), t metal (amounts), ts up (time), n pink (tracker NFT), a alarm, u up, m metal, g/plain grey. */
export type ByteTone = "k" | "t" | "ts" | "n" | "a" | "u" | "m" | "g" | "plain";
export interface ByteSegment {
  label: ReactNode;
  bytes: Uint8Array | string;
  tone?: ByteTone;
  /** Decoded value shown in the legend ("1 240.00 ERG", "2025-11-21 14:20 UTC"). */
  value?: ReactNode;
}
export interface BytesProps {
  segments: ByteSegment[];
  /** Bytes per row: 16 (8 on phone). */
  cols?: number;
  offsets?: boolean;
  legend?: boolean;
  /** Accessible summary ("80-byte message: key 32, total 8, timestamp 8, tracker 32"). */
  ariaLabel?: string;
}

export function Bytes({ segments, cols = 16, offsets = true, legend = true, ariaLabel }: BytesProps) {
  const t = useT();
  const [hl, setHl] = useState<number | null>(null);
  const flat = useMemo(() => {
    const out: { b: string; seg: number; tone: ByteTone }[] = [];
    segments.forEach((s, i) => {
      const h = typeof s.bytes === "string" ? s.bytes.replace(/^0x/, "").toLowerCase() : hex(s.bytes);
      for (let j = 0; j + 1 < h.length; j += 2) out.push({ b: h.slice(j, j + 2), seg: i, tone: s.tone ?? "plain" });
    });
    return out;
  }, [segments]);
  const spans = useMemo(() => {
    let at = 0;
    return segments.map((s) => { const n = typeof s.bytes === "string" ? fromHex(s.bytes.replace(/^0x/, "")).length : s.bytes.length; const r = [at, at + n - 1] as const; at += n; return r; });
  }, [segments]);
  const rows: (typeof flat)[] = [];
  for (let i = 0; i < flat.length; i += cols) rows.push(flat.slice(i, i + cols));
  return (
    <div className="bytes-v" role="group" aria-label={ariaLabel ?? t("ui.bytes.aria", { n: flat.length })}>
      {rows.map((r, ri) => (
        <div className="brow" key={ri}>
          {offsets && <span className="off" aria-hidden="true">{String(ri * cols).padStart(3, "0")}</span>}
          <div className="bytes" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} aria-hidden="true">
            {r.map((x, i) => <span key={i} className={[x.tone, hl === x.seg && "hl"].filter(Boolean).join(" ")}>{x.b}</span>)}
            {r.length < cols && Array.from({ length: cols - r.length }, (_, i) => <span key={"p" + i} className="pad" />)}
          </div>
        </div>
      ))}
      {legend && (
        <div className="segs">
          {segments.map((s, i) => (
            <button key={i} type="button" className={["seg-l", hl === i && "hl"].filter(Boolean).join(" ")}
              onMouseEnter={() => setHl(i)} onMouseLeave={() => setHl(null)} onFocus={() => setHl(i)} onBlur={() => setHl(null)}>
              <i className={`swatch-${s.tone ?? "plain"}`} aria-hidden="true" />
              <span><b>{s.label}</b> · {t("ui.bytes.range", { a: spans[i][0], b: spans[i][1], n: spans[i][1] - spans[i][0] + 1 })}</span>
              {s.value != null ? <span className="val">{s.value}</span> : <span />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Big-endian bytes of an unsigned integer (8 bytes by default): totals in nanoERG, timestamps in ms. */
export function be(v: bigint | number, len = 8): Uint8Array {
  let x = BigInt(v);
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = Number(x & 0xffn); x >>= 8n; }
  return out;
}

/** Groups a signature by byte for display: "02 9a 1f …". */
export const byteGroups = (h: string) => (h.match(/../g) || []).join(" ");
