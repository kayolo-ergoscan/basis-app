// NoteVerifyTool: paste a note as JSON → the 80-byte message is rebuilt from its fields → the issuer's signature is
// checked against it (the engine's verify, which keeps the contract's rules) and opened in the SignatureXray.

import { useMemo, useState } from "react";
import { debtKey, isValidPublicKey, noteMessage, sign, toHex, verify, type VerifyResult } from "@/protocol";
import { toHexStr } from "../core/format";
import { useVizT, type TFn } from "../core/lang";
import { LAB_DEFAULT_TS, LAB_TRACKER_NFT, labKey } from "../core/lab";
import { Btn, ByteGrid, CheckLamp } from "../core/primitives";
import { SignatureXray } from "../signature/SignatureXray";
import { SCHNORR_VECTORS } from "../signature/vectors";
import { MESSAGE_LAYOUT } from "./MessageBuilder";
import "../core/core.css";
import "./tools.css";

export interface ParsedNote {
  issuer: Uint8Array;
  receiver: Uint8Array;
  totalDebt: bigint;
  timestamp: bigint;
  trackerNftId: Uint8Array;
  signature: Uint8Array;
  tokenId: Uint8Array | null;
}

export type NoteParse = { ok: true; note: ParsedNote } | { ok: false; key: string; vars?: Record<string, string | number> };

const ALIASES: Record<keyof ParsedNote, string[]> = {
  issuer: ["issuer", "issuerPub", "issuer_pubkey", "issuerPubKey"],
  receiver: ["receiver", "recipient", "receiverPub", "recipient_pubkey", "receiver_pubkey", "recipientPub"],
  totalDebt: ["totalDebt", "total_debt", "amount_collected", "amount", "total"],
  timestamp: ["timestamp", "timestampMs", "ts"],
  trackerNftId: ["trackerNftId", "tracker_nft_id", "trackerNft"],
  signature: ["signature", "issuerSig", "issuer_signature", "sig"],
  tokenId: ["tokenId", "token_id", "denomination", "denom"],
};

function field(o: Record<string, unknown>, k: keyof ParsedNote): unknown {
  for (const a of ALIASES[k]) if (o[a] !== undefined && o[a] !== null) return o[a];
  return undefined;
}

function hexOf(v: unknown, want: number): Uint8Array | string {
  if (typeof v !== "string") return "viz.tool.invalidHex";
  const h = v.trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]*$/.test(h) || h.length % 2) return "viz.tool.invalidHex";
  if (h.length / 2 !== want) return `len:${h.length / 2}`;
  const b = new Uint8Array(want);
  for (let i = 0; i < want; i++) b[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return b;
}

function intOf(v: unknown): bigint | null {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === "string" && /^\d{1,20}$/.test(v.trim())) return BigInt(v.trim());
  if (typeof v === "bigint" && v >= 0n) return v;
  return null;
}

/** JSON (our names or the tracker server's) → the note's fields, or the first problem as an i18n key. */
export function parseNoteJson(text: string): NoteParse {
  let o: unknown;
  try {
    o = JSON.parse(text);
  } catch (e) {
    return { ok: false, key: "viz.nv.errJson", vars: { error: (e as Error).message } };
  }
  if (!o || typeof o !== "object" || Array.isArray(o)) return { ok: false, key: "viz.nv.errJson", vars: { error: "{…}" } };
  const r = o as Record<string, unknown>;
  const out: Partial<ParsedNote> = {};
  const hexFields: Array<[keyof ParsedNote, number]> = [
    ["issuer", 33],
    ["receiver", 33],
    ["trackerNftId", 32],
    ["signature", 65],
  ];
  for (const [k, want] of hexFields) {
    const v = field(r, k);
    if (v === undefined) return { ok: false, key: "viz.nv.errMissing", vars: { f: k } };
    const b = hexOf(v, want);
    if (typeof b === "string") return { ok: false, key: "viz.nv.errField", vars: { f: k, why: b.startsWith("len:") ? `${b.slice(4)} / ${want}` : "hex" } };
    (out as Record<string, unknown>)[k] = b;
  }
  for (const k of ["totalDebt", "timestamp"] as const) {
    const v = field(r, k);
    if (v === undefined) return { ok: false, key: "viz.nv.errMissing", vars: { f: k } };
    const n = intOf(v);
    if (n === null) return { ok: false, key: "viz.nv.errField", vars: { f: k, why: "int" } };
    out[k] = n;
  }
  const tok = field(r, "tokenId");
  if (tok === undefined || tok === "erg" || tok === "ERG" || tok === "") out.tokenId = null;
  else {
    const s = typeof tok === "string" && tok.startsWith("token:") ? tok.slice(6) : tok;
    const b = hexOf(s, 32);
    if (typeof b === "string") return { ok: false, key: "viz.nv.errField", vars: { f: "tokenId", why: "hex" } };
    out.tokenId = b;
  }
  return { ok: true, note: out as ParsedNote };
}

export function noteMessageOf(n: ParsedNote): Uint8Array {
  return noteMessage(debtKey(n.issuer, n.receiver, n.tokenId), n.totalDebt, n.timestamp, n.trackerNftId);
}

/** A signed sandbox note (Alice → Bob, 1.5 ERG) as the JSON the tool takes. */
export function sampleNoteJson(): string {
  const a = labKey("Alice");
  const b = labKey("Bob");
  const total = 1_500_000_000n;
  const msg = noteMessage(debtKey(a.pub, b.pub), total, LAB_DEFAULT_TS, LAB_TRACKER_NFT);
  return JSON.stringify(
    { issuer: a.pubHex, receiver: b.pubHex, totalDebt: total.toString(), timestamp: LAB_DEFAULT_TS.toString(), trackerNftId: LAB_TRACKER_NFT, signature: toHex(sign(msg, a)) },
    null,
    2,
  );
}

/** TV001 of the signature spec, as note JSON (its message's NFT field is 0x42 × 32). */
export function tv001Json(): string {
  const v = SCHNORR_VECTORS[0];
  return JSON.stringify(
    { issuer: v.issuerPub, receiver: v.recipientPub, totalDebt: v.amount.toString(), timestamp: v.timestampMs.toString(), trackerNftId: v.message.slice(96), signature: v.signature },
    null,
    2,
  );
}

function errorText(p: Extract<NoteParse, { ok: false }>, t: TFn): string {
  if (p.key === "viz.nv.errField" && p.vars) {
    const why = p.vars.why === "hex" ? t("viz.tool.invalidHex") : p.vars.why === "int" ? t("viz.nv.errNumber") : t("viz.tool.wrongLength", { n: String(p.vars.why).split(" / ")[0], want: String(p.vars.why).split(" / ")[1] });
    return t("viz.nv.errField", { f: String(p.vars.f), why });
  }
  return t(p.key, p.vars);
}

export function NoteVerifyTool({ initial, className }: { initial?: string; className?: string }) {
  const t = useVizT();
  const [text, setText] = useState(initial ?? sampleNoteJson);
  const parsed = useMemo(() => (text.trim() ? parseNoteJson(text) : null), [text]);
  const note = parsed && parsed.ok ? parsed.note : null;
  const keyErr = note && !isValidPublicKey(note.issuer) ? t("viz.tool.notPoint") : null;
  const msg = useMemo(() => (note ? noteMessageOf(note) : null), [note]);
  const result: VerifyResult | null = useMemo(() => (note && msg ? verify(note.issuer, msg, note.signature) : null), [note, msg]);
  const segs = MESSAGE_LAYOUT.map((s) => ({ from: s.from, length: s.length, tone: s.tone, label: t(`viz.mb.seg.${s.part}`) }));
  return (
    <section className={`vz vz-panel vz-tl vz-nv${className ? " " + className : ""}`} aria-label={t("viz.nv.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.nv.eyebrow")}</div>
          <h3 className="vz-title">{t("viz.nv.title")}</h3>
          <p className="vz-sub">{t("viz.nv.sub")}</p>
        </div>
      </header>
      <div className="vz-body">
        <div className="vz-field">
          <label htmlFor="vz-nv-j">{t("viz.nv.json")}</label>
          <textarea id="vz-nv-j" className={`vz-input vz-ta${parsed && !parsed.ok ? " err" : ""}`} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} rows={9} />
          <div className="vz-tl-row">
            <Btn kind="quiet" onClick={() => setText(sampleNoteJson())}>
              {t("viz.nv.sample")}
            </Btn>
            <Btn kind="quiet" onClick={() => setText(tv001Json())}>
              {t("viz.nv.tv001")}
            </Btn>
            <Btn kind="quiet" onClick={() => setText("")}>
              {t("viz.nv.clear")}
            </Btn>
          </div>
          <span className={`vz-help${parsed && !parsed.ok ? " err" : ""}`}>{parsed && !parsed.ok ? errorText(parsed, t) : keyErr ?? t("viz.nv.help")}</span>
        </div>
        {!parsed ? <p className="vz-small">{t("viz.nv.waiting")}</p> : null}
        {msg && result ? (
          <>
            <div className="vz-field">
              <div className="vz-field-l">{t("viz.nv.rebuilt")}</div>
              <ByteGrid bytes={msg} segs={segs} label={t("viz.nv.rebuilt")} />
            </div>
            <div className={`vz-verdict ${result.ok ? "ok" : "bad"}`} role="status">
              <CheckLamp state={result.ok ? "pass" : "fail"} size={14} />
              <div>
                <div className="vz-verdict-t">{result.ok ? t("viz.nv.ok") : t("viz.nv.bad")}</div>
                {!result.ok ? <div className="vz-verdict-d">{`${result.reason ? t(`viz.sig.fail.${result.reason}`) : result.message}. ${t("viz.nv.badSub")}`}</div> : null}
              </div>
            </div>
            <SignatureXray key={toHexStr(msg) + toHexStr(note!.signature)} pub={note!.issuer} message={msg} signature={note!.signature} signer="issuer" />
          </>
        ) : null}
        <p className="vz-small">{t("viz.tool.runsHere")}</p>
      </div>
    </section>
  );
}

export default NoteVerifyTool;
