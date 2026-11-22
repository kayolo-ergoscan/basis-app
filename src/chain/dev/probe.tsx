// Dev-only page (not a route, not built): /src/chain/dev/probe.html on the dev server. Shows what the chain hooks return
// with live /v1 data, so the data layer can be screenshotted and checked before the Network page uses it.
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import "@/ui/fonts";
import "@/ui/tokens.css";
import "@/ui/base.css";
import "@/ui/components.css";
import "@/app/theme";
import { useT } from "@/app/lang";
import { Hex, Lamp, Num, Tag, type LampState, type TagTone } from "@/ui/components/primitives";
import { useBox, useChainStatus, useDetector, useHeight, useObservatory, useReserve, useTracker } from "../hooks";
import { fmtInt, formatUnits, shortHex } from "../decode";
import { chain } from "../store";
import type { ExitClass, TrackerStatus } from "../types";

const LAMP: Record<TrackerStatus, LampState> = { live: "live", stale: "stale", burned: "off", locked: "off", unused: "signed" };
const TONE: Record<ExitClass, TagTone> = { locked: "under", refund: "watch", "refund+redeem": "ok", "redeem-if-tracker": "warn", redeem: "ok", "refund+redeem-if-tracker": "watch", "redeem-checking": "plain", "refund+redeem-checking": "watch" };
const FOCUS_TRACKER = "34dd2a13c19a711f64f9259992adb13bf9c33424945c07b070b95744774d0319";

function Probe() {
  const t = useT();
  const obs = useObservatory();
  const status = useChainStatus();
  const height = useHeight();
  const det = useDetector();
  const sampleId = obs?.reserves.find((r) => r.id.startsWith("3857cf9f"))?.id ?? null;   // the first reserve (W52, 2025-10-22)
  const box = useBox(sampleId);
  const focus = useReserve(obs?.unspent.find((r) => r.exit?.class === "refund+redeem")?.id);
  const tracker = useTracker(FOCUS_TRACKER);
  if (!obs) return <div className="container" style={{ paddingTop: 48 }}><p className="dim">{t("chain.box.loading")}</p></div>;
  const tot = obs.totals;
  const use = tot.unspentTokens;
  const log = chain.api.log().slice(-8).reverse();
  const ru = t.lang === "ru";
  const L = ru
    ? { exit: "Выход", boxes: "Боксы", status: "Состояние", lastBox: "Последний бокс", silent: "Молчит", source: "Источник", type: "Тип", value: "Значение", path: "Путь", lane: "Полоса", code: "Код", bytes: "Байт" }
    : { exit: "Exit", boxes: "Boxes", status: "Status", lastBox: "Last box", silent: "Silent", source: "Source", type: "Type", value: "Value", path: "Path", lane: "Lane", code: "Status", bytes: "Bytes" };
  return (
    <div className="container" style={{ paddingTop: 32, paddingBottom: 64, display: "grid", gap: 20 }}>
      <header style={{ display: "grid", gap: 6 }}>
        <span className="label">src/chain · dev</span>
        <h1 className="t-h2" style={{ margin: 0 }}>{ru ? "Проверка данных сети" : "Chain data probe"}</h1>
        <p className="dim" style={{ margin: 0 }}>
          {t("chain.asOf", { height: fmtInt(obs.asOf.height) })} · {height.height ? `${ru ? "блокчейн" : "chain"} ${fmtInt(height.height)}` : "…"} ·{" "}
          {status.hidden ? t("chain.live.paused") : t("chain.live.watching", { used: status.budget.usedThisBlock, max: status.budget.perBlock })} ·{" "}
          {t.p("chain.live.changes", status.changes)}
          {status.lastError ? ` · ${status.lastError}` : ""}
        </p>
      </header>

      <section className="card">
        <div className="card-h"><b>{ru ? "Итоги" : "Totals"}</b><span className="label">{t("chain.testUse", { boxes: tot.reserveBoxes, erg: formatUnits(tot.unspentNano, 9) })}</span></div>
        <div className="card-b" style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 24px" }}>
            <span>{ru ? "Непотрачено" : "Unspent"} <b className="num">{tot.unspent}</b> / {tot.reserveBoxes}</span>
            <span><Num value={tot.unspentNano} decimals={9} dp={3} unit="ERG" reveal /></span>
            {use.map((x) => <span key={x.id}><Num value={x.amount} decimals={x.decimals} dp={1} unit={x.kind === "use" ? "USE" : "“USE”"} reveal /> <span className="dim">{x.kind === "use-lookalike" ? (ru ? "двойник" : "look-alike") : ""}</span></span>)}
            <span>{ru ? "Погашений" : "Redemptions"} <b className="num">{tot.redemptions}</b></span>
            <span>{ru ? "Трекеров" : "Tracker NFTs"} <b className="num">{tot.trackerNfts}</b></span>
          </div>
          <div className="tbl-wrap">
            <table className="tbl stacked">
              <thead><tr><th>{L.exit}</th><th className="r">{L.boxes}</th><th className="r">ERG</th></tr></thead>
              <tbody>
                {(Object.keys(tot.exit) as ExitClass[]).filter((c) => tot.exit[c].boxes).map((c) => (
                  <tr key={c}><td className="lead"><Tag tone={TONE[c]} title={t(`chain.exit.${c}`)}>{t(`chain.exit.${c}.short`)}</Tag></td><td className="r num" data-label={L.boxes}>{tot.exit[c].boxes}</td><td className="r" data-label="ERG"><Num value={tot.exit[c].nano} decimals={9} dp={3} reveal /></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><b>{ru ? "Трекеры" : "Trackers"}</b><span className="label">{t("chain.tracker.honest")}</span></div>
        <div className="card-b tbl-wrap">
          <table className="tbl stacked">
            <thead><tr><th>NFT</th><th>{L.status}</th><th className="r">{L.lastBox}</th><th className="r">{L.silent}</th><th>{L.source}</th></tr></thead>
            <tbody>
              {obs.trackers.map((x) => (
                <tr key={x.nft}>
                  <td className="lead"><Hex value={x.nft} /> <span className="dim">{x.name ?? ""}</span></td>
                  <td data-label={L.status}><span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Lamp state={LAMP[x.status]} />{t(`chain.tracker.${x.status}`)}</span></td>
                  <td className="r num" data-label={L.lastBox}>{x.lastTrackerBox ? fmtInt(x.lastTrackerBox.height) : "—"}</td>
                  <td className="r num" data-label={L.silent}>{x.silentBlocks !== null ? `${fmtInt(x.silentBlocks)} blk` : "—"}</td>
                  <td className="dim" data-label={L.source}>{t(`chain.live.source.${x.source}`)}{x.checkedAt ? (ru ? " · проверен" : " · checked") : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><b>{ru ? "Детектор" : "Detector"}</b><span className="label">{det.found.length ? t.p("chain.detector.found", det.found.length) : t("chain.detector.none")}</span></div>
        <div className="card-b" style={{ display: "grid", gap: 8 }}>
          {det.templates.map((x) => (
            <div key={x.hash} style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px" }}>
              <b>{x.short}</b><Hex value={x.hash} /><span className="dim">{ru ? "боксов" : "boxes"} {x.total ?? "—"} · {t("chain.live.checked", { height: x.checkedHeight ? fmtInt(x.checkedHeight) : "—" })}</span>
            </div>
          ))}
          <div className="dim">{t("chain.hostIndex", { listed: obs.hostIndex.listedKnown, total: obs.hostIndex.unspentHere })} ({t(`chain.live.source.${obs.hostIndex.source}`)})</div>
        </div>
      </section>

      {focus.reserve && focus.reserve.exit && (
        <section className="card">
          <div className="card-h"><b>{ru ? "Резерв" : "Reserve"} <Hex value={focus.reserve.id} /></b><Tag tone={TONE[focus.reserve.exit.class]} title={t(`chain.exit.${focus.reserve.exit.class}`)}>{t(`chain.exit.${focus.reserve.exit.class}.short`)}</Tag></div>
          <div className="card-b" style={{ display: "grid", gap: 8 }}>
            <p style={{ margin: 0 }}>{focus.reserve.exit.line[t.lang]}</p>
            <p className="dim" style={{ margin: 0 }}>
              {focus.reserve.contract?.short} · {focus.reserve.collateral ? <Num value={focus.reserve.collateral.amount} decimals={focus.reserve.collateral.decimals} dp={1} unit="USE" reveal /> : null} ·{" "}
              {ru ? "линия" : "lineage"} {focus.lineage.length} · {focus.reserve.checked ? t("chain.live.checked", { height: fmtInt(focus.reserve.checked.height ?? 0) }) : t("chain.live.seedOnly")}
            </p>
            {tracker.tracker && <p className="dim" style={{ margin: 0 }}>{ru ? "Трекер" : "Tracker"} {shortHex(tracker.tracker.nft)}: {t(`chain.tracker.${tracker.tracker.status}.help`)}</p>}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-h"><b>{ru ? "Разбор бокса" : "Decode a box"}</b>{sampleId && <Hex value={sampleId} />}</div>
        <div className="card-b" style={{ display: "grid", gap: 8 }}>
          {box.state === "loading" && <p className="dim" style={{ margin: 0 }}>{t("chain.box.loading")}</p>}
          {box.state === "missing" && <p style={{ margin: 0 }}>{t("chain.box.notFound")}</p>}
          {box.state === "error" && <p style={{ margin: 0 }}>{t("chain.box.error", { error: box.error ?? "" })}</p>}
          {box.box && (
            <>
              <p style={{ margin: 0 }}>
                {t(`chain.box.role.${box.box.role}`)} · {box.box.contract ? t("chain.box.templateMatch", { contract: box.box.contract.short }) : t("chain.box.templateUnknown")} ·{" "}
                <Num value={box.box.value} decimals={9} dp={2} unit="ERG" reveal />
              </p>
              <div className="tbl-wrap">
                <table className="tbl stacked">
                  <thead><tr><th>Reg</th><th>{L.type}</th><th>{L.value}</th></tr></thead>
                  <tbody>
                    {box.box.registers.map((r) => (
                      <tr key={r.name}><td className="lead mono">{r.name}</td><td className="mono" data-label={L.type}>{r.decoded.type}</td><td className="mono" data-label={L.value} style={{ wordBreak: "break-all" }}>{/^[0-9a-f]{40,}$/.test(r.decoded.display) ? shortHex(r.decoded.display, 12) : r.decoded.display}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="dim mono" style={{ margin: 0, overflowWrap: "anywhere" }}>
                header {box.box.tree?.header} · v{box.box.tree?.version} · {box.box.tree?.constants.length} const · template {shortHex(box.box.templateHash)} · {box.box.addressMatches ? "P2S ✓" : "P2S ✗"}
                {box.box.owner ? ` · owner ${shortHex(box.box.owner.addr, 6)}` : ""}
              </p>
            </>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-h"><b>{ru ? "Запросы" : "Requests"}</b><span className="label">{status.budget.requests} · avg {status.budget.avgLatencyMs ?? "—"} ms</span></div>
        <div className="card-b tbl-wrap">
          <table className="tbl stacked">
            <thead><tr><th>{L.path}</th><th>{L.lane}</th><th className="r">{L.code}</th><th className="r">ms</th><th className="r">{L.bytes}</th></tr></thead>
            <tbody>
              {log.map((x, i) => (
                <tr key={i}>
                  <td className="lead mono" style={{ overflowWrap: "anywhere" }}>{x.path.replace(/[0-9a-f]{64}/g, (h) => shortHex(h))}</td>
                  <td data-label={L.lane}>{x.lane}</td><td className="r num" data-label={L.code}>{x.status}</td><td className="r num" data-label="ms">{x.ms}</td><td className="r num" data-label={L.bytes}>{x.bytes ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// one root per container, also when HMR runs this module again in the same document
const el = document.getElementById("root") as HTMLElement & { __probeRoot?: Root };
(el.__probeRoot ??= createRoot(el)).render(<React.StrictMode><Probe /></React.StrictMode>);
