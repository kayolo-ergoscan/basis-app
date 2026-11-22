// Inputs (VISUAL §12.4): Field (label + control + help line), AmountInput (leading +, value, unit, Max), TextInput,
// KeyField (counterparty: seal S, name, three words; pasting a 33-byte key resolves in place). Focus shows on the
// whole field; errors are an alarm outline plus words that say what to do (no shaking, no modal).
import { cloneElement, isValidElement, useId, useMemo, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { isHex } from "../engine/bytes";
import { short } from "../engine/money";
import { threeWords } from "../engine/words";
import { Icon } from "./Icon";
import { AgentTag } from "./primitives";
import { KeySeal } from "./Seal";

export interface FieldProps {
  label: ReactNode;
  /** Help line: always states the remaining headroom where there is one. */
  help?: ReactNode;
  /** Error line (alarm); the number inside stays ink. Replaces help. */
  error?: ReactNode;
  children: ReactElement;
  className?: string;
}
/** Wires label, control and help/error (aria-describedby, aria-invalid) together. */
export function Field({ label, help, error, children, className }: FieldProps) {
  const id = useId();
  const ctl = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string; invalid?: boolean }>, { id: `${id}-c`, "aria-describedby": help || error ? `${id}-h` : undefined, invalid: !!error })
    : children;
  return (
    <div className={["field-l", className].filter(Boolean).join(" ")}>
      <label htmlFor={`${id}-c`}>{label}</label>
      {ctl}
      {(error || help) && <span id={`${id}-h`} className={error ? "help err" : "help"} role={error ? "alert" : undefined}>{error ?? help}</span>}
    </div>
  );
}

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "size" | "max">;
export interface AmountInputProps extends Base {
  value: string;
  onChange: (v: string) => void;
  unit?: string;
  /** Leading "+" (amounts you add to a note). */
  plus?: boolean;
  /** Trailing Max key: label and handler. */
  max?: { label: ReactNode; onMax: () => void };
  invalid?: boolean;
}
/** 52 px well with the value in Geist 500 22, tabular. */
export function AmountInput({ value, onChange, unit = "ERG", plus, max, invalid, className, id, ...rest }: AmountInputProps) {
  return (
    <div className={["input", invalid && "err", className].filter(Boolean).join(" ")}>
      {plus && <span className="plus" aria-hidden="true">+</span>}
      <input id={id} inputMode="decimal" autoComplete="off" spellCheck={false} value={value} aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,\s ⁠]/g, ""))} {...rest} />
      {unit && <span className="u">{unit}</span>}
      {max && <button type="button" className="key sm" onClick={max.onMax}>{max.label}</button>}
    </div>
  );
}

export interface TextInputProps extends Base { value: string; onChange: (v: string) => void; mono?: boolean; icon?: string; invalid?: boolean; trailing?: ReactNode }
/** Text well (mono for keys and ids). */
export function TextInput({ value, onChange, mono, icon, invalid, trailing, className, ...rest }: TextInputProps) {
  return (
    <div className={["input", mono ? "mono" : "text", invalid && "err", className].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} />}
      <input value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid || undefined} spellCheck={false} {...rest} />
      {trailing}
    </div>
  );
}

export interface KeyFieldProps extends Base {
  value: string;
  onChange: (v: string) => void;
  /** Resolve a pasted key or a typed name to a contact (name, pk, agent). */
  resolve?: (s: string) => { name: string; pk: string; agent?: boolean } | null;
  invalid?: boolean;
}
/** Counterparty field: shows seal + name + three words once the value is a known name or a 33-byte key. */
export function KeyField({ value, onChange, resolve, invalid, placeholder, ...rest }: KeyFieldProps) {
  const t = useT();
  const v = value.trim();
  const hit = useMemo(() => {
    const r = resolve?.(v);
    if (r) return r;
    if (isHex(v, 33) && (v.startsWith("02") || v.startsWith("03"))) return { name: t("ui.keyField.unknown"), pk: v.toLowerCase(), agent: false };
    return null;
  }, [v, resolve, t]);
  if (hit) {
    return (
      <div className={["input", invalid && "err"].filter(Boolean).join(" ")} style={{ gap: 12 }}>
        <KeySeal pk={hit.pk} agent={hit.agent} size="sm" />
        <span style={{ font: "600 16px var(--f-ui)", whiteSpace: "nowrap" }}>{hit.name}</span>
        {hit.agent && <AgentTag small />}
        <span className="mono" style={{ fontSize: 11.5, color: "var(--ink-3)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }} title={hit.pk}>
          {threeWords(hit.pk).join(" · ")} · {short(hit.pk, 4, 4)}
        </span>
        <button type="button" className="key sm quiet icon-only" onClick={() => onChange("")} aria-label={t("ui.keyField.clear")}><Icon name="close" size={16} /></button>
      </div>
    );
  }
  return (
    <div className={["input", "mono", invalid && "err"].filter(Boolean).join(" ")}>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t("ui.keyField.placeholder")} spellCheck={false} autoComplete="off" aria-invalid={invalid || undefined} {...rest} />
    </div>
  );
}
