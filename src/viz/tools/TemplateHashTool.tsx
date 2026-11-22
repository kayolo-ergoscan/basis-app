// TemplateHashTool: ErgoTree hex (or a P2S / P2PK address) → header, constants, template → SHA-256 of the template via
// WebCrypto → compared with every known Basis reserve template (KNOWLEDGE §d.5).

import { useEffect, useMemo, useState } from "react";
import { fmtInt, shortHex, toHexStr } from "../core/format";
import { pick, useVizLang, useVizT } from "../core/lang";
import { Btn, CheckLamp, CopyBtn, HexBlock, Tag } from "../core/primitives";
import { analyzeTemplate, knownTemplates, KNOWN_TEMPLATES, SAMPLE_TREES, sha256Hex, type TemplateAnalysis } from "./template";
import "../core/core.css";
import "./tools.css";

export interface TemplateHashToolProps {
  initial?: string;
  className?: string;
}

type Analysis = { ok: true; a: TemplateAnalysis } | { ok: false; code: "empty" | "p2sh" | "parse"; error?: string } | null;

function analyse(input: string): Analysis {
  if (!input.trim()) return null;
  try {
    return { ok: true, a: analyzeTemplate(input) };
  } catch (e) {
    const m = (e as Error).message;
    return m === "p2sh" ? { ok: false, code: "p2sh" } : m === "empty" ? { ok: false, code: "empty" } : { ok: false, code: "parse", error: m };
  }
}

export function TemplateHashTool(p: TemplateHashToolProps) {
  const t = useVizT();
  const lang = useVizLang();
  const [input, setInput] = useState(p.initial ?? SAMPLE_TREES[0].hex);
  const res = useMemo(() => analyse(input), [input]);
  const [hash, setHash] = useState<{ for: string; hex: string; via: "webcrypto" | "noble" } | null>(null);
  const tplHex = res && res.ok ? toHexStr(res.a.template) : "";
  useEffect(() => {
    if (!res || !res.ok) return;
    let live = true;
    void sha256Hex(res.a.template).then((h) => {
      if (live) setHash({ for: tplHex, ...h });
    });
    return () => {
      live = false;
    };
  }, [tplHex]); // eslint-disable-line react-hooks/exhaustive-deps
  const h = hash && res && res.ok && hash.for === tplHex ? hash : null;
  const matches = h ? knownTemplates(h.hex) : [];
  const a = res && res.ok ? res.a : null;
  const total = a ? a.bytes.length : 0;
  const parts = a
    ? (["header", "size", "count", "constant", "template"] as const)
        .map((part) => ({ part, length: a.segments.filter((s) => s.part === part).reduce((n, s) => n + s.length, 0) }))
        .filter((x) => x.length > 0)
    : [];
  const sampleName = (id: string) => KNOWN_TEMPLATES.find((k) => k.id === id)?.short ?? id;
  return (
    <section className={`vz vz-panel vz-tl vz-th${p.className ? " " + p.className : ""}`} aria-label={t("viz.th.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.th.eyebrow")}</div>
          <h3 className="vz-title">{t("viz.th.title")}</h3>
          <p className="vz-sub">{t("viz.th.sub")}</p>
        </div>
      </header>
      <div className="vz-body">
        <div className="vz-field">
          <label htmlFor="vz-th-i">{t("viz.th.input")}</label>
          <textarea id="vz-th-i" className={`vz-input vz-ta${res && !res.ok ? " err" : ""}`} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} rows={4} />
          <div className="vz-tl-row">
            <span className="vz-small">{t("viz.th.samples")}:</span>
            {SAMPLE_TREES.map((s) => (
              <Btn key={s.id} kind="quiet" pressed={input === s.hex} onClick={() => setInput(s.hex)}>
                {sampleName(s.id)}
              </Btn>
            ))}
          </div>
          {res && !res.ok ? <span className="vz-help err">{res.code === "p2sh" ? t("viz.th.errP2sh") : res.code === "empty" ? t("viz.th.errEmpty") : t("viz.th.errParse", { error: res.error ?? "?" })}</span> : null}
          {a?.address ? (
            <span className={`vz-help${a.address.checksumOk ? "" : " err"}`}>
              {t("viz.th.address", { type: a.address.type, network: a.address.network })}
              {a.address.checksumOk ? "" : ` · ${t("viz.th.checksumBad")}`}
            </span>
          ) : null}
        </div>
        {a ? (
          <>
            <div className="vz-field">
              <div className="vz-field-l">{t("viz.th.parts", { bytes: fmtInt(total), n: a.tree.constants.length, t: fmtInt(a.template.length) })}</div>
              <div className="vz-th-strip" role="img" aria-label={parts.map((x) => `${t(`viz.th.part.${x.part}`)} ${x.length}`).join(", ")}>
                {parts.map((x) => (
                  <span key={x.part} className={`p p-${x.part}`} style={{ flexGrow: x.length }} title={`${t(`viz.th.part.${x.part}`)} · ${x.length}`} />
                ))}
              </div>
              <div className="vz-th-legend">
                {parts.map((x) => (
                  <span key={x.part} className={`l p-${x.part}`}>
                    <i aria-hidden="true" /> {t(`viz.th.part.${x.part}`)} <b>{fmtInt(x.length)}</b>
                  </span>
                ))}
              </div>
              <span className="vz-small">
                {t("viz.th.header", { h: a.tree.headerHex, v: a.tree.version, size: a.tree.hasSize ? t("viz.th.headerSize") : "", seg: a.tree.segregated ? t("viz.th.headerSeg") : "" })}
              </span>
            </div>
            {a.tree.constants.length ? (
              <details className="vz-th-consts">
                <summary>{t("viz.th.constants", { n: a.tree.constants.length })}</summary>
                <p className="vz-small">{t("viz.th.constHelp")}</p>
                <ol>
                  {a.tree.constants.map((c, i) => (
                    <li key={i}>
                      <span className="i">{i}</span>
                      <span className="ty">{c.type}</span>
                      <code className="v">{c.display.length > 80 ? shortHex(c.display, 24, 12) : c.display}</code>
                    </li>
                  ))}
                </ol>
              </details>
            ) : null}
            <div className="vz-field">
              <div className="vz-field-l">{t("viz.th.part.template")}</div>
              <HexBlock hex={tplHex} max={96} />
            </div>
            <div className="vz-th-hash">
              <div className="vz-field-l">{t("viz.th.hash")}</div>
              {h ? (
                <>
                  <div className="vz-tl-row">
                    <code className="hx">{h.hex}</code>
                    <CopyBtn value={h.hex} />
                  </div>
                  <span className="vz-small">{t(`viz.th.via.${h.via}`)}</span>
                </>
              ) : (
                <span className="vz-small">{t("viz.th.computing")}</span>
              )}
            </div>
            {h ? (
              matches.length ? (
                <div className={`vz-verdict ${matches.some((m) => m.role === "current") ? "ok" : "neutral"}`} role="status">
                  <CheckLamp state={matches.some((m) => m.role === "current") ? "pass" : "skip"} size={14} />
                  <div>
                    <div className="vz-verdict-t">{t("viz.th.match")}</div>
                    <ul className="vz-th-matches">
                      {matches.map((m) => (
                        <li key={m.id}>
                          <b>{m.short}</b> {pick(lang, m.name)} <Tag tone={m.role === "current" ? "up" : m.role === "legacy" ? "watch" : "plain"}>{t(`viz.th.role.${m.role}`)}</Tag>
                        </li>
                      ))}
                    </ul>
                    {matches.every((m) => m.role !== "current") ? <div className="vz-verdict-d">{t("viz.th.legacyWarn")}</div> : null}
                  </div>
                </div>
              ) : (
                <div className="vz-verdict neutral" role="status">
                  <CheckLamp state="skip" size={14} />
                  <div>
                    <div className="vz-verdict-t">{t("viz.th.noMatch")}</div>
                  </div>
                </div>
              )
            ) : null}
            <p className="vz-small">
              {t("viz.th.notBlake")} {t("viz.tool.runsHere")}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}

export default TemplateHashTool;
