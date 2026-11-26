// The notes list (VISUAL §13 /wallet): seal with a lamp badge, name, the direction in words, the mini-cap of the
// credit line, the amount and today's change. Tabs All / Owed to you / You owe / Agents.
import { Fragment, useRef, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useT } from "@/app/lang";
import { AgentTag, Empty, Lamp, MiniCap, Tabs, useHoldHeight } from "@/ui";
import { useFmt, useNameOf, usePrefs, setPrefs, useTg } from "../lib/hooks";
import { filterRows, GENDER, POSSESSIVE_EN, rowAmount, sortRows, type Row, type TabId } from "../lib/model";
import { Amt, PartySeal } from "./bits";

const SANDBOX_DAY = 24 * 3600 * 1000;

/** The direction sentence of a row: "owes you · backed · 132 %", "you owe · her line for you 2.00 · 80 %". */
export function useRowSentence() {
  const t = useT();
  const f = useFmt();
  const tg = useTg();
  // the figure of a row (coverage, share of a line) is set in ink weight, as in the reference render
  return (r: Row): ReactNode => {
    const g = GENDER[r.other];
    const parts: (string | { n: string })[] = [];
    if (r.dir === "self") return t("wallet.row.self");
    if (r.dir === "in") {
      parts.push(tg("wallet.row.owesYou", g));
      if (r.line) parts.push(t(r.line.kind === "credit" ? "wallet.row.yourLine" : "wallet.row.yourCap", { v: f.amt(r.line.limit, r.unit) }), { n: f.pct(r.line.used) });
      else if (r.backed) parts.push(t("wallet.row.backed"), { n: f.pct(r.coverage) });
      else parts.push(t("wallet.row.trust"));
    } else {
      parts.push(t("wallet.row.youOwe"));
      const poss = t.lang === "ru" ? tg("wallet.row.poss", g) : POSSESSIVE_EN[r.other] ?? t("wallet.row.poss");
      if (r.line) parts.push(t(r.line.kind === "credit" ? "wallet.row.theirLine" : "wallet.row.theirCap", { poss, v: f.amt(r.line.limit, r.unit) }), { n: f.pct(r.line.used) });
      else if (r.yourCoverage !== null) parts.push(t("wallet.row.yourReserve"), { n: f.pct(r.yourCoverage) });
      else parts.push(t("wallet.row.trust"));
    }
    if (r.omitted) parts.push(t("wallet.row.omitted"));
    return parts.map((p, i) => (
      <Fragment key={i}>
        {i > 0 && " · "}
        {typeof p === "string" ? f.prose(p) : <b className="wl-what-n">{p.n}</b>}
      </Fragment>
    ));
  };
}

/** "+240.00 today" in your favour, else the time of the last change on the sandbox clock. */
export function useRowSub(nowMs: number) {
  const t = useT();
  const f = useFmt();
  return (r: Row): { text: string; up: boolean } => {
    if (r.dir === "in" && r.today > 0n) return { text: t("wallet.row.today", { v: f.amt(r.today, r.unit, { sign: "favour" }) }), up: true };
    const ts = Number(r.lastTs);
    const age = nowMs - ts;
    const loc = t.lang === "ru" ? "ru-RU" : "en-GB";
    if (age < SANDBOX_DAY) return { text: new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(ts), up: false };
    if (age < 6 * SANDBOX_DAY) return { text: new Intl.DateTimeFormat(loc, { weekday: "short", timeZone: "UTC" }).format(ts), up: false };
    return { text: t("wallet.row.daysAgo", { n: Math.round(age / SANDBOX_DAY) }), up: false };
  };
}

export function NoteRow({ r, to, nowMs, selected }: { r: Row; to: string; nowMs: number; selected?: boolean }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const sentence = useRowSentence();
  const sub = useRowSub(nowMs);
  const s = sub(r);
  const amount = rowAmount(r);
  const name = nameOf(r.other);
  const line = r.line;
  const bar = line ? { used: line.used, kind: line.used >= 0.8 ? ("near" as const) : r.dir === "in" && r.backed ? ("settled" as const) : ("out" as const) } : r.dir === "in" && r.backed && r.coverage !== null ? { used: Math.min(1, r.coverage), kind: "settled" as const } : null;
  const label = t(r.dir === "in" ? "wallet.row.aria.in" : "wallet.row.aria.out", { name, v: f.amt(amount, r.unit, { unit: true }), state: t(`wallet.lamp.${r.lamp}`) });
  return (
    <NavLink to={to} className={({ isActive }) => `row wl-row${isActive || selected ? " on" : ""}`} aria-label={label} aria-current={selected ? "true" : undefined}>
      <PartySeal id={r.other} badge={<Lamp state={r.lamp} size={9} />} />
      <span className="wl-row-mid">
        <span className="who">
          {name}
          {r.agent && <AgentTag small />}
        </span>
        <span className="what">{sentence(r)}</span>
        {bar ? <MiniCap used={bar.used} kind={bar.kind} width={150} /> : <span className="wl-nocap" aria-hidden="true" />}
      </span>
      <span className={`amt${r.dir === "in" ? " in" : ""}`}>
        <Amt v={amount} u={r.unit} sign={r.dir === "in" ? "favour" : "owe"} />
        {r.unit.id !== "erg" && <span className="wl-unit">{r.unit.symbol}</span>}
        <small className={s.up ? "up" : undefined}>{s.text}</small>
      </span>
    </NavLink>
  );
}

export interface NotesPanelProps {
  rows: Row[];
  nowMs: number;
  /** Where a row links to. */
  hrefOf: (r: Row) => string;
  tabs?: boolean;
  limit?: number;
  tab: TabId;
  onTab: (t: TabId) => void;
  more?: string;
  title?: boolean;
  /** The note open in the right column (desktop). */
  selected?: string | null;
}

export function NotesPanel({ rows, nowMs, hrefOf, tabs = true, limit, tab, onTab, more, title = true, selected }: NotesPanelProps) {
  const t = useT();
  const p = usePrefs();
  const list = sortRows(filterRows(rows, tab), p.sort);
  const shown = limit ? list.slice(0, limit) : list;
  const count = (x: TabId) => filterRows(rows, x).length;
  // switching tabs never moves what is below the list: the panel keeps the height of its longest tab (motion round)
  const ref = useRef<HTMLElement>(null);
  const most = Math.min(limit ?? Infinity, count("all"));
  useHoldHeight(ref, rows.length, [tab, shown.length, most, tabs], () => {
    const list = ref.current?.querySelector(".wl-rows"), panel = ref.current;
    if (!tabs || !list || !panel || !shown.length) return 0;
    const per = list.getBoundingClientRect().height / shown.length;
    return panel.getBoundingClientRect().height + per * Math.max(0, most - shown.length);
  });
  return (
    <section className="wl-notes" aria-labelledby="wl-notes-h" ref={ref}>
      {title && (
        <div className="spread wl-notes-h">
          <h2 className="label" id="wl-notes-h">
            <b>{t("wallet.notes.title")}</b> · {list.length}
          </h2>
          <button type="button" className="label wl-sort" onClick={() => setPrefs({ sort: p.sort === "amount" ? "recent" : "amount" })} aria-label={t("wallet.notes.sortAria")}>
            {t(p.sort === "amount" ? "wallet.notes.byAmount" : "wallet.notes.byRecent")}
          </button>
        </div>
      )}
      {tabs && (
        <Tabs
          ariaLabel={t("wallet.notes.tabs")}
          idBase="wl-tabs"
          value={tab}
          onChange={onTab}
          block
          tabs={[
            { id: "all", label: t("wallet.tab.all"), count: count("all") },
            { id: "in", label: t("wallet.tab.in"), count: count("in") },
            { id: "out", label: t("wallet.tab.out"), count: count("out") },
            { id: "agents", label: t("wallet.tab.agents"), count: count("agents") },
          ]}
        />
      )}
      {shown.length === 0 ? (
        <Empty
          title={t(`wallet.empty.${tab}.t`)}
          text={t(`wallet.empty.${tab}.b`)}
          action={tab === "in" ? { label: t("wallet.keys.request"), to: "/wallet/request" } : { label: t("wallet.keys.pay"), to: "/wallet/pay" }}
        />
      ) : (
        <div className="rows wl-rows">
          {shown.map((r) => (
            <NoteRow key={r.key} r={r} to={hrefOf(r)} nowMs={nowMs} selected={selected === r.key} />
          ))}
        </div>
      )}
      {more && limit && list.length > limit && (
        <NavLink className="wl-more" to={more}>
          {t("wallet.notes.all", { n: list.length })} <span aria-hidden="true">→</span>
        </NavLink>
      )}
    </section>
  );
}
