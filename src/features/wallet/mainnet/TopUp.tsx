// /wallet/mainnet/topup — add ERG to a reserve (basis.es action 1, design §9). The wallet's own reserve by default;
// `?nft=<reserve NFT>` preselects another one (the observatory's reserve page links here). The contract lets anyone top
// up anyone's reserve without a signature: the review says plainly when the reserve belongs to another key, because
// that money can never come back to this wallet. Only current-contract reserves of our tracker, never one in refund.
// Pipeline as T1 and Withdraw: precheck (the reserve box fresh from /v1, the mempool) → plan → L1 → L2 (the contract
// engine on the real transaction) → review → passphrase → hold to sign → journal → broadcast → depth 2.
// Token reserves: the key's own one by `?d=sigusd|rsada`; a `?nft=` link is in the denomination of its box (a token
// this wallet does not know is refused). The tokens come from the key's boxes that hold them, the fee in ERG; the
// review says what leaves the key (tokens and ERG) before signing. Same L1/L2, mempool, trust and freshness rules.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { AmountInput, Callout, Card, Field, Key, KeySeal, Switch, Tag, TextInput, int, short } from "@/ui";
import { ContractXray } from "@/viz";
import {
  MINER_FEE_NANOERG, MIN_BOX_NANOERG, RESERVE_DEFAULT_CAP_NANOERG, RESERVE_HARD_CAP_NANOERG, TOKEN_RESERVE_TREE_HEX, TOP_UP_MIN_NANOERG, checkReserveAction, checkReserveActionContract, computeTxId,
  denomDecimals, denomSymbol, loadContractAvl, mergedTokens, p2pkAddress, readReserve, reserveAddress, reserveDenomOfBox, tokenIdOf, tokenReserveAddress, type Denomination, type ErgoBox, type L2Result, type ReserveInfo, type UnsignedTx,
} from "@/mainnet/tx";
import {
  isBroadcastLimit, linkTarget, mempoolSpending, namedUnproven, ownReserve, parseUnits, planTokenTopUp, planTopUp, spendable, tokenBalanceOf, topUpMax, trackedAs, trustedNft, unitsInput,
  type OwnReserve,
} from "@/mainnet/flows";
import { isVaultError, type JournalEntry } from "@/mainnet/vault";
import { freshHeight, refreshHeight } from "@/app/height";
import type { Problem } from "@/mainnet/net";
import { useMw } from "./ctx";
import { R, inFlightOf, net, ownReserveNow, t1NftOf, trackedOf, useResource, useUnspent } from "./data";
import { EntryProgress, send, signReserve } from "./send";
import { BackLink, ChainLink, Erg, FlowSteps, Gate, OtherBoxesNote, OwnReserveRefusal, ProblemText, TxReview, ergText, trustText, useVaultError } from "./ui";
import { Amt, DenomSwitch, NotServed, TokensAfter, amtText, backToKey, denomQuery, entryAmtText, entryDenom, tokenOf, useDenom, useDenomPhase, useServed } from "./denom";

type Phase =
  | { k: "edit"; notice?: string }
  | { k: "working"; step: "reserve" | "mempool" | "plan" | "l2" | "sign" | "send" }
  | { k: "review"; tx: UnsignedTx; inputs: ErgoBox[]; reserve: ErgoBox; info: ReserveInfo; amount: bigint; change: bigint; add: bigint; txId: string; tip: number; l2: L2Result }
  | { k: "done"; id: string; problem: Problem | null }
  | { k: "error"; text?: string; problem?: Problem; rule?: string; tx?: string; l2?: L2Result };

const HEX64 = /^[0-9a-f]{64}$/;

/** Why the wallet does not top up this reserve, in words (null: it may). */
function refusalKey(read: ReturnType<typeof readReserve>, box?: ErgoBox): string | null {
  // the token contract with a token this wallet does not know (or not one of our layout): said as such
  if (!read.ok && box && box.ergoTree === TOKEN_RESERVE_TREE_HEX && reserveDenomOfBox(box) === null) return "mw.dn.no.token";
  if (!read.ok) return read.rule === "contract" ? "mw.top.no.legacy" : read.rule === "tracker" ? "mw.top.no.tracker" : "mw.top.no.shape";
  return read.info.refundHeight > 0n ? "mw.top.no.refund" : null;
}

/** The reserve read in the denomination it is in: a `?nft=` link by its box, the key's own one by `?d=`. */
const readIn = (box: ErgoBox, link: boolean, denom: Denomination) => readReserve(box, link ? reserveDenomOfBox(box) ?? "erg" : denom);

/** A new ?nft= or ?d= is a new screen: nothing reviewed for one reserve survives into another (review 1, item 7). */
export function TopUpScreen() {
  const [params] = useSearchParams();
  return <TopUpForm key={`${params.get("nft") ?? ""}|${params.get("d") ?? ""}`} />;
}

function TopUpForm() {
  const t = useT();
  const { vault, state, me, height, entries } = useMw();
  const verr = useVaultError();
  const [params] = useSearchParams();
  const asked = (params.get("nft") ?? "").trim().toLowerCase();
  const badParam = asked !== "" && !HEX64.test(asked);
  const [ownDenom, setDenom] = useDenom();
  // a ?nft= link names its reserve's denomination by its box: this key's own reserve is looked for in that one (a link
  // to the key's own SigUSD reserve, opened without ?d=, is still its own); the same resource as `target` below
  const linked = useResource(asked && !badParam ? R.reserveByNft(asked) : null, { height, enabled: state.backedUp });
  const mineDenom: Denomination = (linked.value?.box ? reserveDenomOfBox(linked.value.box) : null) ?? ownDenom;
  // the key's own reserve: by the NFT this wallet trusts (its T1, a tracked reserve this key minted), found by an exact
  // lookup by token, never in the chain's listing (review 2, re-review P1-1/2); the listing only feeds the warning
  const mineOnChain = useResource(me ? R.reservesOnChain(me.pub, mineDenom) : null, { height, enabled: state.backedUp });
  const trackedMine = useResource(me ? R.trackedOf(me.pub) : null, { height, enabled: state.backedUp });
  const t1Nft = useMemo(() => (me ? t1NftOf(entries, me.pub, mineDenom) : null), [entries, me, mineDenom]);
  const trackerRead = trackedMine.value !== null || !!trackedMine.problem;
  const trust = me && trackerRead ? trustedNft({ owner: me.pub, t1Nft, tracked: trackedMine.value ?? null, token: tokenIdOf(mineDenom) }) : null;
  const held = useResource(trust?.ok ? R.reserveByNft(trust.nft) : null, { height, enabled: state.backedUp });
  const own: OwnReserve | null = !me || !trust ? null : !trust.ok ? trust
    : held.value !== null || held.at ? ownReserve({ owner: me.pub, trusted: trust, held: held.value, listing: mineOnChain.value, token: tokenIdOf(mineDenom) }) : null;
  const ownProblem = trust?.ok && held.problem && !held.value ? held.problem : null;
  const nft = asked && !badParam ? asked : own?.ok ? own.nft : null;
  const target = useResource(nft ? R.reserveByNft(nft) : null, { height, enabled: state.backedUp });
  const un = useUnspent(me, height, state.backedUp);
  const box = target.value?.box ?? null;
  // the denomination of the reserve this screen tops up: a link's box says it; else the switch
  const denom: Denomination = asked && box ? reserveDenomOfBox(box) ?? "erg" : ownDenom;
  const token = tokenOf(denom);
  const served = useServed(denom);
  const minAdd = token ? token.min : TOP_UP_MIN_NANOERG;
  const [amountText, setAmountText] = useState<string | null>(null);
  const [big, setBig] = useState(false);
  const [pass, setPass] = useState("");
  const [passWrong, setPassWrong] = useState(false);
  const [phase, setPhase] = useDenomPhase<Phase>(ownDenom, { k: "edit" });
  const [xray, setXray] = useState(false);

  const read = box ? readIn(box, !!asked, denom) : null;
  const shapeRefusal = read && box ? refusalKey(read, box) : null;
  const info = read && read.ok ? read.info : null;
  const theirs = !!(asked && info && me && info.owner !== me.pub);
  const trackedTheirs = useResource(theirs ? R.trackedOf(info!.owner) : null, { height, enabled: state.backedUp });
  // a ?nft= link: this key's own only when trusted; another key's only when our tracker tracks it as that owner's
  const link = !asked || !info || !me ? null
    : !theirs ? (own ? linkTarget({ me: me.pub, nft: asked, owner: info.owner, own, trackedOfOwner: null }) : "loading")
    : trackedTheirs.value !== null ? linkTarget({ me: me.pub, nft: asked, owner: info.owner, own: own ?? { ok: false, why: "untrusted" }, trackedOfOwner: trackedTheirs.value, token: tokenIdOf(denom) })
    : trackedTheirs.problem ? "down" : "loading";
  const trustKey = link === "untrusted" ? (theirs ? "mw.trust.untracked" : "mw.trust.ownLink") : link === "unproven" ? "mw.trust.unproven" : link === "unchecked" ? "mw.trust.unchecked" : link === "down" ? "mw.trust.trackerDown" : null;
  const servedKey = token && served.k !== "yes" && served.k !== "unknown" ? (served.k === "contract" ? "mw.dn.contractB" : "mw.dn.notServedTop") : null;
  const refusal = shapeRefusal ?? trustKey ?? servedKey;
  const ready = !!info && !refusal && link !== "loading" && (!token || served.k === "yes");
  const own_ = !!(info && me && info.owner === me.pub);
  const cap = token ? (big ? token.hardCap : token.defaultCap) : big ? RESERVE_HARD_CAP_NANOERG : RESERVE_DEFAULT_CAP_NANOERG;
  // what the reserve holds in its denomination: ERG, or the token (tokens(1), raw units)
  const held_ = (i: ReserveInfo) => (token ? i.collateral : i.box.value);
  const max = info ? topUpMax(own_, held_(info), cap, token ? token.hardCap : RESERVE_HARD_CAP_NANOERG) : 0n;
  const text = amountText ?? unitsInput(minAdd, denomDecimals(denom));
  const amount = parseUnits(text, denomDecimals(denom));
  const amountBad = amount !== null && (amount < minAdd || amount > max);
  const have = useMemo(() => (me && un.value ? spendable(un.value.boxes, inFlightOf(entries, me.pub)).reduce((s, b) => s + b.value, 0n) : null), [me, un.value, entries]);
  const haveTokens = useMemo(() => (token && me && un.value ? tokenBalanceOf(spendable(un.value.boxes, inFlightOf(entries, me.pub)), token.id) : null), [token, me, un.value, entries]);
  const recent = useMemo(() => (me ? entries.filter((e) => e.pub === me.pub && e.kind === "topup" && e.state !== "abandoned" && entryDenom(e) === denom).slice(0, 3) : []), [entries, me, denom]);
  const current = phase.k === "done" ? entries.find((e) => e.id === phase.id) ?? null : null;

  const fail = (p: Omit<Extract<Phase, { k: "error" }>, "k">) => setPhase({ k: "error", ...p });
  const guard = (f: () => Promise<void>) => f().catch((e: unknown) => fail({ text: t("mw.err.shape"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined }));

  /** The reserve may be topped up as this screen shows it: this key's trusted own one, or one our tracker tracks. */
  async function trusted(r: ReserveInfo): Promise<boolean> {
    if (!me) return false;
    if (r.owner === me.pub) {
      const o = await ownReserveNow(me.pub, entries, r.denom);
      if (!o.ok) { fail({ problem: o.problem }); return false; }
      if (!o.value.ok || o.value.nft !== r.nft) { fail({ text: o.value.ok ? t("mw.trust.ownLink") : trustText(t, o.value) }); return false; }
      return true;
    }
    if (!asked) { fail({ text: t("mw.trust.ownLink") }); return false; }
    const tr = await trackedOf(r.owner);
    if (!tr.ok) { fail({ text: t("mw.trust.trackerDown") }); return false; }
    if (!trackedAs(r.owner, r.nft, tr.value, r.token?.id ?? null)) { fail({ text: t(namedUnproven(r.owner, r.nft, tr.value) ? "mw.trust.unproven" : "mw.trust.untracked") }); return false; }
    return true;
  }

  /** Precheck → plan → L1 → L2. Nothing is signed here. */
  async function prepare() {
    if (!me || !nft || amount === null) return;
    setPhase({ k: "working", step: "reserve" });
    // 0. a fresh tip: the poller's answer under a minute old (review 2: it keeps the last value on error)
    const tip = freshHeight(await refreshHeight());
    if (tip === null) return fail({ text: t("mw.res.staleTip") });
    // 1. the reserve as the chain has it now (it changes with every redemption), and that it is the one we trust
    const fresh = await net().reserveByNft(nft, { priority: "user" });
    if (!fresh.ok) return fail({ problem: fresh.problem });
    if (!fresh.value) return fail({ text: t("mw.top.no.gone") });
    if (fresh.value.height === null) return fail({ text: t("mw.top.unconfirmed") });
    // read in the denomination the screen showed: a box that changed denomination is not this reserve any more
    const r = readReserve(fresh.value.box, denom);
    const why = refusalKey(r, fresh.value.box);
    if (why || !r.ok) return fail({ text: t(why ?? "mw.top.no.shape"), rule: r.ok ? undefined : `${r.rule}: ${r.message}` });
    if (token && served.k !== "yes") return fail({ text: served.k === "contract" ? t("mw.dn.contractB") : t("mw.dn.notServedTop", { sym: token.symbol }) });
    if (!(await trusted(r.info))) return;
    const reserve = r.info.box;
    const mine = r.info.owner === me.pub;
    const limit = topUpMax(mine, held_(r.info), cap, token ? token.hardCap : RESERVE_HARD_CAP_NANOERG);
    if (amount < minAdd || amount > limit) return fail({ text: t("mw.top.range", { min: amtText(minAdd, denom), max: amtText(limit, denom) }) });
    // 2. nothing else may spend it first: this wallet's open entries, then the mempool of the reserve contract
    if (inFlightOf(entries, me.pub).has(reserve.boxId)) return fail({ text: t("mw.top.openEntry") });
    setPhase({ k: "working", step: "mempool" });
    const rm = await net().mempool(token ? tokenReserveAddress() : reserveAddress(), { priority: "user" });
    if (!rm.ok) return fail({ problem: rm.problem });
    const pending = mempoolSpending(rm.value, reserve.boxId);
    if (pending) return fail({ text: t("mw.top.pending"), tx: pending.id });
    // 3. coins: confirmed boxes at the key that no open entry and no mempool transaction spends
    setPhase({ k: "working", step: "plan" });
    const coins = await net().unspent(me.address, me.tree, { priority: "user" });
    if (!coins.ok) return fail({ problem: coins.problem });
    const mm = await net().mempool(me.address, { priority: "user" });
    if (!mm.ok) return fail({ problem: mm.problem });
    const usable = spendable(coins.value.boxes, inFlightOf(entries, me.pub), mm.value);
    const p = token ? planTokenTopUp(usable, me.pub, reserve, token, amount, MINER_FEE_NANOERG, tip, limit) : planTopUp(usable, me.pub, reserve, amount, MINER_FEE_NANOERG, tip, limit);
    if (!p.ok) {
      const short = p.why === "short" ? (token && p.tokens ? t("mw.dn.shortTokens", { need: amtText(p.need, denom), have: amtText(p.have, denom) }) : token ? t("mw.dn.shortErg", { need: ergText(p.need), have: ergText(p.have) }) : t("mw.res.short", { need: ergText(p.need), have: ergText(p.have) })) : null;
      return fail({
        text: short ?? (p.why === "amount" ? t("mw.top.range", { min: amtText(p.min, denom), max: amtText(p.max, denom) }) : p.why === "too-many-boxes" ? t("mw.top.tooMany") : t("mw.wd.build")),
        rule: p.why === "build" ? p.message : undefined,
      });
    }
    const add = "add" in p && typeof p.add === "bigint" ? p.add : 0n;
    const inputs = [reserve, ...p.inputs];
    // a box newer than the tip read: the tip is behind the chain
    if (inputs.some((b) => b.creationHeight > tip)) return fail({ text: t("mw.res.aheadOfTip") });
    // 4. L1: exactly this transaction, byte for byte (a token top-up: the token, its amount and the ERG dust exact)
    const l1 = checkReserveAction(p.tx, inputs, token
      ? { kind: "topup", signer: me.pub, height: tip, fee: MINER_FEE_NANOERG, amount: p.amount, denom, add }
      : { kind: "topup", signer: me.pub, height: tip, fee: MINER_FEE_NANOERG, amount: p.amount });
    if (!l1.ok) return fail({ text: t("mw.res.checkFailed"), rule: `${l1.rule}: ${l1.message}` });
    // 5. L2: the reserve contract itself on the real transaction, at the next block's height
    setPhase({ k: "working", step: "l2" });
    let l2: L2Result;
    try { l2 = checkReserveActionContract(p.tx, inputs, "topup", [me.pub], tip + 1, await loadContractAvl()); } catch (e) {
      return fail({ text: t("mw.top.l2Error"), rule: e instanceof Error ? e.message.slice(0, 300) : undefined });
    }
    if (!l2.ok) return fail({ text: t("mw.top.l2Failed"), rule: `${l2.rule ?? "?"}: ${l2.message ?? ""}`, l2 });
    setPhase({ k: "review", tx: p.tx, inputs: p.inputs, reserve, info: r.info, amount: p.amount, change: p.change, add, txId: computeTxId(p.tx), tip, l2 });
  }

  async function sign() {
    if (phase.k !== "review" || !me || !pass) return;
    const review = phase;
    const { tx, inputs, reserve, info: ri, amount: a, tip } = phase;
    setPhase({ k: "working", step: "sign" });
    setPassWrong(false);
    let entry: JournalEntry;
    try {
      // the review is still the chain's (review 1, item 2): a fresh tip, and the reserve box unchanged since
      const now = freshHeight(await refreshHeight());
      if (now === null) return fail({ text: t("mw.res.staleTip") });
      const fresh = await net().reserveByNft(ri.nft, { priority: "user" });
      if (!fresh.ok) return fail({ problem: fresh.problem });
      if (!fresh.value || fresh.value.box.boxId !== reserve.boxId) { setPass(""); return setPhase({ k: "edit", notice: t("mw.res.changed") }); }
      // a token top-up records its denomination; its amount and reserveAfter are in the token's raw units
      entry = await signReserve(vault, "topup", tx, [reserve, ...inputs], ri.token ? {
        amount: a.toString(), reserveBox: reserve.boxId, nft: ri.nft, owner: ri.owner, own: ri.owner === me.pub, reserveAfter: (ri.collateral + a).toString(), denom: `token:${ri.token.id}`,
      } : {
        amount: a.toString(), reserveBox: reserve.boxId, nft: ri.nft, owner: ri.owner, own: ri.owner === me.pub, reserveAfter: (reserve.value + a).toString(),
      }, tip, pass, ri.owner);
    } catch (e) {
      if (isVaultError(e, "wrong-passphrase")) { setPassWrong(true); return setPhase(review); }
      return fail({ text: isBroadcastLimit(e) ? t("mw.top.tooMany") : verr(e) });
    }
    // signed and recorded: from here on the screen follows the entry, whatever the send says (review 1, item 1)
    setPass("");
    setPhase({ k: "working", step: "send" });
    const r = await send(vault, entry);
    setPhase({ k: "done", id: entry.id, problem: r.problem });
    target.refresh();
  }

  const busy = phase.k === "working";
  // what a token top-up gives back to the key, read from the transaction as built (every token, not only the reserve's)
  const back = phase.k === "review" && me ? backToKey(phase.tx, me.pub) : { erg: 0n, tokens: [] };
  const owner = phase.k === "review" ? phase.info.owner : info?.owner ?? null;
  const isOwn = !!(owner && me && owner === me.pub);
  const ownRefusal = !asked && own && !own.ok ? own : null;

  return (
    <Gate vault={vault} state={state}>
      <div className="mw-grid">
        <div className="mw-main">
          <header className="mw-screen-h">
            <BackLink to={`/wallet/mainnet/reserve${denomQuery(denom)}`}>{t("mw.nav.reserve")}</BackLink>
            <h1 className="t-h2">{t("mw.top.h")}</h1>
            <p className="t-lede">{token ? t("mw.dn.topLede", { sym: token.symbol }) : t("mw.top.lede")}</p>
            {!asked && <DenomSwitch value={ownDenom} onChange={setDenom} disabled={busy || phase.k === "review"} />}
            <FlowSteps at={phase.k === "done" ? 2 : phase.k === "review" ? 1 : 0} notSent={phase.k === "done" && !!phase.problem} />
          </header>

          <Card title={t("mw.top.targetT")} aside={info ? <Tag tone={isOwn ? "ok" : "metal"}>{isOwn ? t("mw.top.yours") : t("mw.top.theirs")}</Tag> : undefined}>
            {badParam ? (
              <Callout tone="alarm">{t("mw.top.badLink")}</Callout>
            ) : !nft ? (
              ownRefusal || ownProblem ? (
                <div className="mw-form">
                  {ownProblem ? <p className="t-small"><ProblemText p={ownProblem} what="read" /></p> : ownRefusal && <OwnReserveRefusal own={ownRefusal} />}
                  <Key size="sm" to={`/wallet/mainnet/reserve${denomQuery(ownDenom)}`}>{t("mw.top.toReserve")}</Key>
                </div>
              ) : <p className="t-small mw-dim">{t("mw.top.loading")}</p>
            ) : target.problem && !box ? (
              <p className="t-small"><ProblemText p={target.problem} what="read" /></p>
            ) : target.value === null && !target.at ? (
              <p className="t-small mw-dim">{t("mw.top.loading")}</p>
            ) : !box ? (
              <Callout tone="alarm" title={t("mw.top.noT")}>{t("mw.top.no.gone")}</Callout>
            ) : (
              <div className="mw-form">
                {info && (
                  <div className="mw-filecard">
                    <KeySeal pk={info.owner} size="sm" />
                    <div>
                      <div className="label">{isOwn ? t("mw.top.ownerYou") : t("mw.top.ownerOther")}</div>
                      <div className="mono t-small mw-break">{p2pkAddress(info.owner)}</div>
                    </div>
                  </div>
                )}
                <div className="mw-figs">
                  {token && info ? (
                    <div className="mw-figure"><span className="label">{t("mw.top.now")}</span><b><Amt raw={info.collateral} denom={denom} /></b><span className="t-small mw-dim">{t("mw.dn.boxHolds", { erg: ergText(box.value) })}</span></div>
                  ) : (
                    <div className="mw-figure"><span className="label">{t("mw.top.now")}</span><b><Erg nano={box.value} /></b></div>
                  )}
                  <div className="mw-figure"><span className="label">{t("mw.top.nft")}</span><span className="mono t-small">{short(box.tokens[0]?.tokenId ?? "", 8, 6)}</span></div>
                </div>
                <p className="t-small">{t("mw.res.box")} <ChainLink kind="box" id={box.boxId} />{target.value?.height ? <> · {t("mw.res.updated", { h: int(target.value.height) })}</> : null}</p>
                {token && served.k !== "yes" && <NotServed served={served} denom={denom} />}
                {refusal && <Callout tone={link === "unchecked" && !shapeRefusal ? "calm" : "alarm"} title={t("mw.top.noT")}>{t(refusal, { sym: token?.symbol ?? "" })}{read && !read.ok && <span className="mw-reason">{t("mw.rule")} <code>{read.rule}: {read.message}</code></span>}</Callout>}
                {!refusal && link === "loading" && <p className="t-small mw-dim">{t("mw.top.loading")}</p>}
                {isOwn && own?.ok && <OtherBoxesNote own={own} />}
                {ready && !isOwn && <Callout tone="alarm" title={t("mw.top.otherT")}>{t("mw.top.otherB")}</Callout>}
              </div>
            )}
          </Card>

          {ready && (
            <Gate vault={vault} state={state} unlocked why={t("mw.top.unlockWhy")}>
              <Card title={t("mw.top.formT")}>
                {phase.k === "done" && current ? (
                  <div className="mw-form">
                    {phase.problem && (
                      <Callout tone="alarm" title={t("mw.sent.problemT")}>
                        <ProblemText p={phase.problem} what="broadcast" />
                        <span className="mw-reason">{t("mw.sent.problemB")}</span>
                      </Callout>
                    )}
                    <EntryProgress vault={vault} entry={current} tip={height} />
                    <p className="t-small mw-dim">{t("mw.top.after")}</p>
                    <Key onClick={() => setPhase({ k: "edit" })}>{t("mw.top.another")}</Key>
                  </div>
                ) : phase.k === "review" ? (
                  <div className="mw-form">
                    {!isOwn && <Callout tone="alarm" title={t("mw.top.otherT")}>{t("mw.top.otherReview")}</Callout>}
                    <TxReview tx={phase.tx} inputs={[phase.reserve, ...phase.inputs]} signers={[me!.pub]} height={phase.tip + 1} txId={phase.txId}
                      rows={[
                        { label: t("mw.top.rowAdd"), sub: isOwn ? t("mw.top.rowYours") : short(p2pkAddress(phase.info.owner), 6, 6), value: <Amt raw={phase.amount} denom={denom} /> },
                        { label: t("mw.top.rowAfter"), value: <Amt raw={(token ? phase.info.collateral : phase.reserve.value) + phase.amount} denom={denom} /> },
                        ...(token && phase.add > 0n ? [{ label: t("mw.dn.rowDust"), value: <Erg nano={phase.add} /> }] : []),
                        { label: t("mw.top.nft"), value: <span className="mono t-small mw-break">{phase.info.nft}</span> },
                        { label: t("mw.top.rowBox"), value: <ChainLink kind="box" id={phase.reserve.boxId} /> },
                        ...(token ? (back.erg > 0n || back.tokens.length > 0 ? [{ label: t("mw.res.rowChange"), value: <span><Erg nano={back.erg} /><TokensAfter tokens={back.tokens} /></span> }] : [])
                          : phase.change > 0n ? [{ label: t("mw.res.rowChange"), value: <Erg nano={phase.change} /> }] : []),
                        { label: t("mw.res.rowFee"), value: <Erg nano={MINER_FEE_NANOERG} /> },
                      ]}
                      sum={{ label: t("mw.res.rowSpent", { n: phase.inputs.length }), value: token
                        ? <span><Erg nano={phase.inputs.reduce((s, b) => s + b.value, 0n)} /><TokensAfter tokens={mergedTokens(phase.inputs)} /></span>
                        : <Erg nano={phase.inputs.reduce((s, b) => s + b.value, 0n)} /> }}
                      extra={<>
                        <p className="t-small"><Tag tone="ok" glyph="✓">L1</Tag> <Tag tone="ok" glyph="✓">L2</Tag> {t("mw.top.checked", { n: phase.l2.eval?.checks.length ?? 0 })}</p>
                        <p className="t-small mw-dim">{t("mw.top.noSig")}</p>
                        <button type="button" className="textlink t-small" aria-expanded={xray} onClick={() => setXray(!xray)}>{xray ? t("mw.red.hideXray") : t("mw.red.showXray")}</button>
                        {xray && phase.l2.eval && <ContractXray evaluation={phase.l2.eval} mode="compact" title={t("mw.top.xrayT")} />}
                      </>} />
                    {isOwn && <Callout tone="policy">{t("mw.res.lock")}</Callout>}
                    <Field label={t("mw.pay.passAgain")} help={t("mw.top.passWhy")} error={passWrong ? t("mw.pay.passWrong") : undefined}>
                      <TextInput type="password" autoComplete="current-password" value={pass} onChange={(v) => { setPass(v); setPassWrong(false); }} />
                    </Field>
                    {token && <Callout tone="info">{t("mw.dn.topLeaves", { tokens: amtText(phase.amount, denom), erg: ergText(MINER_FEE_NANOERG + phase.add) })}</Callout>}
                    <Key variant="primary" hold block disabled={!pass} onAct={() => void sign()}>{t(isOwn ? "mw.top.hold" : "mw.top.holdOther", { amount: amtText(phase.amount, denom) })}</Key>
                    <Key variant="quiet" onClick={() => setPhase({ k: "edit" })}>{t("mw.cancel")}</Key>
                  </div>
                ) : (
                  <div className="mw-form">
                    <Field label={token ? t("mw.dn.amount", { sym: token.symbol }) : t("mw.top.amount")} help={max >= minAdd ? t("mw.top.amountHelp", { min: amtText(minAdd, denom), max: amtText(max, denom) }) : t("mw.top.atCap", { max: amtText(cap, denom) })}
                      error={text && (amount === null ? (token ? t("mw.dn.amountBad", { sym: token.symbol }) : t("mw.amount.bad")) : amountBad ? (max >= minAdd ? t("mw.top.range", { min: amtText(minAdd, denom), max: amtText(max, denom) }) : t("mw.top.atCap", { max: amtText(cap, denom) })) : undefined)}>
                      <AmountInput value={text} onChange={setAmountText} disabled={busy} unit={denomSymbol(denom)} />
                    </Field>
                    <Switch checked={big} onChange={setBig} label={token ? t("mw.dn.bigT", { max: amtText(token.hardCap, denom) }) : t("mw.res.bigT")} help={isOwn ? (token ? t("mw.dn.bigB") : t("mw.res.bigB")) : t("mw.top.bigOther")} />
                    {token ? (
                      <>
                        <Callout tone="info" title={t("mw.dn.needT")}>{t("mw.dn.needTop", { tokens: amtText(amount !== null && !amountBad ? amount : minAdd, denom), erg: ergText(MINER_FEE_NANOERG), more: ergText(MIN_BOX_NANOERG) })}</Callout>
                        <p className="t-small">{t("mw.res.have")} <b>{haveTokens !== null ? <Amt raw={haveTokens} denom={denom} /> : "—"}</b> · <b>{have !== null ? <Erg nano={have} /> : "—"}</b> · <Link className="textlink" to="/wallet/mainnet/fund">{t("mw.res.fund")}</Link></p>
                      </>
                    ) : (
                      <p className="t-small">{t("mw.res.have")} <b>{have !== null ? <Erg nano={have} /> : "—"}</b> · <Link className="textlink" to="/wallet/mainnet/fund">{t("mw.res.fund")}</Link></p>
                    )}
                    {phase.k === "edit" && phase.notice && <Callout tone="policy">{phase.notice}</Callout>}
                    {phase.k === "error" && (
                      <Callout tone="alarm" title={t("mw.res.stopT")}>
                        {phase.problem ? <ProblemText p={phase.problem} what={phase.problem.kind === "refused" ? "broadcast" : "read"} /> : phase.text}
                        {phase.tx && <> <ChainLink kind="tx" id={phase.tx} /></>}
                        {phase.rule && <span className="mw-reason">{t("mw.rule")} <code>{phase.rule}</code></span>}
                        <span className="mw-reason">{t("mw.nothingSigned")}</span>
                        {phase.l2?.eval && <ContractXray evaluation={phase.l2.eval} focus={phase.l2.rule ? [phase.l2.rule] : undefined} mode="compact" title={t("mw.top.xrayT")} />}
                      </Callout>
                    )}
                    <Key variant="primary" block disabled={busy || amount === null || amountBad} onClick={() => void guard(prepare)}>
                      {busy ? t(`mw.top.working.${(phase as { step: string }).step}`) : t("mw.top.prepare")}
                    </Key>
                    <p className="t-small mw-dim">{t("mw.top.prepareHint")}</p>
                  </div>
                )}
              </Card>
            </Gate>
          )}

          {recent.filter((e) => e.id !== (phase.k === "done" ? phase.id : "")).map((e) => (
            <Card key={e.id} title={t("mw.top.progressT", { amount: entryAmtText(t, BigInt(String(e.meta.amount ?? "0")), entryDenom(e)) })}>
              <EntryProgress vault={vault} entry={e} tip={height} />
            </Card>
          ))}
        </div>
        <aside className="mw-side">
          <Card title={t("mw.res.howT")}>
            <ul className="mw-facts">
              <li>{token ? t("mw.dn.topHow1", { min: amtText(minAdd, denom), sym: token.symbol }) : t("mw.top.how1")}</li>
              <li>{t("mw.top.how2")}</li>
              <li>{t("mw.top.how3")}</li>
              <li>{t("mw.top.how4")}</li>
            </ul>
          </Card>
          <Callout tone="calm" title={t("mw.honest.t")}>{t("mw.honest.b")}</Callout>
        </aside>
      </div>
    </Gate>
  );
}
