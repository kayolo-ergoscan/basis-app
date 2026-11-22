// The kit's commitment button: one sandbox pulse for T-01 that contains the Alice → Bob note, plus its toast.
import { translate } from "@/app/lang";
import { pulse } from "@/app/pulse";
import { int, toast } from "@/ui";
import { DIGEST, KEY_AB_HEX } from "./data";

let h = 1921400;
/** The next sandbox height (a commitment every few blocks). */
export const nextHeight = (): number => (h += 3);

/** Commit at `height` (default: the next one): every committed Alice → Bob note, seal, i-dot and chip pulses once. */
export function firePulse(height = nextHeight()): number {
  pulse.commit({ source: "sandbox", trackerId: "t1", digest: DIGEST, height, noteKeys: [KEY_AB_HEX] });
  toast.proof(translate("kit.pulse.done"), translate("kit.pulse.detail", { n: int(height) }));
  return height;
}
