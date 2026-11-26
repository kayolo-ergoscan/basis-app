// /wallet/mainnet/receive — the receiver's side (design §3.2, §6.2 "Receive"): the key's own payment request (link and
// QR), a receipt imported from a link (verified: the issuer's signature over the 80-byte note message), and the
// watched issuers (from a receipt, or added by the payer's key or address when there is no receipt link), each pair
// read from the tracker every 2 minutes while this screen is visible (at most 10). Only the committed total is
// redeemable; the times are the measured ones of §6.5.
// Token notes: an issuer is watched in a token once a receipt in it is imported, and a payer added by key is watched in
// every denomination of the wallet (its empty pairs take no line); each denomination is its own pair at the tracker
// (?denomination=) with its own figures, never added to another. The request link names its denomination.
// The request link may also carry how to sign the receiver and what for (after #, plain text, unchecked: reqlink.ts),
// and «A button for your project» makes the same link into a README button (Tip.tsx).
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLang, useT } from "@/app/lang";
import { AmountInput, Callout, Card, CopyButton, Field, Key, KeySeal, Lamp, TextInput, short, int } from "@/ui";
import { TRACKER_NFT, WALLET_DENOMS, denomDecimals, denomSlug, denomSymbol, parseStoredNote, type Denomination } from "@/mainnet/tx";
import {
  WATCH_POLLED, checkPreviousNote, decodeReceipt, fragmentOf, noteView, parseUnits, unwatchIssuer, watchIssuer, watchedDenoms,
  type NoteReceipt, type NoteView, type WatchedIssuer,
} from "@/mainnet/flows";
import { parseKeyInput } from "@/chain/ours";
import { QrCode } from "../lib/qr";
import { useMw } from "./ctx";
import { R, net, useResource, useWatchList } from "./data";
import { Gate, ProblemText, TimeHint } from "./ui";
import { Amt, DenomSwitch, amtText, useDenom, useOnDenomChange } from "./denom";
import { LONG_LINK, MEMO_MAX, NAME_MAX, labelledRequestLink } from "./reqlink";
import { ProjectButton } from "./Tip";

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
  const [, update] = useWatchList(me);
  const polled = index < WATCH_POLLED;
  const denoms = watchedDenoms(w);
  // the denominations with nothing to show (no note, no receipt): when that is all of them, one line says so
  const [quiet, setQuiet] = useState<ReadonlySet<Denomination>>(() => new Set());
  const onQuiet = useCallback((d: Denomination, q: boolean) => setQuiet((s) => (s.has(d) === q ? s : q ? new Set([...s, d]) : new Set([...s].filter((x) => x !== d)))), []);
  const allQuiet = denoms.length > 1 && denoms.every((d) => quiet.has(d));
  const who = (lamp: ReactNode) => (
    <div className="mw-pair-h">
      <KeySeal pk={w.pk} size="sm" />
      <div className="mw-pair-who">
        <b>{w.name ?? short(w.pk, 8, 6)}</b>
        <span className="mono t-small mw-dim">{short(w.pk, 8, 6)}</span>
      </div>
      {lamp}
    </div>
  );
  // ERG only (every issuer before token notes): the row as it was, the lamp in the header
  return (
    <li className="mw-pair">
      {denoms.length > 1 && who(null)}
      {denoms.map((d) => <PairDenom key={d} w={w} me={me} denom={d} polled={polled} titled={denoms.length > 1} header={denoms.length > 1 ? undefined : who} onQuiet={onQuiet} />)}
      {allQuiet && <p className="t-small mw-dim">{polled ? t("mw.recv.noNote") : t("mw.recv.notPolled", { n: WATCH_POLLED })}</p>}
      <div className="mw-actions">
        <Key size="sm" variant="quiet" onClick={() => update((l) => unwatchIssuer(l, w.pk))}>{t("mw.recv.unwatch")}</Key>
      </div>
    </li>
  );
}

/** One denomination of a watched pair: its own note at the tracker, checked, in its own unit. */
function PairDenom({ w, me, denom, polled, titled, header, onQuiet }: { w: WatchedIssuer; me: string; denom: Denomination; polled: boolean; titled: boolean; header?: (lamp: ReactNode) => ReactNode; onQuiet?: (d: Denomination, quiet: boolean) => void }) {
  const t = useT();
  const nav = useNavigate();
  const pair = useResource(R.pair(w.pk, me, denom), { everyMs: 120_000, enabled: polled });
  let v: NoteView | null = null;
  let bad = false;
  if (pair.value) {
    try {
      // the total is the issuer's signed promise: checked here, never taken from the tracker on trust (money P2-5);
      // a token note is checked over the token's message (its denomination is part of what was signed)
      const n = parseStoredNote(pair.value);
      if (checkPreviousNote(n, { issuer: w.pk, recipient: me, accepted: 0n, serverNowMs: net().clock.now(), ...(denom === "erg" ? {} : { denomination: denom }) }).ok) v = noteView(n);
      else bad = true;
    } catch { bad = true; }
  }
  const none = pair.at !== null && pair.value === null && !pair.problem;
  const receipt = denom === "erg" ? w.receipt : w.tokens?.find((x) => x.denom === denom)?.receipt ?? null;
  // one of several denominations with no note and no receipt (an issuer watched for a token only: its ERG; a payer
  // added by key: each denomination it has not used) is not worth a line
  const quiet = titled && !receipt && (none || !polled);
  useEffect(() => { onQuiet?.(denom, quiet); }, [onQuiet, denom, quiet]);
  if (quiet) return null;
  const lamp = v ? <Lamp state={STAGE_LAMP[v.stage]} label={t(`mw.recv.stage.${v.stage}`)} /> : null;
  return (
    <div className={titled ? "mw-pair-d" : "mw-pair-one"}>
      {header ? header(lamp) : (
        <div className="mw-pair-dh">
          <b className="t-small">{denomSymbol(denom)}</b>
          {lamp}
        </div>
      )}
      {v ? (
        <>
          <div className="mw-figs">
            <div className="mw-figure"><span className="label">{t("mw.recv.total")}</span><b><Amt raw={v.total} denom={denom} /></b><span className="t-small mw-dim">{t("mw.recv.totalSigned")}</span></div>
            <div className="mw-figure"><span className="label">{t("mw.recv.redeemed")}</span><b><Amt raw={v.redeemed} denom={denom} /></b></div>
            <div className="mw-figure"><span className="label">{t("mw.recv.now")}</span><b><Amt raw={v.redeemableNow} denom={denom} tone={v.redeemableNow > 0n ? "up" : undefined} /></b></div>
          </div>
          {v.stage === "committed" && v.confirmedHeight !== null && <p className="t-small mw-dim">{t("mw.recv.committedAt", { h: int(v.confirmedHeight) })}</p>}
          {v.stage !== "committed" && <p className="t-small">{t(`mw.recv.wait.${v.stage}`)} <TimeHint k="note" /></p>}
          {v.committed !== null && v.committed < v.total && <p className="t-small mw-dim">{t("mw.recv.partCommitted", { c: amtText(v.committed, denom) })}</p>}
          <p className="t-small mw-dim">{t("mw.recv.trackerFigures")}</p>
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
      {receipt && (!v || BigInt(receipt.total) > v.total) && (
        <p className="t-small">{t("mw.recv.receiptAhead", { total: amtText(BigInt(receipt.total), denom) })}</p>
      )}
      {pair.problem && <p className="t-small"><ProblemText p={pair.problem} what="read" /></p>}
      <div className="mw-actions">
        {v && v.redeemableNow > 0n && <Key size="sm" variant="metal" icon="redeem" onClick={() => nav(`/wallet/mainnet/redeem#issuer=${w.pk}${denom === "erg" ? "" : `&d=${denomSlug(denom)}`}`)}>{t("mw.recv.redeem")}</Key>}
        {polled && <Key size="sm" variant="quiet" onClick={() => void pair.refresh()} disabled={pair.loading}>{t("mw.recv.refresh")}</Key>}
      </div>
    </div>
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
    <Card title={t("mw.recv.importT")} className="mw-recv-import">
      <div className="mw-form">
        <Field label={t("mw.recv.importL")} help={t("mw.recv.importHelp")}>
          <TextInput mono value={text} onChange={setText} placeholder={t("mw.recv.importPh")} autoComplete="off" />
        </Field>
        {r && !r.ok && <Callout tone="alarm">{t(`mw.recv.refuse.${r.reason}`)}</Callout>}
        {r && r.ok && !mine && <Callout tone="alarm">{t("mw.recv.refuse.other")}</Callout>}
        {r && r.ok && mine && (
          <div className="mw-form">
            <Callout tone="proof" title={t("mw.recv.validT")}>
              {t("mw.recv.validB", { total: amtText(r.receipt.total, r.receipt.denom ?? "erg"), at: new Date(Number(r.receipt.timestamp)).toISOString().slice(0, 16).replace("T", " ") + " UTC" })}
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

/** No receipt link: watch a payer by public key or P2PK address. The pair route (issuer → this key) then shows the
 *  note, if there is one, exactly as for a watched issuer from a receipt; nothing is trusted that is not signed. */
function AddPayerCard({ me }: { me: string }) {
  const t = useT();
  const { lang } = useLang();
  const [list, update] = useWatchList(me);
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const key = parseKeyInput(text);
  const self = key.ok && key.key === me;
  // already watched in every denomination; one watched from a receipt in one denomination gets the others added
  const old = key.ok ? list.find((w) => w.pk === key.key) ?? null : null;
  const have = !!old && WALLET_DENOMS.every((d) => watchedDenoms(old).includes(d));
  const err = text.trim() && !key.ok ? t(`mw.pay.to.${key.reason}`) : self ? t("mw.pay.to.self") : have ? t("mw.recv.addHave") : undefined;
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!key.ok || self || have) return;
    update((l) => watchIssuer(l, me, key.key, { ...(old ? {} : { name: name.trim() || null }), denoms: WALLET_DENOMS }));
    setText("");
    setName("");
  };
  return (
    <Card title={t("mw.recv.addT")}>
      <form className="mw-form" onSubmit={add}>
        <Field label={t("mw.recv.addL")} help={t("mw.recv.addHelp", { syms: new Intl.ListFormat(lang === "ru" ? "ru" : "en").format(WALLET_DENOMS.map(denomSymbol)) })} error={err}>
          <TextInput mono value={text} onChange={setText} placeholder="9…" autoComplete="off" autoCapitalize="off" autoCorrect="off" />
        </Field>
        {key.ok && !self && !old && (
          <Field label={t("mw.recv.nameL")} help={t("mw.recv.nameHelp")}>
            <TextInput value={name} onChange={setName} maxLength={64} />
          </Field>
        )}
        <Key type="submit" disabled={!key.ok || self || have}>{t("mw.recv.addGo")}</Key>
      </form>
    </Card>
  );
}

export function ReceiveScreen() {
  const t = useT();
  const { vault, state, me } = useMw();
  const loc = useLocation();
  const [list] = useWatchList(me?.pub ?? null);
  const [denom, setDenom] = useDenom();
  const [amountText, setAmountText] = useState("");
  const [nameText, setNameText] = useState("");
  const [memoText, setMemoText] = useState("");
  // an amount typed in one denomination is never kept under another (second review LOW-5)
  useOnDenomChange(denom, () => setAmountText(""));
  const amount = parseUnits(amountText, denomDecimals(denom));
  const initial = useMemo(() => (fragmentOf(loc.hash).note ? loc.hash : ""), [loc.hash]);
  const link = me ? labelledRequestLink(location.origin, { to: me.pub, amount: amount && amount > 0n ? amount : null, nft: TRACKER_NFT, ...(denom === "erg" ? {} : { denom }) }, { name: nameText, memo: memoText }) : "";
  return (
    <Gate vault={vault} state={state}>
      {me && (
        <div className="mw-grid mw-recv">
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
            <AddPayerCard me={me.pub} />
            <ProjectButton me={me.pub} />
          </div>
          <aside className="mw-side">
            <Card title={t("mw.recv.askT")} className="mw-ask">
              <div className="mw-form">
                <DenomSwitch note value={denom} onChange={(d) => { setDenom(d); setAmountText(""); }} />
                <div className={`mw-qr mw-qr-c${link.length > LONG_LINK ? " lg" : ""}`}><QrCode text={link} size={180} label={t("mw.recv.askQr")} /></div>
                <Field label={denom === "erg" ? t("mw.recv.askAmount") : t("mw.dn.askAmount", { sym: denomSymbol(denom) })} help={t("mw.recv.askAmountHelp")}
                  error={amountText && amount === null ? (denom === "erg" ? t("mw.amount.bad") : t("mw.dn.amountBad", { sym: denomSymbol(denom) })) : undefined}>
                  <AmountInput value={amountText} onChange={setAmountText} unit={denomSymbol(denom)} />
                </Field>
                <Field label={t("mw.rq.nameL")}>
                  <TextInput value={nameText} onChange={setNameText} maxLength={NAME_MAX} autoComplete="off" />
                </Field>
                <Field label={t("mw.rq.memoL")} help={t("mw.rq.labelsHelp")}>
                  <TextInput value={memoText} onChange={setMemoText} maxLength={MEMO_MAX} autoComplete="off" />
                </Field>
                <div className="mw-actions">
                  <CopyButton value={link} label={t("mw.recv.copyLink")} />
                  <CopyButton value={me.pub} label={t("mw.recv.copyPk")} />
                </div>
                <p className="t-small">{t("mw.rq.askReceipt")}</p>
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
