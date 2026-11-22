// /network/contracts (FEATURES O01, R17, V06): every Basis template with header, constants, AVL op, exits, repo dates
// and box counts. "Verify" hashes the template bytes in the browser (SHA-256, WebCrypto) against the registry.
import { useCallback, useState } from "react";
import { rich, useT } from "@/app";
import { Callout, Icon, Key, Lamp, Sheet, Table, Tag, useIsPhone, type Column } from "@/ui";
import { copy, pick } from "@/content";
import { templateHash, type ContractView, type Observatory } from "@/chain";
import { blocks, date, ergs, height as fmtH, sid, type Lang } from "./fmt";
import { AsOf, Block } from "./parts";
import { TemplateHashTool } from "./lazyViz";

const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
type VState = "busy" | "ok" | "bad";

const repoDate = (s: string | null) => (s ? /\d{4}-\d{2}-\d{2}/.exec(s)?.[0] ?? null : null);
const chainStats = (c: ContractView) => ("creations" in c.chain ? c.chain : null);

export function ContractsPage({ obs }: { obs: Observatory }) {
  const t = useT();
  const lang = t.lang as Lang;
  const phone = useIsPhone();
  const [v, setV] = useState<Record<string, VState>>({});
  const [tool, setTool] = useState<ContractView | null>(null);
  const verify = useCallback(async (c: ContractView) => {
    setV((s) => ({ ...s, [c.id]: "busy" }));
    try {
      const h = await templateHash(c.ergoTree);
      setV((s) => ({ ...s, [c.id]: h === c.templateHash ? "ok" : "bad" }));
    } catch {
      setV((s) => ({ ...s, [c.id]: "bad" }));
    }
  }, []);
  const verifyAll = async (list: ContractView[]) => {
    for (const c of list) {
      await verify(c);
      await new Promise((r) => setTimeout(r, 0)); // let the page paint between hashes
    }
  };
  const current = obs.contracts.filter((c) => c.current);
  const legacy = obs.contracts.filter((c) => c.role === "legacy").sort((a, b) => (chainStats(a)?.firstHeight ?? 0) - (chainStats(b)?.firstHeight ?? 0));
  const other = obs.contracts.filter((c) => c.role === "repo-only" || c.role === "superseded");
  const det = obs.detector;
  const curBoxes = current.reduce((n, c) => n + (obs.totals.byContract[c.id]?.boxes ?? 0), 0);

  const emCell = (c: ContractView) => !c.params.emergency ? "—" : c.params.emergency.unit === "blocks"
    ? <span className="num">{blocks(c.params.emergency.value, lang)}</span>
    : <span className="nw-inl"><span className="num nw-old">{t("network.ct.ms", { ms: fmtH(c.params.emergency.value) })}</span><sup title={t("chain.contract.msWindow")}>*</sup></span>;
  const avl = (c: ContractView) => <span className="nw-inl">{c.avlOps.map((o) => <code key={o} className={cx("nw-op", o === "insert" && "ins")}>{o}</code>)}</span>;
  const exitCell = (c: ContractView) => c.ownerExit ? <Tag tone="watch" glyph="↩">{t("network.ct.exit.refund")}</Tag> : <Tag glyph="✕">{t("network.ct.exit.none")}</Tag>;
  const repoCell = (c: ContractView) => {
    const a = repoDate(c.repo.first), b = repoDate(c.repo.last);
    // a range breaks only after the dash on narrow screens: "23 Oct 2025 –" / "28 Feb 2026"
    return a ? <span className="num nw-range"><span>{date(a, lang)}</span>{b && b !== a ? <>{"\u00a0– "}<span>{date(b, lang)}</span></> : null}</span> : <span className="dim">{c.repo.first ?? "—"}</span>;
  };
  const verifyCell = (c: ContractView) => <Verify c={c} state={v[c.id]} onVerify={() => void verify(c)} onTool={() => setTool(c)} />;

  const cols: Column<ContractView>[] = [
    { key: "v", label: t("network.ct.c.version"), lead: true, render: (c) => <Ver c={c} id={c.id} /> },
    { key: "k", label: t("network.ct.c.kind"), render: (c) => t(`network.kind.${c.kind}`) },
    { key: "tree", label: t("network.ct.c.tree"), render: (c) => <span className="nw-treec"><code>0x{c.header}</code><span className="dim"> · </span><span className="num">{c.constantsCount}</span></span> },
    { key: "em", label: t("network.ct.c.em"), render: emCell },
    { key: "avl", label: t("network.ct.c.avl"), render: avl },
    { key: "x", label: t("network.ct.c.exits"), render: exitCell },
    { key: "repo", label: t("network.ct.c.repo"), render: repoCell },
    { key: "b", label: t("network.ct.c.boxes"), align: "right", render: (c) => <span className="num">{obs.totals.byContract[c.id]?.boxes ?? chainStats(c)?.boxes ?? 0}</span> },
    { key: "u", label: t("network.ct.c.unspent"), align: "right", render: (c) => <span className="num">{obs.totals.byContract[c.id]?.unspent ?? chainStats(c)?.unspent ?? 0}</span> },
    { key: "e", label: t("network.ct.c.erg"), align: "right", render: (c) => <span className="num">{ergs(obs.totals.byContract[c.id]?.unspentNano ?? 0n)}</span> },
    { key: "hash", label: t("network.ct.c.verify"), render: verifyCell },
  ];
  const otherCols: Column<ContractView>[] = [
    { key: "v", label: t("network.ct.c.version"), lead: true, render: (c) => <Ver c={c} id={c.id} /> },
    { key: "r", label: t("network.ct.c.role"), render: (c) => t(`chain.contract.${c.role}`) },
    { key: "k", label: t("network.ct.c.kind"), render: (c) => t(`network.kind.${c.kind}`) },
    { key: "em", label: t("network.ct.c.em"), render: emCell },
    { key: "avl", label: t("network.ct.c.avl"), render: avl },
    { key: "x", label: t("network.ct.c.exits"), render: exitCell },
    { key: "repo", label: t("network.ct.c.repo"), render: repoCell },
    { key: "hash", label: t("network.ct.c.verify"), render: verifyCell },
  ];

  return (
    <>
      <header className="nw-head">
        <div>
          <div className="eyebrow label">{t("network.ct.eyebrow")}</div>
          <h1 className="t-h1">{rich(t("network.ct.h1"))}</h1>
          <p className="t-lede">{t("network.ct.lede", { legacy: legacy.length, cur: curBoxes ? t("network.ct.ledeSome", { n: curBoxes }) : t("network.ct.ledeNone") })}</p>
        </div>
        <AsOf h={det.checkedHeight ?? obs.height} live={det.checkedHeight != null || obs.heightLive} />
      </header>

      <Block label={t("network.ct.current")} aside={<Key size="sm" variant="quiet" icon="check" onClick={() => void verifyAll(obs.contracts)}>{t("network.ct.verifyAll")}</Key>}>
        <div className="nw-cur">
          {current.map((c) => {
            const n = obs.totals.byContract[c.id]?.boxes ?? 0;
            return (
              <article key={c.id} className="nw-curc" id={c.id}>
                <header>
                  <Ver c={c} />
                  <span className="k">{t(`network.kind.${c.kind}`)}</span>
                  <Tag tone="up">{t("network.contract.currentShort")}</Tag>
                </header>
                {n ? (
                  <div className="nw-curc-n">
                    <span className="t-measure-l num">{n}</span>
                    <span className="t-small">{t("network.ct.boxesN", { n, u: obs.totals.byContract[c.id]?.unspent ?? 0 })}</span>
                  </div>
                ) : (
                  // a giant "0" said less than one calm line; the page header already says which block was checked
                  <p className="nw-curc-none"><Lamp state={det.checkedHeight != null ? "live" : "signed"} size={7} />{t("network.ct.noBoxesLong")}</p>
                )}
                <dl className="nw-curc-f">
                  <div><dt>{t("network.ct.p2s")}</dt><dd className="hex" title={c.p2sFull}>{c.p2s.head}…{c.p2s.tail} <span className="dim">· {fmtH(c.p2s.length)}</span></dd></div>
                  <div><dt>{t("network.ct.c.header")}</dt><dd><code>0x{c.header}</code> · {t("network.ct.c.consts").toLowerCase()} {c.constantsCount} · {t("network.ct.bytes", { n: fmtH(c.treeBytes) })}</dd></div>
                  <div><dt>{t("network.ct.c.em")}</dt><dd>{emCell(c)}</dd></div>
                  <div><dt>{t("network.ct.c.avl")}</dt><dd>{avl(c)}</dd></div>
                  <div><dt>{t("network.ct.actions")}</dt><dd>{c.actions.map((a) => t(`network.ct.act.${a}`)).join(" · ")}</dd></div>
                  <div><dt>{t("network.ct.c.repo")}</dt><dd>{repoDate(c.repo.first) ? t("network.ct.since", { date: date(repoDate(c.repo.first), lang) }) : "—"}</dd></div>
                  <div><dt>{t("network.ct.hash")}</dt><dd>{verifyCell(c)}</dd></div>
                </dl>
              </article>
            );
          })}
          <div className="nw-rules">
            <span className="label">{t("network.ct.rules")}</span>
            <ul>
              <li>{pick(copy.emergencyRule, lang)}</li>
              <li>{pick(copy.refundRule, lang)} {pick(copy.refundCreditors, lang)}</li>
              <li>{pick(copy.topUpRule, lang)} {t("network.ct.keepErg")}</li>
              <li>{pick(copy.topUpRuleToken, lang)} {t("network.ct.keepToken")}</li>
              <li><b>{pick(copy.feeProtocol, lang)}</b> · {pick(copy.feeMiner, lang)}</li>
            </ul>
            <p className="nw-facts-mono"><code>{pick(copy.facts.emergency, lang)}</code><code>{pick(copy.facts.refund, lang)}</code></p>
          </div>
        </div>
      </Block>

      <Block label={t("network.ct.legacy")} aside={<span className="label num">{legacy.length}</span>}>
        <div className="nw-tablecard nw-ct-table"><Table<ContractView> columns={cols} rows={legacy} rowKey={(c) => c.id} stack={phone} caption={t("network.ct.legacy")} /></div>
        {legacy.some((c) => c.params.emergency?.unit && c.params.emergency.unit !== "blocks") && <p className="t-small nw-note"><sup>*</sup> {t("chain.contract.msWindow")}</p>}
      </Block>

      <Block label={t("network.ct.other")} aside={<span className="label num">{other.length}</span>}>
        <div className="nw-tablecard nw-ct-table"><Table<ContractView> columns={otherCols} rows={other} rowKey={(c) => c.id} stack={phone} caption={t("network.ct.other")} /></div>
      </Block>

      <Callout tone="info" title={t("network.ct.verify")}><p className="t-small">{t("network.ct.verifyHow")}</p></Callout>

      <Sheet open={!!tool} onClose={() => setTool(null)} title={t("network.ct.toolTitle")} sub={tool ? `${tool.p2s.head.slice(0, 6)}… · ${tool.short}` : undefined} width={720}>
        {tool && (
          <TemplateHashTool initial={tool.ergoTree} loading={t("network.ct.verifying")} failed={<p className="t-small">{t("network.ct.toolFailed")}</p>} />
        )}
      </Sheet>
    </>
  );
}

function Verify({ c, state, onVerify, onTool }: { c: ContractView; state: VState | undefined; onVerify: () => void; onTool: () => void }) {
  const t = useT();
  return (
    <span className="nw-verify">
      <span className="hex" title={c.templateHash}>{sid(c.templateHash, 8, 4)}</span>
      {state === "ok" ? <span className="ok" role="status"><Icon name="check" size={14} />{t("network.ct.ok")}</span>
        : state === "bad" ? <span className="bad" role="status"><Icon name="warn" size={14} />{t("network.ct.bad")}</span>
          : <button type="button" className="key sm" onClick={onVerify} disabled={state === "busy"} aria-label={`${t("network.ct.verify")} ${c.short}`}>{state === "busy" ? t("network.ct.verifying") : t("network.ct.verify")}</button>}
      <button type="button" className="key sm quiet nw-toolk" onClick={onTool} aria-label={`${t("network.ct.tool")} ${c.short}`} title={t("network.ct.tool")}><Icon name="search" size={15} /></button>
    </span>
  );
}

/** Version name: the short id the rest of the app uses, then the rest of the P2S head, so "W52Uvz…" is not read twice. */
function Ver({ c, id }: { c: ContractView; id?: string }) {
  const head = c.p2s.head;
  if (c.short && head.startsWith(c.short)) {
    return <span className="nw-ver split" id={id}><b className="hex">{c.short}</b><span className="hex dim">{head.slice(c.short.length, Math.max(8, c.short.length + 3))}…</span></span>;
  }
  return <span className="nw-ver" id={id}><b className="hex">{head.slice(0, 6)}…</b><span className="dim">{c.short}</span></span>;
}
