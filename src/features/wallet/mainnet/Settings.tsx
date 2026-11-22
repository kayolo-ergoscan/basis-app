// /wallet/mainnet/settings — the key in this browser (design §4.3): lock now, the auto-lock times, the backup file again
// (or prove one), the hex export (passphrase every time, behind a hold; shown once, never kept), storage persistence,
// and wiping the key from this browser (with a confirmation; without a verified backup the key is gone for good).
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useT } from "@/app/lang";
import { Callout, Card, Field, Hex, Key, KeySeal, Switch, TextInput } from "@/ui";
import { bytesToHex } from "@/protocol/bytes";
import { VAULT, isVaultError } from "@/mainnet/vault";
import { watchExtras } from "@/mainnet/flows";
import { saveText } from "../lib/download";
import { useMw } from "./ctx";
import { useWatchList } from "./data";
import { Persistence } from "./Start";
import { Gate, useVaultError } from "./ui";

const HEX_SHOWN_MS = 60_000;

function ExportHex() {
  const t = useT();
  const { vault } = useMw();
  const verr = useVaultError();
  const [pass, setPass] = useState("");
  const [ok, setOk] = useState(false);
  const [shown, setShown] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const out = useRef<HTMLElement>(null);
  const timer = useRef<number | null>(null);
  const hide = () => {
    if (out.current) out.current.textContent = "";
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    setShown(false);
  };
  useEffect(() => hide, []);
  const reveal = async () => {
    setErr(null);
    try {
      // the key goes straight to the element (never into React state, storage or a URL) and is cleared after a minute
      const hex = await vault.withSecret("export-hex", (sk) => bytesToHex(sk), { passphrase: pass });
      setPass("");
      setShown(true);
      requestAnimationFrame(() => { if (out.current) out.current.textContent = hex; });
      timer.current = window.setTimeout(hide, HEX_SHOWN_MS);
    } catch (e) { setErr(isVaultError(e, "wrong-passphrase") ? t("mw.pay.passWrong") : verr(e)); }
  };
  return (
    <Card title={t("mw.set.hexT")}>
      <div className="mw-form">
        <Callout tone="alarm" title={t("mw.set.hexWarnT")}>{t("mw.set.hexWarnB")}</Callout>
        <div className={shown ? "mw-secret on" : "mw-secret"} aria-live="polite">
          <code ref={out} className="mono mw-break" />
          {shown && (
            <div className="mw-actions">
              <Key size="sm" icon="copy" onClick={() => { const v = out.current?.textContent; if (v) void navigator.clipboard.writeText(v).catch(() => {}); }}>{t("mw.set.hexCopy")}</Key>
              <Key size="sm" variant="quiet" onClick={hide}>{t("mw.set.hexHide")}</Key>
            </div>
          )}
        </div>
        {!shown && (
          <>
            <Field label={t("mw.pass.label")} help={t("mw.set.hexPass")} error={err ?? undefined}>
              <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
            </Field>
            <Switch checked={ok} onChange={setOk} label={t("mw.set.hexOk")} />
            <Key variant="danger" hold disabled={!pass || !ok} onAct={() => void reveal()}>{t("mw.set.hexHold")}</Key>
          </>
        )}
      </div>
    </Card>
  );
}

function Wipe() {
  const t = useT();
  const { vault, state, me, entries } = useMw();
  const verr = useVaultError();
  const [word, setWord] = useState("");
  const [unbacked, setUnbacked] = useState(false);
  const [journal, setJournal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const openEntries = me ? entries.filter((e) => e.pub === me.pub && ["signed", "sent", "mempool", "confirmed"].includes(e.state)).length : 0;
  const need = t("mw.set.wipeWord");
  const ready = word.trim().toLowerCase() === need.toLowerCase() && (state.backedUp || unbacked);
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setErr(null);
    try { await vault.wipe({ confirmUnbacked: !state.backedUp, journal: journal && openEntries === 0, takeOver: true }); } catch (x) { setErr(verr(x)); }
  };
  return (
    <Card title={t("mw.set.wipeT")}>
      <form className="mw-form" onSubmit={go}>
        <p className="t-small">{state.backedUp ? t("mw.set.wipeB") : t("mw.set.wipeNoBackup")}</p>
        {openEntries > 0 && <Callout tone="alarm">{t("mw.set.wipeOpen", { n: openEntries })}</Callout>}
        {!state.backedUp && <Switch checked={unbacked} onChange={setUnbacked} label={t("mw.set.wipeUnbacked")} />}
        <Switch checked={journal} onChange={setJournal} disabled={openEntries > 0} label={t("mw.set.wipeJournal")} help={t("mw.set.wipeJournalB")} />
        <Field label={t("mw.set.wipeType", { word: need })}>
          <TextInput value={word} onChange={setWord} autoComplete="off" />
        </Field>
        <Key variant="danger" type="submit" disabled={!ready}>{t("mw.set.wipeGo")}</Key>
        {err && <Callout tone="alarm">{err}</Callout>}
      </form>
    </Card>
  );
}

export function SettingsScreen() {
  const t = useT();
  const { vault, state, me } = useMw();
  const verr = useVaultError();
  const [watch] = useWatchList(me?.pub ?? null);
  const [msg, setMsg] = useState<string | null>(null);
  const key = state.key;
  const backupAgain = async () => {
    setMsg(null);
    try {
      const b = await vault.exportBackup({ extras: watchExtras(watch) });
      saveText(b.json, b.filename);
      setMsg(t("mw.set.backupSaved", { file: b.filename }));
    } catch (e) { setMsg(verr(e)); }
  };
  return (
    <Gate vault={vault} state={state} backup={false}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <h1 className="t-h2">{t("mw.set.h")}</h1>
            <p className="t-lede">{t("mw.set.lede")}</p>
          </header>
          {key && (
            <Card title={t("mw.set.keyT")}>
              <div className="mw-form">
                <div className="mw-filecard">
                  <KeySeal pk={key.pub} size="md" />
                  <div>
                    <div className="label">{t("mw.fund.addr")}</div>
                    <Hex value={key.address} head={12} tail={8} copy />
                    <div className="label">{t("mw.set.pub")}</div>
                    <Hex value={key.pub} head={12} tail={8} copy />
                  </div>
                </div>
                <p className="t-small mw-dim">{t("mw.set.made", { at: new Date(key.createdAt).toISOString().slice(0, 10), how: t(`mw.set.src.${key.source}`) })} · {key.backedUpAt ? t("mw.set.backedUp", { at: new Date(key.backedUpAt).toISOString().slice(0, 10) }) : t("mw.set.notBackedUp")}</p>
              </div>
            </Card>
          )}
          <Card title={t("mw.set.lockT")}>
            <div className="mw-form">
              <p className="t-small">{t("mw.set.lockB", { idle: VAULT.IDLE_LOCK_MS / 60_000, hidden: VAULT.HIDDEN_LOCK_MS / 60_000 })}</p>
              {state.status === "unlocked" ? <Key icon="lock" onClick={() => vault.lock("manual")}>{t("mw.top.lock")}</Key> : <p className="t-small mw-dim">{t("mw.top.locked")}</p>}
            </div>
          </Card>
          <Card title={t("mw.set.backupT")}>
            <div className="mw-form">
              <p className="t-small">{t("mw.set.backupB")}</p>
              <Gate vault={vault} state={state} backup={false} unlocked why={t("mw.start.unlockForBackup")}>
                <Key icon="down" onClick={() => void backupAgain()}>{t("mw.set.backupGo")}</Key>
              </Gate>
              {msg && <p className="t-small">{msg}</p>}
              <Persistence />
            </div>
          </Card>
          <Gate vault={vault} state={state} backup={false} unlocked why={t("mw.set.hexUnlock")}>
            <ExportHex />
          </Gate>
          <Wipe />
        </div>
        <aside className="mw-side">
          <Callout tone="policy" title={t("mw.set.whereT")}>{t("mw.warn.key")} {t("mw.warn.storage")}</Callout>
          <Callout tone="calm">{t("mw.set.noSeed")}</Callout>
        </aside>
      </div>
    </Gate>
  );
}
