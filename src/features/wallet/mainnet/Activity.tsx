// /wallet/mainnet/activity — the journal of this key: every signed T1, note, redemption and withdrawal, newest first,
// with its state, its id on ergoscan.me, and the actions an open entry offers (send the same bytes again, discard one
// that was provably never sent). The journal lives in this browser only.
import { useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { Card, Empty, Key, Lamp, Seg, blk, short, type LampState } from "@/ui";
import type { JournalEntry, JournalState } from "@/mainnet/vault";
import { useMw } from "./ctx";
import { EntryProgress } from "./send";
import { submitEntry } from "./Redeem";
import { ChainLink, Erg } from "./ui";

const LAMP: Record<JournalState, LampState> = { signed: "signed", sent: "tracked", mempool: "tracked", confirmed: "tracked", final: "committed", failed: "alarm", abandoned: "off" };

function amountOf(e: JournalEntry): bigint {
  const v = e.kind === "note" ? e.meta.added ?? e.meta.total : e.kind === "redeem" ? e.meta.payout : e.meta.amount;
  try { return BigInt(String(v ?? "0")); } catch { return 0n; }
}

function Row({ e }: { e: JournalEntry }) {
  const t = useT();
  const { vault, height } = useMw();
  const [open, setOpen] = useState(false);
  const who = e.kind === "note" ? String(e.meta.to ?? "") : e.kind === "redeem" ? String(e.meta.issuer ?? "") : e.kind === "withdraw" ? String(e.meta.to ?? "") : "";
  return (
    <li className="mw-act">
      <button type="button" className="mw-act-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Lamp state={LAMP[e.state]} size={10} />
        <span className="mw-act-k">{t(`mw.kind.${e.meta.combine === true ? "combine" : e.kind}`)}</span>
        <span className="mw-act-w mono t-small">{who ? short(who, 6, 6) : ""}</span>
        <span className="mw-act-v"><Erg nano={amountOf(e)} sign={e.kind === "redeem" ? "favour" : "none"} tone={e.kind === "redeem" ? "up" : undefined} /></span>
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
          {e.txId && <p className="t-small">{t("mw.track.tx")} <ChainLink kind="tx" id={e.txId} />{e.inclusionHeight !== null && <> · {t("mw.track.inBlock", { h: blk(e.inclusionHeight) })}</>}</p>}
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
  const mine = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub) : []), [entries, me]);
  const shown = mine.filter((e) => f === "all" || (f === "open" ? ["signed", "sent", "mempool", "confirmed"].includes(e.state) : e.kind === f));
  return (
    <div className="mw-single">
      <header className="mw-screen-h">
        <h1 className="t-h2">{t("mw.act.h")}</h1>
        <p className="t-lede">{t("mw.act.lede")}</p>
      </header>
      <Card>
        <Seg ariaLabel={t("mw.act.filter")} value={f} onChange={setF} options={(["all", "open", "t1", "note", "redeem", "withdraw"] as Filter[]).map((v) => ({ value: v, label: t(`mw.act.f.${v}`) }))} />
        {shown.length === 0 ? <Empty title={t("mw.act.emptyT")} text={t("mw.act.emptyB")} /> : <ul className="mw-acts">{shown.map((e) => <Row key={e.id} e={e} />)}</ul>}
      </Card>
    </div>
  );
}
