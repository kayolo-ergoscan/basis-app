// The XL tracker card (VISUAL §12.7, §13 /tracker): who runs it, its state, the last and next commitment, the
// dead-man dial, the heartbeat over 720 blocks, the digest and the honest box. In eclipse (dark, or silent for 720
// blocks) the dial docks into the banner under the header (VISUAL §10.4) and leaves the body. The machine face shows
// the raw registers of the current tracker box: R4 key, R5 digest with its flags, R6 the tracker NFT.
import { useRef } from "react";
import { useT } from "@/app/lang";
import { copy, pick } from "@/content";
import { EMERGENCY_BLOCKS } from "@/protocol";
import {
  blk,
  Bytes,
  CopyButton,
  Dial,
  Digest,
  Faces,
  FaceTabs,
  Honest,
  int,
  Lamp,
  short,
  Tag,
  TrackerTile,
  usePulseClass,
  useIsPhone,
  type LampState,
} from "@/ui";
import type { AvlInfo } from "@/world";
import { Beats } from "./Beats";
import { avlFlags, beatsWindow, registerParts, type Beat, type TrackerView } from "./model";
import { htime, md } from "./parts";
import { useNameOf } from "./townParts";

export interface TrackerXLProps {
  v: TrackerView;
  beats: Beat[];
  genesis: number;
  /** Real milliseconds per sandbox block (null = paused). */
  blockMs: number | null;
  avl: AvlInfo | null;
}

/** "6 s" / "2 min" / "1 h 5 min" for a sandbox wait (real time at the sandbox's speed). */
function fmtWait(ms: number, lang: "en" | "ru"): string {
  const NB = " ";
  const s = Math.max(1, Math.round(ms / 1000));
  const u = lang === "ru" ? { s: "с", m: "мин", h: "ч" } : { s: "s", m: "min", h: "h" };
  if (s < 60) return `${s}${NB}${u.s}`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}${NB}${u.m}`;
  const h = Math.floor(m / 60);
  return `${h}${NB}${u.h}` + (m % 60 ? ` ${m % 60}${NB}${u.m}` : "");
}

export function stateOf(v: TrackerView): { key: string; lamp: LampState } {
  if (!v.online) return { key: "tracker.state.dark", lamp: "off" };
  if (v.censor.mode !== "off") return { key: "tracker.state.censoring", lamp: "alarm" };
  return { key: "tracker.state.online", lamp: "live" };
}

export function TrackerXL({ v, beats, genesis, blockMs, avl }: TrackerXLProps) {
  const t = useT();
  const lang = t.lang;
  const nameOf = useNameOf();
  const phone = useIsPhone();
  const tile = useRef<HTMLSpanElement>(null);
  usePulseClass(tile, (p) => p.source === "sandbox" && p.trackerId === v.id);
  const st = stateOf(v);
  const stale = !v.online || v.band === "silent" || v.band === "emergency";
  const lastAgo = v.box ? v.age : null;
  const eclipse = !v.online || v.band === "silent" || v.band === "emergency";
  const spare = Math.max(0, EMERGENCY_BLOCKS - v.age);
  const win = beatsWindow(v.height, genesis, v.interval);
  // the age band says how old the latest box is; while the tracker is dark it never shows the live lamp
  const bandLamp: LampState =
    v.band === "emergency" ? "alarm" : !v.online ? "stale" : v.band === "ontime" ? "live" : v.band === "late" ? "tracked" : "stale";

  return (
    <article className="card trk-xl" aria-labelledby="trk-xl-title">
      <header className="trk-xl-h">
        <div className="trk-xl-id">
          <TrackerTile id={v.id} size={phone ? "md" : "lg"} stale={stale} tileRef={tile} />
          <div className="trk-xl-who">
            <div className="label">{t("tracker.card.eyebrow")}</div>
            <h2 className="trk-xl-name" id="trk-xl-title">{t("tracker.card.name", { id: v.id })}</h2>
            <div className="trk-xl-sub">
              <span>NFT {short(v.nftId, 4, 4)}</span>
              <span>{t("tracker.card.key")} {short(v.pub, 4, 4)}</span>
              <span>{t("tracker.card.by", { op: nameOf(v.operator) })}</span>
              <span>{t("ui.tracker.anyone")}</span>
            </div>
          </div>
        </div>
        <div className="trk-xl-tags">
          <span className={`trk-state s-${st.lamp}`} role="status" aria-label={t("tracker.state.aria", { state: t(st.key) })}>
            <Lamp state={st.lamp} size={9} />
            {t(st.key)}
          </span>
          <Tag tone={v.band === "emergency" ? "warn" : v.band === "ontime" && v.online ? "ok" : "plain"}>
            <Lamp state={bandLamp} size={7} />
            {t(`ui.tracker.${v.band}`)}
          </Tag>
          <FaceTabs idBase="trk-xl" />
        </div>
      </header>

      {eclipse && <Eclipse v={v} />}

      <Faces
        human={
          <div className="trk-xl-b">
            <div className={eclipse ? "trk-xl-top docked" : "trk-xl-top"}>
              <div className="trk-last">
                <div className="label">{t("ui.tracker.last")}</div>
                {v.box ? (
                  <>
                    <div className="big-measure">
                      <span className="v">{int(v.age)}</span>
                      <span className="u">{t.p("tracker.agoUnit", v.age)}</span>
                    </div>
                    <div className="t-small trk-last-sub">
                      <span className="trk-seps">
                        <span>{htime(v.age, lang)}</span>
                        <span>{t("ui.tracker.block", { n: int(v.box.creationHeight) })}</span>
                        <span>{t.p("ui.tracker.notes", v.box.notes, { n: int(v.box.notes) })}</span>
                      </span>
                    </div>
                  </>
                ) : (
                  <p className="t-small">{t("tracker.card.none")}</p>
                )}
              </div>

              <NextCommit v={v} blockMs={blockMs} />

              {!eclipse && (
                <div className="dial-side trk-dial">
                  <Dial blocks={Math.min(v.age, EMERGENCY_BLOCKS + 1)} size={phone ? 118 : 150} />
                  <div className="trk-dial-t">
                    <div className="label">{t("ui.tracker.deadman")}</div>
                    <div className="t-measure trk-spare">{blk(spare, lang)}</div>
                    <div className="t-small">{t("ui.tracker.spare")}</div>
                    {v.emergencyAt !== null && <div className="t-small dim trk-opens">{t("tracker.dial.opensAt", { h: int(v.emergencyAt) })}</div>}
                  </div>
                </div>
              )}
            </div>

            <div className="trk-beats-wrap">
              <div className="trk-beats-head">
                <span className="label">
                  {win.young ? t.p("tracker.beats.titleYoung", win.back, { n: int(win.back) }) : t("tracker.beats.title", { n: int(win.back) })}
                </span>
                <span className="label trk-beats-sum">
                  {beats.length ? t("tracker.beats.sum", { c: int(beats.length), hb: int(beats.filter((b) => b.heartbeat).length) }) : t("tracker.beats.noneShort")}
                </span>
              </div>
              <Beats beats={beats} height={v.height} genesis={genesis} interval={v.interval} stale={stale} live={v.online} rows={phone ? 2 : 1} lastAgo={lastAgo} />
              <div className="trk-beats-key t-small">
                <span><i className="k-c" aria-hidden="true" />{t("tracker.beats.keyChange")}</span>
                <span><i className="k-hb" aria-hidden="true" />{t("tracker.beats.keyHeartbeat")}</span>
                <span className="dim">{win.bucket === 1 ? t("tracker.beats.slotBlock") : t("tracker.beats.slot", { n: int(win.bucket) })}</span>
              </div>
            </div>

            <div className="trk-digests">
              {v.box && <Digest value={v.box.digest} />}
              {/* always shown, so the card keeps its height as notes change and get committed */}
              <div className={v.dirty ? "trk-live-digest" : "trk-live-digest same"}>
                <span className="label">{t("tracker.digest.live")}</span>
                <code className="trk-code">{short(v.localDigest, 10, 8)}</code>
                <span className="t-small">{v.dirty ? t.p("tracker.digest.waiting", v.uncommitted, { n: int(v.uncommitted) }) : t("tracker.digest.sameLive")}</span>
              </div>
              {avl && (
                <div className="t-small dim trk-avl">
                  {avl.simulated ? t("tracker.avl.sim") : t("tracker.avl.real", { lib: /ergo_avltree_rust\s+[\d.]+/.exec(avl.label)?.[0] ?? "ergo_avltree_rust" })}
                </div>
              )}
            </div>

            <Honest tracker={v.id} />
          </div>
        }
        machine={<MachineFace v={v} />}
      />
    </article>
  );
}

function NextCommit({ v, blockMs }: { v: TrackerView; blockMs: number | null }) {
  const t = useT();
  const lang = t.lang;
  const n = v.next.inBlocks;
  const value =
    v.next.kind === "dark"
      ? t("tracker.next.dark")
      : v.next.kind === "idle"
        ? t("tracker.next.idle")
        : t(`tracker.next.${v.next.kind}`, { blk: blk(n ?? 0, lang) });
  const why =
    v.next.kind === "change"
      ? t.p("tracker.next.waits", v.uncommitted, { n: int(v.uncommitted) })
      : t(`tracker.next.${v.next.kind}Why`);
  return (
    <div className={`trk-next k-${v.next.kind}`}>
      <div className="label">{t("tracker.next.label")}</div>
      <div className="trk-next-v">
        {value}
        {n !== null && <span className="trk-next-time"> {htime(n, lang)}</span>}
      </div>
      <p className="t-small trk-next-why">{why}</p>
      <p className="t-small dim">
        {v.next.kind === "dark" ? t("tracker.next.cycleDark", { n: int(v.interval) }) : t("tracker.next.cycle", { n: int(v.interval), blk: blk(v.nextRunIn, lang) })}
        {n !== null && (
          <>
            {" · "}
            {blockMs ? t("tracker.next.here", { time: fmtWait(n * blockMs, lang) }) : t("tracker.next.paused")}
          </>
        )}
      </p>
    </div>
  );
}

function Eclipse({ v }: { v: TrackerView }) {
  const t = useT();
  const lang = t.lang;
  const left = Math.max(0, v.emergencyIn);
  return (
    <div className="trk-eclipse" role="status">
      <Dial blocks={Math.min(v.age, EMERGENCY_BLOCKS + 1)} size={84} labels={false} />
      <div className="trk-eclipse-t">
        <div className="label">
          <b>{t("ui.eclipse.title")}</b> · {v.online ? t.p("tracker.eclipse.sub", v.age, { id: v.id, n: int(v.age) }) : t("tracker.eclipse.subDark", { id: v.id })}
        </div>
        <div className="trk-eclipse-in">
          {v.emergencyOpen ? (
            t("ui.eclipse.open")
          ) : (
            <>
              {t("ui.eclipse.in", { blk: blk(left, lang) })} <span className="dim">{htime(left, lang)}</span>
              {v.emergencyAt !== null && <span className="dim trk-eclipse-at"> · {t("tracker.eclipse.at", { h: int(v.emergencyAt) })}</span>}
            </>
          )}
        </div>
        <p className="t-small">{!v.online ? t("tracker.eclipse.dark", { id: v.id }) : t.p("tracker.eclipse.silent", v.age, { id: v.id, n: int(v.age) })}</p>
        {v.emergencyOpen ? (
          <p className="t-small">{t("tracker.dial.open")}</p>
        ) : (
          <p className="t-small dim">{t("ui.eclipse.calm", { id: v.id, blk: t.p("tracker.blocksN", EMERGENCY_BLOCKS, { n: int(EMERGENCY_BLOCKS) }) })}</p>
        )}
        <p className="t-small dim">{pick(copy.emergencyIsAvailability, lang)}</p>
      </div>
    </div>
  );
}

function MachineFace({ v }: { v: TrackerView }) {
  const t = useT();
  const phone = useIsPhone();
  const cols = phone ? 8 : 16;
  const box = v.box;
  if (!box) return <div className="trk-xl-b"><p className="t-small">{t("tracker.card.none")}</p></div>;
  const parts = registerParts(box.registers);
  const seg = (id: string) => t(`tracker.mf.seg.${id}`);
  const flags = avlFlags(parts.R5.find((p) => p.id === "flags")?.hex ?? "");
  const yes = (b: boolean) => (b ? "✓" : "✕");
  const depth = v.height - box.creationHeight + 1;
  return (
    <div className="trk-xl-b trk-mf">
      <div className="label trk-mf-title"><b>{t("tracker.mf.title")}</b></div>
      <dl className="trk-kv">
        <div>
          <dt>{t("tracker.mf.box")}</dt>
          <dd><code className="trk-code">{short(box.boxId, 12, 12)}</code> <CopyButton value={box.boxId} small /></dd>
        </div>
        <div>
          <dt>{t("tracker.mf.tx")}</dt>
          <dd><code className="trk-code">{short(box.txId, 12, 12)}</code> <CopyButton value={box.txId} small /></dd>
        </div>
        <div>
          <dt>{t("tracker.mf.height")}</dt>
          <dd>{t("ui.tracker.block", { n: int(box.creationHeight) })}</dd>
        </div>
        <div>
          <dt>{t("tracker.mf.depth")}</dt>
          <dd>
            {int(depth)} ·{" "}
            {box.confirmedHeight !== null
              ? t("tracker.mf.confirmed", { h: int(box.confirmedHeight) })
              : depth >= v.minDepth
                ? t("tracker.mf.deepEnough")
                : t("tracker.mf.pending", { d: int(v.minDepth) })}
          </dd>
        </div>
      </dl>

      <div className="trk-reg">
        <div className="trk-reg-h"><span className="label"><b>{t("tracker.mf.R4")}</b></span><CopyButton value={box.registers.R4} small /></div>
        <Bytes cols={cols} segments={[{ label: seg("type"), bytes: parts.R4[0].hex, tone: "g" }, { label: seg("key"), bytes: parts.R4[1].hex, tone: "k" }]} />
      </div>
      <div className="trk-reg">
        <div className="trk-reg-h"><span className="label"><b>{t("tracker.mf.R5")}</b></span><CopyButton value={box.registers.R5} small /></div>
        <Bytes
          cols={cols}
          segments={parts.R5.filter((p) => p.hex.length > 0).map((p) => ({
            label: seg(p.id),
            bytes: p.hex,
            tone: p.id === "root" ? "u" : p.id === "type" ? "g" : "plain",
            value: p.id === "height" ? String(parseInt(p.hex, 16)) : p.id === "flags" ? t("tracker.mf.flags", { i: yes(flags.insert), u: yes(flags.update), r: yes(flags.remove) }) : undefined,
          }))}
        />
      </div>
      <div className="trk-reg">
        <div className="trk-reg-h"><span className="label"><b>{t("tracker.mf.R6")}</b></span><CopyButton value={box.registers.R6} small /></div>
        <Bytes cols={cols} segments={[{ label: seg("type"), bytes: parts.R6[0].hex, tone: "g" }, { label: seg("length"), bytes: parts.R6[1].hex, tone: "plain" }, { label: seg("nft"), bytes: parts.R6[2].hex, tone: "n" }]} />
      </div>
      <div className="trk-live-digest">
        <span className="label">{md(t("tracker.mf.live"))}</span>
        <code className="trk-code">{short(v.localDigest, 14, 12)}</code>
        <span className="t-small">{v.dirty ? t("tracker.digest.uncommitted") : t("tracker.digest.same")}</span>
      </div>
      <p className="t-small dim">{t("tracker.mf.sandbox")}</p>
    </div>
  );
}
