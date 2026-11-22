// Small shared pieces of the tracker pages that do not need the town: inline marks, content texts, the sub-nav.
import { Fragment, useCallback, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useT } from "@/app/lang";
import { copy, pick, type Text } from "@/content";
import { humanTime, Tag } from "@/ui";

/** Inline marks for our strings and for content texts: `code`, **bold**, *serif italic*. */
export function md(s: string): ReactNode {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*(.+?)\*\*|\*(.+?)\*/g;
  let last = 0;
  let i = 0;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    if (m.index > last) out.push(s.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={i++} className="trk-code">{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<b key={i++}>{md(m[2])}</b>);
    else out.push(<em key={i++}>{md(m[3])}</em>);
    last = re.lastIndex;
  }
  if (last < s.length) out.push(s.slice(last));
  return out.length === 1 ? out[0] : <Fragment>{out}</Fragment>;
}

/** "≈ 14 min" that never breaks after the ≈. */
export const htime = (blocks: number, lang: "en" | "ru") => humanTime(blocks, lang).replace("≈ ", "≈\u00a0");

/** A content `Text` in the current language, with its inline code split out. */
export function useText() {
  const t = useT();
  return useCallback((x: Text) => md(pick(x, t.lang)), [t.lang]);
}

/** The three tracker pages. The console has two modes (simulation, mainnet); both are "Console". */
export function SubNav() {
  const t = useT();
  const { pathname } = useLocation();
  const p = pathname.replace(/\/+$/, "") || "/";
  const items: [string, string, boolean][] = [
    ["/tracker", "tracker.nav.console", p === "/tracker" || p === "/tracker/mainnet"],
    ["/tracker/run", "tracker.nav.run", p === "/tracker/run"],
    ["/tracker/api", "tracker.nav.api", p === "/tracker/api"],
  ];
  return (
    <nav className="trk-subnav" aria-label={t("tracker.nav.aria")}>
      {items.map(([to, k, on]) => (
        <Link key={to} to={to} className={on ? "on" : undefined} aria-current={on ? "page" : undefined}>
          {t(k)}
        </Link>
      ))}
    </nav>
  );
}

/** The console's switch: the sandbox town's tracker, or ErgoScan's real tracker on mainnet (read-only). */
export function ModeSwitch({ mode }: { mode: "sim" | "main" }) {
  const t = useT();
  const items = [
    { id: "sim", to: "/tracker", label: t("tracker.mode.sim"), sub: t("tracker.mode.simSub"), glyph: "◌" },
    { id: "main", to: "/tracker/mainnet", label: t("tracker.mode.main"), sub: t("tracker.mode.mainSub"), glyph: "◆" },
  ] as const;
  return (
    <nav className="trk-mode" aria-label={t("tracker.mode.aria")}>
      {items.map((x) => (
        <Link key={x.id} to={x.to} className={x.id === mode ? "on" : undefined} aria-current={x.id === mode ? "page" : undefined}>
          <span className="trk-mode-l"><span className="g" aria-hidden="true">{x.glyph}</span>{x.label}</span>
          <span className="trk-mode-s">{x.sub}</span>
        </Link>
      ))}
    </nav>
  );
}

/** Head actions: the sub-nav, and the sandbox label (or the mainnet read-only line). */
export function HeadActions({ sandbox = true, mainnet = false }: { sandbox?: boolean; mainnet?: boolean }) {
  const t = useT();
  return (
    <div className="trk-head-actions">
      <SubNav />
      {sandbox && (
        <span className="trk-sandbox-line">
          <Tag tone="agent" glyph="◌">{pick(copy.sandbox, t.lang)}</Tag>
          <span>{t("tracker.sandboxLine")}</span>
        </span>
      )}
      {mainnet && (
        <span className="trk-sandbox-line">
          <Tag tone="plain" glyph="◆">{t("tracker.mode.main")}</Tag>
          <span>{t("tracker.m.line")}</span>
        </span>
      )}
    </div>
  );
}
