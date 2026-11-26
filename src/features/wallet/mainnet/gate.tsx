// The gates of the mainnet wallet screens, and the key's backup step they lead to.
// A key made (or imported) here goes straight to Home; its backup comes later, but before anything can bring value to
// it. Until the backup is checked (the vault's «backed up»: the file loaded back and decrypted with the passphrase, or a
// key restored from its own backup file), every screen that would show the key's address, a payment request, the
// key to share, the project button or the reserve shows the backup step first, and then itself: the person carries on
// where they were going. Signing is refused by the vault until then anyway (vault.ts, "not-backed-up").
import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import { useT } from "@/app/lang";
import { Callout, Card, Field, Key, KeySeal, TextInput, short } from "@/ui";
import type { MainnetVault, VaultState } from "@/mainnet/vault";
import { watchExtras } from "@/mainnet/flows";
import { saveText } from "../lib/download";
import { useMw } from "./ctx";
import { useWatchList } from "./data";
import { Steps, UnlockCard, cx, useVaultError } from "./ui";

const MAX_FILE = 256 * 1024;

export async function readFile(e: ChangeEvent<HTMLInputElement>): Promise<string | null> {
  const f = e.target.files?.[0];
  e.target.value = "";
  if (!f || f.size > MAX_FILE) return null;
  try { return await f.text(); } catch { return null; }
}

/** Key made, not yet backed up: download the file, then load it back with the passphrase. Until the backup is checked
 *  the key is shown short (its seal and the ends of its address): nothing here can be copied to send ERG to. */
export function BackupSteps() {
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
          <div className="mono t-small">{short(key.address, 6, 4)}</div>
        </div>
      </div>
      <Steps house label={t("mw.start.stepsAria")} items={[
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

/** The backup step in place of a screen that would bring value to the key: why first, then the step itself. Once the
 *  file is checked, the screen behind it opens by itself. */
export function BackupFirst() {
  const t = useT();
  return (
    <Card className="mw-backup-first" title={<h1 className="t-h3">{t("mw.gate.backupT")}</h1>}>
      <div className="mw-form">
        <p className="t-small">{t("mw.gate.backupB")}</p>
        <BackupSteps />
      </div>
    </Card>
  );
}

/** Shows `children` only when the key exists, is backed up and (when asked) unlocked; otherwise the next step: the key
 *  set-up, the backup step (in place, then the screen), or the unlock card. */
export function Gate({ vault, state, backup = true, unlocked = false, children, why }: { vault: MainnetVault; state: VaultState; backup?: boolean; unlocked?: boolean; children: ReactNode; why?: ReactNode }) {
  const t = useT();
  if (state.status === "none" || state.status === "damaged") {
    return (
      <Callout tone="info" title={t("mw.gate.noKeyT")}>
        <p>{t("mw.gate.noKeyB")}</p>
        <Key variant="primary" to="/wallet/mainnet/setup">{t("mw.gate.setup")}</Key>
      </Callout>
    );
  }
  if (backup && !state.backedUp) return <BackupFirst />;
  if (unlocked && state.status !== "unlocked") return <UnlockCard vault={vault} state={state} why={why} />;
  return <>{children}</>;
}
