// The wallet home pieces: identity, the three answers (1 what you have: the play coins at your sandbox address; 2 owed
// to you and 3 you owe: the balance sheet under the net position, with the backed / trust bar), the four keys with one
// lead, the start quest (a house that lights one window per step), the reserve and policy summaries and the tour.
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useT } from "@/app/lang";
import { BackedTrustBar, Callout, CoverageMeter, HouseLights, Key, KeySeal, PolicySentence, prefersReducedMotion } from "@/ui";
import { FAUCET_ERG, town, useClock, useTown, useWallet, worldText, YOU } from "@/world";
import type { DenomId } from "@/protocol";
import { setPrefs, useFmt, useNameOf, useOutcomeToast, usePrefs } from "../lib/hooks";
import { share, type WalletModel } from "../lib/model";
import { policyText } from "../lib/policyText";
import { Amt, SandboxTag, TrackerChip } from "./bits";

/** Identity: seal (gold rim with a reserve), name, sandbox tag, tracker chip; words + fingerprint on desktop. */
export function Identity({ m, phone }: { m: WalletModel; phone: boolean }) {
  const t = useT();
  const { identity } = useWallet();
  const name = useNameOf()(YOU);
  if (!identity) return null;
  const rim = m.reserves.length > 0;
  if (phone)
    return (
      <header className="wl-id phone">
        <KeySeal pk={identity.pubHex} size={48} rim={rim} />
        <div className="wl-id-t">
          <div className="wl-id-name">
            <span className="t-h3">{name}</span>
            <SandboxTag small />
          </div>
          <TrackerChip tracker={m.tracker} />
        </div>
        <Key variant="default" icon="scan" to="/wallet/scan" className="wl-scan-sq" aria-label={t("wallet.keys.scan")} />
      </header>
    );
  return (
    <header className="wl-id">
      <KeySeal pk={identity.pubHex} size="xl" rim={rim} />
      <div className="wl-id-t">
        <div className="wl-id-name">
          <span className="t-h3">{name}</span>
          <SandboxTag small />
        </div>
        <div className="mono wl-words" title={t("wallet.id.wordsHint")}>
          {identity.words.join(" · ")}{"\u00a0· "}<span className="wl-fp">{identity.fingerprint}</span>
        </div>
        <TrackerChip tracker={m.tracker} />
      </div>
    </header>
  );
}

/** The net position on the field, the two sides and the backed / trust bar. */
export function NetBlock({ m, denom }: { m: WalletModel; denom: DenomId }) {
  const t = useT();
  const f = useFmt();
  const s = m.sheet;
  const unit = m.denoms.find((d) => d.id === denom) ?? m.denoms[0];
  // the glow behind the figure dims while the tracker is silent or offline
  const quiet = m.tracker.silent || !m.tracker.online;
  if (!s || !unit) return null;
  const net = s.net;
  const side = net > 0n ? "wallet.net.more.in" : net < 0n ? "wallet.net.more.out" : "wallet.net.square";
  const backed = s.assets > 0n ? share(s.assetsBacked, s.assets) : 0;
  const nIn = s.notesHeld;
  const nOut = s.notesIssued;
  const next = m.denoms.length > 1 ? m.denoms[(m.denoms.findIndex((d) => d.id === denom) + 1) % m.denoms.length] : null;
  const netText = f.amt(net, unit, { sign: net > 0n ? "favour" : "auto" });
  return (
    <section className="wl-net" aria-labelledby="wl-net-l" data-tour="net">
      <span className={quiet ? "wl-glow quiet" : "wl-glow"} aria-hidden="true" />
      <div className="spread wl-net-top">
        <h2 className="label" id="wl-net-l">
          {t("wallet.net.label")} ·{" "}
          {next ? (
            <button type="button" className="wl-denom" onClick={() => setPrefs({ denom: next.id })} aria-label={t("wallet.net.denomAria", { d: unit.symbol, next: next.symbol })}>
              {unit.symbol}
              <span aria-hidden="true"> ⇄</span>
            </button>
          ) : (
            unit.symbol
          )}
        </h2>
        <span className="label wl-net-side">{t(side)}</span>
      </div>
      <div className={`wl-net-v${net > 0n ? " in" : ""}`} style={{ "--len": Math.max(6, netText.length) } as CSSProperties} role="img" aria-label={t("wallet.net.aria", { v: netText, u: unit.symbol })}>
        {netText}
      </div>
      <div className="wl-sides">
        <div className="wl-side in">
          <span className="label wl-q"><i className="wl-q-n" aria-hidden="true">2</i>{t("wallet.net.owedToYou")}</span>
          <span className="v">
            <Amt v={s.assets} u={unit} />
          </span>
          <span className="t-small">{t.p("wallet.net.notes", nIn, { n: nIn })}{nIn > 0 ? ` · ${t("wallet.net.inSub")}` : ""}</span>
        </div>
        <div className="wl-side out">
          <span className="label wl-q"><i className="wl-q-n" aria-hidden="true">3</i>{t("wallet.net.youOwe")}</span>
          <span className="v">
            <Amt v={s.liabilities} u={unit} />
          </span>
          <span className="t-small">{t.p("wallet.net.notes", nOut, { n: nOut })}{nOut > 0 ? ` · ${t(m.reserves.some((r) => r.denom === unit.id) ? "wallet.net.outSub" : "wallet.net.outTrust")}` : ""}</span>
        </div>
      </div>
      {s.assets > 0n ? (
        <div className="wl-bt">
          <BackedTrustBar backed={backed} />
        </div>
      ) : (
        <p className="t-small wl-bt-none">
          {t("wallet.net.noneOwed")}
        </p>
      )}
    </section>
  );
}

/** Pay / Request / Redeem / Scan (one metal key per view: Redeem). */
export function ActionKeys({ hasIn }: { hasIn: boolean }) {
  const t = useT();
  // one lead at a time: Redeem in gold while someone owes you, otherwise Pay
  return (
    <nav className="wl-keys" aria-label={t("wallet.keys.aria")} data-tour="keys">
      <Key variant={hasIn ? "default" : "primary"} tall icon="pay" to="/wallet/pay">
        {t("wallet.keys.pay")}
      </Key>
      <Key variant="default" tall icon="request" to="/wallet/request">
        {t("wallet.keys.request")}
      </Key>
      <Key variant={hasIn ? "metal" : "default"} tall icon="redeem" to="/wallet/redeem" aria-describedby={hasIn ? undefined : "wl-redeem-why"}>
        {t("wallet.keys.redeem")}
      </Key>
      <Key variant="default" tall icon="scan" to="/wallet/scan">
        {t("wallet.keys.scan")}
      </Key>
      {!hasIn && (
        <span id="wl-redeem-why" className="sr-only">
          {t("wallet.keys.redeemNone")}
        </span>
      )}
    </nav>
  );
}

/** Your play coins on the sandbox chain (what a reserve locks and a redemption pays into), with the faucet. */
export function ChainPurse({ m }: { m: WalletModel }) {
  const t = useT();
  const f = useFmt();
  const show = useOutcomeToast();
  const { height } = useClock();
  const faucetIn = useTown((s) => s.faucetIn);
  const amount = f.prose(String(Number(FAUCET_ERG) / 1e9));
  return (
    <section className="wl-purse" aria-labelledby="wl-purse-h">
      <div className="spread wl-purse-top">
        <h2 className="label wl-q" id="wl-purse-h">
          <i className="wl-q-n" aria-hidden="true">1</i>{t("wallet.q.have")}
        </h2>
        <Key size="sm" variant="quiet" icon="coin" disabled={faucetIn > 0} aria-describedby="wl-purse-b" onClick={() => void town.faucet().then(show)}>
          {worldText("world.faucet.button", { amount }, t.lang)}
        </Key>
      </div>
      <p className="wl-purse-v">
        {m.denoms.map((u, i) => (
          <span key={u.id}>
            {i > 0 && <span className="wl-purse-sep" aria-hidden="true">·</span>}
            <Amt v={m.wallet[u.id] ?? 0n} u={u} sign="none" unit />
          </span>
        ))}
      </p>
      <p className="t-small wl-purse-b" id="wl-purse-b">
        <b>{t("wallet.purse.label")}.</b> {t("wallet.purse.b")}
        {faucetIn > 0 && ` ${worldText("world.faucet.wait", { height: f.height(height + faucetIn), blocks: f.height(faucetIn) }, t.lang)}`}
      </p>
    </section>
  );
}

/** The tracker is offline or silent: a calm banner (the field dims to 40 %, VISUAL §13). */
export function Eclipse({ m }: { m: WalletModel }) {
  const t = useT();
  if (m.tracker.online && !m.tracker.silent) return null;
  return (
    <Callout tone="calm" className="wl-eclipse" title={t(m.tracker.online ? "wallet.eclipse.silentT" : "wallet.eclipse.offT", { id: m.tracker.id })}>
      {t("wallet.eclipse.b", { id: m.tracker.id })}
    </Callout>
  );
}

/** Your reserve in one card (or the invitation to make one). The metal key of the home is Redeem, so this key is plain. */
export function ReserveSummary({ m }: { m: WalletModel }) {
  const t = useT();
  const f = useFmt();
  const r = m.reserves[0];
  if (!r)
    return (
      <section className="card wl-sum" aria-labelledby="wl-rs-h">
        <div className="card-b">
          <div className="spread">
            <h2 className="label" id="wl-rs-h">
              <b>{t("wallet.rs.title")}</b>
            </h2>
            <span className="tag">{t("wallet.rs.none.tag")}</span>
          </div>
          <p className="t-body wl-sum-p">{t("wallet.rs.none.text")}</p>
          <Key size="sm" to="/wallet/reserve" icon="coin">
            {t("wallet.rs.none.key")}
          </Key>
        </div>
      </section>
    );
  const cov = r.coverage;
  return (
    <section className="card wl-sum" aria-labelledby="wl-rs-h">
      <div className="card-b">
        <div className="spread">
          <h2 className="label" id="wl-rs-h">
            <b>{t("wallet.rs.title")}</b> · {r.unit.symbol} · T-01
          </h2>
          {r.refundPending ? <span className="tag warn">{t("wallet.rs.exiting")}</span> : <span className="tag metal">{t("wallet.rs.onErgo")}</span>}
        </div>
        <div className="wl-rs-row">
          <div>
            <div className="label">{t("wallet.rs.coverage")}</div>
            <div className="wl-rs-cov num">{cov === null ? "—" : f.pct(cov)}</div>
          </div>
          <div className="wl-rs-locked">
            <div className="label">{t("wallet.rs.locked")}</div>
            <div className="t-money metal-t">
              <Amt v={r.collateral} u={r.unit} />
              <span className="unit">{r.unit.symbol}</span>
            </div>
            <div className="t-small">{f.prose(t("wallet.rs.backs", { v: f.amt(r.liabilities, r.unit) }))}</div>
          </div>
        </div>
        {cov !== null && <CoverageMeter value={Math.round(cov * 100)} scale={false} />}
        <div className="spread wl-sum-f">
          <span className="t-small">{t("wallet.rs.policyMarks")}</span>
          <Key size="sm" to="/wallet/reserve">
            {t("wallet.rs.manage")}
          </Key>
        </div>
      </div>
    </section>
  );
}

/** Your acceptance policy as one sentence. */
export function PolicySummary({ m }: { m: WalletModel }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const uid = useId();
  const erg = m.denoms.find((d) => d.id === "erg") ?? m.denoms[0];
  const text = useMemo(() => {
    const eco = town.economy;
    return policyText(m.policy, {
      t,
      uid: `ps${uid}`,
      who: (pub) => {
        const id = eco?.idOf(pub);
        return id ? { name: nameOf(id), agent: eco?.participants.get(id)?.kind === "agent" } : null;
      },
      cap: (v) => `${f.amt(v, erg)} ${erg.symbol}`,
    });
  }, [m.policy, t, uid, nameOf, f, erg]);
  return (
    <section className="card wl-sum" aria-labelledby="wl-ps-h">
      <div className="card-b">
        <div className="spread">
          <h2 className="label" id="wl-ps-h">
            <b>{t("wallet.ps.title")}</b>
          </h2>
          <span className="tag">{t("wallet.ps.tag")}</span>
        </div>
        <PolicySentence parts={text.parts} />
        <div className="spread wl-sum-f">
          <span className="t-small">{t(m.policy ? "wallet.ps.note" : "wallet.ps.noneNote")}</span>
          <Key size="sm" to="/wallet/policy">
            {t("wallet.ps.edit")}
          </Key>
        </div>
      </div>
    </section>
  );
}

/** The sandbox warning strip (onboarding and home): play money, do not send real ERG to this key. */
export function SandboxNote({ compact }: { compact?: boolean }) {
  const t = useT();
  return (
    <Callout tone="sandbox" title={compact ? undefined : t("wallet.sandbox.title")} className="wl-sbx-note">
      {t("wallet.sandbox.body")}
    </Callout>
  );
}

// ---------------------------------------------------------------------------------------------
// the tour: three hints after joining
// ---------------------------------------------------------------------------------------------

const TOUR = ["net", "keys", "notes"] as const;
const CARD_W = 340;

/** Where the hint card goes: beside the highlighted part on wide screens, a bottom sheet on phones. */
function place(el: HTMLElement | null, card: HTMLElement | null): CSSProperties | undefined {
  if (!el || !card || window.innerWidth <= 640) return undefined;
  const r = el.getBoundingClientRect();
  const h = card.offsetHeight || 180;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const top = Math.max(80, Math.min(r.top, H - h - 16));
  if (r.right + 20 + CARD_W <= W - 16) return { left: r.right + 20, top, right: "auto", bottom: "auto" };
  if (r.left - 20 - CARD_W >= 16) return { left: r.left - 20 - CARD_W, top, right: "auto", bottom: "auto" };
  return { left: Math.max(16, Math.min(r.left, W - CARD_W - 16)), top: Math.min(r.bottom + 16, H - h - 16), right: "auto", bottom: "auto" };
}

export function Tour() {
  const t = useT();
  const p = usePrefs();
  const [i, setI] = useState(0);
  const [pos, setPos] = useState<CSSProperties | undefined>(undefined);
  const card = useRef<HTMLDivElement>(null);
  const open = !p.tourDone;
  useEffect(() => {
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${TOUR[i]}"]`);
    document.querySelectorAll("[data-tour-on]").forEach((x) => x.removeAttribute("data-tour-on"));
    if (el) {
      el.setAttribute("data-tour-on", "");
      const r = el.getBoundingClientRect();
      if (r.top < 72 || r.bottom > window.innerHeight - 16) el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
    }
    const update = () => setPos(place(el, card.current));
    update();
    const timer = window.setTimeout(update, 450);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    card.current?.focus({ preventScroll: true });
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      el?.removeAttribute("data-tour-on");
    };
  }, [open, i]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPrefs({ tourDone: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const id = TOUR[i];
  const last = i === TOUR.length - 1;
  return (
    <div className="wl-tour" role="dialog" aria-modal="false" aria-labelledby="wl-tour-h" aria-describedby="wl-tour-b" tabIndex={-1} ref={card} style={pos}>
      <div className="spread">
        <span className="label">
          {t("wallet.tour.label")} · {i + 1} / {TOUR.length}
        </span>
        <button type="button" className="textlink t-small" onClick={() => setPrefs({ tourDone: true })}>
          {t("wallet.tour.skip")}
        </button>
      </div>
      <h2 className="t-h4" id="wl-tour-h">
        {t(`wallet.tour.${id}.t`)}
      </h2>
      <p className="t-small" id="wl-tour-b">
        {t(`wallet.tour.${id}.b`)}
      </p>
      <div className="wl-tour-f">
        {i > 0 && (
          <Key size="sm" variant="quiet" onClick={() => setI(i - 1)}>
            {t("wallet.tour.back")}
          </Key>
        )}
        <Key size="sm" variant="primary" onClick={() => (last ? setPrefs({ tourDone: true }) : setI(i + 1))}>
          {t(last ? "wallet.tour.done" : "wallet.tour.next")}
        </Key>
      </div>
    </div>
  );
}

/** "Start here" for a new wallet: the steps not done yet (buy a coffee, ask for a payment, back your notes). */
export function FirstSteps({ m }: { m: WalletModel }) {
  const t = useT();
  const asked = useTown((s) => s.requests.length > 0);
  const paidCafe = m.rows.some((r) => r.dir === "out" && r.other === "cafe");
  const steps = [
    { to: "/wallet/pay?to=cafe&amount=0.40&memo=coffee", k: "wallet.first.pay", done: paidCafe },
    { to: "/wallet/request", k: "wallet.first.request", done: asked },
    { to: "/wallet/reserve", k: "wallet.first.reserve", done: m.reserves.length > 0 },
  ];
  const lit = steps.filter((x) => x.done).length;
  const now = steps.findIndex((x) => !x.done);
  const house = <HouseLights steps={steps.map((x) => x.done)} now={now < 0 ? undefined : now} size={now < 0 ? 30 : 64} />;
  const list = (
    <ol className="wl-first-l">
      {steps.map((x, i) => (
        <li key={x.k} className={x.done ? "done" : i === now ? "now" : undefined}>
          {x.done ? <span className="wl-first-done">{t(x.k)}<span className="sr-only"> · {t("wallet.first.doneSr")}</span></span> : <Link to={x.to}>{t(x.k)}</Link>}
          <span className="t-small">{t(`${x.k}.b`)}</span>
        </li>
      ))}
    </ol>
  );
  // done: the quest folds into one line (open it to see the three steps again)
  if (now < 0)
    return (
      <details className="wl-first wl-quest-done">
        <summary>{house}<span>{t("wallet.first.sum", { n: lit, total: steps.length })}</span></summary>
        {list}
      </details>
    );
  return (
    <section className="wl-first wl-quest" aria-labelledby="wl-first-h">
      <div className="wl-quest-h">
        {house}
        <div>
          <h2 className="label" id="wl-first-h">
            <b>{t("wallet.first.label")}</b>
          </h2>
          <p className="t-small">{t("wallet.first.sum", { n: lit, total: steps.length })}</p>
        </div>
      </div>
      {list}
    </section>
  );
}
