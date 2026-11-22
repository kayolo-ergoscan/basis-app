// SignatureXray: the 80-byte note message, the 65-byte signature and the 33-byte key as byte grids; the
// verifier's steps (shape, points, challenge e = blake2b256(a ‖ msg ‖ pk) with e[0] < 0x80, z < 2^255,
// g^z = a·x^e with both sides as compressed points) and a verdict. Every byte is tappable: flipping one shows
// exactly which check breaks.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { explain, parseNoteMessage, toBytes, type Hex, type SignatureXray as EngineXray, type XrayCheck, type XrayCheckId } from "@/protocol";
import { ERG_UNIT, fmtAmount, fmtRaw, fmtTimestamp, shortHex, type UnitInfo } from "../core/format";
import { useVizT } from "../core/lang";
import { Btn, ByteGrid, ByteLegend, CheckLamp, FaceToggle, HexBlock, useFace, type ByteSeg, type CheckLampState, type Face } from "../core/primitives";
import "../core/core.css";
import "./signature.css";

export interface SignatureXrayProps {
  /** Signer's compressed public key (33 bytes). */
  pub?: Uint8Array | Hex;
  /** Signed bytes (normally the 80-byte note message). */
  message?: Uint8Array | Hex;
  /** a ‖ z, 65 bytes. */
  signature?: Uint8Array | Hex;
  /** Or a ready engine X-ray (Economy.xray(rec) / explain()). */
  xray?: EngineXray;
  signer?: "issuer" | "tracker";
  /** How the message's total debt is written (default ERG). */
  unit?: UnitInfo;
  /** Tap-to-tamper on every byte (default true). */
  tamper?: boolean;
  face?: Face;
  title?: ReactNode;
  sub?: ReactNode;
  className?: string;
  /** Called with every new verification (after a tamper too). */
  onResult?: (x: EngineXray) => void;
}

type Region = "msg" | "sig" | "pk";

function bytesOf(v: Uint8Array | Hex | undefined | null): Uint8Array {
  if (!v) return new Uint8Array();
  try {
    return v instanceof Uint8Array ? v.slice() : toBytes(v).slice();
  } catch {
    return new Uint8Array();
  }
}

function diff(a: Uint8Array, b: Uint8Array): Set<number> {
  const s = new Set<number>();
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) s.add(i);
  return s;
}

const STEPS: Array<[string, XrayCheckId[]]> = [
  ["shape", ["length", "a-prefix", "z-zero"]],
  ["points", ["pubkey-invalid", "a-not-on-curve"]],
  ["e", ["e-top-bit"]],
  ["z", ["z-top-bit"]],
  ["eq", ["equation"]],
];

function lampOf(c: XrayCheck | undefined): CheckLampState {
  if (!c || c.ok === null) return "skip";
  return c.ok ? "pass" : "fail";
}

export function SignatureXray(p: SignatureXrayProps) {
  const t = useVizT();
  const [face, setFace] = useFace("story", p.face);
  const base = useMemo(
    () => ({ pk: bytesOf(p.xray ? p.xray.pubkey : p.pub), msg: bytesOf(p.xray ? p.xray.message : p.message), sig: bytesOf(p.xray ? p.xray.signature : p.signature) }),
    [p.xray, p.pub, p.message, p.signature],
  );
  const [cur, setCur] = useState(base);
  useEffect(() => setCur({ pk: base.pk.slice(), msg: base.msg.slice(), sig: base.sig.slice() }), [base]);
  const x = useMemo(() => explain(cur.pk, cur.msg, cur.sig), [cur]);
  const { onResult } = p;
  useEffect(() => onResult?.(x), [x, onResult]);
  const changed = useMemo(() => ({ msg: diff(base.msg, cur.msg), sig: diff(base.sig, cur.sig), pk: diff(base.pk, cur.pk) }), [base, cur]);
  const nChanged = changed.msg.size + changed.sig.size + changed.pk.size;
  const tamper = p.tamper !== false;
  const flip = (r: Region) => (i: number) =>
    setCur((c) => {
      const n = c[r].slice();
      n[i] ^= 0x01;
      return { ...c, [r]: n };
    });

  const unit = p.unit ?? ERG_UNIT;
  const msgSegs: ByteSeg[] =
    cur.msg.length === 80
      ? [
          { from: 0, length: 32, tone: "key", label: t("viz.sig.seg.key") },
          { from: 32, length: 8, tone: "debt", label: t("viz.sig.seg.debt") },
          { from: 40, length: 8, tone: "ts", label: t("viz.sig.seg.ts") },
          { from: 48, length: 32, tone: "nft", label: t("viz.sig.seg.nft") },
        ]
      : [{ from: 0, length: cur.msg.length, tone: "dim", label: t("viz.sig.seg.bytes") }];
  const msgValues = useMemo(() => {
    if (cur.msg.length !== 80) return undefined;
    const f = parseNoteMessage(cur.msg);
    return {
      key: <code>{shortHex(f.key)}</code>,
      debt: t("viz.sig.decoded.debt", { amount: fmtAmount(f.totalDebt, unit), raw: fmtRaw(f.totalDebt, unit) }),
      ts: fmtTimestamp(f.timestamp),
      nft: <code>{shortHex(f.trackerNftId)}</code>,
    } as Record<string, ReactNode>;
  }, [cur.msg, unit, t]);
  const sigSegs: ByteSeg[] =
    cur.sig.length === 65
      ? [
          { from: 0, length: 33, tone: "a", label: t("viz.sig.seg.a") },
          { from: 33, length: 32, tone: "z", label: t("viz.sig.seg.z") },
        ]
      : [{ from: 0, length: cur.sig.length, tone: "dim", label: t("viz.sig.seg.bytes") }];
  const pkSegs: ByteSeg[] = [{ from: 0, length: cur.pk.length, tone: "pk", label: t("viz.sig.seg.pk") }];

  const byId = new Map(x.checks.map((c) => [c.id, c]));
  const failed = x.failed;
  const signer = p.signer ? ` · ${t(`viz.sig.signer.${p.signer}`)}` : "";
  const e0 = x.e ? parseInt(x.e.slice(0, 2), 16) : null;
  const z0 = x.z ? parseInt(x.z.slice(0, 2), 16) : null;

  return (
    <section className={`vz vz-panel vz-sx${p.className ? " " + p.className : ""}`} aria-label={t("viz.sig.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.sig.eyebrow")}{signer}</div>
          <h3 className="vz-title">{p.title ?? t("viz.sig.title")}</h3>
          <p className="vz-sub">{p.sub ?? t("viz.sig.sub")}</p>
        </div>
        <div className="vz-head-a">
          {nChanged > 0 ? (
            <>
              <span className="vz-sx-changed">{t("viz.sig.changed", { n: nChanged })}</span>
              <Btn kind="quiet" onClick={() => setCur({ pk: base.pk.slice(), msg: base.msg.slice(), sig: base.sig.slice() })}>
                {t("viz.sig.restore")}
              </Btn>
            </>
          ) : null}
          <FaceToggle face={face} onChange={setFace} />
        </div>
      </header>
      <div className="vz-body">
        {tamper ? <p className="vz-small">{t("viz.sig.tamperHint")}</p> : null}
        <div className="vz-sx-region">
          <div className="vz-sx-rh">
            <span className="vz-eyebrow"><b>{t("viz.sig.message")}</b></span>
            <span className="vz-small">{cur.msg.length === 80 ? t("viz.sig.messageSub") : t("viz.sig.messageOther", { n: cur.msg.length })}</span>
          </div>
          <ByteGrid bytes={cur.msg} segs={msgSegs} onByte={tamper ? flip("msg") : undefined} changed={changed.msg} label={t("viz.sig.message")} />
          <ByteLegend segs={msgSegs} values={face === "story" ? msgValues : undefined} />
        </div>
        <div className="vz-sx-pair">
          <div className="vz-sx-region">
            <div className="vz-sx-rh">
              <span className="vz-eyebrow"><b>{t("viz.sig.signature")}</b></span>
              <span className="vz-small">{t("viz.sig.signatureSub")}</span>
            </div>
            <ByteGrid bytes={cur.sig} segs={sigSegs} onByte={tamper ? flip("sig") : undefined} changed={changed.sig} focus={failed === "a-prefix" ? new Set([0]) : failed === "z-top-bit" ? new Set([33]) : undefined} label={t("viz.sig.signature")} />
            <ByteLegend segs={sigSegs} />
          </div>
          <div className="vz-sx-region">
            <div className="vz-sx-rh">
              <span className="vz-eyebrow"><b>{t("viz.sig.key")}</b></span>
              <span className="vz-small">{t("viz.sig.keySub")}</span>
            </div>
            <ByteGrid bytes={cur.pk} segs={pkSegs} onByte={tamper ? flip("pk") : undefined} changed={changed.pk} label={t("viz.sig.key")} />
          </div>
        </div>

        <div className="vz-eyebrow">{t("viz.sig.steps")}</div>
        <ol className="vz-sx-steps">
          {STEPS.map(([step, ids], si) => {
            const cs = ids.map((id) => byId.get(id));
            const state: CheckLampState = cs.some((c) => c?.ok === false) ? "fail" : cs.every((c) => c?.ok === true) ? "pass" : "skip";
            return (
              <li key={step} className={`vz-sx-step s-${state}${ids.includes(failed as XrayCheckId) ? " first" : ""}`}>
                <div className="vz-sx-sh">
                  <CheckLamp state={state} size={12} />
                  <span className="n">{si + 1}</span>
                  <b>{t(`viz.sig.step.${step}`)}</b>
                </div>
                <ul className="vz-sx-cl">
                  {cs.map((c, i) => (
                    <li key={ids[i]} className={`s-${lampOf(c)}`}>
                      <CheckLamp state={lampOf(c)} size={10} />
                      <span>{t(`viz.sig.check.${ids[i]}`)}</span>
                      {face === "machine" && c ? <code className="dt">{c.detail}</code> : null}
                    </li>
                  ))}
                </ul>
                {step === "e" ? (
                  <div className="vz-sx-math">
                    <code className="f">{t("viz.sig.eFormula")}</code>
                    {x.e ? <HexBlock hex={x.e} /> : <span className="vz-small">{t("viz.sig.notComputed")}</span>}
                    {e0 !== null ? <span className={`rule${e0 >= 0x80 ? " bad" : ""}`}>{t("viz.sig.eTop", { b: x.e!.slice(0, 2), rule: e0 >= 0x80 ? t("viz.sig.above") : t("viz.sig.below") })}</span> : null}
                  </div>
                ) : null}
                {step === "z" && z0 !== null ? (
                  <div className="vz-sx-math">
                    <span className={`rule${z0 >= 0x80 ? " bad" : ""}`}>{t("viz.sig.zTop", { b: x.z!.slice(0, 2), rule: z0 >= 0x80 ? t("viz.sig.above") : t("viz.sig.below") })}</span>
                  </div>
                ) : null}
                {step === "eq" ? (
                  <div className="vz-sx-math">
                    <div className="vz-sx-side">
                      <span className="lbl">{t("viz.sig.lhs")}</span>
                      {x.lhs ? <HexBlock hex={x.lhs} /> : <span className="vz-small">{t("viz.sig.notComputed")}</span>}
                    </div>
                    <div className="vz-sx-side">
                      <span className="lbl">{t("viz.sig.rhs")}</span>
                      {x.rhs ? <HexBlock hex={x.rhs} className={x.lhs && x.rhs !== x.lhs ? "differ" : undefined} /> : <span className="vz-small">{t("viz.sig.notComputed")}</span>}
                    </div>
                    {x.equationHolds !== null ? <span className={`rule${x.equationHolds ? "" : " bad"}`}>{x.equationHolds ? t("viz.sig.equal") : t("viz.sig.differ")}</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>

        {face === "machine" ? (
          <dl className="vz-kv vz-sx-machine">
            <dt>{t("viz.sig.challengeInput")}</dt>
            <dd>{x.challengeInput ? <HexBlock hex={x.challengeInput} /> : "—"}</dd>
            <dt>{t("viz.sig.eDec")}</dt>
            <dd><code>{x.eDecimal ?? "—"}</code></dd>
            <dt>{t("viz.sig.eSigned")}</dt>
            <dd><code>{x.contractView.eSigned ?? "—"}</code></dd>
            <dt>{t("viz.sig.zDec")}</dt>
            <dd><code>{x.zDecimal ?? "—"}</code></dd>
            <dt>{t("viz.sig.zSigned")}</dt>
            <dd><code>{x.contractView.zSigned ?? "—"}</code></dd>
            <dt>{t("viz.sig.contractHolds")}</dt>
            <dd>
              <CheckLamp state={x.contractView.holds === null ? "skip" : x.contractView.holds ? "pass" : "fail"} size={10} /> {x.zTopBit || x.eTopBit ? t("viz.sig.contractDiffers") : t("viz.sig.contractSame")}
            </dd>
          </dl>
        ) : null}

        <div className={`vz-verdict ${x.ok ? "ok" : "bad"}`} role="status">
          <CheckLamp state={x.ok ? "pass" : "fail"} size={14} />
          <div>
            <div className="vz-verdict-t">{x.ok ? t("viz.sig.verdictOk", { n: cur.msg.length }) : t("viz.sig.verdictBad", { check: failed ? t(`viz.sig.check.${failed}`) : "?" })}</div>
            {!x.ok && x.reason ? <div className="vz-verdict-d">{t(`viz.sig.fail.${x.reason}`)}</div> : null}
          </div>
        </div>
      </div>
    </section>
  );
}

export default SignatureXray;
