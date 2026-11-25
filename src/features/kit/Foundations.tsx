// Kit sections 01–02: the lights, colour, type, icons, motion tokens; seals, key identity, the mark and the town.
import type { CSSProperties } from "react";
import { rich, useLang, useT } from "@/app/lang";
import {
  AgentTag, BrandMark, Coin, HouseLights, Icon, ICON_NAMES, INKS, KeySeal, Lamp, PairSeal, Section, SealId, Skyline, Table, WindowLoader, demoPair, inksFor, type Column,
} from "@/ui";
import { hex } from "@/ui/engine/bytes";
import { serialOf } from "@/ui/engine/noteArt";
import { MATERIALS, PALETTE } from "./copy";
import { GALLERY, KEY_AB, NAMES, PK, isAgent } from "./data";
import { Cap, Spec } from "./Spec";

const lum = (h: string) => {
  const c = (h.slice(1).match(/../g) || []).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
/** Readable text on a swatch: paper ink or night ink, whichever contrasts more. */
const onSwatch = (h: string) => {
  const L = lum(h), cr = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  return cr(L, lum("#17171A")) >= cr(L, lum("#F2EEE5")) ? "var(--paper-ink)" : "var(--paper-hi)";
};
const SEM_N: Record<string, string> = { paper: "#F6EEDC", metal: "#FFD36B", "metal-ink": "#FFD77E", lamp: "#FCEBC3", up: "#74E0A2", alarm: "#FF8790", "alarm-fill": "#E0445A", "paper-ink": "#17181F" };
const SEM_C: Record<string, string> = { paper: "#FBF5E6", metal: "#EDB83F", "metal-ink": "#7A5600", lamp: "#F4CF77", up: "#11704F", alarm: "#BE2238", "alarm-fill": "#D2283F", "paper-ink": "#17181F" };

function Swatch({ name, value, label }: { name: string; value?: string; label?: string }) {
  const t = useT();
  if (name === "holo" || name === "holo-stale") {
    return <div className="sw" style={{ background: `var(--${name})`, color: "var(--paper-ink)" }}><b>--{name}</b>{name === "holo" ? t("kit.pal.holo") : t("kit.pal.stale")}</div>;
  }
  return <div className="sw" style={{ background: `var(--${name})`, color: value ? onSwatch(value) : "var(--ink)" }}><b>--{name}</b>{label ?? value}</div>;
}

function Palette() {
  const t = useT();
  const row = (theme: "dark" | "light", head: string, sub: string, items: readonly (readonly [string, string])[]) => (
    <div className={`pal-row theme-${theme}`} style={{ "--n": items.length } as CSSProperties}>
      <div className="h"><b>{head}</b>{sub}</div>
      {items.map(([n, h]) => <Swatch key={n} name={n} value={h} />)}
    </div>
  );
  const sem = (map: Record<string, string>) => PALETTE.meaning.map((n) => [n, map[n] ?? n] as const);
  return (
    <div className="pal" role="group" aria-label={t("kit.pal.aria")}>
      {row("dark", t("app.theme.night"), t("kit.pal.surfaces"), PALETTE.night)}
      {row("light", t("app.theme.cotton"), t("kit.pal.surfaces"), PALETTE.cotton)}
      {row("dark", `${t("kit.pal.meaning")} · ${t("app.theme.night")}`, t("kit.pal.meaning.n"), sem(SEM_N))}
      {row("light", `${t("kit.pal.meaning")} · ${t("app.theme.cotton")}`, t("kit.pal.meaning.c"), sem(SEM_C))}
      <div className="pal-row" style={{ "--n": INKS.length } as CSSProperties}>
        <div className="h"><b>{t("kit.pal.inks")}</b>{t("kit.pal.inks.s")}</div>
        {INKS.map((ink) => <div key={ink.name} className="sw" style={{ background: ink.c, color: onSwatch(ink.c) }}><b>{ink.name}</b>{ink.c}</div>)}
      </div>
    </div>
  );
}

function Materials() {
  const t = useT();
  const { lang } = useLang();
  const ink = inksFor(KEY_AB);
  const sw: Record<string, JSX.Element> = {
    Ink: (
      <div style={{ position: "absolute", inset: 0, background: "var(--bg)", display: "grid", alignContent: "center", padding: "0 16px", border: "1px solid var(--rule)" }}>
        <div style={{ font: "700 48px/1 var(--f-display)", letterSpacing: "-.04em" }}>Aa</div>
        <div style={{ font: "600 22px/1.2 var(--f-ui)", fontVariantNumeric: "tabular-nums", letterSpacing: "-.02em", marginTop: 8 }}>1{" ⁠"}240.00 <span style={{ color: "var(--ink-3)", fontWeight: 400, fontSize: 13 }}>ERG</span></div>
      </div>
    ),
    Paper: (
      <>
        <div style={{ position: "absolute", inset: 0, background: "var(--paper)" }} />
        <div style={{ position: "absolute", width: 210, height: 210, right: -60, top: -40 }}><PairSeal pairKey={KEY_AB} size={210} detail={0.6} paper={false} /></div>
        <div style={{ position: "absolute", left: 14, bottom: 12, font: "650 20px/1 var(--f-display)", letterSpacing: "-.03em", color: ink.a.c }}>Alice → Bob</div>
      </>
    ),
    Line: (
      <>
        <div className="hatch" style={{ position: "absolute", inset: 0, color: "var(--ink-3)", background: "repeating-linear-gradient(135deg,currentColor 0 1.2px,transparent 1.2px 5px)" }} />
        <div style={{ position: "absolute", left: 14, right: 14, bottom: 14, padding: "8px 10px", background: "var(--surface)", borderRadius: 8, font: "500 12px/1.3 var(--f-ui)" }}>23{" ⁠"}% <span style={{ color: "var(--ink-3)", fontWeight: 400 }}>{t("kit.mat.line")}</span></div>
      </>
    ),
    Metal: (
      <>
        <div style={{ position: "absolute", inset: 0, background: "var(--foil-metal)", boxShadow: "inset 0 0 40px rgba(255,255,255,.25)" }} />
        <div style={{ position: "absolute", right: -10, top: -6, opacity: 0.95 }}><Coin coverage={132} size={150} label={false} /></div>
        <div style={{ position: "absolute", left: 14, bottom: 12, font: "650 22px/1 var(--f-display)", letterSpacing: "-.04em", color: "var(--paper-ink)" }}>3{" ⁠"}400.00 <span style={{ font: "600 10px var(--f-ui)", letterSpacing: ".08em" }}>ERG</span></div>
      </>
    ),
    Light: (
      <>
        <div style={{ position: "absolute", inset: 0, background: "var(--holo)", backgroundSize: "200% 100%" }} />
        <div style={{ position: "absolute", left: 14, bottom: 12, display: "flex", gap: 8, alignItems: "center", font: "600 12px/1 var(--f-ui)", letterSpacing: ".06em", color: "var(--paper-ink)" }}><Lamp state="committed" style={{ borderColor: "var(--paper-ink)" }} />{t("kit.mat.light")} 9F3C…E1</div>
      </>
    ),
    Window: (
      <div style={{ position: "absolute", inset: 0, background: "var(--bg)", border: "1px solid var(--rule)" }}>
        <Skyline seed={3} height={90} span={420} lit={0.3} className="kit-mat-town" />
        <div style={{ position: "absolute", right: 16, top: 14 }}><HouseLights steps={[true, true, true, false, false]} now={3} size={64} /></div>
      </div>
    ),
  };
  const keys = ["Ink", "Paper", "Line", "Metal", "Light", "Window"];
  return (
    <div className="mats">
      {MATERIALS[lang].map(([name, means, never, tok], i) => (
        <div className="mat" key={name}>
          <div className="swatch" aria-hidden="true">{sw[keys[i]]}</div>
          <h4>{name}</h4>
          <p className="means">{means}</p>
          <p className="never">{never}</p>
          <span className="tok">{tok}</span>
        </div>
      ))}
    </div>
  );
}

function TypeSpec() {
  const t = useT();
  const rows: [string, string, JSX.Element][] = [
    [t("kit.type.display"), "Unbounded 700 · 40–76 / 1.05 · −3.5 ⁠%", <div className="t-hero" style={{ fontSize: "clamp(38px,4.4vw,76px)" }}>{rich(t("kit.type.hero"))}</div>],
    [t("kit.type.heading"), `Unbounded 650 · 30–50 / 1.1 · ${t("kit.type.heading.m")}`, <div className="t-h1">{rich(t("kit.type.h1"))}</div>],
    [t("kit.type.money"), `Unbounded 650 · ${t("kit.type.money.m")}`, <div className="t-money" style={{ fontSize: "clamp(44px,5vw,80px)", lineHeight: 1 }}>1{" ⁠"}240.00<span className="unit">ERG</span> <span style={{ color: "var(--up)" }}>+240.00</span></div>],
    [t("kit.type.body.n"), "Geist 600 · 20 / 1.3 · Geist 400 · 16 / 1.55", <div><div className="t-h3">{t("kit.type.title")}</div><p className="t-body" style={{ maxWidth: "40em", marginTop: 6 }}>{t("kit.type.body")}</p></div>],
    [t("kit.type.measures"), t("kit.type.measures.m"), <div className="kit-measures"><span>+1{" ⁠"}240.00</span><span>{"−"}320.00</span><span>132{" ⁠"}%</span><span>2{" ⁠"}160 <small>blk</small></span><span>0.0004<small> /call</small></span></div>],
    [t("kit.type.mono"), "Geist 600 · 11.5 caps · +7 ⁠% · Geist Mono 400 · 13 / 1.5", <div><div className="label" style={{ color: "var(--ink-2)" }}>{t("kit.type.label")}</div><div className="mono" style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 8, wordBreak: "break-all" }}>digest 9f3c1a2d07be55c0…2d18f0c7e1 · key {hex(KEY_AB).slice(0, 24)}…</div></div>],
    [t("kit.type.cyr"), t("kit.type.cyr.m"), <div><div className="t-h1" style={{ fontSize: "clamp(30px,3.4vw,54px)" }}>Платите словом. <em>Погашайте на Ergo.</em></div><div style={{ font: "400 16px/1.5 var(--f-ui)", color: "var(--ink-2)", marginTop: 8 }}>Alice должна Bob <b className="num" style={{ color: "var(--ink)" }}>1{" ⁠"}240.00</b>{" "}ERG — один подписанный итог, который только растёт.</div></div>],
  ];
  return <div>{rows.map(([n, m, s]) => <div className="spec" key={n}><div><div className="meta"><b>{n}</b>{m}</div></div><div>{s}</div></div>)}</div>;
}

interface MotionRow { token: string; ms: string; use: string }
function MotionTable() {
  const t = useT();
  const rows: MotionRow[] = [
    { token: "--t-press", ms: "90", use: t("kit.motion.press") },
    { token: "--t-fast", ms: "160", use: t("kit.motion.fast") },
    { token: "--t-base", ms: "240", use: t("kit.motion.base") },
    { token: "--t-slow", ms: "420", use: t("kit.motion.slow") },
    { token: "--t-roll", ms: "900", use: t("kit.motion.roll") },
    { token: "--t-pulse", ms: "1 ⁠400", use: t("kit.motion.pulse") },
  ];
  const cols: Column<MotionRow>[] = [
    { key: "token", label: t("kit.motion.token"), lead: true, render: (r) => <span className="mono">{r.token}</span> },
    { key: "ms", label: "ms", align: "right", render: (r) => <span className="num">{r.ms}</span> },
    { key: "use", label: t("kit.motion.use") },
  ];
  return <Table columns={cols} rows={rows} rowKey={(r) => r.token} stack caption={t("kit.motion.caption")} />;
}

export function Foundations() {
  const t = useT();
  return (
    <Section id="tokens" no={`01 · ${t("kit.s.tokens")}`} title={rich(t("kit.s.tokens.t"))} lede={t("kit.s.tokens.l")}>
      <Materials />
      <div className="kit-gap" />
      <div className="comp-label"><h3>{t("kit.pal.h")} <span className="id">{t("kit.pal.id")}</span></h3><span className="label">{t("kit.pal.note")}</span></div>
      <Palette />
      <div className="kit-gap" />
      <div className="comp-label"><h3>{t("kit.type.h")} <span className="id">Unbounded · Geist · Geist Mono</span></h3><span className="label">{t("kit.type.note")}</span></div>
      <TypeSpec />
      <div className="kit-gap" />
      <div className="grid-12" style={{ alignItems: "start" }}>
        <Spec tag={'<Icon name size>'} name={t("kit.icons")} note={`${ICON_NAMES.length} · 1.6 px · 24`} style={{ gridColumn: "span 7" }} code={'<Icon name="pay" size={18} />'}>
          <div className="card"><div className="card-b icon-grid">
            {ICON_NAMES.map((n) => <div key={n}><Icon name={n} size={22} /><span>{n}</span></div>)}
          </div></div>
        </Spec>
        <Spec tag="--t-*" name={t("kit.motion.h")} note={t("kit.motion.note")} style={{ gridColumn: "span 5" }}>
          <div className="card"><div className="card-b"><MotionTable /></div></div>
        </Spec>
      </div>
    </Section>
  );
}

export function Seals() {
  const t = useT();
  const pa = inksFor(KEY_AB);
  return (
    <Section id="seals" no={`02 · ${t("kit.s.seals")}`} title={rich(t("kit.s.seals.t"))} lede={rich(t("kit.s.seals.l"))}>
      <div className="pipe">
        <div><div className="label" style={{ marginBottom: 8 }}>1 · {t("kit.pipe.1")}</div><div className="mono">A {PK.Alice.slice(0, 22)}…<br />B {PK.Bob.slice(0, 22)}…</div></div>
        <div><div className="label" style={{ marginBottom: 8 }}>2 · blake2b256(A‖B)</div><div className="mono">{hex(KEY_AB)}</div></div>
        <div><div className="label" style={{ marginBottom: 8 }}>3 · {t("kit.pipe.3")}</div><div className="mono">ink {pa.a.name} + {pa.b.name} · rope · lathe · lace · crown · trochoid heart · sfc32(seed)</div></div>
        <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
          <PairSeal pairKey={KEY_AB} size={84} />
          <div><div className="label" style={{ marginBottom: 6 }}>4 · {t("kit.pipe.4")}</div><div className="t-small">{t("kit.pipe.serial")} <span className="mono" style={{ color: "var(--ink)" }}>{serialOf(KEY_AB)}</span></div></div>
        </div>
      </div>
      <div className="kit-gap sm" />
      <Spec tag="<PairSeal pairKey size>" name={t("kit.seal.gallery")} note={t("kit.seal.gallery.n")}>
        <div className="seal-grid">
          {GALLERY.map(([a, b], i) => {
            const k = demoPair(a, b), ink = inksFor(k);
            return (
              <div className="seal-card" key={`${a}>${b}`}>
                <PairSeal pairKey={k} size={190} detail={i < 2 ? 1 : 0.6} />
                <b>{a} → {b}</b>
                <span>{ink.a.name} · {ink.b.name} · {hex(k).slice(0, 6)}</span>
                {i === 1 && <span style={{ color: "var(--ink-2)" }}>{t("kit.seal.direction")}</span>}
              </div>
            );
          })}
        </div>
      </Spec>
      <div className="kit-gap sm" />
      <Spec tag="<SealId pk name agent rim>" name={t("kit.seal.keys")} note={t("kit.seal.words")} code={'<SealId pk={pk} name="Alice" rim />  ·  <KeySeal pk={pk} agent size="sm" />'}>
        <div className="card"><div className="card-b key-row">
          {NAMES.map((n) => <SealId key={n} pk={PK[n]} name={n} agent={isAgent(n)} rim={n === "Alice" || n === "Eve"} />)}
        </div></div>
      </Spec>
      <div className="kit-gap sm" />
      <div className="grid-3" style={{ alignItems: "start" }}>
        <Spec tag="<KeySeal size rim>" name={t("kit.seal.sizes")}>
          <div className="kit-row">
            <KeySeal pk={PK.Alice} size="sm" /><KeySeal pk={PK.Alice} size="md" /><KeySeal pk={PK.Alice} size="lg" rim /><KeySeal pk={PK.Alice} size="xl" rim={0.66} />
            <KeySeal pk={PK["render·ai"]} agent size="lg" />
          </div>
          <Cap>sm · md · lg rim · xl rim={"{0.66}"} · agent</Cap>
        </Spec>
        <Spec tag="<KeySeal badge>" name={t("kit.seal.badge")}>
          <div className="kit-row">
            <KeySeal pk={PK.Bob} size="lg" badge={<Lamp state="committed" />} />
            <KeySeal pk={PK.Carol} size="lg" badge={<Lamp state="tracked" />} />
            <KeySeal pk={PK.Dan} size="lg" badge={<Lamp state="signed" />} />
            <span className="who-line"><KeySeal pk={PK["search·ai"]} agent size="md" /><b>search·ai</b><AgentTag small /></span>
          </div>
          <Cap>badge={"{<Lamp state=\"committed\" />}"}</Cap>
        </Spec>
        <Spec tag="<BrandMark size pulse>" name={t("kit.seal.brand")} note={t("kit.seal.brand.n")}>
          <div className="kit-row"><BrandMark size={30} /><BrandMark size={56} /><BrandMark size={96} /></div>
          <Cap>--lamp · {t("kit.seal.brand.c")}</Cap>
        </Spec>
      </div>
      <div className="kit-gap sm" />
      <Spec tag="<Skyline seed tower /> · <HouseLights steps now /> · <WindowLoader />" name={t("kit.town")} note={t("kit.town.n")} code={'<HouseLights steps={[true, true, false]} now={2} label="2 of 3 done" />'}>
        <div className="card"><div className="card-b kit-town">
          <Skyline seed={7} height={110} span={1200} lit={0.24} tower={820} />
          <div className="kit-row"><HouseLights steps={[true, true, true, true, false]} now={4} size={88} label={t("kit.town.house")} /><WindowLoader size={64} /></div>
        </div></div>
      </Spec>
    </Section>
  );
}
