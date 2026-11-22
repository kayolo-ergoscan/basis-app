// "Download note" (M05, P14): the note face as a standalone SVG or PNG, and the signed note as JSON that
// /learn's NoteVerifyTool (and anyone with the issuer's key) can verify offline. The art is taken from the
// rendered <Note> (the kit's own engraving), the face text is laid out on the same 1000 × 440 grid (cqw × 10).

export interface NoteFace {
  issuer: string;
  receiver: string;
  owes: string;
  amount: string;
  unit: string;
  caption: string;
  brandSub: string;
  serial: string;
  signedLine: string;
  signedSub: string;
  witnessedLine: string;
  witnessedSub: string;
  foilText: string;
  committed: boolean;
  sandbox: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function cssVar(el: Element, name: string, fallback: string): string {
  const v = getComputedStyle(el).getPropertyValue(name).trim();
  return v || fallback;
}

async function artSvg(noteEl: HTMLElement): Promise<string> {
  const art = noteEl.querySelector(".note-art");
  if (!art) return "";
  if (art instanceof HTMLImageElement) {
    try {
      const r = await fetch(art.src);
      return await r.text();
    } catch {
      return "";
    }
  }
  return art.innerHTML;
}

/** Builds the SVG text of a rendered note element. */
export async function noteSvg(noteEl: HTMLElement, f: NoteFace): Promise<string> {
  const art = (await artSvg(noteEl)).replace(/<\?xml[^>]*>/, "").replace(/^<svg /, '<svg x="0" y="0" width="1000" height="440" ');
  const inkA = cssVar(noteEl, "--ink-a", "#2A3A5A");
  const paperInk = cssVar(noteEl, "--paper-ink", "#17171A");
  const holo = cssVar(document.documentElement, "--holo", "");
  const stops = (holo.match(/#[0-9a-fA-F]{6}\s+\d+%/g) ?? []).map((s) => {
    const [c, p] = s.split(/\s+/);
    return `<stop offset="${p}" stop-color="${c}"/>`;
  });
  const paper = cssVar(noteEl, "--paper", "#F1E9D8");
  const staleTok = cssVar(document.documentElement, "--holo-stale", "#B9B5AC");
  const stale = staleTok.match(/#[0-9a-fA-F]{6}/)?.[0] ?? "#B9B5AC";
  const foilFill = f.committed && stops.length ? "url(#wlholo)" : stale;
  const serif = "'Noto Serif Display Variable','Noto Serif Display',Georgia,serif";
  const ui = "'Geist Variable',Geist,'Helvetica Neue',Arial,sans-serif";
  const mono = "'Geist Mono Variable','Geist Mono',ui-monospace,Menlo,monospace";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 440" width="2000" height="880">
<title>${esc(`${f.issuer} ${f.owes} ${f.receiver} ${f.amount} ${f.unit}`)}</title>
<defs><clipPath id="wlclip"><rect width="1000" height="440" rx="10"/></clipPath>
<linearGradient id="wlholo" x1="0" y1="0" x2="0.45" y2="1">${stops.join("")}</linearGradient></defs>
<g clip-path="url(#wlclip)">
<rect width="1000" height="440" fill="${paper}"/>
${art}
<text x="64" y="66" font-family="${serif}" font-size="15" font-weight="600" letter-spacing="5.7" fill="${inkA}">BASIS<tspan dx="12" font-family="${mono}" font-size="9.5" letter-spacing="1.3">${esc(f.brandSub)}</tspan></text>
<text x="850" y="66" text-anchor="end" font-family="${mono}" font-size="12.5" letter-spacing="2" fill="${inkA}">№ ${esc(f.serial)}</text>
<text x="64" y="132" font-family="${serif}" font-style="italic" font-size="46" fill="${inkA}">${esc(f.issuer)}<tspan dx="13" dy="-6" font-family="${mono}" font-style="normal" font-size="11.5" letter-spacing="2.3">${esc(f.owes.toUpperCase())}</tspan><tspan dx="13" dy="6">${esc(f.receiver)}</tspan></text>
<text x="64" y="160" font-family="${ui}" font-size="10.5" font-weight="600" letter-spacing="2.1" fill="${inkA}" opacity=".8">${esc(f.caption.toUpperCase())}</text>
<text x="58" y="268" font-family="${serif}" font-size="118" font-weight="520" letter-spacing="-1.4" fill="${paperInk}">${esc(f.amount)}<tspan dx="11" font-family="${mono}" font-size="15" font-weight="600" letter-spacing="2" fill="${inkA}">${esc(f.unit)}</tspan></text>
<line x1="64" y1="366" x2="294" y2="366" stroke="${inkA}" stroke-opacity=".45"/>
<line x1="324" y1="366" x2="554" y2="366" stroke="${inkA}" stroke-opacity=".45"/>
<text x="64" y="384" font-family="${ui}" font-size="9.8" font-weight="600" letter-spacing="1.4" fill="${inkA}">${esc(f.signedLine.toUpperCase())}</text>
<text x="64" y="399" font-family="${mono}" font-size="9.8" fill="${inkA}" opacity=".75">${esc(f.signedSub)}</text>
<text x="324" y="384" font-family="${ui}" font-size="9.8" font-weight="600" letter-spacing="1.4" fill="${inkA}">${esc(f.witnessedLine.toUpperCase())}</text>
<text x="324" y="399" font-family="${mono}" font-size="9.8" fill="${inkA}" opacity=".75">${esc(f.witnessedSub)}</text>
<rect x="898" y="0" width="46" height="440" fill="${foilFill}" opacity=".92"/>
<text transform="translate(924 220) rotate(-90)" text-anchor="middle" font-family="${mono}" font-size="10.2" letter-spacing="2.2" fill="${paperInk}" fill-opacity=".75">${esc(f.foilText)}</text>
<text x="64" y="428" font-family="${mono}" font-size="9" letter-spacing="1" fill="${inkA}" opacity=".7">${esc(f.sandbox)}</text>
</g></svg>`;
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function saveText(text: string, filename: string, type = "application/json"): void {
  saveBlob(new Blob([text], { type }), filename);
}

/** Rasterises an SVG string to PNG (2000 × 880). Fonts fall back to system serif / sans inside the image. */
export function svgToPng(svg: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 2000;
        c.height = 880;
        const g = c.getContext("2d");
        if (!g) return resolve(null);
        g.drawImage(img, 0, 0, 2000, 880);
        c.toBlob((b) => resolve(b), "image/png");
      } catch {
        resolve(null);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
