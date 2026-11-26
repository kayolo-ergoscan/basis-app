// The place bar's counts (src/app/chrome.tsx NetPlaceBar), shared by /network and the tracker console, which shows the
// same bar with the same numbers once the snapshot is in this tab.
import { useEffect, useSyncExternalStore } from "react";
import { chain, oursExtra, type Observatory } from "@/chain";
import type { NetCounts } from "@/app/chrome";

export function netCounts(obs: Observatory): NetCounts {
  return {
    reserves: obs.unspent.length,
    // ErgoScan's tracker was minted after the snapshot: counted here until the seed lists it (as on the list page)
    trackers: obs.trackers.length + oursExtra(obs),
    redemptions: obs.redemptions.length,
    contracts: obs.contracts.filter((c) => c.role === "legacy" || c.role === "current").length,
    incidents: obs.incidents.burns.length + obs.incidents.locks.length,
  };
}

const read = () => chain.getObservatory(chain.store.getState());
/** The counts from the observatory snapshot, without starting the live layer (no reads of its own): the tracker console
 *  shows them once the snapshot has loaded (here it starts that load, a local chunk; the network pages start it too). */
export function useSnapshotCounts(): NetCounts | undefined {
  const obs = useSyncExternalStore(chain.store.subscribe, read, read);
  useEffect(() => { void chain.ensureSeed().catch(() => {}); }, []);
  return obs ? netCounts(obs) : undefined;
}
