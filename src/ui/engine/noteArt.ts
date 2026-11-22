// Note background art (VISUAL §8.4, note@1), ported verbatim from design/final/intaglio.js.
// viewBox 0 0 1000 440. Text, odometer and foil are HTML layers above (see .note in components.css).
import { fromHex, hex } from "./bytes";
import { poly, r1, rope, rrect, TAU, type Pt } from "./geometry";
import { inksFor, type InkPair } from "./inks";
import { autograph, machineMark } from "./marks";
import { rng } from "./rng";
import { sealSVG } from "./seal";

export const NOTE_ALGO = "note@1";

/** Serial of a note: the first 8 key bytes as 4 hex groups ("2174 37A4 498A DF59"). */
export const serialOf = (key: Uint8Array): string => (hex(key.slice(0, 8)).toUpperCase().match(/..../g) || []).join(" ");

export interface NoteArtOptions {
  inks?: InkPair;
  /** Lite: no fibres, microprint or grain; seal at detail .6 (stacks, cards, thumbnails). */
  lite?: boolean;
  /** Unique suffix for SVG ids when the same key is drawn twice on a page. */
  uid?: string;
  /** Microprint ring text (full notes only), readable with the ×4 loupe. */
  micro?: string;
  /** Issuer signature hex (65 bytes, a ‖ z): seeds the autograph from bytes 1–16. */
  sigA?: string;
  /** Tracker signature hex: the machine mark is its first 48 bytes after the prefix. */
  sigT?: string;
}

/** Text inside the SVG markup (rendered with innerHTML): `&<>"'` escaped (keys review P2-10). */
export const escapeXml = (v: string): string =>
  v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

export function noteArt(key: Uint8Array, o: NoteArtOptions = {}): string {
  const ink = o.inks || inksFor(key), A = ink.a.c, B = ink.b.c, At = ink.a.t;
  const R = rng(key.slice(8));
  const W = 1000, H = 440, lite = !!o.lite, id = "na" + hex(key.slice(0, 4)) + (o.uid || "");
  const sc = { x: 730, y: 214, r: 150 };
  const P: string[] = [];
  P.push(`<svg class="note-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>
      <radialGradient id="${id}p" cx="38%" cy="36%" r="90%"><stop offset="0" stop-color="#FBF7EE"/><stop offset=".62" stop-color="#F3EBDB"/><stop offset="1" stop-color="#E7DCC6"/></radialGradient>
      <radialGradient id="${id}i" cx="${sc.x}" cy="${sc.y}" r="250" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="${At}" stop-opacity=".95"/><stop offset=".6" stop-color="${At}" stop-opacity=".35"/><stop offset="1" stop-color="${At}" stop-opacity="0"/></radialGradient>
      <linearGradient id="${id}f" x1="0" y1="0" x2="1" y2="0"><stop offset=".30" stop-color="#fff" stop-opacity="0"/><stop offset=".55" stop-color="#fff" stop-opacity="1"/></linearGradient>
      <mask id="${id}m"><rect width="${W}" height="${H}" fill="url(#${id}f)"/></mask>
      <clipPath id="${id}c"><rect width="${W}" height="${H}" rx="10"/></clipPath>
      <filter id="${id}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="${key[3]}"/><feColorMatrix values="0 0 0 0 .30  0 0 0 0 .24  0 0 0 0 .16  0 0 0 .8 -.38"/></filter>
    </defs><g clip-path="url(#${id}c)">`);
  P.push(`<rect width="${W}" height="${H}" fill="url(#${id}p)"/><circle cx="${sc.x}" cy="${sc.y}" r="250" fill="url(#${id}i)"/>`);
  // security fibres (two identity inks, never red)
  if (!lite) {
    let fib = "";
    for (let i = 0; i < 22; i++) {
      const x = R.range(30, 970), y = R.range(30, 410), a = R.range(0, TAU), l = R.range(5, 11);
      fib += `<path d="M${r1(x)} ${r1(y)}q${r1(Math.cos(a) * l * .5 + 2)} ${r1(Math.sin(a) * l * .5 - 2)} ${r1(Math.cos(a) * l)} ${r1(Math.sin(a) * l)}" stroke="${i % 2 ? A : B}"/>`;
    }
    P.push(`<g fill="none" stroke-width=".6" opacity=".35">${fib}</g>`);
  }
  // relief: parallel engraved lines lifted by a dome under the seal (banknote "relief" shading)
  const gap = lite ? 7 : 4.6, stepX = lite ? 12 : 7, ph = R.range(0, TAU), petals = R.int(5, 11);
  let rl = "";
  for (let y = 8; y <= H + 30; y += gap) {
    const pts: Pt[] = [];
    for (let x = 300; x <= W + 0.1; x += stepX) {
      const dx = x - sc.x, dy = y - sc.y, dome = Math.exp(-(dx * dx + dy * dy) / (2 * 140 * 140));
      const th = Math.atan2(dy, dx), h = dome * (1 + 0.32 * Math.sin(petals * th + ph));
      pts.push([x, y - 30 * h + 1.3 * Math.sin(x * 0.034 + y * 0.013 + ph)]);
    }
    rl += poly(pts, false);
  }
  P.push(`<g mask="url(#${id}m)" fill="none" stroke="${A}" stroke-width="${lite ? .7 : .42}" opacity="${lite ? .22 : .36}"><path d="${rl}"/></g>`);
  // frame: braided rope between two hairlines
  const fr = rrect(24, 24, W - 48, H - 48, 14);
  P.push(`<g fill="none" stroke="${A}" stroke-width="${lite ? .8 : .5}" opacity=".8"><path d="${rope(fr, { strands: 3, cycles: lite ? 110 : 150, amp: 5.2, steps: lite ? 900 : 1700 }).join("")}"/></g>`);
  const hair = (Rr: ReturnType<typeof rrect>) => { const p: Pt[] = []; for (let j = 0; j <= 200; j++) { const q = Rr.at(j / 200 * Rr.L); p.push([q[0], q[1]]); } return poly(p, true); };
  P.push(`<path d="${hair(rrect(33, 33, W - 66, H - 66, 9))}${hair(rrect(14, 14, W - 28, H - 28, 18))}" fill="none" stroke="${A}" stroke-width="${lite ? .9 : .7}" opacity=".7"/>`);
  // the pair seal, drawn into the note
  P.push(`<g transform="translate(${sc.x} ${sc.y}) scale(${sc.r / 100})">${sealSVG(key, { kind: "pair", detail: lite ? 0.6 : 1, inks: ink, paper: false, px: lite ? 160 : 300 }).replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g>`);
  // microprint ring around the seal (the real pair key, readable with the loupe)
  if (!lite && o.micro) {
    P.push(`<path id="${id}r" d="M ${sc.x} ${sc.y - 160} a 160 160 0 1 1 -0.1 0" fill="none"/>`);
    P.push(`<text font-family="Geist Mono, monospace" font-size="3.6" fill="${A}" opacity=".9" letter-spacing=".15"><textPath href="#${id}r">${escapeXml(o.micro)}</textPath></text>`);
  }
  // signatures
  if (o.sigA) P.push(`<path d="${autograph(70, 357, 140, 15, fromHex(o.sigA.slice(2, 34)))}" fill="none" stroke="${A}" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`);
  if (o.sigT) P.push(`<path d="${machineMark(318, 352, 170, 13, o.sigT)}" stroke="${B}" stroke-width="1.5" opacity=".85"/>`);
  if (!lite) P.push(`<rect width="${W}" height="${H}" filter="url(#${id}n)" opacity=".55" style="mix-blend-mode:multiply"/>`);
  P.push(`</g></svg>`);
  return P.join("");
}
