// Tracker page helpers that read the sandbox town: the start-up gate, names, toasts.
import { useCallback, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { ErrorState, int, Loading, toast } from "@/ui";
import { castName, useTownReady, useWallet, worldText, YOU, type Toast as WorldToast } from "@/world";

/** Shows the town's start-up states; renders children once it is ready. */
export function TownGate({ children }: { children: ReactNode }) {
  const t = useT();
  const r = useTownReady();
  if (r.status === "error") {
    return (
      <div className="container trk-gate">
        <ErrorState title={t("tracker.error")} text={worldText("world.status.error", {}, t.lang)} detail={r.error ?? undefined} onRetry={() => window.location.reload()} retryLabel={t("tracker.retry")} />
      </div>
    );
  }
  if (!r.ready) {
    return (
      <div className="container trk-gate" aria-busy="true">
        <Loading label={worldText(`world.status.${r.status}`, {}, t.lang)} seed="tracker-town" lines={4} />
      </div>
    );
  }
  return (
    <>
      {r.role === "follower" && (
        <div className="container">
          <p className="t-small dim trk-follower">{t("tracker.follower")}</p>
        </div>
      )}
      {children}
    </>
  );
}

/** Names in the current language; "You" shows the wallet's own name. */
export function useNameOf() {
  const t = useT();
  const w = useWallet();
  const mine = w.identity?.name;
  return useCallback((id: string) => (id === YOU && mine ? mine : castName(id, t.lang) ?? id), [t.lang, mine]);
}

const NUMERIC = new Set(["n", "height", "blocks", "unlock"]);

/** Shows a command outcome's toast in the current language (VISUAL §12.10). */
export function useOutcomeToast() {
  const t = useT();
  const nameOf = useNameOf();
  return useCallback(
    (x: WorldToast) => {
      // counts and heights arrive as raw digits; group them like every other number (VISUAL §4.3)
      const params = Object.fromEntries(Object.entries(x.params).map(([k, v]) => [k, NUMERIC.has(k) && /^\d{4,}$/.test(v) ? int(Number(v)) : v]));
      const wt = (k: string) => worldText(k, params, t.lang, { name: (id) => (id === YOU ? nameOf(YOU) : undefined) });
      toast({ kind: x.kind, title: wt(x.titleKey), detail: x.detailKey ? wt(x.detailKey) : undefined, ttl: x.sticky ? 0 : undefined });
    },
    [t.lang, nameOf],
  );
}
