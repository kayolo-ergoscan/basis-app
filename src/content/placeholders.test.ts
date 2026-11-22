// Release guard, together with the "refuse-unfilled" plugin in vite.config.ts. A text that still waits for facts is
// written with the FILL marker: two opening square brackets, then FILL, then what is missing, then two closing ones.
// This test fails while any source file under src/ holds the marker, so a placeholder cannot ship unfilled.
// (The marker is never written out in this file, or the test would find itself.)
import { describe, expect, it } from "vitest";

const MARK = "[[" + "FILL";
const files = import.meta.glob<string>("/src/**/*.{ts,tsx,css,json,html}", { query: "?raw", import: "default", eager: true });

describe("release guard", () => {
  it("reads the app sources", () => {
    expect(Object.keys(files).length).toBeGreaterThan(100);
    expect(Object.keys(files)).toContain("/src/content/history.ts");
  });

  it("leaves no FILL placeholder in src/ (write the text first)", () => {
    const hits = Object.entries(files).filter(([, text]) => text.includes(MARK)).map(([path]) => path);
    expect(hits).toEqual([]);
  });
});
