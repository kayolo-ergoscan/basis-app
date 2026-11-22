// src/chain/ours/tag.tsx — the quiet "ErgoScan test reserve" tag. Pages show it next to the owner wherever reserves are
// listed, only for the exact owner key OUR_TRACKER.testReserveOwner (see isOurTestReserve in model.ts).
import { useT } from "@/app/lang";
import { Tag } from "@/ui";

/** A small plain tag (the design system's quietest tone, at the 18 px height of the other small tags); the tooltip says
 *  why it is there. */
export function OurTestReserveTag() {
  const t = useT();
  return <Tag className="ours-test" style={{ height: 18 }} title={t("chain.ours.testReserve.title")}>{t("chain.ours.testReserve")}</Tag>;
}
