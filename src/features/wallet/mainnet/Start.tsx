// /wallet/mainnet/setup — the mainnet key (design §4, D4 = K1): create one (a random 32-byte key, encrypted with the
// passphrase), download the backup file and prove it by loading it back (mandatory before funding and before any
// signature), or restore from a backup file, or (for experts) import a hex key. No seed words anywhere.
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { Callout, Card, Field, Hex, Icon, Key, KeySeal, Seg, Switch, TextInput } from "@/ui";
import { VAULT, checkPassphrase, parseBackup, type BackupExtras } from "@/mainnet/vault";
import { watchExtras, watchIssuer } from "@/mainnet/flows";
import { saveText } from "../lib/download";
import { useMw } from "./ctx";
import { useWatchList } from "./data";
import { Steps, UnlockCard, cx, useVaultError } from "./ui";

const MAX_FILE = 256 * 1024;

async function readFile(e: ChangeEvent<HTMLInputElement>): Promise<string | null> {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f || f.size > MAX_FILE) return null;
  try { return await f.text(); } catch { return null; }
}

function Hero({ children }: { children?: ReactNode }) {
  const t = useT();
  return (
    <div className="mw-hero">
      <div className="label mw-eyebrow">{t("mw.start.eyebrow")}</div>
      <h1 className="t-h1 mw-hero-h">{t("mw.start.h1a")} <em>{t("mw.start.h1b")}</em></h1>
      <p className="t-lede mw-hero-lede">{t("mw.start.lede")}</p>
      <ul className="mw-warn-list">
        <li><Icon name="warn" size={16} />{t("mw.warn.small")}</li>
        <li><Icon name="lock" size={16} />{t("mw.warn.key")}</li>
        <li><Icon name="info" size={16} />{t("mw.warn.storage")}</li>
        <li><Icon name="info" size={16} />{t("mw.warn.experimental")}</li>
      </ul>
      {children}
    </div>
  );
}

function Strength({ pass }: { pass: string }) {
  const t = useT();
  if (!pass) return null;
  const c = checkPassphrase(pass);
  return (
    <div className="mw-meter" aria-live="polite">
      <span className="mw-meter-bar" data-s={c.strength}><i /><i /><i /><i /></span>
      <span className="t-small">{c.ok ? t(`mw.pass.s${c.strength}`) : t("mw.pass.short", { n: c.length })}{c.issues.filter((i) => i !== "too-short").map((i) => ` · ${t(`mw.pass.issue.${i}`)}`).join("")}</span>
    </div>
  );
}

/** Passphrase twice, the meter, and "I understand". */
function NewPassphrase({ onSubmit, busy, label, extra }: { onSubmit: (p: string) => void; busy: boolean; label: string; extra?: ReactNode }) {
  const t = useT();
  const [p1, setP1] = useState("");
  const [p2, setP2] = useState("");
  const [ok, setOk] = useState(false);
  const c = checkPassphrase(p1);
  const mismatch = p2.length > 0 && p1 !== p2;
  const ready = c.ok && p1 === p2 && ok && !busy;
  return (
    <form className="mw-form" onSubmit={(e: FormEvent) => { e.preventDefault(); if (ready) onSubmit(p1); }}>
      {extra}
      <Field label={t("mw.pass.new")} help={t("mw.pass.help")}>
        <TextInput type="password" autoComplete="new-password" value={p1} onChange={setP1} />
      </Field>
      <Strength pass={p1} />
      <Field label={t("mw.pass.again")} error={mismatch ? t("mw.pass.mismatch") : undefined}>
        <TextInput type="password" autoComplete="new-password" value={p2} onChange={setP2} />
      </Field>
      <Switch checked={ok} onChange={setOk} label={t("mw.start.understand")} />
      <Key variant="primary" type="submit" block disabled={!ready}>{busy ? t("mw.start.deriving") : label}</Key>
    </form>
  );
}

function CreateKey() {
  const t = useT();
  const { vault } = useMw();
  const verr = useVaultError();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (pass: string) => {
    setBusy(true);
    setErr(null);
    try { await vault.create(pass); } catch (e) { setErr(verr(e)); } finally { setBusy(false); }
  };
  return (
    <>
      <p className="t-body">{t("mw.start.createB")}</p>
      <NewPassphrase onSubmit={(p) => void go(p)} busy={busy} label={t("mw.start.create")} />
      {err && <Callout tone="alarm">{err}</Callout>}
    </>
  );
}

function RestoreFile({ onExtras }: { onExtras: (x: BackupExtras) => void }) {
  const t = useT();
  const { vault } = useMw();
  const verr = useVaultError();
  const [text, setText] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  let preview: { address: string; pub: string; createdAt: string } | null = null;
  let bad = false;
  if (text) {
    try { preview = parseBackup(text, VAULT.KDF_ITERATIONS); } catch { bad = true; }
  }
  const go = async (e: FormEvent) => {
    e.preventDefault();
    if (!text || !pass || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await vault.restoreFromBackup(text, pass);
      if (r.extras) onExtras(r.extras);
      setPass("");
    } catch (x) { setErr(verr(x)); } finally { setBusy(false); }
  };
  return (
    <form className="mw-form" onSubmit={go}>
      <p className="t-body">{t("mw.start.restoreB")}</p>
      <input ref={input} type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => { setErr(null); setText(await readFile(e)); }} />
      <Key icon="down" onClick={() => input.current?.click()}>{text ? t("mw.start.fileOther") : t("mw.start.fileChoose")}</Key>
      {bad && <Callout tone="alarm">{t("mw.vault.bad-backup")}</Callout>}
      {preview && (
        <div className="mw-filecard">
          <KeySeal pk={preview.pub} size="sm" />
          <div>
            <div className="label">{t("mw.start.fileKey")}</div>
            <div className="mono t-small">{preview.address}</div>
            <div className="t-small mw-dim">{t("mw.start.fileMade", { at: preview.createdAt.slice(0, 10) })}</div>
          </div>
        </div>
      )}
      {preview && (
        <>
          <Field label={t("mw.pass.label")} error={err ?? undefined}>
            <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
          </Field>
          <Key variant="primary" type="submit" block disabled={!pass || busy}>{busy ? t("mw.start.deriving") : t("mw.start.restore")}</Key>
        </>
      )}
      {!preview && err && <Callout tone="alarm">{err}</Callout>}
    </form>
  );
}

function ImportHex() {
  const t = useT();
  const { vault } = useMw();
  const verr = useVaultError();
  const [hex, setHex] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const go = async (pass: string) => {
    setBusy(true);
    setErr(null);
    try { await vault.importHex(hex, pass); setHex(""); } catch (e) { setErr(verr(e)); } finally { setBusy(false); }
  };
  // keys review P2-5: a text field masked by CSS, outside the passphrase form, marked for password managers to skip,
  // so none of them offers to save the raw key as a "password"
  return (
    <>
      <Callout tone="alarm" title={t("mw.start.hexWarnT")}>{t("mw.start.hexWarnB")}</Callout>
      <Field label={t("mw.start.hexLabel")} error={err ?? undefined}>
        <TextInput type="text" mono className={shown ? undefined : "mw-masked"} value={hex} onChange={setHex}
          autoComplete="off" autoCapitalize="off" autoCorrect="off" name="basis-key-import"
          data-1p-ignore="" data-lpignore="true" data-bwignore="" data-form-type="other"
          trailing={<button type="button" className="key sm quiet" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? t("mw.set.hexHide") : t("mw.start.hexShow")}</button>} />
      </Field>
      <NewPassphrase busy={busy} label={t("mw.start.import")} onSubmit={(p) => void go(p)} />
    </>
  );
}

/** Key made, not yet backed up: download the file, then load it back with the passphrase. */
function BackupSteps() {
  const t = useT();
  const { vault, state, me } = useMw();
  const verr = useVaultError();
  const [watch] = useWatchList(me?.pub ?? null);
  const [downloaded, setDownloaded] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const download = async () => {
    setErr(null);
    try {
      const b = await vault.exportBackup({ extras: watchExtras(watch) });
      saveText(b.json, b.filename);
      setDownloaded(true);
    } catch (e) { setErr(verr(e)); }
  };
  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!text || !pass || busy) return;
    setBusy(true);
    setErr(null);
    try { await vault.verifyBackup(text, pass); setPass(""); } catch (x) { setErr(verr(x)); } finally { setBusy(false); }
  };
  const key = state.key!;
  return (
    <div className="mw-form">
      <div className="mw-filecard">
        <KeySeal pk={key.pub} size="sm" />
        <div>
          <div className="label">{t("mw.start.yourKey")}</div>
          <div className="mono t-small mw-break">{key.address}</div>
        </div>
      </div>
      <Steps label={t("mw.start.stepsAria")} items={[
        { id: "key", label: t("mw.start.s1"), state: "done" },
        { id: "dl", label: t("mw.start.s2"), sub: t("mw.start.s2b"), state: downloaded ? "done" : "now" },
        { id: "verify", label: t("mw.start.s3"), sub: t("mw.start.s3b"), state: downloaded ? "now" : "todo" },
      ]} />
      {state.status !== "unlocked" && !downloaded ? (
        <UnlockCard vault={vault} state={state} why={t("mw.start.unlockForBackup")} />
      ) : (
        <Key variant={downloaded ? "default" : "primary"} icon="down" block onClick={() => void download()}>{downloaded ? t("mw.start.downloadAgain") : t("mw.start.download")}</Key>
      )}
      {downloaded && (
        <form className="mw-form" onSubmit={verify}>
          <p className="t-small">{t("mw.start.verifyB")}</p>
          <input ref={input} type="file" accept="application/json,.json" className="sr-only" onChange={async (e) => { setErr(null); setText(await readFile(e)); }} />
          <Key icon="down" onClick={() => input.current?.click()}>{text ? t("mw.start.fileLoaded") : t("mw.start.fileLoad")}</Key>
          {text && (
            <>
              <Field label={t("mw.pass.label")}>
                <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
              </Field>
              <Key variant="primary" type="submit" block disabled={!pass || busy}>{busy ? t("mw.start.deriving") : t("mw.start.verify")}</Key>
            </>
          )}
        </form>
      )}
      {err && <Callout tone="alarm">{err}</Callout>}
      <Persistence />
    </div>
  );
}

/** navigator.storage.persist(): granted, refused, unknown; ask again from a click. */
export function Persistence() {
  const t = useT();
  const { vault, state } = useMw();
  const p = state.persisted;
  return (
    <p className={cx("t-small", p !== true && "mw-dim")}>
      {p === true ? t("mw.persist.yes") : p === false ? t("mw.persist.no") : t("mw.persist.unknown")}{" "}
      {p !== true && <button type="button" className="textlink" onClick={() => void vault.requestPersistence()}>{t("mw.persist.ask")}</button>}
    </p>
  );
}

function Damaged() {
  const t = useT();
  const { vault, state } = useMw();
  const verr = useVaultError();
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="mw-form">
      <Callout tone="alarm" title={t("mw.start.damagedT")}>{t(state.backedUp ? "mw.start.damagedB" : "mw.start.damagedNoBackup")}</Callout>
      <Switch checked={ok} onChange={setOk} label={t("mw.start.damagedOk")} />
      <Key variant="danger" disabled={!ok} onClick={async () => { try { await vault.wipe({ confirmUnbacked: true }); } catch (e) { setErr(verr(e)); } }}>{t("mw.start.damagedWipe")}</Key>
      {err && <Callout tone="alarm">{err}</Callout>}
    </div>
  );
}

function Done() {
  const t = useT();
  const { state } = useMw();
  const key = state.key!;
  return (
    <div className="mw-form">
      <Callout tone="proof" title={t("mw.start.doneT")}>{t("mw.start.doneB")}</Callout>
      <div className="mw-filecard">
        <KeySeal pk={key.pub} size="sm" />
        <div>
          <div className="label">{t("mw.start.yourKey")}</div>
          <Hex value={key.address} head={10} tail={6} copy />
        </div>
      </div>
      <div className="mw-actions">
        <Key variant="primary" to="/wallet/mainnet/fund" icon="in">{t("mw.start.next.fund")}</Key>
        <Key to="/wallet/mainnet/receive" icon="request">{t("mw.start.next.receive")}</Key>
        <Key to="/wallet/mainnet" icon="home">{t("mw.nav.home")}</Key>
      </div>
      <p className="t-small mw-dim">{t("mw.start.receiveOnly")}</p>
    </div>
  );
}

type Mode = "create" | "restore" | "hex";

export function StartScreen() {
  const t = useT();
  const { state, me } = useMw();
  const [mode, setMode] = useState<Mode>("create");
  const [extras, setExtras] = useState<BackupExtras | null>(null);
  const [, updateWatch] = useWatchList(me?.pub ?? null);
  let body: ReactNode;
  if (state.status === "damaged") body = <Damaged />;
  else if (state.status === "none") {
    body = (
      <>
        <Seg ariaLabel={t("mw.start.modeAria")} value={mode} onChange={setMode}
          options={[{ value: "create", label: t("mw.start.tab.create") }, { value: "restore", label: t("mw.start.tab.restore") }, { value: "hex", label: t("mw.start.tab.hex") }]} />
        {mode === "create" ? <CreateKey /> : mode === "restore" ? <RestoreFile onExtras={setExtras} /> : <ImportHex />}
      </>
    );
  } else if (!state.backedUp) body = <BackupSteps />;
  else body = <Done />;
  const shownExtras = extras && me && (extras.watchedIssuers?.length ?? 0) > 0 ? extras : null;
  return (
    <div className="mw-start">
      <Hero />
      <Card className="mw-start-card">
        <div className="mw-form">
          {body}
          {shownExtras && me && (
            <Callout tone="info" title={t("mw.start.extrasT", { n: shownExtras.watchedIssuers!.length })}>
              <p>{t("mw.start.extrasB")}</p>
              <ul className="mw-mini-list">
                {shownExtras.watchedIssuers!.slice(0, 10).map((pk) => <li key={pk} className="mono t-small">{pk.slice(0, 10)}…{pk.slice(-6)} {shownExtras.contacts?.find((c) => c.pub === pk)?.name ?? ""}</li>)}
              </ul>
              <Key size="sm" onClick={() => {
                updateWatch((l) => (shownExtras.watchedIssuers ?? []).reduce((acc, pk) => watchIssuer(acc, me.pub, pk, { name: shownExtras.contacts?.find((c) => c.pub === pk)?.name ?? null }), l));
                setExtras(null);
              }}>{t("mw.start.extrasAdd")}</Key>
            </Callout>
          )}
        </div>
      </Card>
    </div>
  );
}
