// SignLab: "sign it yourself". Demo keys (public by construction), an amount and a timestamp build the 80-byte
// message; signWithTrace shows every nonce candidate the signer rejected (e[0] ≥ 0x80, z ≥ 2^255) before the one
// it publishes; the result opens in the SignatureXray, tamperable.

import { useMemo, useState } from "react";
import { bytesToHex, debtKey, demoKeyPair, noteMessage, parseUnits, signWithTrace, type SignTrace } from "@/protocol";
import { fmtInt, shortHex } from "../core/format";
import { useVizLang, useVizT } from "../core/lang";
import { Btn, Tag } from "../core/primitives";
import { SignatureXray } from "./SignatureXray";
import "../core/core.css";
import "./signature.css";

export { LAB_DEFAULT_TS, LAB_NAMES, LAB_SALT, LAB_TRACKER_NFT } from "../core/lab";
import { LAB_DEFAULT_TS, LAB_NAMES, LAB_SALT, LAB_TRACKER_NFT, labDisplayName } from "../core/lab";

export interface SignLabProps {
  issuer?: string;
  receiver?: string;
  /** ERG, as typed ("1.5"). */
  amount?: string;
  timestampMs?: bigint;
  className?: string;
}

function parseAmount(s: string): bigint | null {
  const v = s.replace(/[\s ⁠ ]/g, "").replace(",", ".");
  try {
    const n = parseUnits(v, 9);
    return n >= 0n && n < 1n << 63n ? n : null;
  } catch {
    return null;
  }
}

export function SignLab(p: SignLabProps) {
  const t = useVizT();
  const lang = useVizLang();
  const [issuer, setIssuer] = useState(p.issuer ?? "Alice");
  const [receiver, setReceiver] = useState(p.receiver ?? "Bob");
  const [amount, setAmount] = useState(p.amount ?? "1.5");
  const [ts, setTs] = useState((p.timestampMs ?? LAB_DEFAULT_TS).toString());
  const kp = useMemo(() => demoKeyPair(issuer, LAB_SALT), [issuer]);
  const rp = useMemo(() => demoKeyPair(receiver, LAB_SALT), [receiver]);
  const amt = parseAmount(amount);
  const tsv = /^\d{1,19}$/.test(ts.trim()) && BigInt(ts.trim()) < 1n << 63n ? BigInt(ts.trim()) : null;
  const msg = useMemo(() => (amt !== null && tsv !== null ? noteMessage(debtKey(kp.pub, rp.pub), amt, tsv, LAB_TRACKER_NFT) : null), [amt, tsv, kp, rp]);
  const msgHex = msg ? bytesToHex(msg) : "";
  const trace: SignTrace | null = useMemo(() => (msg ? signWithTrace(msg, kp) : null), [msgHex, kp]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div className="vz-field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="vz-input" value={value} onChange={(e) => set(e.target.value)}>
        {LAB_NAMES.map((n) => (
          <option key={n} value={n}>
            {labDisplayName(n, lang)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <div className={`vz vz-sl${p.className ? " " + p.className : ""}`}>
      <section className="vz-panel" aria-label={t("viz.sl.eyebrow")}>
        <header className="vz-head">
          <div className="vz-head-t">
            <div className="vz-eyebrow">{t("viz.sl.eyebrow")}</div>
            <h3 className="vz-title">{t("viz.sl.title")}</h3>
            <p className="vz-sub">{t("viz.sl.sub")}</p>
          </div>
          <div className="vz-head-a">
            <Tag tone="agent" glyph="◇">{t("viz.sandbox")}</Tag>
          </div>
        </header>
        <div className="vz-body">
          <p className="vz-small">{t("viz.sl.demoKeys")}</p>
          <div className="vz-sl-form">
            {select("vz-sl-issuer", t("viz.sl.issuer"), issuer, setIssuer)}
            {select("vz-sl-receiver", t("viz.sl.receiver"), receiver, setReceiver)}
            <div className="vz-field">
              <label htmlFor="vz-sl-amount">{t("viz.sl.amount")}</label>
              <input id="vz-sl-amount" className={`vz-input${amt === null ? " err" : ""}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              {amt === null ? <span className="vz-help err">{t("viz.sl.badAmount")}</span> : null}
            </div>
            <div className="vz-field">
              <label htmlFor="vz-sl-ts">{t("viz.sl.timestamp")}</label>
              <div className="vz-sl-ts">
                <input id="vz-sl-ts" className={`vz-input${tsv === null ? " err" : ""}`} inputMode="numeric" value={ts} onChange={(e) => setTs(e.target.value)} />
                <Btn onClick={() => setTs(String(Date.now()))}>{t("viz.sl.now")}</Btn>
              </div>
              {tsv === null ? <span className="vz-help err">{t("viz.sl.badTs")}</span> : null}
            </div>
          </div>
          {issuer === receiver ? <p className="vz-small">{t("viz.sl.same")}</p> : null}
          <dl className="vz-kv">
            <dt>{t("viz.sl.tracker")}</dt>
            <dd>
              <code>{shortHex(LAB_TRACKER_NFT, 8, 8)}</code>
            </dd>
          </dl>
          {trace ? (
            <div className="vz-field">
              <div className="vz-field-l">{t("viz.sl.attempts")}</div>
              <span className="vz-help">{t("viz.sl.attemptsSub", { n: trace.attempts.length, m: trace.multiplications })}</span>
              <table className="vz-sl-attempts">
                <thead>
                  <tr>
                    <th>{t("viz.sl.col.n")}</th>
                    <th>{t("viz.sl.col.cand")}</th>
                    <th className="col-a">{t("viz.sl.col.a")}</th>
                    <th>{t("viz.sl.col.e0")}</th>
                    <th>{t("viz.sl.col.result")}</th>
                  </tr>
                </thead>
                <tbody>
                  {trace.attempts.map((a, i) => (
                    <tr key={i} className={a.accepted ? "acc" : undefined}>
                      <td>{fmtInt(i + 1)}</td>
                      <td>
                        k{a.step ? `+${a.step}` : ""} {a.candidate}
                      </td>
                      <td className="col-a">{shortHex(a.a, 6, 4)}</td>
                      <td className={`e0${a.eTopBit ? " top" : ""}`}>0x{a.e.slice(0, 2)}</td>
                      <td className="res">{a.accepted ? t("viz.sl.accepted") : t(`viz.sl.rej.${a.rejectedBy}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <span className="vz-help">{t("viz.sl.zHidden")}</span>
            </div>
          ) : null}
        </div>
      </section>
      {trace && msg ? <SignatureXray pub={kp.pub} message={msg} signature={trace.signature} signer="issuer" className="vz-sl-xray" /> : null}
    </div>
  );
}

export default SignLab;
