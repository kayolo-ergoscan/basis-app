// Lazy chunks a page switch loads first (src/app/chunk.ts, src/app/motion.ts): a chunk loads once and remembers its
// module, a failed load can be tried again, a data part is never loaded ahead of a switch, and a chunk that is already
// loaded renders at once (no Suspense fallback, so a switch never shows a loader frame).
import { Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { chunk, lazyChunk, loadParts, part } from "./chunk";

const Hello = ({ who }: { who: string }) => <b>hello {who}</b>;

describe("chunk", () => {
  it("loads once and keeps the module", async () => {
    const loader = vi.fn(() => Promise.resolve({ default: Hello }));
    const c = chunk(loader);
    expect(c.ready()).toBe(false);
    expect(c.get()).toBeUndefined();
    const [a, b] = await Promise.all([c.load(), c.load()]);
    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
    expect(c.ready()).toBe(true);
    expect(c.get()?.default).toBe(Hello);
    await c.load();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("tries again after a failed load", async () => {
    let n = 0;
    const c = chunk(() => (++n === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ default: Hello })));
    await expect(c.load()).rejects.toThrow("offline");
    expect(c.ready()).toBe(false);
    await c.load();
    expect(c.ready()).toBe(true);
    expect(n).toBe(2);
  });
});

describe("part", () => {
  it("is data, ready once resolved, and retried after a failure", async () => {
    let n = 0;
    const p = part(() => (++n === 1 ? Promise.reject(new Error("no")) : Promise.resolve(1)));
    expect(p.data).toBe(true);
    await expect(p.load()).rejects.toThrow("no");
    expect(p.ready()).toBe(false);
    await p.load();
    expect(p.ready()).toBe(true);
  });
});

describe("loadParts", () => {
  it("loads only what is missing, and no data when only code is wanted", async () => {
    const code = chunk(() => Promise.resolve({ default: Hello }));
    const dataLoad = vi.fn(() => Promise.resolve(null));
    const data = part(dataLoad);
    const pCode = loadParts([code, data], true);
    expect(pCode).not.toBeNull();
    await pCode;
    expect(code.ready()).toBe(true);
    expect(dataLoad).not.toHaveBeenCalled();
    expect(loadParts([code, data], true)).toBeNull();
    await loadParts([code, data]);
    expect(dataLoad).toHaveBeenCalledTimes(1);
    expect(loadParts([code, data])).toBeNull();
  });
});

describe("lazyChunk", () => {
  const html = (node: JSX.Element) => renderToStaticMarkup(<Suspense fallback={<i>wait</i>}>{node}</Suspense>);

  it("renders a loaded chunk at once, without the fallback", async () => {
    const c = chunk(() => Promise.resolve({ default: Hello }));
    await c.load();
    const L = lazyChunk(c);
    expect(html(<L who="town" />)).toBe("<b>hello town</b>");
  });

  it("suspends like React.lazy while the chunk is not loaded", () => {
    const c = chunk(() => new Promise<{ default: typeof Hello }>(() => {}));
    const L = lazyChunk(c);
    expect(html(<L who="town" />)).toBe("<i>wait</i>");
  });
});
