// Icons (VISUAL §7): 24 grid, 1.6 px stroke, round caps. The first twelve are the tile's set verbatim;
// the tab-bar icons are the tile's phone tab bar; the rest are drawn to the same rules.
import type { CSSProperties, ReactNode } from "react";

const P = (d: string) => <path d={d} />;
const ICONS: Record<string, ReactNode> = {
  pay: P("M7 17 17 7M9 7h8v8"),
  request: P("M17 7 7 17M15 17H7V9"),
  redeem: <>{P("M12 3v11M8 10l4 4 4-4")}{P("M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3")}</>,
  scan: P("M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"),
  stamp: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4.5" />{P("M12 2v2M12 20v2M2 12h2M20 12h2")}</>,
  coin: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="5" strokeDasharray="1.5 1.5" /></>,
  warn: <>{P("M12 4 2.5 20h19z")}{P("M12 10v4M12 17v.5")}</>,
  in: P("M12 4v12M7 11l5 5 5-5M5 20h14"),
  note: <><rect x="2.5" y="6" width="19" height="12" rx="1.5" /><circle cx="15.5" cy="12" r="3" />{P("M5.5 10h4.5M5.5 13.5h3")}</>,
  agent: <>{P("M8.7 3.5h6.6l5.2 5.2v6.6l-5.2 5.2H8.7l-5.2-5.2V8.7z")}<circle cx="12" cy="12" r="2.6" /></>,
  loop: <>{P("M19.5 12a7.5 7.5 0 1 1-2.2-5.3")}{P("M19.5 4.5v4h-4")}</>,
  exit: <>{P("M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4")}{P("M15 8l4 4-4 4M19 12H9")}</>,
  // phone tab bar (tile)
  wallet: P("M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM4 7l11-3v3M16 13h1"),
  notes: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="15" cy="12" r="3" /></>,
  play: P("M8 5v14l11-7z"),
  network: <><circle cx="6" cy="7" r="2.2" /><circle cx="18" cy="7" r="2.2" /><circle cx="12" cy="17" r="2.2" />{P("M8 8l3 7M16 8l-3 7M8.2 7h7.6")}</>,
  you: <><circle cx="12" cy="9" r="3.5" />{P("M5 20c1.2-3.6 4-5 7-5s5.8 1.4 7 5")}</>,
  // same rules
  story: <>{P("M4 5.5h6a2 2 0 0 1 2 2V19a2 2 0 0 0-2-2H4z")}{P("M20 5.5h-6a2 2 0 0 0-2 2V19a2 2 0 0 1 2-2h6z")}</>,
  learn: <>{P("M3 9l9-4.5L21 9l-9 4.5z")}{P("M7 11v4.5c1.4 1.3 3 2 5 2s3.6-.7 5-2V11M21 9v5")}</>,
  tracker: <><circle cx="12" cy="12" r="2.4" />{P("M7.8 16.2a6 6 0 0 1 0-8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 19a10 10 0 0 1 0-14M19 5a10 10 0 0 1 0 14")}</>,
  search: <><circle cx="11" cy="11" r="6.5" />{P("M16 16l4.5 4.5")}</>,
  close: P("M6 6l12 12M18 6 6 18"),
  menu: P("M4 7h16M4 12h16M4 17h16"),
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" />{P("M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5")}</>,
  check: P("M5 12.5l4.5 4.5L19 7.5"),
  plus: P("M12 5v14M5 12h14"),
  minus: P("M5 12h14"),
  sun: <><circle cx="12" cy="12" r="4" />{P("M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4")}</>,
  moon: P("M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"),
  lang: <><circle cx="12" cy="12" r="8.5" />{P("M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5z")}</>,
  ext: P("M9 6h9v9M18 6 6 18"),
  down: P("M6 9.5l6 6 6-6"),
  right: P("M9.5 6l6 6-6 6"),
  left: P("M14.5 6l-6 6 6 6"),
  arrow: P("M4.5 12h15M14 6.5l5.5 5.5-5.5 5.5"),
  table: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />{P("M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10")}</>,
  graph: <><circle cx="6" cy="17" r="2.2" /><circle cx="18" cy="17" r="2.2" /><circle cx="12" cy="6" r="2.2" />{P("M7.3 15.3l3.6-7.1M16.7 15.3l-3.6-7.1M8.3 17h7.4")}</>,
  zoomIn: <><circle cx="11" cy="11" r="6.5" />{P("M16 16l4.5 4.5M8.5 11h5M11 8.5v5")}</>,
  zoomOut: <><circle cx="11" cy="11" r="6.5" />{P("M16 16l4.5 4.5M8.5 11h5")}</>,
  fit: P("M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"),
  keyboard: <><rect x="2.5" y="6" width="19" height="12" rx="2" />{P("M6 10h.5M9.5 10h.5M13 10h.5M16.5 10h1M6 14h1.5M10 14h4M17 14h1")}</>,
  settings: <><circle cx="12" cy="12" r="3" />{P("M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6")}</>,
  eye: <>{P("M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z")}<circle cx="12" cy="12" r="3" /></>,
  eyeOff: <>{P("M4 4l16 16M10 6c.6-.2 1.3-.5 2-.5 6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-2.6 3.4M6.3 7.7A16 16 0 0 0 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1.1")}{P("M9.9 9.9a3 3 0 0 0 4.2 4.2")}</>,
  kit: <><rect x="4" y="4" width="7" height="7" rx="1.5" /><rect x="13" y="4" width="7" height="7" rx="1.5" /><rect x="4" y="13" width="7" height="7" rx="1.5" /><circle cx="16.5" cy="16.5" r="3.5" /></>,
  info: <><circle cx="12" cy="12" r="8.5" />{P("M12 11v5.5M12 7.8v.4")}</>,
  home: P("M4 11 12 4l8 7M6.5 9.5V20h11V9.5"),
  clock: <><circle cx="12" cy="12" r="8.5" />{P("M12 7.5V12l3 2")}</>,
  lock: <><rect x="5" y="10.5" width="14" height="9.5" rx="2" />{P("M8 10.5V8a4 4 0 0 1 8 0v2.5")}</>,
  github: P("M9 19c-4 1.3-4-2-6-2.5M15 21v-3.3c0-1 .1-1.4-.5-2 2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.6 3 5.6 3.3 5.6 3.3a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4.2 9.7c0 4.6 2.8 5.7 5.5 6-.6.6-.6 1.2-.5 2V21"),
  chat: P("M4.5 18.5V6.5a2 2 0 0 1 2-2h11a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8.5z"),
  sound: <>{P("M4 9.5h3.5L12 5.5v13l-4.5-4H4z")}{P("M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11")}</>,
  motion: P("M3.5 12c2-4 4-4 6 0s4 4 6 0 3-3.5 5-2"),
};

export type IconName = keyof typeof ICONS | string;
export const ICON_NAMES = Object.keys(ICONS);

export interface IconProps {
  name: IconName;
  /** CSS px, default 18 (keys) — tab bar uses 24. */
  size?: number;
  className?: string;
  style?: CSSProperties;
  /** Accessible name; without it the icon is decorative (aria-hidden). */
  title?: string;
}

/** <Icon name="pay" /> — stroke icon in currentColor. */
export function Icon({ name, size = 18, className, style, title }: IconProps) {
  const body = ICONS[name] ?? ICONS.info;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      aria-label={title}
      focusable="false"
    >
      {body}
    </svg>
  );
}
