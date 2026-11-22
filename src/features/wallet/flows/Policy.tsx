// Acceptance policy (A01–A11): your current policy as a sentence with its A09 fingerprint and a Schnorr signature
// over the raw policy_json bytes; every preset town.setPolicy offers; the advanced tree editor over the whole
// grammar with local validation (A03/A04); a local evaluator to test it against a resident (A07); credit lines.
import { useEffect, useId, useMemo, useState } from "react";
import { useT } from "@/app/lang";
import { blake2b256, bytesToHex, evaluateAcceptance, policyToJson, sign, utf8, verify, type AcceptanceConfig, type DenomId, type PredicateConfig } from "@/protocol";
import { AmountInput, Callout, Field, Key, PolicySentence, Seg, Switch, Tag, TextInput } from "@/ui";
import { checkPolicy, parseAmount, policyFromPreset, POLICY_PRESETS, presetOf, RESIDENTS, town, TOWN_TRACKER, useTownView, YOU, type PolicyPresetId } from "@/world";
import { useFmt, useNameOf, useOutcomeToast, useWT } from "../lib/hooks";
import { acceptanceCtx, plainAmount, unitOf, type Unit } from "../lib/model";
import { policyText, traceLines } from "../lib/policyText";
import { Frame, PartySeal } from "../parts/bits";

const PEOPLE = RESIDENTS.filter((r) => r.id !== "op").map((r) => r.id);
const RATIO_PRESETS: PolicyPresetId[] = ["friends-or-backed", "backed-100", "backed-150", "half-backed", "backed-no-refund"];
const DEFAULT_RATIO: Partial<Record<PolicyPresetId, number>> = { "friends-or-backed": 1, "backed-100": 1, "backed-150": 1.5, "half-backed": 0.5, "backed-no-refund": 1 };
const ERG: Unit = { id: "erg", symbol: "ERG", decimals: 9 };

const clone = (c: AcceptanceConfig): AcceptanceConfig => ({ default: c.default, root: c.root ?? null, predicates: c.predicates.map((p) => ({ ...p, ...("holders" in p ? { holders: [...p.holders] } : {}), ...("predicates" in p ? { predicates: [...p.predicates] } : {}) }) as PredicateConfig) });

/** Shared by the current-policy card and the editor: sentence parts with names from the town. */
function useSentence(cfg: AcceptanceConfig | null, uidBase: string) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  return useMemo(
    () =>
      policyText(cfg, {
        t,
        uid: uidBase,
        who: (pub) => {
          const eco = town.economy;
          const id = eco?.idOf(pub);
          return id ? { name: nameOf(id), agent: eco?.participants.get(id)?.kind === "agent" } : null;
        },
        cap: (v) => `${f.amt(v, ERG)} ERG`,
      }),
    [cfg, t, f, nameOf, uidBase],
  );
}

export function PolicyPage({ page }: { page: boolean }) {
  const t = useT();
  const v = useTownView((eco) => ({ policy: eco.p(YOU).policy, pub: eco.p(YOU).pub }), []);
  const [tab, setTab] = useState<"presets" | "tree" | "lines">("presets");
  if (!v) return null;
  return (
    <Frame page={page} title={t("wallet.pol.title")} sub={t("wallet.pol.sub")} labelId="wl-pol-h" className="wl-flow wl-polpage">
      <div className="wl-split">
        <aside className="wl-aside">
          <Current cfg={v.policy} />
        </aside>
        <div className="wl-main">
          <Seg
            ariaLabel={t("wallet.pol.modes")}
            value={tab}
            onChange={setTab}
            options={[
              { value: "presets", label: t("wallet.pol.tab.presets") },
              { value: "tree", label: t("wallet.pol.tab.tree") },
              { value: "lines", label: t("wallet.pol.tab.lines") },
            ]}
          />
          {tab === "presets" && <Presets current={v.policy} />}
          {tab === "tree" && <TreeEditor current={v.policy} />}
          {tab === "lines" && <CreditLines />}
        </div>
      </div>
    </Frame>
  );
}

// ---------------------------------------------------------------------------------------------
// the current policy: sentence, tags, fingerprint, signature
// ---------------------------------------------------------------------------------------------

function Current({ cfg }: { cfg: AcceptanceConfig | null }) {
  const t = useT();
  const wt = useWT();
  const uid = useId();
  const text = useSentence(cfg, `cur${uid}`);
  const preset = presetOf(cfg);
  const sig = useMemo(() => {
    if (!cfg) return null;
    const kp = town.wallet.keyPair();
    if (!kp) return null;
    const bytes = utf8(policyToJson(cfg, 0));
    const s = sign(bytes, kp);
    return { fp: bytesToHex(blake2b256(bytes)), sig: bytesToHex(s), ok: verify(kp.pub, bytes, s).ok, size: bytes.length };
  }, [cfg]);
  return (
    <section className="card wl-polnow" aria-labelledby={`${uid}-h`}>
      <div className="card-b">
        <div className="spread">
          <h2 className="label" id={`${uid}-h`}>
            <b>{t("wallet.pol.now")}</b> · {preset === "none" ? t("wallet.pol.nonePreset") : wt(`world.policy.${preset}.name`)}
          </h2>
          <Tag>{t("wallet.ps.tag")}</Tag>
        </div>
        <PolicySentence parts={text.parts} predicates={text.tags} />
        {sig && (
          <dl className="wl-dl wl-polsig">
            <dt>{t("wallet.pol.fp")}</dt>
            <dd className="mono">
              {sig.fp.slice(0, 8)}…{sig.fp.slice(-4)} <span className="t-small">· blake2b256 · {sig.size} B</span>
            </dd>
            <dt>{t("wallet.pol.sig")}</dt>
            <dd className="mono">
              {sig.sig.slice(0, 8)}…{sig.sig.slice(-4)} · {sig.ok ? t("wallet.nd.verified") : t("wallet.nd.bad")}
            </dd>
          </dl>
        )}
        <p className="t-small">{t("wallet.pol.sigNote", { id: TOWN_TRACKER })}</p>
        {(!cfg || preset === "reject-all") && <Callout tone="policy" title={t("wallet.pol.a10.t")}>{t("wallet.pol.a10.b")}</Callout>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// presets
// ---------------------------------------------------------------------------------------------

function Presets({ current }: { current: AcceptanceConfig | null }) {
  const t = useT();
  const wt = useWT();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const uid = useId();
  const cur = presetOf(current);
  const [id, setId] = useState<PolicyPresetId>(cur === "custom" || cur === "none" ? "friends-or-backed" : cur);
  const curFriends = useMemo(() => {
    const eco = town.economy;
    const wl = current?.predicates.find((p) => p.type === "whitelist");
    return wl && wl.type === "whitelist" && eco ? wl.holders.map((h) => eco.idOf(h)).filter((x): x is string => !!x) : ["alice", "dan"];
  }, [current]);
  const curCap = current?.predicates.find((p) => p.type === "whitelist" && p.max_debt != null);
  const [friends, setFriends] = useState<string[]>(curFriends);
  const [cap, setCap] = useState(curCap && curCap.type === "whitelist" && curCap.max_debt != null ? plainAmount(curCap.max_debt, 9) : "");
  const [ratio, setRatio] = useState("");
  const [busy, setBusy] = useState(false);
  const def = PRESET(id);
  const capV = cap.trim() ? parseAmount(cap, { id: "erg", symbol: "ERG", decimals: 9 }) : null;
  const ratioV = ratio.trim() ? Number(ratio.replace(",", ".")) / 100 : DEFAULT_RATIO[id] ?? 1;
  const ratioBad = ratio.trim() !== "" && (!Number.isFinite(ratioV) || ratioV <= 0 || ratioV > 10);
  const capBad = cap.trim() !== "" && (capV === null || capV <= 0n);
  const params = { friends: def.needsFriends ? friends : undefined, maxDebt: def.needsFriends ? capV : undefined, minRatio: RATIO_PRESETS.includes(id) ? ratioV : undefined };
  const preview = useMemo(() => (town.economy ? policyFromPreset(id, params, town.economy) : null), [id, friends.join(), capV?.toString(), ratioV]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = useSentence(preview, `pre${uid}`);
  const publish = async () => {
    setBusy(true);
    try {
      show(await town.setPolicy({ preset: id, params }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wl-presets" aria-label={t("wallet.pol.tab.presets")}>
      <div className="wl-preset-grid" role="radiogroup" aria-label={t("wallet.pol.tab.presets")}>
        {POLICY_PRESETS.map((p) => (
          <button key={p.id} type="button" role="radio" aria-checked={id === p.id} className={`wl-preset${id === p.id ? " on" : ""}`} onClick={() => setId(p.id)}>
            <span className="t-h4">{wt(`world.policy.${p.id}.name`)}</span>
            <span className="t-small">{wt(`world.policy.${p.id}.about`)}</span>
            {cur === p.id && <Tag tone="ok">{t("wallet.pol.inUse")}</Tag>}
          </button>
        ))}
      </div>
      {def.needsFriends && (
        <div>
          <div className="label wl-lbl">
            <b>{t("wallet.pol.friends")}</b>
          </div>
          <div className="wl-chips" role="group" aria-label={t("wallet.pol.friends")}>
            {PEOPLE.map((p) => (
              <button key={p} type="button" aria-pressed={friends.includes(p)} className={`wl-chip${friends.includes(p) ? " on" : ""}`} onClick={() => setFriends(friends.includes(p) ? friends.filter((x) => x !== p) : [...friends, p])}>
                <PartySeal id={p} size="sm" />
                {nameOf(p)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="wl-params">
        {def.needsFriends && (
          <Field label={t("wallet.pol.cap")} help={t("wallet.pol.capHelp")} error={capBad ? t("wallet.amount.invalid") : undefined}>
            <AmountInput value={cap} onChange={setCap} unit="ERG" invalid={capBad} aria-label={t("wallet.pol.cap")} />
          </Field>
        )}
        {RATIO_PRESETS.includes(id) && (
          <Field label={t("wallet.pol.ratio")} help={t("wallet.pol.ratioHelp")} error={ratioBad ? t("wallet.pol.ratioBad") : undefined}>
            <TextInput value={ratio} onChange={setRatio} placeholder={String(Math.round((DEFAULT_RATIO[id] ?? 1) * 100))} inputMode="decimal" trailing={<span className="u">%</span>} invalid={ratioBad} />
          </Field>
        )}
      </div>
      <div className="wl-polprev">
        <div className="label">{t("wallet.pol.preview")}</div>
        <PolicySentence parts={text.parts} predicates={text.tags} />
      </div>
      <p className="t-small">{wt("world.policy.disclaimer")}</p>
      <Callout tone="policy">{t("wallet.pol.a11")}</Callout>
      <Key variant="primary" size="lg" block hold="sign" disabled={busy || capBad || ratioBad || (def.needsFriends && friends.length === 0)} onAct={() => void publish()}>
        {t("wallet.pol.publish", { id: TOWN_TRACKER })}
      </Key>
    </section>
  );
}

const PRESET = (id: PolicyPresetId) => POLICY_PRESETS.find((p) => p.id === id)!;

// ---------------------------------------------------------------------------------------------
// the tree editor (whole grammar)
// ---------------------------------------------------------------------------------------------

const TYPES: PredicateConfig["type"][] = ["whitelist", "blacklist", "collateralization", "no_pending_refund", "all_of", "any_of", "not"];

function blank(type: PredicateConfig["type"], name: string): PredicateConfig {
  switch (type) {
    case "whitelist":
      return { type, name, holders: [], max_debt: null };
    case "blacklist":
      return { type, name, holders: [] };
    case "collateralization":
      return { type, name, min_ratio: 1 };
    case "no_pending_refund":
      return { type, name };
    case "all_of":
    case "any_of":
      return { type, name, predicates: [] };
    case "not":
      return { type, name, predicate: "" };
  }
}

function TreeEditor({ current }: { current: AcceptanceConfig | null }) {
  const t = useT();
  const show = useOutcomeToast();
  const uid = useId();
  const [draft, setDraft] = useState<AcceptanceConfig>(() => clone(current ?? policyFromPreset("friends-or-backed", { friends: ["alice", "dan"], minRatio: 1 }, town.economy)));
  const [addType, setAddType] = useState<PredicateConfig["type"]>("whitelist");
  const [machine, setMachine] = useState(false);
  const [busy, setBusy] = useState(false);
  const text = useSentence(draft, `tree${uid}`);
  const check = useMemo(() => checkPolicy(draft), [draft]);
  const names = draft.predicates.map((p) => p.name);
  const set = (i: number, p: PredicateConfig) => setDraft({ ...draft, predicates: draft.predicates.map((x, j) => (j === i ? p : x)) });
  const remove = (i: number) => {
    const gone = draft.predicates[i].name;
    setDraft({ ...draft, root: draft.root === gone ? null : draft.root, predicates: draft.predicates.filter((_, j) => j !== i) });
  };
  const add = () => {
    let n = 1;
    while (names.includes(`${addType}_${n}`)) n++;
    setDraft({ ...draft, predicates: [...draft.predicates, blank(addType, `${addType}_${n}`)] });
  };
  const publish = async () => {
    setBusy(true);
    try {
      show(await town.setPolicy({ policy: draft }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="wl-tree" aria-label={t("wallet.pol.tab.tree")}>
      <div className="wl-tree-top">
        <Field label={t("wallet.pol.root")} help={t("wallet.pol.rootHelp")}>
          <select className="wl-select" value={draft.root ?? ""} onChange={(e) => setDraft({ ...draft, root: e.target.value || null })}>
            <option value="">{t("wallet.pol.rootAuto")}</option>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
        <div>
          <div className="label wl-lbl">{t("wallet.pol.default")}</div>
          <Seg ariaLabel={t("wallet.pol.default")} value={draft.default} onChange={(d) => setDraft({ ...draft, default: d })} options={[{ value: "reject", label: t("wallet.pol.reject") }, { value: "accept", label: t("wallet.pol.acceptD") }]} mono />
        </div>
      </div>
      <p className="t-small">{t("wallet.pol.defaultHelp")}</p>
      <ol className="wl-preds">
        {draft.predicates.map((p, i) => (
          <PredEditor key={i} p={p} others={names.filter((n) => n !== p.name)} onChange={(x) => set(i, x)} onRemove={() => remove(i)} />
        ))}
      </ol>
      <div className="wl-act">
        <select className="wl-select" value={addType} onChange={(e) => setAddType(e.target.value as PredicateConfig["type"])} aria-label={t("wallet.pol.addType")}>
          {TYPES.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <Key size="sm" icon="plus" onClick={add}>
          {t("wallet.pol.add")}
        </Key>
      </div>
      <div className="wl-polprev">
        <div className="spread">
          <span className="label">{t("wallet.pol.preview")}</span>
          <Switch checked={machine} onChange={setMachine} label={t("wallet.pol.json")} />
        </div>
        {machine ? <pre className="wl-json mono">{policyToJson(draft)}</pre> : <PolicySentence parts={text.parts} predicates={text.tags} />}
      </div>
      {check.error && (
        <Callout tone="alarm" title={t("wallet.pol.invalid")}>
          <span className="mono">{check.error}</span>
        </Callout>
      )}
      {check.rootAmbiguity && <Callout tone="policy" title={t("wallet.pol.a04.t")}>{t("wallet.pol.a04.b", { a: check.rootBuilder ?? "—", b: check.rootRedemption ?? "—" })}</Callout>}
      {check.inert.length > 0 && <Callout tone="policy" title={t("wallet.pol.inert.t")}>{t("wallet.pol.inert.b", { list: check.inert.join(", ") })}</Callout>}
      <TestBox cfg={draft} />
      <Key variant="primary" size="lg" block hold="sign" disabled={busy || !check.ok} onAct={() => void publish()}>
        {t("wallet.pol.publish", { id: TOWN_TRACKER })}
      </Key>
    </section>
  );
}

function PredEditor({ p, others, onChange, onRemove }: { p: PredicateConfig; others: string[]; onChange: (p: PredicateConfig) => void; onRemove: () => void }) {
  const t = useT();
  const nameOf = useNameOf();
  const toggleHolder = (id: string) => {
    if (p.type !== "whitelist" && p.type !== "blacklist") return;
    const pub = town.economy?.p(id).pub;
    if (!pub) return;
    const has = p.holders.includes(pub);
    onChange({ ...p, holders: has ? p.holders.filter((h) => h !== pub) : [...p.holders, pub] });
  };
  return (
    <li className="wl-pred">
      <div className="wl-pred-h">
        <Tag tone={p.type === "collateralization" ? "metal" : "plain"}>{p.type}</Tag>
        <TextInput value={p.name} onChange={(v) => onChange({ ...p, name: v.replace(/[^\w-]/g, "").slice(0, 32) })} mono aria-label={t("wallet.pol.name")} />
        <Key size="sm" variant="quiet" icon="close" aria-label={t("wallet.pol.remove", { name: p.name })} onClick={onRemove} />
      </div>
      {(p.type === "whitelist" || p.type === "blacklist") && (
        <div className="wl-chips sm" role="group" aria-label={t("wallet.pol.holders")}>
          {PEOPLE.map((id) => {
            const on = p.holders.includes(town.economy?.p(id).pub ?? "-");
            return (
              <button key={id} type="button" aria-pressed={on} className={`wl-chip${on ? " on" : ""}`} onClick={() => toggleHolder(id)}>
                {nameOf(id)}
              </button>
            );
          })}
        </div>
      )}
      {p.type === "whitelist" && (
        <Field label={t("wallet.pol.cap")} help={t("wallet.pol.capHelp")}>
          <AmountInput value={p.max_debt != null ? plainAmount(p.max_debt, 9) : ""} onChange={(v) => onChange({ ...p, max_debt: v.trim() ? parseAmount(v, { id: "erg", symbol: "ERG", decimals: 9 }) : null })} unit="ERG" aria-label={t("wallet.pol.cap")} />
        </Field>
      )}
      {p.type === "collateralization" && (
        <Field label={t("wallet.pol.ratio")} help={t("wallet.pol.ratioHelp")}>
          <TextInput value={String(Math.round(p.min_ratio * 1000) / 10)} onChange={(v) => onChange({ ...p, min_ratio: Math.max(0, Number(v.replace(",", ".")) || 0) / 100 })} inputMode="decimal" trailing={<span className="u">%</span>} />
        </Field>
      )}
      {(p.type === "all_of" || p.type === "any_of") && (
        <div className="wl-chips sm" role="group" aria-label={t("wallet.pol.children")}>
          {others.length === 0 && <span className="t-small">{t("wallet.pol.noOthers")}</span>}
          {others.map((n) => {
            const on = p.predicates.includes(n);
            return (
              <button key={n} type="button" aria-pressed={on} className={`wl-chip mono${on ? " on" : ""}`} onClick={() => onChange({ ...p, predicates: on ? p.predicates.filter((x) => x !== n) : [...p.predicates, n] })}>
                {n}
              </button>
            );
          })}
        </div>
      )}
      {p.type === "not" && (
        <select className="wl-select" value={p.predicate} onChange={(e) => onChange({ ...p, predicate: e.target.value })} aria-label={t("wallet.pol.child")}>
          <option value="">—</option>
          {others.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      )}
    </li>
  );
}

/** A07: evaluate a policy against a resident paying you, with the tracker's own evaluator. */
function TestBox({ cfg }: { cfg: AcceptanceConfig }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const [who, setWho] = useState("bob");
  const [amount, setAmount] = useState("1");
  const value = parseAmount(amount, { id: "erg", symbol: "ERG", decimals: 9 }) ?? 0n;
  const r = useTownView(
    (eco) => {
      if (!eco.participants.has(who)) return null;
      const rec = eco.note(who, YOU, "erg", TOWN_TRACKER);
      const total = (rec?.totalDebt ?? 0n) + value;
      const ctx = acceptanceCtx(eco, who, YOU, "erg", total);
      return { res: evaluateAcceptance(cfg, ctx, "per-recipient"), total, cov: ctx.reserve && ctx.issuerGrossDebt > 0n ? Number(ctx.reserve.collateral) / Number(ctx.issuerGrossDebt) : null };
    },
    [who, value.toString(), cfg],
  );
  const lines = r
    ? traceLines(
        r.res.trace,
        {
          total: f.amt(r.total, ERG, { unit: true }),
          capOf: (n) => {
            const p = cfg.predicates.find((x) => x.name === n);
            return p && p.type === "whitelist" && p.max_debt != null ? f.amt(p.max_debt, ERG, { unit: true }) : null;
          },
          coverage: r.cov === null ? null : f.pct(r.cov),
          ratioOf: (n) => {
            const p = cfg.predicates.find((x) => x.name === n);
            return p && p.type === "collateralization" ? f.pct(p.min_ratio) : null;
          },
          issuer: nameOf(who),
        },
        t,
      )
    : [];
  return (
    <section className="wl-test" aria-labelledby="wl-test-h">
      <h3 className="label" id="wl-test-h">
        <b>{t("wallet.pol.test")}</b>
      </h3>
      <div className="wl-test-row">
        <select className="wl-select" value={who} onChange={(e) => setWho(e.target.value)} aria-label={t("wallet.pol.testWho")}>
          {PEOPLE.map((p) => (
            <option key={p} value={p}>
              {nameOf(p)}
            </option>
          ))}
        </select>
        <AmountInput value={amount} onChange={setAmount} unit="ERG" plus aria-label={t("wallet.pol.testAmount")} />
      </div>
      {r && (
        <>
          <div className={`wl-verdict ${r.res.acceptable ? "ok" : "no"}`}>{f.prose(t(r.res.acceptable ? "wallet.pol.testOk" : "wallet.pol.testNo", { name: nameOf(who), v: f.amt(r.total, ERG, { unit: true }) }))}</div>
          <ul className="wl-trace">
            {lines.map((l, i) => (
              <li key={i} className={l.ok ? "ok" : "no"} style={{ paddingLeft: `${l.depth * 14}px` }}>
                <span aria-hidden="true">{l.ok ? "✓" : "✕"}</span> {f.prose(l.text)} <span className="mono t-small">· {l.tag}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// credit lines (wallet side, outstanding) next to max_debt (policy, lifetime)
// ---------------------------------------------------------------------------------------------

function CreditLines() {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const [denom, setDenom] = useState<DenomId>("erg");
  const v = useTownView(
    (eco) => ({
      denoms: [...eco.denominations.keys()].map((d) => unitOf(eco, d)),
      lines: PEOPLE.map((id) => {
        const rec = eco.participants.has(id) ? eco.note(id, YOU, denom, TOWN_TRACKER) : undefined;
        return { id, line: eco.participants.has(id) ? eco.creditLine(YOU, id, denom) : null, out: rec ? rec.totalDebt - rec.amountRedeemed - rec.waived : 0n };
      }),
    }),
    [denom],
  );
  const [edit, setEdit] = useState<Record<string, string>>({});
  useEffect(() => setEdit({}), [denom]);
  if (!v) return null;
  const unit = v.denoms.find((d) => d.id === denom) ?? ERG;
  const save = async (id: string, limit: bigint | null) => {
    show(await town.setCreditLine({ debtor: id, limit, denom }));
    setEdit((e) => ({ ...e, [id]: "" }));
  };
  return (
    <section className="wl-lines" aria-label={t("wallet.pol.tab.lines")}>
      <Callout tone="policy" title={t("wallet.cl.t")}>
        {t("wallet.cl.b")}
      </Callout>
      {v.denoms.length > 1 && <Seg ariaLabel={t("wallet.denom")} value={denom} onChange={setDenom} options={v.denoms.map((d) => ({ value: d.id, label: d.symbol }))} />}
      <ul className="rows">
        {v.lines.map((l) => {
          const text = edit[l.id] ?? "";
          const val = text.trim() ? parseAmount(text, { id: denom, symbol: unit.symbol, decimals: unit.decimals }) : null;
          return (
            <li key={l.id} className="row wl-line">
              <PartySeal id={l.id} />
              <span className="wl-row-mid">
                <span className="who">{nameOf(l.id)}</span>
                <span className="what">{l.line === null ? t("wallet.cl.none") : f.prose(t("wallet.cl.has", { v: f.amt(l.line, unit, { unit: true }), o: f.amt(l.out, unit) }))}</span>
              </span>
              <span className="wl-line-ed">
                <AmountInput value={text} onChange={(x) => setEdit((e) => ({ ...e, [l.id]: x }))} unit={unit.symbol} aria-label={t("wallet.cl.input", { name: nameOf(l.id) })} />
                <Key size="sm" disabled={val === null || val < 0n} onClick={() => val !== null && void save(l.id, val)}>
                  {t("wallet.cl.set")}
                </Key>
                {l.line !== null && (
                  <Key size="sm" variant="quiet" onClick={() => void save(l.id, null)}>
                    {t("wallet.cl.clear")}
                  </Key>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
