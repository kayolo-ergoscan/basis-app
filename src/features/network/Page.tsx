// /network — mainnet, read-only (VISUAL §13). One frame (the network bar: sections + live status), sub-routes inside.
// Data comes only from the @/chain hooks: the snapshot "as of block N" merged with live polling inside the budget.
import { Route, Routes } from "react-router-dom";
import { addI18n, useT } from "@/app";
import { Empty, ErrorState, Page } from "@/ui";
import { chain, useChainStatus, useObservatory } from "@/chain";
import { loadParts } from "@/app/chunk";
import { snapshot } from "@/app/warm";
import strings from "./strings";
import { NetBar, NetLoading } from "./parts";
import Overview from "./Overview";
import { ReserveDetail, ReservesList } from "./Reserves";
import { TrackerDetail, TrackersList } from "./Trackers";
import { RedemptionsPage, TxPage } from "./Redemptions";
import { ContractsPage } from "./Contracts";
import { IncidentsPage } from "./Incidents";
import "./network.css";

addI18n(strings);

/** A switch loads the observatory snapshot first, so the page shows its numbers from the first frame. */
export const warm = (_pathname: string, code: boolean) => loadParts([snapshot], code);

export default function NetworkPage() {
  const t = useT();
  const obs = useObservatory();
  const st = useChainStatus();
  const seedFailed = !obs && !!st.lastError?.startsWith("seed:");
  const need = (el: (o: NonNullable<typeof obs>) => JSX.Element) => (obs ? el(obs) : <NetLoading />);
  return (
    <Page className="nw">
      <NetBar obs={obs} />
      {seedFailed ? (
        <div className="nw-missing">
          <ErrorState title={t("network.error.seed.title")} text={t("network.error.seed.text")} detail={st.lastError ?? undefined}
            onRetry={() => void chain.ensureSeed()} retryLabel={t("network.retry")} />
        </div>
      ) : (
        <Routes>
          <Route index element={need((o) => <Overview obs={o} />)} />
          <Route path="reserves" element={need((o) => <ReservesList obs={o} />)} />
          <Route path="reserve/:boxId" element={<ReserveDetail obs={obs} />} />
          <Route path="trackers" element={need((o) => <TrackersList obs={o} />)} />
          <Route path="tracker/:nft" element={<TrackerDetail obs={obs} />} />
          <Route path="redemptions" element={need((o) => <RedemptionsPage obs={o} />)} />
          <Route path="tx/:txId" element={<TxPage obs={obs} />} />
          <Route path="contracts" element={need((o) => <ContractsPage obs={o} />)} />
          <Route path="incidents" element={need((o) => <IncidentsPage obs={o} />)} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      )}
    </Page>
  );
}

function NotFound() {
  const t = useT();
  return (
    <div className="nw-missing">
      <Empty title={t("network.nf.title")} text={t("network.nf.text")} ghost={t("network.nf.ghost")}
        action={{ label: t("network.nf.back"), to: "/network" }} />
    </div>
  );
}
