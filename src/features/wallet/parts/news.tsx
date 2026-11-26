// The town's notices about You, in the page instead of over it: one line at the top of the notes column with the
// newest notice, "+N" to unfold the earlier ones, × to clear them. While no such line is on screen (a section page,
// a flow on a narrow screen), a notice is also a toast; alarms are always toasts, so they cannot be missed.
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "@/app/lang";
import { Icon, toast, type IconName, type ToastKind } from "@/ui";
import { useNotices, type TownNotice } from "@/world";
import { useWT } from "../lib/hooks";

const KEEP = 6;
let items: TownNotice[] = [];
let slots = 0;
const subs = new Set<() => void>();
const emit = () => { for (const f of [...subs]) f(); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const clearAll = () => { items = []; emit(); };

/** Collects the notices (mounted once, by the wallet page). */
export function TownNewsFeed() {
  const wt = useWT();
  const t = useT();
  useNotices((n) => {
    const show = () => {
      const ru = (s: string) => (t.lang === "ru" ? s.replace(/(\d)\.(\d)/g, "$1,$2") : s);
      toast({ kind: n.kind, title: ru(wt(n.titleKey, n.params)), detail: n.detailKey ? ru(wt(n.detailKey, n.params)) : undefined, ttl: n.sticky ? 0 : undefined });
    };
    if (n.kind === "alarm") return show();
    items = [n, ...items.filter((x) => x.id !== n.id)].slice(0, KEEP);
    emit();
    // the home mounts a moment after joining (the welcome arrives during the switch): toast only if no line shows it
    window.setTimeout(() => { if (slots === 0) show(); }, 600);
  });
  return null;
}

const ICON: Record<ToastKind, IconName> = { proof: "stamp", up: "in", metal: "coin", alarm: "warn", info: "info" };

/** The line itself (home columns): nothing while there is no notice. */
export function TownNews() {
  const t = useT();
  const wt = useWT();
  const list = useSyncExternalStore(subscribe, () => items, () => items);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    slots += 1;
    return () => { slots -= 1; };
  }, []);
  if (!list.length) return null;
  const ru = (s: string) => (t.lang === "ru" ? s.replace(/(\d)\.(\d)/g, "$1,$2") : s);
  const shown = open ? list : list.slice(0, 1);
  return (
    <section className="wl-news" aria-label={t("wallet.news.label")} aria-live="polite">
      <ul>
        {shown.map((n) => (
          <li key={n.id} className={`k-${n.kind}`}>
            <Icon name={ICON[n.kind]} size={16} />
            <span className="tx">
              <b>{ru(wt(n.titleKey, n.params))}</b>
              {n.detailKey && <span>{ru(wt(n.detailKey, n.params))}</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="wl-news-a">
        {list.length > 1 && (
          <button type="button" className="textlink t-small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? t("wallet.news.less") : t("wallet.news.more", { n: list.length - 1 })}
          </button>
        )}
        <button type="button" className="wl-news-x" aria-label={t("wallet.news.clear")} title={t("wallet.news.clear")} onClick={() => { setOpen(false); clearAll(); }}>
          <Icon name="close" size={14} />
        </button>
      </div>
    </section>
  );
}
