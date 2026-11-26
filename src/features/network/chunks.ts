// What a switch to /network loads first (src/app/motion.ts): the observatory snapshot (a local chunk), so the page
// shows its numbers from the first frame instead of a skeleton that then grows into the page.
import { part } from "@/app/chunk";

export const snapshot = part(() => import("@/chain").then((m) => m.chain.ensureSeed()));
