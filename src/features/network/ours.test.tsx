// ErgoScan's tracker page (/network/tracker/<our NFT>) lists the redemptions found on chain for its NFT: the same merged
// list the redemptions page and the totals count, so a redemption seen in the boxes and then read is counted once.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { addI18n, setLang } from "@/app/lang";
import seedJson from "@/chain/seed.json";
import { buildObservatory, contractIndex, CURRENT_TEMPLATES, emptyLive, interpretTx, liveBoxFromApi, OUR_TRACKER, p2sAddress, type ApiBox, type Seed } from "@/chain";
import chainStrings from "@/chain/i18n";
import { idleStatus } from "@/chain/model";
import uiStrings from "@/ui/i18n";
import { TrackerPanel } from "./Overview";
import { OUR_REDEMPTION_READS, OurRedemptions, ourRedemptionReads } from "./Ours";
import strings from "./strings";

const seed = seedJson as unknown as Seed;
const H = seed.asOf.height;
const html = (el: ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

const CUR = contractIndex(seed).list.find((c) => c.current && c.kind === "erg")!;
const own = seed.reserves.find((x) => !x.spent && x.owner && x.regs.R5)!;
const [C0, R1, R2] = ["c0", "d1", "d2"].map((x) => x.repeat(32));
const [A, B, C] = ["a1", "b1", "c1"].map((x) => x.repeat(32));
const box = (id: string, tx: string, value: string, height: number, spentTx: string | null): ApiBox => ({
  boxId: id, transactionId: tx, value, creationHeight: height, settlementHeight: height + 1, ergoTree: CUR.ergoTree, address: p2sAddress(CUR.ergoTree),
  assets: [{ tokenId: "0c".repeat(32), amount: "1" }], additionalRegisters: { R4: own.regs.R4, R5: own.regs.R5, R6: `0e20${OUR_TRACKER.nft}` }, spentTransactionId: spentTx,
});
// a reserve bound to our tracker: A (1 ERG) → R1 → B (0.9) → R2 → C (0.65, unspent)
const boxes = [box(A, C0, "1000000000", H + 463, R1), box(B, R1, "900000000", H + 473, R2), box(C, R2, "650000000", H + 485, null)];

function liveData(listed: boolean) {
  const l = emptyLive();
  for (const b of boxes) l.extraReserves[b.boxId] = liveBoxFromApi(b);
  if (listed) for (const h of [CURRENT_TEMPLATES.erg, CURRENT_TEMPLATES.multiToken]) l.detector.templates[h] = { total: h === CURRENT_TEMPLATES.erg ? 3 : 0, checkedAt: 1, checkedHeight: H + 600 };
  return l;
}

beforeAll(() => {
  addI18n(strings);
  addI18n(chainStrings);
  addI18n(uiStrings);
  setLang("en");
});

describe("our tracker page: redemptions found on chain", () => {
  it("lists the redemptions of reserves bound to our NFT, none of the snapshot's, each once", () => {
    const l = liveData(true);
    // R1 read; R2 known from the boxes only
    l.txs[R1] = interpretTx(seed, { id: R1, inclusionHeight: H + 474, timestamp: 1_795_380_000_000, inputs: [boxes[0]], dataInputs: [], outputs: [boxes[1]] });
    const obs = buildObservatory({ seed, live: l, tip: H + 600 });
    const out = html(<OurRedemptions obs={obs} />);
    expect(out).toContain("Redemptions it served");
    expect(out.match(/class="nw-rd[ "]/g)?.length).toBe(2);
    expect(out).toContain(`/network/tx/${R1}`);
    expect(out).toContain(`/network/tx/${R2}`);
    expect(out).toContain('<span class="label num">2</span>');
    // the box-only one waits for its transaction ("checking…" and its block), the read one has its date
    expect(out).toContain("block 1,922,335");
    // the same two are what the totals count beyond the snapshot
    expect(obs.totals.redemptions).toBe(seed.redemptions.length + 2);
    // the page reads the box-only one itself (a first look), not the one already read
    const mine = obs.redemptions.filter((x) => x.trackerNft === OUR_TRACKER.nft);
    expect(ourRedemptionReads(mine)).toEqual([R2]);
    // only the rows shown first, so a long list costs at most that many reads
    const many = Array.from({ length: 20 }, (_, i) => ({ ...mine.find((x) => x.tx === R2)!, tx: i.toString(16).padStart(64, "0") }));
    expect(ourRedemptionReads(many)).toHaveLength(OUR_REDEMPTION_READS);
    expect(ourRedemptionReads(null)).toEqual([]);
  });

  it("says «checking…», not «None», before this tab has listed the current templates", () => {
    const empty = emptyLive();
    const out = html(<OurRedemptions obs={buildObservatory({ seed, live: empty, tip: H + 600 })} />);
    expect(out).toContain("checking…");
    expect(out).not.toContain("None.");
    expect(html(<OurRedemptions obs={null} />)).toContain("checking…");
    // once listed, an empty list is an answer
    const listed = emptyLive();
    for (const h of [CURRENT_TEMPLATES.erg, CURRENT_TEMPLATES.multiToken]) listed.detector.templates[h] = { total: 0, checkedAt: 1, checkedHeight: H + 600 };
    expect(html(<OurRedemptions obs={buildObservatory({ seed, live: listed, tip: H + 600 })} />)).toContain("None.");
    // the live layer failed before its first look: the snapshot predates this tracker, so no "None." either
    const failed = html(<OurRedemptions obs={buildObservatory({ seed, live: emptyLive(), tip: H + 600, status: { ...idleStatus(), lastError: "HTTP 503" } })} />);
    expect(failed).toContain("Not checked live yet");
    expect(failed).not.toContain("None.");
  });
});

describe("tracker cards", () => {
  it("our tracker's dial is on time between heartbeats; another tracker of the same age is late", () => {
    const obs = buildObservatory({ seed, live: emptyLive(), tip: H });
    const other = obs.trackers.find((x) => x.status === "live" && x.lastTrackerBox?.unspent)!;
    const tip = other.lastTrackerBox!.height + 681;
    const aria = (nft: string) => html(<TrackerPanel tr={{ ...other, nft, emergency: other.emergency && { ...other.emergency, age: 681 } }} tip={tip} />).match(/class="dial"[^>]*aria-label="([^"]*)"/)?.[1] ?? "";
    expect(aria(OUR_TRACKER.nft)).toMatch(/on time/i);
    expect(aria(other.nft)).toMatch(/late/i);
  });
});
