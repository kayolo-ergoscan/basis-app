// Small shared pieces of the wallet: amounts, seals of town people, the tracker chip, headers.
import { useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { useT } from "@/app/lang";
import { Honest, Icon, Key, KeySeal, Lamp, Popover, Tag, TrackerTile, type LampState } from "@/ui";
import { town, TOWN_TRACKER, useClock, useTown, YOU } from "@/world";
import type { Economy } from "@/protocol";
import { useFmt, useNameOf, useNarrow, useWT } from "../lib/hooks";
import type { TrackerInfo, Unit } from "../lib/model";

/** An amount (privacy aware), with an optional unit and tone. */
export function Amt({ v, u, sign = "auto", unit, tone, className, dp }: { v: bigint; u: Unit; sign?: "favour" | "owe" | "auto" | "none"; unit?: boolean; tone?: "up" | "metal" | "dim" | "alarm"; className?: string; dp?: number }) {
  const f = useFmt();
  const cls = ["num nowrap", tone === "up" ? "up" : tone === "metal" ? "metal-t" : tone === "dim" ? "dim" : tone === "alarm" ? "alarm-t" : "", className].filter(Boolean).join(" ");
  return (
    <span className={cls}>
      {f.amt(v, u, { sign, dp })}
      {unit ? <span className="u-unit">{" " + u.symbol}</span> : null}
    </span>
  );
}

export interface Party {
  id: string;
  name: string;
  pk: string;
  agent: boolean;
  kind: string;
  /** Has an active reserve (any denomination). */
  reserve: boolean;
}

export function partyOf(eco: Economy | null, id: string, nameOf: (id: string) => string): Party | null {
  const p = eco?.participants.get(id);
  if (!eco || !p) return null;
  return { id, name: nameOf(id), pk: p.pub, agent: p.kind === "agent", kind: p.kind, reserve: eco.reservesOf(id).some((r) => r.active) };
}

/** A town participant (live: reserves can open or close). */
export function useParty(id: string | null | undefined): Party | null {
  const nameOf = useNameOf();
  const v = useTown((s) => s.v);
  return useMemo(() => (id ? partyOf(town.economy, id, nameOf) : null), [id, nameOf, v]); // eslint-disable-line react-hooks/exhaustive-deps
}

export function PartySeal({ id, size = "md", badge, rim }: { id: string; size?: "sm" | "md" | "lg" | "xl" | number; badge?: ReactNode; rim?: boolean }) {
  const p = useParty(id);
  if (!p) return <span className="wl-seal-ghost" aria-hidden="true" />;
  return <KeySeal pk={p.pk} agent={p.agent} size={size} rim={rim ?? p.reserve} badge={badge} />;
}

/** "● T-01 · committed 37 blk ago" with the tracker card in a popover (C07). */
export function TrackerChip({ tracker, compact }: { tracker: TrackerInfo; compact?: boolean }) {
  const t = useT();
  const f = useFmt();
  const { height } = useClock();
  const state: LampState = !tracker.online ? "alarm" : tracker.silent ? "stale" : "live";
  const ago = tracker.boxHeight === null ? null : Math.max(0, height - tracker.boxHeight);
  const text = !tracker.online ? t("wallet.trk.offline", { id: tracker.id }) : ago === null ? t("wallet.trk.none", { id: tracker.id }) : t("wallet.trk.ago", { id: tracker.id, n: f.blocks(ago) });
  return (
    <Popover
      trigger={(a) => (
        <button type="button" className={`wl-trk${compact ? " compact" : ""}`} {...a} aria-label={`${text}. ${t("wallet.trk.more")}`}>
          <Lamp state={state} size={9} />
          <span className="mono">{text}</span>
        </button>
      )}
    >
      <div className="wl-trk-pop">
        <div className="who-line">
          <TrackerTile id={tracker.id} stale={tracker.silent || !tracker.online} size="sm" />
          <div>
            <div className="t-h4">{t("wallet.trk.title", { id: tracker.id })}</div>
            <div className="t-small">{t("wallet.trk.cadence", { n: tracker.interval, d: tracker.minDepth })}</div>
          </div>
        </div>
        <dl className="wl-dl">
          <dt>{t("wallet.trk.state")}</dt>
          <dd>{!tracker.online ? t("wallet.trk.st.offline") : tracker.silent ? t("wallet.trk.st.silent") : t("wallet.trk.st.live")}</dd>
          <dt>{t("wallet.trk.box")}</dt>
          <dd className="mono">{tracker.boxHeight === null ? "—" : t("wallet.trk.boxAt", { h: f.height(tracker.boxHeight), age: f.dur(tracker.boxAge) })}</dd>
          <dt>{t("wallet.trk.digest")}</dt>
          <dd className="mono">{tracker.digest ? `${tracker.digest.slice(0, 8)}…${tracker.digest.slice(-4)}` : "—"}</dd>
          <dt>{t("wallet.trk.emergency")}</dt>
          <dd>{tracker.emergencyOpen ? t("wallet.trk.emOpen") : tracker.emergencyOpensAt ? t("wallet.trk.emAt", { h: f.height(tracker.emergencyOpensAt) }) : "—"}</dd>
        </dl>
        <Honest tracker={tracker.id} />
        <Link className="textlink t-small" to="/tracker/practice">{t("wallet.trk.open")}</Link>
      </div>
    </Popover>
  );
}

export function SandboxTag({ small }: { small?: boolean }) {
  const t = useT();
  return (
    <Tag tone="agent" className={small ? "wl-sbx sm" : "wl-sbx"} title={t("world.sandbox.keyLabel")}>
      {t("wallet.sandbox.tag")}
    </Tag>
  );
}

/** Phone sub-page header: back key + title (desktop shows the wallet bar instead). */
export function BackHead({ title, sub, to = "/wallet", right }: { title: ReactNode; sub?: ReactNode; to?: string; right?: ReactNode }) {
  const t = useT();
  const nav = useNavigate();
  return (
    <div className="wl-back">
      <Key size="sm" variant="quiet" icon="left" aria-label={t("wallet.back")} onClick={() => (window.history.length > 1 ? nav(-1) : nav(to))} />
      <div className="wl-back-t">
        <h1 className="t-h3">{title}</h1>
        {sub && <div className="t-small">{sub}</div>}
      </div>
      {right}
    </div>
  );
}

const BAR: Array<[string, string, string]> = [
  ["/wallet", "wallet.bar.home", "wallet"],
  ["/wallet/notes", "wallet.bar.notes", "notes"],
  ["/wallet/reserve", "wallet.bar.reserve", "coin"],
  ["/wallet/policy", "wallet.bar.policy", "lock"],
  ["/wallet/contacts", "wallet.bar.contacts", "you"],
  ["/wallet/settings", "wallet.bar.settings", "settings"],
];

/** The wallet's own navigation: on desktop the sandbox label, block clock and sections; on narrow screens (the site's
 *  tab bar has no wallet sections) a compact row of the same sections that scrolls sideways. */
export function WalletBar() {
  const t = useT();
  const wt = useWT();
  const f = useFmt();
  const narrow = useNarrow();
  const { height, speed } = useClock();
  if (narrow) return <WalletBarM />;
  return (
    <div className="wl-bar">
      <div className="wl-bar-l">
        <SandboxTag />
        <span className="label">
          {TOWN_TRACKER} · {t("wallet.bar.block")} <b>{f.height(height)}</b> · {wt(`world.speed.${speed}`)}
        </span>
      </div>
      <nav className="wl-bar-n" aria-label={t("wallet.bar.aria")}>
        {BAR.map(([to, k, icon]) => (
          <NavLink key={to} to={to} end={to === "/wallet"} className={({ isActive }) => (isActive ? "on" : undefined)}>
            <Icon name={icon} size={15} />
            {t(k)}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

function WalletBarM() {
  const t = useT();
  const ref = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // the current section stays in view in the row (Settings sits past the right edge on a phone)
  useLayoutEffect(() => {
    const nav = ref.current;
    const on = nav?.querySelector<HTMLElement>("a.on");
    if (nav && on) nav.scrollLeft = Math.max(0, on.offsetLeft - nav.offsetLeft - 16);
  }, [pathname]);
  return (
    <nav className="wl-bar-m" aria-label={t("wallet.bar.aria")} ref={ref}>
      {BAR.map(([to, k, icon]) => (
        <NavLink key={to} to={to} end={to === "/wallet"} className={({ isActive }) => (isActive ? "on" : undefined)}>
          <Icon name={icon} size={15} />
          {t(k)}
        </NavLink>
      ))}
    </nav>
  );
}

/** Display name for You in sentences. */
export function useYouName(): string {
  const nameOf = useNameOf();
  return nameOf(YOU);
}

export function StepDots({ n, at, label }: { n: number; at: number; label: string }) {
  return (
    <div className="wl-steps" aria-label={label}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={i < at ? "done" : i === at ? "on" : undefined} />
      ))}
    </div>
  );
}

/** A labelled pair in a definition grid. */
export function Fact({ k, children }: { k: ReactNode; children: ReactNode }) {
  return (
    <div className="wl-fact">
      <span className="label">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

/** A flow's frame: a full page with a back header on phones, a panel with a close key in the right column. */
export function Frame({ page, title, sub, right, children, className, labelId }: { page: boolean; title: ReactNode; sub?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; labelId: string }) {
  const t = useT();
  return (
    <section className={`wl-panel${className ? ` ${className}` : ""}`} aria-labelledby={labelId}>
      {page ? (
        <div className="wl-back">
          <BackKey />
          <div className="wl-back-t">
            <h1 className="t-h3" id={labelId}>
              {title}
            </h1>
            {sub && <div className="t-small">{sub}</div>}
          </div>
          {right}
        </div>
      ) : (
        <div className="wl-panel-h">
          <div>
            <h2 className="t-h4" id={labelId}>
              {title}
            </h2>
            {sub && <div className="t-small">{sub}</div>}
          </div>
          <div className="wl-panel-x">
            {right}
            <Key size="sm" variant="quiet" icon="close" to="/wallet" aria-label={t("wallet.close")} />
          </div>
        </div>
      )}
      {children}
    </section>
  );
}

function BackKey() {
  const t = useT();
  const nav = useNavigate();
  return <Key size="sm" variant="quiet" icon="left" aria-label={t("wallet.back")} onClick={() => (window.history.length > 1 ? nav(-1) : nav("/wallet"))} />;
}
