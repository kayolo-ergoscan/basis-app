// TxLens: one reserve transaction (redeem, top up, exit, create, clearing) as boxes. Inputs (the reserve and the
// fee payer's wallet), the tracker box as data input (NFT, R4 key, R5 digest, creation height → age), outputs with
// decoded R4–R7 and tokens, the context variables in the order the transaction serialises them, who signs, the
// 0.001 ERG miner fee and who pays it, and a value-flow strip. Story face = sentences, Machine face = bytes.

import { useMemo, type ReactNode } from "react";
import {
  basisAvlRegister,
  deriveId,
  EMERGENCY_BLOCKS,
  encodeCollByte,
  encodeGroupElement,
  encodeLong,
  MINER_FEE_NANOERG,
  type EconomyEvent,
  type Hex,
  type ReserveEval,
  type ReserveSim,
  type SimBox,
  type SimTx,
} from "@/protocol";
import { ERG_UNIT, fmtAmount, fmtBlocksTime, fmtInt, fmtRaw, fmtTimestamp, shortHex, type UnitInfo } from "../core/format";
import { maybe, useVizLang, useVizT, type TFn } from "../core/lang";
import { CheckLamp, FaceToggle, HexBlock, Tag, useFace, type Face } from "../core/primitives";
import { extensionHex, extensionRows, type ExtensionRow } from "./contextVars";
import "../core/core.css";
import "./tx.css";

export type TxKind = "redeem" | "top-up" | "refund-init" | "refund-complete" | "create" | "clearing" | "other";

export interface TxLensProps {
  tx: SimTx;
  kind?: TxKind;
  evaluation?: ReserveEval | null;
  /** The event the transaction produced (reserve.redeemed / toppedUp / …): fee payer and fee. */
  event?: EconomyEvent | null;
  /** Public key (or participant id) → display name. */
  nameOf?: (pubOrId: string) => string | undefined;
  /** Unit of the reserve's denomination (token reserves); ERG values always use ERG. */
  unit?: UnitInfo;
  face?: Face;
  /** The transaction was rebuilt from an event (create): say so. */
  synthesized?: boolean;
  title?: ReactNode;
  className?: string;
}

const isReserve = (b: SimBox) => b.script === "basis.es" || b.script === "basis-token.es";

/** Reserve input index (first input under basis.es / basis-token.es), or −1. */
export function reserveInputIndex(tx: SimTx): number {
  return tx.inputs.findIndex(isReserve);
}

export function txKindOf(tx: SimTx): TxKind {
  const rIn = tx.inputs.filter(isReserve).length;
  if (rIn > 1) return "clearing";
  if (rIn === 0) return tx.outputs.some(isReserve) ? "create" : "other";
  const v = tx.contextVars[reserveInputIndex(tx)]?.[0];
  const a = v && v.type === "Byte" ? Math.trunc(v.value / 10) : -1;
  return a === 0 ? "redeem" : a === 1 ? "top-up" : a === 2 ? "refund-init" : a === 3 ? "refund-complete" : "other";
}

/** A creation transaction rebuilt from a reserve's first history entry (the engine records no create tx). */
export function synthCreateTx(r: ReserveSim, fee: bigint = MINER_FEE_NANOERG): SimTx {
  const h = r.history[0];
  const token = r.contract === "basis-token";
  const reserveBox: SimBox = {
    boxId: h.boxId,
    script: token ? "basis-token.es" : "basis.es",
    value: h.value,
    tokens: token ? [{ tokenId: r.reserveNftId!, amount: 1n }, { tokenId: r.tokenId!, amount: h.tokenAmount }] : [],
    registers: { R4: { type: "GroupElement", value: r.owner }, R5: { type: "AvlTree", digest: h.digest }, R6: { type: "Coll[Byte]", value: r.trackerNftId } },
    creationHeight: h.height,
  };
  const wallet: SimBox = { boxId: deriveId("box", h.txId, "wallet"), script: `p2pk:${r.owner}`, value: h.value + fee, tokens: token ? [{ tokenId: r.tokenId!, amount: h.tokenAmount }] : [], registers: {}, creationHeight: Math.max(0, h.height - 1) };
  const feeBox: SimBox = { boxId: deriveId("box", h.txId, "fee"), script: "miner-fee", value: fee, tokens: [], registers: {}, creationHeight: h.height };
  return { id: h.txId, inputs: [wallet], dataInputs: [], outputs: [reserveBox, feeBox], contextVars: {}, signers: [r.owner], height: h.height };
}

function sumValue(bs: readonly SimBox[]): bigint {
  return bs.reduce((s, b) => s + b.value, 0n);
}

interface Names {
  key(pub: Hex | undefined): string;
  id(id: string | undefined): string;
}

function useNames(t: TFn, nameOf?: (s: string) => string | undefined): Names {
  return {
    key: (pub) => (pub ? nameOf?.(pub) ?? t("viz.tx.unknownKey", { k: shortHex(pub) }) : t("viz.tx.someone")),
    id: (id) => (id ? nameOf?.(id) ?? id : t("viz.tx.someone")),
  };
}

type Role = "reserve" | "reserveOut" | "tracker" | "receiver" | "wallet" | "fee" | "payer" | "other";

function roleOf(b: SimBox, side: "in" | "out" | "data", receiverPub: Hex | null): Role {
  if (side === "data") return b.script === "tracker" ? "tracker" : "other";
  if (isReserve(b)) return side === "in" ? "reserve" : "reserveOut";
  if (b.script === "miner-fee") return "fee";
  if (b.script.startsWith("p2pk:")) return receiverPub && b.script === `p2pk:${receiverPub}` && side === "out" ? "receiver" : "wallet";
  return "other";
}

function RegisterRows({ box, kind, face, names, t, lang }: { box: SimBox; kind: "reserve" | "tracker" | "other"; face: Face; names: Names; t: TFn; lang: "en" | "ru" }) {
  const regs = (["R4", "R5", "R6", "R7", "R8", "R9"] as const).filter((r) => box.registers[r]);
  if (!regs.length) return null;
  return (
    <dl className="vz-tx-regs">
      {regs.map((r) => {
        const v = box.registers[r]!;
        const label = kind === "other" ? `${t("viz.tx.reg.other")} ${r}` : maybe(lang, `viz.tx.reg.${r}.${kind}`) ?? t("viz.tx.reg.other");
        let story: ReactNode;
        let machine = "";
        switch (v.type) {
          case "GroupElement":
            story = <>{names.key(v.value)} <code>{shortHex(v.value)}</code></>;
            machine = encodeGroupElement(v.value);
            break;
          case "Coll[Byte]":
            story = <code>{shortHex(v.value, 8, 4)}</code>;
            machine = encodeCollByte(v.value);
            break;
          case "Long":
            story = <span className="num">{fmtInt(v.value)}</span>;
            machine = encodeLong(v.value);
            break;
          case "AvlTree":
            story = <code>{shortHex(v.digest, 8, 4)}</code>;
            machine = basisAvlRegister(v.digest);
            break;
        }
        void lang;
        return (
          <div key={r} className="vz-tx-reg">
            <dt>
              <b>{r}</b> {label}
            </dt>
            <dd>{face === "machine" ? <HexBlock hex={machine} /> : story}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function BoxCard(props: { box: SimBox; role: Role; side: "in" | "out" | "data"; face: Face; names: Names; t: TFn; lang: "en" | "ru"; unit: UnitInfo; txHeight: number; reserveNft?: Hex | null; trackerNft?: Hex | null }) {
  const { box, role, face, names, t, lang, unit } = props;
  const script = box.script.startsWith("p2pk:") ? `P2PK · ${names.key(box.script.slice(5))}` : box.script === "miner-fee" ? t("viz.tx.role.fee") : box.script;
  const tone = role === "reserve" || role === "reserveOut" ? "metal" : role === "tracker" ? "proof" : "plain";
  const age = props.side === "data" ? props.txHeight - box.creationHeight : null;
  return (
    <article className={`vz-tx-box r-${role}`}>
      <header>
        <span className="role">{t(`viz.tx.role.${role}`)}</span>
        <Tag tone={tone as "metal" | "proof" | "plain"}>{script}</Tag>
      </header>
      <div className="val">
        <span className="v num">{face === "machine" ? fmtRaw(box.value, ERG_UNIT) : fmtAmount(box.value, ERG_UNIT)}</span>
        <span className="l">{t("viz.tx.value")}</span>
      </div>
      {box.tokens.length ? (
        <ul className="vz-tx-tokens">
          {box.tokens.map((tk, i) => {
            const what = props.reserveNft && tk.tokenId === props.reserveNft ? t("viz.tx.token.nft") : props.trackerNft && tk.tokenId === props.trackerNft ? t("viz.tx.token.trackerNft") : t("viz.tx.token.unit");
            return (
              <li key={i}>
                <span>{what}</span> <code>{shortHex(tk.tokenId)}</code> <span className="num">{face === "machine" ? fmtInt(tk.amount) : what === t("viz.tx.token.unit") ? fmtAmount(tk.amount, unit) : fmtInt(tk.amount)}</span>
              </li>
            );
          })}
        </ul>
      ) : null}
      <RegisterRows box={box} kind={role === "tracker" ? "tracker" : role === "reserve" || role === "reserveOut" ? "reserve" : "other"} face={face} names={names} t={t} lang={lang} />
      <footer>
        <span>{t("viz.tx.box", { id: shortHex(box.boxId) })}</span>
        <span>{t("viz.tx.created", { h: fmtInt(box.creationHeight) })}</span>
        {age !== null ? (
          <span className={age > EMERGENCY_BLOCKS ? "em" : undefined}>
            {t("viz.tx.age", { age: fmtBlocksTime(age, lang) })} · {age > EMERGENCY_BLOCKS ? t("viz.tx.ageEmergency") : t("viz.tx.ageNormal")}
          </span>
        ) : null}
      </footer>
    </article>
  );
}

function varValue(r: ExtensionRow, t: TFn, names: Names, unit: UnitInfo): ReactNode {
  const v = r.v;
  switch (r.meaning) {
    case "action":
      return v.type === "Byte" ? t("viz.tx.val.action", { a: Math.trunc(v.value / 10), i: v.value % 10 }) : r.value;
    case "receiver":
      return v.type === "GroupElement" ? <>{names.key(v.value)} <code>{shortHex(v.value)}</code></> : r.value;
    case "ownerSig":
      return t("viz.tx.val.sig", { n: r.size });
    case "trackerSig":
      return r.size === 0 ? t("viz.tx.val.empty") : t("viz.tx.val.sig", { n: r.size });
    case "totalDebt":
      return v.type === "Long" ? <span className="num">{fmtAmount(v.value, unit)}</span> : r.value;
    case "timestamp":
      return v.type === "Long" ? fmtTimestamp(v.value) : r.value;
    default:
      return t("viz.tx.val.proof", { n: fmtInt(r.size) });
  }
}

interface FlowSeg {
  role: Role;
  label: string;
  value: bigint;
}

function FlowStrip({ inSegs, outSegs, t, face }: { inSegs: FlowSeg[]; outSegs: FlowSeg[]; t: TFn; face: Face }) {
  const total = (s: FlowSeg[]) => s.reduce((a, b) => a + b.value, 0n);
  const max = total(inSegs) > total(outSegs) ? total(inSegs) : total(outSegs);
  const bar = (segs: FlowSeg[], side: string) => (
    <div className="vz-tx-bar" aria-hidden="true">
      <span className="side">{side}</span>
      <div className="track">
        {segs.map((s, i) => (
          <i key={i} className={`r-${s.role}`} style={{ flexGrow: max > 0n ? Number((s.value * 10000n) / max) / 100 : 1 }} title={`${s.label}: ${fmtAmount(s.value, ERG_UNIT)}`} />
        ))}
      </div>
    </div>
  );
  return (
    <div className="vz-tx-flow">
      {bar(inSegs, t("viz.tx.flowIn"))}
      {bar(outSegs, t("viz.tx.flowOut"))}
      <ul className="vz-tx-flowlegend">
        {[...inSegs.map((s) => ({ ...s, side: "in" })), ...outSegs.map((s) => ({ ...s, side: "out" }))].map((s, i) => (
          <li key={i}>
            <i className={`r-${s.role}`} aria-hidden="true" />
            <span className="l">{s.label}</span>
            <span className="num">{face === "machine" ? fmtRaw(s.value, ERG_UNIT) : fmtAmount(s.value, ERG_UNIT)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TxLens(p: TxLensProps) {
  const t = useVizT();
  const lang = useVizLang();
  const [face, setFace] = useFace("story", p.face);
  const names = useNames(t, p.nameOf);
  const { tx } = p;
  const kind = p.kind ?? txKindOf(tx);
  const unit = p.unit ?? ERG_UNIT;
  const ri = reserveInputIndex(tx);
  const vars = ri >= 0 ? tx.contextVars[ri] : undefined;
  const rows = useMemo(() => extensionRows(vars), [vars]);
  const ext = useMemo(() => (rows.length ? extensionHex(rows) : ""), [rows]);
  const receiverPub = vars?.[1]?.type === "GroupElement" ? vars[1].value : null;
  const reserveIn = ri >= 0 ? tx.inputs[ri] : null;
  const reserveOut = tx.outputs.find(isReserve) ?? null;
  const reserveBox = reserveIn ?? reserveOut;
  const ownerPub = reserveBox?.registers.R4?.type === "GroupElement" ? reserveBox.registers.R4.value : undefined;
  const trackerNft = reserveBox?.registers.R6?.type === "Coll[Byte]" ? reserveBox.registers.R6.value : null;
  const reserveNft = reserveBox?.script === "basis-token.es" ? reserveBox.tokens[0]?.tokenId ?? null : null;
  const ev = p.event;
  const fee = ev && "fee" in ev && typeof ev.fee === "bigint" ? ev.fee : MINER_FEE_NANOERG;

  // who pays the fee and adds value from outside the sandbox transaction
  const extra = sumValue(tx.outputs) - sumValue(tx.inputs);
  const payerName = (() => {
    if (ev?.type === "reserve.redeemed") return names.id(ev.feePayer);
    if (ev?.type === "reserve.toppedUp") return names.id(ev.by);
    if (kind === "redeem") {
      const other = tx.signers.find((s) => s !== receiverPub);
      return names.key(other ?? receiverPub ?? undefined);
    }
    if (kind === "top-up") return names.key(tx.signers[0]);
    return names.key(ownerPub);
  })();

  const story = (() => {
    const owner = names.key(ownerPub);
    switch (kind) {
      case "redeem": {
        const amount = reserveIn && reserveOut ? (reserveIn.script === "basis-token.es" ? (reserveIn.tokens[1]?.amount ?? 0n) - (reserveOut.tokens[1]?.amount ?? 0n) : reserveIn.value - reserveOut.value) : 0n;
        const total = vars?.[3]?.type === "Long" ? vars[3].value : 0n;
        const tb = tx.dataInputs[0];
        const done = ev?.type === "reserve.redeemed" ? ev.redeemedTotal : null;
        const emergency = vars?.[6]?.type === "Coll[Byte]" && vars[6].value.length === 0;
        return (
          <>
            <p className="vz-tx-lede">{t("viz.tx.story.redeem", { receiver: names.key(receiverPub ?? undefined), amount: fmtAmount(amount, unit), owner })}</p>
            {tb ? <p className="vz-p">{t("viz.tx.story.redeemMore", { h: fmtInt(tb.creationHeight), total: fmtAmount(total, unit), done: done !== null ? fmtAmount(done, unit) : "…" })}</p> : null}
            {emergency ? <p className="vz-p">{t("viz.tx.story.redeemEmergency")}</p> : null}
          </>
        );
      }
      case "top-up": {
        const amount = reserveIn && reserveOut ? (reserveIn.script === "basis-token.es" ? (reserveOut.tokens[1]?.amount ?? 0n) - (reserveIn.tokens[1]?.amount ?? 0n) : reserveOut.value - reserveIn.value) : 0n;
        return <p className="vz-tx-lede">{t("viz.tx.story.top-up", { payer: payerName, amount: fmtAmount(amount, reserveIn?.script === "basis-token.es" ? unit : ERG_UNIT), owner })}</p>;
      }
      case "refund-init": {
        const r7 = reserveOut?.registers.R7?.type === "Long" ? reserveOut.registers.R7.value : 0n;
        return <p className="vz-tx-lede">{t("viz.tx.story.refund-init", { owner, r7: fmtInt(r7) })}</p>;
      }
      case "refund-complete": {
        const r7 = reserveIn?.registers.R7?.type === "Long" ? reserveIn.registers.R7.value : 0n;
        return <p className="vz-tx-lede">{t("viz.tx.story.refund-complete", { owner, value: fmtAmount(reserveIn?.value ?? 0n, ERG_UNIT), r7: fmtInt(r7) })}</p>;
      }
      case "create":
        return <p className="vz-tx-lede">{t("viz.tx.story.create", { owner, value: fmtAmount(reserveOut?.value ?? 0n, ERG_UNIT), nft: trackerNft ? shortHex(trackerNft) : "?" })}</p>;
      case "clearing":
        return <p className="vz-tx-lede">{t("viz.tx.story.clearing", { n: tx.inputs.filter(isReserve).length })}</p>;
      default:
        return <p className="vz-tx-lede">{t("viz.tx.story.other", { i: tx.inputs.length, o: tx.outputs.length })}</p>;
    }
  })();

  const roleLabel = (b: SimBox, role: Role) => (b.script.startsWith("p2pk:") ? `${t(`viz.tx.role.${role}`)} · ${names.key(b.script.slice(5))}` : t(`viz.tx.role.${role}`));
  const inSegs: FlowSeg[] = tx.inputs.map((b) => {
    const role = roleOf(b, "in", receiverPub);
    return { role, label: roleLabel(b, role), value: b.value };
  });
  if (extra > 0n) inSegs.push({ role: "payer", label: `${t("viz.tx.role.payer")} · ${payerName}`, value: extra });
  const outSegs: FlowSeg[] = tx.outputs.map((b) => {
    const role = roleOf(b, "out", receiverPub);
    return { role, label: roleLabel(b, role), value: b.value };
  });

  const signers = tx.signers.map((s) => names.key(s));
  const evalOk = p.evaluation ? p.evaluation.ok : null;

  return (
    <section className={`vz vz-panel vz-tx${p.className ? " " + p.className : ""}`} aria-label={t("viz.tx.eyebrow")}>
      <header className="vz-head">
        <div className="vz-head-t">
          <div className="vz-eyebrow">
            {t("viz.tx.eyebrow")} · <b>{t(`viz.tx.kind.${kind}`)}</b>
          </div>
          <h3 className="vz-title">{p.title ?? t(`viz.tx.kind.${kind}`).replace(/^./, (c) => c.toUpperCase())}</h3>
          <p className="vz-sub mono">{t("viz.tx.meta", { id: shortHex(tx.id, 8, 6), h: fmtInt(tx.height) })}</p>
        </div>
        <div className="vz-head-a">
          <FaceToggle face={face} onChange={setFace} />
        </div>
      </header>
      <div className="vz-body">
        {face === "story" ? <div className="vz-tx-story">{story}</div> : null}
        {p.synthesized || kind === "create" ? <p className="vz-small">{t("viz.tx.synth")}</p> : null}

        <div className="vz-eyebrow">{t("viz.tx.flow")}</div>
        <FlowStrip inSegs={inSegs} outSegs={outSegs} t={t} face={face} />

        <div className="vz-tx-cols">
          <div className="vz-tx-col">
            <div className="vz-eyebrow">{t("viz.tx.inputs")}</div>
            {tx.inputs.map((b, i) => (
              <BoxCard key={b.boxId + i} box={b} role={roleOf(b, "in", receiverPub)} side="in" face={face} names={names} t={t} lang={lang} unit={unit} txHeight={tx.height} reserveNft={reserveNft} trackerNft={trackerNft} />
            ))}
            {extra > 0n ? (
              <article className="vz-tx-box r-payer virtual">
                <header>
                  <span className="role">{t("viz.tx.role.payer")}</span>
                  <Tag tone="agent">{payerName}</Tag>
                </header>
                <div className="val">
                  <span className="v num">{fmtAmount(extra, ERG_UNIT)}</span>
                </div>
                <p className="vz-small">{t("viz.tx.payerNote", { payer: payerName, value: fmtAmount(extra, ERG_UNIT) })}</p>
              </article>
            ) : null}
          </div>
          <div className="vz-tx-col">
            <div className="vz-eyebrow">{t("viz.tx.dataInputs")}</div>
            {tx.dataInputs.length ? (
              tx.dataInputs.map((b, i) => <BoxCard key={b.boxId + i} box={b} role={roleOf(b, "data", receiverPub)} side="data" face={face} names={names} t={t} lang={lang} unit={unit} txHeight={tx.height} reserveNft={reserveNft} trackerNft={trackerNft} />)
            ) : (
              <p className="vz-small">{t("viz.tx.noDataInputs")}</p>
            )}
          </div>
          <div className="vz-tx-col">
            <div className="vz-eyebrow">{t("viz.tx.outputs")}</div>
            {tx.outputs.map((b, i) => (
              <BoxCard key={b.boxId + i} box={b} role={roleOf(b, "out", receiverPub)} side="out" face={face} names={names} t={t} lang={lang} unit={unit} txHeight={tx.height} reserveNft={reserveNft} trackerNft={trackerNft} />
            ))}
          </div>
        </div>

        {rows.length > 1 || kind === "redeem" ? (
          <div className="vz-tx-ctx">
            <div className="vz-eyebrow">{t("viz.tx.ctx")}</div>
            <p className="vz-small">{t("viz.tx.ctxSub")}</p>
            <table className="vz-tx-vars">
              <thead>
                <tr>
                  <th>{t("viz.tx.col.id")}</th>
                  <th className="col-type">{t("viz.tx.col.type")}</th>
                  <th>{t("viz.tx.col.meaning")}</th>
                  <th>{face === "machine" ? t("viz.tx.col.wire") : t("viz.tx.col.value")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="id">#{r.id}</td>
                    <td className="col-type">
                      <code>{r.type}</code>
                    </td>
                    <td>{t(`viz.tx.var.${r.meaning}`)}</td>
                    <td className="v">{face === "machine" ? <HexBlock hex={r.wire} max={96} /> : varValue(r, t, names, unit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {face === "machine" && ext ? (
              <div className="vz-field">
                <span className="vz-help">{t("viz.tx.ctxBytes", { n: rows.length, b: fmtInt(ext.length / 2) })}</span>
                <HexBlock hex={ext} max={192} />
              </div>
            ) : null}
          </div>
        ) : rows.length === 1 ? (
          <dl className="vz-kv">
            <dt>#0</dt>
            <dd>{varValue(rows[0], t, names, unit)} · <code>{rows[0].wire}</code></dd>
          </dl>
        ) : null}

        <dl className="vz-kv">
          <dt>{t("viz.tx.signers")}</dt>
          <dd>{signers.length ? signers.join(", ") : t("viz.tx.signersNone")}</dd>
          <dt>{t("viz.tx.fee")}</dt>
          <dd>{kind === "create" ? t("viz.tx.feeLineCreate", { fee: fmtAmount(fee, ERG_UNIT), payer: payerName }) : t("viz.tx.feeLine", { fee: fmtAmount(fee, ERG_UNIT), payer: payerName })}</dd>
        </dl>

        {evalOk !== null ? (
          <div className={`vz-verdict ${evalOk ? "ok" : "bad"}`} role="status">
            <CheckLamp state={evalOk ? "pass" : "fail"} size={14} />
            <div>
              <div className="vz-verdict-t">{evalOk ? t("viz.tx.evalOk") : t("viz.tx.evalBad", { check: p.evaluation?.error ? t(`viz.check.${p.evaluation.error.check}`) : "?" })}</div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default TxLens;
