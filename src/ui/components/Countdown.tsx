// Countdown: blocks ↔ time (1 block ≈ 2 min). Shows "1 348 blk · ≈ 1 d 21 h"; a press swaps which one leads.
import { useState } from "react";
import { useLang, useT } from "@/app/lang";
import { blk, humanTime } from "../engine/money";

export interface CountdownProps {
  /** Blocks left; or pass `target` and `height`. */
  blocks?: number;
  target?: number;
  height?: number | null;
  /** Which part leads first. */
  lead?: "blocks" | "time";
  /** Allow the swap on press (default true). */
  toggle?: boolean;
  /** Prefix words ("Emergency redeem in"). */
  label?: string;
  className?: string;
}
export function Countdown({ blocks, target, height, lead = "blocks", toggle = true, label, className }: CountdownProps) {
  const t = useT();
  const { lang } = useLang();
  const [first, setFirst] = useState(lead);
  const left = Math.max(0, blocks ?? (target != null && height != null ? target - height : 0));
  const done = left === 0;
  const b = blk(left, lang), h = humanTime(left, lang);
  const [p, s] = first === "blocks" ? [b, h] : [h, b];
  const body = <>{label && <span>{label}</span>}<span className="p">{done ? t("ui.countdown.now") : p}</span>{!done && <span className="s">{s}</span>}</>;
  if (!toggle) return <span className={["countdown static", done && "done", className].filter(Boolean).join(" ")}>{body}</span>;
  return (
    <button type="button" className={["countdown", done && "done", className].filter(Boolean).join(" ")} onClick={() => setFirst(first === "blocks" ? "time" : "blocks")}
      title={t("ui.countdown.swap")} aria-label={`${label ? label + " " : ""}${b}, ${h}`}>
      {body}
    </button>
  );
}
