// /wallet/mainnet/activity — the journal of this key: every signed T1, top-up, refund step, note, redemption and
// withdrawal, newest first,
// with its state, its id on ergoscan.me, and the actions an open entry offers (send the same bytes again, discard one
// that was provably never sent). The journal lives in this browser only. Each amount is in its entry's own
// denomination (meta.denom: ERG when absent); a denomination filter shows one at a time, nothing is summed.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { Card, Empty, Key, Lamp, Seg, short, type LampState, int } from "@/ui";
import { RESERVE_ACTION_KINDS, type JournalEntry, type JournalState } from "@/mainnet/vault";
import { WALLET_DENOMS, denomSymbol, p2pkAddress, type Denomination } from "@/mainnet/tx";
import { useMw } from "./ctx";
import { EntryProgress } from "./send";
import { submitEntry } from "./Redeem";
import { ChainLink } from "./ui";
import { Amt, entryDenom } from "./denom";

const LAMP: Record<JournalState, LampState> = { signed: "signed", sent: "tracked", mempool: "tracked", confirmed: "tracked", final: "committed", failed: "alarm", abandoned: "off" };

function amountOf(e: JournalEntry): bigint {
  const v = e.kind === "note" ? e.meta.added ?? e.meta.total : e.kind === "redeem" ? e.meta.payout : e.meta.amount;
  try { return BigInt(String(v ?? "0")); } catch { return 0n; }
}

/** Another key's reserve is named by its owner's address, never the raw key (review 1). */
function addressOf(pub: string): string {
  try { return /^0[23][0-9a-f]{64}$/.test(pub) ? p2pkAddress(pub) : ""; } catch { return ""; }
}

function Row({ e }: { e: JournalEntry }) {
  const t = useT();
  const { vault, height } = useMw();
  const [open, setOpen] = useState(false);
  const who = e.kind === "note" ? String(e.meta.to ?? "") : e.kind === "redeem" ? String(e.meta.issuer ?? "") : e.kind === "withdraw" ? String(e.meta.to ?? "") :
    e.kind === "topup" && e.meta.own === false ? addressOf(String(e.meta.owner ?? "")) : "";
  return (
    <li className="mw-act">
      <button type="button" className="mw-act-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Lamp state={LAMP[e.state]} size={10} />
        <span className="mw-act-k">{t(`mw.kind.${e.meta.combine === true ? "combine" : e.kind}`)}</span>
        <span className="mw-act-w mono t-small">{who ? short(who, 6, 6) : ""}</span>
        <span className="mw-act-v"><Amt raw={amountOf(e)} denom={entryDenom(e)} sign={e.kind === "redeem" ? "favour" : "none"} tone={e.kind === "redeem" ? "up" : undefined} /></span>
        <span className="mw-act-s t-small">{t(`mw.state.${e.state}`)}</span>
        <span className="mw-act-d t-small mw-dim">{new Date(e.createdAt).toISOString().slice(0, 16).replace("T", " ")}</span>
      </button>
      {open && (
        <div className="mw-act-b">
          {e.kind === "note" ? (
            <p className="t-small">{t("mw.act.noteLine", { total: String(e.meta.total ?? "—"), ts: String(e.meta.ts ?? "—") })}</p>
          ) : (
            <EntryProgress vault={vault} entry={e} tip={height} />
          )}
          {e.kind === "redeem" && e.state === "signed" && <Key size="sm" onClick={() => void submitEntry(vault, e)}>{t("mw.red.submitAgain")}</Key>}
          {e.txId && <p className="t-small">{t("mw.track.tx")} <ChainLink kind="tx" id={e.txId} />{e.inclusionHeight !== null && <> · {t("mw.track.inBlock", { h: int(e.inclusionHeight) })}</>}</p>}
          {e.error && <p className="t-small mw-dim">{t("mw.track.lastError")} <q>{e.error}</q></p>}
          <p className="t-small mw-dim">{t("mw.act.attempts", { n: e.sendAttempts })}</p>
        </div>
      )}
    </li>
  );
}

type Filter = "all" | "open" | "t1" | "note" | "redeem" | "withdraw";

export function ActivityScreen() {
  const t = useT();
  const { me, entries } = useMw();
  const [f, setF] = useState<Filter>("all");
  const [d, setD] = useState<Denomination | "all">("all");
  const mine = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && (d === "all" || entryDenom(e) === d)) : []), [entries, me, d]);
  const anyToken = useMemo(() => !!me && entries.some((e) => e.pub === me.pub && entryDenom(e) !== "erg"), [entries, me]);
  // "Reserve" lists everything that made or moved the reserve: T1, top-ups, the refund's two steps
  const shown = mine.filter((e) => f === "all" || (f === "open" ? ["signed", "sent", "mempool", "confirmed"].includes(e.state) : f === "t1" ? e.kind === "t1" || RESERVE_ACTION_KINDS.includes(e.kind) : e.kind === f));
  return (
    <div className="mw-single">
      <header className="mw-screen-h">
        <h1 className="t-h2">{t("mw.act.h")}</h1>
        <p className="t-lede">{t("mw.act.lede")}</p>
      </header>
      <Card>
        <Seg ariaLabel={t("mw.act.filter")} value={f} onChange={setF} options={(["all", "open", "t1", "note", "redeem", "withdraw"] as Filter[]).map((v) => ({ value: v, label: t(`mw.act.f.${v}`) }))} />
        {anyToken && <Seg ariaLabel={t("mw.dn.aria")} value={d} onChange={setD} options={[{ value: "all" as const, label: t("mw.act.f.all") }, ...WALLET_DENOMS.map((x) => ({ value: x, label: denomSymbol(x) }))]} />}
        {shown.length === 0 ? <Empty title={t("mw.act.emptyT")} text={t("mw.act.emptyB")} /> : <ul className="mw-acts">{shown.map((e) => <Row key={e.id} e={e} />)}</ul>}
      </Card>
    </div>
  );
}
