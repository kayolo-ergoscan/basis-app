// Empty, loading and error states (VISUAL §8.7, §12.11).
import { useMemo, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { blake2b256, utf8 } from "../engine/bytes";
import { pairSeal } from "../engine/seal";
import { Icon } from "./Icon";
import { Key } from "./Key";
import { WindowLoader } from "./Town";

export interface EmptyProps {
  title: ReactNode;
  text?: ReactNode;
  /** One primary key ("Play the sandbox"). */
  action?: { label: ReactNode; to?: string; onClick?: () => void };
  /** Words inside the ghost note (default "your first promise"). */
  ghost?: ReactNode;
  className?: string;
}
/** A dashed ghost note, a title, one sentence and one primary key. */
export function Empty({ title, text, action, ghost, className }: EmptyProps) {
  const t = useT();
  return (
    <div className={["empty", className].filter(Boolean).join(" ")}>
      <div className="ghostnote" aria-hidden="true"><span className="ghost-words">{ghost ?? t("ui.empty.ghost")}</span></div>
      <div className="t-h4">{title}</div>
      {text && <p className="t-small" style={{ maxWidth: "26em" }}>{text}</p>}
      {action && <Key variant="primary" size="sm" to={action.to} onClick={action.onClick}>{action.label}</Key>}
    </div>
  );
}

const engraved = new Map<string, string>();
/** The seal engraves itself: every path of a pair seal draws with pathLength = 1 (static frame under reduced motion). */
export function Engraving({ seed = "loading", size = 92 }: { seed?: string; size?: number }) {
  const svg = useMemo(() => {
    let s = engraved.get(seed);
    if (!s) {
      s = pairSeal(blake2b256(utf8("basis-loading:" + seed)), { detail: 0.35, px: size, paper: false }).replace(/<path /g, '<path pathLength="1" ');
      engraved.set(seed, s);
    }
    return s;
  }, [seed, size]);
  return <div className="engraving-load" style={{ width: size, height: size }} aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

/** Loading: three windows lighting up in turn, plus skeleton bars. */
export function Loading({ label, seed, lines = 3 }: { label?: ReactNode; seed?: string; lines?: number }) {
  const t = useT();
  const widths = ["70%", "92%", "48%", "80%", "60%"];
  return (
    <div className="loading" role="status" aria-live="polite">
      <WindowLoader key={seed} />
      <div className="skel" aria-hidden="true">{Array.from({ length: lines }, (_, i) => <i key={i} style={{ width: widths[i % widths.length] }} />)}</div>
      <span className="sr-only">{label ?? t("ui.loading")}</span>
    </div>
  );
}
/** Full-page loading (route Suspense fallback). */
export function PageLoading({ label }: { label?: ReactNode }) {
  return <div className="page-loading"><Loading label={label} seed="page" /></div>;
}

export interface ErrorStateProps {
  title: ReactNode;
  /** What to do, in words. */
  text?: ReactNode;
  onRetry?: () => void;
  retryLabel?: ReactNode;
  /** Technical detail (mono, shown small). */
  detail?: string;
  children?: ReactNode;
}
/** Inline alarm outline and words that say what to do. */
export function ErrorState({ title, text, onRetry, retryLabel, detail, children }: ErrorStateProps) {
  const t = useT();
  return (
    <div className="err-state" role="alert">
      <div className="ttl"><Icon name="warn" />{title}</div>
      {text && <p>{text}</p>}
      {detail && <pre>{detail}</pre>}
      {(onRetry || children) && <div className="acts">{onRetry && <Key size="sm" onClick={onRetry}>{retryLabel ?? t("ui.retry")}</Key>}{children}</div>}
    </div>
  );
}
