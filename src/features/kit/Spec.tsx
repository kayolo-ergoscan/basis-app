// Kit specimen frame: the component tag and props (mono), a short note, the live component, the snippet.
import type { CSSProperties, ReactNode } from "react";

export function Spec({ tag, name, note, code, children, className, style }: {
  /** Component tag with its key props, e.g. "<Note live loupe>". */
  tag: string;
  /** What this specimen shows. */
  name?: ReactNode;
  /** Right-hand label (behaviour, thresholds). */
  note?: ReactNode;
  /** Usage snippet printed under the specimen. */
  code?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div className={["spec-card", className].filter(Boolean).join(" ")} style={style}>
      <div className="comp-label">
        <h3><span className="id">{tag}</span>{name}</h3>
        {note && <span className="label">{note}</span>}
      </div>
      {children}
      {code && <pre className="spec-props">{code}</pre>}
    </div>
  );
}

/** Mono caption under a small specimen. */
export const Cap = ({ children }: { children: ReactNode }) => <div className="spec-cap">{children}</div>;
