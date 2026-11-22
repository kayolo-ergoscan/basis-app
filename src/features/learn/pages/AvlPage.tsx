// /learn/avl — the tracker's AVL+ tree: the 33-byte digest, a tree you write notes into (real Ergo AVL+ compiled to
// WebAssembly when it loads), a lookup proof you can tamper with, where the contract checks it, and what a match
// does not prove.
import { useEffect, useMemo, useRef, useState } from "react";
import { rich, useT } from "@/app";
import { Key, Tag, TextInput, money, short, withUnit } from "@/ui";
import { AvlProofViewer, AvlTreeView, DigestGlyph, LAB_NAMES, labKey } from "@/viz";
import { EMPTY_AVL_DIGEST_HEX, bytesToHex, debtKey, erg, trackerTreeValue, type AuthenticatedMap } from "@/protocol";
import { pick, trust } from "@/content";
import { BookHead, Fact, Fig, Pager, SandboxTag, Sec, Side, Terms, inline, useBookSections } from "../layout";
import { useAvl } from "../lab";

type LabName = (typeof LAB_NAMES)[number];
const NAMES: readonly LabName[] = LAB_NAMES;
const nameKey = (n: LabName) => `learn.name.${n.toLowerCase()}`;
const NANO = 1_000_000_000n;

function u64(b: Uint8Array | undefined): bigint | null {
  if (!b || b.length < 8) return null;
  let v = 0n;
  for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[i]);
  return v;
}
const ergNum = (n: bigint) => Number(n) / Number(NANO);

function parseAmount(s: string): bigint | null {
  const v = s.replace(/[\s   ⁠]/g, "").replace(",", ".");
  if (!/^\d+(\.\d{0,9})?$/.test(v)) return null;
  try {
    const n = erg(v);
    return n > 0n ? n : null;
  } catch {
    return null;
  }
}

interface LogRow { i: number; pair: string; total: bigint; digest: string }

export default function AvlPage() {
  const t = useT();
  const L = t.lang;
  const avl = useAvl(true);
  const mapRef = useRef<AuthenticatedMap | null>(null);
  const [version, setVersion] = useState(0);
  const [log, setLog] = useState<LogRow[]>([]);
  const [issuer, setIssuer] = useState<LabName>("Alice");
  const [receiver, setReceiver] = useState<LabName>("Bob");
  const [amount, setAmount] = useState("1.5");
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);


  const keys = useMemo(() => {
    const m = new Map<string, { a: LabName; b: LabName; key: Uint8Array }>();
    for (const a of NAMES) for (const b of NAMES) if (a !== b) {
      const key = debtKey(labKey(a).pub, labKey(b).pub);
      m.set(bytesToHex(key), { a, b, key });
    }
    return m;
  }, []);
  const pairLabel = (a: LabName, b: LabName) => t("learn.pair", { a: t(nameKey(a)), b: t(nameKey(b)) });
  const keyName = (hex: string) => { const k = keys.get(hex.toLowerCase()); return k ? pairLabel(k.a, k.b) : undefined; };

  const write = (a: LabName, b: LabName, total: bigint, quiet = false): boolean => {
    const map = mapRef.current;
    if (!map) return false;
    const key = debtKey(labKey(a).pub, labKey(b).pub);
    const cur = u64(map.get(key));
    if (cur !== null && total < cur) {
      if (!quiet) setErr(t("learn.av.err.lower", { pair: pairLabel(a, b), v: money(ergNum(cur)) }));
      return false;
    }
    map.insertOrUpdate(key, trackerTreeValue(total));
    const digest = bytesToHex(map.digest());
    setLog((l) => [{ i: (l[0]?.i ?? 0) + 1, pair: pairLabel(a, b), total, digest }, ...l].slice(0, 40));
    setSel(bytesToHex(key));
    return true;
  };

  const submit = () => {
    setErr(null);
    if (issuer === receiver) { setErr(t("learn.av.err.same")); return; }
    const v = parseAmount(amount);
    if (v === null) { setErr(t("learn.av.err.amount")); return; }
    if (write(issuer, receiver, v)) setVersion((x) => x + 1);
  };
  const random = (n: number) => {
    setErr(null);
    const map = mapRef.current;
    if (!map) return;
    for (let k = 0; k < n; k++) {
      const a = NAMES[Math.floor(Math.random() * NAMES.length)];
      let b = NAMES[Math.floor(Math.random() * NAMES.length)];
      if (a === b) b = NAMES[(NAMES.indexOf(a) + 1) % NAMES.length];
      const cur = u64(map.get(debtKey(labKey(a).pub, labKey(b).pub))) ?? 0n;
      const add = BigInt(Math.round(5 + Math.random() * 400)) * 10_000_000n;
      write(a, b, cur + add, true);
    }
    setVersion((x) => x + 1);
  };
  const reset = () => {
    if (!avl) return;
    mapRef.current = avl.backend.createMap(32);
    setLog([]); setSel(null); setErr(null); setVersion((x) => x + 1);
  };

  // start with three notes so the tree, the log and the proof have something to show
  useEffect(() => {
    if (!avl || mapRef.current) return;
    mapRef.current = avl.backend.createMap(32);
    write("Alice", "Bob", erg("1.5"), true);
    write("Carol", "Alice", erg("0.3"), true);
    write("Bob", "Carol", erg("0.75"), true);
    setVersion((v) => v + 1);
  }, [avl]); // eslint-disable-line react-hooks/exhaustive-deps

  const map = mapRef.current;
  const entries = useMemo(() => (map ? map.entries().map(([k, v]) => ({ hex: bytesToHex(k), key: k, total: u64(v) ?? 0n })) : []), [map, version]);
  const absent = useMemo(() => [...keys.entries()].find(([hex]) => !entries.some((e) => e.hex === hex)), [keys, entries]);
  const target = sel && (entries.some((e) => e.hex === sel) || absent?.[0] === sel) ? sel : entries[0]?.hex ?? null;
  const proof = useMemo(() => {
    if (!map || !target) return null;
    const k = keys.get(target);
    if (!k) return null;
    return { digest: bytesToHex(map.digest()), proof: bytesToHex(map.proofFor(k.key)), key: k.key, label: pairLabel(k.a, k.b) };
  }, [map, target, version, L]); // eslint-disable-line react-hooks/exhaustive-deps

  useBookSections([
    { id: "digest", label: pick({ en: "The digest", ru: "Дайджест" }, L) },
    { id: "lab", label: pick({ en: "Build a tree", ru: "Постройте дерево" }, L) },
    { id: "proof", label: pick({ en: "Prove one note", ru: "Докажите расписку" }, L) },
    { id: "contract", label: pick({ en: "In the contract", ru: "В контракте" }, L) },
    { id: "limits", label: pick({ en: "What a match means", ru: "Что значит совпадение" }, L) },
  ]);

  const backendTag = avl
    ? <Tag tone={avl.backend.simulated ? "agent" : "plain"} glyph={avl.backend.simulated ? "◇" : undefined}>{t(avl.backend.simulated ? "viz.backend.simulated" : "viz.backend.wasm")}</Tag>
    : <span className="t-small">{t("learn.av.loading")}</span>;

  return (
    <article>
      <BookHead id="avl" lede={t("learn.av.lede")} />

      <Sec id="digest" first title={rich(t("learn.av.s.digest"))}>
        <Side label={t("learn.words")}><Terms ids={["avl-tree", "digest", "lookup-proof", "proof-insert", "commitment", "r5"]} /></Side>
        <p className="lrn-p">{t("learn.av.p.digest1")}</p>
        <p className="lrn-p">{t("learn.av.p.digest2")}</p>
        <Fig n="1" caption={t("learn.av.p.digest3")}>
          <div className="hw-digest">
            <div className="glyphs" aria-hidden="true"><DigestGlyph digest={EMPTY_AVL_DIGEST_HEX} size={96} holo /></div>
            <div className="hw-dg-rows">
              <div className="hw-dg-row now">
                <span className="label"><b>{t("learn.av.emptyLabel")}</b></span>
                <span className="hex">{EMPTY_AVL_DIGEST_HEX.slice(0, 64)}<b style={{ color: "var(--ink)" }}>{EMPTY_AVL_DIGEST_HEX.slice(64)}</b></span>
              </div>
              <div className="hw-dg-entries">{pick({ en: "Root label, 32 bytes · tree height, 1 byte", ru: "Метка корня, 32 байта · высота дерева, 1 байт" }, L)}</div>
            </div>
          </div>
        </Fig>
      </Sec>

      <Sec id="lab" title={rich(t("learn.av.s.lab"))} lede={t("learn.av.s.lab.lede")}>
        <div className="lab-bar">
          <div className="av-backend"><span className="label">{t("learn.av.backend")}</span>{backendTag}</div>
          <SandboxTag />
        </div>
        {avl?.backend.simulated && <p className="t-small" style={{ marginBottom: 14 }}>{t("learn.av.fallback")}</p>}
        <div className="av-lab">
          <div className="av-ctl">
            <div className="row">
              <label>
                <span className="flabel">{t("learn.av.issuer")}</span>
                <select value={issuer} onChange={(e) => setIssuer(e.target.value as LabName)}>
                  {NAMES.map((n) => <option key={n} value={n}>{t(nameKey(n))}</option>)}
                </select>
              </label>
              <label>
                <span className="flabel">{t("learn.av.receiver")}</span>
                <select value={receiver} onChange={(e) => setReceiver(e.target.value as LabName)}>
                  {NAMES.map((n) => <option key={n} value={n}>{t(nameKey(n))}</option>)}
                </select>
              </label>
            </div>
            <label>
              <span className="flabel">{t("learn.av.total")}</span>
              <TextInput value={amount} onChange={setAmount} inputMode="decimal" mono trailing={<span className="t-small" style={{ paddingRight: 12 }}>ERG</span>} onKeyDown={(e: React.KeyboardEvent) => { if (e.key === "Enter") submit(); }} />
            </label>
            <Key variant="primary" icon="stamp" onClick={submit} disabled={!avl}>{t("learn.av.insert")}</Key>
            {err && <p className="t-small alarm-t" role="alert">{err}</p>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <Key size="sm" icon="plus" onClick={() => random(6)} disabled={!avl}>{t("learn.av.random", { n: 6 })}</Key>
              <Key size="sm" variant="quiet" onClick={reset} disabled={!avl || entries.length === 0}>{t("learn.av.reset")}</Key>
            </div>
            <div>
              <span className="flabel">{t("learn.av.log")}</span>
              {log.length === 0 ? <p className="t-small">{t("learn.av.logEmpty")}</p> : (
                <div className="av-log" aria-live="polite">
                  {log.map((r) => (
                    <div key={r.i}>
                      <span className="mono t-small">{r.i}</span>
                      <span>{r.pair} · {withUnit(money(ergNum(r.total)), "ERG")}<br /><span className="hex mono">{short(r.digest, 10, 6)}</span></span>
                      <DigestGlyph digest={r.digest} size={22} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div style={{ minWidth: 0 }}>
            {map ? (
              <AvlTreeView map={map} version={version} keyName={keyName} valueKind="tracker" highlight={sel ?? undefined} maxDraw={24} />
            ) : (
              <div className="lrn-frame"><p className="t-small">{t("learn.av.loading")}</p></div>
            )}
          </div>
        </div>
      </Sec>

      <Sec id="proof" title={rich(t("learn.av.s.proof"))} lede={t("learn.av.s.proof.lede")}>
        {entries.length === 0 ? (
          <p className="lrn-p">{t("learn.av.needEntries")}</p>
        ) : (
          <>
            <div className="lab-bar">
              <label className="grp">
                <span className="label">{t("learn.av.pick")}</span>
                <span className="av-ctl" style={{ padding: 0, border: 0, background: "none" }}>
                  <select value={target ?? ""} onChange={(e) => setSel(e.target.value)} style={{ minWidth: 220 }}>
                    {entries.map((e) => <option key={e.hex} value={e.hex}>{keyName(e.hex) ?? short(e.hex, 6, 4)} · {money(ergNum(e.total))} ERG</option>)}
                    {absent && <option value={absent[0]}>{t("learn.av.absent", { pair: pairLabel(absent[1].a, absent[1].b) })}</option>}
                  </select>
                </span>
              </label>
            </div>
            {proof && avl && (
              <AvlProofViewer key={`${proof.digest}-${target}`} digest={proof.digest} proof={proof.proof} lookupKey={proof.key} keyLabel={proof.label} backend={avl.backend} valueKind="tracker" />
            )}
          </>
        )}
      </Sec>

      <Sec id="contract" title={rich(t("learn.av.s.contract"))}>
        <p className="lrn-p">{inline(t("learn.av.p.c1"))}</p>
        <p className="lrn-p">{inline(t("learn.av.p.c2"))}</p>
        <Fact text="trackerTree.get(debtKey, proof #8) == totalDebt" lines={{ contract: "basis", from: 288, to: 303 }} />
        <Fact text="reserveTree.insertOrUpdate(reserveKey → timestamp ‖ redeemed, proof #5)" lines={{ contract: "basis", from: 400, to: 419 }} />
      </Sec>

      <Sec id="limits" title={rich(t("learn.av.s.limits"))}>
        <div className="tr-col" style={{ maxWidth: 720 }}>
          {trust.tracker.can.filter((x) => ["censor", "freeze", "lose-data"].includes(x.id)).map((x) => (
            <div className="tr-item" key={x.id}>
              <span className="t">{inline(pick(x.text, L))}</span>
              {x.detail && <span className="d">{inline(pick(x.detail, L))}</span>}
            </div>
          ))}
        </div>
      </Sec>

      <Pager id="avl" />
    </article>
  );
}
