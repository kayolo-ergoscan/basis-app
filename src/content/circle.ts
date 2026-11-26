// The developer circle (/learn/circle): people and projects that accept Basis notes for their work. A list kept by this
// site in circle.json; people join by a pull request to the app's repository. No database, no tracker call: the page
// renders the file as it was built.
//
// An entry (circle.json is an array of these):
//   name     how to sign the receiver: one line, at most 24 characters (it rides in the request link as `name`)
//   project  the project's name: one line, at most 40 characters (the request link's `memo`)
//   url      the project: https, a repository or a site
//   about    what they do: one line, at most 100 characters, in their own words and language
//   key      the receiver's public key: 33 bytes compressed, lowercase hex (02… or 03…)
//   denoms   optional: what they accept, of "erg", "sigusd", "rsada" (default ["erg"]); the first is the button's
//   readme   optional: the public README or page that carries a Basis button with the same key (default: url)
//   checked  set at review, not by the author: the day the key was compared with the button at readme (YYYY-MM-DD)
//
// The site never fetches a README (the page's CSP allows only its own origin): "the key matches the button" is the
// reviewer's word on the `checked` day. circle.test.ts runs readCircle on the file and refuses any problem, so a bad
// entry fails the tests; the page also drops an entry that does not read, rather than show it.
import { OUR_TRACKER } from "@/chain/ours/types";
import { REPOS } from "./repos";
import raw from "./circle.json";

export type CircleDenom = "erg" | "sigusd" | "rsada";

export interface CircleEntry {
  name: string;
  project: string;
  url: string;
  about: string;
  key: string;
  /** At least one; the first is what the main button asks for. */
  denoms: CircleDenom[];
  /** Where the button with this key is (url when the entry names none). */
  readme: string;
  /** YYYY-MM-DD. */
  checked: string;
}

/** Caps, in characters (code points). NAME_MAX is the request link's own cap for a name (wallet reqlink.ts). */
export const CIRCLE_LIMITS = { name: 24, project: 40, about: 100, url: 200 } as const;
export const CIRCLE_DENOMS: readonly CircleDenom[] = ["erg", "sigusd", "rsada"];
export const CIRCLE_DENOM_LABEL: Record<CircleDenom, string> = { erg: "ERG", sigusd: "SigUSD", rsada: "rsADA" };
/** The list starts on this day: no entry was checked before it. */
export const CIRCLE_SINCE = "2026-11-26";

/** Where the list lives on GitHub (the published branch is `main`), and the editor that opens a pull request. */
export const CIRCLE_FILE = "src/content/circle.json";
export const CIRCLE_GITHUB = {
  file: `${REPOS.app.url}/blob/main/${CIRCLE_FILE}`,
  edit: `${REPOS.app.url}/edit/main/${CIRCLE_FILE}`,
} as const;

const FIELDS = new Set(["name", "project", "url", "about", "key", "denoms", "readme", "checked"]);
const PK = /^0[23][0-9a-f]{64}$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const chars = (s: string) => Array.from(s).length;

/** One line of plain text as typed: NFC, no control, format or line characters, no doubled or edge spaces. */
function oneLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return "must be text";
  if (!v.trim()) return "is empty";
  if (v !== v.normalize("NFC")) return "must be NFC text";
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(v)) return "must be one line of plain text (no control, format or line characters)";
  if (v !== v.trim() || /\s{2}/u.test(v) || /[^\S ]/u.test(v)) return "must have single plain spaces and none at the ends";
  if (chars(v) > max) return `is longer than ${max} characters`;
  return null;
}

/** An https link to a named host: no user, no port, no IP address, no spaces. */
function httpsLink(v: unknown): string | null {
  if (typeof v !== "string") return "must be text";
  if (chars(v) > CIRCLE_LIMITS.url) return `is longer than ${CIRCLE_LIMITS.url} characters`;
  if (!v.startsWith("https://") || /\s/u.test(v)) return "must be an https:// link without spaces";
  let u: URL;
  try { u = new URL(v); } catch { return "is not a link"; }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return "must be a plain https link (no user, password or port)";
  const host = u.hostname.toLowerCase();
  if (!host.includes(".") || host.startsWith("[") || /^[\d.]+$/.test(host)) return "must name a host, not an IP address";
  return null;
}

/** The same place, however it is written: host and path, lowercase, without a trailing slash. */
const placeOf = (link: string) => {
  const u = new URL(link);
  return `${u.hostname.toLowerCase()}${u.pathname.replace(/\/+$/, "").toLowerCase()}`;
};

function realDay(v: unknown, today: string | null): string | null {
  if (typeof v !== "string") return "must be set at review (YYYY-MM-DD)";
  const m = DAY.exec(v);
  if (!m) return "must be a date, YYYY-MM-DD";
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.toISOString().slice(0, 10) !== v) return "is not a real date";
  if (v < CIRCLE_SINCE) return `is before the list began (${CIRCLE_SINCE})`;
  if (today && v > today) return "is in the future";
  return null;
}

/**
 * Reads the list: the entries that are right, and a line for each problem («entry 2 (Лена): key: …»). An entry with a
 * problem is left out; so is a second entry with the same key or the same project link. `today` (YYYY-MM-DD) also
 * refuses a check date after it (the tests pass it; the page does not, a visitor's clock proves nothing).
 */
export function readCircle(list: unknown, opts: { today?: string } = {}): { entries: CircleEntry[]; problems: string[] } {
  const entries: CircleEntry[] = [];
  const problems: string[] = [];
  if (!Array.isArray(list)) return { entries, problems: ["the file must hold a JSON array of entries"] };
  const keys = new Map<string, number>();
  const places = new Map<string, number>();
  list.forEach((item, i) => {
    const n = i + 1;
    const o = (typeof item === "object" && item !== null && !Array.isArray(item) ? item : null) as Record<string, unknown> | null;
    const at = `entry ${n}${o && typeof o.name === "string" ? ` (${o.name})` : ""}`;
    if (!o) { problems.push(`${at}: must be an object`); return; }
    const bad: string[] = [];
    const say = (field: string, why: string | null) => { if (why) bad.push(`${field}: ${why}`); };
    for (const k of Object.keys(o)) if (!FIELDS.has(k)) bad.push(`${k}: is not a field (name, project, url, about, key, denoms, readme, checked)`);
    say("name", oneLine(o.name, CIRCLE_LIMITS.name));
    say("project", oneLine(o.project, CIRCLE_LIMITS.project));
    say("about", oneLine(o.about, CIRCLE_LIMITS.about));
    say("url", httpsLink(o.url));
    if (o.readme !== undefined) say("readme", httpsLink(o.readme));
    say("key", typeof o.key === "string" && PK.test(o.key) ? null : "must be a public key: 66 lowercase hex characters starting 02 or 03");
    if (o.key === OUR_TRACKER.key) say("key", "is the tracker's own key");
    let denoms: CircleDenom[] = ["erg"];
    if (o.denoms !== undefined) {
      const d = o.denoms;
      if (!Array.isArray(d) || d.length === 0 || !d.every((x) => CIRCLE_DENOMS.includes(x as CircleDenom))) say("denoms", `must list some of ${CIRCLE_DENOMS.join(", ")}`);
      else if (new Set(d).size !== d.length) say("denoms", "lists one twice");
      else denoms = d as CircleDenom[];
    }
    say("checked", realDay(o.checked, opts.today ?? null));
    if (!bad.length) {
      const key = o.key as string;
      const place = placeOf(o.url as string);
      if (keys.has(key)) bad.push(`key: already in entry ${keys.get(key)}`);
      if (places.has(place)) bad.push(`url: already in entry ${places.get(place)}`);
    }
    if (bad.length) { for (const b of bad) problems.push(`${at}: ${b}`); return; }
    keys.set(o.key as string, n);
    places.set(placeOf(o.url as string), n);
    entries.push({
      name: o.name as string,
      project: o.project as string,
      url: o.url as string,
      about: o.about as string,
      key: o.key as string,
      denoms,
      readme: (o.readme as string | undefined) ?? (o.url as string),
      checked: o.checked as string,
    });
  });
  return { entries, problems };
}

/** The list as the page shows it. */
export const CIRCLE: readonly CircleEntry[] = readCircle(raw).entries;

/**
 * The entry's payment request link, in the wallet's own format (the README button's link): /wallet/mainnet/pay#to=<key>
 * &nft=<our tracker>[&d=sigusd|rsada]&name=<name>&memo=<project>, no amount (the payer chooses). Everything is after #,
 * so no server sees it. `origin` "" gives the in-site path. circle.test.ts checks it against the wallet's builder.
 */
export function circleLink(origin: string, e: Pick<CircleEntry, "key" | "name" | "project">, denom: CircleDenom = "erg"): string {
  const p = new URLSearchParams({ to: e.key });
  p.set("nft", OUR_TRACKER.nft);
  if (denom !== "erg") p.set("d", denom);
  p.set("name", e.name);
  p.set("memo", e.project);
  return `${origin}/wallet/mainnet/pay#${p.toString()}`;
}
