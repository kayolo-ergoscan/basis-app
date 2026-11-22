// /network/reserves (FEATURES O02, O05, R16, R17) and /network/reserve/:boxId (R11, R13, R14, R15, R19, X10, H06, H07,
// V05, O12). Filters live in the URL so a filtered list can be linked.
import { startTransition, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "./query";
import { rich, useT, useTitle } from "@/app";
import { Digest, Empty, FaceTabs, Faces, Icon, KeySeal, Seg, Table, Tag, useIsPhone, type Column } from "@/ui";
import { copy, pick } from "@/content";
import { decodeConstant, describeExit, isOurTestReserve, OurTestReserveTag, REFUND_BLOCKS, useReserve, type ExitClass, type Observatory, type RedemptionView, type ReserveView } from "@/chain";
import { amount, date, ergs, height as fmtH, sAddr, sid, tokenStr, tokenUnit, type Lang } from "./fmt";
import { AsOf, Block, ContractTag, EXIT_ORDER, ExitTag, Ext, Facts, IdLink, KeyName, NetLoading, NftTile, TrackerTag, trackerSilent, UntrustedName, useProgressive } from "./parts";
import { FeedRow, r7Word, reserveRank, TopUpClosed, TrackerPanel, treeWord, unitKind, VaultCard } from "./Overview";
import { ExitClocks } from "./lazyViz";
import { redemptionAmount, unitOf, VaultCoin } from "./viz";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
type TokenFilter = "erg" | "use" | "use-lookalike";
const PAGE = 24;

/* =========================== list =========================== */
export function ReservesList({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [sp, setQ, resetQ] = useQuery();
  const [more, setMore] = useState(0);
  const f = {
    v: sp.get("v") ?? "",
    x: (sp.get("x") ?? "") as ExitClass | "",
    k: (sp.get("k") ?? "") as TokenFilter | "",
    r5: (sp.get("r5") ?? "") as "has" | "empty" | "",
    s: sp.get("s") === "all" ? "all" : "unspent",
    view: (sp.get("view") === "table" ? "table" : "cards") as "cards" | "table",
  };
  // a filter or "more" click may mount a page of cards with key seals: render it as a transition (no long task)
  const set = (k: string, v: string) => startTransition(() => {
    setQ({ [k]: v });
    setMore(0);
  });
  const base = f.s === "all" ? obs.reserves : obs.unspent;
  const variants = useMemo(() => obs.contracts.filter((c) => c.role === "legacy" || (c.current && (obs.totals.byContract[c.id]?.boxes ?? 0) > 0)), [obs]);
  const list = useMemo(() => base.filter((r) =>
    (!f.v || r.contract?.short === f.v) &&
    (!f.x || r.exit?.class === f.x) &&
    (!f.k || unitKind(r) === f.k) &&
    (!f.r5 || (f.r5 === "has" ? !!r.r5 && !r.r5.empty && !r.r5.zero : !!r.r5 && r.r5.empty))
  ).sort(f.s === "all" ? (a, b) => b.height - a.height : reserveRank), [base, f.v, f.x, f.k, f.r5, f.s]);
  const filtered = !!(f.v || f.x || f.k || f.r5);
  const shown = useProgressive(f.view === "cards" ? list.slice(0, PAGE + more) : list, 6);

  const cols: Column<ReserveView>[] = [
    { key: "box", label: t("network.c.box"), lead: true, render: (r) => <Link to={`/network/reserve/${r.id}`} className="hex">{sid(r.id, 6, 4)}</Link> },
    { key: "v", label: t("network.c.version"), render: (r) => <ContractTag c={r.contract} withRole={false} /> },
    { key: "value", label: t("network.c.value"), align: "right", render: (r) => <span className="num">{ergs(r.value)}&nbsp;ERG</span> },
    { key: "tok", label: t("network.c.token"), align: "right", render: (r) => r.collateral ? <span className="num">{tokenStr(r.collateral, lang)}</span> : <span className="dim">—</span> },
    { key: "exit", label: t("network.c.exit"), render: (r) => r.exit ? <ExitTag cls={r.exit.class} /> : <Tag>{t("network.res.spent")}</Tag> },
    { key: "trk", label: t("network.c.tracker"), render: (r) => r.r6 ? <Link to={`/network/tracker/${r.r6}`} className="hex">{r.r6.slice(0, 8)}</Link> : <span className="dim">—</span> },
    { key: "r5", label: t("network.c.tree"), render: (r) => treeWord(r, t) },
    { key: "r7", label: t("network.c.r7"), render: (r) => r7Word(r, obs.height, t) },
    { key: "owner", label: t("network.c.owner"), render: (r) => r.owner ? <span className="nw-inl"><KeySeal pk={r.owner.key} size={20} /><span className="hex">{sAddr(r.owner.addr)}</span>{isOurTestReserve(r.owner.key) && <OurTestReserveTag />}</span> : <span className="dim">{t("network.owner.malformed")}</span> },
    { key: "h", label: t("network.c.height"), align: "right", render: (r) => <span className="num">{fmtH(r.height)}</span> },
  ];

  return (
    <>
      <header className="nw-head">
        <div>
          <div className="eyebrow label">{t("network.rs.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.rs.h1"))}</h1>
          <p className="t-lede">{t("network.rs.lede", { total: obs.reserves.length, unspent: obs.unspent.length })}</p>
        </div>
        <AsOf h={obs.height} live={obs.heightLive} />
      </header>

      <Totals obs={obs} base={base} onPick={(k, v) => set(k, v)} active={f} variants={variants.map((c) => c.short)} />

      <div className="nw-filters" role="group" aria-label={t("network.rs.filters")}>
        <FilterRow label={t("network.f.variant")} value={f.v} onChange={(v) => set("v", v)}
          options={[{ value: "", label: t("network.f.all") }, ...variants.map((c) => ({ value: c.short, label: c.short }))]} />
        <FilterRow label={t("network.f.exit")} value={f.x} onChange={(v) => set("x", v)}
          options={[{ value: "", label: t("network.f.all") }, ...EXIT_ORDER.filter((c) => base.some((r) => r.exit?.class === c)).map((c) => ({ value: c, label: t(`chain.exit.${c}.short`) }))]} />
        <FilterRow label={t("network.f.token")} value={f.k} onChange={(v) => set("k", v)}
          options={[{ value: "", label: t("network.f.all") }, { value: "erg", label: "ERG" }, { value: "use", label: tokenUnit("use", lang) }, { value: "use-lookalike", label: tokenUnit("use-lookalike", lang) }]} />
        <FilterRow label={t("network.f.tree")} value={f.r5} onChange={(v) => set("r5", v)}
          options={[{ value: "", label: t("network.f.all") }, { value: "has", label: t("network.f.treeHas") }, { value: "empty", label: t("network.f.treeEmpty") }]} />
        <FilterRow label={t("network.f.state")} value={f.s} onChange={(v) => set("s", v === "unspent" ? "" : v)}
          options={[{ value: "unspent", label: t("network.f.unspent") }, { value: "all", label: t("network.f.everything", { n: obs.reserves.length }) }]} />
      </div>

      <div className="nw-results-h">
        <span className="label" role="status" aria-live="polite">{t("network.f.shown", { n: list.length, total: base.length })}</span>
        <div className="cluster">
          {filtered && <button type="button" className="key sm quiet" onClick={() => { resetQ(); setMore(0); }}>{t("network.f.reset")}</button>}
          <Seg<"cards" | "table"> mono ariaLabel={t("network.f.view")} value={f.view} onChange={(v) => set("view", v === "cards" ? "" : v)}
            options={[{ value: "cards", label: t("network.f.cards") }, { value: "table", label: t("network.f.table") }]} />
        </div>
      </div>

      {list.length === 0 ? (
        <Empty title={t("network.f.none")} ghost={t("network.f.noneGhost")} action={{ label: t("network.f.reset"), onClick: () => { resetQ(); setMore(0); } }} />
      ) : f.view === "table" ? (
        <div className="nw-tablecard">
          <Table<ReserveView> columns={cols} rows={shown as ReserveView[]} rowKey={(r) => r.id} stack={phone} caption={t("network.tab.reserves")} />
        </div>
      ) : (
        <>
          <div className="nw-vgrid">{shown.map((r) => <VaultCard key={r.id} r={r} obs={obs} />)}</div>
          {list.length > shown.length && (
            <button type="button" className="key sm nw-more" onClick={() => startTransition(() => setMore((m) => m + PAGE))}>{t("network.f.more", { n: Math.min(PAGE, list.length - shown.length) })}</button>
          )}
        </>
      )}
      <TopUpClosed />
    </>
  );
}

function FilterRow<V extends string>({ label, value, onChange, options }: { label: string; value: V | ""; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <div className="nw-frow">
      <span className="label">{label}</span>
      <div className="nw-fopts" role="group" aria-label={label}>
        {options.map((o) => (
          <button key={o.value || "all"} type="button" className={cx("nw-fopt", value === o.value && "on")} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
        ))}
      </div>
    </div>
  );
}

/* ---------- totals (O05): by version, by token, by exit class; a row click filters ---------- */
function Totals({ obs, base, onPick, active, variants }: { obs: Observatory; base: ReserveView[]; onPick: (k: string, v: string) => void; active: { v: string; x: string; k: string }; variants: string[] }) {
  const t = useT();
  const lang = t.lang as Lang;
  const agg = (pred: (r: ReserveView) => boolean) => {
    let n = 0, nano = 0n;
    const tok = new Map<string, { amount: bigint; decimals: number; kind: ReserveView["collateral"] extends infer C ? (C extends { kind: infer K } ? K : never) : never }>();
    for (const r of base) {
      if (!pred(r)) continue;
      n++; nano += r.value;
      if (r.collateral) {
        const c = r.collateral, cur = tok.get(c.id);
        tok.set(c.id, { amount: (cur?.amount ?? 0n) + c.amount, decimals: c.decimals, kind: c.kind });
      }
    }
    return { n, nano, tok: [...tok.values()] };
  };
  const max = base.length || 1;
  const row = (key: string, value: string, label: ReactNode, a: ReturnType<typeof agg>, on: boolean, showTok = true) => (
    <li key={value || label?.toString()}>
      <button type="button" className={cx("nw-trow", on && "on")} aria-pressed={on} onClick={() => onPick(key, on ? "" : value)}>
        <span className="l">{label}</span>
        <span className="bar" aria-hidden="true"><i style={{ width: `${(a.n / max) * 100}%` }} /></span>
        <span className="n num">{a.n}</span>
        <span className="a num">{ergs(a.nano)}&nbsp;ERG{showTok && a.tok.map((x) => <span key={x.kind} className="tk"> + {amount(x.amount, x.decimals)}&nbsp;{tokenUnit(x.kind, lang)}</span>)}</span>
      </button>
    </li>
  );
  const byV = variants.map((v) => row("v", v, <ContractTag c={obs.contracts.find((c) => c.short === v) ?? null} withRole={false} />, agg((r) => r.contract?.short === v), active.v === v));
  const kinds: TokenFilter[] = ["erg", "use", "use-lookalike"];
  const byK = kinds.map((k) => {
    const a = agg((r) => unitKind(r) === k);
    return row("k", k, <b>{tokenUnit(k, lang)}</b>, a, active.k === k, k !== "erg");
  });
  const byX = EXIT_ORDER.map((x) => ({ x, a: agg((r) => r.exit?.class === x) })).filter((y) => y.a.n > 0).map(({ x, a }) => row("x", x, <ExitTag cls={x} />, a, active.x === x));
  return (
    <section className="nw-totals" aria-label={`${t("network.rs.byVariant")}, ${t("network.rs.byToken")}, ${t("network.rs.byExit")}`}>
      <div className="nw-tcard"><h2 className="label">{t("network.rs.byVariant")}</h2><ul>{byV}</ul></div>
      <div className="nw-tcard"><h2 className="label">{t("network.rs.byToken")}</h2><ul>{byK}</ul></div>
      <div className="nw-tcard x"><h2 className="label">{t("network.rs.byExit")}</h2><ul>{byX}</ul></div>
    </section>
  );
}

/* =========================== detail =========================== */
export function ReserveDetail({ obs }: { obs: Observatory | null }) {
  const t = useT();
  const lang = t.lang as Lang;
  const { boxId = "" } = useParams();
  const { loading, reserve: r, tracker, lineage, redemptions } = useReserve(boxId);
  useTitle(r ? `${t("network.rv.title", { id: sid(r.id) })} · ${t("network.title")}` : t("network.title"));
  if (loading || !obs) return <NetLoading />;
  if (!r) {
    return (
      <div className="nw-missing">
        <Empty title={t("network.rv.notFound.title")} text={t("network.rv.notFound.text", { n: obs.reserves.length })} ghost={sid(boxId, 6, 4)}
          action={{ label: t("network.rv.back"), to: "/network/reserves" }} />
        {/^[0-9a-f]{64}$/i.test(boxId) && <Ext kind="box" id={boxId} className="nw-missing-ext">{t("network.nf.explorer", { id: sid(boxId, 6, 6) })}</Ext>}
      </div>
    );
  }
  const tok = r.collateral;
  const ex = r.exit;
  const em = ex?.emergency ?? tracker?.emergency ?? null;
  // a tracker NFT outside the seed has no TrackerView: its box comes from the live lookup (the assessment's clock)
  const trackerBoxH = tracker ? (tracker.lastTrackerBox?.unspent ? tracker.lastTrackerBox.height : null) : ex?.emergency?.boxHeight ?? null;
  const checking = ex?.reason.code === "tracker-unknown";   // not looked up yet: "checking", never "no box"
  const gone = tracker && (tracker.status === "burned" || tracker.status === "locked") ? tracker.status : null;
  return (
    <>
      <nav className="nw-crumb" aria-label={t("network.bar.aria")}>
        <Link to="/network/reserves"><Icon name="left" size={14} />{t("network.rv.back")}</Link>
      </nav>
      <header className="nw-rv-head">
        <VaultCoin unit={unitKind(r)} size={128} spent={!r.unspent} className="nw-rv-coin" />
        <div className="nw-rv-t">
          <div className="eyebrow label">{t("network.rv.eyebrow")}<span className="nw-case">{r.contract?.short ?? "?"}</span></div>
          <h1 className="nw-rv-money">
            {tok ? (<><span className="t-money">{amount(tok.amount, tok.decimals)}</span><span className="u">{tokenUnit(tok.kind, lang)}</span></>)
              : (<><span className="t-money">{ergs(r.value)}</span><span className="u">ERG</span></>)}
            <span className="sr-only"> · {t("network.rv.title", { id: sid(r.id) })}</span>
          </h1>
          <div className="nw-rv-id"><IdLink id={r.id} kind="box" a={10} b={8} copy />{tok && <span className="dim num">+ {ergs(r.value)}&nbsp;ERG</span>}</div>
          <div className="nw-rv-tags">
            {ex && <ExitTag cls={ex.class} long />}
            <ContractTag c={r.contract} />
            <Tag tone={r.unspent ? "metal" : "plain"}>{r.unspent ? t("network.res.unspent") : t("network.res.spent")}</Tag>
          </div>
          {r.legacy && r.contract && <p className="nw-legacy"><Icon name="warn" size={15} />{r.contract.ownerExit ? t("chain.contract.legacy.refundable") : t("chain.contract.legacy.noExit")}</p>}
        </div>
        <AsOf h={r.checked?.height ?? obs.height} live={!!r.checked || obs.heightLive} />
      </header>

      <div className="nw-detail">
        <div className="nw-main">
          <Block label={t("network.rv.exitQ")} className="nw-exit">
            {ex ? (
              <>
                <p className="nw-exit-s">{describeExit(ex, lang)}</p>
                <dl className="nw-exit-rows">
                  <div><dt>{t("network.rv.ownerExit")}</dt><dd className={cx(ex.refund !== "no" && "yes")}>{ex.refund === "yes" ? t("network.rv.refund.yes") : t(`network.rv.refund.${ex.refund}`)}</dd></div>
                  <div><dt>{t("network.rv.holderRedeem")}</dt><dd className={cx(ex.redeem === "now" && "yes")}>{t(`network.rv.redeem.${ex.redeem}`)}</dd></div>
                </dl>
                <p className="nw-facts-mono"><code>{pick(copy.facts.emergency, lang)}</code><code>{pick(copy.facts.refund, lang)}</code></p>
              </>
            ) : (
              <p className="nw-exit-s">{t("network.rv.spentNote", { tx: sid(r.spent?.tx ?? "") })} {r.spent?.tx && <Ext kind="tx" id={r.spent.tx} />}</p>
            )}
          </Block>

          {r.unspent && (
            <Block label={t("network.rv.clocks")} className="nw-clocks">
              {gone ? (
                <>
                  {/* no tracker box can be counted: the emergency dial would only say "no box yet", which is wrong for a burned NFT */}
                  <p className="nw-clocks-gone"><span className="g" aria-hidden="true">{gone === "burned" ? "✕" : "⊘"}</span>
                    {t(`network.rv.clocksGone.${gone}`, { id: sid(tracker!.nft), h: fmtH(tracker!.evidence.height ?? 0) })}</p>
                  {r.contract?.ownerExit && (
                    <ExitClocks height={obs.height} boxCreationHeight={null} r7={r.r7 && r.r7 > 0 ? r.r7 : null} show="exit"
                      loading={t("network.rv.clocksLoading")} failed={null} />
                  )}
                  {r.contract?.ownerExit && <p className="t-small">{t("network.rv.clocksNoteExit")}</p>}
                </>
              ) : (
                <>
                  <ExitClocks height={obs.height} boxCreationHeight={trackerBoxH} boxPending={checking} r7={r.r7 && r.r7 > 0 ? r.r7 : null}
                    show={r.contract?.ownerExit ? "both" : "emergency"} trackerName={tracker ? sid(tracker.nft) : undefined}
                    loading={t("network.rv.clocksLoading")}
                    failed={<><ClocksFallback em={em} checking={checking} lang={lang} /><p className="nw-em-idle">{t("network.em.idle")}</p></>} />
                  <p className="t-small">{t("network.rv.clocksNote")} {pick(copy.refundCreditors, lang)}</p>
                </>
              )}
            </Block>
          )}

          <Registers r={r} obs={obs} />
          <Lineage r={r} lineage={lineage} obs={obs} />
          <PerPair r={r} list={redemptions} />
          <Block label={t("network.rv.redemptions")} aside={<span className="label num">{redemptions.length}</span>}>
            {redemptions.length ? <ol className="nw-feed">{redemptions.map((x) => <FeedRow key={x.tx} r={x} />)}</ol> : <p className="t-small">{t("network.rv.noRedemptions")}</p>}
          </Block>
        </div>

        <aside className="nw-side">
          <Block label={t("network.rv.binding")}>
            {tracker ? <TrackerPanel tr={tracker} tip={obs.height} compact /> : <p className="t-small">{r.r6 ? <span className="hex">{sid(r.r6, 8, 6)}</span> : t("network.res.noTracker")}</p>}
            <p className="t-small nw-bound">{pick(copy.boundForever, lang)}</p>
          </Block>
          <Block label={t("network.rv.facts")}>
            <Facts rows={[
              [t("network.rv.f.box"), <IdLink id={r.id} kind="box" a={8} b={6} copy />],
              [t("network.rv.f.value"), <span className="num">{ergs(r.value, 3)}&nbsp;ERG</span>],
              ...(tok ? [[t("network.rv.f.token"), <span className="nw-inl"><span className="num">{tokenStr(tok, lang)}</span><Ext kind="token" id={tok.id} /></span>] as [ReactNode, ReactNode]] : []),
              [t("network.rv.f.tx"), r.tx ? <IdLink id={r.tx} kind="tx" a={8} b={6} /> : "—"],
              [t("network.rv.f.height"), <span className="num">{fmtH(r.height)} · {date(r.at, lang)}</span>],
              [t("network.rv.f.contract"), <span className="nw-inl"><ContractTag c={r.contract} withRole={false} /><span className="t-small">{r.contract ? t(`chain.contract.${r.contract.role}`) : "—"}</span></span>],
              [t("network.rv.f.template"), r.contract ? <span className="hex" title={r.contract.templateHash}>{sid(r.contract.templateHash, 8, 6)}</span> : "—"],
              [t("network.rv.f.nft"), r.nft ? <span className="nw-inl"><span className="hex">{sid(r.nft.id, 6, 4)}</span><UntrustedName name={r.nft.name} /><Ext kind="token" id={r.nft.id} /></span> : "—"],
              [t("network.rv.f.creator"), r.creator ? <IdLink id={r.creator} kind="address" /> : "—"],
              [t("network.rv.f.state"), r.unspent ? t("network.res.unspent") : <span className="nw-inl">{t("network.res.spent")}{r.spent?.tx && <IdLink id={r.spent.tx} kind="tx" to={`/network/tx/${r.spent.tx}`} />}</span>],
              [t("network.rv.f.mempool"), r.pending < 0 ? t("network.rv.mempool.unknown") : r.pending === 0 ? t("network.rv.mempool.none") : <b>{t("network.rv.mempool.some", { n: r.pending })}</b>],
              [t("network.rv.f.checked"), r.checked?.height ? t("chain.live.checked", { height: fmtH(r.checked.height) }) : t("network.rv.notChecked")],
              ...(r.issues.length ? [[t("network.rv.issues"), <span className="nw-issues">{r.issues.map((i) => <code key={i}>{i}</code>)}</span>] as [ReactNode, ReactNode]] : []),
            ]} />
          </Block>
          <TopUpClosed />
        </aside>
      </div>
    </>
  );
}

function ClocksFallback({ em, checking, lang }: { em: { open: boolean; age: number; opensAt: number; blocksLeft: number } | null; checking?: boolean; lang: Lang }) {
  const t = useT();
  if (!em) return <p className="t-small">{t(checking ? "viz.clock.checking" : "network.trk.noBox")}</p>;
  return <p className="nw-em-l">{em.open ? t("network.trk.emOpen", { h: fmtH(em.opensAt) }) : t("network.trk.emOpens", { h: fmtH(em.opensAt), left: `${fmtH(em.blocksLeft)}` })} · {lang === "ru" ? "возраст" : "age"} {fmtH(em.age)}</p>;
}

/* ---------- registers: Story and Machine faces (R13, V05) ---------- */
function Registers({ r, obs }: { r: ReserveView; obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const tr = r.r6 ? obs.index.trackers.get(r.r6) ?? null : null;
  const ops = r.r5 ? [r.r5.flags & 1 && "insert", r.r5.flags & 2 && "update", r.r5.flags & 4 && "remove"].filter(Boolean).join(" · ") || "—" : "—";
  const regs = (["R4", "R5", "R6", "R7"] as const).map((k) => {
    const hex = r.regs[k];
    if (!hex) return { k, hex: null as string | null, type: t("network.rv.missing"), display: "—" };
    try {
      const d = decodeConstant(hex);
      return { k, hex, type: d.type, display: d.display };
    } catch (e) {
      return { k, hex, type: "?", display: e instanceof Error ? e.message : String(e) };
    }
  });
  const story = (
    <div className="nw-regs">
      <div className="nw-reg">
        <span className="label">{t("network.rv.r4")}</span>
        {r.owner ? <KeyName pk={r.owner.key} addr={r.owner.addr} label={r.owner.label} size="md" sub={isOurTestReserve(r.owner.key) ? <OurTestReserveTag /> : undefined} /> : <p className="t-small">{t("chain.malformedOwner")}</p>}
        <p className="t-small">{t("network.rv.r4Story")}</p>
      </div>
      <div className="nw-reg">
        <span className="label">{t("network.rv.r5")}</span>
        {r.r5 ? (
          <>
            <Digest value={r.r5.digest} label={treeWord(r, t)} head={12} tail={6} />
            <p className="t-small mono">{t("network.rv.r5Flags", { ops, k: r.r5.keyLength })}</p>
          </>
        ) : <p className="t-small">{t("network.res.treeBad")}</p>}
        <p className="t-small">{t("network.rv.r5Story")}</p>
      </div>
      <div className="nw-reg">
        <span className="label">{t("network.rv.r6")}</span>
        {r.r6 ? (
          <span className="nw-inl">
            <NftTile nft={r.r6} silent={trackerSilent(tr)} size="sm" />
            <Link to={`/network/tracker/${r.r6}`} className="hex">{sid(r.r6, 8, 6)}</Link>
            {tr && <UntrustedName name={tr.name} />}
            {tr && <TrackerTag tr={tr} />}
          </span>
        ) : <p className="t-small">{t("network.res.noTracker")}</p>}
        <p className="t-small">{pick(copy.boundForever, lang)}</p>
      </div>
      <div className="nw-reg">
        <span className="label">{t("network.rv.r7")}</span>
        <p className="t-small">
          {r.r7 == null || !r.contract?.ownerExit ? t("chain.refund.notInContract")
            : r.r7 === 0 ? t("chain.refund.none")
              : t("network.rv.r7Started", { h: fmtH(r.r7), done: fmtH(r.r7 + REFUND_BLOCKS) })}
        </p>
      </div>
    </div>
  );
  const machine = (
    <div className="nw-mach">
      <table className="tbl">
        <thead><tr><th scope="col">Reg</th><th scope="col">{t("network.rv.type")}</th><th scope="col">{t("network.rv.decoded")}</th></tr></thead>
        <tbody>
          {regs.map((x) => (
            <tr key={x.k}>
              <td className="mono">{x.k}</td>
              <td className="mono">{x.type}</td>
              <td><span className="hex nw-wrap">{x.display}</span>{x.hex && <span className="nw-raw hex">{x.hex}</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.contract && <p className="t-small mono">templateHash = {r.contract.templateHash}</p>}
    </div>
  );
  return (
    <Block label={t("network.rv.regs")} aside={<FaceTabs idBase="nw-regs" />} className="nw-regs-b">
      <p className="t-small">{t("network.rv.regsSub")}</p>
      <Faces human={story} machine={machine} />
    </Block>
  );
}

/* ---------- box chain (R14) ---------- */
function Lineage({ r, lineage, obs }: { r: ReserveView; lineage: ReserveView[]; obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  if (lineage.length <= 1 && !r.spent) return null;
  return (
    <Block label={t("network.rv.lineage")} aside={<span className="label num">{lineage.length}</span>}>
      <p className="t-small">{t("network.rv.lineageSub")}</p>
      <ol className="nw-chain">
        {lineage.map((b, i) => {
          const next = lineage[i + 1];
          const red = b.spent?.tx ? obs.index.redemptions.get(b.spent.tx) ?? null : null;
          const tokD = next && b.collateral && next.collateral ? next.collateral.amount - b.collateral.amount : 0n;
          const ergD = next ? next.value - b.value : 0n;
          const delta = red ? `−${redemptionAmount(red, lang)}`
            : tokD !== 0n && b.collateral ? `${tokD > 0n ? "+" : "−"}${amount(tokD < 0n ? -tokD : tokD, b.collateral.decimals)} ${tokenUnit(b.collateral.kind, lang)}`
              : ergD !== 0n ? `${ergD > 0n ? "+" : "−"}${ergs(ergD < 0n ? -ergD : ergD)} ERG` : "";
          return (
            <li key={b.id} className={cx("nw-chain-i", b.id === r.id && "this", !b.unspent && "spent")}>
              <Link to={`/network/reserve/${b.id}`} className="nw-chain-box" aria-current={b.id === r.id ? "page" : undefined}>
                <VaultCoin unit={unitKind(b)} size={34} spent={!b.unspent} plain />
                <span className="v num">{b.collateral ? `${amount(b.collateral.amount, b.collateral.decimals)} ${tokenUnit(b.collateral.kind, lang)}` : `${ergs(b.value)} ERG`}</span>
                <span className="s">{b.id === r.id ? t("network.rv.thisBox") : sid(b.id)} · {fmtH(b.height)}</span>
              </Link>
              {b.spent && (
                <span className={cx("nw-chain-tx", red && "red")}>
                  <span className="arr" aria-hidden="true">→</span>
                  {b.spent.tx ? <Link to={`/network/tx/${b.spent.tx}`} className="hex">{sid(b.spent.tx)}</Link> : <span className="dim">?</span>}
                  {delta && <b className="num">{delta}</b>}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

/* ---------- redeemed per pair (R15) ---------- */
function PerPair({ r, list }: { r: ReserveView; list: RedemptionView[] }) {
  const t = useT();
  const lang = t.lang as Lang;
  const rows = useMemo(() => {
    const m = new Map<string, { receiver: string; label: string | null; n: number; sums: Map<string, { raw: bigint; dec: number; unit: string }> }>();
    for (const x of list) {
      const k = x.receiver ?? "?";
      const e = m.get(k) ?? { receiver: k, label: x.receiverLabel, n: 0, sums: new Map() };
      e.n++;
      const u = unitOf(x), dec = x.unit === "erg" ? 9 : x.token?.decimals ?? 0;
      const cur = e.sums.get(u);
      e.sums.set(u, { raw: (cur?.raw ?? 0n) + x.amount, dec, unit: tokenUnit(u, lang) });
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => b.n - a.n);
  }, [list, lang]);
  if (!rows.length) return null;
  return (
    <Block label={t("network.rv.redeemedPair")}>
      <p className="t-small">{t("network.rv.redeemedPairSub")}</p>
      <ul className="nw-pairs">
        {rows.map((p) => (
          <li key={p.receiver}>
            <KeyName pk={r.owner?.key} addr={r.owner?.addr} label={r.owner?.label} size={28} />
            <span className="arr" aria-hidden="true">→</span>
            <KeyName addr={p.receiver} label={p.label} size={28} />
            <span className="sum num">{[...p.sums.values()].map((s) => `${amount(s.raw, s.dec)} ${s.unit}`).join(" + ")}</span>
            <span className="n label">{t("network.rp.count", { n: p.n })}</span>
          </li>
        ))}
      </ul>
    </Block>
  );
}

