// 02 Three doors: Play / Wallet / Network, each with a small live preview — the sandbox town as a debt graph,
// a phone-sized balance of your sandbox wallet, and the mainnet strip. The town boots only when the doors come
// near the screen (it runs the resident bots and its clock).
import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { rich, useLang, useT } from "@/app/lang";
import { currentUse, totalsSource, useDetector, useHeight, useObservatory, useOursInCounts } from "@/chain";
import { copy, pick } from "@/content";
import { Icon, int, Key, KeySeal, Lamp, Section, Tag, units, withUnit } from "@/ui";
import { balanceSheet, castName, FAUCET_ERG, FAUCET_SUSE, graphSnapshot, threeWordsText, useTown, useTownReady, useTownView, useWallet, YOU, type GraphSnapshot } from "@/world";

/** True once the element has come within `margin` of the viewport (stays true). */
function useNear<T extends Element>(margin = "600px"): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    if (typeof IntersectionObserver === "undefined") { setNear(true); return; }
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); } }, { rootMargin: margin });
    io.observe(el);
    return () => io.disconnect();
  }, [near, margin]);
  return [ref, near];
}

/* ---------- Play: the sandbox town as a small 2D debt graph (arrows point at the creditor) ---------- */
function TownGraph() {
  const t = useT();
  const { lang } = useLang();
  const ready = useTownReady();
  const wallet = useWallet();
  const g = useTownView((eco) => graphSnapshot(eco, "erg", { you: YOU }), []);
  if (!ready.ready || !g) return <div className="door-wait"><span className="skel" aria-hidden="true"><i /><i /></span><span>{t("home.d.play.loading")}</span></div>;
  const people = g.nodes.filter((n) => n.kind !== "tracker-operator").length;
  return (
    <GraphSvg g={g} lang={lang} you={wallet.identity?.name ?? null} label={t("home.d.play.aria")}
      caption={t("home.d.play.cap", { people: t.p("home.d.play.people", people), notes: t.p("home.d.play.notes", g.edges.length), n: int(g.height) })} />
  );
}

/** Places the town on two ellipses (businesses inside, people and agents outside), in the angular order of the
 *  town's own stable layout, so a 400 × 210 preview stays readable. */
function layout(g: GraphSnapshot, W: number, H: number) {
  const nodes = g.nodes.filter((n) => n.kind !== "tracker-operator");
  const pos = new Map<string, { x: number; y: number; up: boolean }>();
  const place = (list: typeof nodes, k: number, phase: number) => {
    const sorted = [...list].sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
    sorted.forEach((n, i) => {
      const a = phase + (i / Math.max(1, sorted.length)) * Math.PI * 2;
      const y = H / 2 + Math.sin(a) * (H / 2 - 30) * k;
      pos.set(n.id, { x: W / 2 + Math.cos(a) * (W / 2 - 48) * k, y, up: y < H / 2 - 2 });
    });
  };
  place(nodes.filter((n) => n.kind === "business"), 0.46, Math.PI / 5);
  place(nodes.filter((n) => n.kind !== "business"), 1, -Math.PI / 2);
  return { nodes, pos };
}

const octagon = (x: number, y: number, r: number): string =>
  Array.from({ length: 8 }, (_, i) => { const a = Math.PI / 8 + (i * Math.PI) / 4; return `${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)}`; }).join(" ");

function GraphSvg({ g, lang, you, label, caption }: { g: GraphSnapshot; lang: "en" | "ru"; you: string | null; label: string; caption: string }) {
  const W = 400, H = 210, R = 8;
  const { nodes, pos } = useMemo(() => layout(g, W, H), [g]);
  const edges = g.edges.filter((e) => pos.has(e.from) && pos.has(e.to) && e.from !== e.to && e.claim > 0n);
  const backed = new Set(nodes.filter((n) => n.reserves > 0).map((n) => n.id));
  return (
    <figure className="door-graph">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <marker id="hd-arr" viewBox="0 0 8 8" refX="7.5" refY="4" markerWidth="6" markerHeight="6" markerUnits="userSpaceOnUse" orient="auto"><path d="M0 0.6 L8 4 L0 7.4 z" className="arr" /></marker>
        </defs>
        {edges.map((e) => {
          const a = pos.get(e.from)!, b = pos.get(e.to)!;
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
          const ux = dx / L, uy = dy / L, bend = 0.16;
          const x1 = a.x + ux * (R + 2), y1 = a.y + uy * (R + 2), x2 = b.x - ux * (R + 3), y2 = b.y - uy * (R + 3);
          const mx = (x1 + x2) / 2 - uy * L * bend, my = (y1 + y2) / 2 + ux * L * bend;
          return <path key={e.id} d={`M${x1.toFixed(1)} ${y1.toFixed(1)} Q${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`} className={backed.has(e.from) ? "e backed" : "e"} style={{ strokeWidth: 0.7 + e.weight * 1.6 }} markerEnd="url(#hd-arr)" />;
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id)!;
          const name = n.you ? you ?? castName(YOU, lang) ?? n.name : castName(n.id, lang) ?? n.name;
          return (
            <g key={n.id} className={`n${n.you ? " you" : ""}${backed.has(n.id) ? " rsv" : ""}`}>
              {/* shape grammar (VISUAL §7): people round, AI agents octagons, a reserve adds the metal rim */}
              {n.kind === "agent" ? <polygon points={octagon(p.x, p.y, R + 0.6)} /> : <circle cx={p.x} cy={p.y} r={R} />}
              <text x={p.x} y={p.up ? p.y - R - 6 : p.y + R + 13} textAnchor="middle">{name}</text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mono">{caption}</figcaption>
    </figure>
  );
}

/* ---------- Wallet: a phone-sized balance of You in the town ---------- */
function WalletPhone() {
  const t = useT();
  const ready = useTownReady();
  const wallet = useWallet();
  const joined = useTown((s) => s.joined);
  const sheet = useTownView((eco) => (eco.participants.has(YOU) ? balanceSheet(eco, YOU, "erg") : null), []);
  const id = wallet.status === "ready" ? wallet.identity : null;
  let body: ReactNode;
  if (ready.ready && joined && id && sheet) {
    const net = Number(sheet.net) / 1e9;
    body = (
      <>
        <div className="ph-id"><KeySeal pk={id.pubHex} size={30} /><span><b>{id.name}</b><span className="mono">{threeWordsText(id.pubHex)}</span></span></div>
        <div className="ph-k label">{t("home.d.wallet.net")}</div>
        <div className="ph-net t-money">{net < 0 ? "−" : net > 0 ? "+" : ""}{units(sheet.net < 0n ? -sheet.net : sheet.net, 9)}<span className="u">ERG</span></div>
        <div className="ph-rows">
          <span><span className="label">{t("home.d.wallet.owed")}</span><b className="num up">{units(sheet.assets, 9)}</b></span>
          <span><span className="label">{t("home.d.wallet.owe")}</span><b className="num">{units(sheet.liabilities, 9)}</b></span>
        </div>
        <div className="ph-notes mono">{t.p("home.d.wallet.notes", sheet.notesHeld + sheet.notesIssued)}</div>
      </>
    );
  } else {
    body = (
      <>
        <div className="ph-id"><span className="ph-noseal" aria-hidden="true" /><span><b>{t("home.d.wallet.none")}</b><span className="mono">{t("world.sandbox.playMoney")}</span></span></div>
        <div className="ph-ghost" aria-hidden="true"><em>{t("home.d.wallet.ghost")}</em></div>
        <p className="ph-about">{t("home.d.wallet.join", { erg: withUnit(units(FAUCET_ERG, 9), "ERG"), suse: withUnit(units(FAUCET_SUSE, 3), "sUSE") })}</p>
      </>
    );
  }
  return (
    <div className="door-phone" aria-hidden={!joined || undefined}>
      <div className="ph-screen">
        <div className="ph-top"><span className="mono">{t("world.sandbox")}</span><Lamp state="live" size={7} /></div>
        {body}
      </div>
    </div>
  );
}

/* ---------- Network: the mainnet strip ---------- */
function MainnetStrip() {
  const t = useT();
  const { lang } = useLang();
  const h = useHeight();
  const obs = useObservatory();
  // ErgoScan's tracker (minted after the snapshot) counts once its API has named its box, as in "Trackers by status"
  const ours = useOursInCounts(obs);
  const live = obs ? obs.trackers.filter((x) => x.status === "live").length + (ours?.withBox ?? 0) : null;
  // one block per card: live totals are labelled with the same height as the "Ergo height" cell, the snapshot's totals
  // with the snapshot's block, and while the first live look is on its way there are no totals to label yet
  const tip = h.height ?? obs?.height ?? null;
  const src = obs ? totalsSource(obs) : "checking";
  const snap = obs?.snapshotTotals;
  const cells: [string, ReactNode, string?][] = [
    [t("home.d.net.block"), tip != null ? int(tip) : "—"],
    [t("home.d.net.reserves"), !obs || src === "checking" ? "—" : src === "snapshot" ? int(snap!.unspent) : int(obs.totals.unspent)],
    [t("home.d.net.locked"), !obs || src === "checking" ? "—" : units(src === "snapshot" ? BigInt(snap!.unspentNano) : obs.totals.unspentNano, 9, 3)],
    [t("home.d.net.trackers"), live != null ? int(live) : "—", ours?.withBox ? t("home.n.trackersOurs", { h: int(ours.mint) }) : undefined],
  ];
  const foot = !obs ? null : src === "live" ? pick(copy.asOfBlock(tip ?? obs.height), lang) : src === "snapshot" ? pick(copy.asOfBlock(obs.asOf.height), lang) : t("chain.checking");
  return (
    <div className="door-strip">
      <div className="ds-head"><Lamp state="live" size={8} /><b>MAINNET</b><Tag>{pick(copy.experimental, lang)}</Tag></div>
      <dl>
        {cells.map(([k, v, title]) => <div key={k} title={title}><dt className="label">{k}</dt><dd className="num">{v}</dd></div>)}
      </dl>
      {foot && <p className="ds-foot mono" title={src === "snapshot" ? t("chain.live.seedOnly") : undefined}>{foot}</p>}
    </div>
  );
}

/** The network door's text: what the boxes are, then one sentence that stays true by itself, from the detector's live
 *  list (no request of its own): "all test use" only while every box under the current contracts is ErgoScan's test
 *  reserve, a count once other owners appear, and a dated fact while neither is known. */
function useNetText(): string {
  const t = useT();
  const use = currentUse(useDetector());
  const tail = use === null ? t("home.d.net.first")
    : use.kind === "test" ? t("home.d.net.test")
    : t.p(use.ours ? "home.d.net.othersOurs" : "home.d.net.others", use.n);
  return `${t("home.d.net.p")} ${tail}`;
}

export function Doors() {
  const t = useT();
  const [ref, near] = useNear<HTMLDivElement>();
  const netText = useNetText();
  const doors = [
    { id: "play", k: t("home.d.play.k"), title: t("home.d.play.t"), p: t("home.d.play.p"), go: t("home.d.play.go"), to: "/play", icon: "play" as const, kbd: "P", vis: near ? <TownGraph /> : null },
    { id: "wallet", k: t("home.d.wallet.k"), title: t("home.d.wallet.t"), p: t("home.d.wallet.p"), go: t("home.d.wallet.go"), to: "/wallet", icon: "wallet" as const, kbd: "W", vis: near ? <WalletPhone /> : null },
    { id: "network", k: t("home.d.net.k"), title: t("home.d.net.t"), p: netText, go: t("home.d.net.go"), to: "/network", icon: "network" as const, kbd: "N", vis: <MainnetStrip /> },
  ];
  return (
    <Section id="doors" className="home-doors" no={<>01 · {t("home.d.no")}</>} title={rich(t("home.d.title"))} lede={t("home.d.lede")}>
      <div className="home-door-grid" ref={ref}>
        {doors.map((d) => (
          <article key={d.id} className={`card home-door door-${d.id}`} aria-labelledby={`door-${d.id}`}>
            <div className="door-vis">{d.vis ?? <div className="door-wait"><span className="skel" aria-hidden="true"><i /><i /></span></div>}</div>
            <div className="door-b">
              <span className="label door-k"><Icon name={d.icon} size={14} />{d.k}</span>
              <h3 className="t-h3" id={`door-${d.id}`}>{d.title}</h3>
              <p className="t-small">{d.p}</p>
              <Key to={d.to} kbd={d.kbd} icon="right">{d.go}</Key>
            </div>
          </article>
        ))}
      </div>
    </Section>
  );
}


