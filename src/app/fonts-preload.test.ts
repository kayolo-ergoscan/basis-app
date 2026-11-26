// Russian pages start the Cyrillic fonts through document.fonts.load (one request per file, via the @font-face rule),
// never by adding <link rel=preload>: that raced the stylesheet and fetched the Cyrillic display face twice.
import { afterEach, describe, expect, it, vi } from "vitest";
import { preloadFonts } from "./fonts-preload";

const g = globalThis as unknown as { document?: unknown };
afterEach(() => { delete g.document; });

describe("preloadFonts", () => {
  it("asks the font set for the Cyrillic faces on a Russian page and adds no link", () => {
    const load = vi.fn(() => Promise.resolve([]));
    const appendChild = vi.fn();
    g.document = { fonts: { load }, head: { appendChild }, createElement: vi.fn() };
    preloadFonts("ru");
    expect(load.mock.calls).toEqual([['400 1em "Geist Variable"', "Ж"], ['600 1em "Unbounded Variable"', "Ж"]]);
    expect(appendChild).not.toHaveBeenCalled();
  });

  it("asks for the mono Cyrillic face later, once the page is idle", () => {
    vi.useFakeTimers();
    try {
      const load = vi.fn(() => Promise.resolve([]));
      g.document = { fonts: { load } };
      preloadFonts("ru");
      expect(load).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1500);
      expect(load.mock.calls[2]).toEqual(['500 1em "Geist Mono Variable"', "Ж"]);
    } finally { vi.useRealTimers(); }
  });

  it("does nothing on an English page (index.html preloads the Latin files) or without a font set", () => {
    const load = vi.fn(() => Promise.resolve([]));
    g.document = { fonts: { load } };
    preloadFonts("en");
    expect(load).not.toHaveBeenCalled();
    g.document = {};
    expect(() => preloadFonts("ru")).not.toThrow();
  });
});
