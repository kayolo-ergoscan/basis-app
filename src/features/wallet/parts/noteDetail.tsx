// Note detail (VISUAL §13 right column; P04, P05, P13, P14, S01–S03, M05): the note with both names (foil only
// when the latest total is in a digest), the version ladder, the status ladder, the two signatures with the
// signature X-ray, what is redeemable now and the downloads.
import { useMemo, useRef, useState } from "react";
import { useT } from "@/app/lang";
import { bytesToHex, type NoteRecord } from "@/protocol";
import { Callout, Empty, Key, Lamp, Note, Sheet, Tag, toast, type LampState } from "@/ui";
import { noteHistory, previewRedeem, town, TOWN_TRACKER, useTownView, YOU, type NoteVersionView } from "@/world";
import { SignatureXray, StatusLadder, ladderFromEconomy } from "@/viz";
import { useAfterFirstPaint, useFmt, useNameOf, useTg, useWT } from "../lib/hooks";
import { GENDER, rowAmount, toNum, walletModel, type Row } from "../lib/model";
import { noteSvg, saveBlob, saveText, svgToPng } from "../lib/download";
import { Amt, BackHead, PartySeal } from "./bits";

const VLAMP: Record<NoteVersionView["state"], LampState> = { local: "tracked", pending: "committed", confirmed: "live", superseded: "stale", omitted: "alarm" };

interface DetailData {
  row: Row;
  rec: NoteRecord;
  versions: NoteVersionView[];
  sigA: string;
  sigOk: boolean;
  sigT: string | null;
  sigTSource: "handed-out" | "preview" | null;
  lastCommit: number | null;
  digest: string | null;
  height: number;
  ladder: ReturnType<typeof ladderFromEconomy>;
  redeem: ReturnType<typeof previewRedeem> | null;
  trackerNft: string;
  silent: boolean;
}

function useDetail(noteKey: string): DetailData | null {
  return useTownView(
    (eco) => {
      const m = walletModel(eco, "erg");
      const row = m.rows.find((r) => r.key === noteKey);
      if (!row) return null;
      const rec = eco.note(row.issuer, row.receiver, row.denom, TOWN_TRACKER);
      if (!rec) return null;
      const sigs = eco.signatures(rec, { includeTracker: true });
      const t = eco.t(TOWN_TRACKER);
      const box = t.currentBox();
      return {
        row,
        rec,
        versions: noteHistory(eco, row.issuer, row.receiver, row.denom, TOWN_TRACKER),
        sigA: bytesToHex(sigs.issuerSig),
        sigOk: sigs.issuerSigOk,
        sigT: sigs.trackerSig ? bytesToHex(sigs.trackerSig) : null,
        sigTSource: sigs.trackerSigSource,
        lastCommit: box?.creationHeight ?? null,
        digest: box?.digest ?? null,
        height: eco.clock.height,
        ladder: ladderFromEconomy(eco, rec),
        redeem: row.dir === "in" ? previewRedeem(eco, { issuer: row.issuer, denom: row.denom }) : null,
        trackerNft: t.nftId,
        silent: m.tracker.silent,
      };
    },
    [noteKey],
  );
}

function useTimeFmt() {
  const t = useT();
  return (iso: string) => {
    const d = new Date(iso);
    const loc = t.lang === "ru" ? "ru-RU" : "en-GB";
    return new Intl.DateTimeFormat(loc, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(d);
  };
}

export function NoteDetail({ noteKey, page }: { noteKey: string; page?: boolean }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const tg = useTg();
  const nameOf = useNameOf();
  const time = useTimeFmt();
  const d = useDetail(noteKey);
  const [xray, setXray] = useState<null | "issuer" | "tracker">(null);
  const wrap = useRef<HTMLDivElement>(null);
  const faceReady = useAfterFirstPaint(2);
  const xr = useMemo(() => (xray && d && town.economy ? town.economy.xray(d.rec, { who: xray }) : null), [xray, d]);
  if (!d)
    return (
      <div className="wl-panel">
        {page && <BackHead title={t("wallet.nd.title")} />}
        <Empty title={t("wallet.nd.missing.t")} text={t("wallet.nd.missing.b")} action={{ label: t("wallet.nd.missing.key"), to: "/wallet" }} />
      </div>
    );
  const { row: r, versions } = d;
  const latest = versions[versions.length - 1];
  const prev = versions.length > 1 ? versions[versions.length - 2] : null;
  const inDigest = !!latest && (latest.state === "pending" || latest.state === "confirmed");
  const state = r.omitted ? "tracked" : inDigest ? (d.silent ? "stale" : "committed") : "tracked";
  const issuer = nameOf(r.issuer);
  const receiver = nameOf(r.receiver);
  const other = nameOf(r.other);
  const unitInfo = { symbol: r.unit.symbol, decimals: r.unit.decimals };
  const head = r.dir === "in" ? tg("wallet.nd.headIn", GENDER[r.other], { name: other }) : r.dir === "out" ? t("wallet.nd.headOut", { name: other }) : t("wallet.nd.headSelf");
  const limit = r.line ? toNum(r.line.limit, r.unit.decimals) : 0;

  const fileBase = `basis-note-${issuer}-${receiver}-${r.key.slice(0, 8)}`.replace(/[^\p{L}\p{N}._-]+/gu, "-");
  const face = () => ({
    issuer,
    receiver,
    owes: t("ui.note.owes"),
    amount: f.amt(r.total, r.unit, { reveal: true }),
    unit: r.unit.symbol,
    caption: t("ui.note.caption"),
    brandSub: t("ui.note.brandSub"),
    serial: r.key.slice(0, 10).toUpperCase(),
    signedLine: `${t("ui.note.signed")} · ${issuer}`,
    signedSub: `sig ${d.sigA.slice(0, 6)}…${d.sigA.slice(-4)}`,
    witnessedLine: `${t("ui.note.witnessed")} · ${TOWN_TRACKER}`,
    witnessedSub: d.sigT ? `sig ${d.sigT.slice(0, 6)}…${d.sigT.slice(-4)}` : "—",
    foilText: `${TOWN_TRACKER} · DIGEST ${(d.digest ?? "").slice(0, 4).toUpperCase()}…${(d.digest ?? "").slice(-2).toUpperCase()} · BLK ${d.lastCommit ?? "—"}`,
    committed: state === "committed",
    sandbox: t("wallet.nd.dl.sandbox"),
  });
  const download = async (kind: "svg" | "png" | "json") => {
    if (kind === "json") {
      const json = {
        format: "basis-note/1",
        sandbox: true,
        issuer: { name: issuer, pub: town.economy?.p(r.issuer).pub },
        receiver: { name: receiver, pub: town.economy?.p(r.receiver).pub },
        denom: r.denom,
        key: r.key,
        totalDebt: r.total.toString(),
        timestamp: latest?.timestamp.toString(),
        trackerNftId: d.trackerNft,
        message: latest?.messageHex,
        issuerSignature: d.sigA,
        trackerSignature: d.sigTSource === "handed-out" ? d.sigT : null,
      };
      saveText(JSON.stringify(json, null, 2), `${fileBase}.json`);
      return;
    }
    const el = wrap.current?.querySelector<HTMLElement>(".note");
    if (!el) return;
    const svg = await noteSvg(el, face());
    if (kind === "svg") return saveBlob(new Blob([svg], { type: "image/svg+xml" }), `${fileBase}.svg`);
    const png = await svgToPng(svg);
    if (png) saveBlob(png, `${fileBase}.png`);
    else toast({ kind: "alarm", title: t("wallet.nd.dl.failed"), ttl: 5000 });
  };

  const rd = d.redeem;
  return (
    <article className="wl-panel wl-nd" aria-labelledby="wl-nd-h">
      {page ? (
        <BackHead title={head} sub={t("wallet.nd.sub", { n: versions.length })} />
      ) : (
        <div className="wl-panel-h">
          <div className="who-line">
            <PartySeal id={r.other} size="md" />
            <div>
              <h2 className="t-h4" id="wl-nd-h">
                {head}
              </h2>
              <div className="t-small">{f.prose(t("wallet.nd.sub", { n: versions.length }))}</div>
            </div>
          </div>
          <Tag tone={r.omitted ? "warn" : inDigest ? "ok" : "plain"} glyph={<Lamp state={r.lamp} size={7} />}>
            {wt(`world.note.status.${r.omitted ? "omitted" : latest?.state ?? "local"}`)}
          </Tag>
        </div>
      )}
      {page && (
        <h2 className="sr-only" id="wl-nd-h">
          {head}
        </h2>
      )}

      <div className="wl-nd-note" ref={wrap}>
        {!faceReady ? (
          <div className="note wl-note-ph" aria-hidden="true" />
        ) : (
        <Note
          issuer={issuer}
          receiver={receiver}
          issuerPk={town.economy?.p(r.issuer).pub}
          receiverPk={town.economy?.p(r.receiver).pub}
          noteKey={r.key}
          amount={toNum(r.total, r.unit.decimals)}
          unit={r.unit.symbol}
          dp={f.dpOf(r.unit)}
          prev={prev ? toNum(prev.totalDebt, r.unit.decimals) : null}
          limit={limit}
          settled={toNum(r.redeemed, r.unit.decimals)}
          state={state}
          tracker={TOWN_TRACKER}
          trackerId={TOWN_TRACKER}
          digest={d.digest ?? undefined}
          block={d.lastCommit ?? undefined}
          sigA={d.sigA}
          sigT={d.sigT ?? undefined}
          live
          odometer
          loupe
        />
        )}
        {!inDigest && !r.omitted && <p className="t-small wl-nd-cap">◐ {t("wallet.nd.notInDigest", { id: TOWN_TRACKER, n: 5 })}</p>}
        {r.omitted && (
          <Callout tone="alarm" title={t("wallet.nd.omitted.t")}>
            {t("wallet.nd.omitted.b", { id: TOWN_TRACKER })}
          </Callout>
        )}
      </div>

      <div className="wl-nd-fig">
        <div>
          <span className="label">{t("wallet.nd.total")}</span>
          <Amt v={r.total} u={r.unit} unit className="v" />
        </div>
        <div>
          <span className="label">{t("wallet.nd.redeemed")}</span>
          <Amt v={r.redeemed} u={r.unit} className="v" />
        </div>
        <div>
          <span className="label">{t(r.dir === "in" ? "wallet.nd.claim" : "wallet.nd.outstanding")}</span>
          <Amt v={rowAmount(r)} u={r.unit} sign={r.dir === "in" ? "favour" : r.dir === "out" ? "owe" : "none"} tone={r.dir === "in" ? "up" : undefined} className="v" />
        </div>
      </div>

      {/* versions: every total with time, digest and block */}
      <section aria-labelledby="wl-nd-v">
        <div className="spread wl-sec-h">
          <h3 className="label" id="wl-nd-v">
            <b>{t("wallet.nd.versions")}</b>
          </h3>
          <span className="label">{t("wallet.nd.onlyGrows")}</span>
        </div>
        <ol className="wl-vers">
          {versions
            .slice()
            .reverse()
            .map((v) => (
              <li key={v.index} className={v.latest ? "latest" : v.state}>
                <Lamp state={VLAMP[v.state]} size={8} />
                <span className="wl-v-main">
                  <span className="num wl-v-total">{f.amt(v.totalDebt, r.unit)}</span>
                  <span className={`num wl-v-add${r.dir === "in" && v.index > 0 ? " up" : ""}`}>
                    {v.index === 0 ? t("wallet.nd.vOpen") : r.dir === "in" ? f.amt(v.amount, r.unit, { sign: "favour" }) : f.prose(t("wallet.nd.vRaise", { amt: f.amt(v.amount, r.unit) }))}
                  </span>
                </span>
                <span className="wl-v-meta mono">
                  {time(v.timeIso)}
                  {v.committed ? ` · ${v.committed.digest.slice(0, 4)}…${v.committed.digest.slice(-2)} · ${t("wallet.nd.blk", { h: f.height(v.committed.height) })}` : ` · ${t("wallet.nd.vNoDigest")}`}
                  {v.memo ? (t.lang === "ru" ? ` · «${v.memo}»` : ` · “${v.memo}”`) : ""}
                </span>
                <span className="wl-v-state t-small">{wt(`world.note.status.${v.state}`)}</span>
              </li>
            ))}
        </ol>
      </section>

      {/* the viz ladder speaks for the holder; on a note you owe the holder is the other side, so the wallet says it */}
      <StatusLadder {...d.ladder} unit={unitInfo} compact title={t("wallet.nd.ladder")} className={r.dir === "out" ? "wl-ladder-out" : undefined} />
      {r.dir === "out" && d.ladder.status === "confirmed" && (d.ladder.redeemable ?? 0n) > 0n && (
        <p className="t-small wl-ladder-cap">{f.prose(t("wallet.nd.theyCanRedeem", { name: other, v: f.amt(d.ladder.redeemable ?? 0n, r.unit, { unit: true }) }))}</p>
      )}

      {/* signatures */}
      <section aria-labelledby="wl-nd-s" className="wl-sigs">
        <h3 className="label" id="wl-nd-s">
          <b>{t("wallet.nd.sigs")}</b>
        </h3>
        <div className="wl-sig">
          <Lamp state={d.sigOk ? "live" : "alarm"} size={8} />
          <div className="wl-sig-t">
            <b>{t("wallet.nd.sigA", { name: issuer })}</b>
            <span className="mono">
              sig {d.sigA.slice(0, 4)}…{d.sigA.slice(-3)} · 65 B · {d.sigOk ? t("wallet.nd.verified") : t("wallet.nd.bad")}
            </span>
          </div>
          <Key size="sm" variant="quiet" onClick={() => setXray("issuer")}>
            {t("wallet.nd.xray")}
          </Key>
        </div>
        <div className="wl-sig">
          <Lamp state={d.sigT ? "live" : "tracked"} size={8} />
          <div className="wl-sig-t">
            <b>{t("wallet.nd.sigT", { id: TOWN_TRACKER })}</b>
            <span className="mono">
              {d.sigT ? `sig ${d.sigT.slice(0, 4)}…${d.sigT.slice(-3)} · ` : ""}
              {t(d.sigTSource === "handed-out" ? "wallet.nd.sigT.handed" : "wallet.nd.sigT.preview")}
            </span>
          </div>
          {d.sigT && (
            <Key size="sm" variant="quiet" onClick={() => setXray("tracker")}>
              {t("wallet.nd.xray")}
            </Key>
          )}
        </div>
      </section>

      {/* what you can do with it */}
      {r.dir === "in" && rd && (
        <section className="wl-nd-act" aria-labelledby="wl-nd-r">
          <div className="spread">
            <h3 className="label" id="wl-nd-r">
              <b>{t("wallet.nd.redeemable")}</b>
            </h3>
            <span className="label">{wt(`world.redeem.path.${rd.path}`)}</span>
          </div>
          <div className="wl-nd-r">
            <Amt v={rd.canRedeemNow ? rd.maxAmount : 0n} u={r.unit} unit className="t-money" tone={rd.canRedeemNow ? "metal" : "dim"} />
            <Key size="sm" to={`/wallet/redeem?from=${r.issuer}&denom=${encodeURIComponent(r.denom)}`} icon="redeem" disabled={!rd.canRedeemNow}>
              {t("wallet.nd.redeem")}
            </Key>
          </div>
          {rd.blockers.length > 0 && (
            <ul className="wl-why">
              {rd.blockers.map((b) => (
                <li key={b} className="t-small">
                  {f.prose(wt(`world.redeem.blocker.${b}`, { n: rd.etaBlocks ?? 0, h: rd.emergencyOpensAt ?? 0 }))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {r.dir === "out" && (
        <section className="wl-nd-act" aria-label={t("wallet.nd.raise")}>
          <p className="t-small">{f.prose(t("wallet.nd.outHint", { name: other, v: f.amt(r.outstanding, r.unit, { unit: true }) }))}</p>
          <Key size="sm" variant="primary" icon="pay" to={`/wallet/pay?to=${r.receiver}&denom=${encodeURIComponent(r.denom)}`}>
            {t("wallet.nd.raise")}
          </Key>
        </section>
      )}

      <section className="wl-dl-row" aria-label={t("wallet.nd.dl.aria")}>
        <span className="label">{t("wallet.nd.dl.label")}</span>
        <Key size="sm" variant="quiet" onClick={() => void download("svg")}>
          SVG
        </Key>
        <Key size="sm" variant="quiet" onClick={() => void download("png")}>
          PNG
        </Key>
        <Key size="sm" variant="quiet" onClick={() => void download("json")}>
          {t("wallet.nd.dl.json")}
        </Key>
      </section>

      <Sheet open={!!xray} onClose={() => setXray(null)} title={t(xray === "tracker" ? "wallet.nd.xrayT" : "wallet.nd.xrayA", { name: issuer, id: TOWN_TRACKER })} sub={t("wallet.nd.xraySub")} width={760}>
        {xr && <SignatureXray xray={xr} signer={xray ?? "issuer"} unit={unitInfo} />}
      </Sheet>
    </article>
  );
}

/** You (in the URL as "you") never appear as the other side; used for links from other features. */
export const youId = YOU;
