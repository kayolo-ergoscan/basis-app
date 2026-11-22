// Request (P09, M02, K10) and Scan: a request is a link + QR that opens Pay for you; in the sandbox you can also
// send it to a resident, who answers after a few blocks: pays when its policy allows, or declines with a reason.
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useT } from "@/app/lang";
import { isDenomId, type DenomId } from "@/protocol";
import { AmountInput, Callout, CopyButton, Field, Key, Lamp, Seg, Tag, TextInput } from "@/ui";
import { parseAmount, REQUEST_LIMITS, town, TOWN_TRACKER, useClock, useTown, useTownView, YOU, type PaymentRequest } from "@/world";
import { useFmt, useNameOf, useOutcomeToast, useWT } from "../lib/hooks";
import { makePayLink, parsePayLink, resolveParty, unitOf, type Unit } from "../lib/model";
import { QrCode } from "../lib/qr";
import { Frame, PartySeal } from "../parts/bits";

const RESIDENT_IDS = Object.keys(REQUEST_LIMITS);

export function RequestFlow({ page }: { page: boolean }) {
  const t = useT();
  const f = useFmt();
  const nameOf = useNameOf();
  const show = useOutcomeToast();
  const [sp] = useSearchParams();
  const denoms = useTownView((eco) => [...eco.denominations.keys()].map((d) => unitOf(eco, d)), []) ?? [];
  const youPub = useTownView((eco) => (eco.participants.has(YOU) ? eco.p(YOU).pub : null), []);
  const [from, setFrom] = useState<string>(sp.get("from") && RESIDENT_IDS.includes(sp.get("from")!) ? sp.get("from")! : "");
  const [denom, setDenom] = useState<DenomId>("erg");
  const [amount, setAmount] = useState(sp.get("amount") ?? "");
  const [memo, setMemo] = useState("");
  const [made, setMade] = useState<{ link: string; id?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const unit: Unit = denoms.find((d) => d.id === denom) ?? { id: "erg", symbol: "ERG", decimals: 9 };
  const value = amount.trim() ? parseAmount(amount, { id: denom, symbol: unit.symbol, decimals: unit.decimals }) : null;
  const invalid = amount.trim() !== "" && (value === null || value <= 0n);
  const limit = from ? REQUEST_LIMITS[from]?.[denom] ?? null : null;
  const over = limit !== null && value !== null && value > limit;
  const noDenom = !!from && limit === null;

  const create = async () => {
    if (!youPub || !value || value <= 0n) return;
    const link = makePayLink(window.location.origin, { to: youPub, amount: amount.trim().replace(",", "."), denom, memo: memo.trim() || undefined, tracker: TOWN_TRACKER });
    if (!from) {
      setMade({ link });
      return;
    }
    setBusy(true);
    try {
      const out = await town.request({ from, amount: value, denom, memo: memo.trim() || undefined });
      show(out);
      if (out.ok) setMade({ link, id: out.requestId });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Frame page={page} title={t("wallet.req.title")} sub={t("wallet.req.sub")} labelId="wl-req-h" className="wl-flow">
      {made ? (
        <RequestMade link={made.link} id={made.id} onNew={() => setMade(null)} />
      ) : (
        <div className="wl-form">
          <div>
            <div className="label wl-lbl">
              <b>{t("wallet.req.from")}</b>
            </div>
            <div className="wl-chips" role="radiogroup" aria-label={t("wallet.req.from")}>
              <button type="button" role="radio" aria-checked={from === ""} className={`wl-chip${from === "" ? " on" : ""}`} onClick={() => setFrom("")}>
                <span className="wl-chip-any" aria-hidden="true">
                  ⌁
                </span>
                {t("wallet.req.anyone")}
              </button>
              {RESIDENT_IDS.map((id) => (
                <button key={id} type="button" role="radio" aria-checked={from === id} className={`wl-chip${from === id ? " on" : ""}`} onClick={() => setFrom(id)}>
                  <PartySeal id={id} size="sm" />
                  {nameOf(id)}
                </button>
              ))}
            </div>
            <p className="t-small wl-help">{from ? f.prose(t("wallet.req.fromHint", { name: nameOf(from), v: limit === null ? "—" : f.amt(limit, unit, { unit: true }) })) : t("wallet.req.anyoneHint")}</p>
          </div>
          {denoms.length > 1 && <Seg ariaLabel={t("wallet.denom")} value={denom} onChange={(d) => setDenom(d)} options={denoms.map((d) => ({ value: d.id, label: d.symbol }))} />}
          <Field label={t("wallet.req.amount")} error={invalid ? t("wallet.amount.invalid") : over ? f.prose(t("wallet.req.over", { name: nameOf(from), v: f.amt(limit ?? 0n, unit, { unit: true }) })) : noDenom ? t("wallet.req.noDenom", { name: nameOf(from), d: unit.symbol }) : undefined}>
            <AmountInput value={amount} onChange={setAmount} unit={unit.symbol} invalid={invalid || over} aria-label={t("wallet.req.amount")} />
          </Field>
          <Field label={t("wallet.pay.memo")} help={t("wallet.req.memoHelp")}>
            <TextInput value={memo} onChange={(x) => setMemo(x.slice(0, 80))} placeholder={t("wallet.req.memoPh")} />
          </Field>
          <Callout tone="info">{t("wallet.req.what")}</Callout>
          <div className="wl-act">
            <Key variant="primary" size="lg" block icon="request" disabled={!value || value <= 0n || busy || noDenom || !youPub} onClick={() => void create()}>
              {from ? t("wallet.req.send", { name: nameOf(from) }) : t("wallet.req.make")}
            </Key>
          </div>
        </div>
      )}
      <RequestList exclude={made?.id} />
    </Frame>
  );
}

function RequestMade({ link, id, onNew }: { link: string; id?: string; onNew: () => void }) {
  const t = useT();
  const req = useTown((s) => s.requests.find((r) => r.id === id) ?? null);
  return (
    <div className="wl-form wl-made">
      {req && (
        <ul className="rows wl-made-st">
          <RequestLine r={req} big />
        </ul>
      )}
      <div className="wl-qr-wrap">
        <QrCode text={link} size={224} label={t("wallet.req.qrAria")} />
        <div className="wl-qr-t">
          <div className="label">
            <b>{t("wallet.req.link")}</b>
          </div>
          <code className="wl-link mono">{link}</code>
          <div className="wl-act">
            <CopyButton value={link} label={t("wallet.req.copy")} />
          </div>
          <p className="t-small">{t("wallet.req.linkNote")}</p>
        </div>
      </div>
      <div className="wl-act">
        <Key variant="quiet" icon="plus" onClick={onNew}>
          {t("wallet.req.another")}
        </Key>
      </div>
    </div>
  );
}

function RequestLine({ r, big }: { r: PaymentRequest; big?: boolean }) {
  const t = useT();
  const f = useFmt();
  const wt = useWT();
  const nameOf = useNameOf();
  const { height } = useClock();
  const show = useOutcomeToast();
  const unit = useTownView((eco) => unitOf(eco, r.denom), [r.denom]) ?? { id: "erg", symbol: "ERG", decimals: 9 };
  const lamp = r.status === "paid" ? "live" : r.status === "pending" ? "tracked" : r.status === "cancelled" ? "stale" : "alarm";
  const left = Math.max(0, r.dueHeight - height);
  return (
    <li className={`wl-reqline${big ? " big" : ""}`}>
      <PartySeal id={r.from} size="sm" badge={<Lamp state={lamp} size={7} />} />
      <span className="wl-row-mid">
        <span className="who">
          {nameOf(r.from)} · <span className="num">{f.amt(r.amount, unit, { unit: true })}</span>
        </span>
        <span className="what">
          {/* a paid request already carries the Paid tag on the right: the line keeps only the memo */}
          {[
            r.status === "paid" ? "" : wt(`world.request.status.${r.status}`),
            r.status === "pending" ? t("wallet.req.answerIn", { n: f.blocks(left) }) : "",
            r.memo ? (t.lang === "ru" ? `«${r.memo}»` : `“${r.memo}”`) : "",
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {(r.status === "declined" || r.status === "refused") && r.code && <span className="t-small wl-reason">{f.prose(wt(`world.code.${r.code}`, { name: nameOf(r.from) }))}</span>}
      </span>
      {r.status === "pending" ? (
        <Key size="sm" variant="quiet" onClick={() => void town.cancelRequest(r.id).then((o) => show(o))}>
          {t("wallet.cancel")}
        </Key>
      ) : r.status === "paid" ? (
        <Tag tone="up">{t("wallet.req.paid")}</Tag>
      ) : (
        <span />
      )}
    </li>
  );
}

function RequestList({ exclude }: { exclude?: string }) {
  const t = useT();
  const reqs = useTown((s) => s.requests.filter((r) => r.to === YOU && r.id !== exclude));
  if (!reqs.length) return null;
  const list = reqs.slice().sort((a, b) => b.createdHeight - a.createdHeight).slice(0, 8);
  return (
    <section className="wl-reqs" aria-labelledby="wl-reqs-h">
      <h3 className="label" id="wl-reqs-h">
        <b>{t("wallet.req.list")}</b> · {reqs.length}
      </h3>
      <ul className="rows">
        {list.map((r) => (
          <RequestLine key={r.id} r={r} />
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Scan: paste a link (or read a QR with the camera where the browser has BarcodeDetector)
// ---------------------------------------------------------------------------------------------

interface Detector {
  detect(src: CanvasImageSource): Promise<Array<{ rawValue: string }>>;
}
type DetectorCtor = new (o: { formats: string[] }) => Detector;

export function ScanFlow({ page }: { page: boolean }) {
  const t = useT();
  const f = useFmt();
  const nav = useNavigate();
  const nameOf = useNameOf();
  const [text, setText] = useState("");
  const [cam, setCam] = useState<"off" | "on" | "denied">("off");
  const video = useRef<HTMLVideoElement>(null);
  const hasDetector = typeof window !== "undefined" && "BarcodeDetector" in window;
  const parsed = useMemo(() => (text.trim() ? parsePayLink(text) : null), [text]);
  const eco = useTown((s) => s.eco);
  const sample = useTownView((e) => (e.participants.has("cafe") ? makePayLink(window.location.origin, { to: e.p("cafe").pub, amount: "0.40", memo: t("wallet.scan.sampleMemo") }) : null), [t.lang]);
  const ok = parsed && !("error" in parsed) ? parsed : null;
  const who = ok && eco ? resolveParty(eco, ok.to) : null;
  const unit = useTownView(
    (e) => {
      const d = ok?.denom;
      return d && isDenomId(d) && e.denominations.has(d) ? unitOf(e, d) : unitOf(e, "erg");
    },
    [ok?.denom],
  );

  useEffect(() => {
    if (cam !== "on") return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stop = false;
    const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor }).BarcodeDetector;
    const det = new Ctor({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
        if (stop || !video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        const loop = async () => {
          if (stop || !video.current) return;
          try {
            const codes = await det.detect(video.current);
            if (codes[0]?.rawValue) {
              setText(codes[0].rawValue);
              setCam("off");
              return;
            }
          } catch {
            /* next frame */
          }
          raf = window.setTimeout(() => void loop(), 250);
        };
        void loop();
      } catch {
        setCam("denied");
      }
    })();
    return () => {
      stop = true;
      window.clearTimeout(raf);
      stream?.getTracks().forEach((x) => x.stop());
    };
  }, [cam]);

  const open = () => {
    if (!ok || !who) return;
    const q = new URLSearchParams({ to: who });
    if (ok.amount) q.set("amount", ok.amount);
    if (ok.denom) q.set("denom", ok.denom);
    if (ok.memo) q.set("memo", ok.memo);
    nav(`/wallet/pay?${q.toString()}`);
  };

  return (
    <Frame page={page} title={t("wallet.scan.title")} sub={t("wallet.scan.sub")} labelId="wl-scan-h" className="wl-flow">
      <div className="wl-form">
        {hasDetector && (
          <div className="wl-cam">
            {cam === "on" ? (
              <>
                <video ref={video} className="wl-video" muted playsInline aria-label={t("wallet.scan.camAria")} />
                <Key variant="quiet" size="sm" onClick={() => setCam("off")}>
                  {t("wallet.scan.camStop")}
                </Key>
              </>
            ) : (
              <Key variant="default" icon="scan" onClick={() => setCam("on")}>
                {t("wallet.scan.cam")}
              </Key>
            )}
            {cam === "denied" && <p className="t-small">{t("wallet.scan.denied")}</p>}
          </div>
        )}
        <Field label={t("wallet.scan.paste")} error={parsed && "error" in parsed ? t(`wallet.scan.err.${parsed.error}`) : ok && !who ? t("wallet.scan.err.stranger") : undefined} help={t("wallet.scan.help")}>
          <TextInput value={text} onChange={setText} mono placeholder="https://…/wallet/pay?to=02…" />
        </Field>
        {ok && who && unit && (
          <div className="card wl-scan-prev">
            <div className="card-b">
              <div className="who-line">
                <PartySeal id={who} size="lg" />
                <div>
                  <div className="t-h4">{t("wallet.scan.asks", { name: nameOf(who) })}</div>
                  <div className="t-small">{ok.memo ? (t.lang === "ru" ? `«${ok.memo}»` : `“${ok.memo}”`) : t("wallet.scan.noMemo")}</div>
                </div>
              </div>
              {ok.amount ? (
                <div className="t-money wl-scan-amt">
                  {ok.amount.replace(",", ".")}
                  <span className="u-unit">{unit.symbol}</span>
                </div>
              ) : (
                <div className="t-body">{t("wallet.scan.anyAmount")}</div>
              )}
              {ok.tracker && ok.tracker !== TOWN_TRACKER && <Callout tone="alarm">{t("wallet.scan.otherTracker", { id: ok.tracker })}</Callout>}
              <Key variant="primary" block icon="pay" onClick={open}>
                {t("wallet.scan.open")}
              </Key>
            </div>
          </div>
        )}
        {!text && sample && (
          <button type="button" className="wl-sample" onClick={() => setText(sample)}>
            <span className="label">{t("wallet.scan.sample")}</span>
            <span>{t("wallet.scan.sampleText")}</span>
          </button>
        )}
      </div>
    </Frame>
  );
}
