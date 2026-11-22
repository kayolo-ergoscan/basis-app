// DebtKeyTool: issuer key ‖ receiver key [‖ token id] → blake2b256 → the 32-byte debt key that names a note in the
// tracker's tree and in the signed message; plus the reserve tree key, which never includes the token id.

import { useMemo, useState } from "react";
import { blake2b256, isValidPublicKey } from "@/protocol";
import { parseHexInput, toHexStr } from "../core/format";
import { useVizLang, useVizT, type TFn } from "../core/lang";
import { LAB_NAMES, labDisplayName, labKey, labNameOf } from "../core/lab";
import { Btn, ByteGrid, ByteLegend, CopyBtn, HexBlock, type ByteSeg } from "../core/primitives";
import "../core/core.css";
import "./tools.css";

export interface DebtKeyToolProps {
  issuer?: string;
  receiver?: string;
  tokenId?: string;
  className?: string;
}

export interface HexCheck {
  bytes: Uint8Array | null;
  error: string | null;
}

/** A hex field of a fixed length; `point` also requires a valid compressed secp256k1 key. */
export function checkHexField(s: string, want: number, t: TFn, point = false): HexCheck {
  if (!s.trim()) return { bytes: null, error: null };
  const b = parseHexInput(s);
  if (!b) return { bytes: null, error: t("viz.tool.invalidHex") };
  if (b.length !== want) return { bytes: null, error: t("viz.tool.wrongLength", { n: b.length, want }) };
  if (point && !isValidPublicKey(b)) return { bytes: null, error: t("viz.tool.notPoint") };
  return { bytes: b, error: null };
}

/** Preimage and key, computed here (the test checks them against the engine's debtKey / reserveKey). */
export function debtKeyParts(owner: Uint8Array, receiver: Uint8Array, tokenId: Uint8Array | null) {
  const preimage = new Uint8Array(66 + (tokenId ? 32 : 0));
  preimage.set(owner, 0);
  preimage.set(receiver, 33);
  if (tokenId) preimage.set(tokenId, 66);
  return { preimage, key: blake2b256(preimage), reserveKey: blake2b256(owner, receiver) };
}

export function KeyPicker({ value, onPick, label }: { value: string; onPick: (hex: string) => void; label: string }) {
  const current = labNameOf(value.trim());
  const lang = useVizLang();
  return (
    <div className="vz-tl-picks" role="group" aria-label={label}>
      {LAB_NAMES.map((n) => (
        <button key={n} type="button" className={`vz-chip${current === n ? " on" : ""}`} aria-pressed={current === n} onClick={() => onPick(labKey(n).pubHex)}>
          {labDisplayName(n, lang)}
        </button>
      ))}
    </div>
  );
}

export function DebtKeyTool(p: DebtKeyToolProps) {
  const t = useVizT();
  const [iss, setIss] = useState(p.issuer ?? labKey("Alice").pubHex);
  const [rcv, setRcv] = useState(p.receiver ?? labKey("Bob").pubHex);
  const [tok, setTok] = useState(p.tokenId ?? "");
  const vi = checkHexField(iss, 33, t, true);
  const vr = checkHexField(rcv, 33, t, true);
  const vt = checkHexField(tok, 32, t);
  const parts = useMemo(() => (vi.bytes && vr.bytes && !vt.error ? debtKeyParts(vi.bytes, vr.bytes, vt.bytes) : null), [iss, rcv, tok]); // eslint-disable-line react-hooks/exhaustive-deps
  const segs: ByteSeg[] = [
    { from: 0, length: 33, tone: "pk", label: t("viz.dk.seg.owner") },
    { from: 33, length: 33, tone: "e", label: t("viz.dk.seg.receiver") },
    ...(vt.bytes ? [{ from: 66, length: 32, tone: "nft" as const, label: t("viz.dk.seg.token") }] : []),
  ];
  const lang = useVizLang();
  const labI = labNameOf(iss.trim());
  const labR = labNameOf(rcv.trim());
  const nameI = labI ? labDisplayName(labI, lang) : undefined;
  const nameR = labR ? labDisplayName(labR, lang) : undefined;
  return (
    <section className={`vz vz-panel vz-tl vz-dk${p.className ? " " + p.className : ""}`} aria-label={t("viz.dk.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.dk.eyebrow")}</div>
          <h3 className="vz-title">{t("viz.dk.title")}</h3>
          <p className="vz-sub">{t("viz.dk.sub")}</p>
        </div>
      </header>
      <div className="vz-body">
        <div className="vz-tl-grid">
          <div className="vz-field">
            <label htmlFor="vz-dk-i">{t("viz.dk.issuer")}</label>
            <input id="vz-dk-i" className={`vz-input mono${vi.error ? " err" : ""}`} value={iss} onChange={(e) => setIss(e.target.value)} spellCheck={false} autoComplete="off" />
            <KeyPicker value={iss} onPick={setIss} label={t("viz.tool.labKeys")} />
            {vi.error ? <span className="vz-help err">{vi.error}</span> : null}
          </div>
          <div className="vz-field">
            <label htmlFor="vz-dk-r">{t("viz.dk.receiver")}</label>
            <input id="vz-dk-r" className={`vz-input mono${vr.error ? " err" : ""}`} value={rcv} onChange={(e) => setRcv(e.target.value)} spellCheck={false} autoComplete="off" />
            <KeyPicker value={rcv} onPick={setRcv} label={t("viz.tool.labKeys")} />
            {vr.error ? <span className="vz-help err">{vr.error}</span> : null}
          </div>
        </div>
        <div className="vz-field">
          <label htmlFor="vz-dk-t">{t("viz.dk.token")}</label>
          <input id="vz-dk-t" className={`vz-input mono${vt.error ? " err" : ""}`} value={tok} onChange={(e) => setTok(e.target.value)} spellCheck={false} autoComplete="off" placeholder="—" />
          <span className={`vz-help${vt.error ? " err" : ""}`}>{vt.error ?? t("viz.dk.tokenHelp")}</span>
        </div>
        <div className="vz-tl-row">
          <Btn
            onClick={() => {
              setIss(rcv);
              setRcv(iss);
            }}
          >
            {t("viz.dk.swap")}
          </Btn>
          <span className="vz-small">{t("viz.dk.swapNote")}</span>
        </div>
        {parts ? (
          <>
            <div className="vz-field">
              <div className="vz-field-l">
                {t("viz.dk.preimage", { n: parts.preimage.length })}
                {nameI && nameR ? ` · ${nameI} → ${nameR}` : ""}
              </div>
              <ByteGrid bytes={parts.preimage} segs={segs} label={t("viz.dk.preimage", { n: parts.preimage.length })} />
              <ByteLegend segs={segs} />
            </div>
            <div className="vz-tl-step" aria-hidden="true">
              ↓ <span>{t("viz.dk.hashStep")}</span>
            </div>
            <div className="vz-field">
              <div className="vz-field-l">{t("viz.dk.key")}</div>
              <ByteGrid bytes={parts.key} segs={[{ from: 0, length: 32, tone: "key", label: t("viz.dk.seg.key") }]} label={t("viz.dk.key")} />
              <div className="vz-tl-row">
                <HexBlock hex={toHexStr(parts.key)} />
                <CopyBtn value={toHexStr(parts.key)} />
              </div>
            </div>
            <dl className="vz-kv">
              <dt>{t("viz.dk.reserveKey")}</dt>
              <dd>
                <code>{toHexStr(parts.reserveKey)}</code>
                <br />
                <span className="vz-small">{vt.bytes ? t("viz.dk.reserveKeyHelp") : t("viz.dk.sameKey")}</span>
              </dd>
            </dl>
          </>
        ) : null}
        <p className="vz-small">
          {t("viz.tool.labNote")} {t("viz.tool.runsHere")}
        </p>
      </div>
    </section>
  );
}

export default DebtKeyTool;
