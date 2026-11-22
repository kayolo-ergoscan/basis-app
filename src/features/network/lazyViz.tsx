// @/viz pulls in the whole protocol bundle, so the Network chunk loads it only where a page needs it: the clocks on a
// reserve and the template tool in the contracts sheet. A skeleton holds the space while the chunk arrives.
import { Component, lazy, Suspense, type ComponentProps, type ReactNode } from "react";
import { Loading } from "@/ui";

const ExitClocksLazy = lazy(() => import("@/viz").then((m) => ({ default: m.ExitClocks })));
const TemplateHashToolLazy = lazy(() => import("@/viz").then((m) => ({ default: m.TemplateHashTool })));

class Guard extends Component<{ fallback: ReactNode; children: ReactNode }, { err: boolean }> {
  state = { err: false };
  static getDerivedStateFromError() { return { err: true }; }
  render() { return this.state.err ? this.props.fallback : this.props.children; }
}

export function ExitClocks(p: ComponentProps<typeof ExitClocksLazy> & { loading: string; failed: ReactNode }) {
  const { loading, failed, ...rest } = p;
  return (
    <Guard fallback={failed}>
      <Suspense fallback={<div className="nw-lazy"><Loading label={loading} seed="clocks" lines={3} /></div>}>
        <ExitClocksLazy {...rest} />
      </Suspense>
    </Guard>
  );
}

export function TemplateHashTool(p: ComponentProps<typeof TemplateHashToolLazy> & { loading: string; failed: ReactNode }) {
  const { loading, failed, ...rest } = p;
  return (
    <Guard fallback={failed}>
      <Suspense fallback={<div className="nw-lazy"><Loading label={loading} seed="template" lines={4} /></div>}>
        <TemplateHashToolLazy {...rest} />
      </Suspense>
    </Guard>
  );
}
