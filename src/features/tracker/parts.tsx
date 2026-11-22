// Small shared pieces of the tracker pages that do not need the town: inline marks, content texts, the sub-nav.
import { Fragment, useCallback, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
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

/** The three tracker pages. */
export function SubNav() {
  const t = useT();
  const items: [string, string][] = [
    ["/tracker", "tracker.nav.console"],
    ["/tracker/run", "tracker.nav.run"],
    ["/tracker/api", "tracker.nav.api"],
  ];
  return (
    <nav className="trk-subnav" aria-label={t("tracker.nav.aria")}>
      {items.map(([to, k]) => (
        <NavLink key={to} to={to} end className={({ isActive }) => (isActive ? "on" : undefined)}>
          {t(k)}
        </NavLink>
      ))}
    </nav>
  );
}

/** Head actions: the sub-nav and the sandbox label. */
export function HeadActions({ sandbox = true }: { sandbox?: boolean }) {
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
    </div>
  );
}
