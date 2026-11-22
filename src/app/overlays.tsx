// ⌘K command bar (VISUAL §12.9), global shortcuts (P W N L ? T M, ⌘K) and the shortcuts / display settings sheet.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/ui/components/Icon";
import { Switch } from "@/ui/components/primitives";
import { Sheet } from "@/ui/components/Sheet";
import { toggleLens } from "@/ui/components/FaceTabs";
import { isTyping, useEscape } from "@/ui/hooks";
import { short } from "@/ui/engine/money";
import { setUiSettings, useUiSettings } from "@/ui/settings";
import { iconOf, MOD } from "./chrome";
import { faqCommands, openCommandBar, score, setCommandOpener, setHelpOpener, useDynamicCommands, type Command, type FaqQuestion } from "./commands";
import { getLang, setLang, useT } from "./lang";
import { hrefOf, NAV, ROUTES } from "./routes";
import { toggleTheme } from "./theme";

const HEX64 = /^[0-9a-fA-F]{64}$/;
interface GlossaryTerm { id: string; en: string; ru: string; also: string }


export function Palette() {
  const t = useT();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLElement | null>(null);
  const dyn = useDynamicCommands();
  useEffect(() => {
    setCommandOpener((query) => { back.current = document.activeElement as HTMLElement | null; setQ(query ?? ""); setI(0); setOpen(true); });
    return () => setCommandOpener(null);
  }, []);
  const close = () => { setOpen(false); requestAnimationFrame(() => back.current?.focus?.()); };
  // glossary terms (→ /learn/glossary#t-<id>), loaded on first open so the shell entry stays small
  const [terms, setTerms] = useState<GlossaryTerm[] | null>(null);
  useEffect(() => {
    if (!open || terms) return;
    import("@/content/glossary").then((m) => setTerms(m.glossary.map((x) => ({ id: x.id, en: x.en, ru: x.ru, also: [...(x.alsoEN ?? []), ...(x.alsoRU ?? [])].join(" ") })))).catch(() => setTerms([]));
  }, [open, terms]);
  // FAQ questions (→ /learn/faq#q-<id>), loaded the same way
  const [faqs, setFaqs] = useState<FaqQuestion[] | null>(null);
  useEffect(() => {
    if (!open || faqs) return;
    import("@/content/faq").then((m) => setFaqs(m.faq.map((f) => ({ id: f.id, q: f.q, short: f.short })))).catch(() => setFaqs([]));
  }, [open, faqs]);
  useEscape(open, close);
  useEffect(() => { if (open) requestAnimationFrame(() => input.current?.focus()); }, [open]);

  const all = useMemo<Command[]>(() => {
    const go: Command[] = NAV.map((r) => ({ id: "go." + r.id, label: t(r.nav!.labelKey), sub: hrefOf(r), to: hrefOf(r), group: "go", icon: iconOf(r.id, r.nav?.icon), keywords: r.id }));
    const feat: Command[] = ROUTES.flatMap((r) => (r.commands ?? []).map((c) => ({
      id: c.id, label: t(c.labelKey), sub: c.to, to: c.to, keywords: c.keywords, group: c.to.startsWith("/kit") ? ("dev" as const) : ("actions" as const), icon: iconOf(r.id, r.nav?.icon),
    })));
    const settings: Command[] = [
      { id: "set.theme", label: t("app.cmd.theme"), group: "settings", icon: "moon", run: toggleTheme, kbd: "T", keywords: "night cotton dark light тема тёмная светлая" },
      { id: "set.lang", label: t("app.cmd.lang"), group: "settings", icon: "lang", run: () => setLang(getLang() === "en" ? "ru" : "en"), keywords: "english russian язык" },
      { id: "set.lens", label: t("app.cmd.lens"), group: "settings", icon: "eye", run: toggleLens, kbd: "M", keywords: "machine bytes human story faces" },
      { id: "set.help", label: t("app.cmd.help"), group: "settings", icon: "keyboard", run: () => { setTimeout(() => helpRef.open?.(), 30); }, kbd: "?", keywords: "keys shortcuts motion confirm privacy" },
    ];
    const dev: Command[] = feat.some((c) => c.to === "/kit") ? [] : [{ id: "dev.kit", label: t("app.cmd.kit"), sub: "/kit", to: "/kit", group: "dev", icon: "kit", keywords: "components design" }];
    // pages outside the nav with no commands of their own (the X-ray lab) are still reachable from the bar
    for (const r of ROUTES) {
      if (r.nav || r.commands?.length || !r.titleKey) continue;
      const to = hrefOf(r);
      if (!feat.some((c) => c.to === to)) dev.push({ id: "dev." + r.id, label: t(r.titleKey), sub: to, to, group: "dev", icon: "eye", keywords: r.id });
    }
    const lang = getLang();
    const words: Command[] = (terms ?? []).map((x) => ({ id: "term." + x.id, label: lang === "ru" ? x.ru : x.en, sub: `/learn/glossary#t-${x.id}`, to: `/learn/glossary#t-${x.id}`, group: "terms", icon: "learn", keywords: `${x.en} ${x.ru} ${x.also}` }));
    return [...go, ...feat, ...dyn.map((c) => ({ group: "actions" as const, ...c })), ...settings, ...dev, ...faqCommands(faqs ?? [], lang), ...words];
  }, [t, dyn, terms, faqs]);

  const query = q.trim();
  const ids: Command[] = HEX64.test(query)
    ? [
        { id: "id.tx", label: `${t("app.cmd.tx")} ${short(query, 8, 6)}`, sub: `/network/tx/${query.toLowerCase()}`, to: `/network/tx/${query.toLowerCase()}`, group: "id", icon: "loop" },
        { id: "id.box", label: `${t("app.cmd.reserve")} ${short(query, 8, 6)}`, sub: `/network/reserve/${query.toLowerCase()}`, to: `/network/reserve/${query.toLowerCase()}`, group: "id", icon: "coin" },
        { id: "id.nft", label: `${t("app.cmd.tracker")} ${short(query, 8, 6)}`, sub: `/network/tracker/${query.toLowerCase()}`, to: `/network/tracker/${query.toLowerCase()}`, group: "id", icon: "tracker" },
      ]
    : [];
  // questions and terms only answer a query (an empty bar lists pages and commands)
  const hits = ids.length ? ids : all.filter((c) => query || (c.group !== "terms" && c.group !== "faq")).map((c) => [c, score(c, query)] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const order = ["id", "go", "actions", "faq", "terms", "settings", "dev"] as const;
  const groups = order.map((g) => [g, hits.filter((c) => (c.group ?? "actions") === g)] as const).filter(([, l]) => l.length);
  const flat = groups.flatMap(([, l]) => l);
  const cur = Math.min(i, Math.max(0, flat.length - 1));
  useEffect(() => { list.current?.querySelector(".it.on")?.scrollIntoView({ block: "nearest" }); }, [cur, open]);

  const run = (c: Command) => {
    close();
    if (c.to) nav(c.to);
    else c.run?.();
  };

  if (!open) return null;
  return (
    <div className="cmdk-wrap" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="cmdk" role="dialog" aria-modal="true" aria-label={t("app.cmd.aria")}>
        <div className="q">
          <span className="mono cmdk-mod" style={{ color: "var(--ink-3)", flex: "none" }}>{MOD} K</span>
          <input
            ref={input}
            value={q}
            onChange={(e) => { setQ(e.target.value); setI(0); }}
            placeholder={t("app.cmd.placeholder")}
            aria-label={t("app.cmd.placeholder")}
            role="combobox"
            aria-expanded="true"
            aria-controls="cmdk-list"
            aria-activedescendant={flat[cur] ? `cmdk-${flat[cur].id}` : undefined}
            spellCheck={false}
            autoComplete="off"
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(flat.length - 1, x + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); if (flat[cur]) run(flat[cur]); }
              else if (e.key === "Tab") e.preventDefault();
            }}
          />
        </div>
        <div className="list" id="cmdk-list" role="listbox" ref={list} aria-label={t("app.cmd.aria")}>
          {flat.length === 0 && <div className="empty-q">{t("app.cmd.empty")}</div>}
          {groups.map(([g, l]) => (
            <div key={g} role="group" aria-label={t(`app.cmd.group.${g}`)}>
              <div className="grp label">{t(`app.cmd.group.${g}`)}</div>
              {l.map((c) => {
                const k = flat.indexOf(c);
                return (
                  <button key={c.id} id={`cmdk-${c.id}`} type="button" role="option" aria-selected={k === cur} className={`it${k === cur ? " on" : ""}`}
                    onMouseMove={() => setI(k)} onClick={() => run(c)} tabIndex={-1}>
                    <Icon name={c.icon ?? "arrow"} />
                    <span style={{ minWidth: 0 }}>{c.label}{c.sub && <span className="sub">{c.sub}</span>}</span>
                    {c.kbd ? <kbd>{c.kbd}</kbd> : <span />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="foot"><span>{t("app.cmd.foot.move")}</span><span>{t("app.cmd.foot.open")}</span><span>{t("app.cmd.foot.close")}</span></div>
      </div>
    </div>
  );
}

const helpRef: { open?: () => void } = {};

/** Keyboard shortcuts plus the display and access settings (reduced motion, confirm with a second press, hide amounts). */
export function HelpSheet() {
  const t = useT();
  const ui = useUiSettings();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    helpRef.open = () => setOpen(true);
    setHelpOpener(() => setOpen(true));
    return () => { helpRef.open = undefined; setHelpOpener(null); };
  }, []);
  const rows: [string[], string][] = [
    [[MOD, "K"], "app.keys.cmdk"], [["P"], "app.keys.p"], [["W"], "app.keys.w"], [["N"], "app.keys.n"], [["L"], "app.keys.l"], [["T"], "app.keys.t"], [["M"], "app.keys.m"], [["?"], "app.keys.help"],
  ];
  return (
    <Sheet open={open} onClose={() => setOpen(false)} title={t("app.keys.title")} width={440}>
      <div className="keys-list">
        {rows.map(([k, l]) => <FragmentRow key={l} keys={k} label={t(l)} />)}
      </div>
      <p className="t-small" style={{ marginTop: 14 }}>{t("app.keys.note")}</p>
      <div className="label" style={{ marginTop: 28, marginBottom: 12 }}>{t("app.prefs.title")}</div>
      <div className="prefs">
        <Switch checked={ui.motion === "reduce"} onChange={(v) => setUiSettings({ motion: v ? "reduce" : "system" })} label={t("app.prefs.motion")} help={t("app.prefs.motion.help")} />
        <Switch checked={ui.confirmPress} onChange={(v) => setUiSettings({ confirmPress: v })} label={t("app.prefs.confirm")} help={t("app.prefs.confirm.help")} />
        <Switch checked={ui.privacy} onChange={(v) => setUiSettings({ privacy: v })} label={t("app.prefs.privacy")} help={t("app.prefs.privacy.help")} />
      </div>
    </Sheet>
  );
}
function FragmentRow({ keys, label }: { keys: string[]; label: string }) {
  return <><span className="k">{keys.map((k) => <kbd key={k}>{k}</kbd>)}</span><span>{label}</span></>;
}

/** Global keys. Single letters are ignored while typing or with a modifier, when a page already handled the key
 *  (defaultPrevented, also by listeners added later on window), and when the key would only reopen the section the
 *  reader is already in (P inside /play/<scenario> stays with the run). ⌘K / Ctrl+K always opens the bar. */
export function Shortcuts() {
  const nav = useNavigate();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        openCommandBar();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented || isTyping(e)) return;
      const k = e.key;
      if (!/^[pwnltmPWNLTM?]$/.test(k)) return;
      // decide after the whole dispatch, so a page handler on window (bubble phase) can still claim the key
      setTimeout(() => {
        if (e.defaultPrevented) return;
        if (document.querySelector(".cmdk-wrap, [aria-modal='true']")) return;
        const here = location.pathname;
        const go = (p: string) => { if (here === p || here.startsWith(p + "/")) return; nav(p); };
        const l = k.toLowerCase();
        if (l === "p") go("/play");
        else if (l === "w") go("/wallet");
        else if (l === "n") go("/network");
        else if (l === "l") go("/learn");
        else if (l === "t") toggleTheme();
        else if (l === "m") toggleLens();
        else if (k === "?") helpRef.open?.();
      }, 0);
    };
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, [nav]);
  return null;
}
