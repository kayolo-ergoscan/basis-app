// QR code for request links (P09, M02): qrcode-generator 1.4.4 encodes; we draw the modules as one SVG path,
// dark ink on paper in both themes (scanners need dark on light), with the 4-module quiet zone.
import { useMemo } from "react";
import qrcode from "qrcode-generator";

export function qrPath(text: string): { path: string; size: number } | null {
  try {
    const q = qrcode(0, "M");
    q.addData(text, "Byte");
    q.make();
    const n = q.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) {
      let c = 0;
      while (c < n) {
        if (!q.isDark(r, c)) {
          c++;
          continue;
        }
        let e = c;
        while (e < n && q.isDark(r, e)) e++;
        d += `M${c + 4} ${r + 4}h${e - c}v1h${-(e - c)}z`;
        c = e;
      }
    }
    return { path: d, size: n + 8 };
  } catch {
    return null;
  }
}

export function QrCode({ text, size = 200, label }: { text: string; size?: number; label: string }) {
  const q = useMemo(() => qrPath(text), [text]);
  if (!q) return null;
  return (
    <svg className="wl-qr" width={size} height={size} viewBox={`0 0 ${q.size} ${q.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={q.size} height={q.size} rx="1.2" style={{ fill: "var(--paper-hi)" }} />
      <path d={q.path} style={{ fill: "var(--paper-ink)" }} />
    </svg>
  );
}
