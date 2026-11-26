// /learn/api#clients — the ready-made programs of the reference software (basis-cli, basis-ui, basis-mcp) and what
// ErgoScan's tracker accepts from them (content clients.ts). The only place on the site with these facts: the tracker's
// "Code" card and the ⌘K bar link here (CLIENTS_HREF), so the section id below is that anchor.
import type { ReactNode } from "react";
import { rich, useT } from "@/app";
import { Callout, Icon, Tag } from "@/ui";
import { apiEndpoints, clientPrograms, clients, GIT_REF_SHORT, pick, type ClientRouteGroup, type Text } from "@/content";
import { Sec, inline } from "../layout";

export const CLIENTS_SECTION = "clients";

/** A catalogue path that may break after each slash on a phone. */
function breakable(path: string): ReactNode {
  return path.split("/").map((seg, i) => (i === 0 ? seg : <span key={i}><wbr />/{seg}</span>));
}

function RouteList({ kind, groups }: { kind: "yes" | "no"; groups: readonly ClientRouteGroup[] }) {
  const t = useT();
  const P = (x: Text) => pick(x, t.lang);
  return (
    <div className={`api-cl-side ${kind}`} role="group" aria-labelledby={`${CLIENTS_SECTION}-${kind}`}>
      <h4 id={`${CLIENTS_SECTION}-${kind}`}>
        <Icon name={kind === "yes" ? "check" : "close"} size={16} />
        {t(`learn.api.cl.${kind}`)}
      </h4>
      {groups.map((g) => (
        <div className="api-cl-grp" key={g.id}>
          <b>{P(g.title)}</b>
          <div className="api-cl-paths">
            {g.paths?.map((p) => <code key={p}>{p}</code>)}
            {g.endpoints.map((id) => {
              const e = apiEndpoints.find((x) => x.id === id);
              if (!e) return null;
              return (
                <a key={id} href={`#ep-${id}`} title={P(e.purpose)}>
                  <code>{e.method === "POST" && <span className="m">POST</span>}{breakable(e.path)}</code>
                </a>
              );
            })}
          </div>
          {g.text && <p>{inline(P(g.text))}</p>}
        </div>
      ))}
    </div>
  );
}

export function ApiClients() {
  const t = useT();
  const P = (x: Text) => pick(x, t.lang);
  return (
    <Sec id={CLIENTS_SECTION} first title={rich(t("learn.api.s.clients"))} lede={P(clients.lede)}>
      <ul className="api-cl-cards">
        {clientPrograms.map((c) => (
          <li className="api-cl-card" key={c.id}>
            <div className="api-cl-h">
              <h3>{c.name}</h3>
              <Tag>{c.tag}</Tag>
            </div>
            <p className="api-cl-line">{inline(P(c.line))}</p>
            <ul className="api-cl-does">
              {c.does.map((d, i) => <li key={i}>{inline(P(d))}</li>)}
            </ul>
            {c.note && <p className="api-cl-note">{inline(P(c.note))}</p>}
            <div className="api-cl-end">
              <div className="api-cl-with">
                <span className="label">{t("learn.api.cl.with")}</span>
                <p><Icon name="check" size={15} /><span><b>{t("learn.api.cl.yes")}:</b> {P(clients.withTracker.yes)}</span></p>
                <p><Icon name="close" size={15} /><span><b>{t("learn.api.cl.no")}:</b> {P(clients.withTracker.no)}</span></p>
              </div>
              <a className="api-cl-code" href={c.url} target="_blank" rel="noreferrer" title={t("learn.api.cl.code", { crate: c.crate, ref: GIT_REF_SHORT })}>
                <Icon name="github" size={15} />
                <span>{c.crate}</span>
                <span className="ref">{GIT_REF_SHORT}</span>
                <Icon name="ext" size={12} />
              </a>
            </div>
          </li>
        ))}
      </ul>
      <p className="api-cl-foot">{P(clients.foot)}</p>

      <Callout tone="info" icon="warn" className="lrn-callout api-cl-redeem">{P(clients.redemption)}</Callout>

      <h3 className="lrn-h3">{t("learn.api.cl.routes")}</h3>
      <p className="api-cl-lede">{P(clients.routesLede)}</p>
      <div className="api-cl-routes">
        <RouteList kind="yes" groups={clients.accepted} />
        <RouteList kind="no" groups={clients.refused} />
      </div>
    </Sec>
  );
}
