// The notes panel holds the height of its tallest tab (motion round): the other tabs' empty states are drawn hidden
// (aria-hidden; the page script marks them inert) so their height is known before such a tab opens.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NotesPanel } from "./notes";

function render(node: JSX.Element): string {
  const error = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) error(...a); };
  try { return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>); } finally { console.error = error; }
}

describe("the notes panel's held height", () => {
  it("draws the other empty tabs hidden, the shown one once", () => {
    const html = render(<NotesPanel rows={[]} nowMs={0} hrefOf={() => "/wallet"} tab="out" onTab={() => {}} />);
    const sizer = html.slice(html.indexOf('class="wl-notes-sizer"'));
    expect(html).toContain('<div class="wl-notes-sizer" aria-hidden="true">');
    // all, in and agents are measured; out is the visible one, outside the sizer
    expect(sizer.match(/class="empty"/g)?.length).toBe(3);
    expect(html.match(/class="empty"/g)?.length).toBe(4);
  });

  it("draws no sizer without tabs", () => {
    const html = render(<NotesPanel rows={[]} nowMs={0} hrefOf={() => "/wallet"} tab="all" onTab={() => {}} tabs={false} limit={6} />);
    expect(html).not.toContain("wl-notes-sizer");
    expect(html.match(/class="empty"/g)?.length).toBe(1);
  });
});
