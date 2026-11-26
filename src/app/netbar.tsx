// The Network place's bar (motion round, 26 Nov 2026): one bar on /network/* and /tracker/*. Only those lazy pages
// import it, so the shell's first chunk does not carry it.
import { useRef, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { Lamp } from "@/ui/components/primitives";
import { useLight } from "@/ui/motion";
import { useT } from "./lang";

/** Network is one place with the tracker console in it: the same sub-nav on /network/* and /tracker/*. */
const NET_TABS = ["overview", "reserves", "trackers", "redemptions", "contracts", "incidents", "ours"] as const;
type NetTab = (typeof NET_TABS)[number];
export type NetCounts = Partial<Record<NetTab, number>>;
const netHref = (id: NetTab) => (id === "overview" ? "/network" : id === "ours" ? "/tracker/mainnet" : `/network/${id}`);
function netOn(pathname: string): NetTab {
  if (pathname.startsWith("/tracker")) return "ours";
  const p = pathname.replace(/^\/network\/?/, "");
  if (p.startsWith("reserve")) return "reserves";
  if (p.startsWith("tracker")) return "trackers";
  if (p.startsWith("redemption") || p.startsWith("tx")) return "redemptions";
  if (p.startsWith("contract")) return "contracts";
  if (p.startsWith("incident")) return "incidents";
  return "overview";
}
/** The sections with a count keep a slot for it from the first frame (filled once the snapshot is here), so no tab
 *  widens and nothing beside it moves when the numbers arrive. */
const COUNTED: readonly NetTab[] = ["reserves", "trackers", "redemptions", "contracts", "incidents"];
export function NetPlaceNav({ counts = {}, className }: { counts?: NetCounts; className?: string }) {
  const t = useT();
  const { pathname } = useLocation();
  const on = netOn(pathname);
  const ref = useRef<HTMLElement>(null);
  // the network pages and the tracker console draw the same bar in the same place: the light moves on between them
  useLight(ref, undefined, "net-place");
  return (
    <nav className={className ? `place-tabs ${className}` : "place-tabs"} aria-label={t("nav.net.aria")} ref={ref}>
      <span className="light" aria-hidden="true" />
      {NET_TABS.map((id) => (
        <Link key={id} to={netHref(id)} className={on === id ? "on" : undefined} aria-current={on === id ? "page" : undefined}>
          {id === "ours" && <Lamp state="live" size={7} />}{t(`nav.net.${id}`)}{COUNTED.includes(id) && <span className="n">{counts[id] ?? ""}</span>}
        </Link>
      ))}
    </nav>
  );
}

/** The Network place's bar, the same on /network/* and /tracker/*: the place tag, the sections, and the page's own live
 *  line at the right (the observatory's, on /network). `sandbox`: the practice tracker's tag (play money). Both tags
 *  share one slot as wide as the wider of the two, so the sections never move between pages. */
export function NetPlaceBar({ counts, live, sandbox = false }: { counts?: NetCounts; live?: ReactNode; sandbox?: boolean }) {
  const t = useT();
  return (
    <div className="nw-bar">
      <div className="nw-bar-l">
        <span className="label nw-bar-tag" data-tag={sandbox ? "sandbox" : "mainnet"}>
          <span className="tg tg-main" aria-hidden={sandbox || undefined}><Lamp state="live" size={7} /><b>{t("nav.net.tag.mainnet")}</b> · {t("nav.net.tag.experimental")}</span>
          <span className="tg tg-play" aria-hidden={!sandbox || undefined}><Lamp state="signed" size={7} /><b>{t("nav.net.tag.sandbox")}</b> · {t("nav.net.tag.play")}</span>
        </span>
        <NetPlaceNav counts={counts} />
      </div>
      {live}
    </div>
  );
}
