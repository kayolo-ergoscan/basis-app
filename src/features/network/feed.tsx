// One redemption as a feed row (amount, owner → receiver, date or block, tracker age, flags): the /network overview
// column, a reserve's and a tracker's redemptions, ErgoScan's tracker page. Its own module so Ours.tsx can use it
// without importing Overview.tsx (which imports Ours.tsx).
import { Link } from "react-router-dom";
import { useT } from "@/app";
import { KeySeal } from "@/ui";
import { copy, pick } from "@/content";
import type { RedemptionView } from "@/chain";
import { blocks, date, height as fmtH, keyOfAddress, sAddr, sid, type Lang } from "./fmt";
import { redemptionAmount } from "./viz";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

export function FeedRow({ r }: { r: RedemptionView }) {
  const t = useT();
  const lang = t.lang as Lang;
  const rk = keyOfAddress(r.receiver);
  // seen in the reserve's boxes, its transaction not read yet: the receiver, the time and the tracker box are unknown
  const unread = r.fromBoxes ? t("network.rd.unread") : null;
  return (
    <li className={cx("nw-rd", r.emergencyWindow && "em")}>
      <Link to={`/network/tx/${r.tx}`} className="nw-rd-a" aria-label={t("network.rd.open", { id: sid(r.tx) })} title={unread ? t("network.rd.unreadTitle") : undefined}>
        <span className="nw-rd-amt num">{redemptionAmount(r, lang)}</span>
        <span className="nw-rd-who" aria-hidden="true">
          {r.owner.key ? <KeySeal pk={r.owner.key} size={24} /> : <span className="nw-noseal" style={{ width: 24 }} />}
          <span className="arr">→</span>
          {rk ? <KeySeal pk={rk} size={24} /> : <span className="nw-noseal" style={{ width: 24 }} />}
        </span>
        <span className="nw-rd-pair">
          {t("network.rd.pair", { owner: r.ownerLabel ?? sAddr(r.owner.addr), receiver: r.receiverLabel ?? (r.receiver ? sAddr(r.receiver) : unread ?? sAddr(null)) })}
        </span>
        <span className="nw-rd-m">
          <span>{unread ? t("network.rd.block", { h: fmtH(r.height) }) : date(r.at, lang)}</span>
          <span>{unread ?? t("network.rd.age", { age: blocks(r.tracker?.age ?? 0, lang) })}</span>
          {r.emergencyWindow && <span className="flag em" title={pick(copy.emergencyRule, lang)}>⚑ {t("network.rd.em")}</span>}
          {r.firstOfPair && <span className="flag" title={t("network.rd.firstTitle")}>◇ {t("network.rd.first")}</span>}
        </span>
      </Link>
    </li>
  );
}
