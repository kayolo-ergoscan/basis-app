// /network/redemptions (FEATURES O03, O04) — timeline, redemption graph, list — and /network/tx/:txId (X13, V09): a
// lens over the real transaction that names each box and the contract checks the chain can show.
import { Fragment, startTransition, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "./query";
import { rich, useT, useTitle } from "@/app";
import { Empty, ErrorState, Icon, KeySeal, Lamp, Loading, PairSeal, Seg, Table, Tag, useIsPhone, type Column } from "@/ui";
import { copy, pick } from "@/content";
import { blake2b256, bytesToHex, CHAIN_BUDGET, chainApi, EMERGENCY_BLOCKS, hexToBytes, useChainStatus, useFirstReads, useRedemption, type Observatory, type OwnerRow, type ReceiverRow, type RedemptionView, type TxBoxView, type TxDetail } from "@/chain";
import { makeClock } from "./clock";
import { amount, blocks, date, dateTime, ergs, height as fmtH, keyOfAddress, sAddr, sid, tokenStr, type Lang } from "./fmt";
import { AsOf, Block, ContractTag, Ext, Facts, IdLink, KeyName, NetLoading, useAfterPaint, useProgressive } from "./parts";
import { FlowGraph, flowModel, redemptionAmount, RedemptionTimeline, sumsText, unitOf, VaultCoin, type FlowEdge } from "./viz";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
type View = "timeline" | "graph" | "list";

/* =========================== list =========================== */
export function RedemptionsPage({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [sp, setQ] = useQuery();
  const view: View = sp.get("view") === "graph" ? "graph" : sp.get("view") === "list" ? "list" : "timeline";
  // switching views mounts a graph or a 41-row table: let React time-slice it
  const setView = (v: View) => startTransition(() => setQ({ view: v === "timeline" ? null : v }));
  const later = useAfterPaint(); // the owners tables (seals) mount after the first paint
  const clock = useMemo(() => makeClock(obs), [obs]);
  const list = obs.redemptions;
  // the newest rows (the list's top, the timeline's right end): their txs are read at once, through the tab's one queue
  useFirstReads(list);
  const listRows = useProgressive(view === "list" ? list : [], 8);
  const sums = useMemo(() => {
    const m = new Map<string, { raw: bigint; dec: number; unit: string; n: number }>();
    for (const r of list) {
      const u = unitOf(r);
      const cur = m.get(u);
      m.set(u, { raw: (cur?.raw ?? 0n) + r.amount, dec: r.unit === "erg" ? 9 : r.token?.decimals ?? 0, unit: u, n: (cur?.n ?? 0) + 1 });
    }
    return [...m.values()];
  }, [list]);
  const ownersN = new Set(list.map((r) => r.owner.addr ?? r.owner.key)).size;
  const receiversN = new Set(list.map((r) => r.receiver).filter(Boolean)).size;   // a receiver not read yet is no receiver
  const emN = list.filter((r) => r.emergencyWindow).length;
  const listCols: Column<RedemptionView>[] = [
    // a redemption seen in the reserve's boxes, its transaction not read yet: block instead of date, "checking…" for the rest
    { key: "d", label: t("network.c.date"), lead: true, render: (r) => <Link to={`/network/tx/${r.tx}`} title={r.fromBoxes ? t("network.rd.unreadTitle") : undefined}>{r.fromBoxes ? t("network.rd.block", { h: fmtH(r.height) }) : date(r.at, lang)}</Link> },
    { key: "a", label: t("network.c.amount"), align: "right", render: (r) => <span className="num">{redemptionAmount(r, lang)}</span> },
    { key: "o", label: t("network.c.owner"), render: (r) => <KeyName pk={r.owner.key} addr={r.owner.addr} label={r.ownerLabel} size={24} /> },
    { key: "r", label: t("network.c.receiver"), render: (r) => <KeyName addr={r.receiver} label={r.receiverLabel} size={24} unknown={r.fromBoxes ? t("network.rd.unread") : "—"} /> },
    { key: "age", label: t("network.c.age"), align: "right", render: (r) => r.fromBoxes ? <span className="dim">{t("network.rd.unread")}</span> : <span className="num">{blocks(r.tracker?.age ?? 0, lang)}</span> },
    { key: "f", label: t("network.c.flags"), render: (r) => <span className="nw-inl">{r.emergencyWindow && <span className="nw-flag em">⚑ {t("network.rd.em")}</span>}{r.firstOfPair && <span className="nw-flag">◇ {t("network.rd.first")}</span>}</span> },
    { key: "tx", label: t("network.c.tx"), render: (r) => <IdLink id={r.tx} kind="tx" to={`/network/tx/${r.tx}`} /> },
  ];
  return (
    <>
      <header className="nw-head">
        <div>
          <div className="eyebrow label">{t("network.rp.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.rp.h1"))}</h1>
          <p className="t-lede">{t.p("network.rp.lede", list.length)}</p>
        </div>
        <AsOf h={obs.height} live={obs.heightLive} />
      </header>
      <dl className="nw-rp-sum">
        {sums.map((s) => (
          <div key={s.unit} className="fig metal">
            <dt>{t("network.rp.sum")} · {tokenUnitLabel(s.unit, lang)}</dt>
            <dd><span className="v t-money">{amount(s.raw, s.dec)}</span><span className="u">{tokenUnitLabel(s.unit, lang)}</span></dd>
            <dd className="s">{t("network.rp.count", { n: s.n })}</dd>
          </div>
        ))}
        <div className="fig"><dt>{t("network.gr.owners")}</dt><dd><span className="v num">{ownersN}</span></dd><dd className="s">{t.p("network.rp.paidTo", receiversN)}</dd></div>
        <div className="fig"><dt>{t("network.rp.emFig")}</dt><dd><span className="v num">{emN}</span></dd><dd className="s">{t("network.rp.emFigSub")}</dd></div>
      </dl>
      <div className="nw-viewbar">
        <Seg<View> ariaLabel={t("network.rp.view")} value={view} onChange={setView}
          options={[{ value: "timeline", label: t("network.rp.view.timeline") }, { value: "graph", label: t("network.rp.view.graph") }, { value: "list", label: t("network.rp.view.list") }]} />
      </div>
      {view === "timeline" && (
        <Block label={t("network.rp.view.timeline")} className="nw-tl-b">
          <RedemptionTimeline list={list} clock={clock} tip={obs.height} />
        </Block>
      )}
      {view === "graph" && <GraphView list={list} />}
      {view === "list" && (
        <div className="nw-tablecard"><Table<RedemptionView> columns={listCols} rows={listRows as RedemptionView[]} rowKey={(r) => r.tx} stack={phone} caption={t("network.rp.view.list")} /></div>
      )}
      {later && <OwnersReceivers obs={obs} />}
    </>
  );
}
const tokenUnitLabel = (u: string, lang: Lang) => (u === "erg" ? "ERG" : u === "use" ? "USE" : u === "use-lookalike" ? (lang === "ru" ? "«USE» (тест)" : "“USE” (test)") : u === "sigusd" ? "SigUSD" : u === "rsada" ? "rsADA" : "?");

function GraphView({ list }: { list: RedemptionView[] }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [mode, setMode] = useState<"graph" | "table">("graph");
  const m = useMemo(() => flowModel(list), [list]);
  const nodeName = (id: string, label: string | null) => label ?? (id === "?" ? t("network.rd.unread") : sAddr(id));
  const ownerOf = new Map(m.owners.map((o) => [o.id, o]));
  const recOf = new Map(m.receivers.map((o) => [o.id, o]));
  const cols: Column<FlowEdge>[] = [
    { key: "o", label: t("network.gr.from"), lead: true, render: (e) => <KeyName pk={ownerOf.get(e.owner)?.key} addr={e.owner} label={ownerOf.get(e.owner)?.label} size={24} /> },
    { key: "r", label: t("network.gr.to"), render: (e) => <KeyName addr={e.receiver === "?" || e.receiver === "—" ? null : e.receiver} label={recOf.get(e.receiver)?.label} size={24} unknown={e.receiver === "?" ? t("network.rd.unread") : "—"} /> },
    { key: "n", label: t("network.gr.n"), align: "right", render: (e) => <span className="num">{e.n}</span> },
    { key: "s", label: t("network.gr.sum"), align: "right", render: (e) => <span className="num">{sumsText(e, lang)}</span> },
  ];
  return (
    <Block label={t("network.gr.title")} aside={<Seg<"graph" | "table"> mono ariaLabel={t("network.rp.view")} value={mode} onChange={setMode} options={[{ value: "graph", label: t("network.col.graph") }, { value: "table", label: t("network.gr.tableToggle") }]} />} className="nw-graph-b">
      <p className="nw-why">{t("network.gr.why", { n: list.length })}</p>
      {mode === "graph" ? <FlowGraph list={list} /> : (
        <div className="nw-tablecard">
          <Table<FlowEdge> columns={cols} rows={[...m.edges].sort((a, b) => b.n - a.n)} rowKey={(e) => e.owner + e.receiver} stack={phone}
            caption={t("network.gr.aria", { owners: m.owners.length, receivers: m.receivers.length, n: list.length })} />
        </div>
      )}
      <span className="sr-only">{m.edges.map((e) => t("network.gr.edge", { owner: nodeName(e.owner, ownerOf.get(e.owner)?.label ?? null), receiver: nodeName(e.receiver, recOf.get(e.receiver)?.label ?? null), n: e.n, amounts: sumsText(e, lang) })).join("; ")}</span>
    </Block>
  );
}

/* ---------- owners and receivers (O04) ---------- */
function OwnersReceivers({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [all, setAll] = useState(false);
  const owners = useMemo(() => [...obs.owners].sort((a, b) => b.boxes - a.boxes || a.firstHeight - b.firstHeight), [obs.owners]);
  const oCols: Column<OwnerRow>[] = [
    { key: "k", label: t("network.c.owner"), lead: true, render: (o) => o.addr ? <KeyName pk={o.key} addr={o.addr} label={o.label} size={24} /> : <span className="dim">{t("network.owner.malformed")}</span> },
    { key: "b", label: t("network.ow.boxes"), align: "right", render: (o) => <span className="num">{o.boxes}</span> },
    { key: "u", label: t("network.ow.unspent"), align: "right", render: (o) => <span className="num">{o.unspent}</span> },
    { key: "e", label: t("network.ow.erg"), align: "right", render: (o) => <span className="num">{ergs(o.unspentNano)}</span> },
    { key: "v", label: t("network.ow.versions"), render: (o) => <span className="nw-inl">{o.contracts.map((sh) => <ContractTag key={sh} c={obs.contracts.find((c) => c.short === sh) ?? null} withRole={false} />)}</span> },
    { key: "s", label: t("network.ow.since"), align: "right", render: (o) => <span className="num">{fmtH(o.firstHeight)}</span> },
  ];
  const rCols: Column<ReceiverRow>[] = [
    { key: "a", label: t("network.c.receiver"), lead: true, render: (r) => <KeyName addr={r.addr} label={r.label} size={24} /> },
    { key: "n", label: t("network.ow.redemptions"), align: "right", render: (r) => <span className="num">{r.redemptions}</span> },
    { key: "s", label: t("network.ow.received"), align: "right", render: (r) => <span className="num">{[`${ergs(r.nano)} ERG`, ...r.tokens.map((x) => tokenStr(x, lang))].map((x, i) => <Fragment key={i}>{i ? " + " : ""}<span className="nw-nobr">{x}</span></Fragment>)}</span> },
  ];
  const malformed = obs.owners.filter((o) => !o.addr).length;
  const cap = phone ? 5 : 10; // a stacked owner row is ~5 lines tall on a phone
  return (
    <Block label={t("network.ow.title")} className="nw-owners">
      <p className="t-small">{t("network.ow.sub", { owners: obs.owners.length - malformed, malformed, receivers: obs.receivers.length })}</p>
      <div className="nw-owners-g">
        <div className="nw-tablecard">
          <Table<OwnerRow> columns={oCols} rows={all ? owners : owners.slice(0, cap)} rowKey={(o, i) => (o.addr ?? "x") + i} stack={phone} caption={t("network.gr.owners")} showCaption />
          {owners.length > cap && <button type="button" className="key sm quiet nw-more" onClick={() => setAll((v) => !v)} aria-expanded={all}>{all ? t("network.col.showLess") : t("network.col.showAll", { n: owners.length })}</button>}
        </div>
        <div className="nw-tablecard">
          <Table<ReceiverRow> columns={rCols} rows={obs.receivers} rowKey={(r) => r.addr} stack={phone} caption={t("network.gr.receivers")} showCaption />
        </div>
      </div>
    </Block>
  );
}

/* =========================== one transaction =========================== */
export function TxPage({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const lang = t.lang as Lang;
  const { txId = "" } = useParams();
  const [retry, setRetry] = useState(0);
  return <TxInner key={retry} txId={txId} obs={obs} lang={lang} t={t} onRetry={() => setRetry((n) => n + 1)} />;
}

function TxInner({ txId, obs, lang, t, onRetry }: { txId: string; obs: Observatory | null; lang: Lang; t: ReturnType<typeof useT>; onRetry: () => void }) {
  const valid = /^[0-9a-f]{64}$/i.test(txId);
  const { loading, redemption: rd, detail, detailState, error } = useRedemption(valid ? txId : null, { detail: true });
  useTitle(`${t(rd ? "network.tx.docTitle" : "network.tx.docTitleOther", { id: sid(txId) })} · ${t("network.title")}`);
  if (loading || !obs) return <NetLoading />;
  if (!valid || (!rd && detailState === "missing")) {
    return (
      <div className="nw-missing">
        <Empty title={t("network.tx.missing")} text={t("network.tx.missingText")} ghost={sid(txId, 6, 4)}
          action={{ label: t("network.tx.back"), to: "/network/redemptions" }} />
        {valid && <Ext kind="tx" id={txId} className="nw-missing-ext">{t("network.nf.explorer", { id: sid(txId, 6, 6) })}</Ext>}
      </div>
    );
  }
  const amt = rd ? redemptionAmount(rd, lang) : detail?.amount ? amountOfDetail(detail, lang) : null;
  const ownerKey = rd?.owner.key ?? detail?.reserveIn?.registers.key ?? null;
  // a redemption known from the reserve's boxes only (its transaction not read yet): no zeros for what is unknown
  const known = rd && !rd.fromBoxes ? rd : null;
  const receiver = rd?.receiver ?? detail?.receiver ?? null;
  const recvKey = keyOfAddress(receiver);
  const pairKey = ownerKey && recvKey ? bytesToHex(blake2b256(new Uint8Array([...hexToBytes(ownerKey), ...hexToBytes(recvKey)]))) : null;
  const h = rd?.height ?? detail?.height ?? null;
  return (
    <>
      <nav className="nw-crumb" aria-label={t("network.bar.aria")}>
        <Link to="/network/redemptions"><Icon name="left" size={14} />{t("network.tx.back")}</Link>
      </nav>
      <header className="nw-tx-head">
        <div className="nw-tx-t">
          <div className="eyebrow label">{rd || detail?.kind === "redemption" ? t("network.tx.eyebrow") : t("network.tx.eyebrowOther")}</div>
          {amt && <h1 className="nw-rv-money"><span className="sr-only">{t("network.tx.amountOf")} </span><span className="t-money">{amt.split(" ")[0]}</span><span className="u">{amt.split(" ").slice(1).join(" ")}</span></h1>}
          {!amt && <h1 className="t-h2">{t("network.c.tx")} {sid(txId, 6, 6)}</h1>}
          {(rd || detail?.reserveIn) && (
            <div className="nw-tx-pair">
              <KeyName pk={ownerKey} addr={rd?.owner.addr ?? null} label={rd?.ownerLabel ?? null} size={40} />
              <span className="arr" aria-hidden="true">→</span>
              <KeyName addr={receiver} label={rd?.receiverLabel ?? null} size={40} unknown={detail ? "—" : t("network.rd.unread")} />
            </div>
          )}
          <div className="nw-rv-tags">
            {rd?.emergencyWindow && <Tag tone="watch" glyph="⚑" title={t("chain.receipt.emergency")}>{t("network.rd.em")}</Tag>}
            {rd?.firstOfPair && <Tag glyph="◇" title={t("network.rd.firstTitle")}>{t("network.rd.first")}</Tag>}
            {rd?.contract && <ContractTag c={obs.index.contracts.get(rd.contract) ?? null} />}
          </div>
        </div>
        {pairKey && (
          <div className="nw-tx-key">
            <PairSeal pairKey={pairKey} size={112} />
            <span className="label">{t("network.tx.pairKey")}</span>
            <span className="hex">{sid(pairKey, 8, 8)}</span>
            <code className="t-small">{t("network.tx.pairKeyHow")}</code>
          </div>
        )}
      </header>
      {h != null && (
        <div className="nw-tx-asof">
          <span className="nw-asof"><Lamp state="committed" size={7} />{t("network.tx.minedIn", { height: fmtH(h) })}</span>
          {rd?.at && <span className="t-small">{dateTime(rd.at, lang)}</span>}
          <AsOf h={obs.height} live={obs.heightLive} />
        </div>
      )}

      {!rd && detail && <p className="t-small nw-note">{t("network.tx.notRedemption", { n: obs.redemptions.length })}</p>}

      <div className="nw-detail">
        <div className="nw-main">
          <Block label={t("network.tx.lens")}>
            <p className="t-small">{t("network.tx.lensSub")}</p>
            {detailState === "loading" || detailState === "idle" ? (
              <TxWait txId={txId} />
            ) : detailState === "error" || !detail ? (
              <ErrorState title={t("network.tx.error")} text={t("network.tx.errorText")} detail={error ?? undefined} onRetry={onRetry} retryLabel={t("network.retry")} />
            ) : (
              <ChainTxLens d={detail} lang={lang} />
            )}
          </Block>
          {detail && <Checks d={detail} rd={rd} />}
        </div>
        <aside className="nw-side">
          <Block label={t("network.tx.facts")}>
            <Facts rows={[
              [t("network.tx.f.id"), <IdLink id={txId} kind="tx" a={8} b={6} copy />],
              [t("network.tx.f.block"), h != null ? <span className="num">{fmtH(h)}</span> : "—"],
              [t("network.tx.f.time"), rd?.at ? dateTime(rd.at, lang) : detail ? dateTime(new Date(detail.timestamp).toISOString(), lang) : "—"],
              [t("network.tx.f.fee"), rd?.fee != null ? `${ergs(rd.fee, 3)} ERG` : detail?.fee != null ? `${ergs(detail.fee, 3)} ERG` : "—"],
              [t("network.tx.f.size"), rd?.size ? t("network.tx.bytes", { n: fmtH(rd.size) }) : detail?.size ? t("network.tx.bytes", { n: fmtH(detail.size) }) : "—"],
              [t("network.tx.f.io"), known ? `${known.inputs} · ${known.outputs}` : detail ? `${detail.inputs.length} · ${detail.outputs.length}` : "—"],
              ...(detail?.confirmations != null ? [[t("network.tx.f.conf"), <span className="num">{fmtH(detail.confirmations)}</span>] as [ReactNode, ReactNode]] : []),
              ...(rd?.feePayers.length ? [[t("network.tx.f.feePayers"), <span className="nw-stackv">{rd.feePayers.map((a) => <IdLink key={a} id={a} kind="address" />)}</span>] as [ReactNode, ReactNode]] : []),
            ]} />
            <p className="t-small">{pick(copy.fee, lang)}</p>
          </Block>
          {rd && (
            <Block label={t("network.tx.flags")}>
              <ul className="nw-flags">
                <li className={cx(!rd.emergencyWindow && "off")}><span className="g" aria-hidden="true">⚑</span>{rd.emergencyWindow ? t("chain.receipt.emergency") : rd.fromBoxes ? t("network.rd.unread") : t("chain.receipt.trackerAge", { age: fmtH(rd.tracker?.age ?? 0) })}</li>
                {rd.firstOfPair && <li><span className="g" aria-hidden="true">◇</span>{t("network.tx.firstOfPair")}</li>}
                {rd.treeWasEmpty && <li><span className="g" aria-hidden="true">○</span>{t("network.tx.treeWasEmpty")}</li>}
              </ul>
            </Block>
          )}
        </aside>
      </div>
    </>
  );
}
function amountOfDetail(d: TxDetail, lang: Lang): string {
  if (!d.amount) return "";
  if (d.amount.unit === "erg") return `${ergs(d.amount.raw)} ERG`;
  const tk = d.reserveIn?.tokens.find((x) => x.id === d.amount!.unit);
  return tk ? tokenStr({ amount: d.amount.raw, decimals: tk.decimals, kind: tk.kind }, lang) : `${d.amount.raw}`;
}

/* ---------- the lens ---------- */
function ChainTxLens({ d, lang }: { d: TxDetail; lang: Lang }) {
  const t = useT();
  return (
    <div className="nw-lens">
      {d.dataInputs.length > 0 && (
        <div className="nw-lens-data">
          <span className="label">{t("network.tx.dataInputs")}</span>
          <div className="nw-lens-col">{d.dataInputs.map((b) => <TxBox key={b.boxId} b={b} lang={lang} tip={d.height} />)}</div>
        </div>
      )}
      <div className="nw-lens-io">
        <div>
          <span className="label">{t("network.tx.inputs")} · {d.inputs.length}</span>
          <div className="nw-lens-col">{d.inputs.map((b) => <TxBox key={b.boxId} b={b} lang={lang} />)}</div>
        </div>
        <div className="nw-lens-arrow" aria-hidden="true"><span /><Icon name="arrow" size={18} /></div>
        <div>
          <span className="label">{t("network.tx.outputs")} · {d.outputs.length}</span>
          <div className="nw-lens-col">{d.outputs.map((b) => <TxBox key={b.boxId} b={b} lang={lang} />)}</div>
        </div>
      </div>
    </div>
  );
}

function TxBox({ b, lang, tip }: { b: TxBoxView; lang: Lang; tip?: number }) {
  const t = useT();
  const isRes = b.role === "reserve-in" || b.role === "reserve-out";
  const metal = isRes || b.role === "payout";
  const nft = b.tokens[0];
  const others = isRes || b.role === "tracker" ? b.tokens.slice(1) : b.tokens;
  return (
    <article className={cx("nw-txbox", `r-${b.role}`)}>
      <header>
        <span className={cx("nw-role", metal && "metal")}>{t(`network.role.${b.role}`)}</span>
        {b.contract && <ContractTag c={b.contract} withRole={false} />}
      </header>
      <div className="nw-txbox-v">
        {isRes && <VaultCoin unit={others[0]?.kind ?? "erg"} size={30} plain />}
        <span className="num v">{ergs(b.value, 3)}&nbsp;ERG</span>
        {others.map((x) => <span key={x.id} className="num tk">+ {tokenStr(x, lang)}</span>)}
      </div>
      {(isRes || b.role === "tracker") && (
        <dl className="nw-txregs">
          {b.registers.key && <div><dt>R4</dt><dd className="hex">{sid(b.registers.key, 6, 4)}</dd></div>}
          {b.registers.tree && <div><dt>R5</dt><dd className="hex">{sid(b.registers.tree.digest, 6, 4)}{b.registers.tree.empty ? ` · ${t("network.res.treeEmpty")}` : ""}</dd></div>}
          {b.registers.nft && <div><dt>R6</dt><dd className="hex">{sid(b.registers.nft, 6, 4)}</dd></div>}
          {b.registers.hasR7 && <div><dt>R7</dt><dd className="num">{b.registers.refundHeight.toString()}</dd></div>}
          {nft && <div><dt>NFT</dt><dd className="hex">{sid(nft.id, 6, 4)}</dd></div>}
          {b.role === "tracker" && tip != null && <div><dt>{t("network.c.age")}</dt><dd className="num">{blocks(Math.max(0, tip - b.creationHeight), lang)}</dd></div>}
        </dl>
      )}
      <footer>
        {!b.contract && <span className="hex addr">{sAddr(b.address)}</span>}
        <IdLink id={b.boxId} kind="box" a={6} b={4} to={isRes ? `/network/reserve/${b.boxId}` : undefined} />
      </footer>
    </article>
  );
}

/** The lens loads through the interactive lane: at once, unless this tab has hit the per-block safety cap of
 *  user-started requests, and then it waits for the next block (up to ≈ 2 min). Say so in words instead of a silent
 *  spinner, and offer the explorer meanwhile. */
function TxWait({ txId }: { txId: string }) {
  const t = useT();
  const st = useChainStatus(); // re-render when the budget moves
  // offline first: failed requests also use up the block's budget, and "spent its share" would then be the wrong reason
  const offline = !st.online && st.lastError !== null;
  const queued = !offline && chainApi.budgetLeft("interactive") === 0;
  return (
    <div className="nw-lazy nw-txwait">
      <Loading label={t("network.tx.loading")} seed={txId} lines={5} />
      <p className="nw-wait" role="status" aria-live="polite">
        {offline ? t("network.tx.offline") : queued ? t("network.tx.queued", { n: CHAIN_BUDGET.userPerBlock }) : t("network.tx.loading")}{" "}
        <Ext kind="tx" id={txId}>{t("network.nf.explorer", { id: sid(txId, 6, 6) })}</Ext>
      </p>
    </div>
  );
}

/* ---------- checks (V09) ---------- */
function Checks({ d, rd }: { d: TxDetail; rd: RedemptionView | null }) {
  const t = useT();
  const lang = t.lang as Lang;
  const ri = d.reserveIn, ro = d.reserveOut, tb = d.tracker;
  const age = d.trackerAge ?? rd?.tracker?.age ?? null;
  const hasR7 = !!(ri?.registers.hasR7 || ro?.registers.hasR7);
  type Row = { id: string; ok: boolean | null; label: string; detail?: ReactNode };
  const rows: Row[] = [
    { id: "script", label: t("network.chk.script"), ok: ri && ro ? ri.templateHash === ro.templateHash : null, detail: ri?.contract ? ri.contract.short : undefined },
    { id: "nft", label: t("network.chk.nft"), ok: ri && ro ? !!ri.tokens[0] && ri.tokens[0].id === ro.tokens[0]?.id : null, detail: ri?.tokens[0] ? sid(ri.tokens[0].id) : undefined },
    { id: "owner", label: t("network.chk.owner"), ok: ri && ro ? !!ri.registers.key && ri.registers.key === ro.registers.key : null },
    { id: "tracker", label: t("network.chk.tracker"), ok: ri && ro ? !!ri.registers.nft && ri.registers.nft === ro.registers.nft : null },
    ...(hasR7 ? [{ id: "r7", label: t("network.chk.r7"), ok: ri && ro ? ri.registers.refundHeight === ro.registers.refundHeight : null }] : []),
    { id: "data", label: t("network.chk.dataInput"), ok: tb && ri ? tb.tokens[0]?.id === ri.registers.nft : null, detail: tb?.tokens[0] ? sid(tb.tokens[0].id) : undefined },
    { id: "amount", label: t("network.chk.amount"), ok: d.amount ? d.amount.raw > 0n : null, detail: d.amount ? amountOfDetail(d, lang) : undefined },
    { id: "tree", label: t("network.chk.tree"), ok: ri?.registers.tree && ro?.registers.tree ? ri.registers.tree.digest !== ro.registers.tree.digest : null },
    { id: "payout", label: t("network.chk.payout"), ok: d.receiver ? d.outputs.some((o) => o.role === "payout" && o.address === d.receiver) : null, detail: d.receiver ? sAddr(d.receiver) : undefined },
  ];
  return (
    <Block label={t("network.chk.title")} className="nw-checks">
      <ol className="nw-chk">
        {rows.map((r) => (
          <li key={r.id} className={cx(r.ok === true && "ok", r.ok === false && "bad", r.ok == null && "na")}>
            <span className="g" aria-hidden="true">{r.ok === true ? "✓" : r.ok === false ? "✕" : "–"}</span>
            <span className="l">{r.label}</span>
            {r.detail && <span className="d hex">{r.detail}</span>}
            <span className="sr-only">{r.ok === true ? t("network.chk.pass") : r.ok === false ? t("network.chk.fail") : t("network.chk.na")}</span>
          </li>
        ))}
        {age != null && (
          <li className={cx("age", age > EMERGENCY_BLOCKS && "em")}>
            <span className="g" aria-hidden="true">{age > EMERGENCY_BLOCKS ? "⚑" : "✓"}</span>
            <span className="l">{t("network.chk.age", { age: blocks(age, lang) })}: {age > EMERGENCY_BLOCKS ? t("network.chk.mode.em") : t("network.chk.mode.sig")}</span>
          </li>
        )}
      </ol>
      <p className="nw-hidden"><Icon name="info" size={15} />{t("network.chk.hidden")}</p>
    </Block>
  );
}
