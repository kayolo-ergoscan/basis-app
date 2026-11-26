// Clear round 26.11: a key goes straight to Home and is backed up later, but before anything can bring value to it.
// Until the backup is checked, no screen renders the key's address or its QR (top-up), the payment request (its QR and
// «Copy link»), the key to share («Copy key»), the project button or the key chip's full address; the backup step is
// shown in their place. Once it is checked, they are all there.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { addI18n, setLang } from "@/app/lang";
import type { MainnetVault, VaultState } from "@/mainnet/vault";
import strings from "./strings";
import { MwCtx, type MwContext } from "./ctx";
import { ReceiveScreen } from "./Receive";
import { FundScreen } from "./Fund";
import { HomeScreen } from "./Home";
import { SettingsScreen } from "./Settings";
import { TopBar, NAV, KEY_MENU } from "./Page";

// the public throwaway key of the QA fixtures (redesign-2026-11-25): never funded on purpose, nothing secret here
const PUB = "02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9";
const ADDRESS = "9gQojEoYr8vjJyG1jQS5EAZ3Pupun6DbojoyDESvCZYi3M9VyYF";

const stateOf = (backedUp: boolean): VaultState => ({
  status: "unlocked", backedUp, lockReason: null, missing: [], persisted: true, v: 1,
  key: { pub: PUB, address: ADDRESS, createdAt: Date.UTC(2026, 10, 26), backedUpAt: backedUp ? Date.UTC(2026, 10, 26) : null, source: "created" },
} as unknown as VaultState);

const ctxOf = (backedUp: boolean): MwContext => ({
  vault: {} as MainnetVault, state: stateOf(backedUp), entries: [], me: { pub: PUB, address: ADDRESS, tree: "0008cd" + PUB }, height: 1923300,
});

const html = (el: ReactElement, backedUp: boolean, path = "/wallet/mainnet/receive") =>
  renderToStaticMarkup(<MemoryRouter initialEntries={[path]}><MwCtx.Provider value={ctxOf(backedUp)}>{el}</MwCtx.Provider></MemoryRouter>);

const EN = strings.en as Record<string, string>;
const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

beforeAll(() => {
  // server rendering warns about every useLayoutEffect (the motion hooks): expected here, kept out of the output
  const err = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) err(...a); });
  addI18n(strings);
  setLang("en");
  vi.stubGlobal("location", { origin: "https://basis.ergoscan.me" });
});
afterAll(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("the backup gate: nothing that brings value to the key before its backup is checked", () => {
  it("Receive: no request QR, no «Copy link», no «Copy key», no project button, no address; the backup step instead", () => {
    const out = html(<ReceiveScreen />, false);
    expect(out).toContain(EN["mw.gate.backupT"]);
    expect(out).not.toContain(`aria-label="${attr(EN["mw.recv.askQr"])}"`);
    expect(out).not.toContain(`aria-label="${attr(EN["mw.recv.copyLink"])}"`);
    expect(out).not.toContain(`aria-label="${attr(EN["mw.recv.copyPk"])}"`);
    expect(out).not.toContain(EN["mw.tip.t"]);
    expect(out).not.toContain(ADDRESS);
    expect(out).not.toContain(PUB);
    expect(out).not.toContain("<svg class=\"wl-qr\"");
  });

  it("Receive after the backup: the request QR, «Copy link» and «Copy key», the project button under «More ways»", () => {
    const out = html(<ReceiveScreen />, true);
    expect(out).not.toContain(EN["mw.gate.backupT"]);
    expect(out).toContain(`aria-label="${attr(EN["mw.recv.askQr"])}"`);
    expect(out).toContain(`aria-label="${attr(EN["mw.recv.copyLink"])}"`);
    expect(out).toContain(`aria-label="${attr(EN["mw.recv.copyPk"])}"`);
    expect(out).toContain(EN["mw.tip.t"]);
    expect(out).toContain(EN["mw.recv.moreT"]);
    expect(out).toContain(EN["mw.recv.mineT"]);
  });

  it("the top-up address and its QR: not before the backup, there after it", () => {
    const before = html(<FundScreen />, false, "/wallet/mainnet/fund");
    expect(before).toContain(EN["mw.gate.backupT"]);
    expect(before).not.toContain(ADDRESS);
    expect(before).not.toContain(`aria-label="${attr(EN["mw.fund.qr"])}"`);
    const after = html(<FundScreen />, true, "/wallet/mainnet/fund");
    expect(after).toContain(ADDRESS);
    expect(after).toContain(`aria-label="${attr(EN["mw.fund.qr"])}"`);
  });

  it("Home: the nudge until the backup is checked, never the address; gone after it", () => {
    const before = html(<HomeScreen />, false, "/wallet/mainnet");
    expect(before).toContain(EN["mw.home.nudgeT"]);
    expect(before).toContain('href="/wallet/mainnet/setup"');
    expect(before).not.toContain(ADDRESS);
    expect(before).not.toContain(PUB);
    const after = html(<HomeScreen />, true, "/wallet/mainnet");
    expect(after).not.toContain(EN["mw.home.nudgeT"]);
    // three main actions, the reserve as a row, the history card, the beta note
    for (const k of ["mw.nav.pay", "mw.nav.receive", "mw.home.redeem", "mw.home.histT", "mw.beta.t"]) expect(after).toContain(EN[k]);
  });

  it("Settings: the key short and the backup step before it is checked; the full address and key after", () => {
    const before = html(<SettingsScreen />, false, "/wallet/mainnet/settings");
    expect(before).not.toContain(ADDRESS);
    expect(before).not.toContain(PUB);
    expect(before).toContain(EN["mw.start.download"]);
    const after = html(<SettingsScreen />, true, "/wallet/mainnet/settings");
    expect(after).toContain(EN["mw.set.pub"]);
  });

  it("the key chip: its full address only after the backup", () => {
    const chip = (b: boolean) => html(<TopBar ctx={ctxOf(b)} />, b, "/wallet/mainnet");
    expect(chip(false)).not.toContain(ADDRESS);
    expect(chip(true)).toContain(`title="${ADDRESS}"`);
  });
});

describe("the wallet menu: four items, the reserve and the settings in the key menu", () => {
  it("Home · Pay · Receive · History; Reserve and Settings open from the key chip", () => {
    expect(NAV.map(([to]) => to)).toEqual(["/wallet/mainnet", "/wallet/mainnet/pay", "/wallet/mainnet/receive", "/wallet/mainnet/activity"]);
    expect(KEY_MENU.map(([to]) => to)).toEqual(["/wallet/mainnet/reserve", "/wallet/mainnet/settings"]);
    const out = html(<TopBar ctx={ctxOf(true)} />, true, "/wallet/mainnet");
    expect(out).toContain('class="mw-keymenu"');
    expect(out).toContain('href="/wallet/mainnet/reserve"');
    expect(out).toContain('href="/wallet/mainnet/settings"');
    expect(out).toContain(EN["mw.top.lock"]);
  });
});
