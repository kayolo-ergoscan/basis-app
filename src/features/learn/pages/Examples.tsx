// Working examples against ErgoScan's tracker (content trackerExamples.ts): a command and the live answer it gave, one
// call per row, the first one open. /learn/developers and the start of /learn/api render the same list.
import type { ReactNode } from "react";
import { useT } from "@/app";
import { CopyButton, Icon } from "@/ui";
import { ERGOSCAN_TRACKER_URL, TRACKER_EXAMPLES_DATE, apiEndpoints, pick, trackerExamples } from "@/content";
import { inline } from "../layout";

/** The tracker's public address with a copy key (the label names it). */
export function TrackerAddress({ label, copy }: { label: ReactNode; copy: string }) {
  return (
    <div className="api-cl-addr dx-addr">
      <span className="label">{label}</span>
      <code>{ERGOSCAN_TRACKER_URL}</code>
      <CopyButton value={ERGOSCAN_TRACKER_URL} label={copy} small />
    </div>
  );
}

/** The examples; `entry` is where an endpoint's catalogue entry lives (a link on the API page itself, a route elsewhere). */
export function TrackerExamples({ entry }: { entry: (id: string) => ReactNode }) {
  const t = useT();
  const L = t.lang;
  const date = new Intl.DateTimeFormat(L === "ru" ? "ru-RU" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${TRACKER_EXAMPLES_DATE}T12:00:00Z`));
  return (
    <div className="dx-list">
      {trackerExamples.map((x, i) => {
        const e = apiEndpoints.find((ep) => ep.id === x.endpoint);
        return (
          <details className="api-ep dx" key={x.endpoint} open={i === 0}>
            <summary>
              <span className={e?.method === "POST" ? "api-m post" : "api-m"}>{e?.method ?? "GET"}</span>
              <span className="path">{e?.path}</span>
              <span className="pur">{pick(x.title, L)}</span>
              <Icon name="down" size={16} className="chev" />
            </summary>
            <div className="dx-body">
              <div className="api-code">
                <div className="api-pre">
                  <div className="h"><span className="label">{t("learn.dx.curl")}</span><CopyButton value={x.curl} small /></div>
                  <pre>{x.curl}</pre>
                </div>
                <div className="api-pre">
                  <div className="h"><span className="label">{t("learn.dx.answer", { date })}</span></div>
                  <pre>{x.response}</pre>
                </div>
              </div>
              <p className="dx-read">{inline(pick(x.read, L))} {entry(x.endpoint)}</p>
            </div>
          </details>
        );
      })}
    </div>
  );
}
