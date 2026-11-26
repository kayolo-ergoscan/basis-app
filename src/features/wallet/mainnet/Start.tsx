// /wallet/mainnet/setup — the mainnet key (design §4, D4 = K1): create one (a random 32-byte key, encrypted with the
// passphrase), download the backup file and prove it by loading it back (mandatory before funding and before any
// signature), or restore from a backup file, or bring in an existing key: from the seed phrase of Nautilus or another
// Ergo wallet (EIP-3, one chosen address), or (for experts) as hex. The wallet itself makes no seed words and keeps none.
// One key per browser: a key already here is never replaced (the vault refuses, and the screen says where a second
// key goes).
import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { useT } from "@/app/lang";
import { Callout, Card, Field, Hex, Icon, Key, KeySeal, Seg, Switch, Tag, TextInput, short, HouseLights, useHoldHeight } from "@/ui";
import { SEED_MAX_INDEX, VAULT, checkPassphrase, normalizeMnemonic, parseBackup, type BackupExtras, type SeedKey, type SeedProblem } from "@/mainnet/vault";
import { watchIssuer } from "@/mainnet/flows";
import { useMw } from "./ctx";
import { useWatchList } from "./data";
import { findExpected, importSeedKey, listSeedKeys, type SeedFields } from "./seedflow";
import { cx, useVaultError } from "./ui";
import { BackupSteps, readFile } from "./gate";

/** The four warnings of a mainnet key: small amounts, the key only here, browsers that forget, an experiment. */
function WarnList() {
  const t = useT();
  return (
    <ul className="mw-warn-list">
      <li><Icon name="warn" size={16} />{t("mw.warn.small")}</li>
      <li><Icon name="lock" size={16} />{t("mw.warn.key")}</li>
      <li><Icon name="info" size={16} />{t("mw.warn.storage")}</li>
      <li><Icon name="info" size={16} />{t("mw.warn.experimental")}</li>
    </ul>
  );
}

/** Where «why not my Ergo wallet?» is answered (the sandbox start links the same FAQ answer). */
export const WHY_NOT_ERGO_WALLET = "/learn/faq#q-nautilus";

/** The title and the lede; before a key exists, why an ordinary Ergo wallet is not enough (and what it is still good
 *  for); the four warnings under them once a key exists (its backup step, the done screen). */
function Hero({ warnings }: { warnings: boolean }) {
  const t = useT();
  return (
    <div className="mw-hero">
      <h1 className="t-h1 mw-hero-h">{t("mw.start.h1a")} <em>{t("mw.start.h1b")}</em></h1>
      <p className="t-lede mw-hero-lede">{t("mw.start.lede")}</p>
      {!warnings && (
        <p className="mw-why">
          {t("mw.start.why")} <Link className="textlink" to={WHY_NOT_ERGO_WALLET}>{t("mw.start.whyLink")}</Link> {t("mw.start.whyFund")}
        </p>
      )}
      {warnings && <WarnList />}
    </div>
  );
}

/** Before a key exists the form comes first: one line says what matters, and the four warnings open under it. */
function WarnLine() {
  const t = useT();
  return (
    <div className="mw-warn-one">
      <p className="mw-warn-line"><Icon name="warn" size={16} />{t("mw.start.warnLine")}</p>
      <details className="mw-warn-more">
        <summary>{t("mw.start.warnMore")}</summary>
        <WarnList />
      </details>
    </div>
  );
}

/** The whole setup as a quest: five steps, one window each; this screen lights the first two (key, backup). */
function QuestMap({ lit }: { lit: number }) {
  const t = useT();
  const steps = ["key", "backup", "fund", "reserve", "note"];
  return (
    <section className="mw-questmap" aria-labelledby="mw-questmap-h">
      <HouseLights steps={steps.map((_, i) => i < lit)} now={lit < steps.length ? lit : undefined} size={64} />
      <div>
        <h2 className="label" id="mw-questmap-h"><b>{t("mw.home.quest.t")}</b></h2>
        <p className="t-small mw-dim">{t("mw.start.quest.b")}</p>
        <ol className="mw-questmap-l">
          {steps.map((k, i) => <li key={k} className={i < lit ? "done" : i === lit ? "now" : undefined}>{t(`mw.home.c.${k}`)}</li>)}
        </ol>
      </div>
    </section>
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
function NewPassphrase({ onSubmit, busy, label, extra, understand }: { onSubmit: (p: string) => void; busy: boolean; label: string; extra?: ReactNode; understand?: string }) {
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
      <Switch checked={ok} onChange={setOk} label={understand ?? t("mw.start.understand")} />
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

// keys review P2-5 for the seed words too, and review M2: the words and the mnemonic password live only in these two
// fields (the DOM, never React state), outside the passphrase form. Both are password fields, so phone keyboards neither
// learn nor suggest from them (iOS also takes the system keyboard there). They say autocomplete="one-time-code": Chromium
// then never offers to save them, which clearing them does not achieve (measured 2026-11-25 on Chromium 157: a formless
// password field typed, emptied by script and removed still raised "Save password?"; with one-time-code no prompt).
// Password managers, spell checkers and writing aids are told to skip them (a cloud spell check would send the words).
const SKIP = {
  autoComplete: "one-time-code", autoCapitalize: "off", autoCorrect: "off", spellCheck: false, writingsuggestions: "false",
  "data-1p-ignore": "", "data-lpignore": "true", "data-bwignore": "", "data-form-type": "other",
  "data-gramm": "false", "data-gramm_editor": "false", "data-enable-grammarly": "false", "data-lt-active": "false",
} as const;

interface SecretProps { id?: string; "aria-describedby"?: string; name: string; invalid?: boolean; shown: boolean; onInput: () => void; trailing: ReactNode; flat?: boolean }

/** A password field whose value React never holds. `flat`: a paste with line breaks or tabs comes in as one line of
 *  single spaces (a phrase copied as a column), wherever the browser would otherwise join the words. */
const SecretField = forwardRef<HTMLInputElement, SecretProps>(function SecretField({ id, name, invalid, shown, onInput, trailing, flat, ...aria }, ref) {
  const paste = (e: ClipboardEvent<HTMLInputElement>) => {
    const s = e.clipboardData.getData("text/plain");
    if (!flat || !/[\r\n\t\u00a0\u200b-\u200d\u2060]/u.test(s)) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setRangeText(s.replace(/[\s\u200b-\u200d\u2060]+/gu, " ").trim(), el.selectionStart ?? el.value.length, el.selectionEnd ?? el.value.length, "end");
    onInput();
  };
  return (
    <div className={cx("input text", invalid && "err")}>
      <input ref={ref} type={shown ? "text" : "password"} id={id} aria-describedby={aria["aria-describedby"]} aria-invalid={invalid || undefined} name={name} onInput={onInput} onPaste={paste} {...SKIP} />
      {trailing}
    </div>
  );
});

const FIRST_SHOWN = 5;
const MORE_STEP = 10;

/** From the seed phrase of Nautilus or another Ergo wallet: the words → addresses 0–49 → the chosen key, through
 *  vault.importHex under a new Basis passphrase. */
function ImportSeed() {
  const t = useT();
  const { vault } = useMw();
  const verr = useVaultError();
  const wordsEl = useRef<HTMLInputElement>(null);
  const passEl = useRef<HTMLInputElement>(null);
  const [shown, setShown] = useState(false);
  const [passShown, setPassShown] = useState(false);
  // public only: how many words are typed, indexes, public keys, addresses
  const [count, setCount] = useState(0);
  const [keys, setKeys] = useState<SeedKey[] | null>(null);
  const [problem, setProblem] = useState<SeedProblem | null>(null);
  const [upto, setUpto] = useState(FIRST_SHOWN);
  const [pick, setPick] = useState<number | null>(null);
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState<"list" | "import" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const fields = useMemo<SeedFields>(() => ({
    words: () => wordsEl.current?.value ?? "",
    password: () => passEl.current?.value ?? "",
    clear: () => {
      if (wordsEl.current) wordsEl.current.value = "";
      if (passEl.current) passEl.current.value = "";
      setCount(0);
    },
  }), []);
  const forget = () => {
    setKeys(null);
    setProblem(null);
    setPick(null);
    setUpto(FIRST_SHOWN);
    setErr(null);
  };
  const typed = () => {
    forget();
    const phrase = normalizeMnemonic(wordsEl.current?.value ?? "");
    setCount(phrase ? phrase.split(" ").length : 0);
  };
  // the fields are emptied while they are still on the page (a layout effect's cleanup runs before React removes them):
  // on leaving this screen (another tab of it, another page), on leaving the page, and after the tab stayed hidden as
  // long as the vault waits before it locks (review L3)
  useLayoutEffect(() => {
    const w = wordsEl.current;
    const p = passEl.current;
    const clear = () => {
      if (w) w.value = "";
      if (p) p.value = "";
    };
    const drop = () => { clear(); forget(); setCount(0); };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const vis = () => {
      if (timer !== null) clearTimeout(timer);
      timer = document.visibilityState === "hidden" ? setTimeout(drop, VAULT.HIDDEN_LOCK_MS) : null;
    };
    addEventListener("pagehide", drop);
    document.addEventListener("visibilitychange", vis);
    return () => {
      removeEventListener("pagehide", drop);
      document.removeEventListener("visibilitychange", vis);
      if (timer !== null) clearTimeout(timer);
      clear();
    };
  }, []);
  const match = keys ? findExpected(keys, expected) : null;
  const found = match?.k === "found" ? match.key.index : null;
  const shownUpto = Math.min(SEED_MAX_INDEX, Math.max(upto, found !== null ? found + 1 : 0, pick !== null ? pick + 1 : 0));
  const picked = keys && pick !== null ? keys[pick] ?? null : null;
  // an address is expected and this is not it: said next to the import (review L1)
  const notExpected = picked !== null && expected.trim() !== "" && found !== picked.index;

  const list = async () => {
    setBusy("list");
    setErr(null);
    try {
      const r = await listSeedKeys(fields);
      if (!r.ok) {
        forget();
        setProblem(r.problem);
        return;
      }
      setProblem(null);
      setKeys(r.keys);
      setUpto(FIRST_SHOWN);
      const m = findExpected(r.keys, expected);
      setPick(m.k === "found" ? m.key.index : null);
    } catch (e) { setErr(verr(e)); } finally { setBusy(null); }
  };
  const go = async (pass: string) => {
    if (!picked) return;
    setBusy("import");
    setErr(null);
    try {
      const r = await importSeedKey(vault, fields, picked, pass);
      if (!r.ok) {
        forget();
        setErr(t("mw.start.seed.changed"));
        return;
      }
      // the key is in: the backup steps follow (this form goes away); nothing is kept
      forget();
      setExpected("");
    } catch (e) { setErr(verr(e)); } finally { setBusy(null); }
  };
  const problemText = problem
    ? problem.reason === "word" ? t("mw.start.seed.word", { n: problem.at }) : problem.reason === "count" ? t("mw.start.seed.count", { n: problem.count }) : t(`mw.start.seed.${problem.reason}`)
    : undefined;
  const expectErr = match?.k === "bad" ? (match.reason === "notP2pk" ? t("mw.start.seedExpectNotP2pk") : t(`mw.pay.to.${match.reason}`)) : undefined;
  const toggle = (on: boolean, set: (v: boolean) => void) => (
    <button type="button" className="key sm quiet" aria-pressed={on} onClick={() => set(!on)}>{on ? t("mw.set.hexHide") : t("mw.start.hexShow")}</button>
  );
  return (
    <>
      <p className="mw-seedtip"><Icon name="info" size={15} />{t("mw.start.seedTip")}</p>
      <p className="t-body">{t("mw.start.seedB")}</p>
      <Field label={t("mw.start.seedLabel")} help={count > 0 ? `${t("mw.start.seedCount", { n: count })} ${t("mw.start.seedHelp")}` : t("mw.start.seedHelp")} error={problemText}>
        <SecretField ref={wordsEl} name="basis-seed-import" flat shown={shown} onInput={typed} trailing={toggle(shown, setShown)} />
      </Field>
      <Field label={t("mw.start.seedPassL")} help={t("mw.start.seedPassHelp")}>
        <SecretField ref={passEl} name="basis-seed-extra" shown={passShown} onInput={forget} trailing={toggle(passShown, setPassShown)} />
      </Field>
      <div className="mw-actions">
        <Key variant={keys ? "default" : "primary"} onClick={() => void list()} disabled={busy !== null}>{busy === "list" ? t("mw.start.seedListing") : keys ? t("mw.start.seedRelist") : t("mw.start.seedList")}</Key>
        <Key variant="quiet" onClick={() => { fields.clear(); forget(); setExpected(""); }} disabled={busy !== null}>{t("mw.start.seedClear")}</Key>
      </div>
      {keys && (
        <div className="mw-form">
          <Field label={t("mw.start.seedExpectL")} help={t("mw.start.seedExpectHelp", { n: SEED_MAX_INDEX - 1 })} error={expectErr}>
            <TextInput mono value={expected} onChange={(v) => {
              setExpected(v);
              // a match is chosen; an address that is not among them (or not an address) leaves nothing chosen
              const m = findExpected(keys, v);
              if (m.k === "found") setPick(m.key.index);
              else if (m.k !== "empty") setPick(null);
            }} placeholder="9…" autoComplete="off" autoCapitalize="off" autoCorrect="off" />
          </Field>
          {match?.k === "found" && <Callout tone="proof">{t("mw.start.seedFound", { n: match.key.index })}</Callout>}
          {match?.k === "none" && (
            <Callout tone="info" title={t("mw.start.seedNoneT", { n: SEED_MAX_INDEX - 1 })}>
              <p>{t("mw.start.seedNoneB")}</p>
              <ul className="mw-facts mw-facts-tight">
                <li>{t("mw.start.seedNone1")}</li>
                <li>{t("mw.start.seedNone2")}</li>
                <li>{t("mw.start.seedNone3")}</li>
                <li>{t("mw.start.seedNone4")}</li>
              </ul>
            </Callout>
          )}
          <fieldset className="mw-seedpick">
            <legend className="label">{t("mw.start.seedPick")}</legend>
            <p className="t-small mw-dim">{t("mw.start.seedPickHelp")}</p>
            <ul className="mw-seedlist">
              {keys.slice(0, shownUpto).map((k) => (
                <li key={k.index}>
                  <label className={cx("mw-seedrow", pick === k.index && "on")}>
                    <input type="radio" name="basis-seed-pick" checked={pick === k.index} onChange={() => setPick(k.index)} />
                    <span className="mw-seedrow-i mono">{k.index}</span>
                    <KeySeal pk={k.pub} size="sm" />
                    <span className="mono t-small mw-break">{k.address}</span>
                    {found === k.index && <Tag tone="ok">{t("mw.start.seedMatchTag")}</Tag>}
                  </label>
                </li>
              ))}
            </ul>
            {shownUpto < SEED_MAX_INDEX && (
              <button type="button" className="textlink t-small" onClick={() => setUpto(Math.min(SEED_MAX_INDEX, shownUpto + MORE_STEP))}>
                {t("mw.start.seedMore", { n: Math.min(MORE_STEP, SEED_MAX_INDEX - shownUpto) })}
              </button>
            )}
          </fieldset>
        </div>
      )}
      {picked && (
        <>
          {notExpected && <Callout tone="alarm">{t("mw.start.seedNotExpected", { n: picked.index })}</Callout>}
          <Callout tone="policy" title={t("mw.start.seedWarnT")}>
            <p>{t("mw.start.seedWarnB", { addr: short(picked.address, 8, 6), n: picked.index })}</p>
            <p>{t("mw.start.seedWarnWords")}</p>
          </Callout>
          {/* a new address starts a new form: no passphrase or consent carries over to another key (review L2) */}
          <NewPassphrase key={picked.index} busy={busy === "import"} label={t("mw.start.seedImport")} understand={t("mw.start.seedUnderstand")} onSubmit={(p) => void go(p)} />
        </>
      )}
      {err && <Callout tone="alarm">{err}</Callout>}
    </>
  );
}

/** One key per browser: what to do for a second one (the vault never replaces a key). */
export function OneKeyNote({ address }: { address: string }) {
  const t = useT();
  return <Callout tone="info" title={t("mw.start.oneKeyT")}>{t("mw.start.oneKeyB", { addr: short(address, 8, 6) })}</Callout>;
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

/** Two choices, as in any wallet: a new key, or one you already have; the second holds the three ways in. */
type Mode = "create" | "have";
type Way = "restore" | "seed" | "hex";

export function StartScreen() {
  const t = useT();
  const { state, me } = useMw();
  const [mode, setMode] = useState<Mode>("create");
  const [way, setWay] = useState<Way>("restore");
  const [extras, setExtras] = useState<BackupExtras | null>(null);
  const [, updateWatch] = useWatchList(me?.pub ?? null);
  // the ways to add a key are forms of different heights: the card keeps the tallest one it has shown, so switching
  // back never moves what is below it (motion round; the forms themselves are as they were)
  const formRef = useRef<HTMLDivElement>(null);
  useHoldHeight(formRef, state.status, [mode, way]);
  // a key made or brought in here without its backup goes straight to Home (on /setup too): the backup comes before
  // anything can bring value to it, not now (gate.tsx). A key restored from its backup file stays here for its extras.
  const was = useRef(state.status);
  const [toHome, setToHome] = useState(false);
  useEffect(() => {
    const before = was.current;
    was.current = state.status;
    if (before === "none" && (state.status === "unlocked" || state.status === "locked") && !state.backedUp) setToHome(true);
  }, [state.status, state.backedUp]);
  let body: ReactNode;
  if (state.status === "damaged") body = <Damaged />;
  else if (state.status === "none") {
    body = (
      <>
        <WarnLine />
        <Seg ariaLabel={t("mw.start.modeAria")} value={mode} onChange={setMode}
          options={[{ value: "create", label: t("mw.start.tab.new") }, { value: "have", label: t("mw.start.tab.have") }]} />
        {mode === "create" ? (
          <>
            <p className="t-small mw-dim mw-have-hint">{t("mw.start.haveHint")}</p>
            <CreateKey />
          </>
        ) : (
          <>
            <Seg className="mw-ways" ariaLabel={t("mw.start.wayAria")} value={way} onChange={setWay}
              options={[{ value: "restore", label: t("mw.start.tab.restore") }, { value: "seed", label: t("mw.start.tab.seed") }, { value: "hex", label: t("mw.start.tab.hex") }]} />
            {way === "restore" ? <RestoreFile onExtras={setExtras} /> : way === "seed" ? <ImportSeed /> : <ImportHex />}
          </>
        )}
      </>
    );
  } else if (!state.backedUp) body = <BackupSteps />;
  else body = <Done />;
  const oneKey = (state.status === "locked" || state.status === "unlocked") && state.key ? <OneKeyNote address={state.key.address} /> : null;
  const shownExtras = extras && me && (extras.watchedIssuers?.length ?? 0) > 0 ? extras : null;
  if (toHome) return <Navigate to="/wallet/mainnet" replace />;
  return (
    <div className="mw-start">
      <Hero warnings={state.status !== "none" && state.status !== "loading"} />
      <QuestMap lit={state.status === "locked" || state.status === "unlocked" ? (state.backedUp ? 2 : 1) : 0} />
      <Card className="mw-start-card">
        <div className="mw-form" ref={formRef}>
          {body}
          {oneKey}
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
