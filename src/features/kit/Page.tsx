// /kit — every component of src/ui in its real states, with sample data from the sandbox town.
import "./kit.css";
import { Link } from "react-router-dom";
import { LangSeg, MOD, ThemeSeg } from "@/app/chrome";
import { openCommandBar } from "@/app/commands";
import { addI18n, rich, useT } from "@/app/lang";
import { FaceTabs, Key, setUiSettings, Skyline, Switch, useLens, useUiSettings } from "@/ui";
import { Foundations, Seals } from "./Foundations";
import { FlowsSection, InputsSection, KeysSection, NoteSection } from "./Objects";
import { MotionSection } from "./Motion";
import { firePulse } from "./pulse";
import strings from "./strings";
import { GraphSection, LayoutSection, MachineSection, NeverSection, PolicySection, ReserveSection, StatesSection, ToastsSection } from "./Systems";

// the page's string table arrives with this lazy chunk; register it before the page renders
addI18n(strings);

const TOC: [string, string][] = [
  ["tokens", "kit.s.tokens"], ["seals", "kit.s.seals"], ["note", "kit.s.note"], ["keys", "kit.s.keys"], ["inputs", "kit.s.inputs"],
  ["flows", "kit.s.flows"], ["reserve", "kit.s.reserve"], ["graph", "kit.s.graph"], ["policy", "kit.s.policy"], ["toasts", "kit.s.toasts"],
  ["motion", "kit.s.motion"], ["states", "kit.s.states"], ["machine", "kit.s.machine"], ["layout", "kit.s.layout"], ["never", "kit.s.dd"],
];

export default function KitPage() {
  const t = useT();
  const ui = useUiSettings();
  const [lens, setLens] = useLens();
  return (
    <div className="kit">
      <header className="kit-head">
        <Skyline className="field" seed={5} height={140} span={1600} lit={0.2} tower={1240} />
        <div className="container">
          <div className="eyebrow label">{t("kit.eyebrow")}</div>
          <h1 className="t-h1" style={{ marginTop: 14, maxWidth: "14em" }}>{rich(t("kit.h1"))}</h1>
          <p className="t-lede" style={{ marginTop: 18, maxWidth: "40em" }}>{t("kit.lede")}</p>
          <div className="kit-controls">
            <ThemeSeg />
            <LangSeg />
            <FaceTabs value={lens} onChange={setLens} idBase="kit-head" />
            <Key variant="primary" icon="stamp" onClick={() => firePulse()}>{t("kit.pulse")}</Key>
            <Key icon="search" kbd={`${MOD} K`} onClick={() => openCommandBar()}>{t("kit.openCmdk")}</Key>
          </div>
          <div className="kit-switches">
            <Switch checked={ui.motion === "reduce"} onChange={(v) => setUiSettings({ motion: v ? "reduce" : "system" })} label={t("app.prefs.motion")} />
            <Switch checked={ui.privacy} onChange={(v) => setUiSettings({ privacy: v })} label={t("app.prefs.privacy")} />
            <Switch checked={ui.confirmPress} onChange={(v) => setUiSettings({ confirmPress: v })} label={t("app.prefs.confirm")} />
          </div>
          <nav className="kit-toc" aria-label={t("kit.toc")}>
            {TOC.map(([id, k], i) => <Link key={id} to={{ hash: id }}>{String(i + 1).padStart(2, "0")} · {t(k)}</Link>)}
          </nav>
        </div>
      </header>
      <Foundations />
      <Seals />
      <NoteSection />
      <KeysSection />
      <InputsSection />
      <FlowsSection />
      <ReserveSection />
      <GraphSection />
      <PolicySection />
      <ToastsSection />
      <MotionSection />
      <StatesSection />
      <MachineSection />
      <LayoutSection />
      <NeverSection />
    </div>
  );
}
