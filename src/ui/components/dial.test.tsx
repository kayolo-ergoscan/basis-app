// The dead-man dial's words: a tracker with a known heartbeat is never called "late" between two heartbeats.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { addI18n, setLang } from "@/app/lang";
import uiStrings from "../i18n";
import { Dial, trackerBand } from "./measures";

beforeAll(() => {
  addI18n(uiStrings);
  setLang("ru");
});

describe("Dial", () => {
  it("keeps the product bands without a heartbeat (sandbox, unknown trackers)", () => {
    expect([0, 119, 120, 719, 720, 2159, 2160].map((b) => trackerBand(b))).toEqual(["ontime", "ontime", "late", "late", "silent", "silent", "emergency"]);
  });

  it("calls ErgoScan's tracker on time up to its heartbeat + slack (750), silent after it, never late", () => {
    expect([0, 675, 750, 751, 2159, 2160].map((b) => trackerBand(b, 750))).toEqual(["ontime", "ontime", "ontime", "silent", "silent", "emergency"]);
    const idle = renderToStaticMarkup(<Dial blocks={675} quiet={750} />);
    expect(idle).toContain("ВОВРЕМЯ");
    expect(idle).not.toContain("ОПАЗДЫВАЕТ");
    expect(renderToStaticMarkup(<Dial blocks={675} />)).toContain("ОПАЗДЫВАЕТ");
    expect(renderToStaticMarkup(<Dial blocks={900} quiet={750} />)).toContain("МОЛЧИТ");
  });
});
