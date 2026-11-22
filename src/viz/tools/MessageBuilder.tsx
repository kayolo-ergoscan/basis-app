// MessageBuilder: the 80-byte note message assembled field by field (debt key 32 ‖ total 8 BE ‖ timestamp 8 BE ‖
// tracker NFT id 32). buildMessage() writes the bytes itself; the tests check it against the engine's noteMessage.

import { useMemo, useState } from "react";
import { debtKey } from "@/protocol";
import { ERG_UNIT, fmtAmount, fmtInt, fmtTimestamp, shortHex, toHexStr, type UnitInfo } from "../core/format";
import { useVizLang, useVizT } from "../core/lang";
import { LAB_DEFAULT_TS, LAB_TRACKER_NFT, labDisplayName, labKey } from "../core/lab";
import { Btn, ByteGrid, ByteLegend, CopyBtn, HexBlock, type ByteSeg } from "../core/primitives";
import { checkHexField } from "./DebtKeyTool";
import "../core/core.css";
import "./tools.css";

export interface MessageFields {
  key: Uint8Array;
  totalDebt: bigint;
  timestampMs: bigint;
  trackerNftId: Uint8Array;
}

export const MESSAGE_LAYOUT = [
  { part: "key", from: 0, length: 32, tone: "key" },
  { part: "total", from: 32, length: 8, tone: "debt" },
  { part: "ts", from: 40, length: 8, tone: "ts" },
  { part: "nft", from: 48, length: 32, tone: "nft" },
] as const;

export const I64_MAX = (1n << 63n) - 1n;
const U64_MAX = (1n << 64n) - 1n;

/** 8 bytes, big-endian (two's complement for the u64 range). */
export function u64BE(v: bigint): Uint8Array {
  if (v < 0n || v > U64_MAX) throw new RangeError("out of 8-byte range");
  const b = new Uint8Array(8);
  let x = v;
  for (let i = 7; i >= 0; i--) {
    b[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return b;
}

export function buildMessage(f: MessageFields): Uint8Array {
  if (f.key.length !== 32 || f.trackerNftId.length !== 32) throw new RangeError("key and tracker NFT id are 32 bytes");
  const out = new Uint8Array(80);
  out.set(f.key, 0);
  out.set(u64BE(f.totalDebt), 32);
  out.set(u64BE(f.timestampMs), 40);
  out.set(f.trackerNftId, 48);
  return out;
}

/** "1.5", "1 240.50", "1240,5" → raw units; null when it is not an amount with at most `decimals` places. */
export function parseAmountInput(s: string, decimals: number): bigint | null {
  const v = s.replace(/[\s ⁠  ]/g, "").replace(",", ".");
  if (!/^\d+(\.\d*)?$/.test(v)) return null;
  const [i, f = ""] = v.split(".");
  if (f.length > decimals) return null;
  return BigInt(i) * 10n ** BigInt(decimals) + BigInt((f + "0".repeat(decimals)).slice(0, decimals) || "0");
}

export interface MessageBuilderProps {
  debtKey?: string;
  /** Raw units. */
  totalDebt?: bigint;
  timestampMs?: bigint;
  trackerNftId?: string;
  unit?: UnitInfo;
  className?: string;
}

export function MessageBuilder(p: MessageBuilderProps) {
  const t = useVizT();
  const lang = useVizLang();
  const unit = p.unit ?? ERG_UNIT;
  const aliceBob = useMemo(() => toHexStr(debtKey(labKey("Alice").pub, labKey("Bob").pub)), []);
  const [key, setKey] = useState(p.debtKey ?? aliceBob);
  const [amount, setAmount] = useState(p.totalDebt !== undefined ? fmtAmount(p.totalDebt, unit, { unit: false }).replace(/[ ⁠]/g, "") : "1.5");
  const [ts, setTs] = useState((p.timestampMs ?? LAB_DEFAULT_TS).toString());
  const [nft, setNft] = useState(p.trackerNftId ?? LAB_TRACKER_NFT);
  const vk = checkHexField(key, 32, t);
  const vn = checkHexField(nft, 32, t);
  const total = parseAmountInput(amount, unit.decimals);
  const totalOk = total !== null && total <= U64_MAX;
  const tsv = /^\d{1,20}$/.test(ts.trim()) ? BigInt(ts.trim()) : null;
  const tsOk = tsv !== null && tsv <= U64_MAX;
  const msg = vk.bytes && vn.bytes && totalOk && tsOk ? buildMessage({ key: vk.bytes, totalDebt: total!, timestampMs: tsv!, trackerNftId: vn.bytes }) : null;
  const range = (totalOk && total! > I64_MAX) || (tsOk && tsv! > I64_MAX);
  const segs: ByteSeg[] = MESSAGE_LAYOUT.map((s) => ({ from: s.from, length: s.length, tone: s.tone, label: t(`viz.mb.seg.${s.part}`) }));
  const values = msg
    ? {
        key: <code>{shortHex(toHexStr(msg.subarray(0, 32)), 6, 6)}</code>,
        debt: (
          <>
            {fmtAmount(total!, unit)} · {t("viz.mb.raw", { raw: fmtInt(total!) })} · <code>0x{toHexStr(msg.subarray(32, 40))}</code>
          </>
        ),
        ts: (
          <>
            {fmtTimestamp(tsv!)} · <code>0x{toHexStr(msg.subarray(40, 48))}</code>
          </>
        ),
        nft: <code>{shortHex(toHexStr(msg.subarray(48, 80)), 6, 6)}</code>,
      }
    : undefined;
  return (
    <section className={`vz vz-panel vz-tl vz-mb${p.className ? " " + p.className : ""}`} aria-label={t("viz.mb.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">{t("viz.mb.eyebrow")}</div>
          <h3 className="vz-title">{t("viz.mb.title")}</h3>
          <p className="vz-sub">{t("viz.mb.sub")}</p>
        </div>
      </header>
      <div className="vz-body">
        <div className="vz-field">
          <label htmlFor="vz-mb-k">{t("viz.mb.key")}</label>
          <input id="vz-mb-k" className={`vz-input mono${vk.error ? " err" : ""}`} value={key} onChange={(e) => setKey(e.target.value)} spellCheck={false} autoComplete="off" />
          <div className="vz-tl-row">
            <Btn kind="quiet" onClick={() => setKey(aliceBob)}>
              {t("viz.mb.keyFrom", { a: labDisplayName("Alice", lang), b: labDisplayName("Bob", lang) })}
            </Btn>
            {vk.error ? <span className="vz-help err">{vk.error}</span> : null}
          </div>
        </div>
        <div className="vz-tl-grid">
          <div className="vz-field">
            <label htmlFor="vz-mb-a">{t("viz.mb.total", { sym: unit.symbol })}</label>
            <input id="vz-mb-a" className={`vz-input mono${totalOk ? "" : " err"}`} value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" autoComplete="off" />
            <span className={`vz-help${totalOk ? "" : " err"}`}>{totalOk ? t("viz.mb.totalHelp") : t("viz.mb.badAmount")}</span>
          </div>
          <div className="vz-field">
            <label htmlFor="vz-mb-t">{t("viz.mb.ts")}</label>
            <input id="vz-mb-t" className={`vz-input mono${tsOk ? "" : " err"}`} value={ts} onChange={(e) => setTs(e.target.value)} inputMode="numeric" autoComplete="off" />
            <div className="vz-tl-row">
              <Btn kind="quiet" onClick={() => setTs(String(Date.now()))}>
                {t("viz.mb.now")}
              </Btn>
              <span className={`vz-help${tsOk ? "" : " err"}`}>{tsOk ? fmtTimestamp(tsv!) : t("viz.mb.badTs")}</span>
            </div>
          </div>
        </div>
        <div className="vz-field">
          <label htmlFor="vz-mb-n">{t("viz.mb.nft")}</label>
          <input id="vz-mb-n" className={`vz-input mono${vn.error ? " err" : ""}`} value={nft} onChange={(e) => setNft(e.target.value)} spellCheck={false} autoComplete="off" />
          <div className="vz-tl-row">
            <Btn kind="quiet" onClick={() => setNft(LAB_TRACKER_NFT)}>
              {t("viz.mb.labTracker")}
            </Btn>
            {vn.error ? <span className="vz-help err">{vn.error}</span> : null}
          </div>
        </div>
        {range ? <p className="vz-help err">{t("viz.mb.range")}</p> : null}
        {msg ? (
          <div className="vz-field">
            <div className="vz-field-l">{t("viz.mb.hex")}</div>
            <ByteGrid bytes={msg} segs={segs} label={t("viz.mb.eyebrow")} />
            <ByteLegend segs={segs} values={values} />
            <div className="vz-tl-row">
              <HexBlock hex={toHexStr(msg)} />
              <CopyBtn value={toHexStr(msg)} />
            </div>
          </div>
        ) : (
          <p className="vz-small">{t("viz.mb.incomplete")}</p>
        )}
        <p className="vz-small">{t("viz.tool.runsHere")}</p>
      </div>
    </section>
  );
}

export default MessageBuilder;
