// The denomination of the mainnet screens: ERG, SigUSD or rsADA. It is part of the address (`?d=sigusd`, ERG when
// absent), so a link names it and Back keeps it; the switch on Reserve, Top up, Refund, Pay, Receive and Redeem sets it.
// Amounts of one denomination are only ever shown and added up in that denomination: a SigUSD figure is never next to
// an ERG total as if they were one sum. Token decimals are pinned in tx/tokens.ts, never read from the tracker.
import { Fragment, useCallback, type ReactNode } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { Callout, Key, Num, Seg, units } from "@/ui";
import { dpOfUnits, fragmentOf } from "@/mainnet/flows";
import { WALLET_DENOMS, denomDecimals, denomOfSlug, denomSlug, denomSymbol, mergedTokens, p2pkTree, reserveTokenById, reserveTokenOf, tokenIdOf, tokenReserveAddress, type Denomination, type ReserveToken, type Token, type UnsignedTx } from "@/mainnet/tx";
import { R, useResource } from "./data";
import { Erg, ergText } from "./ui";

/** The screen's denomination from `?d=` (absent: ERG), and a setter that keeps the other parameters. An unknown `?d=`
 *  never reaches a screen: DenomGuard shows it instead (review LOW-4), so the ERG fallback here is never shown. */
export function useDenom(): [Denomination, (d: Denomination) => void] {
  const [sp, setSp] = useSearchParams();
  const d = denomOfSlug(sp.get("d")) ?? "erg";
  const set = useCallback((n: Denomination) => {
    setSp((cur) => {
      const next = new URLSearchParams(cur);
      if (n === "erg") next.delete("d"); else next.set("d", denomSlug(n));
      return next;
    }, { replace: true });
  }, [setSp]);
  return [d, set];
}

/** The `d` a link names (`?d=`, or `#…&d=` of a request or redeem link) when it is not ERG, SigUSD or rsADA; else null. */
export function unknownDenomOf(search: string, hash: string): string | null {
  for (const asked of [new URLSearchParams(search).get("d") ?? "", fragmentOf(hash).d ?? ""]) {
    if (asked.trim() !== "" && denomOfSlug(asked) === null) return asked;
  }
  return null;
}

/**
 * Around the mainnet screens: a link with a denomination the wallet does not know shows that, and nothing else (no
 * amounts, no actions), instead of falling back to ERG (review LOW-4).
 */
export function DenomGuard({ children }: { children: ReactNode }) {
  const t = useT();
  const loc = useLocation();
  const unknown = unknownDenomOf(loc.search, loc.hash);
  if (unknown === null) return <>{children}</>;
  return (
    <div className="mw-grid">
      <div className="mw-main">
        <Callout tone="alarm" title={t("mw.dn.unknownT")}>
          <p>{t("mw.dn.unknownB", { d: unknown.slice(0, 40) })}</p>
          <Key size="sm" to="/wallet/mainnet">{t("mw.dn.unknownHome")}</Key>
        </Callout>
      </div>
    </div>
  );
}

/** `?d=…` for a link to another screen in this denomination ("" for ERG: ERG links stay what they were). */
export const denomQuery = (d: Denomination, lead: "?" | "&" = "?"): string => (d === "erg" ? "" : `${lead}d=${denomSlug(d)}`);

/** The three denominations as a switch. `disabled`: while something is being prepared or signed. */
export function DenomSwitch({ value, onChange, disabled, note, send }: { value: Denomination; onChange: (d: Denomination) => void; disabled?: boolean; /** "Note in" (Receive, Redeem), not "Reserve in" */ note?: boolean; /** "Send" (Withdraw): what leaves the key, no reserve */ send?: boolean }) {
  const t = useT();
  return (
    <div className="mw-denoms">
      <span className="label">{t(send ? "mw.dn.labelSend" : note ? "mw.dn.labelNote" : "mw.dn.label")}</span>
      <Seg ariaLabel={t("mw.dn.aria")} value={value} onChange={(v) => { if (!disabled) onChange(v); }}
        options={WALLET_DENOMS.map((d) => ({ value: d, label: denomSymbol(d), title: send ? (d === "erg" ? "ERG" : t("mw.dn.sendTitle", { sym: denomSymbol(d), id: tokenIdOf(d)! })) : d === "erg" ? t("mw.dn.ergTitle") : t("mw.dn.tokenTitle", { sym: denomSymbol(d), id: tokenIdOf(d)! }) }))} />
    </div>
  );
}

/** An amount in its denomination, formatted like <Erg> (ERG: exactly <Erg>). */
export function Amt({ raw, denom, sign, tone }: { raw: bigint; denom: Denomination; sign?: "favour" | "owe" | "none"; tone?: "up" | "alarm" | "metal" | "dim" }) {
  if (denom === "erg") return <Erg nano={raw} sign={sign} tone={tone} />;
  const dec = denomDecimals(denom);
  return <Num value={raw} decimals={dec} dp={dpOfUnits(raw, dec)} unit={denomSymbol(denom)} sign={sign ?? "auto"} tone={tone} reveal />;
}

/** The same amount as text inside a sentence («12,5 SigUSD»). */
export const amtText = (raw: bigint, denom: Denomination): string =>
  denom === "erg" ? ergText(raw) : `${units(raw, denomDecimals(denom), dpOfUnits(raw, denomDecimals(denom)))} ${denomSymbol(denom)}`;

/**
 * Whether the tracker takes reserves in this token now (GET /config/reserve-collateral lists it, and the token
 * contract it serves is the one pinned here). ERG: always. null while unknown (the first read, or a failed one).
 */
export type Served = { k: "yes" } | { k: "no" } | { k: "contract" } | { k: "unknown" };
export function useServed(denom: Denomination): Served {
  const token = tokenIdOf(denom);
  const c = useResource(token ? R.collateral() : null, { everyMs: 300_000 });
  if (token === null) return { k: "yes" };
  if (!c.value) return { k: "unknown" };
  if (c.value.tokenP2s !== tokenReserveAddress()) return { k: "contract" };
  return c.value.tokens.includes(token) ? { k: "yes" } : { k: "no" };
}

/** What the screen says when the tracker does not take this token's reserves (yet), or serves another contract. */
export function NotServed({ served, denom }: { served: Served; denom: Denomination }) {
  const t = useT();
  if (served.k === "yes") return null;
  const sym = denomSymbol(denom);
  if (served.k === "unknown") return <p className="t-small mw-dim">{t("mw.dn.servedLoading", { sym })}</p>;
  return (
    <Callout tone="calm" title={served.k === "no" ? t("mw.dn.notServedT", { sym }) : t("mw.dn.contractT")}>
      {served.k === "no" ? t("mw.dn.notServedB", { sym }) : t("mw.dn.contractB")}
    </Callout>
  );
}

/** The token of a denomination this screen works in (null: ERG). Unknown tokens never reach here (useDenom). */
export const tokenOf = (d: Denomination): ReserveToken | null => reserveTokenOf(d) ?? null;

/** The denomination a journal entry records (meta.denom; absent: ERG, as every entry before token reserves). */
export const entryDenom = (e: { meta: Readonly<Record<string, unknown>> }): Denomination =>
  (typeof e.meta.denom === "string" && e.meta.denom.startsWith("token:") ? (e.meta.denom as Denomination) : "erg");

/**
 * Tokens after an ERG amount in a review row (" · 47.50 SigUSD · 150 rsADA · 1 other token"): SigUSD and rsADA in
 * their own unit, any other token counted, never added to anything.
 */
export function TokensAfter({ tokens }: { tokens: readonly Token[] }) {
  const t = useT();
  const merged = mergedTokens([{ tokens: [...tokens] }]).filter((x) => x.amount > 0n);
  const pinned = merged.flatMap((x) => (reserveTokenById(x.tokenId) ? [{ d: `token:${x.tokenId}` as Denomination, amount: x.amount }] : []));
  const others = merged.length - pinned.length;
  return <>{pinned.map((p) => <Fragment key={p.d}> · <Amt raw={p.amount} denom={p.d} /></Fragment>)}{others > 0 && <> · {t("mw.dn.otherTokens", { n: others })}</>}</>;
}

/** What a transaction gives back to the key: its outputs at P2PK(owner), ERG and tokens (the change as built). */
export function backToKey(tx: UnsignedTx, owner: string): { erg: bigint; tokens: Token[] } {
  const tree = p2pkTree(owner);
  const outs = tx.outputs.filter((o) => o.ergoTree === tree);
  return { erg: outs.reduce((a, o) => a + o.value, 0n), tokens: mergedTokens(outs) };
}
