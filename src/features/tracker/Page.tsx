// /tracker: ErgoScan's real tracker on mainnet, and the sandbox town tracker T-01. Three pages share one frame:
//   /tracker/mainnet   the console for ErgoScan's tracker on Ergo mainnet, read-only (src/chain/ours); the menu's
//                      «Трекер», /tracker itself and any unknown /tracker address lead here (query and hash kept)
//   /tracker/practice  the same console for the town tracker T-01 (XL card, controls, ladder, digest timeline,
//                      proofs, events): the switch's second tab, «Учебный», play money
//   /tracker/run       running your own tracker (checklist, contracts, caveats)
//   /tracker/api       the API mirror (what the reference server would answer for the town)
// The console and the mirror need the sandbox engine, so they are their own lazy chunks; /run stays light.
import { Suspense } from "react";
import { lazyChunk, loadParts } from "@/app/chunk";
import { sandboxTown } from "@/app/warm";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { addI18n, useT } from "@/app/lang";
import { typo } from "@/content";
import { Loading, Page } from "@/ui";
import { NetPlaceBar } from "@/app/chrome";
import { useSnapshotCounts } from "@/features/network/counts";
import { trackerHomeOf } from "./parts";
import * as C from "./chunks";
import RunOwn from "./RunOwn";
import strings from "./strings";
import "./tracker.css";

// house typography (thin groups, no-break spaces before units, Russian short words); our strings write their
// own quotes and keep code in backticks, so quote conversion stays off
const typeset = (d: Record<string, string>, lang: "en" | "ru") => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typo(v, lang, { quotes: false })]));
addI18n({ en: typeset(strings.en, "en"), ru: typeset(strings.ru, "ru") });

// rendered at once when a switch has loaded them first (chunks.ts); a direct visit waits as before
const Console = lazyChunk(C.consolePage);
const Mainnet = lazyChunk(C.mainnetPage);
const ApiMirror = lazyChunk(C.apiPage);

function Wait() {
  const t = useT();
  return (
    <div className="container trk-gate">
      <Loading label={t("tracker.loading")} seed="tracker" lines={4} />
    </div>
  );
}

/** A switch loads the page's own chunk (and boots the sandbox town for the practice console and the mirror) first. */
export const warm = (pathname: string, code: boolean) => {
  const c = C.trackerChunkOf(pathname);
  return loadParts([...(c ? [c] : []), ...(C.usesTown(pathname) ? [sandboxTown] : [])], code);
};

/** /tracker and unknown /tracker addresses open ErgoScan's tracker (they used to open the sandbox console). */
function ToTrackerHome() {
  const { search, hash } = useLocation();
  return <Navigate to={trackerHomeOf(search, hash)} replace />;
}

/** The Network place's bar: the practice tracker and the API mirror are the sandbox's (play money), the rest mainnet. */
function TrackerPlaceBar() {
  const { pathname } = useLocation();
  const counts = useSnapshotCounts();
  return <NetPlaceBar counts={counts} sandbox={C.usesTown(pathname)} />;
}

export default function TrackerPage() {
  return (
    <Page wide className="trk">
      {/* the tracker console is part of the Network place: the place's own bar, the same as on /network, this page lit */}
      <div className="container"><TrackerPlaceBar /></div>
      <Suspense fallback={<Wait />}>
        <Routes>
          <Route index element={<ToTrackerHome />} />
          <Route path="mainnet" element={<Mainnet />} />
          <Route path="practice" element={<Console />} />
          <Route path="run" element={<RunOwn />} />
          <Route path="api" element={<ApiMirror />} />
          <Route path="*" element={<ToTrackerHome />} />
        </Routes>
      </Suspense>
    </Page>
  );
}
