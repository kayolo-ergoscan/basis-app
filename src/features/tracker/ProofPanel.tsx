// "Prove a note yourself" (FEATURES T08, Z05): pick any note of the town, take the proof bytes the tracker would
// hand out for it, and run the verifier the chain uses against a committed digest: the current box, or any row of
// the timeline. Tampering one byte of the total turns MATCH into MISMATCH.
// useProof holds the choice and the bytes; ProofCard is the picker with the verdict (it sits next to the timeline);
// ProofXray is the same proof cut into its parts by the AvlProofViewer.
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { copy, pick } from "@/content";
import { getAvlBackend, hexToBytes, readI64BE, type Hex } from "@/protocol";
import { Card, int, Seg, short, Tag } from "@/ui";
import { AvlProofViewer, DigestGlyph, proofAnatomy, rootMatches } from "@/viz";
import { denomInfo, fmtDenom, TOWN_TRACKER, useTown, useTownReady, useTownView, YOU } from "@/world";
import { noteOptions, type NoteOption } from "./model";
import { useNameOf } from "./townParts";
import { treeFor, type TreeSource } from "./rebuild";

type Mode = "honest" | "tamper";

interface Resolved {
  boxId: Hex;
  state: "ready" | "rebuilding" | "failed";
  tree: TreeSource | null;
  progress: number;
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Raises the total in the looked-up leaf by one raw unit (Ergo AVL+); else flips one byte in the middle. */
function tamper(proof: Uint8Array, key: Uint8Array, simulated: boolean): { bytes: Uint8Array; plusOne: boolean } {
  const out = proof.slice();
  if (!simulated) {
    const a = proofAnatomy(proof, { simulated: false });
    for (const s of a.segments) {
      const p = s.part;
      if (p && p.kind === "leaf" && eq(p.key, key) && p.value.length === 8) {
        const at = s.from + s.length - 8;
        for (let i = at + 7; i >= at; i--) {
          out[i] = (out[i] + 1) & 0xff;
          if (out[i] !== 0) break;
        }
        return { bytes: out, plusOne: true };
      }
    }
  }
  if (out.length) out[Math.floor(out.length / 2)] ^= 0x01;
  return { bytes: out, plusOne: false };
}

export interface ProofTarget {
  seq: number;
  boxId: Hex;
  digest: Hex;
  height: number;
}

export interface Verdict {
  ok: boolean;
  run: "found" | "absent" | "threw" | "none";
  value: Uint8Array | null;
  /** The root the proof recomputes (Ergo AVL+ only). */
  root: Uint8Array | null;
}

/** Everything the proof card and the x-ray share: the note, the mode, the committed tree and the bytes. */
export function useProof(target: ProofTarget | null) {
  const eco = useTown((s) => s.eco);
  const { avl } = useTownReady();
  const simulated = !!avl?.simulated;
  const options = useTownView((e) => noteOptions(e, TOWN_TRACKER)) ?? [];
  const [key, setKey] = useState<Hex | null>(null);
  const [mode, setMode] = useState<Mode>("honest");
  const [res, setRes] = useState<Resolved | null>(null);

  // default note: your newest, else the newest in town
  const sorted = useMemo(() => [...options].sort((a, b) => b.updatedHeight - a.updatedHeight), [options]);
  const fallback = useMemo(() => sorted.find((o) => o.issuer === YOU || o.receiver === YOU) ?? sorted[0] ?? null, [sorted]);
  const note: NoteOption | null = options.find((o) => o.key === key) ?? fallback;

  // resolve the committed tree of the target box (kept by the engine, or rebuilt from the log in slices)
  useEffect(() => {
    if (!eco || !target) return;
    const signal = { aborted: false };
    const boxId = target.boxId;
    const kept = eco.t(TOWN_TRACKER).boxes.find((b) => b.boxId === boxId)?.tree;
    if (kept) {
      setRes({ boxId, state: "ready", tree: { kind: "kept", map: kept, digest: target.digest }, progress: 1 });
      return;
    }
    setRes({ boxId, state: "rebuilding", tree: null, progress: 0 });
    void treeFor(eco, TOWN_TRACKER, target, {
      signal,
      onProgress: (d, n) => {
        if (!signal.aborted) setRes((r) => (r && r.boxId === boxId && r.state === "rebuilding" ? { ...r, progress: n ? d / n : 1 } : r));
      },
    }).then((tree) => {
      if (!signal.aborted) setRes({ boxId, state: tree ? "ready" : "failed", tree, progress: 1 });
    });
    return () => {
      signal.aborted = true;
    };
  }, [eco, target?.boxId]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = res && target && res.boxId === target.boxId && res.state === "ready" ? res.tree : null;
  const proof = useMemo(() => {
    if (!ready || !note) return null;
    try {
      return ready.map.proofFor(hexToBytes(note.key));
    } catch {
      return null;
    }
  }, [ready, note?.key]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = useMemo(() => {
    if (!proof || !note) return null;
    return mode === "tamper" ? tamper(proof, hexToBytes(note.key), simulated) : { bytes: proof, plusOne: false };
  }, [proof, mode, note?.key, simulated]); // eslint-disable-line react-hooks/exhaustive-deps

  // the same check the x-ray runs: recompute the root, then the backend's stateless lookup
  const verdict: Verdict | null = useMemo(() => {
    if (!shown || !note || !target) return null;
    const backend = getAvlBackend();
    const digest = hexToBytes(target.digest);
    const k = hexToBytes(note.key);
    const anatomy = proofAnatomy(shown.bytes, backend);
    const match = rootMatches(anatomy, digest);
    let run: Verdict["run"] = "none";
    let value: Uint8Array | null = null;
    if (backend.verifier) {
      try {
        value = backend.verifier.lookup(digest, k, shown.bytes);
        run = value ? "found" : "absent";
      } catch {
        run = "threw";
      }
    }
    return { ok: (run === "found" || run === "absent") && match !== false, run, value, root: anatomy.root ?? null };
  }, [shown, note?.key, target?.digest]); // eslint-disable-line react-hooks/exhaustive-deps

  return { eco, avl, options, note, setKey, mode, setMode, res, shown, verdict };
}
export type ProofState = ReturnType<typeof useProof>;

/** The picker and the verdict, next to the timeline. */
export function ProofCard({ p, target, isCurrent, onUseCurrent }: { p: ProofState; target: ProofTarget | null; isCurrent: boolean; onUseCurrent: () => void }) {
  const t = useT();
  const nameOf = useNameOf();
  const { eco, avl, options, note, setKey, mode, setMode, res, shown, verdict } = p;

  // groups for the picker: by issuer, in name order
  const groups = useMemo(() => {
    const m = new Map<string, NoteOption[]>();
    for (const o of options) m.set(o.issuer, [...(m.get(o.issuer) ?? []), o]);
    return [...m.entries()]
      .map(([issuer, list]) => ({ issuer, list: list.sort((a, b) => nameOf(a.receiver).localeCompare(nameOf(b.receiver))) }))
      .sort((a, b) => (a.issuer === YOU ? -1 : b.issuer === YOU ? 1 : nameOf(a.issuer).localeCompare(nameOf(b.issuer))));
  }, [options, nameOf]);

  // "1.20 ERG"; Russian prose writes the decimal comma
  const money = (o: NoteOption, v: bigint) => {
    const s = fmtDenom(eco, v, o.denom);
    return t.lang === "ru" ? s.replace(".", ",") : s;
  };
  const label = (o: NoteOption) => t(o.omitted ? "tracker.pf.optionOmitted" : "tracker.pf.option", { a: nameOf(o.issuer), b: nameOf(o.receiver), v: money(o, o.totalDebt) });

  return (
    <Card className="trk-proof-card" title={t("tracker.pf.title")} aside={avl ? <Tag tone={avl.simulated ? "agent" : "plain"}>{avl.simulated ? t("tracker.pf.sim") : t("tracker.pf.wasm")}</Tag> : undefined}>
      <p className="t-small trk-proof-sub">{t("tracker.pf.sub")}</p>
      {options.length === 0 ? (
        <p className="t-small">{t("tracker.pf.noNotes")}</p>
      ) : (
        <div className="trk-proof-form">
          <label className="trk-field">
            <span className="label">{t("tracker.pf.note")}</span>
            <select className="trk-select" value={note?.key ?? ""} onChange={(e) => setKey(e.target.value)}>
              {groups.map((g) => (
                <optgroup key={g.issuer} label={t("tracker.pf.group", { name: nameOf(g.issuer) })}>
                  {g.list.map((o) => (
                    <option key={o.key} value={o.key}>
                      {label(o)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="trk-field">
            <span className="label">{t("tracker.pf.against")}</span>
            <span className="trk-against">
              {target ? t(isCurrent ? "tracker.pf.current" : "tracker.pf.row", { h: int(target.height) }) : "—"}
              {!isCurrent && (
                <button type="button" className="textlink trk-linkbtn" onClick={onUseCurrent}>
                  {t("tracker.pf.useCurrent")}
                </button>
              )}
            </span>
          </div>
          <div className="trk-field">
            <span className="label">{t("tracker.pf.mode")}</span>
            <Seg<Mode>
              ariaLabel={t("tracker.pf.mode")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "honest", label: t("tracker.pf.honest") },
                { value: "tamper", label: shown && !shown.plusOne && mode === "tamper" ? t("tracker.pf.tamperAbsent") : t("tracker.pf.tamper") },
              ]}
            />
          </div>
        </div>
      )}

      {res?.state === "rebuilding" && (
        <p className="t-small trk-proof-state" role="status">
          {t("tracker.pf.rebuilding", { p: String(Math.round(res.progress * 100)) })}
        </p>
      )}
      {res?.state === "failed" && <p className="t-small trk-proof-state">{t("tracker.pf.failed")}</p>}
      {note?.omitted && <p className="t-small trk-proof-state">{t("tracker.pf.omitted")}</p>}

      {verdict && note && target && (
        <div className={`trk-verdict ${verdict.ok ? "ok" : "bad"}`} role="status">
          <div className="trk-verdict-h">
            <span className="trk-stamp">{verdict.ok ? t("tracker.pf.match") : t("tracker.pf.mismatch")}</span>
            <span aria-hidden="true" className="trk-verdict-glyph">
              <DigestGlyph digest={target.digest} size={40} holo={verdict.ok} stale={!verdict.ok} />
            </span>
          </div>
          <p className="trk-verdict-t">
            {verdict.ok
              ? verdict.run === "found" && verdict.value
                ? t("tracker.pf.v.found", { h: int(target.height), v: money(note, readI64BE(verdict.value, 0)), a: nameOf(note.issuer), b: nameOf(note.receiver) })
                : t("tracker.pf.v.absent", { h: int(target.height), a: nameOf(note.issuer), b: nameOf(note.receiver) })
              : t("tracker.pf.v.bad", { h: int(target.height) })}
          </p>
          <dl className="trk-verdict-roots">
            <div>
              <dt>{t("tracker.pf.v.recomputed")}</dt>
              <dd className={verdict.ok ? undefined : "bad"}>{verdict.root ? short(bytesHex(verdict.root), 8, 6) : "—"}</dd>
            </div>
            <div>
              <dt>{t("tracker.pf.v.committed")}</dt>
              <dd>{short(target.digest.slice(0, 64), 8, 6)}</dd>
            </div>
          </dl>
          {verdict.ok && verdict.run === "found" && verdict.value && readI64BE(verdict.value, 0) !== note.totalDebt && (
            <p className="t-small">{t("tracker.pf.v.newer", { v: money(note, note.totalDebt) })}</p>
          )}
          {mode === "tamper" && shown && <p className="t-small">{shown.plusOne ? t("tracker.pf.tamperLine") : t("tracker.pf.tamperLineByte")}</p>}
          {res?.state === "ready" && res.tree?.kind === "rebuilt" && <p className="t-small dim">{t("tracker.pf.rebuilt")}</p>}
        </div>
      )}
      <p className="t-small dim trk-proof-honest">{pick(copy.matchNotSolvency, t.lang)}</p>
    </Card>
  );
}

const bytesHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The proof cut into its parts, with the verifier run step by step. */
export function ProofXray({ p, target }: { p: ProofState; target: ProofTarget | null }) {
  const t = useT();
  const nameOf = useNameOf();
  const { eco, note, mode, shown } = p;
  if (!target || !note || !shown) return null;
  return (
    <AvlProofViewer
      key={`${target.boxId}|${note.key}|${mode}`}
      digest={target.digest}
      proof={shown.bytes}
      lookupKey={note.key}
      keyLabel={t("tracker.pf.keyLabel", { a: nameOf(note.issuer), b: nameOf(note.receiver) })}
      valueKind="tracker"
      unit={denomInfo(eco, note.denom)}
      title={t("tracker.pf.viewerTitle", { a: nameOf(note.issuer), b: nameOf(note.receiver) })}
    />
  );
}
