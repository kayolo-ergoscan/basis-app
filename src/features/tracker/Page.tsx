// /tracker: the sandbox town tracker T-01. Three pages share one frame:
//   /tracker      the console (XL card, controls, ladder, digest timeline, proofs, events)
//   /tracker/run  running your own tracker (checklist, contracts, caveats)
//   /tracker/api  the API mirror (what the reference server would answer for the town)
// The console and the mirror need the sandbox engine, so they are their own lazy chunks; /run stays light.
import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { addI18n, useT } from "@/app/lang";
import { typo } from "@/content";
import { Loading, Page } from "@/ui";
import RunOwn from "./RunOwn";
import strings from "./strings";
import "./tracker.css";

// house typography (thin groups, no-break spaces before units, Russian short words); our strings write their
// own quotes and keep code in backticks, so quote conversion stays off
const typeset = (d: Record<string, string>, lang: "en" | "ru") => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, typo(v, lang, { quotes: false })]));
addI18n({ en: typeset(strings.en, "en"), ru: typeset(strings.ru, "ru") });

const Console = lazy(() => import("./Console"));
const ApiMirror = lazy(() => import("./ApiMirror"));

function Wait() {
  const t = useT();
  return (
    <div className="container trk-gate">
      <Loading label={t("tracker.loading")} seed="tracker" lines={4} />
    </div>
  );
}

export default function TrackerPage() {
  return (
    <Page wide className="trk">
      <Suspense fallback={<Wait />}>
        <Routes>
          <Route index element={<Console />} />
          <Route path="run" element={<RunOwn />} />
          <Route path="api" element={<ApiMirror />} />
          <Route path="*" element={<Navigate to="/tracker" replace />} />
        </Routes>
      </Suspense>
    </Page>
  );
}
