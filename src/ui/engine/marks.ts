// Signatures as marks (VISUAL §8.4 items 8–9), ported verbatim from design/final/intaglio.js.
// Human mark: a flowing autograph seeded by issuer signature bytes 1–16. Machine mark: a bar code of the first
// 48 bytes of the tracker signature. Marks identify; they never prove.
import { fromHex } from "./bytes";
import { poly, r1, type Pt } from "./geometry";
import { rng } from "./rng";

export function spline(Pts: Pt[], per = 9): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < Pts.length - 1; i++) {
    const p0 = Pts[i - 1] || Pts[i], p1 = Pts[i], p2 = Pts[i + 1], p3 = Pts[i + 2] || p2;
    for (let j = 0; j < per; j++) {
      const t = j / per, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((k) => 0.5 * ((2 * p1[k]) + (-p0[k] + p2[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t2 + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * t3)) as Pt);
    }
  }
  out.push(Pts[Pts.length - 1]);
  return out;
}

/** Human mark of a Schnorr signature: a flowing autograph seeded by the signature bytes. */
export function autograph(x: number, y: number, w: number, h: number, seedBytes: Uint8Array): string {
  const R = rng(seedBytes);
  const A: Pt[] = [[0, 0.15], [0.035, -0.75], [0.075, -1.2], [0.1, -0.95], [0.06, -0.2], [0.02, 0.25], [0.09, -0.05], [0.13, -0.3]];
  let cx = 0.13;
  const n = R.int(4, 6);
  for (let i = 0; i < n; i++) {
    const t = R.pick(["e", "l", "n", "u", "o", "e", "n"]);
    const j = () => R.range(-0.04, 0.04);
    if (t === "e") { A.push([cx + 0.035, -0.38 + j()], [cx + 0.02, -0.55], [cx + 0.005, -0.32], [cx + 0.045, 0.02]); cx += 0.055; }
    else if (t === "l") { A.push([cx + 0.04, -0.85 + j()], [cx + 0.03, -1.05], [cx + 0.012, -0.8], [cx + 0.035, 0.02]); cx += 0.05; }
    else if (t === "n") { A.push([cx + 0.015, -0.42], [cx + 0.04, -0.48 + j()], [cx + 0.055, 0], [cx + 0.075, -0.44], [cx + 0.1, -0.42 + j()], [cx + 0.11, 0.02]); cx += 0.12; }
    else if (t === "u") { A.push([cx + 0.008, -0.42], [cx + 0.03, 0.03], [cx + 0.055, -0.44 + j()], [cx + 0.07, 0.02]); cx += 0.08; }
    else { A.push([cx + 0.03, -0.45 + j()], [cx + 0.005, -0.3], [cx + 0.03, 0], [cx + 0.055, -0.38], [cx + 0.07, -0.3]); cx += 0.075; }
  }
  A.push([cx + 0.06, -0.25], [cx + 0.09, 0.05], [cx * 0.7, 0.42], [cx * 0.25, 0.36], [0.06, 0.3]);
  const sc = w / (cx + 0.1), slant = R.range(0.22, 0.36);
  return poly(spline(A, 9).map(([u, q]) => [x + u * sc - q * h * slant, y + q * h] as Pt), false);
}

/** Machine mark of a tracker signature: a bar code of the first 48 bytes (sigHex includes the 1-byte prefix). */
export function machineMark(x: number, y: number, w: number, h: number, sigHex: string): string {
  const b = fromHex(sigHex.slice(2, 2 + 96)), step = w / b.length;
  let d = "";
  for (let i = 0; i < b.length; i++) { const hh = 1.5 + (b[i] / 255) * h; d += `M${r1(x + i * step)} ${r1(y - hh / 2)}v${r1(hh)}`; }
  return d;
}
