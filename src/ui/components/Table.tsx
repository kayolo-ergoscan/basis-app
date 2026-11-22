// Table: tabular numbers, hairline rows; `stack` turns rows into labelled blocks on phone (≤ 640 px).
import type { ReactNode } from "react";

export interface Column<R> {
  key: string;
  label: ReactNode;
  align?: "left" | "right";
  /** The row's title cell on phone (no label, bold). */
  lead?: boolean;
  render?: (row: R, i: number) => ReactNode;
  /** Plain-text label for the phone layout when `label` is not a string. */
  textLabel?: string;
  width?: number | string;
}
export interface TableProps<R> {
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R, i: number) => string;
  onRowClick?: (row: R) => void;
  selected?: (row: R) => boolean;
  /** Rows become stacked label/value blocks on phone. */
  stack?: boolean;
  caption?: ReactNode;
  /** Visible caption (default: screen readers only). */
  showCaption?: boolean;
  foot?: ReactNode[];
  empty?: ReactNode;
  className?: string;
}

export function Table<R>({ columns, rows, rowKey, onRowClick, selected, stack, caption, showCaption, foot, empty, className }: TableProps<R>) {
  return (
    <div className="tbl-wrap">
      <table className={["tbl", stack && "stacked", className].filter(Boolean).join(" ")}>
        {caption && <caption className={showCaption ? "label" : "sr-only"} style={showCaption ? { textAlign: "left", paddingBottom: 10 } : undefined}>{caption}</caption>}
        <thead>
          <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.align === "right" ? "r" : undefined} style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length === 0 && empty != null && <tr><td colSpan={columns.length} className="dim">{empty}</td></tr>}
          {rows.map((r, i) => (
            <tr
              key={rowKey(r, i)}
              className={[onRowClick && "click", selected?.(r) && "sel"].filter(Boolean).join(" ") || undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(r); } : undefined}
              aria-selected={selected ? !!selected(r) : undefined}
            >
              {columns.map((c) => (
                <td key={c.key} className={[c.align === "right" && "r", c.lead && "lead"].filter(Boolean).join(" ") || undefined}
                  data-label={c.textLabel ?? (typeof c.label === "string" ? c.label : "")}>
                  {c.render ? c.render(r, i) : String((r as Record<string, unknown>)[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {foot && <tfoot><tr>{foot.map((f, i) => <td key={i} className={columns[i]?.align === "right" ? "r" : undefined} data-label={typeof columns[i]?.label === "string" ? (columns[i].label as string) : ""}>{f}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}
