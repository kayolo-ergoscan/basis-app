// Settings (K15, K16, C07, C08 and the sandbox controls): identity and custody, export / verify / import / reveal /
// wipe of the sandbox key, theme, language, units, privacy, confirm-with-second-press, motion, clock speed, the
// faucet and a town reset.
import { useRef, useState } from "react";
import { useT } from "@/app/lang";
import { LangSeg, ThemeSeg } from "@/app/chrome";
import { Callout, CopyButton, Field, Hex, Key, KeySeal, Seg, setUiSettings, Switch, TextInput, useUiSettings } from "@/ui";
import { FAUCET_ERG, SPEEDS, town, useClock, useTown, useTownReady, useWallet, worldText, YOU, type Speed } from "@/world";
import { copy, pick } from "@/content";
import { setPrefs, useFmt, useNameOf, useOutcomeToast, usePrefs } from "../lib/hooks";
import { saveText } from "../lib/download";
import { Frame, SandboxTag } from "../parts/bits";

const errCode = (e: unknown): string => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "unknown");

export function SettingsPage({ page }: { page: boolean }) {
  const t = useT();
  return (
    <Frame page={page} title={t("wallet.set.title")} sub={t("wallet.set.sub")} labelId="wl-set-h" className="wl-flow wl-set">
      <IdentitySection />
      <KeySection />
      <DisplaySection />
      <SandboxSection />
    </Frame>
  );
}

function IdentitySection() {
  const t = useT();
  const { identity } = useWallet();
  const nameOf = useNameOf();
  const own = identity?.name && identity.name !== "You" ? identity.name : "";
  const [name, setName] = useState(own);
  if (!identity) return null;
  return (
    <section className="card wl-set-card" aria-labelledby="wl-set-id">
      <div className="card-b">
        <h2 className="label" id="wl-set-id">
          <b>{t("wallet.set.identity")}</b>
        </h2>
        <div className="wl-idcard">
          <KeySeal pk={identity.pubHex} size="xl" />
          <div>
            <div className="wl-id-name">
              <span className="t-h3">{nameOf(YOU)}</span>
              <SandboxTag small />
            </div>
            <div className="wl-idcard-words">{identity.words.join(" · ")}</div>
            <div className="mono t-small">
              {t("wallet.onb.fp")} {identity.fingerprint}
            </div>
            <div className="wl-pk">
              <span className="label">{t("wallet.set.pub")}</span> <Hex value={identity.pubHex} head={8} tail={6} copy />
            </div>
          </div>
        </div>
        <div className="wl-inline">
          <Field label={t("wallet.set.name")}>
            <TextInput value={name} onChange={(v) => setName(v.slice(0, 24))} autoComplete="nickname" placeholder={nameOf(YOU)} />
          </Field>
          <Key size="lg" disabled={!name.trim() || name.trim() === own} onClick={() => town.wallet.rename(name.trim())}>
            {t("wallet.set.rename")}
          </Key>
        </div>
        <Callout tone="info" title={t("wallet.set.custodyT")}>
          {t("wallet.set.custodyB")} {pick(copy.nautilusCannotSign, t.lang)}
        </Callout>
      </div>
    </section>
  );
}

function KeySection() {
  const t = useT();
  const { identity } = useWallet();
  const [pass, setPass] = useState("");
  const [vPass, setVPass] = useState("");
  const [vFile, setVFile] = useState<string | null>(null);
  const [vName, setVName] = useState("");
  const [msg, setMsg] = useState<{ tone: "proof" | "alarm"; text: string } | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [imp, setImp] = useState("");
  const [wipeAsk, setWipeAsk] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!identity) return null;
  const exportKey = async () => {
    try {
      const b = await town.wallet.exportBackup(pass);
      saveText(b.json, b.filename);
      setMsg({ tone: "proof", text: t("wallet.set.exported", { file: b.filename }) });
      setPass("");
    } catch (e) {
      setMsg({ tone: "alarm", text: t(`wallet.err.${errCode(e)}`) });
    }
  };
  const verify = async () => {
    if (!vFile) return;
    try {
      const ok = await town.wallet.verifyBackup(vFile, vPass);
      setMsg(ok ? { tone: "proof", text: t("wallet.set.verified") } : { tone: "alarm", text: t("wallet.err.wrong-passphrase") });
    } catch (e) {
      setMsg({ tone: "alarm", text: t(`wallet.err.${errCode(e)}`) });
    }
  };
  const importHex = async () => {
    try {
      await town.importIdentity(imp.trim(), { replace: true });
      setImp("");
      setMsg({ tone: "proof", text: t("wallet.set.imported") });
    } catch (e) {
      setMsg({ tone: "alarm", text: t(`wallet.err.${errCode(e)}`) });
    }
  };
  return (
    <section className="card wl-set-card" aria-labelledby="wl-set-key">
      <div className="card-b">
        <div className="spread">
          <h2 className="label" id="wl-set-key">
            <b>{t("wallet.set.key")}</b>
          </h2>
          <span className={`tag ${identity.backedUp ? "ok" : "warn"}`}>{t(identity.backedUp ? "wallet.set.backedUp" : "wallet.set.notBacked")}</span>
        </div>
        <div className="wl-inline">
          <Field label={t("wallet.set.exportPass")} help={t("wallet.onb.passHelp")} error={pass && pass.length < 8 ? t("wallet.err.weak-passphrase") : undefined}>
            <TextInput value={pass} onChange={setPass} type="password" autoComplete="new-password" />
          </Field>
          <Key size="lg" disabled={pass.length < 8} onClick={() => void exportKey()}>
            {t("wallet.set.export")}
          </Key>
        </div>
        <div className="wl-krow">
          <input
            ref={file}
            id="wl-set-file"
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setVName(f.name);
              void f.text().then(setVFile);
            }}
          />
          <div className="field-l">
            <label htmlFor="wl-set-file">{t("wallet.set.checkT")}</label>
          </div>
          <div className="wl-file">
            <Key size="sm" icon="note" onClick={() => file.current?.click()}>
              {t("wallet.onb.pickFile")}
            </Key>
            {vName && <span className="mono t-small">{vName}</span>}
          </div>
          {vFile && (
            <div className="wl-inline">
              <Field label={t("wallet.onb.pass")}>
                <TextInput value={vPass} onChange={setVPass} type="password" autoComplete="current-password" />
              </Field>
              <Key size="lg" disabled={vPass.length < 8} onClick={() => void verify()}>
                {t("wallet.set.verify")}
              </Key>
            </div>
          )}
        </div>
        <div className="wl-inline">
          <Field label={t("wallet.set.import")} help={t("wallet.set.importHelp")}>
            <TextInput value={imp} onChange={(v) => setImp(v.replace(/\s/g, ""))} mono type="password" autoComplete="off" placeholder="64 hex" />
          </Field>
          <Key size="lg" variant="danger" hold="sign" disabled={!/^[0-9a-fA-F]{64}$/.test(imp.trim())} onAct={() => void importHex()}>
            {t("wallet.set.replace")}
          </Key>
        </div>
        {msg && <Callout tone={msg.tone}>{msg.text}</Callout>}
        <div className="wl-secret">
          {secret ? (
            <>
              <code className="mono wl-secret-v">{secret}</code>
              <div className="wl-act">
                <CopyButton value={secret} label={t("wallet.set.copySecret")} small />
                <Key size="sm" variant="quiet" onClick={() => setSecret(null)}>
                  {t("wallet.set.hide")}
                </Key>
              </div>
            </>
          ) : (
            <Key size="sm" variant="quiet" icon="eye" hold="sign" onAct={() => setSecret(town.wallet.revealSecretHex())}>
              {t("wallet.set.reveal")}
            </Key>
          )}
          <p className="t-small">{t("wallet.set.revealNote")}</p>
        </div>
        {!wipeAsk ? (
          <Key size="sm" variant="quiet" icon="exit" className="wl-wipe" onClick={() => setWipeAsk(true)}>
            {t("wallet.set.wipe")}
          </Key>
        ) : (
          <Callout tone="alarm" title={t("wallet.set.wipeT")}>
            <p>{t(identity.backedUp ? "wallet.set.wipeB" : "wallet.set.wipeBNo")}</p>
            <div className="wl-act">
              <Key size="sm" variant="danger" hold onAct={() => void town.wipeWallet().then(() => setPrefs({ backupSkipped: false, tourDone: false }))}>
                {t("wallet.set.wipeYes")}
              </Key>
              <Key size="sm" variant="quiet" onClick={() => setWipeAsk(false)}>
                {t("wallet.cancel")}
              </Key>
            </div>
          </Callout>
        )}
      </div>
    </section>
  );
}

function DisplaySection() {
  const t = useT();
  const ui = useUiSettings();
  const p = usePrefs();
  return (
    <section className="card wl-set-card" aria-labelledby="wl-set-disp">
      <div className="card-b wl-set-grid">
        <h2 className="label" id="wl-set-disp">
          <b>{t("wallet.set.display")}</b>
        </h2>
        <div className="wl-set-line">
          <span className="t-h4">{t("wallet.set.theme")}</span>
          <ThemeSeg />
        </div>
        <div className="wl-set-line">
          <span className="t-h4">{t("wallet.set.lang")}</span>
          <LangSeg />
        </div>
        <div className="wl-set-line">
          <span className="t-h4">{t("wallet.set.amounts")}</span>
          <Seg ariaLabel={t("wallet.set.amounts")} value={p.amounts} onChange={(v) => setPrefs({ amounts: v })} options={[{ value: "2dp", label: t("wallet.set.2dp") }, { value: "exact", label: t("wallet.set.exact") }]} />
        </div>
        <div className="wl-set-line">
          <span className="t-h4">{t("wallet.set.durations")}</span>
          <Seg ariaLabel={t("wallet.set.durations")} value={p.durations} onChange={(v) => setPrefs({ durations: v })} options={[{ value: "blocks", label: t("wallet.set.blocksFirst") }, { value: "time", label: t("wallet.set.timeFirst") }]} />
        </div>
        <Switch checked={ui.privacy} onChange={(v) => setUiSettings({ privacy: v })} label={t("wallet.set.privacy")} help={t("wallet.set.privacyHelp")} />
        <Switch checked={ui.confirmPress} onChange={(v) => setUiSettings({ confirmPress: v })} label={t("wallet.set.confirm")} help={t("wallet.set.confirmHelp")} />
        <Switch checked={ui.motion === "reduce"} onChange={(v) => setUiSettings({ motion: v ? "reduce" : "system" })} label={t("wallet.set.motion")} help={t("wallet.set.motionHelp")} />
      </div>
    </section>
  );
}

function SandboxSection() {
  const t = useT();
  const f = useFmt();
  const show = useOutcomeToast();
  const { speed, height } = useClock();
  const faucetIn = useTown((s) => s.faucetIn);
  const ready = useTownReady();
  const [ask, setAsk] = useState(false);
  const ergAmount = Number(FAUCET_ERG) / 1e9;
  return (
    <section className="card wl-set-card" aria-labelledby="wl-set-sbx">
      <div className="card-b wl-set-grid">
        <div className="spread">
          <h2 className="label" id="wl-set-sbx">
            <b>{t("wallet.set.sandbox")}</b>
          </h2>
          <SandboxTag small />
        </div>
        <div className="wl-set-line">
          <span className="t-h4">{t("wallet.set.speed")}</span>
          <Seg ariaLabel={t("wallet.set.speed")} value={speed} onChange={(v: Speed) => void town.clock.setSpeed(v)} options={SPEEDS.map((s) => ({ value: s, label: worldText(`world.speed.${s}`, {}, t.lang) }))} />
        </div>
        <p className="t-small">{worldText(`world.speed.${speed}.about`, {}, t.lang)}</p>
        <div className="wl-set-line">
          <span className="t-h4">{t("wallet.set.faucet")}</span>
          <Key size="sm" icon="coin" disabled={faucetIn > 0} onClick={() => void town.faucet().then(show)}>
            {worldText("world.faucet.button", { amount: f.prose(String(ergAmount)) }, t.lang)}
          </Key>
        </div>
        <p className="t-small">{faucetIn > 0 ? worldText("world.faucet.wait", { height: f.height(height + faucetIn), blocks: f.height(faucetIn) }, t.lang) : worldText("world.faucet.ready", {}, t.lang)}</p>
        <dl className="wl-dl">
          <dt>{t("wallet.set.storage")}</dt>
          <dd>{ready.persistence.kind ? worldText(`world.storage.${ready.persistence.kind}`, {}, t.lang) : "—"}</dd>
          <dt>{t("wallet.set.role")}</dt>
          <dd>{ready.role ? worldText(`world.role.${ready.role}`, {}, t.lang) : "—"}</dd>
          <dt>{t("wallet.set.avl")}</dt>
          <dd>{!ready.avl ? t("wallet.set.avlOff") : worldText(ready.avl.fallback ? "world.avl.fallback" : ready.avl.simulated ? "world.avl.simulated" : "world.avl.real", {}, t.lang)}</dd>
        </dl>
        {!ask ? (
          <Key size="sm" variant="quiet" icon="loop" className="wl-dq" onClick={() => setAsk(true)}>
            {worldText("world.reset.title", {}, t.lang)}
          </Key>
        ) : (
          <Callout tone="alarm" title={worldText("world.reset.title", {}, t.lang)}>
            <p>{worldText("world.reset.confirm", {}, t.lang)}</p>
            <div className="wl-act">
              <Key size="sm" variant="danger" hold onAct={() => void town.reset().then((o) => (show(o), setAsk(false)))}>
                {t("wallet.set.resetYes")}
              </Key>
              <Key size="sm" variant="quiet" onClick={() => setAsk(false)}>
                {t("wallet.cancel")}
              </Key>
            </div>
          </Callout>
        )}
      </div>
    </section>
  );
}
