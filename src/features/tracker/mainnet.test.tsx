// Real debt on screen: the console's reserves table and key lookup (/tracker/mainnet) and our tracker's reserves on
// /network/tracker/<nft> show the debt and coverage the tracker reports, "0 ERG" with coverage "—" when there is no
// debt. The live API sends 0 and null in /reserves until the tracker update after 22 Nov, so its answers are mocked
// here, shaped like ErgoScan's test reserve: 0.55 ERG of collateral, notes of 0.6 ERG with 0.45 redeemed.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { addI18n, setLang } from "@/app/lang";
import { OUR_TRACKER, parseKeyStatus, parseReserves, type OurView } from "@/chain";
import { ratioPct } from "@/ui";
import { OurReserves } from "@/features/network/Ours";
import networkStrings from "@/features/network/strings";
import { KeyResult, Reserves } from "./Mainnet";
import strings from "./strings";

const TEST = OUR_TRACKER.testReserveOwner;
const BOX = "619613ea5c102b9bfde14fc9c80b4a9dda5fa0dbb3b7493d6e7d623878eb12ff";
const COVER = ratioPct(3.6666666666666665);

const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

/** One /reserves entry as the API sends it, u64 amounts already quoted. */
const reserve = (o: Record<string, unknown> = {}) => ({
  box_id: BOX, owner_pubkey: TEST, collateral_amount: "550000000", total_debt: "0", tracker_nft_id: OUR_TRACKER.nft,
  last_updated_height: 1922368, last_updated_timestamp: 1795362663875, collateralization_ratio: null, refund_initiation_height: 0, ...o,
});

/** The view the tables read: only the reserves answer matters here. */
const viewOf = (list: unknown[]): OurView => {
  const parsed = parseReserves(list);
  if (!parsed) throw new Error("not a reserves list");
  return { reserves: parsed.list, reservesAt: null, reservesCached: false, reservesError: null, skipped: 0, answeredAt: 1, status: "live" } as unknown as OurView;
};

const keyStatus = (d: { total_debt: string; collateralization_ratio: number | null }) => {
  const k = parseKeyStatus({
    issuer_pubkey: TEST, note_count: 1, last_updated: 1795362663875, has_pending_refund: false,
    denominations: [{ denomination: "erg", symbol: "ERG", decimals: 9, collateral: "550000000", note_count: 1, reserve_box_id: BOX, has_pending_refund: false, ...d }],
  });
  if (!k) throw new Error("not a key status");
  return k;
};

beforeAll(() => {
  addI18n(strings);
  addI18n(networkStrings);
  setLang("en");
});

describe("reserves tables: the tracker's debt and coverage", () => {
  it("show the debt and the coverage the tracker reports", () => {
    const v = viewOf([reserve({ total_debt: "150000000", collateralization_ratio: 3.6666666666666665 })]);
    for (const out of [html(<Reserves v={v} />), html(<OurReserves v={v} />)]) {
      expect(out).toContain(">0.55 ERG<");
      expect(out).toContain(">0.15 ERG<");
      expect(out).toContain(COVER);
      expect(out).toContain("Coverage");
      expect(out).not.toContain("from notes");
      expect(out).not.toContain("stays 0");
    }
  });

  it("show 0 debt as 0 ERG, with coverage —", () => {
    const v = viewOf([reserve({ total_debt: "0", collateralization_ratio: null })]);
    for (const out of [html(<Reserves v={v} />), html(<OurReserves v={v} />)]) {
      expect(out).toContain(">0 ERG<");
      expect(out).toContain('<span class="dim">—</span>');
      expect(out).not.toContain("%");
    }
  });

  it("show — for a coverage the tracker did not send", () => {
    const v = viewOf([reserve({ total_debt: "150000000", collateralization_ratio: null })]);
    for (const out of [html(<Reserves v={v} />), html(<OurReserves v={v} />)]) {
      expect(out).toContain(">0.15 ERG<");
      expect(out).toContain('<span class="dim">—</span>');
      expect(out).not.toContain("%");
    }
  });
});

describe("key lookup: debt and coverage per denomination", () => {
  it("shows the debt and collateral with their unit, and the coverage", () => {
    const out = html(<KeyResult data={keyStatus({ total_debt: "150000000", collateralization_ratio: 3.6666666666666665 })} at={Date.now()} from={null} />);
    expect(out).toContain(">0.15 ERG<");
    expect(out).toContain(">0.55 ERG<");
    expect(out).toContain(COVER);
  });

  it("shows 0 debt as 0 ERG, with coverage —", () => {
    const out = html(<KeyResult data={keyStatus({ total_debt: "0", collateralization_ratio: 999999.0 })} at={Date.now()} from={null} />);
    expect(out).toContain(">0 ERG<");
    expect(out).toContain('<span class="dim">—</span>');
    expect(out).not.toContain("no debt");
    expect(out).not.toContain("%");
  });
});
