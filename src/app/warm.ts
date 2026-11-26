// Data parts that several places wait for before a switch shows them (src/app/motion.ts): loaded for the switch itself,
// never ahead of it (a pointer resting on a link loads code only).
import { part } from "./chunk";

/** The sandbox town (play money): the sandbox wallet, the practice tracker and the API mirror show a loader until it
 *  runs. Booted once per tab, as those pages would boot it. */
export const sandboxTown = part(() => import("@/world").then((m) => m.town.ready()));

/** The observatory snapshot (a local chunk): the Network pages and the home page's mainnet section show their numbers
 *  from it in the first frame, instead of a skeleton that then grows into the page. */
export const snapshot = part(() => import("@/chain").then((m) => m.chain.ensureSeed()));
