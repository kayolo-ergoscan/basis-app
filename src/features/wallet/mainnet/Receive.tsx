// /wallet/mainnet/receive — the receiver's side (design §3.2, §6.2 "Receive"): the key's own payment request (link and
// QR), a receipt imported from a link (verified: the issuer's signature over the 80-byte note message), and the
// watched issuers, each pair read from the tracker every 2 minutes while this screen is visible (at most 10). Only the
// committed total is redeemable; the times are the measured ones of §6.5.
import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, CopyButton, Field, Key, KeySeal, Lamp, TextInput, short, int } from "@/ui";
import { TRACKER_NFT, parseStoredNote } from "@/mainnet/tx";
import { WATCH_POLLED, decodeReceipt, fragmentOf, noteView, parseErg, requestLink, unwatchIssuer, watchIssuer, type NoteReceipt, type NoteView, type WatchedIssuer } from "@/mainnet/flows";
import { QrCode } from "../lib/qr";
import { useMw } from "./ctx";
import { R, useResource, useWatchList } from "./data";
import { Erg, Gate, ProblemText, TimeHint, ergText } from "./ui";

/** A receipt from a pasted link, a bare code or the page's own fragment. */
function receiptFrom(text: string): ReturnType<typeof decodeReceipt> | null {
  const s = text.trim();
  if (!s) return null;
  const hash = s.includes("#") ? s.slice(s.indexOf("#")) : null;
  const code = hash ? fragmentOf(hash).note ?? "" : s;
  return decodeReceipt(code, { trackerNft: TRACKER_NFT });
}

const STAGE_LAMP = { local: "signed", pending: "tracked", committed: "committed" } as const;

function PairRow({ w, me, index }: { w: WatchedIssuer; me: string; index: number }) {
  const t = useT();
  const nav = useNavigate();
  const [, update] = useWatchList(me);
  const polled = index < WATCH_POLLED;
  const pair = useResource(R.pair(w.pk, me), { everyMs: 120_000, enabled: polled });
  let v: NoteView | null = null;
  let bad = false;
  if (pair.value) {
    try {
      const n = parseStoredNote(pair.value);
      if (n.issuer === w.pk && n.recipient === me && n.denomination === "erg" && n.trackerNft === TRACKER_NFT) v = noteView(n);
      else bad = true;
    } catch { bad = true; }
  }
  const none = pair.at !== null && pair.value === null && !pair.problem;
  return (
    <li className="mw-pair">
      <div className="mw-pair-h">
        <KeySeal pk={w.pk} size="sm" />
        <div className="mw-pair-who">
          <b>{w.name ?? short(w.pk, 8, 6)}</b>
          <span className="mono t-small mw-dim">{short(w.pk, 8, 6)}</span>
        </div>
        {v && <Lamp state={STAGE_LAMP[v.stage]} label={t(`mw.recv.stage.${v.stage}`)} />}
      </div>
      {v ? (
        <>
          <div className="mw-figs">
            <div className="mw-figure"><span className="label">{t("mw.recv.total")}</span><b><Erg nano={v.total} /></b></div>
            <div className="mw-figure"><span className="label">{t("mw.recv.redeemed")}</span><b><Erg nano={v.redeemed} /></b></div>
            <div className="mw-figure"><span className="label">{t("mw.recv.now")}</span><b><Erg nano={v.redeemableNow} tone={v.redeemableNow > 0n ? "up" : undefined} /></b></div>
          </div>
          {v.stage === "committed" && v.confirmedHeight !== null && <p className="t-small mw-dim">{t("mw.recv.committedAt", { h: int(v.confirmedHeight) })}</p>}
          {v.stage !== "committed" && <p className="t-small">{t(`mw.recv.wait.${v.stage}`)} <TimeHint k="note" /></p>}
          {v.committed !== null && v.committed < v.total && <p className="t-small mw-dim">{t("mw.recv.partCommitted", { c: ergText(v.committed) })}</p>}
        </>
      ) : none ? (
        <p className="t-small mw-dim">{t("mw.recv.noNote")}</p>
      ) : bad ? (
        <p className="t-small">{t("mw.recv.badAnswer")}</p>
      ) : !polled ? (
        <p className="t-small mw-dim">{t("mw.recv.notPolled", { n: WATCH_POLLED })}</p>
      ) : (
        <p className="t-small mw-dim">{t("mw.recv.reading")}</p>
      )}
      {w.receipt && (!v || BigInt(w.receipt.total) > v.total) && (
        <p className="t-small">{t("mw.recv.receiptAhead", { total: ergText(BigInt(w.receipt.total)) })}</p>
      )}
      {pair.problem && <p className="t-small"><ProblemText p={pair.problem} what="read" /></p>}
      <div className="mw-actions">
        {v && v.redeemableNow > 0n && <Key size="sm" variant="metal" icon="redeem" onClick={() => nav(`/wallet/mainnet/redeem#issuer=${w.pk}`)}>{t("mw.recv.redeem")}</Key>}
        {polled && <Key size="sm" variant="quiet" onClick={() => void pair.refresh()} disabled={pair.loading}>{t("mw.recv.refresh")}</Key>}
        <Key size="sm" variant="quiet" onClick={() => update((l) => unwatchIssuer(l, w.pk))}>{t("mw.recv.unwatch")}</Key>
      </div>
    </li>
  );
}

function ImportCard({ me, initial }: { me: string; initial: string }) {
  const t = useT();
  const [text, setText] = useState(initial);
  const [list, update] = useWatchList(me);
  const [name, setName] = useState("");
  const r = receiptFrom(text);
  const mine = r && r.ok && r.receipt.recipient === me;
  const watched = r && r.ok ? list.some((w) => w.pk === r.receipt.issuer) : false;
  const add = (rc: NoteReceipt) => {
    update((l) => watchIssuer(l, me, rc.issuer, { name: name.trim() || null, receipt: rc }));
    setText("");
    setName("");
  };
  return (
    <Card title={t("mw.recv.importT")}>
      <div className="mw-form">
        <Field label={t("mw.recv.importL")} help={t("mw.recv.importHelp")}>
          <TextInput mono value={text} onChange={setText} placeholder={t("mw.recv.importPh")} autoComplete="off" />
        </Field>
        {r && !r.ok && <Callout tone="alarm">{t(`mw.recv.refuse.${r.reason}`)}</Callout>}
        {r && r.ok && !mine && <Callout tone="alarm">{t("mw.recv.refuse.other")}</Callout>}
        {r && r.ok && mine && (
          <div className="mw-form">
            <Callout tone="proof" title={t("mw.recv.validT")}>
              {t("mw.recv.validB", { total: ergText(r.receipt.total), at: new Date(Number(r.receipt.timestamp)).toISOString().slice(0, 16).replace("T", " ") + " UTC" })}
            </Callout>
            <div className="mw-filecard">
              <KeySeal pk={r.receipt.issuer} size="sm" />
              <div><div className="label">{t("mw.recv.issuer")}</div><div className="mono t-small mw-break">{r.receipt.issuer}</div></div>
            </div>
            <p className="t-small">{t("mw.recv.validNote")}</p>
            {!watched && (
              <Field label={t("mw.recv.nameL")} help={t("mw.recv.nameHelp")}>
                <TextInput value={name} onChange={setName} maxLength={64} />
              </Field>
            )}
            <Key variant="primary" onClick={() => add(r.receipt)}>{watched ? t("mw.recv.update") : t("mw.recv.watch")}</Key>
          </div>
        )}
      </div>
    </Card>
  );
}

export function ReceiveScreen() {
  const t = useT();
  const { vault, state, me } = useMw();
  const loc = useLocation();
  const [list] = useWatchList(me?.pub ?? null);
  const [amountText, setAmountText] = useState("");
  const amount = parseErg(amountText);
  const initial = useMemo(() => (fragmentOf(loc.hash).note ? loc.hash : ""), [loc.hash]);
  const link = me ? requestLink(location.origin, { to: me.pub, amount: amount && amount > 0n ? amount : null, nft: TRACKER_NFT }) : "";
  return (
    <Gate vault={vault} state={state}>
      {me && (
        <div className="mw-grid">
          <div className="mw-main">
            <header className="mw-screen-h">
              <h1 className="t-h2">{t("mw.recv.h")}</h1>
              <p className="t-lede">{t("mw.recv.lede")}</p>
            </header>
            {initial && <ImportCard me={me.pub} initial={initial} key={initial} />}
            <Card title={t("mw.recv.watchT", { n: list.length })}>
              {list.length === 0 ? (
                <p className="t-small mw-dim">{t("mw.recv.watchEmpty")}</p>
              ) : (
                <ul className="mw-pairs">{list.map((w, i) => <PairRow key={w.pk} w={w} me={me.pub} index={i} />)}</ul>
              )}
              <p className="t-small mw-dim">{t("mw.recv.watchBudget", { n: WATCH_POLLED })}</p>
            </Card>
            {!initial && <ImportCard me={me.pub} initial="" />}
          </div>
          <aside className="mw-side">
            <Card title={t("mw.recv.askT")}>
              <div className="mw-form">
                <div className="mw-qr mw-qr-c"><QrCode text={link} size={180} label={t("mw.recv.askQr")} /></div>
                <Field label={t("mw.recv.askAmount")} help={t("mw.recv.askAmountHelp")} error={amountText && amount === null ? t("mw.amount.bad") : undefined}>
                  <AmountInput value={amountText} onChange={setAmountText} />
                </Field>
                <div className="mw-actions">
                  <CopyButton value={link} label={t("mw.recv.copyLink")} />
                  <CopyButton value={me.pub} label={t("mw.recv.copyPk")} />
                </div>
                <p className="t-small mw-dim">{t("mw.recv.askB")}</p>
              </div>
            </Card>
            <Card title={t("mw.recv.timesT")}>
              <ul className="mw-facts">
                <li>{t("mw.time.note")}</li>
                <li>{t("mw.recv.times2")}</li>
                <li>{t("mw.time.redeem")}</li>
              </ul>
            </Card>
          </aside>
        </div>
      )}
    </Gate>
  );
}
