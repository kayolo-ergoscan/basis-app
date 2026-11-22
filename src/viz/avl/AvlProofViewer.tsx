// AvlProofViewer: a committed 33-byte digest, a lookup proof split into its parts, and a verifier run that
// recomputes the root (real Ergo AVL+ when the wasm backend is loaded) → MATCH; flip one byte → MISMATCH.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { getAvlBackend, readI64BE, toBytes, type AvlBackend, type Hex } from "@/protocol";
import { ERG_UNIT, fmtAmount, fmtTimestamp, shortHex, toHexStr, type UnitInfo } from "../core/format";
import { useVizT, type TFn } from "../core/lang";
import { Btn, ByteGrid, ByteLegend, CheckLamp, FaceToggle, HexBlock, Tag, useFace, type CheckLampState, type Face } from "../core/primitives";
import { DigestGlyph } from "./DigestGlyph";
import { proofAnatomy, proofByteSegs, rootMatches, type ProofAnatomy } from "./proof";
import "../core/core.css";
import "./avl.css";

export type AvlValueKind = "tracker" | "reserve" | "raw";

export interface AvlProofViewerProps {
  /** Committed digest: root label ‖ height (33 bytes), as in an AvlTree register. */
  digest: Uint8Array | Hex;
  /** Lookup proof (context var #8 for the tracker tree, #7 for the reserve tree). */
  proof: Uint8Array | Hex;
  /** The key looked up (a debt key or a reserve key). Not `key`: React keeps that prop for itself. */
  lookupKey: Uint8Array | Hex;
  /** Who/what the key is (e.g. "Alice → Bob"). */
  keyLabel?: ReactNode;
  /** Verifier to run (default: the active engine backend). */
  backend?: AvlBackend;
  valueKind?: AvlValueKind;
  unit?: UnitInfo;
  tamper?: boolean;
  face?: Face;
  title?: ReactNode;
  className?: string;
}

function bytes(v: Uint8Array | Hex): Uint8Array {
  try {
    return v instanceof Uint8Array ? v.slice() : toBytes(v).slice();
  } catch {
    return new Uint8Array();
  }
}

export function describeAvlValue(v: Uint8Array, kind: AvlValueKind, unit: UnitInfo, t: TFn): string {
  if (kind === "tracker" && v.length >= 8) return t("viz.avl.value.tracker", { amount: fmtAmount(readI64BE(v, 0), unit) });
  if (kind === "reserve" && v.length >= 16) return t("viz.avl.value.reserve", { amount: fmtAmount(readI64BE(v, 8), unit), ts: fmtTimestamp(readI64BE(v, 0)) });
  return t("viz.avl.value.raw", { n: v.length });
}

type Run = { state: "found"; value: Uint8Array } | { state: "absent" } | { state: "threw"; error: string } | { state: "none" };

function runVerifier(b: AvlBackend, digest: Uint8Array, key: Uint8Array, proof: Uint8Array): Run {
  if (!b.verifier) return { state: "none" };
  try {
    const v = b.verifier.lookup(digest, key, proof);
    return v ? { state: "found", value: v } : { state: "absent" };
  } catch (e) {
    return { state: "threw", error: (e as Error).message };
  }
}

export function AvlProofViewer(p: AvlProofViewerProps) {
  const t = useVizT();
  const [face, setFace] = useFace("story", p.face);
  const backend = p.backend ?? getAvlBackend();
  const digest = useMemo(() => bytes(p.digest), [p.digest]);
  const key = useMemo(() => bytes(p.lookupKey), [p.lookupKey]);
  const base = useMemo(() => bytes(p.proof), [p.proof]);
  const [proof, setProof] = useState(base);
  useEffect(() => setProof(base.slice()), [base]);
  const changed = useMemo(() => {
    const s = new Set<number>();
    for (let i = 0; i < proof.length; i++) if (proof[i] !== base[i]) s.add(i);
    return s;
  }, [proof, base]);
  const anatomy: ProofAnatomy = useMemo(() => proofAnatomy(proof, backend), [proof, backend]);
  const run = useMemo(() => runVerifier(backend, digest, key, proof), [backend, digest, key, proof]);
  const match = rootMatches(anatomy, digest);
  const ok = run.state === "found" || run.state === "absent";
  const unit = p.unit ?? ERG_UNIT;
  const kind = p.valueKind ?? "raw";
  const segNames = {
    label: t("viz.avl.seg.label"),
    leaf: t("viz.avl.seg.leaf"),
    internal: t("viz.avl.seg.internal"),
    end: t("viz.avl.seg.end"),
    directions: t("viz.avl.seg.directions"),
    sandbox: t("viz.avl.seg.sandbox"),
  };
  const segs = proofByteSegs(anatomy, segNames);
  const legendSegs = (() => {
    const seen = new Set<string>();
    return segs.filter((s) => (seen.has(s.tone) ? false : (seen.add(s.tone), true))).map((s) => ({ ...s, label: s.label }));
  })();
  const backendName = backend.simulated ? t("viz.avl.backend.simulated") : t("viz.avl.backend.wasm");
  const parseState: CheckLampState = anatomy.wellFormed ? "pass" : "fail";
  const rootState: CheckLampState = match === null ? "skip" : match ? "pass" : "fail";
  const runState: CheckLampState = run.state === "none" ? "skip" : ok ? "pass" : "fail";

  return (
    <section className={`vz vz-panel vz-avlp${p.className ? " " + p.className : ""}`} aria-label={t("viz.avl.proofEyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.avl.proofEyebrow")}</div>
          <h3 className="vz-title">{p.title ?? t("viz.avl.proofTitle")}</h3>
          <p className="vz-sub">{t("viz.avl.proofSub")}</p>
        </div>
        <div className="vz-head-a">
          <Tag tone={backend.simulated ? "agent" : "plain"}>{backendName}</Tag>
          {changed.size ? (
            <Btn kind="quiet" onClick={() => setProof(base.slice())}>
              {t("viz.sig.restore")}
            </Btn>
          ) : null}
          <FaceToggle face={face} onChange={setFace} />
        </div>
      </header>
      <div className="vz-body">
        <div className="vz-avl-digest">
          <DigestGlyph digest={digest} size={64} holo />
          <div className="vz-avl-digest-t">
            <div className="vz-eyebrow">
              <b>{t("viz.avl.digest")}</b>
            </div>
            <HexBlock hex={toHexStr(digest)} />
            <span className="vz-small">{t("viz.avl.digestSub", { h: digest.length > 32 ? digest[32] : "?" })}</span>
          </div>
        </div>
        <dl className="vz-kv">
          <dt>{t("viz.avl.key")}</dt>
          <dd>
            {p.keyLabel ? <>{p.keyLabel} · </> : null}
            <code>{face === "machine" ? toHexStr(key) : shortHex(toHexStr(key), 8, 8)}</code>
          </dd>
        </dl>
        <div className="vz-field">
          <div className="vz-sx-rh">
            <span className="vz-eyebrow">
              <b>{t("viz.avl.proof")}</b>
            </span>
            <span className="vz-small">
              {t("viz.avl.proofSize", { n: proof.length })} ·{" "}
              {anatomy.format === "sandbox" && anatomy.sandbox
                ? anatomy.sandbox.parts.map((pt) => t("viz.avl.sandboxParts", { b: pt.bucket, e: pt.entries.length, s: pt.siblings.length })).join(" · ")
                : t("viz.avl.parts", anatomy.counts)}
            </span>
          </div>
          {p.tamper !== false ? <span className="vz-help">{t("viz.avl.tamperHint")}</span> : null}
          <ByteGrid bytes={proof} segs={segs} dense={proof.length > 400} changed={changed} onByte={p.tamper !== false ? (i) => setProof((x) => {
            const n = x.slice();
            n[i] ^= 0x01;
            return n;
          }) : undefined} label={t("viz.avl.proof")} />
          <ByteLegend segs={legendSegs} />
        </div>
        {face === "machine" && anatomy.format === "ergo-avl" ? (
          <ol className="vz-avl-parts">
            {anatomy.segments.map((s, i) => (
              <li key={i} className={`k-${s.kind}`}>
                <code className="o">{t("viz.avl.part.offset", { o: s.from })}</code>
                <span className="n">{segNames[s.kind]}</span>
                <code className="d">
                  {s.part?.kind === "label"
                    ? shortHex(toHexStr(s.part.label), 8, 8)
                    : s.part?.kind === "leaf"
                      ? s.part.keyFromPrevious
                        ? `${t("viz.avl.part.leafPrev")} · ${t("viz.avl.part.leaf", { k: shortHex(toHexStr(s.part.key)), n: shortHex(toHexStr(s.part.nextKey)), v: toHexStr(s.part.value) || "∅" })}`
                        : t("viz.avl.part.leaf", { k: shortHex(toHexStr(s.part.key)), n: shortHex(toHexStr(s.part.nextKey)), v: toHexStr(s.part.value) || "∅" })
                      : s.part?.kind === "internal"
                        ? t("viz.avl.part.balance", { b: s.part.balance })
                        : s.part?.kind === "directions"
                          ? t("viz.avl.part.bits", { n: s.part.bits.length })
                          : ""}
                </code>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="vz-eyebrow">{t("viz.avl.run")}</div>
        <ol className="vz-avl-run">
          <li className={`s-${parseState}`}>
            <CheckLamp state={parseState} size={12} />
            <span>{anatomy.wellFormed ? t("viz.avl.step.parse") : t("viz.avl.step.parseBad", { error: anatomy.error ?? "?" })}</span>
          </li>
          <li className={`s-${rootState}`}>
            <CheckLamp state={rootState} size={12} />
            {anatomy.format === "ergo-avl" ? (
              <div className="vz-avl-root">
                <span>{t("viz.avl.step.root")}</span>
                {anatomy.root ? (
                  <div className="cmp">
                    <DigestGlyph digest={new Uint8Array([...anatomy.root, digest[32] ?? 0])} size={40} />
                    <div>
                      <div className="row">
                        <span className="lbl">{t("viz.avl.recomputed")}</span> <code className={match ? "" : "bad"}>{shortHex(toHexStr(anatomy.root), 10, 6)}</code>
                      </div>
                      <div className="row">
                        <span className="lbl">{t("viz.avl.committed")}</span> <code>{shortHex(toHexStr(digest.subarray(0, 32)), 10, 6)}</code>
                      </div>
                    </div>
                    <b className={`mt ${match ? "ok" : "bad"}`}>{match ? t("viz.avl.match") : t("viz.avl.mismatch")}</b>
                  </div>
                ) : null}
              </div>
            ) : (
              <span>{t("viz.avl.step.rootSandbox")}</span>
            )}
          </li>
          <li className={`s-${runState}`}>
            <CheckLamp state={runState} size={12} />
            <span>
              {t("viz.avl.step.verify", { backend: backendName })}:{" "}
              {run.state === "found" ? `${t("viz.avl.found")}, ${describeAvlValue(run.value, kind, unit, t)}` : run.state === "absent" ? t("viz.avl.absent") : run.state === "threw" ? t("viz.avl.threw", { error: run.error }) : t("viz.avl.noVerifier")}
            </span>
          </li>
        </ol>
        <div className={`vz-verdict ${ok && match !== false ? "ok" : "bad"}`} role="status">
          <CheckLamp state={ok && match !== false ? "pass" : "fail"} size={14} />
          <div>
            <div className="vz-verdict-t">
              {ok && match !== false
                ? run.state === "found"
                  ? t("viz.avl.verdictOkValue", { value: describeAvlValue(run.value, kind, unit, t) })
                  : t("viz.avl.verdictAbsent")
                : t("viz.avl.verdictBad")}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export default AvlProofViewer;
