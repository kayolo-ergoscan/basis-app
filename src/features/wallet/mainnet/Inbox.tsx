// «Inbox» on Receive: every note paid to this key, without a receipt link (inbox.ts). One press signs the inbox request
// with the wallet key (the vault's withSecret, like the redemption build request: a read, no coins move); a locked key
// is unlocked the way Pay does it (UnlockCard). The signed token stays in this tab until it expires, so the list opens
// again without the key. Each payer found can be watched in one tap. A tracker without the inbox (401/404): one quiet
// line pointing at the receipt link and the payer's key, as before.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLang, useT } from "@/app/lang";
import { Card, Key, KeySeal, Lamp, short } from "@/ui";
import { denomSymbol, signInbox, type Denomination } from "@/mainnet/tx";
import { watchIssuer, watchedDenoms, type WatchedIssuer } from "@/mainnet/flows";
import { isVaultError } from "@/mainnet/vault";
import { useMw } from "./ctx";
import { net, useWatchList } from "./data";
import { UnlockCard, useVaultError } from "./ui";
import { Amt } from "./denom";
import { INBOX_VALID_S, dropToken, payersOf, probeInbox, readInbox, readToken, saveToken, untilFrom, type InboxItem } from "./inbox";

const STAGE_LAMP = { local: "signed", pending: "tracked", committed: "committed" } as const;

type Phase =
  | { k: "idle" }
  | { k: "unlock" }
  | { k: "working" }
  | { k: "list"; items: InboxItem[]; refused: number; until: string }
  | { k: "closed" }
  | { k: "busy" }
  | { k: "failed"; text: string | null };

const nowMs = () => net().clock.now();

export function InboxCard({ me }: { me: string }) {
  const t = useT();
  const { lang } = useLang();
  const verr = useVaultError();
  const { vault, state } = useMw();
  const [list, update] = useWatchList(me);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const live = useRef(true);
  const autoSigned = useRef(0);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  // `kept`: a token from earlier in this tab; refused (401), it is dropped and the button signs a new one
  const read = useCallback(async (token: { until: string; sig: string }, kept = false) => {
    setPhase({ k: "working" });
    const a = await readInbox(me, token, nowMs());
    if (!live.current) return;
    if (a.kind === "list") return setPhase({ k: "list", items: a.items, refused: a.refused, until: token.until });
    if (a.kind === "closed") { dropToken(me); return setPhase(kept && a.status === 401 ? { k: "idle" } : { k: "closed" }); }
    if (a.kind === "busy") return setPhase({ k: "busy" });
    setPhase({ k: "failed", text: null });
  }, [me]);

  const sign = useCallback(async () => {
    setPhase({ k: "working" });
    let token;
    try {
      const until = untilFrom(nowMs());
      // the vault's signing path for a request the recipient signs and that moves nothing (as the build request)
      token = await vault.withSecret("build-request", (sk) => signInbox(sk, me, until));
    } catch (e) {
      if (!live.current) return;
      return setPhase(isVaultError(e, "locked") ? { k: "unlock" } : { k: "failed", text: verr(e) });
    }
    saveToken(me, token);
    await read(token);
  }, [vault, me, read, verr]);

  const show = useCallback(async () => {
    const kept = readToken(me, Math.floor(nowMs() / 1000));
    if (kept) return read(kept, true);
    if (state.status === "unlocked") return sign();
    // locked: first ask whether this tracker has the inbox at all, so nobody types the passphrase for nothing
    setPhase({ k: "working" });
    const p = await probeInbox(me, nowMs());
    if (!live.current) return;
    setPhase(p === "closed" ? { k: "closed" } : p === "failed" ? { k: "failed", text: null } : { k: "unlock" });
  }, [me, state.status, read, sign]);

  // a token kept in this tab opens the list at once; the key is not needed for it
  useEffect(() => {
    const kept = readToken(me, Math.floor(nowMs() / 1000));
    if (kept) void read(kept, true);
  }, [me, read]);

  // unlocked from the card: sign right away (twice at most, should the vault lock again in between)
  useEffect(() => {
    if (phase.k === "unlock" && state.status === "unlocked" && autoSigned.current++ < 2) void sign();
  }, [phase.k, state.status, sign]);

  if (phase.k === "unlock" && state.status !== "unlocked") return <UnlockCard vault={vault} state={state} why={t("mw.in.unlockWhy")} />;

  const forget = () => { dropToken(me); setPhase({ k: "idle" }); };
  const at = (until: string) => new Date(Number(until) * 1000).toLocaleTimeString(lang === "ru" ? "ru-RU" : "en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <Card title={t("mw.in.t")} className="mw-inbox">
      <div className="mw-form">
        {phase.k === "list" ? (
          <InboxList me={me} items={phase.items} refused={phase.refused} list={list} onWatch={(pk, denoms) => update((l) => watchIssuer(l, me, pk, { denoms }))} />
        ) : phase.k === "closed" ? (
          <p className="t-small mw-dim">{t("mw.in.closed")}</p>
        ) : (
          <>
            <p className="t-small">{t("mw.in.lede")}</p>
            {phase.k === "busy" && <p className="t-small">{t("mw.in.busy")}</p>}
            {phase.k === "failed" && <p className="t-small">{phase.text ?? t("mw.in.failed")}</p>}
            <div className="mw-actions">
              <Key variant="primary" icon="in" onClick={() => void show()} disabled={phase.k === "working"}>{phase.k === "working" ? t("mw.in.reading") : t("mw.in.show")}</Key>
            </div>
            <p className="t-small mw-dim">{t("mw.in.signNote", { h: INBOX_VALID_S / 3600 })}</p>
          </>
        )}
        {phase.k === "list" && (
          <div className="mw-actions">
            <Key size="sm" variant="quiet" onClick={() => void show()}>{t("mw.in.refresh")}</Key>
            <Key size="sm" variant="quiet" onClick={forget}>{t("mw.in.forget")}</Key>
            <span className="t-small mw-dim">{t("mw.in.until", { at: at(phase.until) })}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

/** One row per payer (as on the watch list): each denomination it paid in, and one tap to watch them all. */
function InboxList({ me, items, refused, list, onWatch }: { me: string; items: InboxItem[]; refused: number; list: WatchedIssuer[]; onWatch: (pk: string, denoms: Denomination[]) => void }) {
  const t = useT();
  const payers = payersOf(items);
  const lamp = (x: InboxItem) => <Lamp state={STAGE_LAMP[x.view.stage]} label={t(`mw.recv.stage.${x.view.stage}`)} />;
  return (
    <>
      {items.length === 0 ? (
        <p className="t-small mw-dim">{t("mw.in.empty")}</p>
      ) : (
        <>
          <p className="t-small mw-dim">{t("mw.in.found", { n: payers.length })}</p>
          <ul className="mw-pairs">
            {payers.map(({ pk, denoms }) => {
              const w = list.find((y) => y.pk === pk) ?? null;
              const have = w ? watchedDenoms(w) : [];
              const watched = denoms.every((d) => have.includes(d));
              const rows = items.filter((x) => x.issuer === pk);
              const many = rows.length > 1;
              return (
                <li className="mw-pair" key={pk}>
                  <div className="mw-pair-h">
                    <KeySeal pk={pk} size="sm" />
                    <div className="mw-pair-who">
                      <b>{w?.name ?? short(pk, 8, 6)}</b>
                      <span className="mono t-small mw-dim">{short(pk, 8, 6)}</span>
                    </div>
                    {!many && lamp(rows[0])}
                  </div>
                  {rows.map((x) => (
                    <div className={many ? "mw-pair-d" : "mw-pair-one"} key={x.denom}>
                      {many && <div className="mw-pair-dh"><b className="t-small">{denomSymbol(x.denom)}</b>{lamp(x)}</div>}
                      <div className="mw-figs">
                        <div className="mw-figure"><span className="label">{t("mw.recv.total")}</span><b><Amt raw={x.view.total} denom={x.denom} /></b><span className="t-small mw-dim">{t("mw.recv.totalSigned")}</span></div>
                        <div className="mw-figure"><span className="label">{t("mw.recv.now")}</span><b><Amt raw={x.view.redeemableNow} denom={x.denom} tone={x.view.redeemableNow > 0n ? "up" : undefined} /></b></div>
                      </div>
                    </div>
                  ))}
                  <div className="mw-actions">
                    {watched ? (
                      <span className="t-small mw-dim">{t("mw.in.watched")}</span>
                    ) : (
                      <Key size="sm" icon="plus" onClick={() => onWatch(pk, denoms)} disabled={pk === me}>{t("mw.in.watch")}</Key>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {refused > 0 && <p className="t-small">{t("mw.in.refused", { n: refused })}</p>}
    </>
  );
}
