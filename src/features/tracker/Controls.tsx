// Operator controls for the sandbox tracker. Each control says in one line what it does to the town. They call the
// town's commands (never the engine), and every outcome comes back as the world's own toast.
import { useEffect, useRef, useState } from "react";
import { useT } from "@/app/lang";
import { censorshipModes, pick } from "@/content";
import type { CensorshipMode } from "@/protocol";
import { Card, int, Key, Seg, Switch, useUiSettings } from "@/ui";
import { AGENTS, BUSINESSES, HUMANS, town, useTown, YOU, type Toast as WorldToast } from "@/world";
import type { TrackerView } from "./model";
import { useNameOf, useOutcomeToast } from "./townParts";

const SKIPS = [5, 120, 720, 2160] as const;

/**
 * A completed hold swaps "Hold to go dark" for "Bring it back" at the same spot. The release that ends the hold
 * (a touch's synthesized click, or the Space key's click on keyup once focus has moved) must not press the new key,
 * or the tracker comes straight back. Swallow clicks until shortly after the pointer or key is released.
 */
function swallowReleaseClick(): void {
  const swallow = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const ends = ["pointerup", "pointercancel", "touchend", "touchcancel", "mouseup", "keyup"] as const;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    for (const x of ends) document.removeEventListener(x, end, true);
    window.setTimeout(() => document.removeEventListener("click", swallow, true), 450);
  };
  document.addEventListener("click", swallow, true);
  for (const x of ends) document.addEventListener(x, end, true);
  window.setTimeout(end, 8000);
}

export function Controls({ v }: { v: TrackerView }) {
  const t = useT();
  const show = useOutcomeToast();
  const nameOf = useNameOf();
  const joined = useTown((s) => s.joined);
  const [busy, setBusy] = useState<string | null>(null);
  // "Confirm with a second press" turns the hold into two clicks: then no press is still down when the key swaps
  const { confirmPress } = useUiSettings();
  // the dark / back key swaps on every switch: keep keyboard focus on whichever key now stands in that spot
  const slot = useRef<HTMLButtonElement | null>(null);
  const refocus = useRef(false);
  useEffect(() => {
    if (!refocus.current) return;
    refocus.current = false;
    const a = document.activeElement;
    if (!a || a === document.body) slot.current?.focus({ preventScroll: true });
  }, [v.online]);

  // calm: an outcome the card already shows in place (going dark, censoring) is told once, not left as a sticky alarm
  const run = async (id: string, f: () => Promise<{ toast: WorldToast }>, calm = false) => {
    if (busy) return;
    setBusy(id);
    try {
      const o = await f();
      show(calm && o.toast.kind === "alarm" ? { ...o.toast, kind: "info", sticky: false } : o.toast);
    } finally {
      setBusy(null);
    }
  };

  const people = [...(joined ? [YOU] : []), ...HUMANS, ...BUSINESSES, ...AGENTS];
  const censoring = v.censor.mode !== "off";
  const [mode, setMode] = useState<CensorshipMode>(censoring ? v.censor.mode : "refuse");
  const [picked, setPicked] = useState<string[]>(() => (censoring && v.censor.targets !== "all" ? v.censor.targets : []));
  const toggle = (id: string) => setPicked((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));
  const who = v.censor.targets === "all" ? t("tracker.ctl.censor.all") : v.censor.targets.map(nameOf).join(", ");

  return (
    <Card className="trk-ctl" title={t("tracker.ctl.title")}>
      <p className="t-small trk-ctl-sub">{t("tracker.ctl.sub")}</p>

      <div className="trk-ctl-list">
        <div className="trk-ctl-item">
          <Key icon="stamp" onClick={() => run("commit", () => town.tracker.commit())} disabled={!!busy || !v.online} aria-busy={busy === "commit" || undefined}>
            {t("tracker.ctl.commit")}
          </Key>
          <p className="t-small">{v.online ? t("tracker.ctl.commit.line", { n: int(v.interval) }) : t("tracker.ctl.commit.dark")}</p>
        </div>

        <div className="trk-ctl-item trk-ctl-switch">
          <Switch
            checked={v.heartbeat}
            onChange={(on) => run("heartbeat", () => town.tracker.setHeartbeat(on))}
            disabled={!!busy}
            label={t("tracker.ctl.heartbeat")}
            help={v.heartbeat ? t("tracker.ctl.heartbeat.on") : t("tracker.ctl.heartbeat.off")}
          />
        </div>

        <div className="trk-ctl-item">
          {v.online ? (
            <Key
              key="dark"
              ref={slot}
              icon="eyeOff"
              hold
              onAct={() => {
                refocus.current = true;
                if (!confirmPress) swallowReleaseClick();
                void run("dark", () => town.tracker.setOnline(false), true);
              }}
              disabled={!!busy}
            >
              {t("tracker.ctl.dark")}
            </Key>
          ) : (
            <Key
              key="back"
              ref={slot}
              variant="primary"
              icon="eye"
              onClick={() => {
                refocus.current = true;
                void run("back", () => town.tracker.setOnline(true));
              }}
              disabled={!!busy}
            >
              {t("tracker.ctl.back")}
            </Key>
          )}
          <p className="t-small">{v.online ? t("tracker.ctl.dark.line") : v.heartbeat || v.dirty ? t("tracker.ctl.back.line") : t("tracker.ctl.back.idle")}</p>
        </div>

        <fieldset className="trk-ctl-item trk-censor">
          <legend className="t-h4">{t("tracker.ctl.censor")}</legend>
          <Seg<CensorshipMode>
            ariaLabel={t("tracker.ctl.censor.mode")}
            value={mode}
            onChange={setMode}
            options={(["refuse", "omit"] as const).map((m) => ({ value: m, label: pick(censorshipModes[m].title, t.lang), title: pick(censorshipModes[m].text, t.lang) }))}
          />
          <p className="t-small">{pick(censorshipModes[mode].text, t.lang)}</p>
          <div className="trk-picks" role="group" aria-label={t("tracker.ctl.censor.who")}>
            {people.map((id) => (
              <button key={id} type="button" className="trk-pick" aria-pressed={picked.includes(id)} onClick={() => toggle(id)}>
                {nameOf(id)}
              </button>
            ))}
          </div>
          <div className="trk-censor-keys">
            <Key size="sm" disabled={!!busy || picked.length === 0} onClick={() => run("censor", () => town.tracker.setCensorship(mode, picked), true)}>
              {t("tracker.ctl.censor.apply")}
            </Key>
            {censoring && (
              <Key size="sm" variant="quiet" disabled={!!busy} onClick={() => run("censor-off", () => town.tracker.setCensorship("off", []))}>
                {t("tracker.ctl.censor.stop")}
              </Key>
            )}
            {picked.length === 0 && <span className="t-small dim">{t("tracker.ctl.censor.pick")}</span>}
          </div>
          {censoring && (
            <p className="t-small trk-censor-now" role="status">
              <b>{t(v.censor.mode === "refuse" ? "tracker.ctl.censor.now.refuse" : "tracker.ctl.censor.now.omit", { who })}</b>
            </p>
          )}
          <p className="trk-warn t-small">
            <span className="g" aria-hidden="true">!</span>
            <span>{t("tracker.ctl.censor.warn")}</span>
          </p>
        </fieldset>

        <div className="trk-ctl-item">
          <div className="t-h4">{t("tracker.ctl.skip")}</div>
          <div className="trk-skip" role="group" aria-label={t("tracker.ctl.skip")}>
            {SKIPS.map((n) => (
              <Key key={n} size="sm" variant="quiet" disabled={!!busy} onClick={() => run(`skip${n}`, () => town.clock.mine(n))}>
                {t.p("tracker.ctl.skip.key", n, { n: int(n) })}
              </Key>
            ))}
          </div>
          <p className="t-small">{t("tracker.ctl.skip.line")}</p>
        </div>
      </div>
    </Card>
  );
}
