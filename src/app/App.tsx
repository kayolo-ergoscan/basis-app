// The app shell: router, nav, banner, routes discovered from src/features/*/route.tsx, live tape, footer, tab bar,
// ⌘K, shortcuts, toasts.
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster } from "@/ui/components/Toast";
import { Banner, Footer, LiveTape, Nav, TabBar } from "./chrome";
import { preloadFonts } from "./fonts-preload";
import { NotFound, RouteFrame, ScrollManager } from "./frame";
import { useLang, useT } from "./lang";
import { HelpSheet, Palette, Shortcuts } from "./overlays";
import { ROUTES } from "./routes";

function Boot() {
  const { lang } = useLang();
  useEffect(() => { preloadFonts(lang); }, [lang]);
  return null;
}

export default function App() {
  const t = useT();
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Boot />
      <ScrollManager />
      <Shortcuts />
      <a className="skip" href="#main" onClick={(e) => { e.preventDefault(); const m = document.getElementById("main"); m?.focus(); m?.scrollIntoView(); }}>{t("app.skip")}</a>
      <Nav />
      <div className="nav-gap" aria-hidden="true" />
      <Banner />
      <div className="shell-body">
        <main id="main" className="shell-main" tabIndex={-1}>
          <Routes>
            {ROUTES.map((r) => <Route key={r.id} path={r.path} element={<RouteFrame route={r} />} />)}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
        <LiveTape />
        <Footer />
      </div>
      <TabBar />
      <Palette />
      <HelpSheet />
      <Toaster />
    </BrowserRouter>
  );
}
