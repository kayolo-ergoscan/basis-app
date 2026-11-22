// /learn/tools — the four in-page tools from @/viz (debt key, 80-byte message, note verification, template hash) and
// "decode any box": a box id is fetched once through @/chain (useBox, mounted only after the reader asks) and
// decoded here. Links to on-chain objects go to ergoscan.me.
import { useEffect, useRef, useState } from "react";
import { rich, useHeight, useT } from "@/app";
import { CopyButton, ErrorState, Icon, Key, Tag, TextInput, int, short, units, withUnit } from "@/ui";
import { DebtKeyTool, MessageBuilder, NoteVerifyTool, TemplateHashTool } from "@/viz";
import { chain, explorer, useBox, type BoxDetail } from "@/chain";
import { copy, pick } from "@/content";
import { BookHead, Pager, Sec, useBookSections } from "../layout";
import { useNear } from "../lab";

const HEX64 = /^[0-9a-f]{64}$/;

export default function ToolsPage() {
  const t = useT();
  const L = t.lang;
  useBookSections([
    { id: "key", label: pick({ en: "Debt key", ru: "Ключ долга" }, L) },
    { id: "message", label: pick({ en: "The 80 bytes", ru: "80 байт" }, L) },
    { id: "verify", label: pick({ en: "Verify a note", ru: "Проверка расписки" }, L) },
    { id: "template", label: pick({ en: "Which contract", ru: "Какой контракт" }, L) },
    { id: "box", label: pick({ en: "Decode a box", ru: "Разбор бокса" }, L) },
  ]);
  return (
    <article>
      <BookHead id="tools" lede={t("learn.tl.lede")} />
      <Sec id="key" first title={rich(t("learn.tl.s.key"))} lede={t("learn.tl.s.key.lede")}>
        <div className="lrn-fig"><DebtKeyTool /></div>
      </Sec>
      <Sec id="message" title={rich(t("learn.tl.s.msg"))} lede={t("learn.tl.s.msg.lede")}>
        <div className="lrn-fig"><MessageBuilder /></div>
      </Sec>
      <Sec id="verify" title={rich(t("learn.tl.s.verify"))} lede={t("learn.tl.s.verify.lede")}>
        <div className="lrn-fig"><NoteVerifyTool /></div>
      </Sec>
      <Sec id="template" title={rich(t("learn.tl.s.template"))} lede={t("learn.tl.s.template.lede")}>
        <div className="lrn-fig"><TemplateHashTool /></div>
      </Sec>
      <Sec id="box" title={rich(t("learn.tl.s.box"))} lede={t("learn.tl.s.box.lede")}>
        <BoxDecoder />
      </Sec>
      <Pager id="tools" />
    </article>
  );
}

/* ---------------------------------------------------------------- decode any box */

function BoxDecoder() {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const near = useNear(ref, "600px");
  const [text, setText] = useState("");
  const [bad, setBad] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [samples, setSamples] = useState<{ reserve: string | null; tracker: string | null }>({ reserve: null, tracker: null });

  useEffect(() => {
    if (!near) return;
    let live = true;
    void chain.ensureSeed().then(() => {
      const obs = chain.getObservatory();
      if (!live || !obs) return;
      const reserve = obs.unspent[0]?.id ?? obs.reserves[0]?.id ?? null;
      const tracker = obs.trackers.find((x) => x.currentBox)?.currentBox ?? null;
      setSamples({ reserve, tracker });
    }).catch(() => undefined);
    return () => { live = false; };
  }, [near]);

  const go = (v = text) => {
    const s = v.trim().toLowerCase();
    if (!HEX64.test(s)) { setBad(true); return; }
    setBad(false);
    setText(s);
    setId(s);
  };

  return (
    <div className="tl-decode" ref={ref}>
      <form className="tl-form" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <TextInput
          value={text}
          onChange={(v) => { setText(v); if (bad) setBad(false); }}
          mono
          icon="search"
          invalid={bad}
          placeholder={t("learn.tl.box.ph")}
          aria-label={t("learn.tl.box.id")}
          autoComplete="off"
        />
        <Key variant="primary" icon="scan" onClick={() => go()}>{t("learn.tl.box.go")}</Key>
      </form>
      {bad && <p className="t-small alarm-t" role="alert">{t("learn.tl.box.bad")}</p>}
      {(samples.reserve || samples.tracker) && (
        <div className="tl-samples">
          <span>{t("learn.tl.box.samples")}</span>
          {samples.reserve && <Key size="sm" variant="quiet" onClick={() => go(samples.reserve!)}>{t("learn.tl.box.sampleReserve")} · <span className="mono">{short(samples.reserve, 4, 4)}</span></Key>}
          {samples.tracker && <Key size="sm" variant="quiet" onClick={() => go(samples.tracker!)}>{t("learn.tl.box.sampleTracker")} · <span className="mono">{short(samples.tracker, 4, 4)}</span></Key>}
        </div>
      )}
      {id && <BoxResult key={id} id={id} />}
    </div>
  );
}

function BoxResult({ id }: { id: string }) {
  const t = useT();
  const r = useBox(id);
  if (r.state === "loading" || r.state === "idle") return <div className="tl-box"><div className="tl-box-h"><span className="t-small">{t("learn.tl.box.loading")}</span></div></div>;
  if (r.state === "missing") return <ErrorState title={t("learn.tl.box.missing")} detail={id} />;
  if (r.state === "error" || !r.box) return <ErrorState title={t("learn.tl.box.error", { e: String(r.error ?? "") })} onRetry={r.refresh} retryLabel={t("learn.tl.box.retry")} />;
  return <BoxView box={r.box} />;
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return <div className="tl-row"><span className="k">{k}</span><div className="v">{children}</div></div>;
}

function Ext({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="lrn-link" href={href} target="_blank" rel="noreferrer">{children}<Icon name="ext" size={12} style={{ marginLeft: 4, verticalAlign: -1 }} /></a>;
}

function BoxView({ box }: { box: BoxDetail }) {
  const t = useT();
  const { height } = useHeight();
  const b = box.basis;
  const role = t(`learn.tl.box.role.${box.role}`);
  return (
    <div className="tl-box">
      <div className="tl-box-h">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", minWidth: 0 }}>
          <Tag tone={box.role === "other" ? "plain" : "metal"}>{role}</Tag>
          <span className="mono t-small" style={{ overflowWrap: "anywhere" }}>{short(box.boxId, 10, 8)}</span>
          <CopyButton value={box.boxId} small />
        </div>
        <Ext href={explorer.box(box.boxId)}>{t("learn.tl.box.explorer")}</Ext>
      </div>
      <Row k={t("learn.tl.box.value")}>{withUnit(units(box.value, 9, 9).replace(/(\.\d\d\d*?)0+$/, "$1"), "ERG")}</Row>
      <Row k={t("learn.tl.box.created")}>
        {t("learn.tl.box.blockN", { h: int(box.creationHeight) })} · <Ext href={explorer.tx(box.tx)}><span className="mono">{short(box.tx, 8, 6)}</span></Ext>
      </Row>
      <Row k={t("learn.tl.box.status")}>
        {box.spentTx ? <>{t("learn.tl.box.spentIn", { tx: "" })}<Ext href={explorer.tx(box.spentTx)}><span className="mono">{short(box.spentTx, 8, 6)}</span></Ext></> : t("learn.tl.box.unspent")}
        {height != null && <span className="sub">{pick(copy.asOfBlock(height), t.lang)}</span>}
      </Row>
      <Row k={t("learn.tl.box.contract")}>
        {box.contract ? (
          <>
            <b>{box.contract.name}</b> · <span className="mono">{box.contract.short}</span> · {box.contract.current ? t("learn.tl.box.current") : t("learn.tl.box.legacy")}
          </>
        ) : box.p2pkKey ? "P2PK" : t("learn.tl.box.noMatch")}
        {box.templateHash && <span className="sub">{t("learn.tl.box.template")} <span className="mono">{short(box.templateHash, 10, 8)}</span></span>}
      </Row>
      <Row k={t("learn.tl.box.address")}>
        <Ext href={explorer.address(box.address)}><span className="mono">{short(box.address, 10, 8)}</span></Ext>
      </Row>
      {box.role !== "other" && (
        <Row k={t("learn.tl.box.basis")}>
          <div className="tl-regs">
            <div className="tl-reg"><span className="r">R4</span><span className="t">{t("learn.tl.box.r4")}</span><span className="d mono">{b.key ? short(b.key, 10, 8) : "—"}</span></div>
            <div className="tl-reg"><span className="r">R5</span><span className="t">{t("learn.tl.box.r5")}</span><span className="d mono">{b.tree ? short(b.tree.rootHash + "", 10, 8) : "—"}</span></div>
            <div className="tl-reg"><span className="r">R6</span><span className="t">{t("learn.tl.box.r6")}</span><span className="d mono">{b.nft ? <Ext href={explorer.token(b.nft)}>{short(b.nft, 10, 8)}</Ext> : "—"}</span></div>
            {box.role === "reserve" && <div className="tl-reg"><span className="r">R7</span><span className="t">{t("learn.tl.box.r7")}</span><span className="d mono">{b.refundHeight > 0n ? b.refundHeight.toString() : t("learn.tl.box.r7none")}</span></div>}
          </div>
        </Row>
      )}
      <Row k={t("learn.tl.box.registers")}>
        {box.registers.length === 0 ? "—" : (
          <div className="tl-regs">
            {box.registers.map((g) => (
              <div className="tl-reg" key={g.name}>
                <span className="r">{g.name}</span>
                <span className="t mono">{g.decoded.type}</span>
                <span className="d mono">{g.decoded.error ? g.decoded.error : g.decoded.display.length > 140 ? `${g.decoded.display.slice(0, 140)}…` : g.decoded.display}</span>
              </div>
            ))}
          </div>
        )}
      </Row>
      <Row k={t("learn.tl.box.tokens")}>
        {box.tokens.length === 0 ? t("learn.tl.box.noTokens") : (
          <div className="tl-regs">
            {box.tokens.map((x) => (
              <div className="tl-reg tok" key={x.id}>
                <span className="r">{x.name ?? x.label}</span>
                <span className="d mono">{units(x.amount, x.decimals, x.decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "")} · <Ext href={explorer.token(x.id)}>{short(x.id, 8, 6)}</Ext></span>
              </div>
            ))}
          </div>
        )}
      </Row>
      {b.issues.length > 0 && box.role !== "other" && (
        <Row k={t("learn.tl.box.issues")}><span className="mono t-small">{b.issues.join(" · ")}</span></Row>
      )}
    </div>
  );
}
