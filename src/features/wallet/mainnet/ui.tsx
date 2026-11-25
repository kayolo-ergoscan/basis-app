// Shared pieces of the mainnet wallet screens: the MAINNET seal, amounts, problems in plain words, the unlock card,
// the gates (key, backup, unlocked), step ladders and the transaction review (TxLens over the real transaction).
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { explorer } from "@/chain/links";
import { Callout, Card, CopyButton, CoverageTag, Field, Hex, HouseLights, Icon, Key, Lamp, Ledger, Num, Tag, TextInput, units, type LampState, type LedgerRow } from "@/ui";
import { TxLens } from "@/viz";
import { dpOf, reserveTag, type OwnReserve } from "@/mainnet/flows";
import type { TrackedReserve } from "@/chain/ours";
import { isVaultError, type MainnetVault, type VaultState } from "@/mainnet/vault";
import type { Problem } from "@/mainnet/net";
import { simTxOf, type ErgoBox, type UnsignedTx } from "@/mainnet/tx";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");

/** "MAINNET · real ERG": on every mainnet screen (design §4.4). */
export function MainnetSeal({ small }: { small?: boolean }) {
  const t = useT();
  return <Tag tone="metal" glyph="◆" className={cx("mw-seal", small && "sm")} title={t("mw.seal.title")}>{t("mw.seal")}</Tag>;
}

/** nanoERG with as many decimals as it needs (at least 2). */
export function Erg({ nano, sign, tone, unit = true }: { nano: bigint; sign?: "favour" | "owe" | "none"; tone?: "up" | "alarm" | "metal" | "dim"; unit?: boolean }) {
  return <Num value={nano} decimals={9} dp={dpOf(nano)} unit={unit ? "ERG" : undefined} sign={sign ?? "auto"} tone={tone} reveal />;
}

/** ERG as text inside a sentence, formatted exactly like <Erg>: the kit's units() in the page language («9,545 ERG»,
 *  "9.545 ERG"). */
export const ergText = (nano: bigint): string => `${units(nano, 9, dpOf(nano))}\u00a0ERG`;

/** A link to ergoscan.me for a transaction, box or address. */
/** The reserve's tag on Home and Reserve: its coverage band, or a calm "settling" while a redemption waits for the chain. */
export function ReserveTag({ r, small }: { r: TrackedReserve; small?: boolean }) {
  const t = useT();
  const tag = reserveTag(r);
  if (tag.kind === "none") return null;
  if (tag.kind === "band") return <CoverageTag pct={tag.pct} small={small} />;
  return <Tag glyph={small ? undefined : "◷"} style={small ? { height: 18 } : undefined}>{t("mw.res.settlingTag")}</Tag>;
}

export function ChainLink({ kind, id, children }: { kind: "tx" | "box" | "address"; id: string; children?: ReactNode }) {
  return (
    <a className="mw-link" href={explorer[kind](id)} target="_blank" rel="noreferrer">
      {children ?? <span className="mono">{id.slice(0, 8)}…{id.slice(-4)}</span>}
      <Icon name="ext" size={13} />
    </a>
  );
}

/** A problem in the words of design §6.3, with the server's own reason as plain text (never HTML). */
/** A problem in words, with the server's own text under it. `reasonOnly`: only that text, when the caller has
 *  already said what the answer means (a redemption in doubt: "replaced" would wrongly say nothing was sent). */
export function ProblemText({ p, what, reasonOnly }: { p: Problem; what?: "create" | "build" | "submit" | "note" | "broadcast" | "read"; reasonOnly?: boolean }) {
  const t = useT();
  if (reasonOnly) return p.reason ? <span className="mw-problem"><span className="mw-reason">{t("mw.err.says")} <q>{p.reason}</q></span></span> : null;
  const secs = p.retryInMs !== null ? Math.max(1, Math.ceil(p.retryInMs / 1000)) : null;
  let text: string;
  switch (p.kind) {
    case "busy": text = secs ? t("mw.err.busyIn", { s: secs }) : t("mw.err.busy"); break;
    case "restarting": text = t("mw.err.restarting"); break;
    case "low-funds": text = t("mw.err.lowFunds"); break;
    case "unavailable": text = t("mw.err.unavailable"); break;
    case "replaced": text = t("mw.err.replaced"); break;
    case "waiting-chain": text = t("mw.err.waitingChain"); break;
    case "cap": text = t("mw.err.cap"); break;
    case "reopen-blocked": text = t("mw.err.reopenBlocked"); break;
    case "conflict": text = what === "note" ? t("mw.err.conflictNote") : t("mw.err.conflict"); break;
    case "future-ts": text = t("mw.err.futureTs"); break;
    case "past-ts": text = t("mw.err.pastTs"); break;
    case "refused": text = what === "broadcast" ? t("mw.err.nodeRefused") : t("mw.err.refused"); break;
    case "not-found": text = t("mw.err.notFound"); break;
    case "too-large": text = t("mw.err.tooLarge"); break;
    case "timeout": text = t("mw.err.timeout"); break;
    case "network": text = t("mw.err.network"); break;
    case "aborted": text = t("mw.err.aborted"); break;
    case "shape": text = t("mw.err.shape"); break;
    case "clock-skew": text = t("mw.err.clockSkew"); break;
    case "stale-ts": text = t("mw.err.staleTs"); break;
    case "submit-unknown": text = t("mw.err.submitUnknown"); break;
    case "not-submitted": text = t("mw.err.notSubmitted"); break;
    default: text = t("mw.err.http", { status: p.status ?? "—" });
  }
  return (
    <span className="mw-problem">
      {text}
      {p.reason && <span className="mw-reason">{t("mw.err.says")} <q>{p.reason}</q></span>}
      {p.kind === "waiting-chain" && p.txId && <> <ChainLink kind="tx" id={p.txId} /></>}
    </span>
  );
}

/** Vault errors in words (the vault has no texts: README "Errors"). */
export function useVaultError(): (e: unknown) => string {
  const t = useT();
  return (e) => {
    if (isVaultError(e)) return t(`mw.vault.${e.code}`);
    return t("mw.vault.unknown");
  };
}

// ─── steps ──────────────────────────────────────────────────────────────────────────────────────

export interface StepItem { id: string; label: ReactNode; sub?: ReactNode; state: "done" | "now" | "todo" | "fail" }
const LAMP: Record<StepItem["state"], LampState> = { done: "committed", now: "tracked", todo: "signed", fail: "alarm" };

/** A vertical ladder of states (○ ◐ ●): what happened, what happens now, what is next. With `house`, the setup
 *  checklist also shows your house beside it: one window per step, lit when done (decoration; the list says it). */
export function Steps({ items, label, house }: { items: StepItem[]; label: string; house?: boolean }) {
  if (house) {
    const now = items.findIndex((s) => s.state === "now");
    return (
      <div className="mw-steps-house">
        <Steps items={items} label={label} />
        <HouseLights steps={items.map((s) => s.state === "done")} now={now < 0 ? undefined : now} size={76} />
      </div>
    );
  }
  return (
    <ol className="mw-steps" aria-label={label}>
      {items.map((s) => (
        <li key={s.id} className={cx("mw-step", s.state)} aria-current={s.state === "now" ? "step" : undefined}>
          <Lamp state={LAMP[s.state]} size={12} />
          <span className="mw-step-t">
            <span className="mw-step-l">{s.label}</span>
            {s.sub && <span className="mw-step-s">{s.sub}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

// ─── unlock ─────────────────────────────────────────────────────────────────────────────────────

/** Opens the session in this tab (one 600 000-iteration derivation, about a second). */
export function UnlockCard({ vault, state, why }: { vault: MainnetVault; state: VaultState; why?: ReactNode }) {
  const t = useT();
  const verr = useVaultError();
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [elsewhere, setElsewhere] = useState(false);
  const go = async (takeOver: boolean) => {
    setBusy(true);
    setErr(null);
    try {
      await vault.unlock(pass, { takeOver });
      setPass("");
    } catch (e) {
      if (isVaultError(e, "locked-elsewhere")) setElsewhere(true);
      else setErr(verr(e));
    } finally {
      setBusy(false);
    }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (pass && !busy) void go(false); };
  return (
    <Card className="mw-unlock" title={t("mw.unlock.title")} aside={<Lamp state="signed" label={t("mw.unlock.locked")} />}>
      <form onSubmit={submit} className="mw-form">
        <p className="t-small">{why ?? t("mw.unlock.why")}</p>
        {state.lockReason && state.lockReason !== "manual" && <p className="t-small mw-dim">{t(`mw.lock.${state.lockReason}`)}</p>}
        <Field label={t("mw.pass.label")} error={err ?? undefined}>
          <TextInput type="password" autoComplete="current-password" value={pass} onChange={setPass} />
        </Field>
        {elsewhere ? (
          <Callout tone="calm" title={t("mw.unlock.elsewhereT")}>
            <p>{t("mw.unlock.elsewhereB")}</p>
            <Key variant="primary" onClick={() => void go(true)} disabled={busy}>{t("mw.unlock.takeOver")}</Key>
          </Callout>
        ) : (
          <Key variant="primary" type="submit" disabled={!pass || busy} block>{busy ? t("mw.unlock.busy") : t("mw.unlock.go")}</Key>
        )}
      </form>
    </Card>
  );
}

/** Shows `children` only when the key exists, is backed up and (when asked) unlocked; otherwise the next step. */
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
  if (backup && !state.backedUp) {
    return (
      <Callout tone="alarm" title={t("mw.gate.backupT")}>
        <p>{t("mw.gate.backupB")}</p>
        <Key variant="primary" to="/wallet/mainnet/setup">{t("mw.gate.backupGo")}</Key>
      </Callout>
    );
  }
  if (unlocked && state.status !== "unlocked") return <UnlockCard vault={vault} state={state} why={why} />;
  return <>{children}</>;
}

// ─── review ─────────────────────────────────────────────────────────────────────────────────────

/** The real transaction before the hold: the arithmetic, the id, and TxLens over exactly these bytes. */
export function TxReview({ tx, inputs, dataInputs = [], signers, height, rows, sum, txId, extra }: {
  tx: UnsignedTx; inputs: readonly ErgoBox[]; dataInputs?: readonly ErgoBox[]; signers: string[]; height: number;
  rows: LedgerRow[]; sum?: LedgerRow; txId: string; extra?: ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const sim = open ? simTxOf({ tx, inputs, dataInputs, signers, height }) : null;
  return (
    <div className="mw-review">
      <Ledger rows={rows} sum={sum} caption={t("mw.review.caption")} />
      <div className="mw-txid">
        <span className="label">{t("mw.review.txid")}</span>
        <Hex value={txId} head={10} tail={8} copy />
      </div>
      <p className="t-small mw-dim">{t("mw.review.counts", { inputs: inputs.length, outputs: tx.outputs.length })}</p>
      {extra}
      <button type="button" className="textlink t-small" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? t("mw.review.hideTx") : t("mw.review.showTx")}
      </button>
      {open && (sim ? <TxLens tx={sim} title={t("mw.review.lens")} /> : <p className="t-small mw-dim">{t("mw.review.noLens")}</p>)}
    </div>
  );
}

/** Copies a text the user may attach to a report (the build JSON when a check fails). */
export function CopyReport({ text, label }: { text: string; label: string }) {
  return <CopyButton value={text} label={label} />;
}

/** The small "what happens next" aside with the timings of design §6.5. */
export function TimeHint({ k }: { k: "deposit" | "t1" | "note" | "redeem" | "refund" }) {
  const t = useT();
  return <span className="mw-time"><Icon name="clock" size={14} />{t(`mw.time.${k}`)}</span>;
}

export function BackLink({ to = "/wallet/mainnet", children }: { to?: string; children?: ReactNode }) {
  const t = useT();
  return <Link className="mw-back textlink t-small" to={to}>← {children ?? t("mw.nav.home")}</Link>;
}

/** Why the wallet does not act on "your reserve" (review 2: never a planted box), in words; the boxes when listed. */
export function OwnReserveRefusal({ own }: { own: Exclude<OwnReserve, { ok: true }> }) {
  const t = useT();
  if (own.why === "none") return <p className="t-small">{t("mw.top.noOwn")}</p>;
  if (own.why === "unchecked") return <Callout tone="calm" title={t("mw.res.uncheckedT")}>{t("mw.trust.uncheckedB")}</Callout>;
  return (
    <Callout tone="alarm" title={t("mw.top.trustT")}>
      {t(`mw.trust.${own.why}`, own.why === "mismatch" ? { nft: `${own.nft.slice(0, 8)}…` } : undefined)}
      {own.why === "mismatch" && <BoxList boxes={own.boxes} />}
    </Callout>
  );
}

/** Reserve-tree boxes at the key that are not its reserve: ignored for signing, listed so nobody is surprised. */
export function OtherBoxesNote({ own }: { own: Extract<OwnReserve, { ok: true }> }) {
  const t = useT();
  if (own.others.length === 0) return null;
  return (
    <Callout tone="policy" title={t("mw.trust.othersT")}>
      {t("mw.trust.others", { nft: `${own.nft.slice(0, 8)}…` })}
      <BoxList boxes={own.others} />
    </Callout>
  );
}

function BoxList({ boxes }: { boxes: readonly { box: { boxId: string; tokens: readonly { tokenId: string }[] } }[] }) {
  return (
    <ul className="mw-facts mw-facts-tight">
      {boxes.map((b) => <li key={b.box.boxId}><ChainLink kind="box" id={b.box.boxId} /> <span className="mono t-small mw-dim">{b.box.tokens[0]?.tokenId.slice(0, 8) ?? "—"}…</span></li>)}
    </ul>
  );
}

/** The same refusal as one line of text (a stop callout after Prepare). */
export function trustText(t: ReturnType<typeof useT>, own: Exclude<OwnReserve, { ok: true }>): string {
  if (own.why === "none") return t("mw.top.noOwn");
  return t(`mw.trust.${own.why}`, own.why === "mismatch" ? { nft: `${own.nft.slice(0, 8)}…` } : undefined);
}
