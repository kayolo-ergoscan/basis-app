// The denomination of the mainnet screens: ERG, SigUSD or rsADA. It is part of the address (`?d=sigusd`, ERG when
// absent), so a link names it and Back keeps it; the switch on Reserve, Top up, Refund, Pay, Receive and Redeem sets it.
// Amounts of one denomination are only ever shown and added up in that denomination: a SigUSD figure is never next to
// an ERG total as if they were one sum. Token decimals are pinned in tx/tokens.ts, never read from the tracker.
import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { Callout, Num, Seg, units } from "@/ui";
import { dpOfUnits } from "@/mainnet/flows";
import { WALLET_DENOMS, denomDecimals, denomOfSlug, denomSlug, denomSymbol, reserveTokenOf, tokenIdOf, tokenReserveAddress, type Denomination, type ReserveToken } from "@/mainnet/tx";
import { R, useResource } from "./data";
import { Erg, ergText } from "./ui";

/** The screen's denomination from `?d=` (unknown or absent: ERG), and a setter that keeps the other parameters. */
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

/** `?d=…` for a link to another screen in this denomination ("" for ERG: ERG links stay what they were). */
export const denomQuery = (d: Denomination, lead: "?" | "&" = "?"): string => (d === "erg" ? "" : `${lead}d=${denomSlug(d)}`);

/** The three denominations as a switch. `disabled`: while something is being prepared or signed. */
export function DenomSwitch({ value, onChange, disabled }: { value: Denomination; onChange: (d: Denomination) => void; disabled?: boolean }) {
  const t = useT();
  return (
    <div className="mw-denoms">
      <span className="label">{t("mw.dn.label")}</span>
      <Seg ariaLabel={t("mw.dn.aria")} value={value} onChange={(v) => { if (!disabled) onChange(v); }}
        options={WALLET_DENOMS.map((d) => ({ value: d, label: denomSymbol(d), title: d === "erg" ? t("mw.dn.ergTitle") : t("mw.dn.tokenTitle", { sym: denomSymbol(d), id: tokenIdOf(d)! }) }))} />
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
