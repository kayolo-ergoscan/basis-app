// SelfTest: the spec's Schnorr vectors TV001–TV004 verified live with the engine's verifier; each row opens in
// the SignatureXray.

import { useMemo, useState } from "react";
import { verify } from "@/protocol";
import { pick, useVizLang, useVizT } from "../core/lang";
import { Btn, CheckLamp, Tag } from "../core/primitives";
import { SignatureXray } from "./SignatureXray";
import { SCHNORR_VECTORS, type SchnorrVector } from "./vectors";
import "../core/core.css";
import "./signature.css";

export function runSelfTest(vectors: readonly SchnorrVector[] = SCHNORR_VECTORS) {
  return vectors.map((v) => {
    const r = verify(v.issuerPub, v.message, v.signature);
    const pass = r.ok === v.expected && (v.expectedFailure === undefined || r.reason === v.expectedFailure);
    return { v, ok: r.ok, reason: r.reason, pass };
  });
}

export function SelfTest({ className, initialOpen = null }: { className?: string; initialOpen?: SchnorrVector["id"] | null }) {
  const t = useVizT();
  const lang = useVizLang();
  const results = useMemo(() => runSelfTest(), []);
  const [open, setOpen] = useState<string | null>(initialOpen);
  const passed = results.filter((r) => r.pass).length;
  const openV = results.find((r) => r.v.id === open)?.v;
  return (
    <div className={`vz vz-st${className ? " " + className : ""}`}>
      <section className="vz-panel" aria-label={t("viz.st.eyebrow")}>
        <header className="vz-head">
          <div className="vz-head-t">
            <div className="vz-eyebrow">{t("viz.st.eyebrow")}</div>
            <h3 className="vz-title">{t("viz.st.title")}</h3>
            <p className="vz-sub">{t("viz.st.sub")}</p>
          </div>
          <div className="vz-head-a">
            <Tag tone={passed === results.length ? "up" : "warn"} glyph={passed === results.length ? "●" : "✕"}>
              {t("viz.st.summary", { n: passed, total: results.length })}
            </Tag>
          </div>
        </header>
        <div className="vz-body">
          <table className="vz-st-table">
            <thead>
              <tr>
                <th>ID</th>
                <th className="col-t">{t("viz.st.case")}</th>
                <th>{t("viz.st.expected")}</th>
                <th>{t("viz.st.got")}</th>
                <th aria-label={t("viz.st.pass")} />
                <th />
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.v.id} className={open === r.v.id ? "on" : undefined}>
                  <td className="id">{r.v.id}</td>
                  <td className="col-t">{pick(lang, r.v.title)}</td>
                  <td>{r.v.expected ? t("viz.st.valid") : t("viz.st.invalid")}</td>
                  <td>
                    {r.ok ? t("viz.st.valid") : t("viz.st.invalid")} {r.reason ? <code>{r.reason}</code> : null}
                  </td>
                  <td>
                    <CheckLamp state={r.pass ? "pass" : "fail"} size={12} title={r.pass ? t("viz.st.pass") : t("viz.st.fail")} />
                  </td>
                  <td>
                    <Btn kind="quiet" pressed={open === r.v.id} onClick={() => setOpen((o) => (o === r.v.id ? null : r.v.id))}>
                      {t("viz.st.open")}
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {openV ? <SignatureXray key={openV.id} pub={openV.issuerPub} message={openV.message} signature={openV.signature} signer="issuer" title={`${openV.id} · ${pick(lang, openV.title)}`} /> : null}
    </div>
  );
}

export default SelfTest;
