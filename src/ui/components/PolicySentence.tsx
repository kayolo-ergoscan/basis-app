// Policy sentence (VISUAL §12.8): an acceptance policy as one editable serif sentence; its variables are pills that
// open popovers; mono tags under it show the real predicates. CommandBar (§12.9): natural input → a typed call preview.
import { Fragment, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { Popover } from "./Sheet";
import { KeySeal } from "./Seal";
import { Tag } from "./primitives";

export interface PolicyPill {
  id: string;
  label: ReactNode;
  /** A person pill shows the key seal. */
  pk?: string;
  agent?: boolean;
  metal?: boolean;
  /** Popover body (an editor); without it the pill is static. */
  edit?: ReactNode;
}
export interface PolicySentenceProps {
  /** Text and pills in reading order: ["Accept notes from ", {pill}, " and ", {pill}, "."]. */
  parts: (string | PolicyPill)[];
  /** The real predicates (mono tags). */
  predicates?: { label: ReactNode; metal?: boolean }[];
  className?: string;
}
export function PolicySentence({ parts, predicates, className }: PolicySentenceProps) {
  const t = useT();
  return (
    <div className={className}>
      <p className="policy" style={{ margin: 0 }}>
        {parts.map((p, i) => {
          if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
          const body = <>{p.pk && <KeySeal pk={p.pk} agent={p.agent} size={20} />}{p.label}</>;
          if (!p.edit) return <span key={p.id} className={`pill static${p.metal ? " metal" : ""}`}>{body}</span>;
          return (
            <Popover key={p.id} trigger={(a) => <button type="button" className={`pill${p.metal ? " metal" : ""}`} aria-label={t("ui.policy.edit", { what: typeof p.label === "string" ? p.label : p.id })} {...a}>{body}</button>}>
              {p.edit}
            </Popover>
          );
        })}
      </p>
      {predicates && predicates.length > 0 && (
        <div className="policy-preds" aria-label={t("ui.policy.predicates")}>
          {predicates.map((x, i) => <Tag key={i} tone={x.metal ? "metal" : "plain"}>{x.label}</Tag>)}
        </div>
      )}
    </div>
  );
}

export interface TypedCallProps {
  fn: string;
  /** Values: strings render quoted, numbers and booleans bare; `{ num: "0.50" }` is a number with its own formatting. */
  args: [string, string | number | boolean | { num: string }][];
  /** Lines after the call ("acceptance: ok · per-call budget 2.00/day · 1.50 left"). */
  check?: { key: string; value: ReactNode; rest?: ReactNode };
}
/** Typed call preview in mono: keys ink-3, strings metal-ink, numbers up. */
export function TypedCall({ fn, args, check }: TypedCallProps) {
  return (
    <pre>
      <span className="k">{fn}</span>({"{ "}
      {args.map(([k, v], i) => (
        <Fragment key={k}>
          <span className="k">{k}</span>: {typeof v === "string" ? <span className="s">"{v}"</span> : <span className="n">{typeof v === "object" ? v.num : String(v)}</span>}{i < args.length - 1 ? ", " : " "}
        </Fragment>
      ))}
      {"})"}
      {check && <>{"\n"}<span className="k">{check.key}</span>: <span className="n">{check.value}</span>{check.rest}</>}
    </pre>
  );
}

export interface CommandBarProps {
  /** The typed text (shown with a caret when static). */
  query: ReactNode;
  label?: ReactNode;
  call?: TypedCallProps;
  actions?: ReactNode;
}
/** Static command bar card (the live palette is the shell's ⌘K). */
export function CommandBar({ query, label, call, actions }: CommandBarProps) {
  return (
    <div className="cmdk">
      <div className="q"><span className="mono" style={{ color: "var(--ink-3)" }}>⌘K</span><span>{query}</span><span className="caret" aria-hidden="true" /></div>
      {(call || actions) && (
        <div className="res">
          {label && <div className="label">{label}</div>}
          {call && <TypedCall {...call} />}
          {actions && <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{actions}</div>}
        </div>
      )}
    </div>
  );
}
