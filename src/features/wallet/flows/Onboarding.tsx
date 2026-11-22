// Onboarding (K01–K03, K05, K06, K09, W01): create or import a sandbox key → three words + fingerprint + seal →
// encrypted backup (passphrase ≥ 8, words 2 and 3 typed back, or a skip with a warning) → join the town (50 play
// ERG) → the home with a three-hint tour. Says plainly: sandbox key, play money, do not send real ERG to it.
import { useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useT } from "@/app/lang";
import { useTheme } from "@/app/theme";
import { Callout, Field, GuillocheField, Key, KeySeal, Seg, TextInput } from "@/ui";
import { FAUCET_ERG, FAUCET_SUSE, HUMANS, BUSINESSES, town, useTown, useWallet, worldText } from "@/world";
import { copy, pick } from "@/content";
import { setPrefs, useAfterFirstPaint, useFmt, useNameOf, useOutcomeToast, usePrefs } from "../lib/hooks";
import { saveText } from "../lib/download";
import { PartySeal, SandboxTag, StepDots } from "../parts/bits";

type KeyMode = "create" | "hex" | "file";

const errCode = (e: unknown): string => (e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "unknown");

/** The FAQ answer the onboarding's "why?" opens: why ordinary Ergo wallets cannot sign notes. */
export const WHY_NO_WALLET_HREF = "/learn/faq#q-nautilus";

/** Without a key every wallet tab shows the onboarding; this names what the tab will hold (null on /wallet itself). */
export function whereKey(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/wallet" || !p.startsWith("/wallet/")) return null;
  const sub = p.slice("/wallet/".length).split("/")[0];
  return sub === "notes" || sub === "reserve" || sub === "settings" ? `wallet.onb.where.${sub}` : "wallet.onb.where.other";
}

export function Onboarding() {
  const t = useT();
  const where = whereKey(useLocation().pathname);
  const { identity } = useWallet();
  const joined = useTown((s) => s.joined);
  const p = usePrefs();
  const { theme } = useTheme();
  const step = !identity ? 0 : !identity.backedUp && !p.backupSkipped && !joined ? 1 : 2;
  const fieldReady = useAfterFirstPaint();
  return (
    <div className="wl-onb">
      <div className="wl-onb-hero">
        {fieldReady && <GuillocheField className="wl-field" seed={identity?.pubHex ?? "basis-sandbox-wallet"} still lines={30} rings={12} dim={theme === "cotton" ? 1.05 : 1.6} focus={[0.78, 0.4]} />}
        <div className="wl-onb-eyebrow">
          <SandboxTag />
          <StepDots n={3} at={step} label={t("wallet.onb.steps", { n: step + 1 })} />
        </div>
        {where && <p className="wl-onb-where">{t(where)}</p>}
        <h1 className="t-h1 wl-onb-h">
          {t(`wallet.onb.h.${step}`)}
          <em> {t(`wallet.onb.em.${step}`)}</em>
        </h1>
        <p className="t-lede wl-onb-lede">{t(`wallet.onb.lede.${step}`)}</p>
        {step === 0 && (
          <p className="wl-onb-why">
            {t("wallet.onb.why")} <Link className="textlink" to={WHY_NO_WALLET_HREF}>{t("wallet.onb.whyLink")}</Link>
          </p>
        )}
      </div>
      <div className="wl-onb-body">
        {step === 0 && <StepKey />}
        {step === 1 && identity && <StepBackup />}
        {step === 2 && identity && <StepJoin />}
        <Callout tone="sandbox" title={t("wallet.sandbox.title")} className="wl-sbx-note">
          {pick(copy.sandboxKey, t.lang)} {t("wallet.sandbox.noReal")}
        </Callout>
      </div>
      {/* under the headline on a wide screen; after the form on a phone, so the first key stays in view */}
      <TownStrip />
    </div>
  );
}

const TOWNSFOLK = [...HUMANS, ...BUSINESSES, "scout", "quill"];

/** Who already lives in the sandbox town: the residents' key seals and names. */
function TownStrip() {
  const t = useT();
  const nameOf = useNameOf();
  return (
    <figure className="wl-town" aria-label={t("wallet.onb.town")}>
      <figcaption className="label">{t("wallet.onb.town")}</figcaption>
      <ul>
        {TOWNSFOLK.map((id) => (
          <li key={id}>
            <PartySeal id={id} size="md" rim={false} />
            <span>{nameOf(id)}</span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

function IdentityCard() {
  const t = useT();
  const { identity } = useWallet();
  if (!identity) return null;
  return (
    <div className="wl-idcard">
      <KeySeal pk={identity.pubHex} size="xl" />
      <div>
        <div className="label">{t("wallet.onb.yourKey")}</div>
        <div className="wl-idcard-words">{identity.words.join(" · ")}</div>
        <div className="mono t-small">
          {t("wallet.onb.fp")} {identity.fingerprint}
        </div>
        <p className="t-small">{t("wallet.onb.wordsAre")}</p>
      </div>
    </div>
  );
}

function StepKey() {
  const t = useT();
  const [mode, setMode] = useState<KeyMode>("create");
  const [hex, setHex] = useState("");
  const [pass, setPass] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(t(`wallet.err.${errCode(e)}`));
    } finally {
      setBusy(false);
    }
  };
  const hexOk = /^[0-9a-fA-F]{64}$/.test(hex.trim());
  return (
    <div className="wl-form">
      <Seg
        ariaLabel={t("wallet.onb.how")}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setErr(null);
        }}
        options={[
          { value: "create", label: t("wallet.onb.create") },
          { value: "hex", label: t("wallet.onb.importHex") },
          { value: "file", label: t("wallet.onb.importFile") },
        ]}
      />
      {mode === "create" && (
        <>
          <p className="t-body">{t("wallet.onb.createB")}</p>
          <Key variant="primary" size="lg" icon="stamp" disabled={busy} onClick={() => void run(() => town.createIdentity({}))}>
            {t("wallet.onb.createKey")}
          </Key>
        </>
      )}
      {mode === "hex" && (
        <>
          <Field label={t("wallet.onb.hexLabel")} help={t("wallet.onb.hexHelp")} error={hex && !hexOk ? t("wallet.err.invalid-hex") : undefined}>
            <TextInput value={hex} onChange={(v) => setHex(v.replace(/\s/g, ""))} mono type="password" autoComplete="off" placeholder="64 hex" />
          </Field>
          <Key variant="primary" size="lg" disabled={busy || !hexOk} onClick={() => void run(() => town.importIdentity(hex.trim()))}>
            {t("wallet.onb.importKey")}
          </Key>
        </>
      )}
      {mode === "file" && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setFileName(f.name);
              void f.text().then(setFile);
            }}
          />
          <Key variant="default" icon="note" onClick={() => fileRef.current?.click()}>
            {fileName || t("wallet.onb.pickFile")}
          </Key>
          <Field label={t("wallet.onb.pass")}>
            <TextInput value={pass} onChange={setPass} type="password" autoComplete="current-password" />
          </Field>
          <Key variant="primary" size="lg" disabled={busy || !file || pass.length < 8} onClick={() => void run(() => town.importBackup(file!, pass))}>
            {t("wallet.onb.restore")}
          </Key>
        </>
      )}
      {err && <Callout tone="alarm">{err}</Callout>}
    </div>
  );
}

function StepBackup() {
  const t = useT();
  const { identity } = useWallet();
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [json, setJson] = useState<string | null>(null);
  const [w2, setW2] = useState("");
  const [w3, setW3] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [skip, setSkip] = useState(false);
  if (!identity) return null;
  const weak = pass.length > 0 && pass.length < 8;
  const mismatch = pass2.length > 0 && pass2 !== pass;
  const norm = (s: string) => s.trim().toLowerCase();
  const wordsOk = norm(w2) === identity.words[1].toLowerCase() && norm(w3) === identity.words[2].toLowerCase();
  const download = async () => {
    setBusy(true);
    setErr(null);
    try {
      const b = await town.wallet.exportBackup(pass);
      saveText(b.json, b.filename);
      setJson(b.json);
    } catch (e) {
      setErr(t(`wallet.err.${errCode(e)}`));
    } finally {
      setBusy(false);
    }
  };
  const confirm = async () => {
    if (!json) return;
    setBusy(true);
    try {
      const ok = await town.wallet.verifyBackup(json, pass);
      if (!ok) setErr(t("wallet.err.wrong-passphrase"));
    } catch (e) {
      setErr(t(`wallet.err.${errCode(e)}`));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wl-form">
      <IdentityCard />
      {!json ? (
        <>
          <Field label={t("wallet.onb.pass")} help={t("wallet.onb.passHelp")} error={weak ? t("wallet.err.weak-passphrase") : undefined}>
            <TextInput value={pass} onChange={setPass} type="password" autoComplete="new-password" />
          </Field>
          <Field label={t("wallet.onb.pass2")} error={mismatch ? t("wallet.onb.mismatch") : undefined}>
            <TextInput value={pass2} onChange={setPass2} type="password" autoComplete="new-password" />
          </Field>
          <Key variant="primary" size="lg" disabled={busy || pass.length < 8 || pass !== pass2} onClick={() => void download()}>
            {t("wallet.onb.download")}
          </Key>
        </>
      ) : (
        <>
          <Callout tone="proof" title={t("wallet.onb.saved")}>
            {t("wallet.onb.savedB")}
          </Callout>
          <div className="wl-words2">
            <Field label={t("wallet.onb.word", { n: 2 })}>
              <TextInput value={w2} onChange={setW2} autoComplete="off" />
            </Field>
            <Field label={t("wallet.onb.word", { n: 3 })}>
              <TextInput value={w3} onChange={setW3} autoComplete="off" />
            </Field>
          </div>
          <Key variant="primary" size="lg" disabled={busy || !wordsOk} onClick={() => void confirm()}>
            {t("wallet.onb.check")}
          </Key>
          <button type="button" className="textlink t-small" onClick={() => setJson(null)}>
            {t("wallet.onb.again")}
          </button>
        </>
      )}
      {err && <Callout tone="alarm">{err}</Callout>}
      {!skip ? (
        <button type="button" className="textlink t-small wl-skip" onClick={() => setSkip(true)}>
          {t("wallet.onb.skip")}
        </button>
      ) : (
        <Callout tone="alarm" title={t("wallet.onb.skipT")}>
          <p>{t("wallet.onb.skipB")}</p>
          <div className="wl-act">
            <Key size="sm" variant="danger" onClick={() => setPrefs({ backupSkipped: true })}>
              {t("wallet.onb.skipYes")}
            </Key>
            <Key size="sm" variant="quiet" onClick={() => setSkip(false)}>
              {t("wallet.onb.skipNo")}
            </Key>
          </div>
        </Callout>
      )}
    </div>
  );
}

const ERG = { id: "erg", symbol: "ERG", decimals: 9 } as const;
const SUSE = { id: "token:suse", symbol: "sUSE", decimals: 3 } as const;

function StepJoin() {
  const t = useT();
  const f = useFmt();
  const show = useOutcomeToast();
  const { identity } = useWallet();
  const [name, setName] = useState(identity?.name && identity.name !== "You" ? identity.name : "");
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    try {
      setPrefs({ tourDone: false });
      const nm = name.trim();
      const o = await town.join({ name: nm || undefined });
      if (o.ok && nm) town.wallet.rename(nm);
      show(o);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="wl-form">
      <IdentityCard />
      <Field label={t("wallet.onb.name")} help={t("wallet.onb.nameHelp")}>
        <TextInput value={name} onChange={(v) => setName(v.slice(0, 24))} autoComplete="nickname" placeholder={t("wallet.onb.namePh")} />
      </Field>
      <p className="t-body">{f.prose(worldText("world.join.about", { erg: f.amt(FAUCET_ERG, ERG, { unit: true }), suse: f.amt(FAUCET_SUSE, SUSE, { unit: true }) }, t.lang))}</p>
      <ul className="wl-facts">
        <li>{t("wallet.onb.gets.welcome")}</li>
        <li>{t("wallet.onb.gets.cafe")}</li>
        <li>{t("wallet.onb.gets.contacts")}</li>
      </ul>
      <Key variant="primary" size="lg" icon="coin" disabled={busy} onClick={() => void join()}>
        {t("wallet.onb.join")}
      </Key>
    </div>
  );
}
