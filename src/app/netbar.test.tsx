// The Network place's bar (src/app/netbar.tsx NetPlaceBar) is one bar on /network and on /tracker: the same tag slot
// (mainnet or the practice sandbox, both kept so the sections never move), a slot for every count from the first
// frame (empty until the snapshot is here), and the span of the bar's light.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { NetPlaceBar } from "./netbar";

function render(at: string, node: JSX.Element): string {
  const error = console.error;
  console.error = (...a: unknown[]) => { if (!String(a[0]).includes("useLayoutEffect does nothing on the server")) error(...a); };
  try { return renderToStaticMarkup(<MemoryRouter initialEntries={[at]}>{node}</MemoryRouter>); } finally { console.error = error; }
}

describe("the Network place's bar", () => {
  it("draws both tags in one slot and shows the one that applies", () => {
    const main = render("/network", <NetPlaceBar />);
    expect(main).toContain('data-tag="mainnet"');
    expect(main).toMatch(/class="tg tg-main"(?! aria-hidden)/);
    expect(main).toMatch(/class="tg tg-play" aria-hidden="true"/);
    const play = render("/tracker/practice", <NetPlaceBar sandbox />);
    expect(play).toContain('data-tag="sandbox"');
    expect(play).toMatch(/class="tg tg-main" aria-hidden="true"/);
  });

  it("keeps a slot for each count before the numbers arrive", () => {
    const empty = render("/tracker/mainnet", <NetPlaceBar />);
    expect(empty.match(/<span class="n"><\/span>/g)?.length).toBe(5);
    const full = render("/network/reserves", <NetPlaceBar counts={{ reserves: 61, trackers: 13, redemptions: 50, contracts: 8, incidents: 7 }} />);
    expect(full).toContain('<span class="n">61</span>');
    expect(full.match(/<span class="n"><\/span>/g)).toBeNull();
  });

  it("lights the page's section and carries the light", () => {
    const html = render("/tracker/run", <NetPlaceBar />);
    expect(html).toMatch(/<a class="on" aria-current="page" href="\/tracker\/mainnet">/);
    expect(html).toContain('<span class="light" aria-hidden="true"></span>');
  });
});
