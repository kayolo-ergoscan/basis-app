// /tracker: ErgoScan's real tracker on mainnet, and the sandbox town tracker T-01. Three pages share one frame:
//   /tracker/mainnet   the console for ErgoScan's tracker on Ergo mainnet, read-only (src/chain/ours); the menu's
//                      «Трекер», /tracker itself and any unknown /tracker address lead here (query and hash kept)
//   /tracker/practice  the same console for the town tracker T-01 (XL card, controls, ladder, digest timeline,
//                      proofs, events): the switch's second tab, «Учебный», play money
//   /tracker/run       running your own tracker (checklist, contracts, caveats)
//   /tracker/api       the API mirror (what the reference server would answer for the town)
// The console and the mirror need the sandbox engine, so they are their own lazy chunks; /run stays light.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { addI18n, useT } from "@/app/lang";
import { typo } from "@/content";
import { Loading, Page } from "@/ui";
import { NetPlaceNav } from "@/app/chrome";
import { trackerHomeOf } from "./parts";
import RunOwn from "./RunOwn";
import strings from "./strings";
import "./tracker.css";

// house typography (thin groups, no-break spaces before units, Russian short words); our strings write their
// own quotes and keep code in backticks, so quote conversion stays off
const typeset = (d: Record<string, string>, lang: "en" | "ru") => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typo(v, lang, { quotes: false })]));
addI18n({ en: typeset(strings.en, "en"), ru: typeset(strings.ru, "ru") });

const Console = lazy(() => import("./Console"));
const Mainnet = lazy(() => import("./Mainnet"));
const ApiMirror = lazy(() => import("./ApiMirror"));

function Wait() {
  const t = useT();
  return (
    <div className="container trk-gate">
      <Loading label={t("tracker.loading")} seed="tracker" lines={4} />
    </div>
  );
}

/** /tracker and unknown /tracker addresses open ErgoScan's tracker (they used to open the sandbox console). */
function ToTrackerHome() {
  const { search, hash } = useLocation();
  return <Navigate to={trackerHomeOf(search, hash)} replace />;
}

export default function TrackerPage() {
  return (
    <Page wide className="trk">
      {/* the tracker console is part of the Network place: its sub-nav, with this page lit */}
      <div className="container"><div className="trk-place"><NetPlaceNav /></div></div>
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
