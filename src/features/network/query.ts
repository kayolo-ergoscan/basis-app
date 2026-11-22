// Filter and view state mirrored into the query string with history.replaceState. A router navigation would change
// the location key, and the shell's ScrollManager scrolls every new key to the top — wrong for a filter click.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

export function useQuery(): [URLSearchParams, (patch: Record<string, string | null | undefined>) => void, () => void] {
  const loc = useLocation();
  const [sp, setSp] = useState(() => new URLSearchParams(loc.search));
  const cur = useRef(sp);
  useEffect(() => {
    const n = new URLSearchParams(loc.search);
    cur.current = n;
    setSp(n);
  }, [loc.search]);
  const write = (n: URLSearchParams) => {
    cur.current = n;
    setSp(n);
    const qs = n.toString();
    try {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
    } catch { /* ignore: sandboxed frames */ }
  };
  const set = useCallback((patch: Record<string, string | null | undefined>) => {
    const n = new URLSearchParams(cur.current);
    for (const [k, v] of Object.entries(patch)) {
      if (v) n.set(k, v); else n.delete(k);
    }
    write(n);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = useCallback(() => {
    const n = new URLSearchParams();
    const view = cur.current.get("view");
    if (view) n.set("view", view);
    write(n);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return [sp, set, reset];
}
