// /learn/api — the reference tracker's HTTP API (content trackerApi.ts): first the ready-made programs that already
// speak it and what ErgoScan's tracker accepts from them (#clients, ApiClients.tsx), then the basics (envelope, auth,
// codes, limits), the traps, and every endpoint grouped, searchable, deep-linkable (#ep-<id>), with examples.
import { useEffect, useMemo, useState } from "react";
import { rich, useT } from "@/app";
import { Callout, CopyButton, Icon, Key, TextInput, int } from "@/ui";
import { apiEndpoints, apiGroups, pick, trackerApi, type ApiEndpoint } from "@/content";
import { BookHead, Pager, Sec, SourceLinks, inline, plainTitle, useBookSections } from "../layout";
import { ApiClients, CLIENTS_SECTION } from "./ApiClients";

/** A one-line JSON body longer than a panel reads better indented; anything else (GET lines, shaped text) stays as written. */
function pretty(x: string): string {
  // 16+ digits could be a u64 that JSON.parse would round: leave those bodies exactly as written
  if (x.length < 64 || x.includes("\n") || !/^\s*[{[]/.test(x) || /\d{16,}/.test(x)) return x;
  try { return JSON.stringify(JSON.parse(x), null, 2); } catch { return x; }
}

function norm(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е");
}

export default function ApiPage() {
  const t = useT();
  const L = t.lang;
  const P = (x: Parameters<typeof pick>[0]) => pick(x, L);
  const [q, setQ] = useState("");
  const [hash, setHash] = useState(() => (typeof window !== "undefined" ? window.location.hash.slice(1) : ""));
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useBookSections([
    { id: CLIENTS_SECTION, label: plainTitle(t("learn.api.s.clients")) },
    { id: "basics", label: plainTitle(t("learn.api.s.basics")) },
    { id: "gotchas", label: plainTitle(t("learn.api.s.gotchas")) },
    { id: "endpoints", label: plainTitle(t("learn.api.s.endpoints")) },
  ]);

  const shown = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return apiEndpoints;
    return apiEndpoints.filter((e) => norm([e.method, e.path, e.id, e.purpose.en, e.purpose.ru, e.group, e.role, e.ergoscan ? "ergoscan" : ""].join(" ")).includes(n));
  }, [q]);

  return (
    <article>
      <BookHead id="api" lede={P(trackerApi.lede)} meta={<span className="label">{t.p("learn.ix.count.api", apiEndpoints.length)}</span>} />

      <ApiClients />

      <Sec id="basics" title={rich(t("learn.api.s.basics"))}>
        <Callout tone="calm" className="lrn-callout">{P(trackerApi.noPublicTracker)} {P(trackerApi.illustrative)}</Callout>
        <div className="api-ref cols" style={{ marginTop: 20 }}>
          <div>
            <div>
              <span className="label"><b>{P(trackerApi.envelope.title)}</b></span>
              <div className="api-pre" style={{ marginTop: 12 }}><pre>{trackerApi.envelope.shape}</pre></div>
              <p className="t-small" style={{ marginTop: 12 }}>{inline(P(trackerApi.envelope.text))}</p>
            </div>
            <div>
              <span className="label"><b>{t("learn.api.codes")}</b></span>
              <div className="api-codes">
                {trackerApi.statusCodes.map((c) => <div key={c.status}><b>{c.status}</b><span>{inline(P(c.text))}</span></div>)}
              </div>
            </div>
          </div>
          <div>
            <div>
              <span className="label"><b>{P(trackerApi.auth.title)}</b></span>
              <p className="t-small" style={{ marginTop: 10 }}>{inline(P(trackerApi.auth.text))}</p>
              <div className="api-auth">
                {trackerApi.auth.modes.map((m) => (
                  <div key={m.id}>
                    <b>{m.id}</b>
                    <div>
                      <span className="t-small">{inline(P(m.text))}</span>
                      {m.headers.length > 0 && <div className="hd">{m.headers.map((h) => <code key={h}>{h}</code>)}</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <span className="label"><b>{t("learn.api.limits")}</b></span>
              <div className="api-limits">
                {trackerApi.limits.map((l) => <div key={l.id}><b>{/^\d{4,}$/.test(l.value) ? int(Number(l.value)) : l.value}</b><span>{inline(P(l.text))}</span></div>)}
              </div>
              <div className="lrn-c" style={{ marginTop: 18 }}><SourceLinks ids={trackerApi.sources} /></div>
            </div>
          </div>
        </div>
      </Sec>

      <Sec id="gotchas" title={rich(t("learn.api.s.gotchas"))}>
        <div className="api-gotchas" style={{ maxWidth: 820 }}>
          {trackerApi.gotchas.map((g, i) => (
            <div className="api-gotcha" key={i}><span className="g" aria-hidden="true">!</span><span>{inline(P(g))}</span></div>
          ))}
        </div>
      </Sec>

      <Sec id="endpoints" title={rich(t("learn.api.s.endpoints"))}>
        <div className="api-tools">
          <TextInput value={q} onChange={setQ} icon="search" placeholder={t("learn.api.search")} aria-label={t("learn.api.search")} type="search" />
          <span className="api-count" aria-live="polite">{t("learn.api.shown", { n: shown.length, total: apiEndpoints.length })}</span>
        </div>
        {shown.length === 0 ? (
          <div className="api-empty">
            {t("learn.api.none", { q })} <Key size="sm" variant="quiet" onClick={() => setQ("")}>{t("learn.api.clear")}</Key>
          </div>
        ) : (
          apiGroups.map((g) => {
            const eps = shown.filter((e) => e.group === g.id);
            if (!eps.length) return null;
            return (
              <div className="api-group" key={g.id}>
                <div className="api-group-h">
                  <div>
                    <h3>{P(g.title)}</h3>
                    <p>{inline(P(g.lede))}</p>
                  </div>
                  <span className="label">{eps.length}</span>
                </div>
                {eps.map((e) => <Endpoint key={e.id} e={e} open={hash === `ep-${e.id}` || (!!q.trim() && shown.length <= 3)} />)}
              </div>
            );
          })
        )}
      </Sec>

      <Pager id="api" />
    </article>
  );
}

function Endpoint({ e, open }: { e: ApiEndpoint; open: boolean }) {
  const t = useT();
  const L = t.lang;
  const P = (x: Parameters<typeof pick>[0]) => pick(x, L);
  const [isOpen, setOpen] = useState(open);
  useEffect(() => { if (open) setOpen(true); }, [open]);
  return (
    <details className="api-ep" id={`ep-${e.id}`} open={isOpen} onToggle={(ev) => setOpen((ev.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className={e.method === "POST" ? "api-m post" : "api-m"}>{e.method}</span>
        <span className="path">{e.path.split("/").map((seg, i) => i === 0 ? seg : <span key={i}><wbr />/{seg}</span>)}{e.legacy && <> <span className="api-legacy">{t("learn.api.legacy")}</span></>}</span>
        <span className="pur">{inline(P(e.purpose))}</span>
        <span className={e.role === "admin" ? "role admin" : "role"}>{P(trackerApi.roles[e.role])}</span>
        <Icon name="down" size={16} className="chev" />
      </summary>
      {isOpen && (
        <div className="api-body">
          {e.ergoscan && e.ergoscan.length > 0 && (
            <div>
              <span className="label">{t("learn.api.ours")}</span>
              <div className="api-ours" style={{ marginTop: 8 }}>
                {e.ergoscan.map((x, i) => <p key={i}>{inline(P(x))}</p>)}
              </div>
            </div>
          )}
          {e.query && e.query.length > 0 && (
            <div><span className="label">{t("learn.api.query")}</span> <span className="mono t-small">{e.query.join(" · ")}</span></div>
          )}
          <div className="api-code">
            {e.request && (
              <div className="api-pre">
                <div className="h"><span className="label">{t("learn.api.request")}</span><CopyButton value={e.request} small /></div>
                <pre>{pretty(e.request)}</pre>
              </div>
            )}
            <div className="api-pre" style={!e.request ? { gridColumn: "1 / -1" } : undefined}>
              <div className="h"><span className="label">{t("learn.api.response", { s: e.status ?? 200 })}</span><CopyButton value={e.response} small /></div>
              <pre>{e.response}</pre>
            </div>
          </div>
          {e.errors && e.errors.length > 0 && (
            <div>
              <span className="label">{t("learn.api.errors")}</span>
              <div className="api-errs" style={{ marginTop: 8 }}>
                {e.errors.map((x, i) => (
                  <div className="api-err" key={i}><span className="s">{x.status}</span><span><code>{x.message}</code>{x.when ? <> · {inline(P(x.when))}</> : null}</span></div>
                ))}
              </div>
            </div>
          )}
          {e.gotchas && e.gotchas.length > 0 && (
            <div>
              <span className="label">{t("learn.api.watch")}</span>
              <div className="api-gotchas" style={{ marginTop: 8 }}>
                {e.gotchas.map((g, i) => <div className="api-gotcha" key={i}><span className="g" aria-hidden="true">!</span><span>{inline(P(g))}</span></div>)}
              </div>
            </div>
          )}
        </div>
      )}
    </details>
  );
}
