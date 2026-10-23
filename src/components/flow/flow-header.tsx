import type { FlowStep, FlowTrack } from "@/lib/flow/types";
import { Logo } from "./mark";
import { Stepper } from "./stepper";

export function FlowHeader({
  current,
  track = "translation",
  showStepper = true,
}: {
  current: FlowStep;
  track?: FlowTrack;
  showStepper?: boolean;
}) {
  return (
    <header className="border-b border-line">
      <div className="flex items-center justify-between px-4 py-3 md:hidden">
        <Logo />
        <span className="text-sm text-ink-muted">Help</span>
      </div>
      {showStepper ? (
        <div className="overflow-x-auto px-4 pb-3 md:hidden">
          <Stepper current={current} compact track={track} />
        </div>
      ) : null}
      <div className="hidden h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-10 md:grid">
        <Logo />
        <div className="min-w-0 overflow-x-auto">
          {showStepper ? <Stepper current={current} track={track} /> : null}
        </div>
        <span className="text-sm text-ink-muted">Help</span>
      </div>
    </header>
  );
}
