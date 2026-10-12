import type { FlowStep } from "@/lib/flow/types";
import { Logo } from "./mark";
import { Stepper } from "./stepper";

export function FlowHeader({ current }: { current: FlowStep }) {
  return (
    <header className="border-b border-line">
      <div className="flex items-center justify-between px-4 py-3 md:hidden">
        <Logo />
        <span className="text-sm text-ink-muted">Help</span>
      </div>
      <div className="overflow-x-auto px-4 pb-3 md:hidden">
        <Stepper current={current} compact />
      </div>
      <div className="hidden h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-10 md:grid">
        <Logo />
        <div className="min-w-0 overflow-x-auto">
          <Stepper current={current} />
        </div>
        <span className="text-sm text-ink-muted">Help</span>
      </div>
    </header>
  );
}
