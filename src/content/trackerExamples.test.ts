// The working examples on /learn/developers and /learn/api: read routes only, against the public address, with
// placeholders for keys and the answers in the server's envelope.
import { describe, expect, it } from "vitest";
import { ERGOSCAN_TRACKER_URL, apiEndpoints, clients, trackerExamples } from "./index";

const reads = clients.accepted.find((g) => g.id === "reads")?.endpoints ?? [];

describe("tracker examples", () => {
  it("call only routes the public tracker opens for reading, each with a catalogue entry", () => {
    expect(trackerExamples.length).toBeGreaterThan(0);
    for (const x of trackerExamples) {
      expect(apiEndpoints.some((e) => e.id === x.endpoint)).toBe(true);
      expect(reads).toContain(x.endpoint);
    }
  });

  it("are curl commands against the public address, with placeholders instead of real keys", () => {
    for (const x of trackerExamples) {
      expect(x.curl.startsWith("curl -s ")).toBe(true);
      expect(x.curl).toContain(ERGOSCAN_TRACKER_URL + "/");
      expect(x.curl).not.toMatch(/\b0[23][0-9a-f]{64}\b/);
    }
  });

  it("show the server's envelope: success, data, error", () => {
    for (const x of trackerExamples) {
      expect(x.response).toMatch(/^\{\n {2}"success": true,\n {2}"data": /);
      expect(x.response.trimEnd().endsWith('"error": null\n}')).toBe(true);
    }
  });
});
