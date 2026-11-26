// The page and tab switch (src/ui/motion.ts): a cross-fade only where the View Transitions API is there, motion is
// allowed and the tab is visible; anything else switches at once. The bars that stay live during the fade are named for
// that one switch and unnamed after it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { canFade, crossFade, FADE_MS } from "./motion";
import { setUiSettings } from "./settings";

const g = globalThis as unknown as Record<string, unknown>;
afterEach(() => {
  delete g.document; delete g.HTMLElement; delete g.getComputedStyle;
  setUiSettings({ motion: "system" });
});

class FakeEl {
  props = new Map<string, string>();
  style = { setProperty: (k: string, v: string) => this.props.set(k, v), removeProperty: (k: string) => this.props.delete(k) };
}
function fakeDom(opts: { vt?: boolean; hidden?: boolean } = {}) {
  let finish: () => void = () => {};
  const calls: string[] = [];
  const start = vi.fn((update: () => Promise<void>) => {
    calls.push("start");
    const done = update();
    return {
      updateCallbackDone: done,
      ready: Promise.resolve(),
      finished: new Promise<void>((r) => { finish = r; }),
      skipTransition: () => calls.push("skip"),
    };
  });
  g.HTMLElement = FakeEl;
  g.getComputedStyle = (el: FakeEl) => ({ viewTransitionName: el.props.get("view-transition-name") ?? "none" });
  g.document = {
    visibilityState: opts.hidden ? "hidden" : "visible",
    documentElement: { classList: { toggle: () => {} } },
    ...(opts.vt === false ? {} : { startViewTransition: start }),
  };
  return { start, calls, finish: () => finish() };
}

describe("motion budget", () => {
  it("stays quick: every duration ≤ 250 ms", () => {
    expect(FADE_MS).toBeLessThanOrEqual(250);
  });
});

describe("crossFade", () => {
  it("switches at once without a document (and without the API)", () => {
    const update = vi.fn();
    crossFade(update);
    expect(update).toHaveBeenCalledTimes(1);
    const dom = fakeDom({ vt: false });
    expect(canFade()).toBe(false);
    crossFade(update);
    expect(update).toHaveBeenCalledTimes(2);
    expect(dom.start).not.toHaveBeenCalled();
  });

  it("switches at once under reduced motion or in a hidden tab", () => {
    const dom = fakeDom();
    setUiSettings({ motion: "reduce" });
    const update = vi.fn();
    crossFade(update);
    expect(update).toHaveBeenCalledTimes(1);
    expect(dom.start).not.toHaveBeenCalled();
    setUiSettings({ motion: "system" });
    const hidden = fakeDom({ hidden: true });
    crossFade(update);
    expect(update).toHaveBeenCalledTimes(2);
    expect(hidden.start).not.toHaveBeenCalled();
  });

  it("fades with the API, keeps the pressed bar live during the switch only", async () => {
    const dom = fakeDom();
    expect(canFade()).toBe(true);
    const bar = new FakeEl();
    const update = vi.fn();
    crossFade(update, [bar as unknown as Element]);
    expect(dom.start).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(bar.props.get("view-transition-name")).toBe("vt-live-a");
    dom.finish();
    await new Promise((r) => setTimeout(r, 0));
    expect(bar.props.has("view-transition-name")).toBe(false);
  });

  it("leaves a bar that is already named (the always-live bars) as it is", () => {
    fakeDom();
    const bar = new FakeEl();
    bar.props.set("view-transition-name", "bar-place");
    crossFade(() => {}, [bar as unknown as Element]);
    expect(bar.props.get("view-transition-name")).toBe("bar-place");
  });

  it("a switch during a fade finishes the older one at once", () => {
    const dom = fakeDom();
    crossFade(() => {});
    crossFade(() => {});
    expect(dom.calls).toEqual(["start", "skip", "start"]);
  });
});
