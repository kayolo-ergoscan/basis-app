// A payment request opened from a link (/wallet/mainnet/pay#to=…&amount=…&nft=…[&name=…&memo=…]), for a payer who may
// never have heard of Basis: first who asks, how much and what for (the name and memo as plain text, said to be
// unchecked); without a key, three ways on (set up a key and pay, learn what Basis is, try it with play money) and what
// paying takes. The request waits in this tab while the key is set up (reqlink.ts), and the wallet comes back to it once
// the key is backed up. After paying, one clear last step: send the receipt link, without which the receiver sees
// nothing (the tracker's list of notes to a key is closed on our front).
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "@/app/lang";
import { CopyButton, Key, KeySeal, Lamp, short, toast } from "@/ui";
import { RESERVE_MIN_NANOERG } from "@/mainnet/tx";
import { receiptLink, type NoteReceipt } from "@/mainnet/flows";
import type { VaultState } from "@/mainnet/vault";
import { QrCode } from "../lib/qr";
import { T1_FEE_ALLOWANCE } from "./Fund";
import { ergText } from "./ui";
import { Amt, amtText } from "./denom";
import { clearPending, keepPending, openRequest, pendingNow, usePendingHash, type OpenRequest } from "./reqlink";

/** Who asks: the name from the link, or the short key. */
const whoOf = (o: OpenRequest) => o.labels.name ?? short(o.req.to, 4, 4);

/** The request: who asks, how much, what for, the key (longer than in the heading, to check against the receiver) and
 *  the network. `compact` (above the Pay form, a key at hand): the amount beside who asks. */
export function RequestCard({ o, onDrop, compact }: { o: OpenRequest; onDrop?: () => void; compact?: boolean }) {
  const t = useT();
  const { req, labels } = o;
  const denom = req.denom ?? "erg";
  const who = whoOf(o);
  return (
    <section className={`card mw-rq${compact ? " compact" : ""}`} aria-labelledby="mw-rq-h">
      <div className="label">{t("mw.rq.kicker")}</div>
      <div className="mw-rq-who">
        <KeySeal pk={req.to} size="md" />
        <div className="mw-rq-whot">
          <h2 className="t-h3" id="mw-rq-h">{req.amount !== null ? t("mw.rq.asks", { who }) : t("mw.rq.asksAny", { who })}</h2>
          <span className="mono t-small mw-dim">{t("mw.rq.keyNet", { key: short(req.to, 8, 8) })}</span>
        </div>
      </div>
      {req.amount !== null ? (
        <div className="mw-rq-amt"><Amt raw={req.amount} denom={denom} /></div>
      ) : (
        <p className="t-small">{t("mw.rq.anyAmount")}</p>
      )}
      {labels.memo && <p className="mw-rq-memo">{t("mw.rq.memo", { memo: labels.memo })}</p>}
      {(labels.name || labels.memo) && <p className="t-small mw-dim">{t("mw.rq.unchecked")}</p>}
      {onDrop && <button type="button" className="textlink t-small mw-rq-drop" onClick={onDrop}>{t("mw.rq.drop")}</button>}
    </section>
  );
}

/** The request without a key in this browser (or one not backed up yet): the card, how paying works, three ways on and
 *  what paying takes, from the wallet's real rules (a backed-up key, ERG at it, a reserve, one signed note). */
export function RequestWelcome({ o, state }: { o: OpenRequest; state: VaultState }) {
  const t = useT();
  const nav = useNavigate();
  const noKey = state.status === "none" || state.status === "damaged";
  const start = () => { keepPending(o.hash); nav("/wallet/mainnet/setup"); };
  const needs: [string, string][] = [
    [t("mw.rq.need1"), t("mw.rq.need1b")],
    [t("mw.rq.need2"), t("mw.rq.need2b", { min: ergText(RESERVE_MIN_NANOERG), fee: ergText(T1_FEE_ALLOWANCE) })],
    [t("mw.rq.need3"), t("mw.rq.need3b")],
    [t("mw.rq.need4"), t("mw.rq.need4b")],
  ];
  return (
    <div className="mw-rq-page">
      <div className="mw-rq-col">
        <RequestCard o={o} />
        <section className="mw-rq-how" aria-labelledby="mw-rq-how-h">
          <h2 className="t-h4" id="mw-rq-how-h">{t("mw.rq.howT")}</h2>
          <p>{t("mw.rq.howB")}</p>
        </section>
      </div>
      <div className="mw-rq-col">
        <div className="mw-rq-paths">
          <Key variant="primary" size="lg" block onClick={start}>{t("mw.rq.pay")}</Key>
          <p className="t-small mw-dim mw-rq-sub">{t(noKey ? "mw.rq.payNoKey" : "mw.rq.payBackup")}</p>
          <Key size="lg" block to="/learn/how">{t("mw.rq.learn")}</Key>
          <Key size="lg" block to="/play" className="mw-rq-try">{t("mw.rq.try")}</Key>
        </div>
        <section className="mw-rq-needs" aria-labelledby="mw-rq-needs-h">
          <h2 className="label" id="mw-rq-needs-h">{t("mw.rq.needT")}</h2>
          <ol>
            {needs.map(([h, b], i) => (
              <li key={i}><span className="mw-rq-n" aria-hidden="true">{i + 1}</span><span><b>{h}</b><span className="t-small mw-dim">{b}</span></span></li>
            ))}
          </ol>
        </section>
        <p className="mw-rq-ask t-small">{t("mw.rq.noErg")}</p>
      </div>
    </div>
  );
}

/** On every mainnet screen but the request itself: the request that waits in this tab, with the way back to it. */
export function PendingRequestBar() {
  const t = useT();
  const hash = usePendingHash();
  const loc = useLocation();
  const o = hash ? openRequest(hash) : null;
  if (!o) return null;
  if (loc.pathname.replace(/\/$/, "") === "/wallet/mainnet/pay" && openRequest(loc.hash)?.hash === o.hash) return null;
  const who = whoOf(o);
  return (
    <div className="mw-rq-bar" role="status">
      <Lamp state="tracked" size={10} />
      <span className="mw-rq-bar-t">{o.req.amount !== null ? t("mw.rq.barAmt", { who, amount: amtText(o.req.amount, o.req.denom ?? "erg") }) : t("mw.rq.bar", { who })}</span>
      <span className="mw-actions">
        <Key size="sm" to={`/wallet/mainnet/pay${o.hash}`}>{t("mw.rq.barBack")}</Key>
        <Key size="sm" variant="quiet" onClick={clearPending}>{t("mw.rq.barDrop")}</Key>
      </span>
    </div>
  );
}

/** Back to the waiting request once the key is set up in this visit: when the wallet turns ready (a backed-up key),
 *  not on a page load where it already was. */
export function useReturnToRequest(ready: boolean, loading: boolean) {
  const nav = useNavigate();
  const was = useRef<boolean | null>(null);
  useEffect(() => {
    if (loading) return;
    if (was.current === false && ready) {
      const p = pendingNow();
      if (p) nav(`/wallet/mainnet/pay${p.hash}`);
    }
    was.current = ready;
  }, [ready, loading, nav]);
}

/** After paying: send the receipt. Share where the device can, else copy; the link and a QR code beside it. The
 *  receipt link is the one the wallet always made (receiptLink). */
export function ReceiptHandoff({ r, name }: { r: NoteReceipt; name: string | null }) {
  const t = useT();
  const link = receiptLink(location.origin, r);
  const [qr, setQr] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      toast({ kind: "info", title: t("ui.copied"), detail: short(link, 8, 6), mono: true, icon: "copy", ttl: 2000 });
    } catch {
      toast({ kind: "info", title: t("ui.copyFailed"), ttl: 3000 });
    }
  };
  const share = async () => {
    try {
      await navigator.share({ title: t("mw.rq.shareTitle"), text: t("mw.rq.shareText"), url: link });
    } catch (e) {
      // closed by the payer: nothing to say; any other refusal: copy instead
      if (!(e instanceof DOMException && e.name === "AbortError")) await copy();
    }
  };
  return (
    <section className="mw-handoff" aria-labelledby="mw-handoff-h">
      <div className="label mw-handoff-k"><Lamp state="tracked" size={8} />{t("mw.rq.lastStep")}</div>
      <h2 className="t-h3" id="mw-handoff-h">{t("mw.rq.sendH")}</h2>
      <p>{name ? t("mw.rq.sendB", { name }) : t("mw.rq.sendBAnon")}</p>
      <Key variant="primary" size="lg" block icon={canShare ? undefined : "copy"} onClick={() => void (canShare ? share() : copy())}>{t(canShare ? "mw.rq.share" : "mw.rq.copy")}</Key>
      <div className="mw-actions">
        {canShare && <CopyButton value={link} label={t("mw.rq.copyLink")} />}
        <Key size="sm" aria-expanded={qr} onClick={() => setQr(!qr)}>{t(qr ? "mw.rq.qrHide" : "mw.rq.qr")}</Key>
      </div>
      {qr && <div className="mw-qr mw-qr-c lg"><QrCode text={link} size={180} label={t("mw.pay.receiptQr")} /></div>}
      <p className="t-small mw-dim">{t("mw.pay.receiptPrivate")}</p>
    </section>
  );
}

/** Keeps the request of the page's fragment for this tab while the Pay screen shows it. */
export function useKeepRequest(o: OpenRequest | null) {
  useEffect(() => { if (o) keepPending(o.hash); }, [o?.hash]); // eslint-disable-line react-hooks/exhaustive-deps
}

