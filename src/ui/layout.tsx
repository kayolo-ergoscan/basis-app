// Layout primitives (VISUAL §5): 12-column grid in a 1440 container (gutter 64 / 40 / 16), page and section heads,
// cards. Pages compose these; nothing here knows about features.
import type { CSSProperties, ElementType, ReactNode } from "react";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** A page body: the container plus the page rhythm (the shell adds the nav offset). */
export function Page({ children, className, wide, style }: { children: ReactNode; className?: string; wide?: boolean; style?: CSSProperties }) {
  return <div className={cx("page", !wide && "container", className)} style={style}>{children}</div>;
}

export interface PageHeadProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  lede?: ReactNode;
  actions?: ReactNode;
  /** h1 by default. */
  as?: ElementType;
}
/** Page title row: eyebrow (label), serif H1 (with *italic second beat*), lede, actions on the right. */
export function PageHead({ eyebrow, title, lede, actions, as: H = "h1" }: PageHeadProps) {
  return (
    <header className="page-head">
      <div>
        {eyebrow && <div className="eyebrow label">{eyebrow}</div>}
        <H className="t-h1">{title}</H>
        {lede && <p className="t-lede" style={{ marginTop: 18 }}>{lede}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}

export interface SectionProps { no?: ReactNode; title?: ReactNode; lede?: ReactNode; aside?: ReactNode; children?: ReactNode; className?: string; id?: string; rule?: boolean }
/** A numbered section ("01 Five moments"): mono number with a rule, serif H2, lede at the right. */
export function Section({ no, title, lede, aside, children, className, id, rule = true }: SectionProps) {
  return (
    <section className={cx("sec", rule && "rule-top", className)} id={id}>
      <div className="container">
        {(title || no) && <SectionHead no={no} title={title} lede={lede} aside={aside} />}
        {children}
      </div>
    </section>
  );
}
export function SectionHead({ no, title, lede, aside }: { no?: ReactNode; title?: ReactNode; lede?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="sec-head">
      <div>{no && <div className="no">{no}</div>}{title && <h2 className="t-h2">{title}</h2>}</div>
      <div>{lede && <p className="t-lede">{lede}</p>}{aside}</div>
    </div>
  );
}

/** 12-column grid; children use <Col span={7} spanL={12}>. */
export function Grid({ children, cols = 12, gap, className, style }: { children: ReactNode; cols?: 2 | 3 | 4 | 12; gap?: number; className?: string; style?: CSSProperties }) {
  return <div className={cx(`grid-${cols}`, className)} style={{ ...(gap != null ? { gap } : null), ...style }}>{children}</div>;
}
export function Col({ span = 12, spanL, children, className, style }: { span?: number; spanL?: number; children?: ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <div className={className} data-span-l={spanL != null ? "" : undefined} style={{ "--span": span, ...(spanL != null ? { "--span-l": spanL } : null), ...style } as CSSProperties}>
      {children}
    </div>
  );
}

export interface CardProps { title?: ReactNode; aside?: ReactNode; footer?: ReactNode; children?: ReactNode; className?: string; style?: CSSProperties; flush?: boolean; as?: ElementType; id?: string }
/** Flat surface card with a 1 px rule (no glass, no gradients). title → card-h, children → card-b, footer → card-f. */
export function Card({ title, aside, footer, children, className, style, flush, as: El = "div", id }: CardProps) {
  return (
    <El className={cx("card", className)} style={style} id={id}>
      {(title || aside) && <div className="card-h">{typeof title === "string" ? <span className="label"><b>{title}</b></span> : title}{aside}</div>}
      {flush ? children : <div className="card-b">{children}</div>}
      {footer && <div className="card-f">{footer}</div>}
    </El>
  );
}

/** Vertical stack / wrapping row / space-between row with a gap. */
export const Stack = ({ gap = 16, children, className, style }: { gap?: number; children?: ReactNode; className?: string; style?: CSSProperties }) =>
  <div className={cx("stack", className)} style={{ "--gap": `${gap}px`, ...style } as CSSProperties}>{children}</div>;
export const Cluster = ({ gap = 12, children, className, style }: { gap?: number; children?: ReactNode; className?: string; style?: CSSProperties }) =>
  <div className={cx("cluster", className)} style={{ "--gap": `${gap}px`, ...style } as CSSProperties}>{children}</div>;
export const Spread = ({ gap = 12, children, className, style }: { gap?: number; children?: ReactNode; className?: string; style?: CSSProperties }) =>
  <div className={cx("spread", className)} style={{ "--gap": `${gap}px`, ...style } as CSSProperties}>{children}</div>;
